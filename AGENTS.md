# AGENTS.md — punto de entrada fijo para ChatGPT / Codex y Claude

**Ruta fija:** `https://github.com/sterlinr08-dte/studio-rd/blob/main/AGENTS.md`
Este archivo no cambia de sitio ni de nombre. Toda sesión de IA en STUDIO empieza aquí, siempre en la rama `main`.

## 1. Orden de lectura obligatorio (en este orden, sin saltarse ninguno)

1. `AGENTS.md` (este archivo).
2. `CLAUDE.md` — reglas del proyecto, base de datos, banderas, estado técnico.
3. `docs/bitacora/README.md` — cómo se escribe la bitácora.
4. Las **cinco entradas más recientes** de `docs/bitacora/` (orden alfabético = cronológico), sean `-claude.md` o `-chatgpt.md`.
5. `DESIGN.md` — la única línea gráfica: §2 colores, §3 tipografía (SF Pro), §9 iconografía, §10 movimiento (Apple), §12 pantallas de referencia y plan.
6. El código real que se va a tocar (`index.html`, `parches-pos.js`, `studio-brand-theme.css`, `supabase/studio/*.sql`). Nunca asumir cómo funciona un módulo sin leerlo.

## 2. Dónde escribir

- Cada cambio, auditoría o publicación deja **una entrada nueva** en `docs/bitacora/AAAA-MM-DD-HHMM-chatgpt.md` (ChatGPT/Codex) o `-claude.md` (Claude). Hora de República Dominicana. Nunca editar ni borrar entradas anteriores.
- Decisiones de diseño: `DESIGN.md` (añadir secciones o adendas fechadas; no reescribir lo aprobado).
- Reglas y estado del proyecto: `CLAUDE.md`.
- Migraciones: `supabase/studio/NN_nombre.sql`, numeradas y aplicadas al proyecto STUDIO RD (`edbknlkjnlfmkkiizdbe`).

## 3. Reglas que no se negocian

- No publicar a `main` sin autorización explícita del dueño ("publícalo", "súbelo", "ponlo en vivo"). Trabajar en rama y PR.
- STUDIO **no es una empresa de seguros**: nada de Seguros vuelve al código.
- El POS y el Inbox de WhatsApp se quedan. El Inbox solo carga con `pos_config.whatsapp_inbox = true` y necesita backend propio (ver bitácora `2026-09-22-1130-claude.md`).
- Dinero, cobros, cuotas, compras y contabilidad: auditar la fuente de verdad (RPC/triggers) antes de tocar; el asiento lo escribe el servidor.
- Ningún secreto en el repo, bitácoras ni chat.
- No enviar mensajes de WhatsApp a clientes sin autorización del dueño.
- Cambios visuales: contra `DESIGN.md`; sin degradados dorados, sin `!important` nuevos, sin lógica de negocio nueva, aislados y reversibles.
- Publicación: subir `APP_VERSION` en `index.html` y `version.json`.

## 4. Estado vivo (actualizar aquí en cada entrega)

- Producción: `https://studiord.net` = Worker Cloudflare `studio-rd`, integración Git con `main`. Versión publicada: **59.21** (24-sep-2026: réplica del financiamiento de NEXUS PRO completa — 59.21 cuota fija francesa en «sobre saldo» (migración 30, bitácora `2026-09-24-1830-claude.md`); 59.20 tablero de reportes (bitácora `2026-09-24-1800-claude.md`); 59.19 datos legales del contrato congelados por contrato (migración 29, bitácora `2026-09-24-1730-claude.md`); 59.18, 24-sep-2026: financiamiento fase 4 — comprobante de pago con desglose, monto en letras y QR, estado de cuenta — migración 28, bitácora `2026-09-24-1630-claude.md`; 59.17, 24-sep-2026: impresión moderna de factura carta, ticket, prefactura y cotización con QR de verificación pública (`verificar.html`, RPC `pos_doc_verificar`, migración 27), prefactura sin RD$ 0 — bitácoras `2026-09-24-1500-claude.md` y `2026-09-24-1515-claude.md`; 59.16: financiamiento fase 3, cobranza por prioridad e historial crediticio — bitácora `2026-09-24-1300-claude.md`; 59.15, 24-sep-2026: barra de acciones alineada con la ventana del documento y botones compactos — bitácora `2026-09-24-1045-claude.md`; 59.14, 24-sep-2026: financiamiento fase 2 — perfil ampliado, fiador y evaluación financiera con score estilo NEXUS PRO, fiador solidario en contrato — migración 26, bitácora `2026-09-24-0200-claude.md`; 59.13, 24-sep-2026: botones inteligentes Guardar/Guardar+Imprimir/Guardar+WhatsApp/Imprimir/Anular/Cancelar en Factura, Prefactura, Cotización, Reparación, Nota de crédito, Apartado y Compra — bitácoras `2026-09-23-2315-claude.md` y `2026-09-24-0030-claude.md`; 59.11: financiamiento con firma del cliente por link, reportes de financiamiento, documentos y expediente del cliente con cédula, selfie, video y firma — migraciones 24 y 25, bitácoras `2026-09-23-2130-claude.md` y `2026-09-23-2230-claude.md`; 59.10, 23-sep-2026: compra «Con ITBIS»/«Informal» con costo real y crédito fiscal solo en formales — migración 23; Reporte Ganancias inteligente con ganancia real después del ITBIS — bitácoras `2026-09-23-2000-claude.md`, `2026-09-23-2030-claude.md`, `2026-09-23-2040-claude.md`; 59.09: reportes en la barra lateral, casilla Con/Sin ITBIS, páginas de 10 en 10 — bitácoras `2026-09-23-1900-claude.md`, `2026-09-23-1920-claude.md`, `2026-09-23-1930-claude.md`; 59.08: ganancias con venta y costo ambos con ITBIS — bitácora `2026-09-23-1840-claude.md`; 59.07: ventana de cobro con marca STUDIO y cliente fijo salvo administrador; Reportes estilo Infoplus con 65 reportes — bitácoras `2026-09-23-1300-claude.md`, `2026-09-23-1330-claude.md`, `2026-09-23-1430-claude.md`, `2026-09-23-1515-claude.md`; 59.06: Reportes renovados en 9 secciones — bitácora `2026-09-23-1215-claude.md`; 59.05: Factura sin repetidos, «Agregar artículo» en lista, tabla en dos líneas, fix X de avisos — bitácoras `2026-09-23-1045-claude.md` y `2026-09-23-1130-claude.md`; 59.03: la carga espera al POS, sin asomar el panel de Seguros — bitácora `2026-09-23-1030-claude.md`; 59.02: asientos de los 574 cobros migrados, cuenta 4104 — bitácora `2026-09-23-1100-claude.md`; 59.01: pantalla de carga con logo STUDIO — bitácora `2026-09-23-1020-claude.md`; 59.00: contabilidad de ventas solo en el servidor, devoluciones y plan de cuentas completo — bitácora `2026-09-23-0330-claude.md`; 58.99 Facturar a / Elegir cliente / sin IA NEXUS; 58.98 escala de botones; 58.97 login Gold de ChatGPT).
- Repositorio independiente desde el 22-sep-2026; base Supabase propia `edbknlkjnlfmkkiizdbe`.
- **Datos migrados del sistema anterior (22-sep-2026, 15:00):** 797 productos, 399 clientes, 6.419 seriales, 1.155 ventas, cartera RD$30,2M, bancos, cajas y 15 usuarios, ya en la base STUDIO (`supabase/studio/16_migracion_legacy.sql`, esquema `legacy` como trazabilidad). Ver `docs/bitacora/2026-09-22-1500-claude.md`.
- Línea gráfica definida (22-sep-2026): negro `#0A0A0A`, blanco cálido `#F7F5EF`, oro `#C9A227` como único acento; tipografía San Francisco (Inter fuera de Apple); iconos outline 1.75 px; movimiento fluido Apple; Factura en modo lista. **Publicada en `main` (58.88 → 58.91, 22-sep-2026)**; ver bitácora `2026-09-22-1300-claude.md`.
- **Reacondicionado (22-sep-2026, publicado en `main` como 58.94 a las 17:45):** réplica fiel del taller de lotes de BAYOL CELL (5 pestañas, 6 etapas, evaluación, panel de reparación, piezas, devoluciones, rentabilidad) en `parches-pos-reacond.js` + `supabase/studio/18_reacondicionado.sql` (ya aplicado en la base STUDIO; bandera `pos_config.reacondicionado`). Decisión del dueño: «lo más parecido a lo actual». Ver bitácora `2026-09-22-1730-claude.md` y `docs/REACONDICIONADO.md`.
- Stitch: proyecto `projects/3084779069905725803`, design system `assets/11862383679991154944`.
- Próximos bloques: línea gráfica a código (Claude, rama sin publicar); WhatsApp backend propio (número Zernio pendiente del dueño); Financiamiento bloques B/D/E (ChatGPT).

## 5. Coordinación entre las dos IA

- Antes de empezar, leer la última bitácora de la otra IA para no pisar trabajo. Si dos ramas tocan el mismo archivo, la segunda rebasa sobre `main` y lo dice en su bitácora.
- Ramas: `chatgpt/*` o `codex/*` para ChatGPT; `claude/*` para Claude. Un PR por entrega, con la bitácora dentro del mismo PR.
- Dudas de alcance: preguntar al dueño en el chat, no decidir por él.
