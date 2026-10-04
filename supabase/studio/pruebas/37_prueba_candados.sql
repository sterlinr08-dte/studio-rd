-- Prueba de la migración 37 (se corre DESPUÉS del cuerpo de la 37, dentro de begin … rollback; no deja nada).
-- Roles reales de STUDIO simulados con request.jwt.claims: cajero ERIKA y admin.
create temp table t_res (n serial, rol text, caso text, ok boolean, detalle text);
grant all on t_res to authenticated; grant usage on sequence t_res_n_seq to authenticated;

-- ── Preparación (como servicio) ──
do $$
declare v_org uuid := 'e404d1c4-24c5-4e17-88f6-84bef09d6d19'; v_alm uuid := '83e35d4c-d3ff-484f-98fb-fafdf63735af';
  v_cli uuid; v_vfin uuid; v_fin uuid; v_plan uuid; v_c1 uuid;
begin
  select id into v_plan from pos_fin_planes where organizacion_id = v_org limit 1;
  insert into pos_clientes (organizacion_id, nombre, telefono) values (v_org, 'ZZ PRUEBA AUDITORIA', '8090000000') returning id into v_cli;
  insert into pos_ventas (organizacion_id, cliente_id, cliente_nombre, a_credito, subtotal, itbis, total, credito_monto, estado, almacen_id, metodo_pago)
    values (v_org, v_cli, 'ZZ', true, 5000, 0, 5000, 5000, 'completada', v_alm, 'Crédito');
  insert into pos_ventas (organizacion_id, cliente_id, cliente_nombre, a_credito, subtotal, itbis, total, credito_monto, estado, almacen_id, metodo_pago)
    values (v_org, v_cli, 'ZZ', true, 12000, 0, 12000, 12000, 'completada', v_alm, 'Crédito') returning id into v_vfin;
  insert into pos_financiamientos (organizacion_id, venta_id, cliente_id, cliente_nombre, monto_total, inicial, monto_financiado, cuotas_total, cuota_monto, frecuencia, estado, plan_id, interes_total, primera_fecha)
    values (v_org, v_vfin, v_cli, 'ZZ', 12000, 0, 12000, 2, 6000, 'mensual', 'activo', v_plan, 0, current_date + 10) returning id into v_fin;
  insert into pos_fin_cuotas (organizacion_id, financiamiento_id, numero, fecha_venc, monto, capital, interes)
    values (v_org, v_fin, 1, current_date + 10, 6000, 6000, 0), (v_org, v_fin, 2, current_date + 40, 6000, 6000, 0);
  select id into v_c1 from pos_fin_cuotas where financiamiento_id = v_fin and numero = 1;
  insert into pos_cajas (organizacion_id, usuario_id, usuario_nombre, estado, apertura, monto_inicial)
    values (v_org, '9b5d1b70-5347-4df8-a11b-ac8a65211b47', 'ERIKA REYES', 'abierta', now(), 0);
  perform set_config('t.cli', v_cli::text, true); perform set_config('t.fin', v_fin::text, true); perform set_config('t.c1', v_c1::text, true);
end $$;

-- ── CAJERO (ERIKA) ──
select set_config('request.jwt.claims', '{"sub":"9b5d1b70-5347-4df8-a11b-ac8a65211b47","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v_cli uuid := current_setting('t.cli')::uuid; v_fin uuid := current_setting('t.fin')::uuid; v_c1 uuid := current_setting('t.c1')::uuid;
  v_r uuid; v_op uuid; v_j jsonb;
begin
  -- Cobro de cuota existente sigue funcionando (efectivo) y queda en hora RD
  begin v_r := pos_fin_registrar_pago_v2(v_fin, v_c1, 1000, 'efectivo', null, gen_random_uuid(), 'ERIKA');
    insert into t_res values (default,'cajero','cobrar cuota en efectivo (sin cambios)', v_r is not null, 'fecha pago ' || (select fecha from pos_fin_pagos where id = v_r) || ' · hoy RD ' || nx_hoy());
  exception when others then insert into t_res values (default,'cajero','cobrar cuota en efectivo (sin cambios)', false, sqlerrm); end;
  begin perform pos_fin_registrar_pago_v2(v_fin, v_c1, 100.005, 'efectivo', null, gen_random_uuid(), 'ERIKA');
    insert into t_res values (default,'cajero','cuota: monto con fracción de centavo',false,'NO bloqueó');
  exception when others then insert into t_res values (default,'cajero','cuota: monto con fracción de centavo', sqlerrm like '%centavos%', sqlerrm); end;
  -- Fiado
  insert into t_res values (default,'cajero','venta financiada fuera del fiado', (select count(*) from pos_ventas_fiado where cliente_id = v_cli) = 1 and pos_fiado_saldo_cliente(v_cli) = 5000,
    'ventas fiado ' || (select count(*) from pos_ventas_fiado where cliente_id = v_cli) || ' · saldo ' || pos_fiado_saldo_cliente(v_cli));
  begin v_j := pos_fiado_registrar_abono(v_cli, 9000, 'Efectivo'); insert into t_res values (default,'cajero','abono mayor que el saldo',false,'NO bloqueó');
  exception when others then insert into t_res values (default,'cajero','abono mayor que el saldo', sqlerrm like '%FIADO_EXCEDE_SALDO%', sqlerrm); end;
  begin v_j := pos_fiado_registrar_abono(v_cli, 0, 'Efectivo'); insert into t_res values (default,'cajero','abono en cero',false,'NO bloqueó');
  exception when others then insert into t_res values (default,'cajero','abono en cero', sqlerrm like '%FIADO_MONTO_INVALIDO%', sqlerrm); end;
  begin v_op := gen_random_uuid(); v_j := pos_fiado_registrar_abono(v_cli, 1000, 'Efectivo', 'prueba', null, v_op, 'ERIKA');
    perform pos_fiado_registrar_abono(v_cli, 1000, 'Efectivo', 'prueba', null, v_op, 'ERIKA');
    insert into t_res values (default,'cajero','abono en efectivo (RPC) + doble clic',
      (select count(*) from pos_abonos where cliente_id = v_cli) = 1 and (select caja_id from pos_abonos where id = (v_j->>'id')::uuid) is not null
      and (select sum(l.debito) = sum(l.credito) and sum(l.debito) = 1000 from pos_asientos a join pos_asiento_lineas l on l.asiento_id = a.id where a.origen_id = (v_j->>'id')::uuid)
      and pos_fiado_saldo_cliente(v_cli) = 4000,
      v_j::text);
    perform set_config('t.abono', v_j->>'id', true);
  exception when others then insert into t_res values (default,'cajero','abono en efectivo (RPC) + doble clic', false, sqlerrm); end;
  begin v_j := pos_fiado_registrar_abono(v_cli, 500, 'Transferencia', null, null, gen_random_uuid(), 'ERIKA');
    insert into t_res values (default,'cajero','abono por transferencia (sin caja, Banco)', (select caja_id from pos_abonos where id = (v_j->>'id')::uuid) is null
      and exists (select 1 from pos_asientos a join pos_asiento_lineas l on l.asiento_id = a.id where a.origen_id = (v_j->>'id')::uuid and l.cuenta_codigo = '1102'), v_j::text);
  exception when others then insert into t_res values (default,'cajero','abono por transferencia (sin caja, Banco)', false, sqlerrm); end;
  begin perform pos_fiado_registrar_abono(v_cli, 100, 'Transferencia', null, current_date - 5); insert into t_res values (default,'cajero','abono con fecha atrasada',false,'NO bloqueó');
  exception when others then insert into t_res values (default,'cajero','abono con fecha atrasada', sqlerrm like '%FIADO_FECHA_SOLO_ADMIN%', sqlerrm); end;
  begin insert into pos_abonos (organizacion_id, cliente_id, monto, metodo) values (mi_organizacion(), v_cli, 500, 'Transferencia'); insert into t_res values (default,'cajero','abono directo sin asiento',false,'NO bloqueó');
  exception when others then insert into t_res values (default,'cajero','abono directo sin asiento', sqlerrm like '%ABONO_SOLO_POR_SISTEMA%', sqlerrm); end;
  begin update pos_abonos set monto = 1 where cliente_id = v_cli; insert into t_res values (default,'cajero','bajar el monto de un abono',false,'NO bloqueó');
  exception when others then insert into t_res values (default,'cajero','bajar el monto de un abono', sqlerrm like '%ABONO_SOLO_POR_SISTEMA%', sqlerrm); end;
  begin delete from pos_abonos where cliente_id = v_cli; insert into t_res values (default,'cajero','borrar un abono a mano',false,'NO bloqueó');
  exception when others then insert into t_res values (default,'cajero','borrar un abono a mano', sqlerrm like '%ABONO_SOLO_POR_SISTEMA%', sqlerrm); end;
  begin perform pos_fiado_eliminar_abono((current_setting('t.abono'))::uuid); insert into t_res values (default,'cajero','eliminar abono con el botón',false,'NO bloqueó');
  exception when others then insert into t_res values (default,'cajero','eliminar abono con el botón', sqlerrm like '%FIADO_ELIMINAR_SOLO_ADMIN%', sqlerrm); end;
  begin delete from pos_asientos where origen_id = (current_setting('t.abono'))::uuid; insert into t_res values (default,'cajero','borrar el asiento del abono',false,'NO bloqueó');
  exception when others then insert into t_res values (default,'cajero','borrar el asiento del abono', sqlerrm like '%ASIENTO_COBRO%', sqlerrm); end;
  begin insert into pos_asientos (organizacion_id, fecha, concepto, tipo) values (mi_organizacion(), current_date, 'falso', 'cobro'); insert into t_res values (default,'cajero','asiento de cobro inventado',false,'NO bloqueó');
  exception when others then insert into t_res values (default,'cajero','asiento de cobro inventado', sqlerrm like '%ASIENTO_COBRO%', sqlerrm); end;
end $$;
reset role;

-- ── ADMIN ──
select set_config('request.jwt.claims', '{"sub":"25bea4e1-2241-4480-a52e-447dad70c191","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v_j jsonb;
begin
  begin v_j := pos_fiado_eliminar_abono(current_setting('t.abono')::uuid);
    insert into t_res values (default,'admin','eliminar abono con su asiento', not exists (select 1 from pos_asientos where origen_id = current_setting('t.abono')::uuid)
      and not exists (select 1 from pos_abonos where id = current_setting('t.abono')::uuid), v_j::text);
  exception when others then insert into t_res values (default,'admin','eliminar abono con su asiento', false, sqlerrm); end;
  begin v_j := pos_fiado_registrar_abono(current_setting('t.cli')::uuid, 300, 'Transferencia', 'atrasado', current_date - 3);
    insert into t_res values (default,'admin','abono con fecha atrasada', (select fecha from pos_abonos where id = (v_j->>'id')::uuid) = current_date - 3, v_j::text);
  exception when others then insert into t_res values (default,'admin','abono con fecha atrasada', false, sqlerrm); end;
end $$;
reset role;

insert into t_res values (default,'anon','datos legales cerrados', not has_function_privilege('anon','public.pos_fin_legal_snapshot(uuid)','execute') and not has_function_privilege('authenticated','public.pos_fin_legal_snapshot(uuid)','execute'), '');
insert into t_res values (default,'anon','página pública de firma sigue abierta', has_function_privilege('anon','public.pos_fin_firma_ver(uuid)','execute') and has_function_privilege('anon','public.pos_fin_sol_enviar(uuid,text,text,text,text,text,text,text,boolean)','execute'), '');
insert into t_res values (default,'anon','aprobar y cobrar cerrados a anon', not has_function_privilege('anon','public.pos_fin_aprobar_solicitud(uuid,text,uuid,uuid,uuid)','execute') and not has_function_privilege('anon','public.pos_fin_registrar_pago_v2(uuid,uuid,numeric,text,text,uuid,text,uuid)','execute'), '');
insert into t_res values (default,'cajero','sigue pudiendo cobrar y aprobar (permiso)', has_function_privilege('authenticated','public.pos_fin_registrar_pago_v2(uuid,uuid,numeric,text,text,uuid,text,uuid)','execute'), '');
select rol, caso, ok, left(detalle, 170) detalle from t_res order by n;
