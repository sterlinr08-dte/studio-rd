// QA «Funciones del CRM por empleado» (03-oct-2026): canales por empleado + Transferir cliente + Transferidos a mí.
// Uso: desde la raíz del repo, python3 -m http.server 8790; luego node docs/qa-crm/qa-tr.cjs
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
let fallos = 0; const ok = (c, m) => { console.log((c ? 'OK    ' : 'FALLA ') + m); if (!c) fallos++; };
const BASE = process.env.QA_URL || 'http://localhost:8790/docs/qa-crm/index.html';
const CAP = process.env.QA_CAP || '';
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  for (const [w, h] of [[1280, 800], [390, 844]]) {
    const movil = w < 500; console.log(`\n--- ${w}x${h}`);
    const nueva = async (qs) => {
      const p = await b.newPage({ viewport: { width: w, height: h }, hasTouch: movil, isMobile: movil });
      p._errs = []; p.on('pageerror', e => p._errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/i.test(m.text())) p._errs.push(m.text()); });
      await p.goto(BASE + qs); await p.waitForTimeout(500); return p;
    };
    // 1) Empleado solo con Instagram: no ve la pestaña Mensajes (WhatsApp); en Redes solo Instagram.
    let p = await nueva('?rol=vendedor&yo=u9&can=instagram');
    const tabs = await p.$$eval('.crm-tab-seg', x => x.map(t => t.textContent.trim()));
    ok(!tabs.some(t => /Mensajes/.test(t)) && tabs.some(t => /Redes/.test(t)), `solo Instagram: pestañas ${JSON.stringify(tabs)}`);
    const chips = await p.$$eval('.rs-canal', x => x.map(t => t.textContent.trim()));
    ok(chips.length === 1 && /Instagram/.test(chips[0]), `solo Instagram: chips de red ${JSON.stringify(chips)}`);
    ok(p._errs.length === 0, 'sin errores de consola ' + JSON.stringify(p._errs)); await p.close();
    // 2) Empleado solo con WhatsApp: no ve Redes.
    p = await nueva('?rol=vendedor&yo=u9&can=whatsapp');
    const tabs2 = await p.$$eval('.crm-tab-seg', x => x.map(t => t.textContent.trim()));
    ok(tabs2.some(t => /Mensajes/.test(t)) && !tabs2.some(t => /Redes/.test(t)), `solo WhatsApp: pestañas ${JSON.stringify(tabs2)}`);
    await p.close();
    // 3) Sin permiso de transferir: no aparece el botón.
    p = await nueva('?rol=vendedor&yo=u9&tr=0');
    await p.waitForSelector('.wa-row'); await p.click('#bdList .wa-row[data-id="11111111-1111-4111-8111-111111111111"]'); await p.waitForTimeout(400);
    ok(!(await p.$('button[onclick*="trAbrir"]')), 'sin «transferir»: no se muestra el botón');
    await p.close();
    // 4) Transferir: vendedor abre un chat sin asignar, elige compañera, nota, confirma.
    p = await nueva('?rol=vendedor&yo=u9');
    await p.waitForSelector('.wa-row'); await p.click('#bdList .wa-row[data-id="11111111-1111-4111-8111-111111111111"]'); await p.waitForTimeout(400);
    ok(!!(await p.$('button[onclick*="trAbrir"]')), 'botón «Transferir» en la cabecera del chat');
    await p.click('button[onclick*="trAbrir"]'); await p.waitForSelector('#crmTrM .crm-tr-emp');
    ok(await p.$eval('#crmTrOk', x => x.disabled), 'confirmar desactivado hasta elegir a alguien');
    await p.fill('#crmTrQ', 'pedro'); await p.waitForTimeout(100);
    ok(await p.$$eval('#crmTrL .crm-tr-emp', x => x.length) === 1, 'buscar empleado filtra la lista');
    await p.fill('#crmTrQ', ''); await p.click('#crmTrL .crm-tr-emp'); await p.fill('#crmTrNota', 'quiere financiamiento');
    if (CAP) await p.screenshot({ path: `${CAP}/tr-modal-${w}.png` });
    await p.click('#crmTrOk'); await p.waitForTimeout(400);
    const tr = await p.evaluate(() => TRANSF[0]);
    ok(tr && tr.p_conv === '11111111-1111-4111-8111-111111111111' && tr.p_a === 'u2' && tr.p_nota === 'quiere financiamiento', 'llama crm_transferir_conversacion con chat, compañera y nota ' + JSON.stringify(tr));
    ok(!(await p.$('#crmTrM')), 'la ventana se cierra');
    ok(await p.evaluate(() => (TOASTS || []).some(t => t[1] === 'Cliente transferido')), 'aviso «Cliente transferido»');
    ok(!(await p.$('#bdList .wa-row[data-id="11111111-1111-4111-8111-111111111111"]')), 'el chat sale de la lista del vendedor (ya no es suyo)');
    ok(p._errs.length === 0, 'sin errores de consola ' + JSON.stringify(p._errs)); await p.close();
    // 5) Transferidos a mí: contador, lista y abrir el chat (aunque sea de Instagram estando en WhatsApp).
    p = await nueva('?rol=vendedor&yo=u9&trm=1');
    await p.waitForTimeout(300);
    ok(await p.$eval('#crmTrBadge', x => !x.hidden && x.textContent === '1').catch(() => false), 'contador de transferidos = 1');
    await p.click('.crm-tr-btn'); await p.waitForSelector('#crmTrBL .crm-tr-item');
    ok(/IG 3/.test(await p.$eval('#crmTrBL .crm-tr-item', x => x.textContent)) && /iPhone 15/.test(await p.$eval('#crmTrBL .crm-tr-item', x => x.textContent)), 'la lista muestra cliente, quién lo pasó y la nota');
    if (CAP) await p.screenshot({ path: `${CAP}/tr-bandeja-${w}.png` });
    await p.click('#crmTrBL .crm-tr-item'); await p.waitForTimeout(700);
    ok(await p.evaluate(() => MIS_TR[0].visto_at !== null), 'se marca como visto');
    ok(/IG 3/.test(await p.$eval('.wa-chat-head .hn', x => x.textContent).catch(() => '')), 'abre el chat transferido en Redes → Instagram');
    ok(await p.$eval('#crmTrBadge', x => x.hidden).catch(() => false), 'el contador se apaga');
    // 6) Aviso en tiempo real.
    await p.evaluate(() => RT.handlers.crm_transferencias && RT.handlers.crm_transferencias({ eventType: 'INSERT', new: { id: 't2', de_nombre: 'PEDRO REDES', nota: 'te lo paso', a_id: 'u9' } }));
    await p.waitForTimeout(200);
    ok(await p.evaluate(() => (TOASTS || []).some(t => t[1] === 'Te transfirieron un cliente')), 'aviso en tiempo real al recibir un cliente');
    ok(p._errs.length === 0, 'sin errores de consola ' + JSON.stringify(p._errs)); await p.close();
  }
  await b.close();
  console.log(fallos ? `\n${fallos} FALLA(S)` : '\nTODO OK'); process.exit(fallos ? 1 : 0);
})();
