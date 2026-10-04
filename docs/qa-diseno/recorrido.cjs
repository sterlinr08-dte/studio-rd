// Recorrido de diseño de STUDIO (04-oct-2026): abre cada módulo con datos de ejemplo (base Supabase SIMULADA; nunca toca
// la real) y guarda capturas en iPhone (390×844) y computadora (1280×860). Sirve para comparar antes/después.
// Uso: desde la raíz del repo, python3 -m http.server 8790 & ; OUT=/ruta node docs/qa-diseno/recorrido.cjs [390|1280] [modulo…]
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const OUT = process.env.OUT || require('os').tmpdir() + '/recorrido';
const APP_URL = process.env.QA_URL || 'http://localhost:8790/index.html';
const TAMANOS = process.argv[2] ? [Number(process.argv[2])] : [390, 1280];
const SOLO = process.argv.slice(3);
const ICONOS = process.env.ICONOS || '';   // carpeta con tabler.css y tabler.woff2 (el navegador de pruebas no sale a la CDN)
const hace = d => new Date(Date.now() - d * 864e5).toISOString();
const dia = d => hace(d).slice(0, 10);

function db() {
  const cli = [['MARÍA RODRÍGUEZ', '402-1234567-8', '8095551234'], ['JOSÉ PÉREZ', '031-7654321-0', '8295559876'], ['ANA GÓMEZ', '001-1112223-4', '8495553311'],
    ['LUIS FERNÁNDEZ', '031-0001112-2', '8095557788'], ['CARMEN DÍAZ', '402-9998887-6', '8295554422']]
    .map((c, i) => ({ id: 'cli' + i, codigo: 'C-' + (100 + i), nombre: c[0], cedula: c[1], telefono: c[2], activo: true, es_cliente: true, created_at: hace(30 - i) }));
  const prods = [['TV Samsung 55" Crystal UHD 4K', 32500, 38900, 6, 'TV55'], ['Aire Inverter 12,000 BTU', 27900, 33500, 4, 'AA12'], ['iPhone 15 128GB Negro', 52900, 61900, 3, 'IP15'],
    ['Patineta eléctrica Xiaomi 4 Pro', 24900, 29900, 2, 'PX4'], ['Bocina JBL Flip 6', 6900, 7900, 12, 'JBL6'], ['Cargador USB-C 20W', 650, 790, 40, 'CH20'], ['Nevera Midea 14 pies', 38900, 45900, 0, 'NV14']]
    .map((p, i) => ({ id: 'p' + i, codigo: p[4], nombre: p[0], precio: p[1], precio_credito: p[2], costo: Math.round(p[1] * .72), stock: p[3], stock_min: 2, activo: true, tipo: 'producto', categoria_id: 'cat' + (i % 3), marca: ['Samsung', 'Midea', 'Apple', 'Xiaomi', 'JBL', 'Anker', 'Midea'][i] }));
  const ventas = Array.from({ length: 9 }, (_, i) => ({ id: 'v' + i, numero: 1200 + i, numero_factura: (i % 3 ? 'CO-' : 'CR-') + (1200 + i), fecha: hace(i * 0.7), created_at: hace(i * 0.7),
    cliente_id: 'cli' + (i % 5), cliente_nombre: cli[i % 5].nombre, subtotal: 6000 + i * 3100, itbis: 0, total: 6000 + i * 3100, metodo_pago: ['Efectivo', 'Tarjeta', 'Transferencia'][i % 3],
    pagado_efectivo: i % 3 === 0 ? 6000 + i * 3100 : 0, pagado_tarjeta: i % 3 === 1 ? 6000 + i * 3100 : 0, pagado_transferencia: i % 3 === 2 ? 6000 + i * 3100 : 0, credito_monto: i % 3 ? 0 : 2000 + i * 500,
    a_credito: !(i % 3), estado: i === 7 ? 'anulada' : 'completada', caja_id: 'caja1', almacen_id: 'a1', tipo_comprobante: 'B02', ncf: 'B02000000' + (100 + i), vendedor_nombre: 'ESTERLIN' }));
  return {
    profiles: [{ id: 'auth-1', usuario_sistema_id: 'us-admin', nom: 'ESTERLIN', login: 'admin', rol: 'admin', activo: true, must_change_password: false }],
    organizaciones: [{ id: 'org1', slug: 'studio', nombre: 'STUDIO', tipo: 'tienda', activo: true }],
    pos_config: [{ organizacion_id: 'org1', prefijo_contado: 'CO', prefijo_credito: 'CR', mora_pct: 5, mora_dias_gracia: 3, garantia_rep_dias: 30, financiamiento_v2: true, compras_v2: true, reacondicionado: true, emp_nombre: 'STUDIO RD', emp_rnc: '1-32-00000-1' }],
    usuarios_sistema: [{ id: 'us-admin', nom: 'ESTERLIN', login: 'admin', rol: 'admin', activo: true, organizacion_id: 'org1', almacen_id: 'a1' },
      { id: 'us-2', nom: 'ERIKA REYES', login: 'erika', rol: 'cajero', activo: true, almacen_id: 'a1' }, { id: 'us-3', nom: 'CARLOS PEÑA', login: 'carlos', rol: 'vendedor', activo: true }],
    pos_acceso: [], pos_almacenes: [{ id: 'a1', nombre: 'Edificio Studio', es_principal: true, activo: true }, { id: 'a2', nombre: 'Villa Vázquez', activo: true }],
    pos_categorias: [{ id: 'cat0', nombre: 'Televisores', orden: 1 }, { id: 'cat1', nombre: 'Climatización', orden: 2 }, { id: 'cat2', nombre: 'Celulares', orden: 3 }],
    pos_productos: prods, pos_stock_almacen: prods.map(p => ({ producto_id: p.id, almacen_id: 'a1', stock: p.stock })),
    pos_clientes: cli, pos_proveedores: [{ id: 'pv1', nombre: 'Importadora del Caribe', rnc: '1-01-55555-5', telefono: '8095550000', activo: true }],
    pos_cajas: [{ id: 'caja1', estado: 'abierta', usuario_id: 'auth-1', usuario_nombre: 'ESTERLIN', apertura: hace(0.3), monto_inicial: 5000 }],
    pos_caja_movimientos: [{ id: 'm1', caja_id: 'caja1', tipo: 'salida', concepto: 'Pago de delivery', monto: 500, created_at: hace(0.1) }],
    pos_ventas: ventas, pos_venta_items: ventas.map((v, i) => ({ id: 'vi' + i, venta_id: v.id, producto_id: 'p' + (i % 7), nombre: prods[i % 7].nombre, cantidad: 1, precio: v.total, itbis: 0 })),
    pos_abonos: [{ id: 'ab1', cliente_id: 'cli0', monto: 1500, fecha: dia(3), metodo: 'Efectivo', numero: 'REC-00581' }],
    pos_reparaciones: [{ id: 'r1', numero: 'R-301', cliente_nombre: 'JOSÉ PÉREZ', cliente_telefono: '8295559876', equipo: 'iPhone 13 Pro', falla: 'Pantalla rota', estado: 'en_reparacion', costo: 7500, created_at: hace(2) },
      { id: 'r2', numero: 'R-302', cliente_nombre: 'ANA GÓMEZ', cliente_telefono: '8495553311', equipo: 'Samsung A54', falla: 'No carga', estado: 'recibido', costo: 2500, created_at: hace(1) }],
    pos_cotizaciones: [{ id: 'q1', numero: 'COT-55', cliente_nombre: 'LUIS FERNÁNDEZ', total: 61900, estado: 'vigente', validez_dias: 15, created_at: hace(2) }],
    pos_compras: [{ id: 'cp1', numero: 'OC-12', proveedor_id: 'pv1', proveedor_nombre: 'Importadora del Caribe', total: 185000, estado: 'recibida', fecha: dia(5), created_at: hace(5) }],
    pos_apartados: [{ id: 'ap1', numero: 'AP-8', cliente_nombre: 'CARMEN DÍAZ', total: 29900, pagado: 10000, estado: 'activo', created_at: hace(6) }],
    pos_fin_planes: [{ id: 'pl1', nombre: 'Plazo fijo', metodo: 'plano', frecuencia: 'mensual', num_cuotas: 12, cuotas_fase1: 0, tasa1: 7, tasa2: 0, mora_tipo: 'fija', mora_valor: 2, mora_dias_gracia: 3, inicial_min_pct: 0, activo: true }],
    pos_financiamientos: [{ id: 'f1', codigo: 'FIN-1', venta_id: 'v0', cliente_id: 'cli0', cliente_nombre: 'MARÍA RODRÍGUEZ', descripcion: 'TV Samsung 55"', monto_total: 38900, inicial: 5000, monto_financiado: 33900, interes_total: 28476, cuotas_total: 12, cuota_monto: 5198, frecuencia: 'mensual', estado: 'activo', plan_id: 'pl1', created_at: hace(40), primera_fecha: dia(10) }],
    pos_fin_cuotas: Array.from({ length: 12 }, (_, i) => ({ id: 'fc' + i, financiamiento_id: 'f1', numero: i + 1, fecha_venc: new Date(Date.now() + (i * 30 - 10) * 864e5).toISOString().slice(0, 10), monto: 5198, capital: 2825, interes: 2373, monto_pagado: i === 0 ? 5198 : 0, pagado: i === 0 })),
    pos_fin_pagos: [], pos_fin_solicitudes: [],
    pos_secuencias: [{ id: 's1', tipo: 'recibo', prefijo: 'REC-', longitud: 5, proximo: 582, activo: true }],
    pos_ncf_secuencias: [{ id: 'n1', tipo: 'B02', prefijo: 'B02', desde: 1, hasta: 16500, actual: 16474, activo: true }],
    pos_cuentas: [['1101', 'Caja'], ['1102', 'Banco'], ['1103', 'Cuentas por cobrar'], ['4101', 'Ventas']].map((c, i) => ({ id: 'cu' + i, codigo: c[0], nombre: c[1], tipo: c[0][0] === '4' ? 'ingreso' : 'activo' })),
    pos_cuentas_bancarias: [{ id: 'cb1', alias: 'Banreservas', banco_nombre: 'Banreservas', activa: true }],
    rrhh_empleados: [{ id: 'e1', nombre: 'ERIKA REYES', cargo: 'Cajera', salario: 25000, activo: true }],
    pos_crm: [{ id: 'crm1', nombre: 'WhatsApp · MARÍA RODRÍGUEZ', etapa: 'nuevo', fuente: 'WhatsApp', telefono: '8095551234', created_at: hace(1) }]
  };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const MODS = SOLO.length ? SOLO : ['inicio', 'avisos', 'vender', 'factura', 'prefactura', 'reparaciones', 'reacond', 'productos', 'inventario', 'cotizaciones', 'compras', 'entidades', 'crm', 'clientes', 'caja', 'cuotas', 'apartados', 'ventas', 'notascredito', 'prefhist', 'reportes', 'contabilidad', 'rrhh', 'ajustes'];
  for (const W of TAMANOS) {
    const movil = W < 500, H = movil ? 844 : 860;
    const p = await b.newPage({ viewport: { width: W, height: H }, hasTouch: movil, isMobile: movil });
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    const D = db();
    if (ICONOS) {
      await p.route(/icons-webfont.*\.css/, r => r.fulfill({ status: 200, contentType: 'text/css', body: fs.readFileSync(ICONOS + '/tabler.css') }));
      await p.route(/icons-webfont.*\.woff2/, r => r.fulfill({ status: 200, contentType: 'font/woff2', body: fs.readFileSync(ICONOS + '/tabler.woff2') }));
    }
    await p.route(/sentry-cdn|emailjs/, r => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
    await p.route(/edbknlkjnlfmkkiizdbe\.supabase\.co/, async (route) => {
      const r = route.request(), u = new URL(r.url()), m = r.method();
      const send = (o, st = 200) => route.fulfill({ status: st, contentType: 'application/json', body: JSON.stringify(o) });
      if (u.pathname.startsWith('/auth/v1/user')) return send({ id: 'auth-1', email: 'admin@nexus-pro.local' });
      if (u.pathname.startsWith('/auth/v1/')) return send({ access_token: 'tok', refresh_token: 'r', expires_in: 3600, user: { id: 'auth-1' } });
      if (u.pathname.startsWith('/rest/v1/')) {
        const t = u.pathname.slice(9);
        if (t.startsWith('rpc/')) return send([]);
        if (m === 'GET') {
          let f = t === 'pos_ventas_fiado' ? D.pos_ventas.filter(v => v.credito_monto > 0 && v.estado !== 'anulada') : (D[t] || []);
          for (const [k, v] of u.searchParams) { if (/^(select|order|limit|offset)$/.test(k)) continue; const mm = /^eq\.(.*)$/.exec(v); if (mm) f = f.filter(x => String(x[k]) === decodeURIComponent(mm[1])); }
          const off = Number(u.searchParams.get('offset') || 0); return send(f.slice(off, off + 1000));
        }
        return send([]);
      }
      if (u.pathname.startsWith('/functions/v1/')) return send({ ok: true });
      return route.fulfill({ status: 204, body: '' });
    });
    await p.goto(APP_URL + '#access_token=tok&refresh_token=r&expires_in=3600');
    await p.waitForFunction(() => typeof window.nxPosTab === 'function' && window.nxPosCfgListo === true, null, { timeout: 30000 });
    await p.addStyleTag({ content: '#toastS{display:none!important}' });
    await p.waitForTimeout(1500);
    for (const mod of MODS) {
      try {
        await p.evaluate(m => { window.scrollTo(0, 0); window.nxPosTab(m); }, mod); await p.waitForTimeout(900);
        await p.screenshot({ path: `${OUT}/${W}-${mod}.png`, fullPage: !movil });
        if (movil) await p.screenshot({ path: `${OUT}/${W}-${mod}-completo.png`, fullPage: true });
        if (process.env.SONDA) console.log(W, mod, JSON.stringify(await p.evaluate(process.env.SONDA)));
        if (movil && process.env.FONDO) { await p.evaluate(() => { window.scrollTo(0, document.documentElement.scrollHeight); document.querySelectorAll('*').forEach(e => { const cs = getComputedStyle(e).overflowY; if ((cs === 'auto' || cs === 'scroll') && e.scrollHeight > e.clientHeight + 4) e.scrollTop = e.scrollHeight; }); }); await p.waitForTimeout(300); await p.screenshot({ path: `${OUT}/${W}-${mod}-fondo.png` }); }
      } catch (e) { console.log('FALLA', W, mod, e.message.slice(0, 120)); }
    }
    console.log(W, 'listo · errores JS:', errs.length ? [...new Set(errs)].join(' | ').slice(0, 400) : 'ninguno');
    await p.close();
  }
  await b.close();
})();
