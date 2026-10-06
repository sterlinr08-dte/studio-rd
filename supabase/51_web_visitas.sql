-- 51 · Contador de visitas de la página web (dueño 06-oct-2026: «antes de publicarlo haz un contador de visitas a la
--      página web»). Proyecto STUDIO RD (edbknlkjnlfmkkiizdbe).
--
-- Qué cuenta: cada visita de una persona a la página pública de STUDIO (studiord.net = tienda, /lq-n9, /mayoristas).
-- Sin datos personales: no se guarda IP, nombre ni nada que identifique a alguien. Solo la página, de dónde llegó
-- (Instagram, WhatsApp, Google, Facebook, directo, otro), el tipo de equipo (celular, tableta, computadora) y un número
-- al azar que el navegador guarda para poder contar «visitantes» distintos (se borra si la persona limpia el navegador).
-- No cuenta: los equipos del personal (cookie studio_staff), robots, ni recargas de la misma página por la misma persona
-- dentro de 30 minutos (eso es la misma visita).
--
--  web_registrar_visita(...)  → la llama la página pública (anon), con datos validados y recortados.
--  web_visitas_resumen(dias)  → resumen para el sistema (solo administrador y gerente).

set lock_timeout = '10s';

create table if not exists public.web_visitas (
  id bigserial primary key,
  organizacion_id uuid not null,
  creado timestamptz not null default now(),
  pagina text not null,
  origen text not null,
  dispositivo text not null,
  visitante text not null
);
create index if not exists web_visitas_org_creado on public.web_visitas (organizacion_id, creado desc);
create index if not exists web_visitas_visitante on public.web_visitas (visitante, pagina, creado desc);
alter table public.web_visitas enable row level security;
-- Nadie la lee ni escribe directo: solo por las dos funciones de abajo.
revoke all on public.web_visitas from anon, authenticated;
revoke all on sequence public.web_visitas_id_seq from anon, authenticated;

create or replace function public.web_registrar_visita(p_pagina text, p_origen text, p_dispositivo text, p_visitante text)
returns boolean language plpgsql security definer set search_path = public
as $$
declare v_org uuid; v_pag text; v_ori text; v_dis text; v_vis text;
begin
  v_pag := case when p_pagina in ('tienda', 'lq-n9', 'mayoristas') then p_pagina else 'otra' end;
  v_ori := case when p_origen in ('instagram', 'whatsapp', 'google', 'facebook', 'tiktok', 'directo') then p_origen else 'otro' end;
  v_dis := case when p_dispositivo in ('celular', 'tableta', 'computadora') then p_dispositivo else 'computadora' end;
  v_vis := left(regexp_replace(coalesce(p_visitante, ''), '[^A-Za-z0-9]', '', 'g'), 24);
  if length(v_vis) < 8 then return false; end if;
  select id into v_org from public.organizaciones where slug = 'studio' limit 1;
  if v_org is null then return false; end if;
  -- la misma persona en la misma página dentro de 30 minutos es la misma visita
  if exists (select 1 from public.web_visitas where visitante = v_vis and pagina = v_pag and creado > now() - interval '30 minutes') then
    return false;
  end if;
  -- freno contra abuso: un mismo visitante no suma más de 60 visitas por día
  if (select count(*) from public.web_visitas where visitante = v_vis and creado > now() - interval '1 day') >= 60 then
    return false;
  end if;
  insert into public.web_visitas (organizacion_id, pagina, origen, dispositivo, visitante) values (v_org, v_pag, v_ori, v_dis, v_vis);
  return true;
end $$;
revoke all on function public.web_registrar_visita(text, text, text, text) from public;
grant execute on function public.web_registrar_visita(text, text, text, text) to anon, authenticated;

create or replace function public.web_visitas_resumen(p_dias int default 30)
returns json language plpgsql stable security definer set search_path = public
set "TimeZone" to 'America/Santo_Domingo'
as $$
declare v_org uuid := public.mi_organizacion(); v_dias int := least(greatest(coalesce(p_dias, 30), 1), 366); v_desde date;
begin
  if coalesce(public.mi_rol(), '') not in ('admin', 'gerente') then raise exception 'SOLO_ADMIN_GERENTE'; end if;
  v_desde := current_date - (v_dias - 1);
  return (
    with v as (select *, (creado at time zone 'America/Santo_Domingo')::date d from public.web_visitas where organizacion_id = v_org and creado >= v_desde::timestamp at time zone 'America/Santo_Domingo')
    select json_build_object(
      'dias', v_dias, 'desde', v_desde,
      'hoy', (select count(*) from v where d = current_date),
      'hoy_visitantes', (select count(distinct visitante) from v where d = current_date),
      'ayer', (select count(*) from v where d = current_date - 1),
      'semana', (select count(*) from v where d > current_date - 7),
      'semana_visitantes', (select count(distinct visitante) from v where d > current_date - 7),
      'periodo', (select count(*) from v),
      'periodo_visitantes', (select count(distinct visitante) from v),
      'total', (select count(*) from public.web_visitas where organizacion_id = v_org),
      'por_dia', (select coalesce(json_agg(json_build_object('d', g.d, 'n', coalesce(x.n, 0)) order by g.d), '[]'::json)
                    from generate_series(v_desde, current_date, interval '1 day') g(d)
                    left join (select d, count(*) n from v group by d) x on x.d = g.d::date),
      'por_origen', (select coalesce(json_object_agg(origen, n), '{}'::json) from (select origen, count(*) n from v group by origen) o),
      'por_dispositivo', (select coalesce(json_object_agg(dispositivo, n), '{}'::json) from (select dispositivo, count(*) n from v group by dispositivo) o),
      'por_pagina', (select coalesce(json_object_agg(pagina, n), '{}'::json) from (select pagina, count(*) n from v group by pagina) o)
    )
  );
end $$;
revoke all on function public.web_visitas_resumen(int) from public, anon;
grant execute on function public.web_visitas_resumen(int) to authenticated;
