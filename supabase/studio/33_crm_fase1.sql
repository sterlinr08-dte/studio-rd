-- 33 · CRM Fase 1 (24-sep-2026) — réplica mejorada del CRM de Bayol Cell Taller, sin canales externos.
-- Pedido del dueño: «Vamos a replicar el CRM de bayol cell taller y aplicarle mejoras» + «Si» a la Fase 1.
-- Se AMPLÍA pos_crm (no se crea un embudo paralelo). Nuevo:
--   · asignación a un usuario del sistema; motivo de pérdida; interés; vínculos a cotización / venta / reparación /
--     financiamiento; fecha de entrada a la etapa; última actualización;
--   · pos_crm_actividades: notas, llamadas, WhatsApp (manual), visitas, tareas con fecha y el historial de etapas;
--   · historial de etapas y cierre (cerrado_at) calculados en el SERVIDOR por trigger, no en el navegador;
--   · permisos en el servidor (mejora sobre Bayol, que filtraba en el navegador): admin y gerente ven todo;
--     los demás ven lo asignado a ellos y lo que no tiene dueño, y solo pueden tomar lo libre para sí mismos.

alter table public.pos_crm
  add column if not exists asignado_id uuid references public.usuarios_sistema(id) on delete set null,
  add column if not exists asignado_nombre text,
  add column if not exists interes text,
  add column if not exists motivo_perdida text,
  add column if not exists cotizacion_id uuid,
  add column if not exists venta_id uuid,
  add column if not exists reparacion_id uuid,
  add column if not exists financiamiento_id uuid,
  add column if not exists etapa_at timestamptz not null default now(),
  add column if not exists actualizado_at timestamptz not null default now();
create index if not exists pos_crm_org_etapa_idx on public.pos_crm(organizacion_id, etapa);
create index if not exists pos_crm_asignado_idx on public.pos_crm(asignado_id);
create index if not exists pos_crm_cliente_idx on public.pos_crm(cliente_id);

create table if not exists public.pos_crm_actividades (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null,
  crm_id uuid references public.pos_crm(id) on delete cascade,
  cliente_id uuid references public.pos_clientes(id) on delete set null,
  tipo text not null check (tipo in ('nota','llamada','whatsapp','visita','tarea','etapa','sistema')),
  texto text not null,
  vence_at timestamptz,
  hecha boolean not null default false,
  hecha_at timestamptz,
  asignado_id uuid references public.usuarios_sistema(id) on delete set null,
  asignado_nombre text,
  creado_por uuid,
  created_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists pos_crm_act_crm_idx on public.pos_crm_actividades(crm_id, created_at desc);
create index if not exists pos_crm_act_tareas_idx on public.pos_crm_actividades(organizacion_id, hecha, vence_at) where tipo = 'tarea';
drop trigger if exists trg_org_pos_crm_actividades on public.pos_crm_actividades;
create trigger trg_org_pos_crm_actividades before insert on public.pos_crm_actividades for each row execute function public.set_organizacion_id();

-- ¿Puede ver/editar esta oportunidad? (admin/gerente todo; resto lo suyo o lo libre)
create or replace function public.pos_crm_puede(p_asignado uuid) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select public.mi_rol() in ('admin','gerente') or p_asignado is null or p_asignado = public.mi_usuario_id()
$$;

-- Servidor: etapa, cierre, asignado_nombre, historial y controles de asignación.
create or replace function public.pos_crm_antes() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare v_yo uuid := public.mi_usuario_id(); v_admin boolean := coalesce(public.mi_rol() in ('admin','gerente'), false);
begin
  if tg_op = 'INSERT' then
    if new.etapa is null then new.etapa := 'nuevo'; end if;
    new.etapa_at := now();
    if not v_admin and new.asignado_id is not null and new.asignado_id is distinct from v_yo then
      raise exception 'CRM_ASIGNAR_SOLO_ADMIN';
    end if;
  else
    if new.asignado_id is distinct from old.asignado_id and not v_admin then
      -- Un vendedor solo puede tomar una oportunidad libre para sí mismo (o soltar la suya).
      if not ((old.asignado_id is null and new.asignado_id = v_yo) or (old.asignado_id = v_yo and new.asignado_id is null)) then
        raise exception 'CRM_ASIGNAR_SOLO_ADMIN';
      end if;
    end if;
    if new.etapa is distinct from old.etapa then new.etapa_at := now(); end if;
  end if;
  if new.etapa not in ('nuevo','contactado','cotizado','ganado','perdido') then raise exception 'CRM_ETAPA_INVALIDA'; end if;
  if new.etapa = 'perdido' and nullif(trim(coalesce(new.motivo_perdida,'')),'') is null then raise exception 'CRM_FALTA_MOTIVO_PERDIDA'; end if;
  if new.etapa in ('ganado','perdido') then new.cerrado_at := coalesce(case when tg_op='UPDATE' and old.etapa = new.etapa then old.cerrado_at end, now());
  else new.cerrado_at := null; new.motivo_perdida := null; end if;
  new.asignado_nombre := (select nom from public.usuarios_sistema where id = new.asignado_id);
  new.actualizado_at := now();
  return new;
end $$;
drop trigger if exists trg_pos_crm_antes on public.pos_crm;
create trigger trg_pos_crm_antes before insert or update on public.pos_crm for each row execute function public.pos_crm_antes();

create or replace function public.pos_crm_despues() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare et text[] := array['nuevo','contactado','cotizado','ganado','perdido']; etn text[] := array['Nuevo','Contactado','Cotizado','Ganado','Perdido'];
  v_quien text := (select us.nom from public.usuarios_sistema us where us.id = public.mi_usuario_id());
begin
  if tg_op = 'INSERT' then
    insert into public.pos_crm_actividades(organizacion_id, crm_id, cliente_id, tipo, texto, creado_por, created_by_name)
    values (new.organizacion_id, new.id, new.cliente_id, 'etapa', 'Oportunidad creada en ' || etn[array_position(et, new.etapa)], auth.uid(), coalesce(v_quien, new.created_by_name));
  else
    if new.etapa is distinct from old.etapa then
      insert into public.pos_crm_actividades(organizacion_id, crm_id, cliente_id, tipo, texto, creado_por, created_by_name)
      values (new.organizacion_id, new.id, new.cliente_id, 'etapa',
        etn[array_position(et, old.etapa)] || ' → ' || etn[array_position(et, new.etapa)] || case when new.etapa = 'perdido' then ' · motivo: ' || new.motivo_perdida else '' end,
        auth.uid(), v_quien);
    end if;
    if new.asignado_id is distinct from old.asignado_id then
      insert into public.pos_crm_actividades(organizacion_id, crm_id, cliente_id, tipo, texto, creado_por, created_by_name)
      values (new.organizacion_id, new.id, new.cliente_id, 'sistema', coalesce('Asignada a ' || new.asignado_nombre, 'Sin asignar'), auth.uid(), v_quien);
    end if;
  end if;
  return null;
end $$;
drop trigger if exists trg_pos_crm_despues on public.pos_crm;
create trigger trg_pos_crm_despues after insert or update on public.pos_crm for each row execute function public.pos_crm_despues();

-- Actividades: quién la creó y cuándo se completó, en el servidor. El historial (etapa/sistema) no se edita.
create or replace function public.pos_crm_act_antes() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if tg_op = 'INSERT' then
    new.creado_por := auth.uid();
    new.created_by_name := coalesce((select nom from public.usuarios_sistema where id = public.mi_usuario_id()), new.created_by_name);
    if new.crm_id is not null then new.cliente_id := coalesce(new.cliente_id, (select cliente_id from public.pos_crm where id = new.crm_id)); end if;
  else
    if old.tipo in ('etapa','sistema') then raise exception 'CRM_HISTORIAL_NO_EDITABLE'; end if;
    new.creado_por := old.creado_por; new.created_by_name := old.created_by_name; new.created_at := old.created_at; new.crm_id := old.crm_id;
  end if;
  new.asignado_nombre := (select nom from public.usuarios_sistema where id = new.asignado_id);
  if new.hecha and (tg_op = 'INSERT' or not old.hecha) then new.hecha_at := now(); end if;
  if not new.hecha then new.hecha_at := null; end if;
  return new;
end $$;
drop trigger if exists trg_pos_crm_act_antes on public.pos_crm_actividades;
create trigger trg_pos_crm_act_antes before insert or update on public.pos_crm_actividades for each row execute function public.pos_crm_act_antes();

-- RLS por asignación (reemplaza la política amplia por organización).
alter table public.pos_crm enable row level security;
drop policy if exists pos_crm_admin on public.pos_crm;
drop policy if exists pos_crm_sel on public.pos_crm;
drop policy if exists pos_crm_ins on public.pos_crm;
drop policy if exists pos_crm_upd on public.pos_crm;
drop policy if exists pos_crm_del on public.pos_crm;
create policy pos_crm_sel on public.pos_crm for select using (mi_rol() is not null and organizacion_id = mi_organizacion() and pos_crm_puede(asignado_id));
create policy pos_crm_ins on public.pos_crm for insert with check (mi_rol() is not null and (organizacion_id is null or organizacion_id = mi_organizacion()));
create policy pos_crm_upd on public.pos_crm for update using (mi_rol() is not null and organizacion_id = mi_organizacion() and pos_crm_puede(asignado_id))
  with check (organizacion_id = mi_organizacion());
create policy pos_crm_del on public.pos_crm for delete using (mi_rol() in ('admin','gerente') and organizacion_id = mi_organizacion());

alter table public.pos_crm_actividades enable row level security;
drop policy if exists pos_crm_act_sel on public.pos_crm_actividades;
drop policy if exists pos_crm_act_ins on public.pos_crm_actividades;
drop policy if exists pos_crm_act_upd on public.pos_crm_actividades;
drop policy if exists pos_crm_act_del on public.pos_crm_actividades;
create policy pos_crm_act_sel on public.pos_crm_actividades for select using (
  mi_rol() is not null and organizacion_id = mi_organizacion()
  and (crm_id is null and pos_crm_puede(asignado_id) or exists (select 1 from public.pos_crm c where c.id = crm_id)));
create policy pos_crm_act_ins on public.pos_crm_actividades for insert with check (
  mi_rol() is not null and (organizacion_id is null or organizacion_id = mi_organizacion()) and tipo not in ('etapa','sistema')
  and (crm_id is null or exists (select 1 from public.pos_crm c where c.id = crm_id)));
create policy pos_crm_act_upd on public.pos_crm_actividades for update using (
  mi_rol() is not null and organizacion_id = mi_organizacion()
  and (crm_id is null and pos_crm_puede(asignado_id) or exists (select 1 from public.pos_crm c where c.id = crm_id)));
create policy pos_crm_act_del on public.pos_crm_actividades for delete using (
  organizacion_id = mi_organizacion() and tipo not in ('etapa','sistema')
  and (mi_rol() in ('admin','gerente') or creado_por = auth.uid()));
grant select, insert, update, delete on public.pos_crm_actividades to authenticated;

-- Lista de usuarios a quienes asignar (solo nombre y rol; nunca datos de acceso).
create or replace function public.pos_crm_usuarios() returns table(id uuid, nom text, rol text)
language sql stable security definer set search_path to 'public' as $$
  select us.id, us.nom, us.rol from public.usuarios_sistema us
  where us.organizacion_id = public.mi_organizacion() and us.activo and public.mi_rol() is not null
  order by us.nom
$$;
revoke all on function public.pos_crm_usuarios() from public, anon;
grant execute on function public.pos_crm_usuarios() to authenticated;
revoke all on function public.pos_crm_puede(uuid) from public, anon;
grant execute on function public.pos_crm_puede(uuid) to authenticated;
