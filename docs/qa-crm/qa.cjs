// QA del CRM afinado (02-oct-2026): parches-pos-crm.js real contra un servidor simulado (index.html).
// Uso: desde la raíz del repo, python3 -m http.server 8790 y cambiar URL a http://localhost:8790/docs/qa-crm/index.html; luego node docs/qa-crm/qa.cjs
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
let fallos = 0; const ok = (c, m) => { console.log((c ? 'OK    ' : 'FALLA ') + m); if (!c) fallos++; };
const URL = process.env.QA_URL || 'http://localhost:8790/docs/qa-crm/index.html';
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  for (const [w, h] of [[1280, 800], [390, 844]]) {
    const movil = w < 500; console.log(`\n--- ${w}x${h}`);
    const p = await b.newPage({ viewport: { width: w, height: h }, hasTouch: movil, isMobile: movil });
    const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/i.test(m.text())) errs.push(m.text()); });
    await p.goto(URL); await p.waitForSelector('.wa-row'); await p.waitForTimeout(300);
    const rp0 = await p.evaluate(() => CUENTA.renderPOS);
    // 1) lista paginada por plataforma
    let n = await p.$$eval('#bdList .wa-row', x => x.length); ok(n === 200, `lista: primera página de 200 conversaciones de WhatsApp (${n})`);
    ok(await p.evaluate(() => LLAMADAS.some(l => l[1] === 'crm_conversaciones' && /plataforma=eq\.whatsapp/.test(l[2]) && /limit=200/.test(l[2]))), 'consulta filtrada por plataforma y limitada a 200');
    ok(!!(await p.$('#bdList .bd-mas-convs')), 'botón «Cargar más conversaciones» visible');
    // 2) abrir un chat no redibuja todo el POS y la lista conserva su posición
    await p.$eval('#bdList', x => x.scrollTop = 1500); await p.waitForTimeout(250);
    const st0 = await p.$eval('#bdList', x => x.scrollTop);
    const filaVis = await p.evaluate(() => { const l = document.getElementById('bdList'), r = l.getBoundingClientRect(); return [...l.querySelectorAll('.wa-row')].find(x => { const b = x.getBoundingClientRect(); return b.top > r.top + 10 && b.bottom < r.bottom - 10; }).dataset.id; });
    await p.click(`#bdList .wa-row[data-id="${filaVis}"]`); await p.waitForTimeout(300);
    ok(await p.evaluate(() => CUENTA.renderPOS) === rp0, `abrir chat no llama renderPOS (${await p.evaluate(() => CUENTA.renderPOS)} vs ${rp0})`);
    if (!movil) ok(Math.abs(await p.$eval('#bdList', x => x.scrollTop) - st0) < 2, `escritorio: la lista conserva su posición (${st0})`);
    if (movil) { await p.click('.wa-back'); await p.waitForTimeout(250); ok(Math.abs(await p.$eval('#bdList', x => x.scrollTop) - st0) < 2, `iPhone: al volver la lista está donde estaba (${await p.$eval('#bdList', x => x.scrollTop)} / ${st0})`); }
    // 3) abrir el chat largo
    await p.$eval('#bdList', x => x.scrollTop = 0); await p.waitForTimeout(100);
    await p.click(`#bdList .wa-row[data-id="11111111-1111-4111-8111-111111111111"]`); await p.waitForTimeout(400);
    n = await p.$$eval('#bdMsgs > .bd-m', x => x.length); ok(n === 80, `chat: carga los 80 más nuevos (${n})`);
    ok(await p.$eval('#bdMsgs', x => x.scrollHeight - x.scrollTop - x.clientHeight) < 5, 'chat: abre pegado abajo');
    ok(await p.evaluate(() => CUENTA.firmasLote >= 1 && CUENTA.firmas === 0), `fotos: firmadas por lote (${await p.evaluate(() => JSON.stringify([CUENTA.firmasLote, CUENTA.firmas]))})`);
    ok(await p.$eval('#bdMsgs .bd-m[data-id="m110"] img', x => /token=/.test(x.src)).catch(() => false), 'foto del chat con enlace firmado');
    ok(await p.evaluate(() => CUENTA.renderPOS) === rp0, 'chat abierto sin redibujar el POS');
    // 4) envío: el servidor guarda con su hora 3 s atrás; la burbuja provisional se reemplaza por su clave
    await p.$eval('#bdMsgs .bd-m[data-id="m100"]', x => x._marca = 1);
    await p.fill('#bdTx', 'hola desde QA'); await p.click('.wa-send-btn'); await p.waitForTimeout(600);
    ok(!(await p.$$eval('#bdMsgs .bd-m', xs => xs.some(x => x.dataset.id.startsWith('tmp-')))), 'envío: la provisional desaparece aunque el reloj del servidor vaya atrás');
    ok(await p.$$eval('#bdMsgs .bd-m .tx', xs => xs.filter(x => x.textContent === 'hola desde QA').length) === 1, 'envío: el mensaje queda una sola vez');
    ok(await p.$eval('#bdMsgs .bd-m[data-id="m100"]', x => x._marca === 1), 'envío: no se recrean los demás mensajes');
    ok(await p.evaluate(() => !LLAMADAS.slice(-6).some(l => l[0] === 'get' && l[1] === 'crm_conversaciones')), 'envío con tiempo real conectado: no recarga la lista entera');
    // 5) tiempo real: mensaje viejo ignorado, borrado reflejado
    await p.evaluate(() => RT.handlers.crm_mensajes({ eventType: 'INSERT', new: { id: 'viejo1', conversacion_id: '11111111-1111-4111-8111-111111111111', direccion: 'in', tipo: 'texto', cuerpo: 'del historial', estado: 'recibido', created_at: new Date(Date.now() - 400 * 60e3).toISOString() } }));
    await p.waitForTimeout(150);
    ok(!(await p.$('#bdMsgs .bd-m[data-id="viejo1"]')), 'tiempo real: un mensaje más viejo que la página cargada no se mete en medio');
    await p.evaluate(() => RT.handlers.crm_mensajes({ eventType: 'DELETE', old: { id: 'm119' }, new: {} })); await p.waitForTimeout(150);
    ok(!(await p.$('#bdMsgs .bd-m[data-id="m119"]')), 'tiempo real: un mensaje borrado desaparece');
    // 6) cargar anteriores sin saltos
    await p.$eval('#bdMsgs', x => { x.scrollTop = 0; x.dispatchEvent(new Event('scroll')); }); await p.waitForTimeout(500);
    n = await p.$$eval('#bdMsgs > .bd-m', x => x.length); ok(n >= 119, `al subir carga los anteriores (${n})`);
    ok(await p.$eval('#bdMsgs > .bd-m:first-child', x => x.dataset.id) === 'm1', 'el primero es el más antiguo (m1)');
    // 7) ventana de 24 h: Cliente Viejo muestra plantilla; al escribir el cliente aparece la barra sin redibujar todo
    if (movil) { await p.click('.wa-back'); await p.waitForTimeout(200); }
    await p.click(`#bdList .wa-row[data-id="22222222-2222-4222-8222-222222222222"]`); await p.waitForTimeout(400);
    ok(!!(await p.$('#bdPie .bd-btn-plant')), 'ventana cerrada: «Enviar plantilla»');
    const rp1 = await p.evaluate(() => CUENTA.renderPOS);
    await p.evaluate(() => { const t = new Date().toISOString(); RT.handlers.crm_conversaciones({ eventType: 'UPDATE', new: { id: '22222222-2222-4222-8222-222222222222', canal_id: 'c1', plataforma: 'whatsapp', contacto_nombre: 'Cliente Viejo', telefono_e164: '+18095550002', contacto_id: '+18095550002', ultimo_mensaje_at: t, ultimo_inbound_at: t, ultimo_mensaje_preview: 'volví', no_leidos: 1, archivada: false } }); });
    await p.waitForTimeout(250);
    ok(!!(await p.$('#bdPie #bdTx')), 'el cliente escribió: aparece la barra de escribir al instante');
    ok(await p.evaluate(() => CUENTA.renderPOS) === rp1, 'sin redibujar el POS');
    // 8) estado de error al cargar un chat + Reintentar
    if (movil) { await p.click('.wa-back'); await p.waitForTimeout(200); }
    await p.evaluate(() => window.CARGA_FALLA = true);
    await p.click(`#bdList .wa-row[data-id="w5"]`); await p.waitForTimeout(300);
    ok(await p.$eval('#bdMsgs', x => /No se pudieron cargar/.test(x.textContent)), 'chat que no carga: aviso con Reintentar (no se queda «Cargando…»)');
    await p.evaluate(() => window.CARGA_FALLA = false);
    await p.click('#bdMsgs .btn-mini'); await p.waitForTimeout(300);
    ok(await p.$eval('#bdMsgs', x => /Todavía no hay mensajes/.test(x.textContent)), 'Reintentar: carga (chat sin mensajes)');
    // 9) una falla pasajera del sondeo conserva la lista
    if (movil) { await p.click('.wa-back'); await p.waitForTimeout(200); }
    await p.evaluate(async () => { window.CARGA_FALLA = true; document.dispatchEvent(new Event('visibilitychange')); });
    await p.waitForTimeout(400);
    ok((await p.$$('#bdList .wa-row')).length >= 200 && !!(await p.$('#bdList .bd-aviso-red')), 'sin conexión: la lista se queda y aparece un aviso');
    await p.evaluate(async () => { window.CARGA_FALLA = false; document.dispatchEvent(new Event('visibilitychange')); }); await p.waitForTimeout(400);
    ok(!(await p.$('#bdList .bd-aviso-red')), 'al volver la conexión el aviso desaparece');
    // 10) cargar más
    await p.click('#bdList .bd-mas-convs'); await p.waitForTimeout(400);
    n = await p.$$eval('#bdList .wa-row', x => x.length); ok(n === 400, `Cargar más: 400 conversaciones (${n})`);
    await p.$eval('#bdList', x => { x.scrollTop = x.scrollHeight; x.dispatchEvent(new Event('scroll')); }); await p.waitForTimeout(500);
    n = await p.$$eval('#bdList .wa-row', x => x.length); ok(n === 450, `al llegar al final carga el resto sola (${n})`);
    ok(!(await p.$('#bdList .bd-mas-convs')), 'ya no hay botón cuando están todas');
    // 11) búsqueda en el servidor (nueva página: solo 200 cargadas)
    await p.goto(URL); await p.waitForSelector('.wa-row'); await p.waitForTimeout(300);
    const rp2 = await p.evaluate(() => CUENTA.renderPOS);
    await p.click('.crm-buscar'); await p.waitForTimeout(100);
    await p.fill('#crmBuscarInput', 'Contacto 440'); await p.waitForTimeout(700);
    ok(!!(await p.$('#bdList .wa-row[data-id="w440"]')), 'buscar encuentra un chat viejo que no estaba cargado');
    await p.fill('#crmBuscarInput', ''); await p.evaluate(() => document.getElementById('crmBuscarInput').blur()); await p.waitForTimeout(350);
    ok(!!(await p.$('.crmB .crm-buscar')) && await p.evaluate(() => CUENTA.renderPOS) === rp2, 'salir del buscador vacío no redibuja la pantalla');
    // 12) archivadas
    await p.click('.crm-chip >> text=Archivadas'); await p.waitForTimeout(400);
    n = await p.$$eval('#bdList .wa-row', x => x.length); ok(n === 5, `Archivadas: 5 conversaciones (${n})`);
    await p.click('#bdList .wa-row[data-id="ar1"]'); await p.waitForTimeout(300);
    ok(!!(await p.$('#bdCab [title="Devolver a la bandeja"]')), 'chat archivado: botón «Devolver a la bandeja»');
    if (movil) { await p.click('.wa-back'); await p.waitForTimeout(150); }
    await p.click('.crm-chip >> text=Todos'); await p.waitForTimeout(400);
    ok((await p.$$('#bdList .wa-row')).length === 200, 'volver a Todos: lista normal');
    // 13) Redes (Instagram) carga lo suyo
    await p.click('.crm-tab-seg >> text=Redes'); await p.waitForTimeout(500);
    n = await p.$$eval('#bdList .wa-row', x => x.length); ok(n === 30, `Redes: 30 conversaciones de Instagram (${n})`);
    // 14) iPhone: 16 px en el cuadro de escribir (sin zoom) — se mide en WhatsApp
    await p.click('.crm-tab-seg >> text=Mensajes'); await p.waitForTimeout(500);
    await p.click(`#bdList .wa-row[data-id="11111111-1111-4111-8111-111111111111"]`); await p.waitForTimeout(400);
    const fs = await p.$eval('#bdTx', x => parseFloat(getComputedStyle(x).fontSize));
    ok(movil ? fs >= 16 : fs < 16, `cuadro de escribir: ${fs}px ${movil ? '(≥16, Safari no hace zoom)' : '(escritorio)'}`);
    // 15) tiempo real: un «CLOSED» del canal viejo no tumba al nuevo ni crea bucle
    const subs0 = await p.evaluate(() => RT.subs);
    await p.evaluate(() => RT.canales[RT.canales.length - 1].cb('CHANNEL_ERROR'));
    await p.waitForTimeout(5600);
    const subs1 = await p.evaluate(() => RT.subs);
    ok(subs1 === subs0 + 1, `reconecta una vez tras un error (${subs0} → ${subs1})`);
    await p.waitForTimeout(6000);
    ok(await p.evaluate(() => RT.subs) === subs1, `no queda reconectando en bucle (${await p.evaluate(() => RT.subs)})`);
    await p.screenshot({ path: (process.env.QA_OUT || require('os').tmpdir()) + `/crm-${w}.png` });
    ok(errs.length === 0, 'sin errores de página' + (errs.length ? ': ' + errs.join(' | ') : ''));
    await p.close();
  }
  // Permisos por rol (02-oct-2026): cada parte del CRM según su permiso; sin permiso no se piden los datos de la Bandeja.
  console.log('\n--- permisos por rol');
  for (const [perm, tabs, bandeja] of [['crm', ['Leads', 'Campañas'], false], ['bandeja', ['Mensajes', 'Redes'], true], ['ninguno', [], false]]) {
    const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto(URL + '?perm=' + perm); await p.waitForTimeout(800);
    const vis = await p.$$eval('.crm-tab-seg', x => x.map(t => t.textContent.trim().replace(/\d+$/, '').trim()));
    ok(JSON.stringify(vis) === JSON.stringify(tabs), `${perm}: pestañas ${JSON.stringify(vis)}`);
    const pidio = await p.evaluate(() => LLAMADAS.some(l => l[1] === 'crm_conversaciones'));
    ok(pidio === bandeja, `${perm}: ${bandeja ? 'carga' : 'no pide'} las conversaciones`);
    if (perm === 'bandeja') { await p.click('#bdList .wa-row'); await p.waitForTimeout(400); ok(!(await p.$('text=Crear lead')), 'bandeja sin CRM: no ofrece «Crear lead»'); }
    if (perm === 'ninguno') ok(!!(await p.$('text=Tu rol no tiene acceso al CRM')), 'sin permisos: aviso claro');
    ok(errs.length === 0, `${perm}: sin errores de página` + (errs.length ? ': ' + errs.join(' | ') : ''));
    await p.close();
  }
  await b.close();
  console.log(`\n${fallos ? 'FALLAS: ' + fallos : 'TODO OK'}`); process.exitCode = fallos ? 1 : 0;
})();
