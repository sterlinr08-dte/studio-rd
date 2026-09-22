# CLAUDE.md — STUDIO RD

Contexto de arranque obligatorio para Claude, ChatGPT y cualquier sesión que trabaje en `sterlinr08-dte/studio-rd`.

## Proyecto

- Sistema: **STUDIO** — venta de motores eléctricos, patinetas, aires acondicionados, televisores y más. Se está
  convirtiendo en un sistema de facturación completo (POS, compras, financiamiento; luego reacondicionados,
  técnicos y CRM).
- Repositorio: `sterlinr08-dte/studio-rd`. Rama de producción: `main`.
- Producción: `https://studiord.net` (Cloudflare Worker `studio-rd`, integración Git con `main`; sin GitHub Actions).
- Supabase: proyecto **STUDIO RD** `edbknlkjnlfmkkiizdbe` (org `sterlinr08`). Es una base **independiente**:
  nada se comparte con NEXUS PRO Seguros (`tnwsgcxurfyuszxsewsn`) ni con Bayolsale.
- Organización dentro de la base: `e404d1c4-24c5-4e17-88f6-84bef09d6d19` (slug `studio`, tipo `tienda`).
- Origen del código: copia del POS de NEXUS PRO (`sterlinr08-dte/nexus-pro`, commit `6328e66`, 22-sep-2026).
  Los módulos de Seguros, WhatsApp, rifas y vehículos siguen en los archivos pero no se usan (organización tipo
  tienda): se irán retirando módulo a módulo con bitácora.

## Reglas (mismas que NEXUS PRO)

1. Leer `CLAUDE.md`, `docs/bitacora/README.md` y las bitácoras más recientes antes de tocar nada.
2. **Cada cambio deja una bitácora nueva** `docs/bitacora/AAAA-MM-DD-HHMM-claude.md` o `-chatgpt.md`.
   Nunca editar ni borrar entradas anteriores.
3. **No publicar a `main` sin autorización explícita del dueño** ("publícalo", "súbelo", "ponlo en vivo").
4. Dinero, cobros, cuotas, compras, contabilidad: **auditar primero la fuente de verdad** (RPC/triggers en la base)
   y no crear contabilidad paralela. El asiento lo escribe el servidor, nunca el navegador.
5. Ningún secreto (service role, claves de API, contraseñas) en el repo, bitácoras ni chat. Solo la clave `anon`
   pública vive en `index.html`.
6. No enviar mensajes de WhatsApp a clientes sin autorización del dueño.
7. Publicación: subir `APP_VERSION` (`index.html`) y `version.json`; los parches se cargan con `?v=APP_VERSION`.
8. Diseño: `DESIGN.md` es la única línea gráfica (Nexus Blue como acento en el POS; login oscuro STUDIO).

## Estado técnico (22-sep-2026)

- Esquema de la base: `supabase/studio/01…14` (clon del POS + `13_compras_v2` + `14_financiamiento_v2`), ya
  aplicados en STUDIO RD. Banderas activas en `pos_config`: `compras_v2`, `financiamiento_v2`.
- Frontend: `index.html` (monolito) + `parches-pos.js` (POS, Compras v2, Financiamiento v2) +
  `parches-pos-stitch-visual.js` (tokens DESIGN.md). El login usa la piel STUDIO siempre (`html.nx-studio`).
- Usuario administrador: `admin` (cambio de contraseña forzado al primer acceso).
- Despliegue: Worker `studio-rd` (cuenta `7faa18426a58d75b8d975b1e00a0d6f3`) creado el 22-sep-2026 por integración Git
  con `main`; dominios `studiord.net` y `www.studiord.net` asignados a este Worker (antes en el Worker `nexus-pro`).
  URL técnica: `studio-rd.sterlinr08.workers.dev`.
- Pendientes: firma de cliente por link (RPC pública + `firma-financiamiento.html`), recordatorios WhatsApp,
  reportes de financiamiento, subida de documentos, manifest/iconos PWA propios, retirar módulos de Seguros.
