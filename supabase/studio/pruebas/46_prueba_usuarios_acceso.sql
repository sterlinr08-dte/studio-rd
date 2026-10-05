-- Prueba de la migración 46 (Usuarios y acceso). Termina en error a propósito: todo se deshace, no deja nada.
-- Roles reales simulados con request.jwt.claims: una cajera, un gerente y el administrador.
begin;
create temp table t_res (n serial, rol text, caso text, ok boolean, detalle text);
grant all on t_res to authenticated, anon; grant usage on sequence t_res_n_seq to authenticated, anon;

-- La migración, tal cual el archivo supabase/46_usuarios_acceso.sql
alter table public.usuarios_sistema add column if not exists telefono text;
create or replace function public.mi_usuario()
returns table (organizacion_id uuid, almacen_id uuid)
language sql stable security definer set search_path = public
as $$
  select us.organizacion_id, us.almacen_id
  from public.profiles p
  join public.usuarios_sistema us on us.id = p.usuario_sistema_id
  where p.id = auth.uid() and coalesce(p.activo, true) and coalesce(us.activo, true)
  limit 1
$$;
revoke all on function public.mi_usuario() from public, anon;
grant execute on function public.mi_usuario() to authenticated;
alter policy pos_acceso_admin on public.pos_acceso
  using ((public.mi_rol() = 'admin') and (organizacion_id = public.mi_organizacion()))
  with check ((public.mi_rol() = 'admin') and ((organizacion_id is null) or (organizacion_id = public.mi_organizacion())));

-- ── CAJERA ──
select set_config('request.jwt.claims', '{"sub":"9b5d1b70-5347-4df8-a11b-ac8a65211b47","role":"authenticated"}', true);
set local role authenticated;
do $$ declare v_n int; v_alm uuid; begin
  select count(*) into v_n from public.usuarios_sistema;
  insert into t_res values (default,'cajero','sigue sin leer la tabla de usuarios', v_n = 0, v_n || ' filas');
  select almacen_id into v_alm from public.mi_usuario();
  insert into t_res values (default,'cajero','mi_usuario() da su almacén', v_alm is not null, coalesce(v_alm::text,'null'));
  begin update public.pos_acceso set label = label where rol = 'cajero';
    insert into t_res values (default,'cajero','no cambia permisos por rol', not found, 'filas tocadas: ' || (case when found then 'sí' else '0' end));
  exception when others then insert into t_res values (default,'cajero','no cambia permisos por rol', true, sqlerrm); end;
end $$;
reset role;

-- ── GERENTE ──
select set_config('request.jwt.claims', '{"sub":"bcd6eb60-f35d-4fd0-a7d6-7991914cf956","role":"authenticated"}', true);
set local role authenticated;
do $$ declare v_n int; begin
  select count(*) into v_n from public.pos_acceso;
  insert into t_res values (default,'gerente','sigue leyendo los permisos por rol', v_n > 0, v_n || ' roles');
  update public.pos_acceso set modulos = modulos where rol = 'gerente';
  insert into t_res values (default,'gerente','ya NO puede cambiar los permisos (darse Ajustes)', not found, case when found then 'PUDO' else 'bloqueado' end);
  begin insert into public.pos_acceso (rol, label, modulos, organizacion_id) values ('rol_x','X','["ajustes"]'::jsonb, public.mi_organizacion());
    insert into t_res values (default,'gerente','ya NO puede crear un rol', false, 'PUDO');
  exception when others then insert into t_res values (default,'gerente','ya NO puede crear un rol', true, sqlerrm); end;
end $$;
reset role;

-- ── ADMIN ──
select set_config('request.jwt.claims', '{"sub":"25bea4e1-2241-4480-a52e-447dad70c191","role":"authenticated"}', true);
set local role authenticated;
do $$ declare v_n int; begin
  update public.pos_acceso set modulos = modulos where rol = 'gerente';
  insert into t_res values (default,'admin','sigue cambiando los permisos por rol', found, '');
  select count(*) into v_n from public.usuarios_sistema;
  insert into t_res values (default,'admin','sigue viendo los usuarios', v_n > 0, v_n || ' usuarios');
  update public.usuarios_sistema set telefono = telefono where id = (select usuario_sistema_id from public.profiles where id = auth.uid());
  insert into t_res values (default,'admin','columna telefono disponible', found, '');
end $$;
reset role;

-- ── ANÓNIMO ──
set local role anon;
do $$ begin
  begin perform * from public.mi_usuario(); insert into t_res values (default,'anon','no puede llamar mi_usuario()', false, 'PUDO');
  exception when others then insert into t_res values (default,'anon','no puede llamar mi_usuario()', true, sqlerrm); end;
end $$;
reset role;

do $$ begin
  raise exception E'RESULTADOS 46\n%', (select string_agg(case when ok then 'OK   ' else 'FALLA' end || ' · ' || rol || ' · ' || caso || coalesce(' · ' || nullif(left(detalle, 100), ''), ''), E'\n' order by n) from t_res);
end $$;
