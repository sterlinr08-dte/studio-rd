// QA del Tablero de ventas (16-oct-2026, dueño: «Excelente, aplícalo» sobre la maqueta del dashboard).
// Base Supabase SIMULADA con ventas inventadas de cifras conocidas; nunca toca la base real. Reloj: 16-oct-2026 18:30 RD (corre desde ahí).
// Uso: desde la raíz del repo, python3 -m http.server 8790 & ; node docs/qa-tablero/qa.cjs   (QA_OUT=carpeta para las capturas)
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const APP_URL = process.env.QA_URL || 'http://localhost:8790/index.html';
const OUT = process.env.QA_OUT || require('os').tmpdir();
let fallos = 0; const ok = (c, m) => { console.log((c ? 'OK    ' : 'FALLA ') + m); if (!c) fallos++; };
const ORG = 'org1';
const it = (pid, nom, cant, imp) => ({ producto_id: pid, nombre: nom, cantidad: cant, precio: imp / cant, importe: imp });
const V = (id, fecha, total, pagos, vend, creador, items, estado) => Object.assign({ id, organizacion_id: ORG, fecha, total, estado: estado || 'completada', pagado_efectivo: 0, pagado_tarjeta: 0, pagado_transferencia: 0, pagado_otro: 0, credito_monto: 0, vendedor_nombre: vend, created_by_name: creador, pos_venta_items: items }, pagos);
// Octubre (1–16): 780,000 en 5 facturas. Septiembre: 490,000 en 4 (una a las 23:30 del 30-sep RD = 1-oct en UTC).
const VENTAS_A = [
  V('s1', '2026-09-05T15:00:00Z', 200000, { pagado_efectivo: 200000 }, 'Ana Pérez', 'Caja', [it('p2', 'TV 55', 1, 200000)]),
  V('s2', '2026-09-17T03:00:00Z', 100000, { pagado_transferencia: 100000 }, 'Luis Gómez', 'Caja', [it('p3', 'Bocina', 5, 100000)]),
  V('s3', '2026-09-20T15:00:00Z', 120000, { pagado_efectivo: 120000 }, 'Luis Gómez', 'Caja', [it('p3', 'Bocina', 6, 120000)]),
  V('s4', '2026-10-01T03:30:00Z', 70000, { pagado_efectivo: 70000 }, 'Ana Pérez', 'Caja', [it('p3', 'Bocina', 3, 70000)]),
  V('o1', '2026-10-01T04:00:00Z', 100000, { pagado_efectivo: 100000 }, 'Ana Pérez', 'Caja', [it('p1', 'IPHONE 17 PRO MAX 256GB', 1, 100000)]),
  V('o2', '2026-10-03T15:00:00Z', 250000, { pagado_transferencia: 250000 }, null, 'Super Admin', [it('p1', '\tIPHONE 17 PRO MAX 256GB', 2, 250000)]),
  V('o3', '2026-10-05T20:00:00Z', 50000, { pagado_tarjeta: 50000 }, ' ANA  PEREZ ', 'Caja', [it(null, 'Cargador  USB', 5, 50000)]),
  V('o4', '2026-10-10T16:00:00Z', 300000, { pagado_efectivo: 100000, credito_monto: 200000 }, 'Luis Gómez', 'Caja', [it('p9', 'TV  55', 1, 300000)]),   // otra ficha con el mismo nombre
  V('o5', '2026-10-11T16:00:00Z', 999999, { pagado_efectivo: 999999 }, 'Luis Gómez', 'Caja', [it('p2', 'TV 55', 3, 999999)], 'anulada'),
  V('o6', '2026-10-16T22:00:00Z', 80000, { pagado_otro: 80000 }, 'Luis Gómez', 'Caja', [it('p3', 'Bocina', 4, 80000)])
];
const DEVOL_A = [{ id: 'd1', fecha: '2026-10-12', total: 30000, estado: 'emitida' }, { id: 'd2', fecha: '2026-10-13', total: 5000, estado: 'anulada' }];
const METAS_A = [{ mes: '2026-10-01', vendedor: '', monto: 3100000 }, { mes: '2026-10-01', vendedor: 'Ana Pérez', monto: 1000000 }, { mes: '2026-10-01', vendedor: 'Luis Gómez', monto: 400000 }, { mes: '2026-10-01', vendedor: 'Pedro Sin Venta', monto: 500000 }];
// Caso real de hoy: la última venta registrada es del 18-sep y octubre está vacío.
const VENTAS_B = [V('b1', '2026-09-18T20:00:00Z', 729100, { pagado_efectivo: 729100 }, 'Winifergomez', 'Caja', [it('p1', 'IPHONE 17 PRO MAX 256GB', 1, 729100)])];

function filtrar(rows, sp) {
  let out = rows.slice();
  for (const [k, raw] of sp.entries()) {
    if (['select', 'order', 'limit', 'offset'].includes(k)) continue;
    const m = /^(eq|gte|gt|lte|lt|is)\.(.*)$/.exec(raw); if (!m) continue;
    const op = m[1], val = m[2];
    out = out.filter(r => {
      const a = r[k]; if (op === 'is') return String(a) === val;
      const fecha = /^\d{4}-\d{2}-\d{2}/.test(val);
      const x = fecha ? new Date(String(a).length === 10 ? a + 'T00:00:00Z' : a).getTime() : (typeof a === 'number' ? a : String(a));
      const y = fecha ? new Date(val.length === 10 ? val + 'T00:00:00Z' : val).getTime() : (typeof a === 'number' ? Number(val) : val);
      return op === 'eq' ? x === y : op === 'gte' ? x >= y : op === 'gt' ? x > y : op === 'lte' ? x <= y : x < y;
    });
  }
  const ord = sp.get('order'); if (ord) { const [c, d] = ord.split('.'); out.sort((a, b) => (a[c] < b[c] ? -1 : a[c] > b[c] ? 1 : 0) * (d === 'desc' ? -1 : 1)); }
  const off = +(sp.get('offset') || 0), lim = sp.get('limit') ? +sp.get('limit') : out.length;
  return out.slice(off, off + lim);
}

// Simula pos_tablero_resumen (migración 54) con las mismas reglas que el SQL: rango en hora de RD (UTC-4), grupos por
// día (y hora solo si el rango es un día), estado, vendedor_nombre y created_by_name; artículos por nombre tal cual.
const SIN_RESUMEN = process.env.QA_SIN_RESUMEN === '1';      // probar la forma anterior (respaldo sin la migración 54)
function resumenMock(ventas, devol, metas, b) {
  const tsA = d => new Date(d + 'T00:00:00-04:00').getTime(), sig = d => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); };
  const enRango = (f, a, z) => { const t = new Date(f).getTime(); return t >= tsA(a) && t < tsA(sig(z)); };
  const loc = f => { const x = new Date(new Date(f).getTime() - 4 * 3600000); return { dia: x.toISOString().slice(0, 10), hora: x.getUTCHours() }; };
  const num = x => +x || 0, G = {}, I = {};
  ventas.filter(v => enRango(v.fecha, b.p_d1, b.p_d2)).forEach(v => {
    const l = loc(v.fecha), ok = v.estado === 'completada', hora = b.p_d1 === b.p_d2 ? l.hora : null;
    const k = [l.dia, hora, ok, v.vendedor_nombre, v.created_by_name].join('|');
    const g = G[k] = G[k] || { dia: l.dia, hora: hora, ok: ok, vn: v.vendedor_nombre, cb: v.created_by_name, n: 0, t: 0, ef: 0, tr: 0, ta: 0, ot: 0, cr: 0 };
    g.n++; g.t += num(v.total); g.ef += num(v.pagado_efectivo); g.tr += num(v.pagado_transferencia); g.ta += num(v.pagado_tarjeta); g.ot += num(v.pagado_otro); g.cr += num(v.credito_monto);
    if (ok) (v.pos_venta_items || []).forEach(it => { const i = I[it.nombre] = I[it.nombre] || { nombre: it.nombre, cant: 0, monto: 0 }; i.cant += num(it.cantidad); i.monto += it.importe != null ? num(it.importe) : num(it.precio) * num(it.cantidad); });
  });
  const prev = ventas.filter(v => v.estado === 'completada' && enRango(v.fecha, b.p_p1, b.p_p2));
  const dev = devol.filter(d => d.estado !== 'anulada' && d.fecha >= b.p_d1 && d.fecha <= b.p_d2);
  const comp = ventas.filter(v => v.estado === 'completada').map(v => v.fecha).sort();
  return { grupos: Object.values(G), items: Object.values(I), previo: { n: prev.length, t: prev.reduce((s, v) => s + num(v.total), 0) }, devol: { n: dev.length, t: dev.reduce((s, d) => s + num(d.total), 0) },
    metas: metas.filter(m => m.mes >= b.p_d1.slice(0, 8) + '01' && m.mes <= b.p_d2.slice(0, 8) + '01'), ultima: comp.length ? comp[comp.length - 1] : null };
}

async function abrir(b, w, h, rol, opt) {
  opt = opt || {};
  const movil = w < 500;
  const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: movil, hasTouch: movil });
  const p = await ctx.newPage();
  await p.clock.install({ time: new Date(opt.reloj || '2026-10-16T22:30:00Z') });   // el reloj corre desde el 16-oct 18:30 RD
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const st = { guardado: null, metas: (opt.metas || []).slice(), falla: false };
  const acceso = [{ rol: 'gerente', organizacion_id: ORG, modulos: ['inicio', 'vender', 'reportes'] }, { rol: 'cajero', organizacion_id: ORG, modulos: ['inicio', 'vender', 'caja'] }];
  const db = {
    profiles: [{ id: 'auth-u', usuario_sistema_id: 'us-u', nom: 'USUARIO', login: 'u', rol, activo: true, must_change_password: false }],
    organizaciones: [{ id: ORG, slug: 'studio', nombre: 'STUDIO', tipo: 'tienda', activo: true }],
    pos_config: [{ organizacion_id: ORG }], pos_almacenes: [{ id: 'a1', nombre: 'Edificio Studio', es_principal: true, activo: true }],
    usuarios_sistema: [{ id: 'us-u', nom: 'USUARIO', login: 'u', rol, activo: true, almacen_id: 'a1', organizacion_id: ORG }],
    pos_acceso: acceso, pos_ventas: opt.ventas || VENTAS_A, pos_devoluciones: opt.devol || DEVOL_A
  };
  await p.route(/edbknlkjnlfmkkiizdbe\.supabase\.co/, async route => {
    const r = route.request(), u = new URL(r.url()); const send = (o, s) => route.fulfill({ status: s || 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (u.pathname.startsWith('/auth/v1/user')) return send({ id: 'auth-u', email: 'u@studio.local' });
    if (u.pathname.startsWith('/auth/v1/')) return send({ access_token: 'tok', refresh_token: 'r', expires_in: 3600, user: { id: 'auth-u' } });
    const t = u.pathname.slice(9);
    if (t === 'rpc/pos_metas_guardar') {
      if (opt.sinMetas) return send({ code: 'PGRST202', message: 'Could not find the function public.pos_metas_guardar' }, 404);
      if (rol !== 'admin') return send({ code: 'P0001', message: 'METAS_SOLO_ADMIN', details: 'Solo el administrador define las metas de ventas' }, 400);
      const body = JSON.parse(r.postData() || '{}'); st.guardado = body;
      const mes = String(body.p_mes).slice(0, 8) + '01';
      st.metas = st.metas.filter(x => x.mes !== mes).concat((body.p_metas || []).filter(x => x.monto > 0).map(x => ({ mes, vendedor: String(x.vendedor || '').trim(), monto: x.monto })));
      return send((body.p_metas || []).length);
    }
    if (t === 'rpc/pos_tablero_resumen') {
      if (SIN_RESUMEN || opt.sinMetas) return send({ code: 'PGRST202', message: 'Could not find the function public.pos_tablero_resumen' }, 404);
      const body = JSON.parse(r.postData() || '{}'); st.resumenes = (st.resumenes || 0) + 1;
      if (opt.retrasoTodo) await new Promise(res => setTimeout(res, 1200));
      if (opt.retrasoHoy && body.p_d1 === '2026-10-16' && body.p_d2 === '2026-10-16') await new Promise(res => setTimeout(res, 1500));
      if (st.falla) return send({ code: 'XX000', message: 'falla simulada' }, 500);
      return send(resumenMock(db.pos_ventas, db.pos_devoluciones, st.metas, body));
    }
    if (t === 'rpc/pos_personal') return send([{ empleado_id: 'e1', nombre: 'Ana Pérez', activo: true }, { empleado_id: 'e2', nombre: 'Marta Nueva', activo: true }]);
    if (t.startsWith('rpc/')) return send([]);
    if (t === 'pos_metas_ventas') {
      if (opt.sinMetas) return send({ code: 'PGRST205', message: "Could not find the table 'public.pos_metas_ventas' in the schema cache" }, 404);
      if (opt.retrasoMetasMes && u.searchParams.get('mes') === 'eq.' + opt.retrasoMetasMes) await new Promise(res => setTimeout(res, 1500));
      return send(filtrar(st.metas, u.searchParams));
    }
    if (t === 'pos_ventas' && r.method() === 'GET') st.ventasGets = (st.ventasGets || 0) + 1;
    // Retraso a propósito en la consulta de «Hoy» (para probar que una respuesta tardía no pisa otro rango).
    if (opt.retrasoTodo && t === 'pos_ventas' && r.method() === 'GET') await new Promise(res => setTimeout(res, 1200));
    if (st.falla && t === 'pos_ventas') return send({ code: 'XX000', message: 'falla simulada' }, 500);
    if (opt.retrasoHoy && t === 'pos_ventas' && (u.searchParams.getAll('fecha') || []).some(f => f.startsWith('gte.2026-10-16T00:00:00'))) await new Promise(res => setTimeout(res, 1500));
    if (r.method() !== 'GET') return send([]);
    return send(filtrar(db[t] || [], u.searchParams));
  });
  await p.goto(APP_URL + '#access_token=tok&refresh_token=r&expires_in=3600');
  await p.waitForFunction(() => window.nxPosCfgListo === true && !!window.nxTablero, null, { timeout: 30000 });
  await p.waitForFunction(() => !document.getElementById('nxSplash'), null, { timeout: 15000 });   // bienvenida de la primera carga (2.8 s)
  if (opt.premium) await p.evaluate(() => { if (window.aplicarTema) window.aplicarTema('premium'); else document.body.classList.add('tema-premium'); });
  return { p, errs, st, ctx };
}
const txt = (p, sel) => p.$eval(sel, e => e.innerText.replace(/\s+/g, ' ').trim()).catch(() => '');
async function entrar(p) { await p.evaluate(() => { try { localStorage.removeItem('studio_tablero_rango'); } catch (e) {} window.nxPosTab('tablero'); }); await p.waitForSelector('#nxTbKv-v', { timeout: 15000 }); await p.waitForTimeout(400); }
async function preset(p, k) { await p.click(`.nxTbSegB[data-p="${k}"]`); await p.waitForFunction(() => !/actualizando/.test((document.getElementById('nxTbSub') || {}).textContent || ''), null, { timeout: 10000 }); await p.waitForTimeout(900); }
async function sinDesborde(p) { return p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1 && (document.getElementById('nxTbRoot') || { scrollWidth: 0, clientWidth: 1 }).scrollWidth <= document.getElementById('nxTbRoot').clientWidth + 1); }

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

  // ── 1. Administrador, escritorio: cifras de octubre, comparación, metas, gráfica, pagos, equipo y productos ──
  console.log('\n--- Administrador 1280x900 · Este mes (1–16 oct 2026)');
  let { p, errs, st, ctx } = await abrir(b, 1280, 900, 'admin', { metas: METAS_A });
  ok(await p.$eval('#nxTSide', e => /Tablero de ventas/.test(e.innerText)).catch(() => false), 'el menú tiene «Tablero de ventas»');
  await p.waitForTimeout(1500); st.ventasGets = 0; st.resumenes = 0;   // lo que pidió el Inicio antes no cuenta
  await entrar(p);
  ok(SIN_RESUMEN ? st.ventasGets >= 2 : (st.resumenes === 1 && !st.ventasGets), SIN_RESUMEN ? 'sin la migración 54: carga con la forma anterior (' + st.ventasGets + ' consultas de ventas)' : 'al abrir: 1 sola consulta (resumen de la base) y ninguna factura descargada');
  ok(/1 oct – 16 oct 2026 · comparado con 1 sep – 16 sep 2026/.test(await txt(p, '#nxTbSub')), 'rango y comparación: ' + await txt(p, '#nxTbSub'));
  ok(await txt(p, '#nxTbKv-v') === 'RD$ 780,000.00', 'Ventas = RD$ 780,000.00 (sin la anulada ni la venta de las 23:30 del 30-sep): ' + await txt(p, '#nxTbKv-v'));
  const kv = await txt(p, '.nxTbK[data-k="v"]');
  ok(/\+160\.0 %/.test(kv) && /Devoluciones RD\$ 30,000\.00 · netas RD\$ 750,000\.00/.test(kv), 'comparación +160 % y devoluciones/netas: ' + kv);
  ok(await txt(p, '#nxTbKv-f') === '5' && /\+150\.0 %/.test(await txt(p, '.nxTbK[data-k="f"]')) && /1 anulada \(no cuentan\)/.test(await txt(p, '.nxTbK[data-k="f"]')), 'Facturas 5 (+150 %), 1 anulada aparte');
  ok(await txt(p, '#nxTbKv-t') === 'RD$ 156,000.00' && /\+4\.0 %/.test(await txt(p, '.nxTbK[data-k="t"]')), 'Ticket promedio RD$ 156,000.00 (+4 %)');
  const km = await txt(p, '.nxTbK[data-k="m"]');
  ok(/Meta de octubre/.test(km) && await txt(p, '#nxTbKv-m') === '25.2 %' && /Faltan RD\$ 2,320,000\.00 de RD\$ 3,100,000\.00/.test(km) && /cierra en RD\$ 1,511,250\.00/.test(km), 'meta del mes completa 25.2 %, lo que falta y proyección: ' + km);
  ok(await p.$$eval('#nxTbChart rect.hit', r => r.length) === 16, 'gráfica: 16 días');
  ok(await p.$$eval('#nxTbChart rect.b', r => r.length) === 5 && await p.$$eval('#nxTbChart rect.b.bajo', r => r.length) === 2 && await p.$('#nxTbChart path.meta') !== null, 'barras: 5 días con venta, 2 bajo la meta diaria (100,000; el 1-oct la iguala), línea de meta');
  const pagos = await p.$$eval('.nxTbLegF', fs => fs.map(f => f.innerText.replace(/\s+/g, ' ').trim()));
  ok(pagos.join('|') === 'Efectivo RD$ 200,000.00 25.6 %|Transferencia RD$ 250,000.00 32.1 %|Tarjeta RD$ 50,000.00 6.4 %|Otro RD$ 80,000.00 10.3 %|Crédito y financiamiento RD$ 200,000.00 25.6 %', 'formas de pago cuadran con las ventas: ' + pagos.join(' | '));
  const eq = await p.$$eval('.nxTbG3 .nxTbCard:first-child .nxTbTr:not(.nxTbTh)', rs => rs.map(r => r.innerText.replace(/\s+/g, ' ').trim()));
  ok(eq.length === 4 && /^LG Luis Gómez 2 facturas · meta RD\$ 400,000\.00 RD\$ 380,000\.00 95\.0 %$/.test(eq[0]) && /Super Admin 1 factura RD\$ 250,000\.00 Sin meta/.test(eq[1]) && /Ana Pérez 2 facturas · meta RD\$ 1,000,000\.00 RD\$ 150,000\.00 15\.0 %/.test(eq[2]) && /Pedro Sin Venta 0 facturas · meta RD\$ 500,000\.00 RD\$ 0\.00 0\.0 %/.test(eq[3]), 'equipo (vendedor o quien facturó; «ANA PEREZ» = «Ana Pérez»; con meta sin vender): ' + eq.join(' | '));
  const pr = await p.$$eval('.nxTbG3 .nxTbCard:last-child .nxTbTr:not(.nxTbTh)', rs => rs.map(r => r.innerText.replace(/\s+/g, ' ').trim()));
  ok(pr.join('|') === '1 IPHONE 17 PRO MAX 256GB 3 RD$ 350,000.00|2 TV 55 1 RD$ 300,000.00|3 Bocina 4 RD$ 80,000.00|4 Cargador USB 5 RD$ 50,000.00', 'productos (el del tabulador se suma al mismo): ' + pr.join(' | '));
  ok(await sinDesborde(p), 'sin desborde horizontal');
  await p.screenshot({ path: `${OUT}/tablero-1280.png`, fullPage: true });
  // Rango «7 días»: la meta se reparte (3,100,000 × 7/31 = 700,000); los números corren desde lo que se veía.
  await p.click('.nxTbSegB[data-p="7d"]');
  await p.waitForFunction(() => !/actualizando/.test(document.getElementById('nxTbSub').textContent), null, { timeout: 10000 });
  await p.waitForTimeout(60);
  const enCamino = await txt(p, '#nxTbKv-v');
  await p.waitForTimeout(1100);
  ok(await txt(p, '#nxTbKv-v') === 'RD$ 380,000.00' && enCamino !== 'RD$ 380,000.00', '7 días: RD$ 380,000.00, y el número corre (a mitad: ' + enCamino + ')');
  ok(/Meta del período/.test(await txt(p, '.nxTbK[data-k="m"]')) && await txt(p, '#nxTbKv-m') === '54.3 %' && /de RD\$ 700,000\.00/.test(await txt(p, '.nxTbK[data-k="m"]')), '7 días: meta repartida RD$ 700,000.00 → 54.3 %');
  const th = await p.$eval('#nxTbThumb', e => ({ x: e.style.transform, w: e.style.width }));
  const b7 = await p.$eval('.nxTbSegB[data-p="7d"]', e => ({ x: e.offsetLeft, w: e.offsetWidth }));
  ok(th.x === `translateX(${b7.x}px)` && th.w === b7.w + 'px', 'la pastilla se movió a «7 días»');
  await preset(p, 'hoy');
  ok(await p.$$eval('#nxTbChart rect.hit', r => r.length) === 24 && await txt(p, '#nxTbKv-v') === 'RD$ 80,000.00' && /Sin ventas en el período anterior/.test(await txt(p, '.nxTbK[data-k="v"]')), 'Hoy: por hora (24), RD$ 80,000.00, ayer sin ventas');
  await preset(p, 'mesant');
  ok(await txt(p, '#nxTbKv-v') === 'RD$ 490,000.00' && await txt(p, '#nxTbKv-f') === '4', 'Mes anterior (sep): RD$ 490,000.00 en 4 facturas (incluye la de las 23:30 del 30-sep)');
  await preset(p, 'anio');
  ok(await p.$$eval('#nxTbChart rect.hit', r => r.length) === 10 && await txt(p, '#nxTbKv-v') === 'RD$ 1,270,000.00', 'Este año: por mes (10), RD$ 1,270,000.00');
  const prA = await p.$$eval('.nxTbG3 .nxTbCard:last-child .nxTbTr:not(.nxTbTh)', rs => rs.map(r => r.innerText.replace(/\s+/g, ' ').trim()));
  ok(prA[0] === '1 TV 55 2 RD$ 500,000.00' && prA[1] === '2 Bocina 18 RD$ 370,000.00', 'Este año: dos fichas con el mismo nombre («TV 55» y «TV  55») son un solo producto: ' + prA.join(' | '));
  // Metas: el administrador guarda la de noviembre y la de un vendedor.
  await preset(p, 'mes');
  await p.click('.nxTbAcc .nxTbIcoB[title="Metas de ventas"]'); await p.waitForSelector('#nxTbMeta0', { timeout: 8000 });
  ok(await p.$eval('#nxTbMeta0', e => e.value) === '3,100,000.00', 'el formulario trae la meta guardada del negocio');
  const filasM = await p.$$eval('.nxTbMetaL .nxTbMetaF b', bs => bs.map(x => x.textContent));
  ok(filasM.includes('Marta Nueva') && filasM.includes('Pedro Sin Venta') && filasM.includes('Luis Gómez'), 'vendedores: con ventas recientes, empleados y con meta (' + filasM.join(', ') + ')');
  await p.selectOption('#nxTbMetaMes', '2026-11-01'); await p.waitForSelector('#nxTbMeta0', { timeout: 8000 });
  await p.fill('#nxTbMeta0', '4500000'); await p.click('#nxTbMetaOk'); await p.waitForTimeout(900);
  ok(st.guardado && st.guardado.p_mes === '2026-11-01' && JSON.stringify(st.guardado.p_metas) === JSON.stringify([{ vendedor: '', monto: 4500000 }]) && !(await p.$('#nxTbMetasM')), 'guarda noviembre por la función del servidor: ' + JSON.stringify(st.guardado));
  ok(errs.length === 0, 'sin errores de página' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await ctx.close();

  // ── 2. Teléfono 390 y 430 (Clásico) y Premium Dark; toque en una barra ──
  for (const [w, h, prem] of [[390, 844, false], [430, 932, false], [390, 844, true], [1280, 900, true]]) {
    console.log(`\n--- ${w}x${h}${prem ? ' Premium Dark' : ''}`);
    ({ p, errs, ctx } = await abrir(b, w, h, 'admin', { metas: METAS_A, premium: prem }));
    await entrar(p);
    ok(await sinDesborde(p), 'sin desborde horizontal');
    if (w < 500) {
      // En STUDIO se desplaza el área del módulo, no la ventana: se trae la gráfica a la vista antes de tocar.
      await p.$eval('#nxTbChart', e => e.scrollIntoView({ block: 'center' })); await p.waitForTimeout(250);
      const bar = await p.$('#nxTbChart rect.hit[data-i="9"]'); const bb2 = await bar.boundingBox();
      await p.touchscreen.tap(bb2.x + bb2.width / 2, bb2.y + bb2.height - 10); await p.waitForTimeout(350);
      const tip = await txt(p, '#nxTbTip');
      ok(/sáb 10 oct 2026/.test(tip) && /RD\$ 300,000\.00 · 1 factura/.test(tip) && /Sobre la meta/.test(tip), 'tocar la barra del 10-oct muestra el detalle: ' + tip);
      await p.screenshot({ path: `${OUT}/tablero-${w}${prem ? '-oscuro' : ''}-toque.png` });
      await p.$eval('#nxTbRoot', e => e.scrollIntoView({ block: 'start' })); await p.waitForTimeout(200);
    }
    // Texto oscuro (luminancia baja) sobre tarjeta blanca: legible aunque el tema Premium cambie el tono del texto.
    if (prem) ok(await p.evaluate(() => { const osc = e => { const m = getComputedStyle(document.querySelector(e)).color.match(/\d+/g).map(Number); return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2] < 90; }; return getComputedStyle(document.querySelector('.nxTbK')).backgroundColor === 'rgb(255, 255, 255)' && osc('.nxTbH1') && osc('.nxTbH2') && osc('.nxTbKv') && osc('.nxTbTr:not(.nxTbTh) .m'); }), 'con el tema Premium sigue claro y legible, como Inicio y Reportes');
    await p.screenshot({ path: `${OUT}/tablero-${w}${prem ? '-oscuro' : ''}.png`, fullPage: true });
    ok(errs.length === 0, 'sin errores de página' + (errs.length ? ': ' + errs.join(' | ') : ''));
    await ctx.close();
  }

  // ── 3. Gerente: lo ve (tiene Reportes) pero no define metas. Cajero: no lo ve. ──
  console.log('\n--- Roles');
  ({ p, errs, ctx } = await abrir(b, 1280, 900, 'gerente', { metas: [] }));
  ok(await p.$eval('#nxTSide', e => /Tablero de ventas/.test(e.innerText)).catch(() => false), 'gerente (con Reportes) ve «Tablero de ventas»');
  await entrar(p);
  ok(!(await p.$('.nxTbAcc .nxTbIcoB[title="Metas de ventas"]')) && /El administrador todavía no definió la meta/.test(await txt(p, '.nxTbK[data-k="m"]')), 'gerente: sin botón de metas; «el administrador todavía no definió la meta»');
  ok(errs.length === 0, 'sin errores de página' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await ctx.close();
  ({ p, errs, ctx } = await abrir(b, 1280, 900, 'cajero', {}));
  ok(!(await p.$eval('#nxTSide', e => /Tablero de ventas/.test(e.innerText)).catch(() => true)), 'cajero (sin Reportes) no ve «Tablero de ventas»');
  await p.evaluate(() => window.nxPosTab('tablero')); await p.waitForTimeout(800);
  ok(!(await p.$('#nxTbRoot')), 'cajero no puede abrirlo ni escribiendo la pestaña');
  await ctx.close();

  // ── 4. Sin la migración 53 y con la última venta del 18-sep (como hoy en la base real) ──
  console.log('\n--- Sin migración 53 · octubre vacío');
  ({ p, errs, ctx } = await abrir(b, 390, 844, 'admin', { ventas: VENTAS_B, devol: [], sinMetas: true }));
  await entrar(p);
  const vac = await txt(p, '.nxTbVacio');
  ok(/No hay ventas registradas del 1 oct – 16 oct 2026/.test(vac) && /La última venta registrada en STUDIO es del 18 sep 2026/.test(vac), 'estado vacío explica la última venta: ' + vac);
  ok(/Las metas todavía no están activas en la base de datos/.test(await txt(p, '.nxTbK[data-k="m"]')), 'sin la migración: la meta lo dice, sin romper nada');
  await p.screenshot({ path: `${OUT}/tablero-390-vacio.png`, fullPage: true });
  await p.click('.nxTbVacio .btn'); await p.waitForFunction(() => !/actualizando/.test(document.getElementById('nxTbSub').textContent) && !!document.getElementById('nxTbChart'), null, { timeout: 10000 }); await p.waitForTimeout(700);
  const subB = await txt(p, '#nxTbSub'), venB = await txt(p, '#nxTbKv-v'), fechasB = await p.$eval('#nxTbFechas', e => !e.hidden);
  ok(/20 ago – 18 sep 2026/.test(subB) && venB === 'RD$ 729,100.00' && fechasB, `el botón abre los 30 días hasta el 18-sep con las fechas a la vista (${subB} · ${venB} · fechas ${fechasB})`);
  await p.click('.nxTbAcc .nxTbIcoB[title="Metas de ventas"]'); await p.waitForTimeout(800);
  ok(/todavía no están activas en la base de datos/.test(await txt(p, '#nxTbMetasC')), 'el formulario de metas avisa que faltan en la base');
  ok(await sinDesborde(p), 'sin desborde horizontal');
  ok(errs.length === 0, 'sin errores de página' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await ctx.close();

  // ── 5. Lo que encontró la revisión previa a publicar (17-oct-2026) ──
  console.log('\n--- Hallazgos de la revisión (regresión)');
  ({ p, errs, ctx } = await abrir(b, 1280, 900, 'admin', { metas: [METAS_A[0], METAS_A[2]], retrasoHoy: true, retrasoMetasMes: '2026-10-01' }));
  await entrar(p);
  // a) Carrera: «Hoy» (lento) y enseguida «Este mes» (ya cargado): la respuesta tardía de «Hoy» no debe pisar el mes.
  await p.click('.nxTbSegB[data-p="hoy"]'); await p.waitForTimeout(150); await p.click('.nxTbSegB[data-p="mes"]'); await p.waitForTimeout(2300);
  ok(await txt(p, '#nxTbKv-v') === 'RD$ 780,000.00' && await p.$$eval('#nxTbChart rect.hit', r => r.length) === 16 && /1 oct – 16 oct/.test(await txt(p, '#nxTbSub')), 'carrera: volver a «Este mes» mientras «Hoy» carga deja las cifras del mes (' + await txt(p, '#nxTbKv-v') + ')');
  // b) Rango del 1 al 7 que no es «Este mes»: la meta se reparte (3,100,000 × 7/31 = 700,000), sin proyección.
  await p.click('.nxTbSegB[data-p="fechas"]'); await p.waitForTimeout(300);
  await p.fill('#nxTbDesde', '2026-10-01'); await p.fill('#nxTbHasta', '2026-10-07'); await p.evaluate(() => window.nxTablero.fechas());
  await p.waitForFunction(() => /1 oct – 7 oct/.test(document.getElementById('nxTbSub').textContent) && !/actualizando/.test(document.getElementById('nxTbSub').textContent), null, { timeout: 8000 }); await p.waitForTimeout(800);
  const km7 = await txt(p, '.nxTbK[data-k="m"]');
  ok(/Meta del período/.test(km7) && await txt(p, '#nxTbKv-m') === '57.1 %' && /de RD\$ 700,000\.00/.test(km7) && !/cierra en/.test(km7), 'del 1 al 7: meta repartida 700,000 (57.1 %), sin «meta de octubre» ni proyección: ' + km7);
  // c) Varios meses con meta solo en octubre: el avance cuenta solo octubre (780,000 de 1,600,000 = 48.8 %).
  await preset(p, 'anio');
  const kmA = await txt(p, '.nxTbK[data-k="m"]');
  ok(await txt(p, '#nxTbKv-m') === '48.8 %' && /de RD\$ 1,600,000\.00/.test(kmA) && /Solo cuentan los meses con meta \(oct\): vendido RD\$ 780,000\.00/.test(kmA), 'Este año con meta solo en octubre: 48.8 % y lo explica: ' + kmA);
  const eqA = await p.$$eval('.nxTbG3 .nxTbCard:first-child .nxTbTr:not(.nxTbTh)', rs => rs.map(r => r.innerText.replace(/\s+/g, ' ').trim()));
  ok(/Luis Gómez .* 184\.1 %/.test(eqA[0] || ''), 'equipo: el % de Luis cuenta solo octubre contra su meta repartida (184.1 %): ' + (eqA[0] || ''));
  // d) Eje: miles y millones con decimales (sin marcas repetidas).
  ok(await p.evaluate(() => [1500, 2500, 7500, 1250000, 80000].map(window.nxTablero._fmtEje).join(' ')) === '1.5K 2.5K 7.5K 1.25M 80K', 'eje: 1.5K 2.5K 7.5K 1.25M 80K');
  // e) Formulario de metas: el foco entra al diálogo, Escape lo cierra y el foco vuelve al botón «Metas».
  await preset(p, 'mes');
  await p.click('.nxTbAcc .nxTbIcoB[title="Metas de ventas"]'); await p.waitForSelector('#nxTbMeta0', { timeout: 8000 }); await p.waitForTimeout(200);
  ok(await p.evaluate(() => document.activeElement && document.activeElement.id === 'nxTbMeta0'), 'el foco entra al primer campo del formulario');
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  ok(!(await p.$('#nxTbMetasM')) && await p.evaluate(() => document.activeElement && document.activeElement.getAttribute('title') === 'Metas de ventas'), 'Escape cierra y el foco vuelve a «Metas»');
  // f) Carrera del formulario: octubre (lento) se abre y se cierra; se abre septiembre: no deben aparecer montos de octubre.
  await p.click('.nxTbAcc .nxTbIcoB[title="Metas de ventas"]'); await p.waitForTimeout(150); await p.evaluate(() => window.nxTablero.metasCerrar());
  await preset(p, 'mesant');
  await p.click('.nxTbAcc .nxTbIcoB[title="Metas de ventas"]'); await p.waitForSelector('#nxTbMeta0', { timeout: 8000 }); await p.waitForTimeout(2000);
  ok(await p.$eval('#nxTbMetaMes', e => e.value) === '2026-09-01' && await p.$eval('#nxTbMeta0', e => e.value) === '', 'reabrir en septiembre no trae los montos de octubre que llegaron tarde');
  await p.evaluate(() => window.nxTablero.metasCerrar());
  // g) Medianoche: con «Hoy» abierto, al pasar al 17-oct el tablero se recarga y describe el día nuevo.
  await preset(p, 'hoy');
  await p.clock.setSystemTime(new Date('2026-10-17T04:10:00Z'));
  await p.evaluate(() => window.nxPosCtx.renderPOS()); await p.waitForTimeout(2500);
  ok(/^17 oct 2026 · comparado con 16 oct 2026/.test(await txt(p, '#nxTbSub')) && await txt(p, '#nxTbKv-v') === 'RD$ 0.00', 'medianoche: «Hoy» pasa solo al 17-oct (' + await txt(p, '#nxTbSub') + ' · ' + await txt(p, '#nxTbKv-v') + ')');
  ok(errs.length === 0, 'sin errores de página' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await ctx.close();
  // h) Sin metas en «Este año»: el botón nombra el mes que abre el formulario; y un monto de 8 cifras cabe a 1280 px.
  ({ p, errs, ctx } = await abrir(b, 1280, 900, 'admin', { metas: [], ventas: VENTAS_A.concat([V('big', '2026-10-15T15:00:00Z', 28703075, { credito_monto: 28703075 }, 'Ana Pérez', 'Caja', [it('p1', 'IPHONE 17 PRO MAX 256GB', 1, 28703075)])]) }));
  await entrar(p);
  ok(await p.$eval('#nxTbKv-v', e => e.scrollWidth <= e.clientWidth + 1) && await txt(p, '#nxTbKv-v') === 'RD$ 29,483,075.00', 'un monto de 8 cifras (RD$ 29,483,075.00) se ve completo a 1280 px');
  await preset(p, 'anio');
  const link = await txt(p, '.nxTbK[data-k="m"] .nxTbLink');
  await p.click('.nxTbK[data-k="m"] .nxTbLink'); await p.waitForSelector('#nxTbMetaMes', { timeout: 8000 });
  ok(link === 'Definir la meta de octubre' && await p.$eval('#nxTbMetaMes', e => e.value) === '2026-10-01', 'el botón dice «' + link + '» y abre ese mes');
  ok(errs.length === 0, 'sin errores de página' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await ctx.close();

  // ── 6. Lo que encontró la segunda revisión (17-oct-2026) ──
  console.log('\n--- Segunda revisión (regresión)');
  const vMut = VENTAS_A.slice();
  ({ p, errs, ctx } = await abrir(b, 1280, 900, 'admin', { metas: [METAS_A[0]], ventas: vMut, retrasoTodo: true }));
  await entrar(p); await p.waitForFunction(() => !/actualizando/.test(document.getElementById('nxTbSub').textContent), null, { timeout: 10000 }); await p.waitForTimeout(700);
  // a) «Actualizar» y tocar la pastilla activa mientras recarga: la recarga sigue y trae lo nuevo.
  vMut.push(V('nueva', '2026-10-16T21:00:00Z', 20000, { pagado_efectivo: 20000 }, 'Ana Pérez', 'Caja', [it('p3', 'Bocina', 1, 20000)]));
  await p.click('.nxTbAcc .nxTbIcoB[title="Actualizar"]'); await p.waitForTimeout(150); await p.click('.nxTbSegB[data-p="mes"]');
  await p.waitForFunction(() => !/actualizando/.test(document.getElementById('nxTbSub').textContent), null, { timeout: 10000 }); await p.waitForTimeout(900);
  ok(await txt(p, '#nxTbKv-v') === 'RD$ 800,000.00', '«Actualizar» + tocar la pastilla activa: trae la venta nueva (' + await txt(p, '#nxTbKv-v') + ')');
  // b) Escape en la lupa del selector de mes cierra solo la lista, no el diálogo.
  await p.click('.nxTbAcc .nxTbIcoB[title="Metas de ventas"]'); await p.waitForSelector('#nxTbMetaMes', { timeout: 8000 }); await p.waitForTimeout(300);
  await p.click('#nxTbMetaMes'); await p.waitForTimeout(300);
  const hayPanel = !!(await p.$('.nxSbPanel'));
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  ok(hayPanel && !(await p.$('.nxSbPanel')) && !!(await p.$('#nxTbMetasM')), 'Escape en la lupa de meses cierra la lista y el diálogo sigue abierto (lupa ' + hayPanel + ')');
  await p.evaluate(() => window.nxTablero.metasCerrar());
  // c) «Definir la meta de septiembre» tocado mientras carga otro rango abre septiembre.
  await ctx.close();
  ({ p, errs, ctx } = await abrir(b, 1280, 900, 'admin', { metas: [], retrasoTodo: true }));
  await entrar(p); await p.waitForFunction(() => !/actualizando/.test(document.getElementById('nxTbSub').textContent), null, { timeout: 10000 });
  await preset(p, 'mesant');
  await p.click('.nxTbSegB[data-p="7d"]'); await p.waitForTimeout(100);   // un período que no está en el caché
  const lk = await txt(p, '.nxTbK[data-k="m"] .nxTbLink'); await p.click('.nxTbK[data-k="m"] .nxTbLink'); await p.waitForSelector('#nxTbMetaMes', { timeout: 8000 });
  ok(lk === 'Definir la meta de septiembre' && await p.$eval('#nxTbMetaMes', e => e.value) === '2026-09-01', 'el botón «' + lk + '» abre septiembre aunque esté cargando otro rango');
  await p.evaluate(() => window.nxTablero.metasCerrar());
  ok(errs.length === 0, 'sin errores de página' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await ctx.close();
  // d) Medianoche sin tocar nada: el tablero se recarga solo y la fecha máxima pasa a hoy (reloj a las 23:59 RD).
  ({ p, errs, ctx } = await abrir(b, 1280, 900, 'admin', { metas: [], reloj: '2026-10-17T03:58:30Z' }));
  await entrar(p); await preset(p, 'hoy');
  await p.clock.fastForward('01:30'); await p.waitForTimeout(2500);
  ok(/^17 oct 2026 · comparado con 16 oct 2026/.test(await txt(p, '#nxTbSub')) && await p.$eval('#nxTbHasta', e => e.max) === '2026-10-17', 'medianoche sin tocar nada: «Hoy» pasa solo al 17-oct y el máximo de las fechas es el 17 (' + await txt(p, '#nxTbSub') + ')');
  ok(errs.length === 0, 'sin errores de página' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await ctx.close();
  if (!SIN_RESUMEN) {
    console.log('\n--- Caché de períodos');
    let st2;
    ({ p, errs, ctx, st: st2 } = await abrir(b, 1280, 900, 'admin', { metas: [METAS_A[0]], retrasoTodo: true }));
    await entrar(p); await p.waitForFunction(() => !/actualizando/.test(document.getElementById('nxTbSub').textContent), null, { timeout: 10000 }); await p.waitForTimeout(500);
    await preset(p, 'mesant'); const vSep = await txt(p, '#nxTbKv-v');
    await preset(p, '7d');
    // a) Volver a un período cerrado ya visto: sale al instante y no se vuelve a pedir.
    const r0 = st2.resumenes; await p.click('.nxTbSegB[data-p="mesant"]'); await p.waitForTimeout(150);
    const subA = await txt(p, '#nxTbSub'); await p.waitForTimeout(800); const vA = await txt(p, '#nxTbKv-v'); await p.waitForTimeout(800);
    ok(st2.resumenes === r0 && !/actualizando/.test(subA) && /septiembre|sep/i.test(subA) && vA === vSep, 'volver a «Mes anterior»: sale al instante del caché y no consulta (' + vA + ')');
    // b) Volver a «Este mes» (incluye hoy): sale al instante y además se actualiza por detrás.
    await preset(p, 'mes'); await preset(p, '7d');
    const r1 = st2.resumenes; await p.click('.nxTbSegB[data-p="mes"]'); await p.waitForTimeout(150);
    const subB = await txt(p, '#nxTbSub'), vB = await txt(p, '#nxTbKv-v');
    await p.waitForFunction(() => !/actualizando/.test(document.getElementById('nxTbSub').textContent), null, { timeout: 10000 }); await p.waitForTimeout(300);
    ok(/actualizando/.test(subB) && /RD\$ [1-9]/.test(vB) && st2.resumenes === r1 + 1, '«Este mes» desde el caché: cifras al instante y actualiza por detrás (' + vB + ')');
    // c) «Actualizar» siempre consulta, aunque el período esté en el caché.
    await preset(p, 'mesant'); const r2 = st2.resumenes;
    await p.click('.nxTbAcc .nxTbIcoB[title="Actualizar"]'); await p.waitForFunction(() => !/actualizando/.test(document.getElementById('nxTbSub').textContent), null, { timeout: 10000 });
    ok(st2.resumenes === r2 + 1, '«Actualizar» trae datos frescos aunque el período esté guardado');
    ok(errs.length === 0, 'sin errores de página' + (errs.length ? ': ' + errs.join(' | ') : ''));
    await ctx.close();
  }

  console.log('\n--- Tercera revisión (regresión)');
  // f) Tab desde la lupa del mes no saca el foco del diálogo; después Escape lo cierra.
  ({ p, errs, ctx } = await abrir(b, 1280, 900, 'admin', { metas: [METAS_A[0]] }));
  await entrar(p);
  await p.click('.nxTbAcc .nxTbIcoB[title="Metas de ventas"]'); await p.waitForSelector('#nxTbMetaMes', { timeout: 8000 }); await p.waitForTimeout(300);
  await p.click('#nxTbMetaMes'); await p.waitForTimeout(300);
  const lupa = !!(await p.$('.nxSbPanel'));
  const dentro = [];
  for (let i = 0; i < 4; i++) { await p.keyboard.press('Tab'); await p.waitForTimeout(120); dentro.push(await p.evaluate(() => { const m = document.getElementById('nxTbMetasM'); return !!(m && m.contains(document.activeElement)); })); }
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  ok(lupa && dentro.every(Boolean) && !(await p.$('#nxTbMetasM')), 'Tab desde la lupa del mes se queda en el diálogo (' + dentro.join(',') + ') y Escape lo cierra');
  ok(errs.length === 0, 'sin errores de página' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await ctx.close();
  // g) Medianoche en «Fechas» (no recarga): la fecha máxima pasa al día nuevo y el aviso queda armado para la siguiente.
  ({ p, errs, ctx } = await abrir(b, 1280, 900, 'admin', { metas: [], reloj: '2026-10-31T03:58:30Z' }));
  await entrar(p); await p.click('.nxTbSegB[data-p="fechas"]'); await p.waitForTimeout(900);
  const max30 = await p.$eval('#nxTbHasta', e => e.max);
  await p.clock.fastForward('01:30'); await p.waitForTimeout(1500);
  const max31 = await p.$eval('#nxTbHasta', e => e.max);
  await p.clock.fastForward('24:00:00'); await p.waitForTimeout(1500);
  const max01 = await p.$eval('#nxTbHasta', e => e.max);
  ok(max30 === '2026-10-30' && max31 === '2026-10-31' && max01 === '2026-11-01', 'medianoche en «Fechas»: el máximo pasa 30 → 31 oct → 1 nov sin tocar nada (' + [max30, max31, max01].join(' → ') + ')');
  ok(errs.length === 0, 'sin errores de página' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await ctx.close();
  // h) 30-oct: «Actualizar» en «Este mes» y tocar «Fechas» (mismas fechas) mientras recarga: se adopta «Fechas».
  ({ p, errs, ctx } = await abrir(b, 1280, 900, 'admin', { metas: [METAS_A[0]], reloj: '2026-10-30T16:00:00Z', retrasoTodo: true }));
  await entrar(p); await p.waitForFunction(() => !/actualizando/.test(document.getElementById('nxTbSub').textContent), null, { timeout: 10000 }); await p.waitForTimeout(700);
  await p.click('.nxTbAcc .nxTbIcoB[title="Actualizar"]'); await p.waitForTimeout(150); await p.click('.nxTbSegB[data-p="fechas"]');
  await p.waitForFunction(() => !/actualizando/.test(document.getElementById('nxTbSub').textContent), null, { timeout: 10000 }); await p.waitForTimeout(900);
  const mH = await txt(p, '.nxTbK[data-k="m"]');
  ok(/Meta del período/.test(mH) && !/cierra en/.test(mH), '«Actualizar» + «Fechas» con las mismas fechas: la meta se calcula como «Fechas» (' + mH.slice(0, 60) + ')');
  ok(errs.length === 0, 'sin errores de página' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await ctx.close();
  // i) Falla la carga de otro mes: «Metas» abre el mes que dice la cabecera, no el último que se pintó.

  ({ p, errs, ctx, st } = await abrir(b, 1280, 900, 'admin', { metas: [] }));
  await entrar(p);
  st.falla = true; await p.click('.nxTbSegB[data-p="mesant"]'); await p.waitForTimeout(1500);
  const hayErr = /Reintentar/.test(await txt(p, '#nxTbRoot'));
  await p.click('.nxTbAcc .nxTbIcoB[title="Metas de ventas"]'); await p.waitForSelector('#nxTbMetaMes', { timeout: 8000 }); await p.waitForTimeout(300);
  ok(hayErr && await p.$eval('#nxTbMetaMes', e => e.value) === '2026-09-01', 'con error en «Mes anterior», «Metas» abre septiembre (error ' + hayErr + ')');
  await p.evaluate(() => window.nxTablero.metasCerrar()); st.falla = false;
  await ctx.close();
  console.log('\n--- Verificación final (regresión)');
  // j) Con el diálogo de metas abierto y un monto escrito, Ctrl+K y Escape cierran la búsqueda, no el diálogo.
  ({ p, errs, ctx } = await abrir(b, 1280, 900, 'admin', { metas: [] }));
  await entrar(p);
  await p.click('.nxTbAcc .nxTbIcoB[title="Metas de ventas"]'); await p.waitForSelector('#nxTbMeta0', { timeout: 8000 }); await p.waitForTimeout(300);
  await p.click('#nxTbMeta0'); await p.keyboard.type('5000000'); await p.waitForTimeout(150);
  await p.keyboard.press('Control+k'); await p.waitForTimeout(500);
  const gsAbierta = await p.evaluate(() => { const g = document.getElementById('gsOverlay'); return !!(g && g.classList.contains('show')); });
  await p.keyboard.press('Escape'); await p.waitForTimeout(400);
  const v0 = await p.$eval('#nxTbMeta0', e => e.value).catch(() => '');
  ok(gsAbierta && !!(await p.$('#nxTbMetasM')) && /5,?000,?000/.test(v0), 'Ctrl+K y Escape no cierran el diálogo de metas ni borran el monto (' + v0 + ', búsqueda ' + gsAbierta + ')');
  await p.evaluate(() => { try { window.nxBuscUnivCerrar && window.nxBuscUnivCerrar(); } catch (e) {} window.nxTablero.metasCerrar(); });
  ok(errs.length === 0, 'sin errores de página' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await ctx.close();
  // k) Error en «Mes anterior» y «Reintentar» lento: mientras recarga, «Metas» abre septiembre (el mes de la cabecera).
  ({ p, errs, ctx, st } = await abrir(b, 1280, 900, 'admin', { metas: [], retrasoTodo: true }));
  await entrar(p); await p.waitForFunction(() => !/actualizando/.test(document.getElementById('nxTbSub').textContent), null, { timeout: 10000 });
  st.falla = true; await p.click('.nxTbSegB[data-p="mesant"]'); await p.waitForFunction(() => /Reintentar/.test(document.getElementById('nxTbRoot').innerText), null, { timeout: 10000 });
  st.falla = false; await p.click('#nxTbRoot .btn.bc1'); await p.waitForTimeout(150);
  await p.click('.nxTbAcc .nxTbIcoB[title="Metas de ventas"]'); await p.waitForSelector('#nxTbMetaMes', { timeout: 8000 });
  ok(await p.$eval('#nxTbMetaMes', e => e.value) === '2026-09-01', '«Reintentar» en curso tras un error: «Metas» abre septiembre (' + await p.$eval('#nxTbMetaMes', e => e.value) + ')');
  await p.evaluate(() => window.nxTablero.metasCerrar());
  ok(errs.length === 0, 'sin errores de página' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await ctx.close();
  // e) 30-oct: «Este mes» y «Fechas» (1 al 30) piden las mismas fechas, pero la meta se calcula distinto.
  ({ p, errs, ctx } = await abrir(b, 1280, 900, 'admin', { metas: [METAS_A[0]], reloj: '2026-10-30T16:00:00Z' }));
  await entrar(p);
  const mMes30 = await txt(p, '.nxTbK[data-k="m"]');
  await p.click('.nxTbSegB[data-p="fechas"]'); await p.waitForTimeout(900);
  const mFech30 = await txt(p, '.nxTbK[data-k="m"]');
  ok(/Meta de octubre/.test(mMes30) && /cierra en/.test(mMes30) && /Meta del período/.test(mFech30) && /de RD\$ 3,000,000\.00/.test(mFech30) && !/cierra en/.test(mFech30), '30-oct: «Este mes» = meta de octubre con proyección; «Fechas» 1–30 = meta repartida 3,000,000 sin proyección');
  ok(errs.length === 0, 'sin errores de página' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await ctx.close();

  await b.close();
  console.log(`\n${fallos ? 'FALLAS: ' + fallos : 'TODO OK'}`); process.exitCode = fallos ? 1 : 0;
})();
