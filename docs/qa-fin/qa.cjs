// QA de las correcciones de la auditoría de Financiamiento (04-oct-2026): la app real (index.html + parches) contra una
// base Supabase SIMULADA (Playwright intercepta edbknlkjnlfmkkiizdbe.supabase.co; nunca toca la base real).
// Uso: desde la raíz del repo, python3 -m http.server 8790 & ; node docs/qa-fin/qa.cjs
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const APP_URL = process.env.QA_URL || 'http://localhost:8790/index.html';
let fallos = 0; const ok = (c, m) => { console.log((c ? 'OK    ' : 'FALLA ') + m); if (!c) fallos++; };
const hoy = new Date().toISOString().slice(0, 10);
const enDias = d => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);

function base(rol) {
  const us = rol === 'admin' ? 'us-admin' : 'us-caj';
  // 1200 cuotas de relleno: la carga tiene que paginar (antes tenía tope 2000 y la API real entrega 1000 por consulta).
  const relleno = Array.from({ length: 1200 }, (_, i) => ({ id: 'r' + i, financiamiento_id: 'fin-viejo', numero: i + 1, fecha_venc: '2026-01-01', monto: 1, monto_pagado: 1, pagado: true, capital: 1, interes: 0 }));
  return {
    profiles: [{ id: 'auth-1', usuario_sistema_id: us, nom: rol === 'admin' ? 'ESTERLIN' : 'MARIA CAJERA', login: rol, rol, activo: true, must_change_password: false }],
    organizaciones: [{ id: 'org1', slug: 'studio', nombre: 'STUDIO', tipo: 'tienda', activo: true }],
    pos_config: [{ organizacion_id: 'org1', prefijo_contado: 'CO', prefijo_credito: 'CR', mora_pct: 0, mora_dias_gracia: 0, financiamiento_v2: true }],
    usuarios_sistema: [{ id: us, nom: 'X', login: rol, rol, activo: true, organizacion_id: 'org1' }],
    pos_acceso: [],
    pos_almacenes: [{ id: 'a1', nombre: 'Principal', es_principal: true, activo: true }],
    pos_cajas: [{ id: 'caja1', estado: 'abierta', usuario_id: 'auth-1', apertura: new Date().toISOString(), monto_inicial: 0 }],
    pos_cuentas_bancarias: [{ id: 'cta1', alias: 'Banreservas', banco_nombre: 'Banreservas', activa: true }],
    pos_clientes: [{ id: 'cli1', nombre: 'JUAN PRUEBA', telefono: '8095550000', activo: true }],
    pos_ventas: [
      { id: 'v-fiado', cliente_id: 'cli1', credito_monto: 5000, a_credito: true, estado: 'completada', numero: 1, numero_factura: 'CR-1', total: 5000, created_at: '2026-09-01T12:00:00Z', fecha: '2026-09-01T12:00:00Z' },
      { id: 'v-fin', cliente_id: 'cli1', credito_monto: 12000, a_credito: true, estado: 'completada', numero: 2, numero_factura: 'CR-2', total: 12000, created_at: '2026-09-02T12:00:00Z', fecha: '2026-09-02T12:00:00Z' },
      { id: 'v-anul', cliente_id: 'cli1', credito_monto: 3000, a_credito: true, estado: 'anulada', numero: 3, numero_factura: 'CR-3', total: 3000, created_at: '2026-09-03T12:00:00Z', fecha: '2026-09-03T12:00:00Z' }],
    pos_abonos: [{ id: 'ab1', cliente_id: 'cli1', monto: 500, fecha: '2026-09-10', metodo: 'Efectivo', numero: 'REC-00001' }],
    pos_fin_planes: [{ id: 'pl1', nombre: 'Plazo fijo', metodo: 'plano', frecuencia: 'mensual', num_cuotas: 2, tasa1: 0, mora_tipo: 'fija', mora_valor: 0, mora_dias_gracia: 0, activo: true }],
    pos_financiamientos: [{ id: 'fin1', codigo: 'FIN-1', venta_id: 'v-fin', cliente_id: 'cli1', cliente_nombre: 'JUAN PRUEBA', descripcion: 'iPhone', monto_total: 12000, inicial: 0, monto_financiado: 12000, interes_total: 0, cuotas_total: 2, cuota_monto: 6000, frecuencia: 'mensual', estado: 'activo', plan_id: 'pl1', created_at: '2026-09-02T12:00:00Z', primera_fecha: enDias(10) }],
    pos_fin_cuotas: [{ id: 'c1', financiamiento_id: 'fin1', numero: 1, fecha_venc: enDias(10), monto: 6000, monto_pagado: 0, pagado: false, capital: 6000, interes: 0 },
      { id: 'c2', financiamiento_id: 'fin1', numero: 2, fecha_venc: enDias(40), monto: 6000, monto_pagado: 0, pagado: false, capital: 6000, interes: 0 }].concat(relleno),
    pos_fin_pagos: [{ id: 'p0', financiamiento_id: 'fin1', cuota_id: 'c1', monto: 300, tipo: 'pago', fecha: '2026-09-20', created_at: '2026-09-20T12:00:00Z' },
      { id: 'p0r', financiamiento_id: 'fin1', cuota_id: 'c1', monto: 300, tipo: 'reversa', reversa_de_id: 'p0', motivo_reversa: 'error', fecha: '2026-09-21', created_at: '2026-09-21T12:00:00Z' }]
  };
}

async function abrir(b, w, h, db, opt = {}) {
  const movil = w < 500;
  const p = await b.newPage({ viewport: { width: w, height: h }, hasTouch: movil, isMobile: movil });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  const llamadas = []; const ctl = { falla: {}, demora: {} };
  await p.route(/edbknlkjnlfmkkiizdbe\.supabase\.co/, async (route) => {
    const r = route.request(), u = new URL(r.url()), m = r.method();
    const send = (o, st = 200) => route.fulfill({ status: st, contentType: 'application/json', body: JSON.stringify(o) });
    if (u.pathname.startsWith('/auth/v1/user')) return send({ id: 'auth-1', email: 'x@nexus-pro.local' });
    if (u.pathname.startsWith('/auth/v1/')) return send({ access_token: 'tok', refresh_token: 'r', expires_in: 3600, user: { id: 'auth-1' } });
    if (u.pathname.startsWith('/rest/v1/')) {
      const t = u.pathname.slice(9);
      llamadas.push([m, t, u.search, m === 'GET' ? null : r.postDataJSON()]);
      if (opt.configFalla && t === 'pos_config') return send({ message: 'timeout' }, 503);
      if (t.startsWith('rpc/')) {
        const fn = t.slice(4);
        if (ctl.demora[fn]) await new Promise(s => setTimeout(s, ctl.demora[fn]));
        if (ctl.falla[fn] > 0) { ctl.falla[fn]--; return send({ message: 'Failed to fetch (simulado)' }, 503); }
        if (fn === 'pos_fiado_registrar_abono') return send({ ok: true, id: 'ab-nuevo', numero: 'REC-00582', saldo: 3500 });
        if (fn === 'pos_fiado_eliminar_abono') return send({ ok: true });
        if (fn === 'pos_fin_registrar_pago_v2') return send('pago-nuevo');
        return send(null);
      }
      if (m === 'GET' || m === 'HEAD') {
        let filas = t === 'pos_ventas_fiado'
          ? db.pos_ventas.filter(v => v.credito_monto > 0 && v.estado !== 'anulada' && !db.pos_financiamientos.some(f => f.venta_id === v.id && f.estado !== 'cancelado'))
          : (db[t] || []);
        for (const [k, v] of u.searchParams) { if (/^(select|order|limit|offset|on_conflict)$/.test(k)) continue; const mm = /^eq\.(.*)$/.exec(v); if (mm) filas = filas.filter(x => String(x[k]) === decodeURIComponent(mm[1])); }
        const off = Number(u.searchParams.get('offset') || 0), lim = Math.min(1000, Number(u.searchParams.get('limit') || 1000));
        return send(filas.slice(off, off + lim));
      }
      if (m === 'PATCH') return send([]);
      if (m === 'POST') { const body = r.postDataJSON(); return send(Array.isArray(body) ? body : [body]); }
      return send([]);
    }
    return route.fulfill({ status: 204, body: '' });
  });
  await p.goto(APP_URL + '#access_token=tok&refresh_token=r&expires_in=3600');
  await p.waitForFunction(() => typeof window.nxPosTab === 'function' && window.nxPosCfgListo === true, null, { timeout: 30000 });
  await p.waitForTimeout(400);
  return { p, errs, llamadas, ctl };
}
const rpcs = (ll, fn) => ll.filter(x => x[1] === 'rpc/' + fn);

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  for (const [w, h] of [[1280, 860], [390, 844]]) {
    console.log(`\n--- ${w}x${h} · admin`);
    let { p, errs, llamadas, ctl } = await abrir(b, w, h, base('admin'));
    ok(llamadas.filter(x => x[1] === 'pos_fin_cuotas' && /offset=1000/.test(x[2])).length >= 1, 'las cuotas se cargan paginadas (pasa de 1000)');
    await p.evaluate(() => window.nxPosTab('clientes')); await p.waitForTimeout(500);
    if (!llamadas.some(x => x[1] === 'pos_ventas_fiado')) console.log('   ventas pedidas:', llamadas.filter(x => /pos_ventas/.test(x[1])).map(x => x[1] + x[2]).join(' · '));
    ok(llamadas.some(x => x[1] === 'pos_ventas_fiado') && !llamadas.some(x => x[1] === 'pos_ventas' && /credito_monto=gt/.test(x[2])), 'el fiado se lee de pos_ventas_fiado (sin ventas financiadas)');
    await p.evaluate(() => window.nxPosCliVer('cli1')); await p.waitForTimeout(700);
    const txt = await p.evaluate(() => (document.getElementById('nxPosCli') || {}).innerText || '');
    ok(/VENTAS FIADAS \(1\)/.test(txt), 'la ficha muestra 1 venta fiada (no la financiada ni la anulada)');
    ok(/5,000/.test(txt) && /4,500/.test(txt) && !/17,000|20,000|19,500/.test(txt), 'fiado 5,000 − abonos 500 = saldo 4,500 (la venta financiada no se suma al fiado)');
    ok(await p.$('#posAbFecha') !== null, 'admin ve la fecha del abono');
    ok(await p.$('[onclick^="window.nxPosDelAbono"]') !== null, 'admin ve el botón de eliminar abono');
    // Abono: primero falla la red, luego se reintenta → misma clave de operación
    ctl.falla.pos_fiado_registrar_abono = 1;
    await p.fill('#posAbMonto', '1000'); await p.selectOption('#posAbMet', 'Transferencia');
    await p.click('[aria-label="Registrar un abono"]'); await p.waitForTimeout(600);
    await p.click('[aria-label="Registrar un abono"]'); await p.waitForTimeout(800);
    const ab = rpcs(llamadas, 'pos_fiado_registrar_abono');
    ok(ab.length === 2 && ab[0][3].p_operacion_id && ab[0][3].p_operacion_id === ab[1][3].p_operacion_id, 'reintento del abono usa la MISMA clave (no cobra dos veces)');
    ok(ab.length && ab[1][3].p_monto === 1000 && ab[1][3].p_metodo === 'Transferencia' && ab[1][3].p_fecha === null, 'abono enviado al servidor: monto, método, fecha de hoy');
    ok(!llamadas.some(x => x[0] === 'POST' && (x[1] === 'pos_abonos' || x[1] === 'pos_asientos')), 'el navegador ya no escribe abonos ni asientos');
    await p.evaluate(() => window.nxPosCliVer('cli1')); await p.waitForTimeout(600);
    await p.click('[onclick^="window.nxPosDelAbono"]'); await p.waitForTimeout(600);
    ok(rpcs(llamadas, 'pos_fiado_eliminar_abono').length === 1 && !llamadas.some(x => x[0] === 'DELETE'), 'eliminar abono por el servidor (sin DELETE desde el navegador)');
    // Cobro de cuota: doble toque mientras el servidor tarda → una sola llamada
    await p.evaluate(() => window.nxPosTab('cuotas')); await p.waitForTimeout(500);
    ctl.demora.pos_fin_registrar_pago_v2 = 900;
    await p.evaluate(() => window.nxFinV2Cobrar('fin1', 'c1')); await p.waitForTimeout(500);
    await p.evaluate(() => window.nxFinV2Met('transferencia')); await p.waitForTimeout(150);
    await p.evaluate(() => { window.nxFinV2CobrarGo(); window.nxFinV2CobrarGo(); }); await p.waitForTimeout(1600);
    ok(rpcs(llamadas, 'pos_fin_registrar_pago_v2').length === 1, 'doble toque al cobrar cuota = un solo cobro');
    // Falla de red y reintento → misma clave
    ctl.demora.pos_fin_registrar_pago_v2 = 0; ctl.falla.pos_fin_registrar_pago_v2 = 1;
    await p.evaluate(() => { const m = document.getElementById('nxFinM'); if (m) m.remove(); window.nxFinV2Cobrar('fin1', 'c2'); }); await p.waitForTimeout(500);
    await p.evaluate(() => window.nxFinV2Met('transferencia')); await p.waitForTimeout(150);
    await p.evaluate(() => window.nxFinV2CobrarGo()); await p.waitForTimeout(700);
    await p.evaluate(() => window.nxFinV2CobrarGo()); await p.waitForTimeout(900);
    const pg = rpcs(llamadas, 'pos_fin_registrar_pago_v2').slice(1);
    ok(pg.length === 2 && pg[0][3].p_operacion_id === pg[1][3].p_operacion_id, 'reintento del cobro de cuota usa la MISMA clave');
    ok(errs.length === 0, 'sin errores de JavaScript' + (errs.length ? ': ' + errs.join(' | ') : ''));
    await p.close();

    console.log(`--- ${w}x${h} · cajero`);
    ({ p, errs, llamadas } = await abrir(b, w, h, base('cajero')));
    await p.evaluate(() => window.nxPosCliVer('cli1')); await p.waitForTimeout(700);
    ok(await p.$('#posAbFecha') === null, 'cajero no puede cambiar la fecha del abono');
    ok(await p.$('[onclick^="window.nxPosDelAbono"]') === null, 'cajero no ve eliminar abono');
    ok(errs.length === 0, 'sin errores de JavaScript' + (errs.length ? ': ' + errs.join(' | ') : ''));
    await p.close();
  }
  console.log('\n--- configuración que no carga');
  const { p, errs } = await abrir(b, 1280, 860, base('admin'), { configFalla: true });
  const nav = await p.evaluate(() => document.body.innerText);
  ok(/Financiamiento/.test(nav), 'sin pos_config el módulo sigue en v2 (no cae al viejo que escribe tablas)');
  ok(errs.length === 0, 'sin errores de JavaScript' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close();
  console.log(fallos ? `\n${fallos} FALLA(S)` : '\nTODO OK');
  process.exit(fallos ? 1 : 0);
})();
