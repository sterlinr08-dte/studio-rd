-- 45_crm_paridad_bayol.sql — STUDIO RD (03-oct-2026). CRM igual al de Bayol Cell, fase 3 (pedido del dueño: «que el CRM de
-- STUDIO quede así mismo, fluido, estable, con todas las funciones»). Requiere la 44 aplicada antes.
--   · crm_conversaciones: fijado_at, silenciado_hasta, etiquetas (los ve todo el equipo; los cambia quien ve el chat);
--   · «Marcar como no leído»: crm_conv_antes deja pasar no_leidos 0 → 1 desde la app (antes bloqueaba toda subida);
--   · crm_respuestas_rapidas: atajos «/» para el chat (los usa quien tiene la Bandeja; crea cualquiera de ellos, borra
--     quien la creó o admin/gerente).
-- No toca mensajes ni dinero. Reversa al final.

begin;

alter table public.crm_conversaciones add column if not exists fijado_at timestamptz;
alter table public.crm_conversaciones add column if not exists silenciado_hasta timestamptz;
alter table public.crm_conversaciones add column if not exists etiquetas text[] not null default '{}';

-- Igual que en la 44 (deja pasar la transferencia validada) + «marcar como no leído» (0 → 1).
create or replace function public.crm_conv_antes()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare v_yo uuid := public.mi_usuario_id(); v_admin boolean := coalesce(public.mi_rol() in ('admin','gerente'), false);
  v_app boolean := auth.uid() is not null and pg_trigger_depth() = 1;   -- cambio hecho directamente desde la app (no por el resumen de mensajes)
  v_transf boolean := coalesce(current_setting('crm.transferencia', true), '') = '1';
begin
  if v_app and new.asignado_id is distinct from old.asignado_id and not v_admin and not v_transf then
    if not ((old.asignado_id is null and new.asignado_id = v_yo) or (old.asignado_id = v_yo and new.asignado_id is null)) then
      raise exception 'CRM_ASIGNAR_SOLO_ADMIN';
    end if;
  end if;
  if v_app then
    new.canal_id := old.canal_id; new.plataforma := old.plataforma; new.contacto_id := old.contacto_id;
    new.zernio_conversation_id := old.zernio_conversation_id; new.ultimo_inbound_at := old.ultimo_inbound_at;
    new.ultima_respuesta_at := old.ultima_respuesta_at; new.ultimo_mensaje_at := old.ultimo_mensaje_at;
    if new.no_leidos > old.no_leidos and not (old.no_leidos = 0 and new.no_leidos = 1) then new.no_leidos := old.no_leidos; end if;
    -- Etiquetas: sin vacías ni repetidas (sin importar mayúsculas), máximo 12 de 30 letras.
    new.etiquetas := coalesce((select array_agg(e order by e) from (select distinct on (lower(left(trim(x), 30))) left(trim(x), 30) e from unnest(new.etiquetas) x where trim(coalesce(x, '')) <> '') q), '{}');
    if array_length(new.etiquetas, 1) > 12 then new.etiquetas := new.etiquetas[1:12]; end if;
  end if;
  new.asignado_nombre := (select us.nom from public.usuarios_sistema us where us.id = new.asignado_id);
  return new;
end $function$;

create table if not exists public.crm_respuestas_rapidas (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null default public.mi_organizacion(),
  atajo text not null check (atajo ~ '^[a-z0-9_-]{1,24}$'),
  texto text not null check (length(texto) between 1 and 1000),
  creado_por uuid default public.mi_usuario_id(),
  created_at timestamptz not null default now(),
  unique (organizacion_id, atajo)
);
alter table public.crm_respuestas_rapidas enable row level security;
drop policy if exists crm_rr_sel on public.crm_respuestas_rapidas;
drop policy if exists crm_rr_ins on public.crm_respuestas_rapidas;
drop policy if exists crm_rr_upd on public.crm_respuestas_rapidas;
drop policy if exists crm_rr_del on public.crm_respuestas_rapidas;
create policy crm_rr_sel on public.crm_respuestas_rapidas for select to authenticated
  using (organizacion_id = (select public.mi_organizacion()) and (select public.crm_permiso('crm_bandeja')));
create policy crm_rr_ins on public.crm_respuestas_rapidas for insert to authenticated
  with check (organizacion_id = (select public.mi_organizacion()) and (select public.crm_permiso('crm_bandeja')));
create policy crm_rr_upd on public.crm_respuestas_rapidas for update to authenticated
  using (organizacion_id = (select public.mi_organizacion()) and ((select public.mi_rol()) in ('admin','gerente') or creado_por = (select public.mi_usuario_id())))
  with check (organizacion_id = (select public.mi_organizacion()));
create policy crm_rr_del on public.crm_respuestas_rapidas for delete to authenticated
  using (organizacion_id = (select public.mi_organizacion()) and ((select public.mi_rol()) in ('admin','gerente') or creado_por = (select public.mi_usuario_id())));
grant select, insert, update, delete on public.crm_respuestas_rapidas to authenticated;

commit;

-- REVERSA (manual): drop table crm_respuestas_rapidas; alter table crm_conversaciones drop column fijado_at,
--   drop column silenciado_hasta, drop column etiquetas; crm_conv_antes → la versión de la 44.
