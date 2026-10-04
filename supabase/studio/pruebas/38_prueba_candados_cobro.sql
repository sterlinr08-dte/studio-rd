-- Prueba de la migración 38 (candados C1/C2/A1/A5). Termina en error a propósito: todo se deshace, no deja nada.
-- Roles reales simulados con request.jwt.claims: cajera ERIKA y el administrador.
begin;
create temp table t_res (n serial, rol text, caso text, ok boolean, detalle text);
grant all on t_res to authenticated; grant usage on sequence t_res_n_seq to authenticated;

-- ── Preparación (servidor) ──
do $$
declare v_org uuid := 'e404d1c4-24c5-4e17-88f6-84bef09d6d19'; v_alm uuid := '83e35d4c-d3ff-484f-98fb-fafdf63735af'; v_cli uuid; v_v uuid; v_sol uuid;
begin
  insert into pos_clientes (organizacion_id, nombre, telefono, activo) values (v_org, 'ZZ PRUEBA 38', '8090000038', true) returning id into v_cli;
  insert into pos_ventas (organizacion_id, cliente_id, cliente_nombre, a_credito, subtotal, itbis, total, credito_monto, estado, almacen_id, metodo_pago)
    values (v_org, v_cli, 'ZZ PRUEBA 38', true, 12000, 0, 12000, 12000, 'completada', v_alm, 'Crédito') returning id into v_v;
  insert into pos_fin_solicitudes (organizacion_id, cliente_id, cliente_nombre, items, precio_total, inicial, inicial_metodo, plan_id, primera_fecha, estado, exp_estado, monto_manual)
    values (v_org, v_cli, 'ZZ PRUEBA 38', '[{"nombre":"Concepto de prueba","precio":15000,"cantidad":1}]'::jsonb, 15000, 3000, 'efectivo',
            '3c26115f-6ff8-4f02-ba22-038d84f8912f', current_date + 15, 'pendiente', 'enviado', true) returning id into v_sol;
  perform set_config('t.cli', v_cli::text, true); perform set_config('t.v', v_v::text, true); perform set_config('t.sol', v_sol::text, true);
end $$;

-- ── ADMIN crea el financiamiento por la función del sistema ──
select set_config('request.jwt.claims', '{"sub":"25bea4e1-2241-4480-a52e-447dad70c191","role":"authenticated"}', true);
set local role authenticated;
do $$ declare v_fin uuid; begin
  begin v_fin := pos_fin_crear_financiamiento_v2(current_setting('t.v')::uuid, '3c26115f-6ff8-4f02-ba22-038d84f8912f', current_date + 10, null, null);
    perform set_config('t.fin', v_fin::text, true);
    perform set_config('t.c1', (select id::text from pos_fin_cuotas where financiamiento_id = v_fin and numero = 1), true);
    insert into t_res values (default, 'admin', 'crear financiamiento (función)', v_fin is not null, (select count(*) || ' cuotas' from pos_fin_cuotas where financiamiento_id = v_fin));
  exception when others then insert into t_res values (default, 'admin', 'crear financiamiento (función)', false, sqlerrm); end;
end $$;
reset role;
select set_config('nx.fin_rpc', '', true);

-- Caja abierta de ERIKA (con su sesión, como la abre la pantalla).
select set_config('request.jwt.claims', '{"sub":"9b5d1b70-5347-4df8-a11b-ac8a65211b47","role":"authenticated"}', true);
insert into pos_cajas (organizacion_id, usuario_id, usuario_nombre, estado, apertura, monto_inicial)
  values ('e404d1c4-24c5-4e17-88f6-84bef09d6d19', '9b5d1b70-5347-4df8-a11b-ac8a65211b47', 'ERIKA REYES', 'abierta', now(), 0);

-- ── CAJERA (ERIKA) ──
set local role authenticated;
do $$
declare v_fin uuid := current_setting('t.fin')::uuid; v_c1 uuid := current_setting('t.c1')::uuid; v_p uuid;
begin
  begin update pos_fin_cuotas set pagado = true, monto_pagado = monto where id = v_c1; insert into t_res values (default,'cajero','C1 marcar cuota pagada por REST',false,'NO bloqueó');
  exception when others then insert into t_res values (default,'cajero','C1 marcar cuota pagada por REST', sqlerrm like '%FIN_CUOTA_SOLO_POR_SISTEMA%', sqlerrm); end;
  begin update pos_financiamientos set estado = 'saldado' where id = v_fin; insert into t_res values (default,'cajero','C1 saldar financiamiento por REST',false,'NO bloqueó');
  exception when others then insert into t_res values (default,'cajero','C1 saldar financiamiento por REST', sqlerrm like '%FIN_FINANCIAMIENTO_SOLO_POR_SISTEMA%', sqlerrm); end;
  begin insert into pos_fin_pagos (organizacion_id, financiamiento_id, cuota_id, monto, metodo, tipo) values (mi_organizacion(), v_fin, v_c1, 100, 'efectivo', 'pago');
    insert into t_res values (default,'cajero','C2 pago insertado directo',false,'NO bloqueó');
  exception when others then insert into t_res values (default,'cajero','C2 pago insertado directo', sqlerrm like '%FIN_PAGO_SOLO_POR_SISTEMA%', sqlerrm); end;
  begin update pos_financiamientos set firma_tienda = 'data:image/png;base64,AA', firma_tienda_por = 'ERIKA', firma_tienda_en = now() where id = v_fin;
    insert into t_res values (default,'cajero','firma de la tienda (sigue permitida)', found, '');
  exception when others then insert into t_res values (default,'cajero','firma de la tienda (sigue permitida)', false, sqlerrm); end;
  begin v_p := pos_fin_registrar_pago_v2(v_fin, v_c1, 500, 'efectivo', null, gen_random_uuid(), 'ERIKA');
    insert into t_res values (default,'cajero','cobrar cuota en efectivo (función)', v_p is not null and (select monto_pagado from pos_fin_cuotas where id = v_c1) > 0,
      'cuota pagado ' || (select monto_pagado from pos_fin_cuotas where id = v_c1));
  exception when others then insert into t_res values (default,'cajero','cobrar cuota en efectivo (función)', false, sqlerrm); end;
  begin v_p := pos_fin_registrar_pago_v2(v_fin, v_c1, 300, 'transferencia', 'REF-38', gen_random_uuid(), 'ERIKA', '07a1467d-ccbc-4405-b797-c59b99c756f5');
    perform set_config('t.ptr', v_p::text, true);
    insert into t_res values (default,'cajero','A1 cobrar por transferencia (banco)', exists (select 1 from pos_banco_movimientos where origen_id = v_p and monto = 300), 'pago ' || v_p);
  exception when others then insert into t_res values (default,'cajero','A1 cobrar por transferencia (banco)', false, sqlerrm); end;
  -- La marca de las funciones dura la transacción (en la app cada llamada es su propia transacción): se limpia aquí.
  perform set_config('nx.fin_rpc', '', true); perform set_config('nx.fin_recalc', '', true);
  begin insert into pos_banco_movimientos (organizacion_id, cuenta_bancaria_id, fecha, monto, concepto, origen_tipo) values (mi_organizacion(), '07a1467d-ccbc-4405-b797-c59b99c756f5', now(), 999, 'inventado', 'pago_cuota');
    insert into t_res values (default,'cajero','banco: movimiento inventado por REST',false,'NO bloqueó');
  exception when others then insert into t_res values (default,'cajero','banco: movimiento inventado por REST', true, sqlerrm); end;
  begin update pos_fin_solicitudes set inicial = 100 where id = current_setting('t.sol')::uuid; insert into t_res values (default,'cajero','A5 bajar la inicial con expediente enviado',false,'NO bloqueó');
  exception when others then insert into t_res values (default,'cajero','A5 bajar la inicial con expediente enviado', sqlerrm like '%FIN_SOLICITUD_CONGELADA%', sqlerrm); end;
  begin update pos_fin_solicitudes set exp_selfie = 'otra.jpg' where id = current_setting('t.sol')::uuid; insert into t_res values (default,'cajero','A5 cambiar la selfie del expediente',false,'NO bloqueó');
  exception when others then insert into t_res values (default,'cajero','A5 cambiar la selfie del expediente', sqlerrm like '%FIN_EXPEDIENTE_SOLO_CLIENTE%', sqlerrm); end;
  begin update pos_fin_solicitudes set evaluacion = '{"score":70}'::jsonb, evaluacion_score = 70 where id = current_setting('t.sol')::uuid;
    insert into t_res values (default,'cajero','evaluación de la solicitud (sigue permitida)', found, '');
  exception when others then insert into t_res values (default,'cajero','evaluación de la solicitud (sigue permitida)', false, sqlerrm); end;
end $$;
reset role;
select set_config('nx.fin_rpc', '', true); select set_config('nx.fin_recalc', '', true);

-- ── ADMIN ──
select set_config('request.jwt.claims', '{"sub":"25bea4e1-2241-4480-a52e-447dad70c191","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v_fin uuid := current_setting('t.fin')::uuid; v_r uuid;
begin
  begin v_r := pos_fin_reversar_pago(current_setting('t.ptr')::uuid, 'prueba 38', gen_random_uuid());
    insert into t_res values (default,'admin','reversar pago por transferencia', exists (select 1 from pos_banco_movimientos where origen_id = v_r and monto = -300), 'reversa ' || v_r);
  exception when others then insert into t_res values (default,'admin','reversar pago por transferencia', false, sqlerrm); end;
  perform set_config('nx.fin_rpc', '', true); perform set_config('nx.fin_recalc', '', true);
  begin update pos_financiamientos set estado = 'cancelado' where id = v_fin; insert into t_res values (default,'admin','cancelar plan con la venta vigente',false,'NO bloqueó');
  exception when others then insert into t_res values (default,'admin','cancelar plan con la venta vigente', sqlerrm like '%FIN_FINANCIAMIENTO_SOLO_POR_SISTEMA%', sqlerrm); end;
  begin update pos_fin_solicitudes set inicial = 3500 where id = current_setting('t.sol')::uuid;
    insert into t_res values (default,'admin','A5 admin ajusta la inicial (permitido)', found, '');
  exception when others then insert into t_res values (default,'admin','A5 admin ajusta la inicial (permitido)', false, sqlerrm); end;
end $$;
reset role;
update pos_ventas set estado = 'anulada' where id = current_setting('t.v')::uuid;
set local role authenticated;
do $$ begin
  perform set_config('nx.fin_rpc', '', true); perform set_config('nx.fin_recalc', '', true);
  begin update pos_financiamientos set estado = 'cancelado' where id = current_setting('t.fin')::uuid;
    insert into t_res values (default,'admin','anular factura cancela su plan (permitido)', found, '');
  exception when others then insert into t_res values (default,'admin','anular factura cancela su plan (permitido)', false, sqlerrm); end;
end $$;
reset role;

-- Termina con un error a propósito: así todo se deshace y el mensaje trae los resultados.
do $$ begin
  raise exception E'RESULTADOS 38\n%', (select string_agg(case when ok then 'OK   ' else 'FALLA' end || ' · ' || rol || ' · ' || caso || coalesce(' · ' || nullif(left(detalle, 120), ''), ''), E'\n' order by n) from t_res);
end $$;
