# Claude · Financiamiento, entrega 1: una sola pantalla de cobro y nombres únicos (SIN PROBAR EN NAVEGADOR, sin publicar)

Sigue a la bitácora del mapa (opción C elegida por el dueño). El dueño dijo: «Sí, arranca con la entrega 1».

## Qué cambió (`parches-pos.js`, `parches-pos-reportes.js`)
- **Una sola pantalla «Cobrar cuotas»** en lugar de «Cobrar cuota», «Pagos de hoy / Quién paga hoy» y «Cobranza».
  - Filtros con conteo: **Para hoy** (vence hoy o está atrasado) · **Atrasados** · **Todos**. Orden: primero los más atrasados.
  - El buscador (cédula, teléfono o nombre) busca en toda la lista, sin importar el filtro.
  - Lista de 10 en 10 (`data-pag10="fin-cobrar"`).
  - Admin/gerente ven además: resumen (atrasado sin cobrar, cobrado hoy, clientes con más de 30 días), botón «Historial» por cliente y exportar a Excel.
  - El botón «Cobrar» abre la misma ventana de cobro de siempre (`nxFinV2Cobrar`). No se tocó el cobro ni ninguna RPC.
- Inicio del módulo: 3 botones grandes (Nueva solicitud, Consultar / Cotizar, Cobrar cuotas con «Para hoy: N clientes · monto»). Se quitó el botón «Cobranza» de la fila de administrador.
- Las rutas viejas `hoy` y `cobranza` abren la pantalla única con su filtro (Para hoy / Atrasados), para no romper enlaces internos.
- Se retiraron `finHoyHTML`, `finV2CobranzaHTML`, `finCobRowHTML`, `finCobFiltrada`, `finCobListaHTML`, `nxFinCobTab` y `nxFinCobBuscar`. Su CSS `.fcob*` queda para la entrega 3.
- **Nombres:** «Recargo por atraso (Financiamiento)» en Ajustes; «Recargo por atraso» / «Recargo» en comprobante, estado de cuenta y reportes (antes «Mora»); «FINANCIAMIENTOS ACTIVOS» en la ficha del cliente (antes «PLANES DE CUOTAS ACTIVOS»); «Ir a Financiamiento» en Avisos; «Solicitudes de Financiamiento» en Reportes; «desde Financiamiento → detalle». Los nombres son propuesta: el dueño aún no confirmó «Financiamiento» y «Recargo por atraso».
- Lo que se pierde frente a «Cobranza»: las 5 tarjetas por prioridad y la lista «Pagos recientes». La prioridad se sigue viendo en cada fila («Atrasado N días»).

## Pruebas
- `node --check` de los tres archivos: correcto.
- Prueba nueva `docs/qa-fin/qa-cobrar.cjs` (reutiliza la base simulada de `qa.cjs`, que ahora exporta sus funciones): filtros, orden, búsqueda, tamaños ≥ 44 px, rutas viejas, vista de admin y de cajero, a 1280 y 390 px.
- **NO SE PUDO CORRER.** El sistema de permisos de la sesión bloqueó levantar el servidor local (`python3 -m http.server`). Por tanto **no hay capturas ni medidas**, y `qa.cjs` tampoco se volvió a correr. Nada de esto está verificado en pantalla.

## Estado
Rama `claude/financiamiento-organizar`. No publicado. Antes de pedir «Publícalo»: correr `qa.cjs` y `qa-cobrar.cjs`, y mostrar capturas en iPhone y PC.
