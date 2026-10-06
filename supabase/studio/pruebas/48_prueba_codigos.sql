-- Prueba de la migración 48 (códigos automáticos). Termina en error a propósito: todo se deshace, no deja nada.
-- Corrida el 05-oct-2026 en la base real: 9 de 9 OK (16 empleados 001…016, 157 códigos viejos intactos,
-- PRD-001643 y PRD-001644, conserva el código al editar, repetido rechazado, código a mano respetado, empleado 017).
begin;
create temp table t_res (n serial, caso text, ok boolean, detalle text);
grant all on t_res to authenticated; grant usage on sequence t_res_n_seq to authenticated;

-- La migración, tal cual el archivo supabase/48_codigos_automaticos.sql
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


do $$ declare v_n int; v_c text; begin
  select count(*) into v_n from public.rrhh_empleados where codigo ~ '^\d{3}$';
  insert into t_res values (default, 'empleados actuales numerados 001…', v_n = (select count(*) from public.rrhh_empleados), v_n || ' con código');
  select string_agg(codigo || ' ' || left(nombre, 14), ', ' order by codigo) into v_c from (select * from public.rrhh_empleados order by codigo limit 3) x;
  insert into t_res values (default, 'primeros por fecha de ingreso', true, v_c);
  select count(*) into v_n from public.pos_productos where codigo !~ '^PRD-\d{6}$';
  insert into t_res values (default, 'artículos con código viejo intactos', v_n = 157, v_n || '');
end $$;

-- ── como el administrador (RLS real) ──
select set_config('request.jwt.claims', '{"sub":"25bea4e1-2241-4480-a52e-447dad70c191","role":"authenticated"}', true);
set local role authenticated;
do $$ declare v_c text; v_c2 text; v_id uuid; begin
  insert into public.pos_productos (nombre, precio, costo, stock, tipo) values ('QA ARTICULO 1', 1, 1, 0, 'producto') returning codigo, id into v_c, v_id;
  insert into t_res values (default, 'artículo nuevo sin código → siguiente PRD', v_c = 'PRD-001643', v_c);
  insert into public.pos_productos (nombre, precio, costo, stock, tipo, codigo) values ('QA ARTICULO 2', 1, 1, 0, 'producto', '  ') returning codigo into v_c2;
  insert into t_res values (default, 'código en blanco también es automático', v_c2 = 'PRD-001644', v_c2);
  update public.pos_productos set codigo = null where id = v_id returning codigo into v_c;
  insert into t_res values (default, 'editar con el código vacío conserva el que tenía', v_c = 'PRD-001643', v_c);
  begin insert into public.pos_productos (nombre, precio, costo, stock, tipo, codigo) values ('QA REPETIDO', 1, 1, 0, 'producto', 'prd-001003');
    insert into t_res values (default, 'código repetido (aunque cambie mayúsculas) se rechaza', false, 'PUDO');
  exception when unique_violation then insert into t_res values (default, 'código repetido (aunque cambie mayúsculas) se rechaza', true, 'rechazado'); end;
  insert into public.pos_productos (nombre, precio, costo, stock, tipo, codigo) values ('QA MANUAL', 1, 1, 0, 'producto', 'ABC-77') returning codigo into v_c;
  insert into t_res values (default, 'código escrito a mano se respeta', v_c = 'ABC-77', v_c);
  insert into public.rrhh_empleados (nombre, activo) values ('QA EMPLEADO', true) returning codigo into v_c;
  insert into t_res values (default, 'empleado nuevo → siguiente número', v_c = '017', v_c);
end $$;
reset role;

do $$ begin
  raise exception E'RESULTADOS 48\n%', (select string_agg(case when ok then 'OK   ' else 'FALLA' end || ' · ' || caso || coalesce(' · ' || nullif(left(detalle, 120), ''), ''), E'\n' order by n) from t_res);
end $$;
