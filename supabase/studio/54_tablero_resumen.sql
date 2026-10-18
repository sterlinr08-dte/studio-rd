-- 54_tablero_resumen.sql — STUDIO RD (18-oct-2026). Resumen del Tablero de ventas en UNA consulta.
-- NO APLICADA: espera el «publícalo» del dueño. Solo lectura: no crea tablas ni cambia datos.
--
-- Antes, el tablero (parches-pos-tablero.js) hacía 5 consultas al abrir y bajaba CADA factura del período con sus
-- artículos (en «Este año», miles de filas en tandas de 1,000) para sumar en el teléfono. Esta función devuelve lo mismo
-- ya agrupado: ventas por día (y por hora solo cuando el rango es un día) y por vendedor tal como viene en la factura,
-- artículos sumados por nombre, totales del período anterior, devoluciones, metas y la última venta. El teléfono sigue
-- haciendo los mismos cálculos (nombres limpios, cubetas, metas) sobre unas pocas filas, así que las cifras no cambian.
--
-- Mismas reglas que el tablero y Reportes: hora de RD fija (UTC-4); vendedor = vendedor_nombre o created_by_name (el
-- teléfono los limpia y une); artículos por nombre (el teléfono une los que solo difieren en espacios o mayúsculas).
-- SECURITY INVOKER: corre con los permisos de quien abre el tablero, así que RLS filtra la organización como siempre.

create or replace function public.pos_tablero_resumen(p_d1 date, p_d2 date, p_p1 date, p_p2 date)
returns jsonb language sql stable security invoker set search_path = public
as $$
  with r as (
    select (p_d1::text || ' 00:00:00-04')::timestamptz as a, ((p_d2 + 1)::text || ' 00:00:00-04')::timestamptz as b,
           (p_p1::text || ' 00:00:00-04')::timestamptz as pa, ((p_p2 + 1)::text || ' 00:00:00-04')::timestamptz as pb
  ),
  v as (
    select x.id, x.estado, x.total, x.pagado_efectivo, x.pagado_transferencia, x.pagado_tarjeta, x.pagado_otro,
           x.credito_monto, x.vendedor_nombre, x.created_by_name, (x.fecha at time zone 'UTC') - interval '4 hours' as loc
    from public.pos_ventas x, r where x.fecha >= r.a and x.fecha < r.b
  )
  select jsonb_build_object(
    'grupos', coalesce((select jsonb_agg(g) from (
        select to_char(loc, 'YYYY-MM-DD') as dia,
               case when p_d1 = p_d2 then extract(hour from loc)::int end as hora,
               (estado = 'completada') as ok, vendedor_nombre as vn, created_by_name as cb,
               count(*) as n, sum(total) as t, sum(pagado_efectivo) as ef, sum(pagado_transferencia) as tr,
               sum(pagado_tarjeta) as ta, sum(pagado_otro) as ot, sum(credito_monto) as cr
        from v group by 1, 2, 3, 4, 5) g), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(i) from (
        select it.nombre, sum(it.cantidad) as cant, sum(coalesce(it.importe, it.precio * it.cantidad)) as monto
        from v join public.pos_venta_items it on it.venta_id = v.id
        where v.estado = 'completada' group by it.nombre) i), '[]'::jsonb),
    'previo', (select jsonb_build_object('n', count(*), 't', coalesce(sum(x.total), 0))
               from public.pos_ventas x, r where x.estado = 'completada' and x.fecha >= r.pa and x.fecha < r.pb),
    'devol', (select jsonb_build_object('n', count(*), 't', coalesce(sum(d.total), 0))
              from public.pos_devoluciones d where d.estado is distinct from 'anulada' and d.fecha between p_d1 and p_d2),
    'metas', coalesce((select jsonb_agg(jsonb_build_object('mes', m.mes, 'vendedor', m.vendedor, 'monto', m.monto) order by m.mes)
                       from public.pos_metas_ventas m
                       where m.mes between date_trunc('month', p_d1)::date and date_trunc('month', p_d2)::date), '[]'::jsonb),
    'ultima', (select max(x.fecha) from public.pos_ventas x where x.estado = 'completada')
  );
$$;
revoke all on function public.pos_tablero_resumen(date, date, date, date) from public, anon;
grant execute on function public.pos_tablero_resumen(date, date, date, date) to authenticated;

-- ── Reversa ──
-- drop function if exists public.pos_tablero_resumen(date, date, date, date);
