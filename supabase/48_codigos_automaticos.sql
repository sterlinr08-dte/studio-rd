-- 48 · Códigos automáticos de artículos y empleados (dueño 06-oct-2026: «los códigos de empleados y de artículos»;
--      eligió «Automático, viejos igual» para artículos y «Número simple 001» para empleados).
-- Proyecto STUDIO RD (edbknlkjnlfmkkiizdbe).
--
-- Artículos: hoy 640 tienen PRD-001003…PRD-001642 y 157 traen códigos del sistema anterior (1002, CAST-2021-0237…),
-- que NO se tocan (pueden estar en etiquetas y códigos de barra). Un artículo nuevo sin código recibe el siguiente
-- PRD-00xxxx. Si se escribe un código a mano se respeta, pero no puede repetirse. Al editar, dejar el campo vacío ya no
-- borra el código (se conserva el que tenía).
-- Empleados: no tenían código. Se agrega la columna, se numeran los 16 actuales 001, 002… por fecha de ingreso y los
-- nuevos reciben el siguiente.
-- El número se calcula en el servidor con un candado por organización: dos altas a la vez no reciben el mismo.

set lock_timeout = '10s';   -- si una tabla está ocupada, falla rápido en vez de esperar

-- ── Artículos ──
create or replace function public.pos_producto_codigo()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_org uuid; v_n int;
begin
  new.codigo := nullif(btrim(new.codigo), '');
  if new.codigo is null and tg_op = 'UPDATE' then new.codigo := old.codigo; end if;
  if new.codigo is null then
    v_org := coalesce(new.organizacion_id, public.mi_organizacion());
    perform pg_advisory_xact_lock(hashtext('pos_productos.codigo:' || coalesce(v_org::text, '-')));
    select coalesce(max(substring(p.codigo from '^PRD-(\d{1,9})$')::int), 1000) + 1 into v_n
      from public.pos_productos p where p.organizacion_id is not distinct from v_org;
    new.codigo := 'PRD-' || lpad(v_n::text, greatest(6, length(v_n::text)), '0');
  end if;
  return new;
end $$;
revoke all on function public.pos_producto_codigo() from public, anon, authenticated;

-- El nombre empieza por «trg_z» para correr DESPUÉS de trg_org_pos_productos (que pone organizacion_id):
-- los disparadores BEFORE corren en orden alfabético.
drop trigger if exists trg_zcodigo_pos_productos on public.pos_productos;
create trigger trg_zcodigo_pos_productos before insert or update of codigo on public.pos_productos
  for each row execute function public.pos_producto_codigo();

create unique index if not exists pos_productos_codigo_unico
  on public.pos_productos (organizacion_id, lower(codigo)) where codigo is not null;

-- ── Empleados ──
alter table public.rrhh_empleados add column if not exists codigo text;

with n as (
  select id, row_number() over (partition by organizacion_id order by fecha_ingreso nulls last, created_at, nombre) as k
  from public.rrhh_empleados where codigo is null
)
update public.rrhh_empleados e set codigo = lpad(n.k::text, greatest(3, length(n.k::text)), '0')
from n where n.id = e.id
  and not exists (select 1 from public.rrhh_empleados x where x.codigo is not null);   -- solo la primera vez

create or replace function public.rrhh_empleado_codigo()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_org uuid; v_n int;
begin
  new.codigo := nullif(btrim(new.codigo), '');
  if new.codigo is null and tg_op = 'UPDATE' then new.codigo := old.codigo; end if;
  if new.codigo is null then
    v_org := coalesce(new.organizacion_id, public.mi_organizacion());
    perform pg_advisory_xact_lock(hashtext('rrhh_empleados.codigo:' || coalesce(v_org::text, '-')));
    select coalesce(max(case when e.codigo ~ '^\d{1,9}$' then e.codigo::int end), 0) + 1 into v_n
      from public.rrhh_empleados e where e.organizacion_id is not distinct from v_org;
    new.codigo := lpad(v_n::text, greatest(3, length(v_n::text)), '0');
  end if;
  return new;
end $$;
revoke all on function public.rrhh_empleado_codigo() from public, anon, authenticated;

drop trigger if exists trg_zcodigo_rrhh_empleados on public.rrhh_empleados;
create trigger trg_zcodigo_rrhh_empleados before insert or update of codigo on public.rrhh_empleados
  for each row execute function public.rrhh_empleado_codigo();

create unique index if not exists rrhh_empleados_codigo_unico
  on public.rrhh_empleados (organizacion_id, codigo) where codigo is not null;
