// QA de dinero y clientes (59.87, 05-oct-2026): la app real contra una base Supabase SIMULADA (Playwright intercepta
// edbknlkjnlfmkkiizdbe.supabase.co; nunca toca la base real).
// Uso: desde la raíz del repo, python3 -m http.server 8790 & ; node docs/qa-dinero/qa.cjs
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const APP_URL = process.env.QA_URL || 'http://localhost:8790/index.html';
const OUT = process.env.QA_OUT || require('os').tmpdir();
let fallos = 0; const ok = (c, m) => { console.log((c ? 'OK    ' : 'FALLA ') + m); if (!c) fallos++; };

function base() {
  return {
    profiles: [{ id: 'auth-admin', usuario_sistema_id: 'us-admin', nom: 'ESTERLIN', login: 'admin', rol: 'admin', activo: true, must_change_password: false }],
    organizaciones: [{ id: 'org1', slug: 'studio', nombre: 'STUDIO', tipo: 'tienda', activo: true }],
    pos_config: [{ organizacion_id: 'org1', prefijo_contado: 'CO', prefijo_credito: 'CR', mora_pct: 5, mora_dias_gracia: 3, compras_v2: true, financiamiento_v2: true }],
    pos_acceso: [],
    pos_almacenes: [{ id: 'a1', nombre: 'Edificio Studio', es_principal: true, activo: true }],
    usuarios_sistema: [{ id: 'us-admin', nom: 'ESTERLIN', login: 'admin', rol: 'admin', activo: true, almacen_id: 'a1', organizacion_id: 'org1' }],
    pos_productos: [{ id: 'p1', nombre: 'AUDIFONOS BT', codigo: 'AUD1', precio: 1179.4, costo: 600, itbis: false, stock: 10, activo: true, tipo: 'producto' }],
    pos_clientes: [{ id: 'c1', nombre: 'CLIENTE VIEJO', codigo: 'C0001', telefono: '8095550000', es_cliente: true, activo: true, nivel_precio: 'final' }]
  };
}

async function abrir(b, w, h, db) {
  const movil = w < 500;
  const p = await b.newPage({ viewport: { width: w, height: h }, hasTouch: movil, isMobile: movil });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  p.on('dialog', d => d.accept());
  const llamadas = [];
  await p.route(/edbknlkjnlfmkkiizdbe\.supabase\.co/, async (route) => {
    const r = route.request(), u = new URL(r.url()), m = r.method();
    const send = (o, st = 200) => route.fulfill({ status: st, contentType: 'application/json', body: JSON.stringify(o) });
    if (u.pathname.startsWith('/auth/v1/user')) return send({ id: 'auth-admin', email: 'admin@nexus-pro.local' });
    if (u.pathname.startsWith('/auth/v1/')) return send({ access_token: 'tok', refresh_token: 'r', expires_in: 3600, user: { id: 'auth-admin' } });
    if (u.pathname.startsWith('/functions/v1/')) { llamadas.push(['fn', u.pathname, r.postDataJSON()]); return send({ ok: true }); }
    if (u.pathname.startsWith('/rest/v1/')) {
      const t = u.pathname.slice(9);
      if (m === 'GET' || m === 'HEAD') {
        let filas = db[t] || [];
        for (const [k, v] of u.searchParams) { if (/^(select|order|limit|offset|on_conflict)$/.test(k)) continue; const mm = /^eq\.(.*)$/.exec(v); if (mm) filas = filas.filter(x => String(x[k]) === decodeURIComponent(mm[1])); }
        return send(filas);
      }
      const body = r.postDataJSON(); llamadas.push([m, t, u.search, body]);
      if (m === 'POST') { const arr = (Array.isArray(body) ? body : [body]).map((x, i) => Object.assign({ id: t + '-n' + (db[t] || []).length + i, activo: true }, x)); db[t] = (db[t] || []).concat(arr); return send(arr); }
      if (m === 'PATCH') return send([]);
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
    // Lector y formato de dinero
    const lect = await p.evaluate(() => [window.nxMoney.parse('RD$ 1,250.00'), window.nxMoney.parse('1,250.5'), window.nxMoney.parse('4.000'), window.nxMoney.fixed('1250'), window.nxMoney.fixed(1179.4)]);
    ok(lect[0] === 1250 && lect[1] === 1250.5 && lect[2] === 4000 && lect[3] === '1,250.00' && lect[4] === '1,179.40', 'lector y formato: ' + JSON.stringify(lect));
    // Factura: precio y total con RD$, coma y dos decimales
    await p.evaluate(() => window.nxPosTab('factura')); await p.waitForTimeout(600);
    await p.evaluate(() => window.nxFacAdd('p1')); await p.waitForTimeout(500);
    const pin = await p.$eval('input.pin', x => x.value).catch(() => null);
    ok(pin === '1,179.40', 'Factura: precio de la línea con coma y decimales (' + pin + ')');
    const txt = await p.evaluate(() => document.getElementById('v-pos').innerText);
    ok(/Subtotal\s*RD\$ 1,179\.40/.test(txt) && /Redondeo\s*−\s*RD\$ 0\.40/.test(txt) && /Total\s*RD\$ 1,179\.00/.test(txt), 'Factura: línea RD$ 1,179.40, Redondeo − RD$ 0.40, Total RD$ 1,179.00');
    await p.screenshot({ path: `${OUT}/dinero-factura-${w}.png` });
    // Cambiar el precio escribiendo «1500» → al salir queda 1,500.00 y el total cambia
    await p.fill('input.pin', '1500'); await p.press('input.pin', 'Tab'); await p.waitForTimeout(500);
    const txt2 = await p.evaluate(() => document.getElementById('v-pos').innerText);
    ok(/RD\$ 1,500\.00/.test(txt2), 'Factura: precio escrito «1500» → RD$ 1,500.00 en el total');
    // Cliente: crear desde «Elegir cliente» con la ficha de Entidades
    await p.evaluate(() => window.nxFacCliToggle()); await p.waitForTimeout(400);
    await p.fill('#nxFacCliMQ', 'Juana Prueba'); await p.waitForTimeout(250);
    ok(!!(await p.$('.pf2cliNuevo')), '«Crear cliente nuevo» en Elegir cliente');
    await p.click('.pf2cliNuevo'); await p.waitForTimeout(500);
    ok(!!(await p.$('#nxEntForm')) && await p.$eval('#entNom', x => x.value) === 'Juana Prueba' && await p.$eval('#ent_es_cliente', x => x.checked), 'abre la ficha de Entidades con el nombre y «Cliente» marcado');
    await p.fill('#entTel', '8095551234');
    await p.evaluate(() => { const b = [...document.querySelectorAll('#nxEntForm button')].find(x => /Guardar/.test(x.textContent)); if (b) b.click(); }); await p.waitForTimeout(900);
    const post = llamadas.find(l => l[0] === 'POST' && l[1] === 'pos_clientes');
    // 59.91 (migración 50): el código lo pone la base; la pantalla lo manda vacío
    ok(!!post && post[3].nombre === 'Juana Prueba' && post[3].es_cliente === true && !post[3].codigo, 'se guarda en Entidades (pos_clientes); el código lo pone la base');
    const cliTxt = await p.evaluate(() => (document.getElementById('facCliInfoWrap') || document.getElementById('facCliTxt') || {}).innerText || '');
    ok(/Juana Prueba/i.test(cliTxt), 'queda elegido en la factura (' + cliTxt.replace(/\s+/g, ' ').slice(0, 60) + ')');
    await p.screenshot({ path: `${OUT}/dinero-cliente-${w}.png` });
    // Cobro: el monto recibido se llena con el total exacto (con centavos)
    await p.evaluate(() => { try { window.nxFacPrecio(0, '1179.40'); } catch (e) {} }); await p.waitForTimeout(300);
    await p.evaluate(() => window.nxPosCobrar()); await p.waitForTimeout(800);
    const big = await p.$eval('#payBig', x => x.value).catch(() => null);
    ok(big === '1,179.00', 'Cobro: monto recibido = total de la venta con dos decimales (' + big + ')');
    const cobroTxt = await p.evaluate(() => (document.querySelector('#payBig') && document.querySelector('#payBig').closest('.modal, .overlay') || document.body).innerText);
    ok(!/Crédito\s*RD\$ 0\.[1-9]/.test(cobroTxt), 'Cobro: no quedan centavos como crédito');
    await p.screenshot({ path: `${OUT}/dinero-cobro-${w}.png` });
    // Campo de dinero genérico: signo RD$ y dos decimales al salir
    const gen = await p.evaluate(async () => {
      const d = document.createElement('div'); d.innerHTML = '<input id="qaMon" data-nx-money>'; document.body.appendChild(d);
      window.nxMoney.scan(d); const i = document.getElementById('qaMon'); i.focus(); i.value = '2500'; i.dispatchEvent(new Event('input', { bubbles: true })); i.blur();
      await new Promise(r => setTimeout(r, 50));
      const r = { v: i.value, envuelto: !!i.closest('.nxMon'), signo: getComputedStyle(i.closest('.nxMon') || i, '::before').content };
      d.remove(); return r;
    });
    ok(gen.v === '2,500.00' && gen.envuelto && /RD\$/.test(gen.signo), 'campo de dinero: «2500» → «2,500.00» con «RD$» al lado');
    ok(errs.length === 0, 'sin errores de página' + (errs.length ? ': ' + errs.join(' | ') : ''));
    await p.close();
  }
  await b.close();
  console.log(`\n${fallos ? 'FALLAS: ' + fallos : 'TODO OK'}`); process.exitCode = fallos ? 1 : 0;
})();
