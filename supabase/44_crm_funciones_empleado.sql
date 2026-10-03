-- 44_crm_funciones_empleado.sql — STUDIO RD (03-oct-2026). Funciones del CRM POR EMPLEADO (decisión del dueño:
-- «Solo por empleado»; funciones elegidas: «Canal por canal» y «Transferir clientes»).
--   · usuarios_sistema.crm_funciones (jsonb, la edita solo el administrador — RLS all_usuarios_sistema):
--       { "canales": ["whatsapp","instagram","facebook"], "transferir": true }
--     null o clave ausente = como hasta hoy (todos los canales; puede transferir). El administrador ve todo siempre.
--   · Canales: un empleado solo ve/responde las conversaciones de los canales que tiene marcados (lo aplica la RLS de
--     crm_conversaciones; crm_mensajes, crm-enviar y los archivos dependen de esa misma RLS).
--   · Transferir: pasar una conversación a otro empleado con nota y aviso (como «Transferir cliente» de Bayol Cell). El
--     que la recibe queda asignado y la ve aunque antes no la viera; solo se ofrece a quien tenga la Bandeja y ese canal.
-- El permiso de rol «Bandeja de mensajes» (migración 41) sigue siendo la puerta general. No toca mensajes ni dinero.
-- Reversa: ver bloque «REVERSA» al final.

begin;

-- ── 1. Columna por empleado ─────────────────────────────────────────────────────────────────────────────────────
alter table public.usuarios_sistema add column if not exists crm_funciones jsonb;
comment on column public.usuarios_sistema.crm_funciones is
  'CRM por empleado (03-oct-2026): {"canales":[whatsapp|instagram|facebook], "transferir":bool}. null = todos los canales y puede transferir.';

-- ── 2. Helpers ───────────────────────────────────────────────────────────────────────────────────────────────────
-- Canales que el usuario actual puede ver. Admin: todos. Se usa en la RLS como (select …) → se calcula una vez por consulta.
create or replace function public.crm_mis_canales()
returns text[] language sql stable security definer set search_path to 'public' as $$
  select case
    when public.mi_rol() = 'admin' then array['whatsapp','instagram','facebook']
    when f is null or not (f ? 'canales') or jsonb_typeof(f->'canales') <> 'array' then array['whatsapp','instagram','facebook']
    else coalesce((select array_agg(x) from jsonb_array_elements_text(f->'canales') x), array[]::text[])
  end
  from (select (select us.crm_funciones from public.usuarios_sistema us where us.id = public.mi_usuario_id()) as f) s
$$;
revoke all on function public.crm_mis_canales() from public, anon;
grant execute on function public.crm_mis_canales() to authenticated;

-- Mis funciones del CRM (para que la pantalla muestre solo lo permitido; el servidor lo vuelve a comprobar).
create or replace function public.crm_mis_funciones()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'canales', to_jsonb(public.crm_mis_canales()),
    'transferir', public.mi_rol() = 'admin'
                  or coalesce(((select us.crm_funciones from public.usuarios_sistema us where us.id = public.mi_usuario_id()) ->> 'transferir')::boolean, true)
  )
$$;
revoke all on function public.crm_mis_funciones() from public, anon;
grant execute on function public.crm_mis_funciones() to authenticated;

-- ¿Un rol (de esta organización) tiene un permiso del CRM? Misma regla que crm_permiso (migración 41) pero para otro usuario.
create or replace function public.crm_permiso_rol(p_rol text, p_org uuid, p_cap text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  with a as (select a.modulos from public.pos_acceso a where a.organizacion_id = p_org and a.rol = p_rol limit 1)
  select case
    when p_rol is null then false
    when p_rol = 'admin' then true
    when p_rol = 'gerente' and p_cap = 'crm_bandeja' then true
    when exists (select 1 from a) then coalesce((select a.modulos ? p_cap from a), false)
    else p_rol in ('gerente', 'vendedor') and p_cap in ('crm', 'crm_bandeja')
  end
$$;
revoke all on function public.crm_permiso_rol(text, uuid, text) from public, anon;

-- ── 3. RLS: además de lo de la migración 41, solo los canales del empleado ───────────────────────────────────────
alter policy crm_conv_sel on public.crm_conversaciones
  using ((select public.crm_permiso('crm_bandeja')) and (select public.mi_rol()) is not null and organizacion_id = (select public.mi_organizacion())
         and plataforma = any ((select public.crm_mis_canales())::text[])
         and ((select public.mi_rol()) in ('admin','gerente') or asignado_id is null or asignado_id = (select public.mi_usuario_id())));
alter policy crm_conv_upd on public.crm_conversaciones
  using ((select public.crm_permiso('crm_bandeja')) and (select public.mi_rol()) is not null and organizacion_id = (select public.mi_organizacion())
         and plataforma = any ((select public.crm_mis_canales())::text[])
         and ((select public.mi_rol()) in ('admin','gerente') or asignado_id is null or asignado_id = (select public.mi_usuario_id())))
  with check ((select public.crm_permiso('crm_bandeja')) and organizacion_id = (select public.mi_organizacion()));

-- ── 4. Guardar las funciones de un empleado (solo el administrador de su empresa) ───────────────────────────────
create or replace function public.crm_guardar_funciones(p_usuario uuid, p_canales text[], p_transferir boolean)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_can text[];
begin
  if public.mi_rol() is distinct from 'admin' then raise exception 'CRM_SOLO_ADMIN'; end if;
  if not exists (select 1 from public.usuarios_sistema where id = p_usuario and organizacion_id = public.mi_organizacion()) then
    raise exception 'CRM_USUARIO_NO_ENCONTRADO';
  end if;
  select coalesce(array_agg(distinct c), array[]::text[]) into v_can
    from unnest(coalesce(p_canales, array[]::text[])) c where c in ('whatsapp','instagram','facebook');
  update public.usuarios_sistema
     set crm_funciones = jsonb_build_object('canales', to_jsonb(v_can), 'transferir', coalesce(p_transferir, true)),
         updated_at = now()
   where id = p_usuario;
end $$;
revoke all on function public.crm_guardar_funciones(uuid, text[], boolean) from public, anon;
grant execute on function public.crm_guardar_funciones(uuid, text[], boolean) to authenticated;

-- ── 5. Transferencias ────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.crm_transferencias (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null,
  conversacion_id uuid not null references public.crm_conversaciones(id) on delete cascade,
  de_id uuid, de_nombre text,
  a_id uuid not null, a_nombre text,
  nota text,
  created_at timestamptz not null default now(),
  visto_at timestamptz
);
create index if not exists crm_transferencias_a_idx on public.crm_transferencias (a_id, visto_at, created_at desc);
create index if not exists crm_transferencias_conv_idx on public.crm_transferencias (conversacion_id, created_at desc);
alter table public.crm_transferencias enable row level security;
drop policy if exists crm_tr_sel on public.crm_transferencias;
create policy crm_tr_sel on public.crm_transferencias for select to authenticated
  using (organizacion_id = (select public.mi_organizacion())
         and ((select public.mi_rol()) in ('admin','gerente') or a_id = (select public.mi_usuario_id()) or de_id = (select public.mi_usuario_id())));
revoke insert, update, delete on public.crm_transferencias from anon, authenticated;
grant select on public.crm_transferencias to authenticated;
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'crm_transferencias') then
    alter publication supabase_realtime add table public.crm_transferencias;
  end if;
end $$;

-- El candado de asignación (crm_conv_antes, migración 40) deja pasar SOLO la transferencia validada por
-- crm_transferir_conversacion (bandera local de la transacción; la app no puede fijarla: set_config no está expuesta).
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
    if new.no_leidos > old.no_leidos then new.no_leidos := old.no_leidos; end if;
  end if;
  new.asignado_nombre := (select us.nom from public.usuarios_sistema us where us.id = new.asignado_id);
  return new;
end $function$;

-- A quién se le puede pasar esta conversación: empleados activos de la empresa (menos yo) con la Bandeja y ese canal.
create or replace function public.crm_empleados_transferir(p_conv uuid)
returns table (id uuid, nom text, rol text)
language sql stable security definer set search_path to 'public' as $$
  with c as (select plataforma, organizacion_id from public.crm_conversaciones where id = p_conv and organizacion_id = public.mi_organizacion())
  select us.id, us.nom, us.rol
    from public.usuarios_sistema us, c
   where us.organizacion_id = c.organizacion_id and coalesce(us.activo, true) and us.id is distinct from public.mi_usuario_id()
     and public.crm_permiso('crm_bandeja')
     and public.crm_permiso_rol(us.rol, us.organizacion_id, 'crm_bandeja')
     and (us.rol = 'admin' or us.crm_funciones is null or not (us.crm_funciones ? 'canales')
          or (us.crm_funciones -> 'canales') ? c.plataforma)
   order by us.nom
$$;
revoke all on function public.crm_empleados_transferir(uuid) from public, anon;
grant execute on function public.crm_empleados_transferir(uuid) to authenticated;

create or replace function public.crm_transferir_conversacion(p_conv uuid, p_a uuid, p_nota text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_yo uuid := public.mi_usuario_id(); v_rol text := public.mi_rol(); v_org uuid := public.mi_organizacion();
        c record; d record; v_nom text;
begin
  if v_yo is null or v_rol is null then raise exception 'CRM_SIN_SESION'; end if;
  if not public.crm_permiso('crm_bandeja') then raise exception 'CRM_SIN_BANDEJA'; end if;
  if not (public.crm_mis_funciones() ->> 'transferir')::boolean then raise exception 'CRM_SIN_TRANSFERIR'; end if;
  select id, organizacion_id, plataforma, asignado_id into c from public.crm_conversaciones where id = p_conv;
  if c.id is null or c.organizacion_id is distinct from v_org then raise exception 'CRM_CONVERSACION_NO_ENCONTRADA'; end if;
  -- Tiene que poder ver la conversación (misma regla que la RLS).
  if not (c.plataforma = any (public.crm_mis_canales())
          and (v_rol in ('admin','gerente') or c.asignado_id is null or c.asignado_id = v_yo)) then
    raise exception 'CRM_SIN_PERMISO_CONVERSACION';
  end if;
  select us.id, us.nom into d from public.crm_empleados_transferir(p_conv) us where us.id = p_a;
  if d.id is null then raise exception 'CRM_EMPLEADO_NO_VALIDO'; end if;
  select nom into v_nom from public.usuarios_sistema where id = v_yo;
  -- crm_conv_antes solo deja a admin/gerente asignar a otra persona; esta transferencia ya se validó arriba.
  perform set_config('crm.transferencia', '1', true);
  update public.crm_conversaciones set asignado_id = d.id, asignado_nombre = d.nom where id = p_conv;
  perform set_config('crm.transferencia', '', true);
  insert into public.crm_transferencias (organizacion_id, conversacion_id, de_id, de_nombre, a_id, a_nombre, nota)
  values (v_org, p_conv, v_yo, v_nom, d.id, d.nom, nullif(left(trim(coalesce(p_nota, '')), 500), ''));
  return jsonb_build_object('ok', true, 'a_nombre', d.nom);
end $$;
revoke all on function public.crm_transferir_conversacion(uuid, uuid, text) from public, anon;
grant execute on function public.crm_transferir_conversacion(uuid, uuid, text) to authenticated;

-- Transferencias que me hicieron (últimos 7 días), con lo necesario para abrir el chat.
create or replace function public.crm_mis_transferencias()
returns table (id uuid, conversacion_id uuid, plataforma text, cliente text, de_nombre text, nota text,
               created_at timestamptz, visto_at timestamptz, sigue_mia boolean)
language sql stable security definer set search_path to 'public' as $$
  select t.id, t.conversacion_id, c.plataforma,
         coalesce(nullif(c.contacto_nombre, ''), nullif(c.contacto_usuario, ''), c.telefono_e164, 'Cliente'),
         t.de_nombre, t.nota, t.created_at, t.visto_at, c.asignado_id = t.a_id
    from public.crm_transferencias t join public.crm_conversaciones c on c.id = t.conversacion_id
   where t.a_id = public.mi_usuario_id() and t.organizacion_id = public.mi_organizacion()
     and t.created_at > now() - interval '7 days'
   order by (t.visto_at is null) desc, t.created_at desc
   limit 50
$$;
revoke all on function public.crm_mis_transferencias() from public, anon;
grant execute on function public.crm_mis_transferencias() to authenticated;

create or replace function public.crm_transferencia_vista(p_id uuid)
returns void language sql security definer set search_path to 'public' as $$
  update public.crm_transferencias set visto_at = now()
   where id = p_id and visto_at is null and a_id = public.mi_usuario_id()
$$;
revoke all on function public.crm_transferencia_vista(uuid) from public, anon;
grant execute on function public.crm_transferencia_vista(uuid) to authenticated;

commit;

-- REVERSA (manual):
--   alter policy crm_conv_sel / crm_conv_upd → volver a las de 41_crm_permisos_rol.sql (sin la línea de plataforma);
--   drop function crm_transferir_conversacion, crm_empleados_transferir, crm_mis_transferencias, crm_transferencia_vista,
--     crm_guardar_funciones, crm_mis_funciones, crm_mis_canales, crm_permiso_rol; drop table crm_transferencias;
--   alter table usuarios_sistema drop column crm_funciones.
