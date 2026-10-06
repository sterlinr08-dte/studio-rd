// QA del Inicio simplificado (06-oct-2026, dueño: «tiene demasiado icono»): 4 indicadores, avisos solo cuando hay
// algo, 6 accesos rápidos y sin la cuadrícula de 22 iconos. Base Supabase SIMULADA; nunca toca la base real.
// Uso: desde la raíz del repo, python3 -m http.server 8790 & ; node docs/qa-inicio/qa.cjs
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const APP_URL = process.env.QA_URL || 'http://localhost:8790/index.html';
const OUT = process.env.QA_OUT || require('os').tmpdir();
let fallos = 0; const ok = (c, m) => { console.log((c ? 'OK    ' : 'FALLA ') + m); if (!c) fallos++; };
async function abrir(b, w, h, rol, conPendientes) {
  const movil = w < 500;
  const p = await b.newPage({ viewport: { width: w, height: h }, isMobile: movil, hasTouch: movil });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const db = {
    profiles: [{ id: 'auth-u', usuario_sistema_id: 'us-u', nom: 'USUARIO', login: 'u', rol, activo: true, must_change_password: false }],
    organizaciones: [{ id: 'org1', slug: 'studio', nombre: 'STUDIO', tipo: 'tienda', activo: true }],
    pos_config: [{ organizacion_id: 'org1' }], pos_almacenes: [{ id: 'a1', nombre: 'Edificio Studio', es_principal: true, activo: true }],
    usuarios_sistema: [{ id: 'us-u', nom: 'USUARIO', login: 'u', rol, activo: true, almacen_id: 'a1', organizacion_id: 'org1' }],
    pos_productos: conPendientes ? [{ id: 'p1', nombre: 'BATERIA', stock: 1, stock_min: 5, activo: true, tipo: 'producto', precio: 1 }, { id: 'p2', nombre: 'CARGADOR', stock: 0, stock_min: 2, activo: true, tipo: 'producto', precio: 1 }] : [],
    pos_reparaciones: conPendientes ? [{ id: 'r1', estado: 'recibido', numero: 'R-1', created_at: '2026-10-01' }] : []
  };
  await p.route(/edbknlkjnlfmkkiizdbe\.supabase\.co/, async route => {
    const r = route.request(), u = new URL(r.url()); const send = o => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (u.pathname.startsWith('/auth/v1/user')) return send({ id: 'auth-u', email: 'u@studio.local' });
    if (u.pathname.startsWith('/auth/v1/')) return send({ access_token: 'tok', refresh_token: 'r', expires_in: 3600, user: { id: 'auth-u' } });
    if (u.pathname.startsWith('/rest/v1/rpc/')) return send([]);
    return send(db[u.pathname.slice(9)] || []);
  });
  await p.goto(APP_URL + '#access_token=tok&refresh_token=r&expires_in=3600');
  await p.waitForFunction(() => window.nxPosCfgListo === true, null, { timeout: 30000 });
  await p.evaluate(() => window.nxPosTab('inicio')); await p.waitForTimeout(1500);
  return { p, errs };
}
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  for (const [w, h] of [[1280, 900], [390, 844]]) {
    console.log(`\n--- ${w}x${h}`);
    let { p, errs } = await abrir(b, w, h, 'admin', true);
    const kp = await p.$$eval('#v-pos .nxTKpi .nxTKpiL', xs => xs.map(x => x.innerText.trim()));
    ok(kp.length === 4 && /Ventas de hoy/i.test(kp[0]) && /En espera/i.test(kp[3]), '4 indicadores principales (' + kp.join(' | ') + ')');
    const av = await p.$$eval('#v-pos .nxIniAviso', xs => xs.map(x => x.innerText.trim()));
    ok(av.length === 2 && /1 equipo en el taller/i.test(av.join()) && /2 productos con inventario crítico/i.test(av.join()), 'avisos solo de lo que hay: ' + av.join(' | '));
    const acc = await p.$$eval('#v-pos .nxIniAcc .nxApp', xs => xs.map(x => x.innerText.trim()));
    ok(acc.length === 6 && /Vender/i.test(acc[0]), '6 accesos rápidos (' + acc.join(', ') + ')');
    ok(await p.$$eval('#v-pos .nxApp', xs => xs.length) === 6, 'ya no está la cuadrícula de 22 iconos');
    await p.evaluate(() => { const b = document.querySelector('#v-pos .nxIniAviso'); b && b.click(); }); await p.waitForTimeout(500);
    ok(await p.evaluate(() => /Reparaciones|Taller|equipo/i.test(document.getElementById('v-pos').innerText.slice(0, 400))), 'el aviso abre su módulo (taller)');
    await p.evaluate(() => window.nxPosTab('inicio')); await p.waitForTimeout(2200);
    await p.screenshot({ path: `${OUT}/inicio-${w}.png` });
    ok(errs.length === 0, 'sin errores de página' + (errs.length ? ': ' + errs.join(' | ') : ''));
    await p.close();
    ({ p, errs } = await abrir(b, w, h, 'admin', false));
    ok((await p.$$eval('#v-pos .nxIniAviso', xs => xs.length)) === 0, 'sin pendientes: no sale ningún aviso');
    await p.close();
  }
  await b.close();
  console.log(`\n${fallos ? 'FALLAS: ' + fallos : 'TODO OK'}`); process.exitCode = fallos ? 1 : 0;
})();
