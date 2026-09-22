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
  **STUDIO no es una empresa de seguros.** El 22-sep-2026 se retiraron del repositorio los parches de Seguros,
  WhatsApp corporativo, CRM de seguros, préstamos legacy, vehículos, rifas y panel del dueño (ver bitácora
  `2026-09-22-1100-claude.md`). Queda pendiente podar del monolito `index.html` las vistas y funciones de Seguros
  que aún viven ahí en estado latente (el modo `tienda` nunca las muestra).

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
8. Diseño: `DESIGN.md` es la única línea gráfica (negro y carbón estructural, blanco cálido operativo y oro STUDIO como único acento de marca).

## Estado técnico (22-sep-2026)

- Esquema de la base: `supabase/studio/01…14` (clon del POS + `13_compras_v2` + `14_financiamiento_v2`), ya
  aplicados en STUDIO RD. Banderas activas en `pos_config`: `compras_v2`, `financiamiento_v2`.
- Frontend: `index.html` (monolito: login, sesión, `API`, `toast`, `fmt`, auditoría y el shell) +
  `parches-pos-money.js` (montos) + `parches-pos.js` (POS, Compras v2, Financiamiento v2) +
  `parches-pos-stitch-visual.js` (geometría base) + `studio-brand-theme.css` (paleta final negro/blanco/oro) + capas de UI compartidas `parches-contenido-movil-ajuste.js`,
  `parches-fase1-ui-motion.css`, `parches-motion-fase2.css`. El login usa la piel STUDIO siempre (`html.nx-studio`).
  **WhatsApp se queda** (decisión del dueño, 22-sep-2026): las 39 capas `parches-whatsapp-*` del Inbox corporativo
  están en el repo y las carga `parches-whatsapp.js` solo si `pos_config.whatsapp_inbox = true` (hoy `false`, porque
  STUDIO aún no tiene su backend de WhatsApp: tablas `whatsapp_*`, RPC, Edge Functions y número propio). Las capas de
  WhatsApp que eran de Seguros (cobranza de pólizas, pagos por validar, solicitudes, enrutamiento) no se restauraron.
  Al arrancar solo se consultan `organizaciones`, `usuarios_sistema`, `usuario_preferencias` y `auditoria`; el POS
  carga lo suyo desde `pos_*`.
- Usuario administrador: `admin` (cambio de contraseña forzado al primer acceso).
- Despliegue: Worker `studio-rd` (cuenta `7faa18426a58d75b8d975b1e00a0d6f3`) creado el 22-sep-2026 por integración Git
  con `main`; dominios `studiord.net` y `www.studiord.net` asignados a este Worker (antes en el Worker `nexus-pro`).
  URL técnica: `studio-rd.sterlinr08.workers.dev`.
- Pendientes: firma de cliente por link (RPC pública + `firma-financiamiento.html`), recordatorios WhatsApp,
  reportes de financiamiento, subida de documentos, manifest/iconos PWA propios, podar de `index.html` las
  vistas/funciones latentes de Seguros y las tablas núcleo heredadas (`agentes`, `bancos`, `secuencias_ncf`,
  `recibo_contador`, `saas_*`, `rrhh_*` si no se usan).
