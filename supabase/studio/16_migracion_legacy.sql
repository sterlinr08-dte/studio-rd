-- STUDIO · 16_migracion_legacy.sql — migración desde la base del sistema anterior (COCO WIRELESS SRL)
-- ---------------------------------------------------------------------------------------------
-- Flujo (2026-09-22, decisión del dueño: «Todo porque es para ese cliente»):
--   1. El dueño sube `database.sql` (dump del sistema anterior) al bucket público temporal `migracion`.
--   2. legacy.descargar(url, bytes) + legacy.recoger() traen el archivo por pg_net en trozos de 1 MB.
--   3. legacy.cargar_dump() ejecuta solo los INSERT de las tablas que existen en el esquema `legacy`.
--   4. legacy.migrar() transforma legacy.* → pos_* (mismos UUID donde existen, para trazabilidad).
--   5. legacy.reconciliar() compara stock, cartera y totales con el sistema anterior.
--   6. legacy.deshacer() borra todo lo migrado (por id registrado en legacy._ids) para poder repetir.
--   7. Usuarios: legacy.crear_usuarios(json) crea usuarios_sistema + auth.users + profiles con clave temporal.
-- Todo el dinero viene de la fuente de verdad del sistema anterior: ventas + ar_invoices (cartera).
-- Nunca se suma dos veces: la deuda de cada factura = credito_monto - Σ abonos, igual que ar.balance.
-- ---------------------------------------------------------------------------------------------

create schema if not exists legacy;
create table if not exists legacy._log(id serial primary key, paso text, detalle jsonb, at timestamptz default now());
create table if not exists legacy._ids(tabla text not null, id uuid not null, primary key (tabla, id));

create or replace function legacy.const(p text) returns uuid language sql immutable as $$
  select case p
    when 'org'           then 'e404d1c4-24c5-4e17-88f6-84bef09d6d19'
    when 'alm_principal' then '83e35d4c-d3ff-484f-98fb-fafdf63735af'
    when 'nivel_detalle' then '87ee994e-b6bc-4892-8717-014d3fc42dd1'
    when 'nivel_mayor'   then '0efff520-f1e2-4434-9929-bdbb850745a7'
  end::uuid $$;

-- Categoría destino según categoría/tipo/nombre del producto anterior
create or replace function legacy.cat_nombre(p_cat text, p_name text, p_type text) returns text language sql immutable as $$
  select case
    when p_type = 'service' or p_cat = 'SERVICIO' then 'SERVICIOS'
    when p_type = 'part' or p_cat in ('PIEZA','Pieza Motores','BATERIAS SAMSUNG ORIGINAL','BATERIAS DE IPHONE ORIGINALES') then 'PIEZAS'
    when p_cat in ('movilidad','MOVILIDAD') then 'MOTO ELECTRÓNICO'
    when p_cat in ('ACCESORIO','Accesorio') then 'ACCESORIOS'
    when p_cat = 'Aire' or p_name ~* '(aire acond|air condition|\mBTU\M)' then 'AIRES'
    when p_name ~* '(\mTV\M|televis|smart tv)' then 'TELEVISORES'
    when p_cat in ('HOGAR','Hogar','REFIGERADORES') then 'HOGAR'
    when p_cat in ('Tecnologia','IPAD','Celular') then 'CELULARES'
    when p_name ~* '^(iphone|celular|sky|samsung|xiaomi|voltex|ipad)' then 'CELULARES'
    when p_name ~* '^(cover|glass|cable|cargador|airpods|apple watch|aplle watch|raycon|bocina)' then 'ACCESORIOS'
    when p_name ~* '(macbook|laptop)' then 'COMPUTADORAS'
    when p_name ~* '(scooter|patineta|vehículo eléctrico|vehiculo electrico|moto)' then 'MOTO ELECTRÓNICO'
    else 'OTROS' end $$;

create or replace function legacy.metodo(p_label text) returns text language sql immutable as $$
  select case p_label
    when 'Efectivo' then 'Efectivo' when 'Transferencia' then 'Transferencia'
    when 'Tarjeta' then 'Tarjeta' when 'Cardnet' then 'Tarjeta' when 'Cheque' then 'Cheque'
    when 'Crédito cliente' then 'Crédito' when 'Crédito tienda' then 'Nota de crédito'
    when 'Permuta / parte de pago' then 'Permuta' else coalesce(p_label,'Otro') end $$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════
create or replace function legacy.migrar() returns jsonb language plpgsql as $$
declare
  v_org uuid := legacy.const('org');
  v_alm uuid := legacy.const('alm_principal');
  v_nd  uuid := legacy.const('nivel_detalle');
  v_nm  uuid := legacy.const('nivel_mayor');
  v_n int; v_res jsonb := '{}'::jsonb; r record; v_seq bigint;
begin
  if exists (select 1 from public.pos_ventas v join legacy.sales s on s.id=v.id) then
    raise exception 'YA_MIGRADO: ejecutar legacy.deshacer() antes de repetir';
  end if;
  if (select count(*) from legacy.sales) = 0 or (select count(*) from legacy.products) = 0 then
    raise exception 'LEGACY_VACIO: cargar el dump primero (legacy.cargar_dump)';
  end if;

  -- 1) Almacenes ------------------------------------------------------------------------
  update public.pos_almacenes set nombre='Edificio Studio', es_principal=true, activo=true where id=v_alm;
  drop table if exists legacy.m_alm;
  create table legacy.m_alm as
    select w.id wh, case when b.is_headquarters then v_alm else w.id end alm, w.name nombre, b.id branch, b.name sucursal
    from legacy.warehouses w join legacy.branches b on b.id=w.branch_id;
  insert into public.pos_almacenes(id, organizacion_id, nombre, es_principal, activo, created_at)
    select m.alm, v_org, m.nombre, false, true, now() from legacy.m_alm m where m.alm<>v_alm
    on conflict (id) do nothing;
  insert into legacy._ids select 'pos_almacenes', alm from legacy.m_alm where alm<>v_alm on conflict do nothing;

  -- 2) Categorías -------------------------------------------------------------------------
  with ins as (
    insert into public.pos_categorias(organizacion_id, nombre, orden)
    select v_org, n, 10 + row_number() over () from unnest(array['ACCESORIOS','HOGAR','AIRES','TELEVISORES','COMPUTADORAS','OTROS']) n
    where not exists (select 1 from public.pos_categorias c where c.organizacion_id=v_org and upper(c.nombre)=n)
    returning id)
  insert into legacy._ids select 'pos_categorias', id from ins;

  -- 3) Productos --------------------------------------------------------------------------
  insert into public.pos_productos(id, organizacion_id, nombre, codigo, categoria_id, precio, costo, stock, itbis, activo, created_at,
      marca, referencia, precio_mayor, precio_minimo, tipo, stock_min, serial, descripcion, notas, favorito)
  select p.id, v_org, left(btrim(p.name),200), p.sku,
      (select c.id from public.pos_categorias c where c.organizacion_id=v_org and upper(c.nombre)=legacy.cat_nombre(p.category,p.name,p.type) limit 1),
      coalesce(p.sale_price,0), coalesce(p.cost_price,0), 0, true, coalesce(p.active,true), coalesce(p.created_at,now()),
      nullif(btrim(p.brand),''), nullif(btrim(p.model),''), nullif(p.wholesale_price,0), 0,
      case when p.type='service' then 'servicio' else 'producto' end,
      coalesce(p.reorder_threshold,0), coalesce(p.tracks_serial,false),
      nullif(concat_ws(' · ', nullif(btrim(p.color),''), p.specs->>'tipo'),''),
      'Migrado del sistema anterior' || coalesce(' · categoría anterior: '||p.category,''), false
  from legacy.products p
  on conflict (id) do nothing;
  insert into legacy._ids select 'pos_productos', id from legacy.products on conflict do nothing;

  with ins as (
    insert into public.pos_producto_niveles(organizacion_id, producto_id, nivel_id, precio_contado)
    select v_org, p.id, v_nd, coalesce(p.sale_price,0) from legacy.products p
    union all
    select v_org, p.id, v_nm, p.wholesale_price from legacy.products p where coalesce(p.wholesale_price,0)>0
    on conflict (organizacion_id, producto_id, nivel_id) do nothing
    returning id)
  insert into legacy._ids select 'pos_producto_niveles', id from ins;

  -- 4) Clientes ---------------------------------------------------------------------------
  drop table if exists legacy.m_mayoristas;
  create table legacy.m_mayoristas as
    select s.customer_id from legacy.sale_lines l join legacy.sales s on s.id=l.sale_id
    where l.wholesale_price is not null and l.applied_price is not null and abs(l.applied_price-l.wholesale_price)<1 and s.customer_id is not null
    group by 1 having count(*)>=2;
  insert into public.pos_clientes(id, organizacion_id, nombre, cedula, telefono, direccion, limite_credito, notas, activo, created_at, codigo,
      tipo_persona, nivel_precio, nivel_id, es_cliente)
  select c.id, v_org, left(btrim(c.full_name),200),
      case when coalesce(c.identification_pending,false) or c.identification !~ '[1-9]' then null else btrim(c.identification) end,
      case when c.phone !~ '[1-9]' then null else btrim(c.phone) end,
      nullif(btrim(c.location),''),
      case when c.credit_status='approved' then coalesce(c.credit_limit,0) else 0 end,
      nullif(concat_ws(' · ', nullif(btrim(c.notes),''), case when c.legacy_source_code is not null then 'Código anterior: '||c.legacy_source_code end,
                       case when c.credit_status='rejected' then 'Crédito rechazado en el sistema anterior' end),''),
      coalesce(c.status,'active')='active', coalesce(c.created_at,now()), c.code,
      case when c.full_name ~* '(SRL|S\.R\.L|EIRL|E\.I\.R\.L|SAS|S\.A|TECH|CELL|COMUNICA|MOVIL|STORE|SHOP|/)' then 'juridica' else 'fisica' end,
      case when m.customer_id is not null then 'mayor' else 'final' end,
      case when m.customer_id is not null then v_nm else v_nd end, true
  from legacy.customers c left join legacy.m_mayoristas m on m.customer_id=c.id
  on conflict (id) do nothing;
  insert into legacy._ids select 'pos_clientes', id from legacy.customers on conflict do nothing;

  -- 5) Proveedores / empleados (RRHH) ----------------------------------------------------
  insert into public.pos_proveedores(id, organizacion_id, nombre, telefono, contacto, activo, created_at)
  select s.id, v_org, s.name, nullif(s.phone,''), nullif(s.contact_name,''), coalesce(s.active,true), coalesce(s.created_at,now())
  from legacy.suppliers s where lower(s.name)<>'anonimo' on conflict (id) do nothing;
  insert into legacy._ids select 'pos_proveedores', id from legacy.suppliers where lower(name)<>'anonimo' on conflict do nothing;

  insert into public.rrhh_empleados(id, organizacion_id, nombre, puesto, salario, fecha_ingreso, activo, notas, created_at)
  select e.id, v_org, btrim(e.full_name),
      case e.role when 'super_admin' then 'Administrador' when 'supervisor' then 'Supervisor' when 'cashier' then 'Cajero'
                  when 'technician' then 'Técnico' when 'driver' then 'Transportista' when 'auxiliar' then 'Auxiliar' else e.role end,
      coalesce(e.base_salary,0), e.hire_date, coalesce(e.active,true),
      'Sucursal: '||coalesce(b.name,'')||' · código anterior '||e.employee_code, coalesce(e.created_at,now())
  from legacy.employees e left join legacy.branches b on b.id=e.branch_id
  where e.id = (select min(e2.id) from legacy.employees e2 where lower(e2.full_name)=lower(e.full_name))
  on conflict (id) do nothing;
  insert into legacy._ids select 'rrhh_empleados', id from public.rrhh_empleados where id in (select id from legacy.employees) on conflict do nothing;

  -- 6) Ventas -----------------------------------------------------------------------------
  drop table if exists legacy.m_ventas;
  create table legacy.m_ventas as
  with pg as (
    select sp.sale_id, legacy.metodo(pm.label) met, sum(sp.amount) m
    from legacy.sale_payments sp join legacy.payment_methods pm on pm.id=sp.payment_method_id group by 1,2),
  agg as (
    select sale_id,
      coalesce(sum(m) filter (where met='Efectivo'),0) efe,
      coalesce(sum(m) filter (where met='Tarjeta'),0) tar,
      coalesce(sum(m) filter (where met='Transferencia'),0) tra,
      coalesce(sum(m) filter (where met='Crédito'),0) cred,
      coalesce(sum(m) filter (where met not in ('Efectivo','Tarjeta','Transferencia','Crédito')),0) otro,
      jsonb_agg(jsonb_build_object('metodo', met, 'monto', m) order by met) filter (where met<>'Crédito') pagos_sin_cred
    from pg group by 1),
  ar as (select sale_id, min(id) inv_id, sum(amount) amount, sum(balance) balance, min(due_date) due_date from legacy.ar_invoices where sale_id is not null group by 1),
  ncf as (select sale_id, min(ncf) ncf, min(ecf_type) ecf from legacy.invoice_queue where status='completed' and ncf is not null group by 1),
  base as (
    select s.id, s.created_at, s.status, s.customer_id, s.branch_id, s.dispatch_warehouse_id, s.cash_session_id, s.created_by,
      s.subtotal, s.itbis, s.total, coalesce(s.discount_amount,0) descuento, s.discount_reason, s.shipping_address,
      coalesce(a.efe,0) efe, coalesce(a.tar,0) tar, coalesce(a.tra,0) tra, coalesce(a.otro,0) otro,
      coalesce(ar.amount, a.cred, 0) cred, coalesce(a.pagos_sin_cred,'[]'::jsonb) pagos_sin_cred,
      ar.inv_id, ar.balance ar_balance, ar.due_date, n.ncf, n.ecf
    from legacy.sales s left join agg a on a.sale_id=s.id left join ar on ar.sale_id=s.id left join ncf n on n.sale_id=s.id),
  calc as (
    select b.*, (b.efe+b.tar+b.tra+b.otro+b.cred) suma,
      case when (b.efe+b.tar+b.tra+b.otro+b.cred) > b.total then (b.efe+b.tar+b.tra+b.otro+b.cred) else b.total end total_fin
    from base b)
  select c.*,
    c.total_fin - c.suma faltante,                                       -- >0 → pago sin registro
    case when c.total_fin<>c.total then round(c.total_fin*18/118.0,2) else c.itbis end itbis_fin,
    row_number() over (order by c.created_at, c.id) numero,
    row_number() over (partition by (c.cred>0) order by c.created_at, c.id) num_tipo
  from calc c;

  insert into public.pos_ventas(id, organizacion_id, numero, fecha, cliente_id, cliente_nombre, subtotal, itbis, total, descuento,
      metodo_pago, recibido, devuelta, estado, notas, created_by_name, created_at, a_credito, caja_id, pagos,
      pagado_efectivo, pagado_tarjeta, pagado_transferencia, pagado_otro, credito_monto, tipo_comprobante, numero_factura, ncf,
      vendedor_nombre, almacen_id, inventario_aplicado, credito_vencimiento)
  select m.id, v_org, m.numero, m.created_at, cl.id, coalesce(cl.nombre,'Consumidor final'),
      m.total_fin - m.itbis_fin, m.itbis_fin, m.total_fin, m.descuento,
      case when jsonb_array_length(pj.pagos)=0 then 'Efectivo' when jsonb_array_length(pj.pagos)=1 then pj.pagos->0->>'metodo' else 'Mixto' end,
      m.efe, 0, case when m.status='cancelled' then 'anulada' else 'completada' end,
      nullif(concat_ws(' · ', 'Migrada del sistema anterior', nullif(m.discount_reason,''), nullif(m.shipping_address,''),
        case when m.faltante>0 then 'Pago sin registro en el sistema anterior: '||m.faltante end,
        case when m.total_fin<>m.total then 'Total ajustado de '||m.total||' a '||m.total_fin||' para cuadrar con la deuda registrada' end),''),
      coalesce(pr.full_name,'Sistema anterior'), m.created_at, m.cred>0, m.cash_session_id, pj.pagos,
      m.efe, m.tar, m.tra, m.otro + greatest(m.faltante,0), m.cred,
      case m.ecf when 'B01' then 'credito_fiscal' when 'B02' then 'consumo' when 'B14' then 'regimen_especial' when 'B15' then 'gubernamental' else 'sin' end,
      case when m.cred>0 then 'CR' else 'CO' end || lpad(m.num_tipo::text, 8, '0'), m.ncf,
      coalesce(pr.full_name,null), coalesce(ma.alm, mb.alm, v_alm), true, m.due_date
  from legacy.m_ventas m
  left join public.pos_clientes cl on cl.id=m.customer_id
  left join legacy.profiles pr on pr.id=m.created_by
  left join legacy.m_alm ma on ma.wh=m.dispatch_warehouse_id
  left join (select distinct on (branch) branch, alm from legacy.m_alm order by branch, (alm=v_alm) desc) mb on mb.branch=m.branch_id
  cross join lateral (select m.pagos_sin_cred
      || case when m.cred>0 then jsonb_build_array(jsonb_build_object('metodo','Crédito','monto',m.cred)) else '[]'::jsonb end
      || case when m.faltante>0 then jsonb_build_array(jsonb_build_object('metodo','Sin registro (sistema anterior)','monto',m.faltante)) else '[]'::jsonb end pagos) pj;
  insert into legacy._ids select 'pos_ventas', id from legacy.m_ventas on conflict do nothing;

  -- 6b) Facturas de cartera sin venta (saldos iniciales del sistema anterior) → venta a crédito de apertura
  select coalesce(max(numero),0) into v_seq from legacy.m_ventas;
  insert into public.pos_ventas(id, organizacion_id, numero, fecha, cliente_id, cliente_nombre, subtotal, itbis, total, descuento,
      metodo_pago, estado, notas, created_by_name, created_at, a_credito, pagos, credito_monto, tipo_comprobante, numero_factura,
      almacen_id, inventario_aplicado, credito_vencimiento)
  select a.id, v_org, v_seq + row_number() over (order by a.created_at, a.id), a.created_at, cl.id, coalesce(cl.nombre,'Cliente'),
      a.amount, 0, a.amount, 0, 'Crédito', 'completada',
      'Saldo inicial migrado del sistema anterior · factura '||coalesce(a.invoice_number,'s/n'), 'Sistema anterior', a.created_at, true,
      jsonb_build_array(jsonb_build_object('metodo','Crédito','monto',a.amount)), a.amount, 'sin',
      coalesce(a.invoice_number, 'LEGACY-'||left(a.id::text,8)), v_alm, true, a.due_date
  from legacy.ar_invoices a left join public.pos_clientes cl on cl.id=a.customer_id
  where a.sale_id is null;
  insert into legacy._ids select 'pos_ventas', id from legacy.ar_invoices where sale_id is null on conflict do nothing;

  -- 7) Renglones de venta ----------------------------------------------------------------
  insert into public.pos_venta_items(id, organizacion_id, venta_id, producto_id, nombre, precio, cantidad, itbis, importe, descuento, serial, linea_orden, costo_unitario)
  select l.id, v_org, l.sale_id, case when p.id is not null then l.product_id end, left(coalesce(l.description, p.nombre, 'Artículo'),200),
      l.unit_price, l.qty, true, l.qty*l.unit_price, 0, coalesce(u.imei, u.serial, u.barcode),
      row_number() over (partition by l.sale_id order by l.id), coalesce(u.cost_price, p.costo, 0)
  from legacy.sale_lines l
  left join public.pos_productos p on p.id=l.product_id
  left join legacy.imei_units u on u.id=l.imei_unit_id
  where exists (select 1 from public.pos_ventas v where v.id=l.sale_id);
  insert into legacy._ids select 'pos_venta_items', id from legacy.sale_lines on conflict do nothing;

  with ins as (
    insert into public.pos_venta_items(organizacion_id, venta_id, producto_id, nombre, precio, cantidad, itbis, importe, descuento, linea_orden, costo_unitario)
    select v_org, a.id, null, 'Saldo pendiente del sistema anterior (factura '||coalesce(a.invoice_number,'s/n')||')', a.amount, 1, false, a.amount, 0, 1, 0
    from legacy.ar_invoices a where a.sale_id is null
    returning id)
  insert into legacy._ids select 'pos_venta_items', id from ins;

  -- 8) Abonos (cobros de cartera) ---------------------------------------------------------
  drop table if exists legacy.m_abonos;
  create table legacy.m_abonos as
  select al.id, a.customer_id cliente_id, coalesce(a.sale_id, a.id) venta_id, al.amount monto, l.created_at,
      case l.payment_method when 'cash' then 'Efectivo' when 'transfer' then 'Transferencia' else 'Otro' end metodo,
      nullif(concat_ws(' · ', nullif(l.notes,''), case when l.bank_reference is not null then 'Ref. '||l.bank_reference end),'') nota,
      pr.full_name creado_por, a.id inv_id
  from legacy.credit_payment_allocations al
  join legacy.credit_ledger l on l.id=al.ledger_entry_id
  join legacy.ar_invoices a on a.id=al.invoice_id
  left join legacy.profiles pr on pr.id=l.created_by
  union all
  select l.id, a.customer_id, coalesce(a.sale_id, a.id), l.amount, l.created_at,
      case l.type when 'credit_note' then 'Nota de crédito' else 'Ajuste' end, nullif(l.notes,''), pr.full_name, a.id
  from legacy.credit_ledger l join legacy.ar_invoices a on a.id=l.invoice_id
  left join legacy.profiles pr on pr.id=l.created_by
  where l.type in ('credit_note','credit_decrease')
  union all
  -- ajuste por factura: lo que falta para que credito_monto - Σabonos = balance del sistema anterior
  select gen_random_uuid(), a.customer_id, coalesce(a.sale_id, a.id), a.amount - a.balance - coalesce(x.s,0), coalesce(a.created_at, now()),
      'Ajuste', 'Ajuste de migración: pagos sin detalle en el sistema anterior', 'Sistema anterior', a.id
  from legacy.ar_invoices a
  left join (
    select al.invoice_id, sum(al.amount) s from legacy.credit_payment_allocations al group by 1
  ) al on al.invoice_id=a.id
  left join lateral (select coalesce(al.s,0) + coalesce((select sum(l.amount) from legacy.credit_ledger l where l.invoice_id=a.id and l.type in ('credit_note','credit_decrease')),0) s) x on true
  where abs(a.amount - a.balance - coalesce(x.s,0)) >= 1;

  with ins as (
    insert into public.pos_abonos(id, organizacion_id, cliente_id, venta_id, monto, fecha, metodo, nota, created_by_name, created_at, numero)
    select m.id, v_org, m.cliente_id, m.venta_id, m.monto, m.created_at::date, m.metodo, m.nota, m.creado_por, m.created_at,
        'REC-'||lpad((row_number() over (order by m.created_at, m.id))::text, 5, '0')
    from legacy.m_abonos m where m.cliente_id is not null and m.monto<>0
    returning id)
  insert into legacy._ids select 'pos_abonos', id from ins;

  -- 9) Seriales / IMEI --------------------------------------------------------------------
  insert into public.pos_seriales(id, organizacion_id, producto_id, serial, estado, almacen_id, venta_id, notas, created_at, color)
  select u.id, v_org, u.product_id, coalesce(nullif(u.imei,''), nullif(u.serial,''), nullif(u.barcode,''), 'SIN-SERIAL-'||left(u.id::text,8)),
      case u.status when 'available' then 'disponible' when 'in_transit' then 'disponible' when 'sold' then 'vendido' else 'reservado' end,
      coalesce(ma.alm, v_alm),
      case when u.status='sold' and exists (select 1 from public.pos_ventas v where v.id=u.sale_id) then u.sale_id end,
      nullif(concat_ws(' · ', case when u.motor_no is not null then 'Motor: '||u.motor_no end, case when u.list_no is not null then 'Lista: '||u.list_no end,
        case when u.tag is not null then 'Tag: '||u.tag end,
        case u.status when 'defective' then 'DEFECTUOSA (sistema anterior)' when 'in_service' then 'EN TALLER (sistema anterior)'
                      when 'reserved' then 'RESERVADA (sistema anterior)' when 'in_transit' then 'EN TRÁNSITO (sistema anterior)' end,
        case when u.sold_at is not null then 'Vendida '||to_char(u.sold_at at time zone 'America/Santo_Domingo','YYYY-MM-DD') end),''),
      coalesce(u.created_at, now()), nullif(btrim(p.color),'')
  from legacy.imei_units u
  left join legacy.m_alm ma on ma.wh=u.warehouse_id
  left join legacy.products p on p.id=u.product_id
  where exists (select 1 from public.pos_productos pp where pp.id=u.product_id)
  on conflict (id) do nothing;
  insert into legacy._ids select 'pos_seriales', id from legacy.imei_units on conflict do nothing;

  -- 10) Stock por almacén (serializados = unidades disponibles; el resto = stock_levels) -----
  with st as (
    select p.id producto_id, ma.alm almacen_id, count(*)::numeric stock
    from legacy.imei_units u join legacy.products p on p.id=u.product_id and p.tracks_serial
    join legacy.m_alm ma on ma.wh=u.warehouse_id
    where u.status in ('available','in_transit') group by 1,2
    union all
    select s.product_id, ma.alm, s.qty::numeric
    from legacy.stock_levels s join legacy.products p on p.id=s.product_id and not coalesce(p.tracks_serial,false)
    join legacy.m_alm ma on ma.wh=s.warehouse_id where s.qty<>0),
  ins as (
    insert into public.pos_stock_almacen(organizacion_id, producto_id, almacen_id, stock)
    select v_org, producto_id, almacen_id, sum(stock) from st
    where exists (select 1 from public.pos_productos pp where pp.id=st.producto_id) group by 1,2,3
    on conflict (producto_id, almacen_id) do update set stock = excluded.stock
    returning id)
  insert into legacy._ids select 'pos_stock_almacen', id from ins on conflict do nothing;
  update public.pos_productos p set stock = coalesce((select sum(s.stock) from public.pos_stock_almacen s where s.producto_id=p.id),0)
  where p.id in (select id from legacy.products);

  -- 11) Kardex (movimientos históricos) ---------------------------------------------------
  with ins as (
    insert into public.pos_inv_movimientos(organizacion_id, producto_id, producto_nombre, tipo, cantidad, stock_anterior, stock_nuevo, referencia, motivo, created_by_name, fecha)
    select v_org, m.product_id, p.nombre,
      case m.movement_type when 'entrada' then 'compra' when 'salida' then 'venta' when 'sale' then 'venta'
                           when 'transfer_in' then 'transferencia' when 'transfer_out' then 'transferencia' else 'ajuste' end,
      m.qty_delta, m.qty_before, m.qty_after, nullif(concat_ws(' ', m.reference_type, m.reference_id),''),
      nullif(concat_ws(' · ', nullif(m.reason,''), 'Almacén: '||coalesce(ma.nombre,'?'), 'Sistema anterior'),''),
      coalesce(m.user_label,'Sistema anterior'), coalesce(m.created_at, now())
    from legacy.stock_movements m
    join public.pos_productos p on p.id=m.product_id
    left join legacy.m_alm ma on ma.wh=m.warehouse_id
    where m.movement_type in ('ajuste','entrada','salida','sale','transfer_in','transfer_out') and coalesce(m.qty_delta,0)<>0
    returning id)
  insert into legacy._ids select 'pos_inv_movimientos', id from ins;

  -- 12) Cajas -----------------------------------------------------------------------------
  insert into public.pos_cajas(id, organizacion_id, apertura, cierre, monto_inicial, estado, ventas_efectivo, abonos_efectivo, entradas, salidas,
      efectivo_esperado, efectivo_contado, descuadre, notas, created_by_name, usuario_nombre, created_at)
  select cs.id, v_org, cs.opened_at, coalesce(cs.closed_at, now()), coalesce(cs.opening_float,0), 'cerrada',
      coalesce(mv.ventas,0), coalesce(mv.abonos,0), coalesce(mv.entradas,0), coalesce(mv.salidas,0),
      coalesce(cs.expected_cash,0), coalesce(cs.counted_cash, cs.expected_cash, 0), coalesce(cs.variance,0),
      concat_ws(' · ', 'Caja: '||coalesce(r.name,'?'), 'Sistema anterior', case when cs.status='open' then 'Estaba abierta al migrar; cerrada por migración' end),
      coalesce(po.full_name,'Sistema anterior'), coalesce(po.full_name,'Sistema anterior'), cs.opened_at
  from legacy.cash_sessions cs
  left join legacy.cash_registers r on r.id=cs.register_id
  left join legacy.profiles po on po.id=cs.opened_by
  left join (
    select cash_session_id,
      sum(amount) filter (where direction='in' and category='sale') ventas,
      sum(amount) filter (where direction='in' and category in ('credit_payment','credit_payment_transfer')) abonos,
      sum(amount) filter (where direction='in' and category not in ('sale','credit_payment','credit_payment_transfer')) entradas,
      sum(amount) filter (where direction='out') salidas
    from legacy.cash_session_movements group by 1) mv on mv.cash_session_id=cs.id
  on conflict (id) do nothing;
  insert into legacy._ids select 'pos_cajas', id from legacy.cash_sessions on conflict do nothing;

  with ins as (
    insert into public.pos_caja_movimientos(organizacion_id, caja_id, tipo, concepto, monto, fecha, created_by_name)
    select v_org, m.cash_session_id, case when m.direction='in' then 'entrada' else 'salida' end,
      concat_ws(' · ', m.category, nullif(m.source_label,''), nullif(m.description,'')), m.amount, m.created_at, 'Sistema anterior'
    from legacy.cash_session_movements m
    where m.category not in ('sale','credit_payment','credit_payment_transfer') and m.amount<>0
      and exists (select 1 from public.pos_cajas c where c.id=m.cash_session_id)
    returning id)
  insert into legacy._ids select 'pos_caja_movimientos', id from ins;

  -- 13) Bancos (una cuenta por banco+número; las copias por sucursal se consolidan) ----------
  drop table if exists legacy.m_bancos;
  create table legacy.m_bancos as
    select b.id, first_value(b.id) over (partition by b.name, b.account_number order by (br.is_headquarters) desc, b.id) cuenta_id,
           b.name, b.account_number, b.balance
    from legacy.bank_accounts b left join legacy.branches br on br.id=b.branch_id;
  insert into public.pos_cuentas_bancarias(id, organizacion_id, banco_nombre, alias, numero, tipo, moneda, saldo_inicial, fecha_saldo_inicial, predeterminada, activa)
  select distinct on (m.cuenta_id) m.cuenta_id, v_org, m.name, m.name||' ···'||right(m.account_number,4), m.account_number, 'corriente', 'DOP', 0,
      coalesce((select min(created_at)::date from legacy.bank_movements bm join legacy.m_bancos mb on mb.id=bm.bank_account_id where mb.cuenta_id=m.cuenta_id), current_date), false, true
  from legacy.m_bancos m order by m.cuenta_id
  on conflict (id) do nothing;
  insert into legacy._ids select 'pos_cuentas_bancarias', cuenta_id from legacy.m_bancos on conflict do nothing;

  with ins as (
    insert into public.pos_banco_movimientos(organizacion_id, cuenta_bancaria_id, fecha, monto, concepto, referencia, origen_tipo, origen_id)
    select v_org, mb.cuenta_id, bm.created_at, case when bm.direction='in' then bm.amount else -bm.amount end,
      concat_ws(' · ', case bm.category when 'sale' then 'Venta' when 'credit_payment' then 'Cobro de cartera' else bm.category end, nullif(bm.description,''), 'Sistema anterior'),
      bm.reference_id::text, bm.reference_type, bm.reference_id
    from legacy.bank_movements bm join legacy.m_bancos mb on mb.id=bm.bank_account_id
    where coalesce(bm.amount,0)<>0
    returning id)
  insert into legacy._ids select 'pos_banco_movimientos', id from ins;

  -- 14) Taller, cotizaciones, transferencias, devoluciones ----------------------------------
  with ins as (
    insert into public.pos_reparaciones(organizacion_id, numero, cliente_nombre, cliente_telefono, equipo, imei, falla, diagnostico, presupuesto,
        estado, tecnico, nota, es_garantia, entregado_at, created_at)
    select v_org, t.id, coalesce(c.full_name,'Cliente'), c.phone, t.title, nullif(t.imei,''), nullif(t.notes,''), nullif(t.work_summary,''), coalesce(t.total,0),
        case t.status when 'completed' then 'entregado' when 'assigned' then 'recibido' else 'recibido' end,
        pr.full_name, 'Migrado del sistema anterior · '||t.work_type||' · prioridad '||t.priority, t.work_type='warranty', t.completed_at, t.created_at
    from legacy.workshop_tickets t left join legacy.customers c on c.id=t.customer_id left join legacy.profiles pr on pr.id=t.assigned_to
    returning id)
  insert into legacy._ids select 'pos_reparaciones', id from ins;

  insert into public.pos_cotizaciones(id, organizacion_id, numero, cliente_id, cliente_nombre, fecha, validez_dias, subtotal, itbis, descuento, total, estado, notas, created_by_name, created_at)
  select q.id, v_org, 'COT-'||lpad((row_number() over (order by q.created_at))::text,5,'0'), cl.id, coalesce(cl.nombre,'Consumidor final'), q.created_at::date,
      greatest(1, coalesce(q.valid_until - q.created_at::date, 15)), q.subtotal, q.itbis, 0, q.total,
      case q.status when 'expired' then 'vencida' when 'converted' then 'convertida' else 'vigente' end, 'Migrada del sistema anterior', 'Sistema anterior', q.created_at
  from legacy.quotes q left join public.pos_clientes cl on cl.id=q.customer_id on conflict (id) do nothing;
  insert into legacy._ids select 'pos_cotizaciones', id from legacy.quotes on conflict do nothing;
  insert into public.pos_cotizacion_items(id, organizacion_id, cotizacion_id, producto_id, nombre, precio, cantidad, itbis, descuento, importe)
  select l.id, v_org, l.quote_id, case when p.id is not null then l.product_id end, coalesce(l.description, p.nombre), l.unit_price, l.qty, true, 0, l.qty*l.unit_price
  from legacy.quote_lines l left join public.pos_productos p on p.id=l.product_id
  where exists (select 1 from public.pos_cotizaciones c where c.id=l.quote_id) on conflict (id) do nothing;
  insert into legacy._ids select 'pos_cotizacion_items', id from legacy.quote_lines on conflict do nothing;

  insert into public.pos_transferencias(id, organizacion_id, numero, fecha, origen_id, destino_id, origen_nombre, destino_nombre, notas, created_by_name, created_at)
  select t.id, v_org, coalesce(t.code, 'TR-'||left(t.id::text,8)), coalesce(t.received_at, t.created_at)::date, mo.alm, md.alm, mo.nombre, md.nombre,
      concat_ws(' · ', 'Sistema anterior', 'estado: '||t.status, nullif(t.notes,'')), coalesce(pr.full_name,'Sistema anterior'), t.created_at
  from legacy.stock_transfers t left join legacy.m_alm mo on mo.wh=t.from_warehouse_id left join legacy.m_alm md on md.wh=t.to_warehouse_id
  left join legacy.profiles pr on pr.id=t.requested_by
  where t.status='received' on conflict (id) do nothing;
  insert into legacy._ids select 'pos_transferencias', id from legacy.stock_transfers where status='received' on conflict do nothing;
  with ins as (
    insert into public.pos_transferencia_items(organizacion_id, transferencia_id, producto_id, nombre, cantidad)
    select v_org, l.transfer_id, l.product_id, coalesce(p.nombre, l.description), sum(coalesce(l.qty,1))
    from legacy.stock_transfer_lines l join public.pos_productos p on p.id=l.product_id
    where exists (select 1 from public.pos_transferencias t where t.id=l.transfer_id) group by 1,2,3,4
    returning id)
  insert into legacy._ids select 'pos_transferencia_items', id from ins;

  insert into public.pos_devoluciones(id, organizacion_id, venta_id, numero, fecha, cliente_id, cliente_nombre, motivo, subtotal, itbis, total, metodo, estado, created_by_name, created_at)
  select r.id, v_org, case when exists (select 1 from public.pos_ventas v where v.id=r.sale_id) then r.sale_id end,
      'NC-'||lpad((row_number() over (order by r.created_at))::text,5,'0'), r.created_at::date, cl.id, coalesce(cl.nombre,'Consumidor final'),
      concat_ws(' · ', nullif(r.reason,''), nullif(r.notes,''), 'Sistema anterior'), r.subtotal, r.itbis, r.total,
      case r.refund_method_code when 'cash' then 'Efectivo' when 'store_credit' then 'Nota de crédito' else r.refund_method_code end,
      case r.status when 'cancelled' then 'anulada' else 'emitida' end, coalesce(pr.full_name,'Sistema anterior'), r.created_at
  from legacy.sale_returns r left join legacy.sales s on s.id=r.sale_id left join public.pos_clientes cl on cl.id=s.customer_id
  left join legacy.profiles pr on pr.id=r.created_by on conflict (id) do nothing;
  insert into legacy._ids select 'pos_devoluciones', id from legacy.sale_returns on conflict do nothing;
  insert into public.pos_devolucion_items(id, organizacion_id, devolucion_id, producto_id, nombre, cantidad, precio, itbis, importe)
  select l.id, v_org, l.return_id, case when p.id is not null then l.product_id end, coalesce(l.description, p.nombre), l.qty, coalesce(l.refund_unit_price, l.unit_price), true, l.qty*coalesce(l.refund_unit_price, l.unit_price)
  from legacy.sale_return_lines l left join public.pos_productos p on p.id=l.product_id
  where exists (select 1 from public.pos_devoluciones d where d.id=l.return_id) on conflict (id) do nothing;
  insert into legacy._ids select 'pos_devolucion_items', id from legacy.sale_return_lines on conflict do nothing;

  -- 15) Secuencias y NCF ------------------------------------------------------------------
  perform setval('public.pos_venta_seq', (select max(numero) from public.pos_ventas where organizacion_id=v_org));
  update public.pos_secuencias s set proximo = greatest(s.proximo, x.n) from (
    select 'factura_contado' t, coalesce(max(num_tipo),0)+1 n from legacy.m_ventas where cred=0
    union all select 'factura_credito', coalesce(max(num_tipo),0)+1 from legacy.m_ventas where cred>0
    union all select 'recibo', (select count(*)+1 from legacy.m_abonos where cliente_id is not null and monto<>0)
    union all select 'cotizacion', (select count(*)+1 from legacy.quotes)
    union all select 'nota_credito', (select count(*)+1 from legacy.sale_returns)) x
  where s.organizacion_id=v_org and s.tipo=x.t;
  with ins as (
    insert into public.pos_ncf_secuencias(organizacion_id, tipo, descripcion, prefijo, desde, hasta, actual, activo)
    select v_org, x.tipo, x.descripcion, x.prefijo, 1, 99999999, x.actual, true
    from legacy.dgii_config d
    cross join lateral (values
      ('consumo', 'Consumo (B02) — continúa la numeración del sistema anterior', 'B02', d.b02_sequence::bigint),
      ('credito_fiscal', 'Crédito Fiscal (B01) — continúa la numeración del sistema anterior', 'B01', d.b01_sequence::bigint)) x(tipo, descripcion, prefijo, actual)
    where not exists (select 1 from public.pos_ncf_secuencias n where n.organizacion_id=v_org and n.tipo=x.tipo)
    returning id)
  insert into legacy._ids select 'pos_ncf_secuencias', id from ins;

  -- 16) Resumen ---------------------------------------------------------------------------
  select jsonb_object_agg(tabla, n) into v_res from (select tabla, count(*) n from legacy._ids group by 1) x;
  insert into legacy._log(paso, detalle) values ('migrar', v_res);
  return v_res;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════
create or replace function legacy.deshacer() returns jsonb language plpgsql as $$
declare v_org uuid := legacy.const('org'); v_res jsonb := '{}'::jsonb; t text; n bigint;
begin
  foreach t in array array['pos_devolucion_items','pos_devoluciones','pos_transferencia_items','pos_transferencias','pos_cotizacion_items','pos_cotizaciones',
      'pos_reparaciones','pos_banco_movimientos','pos_cuentas_bancarias','pos_caja_movimientos','pos_abonos','pos_venta_items','pos_ventas','pos_cajas',
      'pos_inv_movimientos','pos_stock_almacen','pos_seriales','pos_producto_niveles','pos_productos','pos_categorias','pos_clientes','pos_proveedores',
      'rrhh_empleados','pos_ncf_secuencias','pos_almacenes'] loop
    execute format('delete from public.%I x using legacy._ids i where i.tabla=%L and i.id=x.id', t, t);
    get diagnostics n = row_count;
    v_res := v_res || jsonb_build_object(t, n);
    delete from legacy._ids where tabla=t;
  end loop;
  delete from public.pos_asientos where organizacion_id=v_org and tipo='venta' and origen_id not in (select id from public.pos_ventas);
  update public.pos_almacenes set nombre='Almacén Principal' where id=legacy.const('alm_principal') and not exists (select 1 from legacy._ids);
  insert into legacy._log(paso, detalle) values ('deshacer', v_res);
  return v_res;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════
create or replace function legacy.reconciliar() returns jsonb language plpgsql as $$
declare v_org uuid := legacy.const('org'); v jsonb;
begin
  select jsonb_build_object(
    'clientes', jsonb_build_object('legacy', (select count(*) from legacy.customers), 'pos', (select count(*) from public.pos_clientes c where c.id in (select id from legacy.customers))),
    'productos', jsonb_build_object('legacy', (select count(*) from legacy.products), 'pos', (select count(*) from public.pos_productos p where p.id in (select id from legacy.products))),
    'ventas', jsonb_build_object('legacy', (select count(*) from legacy.sales), 'pos', (select count(*) from public.pos_ventas v where v.id in (select id from legacy.sales)),
        'total_legacy_completadas', (select round(sum(total)) from legacy.sales where status='completed'),
        'total_pos_completadas', (select round(sum(total)) from public.pos_ventas v where v.id in (select id from legacy.sales) and v.estado='completada')),
    'renglones', jsonb_build_object('legacy', (select count(*) from legacy.sale_lines), 'pos', (select count(*) from public.pos_venta_items i where i.id in (select id from legacy.sale_lines))),
    'pagos_cuadran', (select count(*) from public.pos_ventas v where v.organizacion_id=v_org and abs(v.pagado_efectivo+v.pagado_tarjeta+v.pagado_transferencia+v.pagado_otro+v.credito_monto - v.total) > 0.01),
    'cartera', jsonb_build_object(
        'legacy_balance', (select round(sum(balance)) from legacy.ar_invoices),
        'pos_balance', (select round(sum(v.credito_monto) - coalesce((select sum(a.monto) from public.pos_abonos a where a.organizacion_id=v_org),0)) from public.pos_ventas v where v.organizacion_id=v_org and v.estado<>'anulada'),
        'clientes_con_diferencia', (
          select count(*) from (
            select a.customer_id, sum(a.balance) legacy_bal,
              (select coalesce(sum(v.credito_monto),0) from public.pos_ventas v where v.cliente_id=a.customer_id and v.estado<>'anulada')
              - (select coalesce(sum(ab.monto),0) from public.pos_abonos ab where ab.cliente_id=a.customer_id) pos_bal
            from legacy.ar_invoices a group by 1) x where abs(x.legacy_bal - x.pos_bal) >= 1)),
    'stock', jsonb_build_object(
        'unidades_legacy', (select sum(qty) from legacy.stock_levels s join legacy.products p on p.id=s.product_id and not coalesce(p.tracks_serial,false))
                          + (select count(*) from legacy.imei_units u join legacy.products p on p.id=u.product_id and p.tracks_serial where u.status in ('available','in_transit')),
        'unidades_pos', (select sum(stock) from public.pos_stock_almacen where organizacion_id=v_org),
        'seriales_disponibles_legacy', (select count(*) from legacy.imei_units where status in ('available','in_transit')),
        'seriales_disponibles_pos', (select count(*) from public.pos_seriales where organizacion_id=v_org and estado='disponible')),
    'bancos', (select jsonb_agg(jsonb_build_object('cuenta', c.alias, 'legacy', l.s, 'pos', p.s)) from public.pos_cuentas_bancarias c
        left join (select cuenta_id, sum(balance) s from legacy.m_bancos group by 1) l on l.cuenta_id=c.id
        left join (select cuenta_bancaria_id, sum(monto) s from public.pos_banco_movimientos group by 1) p on p.cuenta_bancaria_id=c.id
        where c.id in (select cuenta_id from legacy.m_bancos)),
    'cajas', jsonb_build_object('legacy', (select count(*) from legacy.cash_sessions), 'pos', (select count(*) from public.pos_cajas c where c.id in (select id from legacy.cash_sessions))),
    'ncf_duplicados', (select count(*) from (select ncf from public.pos_ventas where organizacion_id=v_org and ncf is not null group by 1 having count(*)>1) x)
  ) into v;
  insert into legacy._log(paso, detalle) values ('reconciliar', v);
  return v;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- Usuarios: p_usuarios = [{"empleado_id":"uuid","login":"winifer","clave":"...","rol":"gerente","almacen_id":"uuid|null"}, ...]
-- La clave temporal se entrega solo al dueño; must_change_password obliga a cambiarla al entrar.
create or replace function legacy.crear_usuarios(p_usuarios jsonb) returns jsonb language plpgsql as $$
declare v_org uuid := legacy.const('org'); u jsonb; v_us uuid; v_uid uuid; v_nom text; v_email text; v_res jsonb := '[]'::jsonb;
begin
  for u in select * from jsonb_array_elements(p_usuarios) loop
    select nombre into v_nom from public.rrhh_empleados where id=(u->>'empleado_id')::uuid;
    if v_nom is null then v_nom := u->>'nombre'; end if;
    v_email := (u->>'login')||'@nexus-pro.local';
    if exists (select 1 from auth.users where email=v_email) or exists (select 1 from public.usuarios_sistema where login=u->>'login') then
      v_res := v_res || jsonb_build_object('login', u->>'login', 'estado', 'ya_existe'); continue;
    end if;
    v_us := gen_random_uuid(); v_uid := gen_random_uuid();
    insert into public.usuarios_sistema(id, nom, cargo, login, rol, activo, organizacion_id, es_superadmin, almacen_id, creado_por)
    values (v_us, v_nom, u->>'cargo', u->>'login', u->>'rol', true, v_org, false, nullif(u->>'almacen_id','')::uuid, 'migracion');
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
        created_at, updated_at, confirmation_token, recovery_token, email_change, email_change_token_new, email_change_token_current, is_sso_user)
    values ('00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated', v_email,
        extensions.crypt(u->>'clave', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
        now(), now(), '', '', '', '', '', false);
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), v_uid, v_uid::text, jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true), 'email', now(), now(), now());
    insert into public.profiles (id, usuario_sistema_id, login, nom, rol, activo, must_change_password)
    values (v_uid, v_us, u->>'login', v_nom, u->>'rol', true, true);
    update public.rrhh_empleados set entidad_id = null where id=(u->>'empleado_id')::uuid;
    insert into legacy._ids values ('usuarios_sistema', v_us), ('auth_users', v_uid) on conflict do nothing;
    v_res := v_res || jsonb_build_object('login', u->>'login', 'usuario_sistema_id', v_us, 'auth_id', v_uid);
  end loop;
  insert into legacy._log(paso, detalle) values ('crear_usuarios', v_res);
  return v_res;
end $$;
