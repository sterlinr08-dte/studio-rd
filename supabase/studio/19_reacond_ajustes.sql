-- STUDIO · 19 · Reacondicionado: ajustes tras la publicación 58.94 (2026-09-22)
-- 1) Al despachar un equipo cuyo IMEI NO existía en pos_seriales (equipo agregado a mano con un artículo con
--    IMEI), la entrada al inventario (kardex 'taller') lleva ahora el COSTO FINAL del taller
--    (compra + parte proporcional del envío del lote + piezas), igual que una compra fija el último costo
--    del artículo con pos_mover_stock_atomico(p_costo). Antes entraba con el costo del artículo.
--    Si el IMEI ya existía (apartado por el taller o vuelto de una venta) el costo del artículo no cambia.
-- Mismo contrato: pos_reacond_despachar(p_equipo_id, p_almacen_id, p_usuario) -> jsonb.

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
  v_base_lote numeric;
  v_flete numeric := 0;
  v_piezas numeric := 0;
  v_costo_final numeric;
begin
  if v_org is null or public.mi_rol() is null then raise exception 'REACOND_SIN_PERMISO'; end if;
  select * into v_eq from public.pos_reacond_equipos where id = p_equipo_id and organizacion_id = v_org for update;
  if v_eq.id is null then raise exception 'REACOND_EQUIPO_INVALIDO'; end if;
  if v_eq.estado_evaluacion <> 'listo_venta' then raise exception 'REACOND_ESTADO_INVALIDO: el equipo debe estar Listo para venta'; end if;
  select * into v_lote from public.pos_reacond_lotes where id = v_eq.lote_id;
  v_alm := coalesce(p_almacen_id, (select id from public.pos_almacenes where organizacion_id = v_org and activo order by es_principal desc, created_at limit 1));
  v_imei := nullif(trim(coalesce(v_eq.imei, v_eq.serial, '')), '');

  -- costo final = compra + envío proporcional (por costo de compra dentro del lote) + piezas
  if coalesce(v_lote.gastos_envio, 0) > 0 then
    select coalesce(sum(costo_compra), 0), count(*) into v_base_lote, v_piezas from public.pos_reacond_equipos where lote_id = v_lote.id;
    if v_base_lote > 0 then v_flete := v_lote.gastos_envio * (coalesce(v_eq.costo_compra, 0) / v_base_lote);
    elsif v_piezas > 0 then v_flete := v_lote.gastos_envio / v_piezas; end if;
  end if;
  select coalesce(sum((cantidad) * costo_unitario), 0) into v_piezas from public.pos_reacond_piezas
    where equipo_id = p_equipo_id and estado not in ('rechazada', 'devuelta');
  v_costo_final := round(coalesce(v_eq.costo_compra, 0) + coalesce(v_flete, 0) + coalesce(v_piezas, 0), 2);

  if v_eq.producto_id is not null then
    select * into v_prod from public.pos_productos where id = v_eq.producto_id and organizacion_id = v_org;
    if v_prod.id is not null and coalesce(v_prod.serial, false) and v_imei is not null then
      select * into v_ser from public.pos_seriales
        where organizacion_id = v_org and producto_id = v_prod.id and upper(trim(serial)) = upper(v_imei)
        order by created_at desc limit 1 for update;
      if v_ser.id is null then
        insert into public.pos_seriales (organizacion_id, producto_id, serial, estado, almacen_id, color, notas)
          values (v_org, v_prod.id, v_imei, 'disponible', v_alm, nullif(v_eq.color,''),
                  'Reacondicionado · lote ' || coalesce(v_lote.codigo_lote, '') || ' · costo final ' || v_costo_final::text)
          returning * into v_ser;
        perform public.pos_mover_stock_atomico(v_prod.id, 'taller', 1, v_alm,
          'REACOND ' || coalesce(v_lote.codigo_lote, ''), 'Salida de taller (reacondicionado) IMEI ' || v_imei || ' · costo final ' || v_costo_final::text,
          case when v_costo_final > 0 then v_costo_final else null end);
        v_accion := 'creado';
      elsif v_ser.estado = 'disponible' then
        v_accion := 'ya_disponible';
      else
        update public.pos_seriales set estado = 'disponible', venta_id = null, reserva_token = null, reserva_hasta = null,
          almacen_id = coalesce(almacen_id, v_alm),
          notas = left(coalesce(notas, '') || ' · Reacondicionado ' || coalesce(v_lote.codigo_lote, '') || ' · costo final ' || v_costo_final::text, 500)
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
     set estado_evaluacion = 'vendido', fecha_despacho = now(), completado = false, fecha_completado = null,
         costo_repuestos = coalesce(v_piezas, costo_repuestos)
   where id = v_eq.id;
  insert into public.pos_reacond_historial (organizacion_id, equipo_id, estado_anterior, estado_nuevo, accion, notas, usuario)
    values (v_org, v_eq.id, v_eq.estado_evaluacion, 'vendido', 'Salida registrada → Despachado', 'Costo final ' || v_costo_final::text, coalesce(p_usuario, 'Admin'));
  return jsonb_build_object('ok', true, 'serial', v_accion, 'costo_final', v_costo_final, 'piezas', v_pz);
end $$;

revoke execute on function public.pos_reacond_despachar(uuid, uuid, text) from public, anon;
grant execute on function public.pos_reacond_despachar(uuid, uuid, text) to authenticated, service_role;
