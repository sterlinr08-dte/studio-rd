-- STUDIO · 24 · Financiamiento: firma del cliente por link (página pública firma-financiamiento.html) — 2026-09-23
-- Bloque B pendiente desde 2026-09-22 (bitácoras 0610/0720/0830 de nexus-pro): el botón «Enviar link de firma por
-- WhatsApp» ya armaba el link, pero la página y las funciones públicas no existían (el cliente veía un error).
--
-- Seguridad:
--  * La página pública usa la llave anon. Solo puede llamar a estas dos funciones (security definer), nunca a tablas.
--  * El token es un uuid aleatorio por financiamiento, con vencimiento (pos_config.fin_firma_vigencia_horas, 72 h).
--  * Para firmar, el cliente debe escribir los últimos 4 dígitos de su teléfono registrado (si hay teléfono).
--    Máximo 5 intentos fallidos por token; al quinto el token se invalida y la tienda debe generar otro.
--  * La firma solo se guarda una vez (no se puede reemplazar desde el link). Queda evento con IP y navegador.
--  * pos_fin_firma_renovar solo para admin/gerente autenticados.

alter table public.pos_financiamientos add column if not exists firma_intentos integer not null default 0;
alter table public.pos_financiamientos add column if not exists firma_cliente_meta jsonb;

do $$ begin
  alter table public.pos_credito_eventos drop constraint if exists pos_credito_eventos_tipo_check;
  alter table public.pos_credito_eventos add constraint pos_credito_eventos_tipo_check
    check (tipo = any (array['promesa','refinanciacion','castigo','vencimiento','aprobacion','condonacion_mora','firma_cliente','firma_link']));
end $$;

-- Lectura pública del contrato por token (sin datos de otros clientes).
create or replace function public.pos_fin_firma_ver(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare f public.pos_financiamientos%rowtype; v_emp text; v_tel text; v_cuotas jsonb;
begin
  if p_token is null then return jsonb_build_object('ok', false, 'error', 'LINK_INVALIDO'); end if;
  select * into f from public.pos_financiamientos where firma_token = p_token;
  if f.id is null then return jsonb_build_object('ok', false, 'error', 'LINK_INVALIDO'); end if;
  select nombre into v_emp from public.organizaciones where id = f.organizacion_id;
  select telefono into v_tel from public.pos_clientes where id = f.cliente_id;
  select coalesce(jsonb_agg(jsonb_build_object('numero', numero, 'fecha', fecha_venc, 'monto', monto) order by numero), '[]'::jsonb)
    into v_cuotas from public.pos_fin_cuotas where financiamiento_id = f.id;
  return jsonb_build_object(
    'ok', true,
    'empresa', coalesce(v_emp, 'STUDIO'),
    'codigo', f.codigo,
    'cliente', f.cliente_nombre,
    'descripcion', f.descripcion,
    'precio', f.monto_total, 'inicial', f.inicial, 'capital', f.monto_financiado, 'interes', f.interes_total,
    'cuotas_total', f.cuotas_total, 'frecuencia', f.frecuencia, 'primera_fecha', f.primera_fecha,
    'cuotas', v_cuotas,
    'titulo', f.contrato_titulo, 'contrato', f.contrato_texto, 'version', f.contrato_version,
    'firmado', f.firma_cliente is not null, 'firmado_en', f.firma_cliente_en,
    'vence', f.firma_token_vence,
    'vencido', (f.firma_token_vence is not null and f.firma_token_vence < now()) or f.firma_intentos >= 5,
    'pide_telefono', v_tel is not null and length(regexp_replace(v_tel, '\D', '', 'g')) >= 4,
    'estado', f.estado
  );
end;
$function$;

create or replace function public.pos_fin_firma_guardar(p_token uuid, p_firma text, p_tel4 text, p_nombre text, p_acepta boolean)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare f public.pos_financiamientos%rowtype; v_tel text; v_hdr jsonb; v_meta jsonb;
begin
  if p_token is null then return jsonb_build_object('ok', false, 'error', 'LINK_INVALIDO'); end if;
  select * into f from public.pos_financiamientos where firma_token = p_token for update;
  if f.id is null then return jsonb_build_object('ok', false, 'error', 'LINK_INVALIDO'); end if;
  if f.firma_cliente is not null then return jsonb_build_object('ok', false, 'error', 'YA_FIRMADO'); end if;
  if f.firma_intentos >= 5 or (f.firma_token_vence is not null and f.firma_token_vence < now()) then
    return jsonb_build_object('ok', false, 'error', 'LINK_VENCIDO');
  end if;
  if f.estado not in ('activo') then return jsonb_build_object('ok', false, 'error', 'FINANCIAMIENTO_NO_ACTIVO'); end if;
  if coalesce(p_acepta, false) is not true then return jsonb_build_object('ok', false, 'error', 'DEBE_ACEPTAR'); end if;
  if p_firma is null or p_firma not like 'data:image/png;base64,%' or length(p_firma) < 1500 or length(p_firma) > 600000 then
    return jsonb_build_object('ok', false, 'error', 'FIRMA_INVALIDA');
  end if;
  select telefono into v_tel from public.pos_clientes where id = f.cliente_id;
  v_tel := regexp_replace(coalesce(v_tel, ''), '\D', '', 'g');
  if length(v_tel) >= 4 and right(v_tel, 4) <> regexp_replace(coalesce(p_tel4, ''), '\D', '', 'g') then
    update public.pos_financiamientos set firma_intentos = firma_intentos + 1 where id = f.id;
    return jsonb_build_object('ok', false, 'error', 'TELEFONO_NO_COINCIDE', 'intentos_restantes', greatest(0, 4 - f.firma_intentos));
  end if;
  begin v_hdr := current_setting('request.headers', true)::jsonb; exception when others then v_hdr := null; end;
  v_meta := jsonb_build_object(
    'ip', coalesce(v_hdr->>'cf-connecting-ip', split_part(coalesce(v_hdr->>'x-forwarded-for', ''), ',', 1)),
    'navegador', left(coalesce(v_hdr->>'user-agent', ''), 300),
    'nombre_escrito', left(coalesce(p_nombre, ''), 120),
    'contrato_version', f.contrato_version,
    'contrato_hash', md5(coalesce(f.contrato_texto, '')),
    'en', now());
  update public.pos_financiamientos
     set firma_cliente = p_firma, firma_cliente_en = now(), firma_cliente_tel = nullif(v_tel, ''),
         firma_cliente_meta = v_meta, firma_token_vence = now()
   where id = f.id;
  insert into public.pos_credito_eventos(organizacion_id, cliente_id, venta_id, financiamiento_id, tipo, nota)
  values (f.organizacion_id, f.cliente_id, f.venta_id, f.id, 'firma_cliente',
          'Contrato ' || coalesce(f.codigo, '') || ' firmado por link · ' || coalesce(v_meta->>'nombre_escrito', '') || ' · IP ' || coalesce(v_meta->>'ip', '—'));
  return jsonb_build_object('ok', true, 'codigo', f.codigo, 'firmado_en', now());
end;
$function$;

-- Nuevo link (admin/gerente): invalida el anterior.
create or replace function public.pos_fin_firma_renovar(p_financiamiento_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare f public.pos_financiamientos%rowtype; v_h integer; v_tok uuid := gen_random_uuid(); v_vence timestamptz;
begin
  if public.mi_rol() not in ('admin', 'gerente') then raise exception 'FIN_SIN_PERMISO'; end if;
  select * into f from public.pos_financiamientos where id = p_financiamiento_id and organizacion_id = public.mi_organizacion() for update;
  if f.id is null then raise exception 'FIN_NO_ENCONTRADO'; end if;
  if f.firma_cliente is not null then raise exception 'FIN_YA_FIRMADO'; end if;
  select coalesce(fin_firma_vigencia_horas, 72) into v_h from public.pos_config where organizacion_id = f.organizacion_id;
  v_vence := now() + make_interval(hours => coalesce(v_h, 72));
  update public.pos_financiamientos set firma_token = v_tok, firma_token_vence = v_vence, firma_intentos = 0 where id = f.id;
  insert into public.pos_credito_eventos(organizacion_id, cliente_id, venta_id, financiamiento_id, tipo, nota)
  values (f.organizacion_id, f.cliente_id, f.venta_id, f.id, 'firma_link', 'Nuevo link de firma, vence ' || to_char(v_vence at time zone 'America/Santo_Domingo', 'DD/MM/YYYY HH24:MI'));
  return jsonb_build_object('ok', true, 'token', v_tok, 'vence', v_vence);
end;
$function$;

revoke all on function public.pos_fin_firma_ver(uuid) from public;
revoke all on function public.pos_fin_firma_guardar(uuid, text, text, text, boolean) from public;
revoke all on function public.pos_fin_firma_renovar(uuid) from public;
grant execute on function public.pos_fin_firma_ver(uuid) to anon, authenticated;
grant execute on function public.pos_fin_firma_guardar(uuid, text, text, text, boolean) to anon, authenticated;
grant execute on function public.pos_fin_firma_renovar(uuid) to authenticated;
