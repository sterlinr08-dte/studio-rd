-- STUDIO · 25 · Financiamiento: expediente del cliente por link, como «Préstamos» de NEXUS PRO (2026-09-23)
-- Pedido del dueño: «replicar bien el módulo completo de financiamiento y lo del video» · «el módulo de financiamiento es
-- el de NEXUS PRO» · alcance elegido: «Artículos, con todo NEXUS».
--
-- Flujo (igual a NEXUS: firma-prestamo.html + prestamo_solicitudes, adaptado a la venta de artículos de STUDIO):
--   solicitud pendiente → la tienda prepara el link (revisa/edita declaración y guion del video) → el cliente, desde su
--   celular, sube cédula frente/dorso, selfie con la cédula, graba el VIDEO DE COMPROMISO leyendo el guion, firma y acepta
--   → expediente «enviado» → la tienda revisa: aprobar y facturar (RPC existente) · pedir corrección (mismo link) · rechazar.
-- Mejoras de seguridad frente a NEXUS: token propio con vencimiento (no el id), archivos en bucket PRIVADO (NEXUS dejaba
-- cédula/selfie en un bucket público), subida directa a Storage solo dentro de la carpeta del token y solo mientras el
-- expediente está abierto; el rol anon no lee tablas ni archivos.

-- 1) Columnas del expediente en la solicitud (el estado de la solicitud NO cambia: sigue 'pendiente' hasta aprobar)
alter table public.pos_fin_solicitudes
  add column if not exists exp_estado text,                 -- null (sin link) · sin_enviar · enviado · corregir
  add column if not exists exp_token uuid unique,
  add column if not exists exp_token_vence timestamptz,
  add column if not exists video_guion text,
  add column if not exists declaracion text,
  add column if not exists exp_cedula_frente text,          -- rutas en el bucket fin-expediente
  add column if not exists exp_cedula_dorso text,
  add column if not exists exp_selfie text,
  add column if not exists exp_video text,
  add column if not exists exp_firma text,                  -- PNG dataURL (igual que la firma del contrato)
  add column if not exists exp_enviado_en timestamptz,
  add column if not exists exp_meta jsonb,
  add column if not exists correccion_motivo text,
  add column if not exists correccion_at timestamptz,
  add column if not exists exp_link_por text,
  add column if not exists exp_link_en timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'pos_fin_solicitudes_exp_estado_chk') then
    alter table public.pos_fin_solicitudes add constraint pos_fin_solicitudes_exp_estado_chk
      check (exp_estado is null or exp_estado in ('sin_enviar', 'enviado', 'corregir'));
  end if;
end $$;
alter table public.pos_fin_documentos add column if not exists bucket text not null default 'documentos';
alter table public.pos_financiamientos add column if not exists expediente_solicitud_id uuid;

-- 2) Bucket privado del expediente (fotos hasta 12 MB se reducen en el teléfono; video hasta 80 MB como NEXUS)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fin-expediente', 'fin-expediente', false, 83886080,
        array['image/jpeg','image/png','image/webp','video/mp4','video/quicktime','video/webm','video/3gpp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- ¿El token (carpeta sol/<token>/…) corresponde a un expediente abierto y vigente?
create or replace function public.pos_fin_exp_token_abierto(p_token text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from public.pos_fin_solicitudes
     where exp_token::text = p_token
       and estado = 'pendiente'
       and exp_estado in ('sin_enviar', 'corregir')
       and (exp_token_vence is null or exp_token_vence > now()));
$function$;
revoke all on function public.pos_fin_exp_token_abierto(text) from public;
grant execute on function public.pos_fin_exp_token_abierto(text) to anon, authenticated;

drop policy if exists fin_exp_anon_insert on storage.objects;
create policy fin_exp_anon_insert on storage.objects for insert to anon
  with check (bucket_id = 'fin-expediente'
              and (storage.foldername(name))[1] = 'sol'
              and public.pos_fin_exp_token_abierto((storage.foldername(name))[2]));
drop policy if exists fin_exp_auth_select on storage.objects;
create policy fin_exp_auth_select on storage.objects for select to authenticated
  using (bucket_id = 'fin-expediente');
drop policy if exists fin_exp_auth_delete on storage.objects;
create policy fin_exp_auth_delete on storage.objects for delete to authenticated
  using (bucket_id = 'fin-expediente' and public.mi_rol() in ('admin', 'gerente'));

-- 3) La tienda prepara (o renueva) el link con la declaración y el guion ya revisados
create or replace function public.pos_fin_sol_link(p_solicitud_id uuid, p_declaracion text, p_guion text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare s public.pos_fin_solicitudes%rowtype; v_h int; v_tok uuid; v_usr text;
begin
  if public.mi_rol() is null then raise exception 'FIN_SIN_PERMISO'; end if;
  select * into s from public.pos_fin_solicitudes where id = p_solicitud_id and organizacion_id = public.mi_organizacion() for update;
  if s.id is null then raise exception 'FIN_SOLICITUD_NO_ENCONTRADA'; end if;
  if s.estado <> 'pendiente' then raise exception 'FIN_SOLICITUD_NO_PENDIENTE'; end if;
  if s.exp_estado = 'enviado' then raise exception 'FIN_EXPEDIENTE_YA_ENVIADO'; end if;
  if length(trim(coalesce(p_declaracion, ''))) < 20 or length(trim(coalesce(p_guion, ''))) < 20 then raise exception 'FIN_TEXTOS_VACIOS'; end if;
  select coalesce(fin_firma_vigencia_horas, 72) into v_h from public.pos_config where organizacion_id = s.organizacion_id;
  v_tok := coalesce(s.exp_token, gen_random_uuid());
  select us.nom into v_usr from public.profiles pr join public.usuarios_sistema us on us.id = pr.usuario_sistema_id where pr.id = auth.uid() limit 1;
  update public.pos_fin_solicitudes
     set exp_token = v_tok, exp_token_vence = now() + make_interval(hours => greatest(coalesce(v_h, 72), 24) * 2),
         declaracion = left(trim(p_declaracion), 2000), video_guion = left(trim(p_guion), 2000),
         exp_estado = coalesce(nullif(exp_estado, ''), 'sin_enviar'), exp_link_por = v_usr, exp_link_en = now()
   where id = s.id;
  return jsonb_build_object('ok', true, 'token', v_tok);
end;
$function$;

-- 4) Lectura pública por token
create or replace function public.pos_fin_sol_ver(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare s public.pos_fin_solicitudes%rowtype; pl public.pos_fin_planes%rowtype; v_emp text; v_tel text; v_cuotas jsonb;
begin
  if p_token is null then return jsonb_build_object('ok', false, 'error', 'LINK_INVALIDO'); end if;
  select * into s from public.pos_fin_solicitudes where exp_token = p_token;
  if s.id is null then return jsonb_build_object('ok', false, 'error', 'LINK_INVALIDO'); end if;
  select * into pl from public.pos_fin_planes where id = s.plan_id;
  select nombre into v_emp from public.organizaciones where id = s.organizacion_id;
  select telefono into v_tel from public.pos_clientes where id = s.cliente_id;
  begin
    select coalesce(jsonb_agg(jsonb_build_object('numero', a.numero, 'fecha', a.fecha_venc, 'monto', a.cuota) order by a.numero), '[]'::jsonb)
      into v_cuotas from public.pos_fin_amortizacion(s.precio_total - s.inicial, pl.metodo, pl.num_cuotas, pl.cuotas_fase1, pl.tasa1, pl.tasa2, pl.frecuencia, s.primera_fecha) a;
  exception when others then v_cuotas := '[]'::jsonb; end;
  return jsonb_build_object(
    'ok', true, 'empresa', coalesce(v_emp, 'STUDIO'), 'codigo', s.codigo, 'cliente', s.cliente_nombre,
    'articulos', (select coalesce(jsonb_agg(jsonb_build_object('nombre', x->>'nombre', 'cantidad', x->'cantidad')), '[]'::jsonb) from jsonb_array_elements(coalesce(s.items, '[]'::jsonb)) x),
    'precio', s.precio_total, 'inicial', s.inicial, 'capital', s.precio_total - s.inicial,
    'plan', pl.nombre, 'frecuencia', pl.frecuencia, 'cuotas', v_cuotas,
    'declaracion', s.declaracion, 'guion', s.video_guion,
    'estado', s.estado, 'exp_estado', s.exp_estado, 'correccion', s.correccion_motivo,
    'vencido', s.exp_token_vence is not null and s.exp_token_vence < now(),
    'enviado_en', s.exp_enviado_en,
    'pide_telefono', v_tel is not null and length(regexp_replace(v_tel, '\D', '', 'g')) >= 4);
end;
$function$;

-- 5) Envío del expediente (los archivos ya se subieron a sol/<token>/…; aquí se validan y se registran)
create or replace function public.pos_fin_sol_enviar(p_token uuid, p_cedula_frente text, p_cedula_dorso text, p_selfie text,
  p_video text, p_firma text, p_nombre text, p_tel4 text, p_acepta boolean)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'storage'
as $function$
declare s public.pos_fin_solicitudes%rowtype; v_pref text; v_tel text; v_hdr jsonb; p text;
begin
  if p_token is null then return jsonb_build_object('ok', false, 'error', 'LINK_INVALIDO'); end if;
  select * into s from public.pos_fin_solicitudes where exp_token = p_token for update;
  if s.id is null then return jsonb_build_object('ok', false, 'error', 'LINK_INVALIDO'); end if;
  if s.estado <> 'pendiente' then return jsonb_build_object('ok', false, 'error', 'SOLICITUD_CERRADA'); end if;
  if s.exp_estado = 'enviado' then return jsonb_build_object('ok', false, 'error', 'YA_ENVIADO'); end if;
  if s.exp_token_vence is not null and s.exp_token_vence < now() then return jsonb_build_object('ok', false, 'error', 'LINK_VENCIDO'); end if;
  if coalesce(p_acepta, false) is not true then return jsonb_build_object('ok', false, 'error', 'DEBE_ACEPTAR'); end if;
  if p_firma is null or p_firma not like 'data:image/png;base64,%' or length(p_firma) < 1500 or length(p_firma) > 600000 then
    return jsonb_build_object('ok', false, 'error', 'FIRMA_INVALIDA');
  end if;
  select telefono into v_tel from public.pos_clientes where id = s.cliente_id;
  v_tel := regexp_replace(coalesce(v_tel, ''), '\D', '', 'g');
  if length(v_tel) >= 4 and right(v_tel, 4) <> regexp_replace(coalesce(p_tel4, ''), '\D', '', 'g') then
    return jsonb_build_object('ok', false, 'error', 'TELEFONO_NO_COINCIDE');
  end if;
  v_pref := 'sol/' || p_token::text || '/';
  foreach p in array array[p_cedula_frente, p_cedula_dorso, p_selfie, p_video] loop
    if p is null or left(p, length(v_pref)) <> v_pref
       or not exists (select 1 from storage.objects o where o.bucket_id = 'fin-expediente' and o.name = p) then
      return jsonb_build_object('ok', false, 'error', 'FALTA_ARCHIVO');
    end if;
  end loop;
  begin v_hdr := current_setting('request.headers', true)::jsonb; exception when others then v_hdr := null; end;
  update public.pos_fin_solicitudes
     set exp_cedula_frente = p_cedula_frente, exp_cedula_dorso = p_cedula_dorso, exp_selfie = p_selfie, exp_video = p_video,
         exp_firma = p_firma, exp_estado = 'enviado', exp_enviado_en = now(),
         exp_meta = jsonb_build_object(
           'ip', coalesce(v_hdr->>'cf-connecting-ip', split_part(coalesce(v_hdr->>'x-forwarded-for', ''), ',', 1)),
           'navegador', left(coalesce(v_hdr->>'user-agent', ''), 300),
           'nombre_escrito', left(coalesce(p_nombre, ''), 120),
           'declaracion_md5', md5(coalesce(s.declaracion, '')), 'guion_md5', md5(coalesce(s.video_guion, '')), 'en', now())
   where id = s.id;
  return jsonb_build_object('ok', true, 'codigo', s.codigo);
end;
$function$;

-- 6) La tienda pide corrección (mismo link) — como NEXUS «Pedir corrección / rehacer»
create or replace function public.pos_fin_sol_corregir(p_solicitud_id uuid, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare s public.pos_fin_solicitudes%rowtype; v_h int;
begin
  if public.mi_rol() not in ('admin', 'gerente') then raise exception 'FIN_SIN_PERMISO'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 5 then raise exception 'FIN_MOTIVO_REQUERIDO'; end if;
  select * into s from public.pos_fin_solicitudes where id = p_solicitud_id and organizacion_id = public.mi_organizacion() for update;
  if s.id is null then raise exception 'FIN_SOLICITUD_NO_ENCONTRADA'; end if;
  if s.estado <> 'pendiente' or s.exp_token is null then raise exception 'FIN_SOLICITUD_NO_PENDIENTE'; end if;
  select coalesce(fin_firma_vigencia_horas, 72) into v_h from public.pos_config where organizacion_id = s.organizacion_id;
  update public.pos_fin_solicitudes
     set exp_estado = 'corregir', correccion_motivo = left(trim(p_motivo), 500), correccion_at = now(),
         exp_token_vence = greatest(coalesce(exp_token_vence, now()), now() + make_interval(hours => greatest(coalesce(v_h, 72), 24) * 2))
   where id = s.id;
  return jsonb_build_object('ok', true, 'token', s.exp_token);
end;
$function$;

-- 7) Al aprobar: el expediente pasa al financiamiento (firma del cliente = la del link; archivos a Documentos)
create or replace function public.pos_fin_exp_a_financiamiento()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.estado = 'aprobada' and old.estado <> 'aprobada' and new.financiamiento_id is not null and new.exp_estado = 'enviado' then
    update public.pos_financiamientos
       set firma_cliente = coalesce(firma_cliente, new.exp_firma),
           firma_cliente_en = coalesce(firma_cliente_en, new.exp_enviado_en),
           firma_cliente_meta = coalesce(firma_cliente_meta, new.exp_meta || jsonb_build_object('origen', 'expediente_link', 'solicitud', new.codigo)),
           expediente_solicitud_id = new.id
     where id = new.financiamiento_id;
    insert into public.pos_fin_documentos (organizacion_id, cliente_id, solicitud_id, financiamiento_id, tipo, nombre, storage_path, bucket)
    select new.organizacion_id, new.cliente_id, new.id, new.financiamiento_id, t.tipo, t.nombre, t.ruta, 'fin-expediente'
      from (values ('cedula_frente', 'Cédula (frente) · link', new.exp_cedula_frente),
                   ('cedula_dorso', 'Cédula (dorso) · link', new.exp_cedula_dorso),
                   ('selfie', 'Foto con la cédula · link', new.exp_selfie),
                   ('video', 'Video de compromiso · link', new.exp_video)) t(tipo, nombre, ruta)
     where t.ruta is not null;
  end if;
  return new;
end;
$function$;
drop trigger if exists pos_fin_exp_a_financiamiento on public.pos_fin_solicitudes;
create trigger pos_fin_exp_a_financiamiento after update on public.pos_fin_solicitudes
  for each row execute function public.pos_fin_exp_a_financiamiento();

revoke all on function public.pos_fin_sol_link(uuid, text, text) from public;
revoke all on function public.pos_fin_sol_ver(uuid) from public;
revoke all on function public.pos_fin_sol_enviar(uuid, text, text, text, text, text, text, text, boolean) from public;
revoke all on function public.pos_fin_sol_corregir(uuid, text) from public;
grant execute on function public.pos_fin_sol_link(uuid, text, text) to authenticated;
grant execute on function public.pos_fin_sol_ver(uuid) to anon, authenticated;
grant execute on function public.pos_fin_sol_enviar(uuid, text, text, text, text, text, text, text, boolean) to anon, authenticated;
grant execute on function public.pos_fin_sol_corregir(uuid, text) to authenticated;
