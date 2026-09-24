// ──────────────────────────────────────────────────────────────────────────
// Cloudflare Worker — STUDIO (studiord.net)
//
// Portada pública (25-sep-2026, pedido del dueño): quien visita studiord.net ve
// la página de la tienda (tienda.html). El sistema sigue igual para el personal:
//   · /            → tienda, SALVO en equipos donde ya se inició sesión en el
//                    sistema (cookie studio_staff, la pone index.html al entrar)
//                    o si trae ?v= (recarga de actualización del sistema): ahí va la app.
//   · /app         → siempre la app (enlace «Acceso del personal»).
//   · /index.html  → siempre la app, SIN redirigir a «/» (la app instalada en el
//                    teléfono arranca aquí y no comparte cookies con Safari).
// Todo lo demás (JS, imágenes, verificar.html, firma, etc.) se sirve tal cual.
// Para volver a como estaba: dejar solo `return env.ASSETS.fetch(request);`.
// ──────────────────────────────────────────────────────────────────────────
function servir(env, request, ruta) {
  const url = new URL(request.url);
  url.pathname = ruta;
  return env.ASSETS.fetch(new Request(url.toString(), request));
}
async function sinCache(resp) {
  const r = new Response(resp.body, resp);
  r.headers.set('Cache-Control', 'no-cache');
  r.headers.append('Vary', 'Cookie');
  return r;
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'GET' || request.method === 'HEAD') {
      const p = url.pathname;
      if (p === '/app/') return Response.redirect(new URL('/app' + url.search, url).toString(), 301);
      if (p === '/app' || p === '/index.html') return sinCache(await servir(env, request, '/'));
      if (p === '/') {
        const personal = /(?:^|;\s*)studio_staff=1(?:;|$)/.test(request.headers.get('Cookie') || '') || url.searchParams.has('v');
        return sinCache(await (personal ? env.ASSETS.fetch(request) : servir(env, request, '/tienda')));
      }
    }
    return env.ASSETS.fetch(request);
  }
};
