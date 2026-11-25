# Claude · Financiamiento: mapa del módulo y decisión del dueño (solo lectura)

## Pedido del dueño
«El sistema de financiamiento vamos a organizarlo mejor». Se le dieron 3 opciones (A limpieza, B por etapas, C ordenar y completar) y eligió la **C**.

## Base en vivo (`edbknlkjnlfmkkiizdbe`, solo lectura, 25-nov-2026)
- 0 financiamientos, 0 solicitudes, 0 cuotas, 0 pagos, 0 eventos de crédito. El módulo nunca se ha usado con datos reales.
- 1 plan: «Plazo fijo» (activo). `financiamiento_v2 = true`. `mora_pct = 0`, `mora_dias_gracia = 0`.
- Datos legales del contrato vacíos: acreedor, abogado y testigos (`fin_acreedor_*`, `fin_abogado_*`, `fin_testigo*`) están en null.
- Existen en la base, sin botón en pantalla: `pos_credito_castigar`, `pos_credito_refinanciar`, `pos_credito_registrar_promesa`.

## Desorden encontrado (código, `parches-pos.js`)
- Financiamiento ocupa ~3.850 líneas; ~1.010 son del v1 «Cuotas premium» (10990-11999), apagado con `financiamiento_v2=true`, pero su CSS se inyecta siempre y el v2 aún usa `nxFinCarteraVencida` del v1.
- Tres pantallas de «a quién cobrar» sobre el mismo modelo (`cobrar`, `hoy`, `cobranza`), más Avisos y el chip «Atrasados».
- Nombres distintos para lo mismo: Financiamiento / Cuotas / préstamos / planes de cuotas / venta a crédito / Solicitudes de Crédito; Mora / Recargo por mora / Recargo por atraso. El botón «Pagos de hoy» abre «Quién paga hoy».
- Reportes en 5 lugares; tres textos distintos de recordatorio por WhatsApp; datos legales en Planes y en Ajustes; mora configurable en 3 niveles.
- Código muerto: camino de Factura (`FIN_FACTURA_CUOTAS=false`), `finWizPaso3` de planes fijos, formulario «cliente nuevo» en línea, varias funciones sin llamadas.
- Cosas a medias: no hay paso «Entrega»; `castigado` y `refinanciado` sin pantalla; no se cancela un financiamiento desde el módulo; la marca «Revisé…» no se guarda.

## Plan propuesto (opción C, por entregas; nada publicado)
1. Nombres únicos y una sola pantalla de cobro (Hoy / Atrasados / Todos).
2. Cuatro pestañas: Solicitudes · Por aprobar · Cobrar · Reportes; reportes juntos; datos legales en un solo sitio.
3. Retirar el v1 y el código muerto.
4. Guardar quién revisó los documentos y paso «Entrega» (base de datos).
5. Cancelar, refinanciar y castigar con botón (dinero; auditoría previa de las RPC).

## Reglas que no se tocan
Dinero solo por RPC; candados de la migración 38; quién cobra y quién aprueba; contrato congelado; Factura no financia directo; WhatsApp nunca automático; listas de 10 en 10.

## Estado
Solo lectura. Rama `claude/financiamiento-organizar` con esta bitácora. Esperando respuestas del dueño sobre Entrega, refinanciar y datos legales.
