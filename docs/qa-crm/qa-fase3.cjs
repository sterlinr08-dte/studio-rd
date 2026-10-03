// QA «Paridad con Bayol — Fase 3» (03-oct-2026): menú del chat (⋮, clic derecho, mantener pulsado), fijar, silenciar (sin
// sonido), marcar no leído, etiquetas, ficha del contacto con «Crear cliente», respuestas rápidas «/».
// Uso: python3 -m http.server 8790; node docs/qa-crm/qa-fase3.cjs
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
let fallos = 0; const ok = (c, m) => { console.log((c ? 'OK    ' : 'FALLA ') + m); if (!c) fallos++; };
const BASE = process.env.QA_URL || 'http://localhost:8790/docs/qa-crm/index.html';
const C1 = '11111111-1111-4111-8111-111111111111';
const patches = (p, id) => p.evaluate(i => LLAMADAS.filter(l => l[0] === 'patch' && l[1] === 'crm_conversaciones' && l[2] === 'id=eq.' + i).map(l => l[3]), id);
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  for (const [w, h] of [[1280, 800], [390, 844]]) {
    const movil = w < 500; console.log(`\n--- ${w}x${h}`);
    const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: movil, isMobile: movil });
    await ctx.addInitScript(() => { window.TONOS = 0; window.AudioContext = function () { return { state: 'running', currentTime: 0, destination: {}, resume() {}, createOscillator() { return { type: '', frequency: { setValueAtTime() {} }, connect() {}, start() { window.TONOS++; }, stop() {} }; }, createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; } }; }; });
    const p = await ctx.newPage(); const errs = [];
    p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/i.test(m.text())) errs.push(m.text()); });
    p.on('dialog', d => d.type() === 'prompt' ? d.accept('Ana Gómez Pérez') : d.accept());
    await p.goto(BASE); await p.waitForSelector('.wa-row'); await p.waitForTimeout(300);

    // 1) Menú de una conversación desde la lista (clic derecho / mantener pulsado) sin abrir el chat
    if (movil) {
      await p.$eval('#bdList .wa-row[data-id="w10"]', x => x.scrollIntoView({ block: 'center' })); await p.waitForTimeout(200);
      const r = await p.$('#bdList .wa-row[data-id="w10"]'); const bb = await r.boundingBox();
      const cdp = await ctx.newCDPSession(p);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: bb.x + 40, y: bb.y + 20 }] }); await p.waitForTimeout(650);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await p.waitForTimeout(200);
    } else await p.click('#bdList .wa-row[data-id="w10"]', { button: 'right' });
    await p.waitForSelector('#bdChM');
    const it = await p.$$eval('#bdChM button', x => x.map(b => b.textContent.trim()));
    ok(['Ficha del contacto', 'Marcar como no leído', 'Fijar arriba', 'Silenciar 8 horas', 'Etiquetas', 'Archivar'].every(t => it.includes(t)), (movil ? 'mantener pulsado' : 'clic derecho') + ' abre el menú de la conversación ' + JSON.stringify(it));
    ok(!(await p.$('.crmB.chat-abierto')) || !movil, 'el menú no abre el chat');
    // 2) Fijar arriba
    await p.click('#bdChM button:has-text("Fijar arriba")'); await p.waitForTimeout(300);
    ok((await patches(p, 'w10')).some(b => b.fijado_at), 'fijar guarda fijado_at');
    ok(await p.$eval('#bdList .wa-row', x => x.dataset.id) === 'w10' && !!(await p.$('#bdList .wa-row[data-id="w10"] .ti-pin')), 'la fijada sube arriba con su chincheta');
    // 3) Silenciar 8 h → icono y sin sonido al llegarle un mensaje
    await p.click('#bdList .wa-row[data-id="w10"]', movil ? {} : { button: 'right' }).catch(() => {});
    if (movil) { await p.evaluate(() => window.nxCRM.bdChatMenu(null, 'w10')); }
    await p.waitForSelector('#bdChM'); await p.click('#bdChM button:has-text("Silenciar 8 horas")'); await p.waitForTimeout(300);
    if (movil) { await p.click('.wa-back').catch(() => {}); await p.waitForTimeout(200); }
    ok(!!(await p.$('#bdList .wa-row[data-id="w10"] .ti-bell-off')), 'silenciada: icono de campana tachada');
    const t0 = await p.evaluate(() => TONOS);
    await p.evaluate(() => { const c = DB.crm_conversaciones.find(x => x.id === 'w10'); RT.handlers.crm_conversaciones({ eventType: 'UPDATE', new: Object.assign({}, c, { no_leidos: 2, ultimo_inbound_at: new Date().toISOString() }) }); });
    await p.waitForTimeout(200);
    ok(await p.evaluate(() => TONOS) === t0, 'una conversación silenciada no suena');
    // 4) Etiquetas
    await p.evaluate(() => window.nxCRM.bdChatMenu(null, 'w10')); await p.click('#bdChM button:has-text("Etiquetas")'); await p.waitForSelector('#bdEtM');
    await p.click('#bdEtL button:has-text("Interesado")'); await p.fill('#bdEtN', 'VIP'); await p.press('#bdEtN', 'Enter');
    await p.click('#bdEtM .nxCrmBtn.p'); await p.waitForTimeout(300);
    const et = (await patches(p, 'w10')).map(b => b.etiquetas).filter(Boolean).pop() || [];
    ok(et.includes('Interesado') && et.includes('VIP'), 'guarda las etiquetas ' + JSON.stringify(et));
    ok(/Interesado/.test(await p.$eval('#bdList .wa-row[data-id="w10"] .fila-etq', x => x.textContent).catch(() => '')), 'las etiquetas se ven en la fila');
    // 5) Chat abierto: ⋮, ficha, crear cliente, marcar no leído
    await p.click(`#bdList .wa-row[data-id="${C1}"]`); await p.waitForTimeout(500);
    await p.click('button[aria-label="Más opciones del chat"]'); await p.waitForSelector('#bdChM');
    await p.click('#bdChM button:has-text("Ficha del contacto")'); await p.waitForSelector('#bdFiM');
    ok(/\+18095550001/.test(await p.$eval('#bdFiM', x => x.textContent)) && /Archivos del chat/.test(await p.$eval('#bdFiM', x => x.textContent)), 'ficha: teléfono y archivos del chat');
    await p.click('#bdFiM button:has-text("Crear cliente")'); await p.waitForTimeout(400);
    ok(await p.evaluate(() => (window.CREADOS || [])[0] && CREADOS[0].nombre === 'Ana Gómez Pérez' && CREADOS[0].telefono === '8095550001'), 'crear cliente con el nombre y el teléfono del chat');
    ok((await patches(p, C1)).some(b => b.cliente_id === 'cli-nuevo'), 'el cliente nuevo queda vinculado al chat');
    // 6) Respuestas rápidas
    await p.fill('#bdTx', '/'); await p.dispatchEvent('#bdTx', 'input'); await p.waitForSelector('#bdRRP');
    await p.click('#bdRRP .bd-rr-adm'); await p.waitForSelector('#bdRRM');
    await p.fill('#bdRRA', 'precio'); await p.fill('#bdRRX', 'Hola {nombre}, el precio es RD$5,000');
    await p.click('#bdRRM .nxCrmBtn.p'); await p.waitForTimeout(400);
    ok(await p.evaluate(() => (DB.crm_respuestas_rapidas || []).some(x => x.atajo === 'precio')), 'guarda la respuesta rápida /precio');
    await p.click('#bdRRM .nxBack');
    await p.fill('#bdTx', '/pre'); await p.dispatchEvent('#bdTx', 'input'); await p.waitForTimeout(300);
    ok(/\/precio/.test(await p.$eval('#bdRRP', x => x.textContent).catch(() => '')), 'escribir /pre muestra /precio');
    await p.press('#bdTx', 'Enter'); await p.waitForTimeout(200);
    ok((await p.$eval('#bdTx', x => x.value)) === 'Hola Ana, el precio es RD$5,000', 'Enter pone el texto con el nombre del cliente: ' + JSON.stringify(await p.$eval('#bdTx', x => x.value)));
    ok(!(await p.evaluate(() => LLAMADAS.some(l => l[0] === 'enviar' && /precio/.test(l[1].texto || '')))), 'elegir la respuesta no la envía sola');
    // 7) Marcar como no leído desde el chat abierto
    await p.click('button[aria-label="Más opciones del chat"]'); await p.click('#bdChM button:has-text("Marcar como no leído")'); await p.waitForTimeout(400);
    ok((await patches(p, C1)).some(b => b.no_leidos === 1), 'marcar como no leído guarda no_leidos = 1');
    ok(!(await p.$('#bdMsgs')) || !(await p.$('.crmB.chat-abierto')), 'y vuelve a la lista');

    ok(errs.length === 0, 'sin errores de consola ' + JSON.stringify(errs.slice(0, 3)));
    await ctx.close();
  }
  await b.close();
  console.log(fallos ? `\n${fallos} FALLA(S)` : '\nTODO OK'); process.exit(fallos ? 1 : 0);
})();
