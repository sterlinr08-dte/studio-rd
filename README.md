# STUDIO RD

Sistema de facturación de STUDIO (hogar, movilidad y tecnología): punto de venta, compras con costo
desembarcado y cuentas por pagar, financiamiento con planes de interés, contabilidad.

- Producción: https://studiord.net (Cloudflare Worker `studio-rd`, despliegue por Git desde `main`).
- Base de datos: Supabase **STUDIO RD** (`edbknlkjnlfmkkiizdbe`), esquema en `supabase/studio/`.
- Contexto para IA y reglas de trabajo: `CLAUDE.md`. Historial de cambios: `docs/bitacora/`.

Sitio estático sin build: `index.html` + `parches-*.js`. Ver `wrangler.jsonc`.
