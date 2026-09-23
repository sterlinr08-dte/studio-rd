-- STUDIO · 23 · Tipo fiscal de la compra: con ITBIS (formal, crédito fiscal) o informal (2026-09-23)
-- Pedido del dueño: «Hay que determinar si en la compra fue con ITBIS o informal».
--
-- Regla:
--  * formal   → compra con comprobante fiscal (NCF B01/E31…). El ITBIS pagado es CRÉDITO FISCAL (cuenta 1105):
--               NO forma parte del costo del artículo. costo = base (+ gastos); costo_itbis = ITBIS por unidad.
--  * informal → sin comprobante válido para crédito fiscal. Si se pagó ITBIS, NO se recupera: se suma al costo.
--               costo = lo pagado (+ gastos + ITBIS); costo_itbis = 0.
-- Así pos_productos.costo es siempre el COSTO REAL del negocio, y pos_productos.costo_itbis guarda el ITBIS
-- recuperable por unidad (solo compras formales). La venta guarda ambos (snapshot) para los reportes.
-- Aditivo: columnas nuevas con default; compras viejas no existen en STUDIO (0 registros al aplicar).

alter table public.pos_compras add column if not exists tipo_fiscal text not null default 'informal';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'pos_compras_tipo_fiscal_chk') then
    alter table public.pos_compras add constraint pos_compras_tipo_fiscal_chk check (tipo_fiscal in ('formal', 'informal'));
  end if;
end $$;
alter table public.pos_compra_items add column if not exists itbis_unit numeric not null default 0;
alter table public.pos_productos add column if not exists costo_itbis numeric not null default 0;
alter table public.pos_venta_items add column if not exists costo_itbis_unit numeric;

comment on column public.pos_compras.tipo_fiscal is 'formal = con NCF, ITBIS es crédito fiscal (1105); informal = ITBIS no recuperable, se suma al costo';
comment on column public.pos_compra_items.itbis_unit is 'ITBIS por unidad prorrateado por valor. En formal es crédito fiscal; en informal ya va dentro de costo_final_unit';
comment on column public.pos_productos.costo_itbis is 'ITBIS recuperable por unidad del último costo de compra (solo compras formales). costo NO lo incluye';
comment on column public.pos_venta_items.costo_itbis_unit is 'Snapshot de pos_productos.costo_itbis al vender';

-- Snapshot del costo en la venta: ahora también el ITBIS recuperable del costo.
create or replace function public.pos_snapshot_costo_venta_item()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.organizacion_id <> 'e404d1c4-24c5-4e17-88f6-84bef09d6d19'::uuid then return new; end if;
  if tg_op='INSERT' or new.producto_id is distinct from old.producto_id or new.costo_unitario is null then
    select coalesce(p.costo,0), coalesce(p.costo_itbis,0) into new.costo_unitario, new.costo_itbis_unit
    from public.pos_productos p
    where p.id=new.producto_id and p.organizacion_id=new.organizacion_id;
    new.costo_unitario := coalesce(new.costo_unitario,0);
    new.costo_itbis_unit := coalesce(new.costo_itbis_unit,0);
  end if;
  return new;
end;
$function$;

create or replace function public.pos_registrar_compra_atomica(p_operacion_id uuid, p_compra jsonb, p_items jsonb)
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  v_org uuid := public.mi_organizacion();
  v_compra public.pos_compras%rowtype;
  v_usuario text;
  v_item record;
  v_subtotal numeric;
  v_itbis numeric := 0;
  v_total_prov numeric;
  v_imp boolean := false;
  v_moneda text := 'DOP';
  v_tasa numeric := 1;
  v_gastos jsonb := null;
  v_flete numeric := 0;
  v_imp_modo text := 'monto';
  v_imp_valor numeric := 0;
  v_impuesto numeric := 0;
  v_otros numeric := 0;
  v_gastos_total numeric := 0;
  v_n_items integer;
  v_seriales integer;
  v_tipo text;
  v_ncf text;
begin
  if v_org is null or public.mi_rol() is null then raise exception 'COMPRA_SIN_PERMISO'; end if;
  if p_operacion_id is null then raise exception 'COMPRA_OPERACION_REQUERIDA'; end if;
  if jsonb_typeof(p_compra)<>'object' or jsonb_typeof(p_items)<>'array'
     or jsonb_array_length(p_items)<1 or jsonb_array_length(p_items)>200 then
    raise exception 'COMPRA_DATOS_INVALIDOS';
  end if;

  select * into v_compra from public.pos_compras
  where organizacion_id=v_org and operacion_id=p_operacion_id;
  if v_compra.id is not null then
    return jsonb_build_object('ok',true,'reutilizada',true,'compra',to_jsonb(v_compra));
  end if;

  if nullif(p_compra->>'almacen_id','') is null and exists(
    select 1 from public.pos_almacenes where organizacion_id=v_org and activo
  ) then raise exception 'COMPRA_ALMACEN_REQUERIDO'; end if;
  if nullif(p_compra->>'almacen_id','') is not null and not exists(
    select 1 from public.pos_almacenes where id=(p_compra->>'almacen_id')::uuid and organizacion_id=v_org and activo
  ) then raise exception 'COMPRA_ALMACEN_INVALIDO'; end if;
  if coalesce((p_compra->>'a_credito')::boolean,false)
     and nullif(p_compra->>'proveedor_id','') is null then
    raise exception 'COMPRA_CREDITO_SIN_PROVEEDOR';
  end if;

  if exists(
    select 1
    from jsonb_to_recordset(p_items) x(producto_id uuid,cantidad numeric,costo numeric,importe numeric,imeis jsonb)
    left join public.pos_productos p on p.id=x.producto_id and p.organizacion_id=v_org and p.activo and p.tipo<>'servicio'
    where p.id is null or x.cantidad<=0 or x.costo<0 or x.importe<0
       or abs(x.importe-(x.cantidad*x.costo))>0.01
       or (p.serial and (jsonb_typeof(coalesce(x.imeis,'[]'::jsonb))<>'array'
           or jsonb_array_length(coalesce(x.imeis,'[]'::jsonb))<>x.cantidad))
       or (not p.serial and jsonb_array_length(coalesce(x.imeis,'[]'::jsonb))>0)
  ) then raise exception 'COMPRA_ITEM_INVALIDO'; end if;

  select coalesce(sum(x.importe),0), count(*) into v_subtotal, v_n_items
  from jsonb_to_recordset(p_items) x(importe numeric);

  v_itbis := greatest(0, coalesce((p_compra->>'itbis')::numeric,0));
  v_imp := coalesce((p_compra->>'es_importacion')::boolean,false);
  v_moneda := coalesce(nullif(upper(left(p_compra->>'moneda',3)),''),'DOP');
  v_tasa := coalesce(nullif((p_compra->>'tasa')::numeric,0),1);
  if v_tasa <= 0 then raise exception 'COMPRA_TASA_INVALIDA'; end if;

  -- Tipo fiscal. Si un cliente viejo no lo manda: con NCF = formal, sin NCF = informal.
  v_ncf := nullif(trim(left(p_compra->>'ncf',100)),'');
  v_tipo := lower(coalesce(nullif(p_compra->>'tipo_fiscal',''), case when v_ncf is not null then 'formal' else 'informal' end));
  if v_tipo not in ('formal','informal') then raise exception 'COMPRA_TIPO_FISCAL_INVALIDO'; end if;
  if v_tipo='formal' and v_ncf is null then raise exception 'COMPRA_FORMAL_SIN_NCF'; end if;

  if jsonb_typeof(p_compra->'gastos')='object' then
    v_gastos := p_compra->'gastos';
    v_flete := greatest(0, coalesce((v_gastos->>'flete')::numeric,0));
    v_imp_modo := case when lower(coalesce(v_gastos->>'impuesto_modo','monto'))='pct' then 'pct' else 'monto' end;
    v_imp_valor := greatest(0, coalesce((v_gastos->>'impuesto_valor')::numeric,0));
    v_impuesto := case when v_imp_modo='pct' then round(v_subtotal*v_imp_valor/100.0,2) else v_imp_valor end;
    select coalesce(sum(greatest(0, coalesce((o->>'monto')::numeric,0))),0) into v_otros
    from jsonb_array_elements(coalesce(v_gastos->'otros','[]'::jsonb)) o;
    v_gastos_total := round(v_flete + v_impuesto + v_otros, 2);
    v_gastos := v_gastos || jsonb_build_object('impuesto_calculado', v_impuesto, 'total', v_gastos_total);
  end if;

  v_total_prov := round(v_subtotal + (case when v_imp then 0 else v_itbis end), 2);
  if abs(v_total_prov-coalesce((p_compra->>'total')::numeric,0))>0.01 then
    raise exception 'COMPRA_TOTAL_NO_CUADRA';
  end if;

  select count(*) into v_seriales
  from jsonb_array_elements(p_items) e(item)
  cross join lateral jsonb_array_elements_text(coalesce(e.item->'imeis','[]'::jsonb)) s(serial);
  if exists(
    select 1 from (
      select lower(trim(s.serial)) serial, count(*) n
      from jsonb_array_elements(p_items) e(item)
      cross join lateral jsonb_array_elements_text(coalesce(e.item->'imeis','[]'::jsonb)) s(serial)
      group by lower(trim(s.serial)) having count(*)>1 or lower(trim(s.serial))=''
    ) d
  ) or exists(
    select 1 from public.pos_seriales ps
    where ps.organizacion_id=v_org and lower(ps.serial) in (
      select lower(trim(s.serial))
      from jsonb_array_elements(p_items) e(item)
      cross join lateral jsonb_array_elements_text(coalesce(e.item->'imeis','[]'::jsonb)) s(serial)
    )
  ) then raise exception 'COMPRA_IMEI_DUPLICADO'; end if;

  select us.nom into v_usuario
  from public.profiles pr join public.usuarios_sistema us on us.id=pr.usuario_sistema_id
  where pr.id=auth.uid() limit 1;

  insert into public.pos_compras(
    fecha,proveedor_id,proveedor_nombre,ncf,subtotal,itbis,total,a_credito,estado,
    notas,created_by_name,organizacion_id,almacen_id,empleado_id,empleado_nombre,
    vencimiento,orden_no,liquidacion_no,operacion_id,
    moneda,tasa,es_importacion,gastos,gastos_total,total_desembarcado,tipo_fiscal
  ) values (
    coalesce(nullif(p_compra->>'fecha','')::date,current_date),
    nullif(p_compra->>'proveedor_id','')::uuid,nullif(left(p_compra->>'proveedor_nombre',200),''),
    v_ncf,v_subtotal,v_itbis,v_total_prov,
    coalesce((p_compra->>'a_credito')::boolean,false),'recibida',
    nullif(left(p_compra->>'notas',1000),''),coalesce(v_usuario,'Sistema'),v_org,
    nullif(p_compra->>'almacen_id','')::uuid,nullif(p_compra->>'empleado_id','')::uuid,
    nullif(left(p_compra->>'empleado_nombre',200),''),nullif(p_compra->>'vencimiento','')::date,
    nullif(left(p_compra->>'orden_no',100),''),nullif(left(p_compra->>'liquidacion_no',100),''),
    p_operacion_id,
    v_moneda,v_tasa,v_imp,v_gastos,v_gastos_total,
    -- informal: el ITBIS no se recupera y entra al inventario como costo
    round(v_subtotal + v_gastos_total + (case when v_tipo='informal' then v_itbis else 0 end),2),
    v_tipo
  ) returning * into v_compra;

  -- ITBIS y gastos se prorratean por VALOR de cada línea.
  insert into public.pos_compra_items(compra_id,producto_id,nombre,cantidad,costo,importe,organizacion_id,
                                      costo_original,gasto_unit,costo_final_unit,itbis_unit)
  select v_compra.id,(e.item->>'producto_id')::uuid,left(e.item->>'nombre',300),
         (e.item->>'cantidad')::numeric,(e.item->>'costo')::numeric,(e.item->>'importe')::numeric,v_org,
         nullif(e.item->>'costo_original','')::numeric,
         g.gasto_unit,
         round((e.item->>'costo')::numeric + g.gasto_unit + (case when v_tipo='informal' then g.itbis_unit else 0 end), 4),
         g.itbis_unit
  from jsonb_array_elements(p_items) e(item)
  cross join lateral (
    select case when v_gastos_total<=0 then 0
                when v_subtotal>0 then round(v_gastos_total * ((e.item->>'importe')::numeric / v_subtotal) / (e.item->>'cantidad')::numeric, 4)
                else round(v_gastos_total / v_n_items / (e.item->>'cantidad')::numeric, 4) end as gasto_unit,
           case when v_itbis<=0 then 0
                when v_subtotal>0 then round(v_itbis * ((e.item->>'importe')::numeric / v_subtotal) / (e.item->>'cantidad')::numeric, 4)
                else round(v_itbis / v_n_items / (e.item->>'cantidad')::numeric, 4) end as itbis_unit
  ) g;

  for v_item in
    select src.producto_id, src.cantidad, c.costo_final_unit, c.itbis_unit, src.imeis
    from (
      select (e.item->>'producto_id')::uuid producto_id,(e.item->>'cantidad')::numeric cantidad,
             e.item->'imeis' imeis, e.ord
      from jsonb_array_elements(p_items) with ordinality e(item, ord)
    ) src
    join lateral (
      select ci.costo_final_unit, ci.itbis_unit from public.pos_compra_items ci
      where ci.compra_id=v_compra.id and ci.producto_id=src.producto_id limit 1
    ) c on true
    order by src.ord
  loop
    perform public.pos_mover_stock_atomico(v_item.producto_id,'compra',v_item.cantidad,
      v_compra.almacen_id,v_compra.numero::text,'Compra',coalesce(v_item.costo_final_unit,0));
    update public.pos_productos
       set costo_itbis = case when v_tipo='formal' then coalesce(v_item.itbis_unit,0) else 0 end
     where id=v_item.producto_id and organizacion_id=v_org;
    insert into public.pos_seriales(organizacion_id,producto_id,serial,estado,almacen_id,compra_id,notas)
    select v_org,v_item.producto_id,trim(s.serial),'disponible',v_compra.almacen_id,v_compra.id,
           'Compra '||v_compra.numero::text
    from jsonb_array_elements_text(coalesce(v_item.imeis,'[]'::jsonb)) s(serial);
  end loop;

  return jsonb_build_object('ok',true,'reutilizada',false,'compra',to_jsonb(v_compra),
    'items',jsonb_array_length(p_items),'seriales',v_seriales,'tipo_fiscal',v_tipo,
    'gastos_total',v_gastos_total,'total_desembarcado',v_compra.total_desembarcado);
end;
$function$;

-- Asiento de compra: el ITBIS va a 1105 (crédito fiscal) SOLO si la compra es formal.
-- En la informal se suma al inventario (1104), porque no se puede recuperar.
create or replace function public.pos_reconstruir_asiento_compra(p_compra_id uuid)
returns uuid
language plpgsql
set search_path to 'public'
as $function$
declare
  v public.pos_compras%rowtype;
  v_aid uuid;
  v_total_items numeric:=0;
  v_gastos numeric:=0;
  v_itbis numeric:=0;
  v_itbis_cf numeric:=0;
  v_itbis_costo numeric:=0;
  v_conciliar numeric:=0;
begin
  select * into v from public.pos_compras where id=p_compra_id;
  if v.id is null then
    delete from public.pos_asientos where tipo='compra' and origen_id=p_compra_id;
    return null;
  end if;
  if v.organizacion_id <> 'e404d1c4-24c5-4e17-88f6-84bef09d6d19'::uuid then return null; end if;
  delete from public.pos_asientos where organizacion_id=v.organizacion_id and tipo='compra' and origen_id=v.id;
  if v.estado<>'recibida' then return null; end if;
  select coalesce(sum(importe),0) into v_total_items from public.pos_compra_items where compra_id=v.id;
  if v_total_items<=0 then return null; end if;
  if abs(v_total_items-coalesce(v.subtotal,v.total))>0.01 then raise exception 'ASIENTO_COMPRA_TOTAL_NO_CUADRA compra=%',v.id; end if;
  perform public.pos_asegurar_cuentas_operativas(v.organizacion_id);
  v_gastos := coalesce(v.gastos_total,0);
  v_itbis := coalesce(v.itbis,0);
  if coalesce(v.tipo_fiscal,'formal')='formal' then v_itbis_cf := v_itbis; else v_itbis_costo := v_itbis; end if;
  v_conciliar := v_gastos + (case when v.es_importacion then v_itbis else 0 end);

  insert into public.pos_asientos(organizacion_id,fecha,concepto,referencia,tipo,origen_id,numero)
  values(v.organizacion_id,v.fecha,'Compra '||v.numero::text||case when v.tipo_fiscal='informal' then ' (informal)' else '' end,
         v.numero::text,'compra',v.id,'C-'||v.numero::text)
  returning id into v_aid;

  insert into public.pos_asiento_lineas(organizacion_id,asiento_id,cuenta_id,cuenta_codigo,cuenta_nombre,descripcion,debito,credito)
  select v.organizacion_id,v_aid,id,codigo,nombre,
         case when v_itbis_costo>0 then 'Entrada de inventario (ITBIS no recuperable incluido)'
              when v_gastos>0 then 'Entrada de inventario (costo desembarcado)' else 'Entrada de inventario' end,
         v_total_items + v_gastos + v_itbis_costo,0
  from public.pos_cuentas where organizacion_id=v.organizacion_id and codigo='1104';
  if v_itbis_cf>0 then
    insert into public.pos_asiento_lineas(organizacion_id,asiento_id,cuenta_id,cuenta_codigo,cuenta_nombre,descripcion,debito,credito)
    select v.organizacion_id,v_aid,id,codigo,nombre,'ITBIS pagado en compra (crédito fiscal)',v_itbis_cf,0
    from public.pos_cuentas where organizacion_id=v.organizacion_id and codigo='1105';
  end if;
  if v.a_credito then
    insert into public.pos_asiento_lineas(organizacion_id,asiento_id,cuenta_id,cuenta_codigo,cuenta_nombre,descripcion,debito,credito)
    select v.organizacion_id,v_aid,id,codigo,nombre,'Compra a crédito',0,v.total
    from public.pos_cuentas where organizacion_id=v.organizacion_id and codigo='2101';
  else
    insert into public.pos_asiento_lineas(organizacion_id,asiento_id,cuenta_id,cuenta_codigo,cuenta_nombre,descripcion,debito,credito)
    select v.organizacion_id,v_aid,id,codigo,nombre,'Compra de contado por conciliar',0,v.total
    from public.pos_cuentas where organizacion_id=v.organizacion_id and codigo='2199';
  end if;
  if v_conciliar>0 then
    insert into public.pos_asiento_lineas(organizacion_id,asiento_id,cuenta_id,cuenta_codigo,cuenta_nombre,descripcion,debito,credito)
    select v.organizacion_id,v_aid,id,codigo,nombre,'Gastos de importación / ITBIS aduana por conciliar',0,v_conciliar
    from public.pos_cuentas where organizacion_id=v.organizacion_id and codigo='2199';
  end if;
  return v_aid;
end;
$function$;
