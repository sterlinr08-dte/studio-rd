-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 35 · «Financiamiento fácil» — seguimiento en el servidor            *** NO APLICADA ***
-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- ESTADO: NO APLICADA en ninguna base. Pendiente de que el dueño autorice la publicación.
-- Escrita el 29-sep-2026 (bitácora docs/bitacora/2026-09-29-*-claude.md). NO correr sin autorización.
-- Antes de aplicar en STUDIO RD (edbknlkjnlfmkkiizdbe): comparar con pg_get_functiondef() que las funciones
-- que aquí se reemplazan (pos_fin_crear_financiamiento_v2, pos_fin_aprobar_solicitud, pos_fin_sol_ver,
-- pos_fin_mora_calculada) sigan iguales a 14 / 32 / 25 del repositorio; si alguien las cambió en vivo, fusionar.
--
-- Qué hace (todo compatible hacia atrás: columnas nuevas NULL = «como antes»):
--   1. Condiciones por solicitud (decisión del dueño 29-sep): frecuencia, número de pagos, interés por pago,
--      método y recargo por atraso en pos_fin_solicitudes. NULL = se usa el plan base (el de siempre).
--      Sin inicial mínima cuando la solicitud trae sus propias condiciones.
--   2. Recargo CONGELADO por financiamiento: mora_tipo/mora_valor/mora_dias_gracia en pos_financiamientos,
--      copiados al crear. pos_fin_mora_calculada los usa; cambiar un plan ya no cambia financiamientos viejos.
--      Relleno: hoy hay 0 financiamientos; el UPDATE de abajo cubre cualquiera que exista.
--   3. Planes: solo admin/gerente pueden crear, editar o borrar (RLS). Todos siguen pudiendo leerlos.
--   4. pos_fin_crear_financiamiento_v2 (camino rápido de Factura) solo para admin/gerente.
--      El frontend 59.69 ya no muestra ese camino; el de producción (59.68) sí: aplicar junto con 59.69.
--   5. Aprobar exige el expediente por link completo (cédula frente y dorso, foto con cédula, video, firma).
--   6. Interés y recargo de una solicitud solo los cambia admin/gerente (los empleados crean con los de la tienda).
--   7. El link del cliente (pos_fin_sol_ver) muestra las cuotas con las condiciones de su solicitud.
--   8. «Monto a mano» (29-sep, 2.ª entrega): pos_fin_solicitudes.monto_manual = true permite UN renglón sin
--      producto (concepto libre + monto). Al aprobar, la venta se crea con pos_fin_venta_concepto_libre:
--      un renglón con producto_id NULL, inventario_aplicado = true desde el inicio, sin IMEI ni reserva.
--      pos_registrar_venta_atomica (Factura) NO cambia: sigue exigiendo producto en cada renglón.
--      Nunca se toca inventario ni seriales con un monto a mano.
-- El frontend 59.69 funciona antes y después: detecta la columna pos_fin_solicitudes.num_cuotas y, si no
-- existe, sigue con la elección de plan; y lee mora_* del financiamiento solo si vienen en la fila.
--
-- Pendiente de decisión del dueño (NO incluido): dejar que el rol «vendedor» registre cobros. Hoy el trigger
-- pos_fin_validar_pago_insert solo acepta admin, gerente y cajero (14_financiamiento_v2.sql §8).
-- ════════════════════════════════════════════════════════════════════════════════════════════════

begin;

-- 1) Columnas nuevas ----------------------------------------------------------------------------------
alter table public.pos_fin_solicitudes
  add column if not exists frecuencia text,
  add column if not exists num_cuotas integer,
  add column if not exists tasa numeric,
  add column if not exists metodo text,
  add column if not exists mora_tipo text,
  add column if not exists mora_valor numeric,
  add column if not exists mora_dias_gracia integer,
  add column if not exists monto_manual boolean not null default false;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'pos_fin_solicitudes_terminos_chk') then
    alter table public.pos_fin_solicitudes add constraint pos_fin_solicitudes_terminos_chk check (
      (frecuencia is null or frecuencia in ('semanal','quincenal','mensual'))
      and (num_cuotas is null or num_cuotas between 1 and 120)
      and (tasa is null or tasa between 0 and 100)
      and (metodo is null or metodo in ('plano','saldo'))
      and (mora_tipo is null or mora_tipo in ('ninguna','fija','pct'))
      and (mora_valor is null or mora_valor >= 0)
      and (mora_dias_gracia is null or mora_dias_gracia >= 0));
  end if;
end $$;

alter table public.pos_financiamientos
  add column if not exists mora_tipo text,
  add column if not exists mora_valor numeric,
  add column if not exists mora_dias_gracia integer;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'pos_financiamientos_mora_chk') then
    alter table public.pos_financiamientos add constraint pos_financiamientos_mora_chk check (
      (mora_tipo is null or mora_tipo in ('ninguna','fija','pct')) and (mora_valor is null or mora_valor >= 0) and (mora_dias_gracia is null or mora_dias_gracia >= 0));
  end if;
end $$;

-- 2) Plan efectivo = plan base + condiciones de la solicitud (espejo: finPlanEfectivo en parches-pos.js) --------
-- Invoker: con RLS, un usuario solo ve planes y solicitudes de su organización. Las funciones SECURITY DEFINER
-- (pos_fin_sol_ver) lo llaman con sus propios privilegios.
create or replace function public.pos_fin_plan_efectivo(p_plan_id uuid, p_solicitud_id uuid default null)
 returns public.pos_fin_planes language plpgsql stable set search_path to 'public' as $function$
declare pl public.pos_fin_planes%rowtype; s record;
begin
  select * into pl from public.pos_fin_planes where id = p_plan_id;
  if pl.id is null or p_solicitud_id is null then return pl; end if;
  select frecuencia, num_cuotas, tasa, metodo, mora_tipo, mora_valor, mora_dias_gracia into s
    from public.pos_fin_solicitudes where id = p_solicitud_id and organizacion_id = pl.organizacion_id;
  if not found then return pl; end if;
  if s.num_cuotas is not null or s.frecuencia is not null or s.tasa is not null then
    pl.frecuencia := coalesce(s.frecuencia, pl.frecuencia);
    pl.num_cuotas := coalesce(s.num_cuotas, pl.num_cuotas);
    pl.tasa1 := coalesce(s.tasa, pl.tasa1);
    pl.cuotas_fase1 := 0; pl.tasa2 := 0;               -- por caso: una sola tasa
    pl.metodo := coalesce(s.metodo, pl.metodo);
    pl.inicial_min_pct := 0;                             -- por caso: sin inicial mínima (decisión del dueño)
  end if;
  pl.mora_tipo := coalesce(s.mora_tipo, pl.mora_tipo);
  pl.mora_valor := coalesce(s.mora_valor, pl.mora_valor);
  pl.mora_dias_gracia := coalesce(s.mora_dias_gracia, pl.mora_dias_gracia);
  return pl;
end $function$;
revoke all on function public.pos_fin_plan_efectivo(uuid, uuid) from public, anon;
grant execute on function public.pos_fin_plan_efectivo(uuid, uuid) to authenticated;

-- 3) Interés y recargo de una solicitud: solo admin/gerente (los empleados usan los de la tienda) --------------
create or replace function public.pos_fin_solicitud_terminos_guard()
 returns trigger language plpgsql set search_path to 'public' as $function$
begin
  if mi_rol() is null or mi_rol() in ('admin','gerente') then return new; end if;   -- servicio / admin / gerente
  if tg_op = 'INSERT' then
    if new.tasa is not null or new.metodo is not null or new.mora_tipo is not null or new.mora_valor is not null or new.mora_dias_gracia is not null then
      raise exception 'FIN_TERMINOS_SIN_PERMISO';
    end if;
  elsif new.tasa is distinct from old.tasa or new.metodo is distinct from old.metodo or new.mora_tipo is distinct from old.mora_tipo
     or new.mora_valor is distinct from old.mora_valor or new.mora_dias_gracia is distinct from old.mora_dias_gracia then
    raise exception 'FIN_TERMINOS_SIN_PERMISO';
  end if;
  return new;
end $function$;
drop trigger if exists pos_fin_solicitud_terminos_guard on public.pos_fin_solicitudes;
create trigger pos_fin_solicitud_terminos_guard before insert or update on public.pos_fin_solicitudes
  for each row execute function public.pos_fin_solicitud_terminos_guard();

-- 3b) Renglones de la solicitud: sin producto SOLO cuando es monto a mano (y entonces un solo renglón) --------
create or replace function public.pos_fin_solicitud_items_guard()
 returns trigger language plpgsql set search_path to 'public' as $function$
declare v_n int; v_sin int;
begin
  if jsonb_typeof(coalesce(new.items,'[]'::jsonb)) <> 'array' then return new; end if;
  select count(*), count(*) filter (where nullif(x->>'producto_id','') is null) into v_n, v_sin from jsonb_array_elements(new.items) x;
  if coalesce(new.monto_manual,false) then
    if v_n <> 1 or v_sin <> 1 then raise exception 'FIN_MANUAL_UN_RENGLON'; end if;
    if length(trim(coalesce(new.items->0->>'nombre',''))) < 3 or coalesce((new.items->0->>'precio')::numeric,0) <= 0 then raise exception 'FIN_MANUAL_CONCEPTO_INVALIDO'; end if;
  elsif v_sin > 0 then
    raise exception 'FIN_ITEM_SIN_PRODUCTO';
  end if;
  return new;
end $function$;
drop trigger if exists pos_fin_solicitud_items_guard on public.pos_fin_solicitudes;
create trigger pos_fin_solicitud_items_guard before insert or update of items, monto_manual on public.pos_fin_solicitudes
  for each row execute function public.pos_fin_solicitud_items_guard();

-- 3c) Venta a crédito por concepto libre (monto a mano). Misma forma de pos_registrar_venta_atomica pero SIN
--     inventario: inventario_aplicado = true desde el inicio, producto_id NULL, sin IMEI. Solo la usa la aprobación.
create or replace function public.pos_fin_venta_concepto_libre(p_operacion_id uuid, p_venta jsonb, p_items jsonb)
 returns uuid language plpgsql set search_path to 'public' as $function$
declare v_org uuid := mi_organizacion(); v_id uuid; v_usuario text; v_total numeric := coalesce((p_venta->>'total')::numeric,0);
begin
  if mi_rol() not in ('admin','gerente') then raise exception 'FIN_SIN_PERMISO'; end if;
  if p_operacion_id is null then raise exception 'VENTA_OPERACION_REQUERIDA'; end if;
  select id into v_id from public.pos_ventas where organizacion_id=v_org and operacion_id=p_operacion_id;
  if v_id is not null then return v_id; end if;   -- reintento: la misma venta
  if jsonb_array_length(p_items) <> 1 or nullif(p_items->0->>'producto_id','') is not null then raise exception 'FIN_MANUAL_UN_RENGLON'; end if;
  if v_total <= 0 or abs(coalesce((p_items->0->>'importe')::numeric,0) - v_total) > 0.01 then raise exception 'VENTA_TOTAL_NO_CUADRA'; end if;
  if coalesce((p_venta->>'pagado_efectivo')::numeric,0) > 0 and not exists (select 1 from public.pos_cajas c where c.id=nullif(p_venta->>'caja_id','')::uuid and c.organizacion_id=v_org and c.estado='abierta') then
    raise exception 'VENTA_CAJA_CERRADA';
  end if;
  select us.nom into v_usuario from public.profiles pr join public.usuarios_sistema us on us.id=pr.usuario_sistema_id where pr.id=auth.uid() limit 1;
  insert into public.pos_ventas (cliente_id, cliente_nombre, a_credito, subtotal, itbis, total, descuento, metodo_pago, pagos, pagado_efectivo, pagado_tarjeta, pagado_transferencia,
    pagado_otro, credito_monto, recibido, devuelta, tipo_comprobante, numero_factura, almacen_id, estado, caja_id, created_by_name, fecha, organizacion_id, inventario_aplicado, operacion_id)
  values (nullif(p_venta->>'cliente_id','')::uuid, nullif(left(p_venta->>'cliente_nombre',200),''), true, coalesce((p_venta->>'subtotal')::numeric,0), 0, v_total, 0,
    'Crédito', coalesce(p_venta->'pagos','[]'::jsonb), coalesce((p_venta->>'pagado_efectivo')::numeric,0), coalesce((p_venta->>'pagado_tarjeta')::numeric,0), coalesce((p_venta->>'pagado_transferencia')::numeric,0),
    0, coalesce((p_venta->>'credito_monto')::numeric,0), coalesce((p_venta->>'recibido')::numeric,0), 0, 'sin', nullif(left(p_venta->>'numero_factura',80),''), nullif(p_venta->>'almacen_id','')::uuid, 'completada',
    nullif(p_venta->>'caja_id','')::uuid, coalesce(v_usuario, nullif(left(p_venta->>'created_by_name',120),''), 'Sistema'), now(), v_org, true, p_operacion_id)
  returning id into v_id;
  insert into public.pos_venta_items (venta_id, producto_id, nombre, precio, cantidad, itbis, descuento, importe, serial, organizacion_id, linea_orden)
  values (v_id, null, left(p_items->0->>'nombre',300), (p_items->0->>'precio')::numeric, coalesce((p_items->0->>'cantidad')::numeric,1), false, 0, (p_items->0->>'importe')::numeric, null, v_org, 1);
  return v_id;
end $function$;
revoke all on function public.pos_fin_venta_concepto_libre(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.pos_fin_venta_concepto_libre(uuid, jsonb, jsonb) to authenticated;

-- 4) Recargo congelado al crear (respaldo para cualquier insert que no lo traiga) + relleno ------------------
create or replace function public.pos_fin_zy_mora_al_crear()
 returns trigger language plpgsql set search_path to 'public' as $function$
declare pl public.pos_fin_planes%rowtype;
begin
  if new.mora_tipo is null and new.plan_id is not null then
    pl := public.pos_fin_plan_efectivo(new.plan_id, new.solicitud_id);
    new.mora_tipo := pl.mora_tipo; new.mora_valor := pl.mora_valor; new.mora_dias_gracia := pl.mora_dias_gracia;
  end if;
  return new;
end $function$;
drop trigger if exists pos_fin_zy_mora_al_crear on public.pos_financiamientos;
create trigger pos_fin_zy_mora_al_crear before insert on public.pos_financiamientos
  for each row execute function public.pos_fin_zy_mora_al_crear();

update public.pos_financiamientos f
   set mora_tipo = p.mora_tipo, mora_valor = p.mora_valor, mora_dias_gracia = p.mora_dias_gracia
  from public.pos_fin_planes p
 where p.id = f.plan_id and f.mora_tipo is null;       -- hoy: 0 filas (0 financiamientos)

-- 5) Mora calculada con el recargo congelado del financiamiento (antes: el del plan en vivo) --------------------
create or replace function public.pos_fin_mora_calculada(p_cuota_id uuid, p_fecha date)
 returns numeric language plpgsql stable set search_path to 'public' as $function$
declare v_org uuid:=mi_organizacion(); c record; pl record; v_pct numeric:=0; v_gracia int:=0; v_pagado numeric:=0; v_calc numeric:=0;
begin
  select c1.monto, c1.fecha_venc, f.plan_id, f.mora_tipo as f_tipo, f.mora_valor as f_valor, f.mora_dias_gracia as f_gracia
    into c from public.pos_fin_cuotas c1 join public.pos_financiamientos f on f.id=c1.financiamiento_id
  where c1.id=p_cuota_id and c1.organizacion_id=v_org;
  if c.monto is null or p_fecha is null then return 0; end if;
  select coalesce(sum(case when tipo='pago' then monto_principal+coalesce(monto_interes,0) when tipo='reversa' then -(monto_principal+coalesce(monto_interes,0)) else 0 end),0)
    into v_pagado from public.pos_fin_pagos where cuota_id=p_cuota_id and organizacion_id=v_org;
  if v_pagado >= c.monto-0.01 then return 0; end if;
  if c.f_tipo is not null or c.plan_id is not null then
    if c.f_tipo is not null then
      select c.f_tipo as mora_tipo, c.f_valor as mora_valor, c.f_gracia as mora_dias_gracia into pl;
    else
      select mora_tipo, mora_valor, mora_dias_gracia into pl from public.pos_fin_planes where id=c.plan_id;
    end if;
    v_gracia := greatest(coalesce(pl.mora_dias_gracia,0),0);
    if p_fecha <= c.fecha_venc + v_gracia then return 0; end if;
    v_calc := case pl.mora_tipo when 'fija' then coalesce(pl.mora_valor,0) when 'pct' then round(c.monto*coalesce(pl.mora_valor,0)/100,2) else 0 end;
  else
    select coalesce(mora_pct,0), coalesce(mora_dias_gracia,0) into v_pct, v_gracia from public.pos_config where organizacion_id=v_org limit 1;
    v_gracia := greatest(coalesce(v_gracia,0),0);
    if coalesce(v_pct,0)>0 and p_fecha > c.fecha_venc + v_gracia then v_calc := round(c.monto*v_pct/100,2); end if;
  end if;
  return greatest(coalesce(v_calc,0),0);
end $function$;

-- 6) Planes: leer todos; crear / editar / borrar solo admin y gerente -----------------------------------------
drop policy if exists pos_fin_planes_tenant on public.pos_fin_planes;
drop policy if exists pos_fin_planes_leer on public.pos_fin_planes;
drop policy if exists pos_fin_planes_crear on public.pos_fin_planes;
drop policy if exists pos_fin_planes_editar on public.pos_fin_planes;
drop policy if exists pos_fin_planes_borrar on public.pos_fin_planes;
create policy pos_fin_planes_leer on public.pos_fin_planes for select to authenticated
  using (organizacion_id = mi_organizacion() and mi_rol() is not null);
create policy pos_fin_planes_crear on public.pos_fin_planes for insert to authenticated
  with check (organizacion_id = mi_organizacion() and mi_rol() in ('admin','gerente'));
create policy pos_fin_planes_editar on public.pos_fin_planes for update to authenticated
  using (organizacion_id = mi_organizacion() and mi_rol() in ('admin','gerente'))
  with check (organizacion_id = mi_organizacion() and mi_rol() in ('admin','gerente'));
create policy pos_fin_planes_borrar on public.pos_fin_planes for delete to authenticated
  using (organizacion_id = mi_organizacion() and mi_rol() in ('admin','gerente'));

-- 7) Crear financiamiento: condiciones por caso + recargo congelado + solo admin/gerente (antes 14 §13) --------
create or replace function public.pos_fin_crear_financiamiento_v2(p_venta_id uuid, p_plan_id uuid, p_primera_fecha date, p_solicitud_id uuid default null, p_descripcion text default null)
 returns uuid language plpgsql set search_path to 'public' as $function$
declare
  v_org uuid:=mi_organizacion(); v public.pos_ventas%rowtype; pl public.pos_fin_planes%rowtype; cli public.pos_clientes%rowtype; cfg public.pos_config%rowtype;
  v_id uuid; v_codigo text; v_int_total numeric:=0; v_cuota1 numeric:=0; v_n int:=0; r record; v_vars jsonb; v_articulo text; v_empresa text; v_mora_txt text;
begin
  -- 35 (F3): solo admin/gerente. La aprobación (admin/gerente) la sigue llamando; el camino rápido de Factura queda cerrado.
  if mi_rol() not in ('admin','gerente') then raise exception 'FIN_SIN_PERMISO'; end if;
  if p_primera_fecha is null then raise exception 'FIN_PRIMER_VENCIMIENTO_REQUERIDO'; end if;
  select * into v from public.pos_ventas where id=p_venta_id and organizacion_id=v_org and estado='completada' for update;
  if v.id is null or coalesce(v.credito_monto,0)<=0 or v.cliente_id is null then raise exception 'FIN_VENTA_CREDITO_INVALIDA'; end if;
  if exists(select 1 from public.pos_financiamientos where organizacion_id=v_org and venta_id=v.id) then raise exception 'FIN_VENTA_YA_FINANCIADA'; end if;
  select * into pl from public.pos_fin_planes where id=p_plan_id and organizacion_id=v_org and activo;
  if pl.id is null then raise exception 'FIN_PLAN_INVALIDO'; end if;
  -- 35: condiciones de la solicitud (pagos, frecuencia, interés, recargo) encima del plan base.
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

  -- Contrato congelado (si hay plantilla) + token de firma
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
end $function$;



-- 8) Aprobar: condiciones por caso + expediente completo obligatorio (antes 32) --------------------------------
create or replace function public.pos_fin_aprobar_solicitud(p_solicitud_id uuid, p_nota text DEFAULT NULL::text, p_operacion_id uuid DEFAULT NULL::uuid, p_caja_id uuid DEFAULT NULL::uuid, p_almacen_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_org uuid:=mi_organizacion(); s public.pos_fin_solicitudes%rowtype; pl public.pos_fin_planes%rowtype; cli public.pos_clientes%rowtype;
  v_capital numeric; v_suma numeric; v_items jsonb; v_venta jsonb; v_res jsonb; v_venta_id uuid; v_fin uuid; v_caja uuid; v_alm uuid; v_num text; v_usuario text;
  v_pagos jsonb:='[]'::jsonb; v_met text;
  v_token uuid; v_imei_pedidos int:=0; v_imei_res int:=0; v_alm_imei uuid;
begin
  if mi_rol() not in ('admin','gerente') then raise exception 'FIN_APROBAR_SIN_PERMISO'; end if;
  select * into s from public.pos_fin_solicitudes where id=p_solicitud_id and organizacion_id=v_org for update;
  if s.id is null then raise exception 'FIN_SOLICITUD_NO_ENCONTRADA'; end if;
  if s.estado='aprobada' and s.financiamiento_id is not null then
    return jsonb_build_object('ok',true,'reutilizada',true,'venta_id',s.venta_id,'financiamiento_id',s.financiamiento_id);
  end if;
  if s.estado<>'pendiente' then raise exception 'FIN_SOLICITUD_NO_PENDIENTE'; end if;
  select * into pl from public.pos_fin_planes where id=s.plan_id and organizacion_id=v_org and activo;
  if pl.id is null then raise exception 'FIN_PLAN_INVALIDO'; end if;
  -- 35: condiciones por caso (sin inicial mínima cuando la solicitud trae sus propias condiciones).
  pl := public.pos_fin_plan_efectivo(s.plan_id, s.id);
  -- 35 (decisión del dueño 29-sep-2026): expediente por link COMPLETO antes de aprobar. Sin «aprobar de todos modos».
  if coalesce(s.exp_estado,'') <> 'enviado' or s.exp_cedula_frente is null or s.exp_cedula_dorso is null
     or s.exp_selfie is null or s.exp_video is null or s.exp_firma is null then
    raise exception 'FIN_EXPEDIENTE_INCOMPLETO';
  end if;
  select * into cli from public.pos_clientes where id=s.cliente_id and organizacion_id=v_org and activo;
  if cli.id is null then raise exception 'FIN_CLIENTE_INVALIDO'; end if;
  if s.inicial < round(s.precio_total*pl.inicial_min_pct/100,2)-0.01 then raise exception 'FIN_INICIAL_MENOR_AL_MINIMO'; end if;
  v_capital := s.precio_total - s.inicial;
  if v_capital<=0 then raise exception 'FIN_CAPITAL_INVALIDO'; end if;
  if jsonb_typeof(s.items)<>'array' or jsonb_array_length(s.items)<1 then raise exception 'FIN_SOLICITUD_SIN_ARTICULOS'; end if;
  if s.primera_fecha < current_date then raise exception 'FIN_PRIMER_VENCIMIENTO_INVALIDO'; end if;

  select jsonb_agg(jsonb_build_object('producto_id',x.producto_id,'nombre',x.nombre,'precio',x.precio,'cantidad',x.cantidad,'importe',round(x.precio*x.cantidad,2),'serial',x.serial,'itbis',false,'descuento',0)),
         coalesce(sum(round(x.precio*x.cantidad,2)),0)
    into v_items, v_suma
  from jsonb_to_recordset(s.items) as x(producto_id uuid, nombre text, precio numeric, cantidad numeric, serial text);
  if abs(v_suma - s.precio_total)>0.01 then raise exception 'FIN_SOLICITUD_TOTAL_NO_CUADRA'; end if;

  -- IMEI: en cada artículo con serial, la cantidad debe ser igual al número de IMEI escritos/elegidos.
  if exists (
    select 1 from jsonb_to_recordset(s.items) as x(producto_id uuid, cantidad numeric, serial text)
    join public.pos_productos p on p.id=x.producto_id and p.organizacion_id=v_org and p.serial
    where x.cantidad <> (select count(*) from unnest(string_to_array(coalesce(x.serial,''), ',')) t where trim(t)<>'')
  ) then raise exception 'FIN_IMEI_FALTANTE'; end if;
  select count(*) into v_imei_pedidos
  from jsonb_to_recordset(s.items) as x(producto_id uuid, serial text)
  join public.pos_productos p on p.id=x.producto_id and p.organizacion_id=v_org and p.serial
  cross join lateral unnest(string_to_array(coalesce(x.serial,''), ',')) t where trim(t)<>'';

  v_met := s.inicial_metodo;
  if s.inicial>0 and v_met='efectivo' then
    v_caja := coalesce(p_caja_id, public.pos_fin_caja_abierta(false));
    if v_caja is null then raise exception 'FIN_CAJA_CERRADA'; end if;
  end if;
  v_alm := p_almacen_id;
  if v_alm is null and v_imei_pedidos>0 then
    -- Sin almacén elegido: el de los IMEI, si todos están en uno solo.
    select min(s2.almacen_id::text)::uuid into v_alm_imei
    from jsonb_to_recordset(s.items) as x(producto_id uuid, serial text)
    join public.pos_productos p on p.id=x.producto_id and p.organizacion_id=v_org and p.serial
    cross join lateral unnest(string_to_array(coalesce(x.serial,''), ',')) t
    join public.pos_seriales s2 on s2.organizacion_id=v_org and s2.producto_id=x.producto_id and s2.serial=trim(t)
    where trim(t)<>''
    having count(distinct s2.almacen_id)=1;
    v_alm := v_alm_imei;
  end if;
  if v_alm is null then select id into v_alm from public.pos_almacenes where organizacion_id=v_org and activo order by es_principal desc, nombre limit 1; end if;

  if v_imei_pedidos>0 then
    v_token := gen_random_uuid();
    update public.pos_seriales s2 set estado='reservado', reserva_token=v_token, reserva_hasta=now()+interval '10 minutes'
    where s2.organizacion_id=v_org and s2.estado='disponible' and s2.venta_id is null
      and (s2.producto_id, s2.serial) in (
        select x.producto_id, trim(t)
        from jsonb_to_recordset(s.items) as x(producto_id uuid, serial text)
        join public.pos_productos p on p.id=x.producto_id and p.organizacion_id=v_org and p.serial
        cross join lateral unnest(string_to_array(coalesce(x.serial,''), ',')) t where trim(t)<>'');
    get diagnostics v_imei_res = row_count;
    if v_imei_res <> v_imei_pedidos then raise exception 'FIN_IMEI_NO_DISPONIBLE'; end if;
  end if;

  v_num := public.pos_fin_siguiente_codigo('factura_credito');
  select us.nom into v_usuario from public.profiles pr join public.usuarios_sistema us on us.id=pr.usuario_sistema_id where pr.id=auth.uid() limit 1;

  if s.inicial>0 then v_pagos := v_pagos || jsonb_build_array(jsonb_build_object('metodo', initcap(v_met), 'monto', s.inicial)); end if;
  v_pagos := v_pagos || jsonb_build_array(jsonb_build_object('metodo','Crédito','monto',v_capital));

  v_venta := jsonb_build_object(
    'cliente_id', s.cliente_id, 'cliente_nombre', coalesce(s.cliente_nombre,cli.nombre), 'a_credito', true,
    'subtotal', s.precio_total, 'itbis', 0, 'total', s.precio_total, 'descuento', 0,
    'metodo_pago', 'Crédito', 'pagos', v_pagos,
    'pagado_efectivo', case when v_met='efectivo' then s.inicial else 0 end,
    'pagado_tarjeta', case when v_met='tarjeta' then s.inicial else 0 end,
    'pagado_transferencia', case when v_met='transferencia' then s.inicial else 0 end,
    'pagado_otro', 0, 'credito_monto', v_capital, 'recibido', case when v_met='efectivo' then s.inicial else 0 end, 'devuelta', 0,
    'tipo_comprobante', 'sin', 'numero_factura', v_num, 'almacen_id', v_alm, 'caja_id', v_caja,
    'created_by_name', coalesce(v_usuario,'Sistema'));

  if coalesce(s.monto_manual,false) then
    -- 35 §8: monto a mano → venta por concepto libre, sin inventario ni IMEI (v_imei_pedidos es 0: no hay productos).
    v_venta_id := public.pos_fin_venta_concepto_libre(coalesce(p_operacion_id, gen_random_uuid()), v_venta, v_items);
  else
    v_res := public.pos_registrar_venta_atomica(coalesce(p_operacion_id, gen_random_uuid()), v_venta, v_items, v_token, v_imei_pedidos);
    v_venta_id := (v_res->'venta'->>'id')::uuid;
  end if;
  if v_venta_id is null then raise exception 'FIN_VENTA_NO_CREADA'; end if;

  v_fin := public.pos_fin_crear_financiamiento_v2(v_venta_id, pl.id, s.primera_fecha, s.id, null);

  -- Asiento de la venta a crédito en el servidor (el navegador no participa en este flujo).
  perform public.pos_reconstruir_asiento_venta(v_venta_id);

  perform set_config('nx.fin_aprobando','1',true);
  update public.pos_fin_solicitudes set estado='aprobada', nota_aprobador=nullif(trim(p_nota),''), decidido_por=auth.uid(), decidido_en=now(), venta_id=v_venta_id, financiamiento_id=v_fin
  where id=s.id;
  perform set_config('nx.fin_aprobando','0',true);

  insert into public.pos_credito_eventos(organizacion_id,cliente_id,venta_id,financiamiento_id,tipo,monto,nota,creado_por)
  values(v_org,s.cliente_id,v_venta_id,v_fin,'aprobacion',v_capital,'Solicitud '||coalesce(s.codigo,'')||' aprobada · plan '||pl.nombre||' · '||pl.num_cuotas||' pagos '||pl.frecuencia||' · '||trim(to_char(pl.tasa1,'FM990.##'))||' %',auth.uid());

  return jsonb_build_object('ok',true,'reutilizada',false,'venta_id',v_venta_id,'financiamiento_id',v_fin,'numero_factura',v_num,
    'codigo',(select codigo from public.pos_financiamientos where id=v_fin));
end $function$;


-- 9) Link del cliente: cuotas con las condiciones de su solicitud (antes 25 §4) ---------------------------------
create or replace function public.pos_fin_sol_ver(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare s public.pos_fin_solicitudes%rowtype; pl public.pos_fin_planes%rowtype; v_emp text; v_tel text; v_cuotas jsonb;
begin
  if p_token is null then return jsonb_build_object('ok', false, 'error', 'LINK_INVALIDO'); end if;
  select * into s from public.pos_fin_solicitudes where exp_token = p_token;
  if s.id is null then return jsonb_build_object('ok', false, 'error', 'LINK_INVALIDO'); end if;
  select * into pl from public.pos_fin_planes where id = s.plan_id;
  pl := public.pos_fin_plan_efectivo(s.plan_id, s.id);   -- 35: el cliente ve las condiciones de SU solicitud
  select nombre into v_emp from public.organizaciones where id = s.organizacion_id;
  select telefono into v_tel from public.pos_clientes where id = s.cliente_id;
  begin
    select coalesce(jsonb_agg(jsonb_build_object('numero', a.numero, 'fecha', a.fecha_venc, 'monto', a.cuota) order by a.numero), '[]'::jsonb)
      into v_cuotas from public.pos_fin_amortizacion(s.precio_total - s.inicial, pl.metodo, pl.num_cuotas, pl.cuotas_fase1, pl.tasa1, pl.tasa2, pl.frecuencia, s.primera_fecha) a;
  exception when others then v_cuotas := '[]'::jsonb; end;
  return jsonb_build_object(
    'ok', true, 'empresa', coalesce(v_emp, 'STUDIO'), 'codigo', s.codigo, 'cliente', s.cliente_nombre,
    'articulos', (select coalesce(jsonb_agg(jsonb_build_object('nombre', x->>'nombre', 'cantidad', x->'cantidad')), '[]'::jsonb) from jsonb_array_elements(coalesce(s.items, '[]'::jsonb)) x),
    'precio', s.precio_total, 'inicial', s.inicial, 'capital', s.precio_total - s.inicial,
    'plan', pl.nombre, 'frecuencia', pl.frecuencia, 'cuotas', v_cuotas,
    'declaracion', s.declaracion, 'guion', s.video_guion,
    'estado', s.estado, 'exp_estado', s.exp_estado, 'correccion', s.correccion_motivo,
    'vencido', s.exp_token_vence is not null and s.exp_token_vence < now(),
    'enviado_en', s.exp_enviado_en,
    'pide_telefono', v_tel is not null and length(regexp_replace(v_tel, '\D', '', 'g')) >= 4);
end;
$function$;

commit;

-- Verificación sugerida después de aplicar (solo lectura):
--   select column_name from information_schema.columns where table_name='pos_fin_solicitudes' and column_name in ('num_cuotas','frecuencia','tasa','mora_tipo');
--   select polname, polcmd from pg_policy where polrelid='public.pos_fin_planes'::regclass;
--   select count(*) from public.pos_financiamientos where plan_id is not null and mora_tipo is null;   -- debe ser 0
--   select column_name from information_schema.columns where table_name='pos_fin_solicitudes' and column_name='monto_manual';
-- Reversa (si hiciera falta): volver a correr 14 §7 y §13, 32 y 25 §4 del repositorio y el bloque RLS de 14 para
-- pos_fin_planes; las columnas nuevas pueden quedarse (NULL = comportamiento anterior).
