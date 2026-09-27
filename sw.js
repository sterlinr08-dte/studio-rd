// NEXUS PRO v10 — Service Worker
// Cachea SOLO archivos estáticos. No toca datos ni peticiones dinámicas.

const CACHE_NAME = 'studio-rd-v3';  // v3 (27-sep-2026): purga imágenes viejas guardadas (fotos de TV)
const ASSETS_OPCIONALES = [
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-apple-180.png',
];

// Instalar: cachear opcionales uno por uno (tolerante a fallos)
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      await Promise.all(ASSETS_OPCIONALES.map(url =>
        cache.add(url).catch(() => {})
      ));
      return self.skipWaiting();
    })
  );
});

// Activar: limpiar caches antiguas
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch: SOLO interceptar imágenes/iconos estáticos.
// TODO lo demás (HTML, JS, Supabase, APIs) pasa directo sin tocar.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  const url = e.request.url;

  // NUNCA interceptar: Supabase, parches-*.js (los 6 archivos del sistema de
  // parches, 2026-08-27: ya no existe un "parches.js" único), index.html, ni JS dinámico
  if (url.includes('supabase.co')) return;
  if (url.includes('/parches-')) return;
  if (url.includes('.html')) return;
  if (url.includes('?')) return; // peticiones con query (datos) pasan directo

  // Solo cachear imágenes/iconos estáticos
  const esImagen = /\.(png|jpg|jpeg|webp|gif|svg|ico)$/i.test(url);
  if (!esImagen) return; // todo lo demás pasa directo

  // Fotos de productos de la tienda/catálogo: primero la red (siempre la versión publicada),
  // la copia guardada solo si no hay conexión. Antes era «caché para siempre» y el teléfono
  // seguía mostrando fotos viejas después de publicar (27-sep-2026).
  if (url.includes('/img/tienda/')) {
    e.respondWith(
      fetch(e.request).then(resp => {
        if (resp && resp.status === 200) {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        }
        return resp;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  // Resto de imágenes/iconos: se responde con la copia guardada y se actualiza en segundo plano.
  e.respondWith(
    caches.match(e.request).then(cached => {
      const red = fetch(e.request).then(resp => {
        if (resp && resp.status === 200) {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        }
        return resp;
      }).catch(() => cached);
      return cached || red;
    })
  );
});

self.addEventListener('message', e => {
  if (e.data === 'version') e.ports[0].postMessage(CACHE_NAME);
});
