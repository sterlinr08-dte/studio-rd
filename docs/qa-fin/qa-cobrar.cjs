// QA de la pantalla única de cobro de Financiamiento (25-nov-2026). Reutiliza la base simulada de qa.cjs
// (Playwright intercepta Supabase; nunca toca la base real).
// Uso: desde la raíz, python3 -m http.server 8790 & ; node docs/qa-fin/qa-cobrar.cjs [carpeta-de-capturas]
const { chromium, base, abrir, ok, enDias, fallos } = require('./qa.cjs');
const CAPS = process.argv[2] || null;

function datos(rol) {
  const db = base(rol);
  const mk = (n, nom, ced, tel, d1) => {
    db.pos_clientes.push({ id: 'k' + n, nombre: nom, cedula: ced, telefono: tel, activo: true });
    db.pos_financiamientos.push(Object.assign({}, db.pos_financiamientos[0], { id: 'f' + n, codigo: 'FIN-10' + n, venta_id: 'vx' + n, cliente_id: 'k' + n, cliente_nombre: nom, descripcion: 'Motor eléctrico' }));
    db.pos_fin_cuotas.push({ id: 'q' + n + 'a', financiamiento_id: 'f' + n, numero: 1, fecha_venc: enDias(d1), monto: 6000, monto_pagado: 0, pagado: false, capital: 6000, interes: 0 },
      { id: 'q' + n + 'b', financiamiento_id: 'f' + n, numero: 2, fecha_venc: enDias(d1 + 30), monto: 6000, monto_pagado: 0, pagado: false, capital: 6000, interes: 0 });
  };
  mk(1, 'ANA CRITICA', '001-0000001-1', '8095550001', -40);
  mk(2, 'LUIS RECIENTE', '001-0000002-2', '8095550002', -3);
  mk(3, 'MARTA HOY', '001-0000003-3', '8095550003', 0);
  return db; // más JUAN PRUEBA (fin1), al día: vence en 10 días
}

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  for (const [w, h] of [[1280, 860], [390, 844]]) for (const rol of ['admin', 'cajero']) {
    console.log(`\n--- ${w}x${h} · ${rol}`);
    const { p, errs } = await abrir(b, w, h, datos(rol));
    await p.evaluate(() => window.nxPosTab('cuotas')); await p.waitForTimeout(700);
    const home = await p.evaluate(() => document.body.innerText);
    ok(/Cobrar cuotas/i.test(home) && !/Pagos de hoy/i.test(home) && !/Cobranza/i.test(home), 'inicio: un solo botón «Cobrar cuotas» (sin «Pagos de hoy» ni «Cobranza»)');
    ok(/Para hoy: 3 clientes/i.test(home), 'el botón dice cuántos hay para hoy (3)');
    if (CAPS) await p.screenshot({ path: `${CAPS}/inicio-${w}-${rol}.png` });
    await p.evaluate(() => window.nxFinV2Go('cobrar')); await p.waitForTimeout(500);
    const filas = () => p.$$eval('#ffCobLista .ffCob', n => n.map(x => x.querySelector('b').textContent));
    const chips = await p.$$eval('#ffCobChips button', n => n.map(x => x.textContent.trim()));
    ok(chips.join('|') === 'Para hoy · 3|Atrasados · 2|Todos · 4', 'filtros con conteo: ' + chips.join(' | '));
    ok((await filas()).join('|') === 'ANA CRITICA|LUIS RECIENTE|MARTA HOY', '«Para hoy»: atrasados primero, luego el que vence hoy');
    if (CAPS) await p.screenshot({ path: `${CAPS}/cobrar-${w}-${rol}.png` });
    await p.click('#ffCobChips button:nth-child(2)'); await p.waitForTimeout(200);
    ok((await filas()).join('|') === 'ANA CRITICA|LUIS RECIENTE', '«Atrasados»: solo los 2 atrasados');
    await p.click('#ffCobChips button:nth-child(3)'); await p.waitForTimeout(200);
    ok((await filas()).length === 4, '«Todos»: los 4 con cuotas pendientes');
    await p.click('#ffCobChips button:nth-child(2)'); await p.fill('#ffCobQ', 'juan'); await p.waitForTimeout(250);
    ok((await filas()).join('|') === 'JUAN PRUEBA', 'la búsqueda busca en toda la lista aunque el filtro sea «Atrasados»');
    await p.fill('#ffCobQ', '0000003'); await p.waitForTimeout(250);
    ok((await filas()).join('|') === 'MARTA HOY', 'busca por cédula');
    await p.fill('#ffCobQ', ''); await p.waitForTimeout(250);
    const med = await p.$$eval('#ffCobChips button, #ffCobLista .ffCobAcc button, #ffCobQ', n => n.map(x => { const r = x.getBoundingClientRect(); return [x.textContent.trim().slice(0, 12) || 'buscador', Math.round(r.width), Math.round(r.height), parseFloat(getComputedStyle(x).fontSize)]; }));
    const chicos = med.filter(m => m[2] < 44 || m[1] < 44);
    ok(chicos.length === 0, 'todo lo que se toca mide ≥ 44 px' + (chicos.length ? ' · chicos: ' + JSON.stringify(chicos.slice(0, 4)) : ''));
    const bq = med.find(m => m[0] === 'buscador');
    ok(bq[2] >= 48 && bq[3] >= 16, `buscador ≥ 48 px con letra de 16 px (mide ${bq[2]} px, letra ${bq[3]} px)`);
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'sin desbordamiento horizontal');
    const hist = await p.$('#ffCobLista [onclick^="window.nxFinHistCredito"]'), res = await p.$('.ffCobRes'), xls = await p.$('[onclick="window.nxFinCobExcel()"]');
    ok(rol === 'admin' ? !!(hist && res && xls) : !(hist || res || xls), rol === 'admin' ? 'admin ve resumen, Historial y Excel' : 'cajero no ve resumen, Historial ni Excel');
    await p.evaluate(() => window.nxFinV2Go('hoy')); await p.waitForTimeout(300);
    ok(await p.$eval('#ffCobChips .on', x => /Para hoy/.test(x.textContent)), 'la ruta vieja «hoy» abre la pantalla única en «Para hoy»');
    await p.evaluate(() => window.nxFinV2Go('cobranza')); await p.waitForTimeout(300);
    ok(await p.$eval('#ffCobChips .on', x => /Atrasados/.test(x.textContent)), 'la ruta vieja «cobranza» abre la pantalla única en «Atrasados»');
    await p.evaluate(() => window.nxFinV2Cobrar('f1')); await p.waitForTimeout(500);
    ok(await p.$('#nxFinM') !== null, '«Cobrar» abre la ventana de cobro de siempre');
    ok(errs.length === 0, 'sin errores de JavaScript' + (errs.length ? ': ' + errs.join(' | ') : ''));
    await p.close();
  }
  await b.close();
  console.log(fallos() ? `\n${fallos()} FALLA(S)` : '\nTODO OK'); process.exit(fallos() ? 1 : 0);
})();
