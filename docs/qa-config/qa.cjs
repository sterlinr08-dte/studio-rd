// QA del módulo Configuración (02-oct-2026): la app real (index.html + parches) contra una base Supabase SIMULADA
// (Playwright intercepta edbknlkjnlfmkkiizdbe.supabase.co; nunca toca la base real).
// Uso: desde la raíz del repo, python3 -m http.server 8790 & ; node docs/qa-config/qa.cjs
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const APP_URL = process.env.QA_URL || 'http://localhost:8790/index.html';
const OUT = process.env.QA_OUT || require('os').tmpdir();
let fallos = 0; const ok = (c, m) => { console.log((c ? 'OK    ' : 'FALLA ') + m); if (!c) fallos++; };

function base() {
  return {
    profiles: [{ id: 'auth-admin', usuario_sistema_id: 'us-admin', nom: 'ESTERLIN', login: 'admin', rol: 'admin', activo: true, must_change_password: false }],
    organizaciones: [{ id: 'org1', slug: 'studio', nombre: 'STUDIO', tipo: 'tienda', activo: true }],
    pos_config: [{ organizacion_id: 'org1', prefijo_contado: 'CO', prefijo_credito: 'CR', mora_pct: 5, mora_dias_gracia: 3, garantia_rep_dias: 30, compras_v2: true, financiamiento_v2: true, reacondicionado: true,
      fin_contrato_titulo: 'Contrato de venta a crédito', fin_contrato_plantilla: 'CONTRATO No. {{codigo}} entre {{empresa}} y {{cliente}}', fin_firma_vigencia_horas: 72,
      fin_acreedor_nombre: 'STUDIO SRL', fin_acreedor_doc: '1-01-00001-1', fin_abogado_nombre: 'Lic. Ana Pérez', emp_nombre: null, emp_rnc: null }],
    pos_ncf_secuencias: [{ id: 'n1', tipo: 'B02', prefijo: 'B02', desde: 1, hasta: 16500, actual: 16474, activo: true, vencimiento: null },
      { id: 'n2', tipo: 'B01', prefijo: 'B01', desde: 1, hasta: 1000, actual: 63, activo: true, vencimiento: '2026-10-20' }],
    pos_acceso: [],
    pos_almacenes: [{ id: 'a1', nombre: 'Edificio Studio', es_principal: true, activo: true }, { id: 'a2', nombre: 'Villa Vázquez', activo: true }],
    usuarios_sistema: [{ id: 'us-admin', nom: 'ESTERLIN', login: 'admin', rol: 'admin', activo: true, almacen_id: 'a1', organizacion_id: 'org1' },
      { id: 'us-caj', nom: 'MARIA CAJERA', login: 'maria', rol: 'cajero', activo: true, almacen_id: 'a2' },
      { id: 'us-ven', nom: 'PEDRO VENDEDOR', login: 'pedro', rol: 'vendedor', activo: false, almacen_id: null },
      { id: 'us-adm2', nom: 'ANA SOCIA', login: 'ana', rol: 'admin', activo: true, almacen_id: 'a1', telefono: '8095550101' }]
  };
}

async function abrir(b, w, h, db) {
  const movil = w < 500;
  const p = await b.newPage({ viewport: { width: w, height: h }, hasTouch: movil, isMobile: movil });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const llamadas = [];
  await p.route(/edbknlkjnlfmkkiizdbe\.supabase\.co/, async (route) => {
    const r = route.request(), u = new URL(r.url()), m = r.method();
    const send = (o, st = 200) => route.fulfill({ status: st, contentType: 'application/json', body: JSON.stringify(o) });
    if (u.pathname.startsWith('/auth/v1/user')) return send({ id: 'auth-admin', email: 'admin@nexus-pro.local' });
    if (u.pathname.startsWith('/auth/v1/')) return send({ access_token: 'tok', refresh_token: 'r', expires_in: 3600, user: { id: 'auth-admin' } });
    if (u.pathname.startsWith('/functions/v1/')) {
      const body = r.postDataJSON(); llamadas.push(['fn', u.pathname.split('/').pop(), body]);
      if (body.accion === 'accesos') return send({ ok: true, accesos: [{ usuario_id: 'us-admin', ultimo_acceso: new Date().toISOString(), debe_cambiar_clave: false }, { usuario_id: 'us-caj', ultimo_acceso: null, debe_cambiar_clave: true }] });
      return send({ ok: true, id: body.accion === 'crear' ? 'us-new' : undefined, login: body.login, rol: body.rol });
    }
    if (u.pathname.startsWith('/rest/v1/')) {
      const t = u.pathname.slice(9);
      if (m === 'GET' || m === 'HEAD') {
        let filas = db[t] || [];
        for (const [k, v] of u.searchParams) { if (/^(select|order|limit|offset|on_conflict)$/.test(k)) continue; const mm = /^eq\.(.*)$/.exec(v); if (mm) filas = filas.filter(x => String(x[k]) === decodeURIComponent(mm[1])); }
        return send(filas);
      }
      const body = r.postDataJSON(); llamadas.push([m, t, u.search, body]);
      if (m === 'PATCH') { (db[t] || []).forEach(x => Object.assign(x, body)); return send(db[t] && db[t].length ? db[t] : []); }
      if (m === 'POST') { const arr = Array.isArray(body) ? body : [body]; db[t] = (db[t] || []).concat(arr); return send(arr); }
      return send([]);
    }
    return route.fulfill({ status: 204, body: '' });
  });
  await p.goto(APP_URL + '#access_token=tok&refresh_token=r&expires_in=3600');
  await p.waitForFunction(() => typeof window.nxPosTab === 'function' && window.nxPosCfgListo === true, null, { timeout: 30000 });
  await p.evaluate(() => window.nxPosTab('ajustes')); await p.waitForTimeout(700);
  return { p, errs, llamadas };
}

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  for (const [w, h] of [[1280, 860], [390, 844]]) {
    console.log(`\n--- ${w}x${h}`);
    const db = base(); const { p, errs, llamadas } = await abrir(b, w, h, db);
    // Inicio del módulo: buscador, avisos y secciones
    ok(!!(await p.$('#ajBusq')), 'buscador visible');
    const secs = await p.$$eval('.ajSecBtn .tx b', x => x.map(e => e.textContent));
    ok(secs.length === 7 && secs[0] === 'Empresa', `7 secciones (${secs.join(', ')})`);
    const avisos = await p.$$eval('.ajAvisos .ajAv b', x => x.map(e => e.textContent));
    ok(avisos.some(t => /RNC/.test(t)), 'aviso: falta el RNC');
    ok(avisos.some(t => /B01.*vencen en/.test(t)), 'aviso: B01 vence pronto');
    ok(avisos.some(t => /Quedan 26 comprobantes B02/.test(t)), 'aviso: quedan 26 B02');
    ok(avisos.some(t => /permisos por rol/.test(t)), 'aviso: permisos por rol sin guardar');
    await p.waitForTimeout(2500); await p.screenshot({ path: `${OUT}/cfg-inicio-${w}.png`, fullPage: true });
    // Buscar sin perder el foco
    await p.fill('#ajBusq', 'clave'); await p.waitForTimeout(150);
    ok((await p.$$eval('.ajSecBtn .tx b', x => x.map(e => e.textContent))).join() === 'Equipo', 'buscar «clave» → Equipo');
    ok(await p.evaluate(() => document.activeElement && document.activeElement.id === 'ajBusq'), 'el buscador conserva el foco');
    await p.fill('#ajBusq', ''); await p.waitForTimeout(150);
    // Empresa: RNC válido / inválido, vista previa, guardar
    await p.click('.ajSecBtn:has-text("Empresa")'); await p.waitForTimeout(300);
    await p.fill('#aj_emp_rnc', '131-24680-9'); await p.waitForTimeout(100);
    const hintMal = await p.textContent('#ajRncHint'); ok(/no pasa/.test(hintMal) || /válido/.test(hintMal), 'RNC: verifica dígito (' + hintMal.trim().slice(0, 40) + ')');
    await p.fill('#aj_emp_rnc', '12345'); await p.waitForTimeout(100);
    ok(/5 dígitos/.test(await p.textContent('#ajRncHint')), 'RNC de 5 dígitos: avisa el largo');
    await p.fill('#aj_emp_rnc', '001-0000000-1'.replace(/\D/g, '').slice(0, 10) + '1'); // cédula 11 dígitos
    await p.fill('#aj_emp_nombre', 'STUDIO, SRL'); await p.fill('#aj_emp_telefono', '809-555-0000'); await p.fill('#aj_emp_direccion', 'Av. Principal 1, Santiago');
    await p.fill('#aj_emp_pie_factura', 'Gracias por preferirnos'); await p.waitForTimeout(100);
    ok(/STUDIO, SRL/.test(await p.textContent('#ajEmpVista')) && /Gracias por preferirnos/.test(await p.textContent('#ajEmpVista')), 'vista previa en vivo');
    await p.click('button:has-text("Guardar datos de la empresa")'); await p.waitForTimeout(500);
    const pat = llamadas.find(l => l[0] === 'PATCH' && l[1] === 'pos_config' && l[3].emp_nombre);
    ok(!!pat && pat[3].emp_telefono === '809-555-0000' && pat[3].emp_pie_factura === 'Gracias por preferirnos', 'guarda los datos de la empresa en pos_config');
    ok(await p.evaluate(() => !!document.querySelector('.ajSecCab')), 'se queda en la sección después de guardar');
    await p.screenshot({ path: `${OUT}/cfg-empresa-${w}.png`, fullPage: true });
    // Volver
    await p.click('.ajVolver'); await p.waitForTimeout(250);
    ok(!!(await p.$('#ajBusq')), 'volver al inicio de Configuración');
    // Financiamiento: datos legales cargados (H1) y contrato
    await p.click('.ajSecBtn:has-text("Financiamiento")'); await p.waitForTimeout(300);
    ok(await p.inputValue('#lg_fin_acreedor_nombre') === 'STUDIO SRL', 'datos legales se cargan (ya no se borran al guardar)');
    ok(/Bien escrito/.test(await p.textContent('#ajCtHint')), 'contrato: plantilla válida');
    await p.fill('#ajCtTxt', 'Hola {{clienteX}}'); await p.waitForTimeout(100);
    ok(/No conozco \{\{clienteX\}\}/.test(await p.textContent('#ajCtHint')), 'contrato: detecta palabra desconocida');
    await p.click('.nxF2Btn:has-text("Guardar datos legales")'); await p.waitForTimeout(400);
    const leg = llamadas.find(l => l[0] === 'PATCH' && l[1] === 'pos_config' && 'fin_acreedor_nombre' in l[3]);
    ok(!!leg && leg[3].fin_acreedor_nombre === 'STUDIO SRL' && leg[3].fin_abogado_nombre === 'Lic. Ana Pérez', 'guardar datos legales conserva lo que había');
    await p.click('.ajVolver'); await p.waitForTimeout(250);
    // Equipo › Usuarios y acceso (59.85): pestañas, lista, buscador, filtros, ficha única, WhatsApp
    p.removeAllListeners('dialog'); p.on('dialog', d => d.accept());
    await p.click('.ajSecBtn:has-text("Equipo")'); await p.waitForTimeout(900);
    const tabs = await p.$$eval('.ajTabs button', x => x.map(e => e.textContent.trim()));
    ok(tabs.join('|') === 'Usuarios|Roles y permisos|Vendedores', 'pestañas de Equipo: ' + tabs.join(', '));
    const usr = await p.$$eval('.ajUsrF .tx b', x => x.map(e => e.textContent));
    ok(usr.length === 4, `lista de usuarios (${usr.length})`);
    ok(/tú/.test(usr.join('|')), 'marca al usuario actual');
    ok(await p.$$eval('.ajUsrF.inac', x => x.length) === 1, 'usuario desactivado se ve atenuado');
    ok(/Hoy,/.test(await p.textContent('.ajUsrF:has-text("ESTERLIN") .c2 small')), 'muestra la última entrada (hoy)');
    ok(/Debe cambiar la clave/.test(await p.textContent('.ajUsrF:has-text("MARIA") .c3')), 'muestra «Debe cambiar la clave»');
    await p.fill('#ajUsrQ', 'mar'); await p.waitForTimeout(150);
    ok(await p.$$eval('.ajUsrF', x => x.length) === 1 && await p.evaluate(() => document.activeElement && document.activeElement.id === 'ajUsrQ'), 'buscador filtra sin perder el foco');
    await p.fill('#ajUsrQ', ''); await p.waitForTimeout(150);
    await p.click('.ajUsrFil button:has-text("Desactivados")'); await p.waitForTimeout(300);
    ok(await p.$$eval('.ajUsrF', x => x.length) === 1, 'filtro Desactivados');
    await p.click('.ajUsrFil button:has-text("Todos")'); await p.waitForTimeout(300);
    await p.screenshot({ path: `${OUT}/cfg-equipo-${w}.png`, fullPage: true });
    // Editar rol
    await p.click('.ajUsrF:has-text("MARIA")'); await p.waitForTimeout(250);
    await p.check('input[name="ajURol"][value="vendedor"]'); await p.click('#ajUBtn'); await p.waitForTimeout(500);
    const act = llamadas.find(l => l[0] === 'fn' && l[2].accion === 'actualizar');
    ok(!!act && act[2].usuario_id === 'us-caj' && act[2].rol === 'vendedor', 'editar rol → servidor (actualizar)');
    // Error corregido: editar a OTRO administrador no lo baja a gerente
    await p.click('.ajUsrF:has-text("ANA SOCIA")'); await p.waitForTimeout(250);
    ok(await p.$eval('input[name="ajURol"][value="admin"]', x => x.checked), 'otro administrador: su ficha muestra Administrador');
    ok(await p.$eval('#ajUTel', x => x.value) === '8095550101', 'ficha muestra el WhatsApp guardado');
    await p.fill('#ajUNom', 'Ana Socia Pérez'); await p.click('#ajUBtn'); await p.waitForTimeout(500);
    const act2 = llamadas.filter(l => l[0] === 'fn' && l[2].accion === 'actualizar' && l[2].usuario_id === 'us-adm2').pop();
    ok(!!act2 && act2[2].rol === 'admin', 'guardar a otro administrador conserva su rol (antes lo bajaba a Gerente)');
    // Restablecer clave → mensaje de WhatsApp
    await p.click('.ajUsrF:has-text("MARIA")'); await p.waitForTimeout(250);
    await p.click('#ajUReset'); await p.waitForTimeout(500);
    const cl = llamadas.find(l => l[0] === 'fn' && l[2].accion === 'clave');
    ok(!!cl && cl[2].pedir_cambio === true && String(cl[2].clave).length >= 8, 'restablecer clave: temporal de 8+ y pide cambiarla');
    ok(/restablecimos tu acceso/.test(await p.textContent('#ajUMsj')) && (await p.textContent('#ajUMsj')).indexOf(cl[2].clave) >= 0, 'mensaje de acceso con la clave temporal');
    await p.click('#nxAjUsrM .nxBack'); await p.waitForTimeout(150);
    // Uno mismo
    await p.click('.ajUsrF:has-text("ESTERLIN")'); await p.waitForTimeout(250);
    ok(await p.$eval('input[name="ajURol"][value="admin"]', x => x.disabled) && !(await p.$('#nxAjUsrM button:has-text("Desactivar")')), 'a uno mismo: no cambia su rol ni se desactiva');
    await p.click('#nxAjUsrM .nxBack'); await p.waitForTimeout(150);
    // Nuevo usuario
    await p.click('.ajUsrBarra button:has-text("Nuevo usuario")'); await p.waitForTimeout(300);
    await p.fill('#ajUNom', 'Laura Jiménez'); await p.waitForTimeout(80);
    ok(await p.$eval('#ajULogin', x => x.value) === 'laura.j', 'usuario sugerido con el nombre (laura.j)');
    ok(await p.$eval('#ajUClave', x => x.type === 'password' && x.value.length >= 8), 'clave temporal oculta, 8+ caracteres');
    await p.fill('#ajUTel', '809 555'); await p.click('#ajUBtn'); await p.waitForTimeout(300);
    ok(!llamadas.some(l => l[0] === 'fn' && l[2].accion === 'crear') && /10 dígitos/.test(await p.textContent('#ajUErr')), 'WhatsApp incompleto: no crea y lo dice en la ficha');
    await p.fill('#ajUTel', '809 555 0199'); await p.click('#ajUBtn'); await p.waitForTimeout(600);
    const cr = llamadas.find(l => l[0] === 'fn' && l[2].accion === 'crear');
    ok(!!cr && cr[2].login === 'laura.j' && cr[2].telefono === '8095550199' && cr[2].pedir_cambio === true, 'crear → servidor con WhatsApp y cambio de clave al entrar');
    const wa = await p.$eval('#nxAjUsrM a.ajWa', x => x.href);
    ok(wa.indexOf('https://wa.me/18095550199?text=') === 0 && decodeURIComponent(wa).indexOf('Usuario: laura.j') > 0 && decodeURIComponent(wa).indexOf('studiord.net/app') > 0, 'Enviar por WhatsApp: al número del empleado con enlace, usuario y clave');
    await p.screenshot({ path: `${OUT}/cfg-acceso-wa-${w}.png` });
    await p.click('#nxAjUsrM .nxBack'); await p.waitForTimeout(150);
    await p.click('.ajTabs button:has-text("Roles y permisos")'); await p.waitForTimeout(300);
    ok(!!(await p.$('button:has-text("Nuevo rol")')), 'pestaña Roles y permisos');
    await p.click('.ajTabs button:has-text("Usuarios")'); await p.waitForTimeout(200);
    // Aviso de permisos: botón Guardar permisos
    await p.click('.ajVolver'); await p.waitForTimeout(250);
    await p.click('.ajAv:has-text("permisos por rol")'); await p.waitForTimeout(600);
    ok(llamadas.some(l => l[0] === 'POST' && l[1] === 'pos_acceso'), 'aviso de permisos → guarda los roles en el servidor');
    // Documentos usan los datos de la empresa
    const emp = await p.evaluate(() => { const d = document.createElement('div'); return window.nxPosCtx && true; });
    ok(errs.length === 0, 'sin errores de página' + (errs.length ? ': ' + errs.join(' | ') : ''));
    await p.close();
  }
  await b.close();
  console.log(`\n${fallos ? 'FALLAS: ' + fallos : 'TODO OK'}`); process.exitCode = fallos ? 1 : 0;
})();
