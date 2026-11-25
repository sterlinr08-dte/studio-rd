# Claude · Publicado: Financiamiento 59.97 (una sola pantalla de cobro y nombres únicos)

- El dueño respondió «Publícalo» (botón) a la entrega 1 de la reorganización del financiamiento.
- PR #34 unido a `main` (commit `3b83457`). Sin migraciones ni cambios en la base.
- Antes de unir se repitieron sobre la versión final `docs/qa-fin/qa-cobrar.cjs` y `docs/qa-fin/qa.cjs`: TODO OK las dos.
- Comprobado en vivo en `studiord.net`: `version.json` = 59.97, `APP_VERSION='59.97'` en `index.html` y `parches-pos.js?v=59.97` trae la pantalla nueva (`nxFinCobrarFiltro`).
- **No verificado:** el uso con un usuario real en un iPhone. No hay financiamientos reales en la base (0), así que la lista saldrá vacía hasta el primero.

## Siguen pendientes (opción C)
- Entrega 2: cuatro pestañas (Solicitudes · Por aprobar · Cobrar · Reportes), reportes juntos, datos legales en un solo sitio.
- Entrega 3: retirar el v1 «Cuotas premium», el CSS `.fcob*` y el código muerto.
- Entregas 4 y 5 (base y dinero): esperan respuesta del dueño sobre cuándo se entrega el artículo y quién lo marca, y quién puede refinanciar y castigar.
- Confirmar con el dueño los nombres «Financiamiento» y «Recargo por atraso» (publicados como propuesta) y si quiere de vuelta las tarjetas por prioridad.
- Los datos legales del contrato (acreedor, abogado, testigos) están vacíos en `pos_config`: llenarlos antes del primer financiamiento real.
