-- STUDIO · 31 · Limpieza de nombres migrados «NEGOCIO / PERSONA» — 2026-09-24
-- Autorizado por el dueño: «El punto 3 corrige eso» + opción «Separar en Nombre y Contacto».
-- 201 de 399 clientes venían de la migración con el nombre armado como «NEGOCIO / PERSONA» (a veces repetido).
-- Regla: se parte por «/»; si todo el nombre viene duplicado («A / B / A / B») se toma una sola mitad; si las dos
-- partes dicen lo mismo (sin contar espacios ni signos) o una contiene a la otra, queda un solo nombre (el más
-- completo); si no, NOMBRE = primera parte y CONTACTO = el resto (la columna contacto ya existía y estaba vacía).
-- Respaldo completo en pos_clientes_nombre_respaldo para poder deshacerlo. Las facturas, financiamientos y demás
-- documentos guardan su propio cliente_nombre, así que el historial NO cambia.
create table if not exists public.pos_clientes_nombre_respaldo (
  cliente_id uuid primary key references public.pos_clientes(id) on delete cascade,
  organizacion_id uuid not null,
  nombre_original text not null,
  contacto_original text,
  creado_en timestamptz not null default now()
);
alter table public.pos_clientes_nombre_respaldo enable row level security;
drop policy if exists pos_clientes_nombre_respaldo_org on public.pos_clientes_nombre_respaldo;
create policy pos_clientes_nombre_respaldo_org on public.pos_clientes_nombre_respaldo for select to authenticated
  using (organizacion_id = public.mi_organizacion());

create or replace function public.pos_nombre_migrado_partes(p text)
returns text[]
language plpgsql
immutable
set search_path to 'public'
as $function$
declare parts text[]; x text; limpio text[] := '{}'; n int; a text; b text; na text; nb text;
begin
  parts := regexp_split_to_array(coalesce(p, ''), '/');
  foreach x in array parts loop
    x := trim(regexp_replace(x, '^[^[:alnum:]]+|[^[:alnum:].)]+$', '', 'g'));
    if x <> '' then limpio := limpio || x; end if;
  end loop;
  n := coalesce(array_length(limpio, 1), 0);
  if n = 0 then return array[trim(p), null]; end if;
  if n % 2 = 0 and n > 1 and upper(array_to_string(limpio[1:n/2], '|')) = upper(array_to_string(limpio[n/2+1:n], '|')) then
    limpio := limpio[1:n/2]; n := n / 2;
  end if;
  a := limpio[1]; b := case when n > 1 then array_to_string(limpio[2:n], ' / ') end;
  if b is null then return array[a, null]; end if;
  na := upper(regexp_replace(a, '[^[:alnum:]]', '', 'g')); nb := upper(regexp_replace(b, '[^[:alnum:]]', '', 'g'));
  if na = nb then return array[a, null]; end if;
  if nb like na || '%' then return array[b, null]; end if;
  if na like nb || '%' then return array[a, null]; end if;
  return array[a, b];
end $function$;

-- ============================================================================
-- 31b + 31c (aplicadas como studio_31b_nombre_migrado_regla y
-- studio_31c_nombre_parte_redundante): versión final de la regla.
--   · repara letras dañadas por la migración («Ã‘» → «Ñ», «Ã±» → «ñ»);
--   · una barra entre dos letras sueltas («V/P») es parte del nombre;
--   · «A / B / A B»: la última parte solo repite las anteriores → se descarta.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.pos_nombre_migrado_partes(p text)
 RETURNS text[] LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public'
AS $function$
declare s text; parts text[]; x text; limpio text[] := '{}'; n int; a text; b text; na text; nb text;
begin
  -- letras dañadas por la migración (UTF-8 leído como Latin-1)
  s := replace(replace(coalesce(p, ''), 'Ã' || chr(145), 'Ñ'), 'Ã±', 'ñ');
  -- «V/P», «A/C»: una barra entre dos letras sueltas es parte del nombre, no un separador
  s := regexp_replace(s, '(^|[^[:alnum:]])([[:alnum:]])/([[:alnum:]])($|[^[:alnum:]])', '\1\2§\3\4', 'g');
  parts := regexp_split_to_array(s, '/');
  foreach x in array parts loop
    x := trim(regexp_replace(replace(x, '§', '/'), '^[^[:alnum:]]+|[^[:alnum:].)]+$', '', 'g'));
    if x <> '' then limpio := limpio || x; end if;
  end loop;
  n := coalesce(array_length(limpio, 1), 0);
  if n = 0 then return array[trim(p), null]; end if;
  if n % 2 = 0 and n > 1 and upper(array_to_string(limpio[1:n/2], '|')) = upper(array_to_string(limpio[n/2+1:n], '|')) then
    limpio := limpio[1:n/2]; n := n / 2;
  end if;
  -- «PERSONA / APODO / PERSONA APODO»: la última parte solo repite las anteriores juntas
  if n >= 3 and (select string_agg(w, ' ' order by w) from regexp_split_to_table(upper(limpio[n]), '[^[:alnum:]]+') w where w <> '')
              = (select string_agg(w, ' ' order by w) from regexp_split_to_table(upper(array_to_string(limpio[1:n-1], ' ')), '[^[:alnum:]]+') w where w <> '') then
    n := n - 1; limpio := limpio[1:n];
  end if;
  a := limpio[1]; b := case when n > 1 then array_to_string(limpio[2:n], ' / ') end;
  if b is null then return array[a, null]; end if;
  na := upper(regexp_replace(a, '[^[:alnum:]]', '', 'g')); nb := upper(regexp_replace(b, '[^[:alnum:]]', '', 'g'));
  if na = nb then return array[a, null]; end if;
  if nb like na || '%' then return array[b, null]; end if;
  if na like nb || '%' then return array[a, null]; end if;
  return array[a, b];
end $function$;

-- ============================================================================
-- 31d (aplicada como studio_31d_clientes_nombre_aplicar) — autorizada por el
-- dueño: respaldar y separar. Idempotente: el respaldo no se sobrescribe y un
-- contacto ya existente se conserva. Las facturas guardan su propio
-- cliente_nombre y no cambian.
-- Deshacer: update pos_clientes c set nombre = r.nombre_original,
--           contacto = r.contacto_original
--           from pos_clientes_nombre_respaldo r where r.cliente_id = c.id;
-- ============================================================================
insert into public.pos_clientes_nombre_respaldo(cliente_id, organizacion_id, nombre_original, contacto_original)
  select id, organizacion_id, nombre, contacto from public.pos_clientes
  where nombre like '%/%' or nombre ~ 'Ã'
  on conflict (cliente_id) do nothing;
update public.pos_clientes c
   set nombre = x.r[1], contacto = coalesce(nullif(trim(c.contacto), ''), x.r[2])
  from (select id, public.pos_nombre_migrado_partes(nombre) r from public.pos_clientes
        where nombre like '%/%' or nombre ~ 'Ã') x
 where x.id = c.id;
