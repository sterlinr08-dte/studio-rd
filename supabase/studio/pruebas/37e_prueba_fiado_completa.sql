-- Prueba completa del fiado (07-oct-2026). Corre en la base real dentro de UNA transacción que termina en
-- raise exception: todo se deshace y no queda nada. Roles reales: cajera ERIKA REYES y ADMINISTRADOR STUDIO.
set local lock_timeout = '5s'; set local statement_timeout = '50s';
create temp table t_res (n serial, rol text, caso text, ok boolean, detalle text) on commit drop;
grant all on t_res to authenticated; grant usage on sequence t_res_n_seq to authenticated;

do $$
declare v_org uuid := 'e404d1c4-24c5-4e17-88f6-84bef09d6d19'; v_alm uuid := '83e35d4c-d3ff-484f-98fb-fafdf63735af';
  v_cli uuid; v_v1 uuid; v_vfin uuid; v_fin uuid; v_plan uuid;
begin
  select id into v_plan from pos_fin_planes where organizacion_id = v_org limit 1;
  insert into pos_clientes (organizacion_id, nombre, telefono) values (v_org, 'ZZ PRUEBA FIADO', '8090000001') returning id into v_cli;
  insert into pos_ventas (organizacion_id, cliente_id, cliente_nombre, a_credito, subtotal, itbis, total, credito_monto, estado, almacen_id, metodo_pago)
    values (v_org, v_cli, 'ZZ', true, 5000, 0, 5000, 5000, 'completada', v_alm, 'Crédito') returning id into v_v1;
  insert into pos_ventas (organizacion_id, cliente_id, cliente_nombre, a_credito, subtotal, itbis, total, credito_monto, estado, almacen_id, metodo_pago)
    values (v_org, v_cli, 'ZZ', true, 12000, 0, 12000, 12000, 'completada', v_alm, 'Crédito') returning id into v_vfin;
  insert into pos_financiamientos (organizacion_id, venta_id, cliente_id, cliente_nombre, monto_total, inicial, monto_financiado, cuotas_total, cuota_monto, frecuencia, estado, plan_id, interes_total, primera_fecha)
    values (v_org, v_vfin, v_cli, 'ZZ', 12000, 0, 12000, 2, 6000, 'mensual', 'activo', v_plan, 0, current_date + 10) returning id into v_fin;
  perform set_config('t.cli', v_cli::text, false); perform set_config('t.v1', v_v1::text, false);
end $$;

-- ── CAJERA ERIKA ──
select set_config('request.jwt.claims', '{"sub":"9b5d1b70-5347-4df8-a11b-ac8a65211b47","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v_cli uuid := current_setting('t.cli')::uuid; v_j jsonb; v_op uuid; v_s numeric; v_det text;
begin
  begin insert into pos_cajas (organizacion_id, estado, apertura, monto_inicial) values (mi_organizacion(), 'abierta', now(), 0);
  exception when others then insert into t_res values (default,'cajera','0. Abrir caja de prueba', false, sqlerrm); end;
  v_s := pos_fiado_saldo_cliente(v_cli);
  insert into t_res values (default,'cajera','1. Saldo: solo cuenta la venta a crédito (la financiada no)', v_s = 5000 and (select count(*) from pos_ventas_fiado where cliente_id = v_cli) = 1, 'saldo ' || v_s);
  begin v_j := pos_fiado_registrar_abono(v_cli, 9000, 'Efectivo'); insert into t_res values (default,'cajera','2. Abono mayor que la deuda',false,'NO lo bloqueó');
  exception when others then insert into t_res values (default,'cajera','2. Abono mayor que la deuda', sqlerrm like '%FIADO_EXCEDE_SALDO%', sqlerrm); end;
  begin v_j := pos_fiado_registrar_abono(v_cli, 0, 'Efectivo'); insert into t_res values (default,'cajera','3. Abono en cero',false,'NO lo bloqueó');
  exception when others then insert into t_res values (default,'cajera','3. Abono en cero', sqlerrm like '%FIADO_MONTO_INVALIDO%', sqlerrm); end;
  -- 4: se mide qué guarda y se deshace solo este paso (07-oct-2026: lo acepta y lo redondea a 10.01, abono y asiento iguales)
  begin v_j := pos_fiado_registrar_abono(v_cli, 10.005, 'Efectivo');
    select 'guardó abono ' || a.monto || ' · asiento ' || coalesce((select sum(l.debito)::text || '/' || sum(l.credito)::text from pos_asientos x join pos_asiento_lineas l on l.asiento_id = x.id where x.origen_id = a.id), '—')
      into v_det from pos_abonos a where a.id = (v_j->>'id')::uuid;
    raise exception 'DESHACER_CASO4';
  exception when others then
    if sqlerrm = 'DESHACER_CASO4' then insert into t_res values (default,'cajera','4. Abono RD$10.005 (fracción de centavo): lo acepta redondeado, no lo rechaza', false, v_det);
    else insert into t_res values (default,'cajera','4. Abono con fracción de centavo: rechazado', true, sqlerrm); end if;
  end;
  begin v_op := gen_random_uuid(); v_j := pos_fiado_registrar_abono(v_cli, 1000, 'Efectivo', 'prueba', null, v_op, 'ERIKA');
    perform pos_fiado_registrar_abono(v_cli, 1000, 'Efectivo', 'prueba', null, v_op, 'ERIKA');
    insert into t_res values (default,'cajera','5. Abono RD$1,000 en efectivo + doble clic = un solo abono, en su caja, asiento cuadrado, hora RD',
      (select count(*) from pos_abonos where cliente_id = v_cli) = 1
      and (select caja_id is not null and fecha = nx_hoy() from pos_abonos where id = (v_j->>'id')::uuid)
      and (select sum(l.debito) = sum(l.credito) and sum(l.debito) = 1000 from pos_asientos a join pos_asiento_lineas l on l.asiento_id = a.id where a.origen_id = (v_j->>'id')::uuid)
      and pos_fiado_saldo_cliente(v_cli) = 4000, 'saldo ' || pos_fiado_saldo_cliente(v_cli) || ' · ' || (v_j->>'numero'));
    perform set_config('t.ab1', v_j->>'id', false);
  exception when others then insert into t_res values (default,'cajera','5. Abono en efectivo + doble clic', false, sqlerrm); end;
  begin v_j := pos_fiado_registrar_abono(v_cli, 500, 'Transferencia', null, null, gen_random_uuid(), 'ERIKA');
    insert into t_res values (default,'cajera','6. Abono RD$500 por transferencia: sin caja, va a Banco (1102)',
      (select caja_id is null from pos_abonos where id = (v_j->>'id')::uuid)
      and exists (select 1 from pos_asientos a join pos_asiento_lineas l on l.asiento_id = a.id where a.origen_id = (v_j->>'id')::uuid and l.cuenta_codigo = '1102' and l.debito = 500)
      and pos_fiado_saldo_cliente(v_cli) = 3500, 'saldo ' || pos_fiado_saldo_cliente(v_cli));
  exception when others then insert into t_res values (default,'cajera','6. Abono por transferencia', false, sqlerrm); end;
  begin perform pos_fiado_registrar_abono(v_cli, 100, 'Transferencia', null, current_date - 5); insert into t_res values (default,'cajera','7. Abono con fecha atrasada',false,'NO lo bloqueó');
  exception when others then insert into t_res values (default,'cajera','7. Abono con fecha atrasada (solo admin)', sqlerrm like '%FIADO_FECHA_SOLO_ADMIN%', sqlerrm); end;
  begin insert into pos_abonos (organizacion_id, cliente_id, monto, metodo) values (mi_organizacion(), v_cli, 500, 'Efectivo'); insert into t_res values (default,'cajera','8. Meter un abono por fuera del sistema',false,'NO lo bloqueó');
  exception when others then insert into t_res values (default,'cajera','8. Meter un abono por fuera del sistema', sqlerrm like '%ABONO_SOLO_POR_SISTEMA%', sqlerrm); end;
  begin update pos_abonos set monto = 1 where cliente_id = v_cli; insert into t_res values (default,'cajera','9. Cambiar el monto de un abono',false,'NO lo bloqueó');
  exception when others then insert into t_res values (default,'cajera','9. Cambiar el monto de un abono', sqlerrm like '%ABONO_SOLO_POR_SISTEMA%', sqlerrm); end;
  begin delete from pos_abonos where cliente_id = v_cli; insert into t_res values (default,'cajera','10. Borrar un abono a mano',false,'NO lo bloqueó');
  exception when others then insert into t_res values (default,'cajera','10. Borrar un abono a mano', sqlerrm like '%ABONO_SOLO_POR_SISTEMA%', sqlerrm); end;
  begin perform pos_fiado_eliminar_abono(current_setting('t.ab1')::uuid); insert into t_res values (default,'cajera','11. La cajera anula un abono',false,'NO lo bloqueó');
  exception when others then insert into t_res values (default,'cajera','11. La cajera anula un abono (solo admin/gerente)', sqlerrm like '%FIADO_ELIMINAR_SOLO_ADMIN%', sqlerrm); end;
  begin delete from pos_asientos where origen_id = current_setting('t.ab1')::uuid; insert into t_res values (default,'cajera','12. Borrar el asiento contable del abono',false,'NO lo bloqueó');
  exception when others then insert into t_res values (default,'cajera','12. Borrar el asiento contable del abono', sqlerrm like '%ASIENTO_COBRO%', sqlerrm); end;
end $$;
reset role;

-- ── ADMINISTRADOR ──
select set_config('request.jwt.claims', '{"sub":"25bea4e1-2241-4480-a52e-447dad70c191","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v_cli uuid := current_setting('t.cli')::uuid; v_j jsonb; v_an uuid;
begin
  begin v_j := pos_fiado_eliminar_abono(current_setting('t.ab1')::uuid); v_an := (v_j->>'id')::uuid;
    insert into t_res values (default,'admin','13. Anular el abono de RD$1,000: queda el original + un reverso, asiento inverso cuadrado, deuda vuelve a RD$4,500',
      exists (select 1 from pos_abonos where id = current_setting('t.ab1')::uuid)
      and (select monto = -1000 and anula_id = current_setting('t.ab1')::uuid from pos_abonos where id = v_an)
      and (select sum(l.debito) = sum(l.credito) and sum(l.debito) = 1000 and bool_or(l.cuenta_codigo = '1103' and l.debito = 1000) from pos_asientos a join pos_asiento_lineas l on l.asiento_id = a.id where a.origen_id = v_an)
      and pos_fiado_saldo_cliente(v_cli) = 4500, 'saldo ' || pos_fiado_saldo_cliente(v_cli) || ' · ' || (v_j->>'numero'));
    perform set_config('t.an', v_an::text, false);
  exception when others then insert into t_res values (default,'admin','13. Anular abono con reverso', false, sqlerrm); end;
  begin perform pos_fiado_eliminar_abono(current_setting('t.ab1')::uuid); insert into t_res values (default,'admin','14. Anular dos veces el mismo abono',false,'NO lo bloqueó');
  exception when others then insert into t_res values (default,'admin','14. Anular dos veces el mismo abono', sqlerrm like '%FIADO_ABONO_YA_ANULADO%', sqlerrm); end;
  begin perform pos_fiado_eliminar_abono(current_setting('t.an')::uuid); insert into t_res values (default,'admin','15. Anular la anulación',false,'NO lo bloqueó');
  exception when others then insert into t_res values (default,'admin','15. Anular la anulación', sqlerrm like '%FIADO_ABONO_ES_ANULACION%', sqlerrm); end;
  begin v_j := pos_fiado_registrar_abono(v_cli, 300, 'Transferencia', 'atrasado', current_date - 3);
    insert into t_res values (default,'admin','16. El admin sí puede poner fecha atrasada', (select fecha from pos_abonos where id = (v_j->>'id')::uuid) = current_date - 3 and pos_fiado_saldo_cliente(v_cli) = 4200, 'saldo ' || pos_fiado_saldo_cliente(v_cli));
  exception when others then insert into t_res values (default,'admin','16. Admin con fecha atrasada', false, sqlerrm); end;
  begin v_j := pos_fiado_registrar_abono(v_cli, 4200, 'Efectivo', 'saldo completo', null, gen_random_uuid(), 'ADMIN');
    insert into t_res values (default,'admin','17. Pagar la deuda completa deja el saldo en cero', pos_fiado_saldo_cliente(v_cli) = 0, 'saldo ' || pos_fiado_saldo_cliente(v_cli));
  exception when others then insert into t_res values (default,'admin','17. Pagar la deuda completa', false, sqlerrm); end;
  begin perform pos_fiado_registrar_abono(v_cli, 1, 'Efectivo'); insert into t_res values (default,'admin','18. Abonar con la deuda ya en cero',false,'NO lo bloqueó');
  exception when others then insert into t_res values (default,'admin','18. Abonar con la deuda ya en cero', sqlerrm like '%FIADO_%', sqlerrm); end;
end $$;
reset role;

-- Venta anulada sale del fiado (como servicio)
do $$
declare v_cli uuid := current_setting('t.cli')::uuid; v_antes numeric;
begin
  v_antes := (select count(*) from pos_ventas_fiado where cliente_id = v_cli);
  begin update pos_ventas set estado = 'anulada' where id = current_setting('t.v1')::uuid;
    insert into t_res values (default,'sistema','19. Una venta anulada deja de contar en el fiado', (select count(*) from pos_ventas_fiado where cliente_id = v_cli) = v_antes - 1, 'ventas en fiado ' || v_antes || ' → ' || (select count(*) from pos_ventas_fiado where cliente_id = v_cli));
  exception when others then insert into t_res values (default,'sistema','19. Venta anulada fuera del fiado', false, sqlerrm); end;
end $$;

do $$ begin
  raise exception E'RESULTADO_PRUEBA_FIADO\n%', (select string_agg(case when ok then 'OK   ' else 'FALLA' end || ' | ' || rol || ' | ' || caso || ' | ' || left(coalesce(detalle,''), 140), E'\n' order by n) from t_res);
end $$;
