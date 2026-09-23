-- STUDIO · 28 · Verificación QR también para recibos de pago de financiamiento — 2026-09-24
-- Reemplaza pos_doc_verificar (migración 27) agregando el tipo 'recibo' (pos_fin_pagos). Mismo contrato:
-- anon, solo lectura, devuelve número REC-xxxxxx, fecha, monto, estado (vigente / anulada si tiene reversa)
-- y cliente enmascarado. Las reversas no se verifican como recibo.
create or replace function public.pos_doc_verificar(p_tipo text, p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare r record; v_emp text; v_cli text;
begin
  if p_id is null then return jsonb_build_object('ok', false); end if;
  if p_tipo = 'factura' then
    select v.organizacion_id, coalesce(v.numero_factura, 'No. ' || v.numero::text) as numero, v.ncf, coalesce(v.fecha, v.created_at) as fecha, v.total, v.itbis,
           case when v.estado = 'anulada' then 'anulada' else 'vigente' end as estado, v.cliente_nombre
      into r from public.pos_ventas v where v.id = p_id;
  elsif p_tipo = 'prefactura' then
    select p.organizacion_id, p.numero, null::text as ncf, p.created_at as fecha, p.total, null::numeric as itbis,
           case when p.estado = 'anulada' then 'anulada' else coalesce(p.estado, 'vigente') end as estado, p.cliente_nombre
      into r from public.pos_prefacturas p where p.id = p_id;
  elsif p_tipo = 'recibo' then
    select pg.organizacion_id, 'REC-' || upper(left(replace(pg.id::text, '-', ''), 6)) as numero, null::text as ncf, pg.created_at as fecha, pg.monto as total, null::numeric as itbis,
           case when exists (select 1 from public.pos_fin_pagos rv where rv.reversa_de_id = pg.id) then 'anulada' else 'vigente' end as estado, f.cliente_nombre
      into r from public.pos_fin_pagos pg join public.pos_financiamientos f on f.id = pg.financiamiento_id
     where pg.id = p_id and coalesce(pg.tipo, 'pago') <> 'reversa';
  elsif p_tipo = 'cotizacion' then
    select c.organizacion_id, c.numero, null::text as ncf, coalesce(c.fecha::timestamptz, c.created_at) as fecha, c.total, c.itbis,
           coalesce(c.estado, 'vigente') as estado, c.cliente_nombre
      into r from public.pos_cotizaciones c where c.id = p_id;
  else
    return jsonb_build_object('ok', false);
  end if;
  if r.organizacion_id is null then return jsonb_build_object('ok', false); end if;
  select nombre into v_emp from public.organizaciones where id = r.organizacion_id;
  v_cli := nullif(trim(coalesce(r.cliente_nombre, '')), '');
  if v_cli is not null then
    v_cli := initcap(split_part(v_cli, ' ', 1)) || case when split_part(v_cli, ' ', 2) <> '' then ' ' || upper(left(split_part(v_cli, ' ', 2), 1)) || '.' else '' end;
  end if;
  return jsonb_build_object('ok', true, 'tipo', p_tipo, 'empresa', coalesce(v_emp, 'STUDIO'), 'numero', r.numero, 'ncf', r.ncf,
    'fecha', r.fecha, 'total', r.total, 'itbis', r.itbis, 'estado', r.estado, 'cliente', coalesce(v_cli, 'Consumidor final'));
end;
$function$;
revoke all on function public.pos_doc_verificar(text, uuid) from public;
grant execute on function public.pos_doc_verificar(text, uuid) to anon, authenticated;
