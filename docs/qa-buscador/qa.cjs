// QA del buscador inteligente en listas (59.88, 06-oct-2026): la app real contra una base Supabase SIMULADA
// (Playwright intercepta edbknlkjnlfmkkiizdbe.supabase.co; nunca toca la base real).
// Uso: desde la raíz del repo, python3 -m http.server 8790 & ; node docs/qa-buscador/qa.cjs
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const APP_URL = process.env.QA_URL || 'http://localhost:8790/index.html';
const OUT = process.env.QA_OUT || require('os').tmpdir();
let fallos = 0; const ok = (c, m) => { console.log((c ? 'OK    ' : 'FALLA ') + m); if (!c) fallos++; };

const NOMBRES = [
  ['CARGADORES DE 60V', 97], ['CW STUDIO AIR CONDITION 12 BTU', 2], ['GUARDA LODOS H8', 9], ['HOUSING GENERICO IPHONE 11 NORMAL', 0],
  ['HOUSING GENERICO IPHONE 11 PRO MAX', 101], ['IPHONE 11 NORMAL 128GB', 0], ['IPHONE 11 NORMAL 128GB', 6], ['IPHONE 11 NORMAL 64GB', 0],
  ['IPHONE 12 MINI 128GB', 1], ['IPHONE 12 NORMAL 64GB/AVISO DE PANTALLA', 0], ['IPHONE 12 PROMAX 128GB', 3], ['IPHONE 12 PROMAX 256GB', 0],
  ['IPHONE 12 PROMAX 256GB', 1], ['IPHONE 13 NORMAL 128GB', 0], ['IPHONE 14 NORMAL 128GB/AVISO DE PANTALLA', 1], ['IPHONE 16 PRO 256GB', 0],
  ['BATERÍA LITIO 48V', 4], ['PASOLA LQ-N9 ELÉCTRICA', 3]
];
function base() {
  return {
    profiles: [{ id: 'auth-admin', usuario_sistema_id: 'us-admin', nom: 'ESTERLIN', login: 'admin', rol: 'admin', activo: true, must_change_password: false }],
    organizaciones: [{ id: 'org1', slug: 'studio', nombre: 'STUDIO', tipo: 'tienda', activo: true }],
    pos_config: [{ organizacion_id: 'org1', prefijo_contado: 'CO', prefijo_credito: 'CR', compras_v2: true, financiamiento_v2: true }],
    pos_acceso: [],
    pos_almacenes: [{ id: 'a1', nombre: 'Edificio Studio', es_principal: true, activo: true }],
    usuarios_sistema: [{ id: 'us-admin', nom: 'ESTERLIN', login: 'admin', rol: 'admin', activo: true, almacen_id: 'a1', organizacion_id: 'org1' }],
    pos_productos: NOMBRES.map(([n, s], i) => ({ id: 'p' + i, nombre: n, codigo: 'PRD-00' + (1000 + i), precio: 1000, costo: 500, itbis: false, stock: s, activo: true, tipo: 'producto' })),
    pos_clientes: []
  };
}

async function abrir(b, w, h, db) {
  const movil = w < 500;
  const p = await b.newPage({ viewport: { width: w, height: h }, hasTouch: movil, isMobile: movil });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route(/edbknlkjnlfmkkiizdbe\.supabase\.co/, async (route) => {
    const r = route.request(), u = new URL(r.url()), m = r.method();
    const send = (o, st = 200) => route.fulfill({ status: st, contentType: 'application/json', body: JSON.stringify(o) });
    if (u.pathname.startsWith('/auth/v1/user')) return send({ id: 'auth-admin', email: 'admin@nexus-pro.local' });
    if (u.pathname.startsWith('/auth/v1/')) return send({ access_token: 'tok', refresh_token: 'r', expires_in: 3600, user: { id: 'auth-admin' } });
    if (u.pathname.startsWith('/functions/v1/')) return send({ ok: true });
    if (u.pathname.startsWith('/rest/v1/')) {
      const t = u.pathname.slice(9);
      if (m === 'GET' || m === 'HEAD') {
        let filas = db[t] || [];
        for (const [k, v] of u.searchParams) { if (/^(select|order|limit|offset|on_conflict)$/.test(k)) continue; const mm = /^eq\.(.*)$/.exec(v); if (mm) filas = filas.filter(x => String(x[k]) === decodeURIComponent(mm[1])); }
        return send(filas);
      }
      return send([]);
    }
    return route.fulfill({ status: 204, body: '' });
  });
  await p.goto(APP_URL + '#access_token=tok&refresh_token=r&expires_in=3600');
  await p.waitForFunction(() => typeof window.nxPosTab === 'function' && window.nxPosCfgListo === true && window.nxBuscador, null, { timeout: 30000 });
  return { p, errs };
}

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  // búsqueda pura (sin pantalla)
  {
    const { p } = await abrir(b, 1280, 860, base());
    const r = await p.evaluate(() => {
      const s = document.createElement('select');
      s.innerHTML = ['IPHONE 11 PRO MAX 256GB (PRD-1) — stock 2', 'IPHONE 12 PROMAX 128GB (PRD-2) — stock 0', 'IPHONE 12 PROMAX 256GB (PRD-3) — stock 4', 'BATERÍA LITIO (PRD-4) — stock 1'].map((t, i) => `<option value="${i}">${t}</option>`).join('');
      const it = window.nxBuscador._leer(s), B = window.nxBuscador;
      const q = x => { const n = B._norm(x), t = n ? n.split(' ') : []; return it.map(o => [o.value, B._puntuar(o, n, t)]).filter(o => o[1] > 0).sort((a, b) => b[1] - a[1]).map(o => o[0]).join(','); };
      return { promax: q('promax 12'), proMax: q('pro max 12'), acento: q('bateria'), typo: q('iphnoe 11'), codigo: q('prd-4'), orden: q('12 promax') };
    });
    ok(r.promax === '2,1' || r.promax.split(',').slice(0, 2).sort().join() === '1,2', '«promax 12» encuentra los dos 12 PROMAX (' + r.promax + ')');
    ok(r.orden.split(',')[0] === '2', 'con existencia primero: 12 PROMAX 256GB (stock 4) antes que el de stock 0 (' + r.orden + ')');
    ok(r.proMax.split(',').includes('1') && r.proMax.split(',').includes('2'), '«pro max 12» también une «promax» (' + r.proMax + ')');
    ok(r.acento === '3', '«bateria» sin acento encuentra «BATERÍA» (' + r.acento + ')');
    ok(r.typo.split(',')[0] === '0', '«iphnoe 11» con un error de letra encuentra el IPHONE 11 (' + r.typo + ')');
    ok(r.codigo.split(',')[0] === '3', 'por código «prd-4» (' + r.codigo + ')');
    await p.close();
  }
  for (const [w, h] of [[1280, 860], [390, 844]]) {
    console.log(`\n--- ${w}x${h}`);
    const { p, errs } = await abrir(b, w, h, base());
    await p.evaluate(() => window.nxPosTab('inventario')); await p.waitForTimeout(500);
    await p.evaluate(() => window.nxInvAjustarProd('p1')); await p.waitForTimeout(400);
    ok(await p.$eval('#ajProd', s => s.getAttribute('data-nx-sb') === '1' && /svg/.test(s.style.backgroundImage) && (s.style.backgroundImage.match(/url\(/g) || []).length === 2), 'Ajuste de inventario: la lista de productos tiene lupa');
    ok(await p.$eval('#ajProd', s => s.value) === 'p1', 'conserva el producto elegido al abrir (CW STUDIO AIR…)');
    await p.screenshot({ path: `${OUT}/buscador-ajuste-${w}.png` });
    if (w < 500) await p.tap('#ajProd'); else await p.click('#ajProd');
    await p.waitForSelector('.nxSbPanel', { timeout: 2000 }).catch(() => {});
    ok(!!(await p.$('.nxSbPanel')), 'al tocar la lista se abre el buscador (no la lista nativa)');
    await p.waitForTimeout(120);
    ok(await p.evaluate(() => !!(document.activeElement && document.activeElement.closest('.nxSbPanel') && document.activeElement.type === 'search')), 'el cursor queda en el buscador (' + await p.evaluate(() => document.activeElement && (document.activeElement.id || document.activeElement.tagName)) + ')');
    await p.keyboard.type('pro max 11', { delay: 20 }); await p.waitForTimeout(200);
    const prim = await p.$eval('.nxSbIt', b => b.innerText.replace(/\s+/g, ' '));
    ok(/HOUSING GENERICO IPHONE 11 PRO MAX/.test(prim), '«pro max 11» → primero «HOUSING GENERICO IPHONE 11 PRO MAX» (' + prim.slice(0, 70) + ')');
    ok(/101 en stock/i.test(prim), 'muestra la existencia al lado («101 en stock»)');
    await p.screenshot({ path: `${OUT}/buscador-panel-${w}.png` });
    await p.fill('.nxSbPanel input', 'iphone 11 128'); await p.waitForTimeout(200);
    const lst = await p.$$eval('.nxSbIt', bs => bs.map(b => b.innerText.replace(/\s+/g, ' ')));
    ok(lst.length === 2 && /6 en stock/i.test(lst[0]) && /Sin stock/i.test(lst[1]), '«iphone 11 128»: 2 resultados, primero el que tiene 6 en stock (' + lst.map(x => x.slice(0, 40)).join(' | ') + ')');
    await p.screenshot({ path: `${OUT}/buscador-resultados-${w}.png` });
    // elegir con Enter → el select cambia y dispara change
    await p.evaluate(() => { window.__chg = 0; document.getElementById('ajProd').addEventListener('change', () => window.__chg++); });
    await p.keyboard.press('Enter'); await p.waitForTimeout(250);
    ok(!(await p.$('.nxSbPanel')), 'Enter elige y cierra el buscador');
    ok(await p.$eval('#ajProd', s => s.value) === 'p6' && await p.evaluate(() => window.__chg) === 1, 'el producto elegido queda en la lista (p6) y avisa el cambio una vez');
    // recientes
    if (w < 500) await p.tap('#ajProd'); else await p.click('#ajProd');
    await p.waitForTimeout(250);
    const rec = await p.$$eval('.nxSbIt', bs => bs.slice(0, 2).map(b => b.innerText.replace(/\s+/g, ' ')));
    ok(/Reciente/i.test(rec[0] || '') && /IPHONE 11 NORMAL 128GB/.test(rec[0] || ''), 'el último elegido sale arriba como «Reciente»');
    await p.fill('.nxSbPanel input', 'zzzz'); await p.waitForTimeout(150);
    ok(/No hay coincidencias/i.test(await p.$eval('.nxSbLista', x => x.innerText)), 'sin resultados: mensaje claro');
    await p.keyboard.press('Escape'); await p.waitForTimeout(150);
    ok(!(await p.$('.nxSbPanel')) && await p.$eval('#ajProd', s => s.value) === 'p6', 'Escape cierra sin cambiar lo elegido');
    // aplicar el ajuste sigue funcionando con el valor del select
    const leido = await p.evaluate(() => { const s = document.getElementById('ajProd'); return s.options[s.selectedIndex].textContent; });
    ok(/IPHONE 11 NORMAL 128GB/.test(leido), 'la lista muestra el producto elegido (' + leido.slice(0, 50) + ')');
    // listas cortas no llevan buscador
    const corta = await p.evaluate(() => { const d = document.createElement('div'); d.innerHTML = '<select id="qaCorta"><option>A</option><option>B</option></select>'; document.body.appendChild(d); return new Promise(r => setTimeout(() => { r(document.getElementById('qaCorta').hasAttribute('data-nx-sb')); d.remove(); }, 80)); });
    ok(!corta, 'las listas cortas (menos de 10) se quedan como están');
    ok(errs.length === 0, 'sin errores de página' + (errs.length ? ': ' + errs.join(' | ') : ''));
    await p.close();
  }
  await b.close();
  console.log(`\n${fallos ? 'FALLAS: ' + fallos : 'TODO OK'}`); process.exitCode = fallos ? 1 : 0;
})();
