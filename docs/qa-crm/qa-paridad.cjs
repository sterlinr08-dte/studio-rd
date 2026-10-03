// QA «Paridad con Bayol — Fase 1» (03-oct-2026): Redes con chips/filtros/archivadas, contadores en tiempo real, borradores
// que sobreviven a recargar, Ayer/día de la semana, enlaces, emojis, aviso de 24 h en Instagram, sonido al llegar un
// mensaje y adjunto «no disponible» cuando no se puede firmar.
// Uso: desde la raíz del repo, python3 -m http.server 8790; luego node docs/qa-crm/qa-paridad.cjs
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
let fallos = 0; const ok = (c, m) => { console.log((c ? 'OK    ' : 'FALLA ') + m); if (!c) fallos++; };
const BASE = process.env.QA_URL || 'http://localhost:8790/docs/qa-crm/index.html';
const C1 = '11111111-1111-4111-8111-111111111111', VIEJO = '22222222-2222-4222-8222-222222222222';
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  for (const [w, h] of [[1280, 800], [390, 844]]) {
    const movil = w < 500; console.log(`\n--- ${w}x${h}`);
    const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: movil, isMobile: movil });
    await ctx.addInitScript(() => {
      window.TONOS = 0;
      window.AudioContext = function () { return { state: 'running', currentTime: 0, destination: {}, resume() {}, createOscillator() { return { type: '', frequency: { setValueAtTime() {} }, connect() {}, start() { window.TONOS++; }, stop() {} }; }, createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; } }; };
    });
    const p = await ctx.newPage(); const errs = [];
    p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/i.test(m.text())) errs.push(m.text()); });
    await p.goto(BASE); await p.waitForSelector('.wa-row'); await p.waitForTimeout(300);

    // 1) Contadores de los chips se actualizan con el tiempo real
    const nl0 = await p.$eval('#bdChips', x => x.textContent);
    await p.evaluate(() => RT.handlers.crm_conversaciones({ eventType: 'UPDATE', new: Object.assign({}, DB.crm_conversaciones.find(c => c.id === 'w5'), { no_leidos: 3, ultimo_inbound_at: new Date().toISOString(), ultimo_mensaje_at: new Date().toISOString() }) }));
    await p.waitForTimeout(300);
    const nl1 = await p.$eval('#bdChips', x => x.textContent);
    ok(/No leídos\s*2/.test(nl1) && nl0 !== nl1, `chips: «No leídos» se actualiza con el tiempo real (${nl0.replace(/\s+/g, ' ')} → ${nl1.replace(/\s+/g, ' ')})`);
    ok(await p.evaluate(() => TONOS) === 1, 'sonido al llegar un mensaje nuevo de un cliente');
    await p.evaluate(() => RT.handlers.crm_conversaciones({ eventType: 'UPDATE', new: Object.assign({}, DB.crm_conversaciones.find(c => c.id === 'w6'), { no_leidos: 1, ultimo_inbound_at: new Date().toISOString() }) }));
    await p.waitForTimeout(150);
    ok(await p.evaluate(() => TONOS) === 1, 'el sonido no se repite en ráfaga (máx. uno cada 2,5 s)');

    // 2) Borrador + «Borrador:» en la lista + sobrevive a recargar
    await p.click(`#bdList .wa-row[data-id="${C1}"]`); await p.waitForTimeout(400);
    await p.fill('#bdTx', 'te lo dejo en 5 mil'); await p.waitForTimeout(500);
    // Emojis
    await p.click('.bd-emoji-btn'); await p.waitForSelector('#bdEmojiP');
    await p.click('#bdEmojiP button >> nth=0');
    ok(/te lo dejo en 5 mil😀/.test(await p.$eval('#bdTx', x => x.value)), 'emoji insertado en el texto');
    ok(!!(await p.$('#bdEmojiP')), 'el panel de emojis sigue abierto para poner varios');
    await p.mouse.click(5, 5); await p.waitForTimeout(100);
    ok(!(await p.$('#bdEmojiP')), 'el panel de emojis se cierra al tocar fuera');
    if (movil) await p.click('.wa-back'); else await p.click(`#bdList .wa-row[data-id="${VIEJO}"]`);
    await p.waitForTimeout(500);
    ok(/Borrador:\s*te lo dejo en 5 mil/.test(await p.$eval(`#bdList .wa-row[data-id="${C1}"] .fila-preview`, x => x.textContent)), 'la lista muestra «Borrador:» del chat que dejé a medias');
    await p.reload(); await p.waitForSelector('.wa-row'); await p.waitForTimeout(300);
    await p.click(`#bdList .wa-row[data-id="${C1}"]`); await p.waitForTimeout(400);
    ok(/te lo dejo en 5 mil/.test(await p.$eval('#bdTx', x => x.value)), 'el borrador sobrevive a recargar la página');

    // 3) Enlaces y día de la semana
    await p.evaluate(() => { const t = new Date().toISOString(); DB.crm_mensajes.push({ id: 'ay1', conversacion_id: '11111111-1111-4111-8111-111111111111', direccion: 'in', tipo: 'texto', cuerpo: 'mira https://studiord.net/tienda y www.ejemplo.com.', estado: 'recibido', created_at: t }); });
    await p.evaluate(() => RT.handlers.crm_mensajes({ eventType: 'INSERT', new: DB.crm_mensajes.find(m => m.id === 'ay1') }));
    await p.waitForTimeout(300);
    const links = await p.$$eval('#bdMsgs .bd-m[data-id="ay1"] .tx a', x => x.map(a => a.getAttribute('href')));
    ok(links.length === 2 && links[0] === 'https://studiord.net/tienda' && links[1] === 'https://www.ejemplo.com', 'enlaces que se pueden tocar ' + JSON.stringify(links));
    if (movil) await p.click('.wa-back'); await p.waitForTimeout(200);
    await p.click(`#bdList .wa-row[data-id="${VIEJO}"]`); await p.waitForTimeout(400);
    const dias = await p.$$eval('#bdMsgs .wa-dia', x => x.map(d => d.textContent));
    ok(dias.some(d => /^(Lunes|Martes|Miércoles|Jueves|Viernes|Sábado|Domingo)$/i.test(d)), 'separador con el día de la semana (hace 3 días): ' + JSON.stringify(dias));

    // 4) Redes: chips, filtros y archivadas; aviso de 24 h en Instagram
    if (movil) { await p.click('.wa-back').catch(() => {}); await p.waitForTimeout(200); }
    await p.click('.crm-tab-seg:has-text("Redes")'); await p.waitForTimeout(500);
    ok(!!(await p.$('.rs-hub #bdChips .crm-chip')) && !!(await p.$('.rs-filtros')), 'Redes tiene chips y Filtros');
    await p.click('#bdChips .crm-chip:has-text("Archivadas")'); await p.waitForTimeout(500);
    ok(!!(await p.$('#bdList .wa-row[data-id="iga1"]')), 'Redes → Archivadas muestra la conversación archivada de Instagram');
    await p.click('#bdChips .crm-chip:has-text("Todos")'); await p.waitForTimeout(500);
    await p.click('#bdList .wa-row[data-id="ig20"]'); await p.waitForTimeout(400);
    ok(/más de 24 horas/.test(await p.$eval('#bdPie', x => x.textContent).catch(() => '')), 'Instagram: aviso claro pasadas 24 h del último mensaje del cliente');
    if (movil) { await p.click('.wa-back'); await p.waitForTimeout(200); }
    await p.click('#bdList .wa-row[data-id="ig2"]'); await p.waitForTimeout(400);
    ok(!/más de 24 horas/.test(await p.$eval('#bdPie', x => x.textContent).catch(() => '')), 'Instagram: sin aviso dentro de las 24 h');

    // 5) Adjunto que no se puede firmar → «Adjunto no disponible» con Reintentar (en vez de «imagen…» para siempre)
    if (movil) { await p.click('.wa-back'); await p.waitForTimeout(200); }
    await p.click('.crm-tab-seg:has-text("Mensajes")'); await p.waitForTimeout(500);
    await p.evaluate(() => { window.FIRMA_FALLA = true; DB.crm_mensajes.push({ id: 'fx1', conversacion_id: '22222222-2222-4222-8222-222222222222', direccion: 'in', tipo: 'imagen', cuerpo: '', media_path: 'entrantes/x/rota.jpg', estado: 'recibido', created_at: new Date().toISOString() }); });
    await p.click(`#bdList .wa-row[data-id="${VIEJO}"]`); await p.waitForTimeout(500);
    await p.evaluate(() => RT.handlers.crm_mensajes({ eventType: 'INSERT', new: DB.crm_mensajes.find(m => m.id === 'fx1') }));
    for (let i = 0; i < 3; i++) { await p.waitForTimeout(400); await p.evaluate(() => window.nxCRM.bdMediaLista && 0); }
    await p.evaluate(() => window.nxCRM.bdReintentarCarga());
    await p.waitForTimeout(800);
    ok(/Adjunto no disponible/.test(await p.$eval('#bdMsgs .bd-m[data-id="fx1"]', x => x.textContent).catch(() => '')), 'adjunto sin firma → «Adjunto no disponible» + Reintentar');
    await p.evaluate(() => { window.FIRMA_FALLA = false; });
    await p.click('#bdMsgs .bd-m[data-id="fx1"] .btn-mini'); await p.waitForTimeout(600);
    ok(!!(await p.$('#bdMsgs .bd-m[data-id="fx1"] img')), 'Reintentar vuelve a firmar y muestra la foto');

    ok(errs.length === 0, 'sin errores de consola ' + JSON.stringify(errs.slice(0, 3)));
    await ctx.close();
  }
  await b.close();
  console.log(fallos ? `\n${fallos} FALLA(S)` : '\nTODO OK'); process.exit(fallos ? 1 : 0);
})();
