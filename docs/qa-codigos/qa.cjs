// QA de códigos automáticos (59.89, 06-oct-2026): la app real contra una base Supabase SIMULADA que imita los
// disparadores de la migración 48 (PRD-00xxxx y 001…, código repetido rechazado). Nunca toca la base real.
// La migración en sí se prueba aparte en la base, dentro de una transacción que se deshace:
// supabase/studio/pruebas/48_prueba_codigos.sql.
// Uso: desde la raíz del repo, python3 -m http.server 8790 & ; node docs/qa-codigos/qa.cjs
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const APP_URL = process.env.QA_URL || 'http://localhost:8790/index.html';
const OUT = process.env.QA_OUT || require('os').tmpdir();
let fallos = 0; const ok = (c, m) => { console.log((c ? 'OK    ' : 'FALLA ') + m); if (!c) fallos++; };

function base() {
  return {
    profiles: [{ id: 'auth-admin', usuario_sistema_id: 'us-admin', nom: 'ESTERLIN', login: 'admin', rol: 'admin', activo: true, must_change_password: false }],
    organizaciones: [{ id: 'org1', slug: 'studio', nombre: 'STUDIO', tipo: 'tienda', activo: true }],
    pos_config: [{ organizacion_id: 'org1', prefijo_contado: 'CO', prefijo_credito: 'CR' }],
    pos_acceso: [],
    pos_almacenes: [{ id: 'a1', nombre: 'Edificio Studio', es_principal: true, activo: true }],
    usuarios_sistema: [{ id: 'us-admin', nom: 'ESTERLIN', login: 'admin', rol: 'admin', activo: true, almacen_id: 'a1', organizacion_id: 'org1' }],
    pos_productos: [
      { id: 'p1', nombre: 'CW STUDIO AIR CONDITION 12 BTU', codigo: 'PRD-001003', precio: 1000, costo: 500, stock: 2, activo: true, tipo: 'producto' },
      { id: 'p2', nombre: 'PASOLA VIEJA', codigo: 'CAST-2021-0237', precio: 1000, costo: 500, stock: 1, activo: true, tipo: 'producto' },
      { id: 'p3', nombre: 'IPHONE 12 MINI', codigo: 'PRD-001642', precio: 1000, costo: 500, stock: 1, activo: true, tipo: 'producto' }
    ],
    rrhh_empleados: [
      { id: 'e2', codigo: '002', nombre: 'Clarisa Ventura', puesto: 'Cajera', salario: 20000, tipo_pago: 'mensual', activo: true },
      { id: 'e1', codigo: '001', nombre: 'Zoila Admin', puesto: 'Gerente', salario: 40000, tipo_pago: 'mensual', activo: true },
      { id: 'e3', codigo: '003', nombre: 'Ana Pérez', puesto: 'Vendedora', salario: 18000, tipo_pago: 'mensual', activo: true }
    ],
    rrhh_nominas: [], pos_clientes: []
  };
}
// imita los disparadores de la migración 48
function asignar(t, fila, db) {
  const c = (fila.codigo == null ? '' : String(fila.codigo)).trim();
  if (t === 'pos_productos') {
    if (c && db.pos_productos.some(p => String(p.codigo).toLowerCase() === c.toLowerCase())) return 'dup';
    if (!c) { const n = Math.max(1000, ...db.pos_productos.map(p => (/^PRD-(\d+)$/.exec(p.codigo || '') || [])[1] | 0)) + 1; fila.codigo = 'PRD-' + String(n).padStart(6, '0'); }
  }
  if (t === 'rrhh_empleados' && !c) { const n = Math.max(0, ...db.rrhh_empleados.map(e => /^\d+$/.test(e.codigo || '') ? +e.codigo : 0)) + 1; fila.codigo = String(n).padStart(3, '0'); }
  return null;
}

async function abrir(b, w, h, db) {
  const movil = w < 500;
  const p = await b.newPage({ viewport: { width: w, height: h }, hasTouch: movil, isMobile: movil });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  p.on('dialog', d => d.accept());
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
      const body = r.postDataJSON();
      if (m === 'POST') {
        const arr = (Array.isArray(body) ? body : [body]).map((x, i) => Object.assign({ id: t + '-n' + (db[t] || []).length + i, activo: true }, x));
        for (const f of arr) if (asignar(t, f, db) === 'dup') return send({ code: '23505', message: 'duplicate key value violates unique constraint "pos_productos_codigo_unico"' }, 409);
        db[t] = (db[t] || []).concat(arr); return send(arr, 201);
      }
      if (m === 'PATCH') return send([]);
      return send([]);
    }
    return route.fulfill({ status: 204, body: '' });
  });
  await p.goto(APP_URL + '#access_token=tok&refresh_token=r&expires_in=3600');
  await p.waitForFunction(() => typeof window.nxPosTab === 'function' && window.nxPosCfgListo === true, null, { timeout: 30000 });
  return { p, errs };
}
const avisos = p => p.evaluate(() => Array.from(document.querySelectorAll('.toast, [class*="toast"], #toast, .nxToast')).map(x => x.innerText).join(' | '));

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  for (const [w, h] of [[1280, 860], [390, 844]]) {
    console.log(`\n--- ${w}x${h}`);
    const db = base();
    const { p, errs } = await abrir(b, w, h, db);
    // Artículo nuevo sin código → PRD-001643
    await p.evaluate(() => window.nxPosTab('productos')); await p.waitForTimeout(500);
    await p.evaluate(() => window.nxPosNuevoProd()); await p.waitForTimeout(500);
    ok(await p.$eval('#ppCod', x => /Automático/.test(x.placeholder)), 'campo Código dice «Automático (PRD-…)»');
    await p.fill('#ppNom', 'AUDIFONOS QA');
    await p.evaluate(() => window.nxPosGuardarProd('')); await p.waitForTimeout(900);
    const nuevo = db.pos_productos.find(x => x.nombre === 'AUDIFONOS QA');
    ok(!!nuevo && nuevo.codigo === 'PRD-001643', 'se guarda con el siguiente código: ' + (nuevo && nuevo.codigo));
    ok(/PRD-001643/.test(await avisos(p) + await p.evaluate(() => document.body.innerText)), 'el aviso muestra el código asignado');
    // Código repetido → mensaje claro y no se cierra
    await p.evaluate(() => window.nxPosNuevoProd()); await p.waitForTimeout(500);
    await p.fill('#ppNom', 'REPETIDO QA'); await p.fill('#ppCod', 'prd-001003');
    await p.evaluate(() => window.nxPosGuardarProd('')); await p.waitForTimeout(800);
    const txt = await p.evaluate(() => document.body.innerText);
    ok(/Ese código ya lo tiene otro artículo/i.test(txt), 'código repetido: «Ese código ya lo tiene otro artículo»');
    ok(!!(await p.$('#ppNom')) && !db.pos_productos.some(x => x.nombre === 'REPETIDO QA'), 'no se guarda y el formulario sigue abierto');
    await p.evaluate(() => { const m = document.getElementById('nxPosProd'); if (m) m.remove(); });
    // RRHH: lista por código, con el código visible
    await p.evaluate(() => window.nxPosTab('rrhh')); await p.waitForTimeout(700);
    const cods = await p.$$eval('#v-pos .rhCod', xs => xs.map(x => x.textContent.trim()));
    ok(cods.join(',') === '001,002,003', 'Empleados: en orden de código y con el código visible (' + cods.join(',') + ')');
    await p.screenshot({ path: `${OUT}/codigos-rrhh-${w}.png` });
    // empleado nuevo → 004
    await p.evaluate(() => window.nxRhNuevoEmp()); await p.waitForTimeout(400);
    await p.fill('#emN', 'Pedro Nuevo'); await p.fill('#emS', '15000');
    await p.evaluate(() => window.nxRhGuardarEmp('')); await p.waitForTimeout(900);
    const e = db.rrhh_empleados.find(x => x.nombre === 'Pedro Nuevo');
    ok(!!e && e.codigo === '004', 'empleado nuevo recibe 004 (' + (e && e.codigo) + ')');
    ok(/Código 004/i.test(await p.evaluate(() => document.body.innerText)), 'el aviso dice «Código 004»');
    await p.evaluate(() => window.nxRhEditEmp('e2')); await p.waitForTimeout(400);
    ok(/002/.test(await p.$eval('#nxEmpForm .mt', x => x.innerText)), 'la ficha del empleado muestra su código (002)');
    await p.screenshot({ path: `${OUT}/codigos-ficha-${w}.png` });
    ok(errs.length === 0, 'sin errores de página' + (errs.length ? ': ' + errs.join(' | ') : ''));
    await p.close();
  }
  await b.close();
  console.log(`\n${fallos ? 'FALLAS: ' + fallos : 'TODO OK'}`); process.exitCode = fallos ? 1 : 0;
})();
