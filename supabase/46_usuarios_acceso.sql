-- 46 · Usuarios y acceso (dueño 05-oct-2026: «organízame eso»; maqueta aprobada «Visto bueno»).
-- Proyecto STUDIO RD (edbknlkjnlfmkkiizdbe). No toca datos existentes: solo agrega una columna, una función de lectura
-- y endurece quién puede escribir los permisos por rol.

-- 1) WhatsApp del empleado, para enviarle su acceso (lo escribe la función crear-usuario-staff v4; solo admin lo lee).
alter table public.usuarios_sistema add column if not exists telefono text;

-- 2) Cada usuario lee SU organización y SU almacén. Antes la tabla solo la leía el administrador (RLS), así que a
--    cajeros y vendedores nunca se les aplicaba el «Almacén asignado» al facturar. Función de solo lectura con dos
--    columnas: no abre la tabla (que guarda hashes de claves viejas).
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

-- 3) Permisos por rol: solo el administrador los cambia. Antes también el gerente, que podía darse a sí mismo
--    «Ajustes» (auditoría 02-oct-2026). Leerlos sigue igual (pos_acceso_select).
alter policy pos_acceso_admin on public.pos_acceso
  using ((public.mi_rol() = 'admin') and (organizacion_id = public.mi_organizacion()))
  with check ((public.mi_rol() = 'admin') and ((organizacion_id is null) or (organizacion_id = public.mi_organizacion())));
