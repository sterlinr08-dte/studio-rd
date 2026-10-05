-- 47 · Usuario ↔ Empleado (dueño 05-oct-2026: «cómo se enlaza ese módulo con el de entidad-empleado» → «Sí»).
-- Proyecto STUDIO RD (edbknlkjnlfmkkiizdbe). Un usuario del sistema apunta a su ficha de empleado de RRHH
-- (rrhh_empleados, que a su vez se enlaza con Entidades por entidad_id). Una ficha de empleado tiene a lo sumo un usuario.
-- No toca datos: los usuarios existentes quedan sin enlazar hasta que el administrador los vincule (herramienta
-- «Vincular por nombre» en Ajustes → Equipo, con revisión).
alter table public.usuarios_sistema
  add column if not exists empleado_id uuid references public.rrhh_empleados(id) on delete set null;
create unique index if not exists usuarios_sistema_empleado_unico
  on public.usuarios_sistema (empleado_id) where empleado_id is not null;
