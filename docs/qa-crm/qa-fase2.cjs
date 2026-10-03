// QA «Paridad con Bayol — Fase 2» (03-oct-2026): adjuntar con menú + vista previa + pie + burbuja «Enviando…», arrastrar y
// soltar, notas de voz, ubicación (y ubicación de la tienda guardada), contacto, menú del mensaje (copiar / reenviar),
// buscar dentro del chat y contador de nuevos en «ir abajo». Uso: python3 -m http.server 8790; node docs/qa-crm/qa-fase2.cjs
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path'), os = require('os');
let fallos = 0; const ok = (c, m) => { console.log((c ? 'OK    ' : 'FALLA ') + m); if (!c) fallos++; };
const BASE = process.env.QA_URL || 'http://localhost:8790/docs/qa-crm/index.html';
const C1 = '11111111-1111-4111-8111-111111111111';
const PNG = path.join(os.tmpdir(), 'qa-foto.png');
fs.writeFileSync(PNG, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));
const enviados = p => p.evaluate(() => LLAMADAS.filter(l => l[0] === 'enviar').map(l => l[1]));
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  for (const [w, h] of [[1280, 800], [390, 844]]) {
    const movil = w < 500; console.log(`\n--- ${w}x${h}`);
    const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: movil, isMobile: movil, permissions: ['microphone', 'clipboard-read', 'clipboard-write'] });
    const p = await ctx.newPage(); const errs = [];
    p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/i.test(m.text())) errs.push(m.text()); });
    await p.goto(BASE); await p.waitForSelector('.wa-row'); await p.waitForTimeout(300);
    await p.click(`#bdList .wa-row[data-id="${C1}"]`); await p.waitForTimeout(500);

    // 1) Adjuntar foto: menú → vista previa con pie → «Enviando…» → enviado con pie
    await p.click('.bd-clip'); await p.waitForSelector('#bdAdjM');
    const items = await p.$$eval('#bdAdjM button', x => x.map(b => b.textContent.trim()));
    ok(JSON.stringify(items) === JSON.stringify(['Foto o video', 'Documento', 'Ubicación', 'Contacto']), 'WhatsApp: menú de adjuntar ' + JSON.stringify(items));
    await p.click('#bdTx'); await p.waitForTimeout(100);
    ok(!(await p.$('#bdAdjM')), 'el menú de adjuntar se cierra al tocar fuera');
    await p.fill('#bdTx', 'este es el modelo');
    await p.setInputFiles('#bdFile', PNG); await p.waitForSelector('#bdAdjP');
    ok(!!(await p.$('#bdAdjP .bd-adj-prev img')) && (await p.$eval('#bdAdjTx', x => x.value)) === 'este es el modelo', 'vista previa de la foto con el pie tomado de lo escrito');
    const n0 = (await enviados(p)).length;
    await p.click('#bdAdjOk'); await p.waitForTimeout(40);
    ok(/Enviando/.test(await p.$eval('#bdMsgs', x => x.textContent)), 'burbuja «Enviando…» al instante mientras sube');
    await p.waitForTimeout(600);
    const e1 = (await enviados(p))[n0] || {};
    ok(e1.adjunto_tipo === 'imagen' && e1.texto === 'este es el modelo' && /^salientes\//.test(e1.adjunto_path || ''), 'envía la foto con su pie ' + JSON.stringify({ t: e1.adjunto_tipo, x: e1.texto }));
    ok(await p.$$eval('#bdMsgs .bd-m', x => x.filter(n => /este es el modelo/.test(n.textContent)).length) === 1, 'la foto queda una sola vez (eco + respuesta)');
    ok((await p.$eval('#bdTx', x => x.value)) === '', 'el texto usado como pie se limpia de la barra');

    // 2) Ubicación con «guardar como ubicación de la tienda»
    await p.click('.bd-clip'); await p.click('#bdAdjM button:has-text("Ubicación")'); await p.waitForSelector('#bdUbM');
    await p.fill('#bdUbLat', '18.4861'); await p.fill('#bdUbLng', '-69.9312'); await p.fill('#bdUbNom', 'STUDIO RD'); await p.check('#bdUbGuardar');
    await p.click('#bdUbM .nxCrmBtn.p:has-text("Enviar")'); await p.waitForTimeout(500);
    const e2 = (await enviados(p)).pop() || {};
    ok(e2.ubicacion && e2.ubicacion.lat === 18.4861 && e2.ubicacion.lng === -69.9312 && e2.ubicacion.nombre === 'STUDIO RD', 'envía la ubicación ' + JSON.stringify(e2.ubicacion));
    ok(await p.$$eval('#bdMsgs .bd-card[href*="google.com/maps?q=18.4861,-69.9312"]', x => x.length) === 1, 'tarjeta de ubicación con «Abrir en Google Maps» (una sola)');
    await p.click('.bd-clip'); await p.click('#bdAdjM button:has-text("Ubicación")'); await p.waitForSelector('#bdUbM');
    ok(/Enviar ubicación de STUDIO RD/.test(await p.$eval('#bdUbM', x => x.textContent)), 'la ubicación de la tienda queda guardada para un toque');
    await p.click('#bdUbM .nxBack');

    // 3) Contacto
    await p.click('.bd-clip'); await p.click('#bdAdjM button:has-text("Contacto")'); await p.waitForSelector('#bdCtM');
    await p.fill('#bdCtNom', 'Técnico Juan'); await p.fill('#bdCtTel', '+1 809 555 0000');
    await p.click('#bdCtM .nxCrmBtn.p'); await p.waitForTimeout(500);
    const e3 = (await enviados(p)).pop() || {};
    ok(e3.contacto && e3.contacto.nombre === 'Técnico Juan', 'envía el contacto ' + JSON.stringify(e3.contacto));
    ok(await p.$$eval('#bdMsgs .bd-card', x => x.some(n => /Técnico Juan/.test(n.textContent))), 'tarjeta de contacto en el chat');

    // 4) Nota de voz
    await p.click('.bd-mic'); await p.waitForSelector('#bdGrab');
    ok(await p.$eval('#bdPie .wa-input-bar', x => x.hidden), 'al grabar, la barra se cambia por la de grabación');
    await p.waitForTimeout(1500);
    await p.click('#bdGrab .wa-send-btn'); await p.waitForTimeout(900);
    const e4 = (await enviados(p)).pop() || {};
    ok(e4.nota_voz === true && e4.adjunto_tipo === 'audio', 'envía la nota de voz (nota_voz + audio) ' + JSON.stringify({ v: e4.nota_voz, t: e4.adjunto_tipo }));
    ok(!(await p.$('#bdGrab')) && !(await p.$eval('#bdPie .wa-input-bar', x => x.hidden)), 'vuelve la barra de escribir');

    // 5) Menú del mensaje: copiar y reenviar
    await p.evaluate(() => { const n = document.querySelector('#bdMsgs .bd-m[data-id="m119"] .bd-mmenu'); n.scrollIntoView({ block: 'center' }); });
    await p.click('#bdMsgs .bd-m[data-id="m119"] .bd-mmenu', { force: true }); await p.waitForSelector('#bdMsgM');
    const mi = await p.$$eval('#bdMsgM button', x => x.map(b => b.textContent.trim()));
    ok(mi.includes('Responder') && mi.includes('Copiar') && mi.includes('Reenviar'), 'menú del mensaje ' + JSON.stringify(mi));
    await p.click('#bdMsgM button:has-text("Copiar")'); await p.waitForTimeout(200);
    ok(await p.evaluate(() => (TOASTS || []).some(t => t[1] === 'Copiado')), 'copiar el texto');
    await p.click('#bdMsgs .bd-m[data-id="m119"] .bd-mmenu', { force: true }); await p.click('#bdMsgM button:has-text("Reenviar")'); await p.waitForSelector('#bdReM');
    await p.fill('#bdReQ', 'Contacto 3'); await p.waitForTimeout(100);
    await p.click('#bdReL .crm-tr-emp >> nth=0'); await p.waitForTimeout(500);
    const e5 = (await enviados(p)).pop() || {};
    ok(e5.conversacion_id === 'w3' && e5.texto === 'msg 119', 'reenvía el texto a la conversación elegida ' + JSON.stringify({ c: e5.conversacion_id, t: e5.texto }));

    // 6) Buscar dentro del chat
    await p.click('button[onclick*="bdBuscarChat"]'); await p.waitForSelector('#bdBqIn');
    await p.fill('#bdBqIn', 'msg 11'); await p.waitForTimeout(250);
    const bq = await p.$eval('#bdBqN', x => x.textContent);
    ok(/^\d+\/\d+$/.test(bq) && !!(await p.$('#bdMsgs .bd-m.bd-hit-on')), 'buscar en el chat marca y cuenta coincidencias (' + bq + ')');
    await p.click('button[aria-label="Cerrar búsqueda"]'); await p.waitForTimeout(150);
    ok(!(await p.$('#bdMsgs .bd-m.bd-hit')), 'cerrar la búsqueda quita las marcas');

    // 7) Contador de nuevos en «ir abajo»
    await p.$eval('#bdMsgs', x => x.scrollTop = 200); await p.waitForTimeout(250);
    await p.evaluate(() => RT.handlers.crm_mensajes({ eventType: 'INSERT', new: { id: 'nv1', conversacion_id: '11111111-1111-4111-8111-111111111111', direccion: 'in', tipo: 'texto', cuerpo: 'llegó algo', estado: 'recibido', created_at: new Date().toISOString() } }));
    await p.waitForTimeout(300);
    ok(await p.$eval('#bdAbajo .bd-nuevos', x => !x.hidden && x.textContent === '1'), 'contador «1» de mensajes nuevos en el botón de ir abajo');
    await p.click('#bdAbajo'); await p.waitForTimeout(600);
    ok(await p.$eval('#bdAbajo .bd-nuevos', x => x.hidden), 'al bajar se apaga el contador');

    // 8) Arrastrar y soltar un archivo sobre el chat
    await p.evaluate(() => { const dt = new DataTransfer(); dt.items.add(new File(['%PDF-1.4'], 'cotizacion.pdf', { type: 'application/pdf' })); document.getElementById('bdMsgs').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt })); });
    await p.waitForTimeout(200);
    ok(/cotizacion\.pdf/.test(await p.$eval('#bdAdjP', x => x.textContent).catch(() => '')), 'soltar un archivo abre la vista previa');
    await p.click('#bdAdjP .nxBack');

    // 9) Instagram: el menú de adjuntar no ofrece ubicación ni contacto
    if (movil) { await p.click('.wa-back'); await p.waitForTimeout(200); }
    await p.click('.crm-tab-seg:has-text("Redes")'); await p.waitForTimeout(500);
    await p.click('#bdList .wa-row[data-id="ig2"]'); await p.waitForTimeout(400);
    await p.click('.bd-clip'); await p.waitForSelector('#bdAdjM');
    ok(JSON.stringify(await p.$$eval('#bdAdjM button', x => x.map(b => b.textContent.trim()))) === JSON.stringify(['Foto o video', 'Documento']), 'Instagram: solo foto/video y documento');

    ok(errs.length === 0, 'sin errores de consola ' + JSON.stringify(errs.slice(0, 3)));
    await ctx.close();
  }
  await b.close();
  console.log(fallos ? `\n${fallos} FALLA(S)` : '\nTODO OK'); process.exit(fallos ? 1 : 0);
})();
