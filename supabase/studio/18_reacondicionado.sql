-- STUDIO · 18 · Reacondicionado (taller de lotes) — 2026-09-22
-- Réplica del módulo "Reacondicionados" del taller BAYOL CELL (taller.html #v-refurb) adaptada a
-- STUDIO: mismas etapas, mismos estados internos y mismas tablas, pero con prefijo pos_reacond_,
-- organizacion_id + RLS por organización y enlazadas al inventario real del POS
-- (pos_productos / pos_seriales / pos_compras) en vez de Info Plus.
--
-- Equivalencias con BAYOL:
--   refurb_lotes            -> pos_reacond_lotes
--   equipos_refurbish       -> pos_reacond_equipos   (estado_evaluacion: pendiente, en_evaluacion, evaluado,
--                              en_proceso, tecnico_recibio, espera_pieza, reasignado, reparacion_externa,
--                              listo_revision, listo_venta, vendido[=despachado] + completado bool)
--   equipo_piezas_pedidas   -> pos_reacond_piezas    (pieza_id/pieza_codigo Info Plus -> producto_id del POS;
--                              infoplus_desc_cant/almacen -> descontada_cant/descontada_almacen_id)
--   tareas_trabajo          -> pos_reacond_tareas
--   equipo_historial        -> pos_reacond_historial
--   falla_categorias/fallas -> pos_reacond_falla_categorias / pos_reacond_fallas
--   equipo_fallas           -> pos_reacond_equipo_fallas
--   equipo_devoluciones     -> pos_reacond_devoluciones
--   tecnicos                -> usuarios_sistema (no se crea tabla aparte: técnico = usuario del sistema)
--
-- Inventario: NUNCA se toca pos_productos.stock directo. Todo pasa por pos_mover_stock_atomico
-- (kardex tipo 'taller'). El despacho y el descuento de piezas son RPC atómicas (abajo).
-- Bandera: pos_config.reacondicionado (true solo para STUDIO). Sin bandera el frontend no muestra el módulo.

begin;

-- ───────────────────────── bandera ─────────────────────────
alter table public.pos_config add column if not exists reacondicionado boolean not null default false;
comment on column public.pos_config.reacondicionado is 'Muestra el módulo Reacondicionado (parches-pos-reacond.js). Réplica del taller de lotes de BAYOL CELL.';

-- ───────────────────────── tablas ─────────────────────────
create table if not exists public.pos_reacond_lotes (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid references public.organizaciones(id),
  codigo_lote text not null,
  proveedor_id uuid references public.pos_proveedores(id),
  compra_id uuid references public.pos_compras(id) on delete set null,
  fecha_compra date default current_date,
  costo_total_lote numeric not null default 0,
  cantidad_equipos integer not null default 0,
  gastos_envio numeric not null default 0,
  notas text,
  estado text not null default 'Abierto',
  enviado_reacond boolean not null default true,
  fecha_envio_reacond timestamptz default now(),
  creado_por uuid,
  creado_en timestamptz not null default now()
);
create unique index if not exists ux_pos_reacond_lotes_codigo on public.pos_reacond_lotes(organizacion_id, codigo_lote);

create table if not exists public.pos_reacond_equipos (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid references public.organizaciones(id),
  lote_id uuid references public.pos_reacond_lotes(id) on delete cascade,
  producto_id uuid references public.pos_productos(id) on delete set null,
  serial_id uuid references public.pos_seriales(id) on delete set null,
  articulo_codigo text,
  modelo text,
  marca text,
  color text,
  capacidad text,
  imei text,
  serial text,
  costo_compra numeric not null default 0,
  costo_repuestos numeric not null default 0,
  precio_venta_estimado numeric not null default 0,
  precio_venta_real numeric,
  estado_evaluacion text not null default 'pendiente',
  tecnico_asignado_id uuid references public.usuarios_sistema(id) on delete set null,
  tecnico_anterior_id uuid references public.usuarios_sistema(id) on delete set null,
  fecha_asignacion timestamptz,
  fecha_reasignacion timestamptz,
  motivo_reasignacion text,
  fecha_terminado timestamptz,
  fecha_despacho timestamptz,
  completado boolean not null default false,
  fecha_completado timestamptz,
  veces_devuelto integer not null default 0,
  ultima_devolucion timestamptz,
  ciclo_actual integer not null default 1,
  taller_externo text,
  notas_diagnostico text,
  es_garantia boolean not null default false,
  score integer default 0,
  clasificacion text,
  proveedor_id uuid references public.pos_proveedores(id),
  fecha_compra date default current_date,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  constraint pos_reacond_equipos_estado_check check (estado_evaluacion in ('pendiente','en_evaluacion','evaluado','en_proceso','tecnico_recibio','espera_pieza','reasignado','reparacion_externa','listo_revision','listo_venta','vendido'))
);
create index if not exists idx_pos_reacond_equipos_lote on public.pos_reacond_equipos(lote_id);
create index if not exists idx_pos_reacond_equipos_estado on public.pos_reacond_equipos(organizacion_id, estado_evaluacion);
create index if not exists idx_pos_reacond_equipos_tecnico on public.pos_reacond_equipos(tecnico_asignado_id);
create index if not exists idx_pos_reacond_equipos_imei on public.pos_reacond_equipos(organizacion_id, imei);

create table if not exists public.pos_reacond_piezas (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid references public.organizaciones(id),
  equipo_id uuid references public.pos_reacond_equipos(id) on delete cascade,
  producto_id uuid references public.pos_productos(id) on delete set null,
  pieza_codigo text,
  pieza_nombre text,
  cantidad integer not null default 1,
  costo_unitario numeric not null default 0,
  estado text not null default 'pendiente',
  notas text,
  agregada_por_tecnico boolean not null default false,
  fecha_entrega timestamptz,
  aprobada_por_admin boolean not null default false,
  devolucion_solicitada boolean not null default false,
  motivo_devolucion_pieza text,
  fecha_solicitud_devolucion timestamptz,
  tecnico_id uuid references public.usuarios_sistema(id) on delete set null,
  descontada_cant integer not null default 0,
  descontada_almacen_id uuid references public.pos_almacenes(id) on delete set null,
  creado_en timestamptz not null default now(),
  constraint pos_reacond_piezas_estado_check check (estado in ('pendiente','solicitada','aprobada','entregada','recibida','devolucion_pendiente','devuelta','extra','extra_pendiente','rechazada'))
);
create index if not exists idx_pos_reacond_piezas_equipo on public.pos_reacond_piezas(equipo_id);

create table if not exists public.pos_reacond_tareas (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid references public.organizaciones(id),
  tipo text not null default 'equipo',
  ref_id uuid not null,
  descripcion text not null,
  tecnico_id uuid references public.usuarios_sistema(id) on delete set null,
  tecnico_anterior_id uuid references public.usuarios_sistema(id) on delete set null,
  estado text not null default 'pendiente',
  notas text,
  adicional boolean not null default false,
  creado_por uuid,
  creado_en timestamptz not null default now(),
  fecha_completada timestamptz,
  constraint pos_reacond_tareas_estado_check check (estado in ('pendiente','hecha'))
);
create index if not exists idx_pos_reacond_tareas_ref on public.pos_reacond_tareas(ref_id);

create table if not exists public.pos_reacond_historial (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid references public.organizaciones(id),
  equipo_id uuid references public.pos_reacond_equipos(id) on delete cascade,
  estado_anterior text,
  estado_nuevo text,
  accion text,
  notas text,
  usuario text,
  fecha timestamptz not null default now()
);
create index if not exists idx_pos_reacond_historial_equipo on public.pos_reacond_historial(equipo_id, fecha);

create table if not exists public.pos_reacond_falla_categorias (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid references public.organizaciones(id),
  nombre text not null,
  icono text not null default 'ti-circle',
  color text not null default '#c9a227',
  orden integer not null default 0,
  activa boolean not null default true,
  creado_en timestamptz not null default now()
);

create table if not exists public.pos_reacond_fallas (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid references public.organizaciones(id),
  categoria_id uuid references public.pos_reacond_falla_categorias(id) on delete set null,
  nombre text not null,
  nombre_corto text,
  descripcion text,
  activa boolean not null default true,
  creado_en timestamptz not null default now()
);

create table if not exists public.pos_reacond_equipo_fallas (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid references public.organizaciones(id),
  equipo_id uuid references public.pos_reacond_equipos(id) on delete cascade,
  falla_id uuid references public.pos_reacond_fallas(id) on delete set null,
  falla_nombre text,
  falla_corto text,
  falla_categoria text,
  adicional boolean not null default false,
  nota text,
  creado_en timestamptz not null default now()
);
create index if not exists idx_pos_reacond_equipo_fallas_equipo on public.pos_reacond_equipo_fallas(equipo_id);

create table if not exists public.pos_reacond_devoluciones (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid references public.organizaciones(id),
  equipo_id uuid references public.pos_reacond_equipos(id) on delete cascade,
  fecha_devolucion timestamptz not null default now(),
  motivo_devolucion text not null,
  problemas_reportados text,
  ciclo integer not null default 1,
  cliente_que_devolvio text,
  diagnostico_inicial text,
  registrado_por text,
  creado_en timestamptz not null default now()
);

-- ───────────────────────── triggers ─────────────────────────
do $$
declare t text;
begin
  foreach t in array array['pos_reacond_lotes','pos_reacond_equipos','pos_reacond_piezas','pos_reacond_tareas','pos_reacond_historial','pos_reacond_falla_categorias','pos_reacond_fallas','pos_reacond_equipo_fallas','pos_reacond_devoluciones'] loop
    execute format('drop trigger if exists trg_org_%1$s on public.%1$s', t);
    execute format('create trigger trg_org_%1$s before insert on public.%1$s for each row execute function public.set_organizacion_id()', t);
  end loop;
end $$;

create or replace function public.pos_reacond_touch()
returns trigger language plpgsql as $$
begin new.actualizado_en := now(); return new; end $$;
drop trigger if exists trg_touch_pos_reacond_equipos on public.pos_reacond_equipos;
create trigger trg_touch_pos_reacond_equipos before update on public.pos_reacond_equipos for each row execute function public.pos_reacond_touch();

-- ───────────────────────── RLS (mismo patrón que el resto de pos_*) ─────────────────────────
do $$
declare t text;
begin
  foreach t in array array['pos_reacond_lotes','pos_reacond_equipos','pos_reacond_piezas','pos_reacond_tareas','pos_reacond_historial','pos_reacond_falla_categorias','pos_reacond_fallas','pos_reacond_equipo_fallas','pos_reacond_devoluciones'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %1$s_org on public.%1$s', t);
    execute format($p$create policy %1$s_org on public.%1$s as permissive for all to public
      using ((public.mi_rol() is not null) and (organizacion_id = public.mi_organizacion()))
      with check ((public.mi_rol() is not null) and ((organizacion_id is null) or (organizacion_id = public.mi_organizacion())))$p$, t);
  end loop;
end $$;

-- ───────────────────────── RPC: descontar piezas del inventario ─────────────────────────
-- BAYOL descontaba las piezas de Info Plus al despachar (o a mano con "Descontar"). Aquí las piezas
-- ligadas a un producto del POS se descuentan por pos_mover_stock_atomico (kardex 'taller').
-- p_pieza_id: solo esa pieza (técnico confirma "recibida"); null: todas las pendientes del equipo.
create or replace function public.pos_reacond_descontar_piezas(p_equipo_id uuid, p_pieza_id uuid default null, p_usuario text default null)
returns jsonb language plpgsql set search_path to 'public' as $$
declare
  v_org uuid := public.mi_organizacion();
  v_eq public.pos_reacond_equipos%rowtype;
  v_pz record;
  v_alm uuid;
  v_alm_pref uuid;
  v_n integer := 0;
  v_omitidas text[] := '{}';
begin
  if v_org is null or public.mi_rol() is null then raise exception 'REACOND_SIN_PERMISO'; end if;
  select * into v_eq from public.pos_reacond_equipos where id = p_equipo_id and organizacion_id = v_org;
  if v_eq.id is null then raise exception 'REACOND_EQUIPO_INVALIDO'; end if;
  select id into v_alm_pref from public.pos_almacenes where organizacion_id = v_org and activo order by es_principal desc, created_at limit 1;
  for v_pz in
    select p.*, pr.nombre as prod_nombre, pr.stock as prod_stock, coalesce(pr.serial,false) as prod_serial
    from public.pos_reacond_piezas p join public.pos_productos pr on pr.id = p.producto_id
    where p.equipo_id = p_equipo_id and p.organizacion_id = v_org
      and (p_pieza_id is null or p.id = p_pieza_id)
      and p.producto_id is not null and coalesce(p.descontada_cant,0) = 0
      and p.estado not in ('rechazada','devuelta','devolucion_pendiente','extra_pendiente')
    order by p.creado_en
  loop
    if v_pz.prod_serial then v_omitidas := v_omitidas || (v_pz.prod_nombre || ' (es un artículo con IMEI)'); continue; end if;
    -- almacén: el principal si tiene existencia; si no, cualquiera con existencia suficiente
    v_alm := null;
    if v_alm_pref is not null and exists (select 1 from public.pos_stock_almacen s where s.producto_id = v_pz.producto_id and s.almacen_id = v_alm_pref and s.stock >= v_pz.cantidad) then
      v_alm := v_alm_pref;
    else
      select s.almacen_id into v_alm from public.pos_stock_almacen s join public.pos_almacenes a on a.id = s.almacen_id and a.activo
       where s.producto_id = v_pz.producto_id and s.organizacion_id = v_org and s.stock >= v_pz.cantidad order by s.stock desc limit 1;
    end if;
    if v_alm is null and not exists (select 1 from public.pos_almacenes where organizacion_id = v_org and activo) then v_alm := null;
    elsif v_alm is null then v_omitidas := v_omitidas || (v_pz.prod_nombre || ' (sin existencia suficiente)'); continue; end if;
    begin
      perform public.pos_mover_stock_atomico(v_pz.producto_id, 'taller', -v_pz.cantidad, v_alm,
        'REACOND ' || coalesce(v_eq.imei, left(v_eq.id::text, 8)),
        'Pieza usada en reacondicionado · ' || coalesce(v_eq.modelo,'') || (case when p_usuario is not null then ' · ' || p_usuario else '' end), null);
    exception when others then
      v_omitidas := v_omitidas || (v_pz.prod_nombre || ' (' || sqlerrm || ')'); continue;
    end;
    update public.pos_reacond_piezas set descontada_cant = v_pz.cantidad, descontada_almacen_id = v_alm,
      estado = (case when estado in ('pendiente','solicitada','entregada') then 'aprobada' else estado end)
      where id = v_pz.id;
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'descontadas', v_n, 'omitidas', to_jsonb(v_omitidas));
end $$;

-- ───────────────────────── RPC: despachar (salida del taller al inventario) ─────────────────────────
-- BAYOL: "despachar" = entregar al almacén principal, NO es una venta ni pide precio.
-- STUDIO: el teléfono queda DISPONIBLE en pos_seriales (almacén principal o el indicado) con su
-- IMEI, entra al stock por kardex 'taller' si no existía, y se descuentan las piezas pendientes.
create or replace function public.pos_reacond_despachar(p_equipo_id uuid, p_almacen_id uuid default null, p_usuario text default null)
returns jsonb language plpgsql set search_path to 'public' as $$
declare
  v_org uuid := public.mi_organizacion();
  v_eq public.pos_reacond_equipos%rowtype;
  v_lote public.pos_reacond_lotes%rowtype;
  v_prod public.pos_productos%rowtype;
  v_ser public.pos_seriales%rowtype;
  v_alm uuid;
  v_accion text := 'sin_producto';
  v_pz jsonb := '{}'::jsonb;
  v_imei text;
begin
  if v_org is null or public.mi_rol() is null then raise exception 'REACOND_SIN_PERMISO'; end if;
  select * into v_eq from public.pos_reacond_equipos where id = p_equipo_id and organizacion_id = v_org for update;
  if v_eq.id is null then raise exception 'REACOND_EQUIPO_INVALIDO'; end if;
  if v_eq.estado_evaluacion <> 'listo_venta' then raise exception 'REACOND_ESTADO_INVALIDO: el equipo debe estar Listo para venta'; end if;
  select * into v_lote from public.pos_reacond_lotes where id = v_eq.lote_id;
  v_alm := coalesce(p_almacen_id, (select id from public.pos_almacenes where organizacion_id = v_org and activo order by es_principal desc, created_at limit 1));
  v_imei := nullif(trim(coalesce(v_eq.imei, v_eq.serial, '')), '');

  if v_eq.producto_id is not null then
    select * into v_prod from public.pos_productos where id = v_eq.producto_id and organizacion_id = v_org;
    if v_prod.id is not null and coalesce(v_prod.serial, false) and v_imei is not null then
      select * into v_ser from public.pos_seriales
        where organizacion_id = v_org and producto_id = v_prod.id and upper(trim(serial)) = upper(v_imei)
        order by created_at desc limit 1 for update;
      if v_ser.id is null then
        insert into public.pos_seriales (organizacion_id, producto_id, serial, estado, almacen_id, color, notas)
          values (v_org, v_prod.id, v_imei, 'disponible', v_alm, nullif(v_eq.color,''), 'Reacondicionado · lote ' || coalesce(v_lote.codigo_lote, ''))
          returning * into v_ser;
        perform public.pos_mover_stock_atomico(v_prod.id, 'taller', 1, v_alm,
          'REACOND ' || coalesce(v_lote.codigo_lote, ''), 'Salida de taller (reacondicionado) IMEI ' || v_imei, null);
        v_accion := 'creado';
      elsif v_ser.estado = 'disponible' then
        v_accion := 'ya_disponible';
      else
        -- 'reservado' (apartado para el taller) o 'vendido' (volvió por devolución)
        update public.pos_seriales set estado = 'disponible', venta_id = null, reserva_token = null, reserva_hasta = null,
          almacen_id = coalesce(almacen_id, v_alm),
          notas = left(coalesce(notas, '') || ' · Reacondicionado ' || coalesce(v_lote.codigo_lote, ''), 500)
          where id = v_ser.id;
        if v_ser.estado = 'vendido' then
          perform public.pos_mover_stock_atomico(v_prod.id, 'taller', 1, coalesce(v_ser.almacen_id, v_alm),
            'REACOND ' || coalesce(v_lote.codigo_lote, ''), 'Reingreso de taller (reacondicionado) IMEI ' || v_imei, null);
        end if;
        v_accion := 'reactivado';
      end if;
      update public.pos_reacond_equipos set serial_id = v_ser.id where id = v_eq.id;
    elsif v_prod.id is not null then
      v_accion := 'producto_sin_imei';
    end if;
  end if;

  v_pz := public.pos_reacond_descontar_piezas(p_equipo_id, null, p_usuario);

  update public.pos_reacond_equipos
     set estado_evaluacion = 'vendido', fecha_despacho = now(), completado = false, fecha_completado = null
   where id = v_eq.id;
  insert into public.pos_reacond_historial (organizacion_id, equipo_id, estado_anterior, estado_nuevo, accion, usuario)
    values (v_org, v_eq.id, v_eq.estado_evaluacion, 'vendido', 'Salida registrada → Despachado', coalesce(p_usuario, 'Admin'));
  return jsonb_build_object('ok', true, 'serial', v_accion, 'piezas', v_pz);
end $$;

-- ───────────────────────── RPC: crear lote desde una compra del POS ─────────────────────────
-- BAYOL creaba lotes desde la compra de Info Plus (1 equipo por IMEI). Aquí: 1 equipo por cada
-- pos_seriales de la compra, con el costo final unitario de la línea; los seriales quedan 'reservado'
-- (apartados para el taller: no se pueden vender hasta despacharlos).
create or replace function public.pos_reacond_lote_desde_compra(p_compra_id uuid, p_codigo text default null, p_gastos_envio numeric default 0, p_notas text default null)
returns jsonb language plpgsql set search_path to 'public' as $$
declare
  v_org uuid := public.mi_organizacion();
  v_c public.pos_compras%rowtype;
  v_lote_id uuid;
  v_codigo text;
  v_n integer := 0;
  v_total numeric := 0;
  v_s record;
begin
  if v_org is null or public.mi_rol() not in ('admin','gerente') then raise exception 'REACOND_SIN_PERMISO'; end if;
  select * into v_c from public.pos_compras where id = p_compra_id and organizacion_id = v_org;
  if v_c.id is null then raise exception 'REACOND_COMPRA_INVALIDA'; end if;
  if exists (select 1 from public.pos_reacond_lotes where organizacion_id = v_org and compra_id = p_compra_id) then
    raise exception 'REACOND_LOTE_DUPLICADO: esta compra ya tiene un lote';
  end if;
  v_codigo := coalesce(nullif(trim(p_codigo), ''), 'C' || lpad(coalesce(v_c.numero, 0)::text, 6, '0'));
  if exists (select 1 from public.pos_reacond_lotes where organizacion_id = v_org and codigo_lote = v_codigo) then
    v_codigo := v_codigo || '-' || to_char(now(), 'HH24MI');
  end if;
  insert into public.pos_reacond_lotes (organizacion_id, codigo_lote, proveedor_id, compra_id, fecha_compra, gastos_envio, notas, estado, creado_por)
    values (v_org, v_codigo, v_c.proveedor_id, v_c.id, coalesce(v_c.fecha, current_date), coalesce(p_gastos_envio, 0),
            coalesce(p_notas, 'Creado desde la compra ' || coalesce(v_c.numero::text, '') || coalesce(' · ' || v_c.proveedor_nombre, '')), 'Abierto', null)
    returning id into v_lote_id;
  for v_s in
    select s.id as serial_id, s.serial, s.color, s.producto_id, pr.nombre, pr.marca, pr.referencia, pr.codigo,
           coalesce(nullif(i.costo_final_unit, 0), nullif(i.costo, 0), pr.costo, 0) as costo
    from public.pos_seriales s
    join public.pos_productos pr on pr.id = s.producto_id
    left join lateral (select costo, costo_final_unit from public.pos_compra_items ci where ci.compra_id = v_c.id and ci.producto_id = s.producto_id order by ci.id limit 1) i on true
    where s.compra_id = v_c.id and s.organizacion_id = v_org and s.estado <> 'vendido'
      and not exists (select 1 from public.pos_reacond_equipos e where e.serial_id = s.id)
    order by pr.nombre, s.created_at
  loop
    insert into public.pos_reacond_equipos (organizacion_id, lote_id, producto_id, serial_id, articulo_codigo, modelo, marca, capacidad, color, imei,
      costo_compra, costo_repuestos, estado_evaluacion, proveedor_id, fecha_compra)
    values (v_org, v_lote_id, v_s.producto_id, v_s.serial_id, v_s.codigo, v_s.nombre, v_s.marca, v_s.referencia, v_s.color, v_s.serial,
      v_s.costo, 0, 'pendiente', v_c.proveedor_id, coalesce(v_c.fecha, current_date));
    update public.pos_seriales set estado = 'reservado', notas = left(coalesce(notas,'') || ' · Taller reacondicionado ' || v_codigo, 500) where id = v_s.serial_id and estado = 'disponible';
    v_n := v_n + 1; v_total := v_total + coalesce(v_s.costo, 0);
  end loop;
  update public.pos_reacond_lotes set cantidad_equipos = v_n, costo_total_lote = round(v_total, 2) where id = v_lote_id;
  return jsonb_build_object('ok', true, 'lote_id', v_lote_id, 'codigo', v_codigo, 'equipos', v_n);
end $$;

revoke execute on function public.pos_reacond_descontar_piezas(uuid, uuid, text) from public, anon;
revoke execute on function public.pos_reacond_despachar(uuid, uuid, text) from public, anon;
revoke execute on function public.pos_reacond_lote_desde_compra(uuid, text, numeric, text) from public, anon;
grant execute on function public.pos_reacond_descontar_piezas(uuid, uuid, text) to authenticated, service_role;
grant execute on function public.pos_reacond_despachar(uuid, uuid, text) to authenticated, service_role;
grant execute on function public.pos_reacond_lote_desde_compra(uuid, text, numeric, text) to authenticated, service_role;

-- ───────────────────────── semilla: catálogo de fallas (el mismo de BAYOL CELL) ─────────────────────────
do $$
declare
  v_org uuid := 'e404d1c4-24c5-4e17-88f6-84bef09d6d19';
  v_cat uuid;
  c jsonb; f jsonb;
  v_cats jsonb := $j$[
   {"n":"Pantalla","i":"ti-device-mobile","c":"#3b82f6","o":1,"f":[["AVISO DE PANTALLA","MENSAJE DE PANTALLA",null],["CAMBIAR PANTALLA","CAMBIAR PANTALLA",null],["Cristal roto (display funciona)","GLASS","CAMBIO DE CRISTAL"],["Líneas en pantalla","LÍNEAS LCD",null],["Manchas en pantalla","SOMBRA EN PANTALLA","PUEDE SER PORQUE ESTÉ QUEMADA PERO SI FUNCIONA"],["Pantalla rayada","PULIR PANTALLA",null],["Pantalla rota / quebrada","PANT ROTA",null],["TOUCH","TOUCH",null]]},
   {"n":"Batería","i":"ti-battery","c":"#10b981","o":2,"f":[["Aviso de batería","AVISO BAT",null],["BATERIA","CAMBIAR BATERIA",null],["Se descarga rápido","DESCARGA RAP",null],["SUBIR BATERIA","SUBIR BATERIA",null]]},
   {"n":"Cámara","i":"ti-camera","c":"#f59e0b","o":3,"f":[["Cámara trasera no abre","CAMARA TRASERA NO ABRE",null],["Cámara trasera se congela","CAMARA TRASERA SE FRISA",null],["Cámara con manchas","CAM MANCHA",null],["Cámara frontal dañada","CAM FRONT",null],["Cámara trasera no enfoca","CAM TRAS",null],["FLASH","NO FLASH",null],["Lente quebrado","LENTE QUEB",null]]},
   {"n":"Audio","i":"ti-volume","c":"#8b5cf6","o":4,"f":[["Altavoz inferior no suena","ALTAVOZ",null],["Bocina de arriba","BOCINA ARRIBA",null],["Micrófono no funciona","MIC",null]]},
   {"n":"Carga / Puerto","i":"ti-plug","c":"#ef4444","o":5,"f":[["Carga lenta","CARGA LENTA",null],["FLEX DE CARGA","FLEX DE CARGA",null],["No carga","NO CARGA",null],["No reconoce cable","NO CABLE",null]]},
   {"n":"Botones","i":"ti-square","c":"#06b6d4","o":6,"f":[["Botón de encendido dañado","BTN POWER",null],["Botón home / inicio","BTN HOME",null],["Botones de volumen","BTN VOL",null],["Touch ID / Face ID dañado","FACE ID VERIFICAR",null]]},
   {"n":"Conectividad","i":"ti-wifi","c":"#ec4899","o":7,"f":[["Bluetooth no funciona","NO BT",null],["No reconoce SIM","NO SIM",null],["Sin señal celular","SIN SEÑAL",null],["Wi-Fi no conecta","NO WIFI",null]]},
   {"n":"Software","i":"ti-device-mobile-code","c":"#6366f1","o":8,"f":[["iCloud / FRP bloqueado","ICLOUD",null],["Pantalla congelada","CONGELADO",null],["Reinicia solo","REINICIA",null]]},
   {"n":"Físico / Carcasa","i":"ti-package","c":"#84cc16","o":9,"f":[["BRILLAR HOUSING","BRILLAR HOUSING",null],["Golpes / Rayones","GOLPES",null],["HOUSING","HOUSING",null],["MARCO","CAMBIAR MARCO",null],["Marco doblado","MARCO DOBL",null],["Tapa trasera quebrada","TAPA ROTA",null]]},
   {"n":"Otros","i":"ti-help","c":"#64748b","o":99,"f":[["Falta de componentes","FALTAN PZ",null]]}
  ]$j$::jsonb;
begin
  if not exists (select 1 from public.organizaciones where id = v_org) then return; end if;
  if exists (select 1 from public.pos_reacond_falla_categorias where organizacion_id = v_org) then return; end if;
  for c in select * from jsonb_array_elements(v_cats) loop
    insert into public.pos_reacond_falla_categorias (organizacion_id, nombre, icono, color, orden, activa)
      values (v_org, c->>'n', c->>'i', c->>'c', (c->>'o')::int, true) returning id into v_cat;
    for f in select * from jsonb_array_elements(c->'f') loop
      insert into public.pos_reacond_fallas (organizacion_id, categoria_id, nombre, nombre_corto, descripcion, activa)
        values (v_org, v_cat, f->>0, f->>1, f->>2, true);
    end loop;
  end loop;
  update public.pos_config set reacondicionado = true where organizacion_id = v_org;
end $$;

commit;
