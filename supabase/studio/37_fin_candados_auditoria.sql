-- 37_fin_candados_auditoria.sql — STUDIO RD (04-oct-2026). Primera parte de las correcciones de la auditoría del
-- módulo de Financiamiento (docs/bitacora/2026-10-04-0200-claude.md). Pedido del dueño: «Empieza».
--
-- Incluye lo que NO depende de cambiar las funciones de cobro existentes:
--   · A2: las ventas financiadas dejan de contar como fiado (vista pos_ventas_fiado + saldo del servidor).
--   · A3: abono de fiado por RPC (valida monto y saldo, caja, número de recibo y asiento en una sola transacción;
--     idempotente) y eliminar abono solo admin/gerente; abonos y sus asientos ya no se tocan a mano.
--   · M4: montos de pagos y abonos con centavos exactos; un pago de cuota cuyo desglose no cuadra se rechaza.
--   · M3: las funciones del módulo trabajan en hora de RD (current_date ya no salta de día a las 8 p. m.).
--   · M1/M2/L1: anon sin acceso a las funciones internas; datos legales solo para el servidor; caminos viejos (v1)
--     cerrados. (Quitar TRUNCATE a anon/authenticated queda para aplicarlo a mano: la herramienta lo trata como destructivo.)
-- PENDIENTE (decisión del dueño): candados de cuotas/financiamientos, pagos solo por RPC, banco del cajero y
-- solicitud congelada (C1, C2, A1, A5) — requieren que las funciones de cobro existentes se identifiquen ante los
-- candados; ver bitácora.
-- No toca datos existentes. Reversa al final.

begin;
set local lock_timeout = '5s';

-- ── 0. Utilidades ──────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.nx_hoy() returns date language sql stable set search_path = public
as $$ select (now() at time zone 'America/Santo_Domingo')::date $$;

-- Cambio hecho por el sistema: servicio/SQL (sin usuario) o dentro de una RPC del fiado (marca local nx.fin_rpc,
-- que la app no puede fijar: set_config no está expuesta por la API y cada petición es su propia transacción).
create or replace function public.nx_fin_privilegiado() returns boolean language sql stable set search_path = public
as $$ select auth.uid() is null or coalesce(current_setting('nx.fin_rpc', true), '') = '1' $$;

-- ── 1. Fiado: las ventas financiadas no son fiado (A2) ──────────────────────────────────────────────────────────
create or replace view public.pos_ventas_fiado with (security_invoker = true) as
  select v.* from public.pos_ventas v
   where coalesce(v.credito_monto, 0) > 0 and v.estado is distinct from 'anulada'
     and not exists (select 1 from public.pos_financiamientos f where f.venta_id = v.id and f.estado is distinct from 'cancelado');
grant select on public.pos_ventas_fiado to authenticated;

create or replace function public.pos_fiado_saldo_cliente(p_cliente_id uuid) returns numeric language sql stable set search_path = public as $$
  select round(coalesce((select sum(v.credito_monto) from public.pos_ventas_fiado v where v.cliente_id = p_cliente_id and v.organizacion_id = mi_organizacion()), 0)
             - coalesce((select sum(a.monto) from public.pos_abonos a where a.cliente_id = p_cliente_id and a.organizacion_id = mi_organizacion()), 0), 2)
$$;

-- ── 2. Abonos de fiado: solo por RPC (A3) ───────────────────────────────────────────────────────────────────────
alter table public.pos_abonos add column if not exists operacion_id uuid;
create unique index if not exists pos_abonos_operacion_uidx on public.pos_abonos (organizacion_id, operacion_id) where operacion_id is not null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'pos_abonos_centavos_chk') then
    alter table public.pos_abonos add constraint pos_abonos_centavos_chk check (monto = round(monto, 2));
  end if;
end $$;

create or replace function public.pos_abonos_aa_guard_directo() returns trigger language plpgsql set search_path = public as $$
begin
  if public.nx_fin_privilegiado() then return coalesce(new, old); end if;
  -- Mantenimiento del administrador (Ajustes → borrar datos de prueba borra abonos y asientos en lote): solo borrar.
  if tg_op = 'DELETE' and public.mi_rol() = 'admin' then return old; end if;
  raise exception 'ABONO_SOLO_POR_SISTEMA' using detail = 'Los abonos se registran y eliminan con sus botones (contabilidad incluida)';
end $$;
create or replace trigger pos_abonos_aa_guard_directo before insert or update or delete on public.pos_abonos
  for each row execute function public.pos_abonos_aa_guard_directo();

-- Asientos de abonos de fiado (cobro / rebaja_cliente): no se inventan, editan ni borran a mano.
create or replace function public.pos_asiento_aa_guard_cobro() returns trigger language plpgsql set search_path = public as $$
declare v_tipo text;
begin
  if public.nx_fin_privilegiado() then return coalesce(new, old); end if;
  if tg_table_name = 'pos_asientos' then
    if (tg_op <> 'INSERT' and old.tipo in ('cobro', 'rebaja_cliente')) or (tg_op <> 'DELETE' and new.tipo in ('cobro', 'rebaja_cliente')) then
      if tg_op = 'DELETE' and public.mi_rol() = 'admin' then return old; end if;
      raise exception 'ASIENTO_COBRO_SOLO_POR_SISTEMA' using detail = 'Los asientos de abonos se crean y anulan con el abono';
    end if;
  else
    select a.tipo into v_tipo from public.pos_asientos a where a.id = coalesce(new.asiento_id, old.asiento_id);
    if v_tipo in ('cobro', 'rebaja_cliente') then
      if tg_op = 'DELETE' and public.mi_rol() = 'admin' then return old; end if;
      raise exception 'ASIENTO_COBRO_SOLO_POR_SISTEMA' using detail = 'Los asientos de abonos se crean y anulan con el abono';
    end if;
  end if;
  return coalesce(new, old);
end $$;
create or replace trigger pos_asiento_aa_guard_cobro before insert or update or delete on public.pos_asientos
  for each row execute function public.pos_asiento_aa_guard_cobro();
create or replace trigger pos_asiento_aa_guard_cobro before insert or update or delete on public.pos_asiento_lineas
  for each row execute function public.pos_asiento_aa_guard_cobro();

create or replace function public.pos_fiado_registrar_abono(
  p_cliente_id uuid, p_monto numeric, p_metodo text default 'Efectivo', p_nota text default null,
  p_fecha date default null, p_operacion_id uuid default null, p_created_by_name text default null)
returns jsonb language plpgsql set search_path = public set timezone = 'America/Santo_Domingo' as $$
declare v_org uuid := mi_organizacion(); v_rol text := mi_rol(); v_cli record; v_monto numeric := round(p_monto, 2);
  v_saldo numeric; v_fecha date := current_date; v_met text := coalesce(nullif(trim(p_metodo), ''), 'Efectivo');
  v_efe boolean; v_caja uuid; v_num text; v_id uuid; v_asiento uuid; v_prev record;
begin
  perform set_config('nx.fin_rpc', '1', true);
  if v_rol is null or v_org is null then raise exception 'FIADO_SIN_PERMISO'; end if;
  if p_operacion_id is not null then
    select id, numero into v_prev from public.pos_abonos where organizacion_id = v_org and operacion_id = p_operacion_id;
    if v_prev.id is not null then perform set_config('nx.fin_rpc', '', true); return jsonb_build_object('ok', true, 'id', v_prev.id, 'numero', v_prev.numero, 'repetido', true); end if;
  end if;
  if v_monto is null or v_monto <= 0 then raise exception 'FIADO_MONTO_INVALIDO'; end if;
  select id, nombre into v_cli from public.pos_clientes where id = p_cliente_id and organizacion_id = v_org for update;
  if v_cli.id is null then raise exception 'FIADO_CLIENTE_NO_ENCONTRADO'; end if;
  v_saldo := public.pos_fiado_saldo_cliente(p_cliente_id);
  if v_monto > v_saldo then raise exception 'FIADO_EXCEDE_SALDO' using detail = format('saldo %s, abono %s', v_saldo, v_monto); end if;
  if p_fecha is not null and p_fecha <> current_date then
    if v_rol not in ('admin','gerente') or p_fecha > current_date then raise exception 'FIADO_FECHA_SOLO_ADMIN'; end if;
    v_fecha := p_fecha;
  end if;
  v_efe := lower(v_met) = 'efectivo';
  if v_efe then
    v_caja := public.pos_fin_caja_abierta(true);
    if v_caja is null then raise exception 'FIADO_CAJA_CERRADA'; end if;
  end if;
  update public.pos_secuencias set proximo = proximo + 1
   where organizacion_id = v_org and tipo = 'recibo' and activo is distinct from false
   returning coalesce(prefijo, '') || lpad((proximo - 1)::text, greatest(coalesce(longitud, 5), length((proximo - 1)::text)), '0') into v_num;

  insert into public.pos_abonos (organizacion_id, cliente_id, monto, fecha, metodo, nota, numero, caja_id, created_by_name, operacion_id)
  values (v_org, p_cliente_id, v_monto, v_fecha, v_met, nullif(left(trim(coalesce(p_nota, '')), 300), ''), v_num, v_caja,
          nullif(trim(coalesce(p_created_by_name, '')), ''), p_operacion_id)
  returning id into v_id;

  -- Asiento igual que el que hacía la app: Debe Caja (efectivo) o Banco / Haber Cuentas por cobrar.
  perform public.pos_asegurar_cuentas_operativas(v_org);
  insert into public.pos_asientos (organizacion_id, fecha, concepto, referencia, tipo, origen_id, numero)
  values (v_org, v_fecha, 'Abono cliente ' || coalesce(v_cli.nombre, ''), v_num, 'cobro', v_id, 'AB-' || coalesce(v_num, substr(v_id::text, 1, 8)))
  returning id into v_asiento;
  insert into public.pos_asiento_lineas (organizacion_id, asiento_id, cuenta_id, cuenta_codigo, cuenta_nombre, descripcion, debito, credito)
  select v_org, v_asiento, id, codigo, nombre, case when v_efe then 'Entrada de efectivo' else 'Ingreso por medio electrónico' end, v_monto, 0
    from public.pos_cuentas where organizacion_id = v_org and codigo = case when v_efe then '1101' else '1102' end;
  insert into public.pos_asiento_lineas (organizacion_id, asiento_id, cuenta_id, cuenta_codigo, cuenta_nombre, descripcion, debito, credito)
  select v_org, v_asiento, id, codigo, nombre, 'Abono a cuenta por cobrar', 0, v_monto
    from public.pos_cuentas where organizacion_id = v_org and codigo = '1103';
  if (select count(*) from public.pos_asiento_lineas where asiento_id = v_asiento) <> 2 then raise exception 'FIADO_CUENTAS_CONTABLES_FALTAN'; end if;

  perform set_config('nx.fin_rpc', '', true); return jsonb_build_object('ok', true, 'id', v_id, 'numero', v_num, 'saldo', v_saldo - v_monto);
exception when unique_violation then
  if p_operacion_id is not null then
    select id, numero into v_prev from public.pos_abonos where organizacion_id = v_org and operacion_id = p_operacion_id;
    if v_prev.id is not null then perform set_config('nx.fin_rpc', '', true); return jsonb_build_object('ok', true, 'id', v_prev.id, 'numero', v_prev.numero, 'repetido', true); end if;
  end if;
  raise;
end $$;

create or replace function public.pos_fiado_eliminar_abono(p_abono_id uuid) returns jsonb
language plpgsql set search_path = public set timezone = 'America/Santo_Domingo' as $$
declare v_org uuid := mi_organizacion(); v_ab record;
begin
  perform set_config('nx.fin_rpc', '1', true);
  if mi_rol() not in ('admin','gerente') then raise exception 'FIADO_ELIMINAR_SOLO_ADMIN'; end if;
  select * into v_ab from public.pos_abonos where id = p_abono_id and organizacion_id = v_org for update;
  if v_ab.id is null then raise exception 'FIADO_ABONO_NO_ENCONTRADO'; end if;
  delete from public.pos_asientos where organizacion_id = v_org and origen_id = v_ab.id and tipo in ('cobro', 'rebaja_cliente');
  delete from public.pos_abonos where id = v_ab.id;
  perform set_config('nx.fin_rpc', '', true); return jsonb_build_object('ok', true, 'monto', v_ab.monto);
end $$;

-- ── 3. Pagos de cuota: centavos exactos y desglose que cuadra (M4) ──────────────────────────────────────────────
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'pos_fin_pagos_centavos_chk') then
    alter table public.pos_fin_pagos add constraint pos_fin_pagos_centavos_chk check (monto = round(monto, 2));
  end if;
end $$;
create or replace function public.pos_fin_pago_zz_cuadre() returns trigger language plpgsql set search_path = public as $$
begin
  if new.monto_principal is not null
     and new.monto <> coalesce(new.monto_principal, 0) + coalesce(new.monto_interes, 0) + coalesce(new.monto_mora, 0) then
    raise exception 'FIN_PAGO_NO_CUADRA' using detail = format('monto %s ≠ capital %s + interés %s + mora %s',
      new.monto, new.monto_principal, coalesce(new.monto_interes, 0), coalesce(new.monto_mora, 0));
  end if;
  return new;
end $$;
create or replace trigger pos_fin_pago_zz_cuadre before insert on public.pos_fin_pagos for each row execute function public.pos_fin_pago_zz_cuadre();

-- ── 4. Hora RD y permisos de las funciones del módulo (M1, M2, M3, L1) ──────────────────────────────────────────
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as f, p.prorettype = 'trigger'::regtype as es_trigger
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and (p.proname like 'pos_fin\_%' or p.proname like 'pos_credito\_%' or p.proname like 'pos_fiado\_%')
              and p.prokind = 'f'
  loop
    execute format('alter function %s set timezone = %L', r.f, 'America/Santo_Domingo');
    if not r.es_trigger then
      execute format('revoke all on function %s from public, anon', r.f);
      execute format('grant execute on function %s to authenticated, service_role', r.f);
    end if;
  end loop;
end $$;
-- La página pública de firma (firma-financiamiento.html) usa estas cuatro sin sesión.
grant execute on function public.pos_fin_firma_ver(uuid) to anon;
grant execute on function public.pos_fin_firma_guardar(uuid, text, text, text, boolean) to anon;
grant execute on function public.pos_fin_sol_ver(uuid) to anon;
grant execute on function public.pos_fin_sol_enviar(uuid, text, text, text, text, text, text, text, boolean) to anon;
-- Solo para el servidor: datos legales de la empresa (cédulas de abogado/testigos) y los caminos viejos (v1).
revoke execute on function public.pos_fin_legal_snapshot(uuid) from authenticated;
revoke execute on function public.pos_fin_crear_plan_venta(uuid, integer, text, date) from authenticated;
revoke execute on function public.pos_fin_registrar_pago from authenticated;
revoke all on function public.nx_fin_privilegiado() from public, anon;
grant execute on function public.nx_fin_privilegiado() to authenticated, service_role;
commit;

-- REVERSA (manual):
--   drop trigger pos_abonos_aa_guard_directo on pos_abonos; drop trigger pos_asiento_aa_guard_cobro on pos_asientos;
--   drop trigger pos_asiento_aa_guard_cobro on pos_asiento_lineas; drop trigger pos_fin_pago_zz_cuadre on pos_fin_pagos;
--   alter table pos_abonos drop constraint pos_abonos_centavos_chk; alter table pos_fin_pagos drop constraint pos_fin_pagos_centavos_chk;
--   drop function pos_fiado_registrar_abono, pos_fiado_eliminar_abono, pos_fiado_saldo_cliente; drop view pos_ventas_fiado;
--   alter function … reset timezone; volver a dar execute a anon si hiciera falta.
