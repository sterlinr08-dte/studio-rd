// ──────────────────────────────────────────────────────────────────────────
// Cloudflare Worker — STUDIO (studiord.net)
//
// Sirve el sitio estático tal cual (env.ASSETS). Antes (NEXUS PRO) este Worker
// inyectaba la vista previa Open Graph de boleto.html para las rifas; STUDIO no
// tiene rifas ni seguros, así que no interviene ninguna ruta.
// ──────────────────────────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    return env.ASSETS.fetch(request);
  }
};
