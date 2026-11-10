# Claude · Enlace nuevo del catálogo mayorista

## Pedido del dueño
Pidió el catálogo al por mayor (10-nov-2026). El enlace del 26-sep-2026 se le entregó por chat en otra sesión, y la base solo guarda la clave cifrada, así que no se podía recuperar. Se le explicó qué cambia con un enlace nuevo y contestó «Crea el enlace».

## Qué se hizo
- `tienda_mayoristas_acceso`: fila nueva `id 2`, activa, nota «Enlace del 10-nov-2026 (pedido del dueño)». Solo se guardó el hash SHA-256; la clave se generó al azar (24 bytes, URL segura) y se entregó al dueño por chat.
- El enlace del 26-sep (`id 1`) sigue activo y sin cambios.
- No cambian el código, los precios ni los artículos.

## Verificación
- La RPC `tienda_mayoristas_catalogo` con la clave nueva devuelve los 28 artículos activos y ningún costo.
- `studiord.net/mayoristas#k=…` en Playwright (390 px): carga el catálogo y no sale «Enlace no válido».

## Para apagarlo
`update public.tienda_mayoristas_acceso set activo = false where id = 2;` (el de `id 1` sigue funcionando).

La clave no se escribe en el repo (es público) ni en esta bitácora.
