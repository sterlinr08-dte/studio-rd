-- STUDIO · 29 · Financiamiento fase 5 (réplica NEXUS PRO): datos legales del contrato — 2026-09-24
-- NEXUS guarda en prestamos_config al acreedor, al abogado notario (cédula, matrícula CARD) y dos testigos, y los
-- imprime en el contrato con la «LEGALIZACIÓN DE FIRMAS». En STUDIO:
--  * La configuración vive en pos_config (una fila por organización, igual que el resto del POS).
--  * Cada financiamiento CONGELA esos datos en pos_financiamientos.contrato_legal al crearse (trigger), como ya
--    se congela el texto del contrato. Así un cambio de abogado no altera contratos ya emitidos.
--  * Para financiamientos creados antes de configurar, pos_fin_contrato_legal_fijar() los congela la primera vez
--    que se imprime el contrato (solo si todavía está vacío).
-- Todo aditivo.
alter table public.pos_config
  add column if not exists fin_acreedor_nombre text,
  add column if not exists fin_acreedor_doc text,
  add column if not exists fin_acreedor_tel text,
  add column if not exists fin_acreedor_dir text,
  add column if not exists fin_abogado_nombre text,
  add column if not exists fin_abogado_cedula text,
  add column if not exists fin_abogado_matricula text,
  add column if not exists fin_abogado_tel text,
  add column if not exists fin_testigo1_nombre text,
  add column if not exists fin_testigo1_cedula text,
  add column if not exists fin_testigo2_nombre text,
  add column if not exists fin_testigo2_cedula text;

alter table public.pos_financiamientos add column if not exists contrato_legal jsonb;

create or replace function public.pos_fin_legal_snapshot(p_org uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select case when c.organizacion_id is null then null else jsonb_strip_nulls(jsonb_build_object(
    'acreedor_nombre', nullif(trim(c.fin_acreedor_nombre), ''), 'acreedor_doc', nullif(trim(c.fin_acreedor_doc), ''),
    'acreedor_tel', nullif(trim(c.fin_acreedor_tel), ''), 'acreedor_dir', nullif(trim(c.fin_acreedor_dir), ''),
    'abogado_nombre', nullif(trim(c.fin_abogado_nombre), ''), 'abogado_cedula', nullif(trim(c.fin_abogado_cedula), ''),
    'abogado_matricula', nullif(trim(c.fin_abogado_matricula), ''), 'abogado_tel', nullif(trim(c.fin_abogado_tel), ''),
    'testigo1_nombre', nullif(trim(c.fin_testigo1_nombre), ''), 'testigo1_cedula', nullif(trim(c.fin_testigo1_cedula), ''),
    'testigo2_nombre', nullif(trim(c.fin_testigo2_nombre), ''), 'testigo2_cedula', nullif(trim(c.fin_testigo2_cedula), ''),
    'fijado_en', now())) end
  from public.pos_config c where c.organizacion_id = p_org;
$function$;
revoke all on function public.pos_fin_legal_snapshot(uuid) from public;

create or replace function public.pos_fin_legal_al_crear()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.contrato_legal is null then new.contrato_legal := public.pos_fin_legal_snapshot(new.organizacion_id); end if;
  return new;
end $function$;
drop trigger if exists pos_fin_legal_al_crear on public.pos_financiamientos;
create trigger pos_fin_legal_al_crear before insert on public.pos_financiamientos
  for each row execute function public.pos_fin_legal_al_crear();

create or replace function public.pos_fin_contrato_legal_fijar(p_financiamiento_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare f public.pos_financiamientos%rowtype;
begin
  if public.mi_rol() is null then raise exception 'FIN_SIN_PERMISO'; end if;
  select * into f from public.pos_financiamientos where id = p_financiamiento_id and organizacion_id = public.mi_organizacion() for update;
  if f.id is null then raise exception 'FIN_NO_ENCONTRADO'; end if;
  if f.contrato_legal is not null then return f.contrato_legal; end if;
  update public.pos_financiamientos set contrato_legal = public.pos_fin_legal_snapshot(f.organizacion_id) where id = f.id returning contrato_legal into f.contrato_legal;
  return f.contrato_legal;
end $function$;
revoke all on function public.pos_fin_contrato_legal_fijar(uuid) from public;
grant execute on function public.pos_fin_contrato_legal_fijar(uuid) to authenticated;
