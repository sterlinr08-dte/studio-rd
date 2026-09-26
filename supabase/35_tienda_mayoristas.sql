-- 35 · Catálogo mayorista privado (studiord.net/mayoristas)
-- Pedido del dueño (26-sep-2026): catálogo al por mayor en un enlace aparte que
-- los clientes finales no puedan ver. El repositorio es PÚBLICO, así que los
-- precios NO van en archivos del repo: viven solo en estas tablas.
--
--   · tienda_mayoristas_items  → artículos del catálogo mayorista (precio + disponible).
--   · tienda_mayoristas_acceso → claves del enlace, guardadas SOLO como hash SHA-256.
--   · tienda_mayoristas_catalogo(p_clave) → única puerta de lectura (anon puede
--     llamarla); devuelve los artículos solo si la clave es válida. Nunca costo.
--
-- RLS activo y SIN políticas: anon/authenticated no pueden leer las tablas
-- directamente. Para invalidar un enlace filtrado: activo=false en su clave y crear otra.

create table if not exists public.tienda_mayoristas_items (
  id          bigint generated always as identity primary key,
  grupo       text    not null,              -- Movilidad, Monta cargas, Hogar, Tecnología
  nombre      text    not null,
  detalle     text,
  foto        text,                           -- ruta pública de la imagen de la tienda
  precio      numeric(12,2) not null check (precio >= 0),
  disponible  boolean not null default true,  -- manual hasta conectar inventario
  orden       int     not null default 0,
  activo      boolean not null default true,
  actualizado timestamptz not null default now()
);

create table if not exists public.tienda_mayoristas_acceso (
  id         bigint generated always as identity primary key,
  clave_hash text not null unique,            -- encode(sha256(clave),'hex')
  nota       text,
  activo     boolean not null default true,
  creado     timestamptz not null default now(),
  ultimo_uso timestamptz
);

alter table public.tienda_mayoristas_items  enable row level security;
alter table public.tienda_mayoristas_acceso enable row level security;
revoke all on public.tienda_mayoristas_items, public.tienda_mayoristas_acceso from anon, authenticated;

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
             'foto', foto, 'precio', precio, 'disponible', disponible)
           order by orden, id)
      from tienda_mayoristas_items
     where activo), '[]'::jsonb);
end;
$$;

revoke all on function public.tienda_mayoristas_catalogo(text) from public;
grant execute on function public.tienda_mayoristas_catalogo(text) to anon, authenticated;
