// QA del contador de visitas (06-oct-2026, migración 51): la tienda pública manda la visita a web_registrar_visita
// (simulada; nunca toca la base real) y el Inicio del sistema muestra el resumen de web_visitas_resumen.
// Uso: desde la raíz del repo, python3 -m http.server 8790 & ; node docs/qa-visitas/qa.cjs
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const BASE = process.env.QA_BASE || 'http://localhost:8790';
const OUT = process.env.QA_OUT || require('os').tmpdir();
let fallos = 0; const ok = (c, m) => { console.log((c ? 'OK    ' : 'FALLA ') + m); if (!c) fallos++; };

async function tienda(b, url, opts) {
  const ctx = await b.newContext(Object.assign({ viewport: { width: 390, height: 844 } }, opts || {}));
  if (opts && opts.cookie) await ctx.addCookies([{ name: 'studio_staff', value: '1', url: BASE }]);
  const p = await ctx.newPage(); const env = [];
  await p.route(/edbknlkjnlfmkkiizdbe\.supabase\.co/, route => { const r = route.request(); if (/web_registrar_visita/.test(r.url())) env.push(r.postDataJSON()); route.fulfill({ status: 200, contentType: 'application/json', body: 'true' }); });
  await p.route(/sentry|unpkg|googleapis|gstatic|jsdelivr/, route => route.fulfill({ status: 200, body: '' }));
  await p.goto(BASE + url, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(2600);
  await ctx.close(); return env;
}
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const iphone = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', isMobile: true, hasTouch: true };
  let e = await tienda(b, '/tienda.html?qa-visitas=1', iphone);
  ok(e.length === 1 && e[0].p_pagina === 'tienda' && e[0].p_origen === 'directo' && e[0].p_dispositivo === 'celular' && /^[a-f0-9]{20}$/.test(e[0].p_visitante), 'tienda: manda una visita (tienda · directo · celular · número al azar) ' + JSON.stringify(e[0] || {}));
  e = await tienda(b, '/tienda.html?qa-visitas=1&utm_source=instagram', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129 Safari/537.36' });
  ok(e.length === 1 && e[0].p_origen === 'instagram' && e[0].p_dispositivo === 'computadora', 'con utm_source=instagram cuenta como Instagram, en computadora');
  e = await tienda(b, '/lq-n9.html?qa-visitas=1', { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129 Mobile Safari/537.36 WhatsApp/2.24' });
  ok(e.length === 1 && e[0].p_pagina === 'lq-n9' && e[0].p_origen === 'whatsapp', 'LQ-N9 abierta desde WhatsApp: página lq-n9, origen WhatsApp');
  e = await tienda(b, '/tienda.html?qa-visitas=1', { cookie: true });
  ok(e.length === 0, 'equipo del personal (cookie studio_staff): no cuenta');
  e = await tienda(b, '/tienda.html');
  ok(e.length === 0, 'navegador automático (robot) sin la marca de prueba: no cuenta');
  e = await tienda(b, '/tienda.html?qa-visitas=1', { userAgent: 'Mozilla/5.0 (compatible; Googlebot/2.1)' });
  ok(e.length === 0, 'Googlebot: no cuenta');

  // Inicio del sistema: panel de visitas
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } }); const errs = []; p.on('pageerror', x => errs.push(x.message));
  const dias = Array.from({ length: 30 }, (_, i) => ({ d: '2026-09-' + String(7 + i).padStart(2, '0'), n: i % 5 }));
  await p.route(/edbknlkjnlfmkkiizdbe\.supabase\.co/, async route => {
    const r = route.request(), u = new URL(r.url()); const send = (o, st = 200) => route.fulfill({ status: st, contentType: 'application/json', body: JSON.stringify(o) });
    if (u.pathname.startsWith('/auth/v1/user')) return send({ id: 'auth-admin', email: 'admin@nexus-pro.local' });
    if (u.pathname.startsWith('/auth/v1/')) return send({ access_token: 'tok', refresh_token: 'r', expires_in: 3600, user: { id: 'auth-admin' } });
    if (u.pathname === '/rest/v1/rpc/web_visitas_resumen') return send({ dias: 30, hoy: 12, hoy_visitantes: 9, semana: 61, semana_visitantes: 40, periodo: 210, periodo_visitantes: 150, total: 210, por_dia: dias, por_origen: { instagram: 120, whatsapp: 50, directo: 30, google: 10 }, por_dispositivo: { celular: 180, computadora: 30 }, por_pagina: { tienda: 190, 'lq-n9': 20 } });
    if (u.pathname.startsWith('/rest/v1/rpc/')) return send([]);
    const t = u.pathname.slice(9);
    const db = { profiles: [{ id: 'auth-admin', usuario_sistema_id: 'us-admin', nom: 'ADMIN', login: 'admin', rol: 'admin', activo: true, must_change_password: false }], organizaciones: [{ id: 'org1', slug: 'studio', nombre: 'STUDIO', tipo: 'tienda', activo: true }], pos_config: [{ organizacion_id: 'org1', prefijo_contado: 'CO', prefijo_credito: 'CR' }], pos_almacenes: [{ id: 'a1', nombre: 'Edificio Studio', es_principal: true, activo: true }], usuarios_sistema: [{ id: 'us-admin', nom: 'ADMIN', login: 'admin', rol: 'admin', activo: true, almacen_id: 'a1', organizacion_id: 'org1' }] };
    return send(db[t] || []);
  });
  await p.goto(BASE + '/index.html#access_token=tok&refresh_token=r&expires_in=3600');
  await p.waitForFunction(() => typeof window.nxPosTab === 'function' && window.nxPosCfgListo === true, null, { timeout: 30000 });
  await p.evaluate(() => window.nxPosTab('inicio')); await p.waitForTimeout(1500);
  const t = await p.$eval('#nxWebVis', x => x.innerText).catch(() => '');
  ok(/Visitas a la página web/i.test(t) && /12/.test(t) && /9 personas/i.test(t) && /210/.test(t), 'Inicio: panel «Visitas a la página web» con hoy, 7 días, 30 días y total');
  ok(/Instagram\s*57%/i.test(t) && /Celular\s*86%/i.test(t) && /Tienda\s*190/i.test(t), 'de dónde llegan, equipo y páginas');
  ok(await p.$$eval('#nxWebVis svg rect', r => r.length) === 30, 'gráfica de 30 días');
  await p.waitForTimeout(2000); await p.$eval('#nxWebVis', x => x.scrollIntoView()); await p.screenshot({ path: `${OUT}/visitas-inicio.png` });
  ok(errs.length === 0, 'sin errores de página' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close();
  console.log(`\n${fallos ? 'FALLAS: ' + fallos : 'TODO OK'}`); process.exitCode = fallos ? 1 : 0;
})();
