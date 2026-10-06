-- 49 · Una persona, una ficha: Entidad ↔ Empleado ↔ Usuario, y vendedores/técnicos desde los empleados
--      (dueño 06-oct-2026: «Automatiza entidad y empleado con todo lo relacionado al sistema»; marcó las 4 opciones:
--      Empleado = Entidad, Usuario nuevo = Empleado, Vendedores = Empleados, Técnicos = Empleados; el usuario
--      «ADMINISTRADOR STUDIO» y el empleado 001 «Super Admin» son personas distintas).
-- Proyecto STUDIO RD (edbknlkjnlfmkkiizdbe).
--
-- Antes: 16 empleados sin Entidad, 0 Entidades marcadas «Empleado», 15 de 16 usuarios enlazados a su empleado,
-- pos_vendedores vacía (las ventas no guardaban vendedor_id) y Reacondicionado leía los técnicos de usuarios_sistema,
-- que solo el administrador puede leer (a los demás les salía la lista vacía).
--
-- Lo hace la base (disparadores), no la pantalla:
--  1. Empleado nuevo → se crea su Entidad («EM-» + su código, marcada Empleado, no Cliente) y quedan enlazados.
--  2. Entidad marcada «Empleado» → se crea su ficha de RRHH. Si le quitan la marca, la ficha queda inactiva.
--  3. Nombre, cédula y teléfono se copian solos entre Entidad y Empleado (en los dos sentidos).
--  4. Usuario nuevo sin empleado → se crea su empleado (y con él su Entidad).
--  5. Empleado desactivado → su usuario pierde el acceso (usuarios_sistema y profiles inactivos; mi_rol() deja de
--     devolver rol y la RLS le cierra los datos). Nunca deja la empresa sin un administrador activo.
--     Reactivar al empleado NO devuelve el acceso solo: eso lo decide el administrador en Ajustes → Usuarios.
--  6. pos_personal(): lista de empleados con su código, usuario, rol y % de comisión, sin salarios, para cualquier
--     usuario activo de la empresa (vendedor al cobrar, técnicos de Reacondicionado, Reparaciones).
--  7. rrhh_empleados.comision_pct: el % de comisión ahora vive en el empleado.
-- Datos: crea las 16 Entidades de los empleados actuales y el empleado (con su Entidad) del usuario administrador.
-- No toca ventas ni datos históricos.

set lock_timeout = '10s';

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

drop trigger if exists trg_persona_empleado_entidad on public.rrhh_empleados;
create trigger trg_persona_empleado_entidad after insert or update of nombre, cedula, telefono, entidad_id on public.rrhh_empleados
  for each row execute function public.rrhh_empleado_a_entidad();
drop trigger if exists trg_persona_entidad_empleado on public.pos_clientes;
create trigger trg_persona_entidad_empleado after insert or update of nombre, cedula, telefono, es_empleado on public.pos_clientes
  for each row execute function public.pos_entidad_a_empleado();
drop trigger if exists trg_persona_usuario_empleado on public.usuarios_sistema;
create trigger trg_persona_usuario_empleado before insert on public.usuarios_sistema
  for each row execute function public.usuario_a_empleado();
drop trigger if exists trg_persona_quita_acceso on public.rrhh_empleados;
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
