-- 36 · Catálogo mayorista con el estilo de la tienda: cada artículo lleva el color (tono) y la
-- letra de fondo (letra) de su tarjeta en studiord.net. Solo presentación; no cambia precios ni acceso.
alter table public.tienda_mayoristas_items add column if not exists tono  text;
alter table public.tienda_mayoristas_items add column if not exists letra text;

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
             'tono', tono, 'letra', letra)
           order by orden, id)
      from tienda_mayoristas_items
     where activo), '[]'::jsonb);
end;
$$;

revoke all on function public.tienda_mayoristas_catalogo(text) from public;
grant execute on function public.tienda_mayoristas_catalogo(text) to anon, authenticated;
