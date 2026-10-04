-- 38 · Financiamiento STUDIO: candados C1, C2, A1 y A5 de la auditoría (bitácora 2026-10-04-0200), opción (a) aprobada por
-- el dueño el 04-oct-2026 («1- sí»): las funciones de cobro EXISTENTES se reescriben explícitamente aquí, idénticas a las
-- de producción salvo UNA línea al inicio (`perform set_config('nx.fin_rpc','1',true);`) que las identifica ante los candados.
-- Huellas md5 del cuerpo original (antes de la línea añadida), comprobadas al aplicar:
--   pos_credito_castigar            c4fb6a28f15cf542ff89fc04289cfa0c
--   pos_credito_refinanciar         2d3ceaefaeba9ea096722690190955d6
--   pos_fin_crear_financiamiento_v2 c3c0a7ccb0013aa844d3908e74425c2c
--   pos_fin_registrar_pago_v2       8f4602b650b76f66c261a61ff3807a7f
--   pos_fin_reversar_pago           7b67c22518740b6f6722abd73f98a70b
-- Datos al aplicar: 0 financiamientos, 0 solicitudes. No toca datos históricos.

begin;

-- ── 1. ¿Quién puede escribir directo en las tablas de cobro? ─────────────────────────────────────────────────────
-- Sí: el servidor (sin sesión), funciones SECURITY DEFINER (corren como su dueño, no como authenticated/anon) y las
-- funciones de cobro marcadas con nx.fin_rpc / nx.fin_recalc. No: un PATCH/POST por REST desde el navegador.
create or replace function public.nx_fin_escritura_ok() returns boolean
language sql stable set search_path = public as $$
  select auth.uid() is null
      or current_user not in ('authenticated', 'anon')
      or coalesce(current_setting('nx.fin_rpc', true), '') = '1'
      or coalesce(current_setting('nx.fin_recalc', true), '') = '1'
$$;
revoke all on function public.nx_fin_escritura_ok() from public, anon;
grant execute on function public.nx_fin_escritura_ok() to authenticated, service_role;

-- Camino viejo (v1, financiamiento_v2 apagado): escribe por REST; se respeta mientras esa organización siga en v1.
create or replace function public.nx_fin_v1_org(p_org uuid) returns boolean
language sql stable set search_path = public as $$
  select coalesce((select not coalesce(financiamiento_v2, false) from public.pos_config where organizacion_id = p_org limit 1), true)
$$;
revoke all on function public.nx_fin_v1_org(uuid) from public, anon;
grant execute on function public.nx_fin_v1_org(uuid) to authenticated, service_role;

-- ── 2. C1: cuotas y financiamientos solo por las funciones del sistema ─────────────────────────────────────────────
create or replace function public.pos_fin_cuotas_aa_guard() returns trigger
language plpgsql set search_path = public as $$
declare v_org uuid := coalesce(new.organizacion_id, old.organizacion_id);
begin
  if public.nx_fin_escritura_ok() or public.nx_fin_v1_org(v_org) then return coalesce(new, old); end if;
  raise exception 'FIN_CUOTA_SOLO_POR_SISTEMA' using hint = 'Las cuotas se cambian cobrando, reversando o perdonando recargo desde Financiamiento.';
end $$;
create or replace trigger pos_fin_cuotas_aa_guard before insert or update or delete on public.pos_fin_cuotas
  for each row execute function public.pos_fin_cuotas_aa_guard();

create or replace function public.pos_financiamientos_aa_guard() returns trigger
language plpgsql set search_path = public as $$
declare v_org uuid := coalesce(new.organizacion_id, old.organizacion_id);
begin
  if public.nx_fin_escritura_ok() or public.nx_fin_v1_org(v_org) then return coalesce(new, old); end if;
  if tg_op = 'UPDATE' then
    -- Firma de la tienda en el contrato (pantalla «Firmar»): solo esas tres columnas.
    if (to_jsonb(new) - array['firma_tienda','firma_tienda_por','firma_tienda_en']) = (to_jsonb(old) - array['firma_tienda','firma_tienda_por','firma_tienda_en']) then
      return new;
    end if;
    -- Anular la factura cancela su plan: solo admin/gerente, solo pasar a «cancelado» y solo si la venta ya está anulada.
    if mi_rol() in ('admin','gerente') and new.estado = 'cancelado' and old.estado is distinct from 'cancelado'
       and (to_jsonb(new) - 'estado') = (to_jsonb(old) - 'estado')
       and exists (select 1 from public.pos_ventas v where v.id = new.venta_id and v.organizacion_id = v_org and v.estado = 'anulada') then
      return new;
    end if;
  end if;
  raise exception 'FIN_FINANCIAMIENTO_SOLO_POR_SISTEMA' using hint = 'Los financiamientos se crean al aprobar y cambian al cobrar, refinanciar o castigar.';
end $$;
create or replace trigger pos_financiamientos_aa_guard before insert or update or delete on public.pos_financiamientos
  for each row execute function public.pos_financiamientos_aa_guard();

-- ── 3. C2: un pago de cuota solo entra por pos_fin_registrar_pago_v2 / pos_fin_reversar_pago ────────────────────────
create or replace function public.pos_fin_pagos_aa_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if public.nx_fin_escritura_ok() or public.nx_fin_v1_org(new.organizacion_id) then return new; end if;
  raise exception 'FIN_PAGO_SOLO_POR_SISTEMA' using hint = 'Cobre la cuota desde Financiamiento → Cobrar cuota.';
end $$;
create or replace trigger pos_fin_pagos_aa_guard before insert on public.pos_fin_pagos
  for each row execute function public.pos_fin_pagos_aa_guard();

-- ── 4. A1: cajero y vendedor pueden cobrar cuota por transferencia ───────────────────────────────────────────────
-- El movimiento de banco lo escribe la función de cobro (nx.fin_rpc); la política vieja (solo admin/gerente) sigue igual
-- para todo lo demás.
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'pos_banco_movimientos' and policyname = 'pos_banco_mov_cobro_cuota') then
    create policy pos_banco_mov_cobro_cuota on public.pos_banco_movimientos for insert to authenticated
      with check (organizacion_id = mi_organizacion() and mi_rol() is not null
                  and coalesce(current_setting('nx.fin_rpc', true), '') = '1'
                  and origen_tipo in ('pago_cuota', 'reversa_pago_cuota'));
  end if;
end $$;

-- ── 5. A5: expediente y condiciones congelados una vez enviado ───────────────────────────────────────────────────
-- · Las fotos, el video, la firma y la declaración del cliente solo los escribe la página pública (SECURITY DEFINER).
-- · Con el expediente enviado, precio, artículos, inicial, plan y plazos solo los cambia un admin/gerente.
create or replace function public.pos_fin_solicitud_ab_congelar() returns trigger
language plpgsql set search_path = public as $$
begin
  if public.nx_fin_escritura_ok() then return new; end if;
  if (new.exp_cedula_frente, new.exp_cedula_dorso, new.exp_selfie, new.exp_video, new.exp_firma, new.exp_enviado_en, new.exp_meta, new.declaracion, new.exp_estado)
     is distinct from
     (old.exp_cedula_frente, old.exp_cedula_dorso, old.exp_selfie, old.exp_video, old.exp_firma, old.exp_enviado_en, old.exp_meta, old.declaracion, old.exp_estado) then
    raise exception 'FIN_EXPEDIENTE_SOLO_CLIENTE' using hint = 'El expediente lo envía el cliente desde su enlace; para cambiarlo, pida una corrección.';
  end if;
  if coalesce(old.exp_estado, '') = 'enviado' and coalesce(mi_rol(), '') not in ('admin', 'gerente')
     and (new.items, new.precio_total, new.inicial, new.inicial_metodo, new.plan_id, new.primera_fecha, new.num_cuotas, new.frecuencia, new.cliente_id, new.monto_manual)
         is distinct from
         (old.items, old.precio_total, old.inicial, old.inicial_metodo, old.plan_id, old.primera_fecha, old.num_cuotas, old.frecuencia, old.cliente_id, old.monto_manual) then
    raise exception 'FIN_SOLICITUD_CONGELADA' using hint = 'Con el expediente enviado, solo un administrador o gerente puede cambiar las condiciones.';
  end if;
  return new;
end $$;
create or replace trigger pos_fin_solicitud_ab_congelar before update on public.pos_fin_solicitudes
  for each row execute function public.pos_fin_solicitud_ab_congelar();

-- ── 6. Funciones de cobro reescritas (idénticas + la línea marcada «38») ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pos_credito_castigar(p_financiamiento_id uuid, p_motivo text)
 RETURNS numeric
 LANGUAGE plpgsql
 SET search_path TO 'public'
 SET "TimeZone" TO 'America/Santo_Domingo'
AS $function$
declare v_org uuid:=mi_organizacion(); v public.pos_financiamientos%rowtype; v_saldo numeric; v_aid uuid;
begin
  perform set_config('nx.fin_rpc','1',true); -- 38
  if mi_rol() not in ('admin','gerente') then raise exception 'CREDITO_CASTIGO_SIN_PERMISO'; end if;
  if length(trim(coalesce(p_motivo,'')))<5 then raise exception 'CREDITO_CASTIGO_MOTIVO_REQUERIDO'; end if;
  select * into v from public.pos_financiamientos where id=p_financiamiento_id and organizacion_id=v_org for update;
  if v.id is null or v.estado<>'activo' then raise exception 'CREDITO_FINANCIAMIENTO_NO_ACTIVO'; end if;
  v_saldo:=public.pos_credito_saldo_principal(v.id);
  if v_saldo<=0.01 then raise exception 'CREDITO_SIN_SALDO'; end if;
  insert into public.pos_cuentas(organizacion_id,codigo,nombre,tipo,naturaleza,activo)
  values(v_org,'5201','Pérdidas por cuentas incobrables','gasto','deudora',true)
  on conflict (organizacion_id,codigo) do update set nombre=excluded.nombre,tipo=excluded.tipo,naturaleza=excluded.naturaleza,activo=true;
  update public.pos_financiamientos set estado='castigado',castigo_monto=v_saldo,castigo_fecha=current_date,castigo_motivo=trim(p_motivo),castigo_por=auth.uid() where id=v.id;
  insert into public.pos_credito_eventos(organizacion_id,cliente_id,financiamiento_id,tipo,monto,nota,creado_por)
  values(v_org,v.cliente_id,v.id,'castigo',v_saldo,trim(p_motivo),auth.uid());
  insert into public.pos_asientos(organizacion_id,fecha,concepto,referencia,tipo,origen_id,numero)
  values(v_org,current_date,'Castigo de cuenta incobrable',substr(v.id::text,1,8),'castigo_credito',v.id,'CI-'||substr(v.id::text,1,8)) returning id into v_aid;
  insert into public.pos_asiento_lineas(organizacion_id,asiento_id,cuenta_id,cuenta_codigo,cuenta_nombre,descripcion,debito,credito)
  select v_org,v_aid,id,codigo,nombre,'Pérdida por crédito incobrable',v_saldo,0 from public.pos_cuentas where organizacion_id=v_org and codigo='5201';
  insert into public.pos_asiento_lineas(organizacion_id,asiento_id,cuenta_id,cuenta_codigo,cuenta_nombre,descripcion,debito,credito)
  select v_org,v_aid,id,codigo,nombre,'Baja de cuenta por cobrar',0,v_saldo from public.pos_cuentas where organizacion_id=v_org and codigo='1103';
  return v_saldo;
end; $function$
;

CREATE OR REPLACE FUNCTION public.pos_credito_refinanciar(p_financiamiento_id uuid, p_cuotas_total integer, p_frecuencia text, p_primera_fecha date, p_nota text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
 SET "TimeZone" TO 'America/Santo_Domingo'
AS $function$
declare
  v_org uuid:=mi_organizacion(); v_old public.pos_financiamientos%rowtype; v_new uuid;
  v_saldo numeric; v_base numeric; v_monto numeric; v_fecha date; i integer;
begin
  perform set_config('nx.fin_rpc','1',true); -- 38
  if mi_rol() not in ('admin','gerente') then raise exception 'CREDITO_REFIN_SIN_PERMISO'; end if;
  if p_cuotas_total is null or p_cuotas_total<1 or p_cuotas_total>60 then raise exception 'CREDITO_CUOTAS_INVALIDAS'; end if;
  if p_frecuencia not in ('semanal','quincenal','mensual') then raise exception 'CREDITO_FRECUENCIA_INVALIDA'; end if;
  if p_primera_fecha is null or p_primera_fecha<current_date then raise exception 'CREDITO_PRIMER_VENCIMIENTO_INVALIDO'; end if;
  select * into v_old from public.pos_financiamientos where id=p_financiamiento_id and organizacion_id=v_org for update;
  if v_old.id is null or v_old.estado<>'activo' then raise exception 'CREDITO_FINANCIAMIENTO_NO_ACTIVO'; end if;
  v_saldo:=public.pos_credito_saldo_principal(v_old.id);
  if v_saldo<=0.01 then raise exception 'CREDITO_SIN_SALDO'; end if;
  v_base:=round(v_saldo/p_cuotas_total,2);
  insert into public.pos_financiamientos(organizacion_id,venta_id,cliente_id,cliente_nombre,descripcion,monto_total,inicial,monto_financiado,cuotas_total,cuota_monto,frecuencia,estado,refinanciado_desde_id)
  values(v_org,null,v_old.cliente_id,v_old.cliente_nombre,'Refinanciación de '||coalesce(v_old.descripcion,substr(v_old.id::text,1,8)),v_saldo,0,v_saldo,p_cuotas_total,v_base,p_frecuencia,'activo',v_old.id)
  returning id into v_new;
  for i in 1..p_cuotas_total loop
    v_monto:=case when i=p_cuotas_total then round(v_saldo-(v_base*(p_cuotas_total-1)),2) else v_base end;
    v_fecha:=case p_frecuencia when 'semanal' then p_primera_fecha+((i-1)*7) when 'quincenal' then p_primera_fecha+((i-1)*15) else (p_primera_fecha+make_interval(months=>i-1))::date end;
    insert into public.pos_fin_cuotas(organizacion_id,financiamiento_id,numero,fecha_venc,monto,pagado,monto_pagado)
    values(v_org,v_new,i,v_fecha,v_monto,false,0);
  end loop;
  update public.pos_financiamientos set estado='refinanciado',refinanciado_a_id=v_new where id=v_old.id;
  insert into public.pos_credito_eventos(organizacion_id,cliente_id,financiamiento_id,tipo,monto,fecha_compromiso,nota,creado_por)
  values(v_org,v_old.cliente_id,v_old.id,'refinanciacion',v_saldo,p_primera_fecha,coalesce(nullif(trim(p_nota),''),'Refinanciado a '||substr(v_new::text,1,8)),auth.uid());
  return v_new;
end; $function$
;

CREATE OR REPLACE FUNCTION public.pos_fin_crear_financiamiento_v2(p_venta_id uuid, p_plan_id uuid, p_primera_fecha date, p_solicitud_id uuid DEFAULT NULL::uuid, p_descripcion text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
 SET "TimeZone" TO 'America/Santo_Domingo'
AS $function$
declare
  v_org uuid:=mi_organizacion(); v public.pos_ventas%rowtype; pl public.pos_fin_planes%rowtype; cli public.pos_clientes%rowtype; cfg public.pos_config%rowtype;
  v_id uuid; v_codigo text; v_int_total numeric:=0; v_cuota1 numeric:=0; v_n int:=0; r record; v_vars jsonb; v_articulo text; v_empresa text; v_mora_txt text;
begin
  perform set_config('nx.fin_rpc','1',true); -- 38
  if mi_rol() not in ('admin','gerente') then raise exception 'FIN_SIN_PERMISO'; end if;
  if p_primera_fecha is null then raise exception 'FIN_PRIMER_VENCIMIENTO_REQUERIDO'; end if;
  select * into v from public.pos_ventas where id=p_venta_id and organizacion_id=v_org and estado='completada' for update;
  if v.id is null or coalesce(v.credito_monto,0)<=0 or v.cliente_id is null then raise exception 'FIN_VENTA_CREDITO_INVALIDA'; end if;
  if exists(select 1 from public.pos_financiamientos where organizacion_id=v_org and venta_id=v.id) then raise exception 'FIN_VENTA_YA_FINANCIADA'; end if;
  select * into pl from public.pos_fin_planes where id=p_plan_id and organizacion_id=v_org and activo;
  if pl.id is null then raise exception 'FIN_PLAN_INVALIDO'; end if;
  pl := public.pos_fin_plan_efectivo(p_plan_id, p_solicitud_id);
  select * into cli from public.pos_clientes where id=v.cliente_id and organizacion_id=v_org;
  select * into cfg from public.pos_config where organizacion_id=v_org limit 1;
  select nombre into v_empresa from public.organizaciones where id=v_org;

  select sum(interes), count(*) into v_int_total, v_n from public.pos_fin_amortizacion(v.credito_monto, pl.metodo, pl.num_cuotas, pl.cuotas_fase1, pl.tasa1, pl.tasa2, pl.frecuencia, p_primera_fecha);
  select cuota into v_cuota1 from public.pos_fin_amortizacion(v.credito_monto, pl.metodo, pl.num_cuotas, pl.cuotas_fase1, pl.tasa1, pl.tasa2, pl.frecuencia, p_primera_fecha) where numero=1;
  v_codigo := public.pos_fin_siguiente_codigo('financiamiento');

  select string_agg(coalesce(i.nombre,'Artículo')||case when i.serial is not null and i.serial<>'' then ' (serial '||i.serial||')' else '' end||' × '||trim(to_char(i.cantidad,'FM999999990.##')), ', ' order by i.linea_orden nulls last, i.id)
    into v_articulo from public.pos_venta_items i where i.venta_id=v.id;
  v_mora_txt := case pl.mora_tipo when 'fija' then public.pos_fin_fmt_monto(pl.mora_valor)||' por cuota' when 'pct' then trim(to_char(pl.mora_valor,'FM990.##'))||' % de la cuota' else 'sin mora' end
                || case when pl.mora_tipo<>'ninguna' then ' tras '||pl.mora_dias_gracia||' día(s) de gracia' else '' end;

  insert into public.pos_financiamientos(organizacion_id,venta_id,cliente_id,cliente_nombre,descripcion,monto_total,inicial,monto_financiado,cuotas_total,cuota_monto,frecuencia,estado,
    codigo,plan_id,solicitud_id,interes_total,primera_fecha,mora_tipo,mora_valor,mora_dias_gracia)
  values(v_org,v.id,v.cliente_id,coalesce(v.cliente_nombre,cli.nombre),coalesce(nullif(trim(p_descripcion),''),v_articulo,'Venta '||coalesce(v.numero_factura,v.numero::text)),
    v.total,v.total-v.credito_monto,v.credito_monto,pl.num_cuotas,v_cuota1,pl.frecuencia,'activo',
    v_codigo,pl.id,p_solicitud_id,coalesce(v_int_total,0),p_primera_fecha,pl.mora_tipo,pl.mora_valor,pl.mora_dias_gracia)
  returning id into v_id;

  for r in select * from public.pos_fin_amortizacion(v.credito_monto, pl.metodo, pl.num_cuotas, pl.cuotas_fase1, pl.tasa1, pl.tasa2, pl.frecuencia, p_primera_fecha) loop
    insert into public.pos_fin_cuotas(organizacion_id,financiamiento_id,numero,fecha_venc,monto,capital,interes,pagado,monto_pagado)
    values(v_org,v_id,r.numero,r.fecha_venc,r.cuota,r.capital,r.interes,false,0);
  end loop;

  v_vars := jsonb_build_object(
    'empresa', coalesce(v_empresa,'STUDIO'), 'codigo', coalesce(v_codigo,''), 'factura', coalesce(v.numero_factura, v.numero::text),
    'fecha', to_char(current_date,'DD/MM/YYYY'), 'cliente', coalesce(v.cliente_nombre,cli.nombre,''), 'cedula', coalesce(cli.cedula,''),
    'telefono', coalesce(cli.telefono,''), 'direccion', coalesce(cli.direccion,''), 'articulo', coalesce(v_articulo,''),
    'precio', public.pos_fin_fmt_monto(v.total), 'inicial', public.pos_fin_fmt_monto(v.total-v.credito_monto), 'capital', public.pos_fin_fmt_monto(v.credito_monto),
    'interes_total', public.pos_fin_fmt_monto(v_int_total), 'total', public.pos_fin_fmt_monto(v.credito_monto+coalesce(v_int_total,0)),
    'plan', pl.nombre, 'cuotas', pl.num_cuotas::text, 'frecuencia', pl.frecuencia, 'cuota_1', public.pos_fin_fmt_monto(v_cuota1),
    'primera_fecha', to_char(p_primera_fecha,'DD/MM/YYYY'), 'tasa1', trim(to_char(pl.tasa1,'FM990.##'))||' %', 'tasa2', trim(to_char(pl.tasa2,'FM990.##'))||' %',
    'cuotas_fase1', pl.cuotas_fase1::text, 'metodo_interes', case pl.metodo when 'saldo' then 'sobre saldo' else 'plano' end, 'mora', v_mora_txt);
  if nullif(trim(coalesce(cfg.fin_contrato_plantilla,'')),'') is not null then
    update public.pos_financiamientos set
      contrato_titulo = coalesce(nullif(trim(cfg.fin_contrato_titulo),''),'Contrato de venta a crédito'),
      contrato_texto = public.pos_fin_render_plantilla(cfg.fin_contrato_plantilla, v_vars),
      contrato_version = 1, contrato_en = now(),
      firma_token = gen_random_uuid(), firma_token_vence = now() + make_interval(hours => greatest(coalesce(cfg.fin_firma_vigencia_horas,72),1))
    where id=v_id;
  end if;
  return v_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.pos_fin_registrar_pago_v2(p_financiamiento_id uuid, p_cuota_id uuid, p_monto numeric, p_metodo text DEFAULT NULL::text, p_referencia text DEFAULT NULL::text, p_operacion_id uuid DEFAULT NULL::uuid, p_created_by_name text DEFAULT NULL::text, p_cuenta_bancaria_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
 SET "TimeZone" TO 'America/Santo_Domingo'
AS $function$
declare
  v_org uuid:=mi_organizacion(); v_id uuid; v_exist uuid; v_met text; v_caja uuid; v_principal numeric; v_interes numeric; v_mora numeric; v_asiento uuid;
begin
  perform set_config('nx.fin_rpc','1',true); -- 38
  if p_operacion_id is not null then select id into v_exist from public.pos_fin_pagos where organizacion_id=v_org and operacion_id=p_operacion_id; if v_exist is not null then return v_exist; end if; end if;
  perform public.pos_asegurar_cuentas_operativas(v_org);
  v_met:=lower(trim(coalesce(p_metodo,'')));
  if v_met='efectivo' then
    v_caja := public.pos_fin_caja_abierta(true);
    if v_caja is null then raise exception 'FIN_CAJA_CERRADA'; end if;
  elsif p_cuenta_bancaria_id is not null and not exists(select 1 from public.pos_cuentas_bancarias where id=p_cuenta_bancaria_id and organizacion_id=v_org and activa) then
    raise exception 'FIN_CUENTA_BANCARIA_INVALIDA';
  end if;

  insert into public.pos_fin_pagos(organizacion_id,financiamiento_id,cuota_id,monto,metodo,referencia,created_by_name,tipo,operacion_id,caja_id,cuenta_bancaria_id)
  values(v_org,p_financiamiento_id,p_cuota_id,p_monto,nullif(trim(p_metodo),''),nullif(trim(p_referencia),''),nullif(trim(p_created_by_name),''),'pago',p_operacion_id,v_caja,p_cuenta_bancaria_id)
  returning id,monto_principal,coalesce(monto_interes,0),monto_mora into v_id,v_principal,v_interes,v_mora;

  if v_met='efectivo' then
    insert into public.pos_caja_movimientos(caja_id,tipo,concepto,monto,created_by_name,organizacion_id)
    values(v_caja,'entrada','Pago de cuota',p_monto,p_created_by_name,v_org);
  elsif p_cuenta_bancaria_id is not null then
    insert into public.pos_banco_movimientos(organizacion_id,cuenta_bancaria_id,fecha,monto,concepto,referencia,origen_tipo,origen_id,origen_clave,creado_por)
    values(v_org,p_cuenta_bancaria_id,now(),p_monto,'Pago de cuota',nullif(trim(p_referencia),''),'pago_cuota',v_id,'pago_cuota:'||v_id::text,auth.uid());
  end if;

  insert into public.pos_asientos(organizacion_id,fecha,concepto,referencia,tipo,origen_id,numero)
  values(v_org,current_date,'Pago de cuota',coalesce(nullif(trim(p_referencia),''),substr(v_id::text,1,8)),'pago_cuota',v_id,'PC-'||substr(v_id::text,1,8)) returning id into v_asiento;
  insert into public.pos_asiento_lineas(organizacion_id,asiento_id,cuenta_id,cuenta_codigo,cuenta_nombre,descripcion,debito,credito)
  select v_org,v_asiento,id,codigo,nombre,case when v_met='efectivo' then 'Entrada de efectivo' else 'Ingreso por medio electrónico' end,p_monto,0
  from public.pos_cuentas where organizacion_id=v_org and codigo=case when v_met='efectivo' then '1101' else '1102' end;
  if v_principal>0 then insert into public.pos_asiento_lineas(organizacion_id,asiento_id,cuenta_id,cuenta_codigo,cuenta_nombre,descripcion,debito,credito)
    select v_org,v_asiento,id,codigo,nombre,'Reducción cuenta por cobrar (capital)',0,v_principal from public.pos_cuentas where organizacion_id=v_org and codigo='1103'; end if;
  if v_interes>0 then insert into public.pos_asiento_lineas(organizacion_id,asiento_id,cuenta_id,cuenta_codigo,cuenta_nombre,descripcion,debito,credito)
    select v_org,v_asiento,id,codigo,nombre,'Interés devengado de la cuota',0,v_interes from public.pos_cuentas where organizacion_id=v_org and codigo='4102'; end if;
  if v_mora>0 then insert into public.pos_asiento_lineas(organizacion_id,asiento_id,cuenta_id,cuenta_codigo,cuenta_nombre,descripcion,debito,credito)
    select v_org,v_asiento,id,codigo,nombre,'Recargo por mora',0,v_mora from public.pos_cuentas where organizacion_id=v_org and codigo='4103'; end if;
  return v_id;
exception when unique_violation then
  if p_operacion_id is not null then select id into v_id from public.pos_fin_pagos where organizacion_id=v_org and operacion_id=p_operacion_id; if v_id is not null then return v_id; end if; end if;
  raise;
end $function$
;

CREATE OR REPLACE FUNCTION public.pos_fin_reversar_pago(p_pago_id uuid, p_motivo text, p_operacion_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
 SET "TimeZone" TO 'America/Santo_Domingo'
AS $function$
declare
  v_org uuid:=mi_organizacion(); v_p public.pos_fin_pagos%rowtype; v_id uuid; v_exist uuid; v_met text; v_caja uuid; v_asiento uuid;
begin
  perform set_config('nx.fin_rpc','1',true); -- 38
  if mi_rol() not in ('admin','gerente') then raise exception 'FIN_REVERSA_SIN_PERMISO'; end if;
  if length(trim(coalesce(p_motivo,'')))<3 then raise exception 'FIN_REVERSA_MOTIVO_REQUERIDO'; end if;
  if p_operacion_id is not null then select id into v_exist from public.pos_fin_pagos where organizacion_id=v_org and operacion_id=p_operacion_id; if v_exist is not null then return v_exist; end if; end if;
  select * into v_p from public.pos_fin_pagos where id=p_pago_id and organizacion_id=v_org and tipo='pago';
  if v_p.id is null then raise exception 'FIN_PAGO_NO_ENCONTRADO'; end if;
  v_met:=lower(trim(coalesce(v_p.metodo,'')));
  if v_met='efectivo' then
    v_caja := public.pos_fin_caja_abierta(true);
    if v_caja is null then raise exception 'FIN_CAJA_CERRADA'; end if;
  end if;
  insert into public.pos_fin_pagos(organizacion_id,financiamiento_id,cuota_id,monto,metodo,fecha,referencia,created_by_name,tipo,reversa_de_id,motivo_reversa,operacion_id,caja_id,cuenta_bancaria_id)
  values(v_org,v_p.financiamiento_id,v_p.cuota_id,v_p.monto,v_p.metodo,current_date,v_p.referencia,null,'reversa',v_p.id,trim(p_motivo),p_operacion_id,v_caja,v_p.cuenta_bancaria_id)
  returning id into v_id;

  if v_met='efectivo' then
    insert into public.pos_caja_movimientos(caja_id,tipo,concepto,monto,created_by_name,organizacion_id)
    values(v_caja,'salida','Reversa pago de cuota',v_p.monto,null,v_org);
  elsif v_p.cuenta_bancaria_id is not null then
    insert into public.pos_banco_movimientos(organizacion_id,cuenta_bancaria_id,fecha,monto,concepto,referencia,origen_tipo,origen_id,origen_clave,creado_por)
    values(v_org,v_p.cuenta_bancaria_id,now(),-v_p.monto,'Reversa pago de cuota',v_p.referencia,'reversa_pago_cuota',v_id,'reversa_pago_cuota:'||v_id::text,auth.uid());
  end if;

  insert into public.pos_asientos(organizacion_id,fecha,concepto,referencia,tipo,origen_id,numero)
  values(v_org,current_date,'Reversa pago de cuota',substr(v_id::text,1,8),'reversa_pago_cuota',v_id,'RPC-'||substr(v_id::text,1,8)) returning id into v_asiento;
  if v_p.monto_principal>0 then insert into public.pos_asiento_lineas(organizacion_id,asiento_id,cuenta_id,cuenta_codigo,cuenta_nombre,descripcion,debito,credito)
    select v_org,v_asiento,id,codigo,nombre,'Restituye cuenta por cobrar',v_p.monto_principal,0 from public.pos_cuentas where organizacion_id=v_org and codigo='1103'; end if;
  if coalesce(v_p.monto_interes,0)>0 then insert into public.pos_asiento_lineas(organizacion_id,asiento_id,cuenta_id,cuenta_codigo,cuenta_nombre,descripcion,debito,credito)
    select v_org,v_asiento,id,codigo,nombre,'Revierte interés devengado',v_p.monto_interes,0 from public.pos_cuentas where organizacion_id=v_org and codigo='4102'; end if;
  if v_p.monto_mora>0 then insert into public.pos_asiento_lineas(organizacion_id,asiento_id,cuenta_id,cuenta_codigo,cuenta_nombre,descripcion,debito,credito)
    select v_org,v_asiento,id,codigo,nombre,'Revierte ingreso por mora',v_p.monto_mora,0 from public.pos_cuentas where organizacion_id=v_org and codigo='4103'; end if;
  insert into public.pos_asiento_lineas(organizacion_id,asiento_id,cuenta_id,cuenta_codigo,cuenta_nombre,descripcion,debito,credito)
    select v_org,v_asiento,id,codigo,nombre,case when v_met='efectivo' then 'Salida de efectivo' else 'Reversa medio electrónico' end,0,v_p.monto from public.pos_cuentas where organizacion_id=v_org and codigo=case when v_met='efectivo' then '1101' else '1102' end;
  return v_id;
exception when unique_violation then
  select id into v_id from public.pos_fin_pagos where organizacion_id=v_org and (reversa_de_id=p_pago_id or (p_operacion_id is not null and operacion_id=p_operacion_id)) order by created_at desc limit 1;
  if v_id is not null then return v_id; end if;
  raise;
end $function$
;

commit;

-- REVERSA (manual): quitar los triggers *_aa_guard / pos_fin_solicitud_ab_congelar y la política pos_banco_mov_cobro_cuota;
-- las 5 funciones siguen funcionando igual con la línea «38» (sin los candados, la marca no tiene efecto).
