// QA de «una persona, una ficha» (59.90, 06-oct-2026): la app real contra una base Supabase SIMULADA que responde
// pos_personal() como la migración 49. Nunca toca la base real. La migración en sí se prueba en la base dentro de una
// transacción que se deshace: supabase/studio/pruebas/49_prueba_personas.sql (16 de 16 OK).
// Uso: desde la raíz del repo, python3 -m http.server 8790 & ; node docs/qa-personas/qa.cjs
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const APP_URL = process.env.QA_URL || 'http://localhost:8790/index.html';
const OUT = process.env.QA_OUT || require('os').tmpdir();
let fallos = 0; const ok = (c, m) => { console.log((c ? 'OK    ' : 'FALLA ') + m); if (!c) fallos++; };

const EMP = [['e1', '001', 'Super Admin', null, null], ['e2', '002', 'Clarisa Ventura', 'u2', 'admin'], ['e5', '005', 'ERIKA REYES', 'u5', 'cajero'], ['e9', '009', 'SAMUEL PEÑA', 'u9', 'vendedor'], ['e11', '011', 'Técnico Taller', 'u11', 'vendedor'], ['e17', '017', 'ADMINISTRADOR STUDIO', 'us-admin', 'admin']];
function base() {
  return {
    profiles: [{ id: 'auth-admin', usuario_sistema_id: 'us-admin', nom: 'ADMINISTRADOR STUDIO', login: 'admin', rol: 'admin', activo: true, must_change_password: false }],
    organizaciones: [{ id: 'org1', slug: 'studio', nombre: 'STUDIO', tipo: 'tienda', activo: true }],
    pos_config: [{ organizacion_id: 'org1', prefijo_contado: 'CO', prefijo_credito: 'CR' }],
    pos_acceso: [],
    pos_almacenes: [{ id: 'a1', nombre: 'Edificio Studio', es_principal: true, activo: true }],
    usuarios_sistema: EMP.filter(e => e[3]).map(e => ({ id: e[3], nom: e[2].toUpperCase(), login: e[2].split(' ')[0].toLowerCase(), rol: e[4], activo: true, almacen_id: 'a1', organizacion_id: 'org1', empleado_id: e[0] })),
    rrhh_empleados: EMP.map(e => ({ id: e[0], codigo: e[1], nombre: e[2], entidad_id: 'c-' + e[0], salario: 20000, tipo_pago: 'mensual', activo: true, comision_pct: e[1] === '009' ? 3 : null })),
    pos_clientes: EMP.map(e => ({ id: 'c-' + e[0], codigo: 'EM-' + e[1], nombre: e[2], es_empleado: true, es_cliente: false, activo: true, nivel_precio: 'final' })),
    pos_productos: [{ id: 'p1', nombre: 'AUDIFONOS BT', codigo: 'PRD-001003', precio: 1000, costo: 600, itbis: false, stock: 10, activo: true, tipo: 'producto' }],
    rrhh_nominas: [], pos_reparaciones: []
  };
}
function personal(db) {
  return db.rrhh_empleados.map(e => { const u = db.usuarios_sistema.find(x => x.empleado_id === e.id); return { empleado_id: e.id, codigo: e.codigo, nombre: e.nombre, telefono: null, puesto: null, comision_pct: e.comision_pct, activo: e.activo, usuario_id: u ? u.id : null, usuario_activo: u ? u.activo : null, rol: u ? u.rol : null, soy_yo: !!u && u.id === 'us-admin' }; });
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
    if (u.pathname.startsWith('/functions/v1/')) { llamadas.push(['fn', u.pathname, r.postDataJSON()]); return send({ ok: true, usuarios: db.usuarios_sistema }); }
    if (u.pathname === '/rest/v1/rpc/pos_personal') return send(personal(db));
    if (u.pathname.startsWith('/rest/v1/rpc/')) return send([]);
    if (u.pathname.startsWith('/rest/v1/')) {
      const t = u.pathname.slice(9);
      if (m === 'GET' || m === 'HEAD') {
        let filas = db[t] || [];
        for (const [k, v] of u.searchParams) { if (/^(select|order|limit|offset|on_conflict)$/.test(k)) continue; const mm = /^eq\.(.*)$/.exec(v); if (mm) filas = filas.filter(x => String(x[k]) === decodeURIComponent(mm[1])); }
        return send(filas);
      }
      const body = r.postDataJSON(); llamadas.push([m, t, u.search, body]);
      if (m === 'POST') { const arr = (Array.isArray(body) ? body : [body]).map((x, i) => Object.assign({ id: t + '-n' + (db[t] || []).length + i, activo: true }, x)); db[t] = (db[t] || []).concat(arr); return send(arr, 201); }
      if (m === 'PATCH') { const id = (/id=eq\.([^&]+)/.exec(u.search) || [])[1]; const f = (db[t] || []).find(x => String(x.id) === id); if (f) Object.assign(f, body); return send(f ? [f] : []); }
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
    // Cobro: el vendedor es el empleado de quien cobra, con su código
    await p.evaluate(() => window.nxPosTab('factura')); await p.waitForTimeout(500);
    await p.evaluate(() => window.nxFacAdd('p1')); await p.waitForTimeout(300);
    await p.evaluate(() => window.nxPosCobrar()); await p.waitForTimeout(700);
    const vend = await p.$eval('#posVendId', s => ({ v: s.value, t: s.options[s.selectedIndex].textContent, n: s.options.length })).catch(() => null);
    ok(vend && vend.v === 'e17' && /017 · ADMINISTRADOR STUDIO/.test(vend.t), 'Cobro: vendedor automático = el empleado de quien cobra (' + (vend && vend.t) + ')');
    ok(vend && vend.n === 7, 'Cobro: la lista de vendedores son los 6 empleados (+ «Sin vendedor»)');
    await p.screenshot({ path: `${OUT}/personas-cobro-${w}.png` });
    await p.evaluate(() => { const m = document.getElementById('nxPosPago'); if (m) m.remove(); });
    // Ajustes → Empleados → Vendedores: empleados con código y %
    await p.evaluate(() => { window.nxPosTab('ajustes'); }); await p.waitForTimeout(400);
    await p.evaluate(() => { window.nxAjSec('equipo'); }); await p.waitForTimeout(500);
    await p.evaluate(() => { window.nxAjEqTab('vendedores'); }); await p.waitForTimeout(400);
    const vtxt = await p.evaluate(() => document.getElementById('v-pos').innerText);
    ok(/009\s*SAMUEL PEÑA[\s\S]*3%/i.test(vtxt) && /Los vendedores son tus empleados/i.test(vtxt), 'Ajustes → Vendedores: los empleados con su código y su %');
    await p.screenshot({ path: `${OUT}/personas-vendedores-${w}.png` });
    await p.evaluate(() => window.nxVendEdit('e5')); await p.waitForTimeout(300);
    await p.fill('#vdC', '2.5'); await p.evaluate(() => window.nxVendComGuardar('e5')); await p.waitForTimeout(600);
    ok(llamadas.some(l => l[0] === 'PATCH' && l[1] === 'rrhh_empleados' && /e5/.test(l[2]) && l[3].comision_pct === 2.5), 'el % se guarda en el empleado (rrhh_empleados.comision_pct)');
    ok(!llamadas.some(l => l[1] === 'pos_vendedores'), 'ya no se usa la tabla aparte de vendedores');
    // Entidad marcada Empleado: la pantalla ya no crea la ficha de RRHH (la crea la base)
    const antes = llamadas.length;
    await p.evaluate(() => window.nxEntEdit('c-e9')); await p.waitForTimeout(400);
    await p.fill('#entTel', '8095551111');
    await p.evaluate(() => { const b = [...document.querySelectorAll('#nxEntForm button')].find(x => /Guardar/.test(x.textContent)); if (b) b.click(); }); await p.waitForTimeout(800);
    const nuevas = llamadas.slice(antes);
    ok(nuevas.some(l => l[0] === 'PATCH' && l[1] === 'pos_clientes') && !nuevas.some(l => l[1] === 'rrhh_empleados'), 'Entidad de empleado: solo se guarda la Entidad; la copia a RRHH la hace la base');
    // RRHH: desactivar un empleado con usuario → aviso y se le retira el acceso
    await p.evaluate(() => window.nxPosTab('rrhh')); await p.waitForTimeout(800);
    await p.evaluate(() => window.nxRhEditEmp('e9')); await p.waitForTimeout(400);
    ok(/Enlazado con su Entidad/i.test(await p.$eval('#nxEmpForm', x => x.innerText)), 'la ficha del empleado dice que está enlazada con su Entidad');
    ok(!!(await p.$('#emCom')), 'la ficha del empleado tiene «Comisión por ventas (%)»');
    await p.selectOption('#emA', '0');
    const a2 = llamadas.length;
    await p.evaluate(() => window.nxRhGuardarEmp('e9')); await p.waitForTimeout(900);
    const n2 = llamadas.slice(a2);
    const pat = n2.find(l => l[0] === 'PATCH' && l[1] === 'rrhh_empleados');
    ok(!!pat && pat[3].activo === false && pat[3].entidad_id === 'c-e9', 'se guarda inactivo sin perder el enlace con su Entidad');
    ok(n2.some(l => l[0] === 'fn' && l[2] && l[2].accion === 'desactivar' && l[2].usuario_id === 'u9'), 'se llama a «desactivar» su usuario (cierra su acceso)');
    // Reparaciones: técnico = empleado
    await p.evaluate(() => window.nxPosTab('reparaciones')); await p.waitForTimeout(400);
    await p.evaluate(() => window.nxRepNueva()); await p.waitForTimeout(400);
    const tec = await p.$eval('#repTec', s => s.tagName + ':' + Array.from(s.options || []).map(o => o.textContent).join('|')).catch(() => 'no');
    ok(/^SELECT:.*011 · Técnico Taller/.test(tec), 'Reparaciones: el técnico se elige de los empleados con su código');
    await p.screenshot({ path: `${OUT}/personas-reparacion-${w}.png` });
    ok(errs.length === 0, 'sin errores de página' + (errs.length ? ': ' + errs.join(' | ') : ''));
    await p.close();
  }
  await b.close();
  console.log(`\n${fallos ? 'FALLAS: ' + fallos : 'TODO OK'}`); process.exitCode = fallos ? 1 : 0;
})();
