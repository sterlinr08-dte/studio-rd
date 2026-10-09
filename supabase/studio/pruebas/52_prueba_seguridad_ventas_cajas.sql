-- Prueba de la migración 52 (candados de facturas y cajas). NO CORRIDA TODAVÍA (08-oct-2026).
-- Cómo se corre (una sola ejecución, en la base real):
--   begin;  + el cuerpo de supabase/studio/52_seguridad_ventas_cajas.sql  + este archivo.
-- Termina en raise exception a propósito: TODO se deshace (migración incluida) y no queda nada.
-- Roles reales de STUDIO simulados con request.jwt.claims: cajera ERIKA REYES y ADMINISTRADOR STUDIO.
-- El caso «gerente» sube a ERIKA a gerente solo dentro de esta transacción (se deshace con todo lo demás).
set local lock_timeout = '5s'; set local statement_timeout = '50s';
create temp table t_res (n serial, rol text, caso text, ok boolean, detalle text) on commit drop;
grant all on t_res to authenticated; grant usage on sequence t_res_n_seq to authenticated;

-- ── Preparación (como servicio) ──
do $$
declare v_org uuid := 'e404d1c4-24c5-4e17-88f6-84bef09d6d19'; v_alm uuid := '83e35d4c-d3ff-484f-98fb-fafdf63735af';
  v_prod uuid; v_va uuid; v_vb uuid; v_vc uuid; v_caja uuid; v_mov uuid; v_nueva boolean := true;
begin
  insert into pos_productos (organizacion_id, nombre, precio, tipo, itbis) values (v_org, 'ZZ PRUEBA SEGURIDAD 52', 1000, 'servicio', false)
    returning id into v_prod;
  insert into pos_ventas (organizacion_id, cliente_nombre, subtotal, itbis, total, estado, almacen_id, metodo_pago, pagado_transferencia)
    values (v_org, 'ZZ PRUEBA 52 A', 1000, 0, 1000, 'completada', v_alm, 'Transferencia', 1000) returning id into v_va;
  insert into pos_venta_items (organizacion_id, venta_id, producto_id, nombre, precio, cantidad, importe)
    values (v_org, v_va, v_prod, 'ZZ', 1000, 1, 1000);
  insert into pos_ventas (organizacion_id, cliente_nombre, subtotal, itbis, total, estado, almacen_id, metodo_pago, pagado_transferencia)
    values (v_org, 'ZZ PRUEBA 52 B', 500, 0, 500, 'completada', v_alm, 'Transferencia', 500) returning id into v_vb;
  insert into pos_ventas (organizacion_id, cliente_nombre, subtotal, itbis, total, estado, almacen_id, metodo_pago, pagado_transferencia)
    values (v_org, 'ZZ PRUEBA 52 C', 300, 0, 300, 'completada', v_alm, 'Transferencia', 300) returning id into v_vc;

  -- Caja CERRADA con un movimiento: se abre y se cierra con la sesión del administrador (los disparadores de caja
  -- ponen dueño y estado). Si el admin ya tiene una caja abierta, se toma una caja cerrada que ya exista (solo se
  -- intenta borrarla como cajera; todo se deshace al final).
  perform set_config('request.jwt.claims', '{"sub":"25bea4e1-2241-4480-a52e-447dad70c191","role":"authenticated"}', true);
  begin
    insert into pos_cajas (monto_inicial) values (0) returning id into v_caja;
    insert into pos_caja_movimientos (caja_id, tipo, concepto, monto) values (v_caja, 'entrada', 'ZZ prueba 52', 1) returning id into v_mov;
    perform set_config('nx.caja_cierre_rpc', '1', true);
    update pos_cajas set estado = 'cerrada', cierre = now() where id = v_caja;
    perform set_config('nx.caja_cierre_rpc', '', true);
  exception when unique_violation then
    v_nueva := false;
    select c.id, m.id into v_caja, v_mov from pos_cajas c left join pos_caja_movimientos m on m.caja_id = c.id
     where c.organizacion_id = v_org and c.estado = 'cerrada' order by (m.id is null), c.apertura desc limit 1;
  end;
  perform set_config('request.jwt.claims', '', true);

  perform set_config('t.prod', v_prod::text, false); perform set_config('t.va', v_va::text, false);
  perform set_config('t.vb', v_vb::text, false);     perform set_config('t.vc', v_vc::text, false);
  perform set_config('t.caja', coalesce(v_caja::text, ''), false); perform set_config('t.mov', coalesce(v_mov::text, ''), false);
  perform set_config('t.caja_nueva', v_nueva::text, false);
end $$;

-- ── CAJERA ERIKA ──
select set_config('request.jwt.claims', '{"sub":"9b5d1b70-5347-4df8-a11b-ac8a65211b47","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v_alm uuid := '83e35d4c-d3ff-484f-98fb-fafdf63735af'; v_va uuid := current_setting('t.va')::uuid;
  v_caja uuid := nullif(current_setting('t.caja'), '')::uuid; v_movc uuid := nullif(current_setting('t.mov'), '')::uuid;
  v_j jsonb; v_vn uuid; v_mia uuid; v_mov uuid; v_ncf text := 'ZZ52-' || substr(gen_random_uuid()::text, 1, 8);
begin
  insert into t_res values (default, 'cajera', '0. La sesión es de cajera', mi_rol() = 'cajero', 'rol ' || coalesce(mi_rol(), '—'));
  -- 1. Vender sigue funcionando (misma RPC que usa la pantalla)
  begin
    v_j := pos_registrar_venta_atomica(gen_random_uuid(),
      jsonb_build_object('cliente_nombre', 'ZZ PRUEBA 52 CAJERA', 'subtotal', 1000, 'itbis', 0, 'total', 1000, 'descuento', 0,
                         'metodo_pago', 'Transferencia', 'pagado_transferencia', 1000, 'almacen_id', v_alm, 'pagos', '[]'::jsonb),
      jsonb_build_array(jsonb_build_object('producto_id', current_setting('t.prod'), 'nombre', 'ZZ', 'precio', 1000, 'cantidad', 1, 'importe', 1000, 'itbis', false)),
      null, 0);
    v_vn := (v_j->'venta'->>'id')::uuid;
    insert into t_res values (default, 'cajera', '1. Crear una venta (pos_registrar_venta_atomica)',
      (v_j->>'ok')::boolean and exists (select 1 from pos_ventas where id = v_vn and estado = 'completada' and inventario_aplicado),
      'venta ' || coalesce(v_j->'venta'->>'numero', '—'));
  exception when others then insert into t_res values (default, 'cajera', '1. Crear una venta', false, sqlerrm); end;
  -- 2. Poner el NCF la primera vez (lo hace la pantalla justo después de vender)
  begin
    update pos_ventas set ncf = v_ncf where id = v_vn;
    insert into t_res values (default, 'cajera', '2. Poner el NCF a su venta nueva', (select ncf from pos_ventas where id = v_vn) = v_ncf, v_ncf);
  exception when others then insert into t_res values (default, 'cajera', '2. Poner el NCF a su venta nueva', false, sqlerrm); end;
  -- 3. Cambiar un NCF ya puesto
  begin update pos_ventas set ncf = v_ncf || 'X' where id = v_vn; insert into t_res values (default, 'cajera', '3. Cambiar un NCF ya puesto', false, 'NO lo bloqueó');
  exception when others then insert into t_res values (default, 'cajera', '3. Cambiar un NCF ya puesto', sqlerrm like '%VENTA_MONTOS_SOLO_ADMIN%', sqlerrm); end;
  -- 4. Anular por la API
  begin update pos_ventas set estado = 'anulada' where id = v_va; insert into t_res values (default, 'cajera', '4. Anular una factura', false, 'NO lo bloqueó');
  exception when others then insert into t_res values (default, 'cajera', '4. Anular una factura (solo admin/gerente)', sqlerrm like '%VENTA_ANULAR_SOLO_ADMIN%', sqlerrm); end;
  -- 5. Cambiar el total
  begin update pos_ventas set total = 1, subtotal = 1 where id = v_va; insert into t_res values (default, 'cajera', '5. Bajar el total de una factura', false, 'NO lo bloqueó');
  exception when others then insert into t_res values (default, 'cajera', '5. Bajar el total de una factura', sqlerrm like '%VENTA_MONTOS_SOLO_ADMIN%', sqlerrm); end;
  -- 6. Borrar la factura
  begin delete from pos_ventas where id = v_va; insert into t_res values (default, 'cajera', '6. Borrar una factura', false, 'NO lo bloqueó');
  exception when others then insert into t_res values (default, 'cajera', '6. Borrar una factura', sqlerrm like '%VENTA_NO_SE_BORRA%', sqlerrm); end;
  -- 7. Borrar o cambiar las líneas
  begin delete from pos_venta_items where venta_id = v_va; insert into t_res values (default, 'cajera', '7. Borrar las líneas de una factura', false, 'NO lo bloqueó');
  exception when others then insert into t_res values (default, 'cajera', '7. Borrar las líneas de una factura', sqlerrm like '%VENTA_LINEAS_SOLO_ADMIN%', sqlerrm); end;
  begin update pos_venta_items set precio = 1, importe = 1 where venta_id = v_va; insert into t_res values (default, 'cajera', '8. Cambiar el precio de una línea', false, 'NO lo bloqueó');
  exception when others then insert into t_res values (default, 'cajera', '8. Cambiar el precio de una línea', sqlerrm like '%VENTA_LINEAS_SOLO_ADMIN%', sqlerrm); end;
  insert into t_res values (default, 'cajera', '9. La factura sigue completa e intacta',
    (select estado = 'completada' and total = 1000 from pos_ventas where id = v_va) and (select count(*) from pos_venta_items where venta_id = v_va) = 1, null);
  -- 10–12. Caja cerrada y sus movimientos
  if v_caja is null then insert into t_res values (default, 'cajera', '10. Borrar una caja cerrada', false, 'no hay caja cerrada para probar');
  else
    begin delete from pos_cajas where id = v_caja; insert into t_res values (default, 'cajera', '10. Borrar una caja cerrada', false, 'NO lo bloqueó');
    exception when others then insert into t_res values (default, 'cajera', '10. Borrar una caja cerrada', sqlerrm like '%CAJA_NO_SE_BORRA%', sqlerrm); end;
  end if;
  if v_movc is null then insert into t_res values (default, 'cajera', '11. Borrar un movimiento de una caja cerrada', false, 'no hay movimiento para probar');
  else
    begin delete from pos_caja_movimientos where id = v_movc; insert into t_res values (default, 'cajera', '11. Borrar un movimiento de una caja cerrada', false, 'NO lo bloqueó');
    exception when others then insert into t_res values (default, 'cajera', '11. Borrar un movimiento de una caja cerrada', sqlerrm like '%CAJA_MOVIMIENTO_NO_ELIMINABLE%', sqlerrm); end;
  end if;
  -- 12. Su propia caja abierta: agregar y quitar un movimiento con la RPC de siempre
  begin
    select id into v_mia from pos_cajas where organizacion_id = mi_organizacion() and usuario_id = auth.uid() and estado = 'abierta';
    if v_mia is null then insert into pos_cajas (monto_inicial) values (0) returning id into v_mia; end if;
    insert into pos_caja_movimientos (caja_id, tipo, concepto, monto) values (v_mia, 'entrada', 'ZZ prueba 52', 1) returning id into v_mov;
    if v_movc is not null then
      begin update pos_caja_movimientos set caja_id = v_mia where id = v_movc; insert into t_res values (default, 'cajera', '12. Pasar un movimiento de caja cerrada a la suya', false, 'NO lo bloqueó');
      exception when others then insert into t_res values (default, 'cajera', '12. Pasar un movimiento de caja cerrada a la suya', sqlerrm like '%CAJA_MOVIMIENTO_NO_ELIMINABLE%', sqlerrm); end;
    end if;
    perform pos_eliminar_movimiento_mi_caja(v_mov);
    insert into t_res values (default, 'cajera', '13. Quitar un movimiento de SU caja abierta (pos_eliminar_movimiento_mi_caja)', not exists (select 1 from pos_caja_movimientos where id = v_mov), null);
  exception when others then insert into t_res values (default, 'cajera', '13. Quitar un movimiento de su caja abierta', false, sqlerrm); end;
end $$;
reset role;

-- ── ADMINISTRADOR ──
select set_config('request.jwt.claims', '{"sub":"25bea4e1-2241-4480-a52e-447dad70c191","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v_va uuid := current_setting('t.va')::uuid; v_vc uuid := current_setting('t.vc')::uuid;
begin
  insert into t_res values (default, 'admin', '14. La sesión es de administrador', mi_rol() = 'admin', 'rol ' || coalesce(mi_rol(), '—'));
  begin update pos_ventas set estado = 'anulada' where id = v_va;
    insert into t_res values (default, 'admin', '15. El administrador anula la factura', (select estado from pos_ventas where id = v_va) = 'anulada', null);
  exception when others then insert into t_res values (default, 'admin', '15. El administrador anula la factura', false, sqlerrm); end;
  begin delete from pos_ventas where id = v_vc;
    insert into t_res values (default, 'admin', '16. El administrador puede borrar (Ajustes → datos de prueba)', not exists (select 1 from pos_ventas where id = v_vc), null);
  exception when others then insert into t_res values (default, 'admin', '16. El administrador puede borrar', false, sqlerrm); end;
  if current_setting('t.caja_nueva') = 'true' then
    begin delete from pos_cajas where id = current_setting('t.caja')::uuid;
      insert into t_res values (default, 'admin', '17. El administrador puede borrar una caja (con sus movimientos)',
        not exists (select 1 from pos_caja_movimientos where id = nullif(current_setting('t.mov'), '')::uuid), null);
    exception when others then insert into t_res values (default, 'admin', '17. El administrador puede borrar una caja', false, sqlerrm); end;
  end if;
end $$;
reset role;

-- ── GERENTE (ERIKA subida a gerente solo en esta transacción) ──
update profiles set rol = 'gerente' where id = '9b5d1b70-5347-4df8-a11b-ac8a65211b47';
select set_config('request.jwt.claims', '{"sub":"9b5d1b70-5347-4df8-a11b-ac8a65211b47","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v_vb uuid := current_setting('t.vb')::uuid;
begin
  insert into t_res values (default, 'gerente', '18. La sesión es de gerente', mi_rol() = 'gerente', 'rol ' || coalesce(mi_rol(), '—'));
  begin update pos_ventas set estado = 'anulada' where id = v_vb;
    insert into t_res values (default, 'gerente', '19. El gerente anula la factura', (select estado from pos_ventas where id = v_vb) = 'anulada', null);
  exception when others then insert into t_res values (default, 'gerente', '19. El gerente anula la factura', false, sqlerrm); end;
  begin delete from pos_ventas where id = v_vb; insert into t_res values (default, 'gerente', '20. El gerente borra una factura', false, 'NO lo bloqueó');
  exception when others then insert into t_res values (default, 'gerente', '20. El gerente borra una factura (solo admin)', sqlerrm like '%VENTA_NO_SE_BORRA%', sqlerrm); end;
end $$;
reset role;

do $$ begin
  raise exception E'RESULTADO_PRUEBA_52\n%', (select string_agg(case when ok then 'OK   ' else 'FALLA' end || ' | ' || rol || ' | ' || caso || ' | ' || left(coalesce(detalle, ''), 140), E'\n' order by n) from t_res);
end $$;
