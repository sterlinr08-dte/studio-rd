-- Prueba de la migración 53 (metas de ventas del Tablero).
-- 16-oct-2026: corrida en un Postgres 16 desechable con las mismas funciones mi_rol/mi_organizacion/mi_usuario_id de STUDIO
-- y los tres usuarios reales simulados: 17 de 17 OK; el 17-oct, con los arreglos de la revisión (nombres y candado), 18 de 18 OK. En la base real queda para el momento de publicar (la herramienta de
-- consultas pide confirmación para sentencias con delete/drop). Se corre en UNA sola ejecución, en la base real:
--   begin;  + el cuerpo de supabase/studio/53_metas_ventas.sql  + este archivo.
-- Termina en raise exception a propósito: TODO se deshace (la tabla y la función incluidas) y no queda nada.
-- Sesiones reales simuladas con request.jwt.claims: ADMINISTRADOR STUDIO, la gerente Winifergomez y la cajera ERIKA REYES.
-- (Sin «select» intermedios ni avisos: la herramienta de consultas de Supabase se cuelga con resultados o NOTICE a mitad.)
set local lock_timeout = '5s'; set local statement_timeout = '50s';
create temp table t_res (n serial, rol text, caso text, ok boolean, detalle text) on commit drop;
grant all on t_res to authenticated, anon; grant usage on sequence t_res_n_seq to authenticated, anon;

-- ── ADMINISTRADOR ──
do $$ begin perform set_config('request.jwt.claims', '{"sub":"25bea4e1-2241-4480-a52e-447dad70c191","role":"authenticated"}', true); end $$;
set local role authenticated;
do $$
declare v_n int;
begin
  insert into t_res values (default, 'admin', '1. La sesión es de administrador', mi_rol() = 'admin', 'rol ' || coalesce(mi_rol(), '—'));
  begin
    v_n := pos_metas_guardar('2026-10-15', '[{"vendedor":"","monto":3100000},{"vendedor":"  Winifergomez   ","monto":"2500000.456"},{"vendedor":"SIN META","monto":0}]'::jsonb);
    insert into t_res values (default, 'admin', '2. Guarda la meta del negocio y la de un vendedor (la de 0 no se guarda)',
      v_n = 2 and (select count(*) from pos_metas_ventas where mes = '2026-10-01') = 2
      and exists (select 1 from pos_metas_ventas where mes = '2026-10-01' and vendedor = '' and monto = 3100000)
      and exists (select 1 from pos_metas_ventas where mes = '2026-10-01' and vendedor = 'Winifergomez' and monto = 2500000.46),
      'guardadas ' || v_n);
  exception when others then insert into t_res values (default, 'admin', '2. Guardar metas', false, sqlerrm); end;
  begin
    v_n := pos_metas_guardar('2026-10-01', '[{"vendedor":"","monto":3200000}]'::jsonb);
    insert into t_res values (default, 'admin', '3. Volver a guardar el mes reemplaza: sube la del negocio y quita la del vendedor',
      v_n = 1 and (select count(*) from pos_metas_ventas where mes = '2026-10-01') = 1
      and (select monto from pos_metas_ventas where mes = '2026-10-01' and vendedor = '') = 3200000, 'guardadas ' || v_n);
  exception when others then insert into t_res values (default, 'admin', '3. Reemplazar el mes', false, sqlerrm); end;
  begin
    v_n := pos_metas_guardar('2026-11-01', '[]'::jsonb);
    insert into t_res values (default, 'admin', '4. Guardar un mes sin metas no toca otros meses',
      v_n = 0 and (select count(*) from pos_metas_ventas where mes = '2026-10-01') = 1, null);
  exception when others then insert into t_res values (default, 'admin', '4. Mes vacío', false, sqlerrm); end;
  begin perform pos_metas_guardar('2026-10-01', '{"vendedor":""}'::jsonb); insert into t_res values (default, 'admin', '5. Rechaza un formato que no es lista', false, 'NO lo rechazó');
  exception when others then insert into t_res values (default, 'admin', '5. Rechaza un formato que no es lista', sqlerrm like '%METAS_FORMATO%', sqlerrm); end;
  begin perform pos_metas_guardar('2026-10-01', '[{"vendedor":"","monto":"abc"}]'::jsonb); insert into t_res values (default, 'admin', '6. Rechaza un monto que no es número', false, 'NO lo rechazó');
  exception when others then insert into t_res values (default, 'admin', '6. Rechaza un monto que no es número', sqlerrm like '%METAS_MONTO%', sqlerrm); end;
  begin
    v_n := pos_metas_guardar('2026-12-01', jsonb_build_array(jsonb_build_object('vendedor', E'\tAna\n', 'monto', 10), jsonb_build_object('vendedor', repeat('a', 119) || ' bcd', 'monto', 20)));
    insert into t_res values (default, 'admin', '6b. Nombres con tabulador o largos (corte en un espacio) se limpian y se guardan',
      v_n = 2 and exists (select 1 from pos_metas_ventas where mes = '2026-12-01' and vendedor = 'Ana') and exists (select 1 from pos_metas_ventas where mes = '2026-12-01' and vendedor = repeat('a', 119)),
      'guardadas ' || v_n);
  exception when others then insert into t_res values (default, 'admin', '6b. Nombres con tabulador o largos', false, sqlerrm); end;
  insert into t_res values (default, 'admin', '7. Después del error la meta del mes sigue igual',
    (select count(*) from pos_metas_ventas where mes = '2026-10-01') = 1 and (select monto from pos_metas_ventas where mes = '2026-10-01' and vendedor = '') = 3200000, null);
  begin insert into pos_metas_ventas (organizacion_id, mes, vendedor, monto) values (mi_organizacion(), '2026-12-01', '', 1);
    insert into t_res values (default, 'admin', '8. Nadie escribe la tabla directo (ni el administrador)', false, 'NO lo bloqueó');
  exception when others then insert into t_res values (default, 'admin', '8. Nadie escribe la tabla directo (ni el administrador)', sqlerrm like '%permission denied%', sqlerrm); end;
end $$;
reset role;

-- ── GERENTE (Winifergomez) ──
do $$ begin perform set_config('request.jwt.claims', '{"sub":"1dfe9d84-c98f-4a51-b77e-da2e2e553211","role":"authenticated"}', true); end $$;
set local role authenticated;
do $$
begin
  insert into t_res values (default, 'gerente', '9. La sesión es de gerente', mi_rol() = 'gerente', 'rol ' || coalesce(mi_rol(), '—'));
  insert into t_res values (default, 'gerente', '10. El gerente ve la meta (para el tablero)', (select count(*) from pos_metas_ventas where mes = '2026-10-01') = 1, null);
  begin perform pos_metas_guardar('2026-10-01', '[{"vendedor":"Winifergomez","monto":1}]'::jsonb);
    insert into t_res values (default, 'gerente', '11. El gerente NO define metas', false, 'NO lo bloqueó');
  exception when others then insert into t_res values (default, 'gerente', '11. El gerente NO define metas', sqlerrm like '%METAS_SOLO_ADMIN%', sqlerrm); end;
end $$;
reset role;

-- ── CAJERA ERIKA ──
do $$ begin perform set_config('request.jwt.claims', '{"sub":"9b5d1b70-5347-4df8-a11b-ac8a65211b47","role":"authenticated"}', true); end $$;
set local role authenticated;
do $$
begin
  insert into t_res values (default, 'cajera', '12. La sesión es de cajera', mi_rol() = 'cajero', 'rol ' || coalesce(mi_rol(), '—'));
  begin update pos_metas_ventas set monto = 1; insert into t_res values (default, 'cajera', '13. No cambia metas', false, 'NO lo bloqueó');
  exception when others then insert into t_res values (default, 'cajera', '13. No cambia metas', sqlerrm like '%permission denied%', sqlerrm); end;
  begin delete from pos_metas_ventas; insert into t_res values (default, 'cajera', '14. No borra metas', false, 'NO lo bloqueó');
  exception when others then insert into t_res values (default, 'cajera', '14. No borra metas', sqlerrm like '%permission denied%', sqlerrm); end;
  begin perform pos_metas_guardar('2026-10-01', '[]'::jsonb); insert into t_res values (default, 'cajera', '15. No guarda metas con la función', false, 'NO lo bloqueó');
  exception when others then insert into t_res values (default, 'cajera', '15. No guarda metas con la función', sqlerrm like '%METAS_SOLO_ADMIN%', sqlerrm); end;
end $$;
reset role;

-- ── SIN SESIÓN (anon) ──
do $$ begin perform set_config('request.jwt.claims', '', true); end $$;
set local role anon;
do $$
begin
  begin perform count(*) from pos_metas_ventas; insert into t_res values (default, 'anon', '16. Sin sesión no se leen las metas', false, 'NO lo bloqueó');
  exception when others then insert into t_res values (default, 'anon', '16. Sin sesión no se leen las metas', sqlerrm like '%permission denied%', sqlerrm); end;
  begin perform pos_metas_guardar('2026-10-01', '[]'::jsonb); insert into t_res values (default, 'anon', '17. Sin sesión no se guardan metas', false, 'NO lo bloqueó');
  exception when others then insert into t_res values (default, 'anon', '17. Sin sesión no se guardan metas', sqlerrm like '%permission denied%' or sqlerrm like '%METAS_SOLO_ADMIN%', sqlerrm); end;
end $$;
reset role;

do $$ begin
  raise exception E'RESULTADO_PRUEBA_53\n%', (select string_agg(case when ok then 'OK   ' else 'FALLA' end || ' | ' || rol || ' | ' || caso || ' | ' || left(coalesce(detalle, ''), 140), E'\n' order by n) from t_res);
end $$;
