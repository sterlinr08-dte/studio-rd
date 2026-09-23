-- 34 · CRM Fase 2: bandeja única de WhatsApp, Instagram y Facebook (24-sep-2026).
-- Pedido del dueño: «Si su propio número de whatsapp su Facebook e Instagram». Réplica de la bandeja de BAYOL CELL
-- con un solo modelo para los 3 canales (Bayol tiene tablas separadas por canal) y las correcciones de su auditoría:
--   F15 · la conversación se identifica por CANAL + contacto (no por sucursal + teléfono): dos cuentas no se mezclan.
--   F16 · el webhook guarda primero el evento crudo (idempotente por id de evento) y lo procesa después; los no leídos
--         suben solo cuando el mensaje entra por primera vez (trigger de INSERT con id de proveedor único); los estados
--         de entrega solo avanzan (enviado → entregado → leído; fallido no pisa leído).
--   F17 · cada envío se registra ANTES de llamar a Zernio con una clave de idempotencia única; si Zernio falla queda
--         «fallido» con el error, nunca un «ok» sin registro.
--   F19 · los adjuntos van a un bucket privado legible solo por usuarios del sistema.
-- Todo nace APAGADO: un canal nuevo aparece desactivado hasta que el administrador lo activa en el CRM.
-- Nada se envía solo: los mensajes salen únicamente cuando un empleado pulsa Enviar.

create table if not exists public.crm_canales (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null,
  plataforma text not null check (plataforma in ('whatsapp','instagram','facebook')),
  zernio_account_id text not null unique,
  nombre text,
  identificador text,             -- número de WhatsApp o usuario de la red
  activo boolean not null default false,
  ultimo_evento_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.crm_conversaciones (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null,
  canal_id uuid not null references public.crm_canales(id) on delete cascade,
  plataforma text not null,
  contacto_id text not null,      -- teléfono E.164, bsid:… o id del participante en la red
  contacto_nombre text,
  contacto_usuario text,
  telefono_e164 text,
  zernio_conversation_id text,
  cliente_id uuid references public.pos_clientes(id) on delete set null,
  crm_id uuid references public.pos_crm(id) on delete set null,
  asignado_id uuid references public.usuarios_sistema(id) on delete set null,
  asignado_nombre text,
  ultimo_mensaje_at timestamptz,
  ultimo_mensaje_preview text,
  ultimo_inbound_at timestamptz,
  ultima_respuesta_at timestamptz,
  no_leidos int not null default 0,
  archivada boolean not null default false,
  created_at timestamptz not null default now(),
  unique (canal_id, contacto_id)
);
create index if not exists crm_conv_org_ult_idx on public.crm_conversaciones(organizacion_id, ultimo_mensaje_at desc);
create index if not exists crm_conv_cliente_idx on public.crm_conversaciones(cliente_id);

create table if not exists public.crm_mensajes (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null,
  conversacion_id uuid not null references public.crm_conversaciones(id) on delete cascade,
  direccion text not null check (direccion in ('in','out')),
  tipo text not null default 'texto',
  cuerpo text,
  media_path text,
  proveedor_msg_id text,
  estado text not null default 'recibido' check (estado in ('recibido','pendiente','enviado','entregado','leido','fallido')),
  error text,
  idempotency_key uuid unique,
  enviado_por uuid,
  enviado_por_nombre text,
  desde_telefono boolean not null default false,   -- enviado desde la app del teléfono (espejo de Zernio)
  created_at timestamptz not null default now()
);
create unique index if not exists crm_msg_proveedor_uq on public.crm_mensajes(proveedor_msg_id) where proveedor_msg_id is not null;
create index if not exists crm_msg_conv_idx on public.crm_mensajes(conversacion_id, created_at);

create table if not exists public.crm_webhook_eventos (
  id uuid primary key default gen_random_uuid(),
  evento_id text not null unique,
  evento text,
  plataforma text,
  zernio_account_id text,
  payload jsonb not null,
  recibido_at timestamptz not null default now(),
  procesado_at timestamptz,
  error text
);

-- Resumen de la conversación: solo al INSERTAR un mensaje (un mismo mensaje nunca cuenta dos veces).
create or replace function public.crm_msg_resumen() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  update public.crm_conversaciones c set
    ultimo_mensaje_at = greatest(coalesce(c.ultimo_mensaje_at, new.created_at), new.created_at),
    ultimo_mensaje_preview = left(coalesce(nullif(new.cuerpo,''), '[' || new.tipo || ']'), 200),
    ultimo_inbound_at = case when new.direccion = 'in' then greatest(coalesce(c.ultimo_inbound_at, new.created_at), new.created_at) else c.ultimo_inbound_at end,
    ultima_respuesta_at = case when new.direccion = 'out' then greatest(coalesce(c.ultima_respuesta_at, new.created_at), new.created_at) else c.ultima_respuesta_at end,
    no_leidos = case when new.direccion = 'in' then c.no_leidos + 1 else 0 end,
    archivada = case when new.direccion = 'in' then false else c.archivada end
  where c.id = new.conversacion_id;
  return null;
end $$;
drop trigger if exists trg_crm_msg_resumen on public.crm_mensajes;
create trigger trg_crm_msg_resumen after insert on public.crm_mensajes for each row execute function public.crm_msg_resumen();

-- Estados de entrega solo avanzan.
create or replace function public.crm_estado_rank(e text) returns int language sql immutable as $$
  select case e when 'pendiente' then 1 when 'enviado' then 2 when 'entregado' then 3 when 'leido' then 4 when 'fallido' then 0 else 0 end
$$;
create or replace function public.crm_msg_estado() returns trigger
language plpgsql as $$
begin
  if new.estado is distinct from old.estado and old.direccion = 'out' then
    if new.estado = 'fallido' and old.estado in ('entregado','leido') then new.estado := old.estado; end if;
    if new.estado <> 'fallido' and old.estado <> 'fallido' and public.crm_estado_rank(new.estado) < public.crm_estado_rank(old.estado) then new.estado := old.estado; end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_crm_msg_estado on public.crm_mensajes;
create trigger trg_crm_msg_estado before update on public.crm_mensajes for each row execute function public.crm_msg_estado();

-- Conversación: asignación con las mismas reglas del CRM (vendedor solo toma lo libre o suelta lo suyo).
create or replace function public.crm_conv_antes() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare v_yo uuid := public.mi_usuario_id(); v_admin boolean := coalesce(public.mi_rol() in ('admin','gerente'), false);
  v_app boolean := auth.uid() is not null and pg_trigger_depth() = 1;   -- cambio hecho directamente desde la app (no por el resumen de mensajes)
begin
  if v_app and new.asignado_id is distinct from old.asignado_id and not v_admin then
    if not ((old.asignado_id is null and new.asignado_id = v_yo) or (old.asignado_id = v_yo and new.asignado_id is null)) then
      raise exception 'CRM_ASIGNAR_SOLO_ADMIN';
    end if;
  end if;
  if v_app then
    -- Desde la app solo se cambian: cliente, oportunidad, asignación, leído y archivada.
    new.canal_id := old.canal_id; new.plataforma := old.plataforma; new.contacto_id := old.contacto_id;
    new.zernio_conversation_id := old.zernio_conversation_id; new.ultimo_inbound_at := old.ultimo_inbound_at;
    new.ultima_respuesta_at := old.ultima_respuesta_at; new.ultimo_mensaje_at := old.ultimo_mensaje_at;
    if new.no_leidos > old.no_leidos then new.no_leidos := old.no_leidos; end if;
  end if;
  new.asignado_nombre := (select us.nom from public.usuarios_sistema us where us.id = new.asignado_id);
  return new;
end $$;
drop trigger if exists trg_crm_conv_antes on public.crm_conversaciones;
create trigger trg_crm_conv_antes before update on public.crm_conversaciones for each row execute function public.crm_conv_antes();

-- RLS
alter table public.crm_canales enable row level security;
alter table public.crm_conversaciones enable row level security;
alter table public.crm_mensajes enable row level security;
alter table public.crm_webhook_eventos enable row level security;   -- sin políticas: solo el servidor

drop policy if exists crm_canales_sel on public.crm_canales;
drop policy if exists crm_canales_upd on public.crm_canales;
create policy crm_canales_sel on public.crm_canales for select using (mi_rol() is not null and organizacion_id = mi_organizacion());
create policy crm_canales_upd on public.crm_canales for update using (mi_rol() in ('admin','gerente') and organizacion_id = mi_organizacion())
  with check (organizacion_id = mi_organizacion());

drop policy if exists crm_conv_sel on public.crm_conversaciones;
drop policy if exists crm_conv_upd on public.crm_conversaciones;
create policy crm_conv_sel on public.crm_conversaciones for select using (mi_rol() is not null and organizacion_id = mi_organizacion() and pos_crm_puede(asignado_id));
create policy crm_conv_upd on public.crm_conversaciones for update using (mi_rol() is not null and organizacion_id = mi_organizacion() and pos_crm_puede(asignado_id))
  with check (organizacion_id = mi_organizacion());

drop policy if exists crm_msg_sel on public.crm_mensajes;
create policy crm_msg_sel on public.crm_mensajes for select using (
  mi_rol() is not null and organizacion_id = mi_organizacion()
  and exists (select 1 from public.crm_conversaciones c where c.id = conversacion_id));

grant select, update on public.crm_canales to authenticated;
grant select, update on public.crm_conversaciones to authenticated;
grant select on public.crm_mensajes to authenticated;
revoke all on public.crm_webhook_eventos from anon, authenticated;
revoke all on public.crm_canales from anon;
revoke all on public.crm_conversaciones from anon;
revoke all on public.crm_mensajes from anon;

-- Adjuntos: bucket privado; solo usuarios del sistema leen y suben (el servidor los entrega con URL firmada).
insert into storage.buckets (id, name, public) values ('crm-media', 'crm-media', false) on conflict (id) do nothing;
drop policy if exists crm_media_sel on storage.objects;
drop policy if exists crm_media_ins on storage.objects;
create policy crm_media_sel on storage.objects for select to authenticated using (bucket_id = 'crm-media' and public.mi_rol() is not null);
create policy crm_media_ins on storage.objects for insert to authenticated with check (bucket_id = 'crm-media' and public.mi_rol() is not null and (storage.foldername(name))[1] = 'salientes');

-- Tiempo real para la bandeja (solo filas que la RLS deja ver a cada usuario).
do $$ begin
  begin alter publication supabase_realtime add table public.crm_conversaciones; exception when duplicate_object then null; when undefined_object then null; end;
  begin alter publication supabase_realtime add table public.crm_mensajes; exception when duplicate_object then null; when undefined_object then null; end;
end $$;

-- 34b · Buscar el cliente por teléfono (últimos 10 dígitos) para vincular sola una conversación nueva de WhatsApp.
create or replace function public.crm_cliente_por_telefono(p_tel text) returns uuid
language sql stable security definer set search_path to 'public' as $$
  select c.id from public.pos_clientes c
  where c.activo and length(regexp_replace(coalesce(p_tel,''), '\D', '', 'g')) >= 10
    and right(regexp_replace(coalesce(c.telefono,''), '\D', '', 'g'), 10) = right(regexp_replace(p_tel, '\D', '', 'g'), 10)
  order by c.created_at limit 1
$$;
revoke all on function public.crm_cliente_por_telefono(text) from public, anon, authenticated;

-- 34c/34d (aplicadas como studio_34c_crm_endurecer y studio_34d_crm_conv_trigger_depth): search_path fijo, funciones de
-- trigger sin EXECUTE para la API, y crm_conv_antes solo restringe cambios hechos directamente desde la app.
alter function public.crm_estado_rank(text) set search_path = public;
alter function public.crm_msg_estado() set search_path = public;
revoke all on function public.crm_conv_antes() from public, anon, authenticated;
revoke all on function public.crm_msg_resumen() from public, anon, authenticated;
revoke all on function public.pos_crm_antes() from public, anon, authenticated;
revoke all on function public.pos_crm_despues() from public, anon, authenticated;
revoke all on function public.pos_crm_act_antes() from public, anon, authenticated;
