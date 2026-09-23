/* STUDIO · Reportes (2026-09-23)
 * Pedido del dueño: «Vamos con los reportes, vamos a ordenar bien y completar todo lo que hace falta».
 * Módulo propio enganchado igual que Reacondicionado (window.nxReportes = { cargar, render, postRender }).
 * Solo LECTURA: no escribe nada en la base. Carga por rango de fechas y por páginas de 1,000 filas
 * (el reporte anterior pedía todo sin filtro y Supabase corta en 1,000 filas: se perdían ventas y líneas).
 * Costo de lo vendido = pos_venta_items.costo_unitario (costo al momento de la venta), no el costo actual.
 * Secciones: Resumen · Ventas · Productos · Inventario · Clientes y cobros · Compras · Caja · Fiscal · Taller.
 */
(function () {
  'use strict';
  if (window.nxReportes) return;
  function api() { try { return (typeof API !== 'undefined') ? API : window.API; } catch (e) { return window.API; } }
  function ctx() { return window.nxPosCtx || {}; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function n(v) { const x = Number(v); return isFinite(x) ? x : 0; }
  function fmt(v) { const r = Math.round(n(v)); return 'RD$ ' + (r === 0 ? 0 : r).toLocaleString('en-US'); }
  function fmtN(v) { return (Math.round(n(v) * 100) / 100).toLocaleString('en-US'); }
  function pct(a, b) { return b ? Math.round(a / b * 1000) / 10 : 0; }
  function toast(t, m, s) { try { window.toast && window.toast(t, m, s); } catch (e) {} }
  function hoyISO() { try { return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santo_Domingo' }); } catch (e) { return new Date().toISOString().slice(0, 10); } }
  function mesIni() { return hoyISO().slice(0, 8) + '01'; }
  function addDays(iso, d) { const t = new Date(iso + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10); }
  function diasEntre(a, b) { return Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 86400000); }
  // Fecha local RD (UTC-4) de un timestamp.
  function diaRD(ts) { if (!ts) return ''; const s = String(ts); if (s.length === 10) return s; try { return new Date(s).toLocaleDateString('en-CA', { timeZone: 'America/Santo_Domingo' }); } catch (e) { return s.slice(0, 10); } }
  function dmy(iso) { const d = diaRD(iso); return d ? d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4) : ''; }
  function tsDesde(d) { return encodeURIComponent(d + 'T00:00:00-04:00'); }
  function tsHasta(d) { return encodeURIComponent(addDays(d, 1) + 'T00:00:00-04:00'); }
  function puedeCosto() { try { const r = ctx().rolEfectivo ? ctx().rolEfectivo() : 'admin'; return r === 'admin' || r === 'gerente'; } catch (e) { return true; } }

  async function getAll(tabla, qs) {
    const out = []; const PAG = 1000;
    for (let off = 0; off < 60000; off += PAG) {
      const r = await api().get(tabla, qs + '&limit=' + PAG + '&offset=' + off) || [];
      out.push.apply(out, r);
      if (r.length < PAG) break;
    }
    return out;
  }

  const TABS = [
    ['resumen', 'Resumen', 'ti-layout-dashboard'], ['ventas', 'Ventas', 'ti-receipt'], ['productos', 'Productos', 'ti-box'],
    ['inventario', 'Inventario', 'ti-building-warehouse'], ['cobros', 'Clientes y cobros', 'ti-users'], ['compras', 'Compras', 'ti-truck-delivery'],
    ['caja', 'Caja', 'ti-cash'], ['fiscal', 'Fiscal', 'ti-file-certificate'], ['taller', 'Taller', 'ti-tool']
  ];
  let tab = 'resumen';
  try { const t = localStorage.getItem('studio_rep_tab'); if (t && TABS.some(x => x[0] === t)) tab = t; } catch (e) {}
  let desde = '', hasta = '', D = null, cargando = false, error = '';
  const tablas = {}; // id sección → { titulo, cols, filas } para exportar

  async function cargar() {
    if (!desde) desde = mesIni();
    if (!hasta) hasta = hoyISO();
    cargando = true; error = '';
    const largo = diasEntre(desde, hasta) + 1, pDesde = addDays(desde, -largo), pHasta = addDays(desde, -1);
    const rng = (col) => col + '=gte.' + tsDesde(desde) + '&' + col + '=lt.' + tsHasta(hasta);
    const rngD = (col) => col + '=gte.' + desde + '&' + col + '=lte.' + hasta;
    const pr = (p, def) => p.catch(() => def);
    try {
      const [ventas, previas, prods, cats, devol, abonos, creditos, abonosTodos, compras, cxp, cajas, cajaMov, asientos, reps, stockAlm, almacenes] = await Promise.all([
        getAll('pos_ventas', 'select=id,numero,numero_factura,fecha,cliente_id,cliente_nombre,subtotal,itbis,total,descuento,pagado_efectivo,pagado_tarjeta,pagado_transferencia,pagado_otro,credito_monto,a_credito,estado,vendedor_id,vendedor_nombre,created_by_name,ncf,tipo_comprobante,pos_venta_items(producto_id,nombre,cantidad,precio,importe,itbis,costo_unitario)&' + rng('fecha') + '&order=fecha.asc'),
        pr(getAll('pos_ventas', 'select=total,estado&estado=eq.completada&fecha=gte.' + tsDesde(pDesde) + '&fecha=lt.' + tsHasta(pHasta)), []),
        getAll('pos_productos', 'select=id,nombre,codigo,categoria_id,marca,costo,precio,stock,stock_min,tipo,activo,serial&order=nombre.asc'),
        pr(getAll('pos_categorias', 'select=id,nombre'), []),
        pr(getAll('pos_devoluciones', 'select=id,numero,ncf,fecha,cliente_nombre,subtotal,itbis,total,metodo,estado,venta_id&' + rngD('fecha')), []),
        pr(getAll('pos_abonos', 'select=id,fecha,monto,metodo,cliente_id,venta_id&' + rngD('fecha')), []),
        pr(getAll('pos_ventas', 'select=id,numero,numero_factura,fecha,cliente_id,cliente_nombre,credito_monto,credito_vencimiento&estado=eq.completada&a_credito=is.true'), []),
        pr(getAll('pos_abonos', 'select=venta_id,monto'), []),
        pr(getAll('pos_compras', 'select=id,numero,fecha,proveedor_nombre,ncf,subtotal,itbis,total,a_credito,estado,moneda,tasa,es_importacion,total_desembarcado&' + rngD('fecha')), []),
        pr(getAll('pos_cxp_v', 'select=*&saldo=gt.0'), []),
        pr(getAll('pos_cajas', 'select=id,apertura,cierre,estado,usuario_nombre,created_by_name,monto_inicial,efectivo_esperado,efectivo_contado,descuadre&' + rng('apertura') + '&order=apertura.desc'), []),
        pr(getAll('pos_caja_movimientos', 'select=tipo,monto,concepto,fecha&' + rng('fecha')), []),
        pr(getAll('pos_asientos', 'select=fecha,tipo,concepto,pos_asiento_lineas(cuenta_codigo,cuenta_nombre,debito,credito)&' + rngD('fecha')), []),
        pr(getAll('pos_reparaciones', 'select=numero,equipo,cliente_nombre,cobrado,cobrado_monto,costo_piezas,presupuesto,estado,entregado_at,created_at&' + rng('created_at')), []),
        pr(getAll('pos_stock_almacen', 'select=producto_id,almacen_id,stock'), []),
        pr(getAll('pos_almacenes', 'select=id,nombre,activo'), [])
      ]);
      D = { ventas, previas, prods, cats, devol, abonos, creditos, abonosTodos, compras, cxp, cajas, cajaMov, asientos, reps, stockAlm, almacenes };
    } catch (e) { error = String(e && e.message || e); D = null; }
    cargando = false;
  }

  function repintar() { try { ctx().renderPOS && ctx().renderPOS(); } catch (e) {} }

  // ── Cálculos ────────────────────────────────────────────────────────
  function calc() {
    const ven = D.ventas.filter(v => v.estado === 'completada');
    const anul = D.ventas.filter(v => v.estado !== 'completada');
    const dev = D.devol.filter(d => d.estado !== 'anulada');
    const prodBy = {}; D.prods.forEach(p => { prodBy[p.id] = p; });
    const catBy = {}; D.cats.forEach(c => { catBy[c.id] = c.nombre; });
    let bruto = 0, itbis = 0, costo = 0, cobradoContado = 0, credito = 0;
    const met = { Efectivo: 0, Tarjeta: 0, Transferencia: 0, Otro: 0, 'A crédito': 0 };
    const porDia = {}, porProd = {}, porCat = {}, porVend = {}, porCli = {}, porTipo = { Contado: { n: 0, t: 0 }, 'A crédito': { n: 0, t: 0 } };
    ven.forEach(v => {
      const t = n(v.total); bruto += t; itbis += n(v.itbis);
      const d = diaRD(v.fecha); porDia[d] = (porDia[d] || 0) + t;
      met.Efectivo += n(v.pagado_efectivo); met.Tarjeta += n(v.pagado_tarjeta); met.Transferencia += n(v.pagado_transferencia); met.Otro += n(v.pagado_otro); met['A crédito'] += n(v.credito_monto);
      credito += n(v.credito_monto); cobradoContado += t - n(v.credito_monto);
      const tp = n(v.credito_monto) > 0 ? 'A crédito' : 'Contado'; porTipo[tp].n++; porTipo[tp].t += t;
      const vd = v.vendedor_nombre || v.created_by_name || 'Sin vendedor'; porVend[vd] = porVend[vd] || { n: 0, t: 0, g: 0 }; porVend[vd].n++; porVend[vd].t += t;
      const ck = v.cliente_id || ('n:' + (v.cliente_nombre || 'Consumidor final')); porCli[ck] = porCli[ck] || { nom: v.cliente_nombre || 'Consumidor final', n: 0, t: 0 }; porCli[ck].n++; porCli[ck].t += t;
      (v.pos_venta_items || []).forEach(it => {
        const c = n(it.cantidad), imp = it.importe != null ? n(it.importe) : n(it.precio) * c;
        const sinItb = it.itbis ? imp / 1.18 : imp;
        const p = prodBy[it.producto_id];
        const cu = it.costo_unitario != null ? n(it.costo_unitario) : n(p && p.costo);
        const cst = (p && p.tipo === 'servicio') ? 0 : cu * c;
        costo += cst;
        const k = it.producto_id || it.nombre;
        porProd[k] = porProd[k] || { nom: it.nombre || (p && p.nombre) || '—', cod: p ? (p.codigo || '') : '', cant: 0, monto: 0, costo: 0, gan: 0 };
        porProd[k].cant += c; porProd[k].monto += imp; porProd[k].costo += cst; porProd[k].gan += sinItb - cst;
        const cat = p && p.categoria_id ? (catBy[p.categoria_id] || 'Sin categoría') : 'Sin categoría';
        porCat[cat] = porCat[cat] || { cant: 0, monto: 0, gan: 0 }; porCat[cat].cant += c; porCat[cat].monto += imp; porCat[cat].gan += sinItb - cst;
        porVend[vd].g += sinItb - cst;
      });
    });
    const devTot = dev.reduce((s, d) => s + n(d.total), 0), devItb = dev.reduce((s, d) => s + n(d.itbis), 0);
    const netas = bruto - devTot, netasSinItb = (bruto - itbis) - (devTot - devItb);
    const ganBruta = netasSinItb - costo;
    // Gastos del período: cuentas 6xxx de los asientos (gastos, nómina, salidas de caja, descuadres).
    let gastos = 0; const porGasto = {};
    D.asientos.forEach(a => (a.pos_asiento_lineas || []).forEach(l => {
      if (!String(l.cuenta_codigo || '').startsWith('6')) return;
      const m = n(l.debito) - n(l.credito); gastos += m; const k = l.cuenta_codigo + ' · ' + (l.cuenta_nombre || ''); porGasto[k] = (porGasto[k] || 0) + m;
    }));
    const cobrosAbonos = D.abonos.filter(a => n(a.monto) > 0 && !/ajuste|nota de cr/i.test(a.metodo || '')).reduce((s, a) => s + n(a.monto), 0);
    const previo = D.previas.reduce((s, v) => s + n(v.total), 0);
    // Cuentas por cobrar (hoy) por antigüedad, por factura.
    const pagado = {}; D.abonosTodos.forEach(a => { if (a.venta_id) pagado[a.venta_id] = (pagado[a.venta_id] || 0) + n(a.monto); });
    const hoy = hoyISO(); const cxc = []; const tramos = { 'Al día': 0, '1–30 días': 0, '31–60 días': 0, '61–90 días': 0, 'Más de 90': 0 };
    D.creditos.forEach(v => {
      const saldo = n(v.credito_monto) - n(pagado[v.id]); if (saldo <= 0.5) return;
      const vence = v.credito_vencimiento || addDays(diaRD(v.fecha), 30);
      const dias = diasEntre(vence, hoy);
      const tr = dias <= 0 ? 'Al día' : dias <= 30 ? '1–30 días' : dias <= 60 ? '31–60 días' : dias <= 90 ? '61–90 días' : 'Más de 90';
      tramos[tr] += saldo; cxc.push({ v, saldo, vence, dias, tr });
    });
    const cxcTot = cxc.reduce((s, x) => s + x.saldo, 0);
    return { ven, anul, dev, bruto, itbis, costo, netas, netasSinItb, ganBruta, gastos, porGasto, devTot, devItb, met, porDia, porProd, porCat, porVend, porCli, porTipo, cobradoContado, credito, cobrosAbonos, previo, cxc, tramos, cxcTot, prodBy };
  }

  // ── Piezas de UI ────────────────────────────────────────────────────
  function kpi(l, v, sub, tono) { return `<div class="nxRpK${tono ? ' ' + tono : ''}"><span>${esc(l)}</span><b>${v}</b>${sub ? `<small>${sub}</small>` : ''}</div>`; }
  function variacion(a, b) { if (!b) return ''; const d = pct(a - b, b); return `<em class="${d >= 0 ? 'up' : 'dn'}">${d >= 0 ? '▲' : '▼'} ${Math.abs(d)}% vs. período anterior</em>`; }
  function tabla(id, titulo, cols, filas, opts) {
    opts = opts || {};
    tablas[id] = { titulo, cols, filas };
    const head = cols.map(c => `<th class="${c.r ? 'r' : ''}">${esc(c.l)}</th>`).join('');
    const max = opts.max || 200;
    const body = filas.length ? filas.slice(0, max).map(f => `<tr>${cols.map((c, i) => `<td class="${c.r ? 'r' : ''}${c.m ? ' m' : ''}">${c.fmt ? c.fmt(f[i]) : esc(f[i])}</td>`).join('')}</tr>`).join('')
      : `<tr><td colspan="${cols.length}" class="vac">${esc(opts.vacio || 'Sin datos en el período.')}</td></tr>`;
    const pie = opts.pie ? `<tfoot><tr>${opts.pie.map((p, i) => `<td class="${cols[i] && cols[i].r ? 'r' : ''}">${p}</td>`).join('')}</tr></tfoot>` : '';
    return `<section class="nxRpCard"><header><h3>${esc(titulo)}</h3><div class="nxRpAcc">${filas.length > max ? `<span class="nxRpNote">Mostrando ${max} de ${filas.length}</span>` : ''}<button type="button" class="btn bsm bghost" onclick="window.nxReportes.csv('${id}')"><i class="ti ti-file-spreadsheet"></i> Excel</button></div></header>
      <div class="nxRpTw"><table class="nxRpT"><thead><tr>${head}</tr></thead><tbody>${body}</tbody>${pie}</table></div>${opts.nota ? `<p class="nxRpNote">${opts.nota}</p>` : ''}</section>`;
  }
  function barras(porDia) {
    const dias = []; for (let d = desde; d <= hasta && dias.length < 400; d = addDays(d, 1)) dias.push(d);
    let serie;
    if (dias.length <= 45) serie = dias.map(d => [d.slice(8) + '/' + d.slice(5, 7), n(porDia[d])]);
    else { const m = {}; dias.forEach(d => { const k = d.slice(0, 7); m[k] = (m[k] || 0) + n(porDia[d]); }); serie = Object.keys(m).map(k => [k.slice(5) + '/' + k.slice(2, 4), m[k]]); }
    const mx = Math.max(1, ...serie.map(s => s[1]));
    const paso = Math.max(1, Math.ceil(serie.length / 12));
    return `<div class="nxRpBars" role="img" aria-label="Ventas por ${dias.length <= 45 ? 'día' : 'mes'}">${serie.map((s, i) => `<div class="b" title="${esc(s[0])}: ${fmt(s[1])}"><i style="height:${Math.max(2, Math.round(s[1] / mx * 100))}%"></i>${(i % paso === 0 || i === serie.length - 1) ? `<span>${esc(s[0])}</span>` : ''}</div>`).join('')}</div>`;
  }
  function metodos(met) {
    const tot = Object.values(met).reduce((a, b) => a + b, 0) || 1;
    return Object.entries(met).filter(e => e[1] > 0).map(([k, v]) => `<div class="nxRpMet"><div><span>${esc(k)}</span><b>${fmt(v)}</b></div><div class="bar"><i style="width:${pct(v, tot)}%"></i></div></div>`).join('') || '<p class="nxRpNote">Sin cobros en el período.</p>';
  }

  // ── Secciones ───────────────────────────────────────────────────────
  function secResumen(C) {
    const vc = puedeCosto();
    return `<div class="nxRpKpis">
        ${kpi('Ventas netas', fmt(C.netas), variacion(C.bruto, C.previo) || (C.devTot ? 'Devoluciones: ' + fmt(C.devTot) : ''), 'main')}
        ${vc ? kpi('Ganancia bruta', fmt(C.ganBruta), 'Margen ' + pct(C.ganBruta, C.netasSinItb) + '% sobre ventas sin ITBIS', C.ganBruta >= 0 ? 'ok' : 'bad') : ''}
        ${vc ? kpi('Gastos del período', fmt(C.gastos), 'Resultado: ' + fmt(C.ganBruta - C.gastos), '') : ''}
        ${kpi('Cobrado', fmt(C.cobradoContado + C.cobrosAbonos), 'Contado ' + fmt(C.cobradoContado) + ' · Abonos ' + fmt(C.cobrosAbonos), '')}
        ${kpi('Por cobrar hoy', fmt(C.cxcTot), C.cxc.length + ' factura(s) con saldo', C.tramos['Más de 90'] > 0 ? 'warn' : '')}
        ${kpi('Ventas', String(C.ven.length), 'Ticket promedio ' + fmt(C.ven.length ? C.bruto / C.ven.length : 0) + (C.anul.length ? ' · ' + C.anul.length + ' anulada(s)' : ''), '')}
      </div>
      <div class="nxRpGrid2">
        <section class="nxRpCard"><header><h3>Ventas por ${diasEntre(desde, hasta) <= 44 ? 'día' : 'mes'}</h3></header>${barras(C.porDia)}</section>
        <section class="nxRpCard"><header><h3>Cómo se cobró</h3></header>${metodos(C.met)}</section>
      </div>
      ${vc ? `<section class="nxRpCard"><header><h3>Estado de resultados del período</h3></header>
        <table class="nxRpT nxRpER"><tbody>
          <tr><td>Ventas (con ITBIS)</td><td class="r">${fmt(C.bruto)}</td></tr>
          <tr><td>− Devoluciones</td><td class="r">${fmt(C.devTot)}</td></tr>
          <tr><td>− ITBIS incluido</td><td class="r">${fmt(C.itbis - C.devItb)}</td></tr>
          <tr class="s"><td>Ventas netas sin ITBIS</td><td class="r">${fmt(C.netasSinItb)}</td></tr>
          <tr><td>− Costo de lo vendido</td><td class="r">${fmt(C.costo)}</td></tr>
          <tr class="s"><td>Ganancia bruta</td><td class="r">${fmt(C.ganBruta)}</td></tr>
          <tr><td>− Gastos (cuentas 6xxx)</td><td class="r">${fmt(C.gastos)}</td></tr>
          <tr class="t"><td>Resultado del período</td><td class="r">${fmt(C.ganBruta - C.gastos)}</td></tr>
        </tbody></table><p class="nxRpNote">El costo es el que tenía cada artículo al venderse. Los gastos salen de Contabilidad (gastos, nómina, salidas de caja).</p></section>` : ''}`;
  }
  function secVentas(C) {
    const vc = puedeCosto();
    const dias = Object.keys(C.porDia).sort();
    const filasDia = dias.map(d => { const vs = C.ven.filter(v => diaRD(v.fecha) === d); return [dmy(d), vs.length, C.porDia[d], vs.reduce((s, v) => s + n(v.itbis), 0)]; });
    const vend = Object.entries(C.porVend).sort((a, b) => b[1].t - a[1].t).map(([k, o]) => vc ? [k, o.n, o.t, o.n ? o.t / o.n : 0, o.g] : [k, o.n, o.t, o.n ? o.t / o.n : 0]);
    const tipos = Object.entries(C.porTipo).map(([k, o]) => [k, o.n, o.t, pct(o.t, C.bruto) + '%']);
    const facturas = C.ven.slice().reverse().map(v => [dmy(v.fecha), v.numero_factura || v.numero || '', v.ncf || '', v.cliente_nombre || 'Consumidor final', v.vendedor_nombre || v.created_by_name || '', n(v.credito_monto) > 0 ? 'Crédito' : 'Contado', v.total]);
    const $ = { l: '', r: 1, fmt: fmt };
    return tabla('ven_dia', 'Ventas por día', [{ l: 'Fecha' }, { l: 'Ventas', r: 1 }, Object.assign({}, $, { l: 'Total' }), Object.assign({}, $, { l: 'ITBIS' })], filasDia, { pie: ['Total', C.ven.length, fmt(C.bruto), fmt(C.itbis)] })
      + tabla('ven_vend', 'Ventas por vendedor', [{ l: 'Vendedor' }, { l: 'Ventas', r: 1 }, Object.assign({}, $, { l: 'Total' }), Object.assign({}, $, { l: 'Ticket promedio' })].concat(vc ? [Object.assign({}, $, { l: 'Ganancia' })] : []), vend)
      + tabla('ven_tipo', 'Contado y crédito', [{ l: 'Tipo' }, { l: 'Ventas', r: 1 }, Object.assign({}, $, { l: 'Total' }), { l: '% del total', r: 1 }], tipos)
      + tabla('ven_fact', 'Facturas del período', [{ l: 'Fecha' }, { l: 'Factura', m: 1 }, { l: 'NCF', m: 1 }, { l: 'Cliente' }, { l: 'Vendedor' }, { l: 'Tipo' }, Object.assign({}, $, { l: 'Total' })], facturas, { max: 300 })
      + (C.anul.length ? tabla('ven_anul', 'Facturas anuladas', [{ l: 'Fecha' }, { l: 'Factura', m: 1 }, { l: 'Cliente' }, Object.assign({}, $, { l: 'Total' })], C.anul.map(v => [dmy(v.fecha), v.numero_factura || v.numero || '', v.cliente_nombre || '', v.total])) : '')
      + (C.dev.length ? tabla('ven_dev', 'Devoluciones y notas de crédito', [{ l: 'Fecha' }, { l: 'Número', m: 1 }, { l: 'NCF', m: 1 }, { l: 'Cliente' }, { l: 'Método' }, Object.assign({}, $, { l: 'Total' })], C.dev.map(d => [dmy(d.fecha), d.numero || '', d.ncf || '', d.cliente_nombre || '', d.metodo || '', d.total]), { pie: ['Total', '', '', '', '', fmt(C.devTot)] }) : '');
  }
  function secProductos(C) {
    const vc = puedeCosto(); const $ = { r: 1, fmt: fmt };
    const arr = Object.values(C.porProd);
    const top = arr.slice().sort((a, b) => b.monto - a.monto).map(o => vc ? [o.cod, o.nom, fmtN(o.cant), o.monto, o.costo, o.gan, pct(o.gan, o.monto / 1.18 || 1) + '%'] : [o.cod, o.nom, fmtN(o.cant), o.monto]);
    const cols = [{ l: 'Código', m: 1 }, { l: 'Artículo' }, { l: 'Cant.', r: 1 }, Object.assign({ l: 'Vendido' }, $)].concat(vc ? [Object.assign({ l: 'Costo' }, $), Object.assign({ l: 'Ganancia' }, $), { l: 'Margen', r: 1 }] : []);
    const cats = Object.entries(C.porCat).sort((a, b) => b[1].monto - a[1].monto).map(([k, o]) => vc ? [k, fmtN(o.cant), o.monto, o.gan, pct(o.monto, C.bruto) + '%'] : [k, fmtN(o.cant), o.monto, pct(o.monto, C.bruto) + '%']);
    const vendidos = new Set(Object.keys(C.porProd));
    const sinVenta = D.prods.filter(p => p.activo !== false && p.tipo !== 'servicio' && n(p.stock) > 0 && !vendidos.has(p.id)).sort((a, b) => n(b.stock) * n(b.costo) - n(a.stock) * n(a.costo))
      .map(p => vc ? [p.codigo || '', p.nombre, fmtN(p.stock), n(p.stock) * n(p.costo)] : [p.codigo || '', p.nombre, fmtN(p.stock)]);
    return tabla('pro_top', 'Artículos vendidos (de más a menos)', cols, top, { max: 300 })
      + tabla('pro_cat', 'Ventas por categoría', [{ l: 'Categoría' }, { l: 'Cant.', r: 1 }, Object.assign({ l: 'Vendido' }, $)].concat(vc ? [Object.assign({ l: 'Ganancia' }, $)] : []).concat([{ l: '% del total', r: 1 }]), cats)
      + tabla('pro_sin', 'Artículos con existencia que no se vendieron en el período', [{ l: 'Código', m: 1 }, { l: 'Artículo' }, { l: 'Existencia', r: 1 }].concat(vc ? [Object.assign({ l: 'Dinero detenido (costo)' }, $)] : []), sinVenta, { max: 200, vacio: 'Todos los artículos con existencia tuvieron ventas.' });
  }
  function secInventario() {
    const vc = puedeCosto(); const $ = { r: 1, fmt: fmt };
    const act = D.prods.filter(p => p.activo !== false && p.tipo !== 'servicio');
    let vCosto = 0, vPrecio = 0, unidades = 0;
    act.forEach(p => { const s = Math.max(0, n(p.stock)); unidades += s; vCosto += s * n(p.costo); vPrecio += s * n(p.precio); });
    const bajo = act.filter(p => n(p.stock) <= 0 || (n(p.stock_min) > 0 && n(p.stock) <= n(p.stock_min))).map(p => [p.codigo || '', p.nombre, fmtN(p.stock), fmtN(p.stock_min), n(p.stock) <= 0 ? 'Agotado' : 'Bajo']);
    const almBy = {}; D.almacenes.forEach(a => { almBy[a.id] = a.nombre; });
    const prodBy = C_prod(); const porAlm = {};
    D.stockAlm.forEach(s => { const p = prodBy[s.producto_id]; if (!p || p.tipo === 'servicio') return; const k = almBy[s.almacen_id] || 'Sin almacén'; porAlm[k] = porAlm[k] || { u: 0, c: 0, p: 0 }; const q = Math.max(0, n(s.stock)); porAlm[k].u += q; porAlm[k].c += q * n(p.costo); porAlm[k].p += q * n(p.precio); });
    const alm = Object.entries(porAlm).sort((a, b) => b[1].c - a[1].c).map(([k, o]) => vc ? [k, fmtN(o.u), o.c, o.p] : [k, fmtN(o.u), o.p]);
    const valor = act.filter(p => n(p.stock) > 0).sort((a, b) => n(b.stock) * n(b.costo) - n(a.stock) * n(a.costo)).map(p => vc ? [p.codigo || '', p.nombre, fmtN(p.stock), n(p.costo), n(p.stock) * n(p.costo), n(p.stock) * n(p.precio)] : [p.codigo || '', p.nombre, fmtN(p.stock), n(p.stock) * n(p.precio)]);
    return `<div class="nxRpKpis">${vc ? kpi('Valor al costo', fmt(vCosto), 'Lo que costó la mercancía en existencia', 'main') : ''}${kpi('Valor a precio de venta', fmt(vPrecio), vc ? 'Ganancia potencial ' + fmt(vPrecio / 1.18 - vCosto) : '', '')}${kpi('Unidades en existencia', fmtN(unidades), act.length + ' artículos activos', '')}${kpi('Agotados o bajos', String(bajo.length), 'Revisa la lista abajo', bajo.length ? 'warn' : '')}</div>`
      + (alm.length ? tabla('inv_alm', 'Existencia por almacén', [{ l: 'Almacén' }, { l: 'Unidades', r: 1 }].concat(vc ? [Object.assign({ l: 'Valor al costo' }, $)] : []).concat([Object.assign({ l: 'Valor a precio' }, $)]), alm) : '')
      + tabla('inv_bajo', 'Agotados y bajo el mínimo', [{ l: 'Código', m: 1 }, { l: 'Artículo' }, { l: 'Existencia', r: 1 }, { l: 'Mínimo', r: 1 }, { l: 'Estado' }], bajo, { vacio: 'No hay artículos agotados ni bajo el mínimo.' })
      + tabla('inv_val', 'Inventario valorizado', [{ l: 'Código', m: 1 }, { l: 'Artículo' }, { l: 'Existencia', r: 1 }].concat(vc ? [Object.assign({ l: 'Costo unit.' }, $), Object.assign({ l: 'Valor al costo' }, $)] : []).concat([Object.assign({ l: 'Valor a precio' }, $)]), valor, { max: 300, nota: 'Existencia y costo actuales (no dependen del rango de fechas).' });
  }
  function C_prod() { const m = {}; D.prods.forEach(p => { m[p.id] = p; }); return m; }
  function secCobros(C) {
    const $ = { r: 1, fmt: fmt };
    const tr = Object.entries(C.tramos).map(([k, v]) => [k, v, pct(v, C.cxcTot) + '%']);
    const porCli = {}; C.cxc.forEach(x => { const k = x.v.cliente_id || x.v.cliente_nombre; porCli[k] = porCli[k] || { nom: x.v.cliente_nombre || '—', n: 0, s: 0, mx: 0 }; porCli[k].n++; porCli[k].s += x.saldo; porCli[k].mx = Math.max(porCli[k].mx, x.dias); });
    const cli = Object.values(porCli).sort((a, b) => b.s - a.s).map(o => [o.nom, o.n, o.s, o.mx > 0 ? o.mx + ' días' : 'Al día']);
    const det = C.cxc.slice().sort((a, b) => b.dias - a.dias).map(x => [x.v.cliente_nombre || '', x.v.numero_factura || x.v.numero || '', dmy(x.v.fecha), dmy(x.vence), x.saldo, x.dias > 0 ? x.dias + ' días' : 'Al día']);
    const met = {}; D.abonos.forEach(a => { const k = a.metodo || 'Otro'; met[k] = met[k] || { n: 0, m: 0 }; met[k].n++; met[k].m += n(a.monto); });
    const cobros = Object.entries(met).sort((a, b) => b[1].m - a[1].m).map(([k, o]) => [k, o.n, o.m]);
    const top = Object.values(C.porCli).filter(o => o.nom !== 'Consumidor final').sort((a, b) => b.t - a.t).map(o => [o.nom, o.n, o.t]);
    return `<div class="nxRpKpis">${kpi('Por cobrar hoy', fmt(C.cxcTot), C.cxc.length + ' factura(s)', 'main')}${kpi('Vencido más de 90 días', fmt(C.tramos['Más de 90']), pct(C.tramos['Más de 90'], C.cxcTot) + '% de la cartera', C.tramos['Más de 90'] ? 'bad' : '')}${kpi('Cobrado en abonos (período)', fmt(C.cobrosAbonos), 'Sin ajustes ni notas de crédito', 'ok')}${kpi('Vendido a crédito (período)', fmt(C.credito), '', '')}</div>`
      + tabla('cxc_tr', 'Antigüedad de saldos', [{ l: 'Tramo (según vencimiento)' }, Object.assign({ l: 'Saldo' }, $), { l: '% ', r: 1 }], tr, { pie: ['Total', fmt(C.cxcTot), '100%'] })
      + tabla('cxc_cli', 'Clientes con saldo', [{ l: 'Cliente' }, { l: 'Facturas', r: 1 }, Object.assign({ l: 'Saldo' }, $), { l: 'Atraso máx.', r: 1 }], cli, { max: 300 })
      + tabla('cxc_det', 'Facturas pendientes', [{ l: 'Cliente' }, { l: 'Factura', m: 1 }, { l: 'Fecha' }, { l: 'Vence' }, Object.assign({ l: 'Saldo' }, $), { l: 'Atraso', r: 1 }], det, { max: 300, nota: 'Si la factura no tiene fecha de vencimiento se toman 30 días desde la venta.' })
      + tabla('cxc_cob', 'Cobros del período por método', [{ l: 'Método' }, { l: 'Recibos', r: 1 }, Object.assign({ l: 'Monto' }, $)], cobros)
      + tabla('cli_top', 'Mejores clientes del período', [{ l: 'Cliente' }, { l: 'Compras', r: 1 }, Object.assign({ l: 'Total' }, $)], top, { max: 50 });
  }
  function secCompras() {
    const $ = { r: 1, fmt: fmt };
    const c = D.compras.filter(x => x.estado !== 'anulada');
    const tot = c.reduce((s, x) => s + n(x.total) * (n(x.tasa) || 1), 0);
    const porProv = {}; c.forEach(x => { const k = x.proveedor_nombre || 'Sin proveedor'; porProv[k] = porProv[k] || { n: 0, t: 0 }; porProv[k].n++; porProv[k].t += n(x.total) * (n(x.tasa) || 1); });
    const cxpTot = D.cxp.reduce((s, x) => s + n(x.saldo), 0);
    return `<div class="nxRpKpis">${kpi('Compras del período', fmt(tot), c.length + ' compra(s)', 'main')}${kpi('Por pagar a proveedores', fmt(cxpTot), D.cxp.length + ' factura(s)', cxpTot ? 'warn' : '')}</div>`
      + tabla('com_prov', 'Compras por proveedor', [{ l: 'Proveedor' }, { l: 'Compras', r: 1 }, Object.assign({ l: 'Total (RD$)' }, $)], Object.entries(porProv).sort((a, b) => b[1].t - a[1].t).map(([k, o]) => [k, o.n, o.t]))
      + tabla('com_det', 'Compras del período', [{ l: 'Fecha' }, { l: 'No.', m: 1 }, { l: 'Proveedor' }, { l: 'NCF', m: 1 }, { l: 'Tipo' }, Object.assign({ l: 'Total (RD$)' }, $)], c.map(x => [dmy(x.fecha), x.numero || '', x.proveedor_nombre || '', x.ncf || '', (x.a_credito ? 'Crédito' : 'Contado') + (x.es_importacion ? ' · Importación' : ''), n(x.total) * (n(x.tasa) || 1)]), { vacio: 'No hay compras en el período.' })
      + tabla('com_cxp', 'Cuentas por pagar (hoy)', [{ l: 'Proveedor' }, { l: 'Compra', m: 1 }, { l: 'Fecha' }, { l: 'Vence' }, Object.assign({ l: 'Saldo' }, $), { l: 'Estado' }], D.cxp.map(x => [x.proveedor_nombre || '', x.numero || '', dmy(x.fecha), dmy(x.vencimiento), x.saldo, x.tramo || x.estado_pago || '']), { vacio: 'No hay cuentas por pagar.' });
  }
  function secCaja() {
    const $ = { r: 1, fmt: fmt };
    const cer = D.cajas.filter(c => c.estado === 'cerrada');
    const desc = cer.reduce((s, c) => s + n(c.descuadre), 0);
    const ent = D.cajaMov.filter(m => m.tipo === 'entrada').reduce((s, m) => s + n(m.monto), 0), sal = D.cajaMov.filter(m => m.tipo !== 'entrada').reduce((s, m) => s + n(m.monto), 0);
    return `<div class="nxRpKpis">${kpi('Cierres de caja', String(cer.length), '', 'main')}${kpi('Descuadre acumulado', fmt(desc), desc < 0 ? 'Faltante' : desc > 0 ? 'Sobrante' : 'Cuadrado', desc ? 'warn' : 'ok')}${kpi('Entradas de efectivo', fmt(ent), '', '')}${kpi('Salidas / gastos de caja', fmt(sal), '', '')}</div>`
      + tabla('caj_cie', 'Cierres de caja', [{ l: 'Apertura' }, { l: 'Cierre' }, { l: 'Usuario' }, Object.assign({ l: 'Fondo' }, $), Object.assign({ l: 'Esperado' }, $), Object.assign({ l: 'Contado' }, $), Object.assign({ l: 'Descuadre' }, $)], cer.map(c => [dmy(c.apertura), dmy(c.cierre), c.usuario_nombre || c.created_by_name || '', c.monto_inicial, c.efectivo_esperado, c.efectivo_contado, c.descuadre]), { vacio: 'No hay cierres en el período.' })
      + tabla('caj_mov', 'Entradas y salidas de caja', [{ l: 'Fecha' }, { l: 'Tipo' }, { l: 'Concepto' }, Object.assign({ l: 'Monto' }, $)], D.cajaMov.map(m => [dmy(m.fecha), m.tipo === 'entrada' ? 'Entrada' : 'Salida', m.concepto || '', m.monto]), { vacio: 'Sin movimientos en el período.' });
  }
  function secFiscal(C) {
    const $ = { r: 1, fmt: fmt };
    const v607 = C.ven.filter(v => v.ncf).map(v => [v.ncf, dmy(v.fecha), v.cliente_nombre || 'Consumidor final', n(v.total) - n(v.itbis), n(v.itbis), n(v.total)]);
    const nc = C.dev.filter(d => d.ncf).map(d => [d.ncf, dmy(d.fecha), d.cliente_nombre || '', -(n(d.total) - n(d.itbis)), -n(d.itbis), -n(d.total)]);
    const r607 = v607.concat(nc);
    const s = i => r607.reduce((a, f) => a + n(f[i]), 0);
    const c606 = D.compras.filter(x => x.ncf && x.estado !== 'anulada').map(x => [x.ncf, dmy(x.fecha), x.proveedor_nombre || '', (n(x.subtotal)) * (n(x.tasa) || 1), n(x.itbis) * (n(x.tasa) || 1), n(x.total) * (n(x.tasa) || 1)]);
    const s6 = i => c606.reduce((a, f) => a + n(f[i]), 0);
    const itbCob = C.itbis - C.devItb, itbPag = s6(4);
    return `<div class="nxRpKpis">${kpi('ITBIS cobrado (ventas − devoluciones)', fmt(itbCob), '', 'main')}${kpi('ITBIS pagado en compras con NCF', fmt(itbPag), '', '')}${kpi('ITBIS estimado a pagar', fmt(itbCob - itbPag), 'Referencia; confirma con tu contador', itbCob - itbPag > 0 ? 'warn' : 'ok')}</div>`
      + tabla('fis_607', '607 · Ventas con comprobante (incluye notas de crédito)', [{ l: 'NCF', m: 1 }, { l: 'Fecha' }, { l: 'Cliente' }, Object.assign({ l: 'Monto sin ITBIS' }, $), Object.assign({ l: 'ITBIS' }, $), Object.assign({ l: 'Total' }, $)], r607, { max: 400, pie: ['Total', '', '', fmt(s(3)), fmt(s(4)), fmt(s(5))], vacio: 'No hay ventas con NCF en el período.' })
      + tabla('fis_606', '606 · Compras con comprobante', [{ l: 'NCF', m: 1 }, { l: 'Fecha' }, { l: 'Proveedor' }, Object.assign({ l: 'Monto sin ITBIS' }, $), Object.assign({ l: 'ITBIS' }, $), Object.assign({ l: 'Total' }, $)], c606, { pie: ['Total', '', '', fmt(s6(3)), fmt(s6(4)), fmt(s6(5))], vacio: 'No hay compras con NCF en el período.' });
  }
  function secTaller() {
    const $ = { r: 1, fmt: fmt };
    const ent = D.reps.filter(r => r.cobrado || r.entregado_at);
    const cob = ent.reduce((s, r) => s + n(r.cobrado_monto), 0), pz = ent.reduce((s, r) => s + n(r.costo_piezas), 0);
    const abiertas = D.reps.filter(r => !r.entregado_at && !/entregad|cancel/i.test(r.estado || ''));
    return `<div class="nxRpKpis">${kpi('Reparaciones recibidas', String(D.reps.length), abiertas.length + ' todavía en taller', 'main')}${kpi('Cobrado en taller', fmt(cob), '', 'ok')}${puedeCosto() ? kpi('Costo de piezas', fmt(pz), 'Ganancia ' + fmt(cob - pz), '') : ''}</div>`
      + tabla('tal_det', 'Reparaciones del período', [{ l: 'Número', m: 1 }, { l: 'Fecha' }, { l: 'Cliente' }, { l: 'Equipo' }, { l: 'Estado' }, Object.assign({ l: 'Cobrado' }, $)], D.reps.map(r => [r.numero || '', dmy(r.created_at), r.cliente_nombre || '', r.equipo || '', r.entregado_at ? 'Entregada' : (r.estado || ''), n(r.cobrado_monto)]), { vacio: 'No hay reparaciones en el período.' })
      + `<p class="nxRpNote">La rentabilidad de los equipos reacondicionados está en Reacondicionado → Rentabilidad.</p>`;
  }

  // ── Render ──────────────────────────────────────────────────────────
  function render() {
    ensureCSS();
    const rangos = [['hoy', 'Hoy'], ['sem', 'Últimos 7 días'], ['mes', 'Este mes'], ['mesant', 'Mes anterior'], ['anio', 'Este año']];
    const barraTop = `<div class="nxRpTop">
        <div class="nxRpRange"><label>Desde<input type="date" value="${esc(desde)}" onchange="window.nxReportes.rango('d',this.value)"></label><label>Hasta<input type="date" value="${esc(hasta)}" onchange="window.nxReportes.rango('h',this.value)"></label></div>
        <div class="nxRpPres">${rangos.map(r => `<button type="button" class="nxRpChip" onclick="window.nxReportes.preset('${r[0]}')">${r[1]}</button>`).join('')}</div>
        <div class="nxRpTools"><button type="button" class="btn bsm bghost" onclick="window.nxRepImei && window.nxRepImei()"><i class="ti ti-device-mobile-search"></i> Buscar IMEI</button><button type="button" class="btn bsm bghost" onclick="window.nxReportes.imprimir()"><i class="ti ti-printer"></i> Imprimir</button></div>
      </div>
      <nav class="nxRpTabs" role="tablist">${TABS.map(t => `<button type="button" role="tab" aria-selected="${tab === t[0]}" class="nxRpTab${tab === t[0] ? ' on' : ''}" onclick="window.nxReportes.tab('${t[0]}')"><i class="ti ${t[2]}"></i>${t[1]}</button>`).join('')}</nav>`;
    let body;
    if (cargando && !D) body = '<div class="nxRpLoad"><div class="spin"></div> Cargando reportes…</div>';
    else if (error) body = `<div class="nxRpErr">No se pudieron cargar los datos: ${esc(error)} <button class="btn bsm" type="button" onclick="window.nxReportes.recargar()">Reintentar</button></div>`;
    else if (!D) body = '<div class="nxRpLoad">Sin datos.</div>';
    else {
      const C = calc();
      body = ({ resumen: secResumen, ventas: secVentas, productos: secProductos, inventario: secInventario, cobros: secCobros, compras: secCompras, caja: secCaja, fiscal: secFiscal, taller: secTaller }[tab] || secResumen)(C);
    }
    const titulo = (TABS.find(t => t[0] === tab) || TABS[0])[1];
    return `<div class="nxRp" id="nxRpRoot"><div class="nxRpHead"><div><h2>Reportes</h2><p>${esc(titulo)} · del ${dmy(desde)} al ${dmy(hasta)}${cargando ? ' · actualizando…' : ''}</p></div></div>${barraTop}<div class="nxRpBody">${body}</div></div>`;
  }
  function postRender() {}

  async function recargar() { cargando = true; repintar(); await cargar(); repintar(); }
  function preset(k) {
    const h = hoyISO();
    if (k === 'hoy') { desde = h; hasta = h; }
    else if (k === 'sem') { desde = addDays(h, -6); hasta = h; }
    else if (k === 'mes') { desde = h.slice(0, 8) + '01'; hasta = h; }
    else if (k === 'mesant') { const ini = addDays(h.slice(0, 8) + '01', -1); desde = ini.slice(0, 8) + '01'; hasta = ini; }
    else if (k === 'anio') { desde = h.slice(0, 5) + '01-01'; hasta = h; }
    recargar();
  }
  function csv(id) {
    const t = tablas[id]; if (!t) return;
    const q = v => { const s = String(v == null ? '' : v); return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const lineas = [t.cols.map(c => q(c.l)).join(',')].concat(t.filas.map(f => f.map(v => q(typeof v === 'number' ? Math.round(v * 100) / 100 : v)).join(',')));
    const blob = new Blob(['﻿' + lineas.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = ('STUDIO ' + t.titulo + ' ' + desde + ' a ' + hasta).replace(/[^\w\s\-áéíóúñÁÉÍÓÚÑ.]/g, '').replace(/\s+/g, '_') + '.csv';
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    toast('ok', 'Exportado', t.titulo);
  }
  function imprimir() {
    const root = document.getElementById('nxRpRoot'); if (!root) return;
    const w = window.open('', '_blank'); if (!w) { toast('warn', 'Permite las ventanas emergentes'); return; }
    const css = (document.getElementById('nxRpCSS') || {}).textContent || '';
    w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Reportes STUDIO</title><style>${css} body{font-family:-apple-system,system-ui,sans-serif;margin:18px;color:#111} .nxRpTop,.nxRpTabs,.nxRpAcc,button{display:none!important} .nxRpCard{break-inside:avoid}</style></head><body>${root.outerHTML}</body></html>`);
    w.document.close(); setTimeout(() => { try { w.print(); } catch (e) {} }, 300);
  }

  function ensureCSS() {
    if (document.getElementById('nxRpCSS')) return;
    const st = document.createElement('style'); st.id = 'nxRpCSS';
    st.textContent = `
.nxRp{--rp-ink:var(--studio-ink,#111);--rp-mute:var(--studio-steel,#5b5951);--rp-line:var(--studio-line-2,rgba(128,101,21,.09));--rp-gold:var(--studio-gold,#c9a227);--rp-gold-d:var(--studio-gold-dark,#806515);max-width:1440px;margin:0 auto;color:var(--rp-ink)}
.nxRp h2,.nxRp h3,.nxRp .nxRpK span{text-transform:none!important;letter-spacing:-.01em}
.nxRpHead h2{margin:0;font-size:22px;font-weight:700;letter-spacing:-.02em}.nxRpHead p{margin:2px 0 12px;color:var(--rp-mute);font-size:13px}
.nxRpTop{display:flex;flex-wrap:wrap;gap:10px 14px;align-items:flex-end;margin-bottom:12px}
.nxRpRange{display:flex;gap:8px}.nxRpRange label{display:flex;flex-direction:column;gap:4px;font-size:11px;font-weight:600;color:var(--rp-mute)}
.nxRpRange input{height:36px;border:1px solid rgba(0,0,0,.16);border-radius:10px;padding:0 10px;font-size:13px;background:#fff;color:var(--rp-ink)}
.nxRpPres{display:flex;gap:6px;flex-wrap:wrap}.nxRpChip{height:32px;padding:0 12px;border-radius:999px;border:1px solid rgba(0,0,0,.14);background:#fff;font-size:12.5px;font-weight:600;color:var(--rp-ink);cursor:pointer}
.nxRpChip:active{transform:scale(.97)}.nxRpTools{margin-left:auto;display:flex;gap:6px}
.nxRpTabs{display:flex;gap:4px;overflow-x:auto;padding:4px;margin-bottom:14px;border-radius:12px;background:rgba(10,10,10,.05);scrollbar-width:none}.nxRpTabs::-webkit-scrollbar{display:none}
.nxRpTab{flex:0 0 auto;display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 12px;border:0;border-radius:9px;background:transparent;color:var(--rp-ink);font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap}
.nxRpTab i{font-size:16px;color:var(--rp-gold-d)}.nxRpTab.on{background:#0a0a0a;color:#fffefa;box-shadow:0 1px 3px rgba(0,0,0,.25)}.nxRpTab.on i{color:var(--studio-gold-light,#e3c45c)}
.nxRpKpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px;margin-bottom:12px}
.nxRpK{background:#fff;border:1px solid var(--rp-line);border-radius:14px;padding:12px 14px;display:flex;flex-direction:column;gap:3px;min-width:0}
.nxRpK span{font-size:11.5px;font-weight:600;color:var(--rp-mute)}.nxRpK b{font-family:var(--studio-mono,ui-monospace,monospace);font-size:20px;font-weight:600;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.nxRpK small{font-size:11.5px;color:var(--rp-mute);line-height:1.35}.nxRpK em{font-style:normal;font-size:11.5px;font-weight:600}.nxRpK em.up{color:#15803d}.nxRpK em.dn{color:#b91c1c}
.nxRpK.main{border-color:var(--rp-gold);box-shadow:inset 3px 0 0 var(--rp-gold)}.nxRpK.ok b{color:#15803d}.nxRpK.bad b{color:#b91c1c}.nxRpK.warn b{color:#b45309}
.nxRpGrid2{display:grid;grid-template-columns:1.5fr 1fr;gap:12px}@media(max-width:900px){.nxRpGrid2{grid-template-columns:1fr}}
.nxRpCard{background:#fff;border:1px solid var(--rp-line);border-radius:14px;padding:12px 14px;margin-bottom:12px;min-width:0}
.nxRpCard header{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px}.nxRpCard h3{margin:0;font-size:14px;font-weight:700}
.nxRpAcc{display:flex;align-items:center;gap:8px}.nxRpNote{font-size:11.5px;color:var(--rp-mute);margin:6px 0 0}
.nxRpTw{overflow-x:auto;-webkit-overflow-scrolling:touch}.nxRpT{width:100%;border-collapse:collapse;font-size:12.5px}
.nxRpT th{text-align:left;font-size:10.5px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--rp-mute);padding:7px 8px;background:var(--studio-canvas-2,#f0ede4);white-space:nowrap}
.nxRpT td{padding:7px 8px;border-top:1px solid var(--rp-line);vertical-align:top}.nxRpT .r{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.nxRpT td.m{font-family:var(--studio-mono,ui-monospace,monospace);font-size:12px;white-space:nowrap}.nxRpT td.vac{text-align:center;color:var(--rp-mute);padding:16px}
.nxRpT tfoot td{font-weight:700;border-top:1.5px solid var(--rp-ink)}.nxRpT tbody tr:hover td{background:#fbf8ee}
.nxRpER td{font-size:13.5px}.nxRpER tr.s td{font-weight:700}.nxRpER tr.t td{font-weight:700;font-size:15px;border-top:1.5px solid var(--rp-ink)}
.nxRpBars{display:flex;align-items:flex-end;gap:4px;height:170px;overflow-x:auto;padding-bottom:18px}.nxRpBars .b{flex:1 0 16px;min-width:16px;height:100%;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;position:relative}
.nxRpBars .b i{display:block;width:70%;border-radius:4px 4px 0 0;background:linear-gradient(180deg,#e3c45c,#c9a227)}.nxRpBars .b span{position:absolute;bottom:-17px;font-size:9.5px;color:var(--rp-mute);white-space:nowrap}
.nxRpMet{margin-bottom:10px}.nxRpMet>div:first-child{display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:4px}.nxRpMet b{font-variant-numeric:tabular-nums}
.nxRpMet .bar{height:7px;border-radius:5px;background:rgba(10,10,10,.06);overflow:hidden}.nxRpMet .bar i{display:block;height:100%;background:var(--rp-gold)}
.nxRpLoad,.nxRpErr{padding:30px;text-align:center;color:var(--rp-mute);display:flex;gap:10px;align-items:center;justify-content:center}.nxRpErr{color:#b91c1c}
@media(max-width:760px){.nxRpKpis{grid-template-columns:1fr 1fr;gap:8px}.nxRpK{padding:10px 12px}.nxRpK.main{grid-column:1/-1}.nxRpTools{margin-left:0}.nxRpRange{width:100%}.nxRpRange label{flex:1}.nxRpRange input{width:100%;height:40px;font-size:16px}.nxRpK b{font-size:18px}.nxRpChip{height:36px}.nxRpTab{height:38px}}
@media(prefers-reduced-motion:reduce){.nxRpChip:active{transform:none}}`;
    document.head.appendChild(st);
  }

  window.nxReportes = {
    cargar, render, postRender, recargar, preset, csv, imprimir,
    tab: function (t) { tab = t; try { localStorage.setItem('studio_rep_tab', t); } catch (e) {} repintar(); },
    rango: function (k, v) { if (!v) return; if (k === 'd') desde = v; else hasta = v; if (desde > hasta) { const x = desde; desde = hasta; hasta = x; } recargar(); }
  };
})();
