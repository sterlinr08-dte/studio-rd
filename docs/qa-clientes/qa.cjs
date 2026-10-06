// QA de clientes automáticos (59.91, 06-oct-2026): la app real contra una base Supabase SIMULADA que responde como la
// migración 50 (duplicados, unir, cédula repetida, código automático). Nunca toca la base real. La migración se prueba en
// la base dentro de una transacción que se deshace: supabase/studio/pruebas/50_prueba_clientes.sql.
// Uso: desde la raíz del repo, python3 -m http.server 8790 & ; node docs/qa-clientes/qa.cjs
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const APP_URL = process.env.QA_URL || 'http://localhost:8790/index.html';
const OUT = process.env.QA_OUT || require('os').tmpdir();
let fallos = 0; const ok = (c, m) => { console.log((c ? 'OK    ' : 'FALLA ') + m); if (!c) fallos++; };

function base() {
  return {
    profiles: [{ id: 'auth-admin', usuario_sistema_id: 'us-admin', nom: 'ADMINISTRADOR STUDIO', login: 'admin', rol: 'admin', activo: true, must_change_password: false }],
    organizaciones: [{ id: 'org1', slug: 'studio', nombre: 'STUDIO', tipo: 'tienda', activo: true }],
    pos_config: [{ organizacion_id: 'org1', prefijo_contado: 'CO', prefijo_credito: 'CR' }],
    pos_acceso: [], pos_almacenes: [{ id: 'a1', nombre: 'Edificio Studio', es_principal: true, activo: true }],
    usuarios_sistema: [{ id: 'us-admin', nom: 'ADMINISTRADOR STUDIO', login: 'admin', rol: 'admin', activo: true, almacen_id: 'a1', organizacion_id: 'org1' }],
    pos_productos: [],
    pos_clientes: [
      { id: 'h1', codigo: 'C-00124', nombre: 'HANCEL VASQUEZ', telefono: '8096525508', es_cliente: true, activo: true, nivel_precio: 'final' },
      { id: 'h2', codigo: 'C-00398', nombre: 'HANCEL VASQUEZ', telefono: '8096525508', cedula: '40226013874', es_cliente: true, activo: true, nivel_precio: 'final' },
      { id: 'b1', codigo: 'C-00296', nombre: 'BRENDA SANCHEZ', cedula: '402-3345697-5', es_cliente: true, activo: true, nivel_precio: 'final' },
      { id: 'b3', codigo: 'C-00298', nombre: 'BRENDA SANCHEZ', cedula: '402-3345697-5', es_cliente: true, activo: true, nivel_precio: 'final' }
    ]
  };
}
const DUP = [
  { grupo: 'tel:8096525508', motivo: 'Mismo teléfono', cliente_id: 'h1', codigo: 'C-00124', nombre: 'HANCEL VASQUEZ', telefono: '8096525508', cedula: null, es_empleado: false, ventas: 1, abonos: 3, chats: 0, creado: '2026-09-22' },
  { grupo: 'tel:8096525508', motivo: 'Mismo teléfono', cliente_id: 'h2', codigo: 'C-00398', nombre: 'HANCEL VASQUEZ', telefono: '8096525508', cedula: '40226013874', es_empleado: false, ventas: 2, abonos: 2, chats: 0, creado: '2026-09-22' },
  { grupo: 'ced:40233456975', motivo: 'Misma cédula', cliente_id: 'b1', codigo: 'C-00296', nombre: 'BRENDA SANCHEZ', telefono: null, cedula: '402-3345697-5', es_empleado: false, ventas: 0, abonos: 0, chats: 0, creado: '2026-09-22' },
  { grupo: 'ced:40233456975', motivo: 'Misma cédula', cliente_id: 'b3', codigo: 'C-00298', nombre: 'BRENDA SANCHEZ', telefono: null, cedula: '402-3345697-5', es_empleado: false, ventas: 4, abonos: 2, chats: 0, creado: '2026-09-22' }
];
async function abrir(b, w, h, db) {
  const movil = w < 500;
  const p = await b.newPage({ viewport: { width: w, height: h }, hasTouch: movil, isMobile: movil });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  p.on('dialog', d => d.accept());
  const llamadas = []; let dup = DUP.slice();
  await p.route(/edbknlkjnlfmkkiizdbe\.supabase\.co/, async (route) => {
    const r = route.request(), u = new URL(r.url()), m = r.method();
    const send = (o, st = 200) => route.fulfill({ status: st, contentType: 'application/json', body: JSON.stringify(o) });
    if (u.pathname.startsWith('/auth/v1/user')) return send({ id: 'auth-admin', email: 'admin@nexus-pro.local' });
    if (u.pathname.startsWith('/auth/v1/')) return send({ access_token: 'tok', refresh_token: 'r', expires_in: 3600, user: { id: 'auth-admin' } });
    if (u.pathname.startsWith('/functions/v1/')) return send({ ok: true });
    if (u.pathname === '/rest/v1/rpc/pos_clientes_duplicados') return send(dup);
    if (u.pathname === '/rest/v1/rpc/pos_unir_clientes') {
      const body = r.postDataJSON(); llamadas.push(['unir', body]);
      dup = dup.filter(x => !body.p_quitar.includes(x.cliente_id)); dup = dup.filter(x => dup.filter(y => y.grupo === x.grupo).length > 1);
      db.pos_clientes.forEach(c => { if (body.p_quitar.includes(c.id)) c.activo = false; });
      return send({ queda: body.p_queda, codigo: 'C-00398', unidos: body.p_quitar.length, movidos: { pos_ventas: 1, pos_abonos: 3 } });
    }
    if (u.pathname.startsWith('/rest/v1/rpc/')) return send([]);
    if (u.pathname.startsWith('/rest/v1/')) {
      const t = u.pathname.slice(9);
      if (m === 'GET' || m === 'HEAD') {
        let filas = db[t] || [];
        for (const [k, v] of u.searchParams) { if (/^(select|order|limit|offset|on_conflict)$/.test(k)) continue; const mm = /^eq\.(.*)$/.exec(v); if (mm) filas = filas.filter(x => String(x[k]) === decodeURIComponent(mm[1])); }
        return send(filas);
      }
      const body = r.postDataJSON(); llamadas.push([m, t, u.search, body]);
      if (m === 'POST' && t === 'pos_clientes') {
        const f = Array.isArray(body) ? body[0] : body;
        if (f.cedula && f.cedula.replace(/\D/g, '') === '40226013874') return send({ code: 'P0001', details: 'C-00398 · HANCEL VASQUEZ', hint: 'Esa cédula ya es de otro cliente.', message: 'CLIENTE_CEDULA_DUPLICADA' }, 400);
        const row = Object.assign({ id: 'nuevo' + db.pos_clientes.length, activo: true }, f, { codigo: f.codigo || 'C-00450' });
        db.pos_clientes.push(row); return send([row], 201);
      }
      if (m === 'POST') return send([Object.assign({ id: t + '-n' }, Array.isArray(body) ? body[0] : body)], 201);
      return send([]);
    }
    return route.fulfill({ status: 204, body: '' });
  });
  await p.goto(APP_URL + '#access_token=tok&refresh_token=r&expires_in=3600');
  await p.waitForFunction(() => typeof window.nxPosTab === 'function' && window.nxPosCfgListo === true, null, { timeout: 30000 });
  return { p, errs, llamadas };
}

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  for (const [w, h] of [[1280, 860], [390, 844]]) {
    console.log(`\n--- ${w}x${h}`);
    const db = base();
    const { p, errs, llamadas } = await abrir(b, w, h, db);
    await p.evaluate(() => window.nxPosTab('clientes')); await p.waitForTimeout(500);
    ok(/Revisar duplicados/i.test(await p.evaluate(() => document.getElementById('v-pos').innerText)), 'Clientes: botón «Revisar duplicados» para el administrador');
    await p.evaluate(() => window.nxDupAbrir()); await p.waitForTimeout(700);
    const txt = await p.$eval('#nxDupCuerpo', x => x.innerText);
    ok(/2 grupos/i.test(txt) && /Mismo teléfono/i.test(txt) && /Misma cédula/i.test(txt), 'muestra los 2 grupos con el motivo');
    const marcadas = await p.$$eval('#nxDupCuerpo .nxDupF.on .rhCod', xs => xs.map(x => x.textContent));
    ok(marcadas.join(',') === 'C-00298,C-00398' || marcadas.join(',') === 'C-00398,C-00298', 'queda marcada la ficha con más movimientos (' + marcadas.join(',') + ')');
    await p.waitForTimeout(2500); await p.screenshot({ path: `${OUT}/clientes-duplicados-${w}.png` });
    // unir el grupo de HANCEL en la marcada (C-00398)
    const gi = await p.evaluate(() => { const gs = [...document.querySelectorAll('#nxDupCuerpo .nxDupG')]; return gs.findIndex(g => /HANCEL/.test(g.innerText)); });
    await p.evaluate(gi => window.nxDupUnir(gi), gi); await p.waitForTimeout(900);
    const u = llamadas.find(l => l[0] === 'unir');
    ok(!!u && u[1].p_queda === 'h2' && u[1].p_quitar.join() === 'h1', 'se une en C-00398 quitando C-00124');
    const txt2 = await p.$eval('#nxDupCuerpo', x => x.innerText).catch(() => '');
    ok(/1 grupo/i.test(txt2) && !/HANCEL/.test(txt2), 'el grupo unido desaparece de la lista');
    ok(/unidos en C-00398/i.test(await p.evaluate(() => document.body.innerText)), 'aviso «Clientes unidos en C-00398» con lo que se pasó');
    await p.evaluate(() => { const m = document.getElementById('nxDup'); if (m) m.remove(); });
    // cliente nuevo: el código lo pone la base
    await p.evaluate(() => window.nxPosNuevoCli()); await p.waitForTimeout(500);
    await p.fill('#entNom', 'QA CLIENTE NUEVO'); await p.fill('#entTel', '8095557001');
    await p.evaluate(() => { const b = [...document.querySelectorAll('#nxEntForm button')].find(x => /Guardar/.test(x.textContent)); if (b) b.click(); }); await p.waitForTimeout(900);
    const post = llamadas.find(l => l[0] === 'POST' && l[1] === 'pos_clientes' && /QA CLIENTE NUEVO/.test(JSON.stringify(l[3])));
    ok(!!post && (post[3].codigo == null || post[3].codigo === ''), 'cliente nuevo: la pantalla no inventa el código (lo pone la base)');
    ok(/C-00450/.test(await p.evaluate(() => document.body.innerText)), 'el aviso muestra el código que puso la base (C-00450)');
    // cédula repetida
    await p.evaluate(() => window.nxPosNuevoCli()); await p.waitForTimeout(500);
    await p.fill('#entNom', 'QA REPETIDA'); await p.fill('#entCed', '402-2601387-4');
    await p.evaluate(() => { const b = [...document.querySelectorAll('#nxEntForm button')].find(x => /Guardar/.test(x.textContent)); if (b) b.click(); }); await p.waitForTimeout(900);
    const t3 = await p.evaluate(() => document.body.innerText);
    ok(/Esa cédula ya es de otro cliente/i.test(t3), 'cédula repetida: «Esa cédula ya es de otro cliente»');
    ok(/HANCEL VASQUEZ/.test(await p.$eval('#nxEntForm', x => x.innerText).catch(() => '')) || /C-00398/.test(t3), 'ofrece abrir la ficha que ya tiene esa cédula');
    ok(errs.length === 0, 'sin errores de página' + (errs.length ? ': ' + errs.join(' | ') : ''));
    await p.close();
  }
  await b.close();
  console.log(`\n${fallos ? 'FALLAS: ' + fallos : 'TODO OK'}`); process.exitCode = fallos ? 1 : 0;
})();
