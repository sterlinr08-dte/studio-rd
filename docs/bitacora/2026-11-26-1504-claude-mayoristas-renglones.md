# Claude · Mayoristas: renglones «Vehículos eléctricos» y «Vehículos de gasolina» (sin publicar)

## Pedido del dueño
«Los motocarga están en el renglón de motor de gasolina o vehículo de gasolina, para que los divida en el catálogo al por mayor». Entre tres nombres eligió **Eléctricos / Gasolina**.

## Cambio
- `mayoristas.html`: `ORDEN` acepta los nombres nuevos y los viejos (Vehículos eléctricos, Movilidad, Vehículos de gasolina, Monta cargas, Hogar, Tecnología), para que el orden no se altere mientras se renombra la base. El contador «1 / 2» del renglón ya no se parte en dos líneas en el teléfono.
- `supabase/studio/55_mayoristas_renglones.sql` (solo datos, **no aplicada**): `Movilidad` → `Vehículos eléctricos`, `Monta cargas` → `Vehículos de gasolina` en `tienda_mayoristas_items`. Se aplica después de publicar la página.
- No cambia precios ni existencias. La tienda pública (`tienda.html`) no se tocó.

## Pruebas (RPC simulada, 390 y 1280 px)
Con los nombres viejos y con los nuevos: renglones y pestañas en el orden correcto, sin errores de JavaScript ni desbordamiento.

## Observación
El LQ-PP (único eléctrico disponible) va de noveno en su renglón, detrás de 8 agotados (`orden` 70). Se propuso al dueño ponerlo primero; no se cambió.

## Estado
Rama `claude/mayoristas-lqpp`. Falta el «Publícalo».
