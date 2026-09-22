-- STUDIO · 17_auditoria_hardening.sql — aplicado el 2026-09-22 (auditoría post-migración)
-- 1) PostgREST devolvía como máximo 1000 filas por petición (valor por defecto). Con los datos migrados
--    varias pantallas piden más (renglones de venta 3.827, niveles de precio 1.554, asientos 4.747, ventas 1.396)
--    y quedaban truncadas en silencio: reportes, precios mayoristas y contabilidad incompletos.
alter role authenticator set pgrst.db_max_rows = '20000';
notify pgrst, 'reload config';

-- 2) Funciones SECURITY DEFINER: solo usuarios autenticados y service_role (anon no tiene flujo en STUDIO).
do $$ declare r record; begin
  for r in select p.oid, p.proname, pg_get_function_identity_arguments(p.oid) args
           from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef loop
    execute format('revoke execute on function public.%I(%s) from public, anon', r.proname, r.args);
    execute format('grant execute on function public.%I(%s) to authenticated, service_role', r.proname, r.args);
  end loop;
end $$;

-- 3) search_path fijo en funciones señaladas por el advisor de seguridad.
do $$ declare r record; begin
  for r in select p.oid, p.proname, pg_get_function_identity_arguments(p.oid) args from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='public' and p.proname in ('pos_fin_render_plantilla','pos_fin_fmt_monto') loop
    execute format('alter function public.%I(%s) set search_path = public', r.proname, r.args);
  end loop;
end $$;

-- 4) RLS de profiles: auth.uid() evaluado una vez por consulta (advisor de rendimiento).
drop policy if exists profiles_self_read on public.profiles;
drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_read on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy profiles_self_update on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- 5) Índices en claves foráneas y filtros con uso real.
create index if not exists idx_pos_abonos_venta on public.pos_abonos(venta_id);
create index if not exists idx_pos_abonos_caja on public.pos_abonos(caja_id);
create index if not exists idx_pos_abonos_cliente on public.pos_abonos(cliente_id);
create index if not exists idx_pos_ventas_caja on public.pos_ventas(caja_id);
create index if not exists idx_pos_ventas_cliente on public.pos_ventas(cliente_id);
create index if not exists idx_pos_ventas_fecha on public.pos_ventas(fecha desc);
create index if not exists idx_pos_venta_items_venta on public.pos_venta_items(venta_id);
create index if not exists idx_pos_venta_items_producto on public.pos_venta_items(producto_id);
create index if not exists idx_pos_seriales_producto_estado on public.pos_seriales(producto_id, estado);
create index if not exists idx_pos_banco_mov_cuenta on public.pos_banco_movimientos(cuenta_bancaria_id);
create index if not exists idx_pos_compra_pagos_compra on public.pos_compra_pagos(compra_id);
create index if not exists idx_pos_apartado_pagos_apartado on public.pos_apartado_pagos(apartado_id);
create index if not exists idx_pos_rep_piezas_reparacion on public.pos_reparacion_piezas(reparacion_id);
create index if not exists idx_pos_rep_piezas_producto on public.pos_reparacion_piezas(producto_id);
create index if not exists idx_profiles_usuario_sistema on public.profiles(usuario_sistema_id);
create index if not exists idx_pos_cajas_usuario on public.pos_cajas(usuario_id);
create index if not exists idx_pos_inv_mov_producto_fecha on public.pos_inv_movimientos(producto_id, fecha desc);

-- 6) Cargador temporal de la migración retirado (el flujo queda documentado en 16_migracion_legacy.sql).
drop function if exists legacy.descargar(text, bigint, int);
drop function if exists legacy.recoger();
drop function if exists legacy.cargar_dump();
drop table if exists legacy._raw;
drop table if exists legacy._token;
