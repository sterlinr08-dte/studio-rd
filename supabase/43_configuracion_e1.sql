-- 43_configuracion_e1.sql — STUDIO RD (02-oct-2026). Módulo Configuración, etapa 1 (dueño: «sí» a la propuesta).
-- Bitácora: 2026-10-02-0850-claude (auditoría) y la de esta etapa.
--   1. Datos de la empresa en pos_config (nombre, RNC, teléfono, dirección, correo, pie de factura): hasta hoy no
--      existían en STUDIO y las facturas con NCF salían sin el RNC de quien emite.
--   2. Usuarios: un usuario desactivado ya no tiene rol (mi_rol() = null → la base no le muestra ni deja hacer nada),
--      aunque conserve una sesión abierta. Hoy los 16 perfiles están activos: no cambia nada para nadie.
--   3. usuarios_sistema: el administrador ve y edita solo los usuarios de SU empresa (antes no filtraba por empresa).
--   4. Historial de cambios de configuración en el servidor: cada cambio de pos_config deja en auditoría quién,
--      cuándo, qué campos y el valor anterior y el nuevo (antes solo algunos botones lo anotaban desde el navegador).
-- No toca dinero, ventas ni datos existentes.

begin;

-- ── 1. Empresa ───────────────────────────────────────────────────────────────────────────────────────────────────
alter table public.pos_config
  add column if not exists emp_nombre text,
  add column if not exists emp_rnc text,
  add column if not exists emp_telefono text,
  add column if not exists emp_direccion text,
  add column if not exists emp_email text,
  add column if not exists emp_pie_factura text;

-- ── 2. Usuario desactivado = sin rol ─────────────────────────────────────────────────────────────────────────────
create or replace function public.mi_rol()
returns text language sql stable security definer set search_path to 'public' as $$
  select rol from public.profiles where id = auth.uid() and coalesce(activo, true)
$$;

-- ── 3. Usuarios: solo los de mi empresa ──────────────────────────────────────────────────────────────────────────
alter policy all_usuarios_sistema on public.usuarios_sistema
  using ((select public.mi_rol()) = 'admin' and organizacion_id = (select public.mi_organizacion()))
  with check ((select public.mi_rol()) = 'admin' and organizacion_id = (select public.mi_organizacion()));

-- ── 4. Historial de cambios de configuración ─────────────────────────────────────────────────────────────────────
create or replace function public.pos_config_auditar()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_old jsonb := to_jsonb(old); v_new jsonb := to_jsonb(new); v_ant jsonb := '{}'; v_nue jsonb := '{}'; k text;
        v_quien text; v_rol text;
begin
  for k in select jsonb_object_keys(v_new) loop
    if k not in ('organizacion_id', 'created_at') and (v_old -> k) is distinct from (v_new -> k) then
      -- El texto del contrato es largo: se anota que cambió, no el texto completo.
      if k = 'fin_contrato_plantilla' then
        v_ant := v_ant || jsonb_build_object(k, length(coalesce(old.fin_contrato_plantilla, '')) || ' caracteres');
        v_nue := v_nue || jsonb_build_object(k, length(coalesce(new.fin_contrato_plantilla, '')) || ' caracteres');
      else
        v_ant := v_ant || jsonb_build_object(k, v_old -> k);
        v_nue := v_nue || jsonb_build_object(k, v_new -> k);
      end if;
    end if;
  end loop;
  if v_nue = '{}'::jsonb then return new; end if;
  select p.nom, p.rol into v_quien, v_rol from public.profiles p where p.id = auth.uid();
  insert into public.auditoria (ts, usuario, rol, accion, detalle, modulo, user_id, entity_table, entity_id, old_data, new_data, organizacion_id, origen)
  values (to_char(now() at time zone 'America/Santo_Domingo', 'YYYY-MM-DD HH24:MI:SS'), coalesce(v_quien, 'sistema'), v_rol,
          'CONFIG_CAMBIO', 'Configuración: ' || (select string_agg(x, ', ') from jsonb_object_keys(v_nue) x), 'Configuración',
          auth.uid()::text, 'pos_config', new.organizacion_id::text, v_ant::text, v_nue::text, new.organizacion_id, 'servidor');
  return new;
end $$;

create or replace trigger trg_pos_config_auditar after update on public.pos_config
  for each row execute function public.pos_config_auditar();

commit;
