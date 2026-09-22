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

- Producción: `https://studiord.net` = Worker Cloudflare `studio-rd`, integración Git con `main`. Versión publicada: **58.87** (identidad negro/blanco/oro + sidebar dock premium).
- Repositorio independiente desde el 22-sep-2026; base Supabase propia `edbknlkjnlfmkkiizdbe`.
- Línea gráfica definida (22-sep-2026): negro `#0A0A0A`, blanco cálido `#F7F5EF`, oro `#C9A227` como único acento; tipografía San Francisco (Inter fuera de Apple); iconos outline 1.75 px; movimiento fluido Apple; Factura en modo lista. Pendiente de llevar a código: ver `DESIGN.md` §12.8.
- Stitch: proyecto `projects/3084779069905725803`, design system `assets/11862383679991154944`.
- Próximos bloques: línea gráfica a código (Claude, rama sin publicar); WhatsApp backend propio (número Zernio pendiente del dueño); Financiamiento bloques B/D/E (ChatGPT).

## 5. Coordinación entre las dos IA

- Antes de empezar, leer la última bitácora de la otra IA para no pisar trabajo. Si dos ramas tocan el mismo archivo, la segunda rebasa sobre `main` y lo dice en su bitácora.
- Ramas: `chatgpt/*` o `codex/*` para ChatGPT; `claude/*` para Claude. Un PR por entrega, con la bitácora dentro del mismo PR.
- Dudas de alcance: preguntar al dueño en el chat, no decidir por él.
