-- STUDIO · 26 · Financiamiento fase 2 (réplica NEXUS PRO): perfil del cliente ampliado, fiador y evaluación
-- financiera — 2026-09-24.
-- Fuente de verdad: NO se crea una tabla nueva. El perfil crediticio ya vive en pos_fin_perfil (uno por
-- cliente) y las referencias en pos_fin_referencias; aquí solo se agregan las columnas que NEXUS PRO pide
-- en su ficha de cliente (datos personales, contacto, ingresos/gastos y fiador). La evaluación financiera
-- queda en la solicitud (pos_fin_solicitudes.evaluacion), congelada con los números que se usaron.
-- Todo aditivo y nullable: no toca datos existentes.

alter table public.pos_fin_perfil
  add column if not exists fecha_nacimiento date,
  add column if not exists estado_civil text,
  add column if not exists nacionalidad text,
  add column if not exists dependientes integer,
  add column if not exists telefono_alterno text,
  add column if not exists sector text,
  add column if not exists ciudad text,
  add column if not exists provincia text,
  add column if not exists tipo_ingreso text,
  add column if not exists otros_ingresos numeric(14,2),
  add column if not exists gastos_mensuales numeric(14,2),
  add column if not exists antiguedad_anios numeric(5,1),
  add column if not exists tiene_fiador boolean not null default false,
  add column if not exists fiador_nombre text,
  add column if not exists fiador_cedula text,
  add column if not exists fiador_telefono text,
  add column if not exists fiador_direccion text,
  add column if not exists fiador_ocupacion text,
  add column if not exists fiador_relacion text;

alter table public.pos_fin_solicitudes
  add column if not exists evaluacion jsonb,
  add column if not exists evaluacion_score integer,
  add column if not exists evaluado_por text,
  add column if not exists evaluado_en timestamptz;

do $$ begin
  alter table public.pos_fin_solicitudes drop constraint if exists pos_fin_solicitudes_eval_score_chk;
  alter table public.pos_fin_solicitudes add constraint pos_fin_solicitudes_eval_score_chk
    check (evaluacion_score is null or evaluacion_score between 0 and 100);
end $$;

-- La evaluación solo se puede cambiar mientras la solicitud está pendiente (después queda como constancia).
create or replace function public.pos_fin_solicitud_guard_update()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.estado='aprobada' and old.estado<>'aprobada' and coalesce(current_setting('nx.fin_aprobando',true),'')<>'1' then
    raise exception 'FIN_SOLICITUD_APROBAR_SOLO_POR_RPC';
  end if;
  if old.estado in ('aprobada','rechazada','cancelada') and new.estado<>old.estado then
    raise exception 'FIN_SOLICITUD_DECIDIDA_INMUTABLE';
  end if;
  if old.estado <> 'pendiente' and (new.evaluacion is distinct from old.evaluacion or new.evaluacion_score is distinct from old.evaluacion_score) then
    raise exception 'FIN_EVALUACION_SOLO_PENDIENTE';
  end if;
  return new;
end $function$;
