-- 41_crm_permisos_rol.sql — STUDIO RD (02-oct-2026). El CRM por rol (decisión del dueño: «Por rol» + recomendación aceptada).
-- Dos permisos que se activan por rol en Ajustes → Permisos por rol (tabla pos_acceso.modulos):
--   · 'crm'          → Leads, Campañas, tareas (pos_crm, pos_crm_actividades);
--   · 'crm_bandeja'  → leer y responder WhatsApp/Instagram/Facebook (crm_conversaciones, crm_mensajes, archivos crm-media).
-- Reglas (iguales a las del navegador, parches-pos.js puedeVerBase/puedeCap):
--   · admin: todo; gerente: la Bandeja siempre;
--   · si el rol tiene fila en pos_acceso, manda esa fila;
--   · sin fila (roles por defecto): gerente y vendedor tienen los dos; cajero ninguno.
-- Antes cualquier rol de la organización (también el cajero) podía leer los chats llamando a la API directamente.
-- crm-enviar ya consulta la conversación con la sesión del usuario: sin 'crm_bandeja' responde «sin_permiso».
-- Se usa ALTER POLICY (sin ventana sin permisos). No toca mensajes, conversaciones ni dinero.
-- Reversa: volver a correr la sección 1 de 40_crm_afinado.sql y las políticas crm_media_* de 34_crm_bandeja.sql.

begin;

-- ── 1. ¿El usuario actual tiene este permiso del CRM? ───────────────────────────────────────────────────────────
create or replace function public.crm_permiso(p_cap text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  with r as (select public.mi_rol() as rol, public.mi_organizacion() as org),
       a as (select a.modulos from public.pos_acceso a, r where a.organizacion_id = r.org and a.rol = r.rol limit 1)
  select case
    when r.rol is null then false
    when r.rol = 'admin' then true
    when r.rol = 'gerente' and p_cap = 'crm_bandeja' then true
    when exists (select 1 from a) then coalesce((select a.modulos ? p_cap from a), false)
    else r.rol in ('gerente', 'vendedor') and p_cap in ('crm', 'crm_bandeja')
  end
  from r
$$;
revoke all on function public.crm_permiso(text) from public, anon;
grant execute on function public.crm_permiso(text) to authenticated;

-- Roles ya guardados con el CRM: conservan la Bandeja que hoy tienen (hoy 0 filas en pos_acceso; queda por si acaso).
update public.pos_acceso set modulos = modulos || '["crm_bandeja"]'::jsonb
 where modulos ? 'crm' and not modulos ? 'crm_bandeja';

-- ── 2. Políticas: mismas condiciones de 40 + el permiso del CRM ─────────────────────────────────────────────────
alter policy crm_conv_sel on public.crm_conversaciones
  using ((select public.crm_permiso('crm_bandeja')) and (select public.mi_rol()) is not null and organizacion_id = (select public.mi_organizacion())
         and ((select public.mi_rol()) in ('admin','gerente') or asignado_id is null or asignado_id = (select public.mi_usuario_id())));
alter policy crm_conv_upd on public.crm_conversaciones
  using ((select public.crm_permiso('crm_bandeja')) and (select public.mi_rol()) is not null and organizacion_id = (select public.mi_organizacion())
         and ((select public.mi_rol()) in ('admin','gerente') or asignado_id is null or asignado_id = (select public.mi_usuario_id())))
  with check ((select public.crm_permiso('crm_bandeja')) and organizacion_id = (select public.mi_organizacion()));
alter policy crm_msg_sel on public.crm_mensajes
  using ((select public.crm_permiso('crm_bandeja')) and (select public.mi_rol()) is not null and organizacion_id = (select public.mi_organizacion())
         and exists (select 1 from public.crm_conversaciones c where c.id = crm_mensajes.conversacion_id));
alter policy pos_crm_sel on public.pos_crm
  using ((select public.crm_permiso('crm')) and (select public.mi_rol()) is not null and organizacion_id = (select public.mi_organizacion())
         and ((select public.mi_rol()) in ('admin','gerente') or asignado_id is null or asignado_id = (select public.mi_usuario_id())));
alter policy pos_crm_upd on public.pos_crm
  using ((select public.crm_permiso('crm')) and (select public.mi_rol()) is not null and organizacion_id = (select public.mi_organizacion())
         and ((select public.mi_rol()) in ('admin','gerente') or asignado_id is null or asignado_id = (select public.mi_usuario_id())))
  with check ((select public.crm_permiso('crm')) and organizacion_id = (select public.mi_organizacion()));
alter policy pos_crm_ins on public.pos_crm
  with check ((select public.crm_permiso('crm')) and (select public.mi_rol()) is not null and (organizacion_id is null or organizacion_id = (select public.mi_organizacion())));
alter policy pos_crm_del on public.pos_crm
  using ((select public.crm_permiso('crm')) and (select public.mi_rol()) in ('admin','gerente') and organizacion_id = (select public.mi_organizacion()));
alter policy pos_crm_act_sel on public.pos_crm_actividades
  using ((select public.crm_permiso('crm')) and (select public.mi_rol()) is not null and organizacion_id = (select public.mi_organizacion())
         and ((crm_id is null and ((select public.mi_rol()) in ('admin','gerente') or asignado_id is null or asignado_id = (select public.mi_usuario_id())))
              or exists (select 1 from public.pos_crm c where c.id = pos_crm_actividades.crm_id)));
alter policy pos_crm_act_upd on public.pos_crm_actividades
  using ((select public.crm_permiso('crm')) and (select public.mi_rol()) is not null and organizacion_id = (select public.mi_organizacion())
         and ((crm_id is null and ((select public.mi_rol()) in ('admin','gerente') or asignado_id is null or asignado_id = (select public.mi_usuario_id())))
              or exists (select 1 from public.pos_crm c where c.id = pos_crm_actividades.crm_id)));
alter policy pos_crm_act_ins on public.pos_crm_actividades
  with check ((select public.crm_permiso('crm')) and (select public.mi_rol()) is not null and (organizacion_id is null or organizacion_id = (select public.mi_organizacion()))
              and tipo <> all (array['etapa','sistema'])
              and (crm_id is null or exists (select 1 from public.pos_crm c where c.id = pos_crm_actividades.crm_id)));
alter policy pos_crm_act_del on public.pos_crm_actividades
  using ((select public.crm_permiso('crm')) and organizacion_id = (select public.mi_organizacion()) and tipo <> all (array['etapa','sistema'])
         and ((select public.mi_rol()) in ('admin','gerente') or creado_por = (select auth.uid())));

-- Archivos de la Bandeja (fotos, audios, documentos de los chats).
alter policy crm_media_sel on storage.objects
  using (bucket_id = 'crm-media' and (select public.crm_permiso('crm_bandeja')));
alter policy crm_media_ins on storage.objects
  with check (bucket_id = 'crm-media' and (select public.crm_permiso('crm_bandeja')) and (storage.foldername(name))[1] = 'salientes');

commit;
