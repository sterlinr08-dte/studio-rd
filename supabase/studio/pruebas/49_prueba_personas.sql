-- Prueba de la migración 49 (personas enlazadas). Termina en error a propósito: todo se deshace, no deja nada.
-- Corrida el 06-oct-2026 en la base real: 16 de 16 OK.
begin;
set local lock_timeout = '5s'; set local statement_timeout = '45s';
create temp table t_res (n serial, caso text, ok boolean, detalle text);
grant all on t_res to authenticated, anon; grant usage on sequence t_res_n_seq to authenticated, anon;
-- La migración (sin los drop … if exists, que en una base limpia solo avisan)


alter table public.rrhh_empleados add column if not exists comision_pct numeric;

-- ── Freno para que la copia Entidad ↔ Empleado no rebote ──
create or replace function public.nx_sync_activo() returns boolean language sql stable as
$$ select coalesce(current_setting('nx.sync_persona', true), '') = '1' $$;

-- 1 y 3: Empleado → Entidad
create or replace function public.rrhh_empleado_a_entidad()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_ent uuid;
begin
  if public.nx_sync_activo() then return null; end if;
  perform set_config('nx.sync_persona', '1', true);
  if new.entidad_id is null then
    insert into public.pos_clientes (nombre, cedula, telefono, codigo, es_empleado, es_cliente, organizacion_id)
    values (new.nombre, new.cedula, new.telefono, 'EM-' || coalesce(new.codigo, ''), true, false, new.organizacion_id)
    returning id into v_ent;
    update public.rrhh_empleados set entidad_id = v_ent where id = new.id;
  elsif tg_op = 'INSERT' or new.nombre is distinct from old.nombre or new.cedula is distinct from old.cedula
        or new.telefono is distinct from old.telefono or new.entidad_id is distinct from old.entidad_id then
    update public.pos_clientes c
       set nombre = new.nombre, cedula = coalesce(new.cedula, c.cedula), telefono = coalesce(new.telefono, c.telefono), es_empleado = true
     where c.id = new.entidad_id;
  end if;
  perform set_config('nx.sync_persona', '', true);
  return null;
end $$;

-- 2 y 3: Entidad → Empleado
create or replace function public.pos_entidad_a_empleado()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_emp public.rrhh_empleados%rowtype;
begin
  if public.nx_sync_activo() then return null; end if;
  if tg_op = 'INSERT' and not new.es_empleado then return null; end if;   -- clientes, proveedores, bancos: nada que hacer
  perform set_config('nx.sync_persona', '1', true);
  select * into v_emp from public.rrhh_empleados where entidad_id = new.id limit 1;
  if new.es_empleado then
    if v_emp.id is null then
      insert into public.rrhh_empleados (entidad_id, nombre, cedula, telefono, activo, organizacion_id)
      values (new.id, new.nombre, new.cedula, new.telefono, true, new.organizacion_id)
      returning * into v_emp;
      -- la Entidad toma el código del empleado (EM-017) si no tenía uno propio o era un EM- provisional
      if new.codigo is null or new.codigo ~ '^EM-\d*$' then
        update public.pos_clientes set codigo = 'EM-' || v_emp.codigo where id = new.id;
      end if;
    else
      update public.rrhh_empleados e
         set nombre = new.nombre, cedula = coalesce(new.cedula, e.cedula), telefono = coalesce(new.telefono, e.telefono),
             activo = case when tg_op = 'UPDATE' and not old.es_empleado then true else e.activo end
       where e.id = v_emp.id;
    end if;
  elsif tg_op = 'UPDATE' and old.es_empleado and v_emp.id is not null then
    perform set_config('nx.sync_persona', '', true);      -- deja correr el paso 5 (quitar el acceso)
    update public.rrhh_empleados set activo = false where id = v_emp.id and activo;
  end if;
  perform set_config('nx.sync_persona', '', true);
  return null;
end $$;

-- 4: Usuario nuevo → Empleado (y por el paso 1, su Entidad)
create or replace function public.usuario_a_empleado()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_id uuid;
begin
  if new.empleado_id is null then
    insert into public.rrhh_empleados (nombre, telefono, puesto, activo, organizacion_id)
    values (coalesce(nullif(btrim(new.nom), ''), new.login), new.telefono, nullif(btrim(coalesce(new.cargo, '')), ''), coalesce(new.activo, true), new.organizacion_id)
    returning id into v_id;
    new.empleado_id := v_id;
  end if;
  return new;
end $$;

-- 5: Empleado desactivado → su usuario pierde el acceso
create or replace function public.rrhh_empleado_quita_acceso()
returns trigger language plpgsql security definer set search_path = public
as $$
declare u record;
begin
  if not (old.activo and not new.activo) then return null; end if;
  for u in select * from public.usuarios_sistema where empleado_id = new.id and activo loop
    if u.rol = 'admin' and not exists (select 1 from public.usuarios_sistema x where x.organizacion_id = u.organizacion_id
                                        and x.rol = 'admin' and x.activo and x.id <> u.id) then
      continue;                                             -- nunca dejar la empresa sin administrador activo
    end if;
    update public.usuarios_sistema set activo = false, updated_at = now() where id = u.id;
    update public.profiles set activo = false where usuario_sistema_id = u.id;
  end loop;
  return null;
end $$;

revoke all on function public.rrhh_empleado_a_entidad() from public, anon, authenticated;
revoke all on function public.pos_entidad_a_empleado() from public, anon, authenticated;
revoke all on function public.usuario_a_empleado() from public, anon, authenticated;
revoke all on function public.rrhh_empleado_quita_acceso() from public, anon, authenticated;

create trigger trg_persona_empleado_entidad after insert or update of nombre, cedula, telefono, entidad_id on public.rrhh_empleados
  for each row execute function public.rrhh_empleado_a_entidad();
create trigger trg_persona_entidad_empleado after insert or update of nombre, cedula, telefono, es_empleado on public.pos_clientes
  for each row execute function public.pos_entidad_a_empleado();
create trigger trg_persona_usuario_empleado before insert on public.usuarios_sistema
  for each row execute function public.usuario_a_empleado();
create trigger trg_persona_quita_acceso after update of activo on public.rrhh_empleados
  for each row execute function public.rrhh_empleado_quita_acceso();

-- 6: lista del personal para cualquier usuario activo de la empresa (sin salarios ni datos bancarios)
create or replace function public.pos_personal()
returns table (empleado_id uuid, codigo text, nombre text, telefono text, puesto text, comision_pct numeric,
               activo boolean, usuario_id uuid, usuario_activo boolean, rol text, soy_yo boolean)
language sql stable security definer set search_path = public
as $$
  select e.id, e.codigo, e.nombre, e.telefono, e.puesto, e.comision_pct, coalesce(e.activo, true),
         u.id, u.activo, u.rol,
         u.id is not null and u.id = (select p.usuario_sistema_id from public.profiles p where p.id = auth.uid())
  from public.rrhh_empleados e
  left join public.usuarios_sistema u on u.empleado_id = e.id
  where public.mi_rol() is not null and e.organizacion_id = public.mi_organizacion()
  order by e.codigo nulls last, e.nombre
$$;
revoke all on function public.pos_personal() from public, anon;
grant execute on function public.pos_personal() to authenticated;

-- ── Datos actuales ──
-- Empleado (y Entidad) del usuario administrador, que era el único usuario sin empleado.
with nuevos as (
  insert into public.rrhh_empleados (nombre, telefono, puesto, activo, organizacion_id)
  select coalesce(nullif(btrim(u.nom), ''), u.login), u.telefono, nullif(btrim(coalesce(u.cargo, '')), ''), coalesce(u.activo, true), u.organizacion_id
  from public.usuarios_sistema u where u.empleado_id is null
  returning id, nombre, organizacion_id
)
update public.usuarios_sistema u set empleado_id = n.id
from nuevos n where u.empleado_id is null and u.organizacion_id = n.organizacion_id
  and coalesce(nullif(btrim(u.nom), ''), u.login) = n.nombre;

-- Entidad de cada empleado que no tiene una (los 16 actuales; el del administrador ya la creó el disparador).
do $$
declare e record; v_ent uuid;
begin
  perform set_config('nx.sync_persona', '1', true);
  for e in select * from public.rrhh_empleados where entidad_id is null order by codigo loop
    insert into public.pos_clientes (nombre, cedula, telefono, codigo, es_empleado, es_cliente, organizacion_id)
    values (e.nombre, e.cedula, e.telefono, 'EM-' || coalesce(e.codigo, ''), true, false, e.organizacion_id)
    returning id into v_ent;
    update public.rrhh_empleados set entidad_id = v_ent where id = e.id;
  end loop;
  perform set_config('nx.sync_persona', '', true);
end $$;

do $$ declare a int; b int; c int; d text; begin
  select count(*), count(entidad_id) into a, b from public.rrhh_empleados;
  insert into t_res values (default, 'todos los empleados con Entidad', a = b and a = 17, b || ' de ' || a);
  select count(*) into c from public.pos_clientes where es_empleado;
  insert into t_res values (default, 'Entidades marcadas Empleado', c = 17, c || '');
  select string_agg(c2.codigo || ' ' || c2.nombre, ', ' order by c2.codigo) into d from (select * from public.pos_clientes where es_empleado order by codigo limit 3) c2;
  insert into t_res values (default, 'códigos de Entidad EM-…', d like 'EM-001 %', d);
  select e.codigo || ' ' || e.nombre into d from public.usuarios_sistema u join public.rrhh_empleados e on e.id = u.empleado_id where u.login = 'admin';
  insert into t_res values (default, 'el usuario admin tiene su propio empleado', d like '017 ADMINISTRADOR%', d);
  select count(*) into a from public.usuarios_sistema where empleado_id is null;
  insert into t_res values (default, 'ningún usuario sin empleado', a = 0, a || '');
  select count(*) into a from public.pos_clientes where es_empleado and es_cliente;
  insert into t_res values (default, 'las Entidades de empleados no son clientes', a = 0, a || '');
end $$;

-- ── como el administrador (RLS real) ──
select set_config('request.jwt.claims', '{"sub":"25bea4e1-2241-4480-a52e-447dad70c191","role":"authenticated"}', true);
set local role authenticated;
do $$ declare v_e uuid; v_ent uuid; d text; v_c uuid; v_us uuid; v_act boolean; v_pact boolean; begin
  insert into public.rrhh_empleados (nombre, telefono, activo) values ('QA Empleado Nuevo', '8095550001', true) returning id into v_e;
  select c.codigo || ' ' || c.nombre || ' ' || c.telefono || ' emp=' || c.es_empleado into d from public.pos_clientes c join public.rrhh_empleados e on e.entidad_id = c.id where e.id = v_e;
  insert into t_res values (default, 'empleado nuevo → su Entidad', d = 'EM-018 QA Empleado Nuevo 8095550001 emp=true', d);
  update public.rrhh_empleados set telefono = '8095550002', nombre = 'QA Empleado Renombrado' where id = v_e;
  select c.nombre || ' ' || c.telefono into d from public.pos_clientes c join public.rrhh_empleados e on e.entidad_id = c.id where e.id = v_e;
  insert into t_res values (default, 'cambio en el empleado → la Entidad', d = 'QA Empleado Renombrado 8095550002', d);
  insert into public.pos_clientes (nombre, cedula, telefono, codigo, es_empleado, es_cliente) values ('QA Desde Entidad', '00100000001', '8095550003', 'EM-0001', true, false) returning id into v_c;
  select e.codigo || ' ' || e.nombre || ' ' || e.cedula || ' / ' || c.codigo into d from public.rrhh_empleados e join public.pos_clientes c on c.id = e.entidad_id where c.id = v_c;
  insert into t_res values (default, 'Entidad marcada Empleado → su ficha de RRHH', d = '019 QA Desde Entidad 00100000001 / EM-019', d);
  update public.pos_clientes set nombre = 'QA Entidad Renombrada' where id = v_c;
  select e.nombre into d from public.rrhh_empleados e where e.entidad_id = v_c;
  insert into t_res values (default, 'cambio en la Entidad → el empleado', d = 'QA Entidad Renombrada', d);
  update public.pos_clientes set es_empleado = false where id = v_c;
  select e.activo::text into d from public.rrhh_empleados e where e.entidad_id = v_c;
  insert into t_res values (default, 'quitar «Empleado» a la Entidad → ficha inactiva', d = 'false', d);
  insert into public.pos_clientes (nombre, telefono, es_cliente) values ('QA Cliente Normal', '8095550009', true) returning id into v_c;
  select count(*)::text into d from public.rrhh_empleados where entidad_id = v_c;
  insert into t_res values (default, 'un cliente normal no crea empleado', d = '0', d);
  -- empleado con usuario (SAMUEL PEÑA, vendedor) desactivado → pierde el acceso
  select u.id into v_us from public.usuarios_sistema u where u.login = 'samuel';
  update public.rrhh_empleados set activo = false where id = (select empleado_id from public.usuarios_sistema where id = v_us);
  select u.activo, coalesce(bool_and(p.activo), false) into v_act, v_pact from public.usuarios_sistema u left join public.profiles p on p.usuario_sistema_id = u.id where u.id = v_us group by u.activo;
  insert into t_res values (default, 'empleado desactivado → su usuario sin acceso', not v_act and not v_pact, 'usuario=' || v_act || ' perfil=' || v_pact);
end $$;
reset role;

-- usuario nuevo sin empleado (como lo crea la función crear-usuario-staff, con la llave de servicio)
do $$ declare v_u uuid; d text; begin
  insert into public.usuarios_sistema (nom, cargo, login, rol, activo, organizacion_id, telefono)
  values ('QA USUARIO NUEVO', 'vendedor', 'qa.nuevo', 'vendedor', true, (select organizacion_id from public.usuarios_sistema where login = 'admin'), '8095550004') returning id into v_u;
  select e.codigo || ' ' || e.nombre || ' / ' || c.codigo into d from public.usuarios_sistema u join public.rrhh_empleados e on e.id = u.empleado_id join public.pos_clientes c on c.id = e.entidad_id where u.id = v_u;
  insert into t_res values (default, 'usuario nuevo → su empleado y su Entidad', d like '020 QA USUARIO NUEVO / EM-020', d);
end $$;

-- ── como una cajera: ve el personal sin salarios ──
select set_config('request.jwt.claims', '{"sub":"9b5d1b70-5347-4df8-a11b-ac8a65211b47","role":"authenticated"}', true);
set local role authenticated;
do $$ declare a int; d text; begin
  select count(*), max(case when soy_yo then codigo || ' ' || nombre end) into a, d from public.pos_personal();
  insert into t_res values (default, 'pos_personal() para la cajera', a >= 17 and d is not null, a || ' personas; soy ' || coalesce(d, '?'));
end $$;
reset role;
set local role anon;
do $$ begin
  begin perform * from public.pos_personal(); insert into t_res values (default, 'anónimo no puede llamar pos_personal()', false, 'PUDO');
  exception when others then insert into t_res values (default, 'anónimo no puede llamar pos_personal()', true, left(sqlerrm, 60)); end;
end $$;
reset role;

do $$ begin
  raise exception E'RESULTADOS 49\n%', (select string_agg(case when ok then 'OK   ' else 'FALLA' end || ' · ' || caso || coalesce(' · ' || nullif(left(detalle, 140), ''), ''), E'\n' order by n) from t_res);
end $$;
