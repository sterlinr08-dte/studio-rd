# Claude · Financiamiento, entrega 1: probada en navegador (sin publicar)

Sigue a `2026-11-24-2159-claude-financiamiento-entrega1.md`, que quedó sin probar. El dueño autorizó el servidor local de pruebas.

## Pruebas (base simulada; nunca toca la base real)
- `docs/qa-fin/qa-cobrar.cjs`: **TODO OK** — 16 comprobaciones × 4 (1280 y 390 px; admin y cajero): un solo botón de cobro, filtros con conteo, orden por atraso, búsqueda en toda la lista y por cédula, rutas viejas `hoy`/`cobranza`, permisos (cajero sin resumen, Historial ni Excel), ventana de cobro de siempre, sin errores de JavaScript, sin desbordamiento.
- `docs/qa-fin/qa.cjs` (regresión del cobro: doble toque, reintento con la misma clave, abonos): **TODO OK**.

## Fallos que encontró la prueba y se corrigieron
- Filtros de 34–36 px y botón «Cobrar» de 36 px en PC: la regla del tema (`html.nx-studio #v-pos :is(.nxF2Chip…)`) ganaba. Ahora miden ≥ 44 px (filtros 44, acciones 46) con letra de 13 px.
- La comprobación del botón de inicio en el teléfono estaba mal escrita: ahí el subtítulo se oculta a propósito (`studio-pulido.css` §26) y queda el número en la esquina. Se corrigió la prueba, no la pantalla.

## Medidas (Playwright)
| | 390 px | 1280 px |
|---|---|---|
| Filtros | 44 px | 44 px |
| Cobrar / Recordar / Historial | 46 px | 46 px |
| Buscador | 52 px, letra 16 px | 52 px, letra 16 px |

## Estado
Rama `claude/financiamiento-organizar`. **No publicado**: falta el «Publícalo» del dueño; al publicar se sube `APP_VERSION` y `version.json`.
Pendiente de confirmar por el dueño: los nombres «Financiamiento» y «Recargo por atraso», y si quiere de vuelta las tarjetas por prioridad de la antigua Cobranza.
