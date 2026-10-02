-- 40_crm_afinado.sql — STUDIO RD (02-oct-2026). CRM sin lag: permisos (RLS) evaluados una vez por consulta, índice de la
-- lista de la bandeja y resumen de conversación a prueba de mensajes antiguos. NO toca datos ni dinero.
-- Auditoría (bitácora 2026-10-01-2245-claude): la lista de conversaciones tardaba 70–336 ms con 547 filas porque cada fila llamaba
-- mi_rol()/mi_organizacion()/pos_crm_puede() (funciones SECURITY DEFINER que Postgres no puede «aplanar»); envueltas en
-- (select …) se calculan una sola vez por consulta (≈2,4 ms). Mismas reglas de acceso que antes:
--   admin y gerente ven todo; el resto, lo asignado a sí mismo y lo libre.

begin;

-- ── 1. RLS: mismas condiciones, calculadas una vez por consulta ─────────────────────────────────────────────────
drop policy if exists crm_canales_sel on public.crm_canales;
create policy crm_canales_sel on public.crm_canales for select
  using ((select public.mi_rol()) is not null and organizacion_id = (select public.mi_organizacion()));
drop policy if exists crm_canales_upd on public.crm_canales;
create policy crm_canales_upd on public.crm_canales for update
  using ((select public.mi_rol()) in ('admin','gerente') and organizacion_id = (select public.mi_organizacion()))
  with check (organizacion_id = (select public.mi_organizacion()));

drop policy if exists crm_conv_sel on public.crm_conversaciones;
create policy crm_conv_sel on public.crm_conversaciones for select
  using ((select public.mi_rol()) is not null and organizacion_id = (select public.mi_organizacion())
         and ((select public.mi_rol()) in ('admin','gerente') or asignado_id is null or asignado_id = (select public.mi_usuario_id())));
drop policy if exists crm_conv_upd on public.crm_conversaciones;
create policy crm_conv_upd on public.crm_conversaciones for update
  using ((select public.mi_rol()) is not null and organizacion_id = (select public.mi_organizacion())
         and ((select public.mi_rol()) in ('admin','gerente') or asignado_id is null or asignado_id = (select public.mi_usuario_id())))
  with check (organizacion_id = (select public.mi_organizacion()));

drop policy if exists crm_msg_sel on public.crm_mensajes;
create policy crm_msg_sel on public.crm_mensajes for select
  using ((select public.mi_rol()) is not null and organizacion_id = (select public.mi_organizacion())
         and exists (select 1 from public.crm_conversaciones c where c.id = crm_mensajes.conversacion_id));

drop policy if exists pos_crm_sel on public.pos_crm;
create policy pos_crm_sel on public.pos_crm for select
  using ((select public.mi_rol()) is not null and organizacion_id = (select public.mi_organizacion())
         and ((select public.mi_rol()) in ('admin','gerente') or asignado_id is null or asignado_id = (select public.mi_usuario_id())));
drop policy if exists pos_crm_upd on public.pos_crm;
create policy pos_crm_upd on public.pos_crm for update
  using ((select public.mi_rol()) is not null and organizacion_id = (select public.mi_organizacion())
         and ((select public.mi_rol()) in ('admin','gerente') or asignado_id is null or asignado_id = (select public.mi_usuario_id())))
  with check (organizacion_id = (select public.mi_organizacion()));
drop policy if exists pos_crm_ins on public.pos_crm;
create policy pos_crm_ins on public.pos_crm for insert
  with check ((select public.mi_rol()) is not null and (organizacion_id is null or organizacion_id = (select public.mi_organizacion())));
drop policy if exists pos_crm_del on public.pos_crm;
create policy pos_crm_del on public.pos_crm for delete
  using ((select public.mi_rol()) in ('admin','gerente') and organizacion_id = (select public.mi_organizacion()));

drop policy if exists pos_crm_act_sel on public.pos_crm_actividades;
create policy pos_crm_act_sel on public.pos_crm_actividades for select
  using ((select public.mi_rol()) is not null and organizacion_id = (select public.mi_organizacion())
         and ((crm_id is null and ((select public.mi_rol()) in ('admin','gerente') or asignado_id is null or asignado_id = (select public.mi_usuario_id())))
              or exists (select 1 from public.pos_crm c where c.id = pos_crm_actividades.crm_id)));
drop policy if exists pos_crm_act_upd on public.pos_crm_actividades;
create policy pos_crm_act_upd on public.pos_crm_actividades for update
  using ((select public.mi_rol()) is not null and organizacion_id = (select public.mi_organizacion())
         and ((crm_id is null and ((select public.mi_rol()) in ('admin','gerente') or asignado_id is null or asignado_id = (select public.mi_usuario_id())))
              or exists (select 1 from public.pos_crm c where c.id = pos_crm_actividades.crm_id)));
drop policy if exists pos_crm_act_ins on public.pos_crm_actividades;
create policy pos_crm_act_ins on public.pos_crm_actividades for insert
  with check ((select public.mi_rol()) is not null and (organizacion_id is null or organizacion_id = (select public.mi_organizacion()))
              and tipo <> all (array['etapa','sistema'])
              and (crm_id is null or exists (select 1 from public.pos_crm c where c.id = pos_crm_actividades.crm_id)));
drop policy if exists pos_crm_act_del on public.pos_crm_actividades;
create policy pos_crm_act_del on public.pos_crm_actividades for delete
  using (organizacion_id = (select public.mi_organizacion()) and tipo <> all (array['etapa','sistema'])
         and ((select public.mi_rol()) in ('admin','gerente') or creado_por = (select auth.uid())));

-- ── 2. Índices ───────────────────────────────────────────────────────────────────────────────────────────────────
-- La lista pide archivada=false ordenada por ultimo_mensaje_at desc NULLS LAST: este índice la sirve sin ordenar.
create index if not exists crm_conv_lista_idx on public.crm_conversaciones (organizacion_id, archivada, ultimo_mensaje_at desc nulls last);
drop index if exists public.crm_conv_org_ult_idx;   -- reemplazado por el anterior
-- Llaves foráneas sin índice (advisor).
create index if not exists crm_conv_asignado_idx on public.crm_conversaciones (asignado_id) where asignado_id is not null;
create index if not exists crm_conv_crm_idx on public.crm_conversaciones (crm_id) where crm_id is not null;
create index if not exists pos_crm_act_cliente_idx on public.pos_crm_actividades (cliente_id) where cliente_id is not null;
create index if not exists pos_crm_act_asignado_idx on public.pos_crm_actividades (asignado_id) where asignado_id is not null;

-- ── 3. Resumen de la conversación a prueba de mensajes antiguos o fuera de orden ──────────────────────────────────
-- Antes: cualquier mensaje insertado (también uno del historial o un reintento tardío del webhook) pisaba la vista
-- previa, sumaba «no leídos», ponía no leídos en 0 o desarchivaba aunque fuera más viejo que lo ya guardado.
create or replace function public.crm_msg_resumen()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  update public.crm_conversaciones c set
    ultimo_mensaje_at = greatest(coalesce(c.ultimo_mensaje_at, new.created_at), new.created_at),
    ultimo_mensaje_preview = case when c.ultimo_mensaje_at is null or new.created_at >= c.ultimo_mensaje_at
                                  then left(coalesce(nullif(new.cuerpo,''), '[' || new.tipo || ']'), 200)
                                  else c.ultimo_mensaje_preview end,
    ultimo_inbound_at = case when new.direccion = 'in' then greatest(coalesce(c.ultimo_inbound_at, new.created_at), new.created_at) else c.ultimo_inbound_at end,
    ultima_respuesta_at = case when new.direccion = 'out' then greatest(coalesce(c.ultima_respuesta_at, new.created_at), new.created_at) else c.ultima_respuesta_at end,
    no_leidos = case
                  when new.direccion = 'in' and (c.ultima_respuesta_at is null or new.created_at > c.ultima_respuesta_at) then c.no_leidos + 1
                  when new.direccion = 'out' and (c.ultimo_inbound_at is null or new.created_at >= c.ultimo_inbound_at) then 0
                  else c.no_leidos end,
    archivada = case when new.direccion = 'in' and (c.ultimo_mensaje_at is null or new.created_at >= c.ultimo_mensaje_at) then false else c.archivada end
  where c.id = new.conversacion_id;
  return null;
end $$;

commit;
