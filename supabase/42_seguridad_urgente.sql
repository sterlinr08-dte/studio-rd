-- 42_seguridad_urgente.sql — STUDIO RD (02-oct-2026). Hallazgos críticos de la auditoría de Configuración.
-- Solo permisos (GRANT/REVOKE y políticas RESTRICTIVAS nuevas): no borra políticas ni toca datos.
--
-- 1) CRÍTICO — cualquier usuario podía hacerse administrador: la política profiles_self_update deja a cada quien
--    editar su propia fila y authenticated tenía UPDATE en TODAS las columnas (rol, usuario_sistema_id, agente_id…).
--    Un cajero con un PATCH a /rest/v1/profiles cambiaba su rol a 'admin'; mi_rol() lee esa columna.
--    El navegador solo escribe must_change_password (index.html:6285) → solo esa columna queda editable.
--    crear-usuario-staff usa la clave de servicio (no le afecta).
-- 2) ALTO — la auditoría se podía editar y borrar por cualquier rol (política ALL + permisos DELETE/UPDATE/TRUNCATE).
--    Queda: leer e insertar. Nadie en el código actualiza ni borra auditoría.
-- 3) ALTO — cualquier rol podía cambiar pos_config (mora, banderas, contrato, datos legales) llamando a la API.
--    Política restrictiva: crear/cambiar/borrar solo admin y gerente. Leer sigue igual (todos la necesitan).
-- Reversa: grant update on public.profiles to authenticated; grant delete, update, truncate on public.auditoria to
--          authenticated; drop policy pos_config_solo_admin_* (3).

begin;

-- 1) profiles: solo la marca de «cambiar contraseña»
revoke update on public.profiles from authenticated, anon;
grant update (must_change_password) on public.profiles to authenticated;

-- 2) auditoría: solo leer e insertar
revoke update, delete, truncate on public.auditoria from authenticated, anon;

-- 3) pos_config: escribir solo admin y gerente
create policy pos_config_solo_admin_ins on public.pos_config as restrictive for insert
  with check ((select public.mi_rol()) in ('admin','gerente'));
create policy pos_config_solo_admin_upd on public.pos_config as restrictive for update
  using ((select public.mi_rol()) in ('admin','gerente'));
create policy pos_config_solo_admin_del on public.pos_config as restrictive for delete
  using ((select public.mi_rol()) in ('admin','gerente'));

commit;
