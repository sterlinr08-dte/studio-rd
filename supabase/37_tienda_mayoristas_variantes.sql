-- 37 · Catálogo mayorista con variantes como en la tienda: los artículos de una misma familia
-- (LQ-M12 por color, CW Smart TV por tamaño, aire por BTU, nevera por pies, ventilador por modelo)
-- se muestran en UNA tarjeta con botones de color o tamaño. Cada variante sigue siendo su propia
-- fila (precio, disponible, foto), así que el pedido y los precios no cambian.
--   familia  → nombre común de la tarjeta (null = artículo sin variantes).
--   variante → texto del botón (Rosa, 43", 12,000 BTU…).
--   punto    → color del círculo si la variante es un color (null = botón de texto).
alter table public.tienda_mayoristas_items add column if not exists familia  text;
alter table public.tienda_mayoristas_items add column if not exists variante text;
alter table public.tienda_mayoristas_items add column if not exists punto    text;

create or replace function public.tienda_mayoristas_catalogo(p_clave text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_id bigint;
begin
  if p_clave is null or length(p_clave) < 20 then
    return null;
  end if;
  select id into v_id
    from tienda_mayoristas_acceso
   where clave_hash = encode(extensions.digest(p_clave, 'sha256'), 'hex')
     and activo;
  if v_id is null then
    return null;
  end if;
  update tienda_mayoristas_acceso set ultimo_uso = now() where id = v_id;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', id, 'grupo', grupo, 'nombre', nombre, 'detalle', detalle,
             'foto', foto, 'precio', precio, 'disponible', disponible,
             'tono', tono, 'letra', letra,
             'familia', familia, 'variante', variante, 'punto', punto)
           order by orden, id)
      from tienda_mayoristas_items
     where activo), '[]'::jsonb);
end;
$$;

revoke all on function public.tienda_mayoristas_catalogo(text) from public;
grant execute on function public.tienda_mayoristas_catalogo(text) to anon, authenticated;
