# Claude · Mayoristas: LQ-PP a RD$20,000 y las demás pasolas eléctricas agotadas

## Pedido del dueño
Captura de la página de mayoristas (LQ-PP, RD$22,000): «Único modelo disponible, precio nuevo a 20000». Al preguntarle el alcance: «Solo hay disponible esa… las pasolas eléctricas; las motocargas sí hay disponibles».

## Cambio (solo datos, base `edbknlkjnlfmkkiizdbe`, tabla `tienda_mayoristas_items`)
- LQ-PP (id 9): precio 22,000 → **20,000**. Sigue disponible.
- Movilidad, pasan a `disponible = false`: LQ-N9, LQ-H8, LQ-ZS, LQ-M12 (Rosa, Blanco, Gris), LQ-XGW e ILQ-HLD (ids 1–8). LQ-XBW ya estaba agotado.
- No se tocaron Monta cargas (los 2 disponibles), Hogar ni Tecnología. No se cambió ningún otro precio.
- La página `mayoristas.html` lee de la RPC `tienda_mayoristas_catalogo`, así que el cambio se ve al recargar. Sin cambios de código ni de versión.

## Comprobado
Consulta a la tabla después del cambio: en Movilidad solo LQ-PP queda disponible, a 20,000; las dos motocargas siguen disponibles.

## No verificado
- La página con un enlace de mayorista real (no se tiene la clave).
- Si la tienda pública (`tienda.html`) o el inventario del POS muestran estos modelos por otra vía: no se tocaron.

## Para deshacer
`update tienda_mayoristas_items set disponible = true where id in (1,2,3,4,5,6,7,8);` y `set precio = 22000 where id = 9`.
