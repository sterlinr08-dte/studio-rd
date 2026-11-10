# Claude · Enlace mayorista nuevo apagado

Sigue a `…-claude-enlace-mayorista-nuevo.md` (10-nov-2026).

- El dueño encontró el enlace del 26-sep y pidió «Apaga el nuevo».
- `tienda_mayoristas_acceso` `id 2` → `activo = false`. El `id 1` (enlace del 26-sep) sigue activo.
- Verificado: la RPC `tienda_mayoristas_catalogo` con la clave del `id 2` devuelve vacío («Enlace no válido» en la página).

## Pendiente
Precios del catálogo: el dueño señaló que hay precios que no son de por mayor. Se le mostró la comparación con el nivel «Mayorista» del POS (`pos_producto_niveles`); falta su decisión antes de cambiar `tienda_mayoristas_items`.
