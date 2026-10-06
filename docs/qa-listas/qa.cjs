// QA del Reglamento 13 «de 10 en 10» (06-oct-2026): listas paginadas de 10 en 10 con «1–10 de N», la búsqueda busca en
// toda la lista y la página vuelve a la 1 al buscar. Base Supabase SIMULADA; nunca toca la base real.
// Uso: desde la raíz del repo, python3 -m http.server 8790 & ; node docs/qa-listas/qa.cjs
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const APP_URL = process.env.QA_URL || 'http://localhost:8790/index.html';
const OUT = process.env.QA_OUT || require('os').tmpdir();
let fallos = 0; const ok = (c, m) => { console.log((c ? 'OK    ' : 'FALLA ') + m); if (!c) fallos++; };
const NOMBRES = ['ANA', 'BRENDA', 'CARLOS', 'DANIA', 'ELVIN', 'FRANCIS', 'GLORIA', 'HECTOR', 'IRIS', 'JOSE', 'KARLA', 'LUIS', 'MARIA', 'NELSON', 'OLGA', 'PEDRO', 'QUELVIN', 'ROSA', 'SANDRA', 'TOMAS', 'URSULA', 'VICTOR', 'WENDY', 'XIOMARA', 'YAN'];
function base() {
  return {
    profiles: [{ id: 'auth-a', usuario_sistema_id: 'us-a', nom: 'ADMIN', login: 'admin', rol: 'admin', activo: true, must_change_password: false }],
    organizaciones: [{ id: 'org1', slug: 'studio', nombre: 'STUDIO', tipo: 'tienda', activo: true }],
    pos_config: [{ organizacion_id: 'org1' }], pos_almacenes: [{ id: 'a1', nombre: 'Edificio Studio', es_principal: true, activo: true }],
    usuarios_sistema: [{ id: 'us-a', nom: 'ADMIN', login: 'admin', rol: 'admin', activo: true, almacen_id: 'a1', organizacion_id: 'org1' }],
    pos_clientes: NOMBRES.map((n, i) => ({ id: 'c' + i, codigo: 'C-' + String(100 + i).padStart(5, '0'), nombre: n + ' PRUEBA', telefono: '80955500' + String(i).padStart(2, '0'), es_cliente: true, activo: true, nivel_precio: 'final' })),
    pos_productos: Array.from({ length: 23 }, (_, i) => ({ id: 'p' + i, nombre: 'ARTICULO ' + (i + 1), codigo: 'PRD-00' + (1000 + i), precio: 100, costo: 50, stock: 5, activo: true, tipo: 'producto' })),
    pos_ventas: Array.from({ length: 13 }, (_, i) => ({ id: 'v' + i, numero: i + 1, numero_factura: 'CO' + String(i + 1).padStart(8, '0'), fecha: '2026-10-06', created_at: '2026-10-06T10:00:00', total: 100, estado: 'completada', cliente_nombre: 'Consumidor final' }))
  };
}
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  for (const [w, h] of [[1280, 900], [390, 844]]) {
    console.log(`\n--- ${w}x${h}`);
    const db = base();
    const p = await b.newPage({ viewport: { width: w, height: h }, isMobile: w < 500, hasTouch: w < 500 });
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.route(/edbknlkjnlfmkkiizdbe\.supabase\.co/, async route => {
      const r = route.request(), u = new URL(r.url()); const send = o => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
      if (u.pathname.startsWith('/auth/v1/user')) return send({ id: 'auth-a', email: 'a@studio.local' });
      if (u.pathname.startsWith('/auth/v1/')) return send({ access_token: 'tok', refresh_token: 'r', expires_in: 3600, user: { id: 'auth-a' } });
      if (u.pathname.startsWith('/rest/v1/rpc/')) return send([]);
      let filas = db[u.pathname.slice(9)] || [];
      for (const [k, v] of u.searchParams) { if (/^(select|order|limit|offset|on_conflict)$/.test(k)) continue; const mm = /^eq\.(.*)$/.exec(v); if (mm) filas = filas.filter(x => String(x[k]) === decodeURIComponent(mm[1])); }
      return send(filas);
    });
    await p.goto(APP_URL + '#access_token=tok&refresh_token=r&expires_in=3600');
    await p.waitForFunction(() => window.nxPosCfgListo === true, null, { timeout: 30000 });
    const vis = sel => p.$$eval(sel, xs => xs.filter(x => x.offsetParent !== null).length);
    const pie = clave => p.$eval(`.nxP10[data-de="${clave}"]`, x => x.innerText.replace(/\s+/g, ' ')).catch(() => '');
    // Clientes: 25 → 10 por página
    await p.evaluate(() => window.nxPosTab('clientes')); await p.waitForTimeout(700);
    ok(await vis('#nxCliTb tr[data-q]') === 10, 'Clientes: 10 filas visibles de 25');
    ok(/1–10 de 25/.test(await pie('clientes')), 'Clientes: pie «1–10 de 25» (' + await pie('clientes') + ')');
    await p.evaluate(() => window.nxPag10('clientes', 3)); await p.waitForTimeout(200);
    ok(await vis('#nxCliTb tr[data-q]') === 5 && /21–25 de 25/.test(await pie('clientes')), 'Clientes: página 3 → 21–25');
    await p.waitForTimeout(2500); await p.evaluate(() => { const t = document.querySelector('.nxP10'); t && t.scrollIntoView({ block: 'end' }); }); await p.screenshot({ path: `${OUT}/listas-clientes-${w}.png` });
    // búsqueda en toda la lista y vuelve a la página 1
    await p.fill('.nxBuscaFila input', 'wendy'); await p.waitForTimeout(250);
    const nomb = await p.$$eval('#nxCliTb tr[data-q]', xs => xs.filter(x => x.offsetParent !== null).map(x => x.innerText.split('\n')[0]));
    ok(nomb.length === 1 && /WENDY/.test(nomb[0]), 'Clientes: buscar «wendy» la encuentra aunque estaba en la página 3');
    ok(!(await p.$('.nxP10[data-de="clientes"]')), 'con 1 resultado no hay números de página');
    await p.fill('.nxBuscaFila input', ''); await p.waitForTimeout(250);
    ok(await vis('#nxCliTb tr[data-q]') === 10 && /1–10 de 25/.test(await pie('clientes')), 'al borrar la búsqueda vuelve a 1–10 de 25');
    // Entidades
    await p.evaluate(() => window.nxPosTab('entidades')); await p.waitForTimeout(600);
    ok(/1–10 de 25/.test(await pie('entidades')), 'Entidades: «1–10 de 25»');
    // Inventario: su paginador propio, ahora de 10
    await p.evaluate(() => window.nxPosTab('productos')); await p.waitForTimeout(600);
    const inv = await p.evaluate(() => document.getElementById('v-pos').innerText);
    ok(/Mostrando 1-10 de 23/i.test(inv), 'Inventario: «Mostrando 1-10 de 23»');
    // Historial de ventas
    await p.evaluate(() => window.nxPosTab('ventas')); await p.waitForTimeout(700);
    ok(/1–10 de 13/.test(await pie('historial-ventas')), 'Historial: «1–10 de 13» (' + await pie('historial-ventas') + ')');
    await p.evaluate(() => window.nxPag10('historial-ventas', 2)); await p.waitForTimeout(200);
    ok(/11–13 de 13/.test(await pie('historial-ventas')), 'Historial: página 2 → 11–13');
    // al volver a la pantalla se recuerda la página
    await p.evaluate(() => window.nxPosTab('clientes')); await p.waitForTimeout(400);
    await p.evaluate(() => window.nxPosTab('ventas')); await p.waitForTimeout(600);
    ok(/11–13 de 13/.test(await pie('historial-ventas')), 'al volver a Historial sigue en la página 2');
    ok(errs.length === 0, 'sin errores de página' + (errs.length ? ': ' + errs.join(' | ') : ''));
    await p.close();
  }
  await b.close();
  console.log(`\n${fallos ? 'FALLAS: ' + fallos : 'TODO OK'}`); process.exitCode = fallos ? 1 : 0;
})();
