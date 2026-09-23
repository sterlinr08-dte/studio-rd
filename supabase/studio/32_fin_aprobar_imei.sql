-- 32 · Financiamiento: al aprobar una solicitud, los IMEI elegidos quedan VENDIDOS (24-sep-2026).
-- Pedido del dueño («Si» a corregir el IMEI al aprobar). Antes el IMEI viajaba solo como texto en el renglón:
-- pos_seriales seguía «disponible» y pos_aplicar_inventario_venta (que en artículos con IMEI descuenta según los
-- seriales vendidos) no rebajaba ese teléfono. Ahora la aprobación reserva los IMEI de la solicitud con un token y
-- se los pasa a pos_registrar_venta_atomica, que los confirma como vendidos con la venta (mismo camino que Factura).
-- Reglas: en artículos con IMEI, cantidad = número de IMEI; cada IMEI debe existir y estar disponible.
-- Todo en la misma transacción: si algo falla, nada queda reservado ni vendido.
CREATE OR REPLACE FUNCTION public.pos_fin_aprobar_solicitud(p_solicitud_id uuid, p_nota text DEFAULT NULL::text, p_operacion_id uuid DEFAULT NULL::uuid, p_caja_id uuid DEFAULT NULL::uuid, p_almacen_id uuid DEFAULT NULL::uuid)
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

  v_res := public.pos_registrar_venta_atomica(coalesce(p_operacion_id, gen_random_uuid()), v_venta, v_items, v_token, v_imei_pedidos);
  v_venta_id := (v_res->'venta'->>'id')::uuid;
  if v_venta_id is null then raise exception 'FIN_VENTA_NO_CREADA'; end if;

  v_fin := public.pos_fin_crear_financiamiento_v2(v_venta_id, pl.id, s.primera_fecha, s.id, null);

  -- Asiento de la venta a crédito en el servidor (el navegador no participa en este flujo).
  perform public.pos_reconstruir_asiento_venta(v_venta_id);

  perform set_config('nx.fin_aprobando','1',true);
  update public.pos_fin_solicitudes set estado='aprobada', nota_aprobador=nullif(trim(p_nota),''), decidido_por=auth.uid(), decidido_en=now(), venta_id=v_venta_id, financiamiento_id=v_fin
  where id=s.id;
  perform set_config('nx.fin_aprobando','0',true);

  insert into public.pos_credito_eventos(organizacion_id,cliente_id,venta_id,financiamiento_id,tipo,monto,nota,creado_por)
  values(v_org,s.cliente_id,v_venta_id,v_fin,'aprobacion',v_capital,'Solicitud '||coalesce(s.codigo,'')||' aprobada · plan '||pl.nombre,auth.uid());

  return jsonb_build_object('ok',true,'reutilizada',false,'venta_id',v_venta_id,'financiamiento_id',v_fin,'numero_factura',v_num,
    'codigo',(select codigo from public.pos_financiamientos where id=v_fin));
end $function$;
