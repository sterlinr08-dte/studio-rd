/* STUDIO · Reportes (2026-09-23, rehecho al estilo Infoplus el mismo día)
 * Pedido del dueño: «vamos con el reporte, yo quiero que sea parecido a los reportes de Infoplus» + captura del
 * menú de Infoplus: Reportes → Bancos · Clientes · Contabilidad · Inventario · Proveedores · Recursos Humanos · Caja.
 * Catálogo por módulo (acordeón) → cada reporte sale como HOJA formal: empresa/RNC, título, rango o fecha de corte,
 * grupos con subtotal, total general, pie con usuario y hora; Imprimir (carta) y Excel (CSV).
 * Solo LECTURA. Carga por rango y por páginas de 1,000 filas; bancos, diario, balanza, kárdex, proveedores y
 * RR. HH. cargan aparte solo al abrir su reporte. Costos, sueldos, bancos y contabilidad: solo admin y gerente.
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

  let desde = '', hasta = '', D = null, cargando = false, error = '';

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
        pr(getAll('pos_abonos', 'select=id,numero,fecha,monto,metodo,cliente_id,venta_id&' + rngD('fecha')), []),
        pr(getAll('pos_ventas', 'select=id,numero,numero_factura,fecha,cliente_id,cliente_nombre,credito_monto,credito_vencimiento&estado=eq.completada&a_credito=is.true'), []),
        pr(getAll('pos_abonos', 'select=venta_id,monto'), []),
        pr(getAll('pos_compras', 'select=id,numero,fecha,proveedor_nombre,ncf,subtotal,itbis,total,a_credito,estado,moneda,tasa,es_importacion,total_desembarcado&' + rngD('fecha')), []),
        pr(getAll('pos_cxp_v', 'select=*&saldo=gt.0'), []),
        pr(getAll('pos_cajas', 'select=id,apertura,cierre,estado,usuario_nombre,created_by_name,monto_inicial,ventas_efectivo,ventas_tarjeta,ventas_transferencia,abonos_efectivo,entradas,salidas,efectivo_esperado,efectivo_contado,descuadre&' + rng('apertura') + '&order=apertura.desc'), []),
        pr(getAll('pos_caja_movimientos', 'select=tipo,monto,concepto,fecha,created_by_name&' + rng('fecha')), []),
        pr(getAll('pos_asientos', 'select=fecha,tipo,concepto,numero,pos_asiento_lineas(cuenta_codigo,cuenta_nombre,debito,credito)&' + rngD('fecha')), []),
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
        // Ganancia = lo cobrado − lo que costó. Los costos de STUDIO se registran con el ITBIS pagado incluido,
        // así que se comparan contra la venta CON ITBIS (antes se le quitaba el 18% solo a la venta y salían pérdidas falsas).
        const p = prodBy[it.producto_id];
        const cu = it.costo_unitario != null ? n(it.costo_unitario) : n(p && p.costo);
        const cst = (p && p.tipo === 'servicio') ? 0 : cu * c;
        costo += cst;
        const k = it.producto_id || it.nombre;
        porProd[k] = porProd[k] || { nom: String(it.nombre || (p && p.nombre) || '—').trim(), cod: p ? (p.codigo || '') : '', cant: 0, monto: 0, costo: 0, gan: 0 };
        if (!cu && !(p && p.tipo === 'servicio')) porProd[k].sinCosto = 1;
        porProd[k].cant += c; porProd[k].monto += imp; porProd[k].costo += cst; porProd[k].gan += imp - cst;
        const cat = p && p.categoria_id ? (catBy[p.categoria_id] || 'Sin categoría') : 'Sin categoría';
        porCat[cat] = porCat[cat] || { cant: 0, monto: 0, gan: 0 }; porCat[cat].cant += c; porCat[cat].monto += imp; porCat[cat].gan += imp - cst;
        porVend[vd].g += imp - cst;
      });
    });
    const devTot = dev.reduce((s, d) => s + n(d.total), 0), devItb = dev.reduce((s, d) => s + n(d.itbis), 0);
    const netas = bruto - devTot, netasSinItb = (bruto - itbis) - (devTot - devItb);
    const ganBruta = netas - costo;
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

  // ── Resumen general ────────────────────────────────────────────────
  function secResumen(C) {
    const vc = puedeCosto();
    return `<div class="nxRpKpis">
        ${kpi('Ventas netas', fmt(C.netas), variacion(C.bruto, C.previo) || (C.devTot ? 'Devoluciones: ' + fmt(C.devTot) : ''), 'main')}
        ${vc ? kpi('Ganancia bruta', fmt(C.ganBruta), 'Margen ' + pct(C.ganBruta, C.netas) + '% sobre lo vendido', C.ganBruta >= 0 ? 'ok' : 'bad') : ''}
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
          <tr class="s"><td>Ventas netas</td><td class="r">${fmt(C.netas)}</td></tr>
          <tr><td>− Costo de lo vendido</td><td class="r">${fmt(C.costo)}</td></tr>
          <tr class="s"><td>Ganancia bruta</td><td class="r">${fmt(C.ganBruta)}</td></tr>
          <tr><td>− Gastos (cuentas 6xxx)</td><td class="r">${fmt(C.gastos)}</td></tr>
          <tr class="t"><td>Resultado del período</td><td class="r">${fmt(C.ganBruta - C.gastos)}</td></tr>
        </tbody></table><p class="nxRpNote">El costo es el que tenía cada artículo al venderse. Los gastos salen de Contabilidad (gastos, nómina, salidas de caja).</p></section>` : ''}`;
  }

  // ── Catálogo estilo Infoplus: Reportes → módulo → reporte ─────────────────
  // Cada reporte devuelve { cols, grupos:[{t, filas, sub}], total, nota, alCorte, filtro } y se pinta como
  // una hoja formal (empresa, título, rango, grupos con subtotal, total general, pie con usuario y hora).
  // [id, nombre como en Infoplus, (opcional) id del reporte que lo construye cuando es el mismo cálculo]
  const CAT = [
    ['bancos', 'Bancos', 'ti-building-bank', [
      ['ban_saldos', 'Saldos de cuentas bancarias'], ['ban_mov', 'Movimientos bancarios'], ['ban_conc', 'Movimientos sin conciliar']]],
    ['clientes', 'Clientes', 'ti-users', [
      ['cli_fact', 'Reporte Factura'], ['cli_dev', 'Reporte Devoluciones S/V'], ['cli_notas', 'Reporte Notas de Clientes'],
      ['cli_cxc', 'Reporte Cuentas por Cobrar'], ['cli_ant', 'Antigüedad de Saldos'], ['cli_dep', 'Reporte Depósito Facturas'],
      ['cli_cob', 'Reporte Cobros Recibidos'], ['cli_nov', 'Reporte No Ventas'], ['cli_cot', 'Reporte Cotizaciones'],
      ['cli_cotfalt', 'Materiales Faltantes Cotizaciones'], ['cli_taller', 'Reporte Órdenes de Servicio'], ['cli_datacr', 'Datacrédito (morosos)'],
      ['cli_pref', 'Reporte Prefactura'], ['cli_prefpend', 'Reporte Prefacturas Pendientes'], ['cli_vend', 'Reporte Ventas por Vendedor'],
      ['cli_cli', 'Reporte Ventas por Clientes'], ['cli_anul', 'Facturas Anuladas']]],
    ['conta', 'Contabilidad', 'ti-notebook', [
      ['con_er', 'Estado de Resultados'], ['con_diario', 'Libro Diario'], ['con_bal', 'Balanza de Comprobación'],
      ['con_gastos', 'Gastos por Cuenta'], ['con_607', 'Formato 607 · Ventas'], ['con_606', 'Formato 606 · Compras'], ['con_itbis', 'Resumen de ITBIS']]],
    ['inv', 'Inventario', 'ti-list-details', [
      ['inv_ajustes', 'Reporte Ajustes'], ['inv_altabaja', 'Reporte Alta y Baja Existencia'], ['inv_compras', 'Reporte Compras', 'prov_comp'],
      ['inv_gan', 'Reporte Ganancias', 'cli_prod'], ['inv_resumen', 'Resumen Inventario'], ['inv_ventas', 'Reporte Ventas', 'cli_prod'],
      ['inv_fichero', 'Reporte Fichero Artículos'], ['inv_desp', 'Reporte Despachos'], ['inv_recep', 'Reporte Recepciones'],
      ['inv_seriales', 'Historial Seriales'], ['inv_fisico', 'Reporte Inventario Físico'], ['inv_nomov', 'Reporte No Movimiento Inventario'],
      ['inv_precios', 'Precios'], ['inv_gandia', 'Reporte Ganancias por Día'], ['inv_serdisp', 'Reporte Series No Vendidas'],
      ['inv_vemp', 'Reporte Ventas por Empleado'], ['inv_vcli', 'Reporte Ventas por Clientes', 'cli_cli'], ['inv_cat', 'Ventas por Categoría', 'cli_cat'],
      ['inv_val', 'Existencia Valorizada'], ['inv_alm', 'Existencia por Almacén'], ['inv_bajo', 'Agotados y Bajo Mínimo'], ['inv_kardex', 'Kárdex de Movimientos']]],
    ['prov', 'Proveedores', 'ti-truck', [
      ['prov_comp', 'Compras por Fecha'], ['prov_porprov', 'Compras por Proveedor'], ['prov_cxp', 'Cuentas por Pagar'],
      ['prov_pagos', 'Pagos a Proveedores'], ['prov_lista', 'Listado de Proveedores']]],
    ['rrhh', 'Recursos Humanos', 'ti-user-circle', [
      ['rh_emp', 'Listado de Empleados'], ['rh_nom', 'Nóminas del Período'], ['rh_det', 'Detalle de Nómina por Empleado']]],
    ['caja', 'Caja', 'ti-currency-dollar', [
      ['caja_des', 'Reporte Desembolso de Caja'], ['caja_ing', 'Reporte Ingreso'], ['caja_cie', 'Reporte Arqueo'], ['caja_conc', 'Conciliación Arqueo'],
      ['caja_rec', 'Reporte Imprimir Ingresos', 'cli_cob'], ['caja_mov', 'Entradas y Salidas de Caja'], ['caja_met', 'Ventas por Forma de Pago'], ['caja_dia', 'Ventas Diarias']]]
  ];
  const REP = {}; CAT.forEach(c => c[3].forEach(r => { REP[r[0]] = { t: r[1], cat: c[0], b: r[2] || r[0] }; }));
  // Reportes con datos sensibles (costos, sueldos, bancos, contabilidad): solo administrador y gerente.
  const SENSIBLE = /^(ban_|con_|rh_|inv_val|inv_alm|inv_gandia)/;
  const sens = id => SENSIBLE.test((REP[id] || {}).b || id);
  let rep = '', abierto = {}, fsel = {}, fbus = {};
  try { const r = localStorage.getItem('studio_rep_sel'); if (r && REP[r]) rep = r; } catch (e) {}
  try { abierto = JSON.parse(localStorage.getItem('studio_rep_cat') || '{}') || {}; } catch (e) { abierto = {}; }
  if (rep) abierto[REP[rep].cat] = true;

  // Datos extra que solo cargan al abrir un reporte que los usa (cache por rango).
  const X = {}; let xCargando = '';
  function xKey(k) { return k + '|' + desde + '|' + hasta; }
  const XNEED = { ban_: 'bancos', con_diario: 'diario', con_bal: 'balanza', inv_kardex: 'kardex', inv_ajustes: 'kardex', inv_altabaja: 'kardex', inv_resumen: 'kardex', inv_nomov: 'kardex', prov_pagos: 'prov', prov_lista: 'prov', rh_: 'rrhh', cli_nov: 'hist', cli_datacr: 'hist', cli_cot: 'cot', cli_cotfalt: 'cot', cli_pref: 'pref', cli_prefpend: 'pref', inv_desp: 'transf', inv_recep: 'transf', inv_seriales: 'seriales', inv_serdisp: 'seriales' };
  function xDe(id) { for (const k in XNEED) if (id === k || (k.endsWith('_') && id.startsWith(k))) return XNEED[k]; return ''; }
  async function cargarX(k) {
    const key = xKey(k); if (X[key]) return X[key];
    const pr = (p, def) => p.catch(() => def);
    const rngD = (col) => col + '=gte.' + desde + '&' + col + '=lte.' + hasta;
    let r = {};
    if (k === 'bancos') {
      const [cuentas, movs, conc] = await Promise.all([
        pr(getAll('pos_cuentas_bancarias', 'select=id,banco_nombre,alias,numero,tipo,moneda,saldo_inicial,fecha_saldo_inicial,activa&order=banco_nombre.asc'), []),
        pr(getAll('pos_banco_movimientos', 'select=id,cuenta_bancaria_id,fecha,monto,concepto,referencia,origen_tipo&fecha=lt.' + tsHasta(hasta) + '&order=fecha.asc'), []),
        pr(getAll('pos_banco_conciliaciones', 'select=movimiento_id'), [])
      ]);
      r = { cuentas, movs, conc };
    } else if (k === 'diario') {
      r.asientos = await pr(getAll('pos_asientos', 'select=numero,fecha,tipo,concepto,referencia,pos_asiento_lineas(cuenta_codigo,cuenta_nombre,descripcion,debito,credito)&' + rngD('fecha') + '&order=fecha.asc,numero.asc'), []);
    } else if (k === 'balanza') {
      const [cuentas, lineas] = await Promise.all([
        pr(getAll('pos_cuentas', 'select=codigo,nombre,tipo,naturaleza&order=codigo.asc'), []),
        pr(getAll('pos_asiento_lineas', 'select=cuenta_codigo,cuenta_nombre,debito,credito,pos_asientos!inner(fecha)&pos_asientos.fecha=lte.' + hasta), [])
      ]);
      r = { cuentas, lineas };
    } else if (k === 'kardex') {
      r.movs = await pr(getAll('pos_inv_movimientos', 'select=producto_id,producto_nombre,tipo,cantidad,stock_anterior,stock_nuevo,referencia,motivo,created_by_name,fecha&fecha=gte.' + tsDesde(desde) + '&fecha=lt.' + tsHasta(hasta) + '&order=fecha.asc'), []);
    } else if (k === 'prov') {
      const [provs, pagos] = await Promise.all([
        pr(getAll('pos_proveedores', 'select=id,nombre,rnc,telefono,direccion,contacto,activo&order=nombre.asc'), []),
        pr(getAll('pos_compra_pagos', 'select=numero,fecha,monto,metodo,referencia,proveedor_id,compra_id,created_by_name&' + rngD('fecha') + '&order=fecha.asc'), [])
      ]);
      r = { provs, pagos };
    } else if (k === 'rrhh') {
      const [emps, noms] = await Promise.all([
        pr(getAll('rrhh_empleados', 'select=nombre,cedula,telefono,puesto,departamento,salario,tipo_pago,fecha_ingreso,activo&order=nombre.asc'), []),
        pr(getAll('rrhh_nominas', 'select=numero,periodo,descripcion,fecha,tipo,total_bruto,total_deducciones,total_neto,estado,rrhh_nomina_lineas(empleado_nombre,salario_bruto,bonos,sfs,afp,isr,otras_deducciones,neto)&' + rngD('fecha') + '&order=fecha.asc'), [])
      ]);
      r = { emps, noms };
    }
    else if (k === 'hist') {
      const [clientes, vtas] = await Promise.all([
        pr(getAll('pos_clientes', 'select=id,codigo,nombre,cedula,telefono,direccion,tipo_persona,activo,es_cliente&order=nombre.asc'), []),
        pr(getAll('pos_ventas', 'select=cliente_id,fecha,total&estado=eq.completada&cliente_id=not.is.null&order=fecha.asc'), [])
      ]);
      r = { clientes, vtas };
    } else if (k === 'cot') {
      r.cots = await pr(getAll('pos_cotizaciones', 'select=numero,fecha,cliente_nombre,validez_dias,total,estado,created_by_name,pos_cotizacion_items(producto_id,nombre,cantidad,precio,importe)&' + rngD('fecha') + '&order=fecha.asc'), []);
    } else if (k === 'pref') {
      r.prefs = await pr(getAll('pos_prefacturas', 'select=numero,cliente_nombre,total,estado,created_by_name,created_at,items&order=created_at.asc'), []);
    } else if (k === 'transf') {
      r.trs = await pr(getAll('pos_transferencias', 'select=numero,fecha,origen_nombre,destino_nombre,notas,created_by_name,pos_transferencia_items(nombre,cantidad)&' + rngD('fecha') + '&order=fecha.asc'), []);
    } else if (k === 'seriales') {
      const [sers, vtas] = await Promise.all([
        pr(getAll('pos_seriales', 'select=serial,estado,producto_id,almacen_id,venta_id,color,created_at&order=created_at.asc'), []),
        pr(getAll('pos_ventas', 'select=id,numero,numero_factura,fecha,cliente_nombre'), [])
      ]);
      r = { sers, vtas };
    }
    X[key] = r; return r;
  }

  // ── Formatos de hoja ───────────────────────────────────────────────
  function m2(v) { const x = Math.round(n(v) * 100) / 100; return (x === 0 ? 0 : x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  const $ = (l, o) => Object.assign({ l, r: 1, fmt: m2, sum: 1 }, o || {});
  const T = (l, o) => Object.assign({ l }, o || {});
  function sumas(cols, filas) { return cols.map((c, i) => c.sum ? filas.reduce((s, f) => s + n(f[i]), 0) : null); }
  function grupo(t, filas, cols) { return { t, filas, sub: sumas(cols, filas) }; }
  function agrupar(lista, clave, fila, cols, ordenGrupos) {
    const g = {}; lista.forEach(x => { const k = clave(x) || '—'; (g[k] = g[k] || []).push(fila(x)); });
    let ks = Object.keys(g); ks = ordenGrupos ? ordenGrupos(ks, g) : ks.sort((a, b) => a.localeCompare(b, 'es'));
    return ks.map(k => grupo(k, g[k], cols));
  }
  const porTotalDesc = col => (ks, g) => ks.sort((a, b) => g[b].reduce((s, f) => s + n(f[col]), 0) - g[a].reduce((s, f) => s + n(f[col]), 0));

  // ── Definición de cada reporte ─────────────────────────────────────
  function construir(id, C, x, rid) {
    const vc = puedeCosto(); const fv = fsel[rid || id] || ''; const fq = String(fbus[rid || id] || '').trim().toLowerCase();
    const almBy = {}; D.almacenes.forEach(a => { almBy[a.id] = a.nombre; });
    const catBy = {}; D.cats.forEach(c => { catBy[c.id] = c.nombre; });
    const tasa = c => n(c.tasa) || 1;
    switch (id) {
      // Bancos
      case 'ban_saldos': {
        const cols = [T('Banco'), T('Cuenta', { m: 1 }), T('Tipo'), T('Moneda'), $('Saldo inicial'), $('Entradas'), $('Salidas'), $('Saldo')];
        const filas = x.cuentas.map(c => { const ms = x.movs.filter(m => m.cuenta_bancaria_id === c.id && (!c.fecha_saldo_inicial || diaRD(m.fecha) >= c.fecha_saldo_inicial)); const e = ms.filter(m => n(m.monto) > 0).reduce((s, m) => s + n(m.monto), 0), s = -ms.filter(m => n(m.monto) < 0).reduce((s2, m) => s2 + n(m.monto), 0); return [c.banco_nombre || '', (c.alias ? c.alias + ' · ' : '') + (c.numero || ''), c.tipo || '', c.moneda || 'DOP', n(c.saldo_inicial), e, s, n(c.saldo_inicial) + e - s]; });
        return { cols, grupos: [grupo('', filas, cols)], alCorte: 1, nota: 'Saldo = saldo inicial + entradas − salidas registradas en STUDIO hasta la fecha de corte.' };
      }
      case 'ban_mov': case 'ban_conc': {
        const concSet = new Set(x.conc.map(c => c.movimiento_id));
        const cols = [T('Fecha'), T('Concepto'), T('Referencia', { m: 1 }), T('Origen'), $('Entrada'), $('Salida')].concat(id === 'ban_mov' ? [$('Balance', { sum: 0 })] : []);
        const cuentas = x.cuentas.filter(c => !fv || c.id === fv);
        const grupos = cuentas.map(c => {
          let bal = n(c.saldo_inicial);
          const ms = x.movs.filter(m => m.cuenta_bancaria_id === c.id && (!c.fecha_saldo_inicial || diaRD(m.fecha) >= c.fecha_saldo_inicial));
          ms.filter(m => diaRD(m.fecha) < desde).forEach(m => { bal += n(m.monto); });
          const antes = bal;
          const filas = ms.filter(m => diaRD(m.fecha) >= desde && (id === 'ban_mov' || !concSet.has(m.id))).map(m => { bal += n(m.monto); const f = [dmy(m.fecha), m.concepto || '', m.referencia || '', m.origen_tipo || '', n(m.monto) > 0 ? n(m.monto) : 0, n(m.monto) < 0 ? -n(m.monto) : 0]; if (id === 'ban_mov') f.push(bal); return f; });
          if (id === 'ban_mov') filas.unshift(Object.assign(['', 'Balance anterior', '', '', 0, 0, antes], { _ini: 1 }));
          return grupo((c.banco_nombre || '') + ' · ' + (c.alias || c.numero || ''), filas, cols);
        }).filter(g => id === 'ban_mov' || g.filas.length);
        return { cols, grupos, filtro: { l: 'Cuenta', o: x.cuentas.map(c => [c.id, (c.banco_nombre || '') + ' · ' + (c.alias || c.numero || '')]) } };
      }
      // Clientes
      case 'cli_fact': {
        const cols = [T('Factura', { m: 1 }), T('NCF', { m: 1 }), T('Cliente'), T('Vendedor'), T('Tipo'), $('Subtotal'), $('ITBIS'), $('Total')];
        return { cols, grupos: agrupar(C.ven, v => dmy(v.fecha), v => [v.numero_factura || v.numero || '', v.ncf || '', v.cliente_nombre || 'Consumidor final', v.vendedor_nombre || v.created_by_name || '', n(v.credito_monto) > 0 ? 'Crédito' : 'Contado', n(v.total) - n(v.itbis), n(v.itbis), n(v.total)], cols, ks => ks.sort((a, b) => a.split('/').reverse().join('').localeCompare(b.split('/').reverse().join('')))) };
      }
      case 'cli_vend': {
        const vendNom = v => v.vendedor_nombre || v.created_by_name || 'Sin vendedor';
        const lista = C.ven.filter(v => !fv || vendNom(v) === fv);
        const cols = [T('Fecha'), T('Factura', { m: 1 }), T('Cliente'), T('Tipo'), $('Total')];
        return { cols, grupos: agrupar(lista, vendNom, v => [dmy(v.fecha), v.numero_factura || v.numero || '', v.cliente_nombre || 'Consumidor final', n(v.credito_monto) > 0 ? 'Crédito' : 'Contado', n(v.total)], cols, porTotalDesc(4)), filtro: { l: 'Vendedor', o: Object.keys(C.porVend).sort().map(k => [k, k]) } };
      }
      case 'cli_cli': {
        const cols = [T('Fecha'), T('Factura', { m: 1 }), T('Vendedor'), T('Tipo'), $('Total')];
        return { cols, grupos: agrupar(C.ven, v => v.cliente_nombre || 'Consumidor final', v => [dmy(v.fecha), v.numero_factura || v.numero || '', v.vendedor_nombre || v.created_by_name || '', n(v.credito_monto) > 0 ? 'Crédito' : 'Contado', n(v.total)], cols, porTotalDesc(4)) };
      }
      case 'cli_prod': case 'cli_cat': {
        const arr = Object.values(C.porProd).map(o => Object.assign({}, o, { cat: 'Sin categoría' }));
        Object.keys(C.porProd).forEach((k, i) => { const p = C.prodBy[k]; arr[i].cat = p && p.categoria_id ? (catBy[p.categoria_id] || 'Sin categoría') : 'Sin categoría'; });
        const cols = [T('Código', { m: 1 }), T('Artículo'), $('Cant.', { fmt: fmtN }), $('Vendido')].concat(vc ? [$('Costo'), $('Ganancia'), T('Margen', { r: 1 })] : []);
        const fila = o => [o.cod, o.nom + (vc && o.sinCosto ? ' *' : ''), o.cant, o.monto].concat(vc ? [o.costo, o.gan, o.monto ? pct(o.gan, o.monto) + '%' : ''] : []);
        if (id === 'cli_prod') return { cols, grupos: [grupo('', arr.sort((a, b) => b.monto - a.monto).map(fila), cols)], nota: vc ? 'Ganancia = lo vendido − el costo que tenía el artículo al venderse (ambos con ITBIS incluido).' + (arr.filter(o => o.sinCosto).length ? ' Atención: ' + arr.filter(o => o.sinCosto).length + ' artículo(s) se vendieron sin costo registrado (marcados con *); su ganancia sale inflada hasta que se les ponga costo.' : '') : '' };
        return { cols, grupos: agrupar(arr.sort((a, b) => b.monto - a.monto), o => o.cat, fila, cols, porTotalDesc(3)) };
      }
      case 'cli_cxc': {
        const cols = [T('Factura', { m: 1 }), T('Fecha'), T('Vence'), T('Atraso', { r: 1 }), $('Saldo')];
        return { cols, grupos: agrupar(C.cxc, c => c.v.cliente_nombre || '—', c => [c.v.numero_factura || c.v.numero || '', dmy(c.v.fecha), dmy(c.vence), c.dias > 0 ? c.dias + ' días' : 'Al día', c.saldo], cols, porTotalDesc(4)), alCorte: 1, nota: 'Saldos a hoy. Sin fecha de vencimiento se toman 30 días desde la venta.' };
      }
      case 'cli_ant': {
        const trs = Object.keys(C.tramos);
        const cols = [T('Cliente')].concat(trs.map(t => $(t))).concat([$('Total')]);
        const pc = {}; C.cxc.forEach(c => { const k = c.v.cliente_nombre || '—'; pc[k] = pc[k] || trs.map(() => 0); pc[k][trs.indexOf(c.tr)] += c.saldo; });
        const filas = Object.entries(pc).map(([k, a]) => [k].concat(a).concat([a.reduce((s, v) => s + v, 0)])).sort((a, b) => b[b.length - 1] - a[a.length - 1]);
        return { cols, grupos: [grupo('', filas, cols)], alCorte: 1 };
      }
      case 'cli_cob': {
        const cols = [T('Fecha'), T('Recibo', { m: 1 }), T('Cliente'), T('Factura', { m: 1 }), $('Monto')];
        const cliNom = {}; D.creditos.forEach(v => { cliNom[v.id] = v; });
        return { cols, grupos: agrupar(D.abonos.filter(a => n(a.monto) > 0), a => a.metodo || 'Otro', a => { const v = cliNom[a.venta_id]; return [dmy(a.fecha), a.numero || '', v ? v.cliente_nombre || '' : '', v ? v.numero_factura || v.numero || '' : '', n(a.monto)]; }, cols, porTotalDesc(4)) };
      }
      case 'cli_dev': {
        const cols = [T('Fecha'), T('Número', { m: 1 }), T('NCF', { m: 1 }), T('Cliente'), T('Método'), $('ITBIS'), $('Total')];
        return { cols, grupos: [grupo('', C.dev.map(d => [dmy(d.fecha), d.numero || '', d.ncf || '', d.cliente_nombre || '', d.metodo || '', n(d.itbis), n(d.total)]), cols)] };
      }
      case 'cli_anul': {
        const cols = [T('Fecha'), T('Factura', { m: 1 }), T('NCF', { m: 1 }), T('Cliente'), T('Estado'), $('Total')];
        return { cols, grupos: [grupo('', C.anul.map(v => [dmy(v.fecha), v.numero_factura || v.numero || '', v.ncf || '', v.cliente_nombre || '', v.estado || '', n(v.total)]), cols)] };
      }
      case 'cli_taller': {
        const cols = [T('Número', { m: 1 }), T('Fecha'), T('Cliente'), T('Equipo'), $('Presupuesto'), $('Cobrado')].concat(vc ? [$('Piezas')] : []);
        return { cols, grupos: agrupar(D.reps, r => r.entregado_at ? 'Entregadas' : (r.estado || 'Sin estado').replace(/_/g, ' '), r => [r.numero || '', dmy(r.created_at), r.cliente_nombre || '', r.equipo || '', n(r.presupuesto), n(r.cobrado_monto)].concat(vc ? [n(r.costo_piezas)] : []), cols) };
      }
      // Contabilidad
      case 'con_er': {
        const cols = [T('Concepto'), $('Monto', { sum: 0 })];
        const g = [
          grupo('Ingresos', [['Ventas', C.bruto], ['− Devoluciones', -C.devTot], ['Ventas netas', C.netas]], cols),
          grupo('Costo', [['Costo de lo vendido', C.costo], ['Ganancia bruta', C.ganBruta]], cols),
          grupo('Gastos', Object.entries(C.porGasto).sort().map(([k, v]) => [k, v]).concat([['Total gastos', C.gastos]]), cols)
        ];
        return { cols, grupos: g, total: ['Resultado del período', C.ganBruta - C.gastos], nota: 'Ventas y costo con ITBIS incluido, como se registran en STUDIO (ITBIS de las ventas del período: ' + m2(C.itbis - C.devItb) + '; ver Resumen de ITBIS). El costo es el que tenía cada artículo al venderse. Gastos: cuentas 6xxx.' };
      }
      case 'con_diario': {
        const cols = [T('Cuenta', { m: 1 }), T('Nombre'), T('Descripción'), $('Débito'), $('Crédito')];
        const grupos = x.asientos.map(a => grupo(dmy(a.fecha) + ' · ' + (a.numero || '') + ' · ' + (a.concepto || a.tipo || ''), (a.pos_asiento_lineas || []).map(l => [l.cuenta_codigo || '', l.cuenta_nombre || '', l.descripcion || '', n(l.debito), n(l.credito)]), cols));
        return { cols, grupos };
      }
      case 'con_bal': {
        const cols = [T('Cuenta', { m: 1 }), T('Nombre'), $('Débitos'), $('Créditos'), $('Saldo deudor'), $('Saldo acreedor')];
        const acc = {}; x.lineas.forEach(l => { const k = l.cuenta_codigo || '?'; acc[k] = acc[k] || { nom: l.cuenta_nombre || '', d: 0, c: 0 }; acc[k].d += n(l.debito); acc[k].c += n(l.credito); });
        x.cuentas.forEach(c => { if (acc[c.codigo]) acc[c.codigo].nom = c.nombre; });
        const tipo = k => ({ '1': 'Activos', '2': 'Pasivos', '3': 'Capital', '4': 'Ingresos', '5': 'Costos', '6': 'Gastos' })[k[0]] || 'Otras';
        const filas = Object.keys(acc).sort().map(k => { const a = acc[k], s = a.d - a.c; return [k, a.nom, a.d, a.c, s > 0 ? s : 0, s < 0 ? -s : 0]; });
        return { cols, grupos: agrupar(filas, f => tipo(f[0]), f => f, cols, ks => ks.sort((a, b) => ['Activos', 'Pasivos', 'Capital', 'Ingresos', 'Costos', 'Gastos', 'Otras'].indexOf(a) - ['Activos', 'Pasivos', 'Capital', 'Ingresos', 'Costos', 'Gastos', 'Otras'].indexOf(b))), alCorte: 1, nota: 'Acumulado de todos los asientos hasta la fecha de corte. Débitos y créditos totales deben ser iguales.' };
      }
      case 'con_gastos': {
        const cols = [T('Fecha'), T('Concepto'), T('Cuenta', { m: 1 }), $('Monto')];
        const ls = []; D.asientos.forEach(a => (a.pos_asiento_lineas || []).forEach(l => { if (String(l.cuenta_codigo || '').startsWith('6')) ls.push({ a, l }); }));
        return { cols, grupos: agrupar(ls, o => o.l.cuenta_codigo + ' · ' + (o.l.cuenta_nombre || ''), o => [dmy(o.a.fecha), o.a.concepto || '', o.l.cuenta_codigo || '', n(o.l.debito) - n(o.l.credito)], cols) };
      }
      case 'con_607': {
        const cols = [T('NCF', { m: 1 }), T('Fecha'), T('Cliente'), $('Monto sin ITBIS'), $('ITBIS'), $('Total')];
        return { cols, grupos: [grupo('Ventas', C.ven.filter(v => v.ncf).map(v => [v.ncf, dmy(v.fecha), v.cliente_nombre || 'Consumidor final', n(v.total) - n(v.itbis), n(v.itbis), n(v.total)]), cols), grupo('Notas de crédito', C.dev.filter(d => d.ncf).map(d => [d.ncf, dmy(d.fecha), d.cliente_nombre || '', -(n(d.total) - n(d.itbis)), -n(d.itbis), -n(d.total)]), cols)].filter(g => g.filas.length) };
      }
      case 'con_606': {
        const cols = [T('NCF', { m: 1 }), T('Fecha'), T('Proveedor'), $('Monto sin ITBIS'), $('ITBIS'), $('Total')];
        return { cols, grupos: [grupo('', D.compras.filter(c => c.ncf && c.estado !== 'anulada').map(c => [c.ncf, dmy(c.fecha), c.proveedor_nombre || '', n(c.subtotal) * tasa(c), n(c.itbis) * tasa(c), n(c.total) * tasa(c)]), cols)] };
      }
      case 'con_itbis': {
        const cols = [T('Concepto'), $('Monto', { sum: 0 })];
        const pag = D.compras.filter(c => c.ncf && c.estado !== 'anulada').reduce((s, c) => s + n(c.itbis) * tasa(c), 0), cob = C.itbis - C.devItb;
        return { cols, grupos: [grupo('', [['ITBIS en ventas', C.itbis], ['− ITBIS en devoluciones', -C.devItb], ['ITBIS cobrado neto', cob], ['ITBIS pagado en compras con NCF', pag]], cols)], total: ['ITBIS estimado a pagar', cob - pag], nota: 'Referencia para el IT-1; confirma con tu contador.' };
      }
      // Inventario
      case 'inv_val': case 'inv_bajo': {
        let act = D.prods.filter(p => p.activo !== false && p.tipo !== 'servicio' && (!fv || p.categoria_id === fv));
        const cat = p => p.categoria_id ? (catBy[p.categoria_id] || 'Sin categoría') : 'Sin categoría';
        if (id === 'inv_bajo') {
          const cols = [T('Código', { m: 1 }), T('Artículo'), $('Existencia', { fmt: fmtN, sum: 0 }), $('Mínimo', { fmt: fmtN, sum: 0 }), T('Estado')];
          act = act.filter(p => n(p.stock) <= 0 || (n(p.stock_min) > 0 && n(p.stock) <= n(p.stock_min)));
          return { cols, grupos: agrupar(act, cat, p => [p.codigo || '', p.nombre, n(p.stock), n(p.stock_min), n(p.stock) <= 0 ? 'Agotado' : 'Bajo'], cols), alCorte: 1, filtro: { l: 'Categoría', o: D.cats.map(c => [c.id, c.nombre]).sort((a, b) => a[1].localeCompare(b[1])) } };
        }
        const cols = [T('Código', { m: 1 }), T('Artículo'), $('Existencia', { fmt: fmtN }), $('Costo unit.', { sum: 0 }), $('Valor al costo'), $('Precio', { sum: 0 }), $('Valor a precio')];
        return { cols, grupos: agrupar(act.filter(p => n(p.stock) > 0), cat, p => [p.codigo || '', p.nombre, n(p.stock), n(p.costo), n(p.stock) * n(p.costo), n(p.precio), n(p.stock) * n(p.precio)], cols, porTotalDesc(4)), alCorte: 1, filtro: { l: 'Categoría', o: D.cats.map(c => [c.id, c.nombre]).sort((a, b) => a[1].localeCompare(b[1])) } };
      }
      case 'inv_alm': {
        const prodBy = C.prodBy;
        const cols = [T('Código', { m: 1 }), T('Artículo'), $('Existencia', { fmt: fmtN }), $('Valor al costo')];
        const lista = D.stockAlm.filter(s => n(s.stock) !== 0 && prodBy[s.producto_id] && prodBy[s.producto_id].tipo !== 'servicio' && (!fv || s.almacen_id === fv));
        return { cols, grupos: agrupar(lista, s => almBy[s.almacen_id] || 'Sin almacén', s => { const p = prodBy[s.producto_id]; return [p.codigo || '', p.nombre, n(s.stock), n(s.stock) * n(p.costo)]; }, cols), alCorte: 1, filtro: { l: 'Almacén', o: D.almacenes.map(a => [a.id, a.nombre]) } };
      }
      case 'inv_kardex': {
        const cols = [T('Fecha'), T('Tipo'), T('Referencia', { m: 1 }), T('Usuario'), $('Entrada', { fmt: fmtN }), $('Salida', { fmt: fmtN }), $('Existencia', { fmt: fmtN, sum: 0 })];
        return { cols, grupos: agrupar(x.movs, m => m.producto_nombre || '—', m => { const q = n(m.cantidad), d = m.stock_nuevo != null && m.stock_anterior != null ? n(m.stock_nuevo) - n(m.stock_anterior) : q; return [dmy(m.fecha), (m.tipo || '').replace(/_/g, ' '), m.referencia || m.motivo || '', m.created_by_name || '', d > 0 ? d : 0, d < 0 ? -d : 0, m.stock_nuevo != null ? n(m.stock_nuevo) : '']; }, cols) };
      }
      case 'inv_sin': {
        const vend = new Set(Object.keys(C.porProd));
        const cols = [T('Código', { m: 1 }), T('Artículo'), $('Existencia', { fmt: fmtN })].concat(vc ? [$('Dinero detenido (costo)')] : []);
        const l = D.prods.filter(p => p.activo !== false && p.tipo !== 'servicio' && n(p.stock) > 0 && !vend.has(p.id));
        return { cols, grupos: agrupar(l, p => p.categoria_id ? (catBy[p.categoria_id] || 'Sin categoría') : 'Sin categoría', p => [p.codigo || '', p.nombre, n(p.stock)].concat(vc ? [n(p.stock) * n(p.costo)] : []), cols) };
      }
      // Proveedores
      case 'prov_comp': case 'prov_porprov': {
        const cs = D.compras.filter(c => c.estado !== 'anulada');
        if (id === 'prov_comp') { const cols = [T('Fecha'), T('No.', { m: 1 }), T('Proveedor'), T('NCF', { m: 1 }), T('Tipo'), $('ITBIS'), $('Total RD$')]; return { cols, grupos: [grupo('', cs.map(c => [dmy(c.fecha), c.numero || '', c.proveedor_nombre || '', c.ncf || '', (c.a_credito ? 'Crédito' : 'Contado') + (c.es_importacion ? ' · Import.' : ''), n(c.itbis) * tasa(c), n(c.total) * tasa(c)]), cols)] }; }
        const cols = [T('Fecha'), T('No.', { m: 1 }), T('NCF', { m: 1 }), T('Tipo'), $('Total RD$')];
        return { cols, grupos: agrupar(cs, c => c.proveedor_nombre || 'Sin proveedor', c => [dmy(c.fecha), c.numero || '', c.ncf || '', c.a_credito ? 'Crédito' : 'Contado', n(c.total) * tasa(c)], cols, porTotalDesc(4)) };
      }
      case 'prov_cxp': {
        const cols = [T('Compra', { m: 1 }), T('Fecha'), T('Vence'), T('Estado'), $('Total'), $('Pagado'), $('Saldo')];
        return { cols, grupos: agrupar(D.cxp, c => c.proveedor_nombre || '—', c => [c.numero || '', dmy(c.fecha), dmy(c.vencimiento), c.tramo || c.estado_pago || '', n(c.total), n(c.pagado), n(c.saldo)], cols, porTotalDesc(6)), alCorte: 1 };
      }
      case 'prov_pagos': {
        const pn = {}; x.provs.forEach(p => { pn[p.id] = p.nombre; });
        const cols = [T('Fecha'), T('Recibo', { m: 1 }), T('Método'), T('Referencia', { m: 1 }), $('Monto')];
        return { cols, grupos: agrupar(x.pagos, p => pn[p.proveedor_id] || 'Sin proveedor', p => [dmy(p.fecha), p.numero || '', p.metodo || '', p.referencia || '', n(p.monto)], cols, porTotalDesc(4)) };
      }
      case 'prov_lista': {
        const cols = [T('Proveedor'), T('RNC', { m: 1 }), T('Teléfono'), T('Contacto'), T('Dirección')];
        return { cols, grupos: [grupo('', x.provs.filter(p => p.activo !== false).map(p => [p.nombre || '', p.rnc || '', p.telefono || '', p.contacto || '', p.direccion || '']), cols)], alCorte: 1 };
      }
      // Recursos Humanos
      case 'rh_emp': {
        const cols = [T('Empleado'), T('Cédula', { m: 1 }), T('Puesto'), T('Ingreso'), T('Pago'), $('Salario')];
        return { cols, grupos: agrupar(x.emps.filter(e => e.activo !== false), e => e.departamento || 'General', e => [e.nombre || '', e.cedula || '', e.puesto || '', dmy(e.fecha_ingreso), e.tipo_pago || '', n(e.salario)], cols), alCorte: 1 };
      }
      case 'rh_nom': {
        const cols = [T('Nómina', { m: 1 }), T('Fecha'), T('Período'), T('Estado'), $('Bruto'), $('Deducciones'), $('Neto')];
        return { cols, grupos: [grupo('', x.noms.map(m => [m.numero || '', dmy(m.fecha), m.periodo || m.descripcion || '', m.estado || '', n(m.total_bruto), n(m.total_deducciones), n(m.total_neto)]), cols)] };
      }
      case 'rh_det': {
        const cols = [T('Empleado'), $('Salario'), $('Bonos'), $('SFS'), $('AFP'), $('ISR'), $('Otras'), $('Neto')];
        return { cols, grupos: x.noms.map(m => grupo((m.numero || '') + ' · ' + (m.periodo || m.descripcion || '') + ' · ' + dmy(m.fecha), (m.rrhh_nomina_lineas || []).map(l => [l.empleado_nombre || '', n(l.salario_bruto), n(l.bonos), n(l.sfs), n(l.afp), n(l.isr), n(l.otras_deducciones), n(l.neto)]), cols)) };
      }
      // Caja
      case 'caja_cie': {
        const cols = [T('Apertura'), T('Cierre'), $('Fondo'), $('Efectivo'), $('Tarjeta'), $('Transf.'), $('Esperado'), $('Contado'), $('Descuadre')];
        return { cols, grupos: agrupar(D.cajas.filter(c => c.estado === 'cerrada'), c => c.usuario_nombre || c.created_by_name || '—', c => [dmy(c.apertura), dmy(c.cierre), n(c.monto_inicial), n(c.ventas_efectivo), n(c.ventas_tarjeta), n(c.ventas_transferencia), n(c.efectivo_esperado), n(c.efectivo_contado), n(c.descuadre)], cols) };
      }
      case 'caja_mov': {
        const cols = [T('Fecha'), T('Concepto'), T('Usuario'), $('Monto')];
        return { cols, grupos: agrupar(D.cajaMov, m => m.tipo === 'entrada' ? 'Entradas' : 'Salidas', m => [dmy(m.fecha), m.concepto || '', m.created_by_name || '', n(m.monto)], cols) };
      }
      case 'caja_met': {
        const cols = [T('Forma de pago'), $('Monto'), T('% del total', { r: 1 })];
        const tot = Object.values(C.met).reduce((a, b) => a + b, 0);
        return { cols, grupos: [grupo('', Object.entries(C.met).filter(e => e[1]).map(([k, v]) => [k, v, pct(v, tot) + '%']), cols)], nota: 'Abonos a cuentas por cobrar del período: ' + m2(C.cobrosAbonos) + ' (ver Clientes → Cobros recibidos).' };
      }
      case 'caja_dia': {
        const cols = [T('Fecha'), $('Facturas', { fmt: v => String(v) }), $('Efectivo'), $('Tarjeta'), $('Transferencia'), $('Crédito'), $('Total')];
        const d = {}; C.ven.forEach(v => { const k = diaRD(v.fecha); d[k] = d[k] || [dmy(k), 0, 0, 0, 0, 0, 0]; const r = d[k]; r[1]++; r[2] += n(v.pagado_efectivo); r[3] += n(v.pagado_tarjeta); r[4] += n(v.pagado_transferencia); r[5] += n(v.credito_monto); r[6] += n(v.total); });
        return { cols, grupos: [grupo('', Object.keys(d).sort().map(k => d[k]), cols)] };
      }
      // ── Clientes (nombres de Infoplus) ──
      case 'cli_notas': {
        const cols = [T('Fecha'), T('Recibo', { m: 1 }), T('Cliente'), T('Factura', { m: 1 }), $('Monto')];
        const vb = {}; D.creditos.forEach(v => { vb[v.id] = v; });
        const l = D.abonos.filter(a => /nota de cr|ajuste/i.test(a.metodo || ''));
        return { cols, grupos: agrupar(l, a => /ajuste/i.test(a.metodo || '') ? 'Ajustes a cuentas' : 'Notas de crédito aplicadas', a => { const v = vb[a.venta_id]; return [dmy(a.fecha), a.numero || '', v ? v.cliente_nombre || '' : '', v ? v.numero_factura || v.numero || '' : '', n(a.monto)]; }, cols) };
      }
      case 'cli_dep': {
        const cols = [T('Fecha'), T('Documento', { m: 1 }), T('Cliente'), T('Origen'), $('Monto')];
        const vb = {}; D.creditos.forEach(v => { vb[v.id] = v; });
        const l = C.ven.filter(v => n(v.pagado_transferencia) > 0).map(v => ({ f: v.fecha, doc: v.numero_factura || v.numero || '', cli: v.cliente_nombre || 'Consumidor final', o: 'Factura de contado', m: n(v.pagado_transferencia) }))
          .concat(D.abonos.filter(a => /transfer|dep[oó]s/i.test(a.metodo || '')).map(a => { const v = vb[a.venta_id]; return { f: a.fecha, doc: a.numero || '', cli: v ? v.cliente_nombre || '' : '', o: 'Abono a ' + (v ? v.numero_factura || v.numero || 'factura' : 'factura'), m: n(a.monto) }; }));
        return { cols, grupos: agrupar(l, o => dmy(o.f), o => [dmy(o.f), o.doc, o.cli, o.o, o.m], cols, ks => ks.sort((a, b) => a.split('/').reverse().join('').localeCompare(b.split('/').reverse().join('')))), nota: 'Dinero recibido por transferencia o depósito: facturas de contado y abonos a crédito.' };
      }
      case 'cli_nov': {
        const ult = {}; x.vtas.forEach(v => { const d = diaRD(v.fecha); const o = ult[v.cliente_id] = ult[v.cliente_id] || { u: '', n: 0, t: 0 }; if (d > o.u) o.u = d; o.n++; o.t += n(v.total); });
        const compraron = new Set(C.ven.map(v => v.cliente_id).filter(Boolean));
        const cols = [T('Código', { m: 1 }), T('Cliente'), T('Teléfono'), T('Última compra'), T('Días sin comprar', { r: 1 }), $('Compras', { fmt: v => String(v) }), $('Total histórico')];
        const l = x.clientes.filter(c => c.activo !== false && ult[c.id] && !compraron.has(c.id)).map(c => ({ c, o: ult[c.id] })).sort((a, b) => b.o.t - a.o.t);
        return { cols, grupos: [grupo('', l.map(({ c, o }) => [c.codigo || '', c.nombre || '', c.telefono || '', dmy(o.u), diasEntre(o.u, hoyISO()), o.n, o.t]), cols)], nota: 'Clientes que ya habían comprado antes y no compraron entre las fechas elegidas. Ordenados por lo que han comprado en total: buenos candidatos para llamar o escribir.' };
      }
      case 'cli_cot': {
        const cols = [T('Número', { m: 1 }), T('Fecha'), T('Cliente'), T('Vendedor'), T('Vence'), $('Total')];
        const est = c => { const v = addDays(c.fecha, n(c.validez_dias) || 15); return c.estado === 'convertida' || c.estado === 'facturada' ? 'Facturadas' : v < hoyISO() ? 'Vencidas' : 'Vigentes'; };
        return { cols, grupos: agrupar(x.cots, est, c => [c.numero || '', dmy(c.fecha), c.cliente_nombre || '', c.created_by_name || '', dmy(addDays(c.fecha, n(c.validez_dias) || 15)), n(c.total)], cols) };
      }
      case 'cli_cotfalt': {
        const cols = [T('Cotización', { m: 1 }), T('Cliente'), T('Artículo'), $('Pedido', { fmt: fmtN, sum: 0 }), $('Existencia', { fmt: fmtN, sum: 0 }), $('Falta', { fmt: fmtN })];
        const vig = x.cots.filter(c => addDays(c.fecha, n(c.validez_dias) || 15) >= hoyISO() && !/convert|factur|anul/i.test(c.estado || ''));
        const l = []; vig.forEach(c => (c.pos_cotizacion_items || []).forEach(it => { const p = C.prodBy[it.producto_id]; if (!p || p.tipo === 'servicio') return; const falta = n(it.cantidad) - Math.max(0, n(p.stock)); if (falta > 0) l.push([c.numero || '', c.cliente_nombre || '', it.nombre || p.nombre, n(it.cantidad), n(p.stock), falta]); }));
        return { cols, grupos: agrupar(l, f => f[2], f => f, cols), nota: 'Cotizaciones vigentes del rango con artículos que no alcanzan en existencia. Sirve para saber qué comprar antes de cerrar la venta.' };
      }
      case 'cli_datacr': {
        const cb = {}; x.clientes.forEach(c => { cb[c.id] = c; });
        const cols = [T('Cédula / RNC', { m: 1 }), T('Cliente'), T('Teléfono'), T('Facturas', { r: 1 }), T('Atraso máx.', { r: 1 }), $('Saldo vencido')];
        const pc = {}; C.cxc.filter(c => c.dias > 30).forEach(c => { const k = c.v.cliente_id || c.v.cliente_nombre; const o = pc[k] = pc[k] || { c: cb[c.v.cliente_id] || {}, nom: c.v.cliente_nombre, n: 0, d: 0, s: 0 }; o.n++; o.d = Math.max(o.d, c.dias); o.s += c.saldo; });
        const l = Object.values(pc).sort((a, b) => b.s - a.s);
        return { cols, grupos: agrupar(l, o => o.d > 90 ? 'Más de 90 días' : o.d > 60 ? '61 a 90 días' : '31 a 60 días', o => [o.c.cedula || '—', o.nom || o.c.nombre || '', o.c.telefono || '', o.n, o.d + ' días', o.s], cols, ks => ks.sort((a, b) => ['Más de 90 días', '61 a 90 días', '31 a 60 días'].indexOf(a) - ['Más de 90 días', '61 a 90 días', '31 a 60 días'].indexOf(b))), alCorte: 1, nota: 'Clientes con facturas vencidas hace más de 30 días, con cédula para reportar a Datacrédito. Revisa los que salen con «—»: les falta la cédula en su ficha.' };
      }
      case 'cli_pref': case 'cli_prefpend': {
        const cols = [T('Número', { m: 1 }), T('Fecha'), T('Cliente'), T('Hecha por'), T('Artículos', { r: 1 }), $('Total')];
        let l = x.prefs;
        if (id === 'cli_pref') l = l.filter(p => diaRD(p.created_at) >= desde && diaRD(p.created_at) <= hasta);
        else l = l.filter(p => !/factur|convert|anul|cancel/i.test(p.estado || ''));
        return { cols, grupos: agrupar(l, p => p.estado ? p.estado.charAt(0).toUpperCase() + p.estado.slice(1) : 'Pendiente', p => [p.numero || '', dmy(p.created_at), p.cliente_nombre || '', p.created_by_name || '', Array.isArray(p.items) ? p.items.length : 0, n(p.total)], cols), alCorte: id === 'cli_prefpend' ? 1 : 0 };
      }
      // ── Inventario (nombres de Infoplus) ──
      case 'inv_ajustes': {
        const cols = [T('Fecha'), T('Motivo'), T('Usuario'), $('Entrada', { fmt: fmtN }), $('Salida', { fmt: fmtN })];
        const d = m => m.stock_nuevo != null && m.stock_anterior != null ? n(m.stock_nuevo) - n(m.stock_anterior) : n(m.cantidad);
        return { cols, grupos: agrupar(x.movs.filter(m => m.tipo === 'ajuste'), m => m.producto_nombre || '—', m => [dmy(m.fecha), m.motivo || m.referencia || '', m.created_by_name || '', d(m) > 0 ? d(m) : 0, d(m) < 0 ? -d(m) : 0], cols) };
      }
      case 'inv_altabaja': case 'inv_resumen': {
        const d = m => m.stock_nuevo != null && m.stock_anterior != null ? n(m.stock_nuevo) - n(m.stock_anterior) : n(m.cantidad);
        const pp = {}; x.movs.forEach(m => { const k = m.producto_id || m.producto_nombre; const o = pp[k] = pp[k] || { nom: m.producto_nombre, ini: m.stock_anterior != null ? n(m.stock_anterior) : null, fin: 0, t: {} }; o.fin = m.stock_nuevo != null ? n(m.stock_nuevo) : o.fin; const q = d(m), t = m.tipo || 'otro'; o.t[t] = o.t[t] || [0, 0]; if (q > 0) o.t[t][0] += q; else o.t[t][1] -= q; });
        if (id === 'inv_altabaja') {
          const cols = [T('Artículo'), $('Altas (entradas)', { fmt: fmtN }), $('Bajas (salidas)', { fmt: fmtN }), $('Neto', { fmt: fmtN })];
          const l = []; Object.values(pp).forEach(o => Object.entries(o.t).forEach(([t, v]) => l.push({ t, f: [o.nom || '—', v[0], v[1], v[0] - v[1]] })));
          const nomT = { compra: 'Compras', venta: 'Ventas', ajuste: 'Ajustes', transferencia: 'Transferencias entre almacenes', devolucion: 'Devoluciones' };
          return { cols, grupos: agrupar(l, o => nomT[o.t] || o.t, o => o.f, cols), nota: 'Transferencias entre almacenes salen de uno y entran a otro: en el total de la empresa se compensan.' };
        }
        const cols = [T('Código', { m: 1 }), T('Artículo'), $('Existencia inicial', { fmt: fmtN }), $('Entradas', { fmt: fmtN }), $('Salidas', { fmt: fmtN }), $('Existencia final', { fmt: fmtN })].concat(vc ? [$('Valor final (costo)')] : []);
        const l = D.prods.filter(p => p.tipo !== 'servicio' && p.activo !== false).map(p => { const o = pp[p.id]; let e = 0, s2 = 0; if (o) Object.values(o.t).forEach(v => { e += v[0]; s2 += v[1]; }); const fin = o ? o.fin : Math.max(0, n(p.stock)); const ini = o && o.ini != null ? o.ini : fin - e + s2; return { p, f: [p.codigo || '', p.nombre, ini, e, s2, fin].concat(vc ? [fin * n(p.costo)] : []) }; }).filter(o => o.f[2] || o.f[3] || o.f[4] || o.f[5]);
        return { cols, grupos: agrupar(l, o => o.p.categoria_id ? (catBy[o.p.categoria_id] || 'Sin categoría') : 'Sin categoría', o => o.f, cols), nota: 'Inicial y final según el kárdex del rango; los artículos sin movimientos muestran su existencia actual.' };
      }
      case 'inv_fichero': {
        const cols = [T('Código', { m: 1 }), T('Artículo'), T('Marca'), T('Tipo'), T('ITBIS'), T('Serial'), $('Existencia', { fmt: fmtN, sum: 0 }), $('Precio', { sum: 0 })].concat(vc ? [$('Costo', { sum: 0 })] : []);
        const l = D.prods.filter(p => p.activo !== false && (!fv || p.categoria_id === fv));
        return { cols, grupos: agrupar(l, p => p.categoria_id ? (catBy[p.categoria_id] || 'Sin categoría') : 'Sin categoría', p => [p.codigo || '', p.nombre || '', p.marca || '', p.tipo === 'servicio' ? 'Servicio' : 'Producto', p.itbis === false ? 'Exento' : '18%', p.serial ? 'Sí' : '', n(p.stock), n(p.precio)].concat(vc ? [n(p.costo)] : []), cols), alCorte: 1, filtro: { l: 'Categoría', o: D.cats.map(c => [c.id, c.nombre]).sort((a, b) => a[1].localeCompare(b[1])) } };
      }
      case 'inv_desp': case 'inv_recep': {
        const cols = [T('Fecha'), T('Transferencia', { m: 1 }), T(id === 'inv_desp' ? 'Hacia' : 'Desde'), T('Artículo'), $('Cantidad', { fmt: fmtN }), T('Usuario')];
        const l = []; x.trs.forEach(t => (t.pos_transferencia_items || []).forEach(it => l.push({ t, it })));
        return { cols, grupos: agrupar(l, o => id === 'inv_desp' ? 'Sale de ' + (o.t.origen_nombre || '—') : 'Entra a ' + (o.t.destino_nombre || '—'), o => [dmy(o.t.fecha), o.t.numero || '', id === 'inv_desp' ? o.t.destino_nombre || '' : o.t.origen_nombre || '', o.it.nombre || '', n(o.it.cantidad), o.t.created_by_name || ''], cols) };
      }
      case 'inv_seriales': case 'inv_serdisp': {
        const vb = {}; x.vtas.forEach(v => { vb[v.id] = v; });
        const prodBy = C.prodBy;
        if (id === 'inv_serdisp') {
          const cols = [T('Serial / IMEI', { m: 1 }), T('Color'), T('Almacén'), T('Entrada'), T('Días en inventario', { r: 1 })].concat(vc ? [$('Costo')] : []);
          const l = x.sers.filter(z => z.estado === 'disponible' && (!fv || z.almacen_id === fv));
          return { cols, grupos: agrupar(l, z => (prodBy[z.producto_id] || {}).nombre || 'Artículo no encontrado', z => [z.serial || '', z.color || '', almBy[z.almacen_id] || '', dmy(z.created_at), diasEntre(diaRD(z.created_at), hoyISO())].concat(vc ? [n((prodBy[z.producto_id] || {}).costo)] : []), cols), alCorte: 1, filtro: { l: 'Almacén', o: D.almacenes.map(a => [a.id, a.nombre]) }, nota: 'Equipos con serial todavía sin vender. Los de más días en inventario son los que conviene mover primero.' };
        }
        const cols = [T('Serial / IMEI', { m: 1 }), T('Artículo'), T('Estado'), T('Almacén'), T('Entrada'), T('Factura', { m: 1 }), T('Fecha venta'), T('Cliente')];
        let l = x.sers;
        if (fq) l = l.filter(z => String(z.serial || '').toLowerCase().includes(fq) || String((prodBy[z.producto_id] || {}).nombre || '').toLowerCase().includes(fq));
        else l = l.filter(z => { const v = vb[z.venta_id]; const d = v ? diaRD(v.fecha) : diaRD(z.created_at); return d >= desde && d <= hasta; });
        return { cols, grupos: [grupo('', l.slice(0, 2000).map(z => { const v = vb[z.venta_id]; return [z.serial || '', (prodBy[z.producto_id] || {}).nombre || '', z.estado || '', almBy[z.almacen_id] || '', dmy(z.created_at), v ? v.numero_factura || v.numero || '' : '', v ? dmy(v.fecha) : '', v ? v.cliente_nombre || '' : '']; }), cols)], buscar: 'Serial, IMEI o artículo', nota: fq ? 'Resultado de la búsqueda en todos los seriales (sin límite de fechas).' : 'Seriales que entraron o se vendieron en el rango. Escribe un serial o IMEI para ver su historial completo.' };
      }
      case 'inv_fisico': {
        const cols = [T('Código', { m: 1 }), T('Artículo'), $('Existencia sistema', { fmt: fmtN, sum: 0 }), T('Conteo físico', { r: 1 }), T('Diferencia', { r: 1 })];
        let l;
        if (fv) { const pb = C.prodBy; l = D.stockAlm.filter(s2 => s2.almacen_id === fv && pb[s2.producto_id] && pb[s2.producto_id].tipo !== 'servicio').map(s2 => ({ p: pb[s2.producto_id], q: n(s2.stock) })); }
        else l = D.prods.filter(p => p.activo !== false && p.tipo !== 'servicio').map(p => ({ p, q: n(p.stock) }));
        l.sort((a, b) => String(a.p.nombre).localeCompare(String(b.p.nombre), 'es'));
        return { cols, grupos: agrupar(l, o => o.p.categoria_id ? (catBy[o.p.categoria_id] || 'Sin categoría') : 'Sin categoría', o => [o.p.codigo || '', o.p.nombre, o.q, '________', '________'], cols), alCorte: 1, filtro: { l: 'Almacén', o: D.almacenes.map(a => [a.id, a.nombre]) }, nota: 'Hoja para imprimir y contar: anota el conteo y la diferencia, y luego haz el ajuste en Kardex.' };
      }
      case 'inv_nomov': {
        const mov = new Set(x.movs.map(m => m.producto_id));
        const cols = [T('Código', { m: 1 }), T('Artículo'), $('Existencia', { fmt: fmtN })].concat(vc ? [$('Dinero detenido (costo)')] : []);
        const l = D.prods.filter(p => p.activo !== false && p.tipo !== 'servicio' && n(p.stock) > 0 && !mov.has(p.id));
        return { cols, grupos: agrupar(l, p => p.categoria_id ? (catBy[p.categoria_id] || 'Sin categoría') : 'Sin categoría', p => [p.codigo || '', p.nombre, n(p.stock)].concat(vc ? [n(p.stock) * n(p.costo)] : []), cols, vc ? porTotalDesc(3) : null), nota: 'Artículos con existencia que no tuvieron ninguna entrada, venta, ajuste ni transferencia en el rango.' };
      }
      case 'inv_precios': {
        const cols = [T('Código', { m: 1 }), T('Artículo')].concat(vc ? [$('Costo', { sum: 0 })] : []).concat([$('Contado', { sum: 0 }), $('Crédito', { sum: 0 }), $('Por mayor', { sum: 0 }), $('Mínimo', { sum: 0 })]).concat(vc ? [T('Margen', { r: 1 })] : []);
        const l = D.prods.filter(p => p.activo !== false && (!fv || p.categoria_id === fv));
        return { cols, grupos: agrupar(l, p => p.categoria_id ? (catBy[p.categoria_id] || 'Sin categoría') : 'Sin categoría', p => [p.codigo || '', p.nombre].concat(vc ? [n(p.costo)] : []).concat([n(p.precio), n(p.precio_credito) || '', n(p.precio_mayor) || '', n(p.precio_minimo) || '']).concat(vc ? [n(p.precio) ? pct(n(p.precio) - n(p.costo), n(p.precio)) + '%' : ''] : []), cols), alCorte: 1, filtro: { l: 'Categoría', o: D.cats.map(c => [c.id, c.nombre]).sort((a, b) => a[1].localeCompare(b[1])) } };
      }
      case 'inv_gandia': {
        const cols = [T('Fecha'), $('Facturas', { fmt: v => String(v) }), $('Vendido'), $('Costo'), $('Ganancia'), T('Margen', { r: 1 })];
        const d = {}; C.ven.forEach(v => { const k = diaRD(v.fecha); const o = d[k] = d[k] || { n: 0, vta: 0, c: 0 }; o.n++; o.vta += (v.pos_venta_items || []).reduce((a, it) => a + (it.importe != null ? n(it.importe) : n(it.precio) * n(it.cantidad)), 0); (v.pos_venta_items || []).forEach(it => { const p = C.prodBy[it.producto_id]; if (p && p.tipo === 'servicio') return; o.c += (it.costo_unitario != null ? n(it.costo_unitario) : n(p && p.costo)) * n(it.cantidad); }); });
        const l = Object.keys(d).sort().map(k => { const o = d[k]; return [dmy(k), o.n, o.vta, o.c, o.vta - o.c, pct(o.vta - o.c, o.vta) + '%']; });
        return { cols, grupos: [grupo('', l, cols)], nota: 'Ganancia por día: lo vendido menos el costo que tenía cada artículo al venderse (ambos con ITBIS). No descuenta devoluciones ni gastos.' };
      }
      case 'inv_vemp': {
        const cols = [T('Vendedor'), $('Facturas', { fmt: v => String(v) }), $('Unidades', { fmt: fmtN }), $('Vendido'), $('Ticket promedio', { sum: 0 })].concat(vc ? [$('Ganancia')] : []);
        const u = {}; C.ven.forEach(v => { const k = v.vendedor_nombre || v.created_by_name || 'Sin vendedor'; u[k] = (u[k] || 0) + (v.pos_venta_items || []).reduce((s2, it) => s2 + n(it.cantidad), 0); });
        const l = Object.entries(C.porVend).sort((a, b) => b[1].t - a[1].t).map(([k, o]) => [k, o.n, u[k] || 0, o.t, o.n ? o.t / o.n : 0].concat(vc ? [o.g] : []));
        return { cols, grupos: [grupo('', l, cols)] };
      }
      // ── Caja (nombres de Infoplus) ──
      case 'caja_des': {
        const cols = [T('Fecha'), T('Concepto'), T('Usuario'), $('Monto')];
        return { cols, grupos: agrupar(D.cajaMov.filter(m => m.tipo !== 'entrada'), m => dmy(m.fecha), m => [dmy(m.fecha), m.concepto || '', m.created_by_name || '', n(m.monto)], cols, ks => ks.sort((a, b) => a.split('/').reverse().join('').localeCompare(b.split('/').reverse().join('')))) };
      }
      case 'caja_ing': {
        const cols = [T('Fecha'), T('Documento', { m: 1 }), T('Cliente / concepto'), T('Tipo'), $('Monto')];
        const vb = {}; D.creditos.forEach(v => { vb[v.id] = v; });
        const l = [];
        C.ven.forEach(v => [['Efectivo', v.pagado_efectivo], ['Tarjeta', v.pagado_tarjeta], ['Transferencia', v.pagado_transferencia], ['Otro', v.pagado_otro]].forEach(([mt, m]) => { if (n(m) > 0) l.push({ mt, f: [dmy(v.fecha), v.numero_factura || v.numero || '', v.cliente_nombre || 'Consumidor final', 'Venta', n(m)] }); }));
        D.abonos.filter(a => n(a.monto) > 0 && !/ajuste|nota de cr/i.test(a.metodo || '')).forEach(a => { const v = vb[a.venta_id]; l.push({ mt: a.metodo || 'Otro', f: [dmy(a.fecha), a.numero || '', v ? v.cliente_nombre || '' : '', 'Cobro a crédito', n(a.monto)] }); });
        D.cajaMov.filter(m => m.tipo === 'entrada').forEach(m => l.push({ mt: 'Efectivo', f: [dmy(m.fecha), '', m.concepto || '', 'Entrada de caja', n(m.monto)] }));
        return { cols, grupos: agrupar(l, o => o.mt, o => o.f, cols, porTotalDesc(4)), nota: 'Todo el dinero que entró: ventas de contado, cobros de cuentas y entradas de caja. No incluye lo vendido a crédito.' };
      }
      case 'caja_conc': {
        const cols = [T('Apertura'), T('Usuario'), $('Fondo'), $('+ Ventas efectivo'), $('+ Cobros efectivo'), $('+ Entradas'), $('− Salidas'), $('= Esperado'), $('Contado'), $('Diferencia'), T('Estado')];
        const l = D.cajas.filter(c => c.estado === 'cerrada').map(c => { const esp = n(c.monto_inicial) + n(c.ventas_efectivo) + n(c.abonos_efectivo) + n(c.entradas) - n(c.salidas); const dif = n(c.efectivo_contado) - (n(c.efectivo_esperado) || esp); return [dmy(c.apertura), c.usuario_nombre || c.created_by_name || '', n(c.monto_inicial), n(c.ventas_efectivo), n(c.abonos_efectivo), n(c.entradas), n(c.salidas), n(c.efectivo_esperado) || esp, n(c.efectivo_contado), dif, Math.abs(dif) < 1 ? 'Cuadrada' : dif < 0 ? 'Faltante' : 'Sobrante']; });
        return { cols, grupos: [grupo('', l, cols)], nota: 'Esperado = fondo + ventas en efectivo + cobros en efectivo + entradas − salidas. Diferencia = contado − esperado.' };
      }
    }
    return null;
  }

  // ── Hoja formal ────────────────────────────────────────────────────
  let ultimo = null; // { titulo, cols, grupos, total } para Excel/Imprimir
  function celda(c, v) { return c.fmt && v !== '' && v != null ? c.fmt(v) : esc(v); }
  function hoja(id, R) {
    const e = (window.CFG || {}); const emp = { nom: e.empNom || 'STUDIO', rnc: e.empRNC || '', dir: e.empDir || '', tel: e.empTel || '' };
    const s = (ctx().sesion && ctx().sesion()) || {};
    const ahora = new Date().toLocaleString('es-DO', { timeZone: 'America/Santo_Domingo', dateStyle: 'short', timeStyle: 'short' });
    const cols = R.cols; const nc = cols.length;
    const firstSum = cols.findIndex(c => c.sum);
    const filaSum = (lbl, arr, cls) => `<tr class="${cls}"><td colspan="${firstSum > 0 ? firstSum : 1}">${esc(lbl)}</td>${cols.slice(firstSum > 0 ? firstSum : 1).map((c, j) => { const i = j + (firstSum > 0 ? firstSum : 1); return `<td class="r">${arr[i] != null ? (cols[i].fmt || m2)(arr[i]) : ''}</td>`; }).join('')}</tr>`;
    let body = '', nFilas = 0; const tot = cols.map(c => c.sum ? 0 : null);
    const conGrupos = R.grupos.length > 1 || (R.grupos[0] && R.grupos[0].t);
    R.grupos.forEach(g => {
      if (g.t) body += `<tr class="g"><td colspan="${nc}">${esc(g.t)}</td></tr>`;
      g.filas.forEach(f => { if (!f._ini) nFilas++; body += `<tr>${cols.map((c, i) => `<td class="${c.r ? 'r' : ''}${c.m ? ' m' : ''}">${celda(c, f[i])}</td>`).join('')}</tr>`; });
      g.sub.forEach((v, i) => { if (v != null) tot[i] += v; });
      if (conGrupos && g.t && g.filas.length && firstSum > 0) body += filaSum('Subtotal ' + g.t + ' (' + g.filas.length + ')', g.sub, 'st');
    });
    if (!nFilas) body = `<tr><td colspan="${nc}" class="vac">No hay datos para este reporte${R.alCorte ? '' : ' en el rango elegido'}.</td></tr>`;
    let pie = '';
    if (R.total) pie = `<tr class="tt"><td colspan="${nc - 1}">${esc(R.total[0])}</td><td class="r">${m2(R.total[1])}</td></tr>`;
    else if (nFilas && firstSum > 0) pie = filaSum('Total general (' + nFilas + ' registro' + (nFilas === 1 ? '' : 's') + ')', tot, 'tt');
    ultimo = { titulo: REP[id].t, cols, grupos: R.grupos, total: R.total, tot };
    const rango = R.alCorte ? 'Al ' + dmy(hasta) : 'Desde ' + dmy(desde) + ' hasta ' + dmy(hasta);
    const fTxt = R.filtro && fsel[rep] ? ((R.filtro.o.find(o => o[0] === fsel[rep]) || [])[1] || '') : '';
    return `<article class="nxRpSheet" id="nxRpSheet">
      <header class="nxRpSH"><div class="emp"><b>${esc(emp.nom)}</b>${emp.rnc ? `<span>RNC ${esc(emp.rnc)}</span>` : ''}${emp.dir || emp.tel ? `<span>${esc([emp.dir, emp.tel].filter(Boolean).join(' · '))}</span>` : ''}</div>
        <div class="tit"><h3>${esc(REP[id].t)}</h3><span>${rango}</span>${fTxt ? `<span>${esc(R.filtro.l)}: ${esc(fTxt)}</span>` : ''}<span>Valores en RD$</span></div></header>
      <div class="nxRpTw"><table class="nxRpT nxRpST"><thead><tr>${cols.map(c => `<th class="${c.r ? 'r' : ''}">${esc(c.l)}</th>`).join('')}</tr></thead><tbody>${body}</tbody>${pie ? `<tfoot>${pie}</tfoot>` : ''}</table></div>
      ${R.nota ? `<p class="nxRpNote">${esc(R.nota)}</p>` : ''}
      <footer class="nxRpSF"><span>Generado por ${esc(s.nom || s.nombre || 'usuario')} · ${esc(ahora)}</span><span>STUDIO · Reportes</span></footer>
    </article>`;
  }

  // ── Render ─────────────────────────────────────────────────────────
  function catalogo() {
    const vc = puedeCosto();
    return `<nav class="nxRpCat" aria-label="Reportes">
      <button type="button" class="nxRpCatRes${!rep ? ' on' : ''}" onclick="window.nxReportes.abrir('')"><i class="ti ti-layout-dashboard"></i><span>Resumen general</span></button>
      ${CAT.map(c => { const reps = c[3].filter(r => vc || !sens(r[0])); if (!reps.length) return ''; const ab = !!abierto[c[0]]; return `<div class="nxRpCatG${ab ? ' ab' : ''}">
        <button type="button" class="nxRpCatH" aria-expanded="${ab}" onclick="window.nxReportes.cat('${c[0]}')"><i class="ti ${c[2]}"></i><span>${esc(c[1])}</span><i class="ti ti-chevron-${ab ? 'down' : 'left'} chev"></i></button>
        ${ab ? `<div class="nxRpCatL">${reps.map(r => `<button type="button" class="nxRpCatI${rep === r[0] ? ' on' : ''}" onclick="window.nxReportes.abrir('${r[0]}')">${esc(r[1])}</button>`).join('')}</div>` : ''}
      </div>`; }).join('')}
    </nav>`;
  }
  function barraRango(R) {
    const rangos = [['hoy', 'Hoy'], ['sem', '7 días'], ['mes', 'Este mes'], ['mesant', 'Mes anterior'], ['anio', 'Este año']];
    const f = R && R.filtro ? `<label class="nxRpFil">${esc(R.filtro.l)}<select onchange="window.nxReportes.filtro(this.value)"><option value="">Todos</option>${R.filtro.o.map(o => `<option value="${esc(o[0])}"${fsel[rep] === o[0] ? ' selected' : ''}>${esc(o[1])}</option>`).join('')}</select></label>` : '';
    const alCorte = R && R.alCorte;
    const bus = R && R.buscar ? `<label class="nxRpFil nxRpBus">Buscar<input type="search" value="${esc(fbus[rep] || '')}" placeholder="${esc(R.buscar)}" onchange="window.nxReportes.buscar(this.value)" onkeydown="if(event.key==='Enter')this.blur()"></label>` : '';
    return `<div class="nxRpTop">
      ${rep ? `<button type="button" class="nxRpBack" onclick="window.nxReportes.abrir('')"><i class="ti ti-chevron-left"></i> Reportes</button>` : ''}
      <div class="nxRpRange">${alCorte ? '' : `<label>Desde<input type="date" value="${esc(desde)}" onchange="window.nxReportes.rango('d',this.value)"></label>`}<label>${alCorte ? 'Al' : 'Hasta'}<input type="date" value="${esc(hasta)}" onchange="window.nxReportes.rango('h',this.value)"></label>${f}${bus}</div>
      ${alCorte ? '' : `<div class="nxRpPres">${rangos.map(r => `<button type="button" class="nxRpChip" onclick="window.nxReportes.preset('${r[0]}')">${r[1]}</button>`).join('')}</div>`}
      <div class="nxRpTools">${rep ? `<button type="button" class="btn bsm bghost" onclick="window.nxReportes.csv()"><i class="ti ti-file-spreadsheet"></i> Excel</button><button type="button" class="btn bsm" onclick="window.nxReportes.imprimir()"><i class="ti ti-printer"></i> Imprimir</button>` : `<button type="button" class="btn bsm bghost" onclick="window.nxRepImei && window.nxRepImei()"><i class="ti ti-device-mobile-search"></i> Buscar IMEI</button>`}</div>
    </div>`;
  }
  function render() {
    ensureCSS();
    if (rep && sens(rep) && !puedeCosto()) rep = '';
    let body, R = null;
    if (cargando && !D) body = '<div class="nxRpLoad"><div class="spin"></div> Cargando reportes…</div>';
    else if (error) body = `<div class="nxRpErr">No se pudieron cargar los datos: ${esc(error)} <button class="btn bsm" type="button" onclick="window.nxReportes.recargar()">Reintentar</button></div>`;
    else if (!D) body = '<div class="nxRpLoad">Sin datos.</div>';
    else {
      const C = calc();
      if (!rep) body = secResumen(C);
      else {
        const xk = xDe(REP[rep].b); const x = xk ? X[xKey(xk)] : {};
        if (xk && !x) { body = '<div class="nxRpLoad"><div class="spin"></div> Preparando reporte…</div>'; if (xCargando !== xKey(xk)) { xCargando = xKey(xk); cargarX(xk).then(() => { xCargando = ''; repintar(); }).catch(err => { xCargando = ''; error = String(err && err.message || err); repintar(); }); } }
        else { R = construir(REP[rep].b, C, x || {}, rep); body = R ? hoja(rep, R) : '<div class="nxRpLoad">Reporte no disponible.</div>'; }
      }
    }
    const sub = rep ? (CAT.find(c => c[0] === REP[rep].cat) || [])[1] + ' · ' + REP[rep].t : 'Resumen general · del ' + dmy(desde) + ' al ' + dmy(hasta);
    return `<div class="nxRp${rep ? ' conRep' : ''}" id="nxRpRoot"><div class="nxRpHead"><h2>Reportes</h2><p>${esc(sub)}${cargando ? ' · actualizando…' : ''}</p></div>
      <div class="nxRpLay">${catalogo()}<div class="nxRpMain">${barraRango(R)}<div class="nxRpBody">${body}</div></div></div></div>`;
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
  function nombreArchivo(ext) { return ('STUDIO ' + (ultimo ? ultimo.titulo : 'Reporte') + ' ' + desde + ' a ' + hasta).replace(/[^\w\s\-áéíóúñÁÉÍÓÚÑ.]/g, '').replace(/\s+/g, '_') + '.' + ext; }
  function csv() {
    const t = ultimo; if (!t) return;
    const q = v => { const s = String(v == null ? '' : v); return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const val = v => typeof v === 'number' ? Math.round(v * 100) / 100 : v;
    const conG = t.grupos.some(g => g.t);
    const lin = [(conG ? ['Grupo'] : []).concat(t.cols.map(c => c.l)).map(q).join(',')];
    t.grupos.forEach(g => g.filas.forEach(f => lin.push((conG ? [g.t] : []).concat(f).map(v => q(val(v))).join(','))));
    if (t.total) lin.push([t.total[0], val(t.total[1])].map(q).join(','));
    else if (t.tot.some(v => v != null)) lin.push((conG ? ['Total general'] : []).concat(t.cols.map((c, i) => t.tot[i] != null ? val(t.tot[i]) : (i === 0 && !conG ? 'Total general' : ''))).map(q).join(','));
    const blob = new Blob(['﻿' + lin.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nombreArchivo('csv');
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    toast('ok', 'Exportado', t.titulo);
  }
  function imprimir() {
    const src = document.getElementById(rep ? 'nxRpSheet' : 'nxRpRoot'); if (!src) return;
    const w = window.open('', '_blank'); if (!w) { toast('warn', 'Permite las ventanas emergentes'); return; }
    const css = (document.getElementById('nxRpCSS') || {}).textContent || '';
    w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(nombreArchivo('pdf').replace(/\.pdf$/, ''))}</title><style>${css}
      @page{size:letter;margin:12mm} body{font-family:-apple-system,system-ui,"Helvetica Neue",Arial,sans-serif;margin:0;color:#111;background:#fff}
      .nxRpSheet{box-shadow:none!important;border:0!important;padding:0!important;max-width:none!important} .nxRpTw{overflow:visible!important}
      .nxRpT thead{display:table-header-group} .nxRpT tr{break-inside:avoid} .nxRpCat,.nxRpTop,button{display:none!important}</style></head><body>${src.outerHTML}</body></html>`);
    w.document.close(); setTimeout(() => { try { w.focus(); w.print(); } catch (e) {} }, 300);
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
@media(prefers-reduced-motion:reduce){.nxRpChip:active{transform:none}}
.nxRpLay{display:grid;grid-template-columns:270px minmax(0,1fr);min-width:0;gap:16px;align-items:start}
.nxRpCat{position:sticky;top:12px;background:#0a0a0a;border-radius:16px;padding:8px;display:flex;flex-direction:column;gap:2px;color:#fffefa;max-height:calc(100vh - 120px);overflow-y:auto}
.nxRpCat button{font-family:inherit;text-transform:none;letter-spacing:0}
.nxRpCatRes,.nxRpCatH{display:flex;align-items:center;gap:10px;width:100%;min-height:44px;padding:0 12px;border:0;border-radius:11px;background:transparent;color:rgba(255,254,250,.86);font-size:14.5px;font-weight:600;cursor:pointer;text-align:left}
.nxRpCatRes i,.nxRpCatH>i:first-child{font-size:19px;color:var(--studio-gold,#c9a227);flex:none}.nxRpCatH span,.nxRpCatRes span{flex:1}
.nxRpCatH .chev{font-size:15px;color:rgba(255,254,250,.45)}.nxRpCatRes.on,.nxRpCatG.ab>.nxRpCatH{background:rgba(255,255,255,.08);color:#fffefa}
.nxRpCatRes:hover,.nxRpCatH:hover{background:rgba(255,255,255,.06)}
.nxRpCatL{display:flex;flex-direction:column;gap:1px;padding:2px 0 6px 29px;margin-left:12px;border-left:1px solid rgba(255,255,255,.1)}
.nxRpCatI{display:block;width:100%;min-height:36px;padding:6px 10px;border:0;border-radius:9px;background:transparent;color:rgba(255,254,250,.66);font-size:13.5px;font-weight:500;text-align:left;cursor:pointer;line-height:1.3}
.nxRpCatI:hover{background:rgba(255,255,255,.06);color:#fffefa}.nxRpCatI.on{background:var(--studio-gold,#c9a227);color:#0a0a0a;font-weight:700}
.nxRpBack{display:none;align-items:center;gap:4px;height:36px;padding:0 12px 0 8px;border:1px solid rgba(0,0,0,.14);border-radius:999px;background:#fff;color:var(--rp-ink);font-size:13.5px;font-weight:600;cursor:pointer;font-family:inherit}
.nxRpFil{display:flex;flex-direction:column;gap:4px;font-size:11px;font-weight:600;color:var(--rp-mute)}.nxRpBus input{height:36px;border:1px solid rgba(0,0,0,.16);border-radius:10px;padding:0 10px;font-size:13px;background:#fff;min-width:220px;text-transform:none}.nxRpFil select{height:36px;border:1px solid rgba(0,0,0,.16);border-radius:10px;padding:0 10px;font-size:13px;background:#fff;color:var(--rp-ink);max-width:240px;text-transform:none}
.nxRpSheet{background:#fff;border:1px solid var(--rp-line);border-radius:6px;box-shadow:0 1px 2px rgba(0,0,0,.06),0 10px 30px -12px rgba(0,0,0,.18);padding:26px 28px 18px;max-width:1100px}
.nxRpSH{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;padding-bottom:12px;margin-bottom:12px;border-bottom:2px solid #0a0a0a}
.nxRpSH .emp{display:flex;flex-direction:column;gap:2px;font-size:12px;color:var(--rp-mute)}.nxRpSH .emp b{font-size:17px;font-weight:800;color:var(--rp-ink);letter-spacing:.02em;text-transform:uppercase}
.nxRpSH .tit{text-align:right;display:flex;flex-direction:column;gap:2px;font-size:12px;color:var(--rp-mute)}.nxRpSH .tit h3{margin:0 0 2px;font-size:17px;font-weight:700;color:var(--rp-ink);text-transform:uppercase;letter-spacing:.01em}
.nxRpST th{background:#0a0a0a!important;color:#fffefa!important;font-size:10.5px}.nxRpST td{padding:6px 8px;font-size:12.5px}
.nxRpST tr.g td{background:var(--studio-canvas,#f3f0e8);font-weight:700;font-size:12.5px;color:var(--rp-ink);border-top:1px solid rgba(0,0,0,.14)}
.nxRpST tr.st td{font-weight:700;border-top:1px solid rgba(0,0,0,.35);background:#fcfbf7}.nxRpST tr.st td.r,.nxRpST tfoot td.r{font-variant-numeric:tabular-nums}
.nxRpST tfoot tr.tt td{font-weight:800;font-size:13px;border-top:2px solid #0a0a0a;border-bottom:3px double #0a0a0a;background:#fff}
.nxRpST tbody tr:hover td{background:#fbf8ee}.nxRpST tbody tr.g:hover td{background:var(--studio-canvas,#f3f0e8)}
.nxRpSF{display:flex;justify-content:space-between;gap:10px;margin-top:14px;padding-top:8px;border-top:1px solid var(--rp-line);font-size:11px;color:var(--rp-mute)}
@media(max-width:900px){.nxRpLay{grid-template-columns:minmax(0,1fr)}.nxRpMain{min-width:0}.nxRpRange{flex-wrap:wrap}.nxRpRange label{flex:1 1 40%}.nxRpST{min-width:560px}.nxRpST td.r,.nxRpST td.m{white-space:nowrap}.nxRpST td:not(.r):not(.m){min-width:120px;max-width:220px;white-space:normal}.nxRpCat{position:static;max-height:none}.nxRp.conRep .nxRpCat{display:none}.nxRpBack{display:inline-flex}
.nxRpSheet{padding:16px 14px 12px;border-radius:12px}.nxRpSH{flex-direction:column;gap:8px}.nxRpSH .tit{text-align:left}.nxRpFil{flex:1 1 100%}.nxRpBus input{height:36px;border:1px solid rgba(0,0,0,.16);border-radius:10px;padding:0 10px;font-size:13px;background:#fff;min-width:220px;text-transform:none}.nxRpFil select{max-width:none;height:40px;font-size:16px}.nxRpCatI{min-height:42px;font-size:14.5px}}`;
    document.head.appendChild(st);
  }

  window.nxReportes = {
    cargar, render, postRender, recargar, preset, csv, imprimir,
    abrir: function (id) { rep = REP[id] ? id : ''; if (rep) abierto[REP[rep].cat] = true; try { localStorage.setItem('studio_rep_sel', rep); localStorage.setItem('studio_rep_cat', JSON.stringify(abierto)); } catch (e) {} repintar(); try { const m = document.querySelector('#nxRpRoot .nxRpMain'); if (m && window.innerWidth < 900 && rep) m.scrollIntoView({ block: 'start' }); } catch (e) {} },
    cat: function (k) { abierto[k] = !abierto[k]; try { localStorage.setItem('studio_rep_cat', JSON.stringify(abierto)); } catch (e) {} repintar(); },
    filtro: function (v) { if (rep) fsel[rep] = v; repintar(); },
    buscar: function (v) { if (rep) fbus[rep] = v; repintar(); },
    rango: function (k, v) { if (!v) return; if (k === 'd') desde = v; else { hasta = v; if (desde > hasta) desde = hasta; } if (desde > hasta) { const x = desde; desde = hasta; hasta = x; } recargar(); }
  };
})();
