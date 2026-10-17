-- 53_metas_ventas.sql — STUDIO RD (16-oct-2026). Metas de ventas del Tablero de ventas (parches-pos-tablero.js).
-- NO APLICADA: espera el «publícalo» del dueño. Orden al publicar: correr la prueba (todo se deshace), aplicar esta
-- migración y después publicar 59.95. Sin esta migración el tablero funciona igual y dice «sin meta».
--
-- Qué guarda: una meta en pesos por MES para el negocio (vendedor = '') y, si se quiere, una por vendedor (el nombre
-- tal como sale en la factura: vendedor_nombre o, si falta, quien facturó). El tablero reparte la meta del mes por días
-- cuando se mira otro rango. No toca ventas, cobros, caja ni contabilidad: es solo una referencia para comparar.
--
--  · Leer: cualquier usuario con rol de la misma organización (el tablero lo abre quien tiene Reportes).
--  · Escribir: SOLO el administrador, y solo por la función pos_metas_guardar(mes, metas) — reemplaza las metas de ese
--    mes en una sola operación (dejar un campo vacío quita esa meta). Nadie escribe la tabla directo.
-- Prueba: supabase/studio/pruebas/53_prueba_metas_ventas.sql. Reversa al final de este archivo.

set local lock_timeout = '5s';

create table if not exists public.pos_metas_ventas (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null,
  mes date not null,
  vendedor text not null default '',
  monto numeric(14,2) not null,
  updated_at timestamptz not null default now(),
  updated_by_name text,
  constraint pos_metas_ventas_mes_dia1 check (mes = date_trunc('month', mes)::date),
  constraint pos_metas_ventas_monto check (monto > 0 and monto < 100000000000),
  constraint pos_metas_ventas_vendedor check (vendedor = btrim(vendedor) and length(vendedor) <= 120),
  constraint pos_metas_ventas_uk unique (organizacion_id, mes, vendedor)
);
comment on table public.pos_metas_ventas is 'Metas de ventas por mes (vendedor vacío = negocio). Solo se escriben con pos_metas_guardar (administrador).';

alter table public.pos_metas_ventas enable row level security;
drop policy if exists pos_metas_ventas_leer on public.pos_metas_ventas;
create policy pos_metas_ventas_leer on public.pos_metas_ventas for select
  using (public.mi_rol() is not null and organizacion_id = public.mi_organizacion());
revoke all on public.pos_metas_ventas from anon;
revoke insert, update, delete, truncate on public.pos_metas_ventas from authenticated;
grant select on public.pos_metas_ventas to authenticated;

create or replace function public.pos_metas_guardar(p_mes date, p_metas jsonb)
returns integer language plpgsql security definer set search_path = public
as $$
declare
  v_org uuid := public.mi_organizacion();
  v_mes date;
  v_nom text;
  v_n integer := 0;
  e jsonb;
  v_vend text;
  v_monto numeric;
begin
  if coalesce(public.mi_rol(), '') <> 'admin' then
    raise exception 'METAS_SOLO_ADMIN' using detail = 'Solo el administrador define las metas de ventas';
  end if;
  if v_org is null then raise exception 'SIN_ORGANIZACION'; end if;
  if p_mes is null then raise exception 'METAS_MES' using detail = 'Falta el mes de las metas'; end if;
  v_mes := date_trunc('month', p_mes)::date;
  if p_metas is null then p_metas := '[]'::jsonb; end if;
  if jsonb_typeof(p_metas) <> 'array' or jsonb_array_length(p_metas) > 300 then
    raise exception 'METAS_FORMATO' using detail = 'Las metas deben ser una lista (máximo 300)';
  end if;
  select us.nom into v_nom from public.usuarios_sistema us where us.id = public.mi_usuario_id();

  -- Dos guardados del mismo mes a la vez (hay dos administradores) van uno detrás del otro: si no, el segundo no vería
  -- las filas que acaba de insertar el primero y el mes quedaría con una mezcla de las dos listas.
  perform pg_advisory_xact_lock(hashtextextended(v_org::text || ':' || v_mes::text, 0));
  delete from public.pos_metas_ventas where organizacion_id = v_org and mes = v_mes;
  for e in select value from jsonb_array_elements(p_metas) loop
    -- Primero se juntan los espacios (tabuladores y saltos incluidos), después se corta a 120 y al final se recortan los
    -- bordes: así el nombre siempre cumple el CHECK (antes un tabulador al inicio o un corte en un espacio lo rompía).
    v_vend := btrim(left(regexp_replace(coalesce(e->>'vendedor', ''), '\s+', ' ', 'g'), 120));
    begin
      v_monto := round(coalesce((e->>'monto')::numeric, 0), 2);
    exception when others then
      raise exception 'METAS_MONTO' using detail = 'Monto inválido para ' || coalesce(nullif(v_vend, ''), 'el negocio');
    end;
    if v_monto <= 0 then continue; end if;
    if v_monto >= 100000000000 then raise exception 'METAS_MONTO' using detail = 'Monto demasiado grande'; end if;
    insert into public.pos_metas_ventas (organizacion_id, mes, vendedor, monto, updated_by_name)
      values (v_org, v_mes, v_vend, v_monto, v_nom)
      on conflict (organizacion_id, mes, vendedor) do update set monto = excluded.monto, updated_at = now(), updated_by_name = excluded.updated_by_name;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function public.pos_metas_guardar(date, jsonb) from public, anon;
grant execute on function public.pos_metas_guardar(date, jsonb) to authenticated;

-- ── Reversa (solo si hay que deshacer; borra las metas guardadas) ──
-- drop function if exists public.pos_metas_guardar(date, jsonb);
-- drop table if exists public.pos_metas_ventas;
