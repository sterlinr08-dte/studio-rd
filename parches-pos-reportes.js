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

  // «Con ITBIS» (casilla del dueño, 23-sep-2026): marcada = montos tal cual se cobran y costos tal cual se registran
  // (ITBIS de compras formales sumado al costo). Desmarcada = ventas sin el 18% y costos sin el ITBIS recuperable
  // (en compras informales el ITBIS no se recupera: sigue dentro del costo).
  let conItbis = true; try { conItbis = localStorage.getItem('studio_rep_itbis') !== '0'; } catch (e) {}
  const fx = gravado => (!conItbis && gravado !== false) ? 1 / 1.18 : 1;          // VENTAS por artículo (p.itbis / it.itbis)
  // COSTOS (23-sep-2026, tipo fiscal de la compra): el costo guardado es el costo real SIN el ITBIS recuperable.
  //  - compra formal: costo_itbis = ITBIS pagado por unidad (crédito fiscal) → «Con ITBIS» lo suma, «Sin ITBIS» no.
  //  - compra informal / costos migrados: costo_itbis = 0 → el ITBIS ya está dentro del costo y no se quita nunca.
  const cReal = (cu, ci) => n(cu) + (conItbis ? n(ci) : 0);
  const tv = v => conItbis ? n(v.total) : n(v.total) - n(v.itbis);                  // total de una factura
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
        getAll('pos_ventas', 'select=id,numero,numero_factura,fecha,cliente_id,cliente_nombre,subtotal,itbis,total,descuento,pagado_efectivo,pagado_tarjeta,pagado_transferencia,pagado_otro,credito_monto,a_credito,estado,vendedor_id,vendedor_nombre,created_by_name,ncf,tipo_comprobante,pos_venta_items(producto_id,nombre,cantidad,precio,importe,itbis,costo_unitario,costo_itbis_unit)&' + rng('fecha') + '&order=fecha.asc'),
        pr(getAll('pos_ventas', 'select=total,estado&estado=eq.completada&fecha=gte.' + tsDesde(pDesde) + '&fecha=lt.' + tsHasta(pHasta)), []),
        getAll('pos_productos', 'select=id,nombre,codigo,categoria_id,marca,costo,costo_itbis,precio,stock,stock_min,tipo,activo,serial,comision_pct&order=nombre.asc'),
        pr(getAll('pos_categorias', 'select=id,nombre'), []),
        pr(getAll('pos_devoluciones', 'select=id,numero,ncf,fecha,cliente_nombre,subtotal,itbis,total,metodo,estado,venta_id&' + rngD('fecha')), []),
        pr(getAll('pos_abonos', 'select=id,numero,fecha,monto,metodo,cliente_id,venta_id&' + rngD('fecha')), []),
        pr(getAll('pos_ventas', 'select=id,numero,numero_factura,fecha,cliente_id,cliente_nombre,credito_monto,credito_vencimiento&estado=eq.completada&a_credito=is.true'), []),
        pr(getAll('pos_abonos', 'select=venta_id,monto'), []),
        pr(getAll('pos_compras', 'select=id,numero,fecha,proveedor_nombre,ncf,subtotal,itbis,total,a_credito,estado,tipo_fiscal,moneda,tasa,es_importacion,total_desembarcado&' + rngD('fecha')), []),
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
      const t = tv(v); bruto += t; itbis += n(v.itbis);
      const d = diaRD(v.fecha); porDia[d] = (porDia[d] || 0) + t;
      met.Efectivo += n(v.pagado_efectivo); met.Tarjeta += n(v.pagado_tarjeta); met.Transferencia += n(v.pagado_transferencia); met.Otro += n(v.pagado_otro); met['A crédito'] += n(v.credito_monto);
      credito += n(v.credito_monto); cobradoContado += n(v.total) - n(v.credito_monto);
      const tp = n(v.credito_monto) > 0 ? 'A crédito' : 'Contado'; porTipo[tp].n++; porTipo[tp].t += t;
      const vd = v.vendedor_nombre || v.created_by_name || 'Sin vendedor'; porVend[vd] = porVend[vd] || { n: 0, t: 0, g: 0 }; porVend[vd].n++; porVend[vd].t += t;
      const ck = v.cliente_id || ('n:' + (v.cliente_nombre || 'Consumidor final')); porCli[ck] = porCli[ck] || { nom: v.cliente_nombre || 'Consumidor final', n: 0, t: 0 }; porCli[ck].n++; porCli[ck].t += t;
      (v.pos_venta_items || []).forEach(it => {
        const c = n(it.cantidad), fI = fx(it.itbis), imp = (it.importe != null ? n(it.importe) : n(it.precio) * c) * fI;
        // Ganancia = lo cobrado − lo que costó. Los costos de STUDIO se registran con el ITBIS pagado incluido,
        // así que se comparan contra la venta CON ITBIS (antes se le quitaba el 18% solo a la venta y salían pérdidas falsas).
        const p = prodBy[it.producto_id];
        const cu = it.costo_unitario != null ? n(it.costo_unitario) : n(p && p.costo);
        const cst = (p && p.tipo === 'servicio') ? 0 : cReal(cu, it.costo_itbis_unit != null ? it.costo_itbis_unit : (p && p.costo_itbis)) * c;
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
    const devTot = dev.reduce((s, d) => s + n(d.total) - (conItbis ? 0 : n(d.itbis)), 0), devItb = dev.reduce((s, d) => s + n(d.itbis), 0);
    const netas = bruto - devTot, netasSinItb = (bruto - itbis) - (devTot - devItb);
    const ganBruta = netas - costo;
    // Gastos del período: cuentas 6xxx de los asientos (gastos, nómina, salidas de caja, descuadres).
    let gastos = 0; const porGasto = {};
    D.asientos.forEach(a => (a.pos_asiento_lineas || []).forEach(l => {
      if (!String(l.cuenta_codigo || '').startsWith('6')) return;
      const m = n(l.debito) - n(l.credito); gastos += m; const k = l.cuenta_codigo + ' · ' + (l.cuenta_nombre || ''); porGasto[k] = (porGasto[k] || 0) + m;
    }));
    const cobrosAbonos = D.abonos.filter(a => n(a.monto) > 0 && !/ajuste|nota de cr/i.test(a.metodo || '')).reduce((s, a) => s + n(a.monto), 0);
    const previo = D.previas.reduce((s, v) => s + n(v.total), 0) * (conItbis ? 1 : 1 / 1.18);
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
    ['fin', 'Financiamiento', 'ti-calendar-dollar', [
      ['fin_resumen', 'Resumen de Financiamiento'], ['fin_cartera', 'Cartera de Financiamientos'], ['fin_venc', 'Cuotas Vencidas por Antigüedad'],
      ['fin_prox', 'Cuotas por Cobrar'], ['fin_cobros', 'Cobros de Cuotas'], ['fin_otorgados', 'Financiamientos Otorgados'],
      ['fin_sol', 'Solicitudes de Crédito'], ['fin_firmas', 'Contratos sin Firma del Cliente']]],
    ['conta', 'Contabilidad', 'ti-notebook', [
      ['con_er', 'Estado de Resultados'], ['con_diario', 'Libro Diario'], ['con_bal', 'Balanza de Comprobación'],
      ['con_gastos', 'Gastos por Cuenta'], ['con_607', 'Formato 607 · Ventas'], ['con_606', 'Formato 606 · Compras'], ['con_itbis', 'Resumen de ITBIS']]],
    ['inv', 'Inventario', 'ti-list-details', [
      ['inv_ajustes', 'Reporte Ajustes'], ['inv_altabaja', 'Reporte Alta y Baja Existencia'], ['inv_compras', 'Reporte Compras', 'prov_comp'],
      ['inv_gan', 'Reporte Ganancias', 'ganancias'], ['inv_resumen', 'Resumen Inventario'], ['inv_ventas', 'Reporte Ventas', 'cli_prod'],
      ['inv_fichero', 'Reporte Fichero Artículos'], ['inv_desp', 'Reporte Despachos'], ['inv_recep', 'Reporte Recepciones'],
      ['inv_seriales', 'Historial Seriales'], ['inv_fisico', 'Reporte Inventario Físico'], ['inv_nomov', 'Reporte No Movimiento Inventario'],
      ['inv_precios', 'Precios'], ['inv_gandia', 'Reporte Ganancias por Día'], ['inv_serdisp', 'Reporte Series No Vendidas'],
      ['inv_vemp', 'Reporte Ventas por Empleado'], ['inv_vcli', 'Reporte Ventas por Clientes', 'cli_cli'], ['inv_cat', 'Ventas por Categoría', 'cli_cat'],
      ['inv_val', 'Existencia Valorizada'], ['inv_alm', 'Existencia por Almacén'], ['inv_bajo', 'Agotados y Bajo Mínimo'], ['inv_kardex', 'Kárdex de Movimientos']]],
    ['prov', 'Proveedores', 'ti-truck', [
      ['prov_comp', 'Compras por Fecha'], ['prov_porprov', 'Compras por Proveedor'], ['prov_cxp', 'Cuentas por Pagar'],
      ['prov_pagos', 'Pagos a Proveedores'], ['prov_lista', 'Listado de Proveedores']]],
    ['rrhh', 'Recursos Humanos', 'ti-user-circle', [
      ['rh_emp', 'Listado de Empleados'], ['rh_nom', 'Nóminas del Período'], ['rh_det', 'Detalle de Nómina por Empleado'], ['rh_com', 'Reporte Comisiones']]],
    ['caja', 'Caja', 'ti-currency-dollar', [
      ['caja_des', 'Reporte Desembolso de Caja'], ['caja_ing', 'Reporte Ingreso'], ['caja_cie', 'Reporte Arqueo'], ['caja_conc', 'Conciliación Arqueo'],
      ['caja_rec', 'Reporte Imprimir Ingresos', 'cli_cob'], ['caja_mov', 'Entradas y Salidas de Caja'], ['caja_met', 'Ventas por Forma de Pago'], ['caja_dia', 'Ventas Diarias']]]
  ];
  const REP = {}; CAT.forEach(c => c[3].forEach(r => { REP[r[0]] = { t: r[1], cat: c[0], b: r[2] || r[0] }; }));
  // Reportes con datos sensibles (costos, sueldos, bancos, contabilidad): solo administrador y gerente.
  const SENSIBLE = /^(ban_|con_|rh_|inv_val|inv_alm|inv_gandia|ganancias)/;
  const sens = id => SENSIBLE.test((REP[id] || {}).b || id);
  let rep = '', abierto = {}, fsel = {}, fbus = {};
  try { const r = localStorage.getItem('studio_rep_sel'); if (r && REP[r]) rep = r; } catch (e) {}
  try { abierto = JSON.parse(localStorage.getItem('studio_rep_cat') || '{}') || {}; } catch (e) { abierto = {}; }
  if (rep) abierto[REP[rep].cat] = true;

  // Datos extra que solo cargan al abrir un reporte que los usa (cache por rango).
  const X = {}; let xCargando = '';
  function xKey(k) { return k + '|' + desde + '|' + hasta; }
  const XNEED = { rh_com: 'com', ban_: 'bancos', con_diario: 'diario', con_bal: 'balanza', inv_kardex: 'kardex', inv_ajustes: 'kardex', inv_altabaja: 'kardex', inv_resumen: 'kardex', inv_nomov: 'kardex', prov_pagos: 'prov', prov_lista: 'prov', rh_: 'rrhh', fin_: 'fin', cli_nov: 'hist', cli_datacr: 'hist', cli_cot: 'cot', cli_cotfalt: 'cot', cli_pref: 'pref', cli_prefpend: 'pref', inv_desp: 'transf', inv_recep: 'transf', inv_seriales: 'seriales', inv_serdisp: 'seriales' };
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
    else if (k === 'com') {
      // Comisiones: todos los abonos y facturas a crédito (para aplicar cada cobro a su factura y medir su antigüedad).
      const [abonos, vtas] = await Promise.all([
        pr(getAll('pos_abonos', 'select=id,numero,cliente_id,venta_id,monto,fecha,metodo,created_by_name,created_at&order=fecha.asc,created_at.asc'), []),
        pr(getAll('pos_ventas', 'select=id,numero,numero_factura,fecha,cliente_id,cliente_nombre,total,itbis,credito_monto,vendedor_nombre,created_by_name&estado=eq.completada&order=fecha.asc'), [])
      ]);
      r = { abonos, vtas };
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
    else if (k === 'fin') {
      const [fins, cuotas, pagos, planes, sols, clientes, cfg] = await Promise.all([
        pr(getAll('pos_financiamientos', 'select=id,codigo,venta_id,cliente_id,cliente_nombre,descripcion,monto_total,inicial,monto_financiado,interes_total,cuotas_total,frecuencia,estado,plan_id,created_at,firma_cliente_en,firma_tienda_en,firma_token_vence&order=created_at.asc'), []),
        pr(getAll('pos_fin_cuotas', 'select=id,financiamiento_id,numero,fecha_venc,monto,capital,interes,pagado,mora_generada,mora_exenta&order=fecha_venc.asc'), []),
        pr(getAll('pos_fin_pagos', 'select=id,financiamiento_id,cuota_id,monto,metodo,fecha,tipo,monto_principal,monto_interes,monto_mora,created_by_name&order=fecha.asc'), []),
        pr(getAll('pos_fin_planes', 'select=id,nombre,mora_tipo,mora_valor,mora_dias_gracia'), []),
        pr(getAll('pos_fin_solicitudes', 'select=codigo,cliente_nombre,precio_total,inicial,estado,plan_id,created_at,decidido_en,motivo_rechazo,creado_por_nombre&order=created_at.asc'), []),
        pr(getAll('pos_clientes', 'select=id,telefono,cedula'), []),
        pr(getAll('pos_config', 'select=mora_pct,mora_dias_gracia'), [])
      ]);
      r = { fins, cuotas, pagos, planes, sols, clientes, cfg: cfg[0] || {} };
    }
    X[key] = r; return r;
  }

  // ── Reporte Comisiones (como RepRH_Comi de Infoplus): los % se escriben en el propio reporte y se recuerdan
  // en este equipo. Tramos de cobro vacíos usan el % de cobros general.
  const COM_TR = [['t1', '1–30', 30], ['t2', '31–60', 60], ['t3', '61–90', 90], ['t4', '91–120', 120], ['t5', '120+', Infinity]];
  const COM_TIPOS = [['mixto', 'Ventas contado + cobros'], ['ventas', 'Comisiones ventas'], ['contado', 'Comisiones ventas contado'], ['cobros', 'Comisiones cobros']];
  let com = { v: '', c: '', t1: '', t2: '', t3: '', t4: '', t5: '', tipo: 'mixto' };
  try { Object.assign(com, JSON.parse(localStorage.getItem('studio_rep_com') || '{}') || {}); } catch (e) {}
  function comPanel() {
    const inp = (k, l) => `<label>${l}<input inputmode="decimal" value="${esc(com[k])}" placeholder="${k[0] === 't' ? '= cobros' : '0'}" onchange="window.nxReportes.com('${k}',this.value)"></label>`;
    return `<section class="nxRpCom" aria-label="Parámetros de comisión">
      <div class="nxRpComTipos" role="group">${COM_TIPOS.map(t => `<button type="button" class="nxRpChip${com.tipo === t[0] ? ' on' : ''}" aria-pressed="${com.tipo === t[0]}" onclick="window.nxReportes.com('tipo','${t[0]}')">${t[1]}</button>`).join('')}</div>
      <div class="nxRpComG">${inp('v', '% Ventas')}${inp('c', '% Cobros')}${COM_TR.map(t => inp(t[0], '% Cobros ' + t[1])).join('')}</div>
    </section>`;
  }
  function comHoja(C, x, fv) {
    const tipo = com.tipo, pv = n(com.v), pc = n(com.c);
    const conV = tipo !== 'cobros', conC = tipo === 'mixto' || tipo === 'cobros', soloContado = tipo === 'mixto' || tipo === 'contado';
    const pctTxt = (b, c) => b ? (Math.round(c / b * 10000) / 100) + '%' : '';
    const vBy = {}; (x.vtas || []).forEach(v => { vBy[v.id] = v; });
    const empV = v => v.vendedor_nombre || v.created_by_name || 'Sin vendedor';
    const L = []; let especial = false, devSin = 0, sinCobrador = 0;
    if (conV) {
      C.ven.forEach(v => {
        const tot = n(v.total); if (tot <= 0) return;
        // En «contado» la parte a crédito comisiona cuando se cobra (no dos veces).
        const parte = soloContado ? Math.max(0, tot - n(v.credito_monto)) / tot : 1; if (parte <= 0) return;
        const base = tv(v) * parte;
        // % propio del artículo (Inventario → Ventas) manda sobre el % general.
        let sumI = 0, comI = 0;
        (v.pos_venta_items || []).forEach(it => {
          const imp = (it.importe != null ? n(it.importe) : n(it.precio) * n(it.cantidad)) * fx(it.itbis), p = C.prodBy[it.producto_id];
          const esp = p && p.comision_pct != null && p.comision_pct !== ''; if (esp) especial = true;
          sumI += imp; comI += imp * (esp ? n(p.comision_pct) : pv) / 100;
        });
        const c = sumI > 0 ? comI * base / sumI : base * pv / 100;
        L.push({ e: empV(v), f: v.fecha, r: [dmy(v.fecha), parte < 1 ? 'Venta (parte contado)' : 'Venta', v.numero_factura || v.numero || '', v.cliente_nombre || 'Consumidor final', base, pctTxt(base, c), c] });
      });
      // Devoluciones del período: descuentan la comisión al vendedor de la factura original.
      C.dev.forEach(d => {
        const o = vBy[d.venta_id]; if (!o) { devSin++; return; }
        const parte = soloContado && n(o.total) > 0 ? Math.max(0, n(o.total) - n(o.credito_monto)) / n(o.total) : 1; if (parte <= 0) return;
        const base = -(n(d.total) - (conItbis ? 0 : n(d.itbis))) * parte, c = base * pv / 100;
        L.push({ e: empV(o), f: d.fecha, r: [dmy(d.fecha), 'Devolución', 'NC ' + (d.numero || ''), 'Fact. ' + (o.numero_factura || o.numero || '') + ' · ' + (d.cliente_nombre || ''), base, pctTxt(base, c), c] });
      });
    }
    if (conC) {
      // Cada abono se aplica a su factura; si no trae factura, a la factura a crédito más vieja con saldo del cliente.
      // Ajustes y notas de crédito rebajan el saldo pero no comisionan.
      const pend = {}; (x.vtas || []).forEach(v => { if (n(v.credito_monto) > 0 && v.cliente_id) (pend[v.cliente_id] = pend[v.cliente_id] || []).push({ v, s: n(v.credito_monto) }); });
      (x.abonos || []).forEach(a => {
        let m = n(a.monto); if (m <= 0) return;
        const lista = pend[a.cliente_id] || [], partes = [];
        const dir = a.venta_id ? lista.find(o => o.v.id === a.venta_id) : null;
        if (dir) { partes.push([dir.v, m]); dir.s -= m; m = 0; }
        else if (a.venta_id && vBy[a.venta_id]) { partes.push([vBy[a.venta_id], m]); m = 0; }
        for (const o of lista) { if (m <= 0.005) break; if (o.s <= 0.005 || diaRD(o.v.fecha) > a.fecha) continue; const q = Math.min(m, o.s); partes.push([o.v, q]); o.s -= q; m -= q; }
        if (m > 0.005) partes.push([null, m]);
        if (a.fecha < desde || a.fecha > hasta || /ajuste|nota de cr/i.test(a.metodo || '')) return;
        const quien = a.created_by_name || 'Sin registrar (sistema anterior)'; if (!a.created_by_name) sinCobrador++;
        partes.forEach(([v, q]) => {
          const dias = v ? Math.max(0, diasEntre(diaRD(v.fecha), a.fecha)) : null;
          const tr = dias == null ? null : COM_TR.find(t => dias <= t[2]);
          const pt = tr && String(com[tr[0]]).trim() !== '' ? n(com[tr[0]]) : pc;
          const base = conItbis || !v || !n(v.total) ? q : q * (n(v.total) - n(v.itbis)) / n(v.total), c = base * pt / 100;
          L.push({ e: quien, f: a.fecha, r: [dmy(a.fecha), 'Cobro ' + (tr ? tr[1] + ' días' : 'sin factura'), 'Rec. ' + (a.numero || ''), v ? 'Fact. ' + (v.numero_factura || v.numero || '') + ' · ' + (v.cliente_nombre || '') + ' · ' + dias + ' días' : 'Abono sin factura pendiente', base, pctTxt(base, c), c] });
        });
      });
    }
    const emps = [...new Set(L.map(o => o.e))].sort((a, b) => a.localeCompare(b, 'es'));
    const cols = [T('Fecha'), T('Tipo'), T('Documento', { m: 1 }), T('Detalle'), $('Base'), T('%', { r: 1 }), $('Comisión')];
    const lista = L.filter(o => !fv || o.e === fv).sort((a, b) => String(a.f).localeCompare(String(b.f)));
    const avisos = [];
    if (!pv && !pc && !COM_TR.some(t => String(com[t[0]]).trim() !== '')) avisos.push('Escribe el % de comisión arriba para calcular.');
    if (especial) avisos.push('Los artículos con % de comisión propio (Inventario → Ventas) usan ese % en lugar del % de ventas.');
    if (sinCobrador) avisos.push(sinCobrador + ' cobro(s) del sistema anterior no traen quién cobró: salen como «Sin registrar».');
    if (devSin) avisos.push(devSin + ' devolución(es) sin factura original no descuentan comisión.');
    const tiTxt = (COM_TIPOS.find(t => t[0] === tipo) || [])[1] || '';
    const tr = COM_TR.map(t => t[1] + ': ' + (String(com[t[0]]).trim() !== '' ? n(com[t[0]]) : pc) + '%').join(' · ');
    const resumen = `<div class="nxRpComCfg"><b>${esc(tiTxt)}</b>${conV ? ` · Ventas ${pv}%` : ''}${conC ? ` · Cobros ${pc}% (${esc(tr)})` : ''}</div>`;
    return { cols, grupos: agrupar(lista, o => o.e, o => o.r, cols, porTotalDesc(6)), panel: comPanel(), resumen,
      filtro: { l: 'Empleado', o: emps.map(k => [k, k]) },
      nota: 'Ventas: por fecha de la factura, a nombre del vendedor asignado o de quien facturó. Cobros: por fecha del cobro, a nombre de quien lo registró; la antigüedad son los días entre la factura y el cobro. ' + avisos.join(' ') };
  }

  // ── Formatos de hoja ───────────────────────────────────────────────
  function m2(v) { const x = Math.round(n(v) * 100) / 100; return (x === 0 ? 0 : x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  const $ = (l, o) => Object.assign({ l, r: 1, fmt: m2, sum: 1 }, o || {});
  const T = (l, o) => Object.assign({ l }, o || {}); const T0 = T;
  function sumas(cols, filas) { return cols.map((c, i) => c.sum ? filas.reduce((s, f) => s + n(f[i]), 0) : null); }
  function grupo(t, filas, cols) { return { t, filas, sub: sumas(cols, filas) }; }
  function agrupar(lista, clave, fila, cols, ordenGrupos) {
    const g = {}; lista.forEach(x => { const k = clave(x) || '—'; (g[k] = g[k] || []).push(fila(x)); });
    let ks = Object.keys(g); ks = ordenGrupos ? ordenGrupos(ks, g) : ks.sort((a, b) => a.localeCompare(b, 'es'));
    return ks.map(k => grupo(k, g[k], cols));
  }
  const porTotalDesc = col => (ks, g) => ks.sort((a, b) => g[b].reduce((s, f) => s + n(f[col]), 0) - g[a].reduce((s, f) => s + n(f[col]), 0));

  // ── Definición de cada reporte ─────────────────────────────────────
  // ── Análisis de ganancia (pedido del dueño: «es tema delicado, que sea muy inteligente ese reporte») ──
  // Independiente de la casilla «Con ITBIS»: muestra las dos lecturas a la vez, línea por línea.
  //  vendido        = lo que se cobró (precio con ITBIS si el artículo es gravado)
  //  itbisVenta     = ITBIS contenido en lo vendido (18/118 de lo cobrado en gravados)
  //  costo          = costo real (costo_unitario) + ITBIS recuperable (costo_itbis_unit) → lo que se pagó
  //  ganancia       = vendido − costo  (la cuenta de mostrador: precio menos lo que me costó)
  //  itbisPagar     = itbisVenta − ITBIS recuperable de esa mercancía (crédito fiscal de compras con comprobante)
  //  gananciaReal   = ganancia − itbisPagar = (vendido − itbisVenta) − costo real
  function analisisGanancia(C) {
    const L = [];
    C.ven.forEach(v => (v.pos_venta_items || []).forEach(it => {
      const p = C.prodBy[it.producto_id]; const serv = p && p.tipo === 'servicio';
      const c = n(it.cantidad), imp = it.importe != null ? n(it.importe) : n(it.precio) * c;
      const itbV = it.itbis ? imp * 18 / 118 : 0;
      const cu = serv ? 0 : n(it.costo_unitario != null ? it.costo_unitario : (p && p.costo));
      const ci = serv ? 0 : n(it.costo_itbis_unit != null ? it.costo_itbis_unit : (p && p.costo_itbis));
      L.push({ v, it, p, serv, dia: diaRD(v.fecha), k: it.producto_id || it.nombre, nom: String(it.nombre || (p && p.nombre) || '—').trim(), cod: p ? (p.codigo || '') : '', cat: p && p.categoria_id ? p.categoria_id : '', c, imp, itbV, costo: (cu + ci) * c, cr: ci * c, sinCosto: !serv && !cu && !ci });
    }));
    return L;
  }
  function sumarGan(lista) {
    const o = { c: 0, imp: 0, itbV: 0, costo: 0, cr: 0, sinCosto: 0 };
    lista.forEach(l => { o.c += l.c; o.imp += l.imp; o.itbV += l.itbV; o.costo += l.costo; o.cr += l.cr; if (l.sinCosto) o.sinCosto = 1; });
    o.gan = o.imp - o.costo; o.itbPagar = o.itbV - o.cr; o.real = o.gan - o.itbPagar; o.neto = o.imp - o.itbV;
    return o;
  }
  function resumenGanancia(T, extra) {
    const pc = v => T.imp ? Math.round(v / T.imp * 1000) / 10 : 0;
    const k = (l, v, sub, tono) => `<div class="nxRpK${tono ? ' ' + tono : ''}"><span>${esc(l)}</span><b>${v}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
    // vendido = costo pagado + ITBIS a pagar + ganancia real (cuadra exacto)
    const cien = [['Costo', Math.max(0, T.costo), 'cos'], ['ITBIS a pagar', Math.max(0, T.itbPagar), 'itb'], ['Ganancia real', Math.max(0, T.real), 'gan']];
    const base = T.imp || 1;
    const barra = `<div class="nxRpCien"><div class="t">De cada <b>RD$ 100</b> que cobraste: ${T.real >= 0 ? `<b>${m2(pc(T.itbPagar))}</b> son ITBIS para la DGII, <b>${m2(pc(T.costo))}</b> pagaste por la mercancía y <b class="ok">${m2(pc(T.real))}</b> te quedan de ganancia real.` : `<b>${m2(pc(T.itbPagar))}</b> son ITBIS para la DGII y <b>${m2(pc(T.costo))}</b> pagaste por la mercancía: <b class="bad">pierdes ${m2(pc(-T.real))}</b>.`}</div>
      <div class="bar">${cien.map(([l, v, cl]) => `<i class="${cl}" style="width:${Math.max(0, Math.min(100, v / base * 100))}%" title="${esc(l)}"></i>`).join('')}</div>
      <div class="ley"><span><i class="cos"></i>Costo</span><span><i class="itb"></i>ITBIS a pagar</span><span><i class="gan"></i>Ganancia real</span></div></div>`;
    const al = (extra || []).filter(Boolean);
    return `<div class="nxRpGan">
      <div class="nxRpKpis">
        ${k('Vendido', m2(T.imp), 'Lo que cobraste (incluye ITBIS ' + m2(T.itbV) + ')', '')}
        ${k('Costo de lo vendido', m2(T.costo), T.cr ? 'Incluye ' + m2(T.cr) + ' de ITBIS recuperable' : 'Lo que pagaste por esa mercancía', '')}
        ${k('Ganancia (precio − costo)', m2(T.gan), 'Margen ' + pct(T.gan, T.imp) + '% · la cuenta de mostrador', T.gan >= 0 ? '' : 'bad')}
        ${k('ITBIS a pagar (estimado)', m2(T.itbPagar), 'ITBIS de ventas ' + m2(T.itbV) + ' − crédito fiscal ' + m2(T.cr), T.itbPagar > 0 ? 'warn' : '')}
        ${k('Ganancia real', m2(T.real), 'Después del ITBIS · margen ' + pct(T.real, T.neto) + '% sobre venta sin ITBIS', T.real >= 0 ? 'ok main' : 'bad main')}
      </div>${barra}
      ${al.length ? `<ul class="nxRpAl">${al.map(a => `<li class="${a[0]}"><i class="ti ${a[0] === 'bad' ? 'ti-alert-triangle' : a[0] === 'warn' ? 'ti-alert-circle' : 'ti-info-circle'}"></i><span>${a[1]}</span></li>`).join('')}</ul>` : ''}
    </div>`;
  }

  // ── Financiamiento: saldo por cuota con la misma regla del POS (mora → interés → capital; mora del plan con gracia) ──
  function libroFin(x) {
    const pgC = {}; x.pagos.forEach(p => { const s2 = p.tipo === 'reversa' ? -1 : 1; const o = pgC[p.cuota_id] = pgC[p.cuota_id] || { cap: 0, int: 0, mora: 0 }; o.cap += s2 * n(p.monto_principal); o.int += s2 * n(p.monto_interes); o.mora += s2 * n(p.monto_mora); });
    const plan = {}; x.planes.forEach(p => { plan[p.id] = p; });
    const fin = {}; x.fins.forEach(f => { fin[f.id] = f; });
    const tel = {}; x.clientes.forEach(c => { tel[c.id] = c; });
    const hoy = hoyISO();
    const cuotas = x.cuotas.map(c => {
      const f = fin[c.financiamiento_id] || {}; const pl = plan[f.plan_id]; const pg = pgC[c.id] || { cap: 0, int: 0, mora: 0 };
      const capP = Math.max(0, n(c.capital != null ? c.capital : c.monto) - pg.cap), intP = Math.max(0, n(c.interes) - pg.int);
      const venc = String(c.fecha_venc || '').slice(0, 10); const dias = !c.pagado && venc && venc < hoy ? diasEntre(venc, hoy) : 0;
      let moraCalc = 0;
      if (!c.pagado && dias > 0 && capP + intP > 0.01) {
        const gr = pl ? n(pl.mora_dias_gracia) : n(x.cfg.mora_dias_gracia);
        if (dias > gr) moraCalc = pl ? (pl.mora_tipo === 'fija' ? n(pl.mora_valor) : pl.mora_tipo === 'pct' ? n(c.monto) * n(pl.mora_valor) / 100 : 0) : n(c.monto) * n(x.cfg.mora_pct) / 100;
      }
      const moraTot = c.mora_exenta ? pg.mora : Math.max(n(c.mora_generada), moraCalc);
      const moraP = c.pagado ? 0 : Math.max(0, moraTot - pg.mora);
      return { c, f, capP: c.pagado ? 0 : capP, intP: c.pagado ? 0 : intP, moraP, dias, venc, cli: tel[f.cliente_id] || {}, pg };
    });
    const porFin = {}; cuotas.forEach(q => { (porFin[q.c.financiamiento_id] = porFin[q.c.financiamiento_id] || []).push(q); });
    return { cuotas, porFin, plan, fin, tel };
  }

  function construir(id, C, x, rid) {
    const cP = p => cReal(p.costo, p.costo_itbis), pP = p => n(p.precio) * fx(p.itbis);
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
        return { cols, grupos: agrupar(lista, vendNom, v => [dmy(v.fecha), v.numero_factura || v.numero || '', v.cliente_nombre || 'Consumidor final', n(v.credito_monto) > 0 ? 'Crédito' : 'Contado', tv(v)], cols, porTotalDesc(4)), filtro: { l: 'Vendedor', o: Object.keys(C.porVend).sort().map(k => [k, k]) } };
      }
      case 'cli_cli': {
        const cols = [T('Fecha'), T('Factura', { m: 1 }), T('Vendedor'), T('Tipo'), $('Total')];
        return { cols, grupos: agrupar(C.ven, v => v.cliente_nombre || 'Consumidor final', v => [dmy(v.fecha), v.numero_factura || v.numero || '', v.vendedor_nombre || v.created_by_name || '', n(v.credito_monto) > 0 ? 'Crédito' : 'Contado', tv(v)], cols, porTotalDesc(4)) };
      }
      case 'cli_prod': case 'cli_cat': {
        const arr = Object.values(C.porProd).map(o => Object.assign({}, o, { cat: 'Sin categoría' }));
        Object.keys(C.porProd).forEach((k, i) => { const p = C.prodBy[k]; arr[i].cat = p && p.categoria_id ? (catBy[p.categoria_id] || 'Sin categoría') : 'Sin categoría'; });
        const cols = [T('Código', { m: 1 }), T('Artículo'), $('Cant.', { fmt: fmtN }), $('Vendido')].concat(vc ? [$('Costo'), $('Ganancia'), T('Margen', { r: 1 })] : []);
        const fila = o => [o.cod, o.nom + (vc && o.sinCosto ? ' *' : ''), o.cant, o.monto].concat(vc ? [o.costo, o.gan, o.monto ? pct(o.gan, o.monto) + '%' : ''] : []);
        if (id === 'cli_prod') return { cols, grupos: [grupo('', arr.sort((a, b) => b.monto - a.monto).map(fila), cols)], nota: vc ? 'Ganancia = lo vendido − el costo que tenía el artículo al venderse (' + (conItbis ? 'ambos con ITBIS' : 'venta sin ITBIS; costo sin el ITBIS recuperable de compras con ITBIS; en las informales el ITBIS es parte del costo') + ').' + (arr.filter(o => o.sinCosto).length ? ' Atención: ' + arr.filter(o => o.sinCosto).length + ' artículo(s) se vendieron sin costo registrado (marcados con *); su ganancia sale inflada hasta que se les ponga costo.' : '') : '' };
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
        return { cols, grupos: g, total: ['Resultado del período', C.ganBruta - C.gastos], nota: 'Ventas y costo ' + (conItbis ? 'con ITBIS incluido, como se registran en STUDIO' : 'sin ITBIS (ventas sin el 18%; costos sin el ITBIS recuperable de compras con comprobante; en compras informales el ITBIS es parte del costo)') + ' (ITBIS de las ventas del período: ' + m2(C.itbis - C.devItb) + '; ver Resumen de ITBIS). El costo es el que tenía cada artículo al venderse. Gastos: cuentas 6xxx.' };
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
        return { cols, grupos: agrupar(act.filter(p => n(p.stock) > 0), cat, p => [p.codigo || '', p.nombre, n(p.stock), cP(p), n(p.stock) * cP(p), pP(p), n(p.stock) * pP(p)], cols, porTotalDesc(4)), alCorte: 1, filtro: { l: 'Categoría', o: D.cats.map(c => [c.id, c.nombre]).sort((a, b) => a[1].localeCompare(b[1])) } };
      }
      case 'inv_alm': {
        const prodBy = C.prodBy;
        const cols = [T('Código', { m: 1 }), T('Artículo'), $('Existencia', { fmt: fmtN }), $('Valor al costo')];
        const lista = D.stockAlm.filter(s => n(s.stock) !== 0 && prodBy[s.producto_id] && prodBy[s.producto_id].tipo !== 'servicio' && (!fv || s.almacen_id === fv));
        return { cols, grupos: agrupar(lista, s => almBy[s.almacen_id] || 'Sin almacén', s => { const p = prodBy[s.producto_id]; return [p.codigo || '', p.nombre, n(s.stock), n(s.stock) * cP(p)]; }, cols), alCorte: 1, filtro: { l: 'Almacén', o: D.almacenes.map(a => [a.id, a.nombre]) } };
      }
      case 'inv_kardex': {
        const cols = [T('Fecha'), T('Tipo'), T('Referencia', { m: 1 }), T('Usuario'), $('Entrada', { fmt: fmtN }), $('Salida', { fmt: fmtN }), $('Existencia', { fmt: fmtN, sum: 0 })];
        return { cols, grupos: agrupar(x.movs, m => m.producto_nombre || '—', m => { const q = n(m.cantidad), d = m.stock_nuevo != null && m.stock_anterior != null ? n(m.stock_nuevo) - n(m.stock_anterior) : q; return [dmy(m.fecha), (m.tipo || '').replace(/_/g, ' '), m.referencia || m.motivo || '', m.created_by_name || '', d > 0 ? d : 0, d < 0 ? -d : 0, m.stock_nuevo != null ? n(m.stock_nuevo) : '']; }, cols) };
      }
      case 'inv_sin': {
        const vend = new Set(Object.keys(C.porProd));
        const cols = [T('Código', { m: 1 }), T('Artículo'), $('Existencia', { fmt: fmtN })].concat(vc ? [$('Dinero detenido (costo)')] : []);
        const l = D.prods.filter(p => p.activo !== false && p.tipo !== 'servicio' && n(p.stock) > 0 && !vend.has(p.id));
        return { cols, grupos: agrupar(l, p => p.categoria_id ? (catBy[p.categoria_id] || 'Sin categoría') : 'Sin categoría', p => [p.codigo || '', p.nombre, n(p.stock)].concat(vc ? [n(p.stock) * cP(p)] : []), cols) };
      }
      // Proveedores
      case 'prov_comp': case 'prov_porprov': {
        const cs = D.compras.filter(c => c.estado !== 'anulada');
        if (id === 'prov_comp') { const cols = [T('Fecha'), T('No.', { m: 1 }), T('Proveedor'), T('NCF', { m: 1 }), T('Tipo'), $('ITBIS'), $('Total RD$')]; return { cols, grupos: [grupo('', cs.map(c => [dmy(c.fecha), c.numero || '', c.proveedor_nombre || '', c.ncf || '', (c.a_credito ? 'Crédito' : 'Contado') + (c.es_importacion ? ' · Import.' : '') + (c.tipo_fiscal === 'formal' ? ' · Con ITBIS' : c.tipo_fiscal === 'informal' ? ' · Informal' : ''), n(c.itbis) * tasa(c), n(c.total) * tasa(c)]), cols)] }; }
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
      case 'rh_com': return comHoja(C, x, fv);
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
        const l = D.prods.filter(p => p.tipo !== 'servicio' && p.activo !== false).map(p => { const o = pp[p.id]; let e = 0, s2 = 0; if (o) Object.values(o.t).forEach(v => { e += v[0]; s2 += v[1]; }); const fin = o ? o.fin : Math.max(0, n(p.stock)); const ini = o && o.ini != null ? o.ini : fin - e + s2; return { p, f: [p.codigo || '', p.nombre, ini, e, s2, fin].concat(vc ? [fin * cP(p)] : []) }; }).filter(o => o.f[2] || o.f[3] || o.f[4] || o.f[5]);
        return { cols, grupos: agrupar(l, o => o.p.categoria_id ? (catBy[o.p.categoria_id] || 'Sin categoría') : 'Sin categoría', o => o.f, cols), nota: 'Inicial y final según el kárdex del rango; los artículos sin movimientos muestran su existencia actual.' };
      }
      case 'inv_fichero': {
        const cols = [T('Código', { m: 1 }), T('Artículo'), T('Marca'), T('Tipo'), T('ITBIS'), T('Serial'), $('Existencia', { fmt: fmtN, sum: 0 }), $('Precio', { sum: 0 })].concat(vc ? [$('Costo', { sum: 0 })] : []);
        const l = D.prods.filter(p => p.activo !== false && (!fv || p.categoria_id === fv));
        return { cols, grupos: agrupar(l, p => p.categoria_id ? (catBy[p.categoria_id] || 'Sin categoría') : 'Sin categoría', p => [p.codigo || '', p.nombre || '', p.marca || '', p.tipo === 'servicio' ? 'Servicio' : 'Producto', p.itbis === false ? 'Exento' : '18%', p.serial ? 'Sí' : '', n(p.stock), pP(p)].concat(vc ? [cP(p)] : []), cols), alCorte: 1, filtro: { l: 'Categoría', o: D.cats.map(c => [c.id, c.nombre]).sort((a, b) => a[1].localeCompare(b[1])) } };
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
          return { cols, grupos: agrupar(l, z => (prodBy[z.producto_id] || {}).nombre || 'Artículo no encontrado', z => [z.serial || '', z.color || '', almBy[z.almacen_id] || '', dmy(z.created_at), diasEntre(diaRD(z.created_at), hoyISO())].concat(vc ? [cP(prodBy[z.producto_id] || {})] : []), cols), alCorte: 1, filtro: { l: 'Almacén', o: D.almacenes.map(a => [a.id, a.nombre]) }, nota: 'Equipos con serial todavía sin vender. Los de más días en inventario son los que conviene mover primero.' };
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
        return { cols, grupos: agrupar(l, p => p.categoria_id ? (catBy[p.categoria_id] || 'Sin categoría') : 'Sin categoría', p => [p.codigo || '', p.nombre, n(p.stock)].concat(vc ? [n(p.stock) * cP(p)] : []), cols, vc ? porTotalDesc(3) : null), nota: 'Artículos con existencia que no tuvieron ninguna entrada, venta, ajuste ni transferencia en el rango.' };
      }
      case 'inv_precios': {
        const cols = [T('Código', { m: 1 }), T('Artículo')].concat(vc ? [$('Costo', { sum: 0 })] : []).concat([$('Contado', { sum: 0 }), $('Crédito', { sum: 0 }), $('Por mayor', { sum: 0 }), $('Mínimo', { sum: 0 })]).concat(vc ? [T('Margen', { r: 1 })] : []);
        const l = D.prods.filter(p => p.activo !== false && (!fv || p.categoria_id === fv));
        return { cols, grupos: agrupar(l, p => p.categoria_id ? (catBy[p.categoria_id] || 'Sin categoría') : 'Sin categoría', p => [p.codigo || '', p.nombre].concat(vc ? [cP(p)] : []).concat([pP(p), n(p.precio_credito) * fx(p.itbis) || '', n(p.precio_mayor) * fx(p.itbis) || '', n(p.precio_minimo) * fx(p.itbis) || '']).concat(vc ? [pP(p) ? pct(pP(p) - cP(p), pP(p)) + '%' : ''] : []), cols), alCorte: 1, filtro: { l: 'Categoría', o: D.cats.map(c => [c.id, c.nombre]).sort((a, b) => a[1].localeCompare(b[1])) } };
      }
      case 'fin_resumen': case 'fin_cartera': {
        const L = libroFin(x); const act = x.fins.filter(f => f.estado === 'activo');
        const filaF = f => { const qs = L.porFin[f.id] || []; const pend = qs.filter(q => !q.c.pagado); const prox = pend[0]; const at = Math.max(0, ...pend.map(q => q.dias));
          return { f, cap: pend.reduce((a2, q) => a2 + q.capP, 0), int: pend.reduce((a2, q) => a2 + q.intP, 0), mora: pend.reduce((a2, q) => a2 + q.moraP, 0), venc: pend.filter(q => q.dias > 0).reduce((a2, q) => a2 + q.capP + q.intP + q.moraP, 0), pag: qs.length - pend.length, tot: qs.length, prox, at }; };
        const R2 = act.map(filaF);
        if (id === 'fin_cartera') {
          const cols = [T('Código', { m: 1 }), T('Cliente'), T('Plan'), T('Cuotas', { r: 1 }), $('Capital'), $('Interés'), $('Mora'), $('Total pendiente'), T('Próxima'), T('Atraso', { r: 1 })];
          const fila = o => [o.f.codigo || '', o.f.cliente_nombre || '', (L.plan[o.f.plan_id] || {}).nombre || 'Sin plan', o.pag + '/' + o.tot, o.cap, o.int, o.mora, o.cap + o.int + o.mora, o.prox ? dmy(o.prox.venc) : '', o.at ? o.at + ' días' : 'Al día'];
          return { cols, grupos: agrupar(R2, o => o.at > 0 ? '1 · Atrasados' : '2 · Al día', fila, cols, ks => ks.sort()).map(g => Object.assign(g, { t: g.t.replace(/^\d · /, '') })), alCorte: 1, nota: 'Solo financiamientos activos. Mora calculada a hoy con la regla de cada plan (días de gracia incluidos).' };
        }
        const ini = desde, fin2 = hasta, enR = d => { const k = diaRD(d); return k >= ini && k <= fin2; };
        const otor = x.fins.filter(f => enR(f.created_at));
        const pagR = x.pagos.filter(p => enR(p.fecha)); const sg = p => p.tipo === 'reversa' ? -1 : 1;
        const cob = { cap: 0, int: 0, mora: 0 }; pagR.forEach(p => { cob.cap += sg(p) * n(p.monto_principal); cob.int += sg(p) * n(p.monto_interes); cob.mora += sg(p) * n(p.monto_mora); });
        const carT = R2.reduce((a2, o) => ({ cap: a2.cap + o.cap, int: a2.int + o.int, mora: a2.mora + o.mora, venc: a2.venc + o.venc, atr: a2.atr + (o.at > 0 ? 1 : 0) }), { cap: 0, int: 0, mora: 0, venc: 0, atr: 0 });
        const k = (l, v, sub, tono) => `<div class="nxRpK${tono ? ' ' + tono : ''}"><span>${esc(l)}</span><b>${v}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
        const sinFirma = act.filter(f => !f.firma_cliente_en).length;
        const resumen = `<div class="nxRpGan"><div class="nxRpKpis">
          ${k('Cartera por cobrar', m2(carT.cap + carT.int), act.length + ' financiamiento(s) activos · capital ' + m2(carT.cap) + ' + interés ' + m2(carT.int), 'main')}
          ${k('Vencido hoy', m2(carT.venc), carT.atr + ' cliente(s) atrasados · mora ' + m2(carT.mora), carT.venc > 0 ? 'bad' : 'ok')}
          ${k('Otorgado en el rango', m2(otor.reduce((a2, f) => a2 + n(f.monto_financiado), 0)), otor.length + ' contrato(s) · interés contratado ' + m2(otor.reduce((a2, f) => a2 + n(f.interes_total), 0)), '')}
          ${k('Cobrado en el rango', m2(cob.cap + cob.int + cob.mora), 'Capital ' + m2(cob.cap) + ' · interés ' + m2(cob.int) + ' · mora ' + m2(cob.mora), 'ok')}
          ${k('Ganado en el rango', m2(cob.int + cob.mora), 'Interés + mora cobrados (ingreso real)', '')}
        </div>${sinFirma ? `<ul class="nxRpAl"><li class="warn"><i class="ti ti-signature"></i><span><b>${sinFirma} contrato(s) activos sin firma del cliente.</b> Envía el link desde Cuotas → detalle del financiamiento, o mira «Contratos sin Firma del Cliente».</span></li></ul>` : ''}</div>`;
        const cols = [T('Plan'), $('Activos', { fmt: v => String(v) }), $('Capital pendiente'), $('Interés pendiente'), $('Vencido'), $('Mora')];
        const pp = {}; R2.forEach(o => { const nm = (L.plan[o.f.plan_id] || {}).nombre || 'Sin plan'; const a2 = pp[nm] = pp[nm] || [nm, 0, 0, 0, 0, 0]; a2[1]++; a2[2] += o.cap; a2[3] += o.int; a2[4] += o.venc; a2[5] += o.mora; });
        return { cols, grupos: [grupo('', Object.values(pp).sort((a2, b2) => b2[2] - a2[2]), cols)], resumen, nota: 'Cartera y vencido a hoy; otorgado y cobrado según el rango de fechas. El interés se gana al cobrarlo.' };
      }
      case 'fin_venc': {
        const L = libroFin(x);
        const cols = [T('Cliente'), T('Teléfono'), T('Código', { m: 1 }), T('Cuota', { r: 1 }), T('Venció'), T('Días', { r: 1 }), $('Cuota pendiente'), $('Mora'), $('Total')];
        const l = L.cuotas.filter(q => q.dias > 0 && q.f.estado === 'activo' && q.capP + q.intP > 0.01).sort((a2, b2) => b2.dias - a2.dias);
        const tr = d => d > 90 ? '1 · Más de 90 días' : d > 60 ? '2 · 61 a 90 días' : d > 30 ? '3 · 31 a 60 días' : '4 · 1 a 30 días';
        return { cols, grupos: agrupar(l, q => tr(q.dias), q => [q.f.cliente_nombre || '', q.cli.telefono || '', q.f.codigo || '', q.c.numero, dmy(q.venc), q.dias, q.capP + q.intP, q.moraP, q.capP + q.intP + q.moraP], cols, ks => ks.sort()).map(g => Object.assign(g, { t: g.t.replace(/^\d · /, '') })), alCorte: 1, nota: 'Lista para cobranza: los más atrasados primero. La mora se calcula a hoy con la regla del plan.' };
      }
      case 'fin_prox': {
        const L = libroFin(x);
        const cols = [T('Cliente'), T('Teléfono'), T('Código', { m: 1 }), T('Cuota', { r: 1 }), $('Capital'), $('Interés'), $('Por cobrar')];
        const l = L.cuotas.filter(q => !q.c.pagado && q.f.estado === 'activo' && q.venc >= desde && q.venc <= hasta);
        return { cols, grupos: agrupar(l, q => dmy(q.venc), q => [q.f.cliente_nombre || '', q.cli.telefono || '', q.f.codigo || '', q.c.numero, q.capP, q.intP, q.capP + q.intP + q.moraP], cols, ks => ks.sort((a2, b2) => a2.split('/').reverse().join('').localeCompare(b2.split('/').reverse().join('')))), nota: 'Cuotas pendientes que vencen entre las fechas elegidas (usa «Hoy» o «7 días» para la cobranza de la semana).' };
      }
      case 'fin_cobros': {
        const fin = {}; x.fins.forEach(f => { fin[f.id] = f; }); const cn = {}; x.cuotas.forEach(c => { cn[c.id] = c.numero; });
        const l = x.pagos.filter(p => { const d = diaRD(p.fecha); return d >= desde && d <= hasta; });
        const sg = p => p.tipo === 'reversa' ? -1 : 1;
        const cols = [T('Fecha'), T('Código', { m: 1 }), T('Cliente'), T('Cuota', { r: 1 }), T('Tipo'), $('Capital'), $('Interés'), $('Mora'), $('Total')];
        return { cols, grupos: agrupar(l, p => p.metodo || 'Otro', p => [dmy(p.fecha), (fin[p.financiamiento_id] || {}).codigo || '', (fin[p.financiamiento_id] || {}).cliente_nombre || '', cn[p.cuota_id] || '', p.tipo === 'reversa' ? 'Reversa' : 'Pago', sg(p) * n(p.monto_principal), sg(p) * n(p.monto_interes), sg(p) * n(p.monto_mora), sg(p) * n(p.monto)], cols, porTotalDesc(8)), nota: 'Las reversas restan. Interés y mora son ingreso; el capital solo recupera lo prestado.' };
      }
      case 'fin_otorgados': {
        const cols = [T('Código', { m: 1 }), T('Fecha'), T('Cliente'), T('Artículo'), $('Precio'), $('Inicial'), $('Financiado'), $('Interés'), $('Total en cuotas')];
        const pl = {}; x.planes.forEach(p => { pl[p.id] = p.nombre; });
        const l = x.fins.filter(f => { const d = diaRD(f.created_at); return d >= desde && d <= hasta; });
        return { cols, grupos: agrupar(l, f => pl[f.plan_id] || 'Sin plan', f => [f.codigo || '', dmy(f.created_at), f.cliente_nombre || '', f.descripcion || '', n(f.monto_total), n(f.inicial), n(f.monto_financiado), n(f.interes_total), n(f.monto_financiado) + n(f.interes_total)], cols, porTotalDesc(6)) };
      }
      case 'fin_sol': {
        const cols = [T('Código', { m: 1 }), T('Fecha'), T('Cliente'), T('Registró'), $('Precio'), $('Inicial'), T('Decisión')];
        const l = x.sols.filter(s2 => { const d = diaRD(s2.created_at); return d >= desde && d <= hasta; });
        const est = { pendiente: '1 · Por aprobar', aprobada: '2 · Aprobadas', rechazada: '3 · Rechazadas', borrador: '4 · Borradores' };
        return { cols, grupos: agrupar(l, s2 => est[s2.estado] || s2.estado, s2 => [s2.codigo || '', dmy(s2.created_at), s2.cliente_nombre || '', s2.creado_por_nombre || '', n(s2.precio_total), n(s2.inicial), s2.decidido_en ? dmy(s2.decidido_en) + (s2.motivo_rechazo ? ' · ' + s2.motivo_rechazo : '') : ''], cols, ks => ks.sort()).map(g => Object.assign(g, { t: g.t.replace(/^\d · /, '') })) };
      }
      case 'fin_firmas': {
        const tel = {}; x.clientes.forEach(c => { tel[c.id] = c.telefono; });
        const cols = [T('Código', { m: 1 }), T('Cliente'), T('Teléfono'), T('Desde'), T('Link'), T('Firma tienda')];
        const l = x.fins.filter(f => f.estado === 'activo' && !f.firma_cliente_en);
        return { cols, grupos: [grupo('', l.map(f => [f.codigo || '', f.cliente_nombre || '', tel[f.cliente_id] || '—', dmy(f.created_at), f.firma_token_vence && new Date(f.firma_token_vence) > new Date() ? 'Vigente hasta ' + dmy(f.firma_token_vence) : 'Vencido (se crea uno nuevo al enviar)', f.firma_tienda_en ? 'Sí' : 'Falta']), cols)], alCorte: 1, nota: 'Para enviar el link: Cuotas → abre el financiamiento → «Enviar link de firma por WhatsApp». Si el link venció, el sistema crea uno nuevo.' };
      }
      case 'ganancias': {
        const L = analisisGanancia(C); const T = sumarGan(L);
        const pp = {}; L.forEach(l => { (pp[l.k] = pp[l.k] || []).push(l); });
        const arts = Object.values(pp).map(ls => Object.assign(sumarGan(ls), { nom: ls[0].nom, cod: ls[0].cod, cat: ls[0].cat }));
        const cols = [T0('Código', { m: 1 }), T0('Artículo'), $('Cant.', { fmt: fmtN }), $('Vendido'), $('Costo'), $('Ganancia'), $('ITBIS a pagar'), $('Ganancia real'), T0('Margen real', { r: 1 })];
        const fila = o => [o.cod, o.nom + (o.sinCosto ? ' *' : ''), o.c, o.imp, o.costo, o.gan, o.itbPagar, o.real, o.sinCosto ? '—' : (o.neto ? pct(o.real, o.neto) + '%' : '')];
        const est = o => o.sinCosto ? '1 · Sin costo registrado (revisar)' : o.real < 0 ? '2 · Con pérdida real' : pct(o.real, o.neto) < 5 ? '3 · Margen bajo (menos de 5%)' : '4 · Rentables (5% o más)';
        const modo = fv || 'estado';
        let grupos;
        if (modo === 'categoria') grupos = agrupar(arts.sort((a2, b2) => b2.real - a2.real), o => o.cat ? (catBy[o.cat] || 'Sin categoría') : 'Sin categoría', fila, cols, porTotalDesc(7));
        else if (modo === 'todos') grupos = [grupo('', arts.sort((a2, b2) => b2.real - a2.real).map(fila), cols)];
        else grupos = agrupar(arts.sort((a2, b2) => (a2.real < 0 && b2.real < 0) ? a2.real - b2.real : b2.real - a2.real), est, fila, cols, ks => ks.sort()).map(g => Object.assign(g, { t: g.t.replace(/^\d · /, '') }));
        const sinC = arts.filter(o => o.sinCosto), perd = arts.filter(o => !o.sinCosto && o.real < 0);
        const crTot = T.cr, costoSinCF = T.costo - crTot;
        const devTot = C.dev.reduce((a2, d) => a2 + n(d.total), 0);
        const alertas = [
          sinC.length ? ['bad', `<b>${sinC.length} artículo(s) se vendieron sin costo registrado</b> (marcados con *). Suman ${m2(sumarGan(L.filter(l => l.sinCosto)).imp)} en ventas y su ganancia sale inflada. Ponles el costo en Inventario.`] : null,
          perd.length ? ['bad', `<b>${perd.length} artículo(s) dejan pérdida real</b> después del ITBIS: ${m2(-perd.reduce((a2, o) => a2 + o.real, 0))} en total. Revisa su precio o regístralos como compra «Con ITBIS» si tenías comprobante.`] : null,
          T.costo > 0 && crTot < T.costo * 0.5 ? ['warn', `El ${Math.round((1 - crTot / T.costo) * 100)}% del costo vendido no tiene crédito fiscal (compras informales o costos anteriores a este sistema). Por eso casi todo el ITBIS de las ventas sale a pagar. Si esas compras tenían NCF, regístralas como «Con ITBIS» y la ganancia real sube.`] : null,
          devTot ? ['info', `Devoluciones del período: ${m2(devTot)}. No están restadas artículo por artículo; ver Estado de Resultados.`] : null,
          ['info', 'El ITBIS a pagar es un estimado sobre lo vendido. La declaración (IT-1) usa todas las compras del mes con comprobante: ver Contabilidad → Resumen de ITBIS.']
        ];
        return { cols, grupos, sinToggle: 1, resumen: resumenGanancia(T, alertas), filtro: { l: 'Agrupar por', def: 'estado', o: [['estado', 'Estado (pérdida / margen)'], ['categoria', 'Categoría'], ['todos', 'Sin agrupar']] },
          nota: 'Ganancia = vendido − costo (lo que cobraste menos lo que pagaste). Ganancia real = ganancia − ITBIS a pagar = venta sin ITBIS − costo sin el ITBIS recuperable. En compras informales el ITBIS no se recupera y ya está dentro del costo.' };
      }
      case 'inv_gandia': {
        const L = analisisGanancia(C); const d = {}; L.forEach(l => { (d[l.dia] = d[l.dia] || []).push(l); });
        const fac = {}; C.ven.forEach(v => { const k = diaRD(v.fecha); fac[k] = (fac[k] || 0) + 1; });
        const cols = [T0('Fecha'), $('Facturas', { fmt: v => String(v) }), $('Vendido'), $('Costo'), $('Ganancia'), $('ITBIS a pagar'), $('Ganancia real'), T0('Margen real', { r: 1 })];
        const l = Object.keys(d).sort().map(k => { const o = sumarGan(d[k]); return [dmy(k), fac[k] || 0, o.imp, o.costo, o.gan, o.itbPagar, o.real, o.neto ? pct(o.real, o.neto) + '%' : '']; });
        const T = sumarGan(L);
        return { cols, grupos: [grupo('', l, cols)], sinToggle: 1, resumen: resumenGanancia(T, [['info', 'No descuenta devoluciones ni gastos. El ITBIS a pagar es un estimado sobre lo vendido.']]), nota: 'Ganancia = vendido − costo. Ganancia real = después de pagar el ITBIS de la venta menos el crédito fiscal de la mercancía.' };
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
  // Paginación estilo Infoplus: registros de 10 en 10 (el dueño puede elegir 25, 50 o todos). Imprimir y Excel llevan todo.
  let tam = 10; try { const t = parseInt(localStorage.getItem('studio_rep_tam'), 10); if ([10, 25, 50, 0].includes(t)) tam = t; } catch (e) {}
  const pag = {}; let ultimoR = null;
  function hoja(id, R, todo) {
    const e = (window.CFG || {}); const emp = { nom: e.empNom || 'STUDIO', rnc: e.empRNC || '', dir: e.empDir || '', tel: e.empTel || '' };
    const s = (ctx().sesion && ctx().sesion()) || {};
    const ahora = new Date().toLocaleString('es-DO', { timeZone: 'America/Santo_Domingo', dateStyle: 'short', timeStyle: 'short' });
    const cols = R.cols; const nc = cols.length;
    const firstSum = cols.findIndex(c => c.sum);
    const filaSum = (lbl, arr, cls) => `<tr class="${cls}"><td colspan="${firstSum > 0 ? firstSum : 1}">${esc(lbl)}</td>${cols.slice(firstSum > 0 ? firstSum : 1).map((c, j) => { const i = j + (firstSum > 0 ? firstSum : 1); return `<td class="r">${arr[i] != null ? (cols[i].fmt || m2)(arr[i]) : ''}</td>`; }).join('')}</tr>`;
    let body = '', nFilas = 0; const tot = cols.map(c => c.sum ? 0 : null);
    const conGrupos = R.grupos.length > 1 || (R.grupos[0] && R.grupos[0].t);
    const totalFilas = R.grupos.reduce((a, g) => a + g.filas.length, 0);
    const porPag = todo || !tam ? totalFilas || 1 : tam;
    const paginas = Math.max(1, Math.ceil(totalFilas / porPag));
    let pg = todo ? 0 : Math.min(pag[rep] || 0, paginas - 1); if (!todo) pag[rep] = pg;
    const ini = pg * porPag, fin = ini + porPag; let k = 0;
    R.grupos.forEach(g => {
      const gIni = k, gFin = k + g.filas.length; // filas de este grupo: [gIni, gFin)
      const visible = gFin > ini && gIni < fin;
      if (g.t && visible) body += `<tr class="g"><td colspan="${nc}">${esc(g.t)}${gIni < ini ? ' <span class="cont">(continuación)</span>' : ''}</td></tr>`;
      g.filas.forEach(f => { if (!f._ini) nFilas++; if (k >= ini && k < fin) body += `<tr>${cols.map((c, i) => `<td class="${c.r ? 'r' : ''}${c.m ? ' m' : ''}">${celda(c, f[i])}</td>`).join('')}</tr>`; k++; });
      g.sub.forEach((v, i) => { if (v != null) tot[i] += v; });
      if (conGrupos && g.t && g.filas.length && firstSum > 0 && gFin > ini && gFin <= fin) body += filaSum('Subtotal ' + g.t + ' (' + g.filas.length + ')', g.sub, 'st');
    });
    const pagMini = !todo && paginas > 1 ? `<nav class="nxRpPag mini" aria-label="Páginas"><span>${ini + 1}–${Math.min(fin, totalFilas)} de ${totalFilas}</span><div class="b"><button type="button" ${pg ? '' : 'disabled'} onclick="window.nxReportes.pagina(${pg - 1})" aria-label="Anterior"><i class="ti ti-chevron-left"></i></button><b>${pg + 1} / ${paginas}</b><button type="button" ${pg < paginas - 1 ? '' : 'disabled'} onclick="window.nxReportes.pagina(${pg + 1})" aria-label="Siguiente"><i class="ti ti-chevron-right"></i></button></div></nav>` : '';
    const paginador = (!todo && paginas > 1) || (!todo && totalFilas > 10) ? `<nav class="nxRpPag" aria-label="Páginas">
        <span>Mostrando ${totalFilas ? ini + 1 : 0}–${Math.min(fin, totalFilas)} de ${totalFilas}</span>
        <label>Ver <select onchange="window.nxReportes.tam(this.value)">${[[10, '10'], [25, '25'], [50, '50'], [0, 'Todos']].map(o => `<option value="${o[0]}"${tam === o[0] ? ' selected' : ''}>${o[1]}</option>`).join('')}</select></label>
        <div class="b"><button type="button" ${pg ? '' : 'disabled'} onclick="window.nxReportes.pagina(0)" aria-label="Primera página"><i class="ti ti-chevrons-left"></i></button><button type="button" ${pg ? '' : 'disabled'} onclick="window.nxReportes.pagina(${pg - 1})" aria-label="Anterior"><i class="ti ti-chevron-left"></i></button><b>${pg + 1} / ${paginas}</b><button type="button" ${pg < paginas - 1 ? '' : 'disabled'} onclick="window.nxReportes.pagina(${pg + 1})" aria-label="Siguiente"><i class="ti ti-chevron-right"></i></button><button type="button" ${pg < paginas - 1 ? '' : 'disabled'} onclick="window.nxReportes.pagina(${paginas - 1})" aria-label="Última página"><i class="ti ti-chevrons-right"></i></button></div>
      </nav>` : '';
    if (!nFilas) body = `<tr><td colspan="${nc}" class="vac">No hay datos para este reporte${R.alCorte ? '' : ' en el rango elegido'}.</td></tr>`;
    let pie = '';
    if (R.total) pie = `<tr class="tt"><td colspan="${nc - 1}">${esc(R.total[0])}</td><td class="r">${m2(R.total[1])}</td></tr>`;
    else if (nFilas && firstSum > 0) pie = filaSum('Total general (' + nFilas + ' registro' + (nFilas === 1 ? '' : 's') + ')', tot, 'tt');
    ultimo = { titulo: REP[id].t, cols, grupos: R.grupos, total: R.total, tot }; ultimoR = R;
    const rango = R.alCorte ? 'Al ' + dmy(hasta) : 'Desde ' + dmy(desde) + ' hasta ' + dmy(hasta);
    const fTxt = R.filtro && fsel[rep] ? ((R.filtro.o.find(o => o[0] === fsel[rep]) || [])[1] || '') : '';
    return `<article class="nxRpSheet" id="${todo ? 'nxRpSheetPrint' : 'nxRpSheet'}">
      <header class="nxRpSH"><div class="emp"><b>${esc(emp.nom)}</b>${emp.rnc ? `<span>RNC ${esc(emp.rnc)}</span>` : ''}${emp.dir || emp.tel ? `<span>${esc([emp.dir, emp.tel].filter(Boolean).join(' · '))}</span>` : ''}</div>
        <div class="tit"><h3>${esc(REP[id].t)}</h3><span>${rango}</span>${fTxt ? `<span>${esc(R.filtro.l)}: ${esc(fTxt)}</span>` : ''}<span>Valores en RD$${R.sinToggle ? '' : ' · ' + (conItbis ? 'con ITBIS' : 'sin ITBIS')}</span></div></header>
      ${R.resumen || ''}${pagMini}<div class="nxRpTw"><table class="nxRpT nxRpST"><thead><tr>${cols.map(c => `<th class="${c.r ? 'r' : ''}">${esc(c.l)}</th>`).join('')}</tr></thead><tbody>${body}</tbody>${pie ? `<tfoot>${pie}</tfoot>` : ''}</table></div>${paginador}
      ${R.nota ? `<p class="nxRpNote">${esc(R.nota)}</p>` : ''}
      <footer class="nxRpSF"><span>Generado por ${esc(s.nom || s.nombre || 'usuario')} · ${esc(ahora)}</span><span>STUDIO · Reportes</span></footer>
    </article>`;
  }

  // ── Render ─────────────────────────────────────────────────────────
  function barraRango(R) {
    const rangos = [['hoy', 'Hoy'], ['sem', '7 días'], ['mes', 'Este mes'], ['mesant', 'Mes anterior'], ['anio', 'Este año']];
    const f = R && R.filtro ? `<label class="nxRpFil">${esc(R.filtro.l)}<select onchange="window.nxReportes.filtro(this.value)">${R.filtro.def ? '' : '<option value="">Todos</option>'}${R.filtro.o.map(o => `<option value="${esc(o[0])}"${(fsel[rep] || R.filtro.def) === o[0] ? ' selected' : ''}>${esc(o[1])}</option>`).join('')}</select></label>` : '';
    const alCorte = R && R.alCorte;
    const bus = R && R.buscar ? `<label class="nxRpFil nxRpBus">Buscar<input type="search" value="${esc(fbus[rep] || '')}" placeholder="${esc(R.buscar)}" onchange="window.nxReportes.buscar(this.value)" onkeydown="if(event.key==='Enter')this.blur()"></label>` : '';
    return `<div class="nxRpTop">
      <button type="button" class="nxRpBack" onclick="window.nxReportes.menu()"><i class="ti ti-list-details"></i> Menú de reportes</button>
      <div class="nxRpRange">${alCorte ? '' : `<label>Desde<input type="date" value="${esc(desde)}" onchange="window.nxReportes.rango('d',this.value)"></label>`}<label>${alCorte ? 'Al' : 'Hasta'}<input type="date" value="${esc(hasta)}" onchange="window.nxReportes.rango('h',this.value)"></label>${f}${bus}</div>
      ${alCorte ? '' : `<div class="nxRpPres">${rangos.map(r => `<button type="button" class="nxRpChip" onclick="window.nxReportes.preset('${r[0]}')">${r[1]}</button>`).join('')}</div>`}
      ${R && R.sinToggle ? '' : `<label class="nxRpItb"><input type="checkbox" ${conItbis ? 'checked' : ''} onchange="window.nxReportes.itbis(this.checked)"><span>Con ITBIS</span></label>`}
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
        else { R = construir(REP[rep].b, C, x || {}, rep); body = R ? (R.panel || '') + hoja(rep, R) : '<div class="nxRpLoad">Reporte no disponible.</div>'; }
      }
    }
    const sub = rep ? (CAT.find(c => c[0] === REP[rep].cat) || [])[1] + ' · ' + REP[rep].t : 'Resumen general · del ' + dmy(desde) + ' al ' + dmy(hasta);
    return `<div class="nxRp${rep ? ' conRep' : ''}" id="nxRpRoot"><div class="nxRpHead"><h2>Reportes</h2><p>${esc(sub)}${cargando ? ' · actualizando…' : ''}</p></div>
      <div class="nxRpLay solo"><div class="nxRpMain">${barraRango(R)}<div class="nxRpBody">${body}</div></div></div></div>`;
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
    let src = document.getElementById('nxRpRoot'); if (!src) return;
    if (rep && ultimoR) { const t = document.createElement('div'); t.innerHTML = hoja(rep, ultimoR, true); src = t.firstElementChild; }
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
.nxRpLay.solo{grid-template-columns:minmax(0,1fr)}.nxRpLay{display:grid;grid-template-columns:270px minmax(0,1fr);min-width:0;gap:16px;align-items:start}
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
.nxRpCom{display:grid;gap:10px;margin:0 0 12px;padding:12px;border:1px solid var(--rp-line);border-radius:14px;background:var(--studio-paper,#fff)}.nxRpComTipos{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none}.nxRpComTipos .nxRpChip{white-space:nowrap}.nxRpComTipos .nxRpChip.on{background:var(--rp-ink);color:#fff;border-color:var(--rp-ink)}.nxRpComG{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:8px}.nxRpComG label{display:flex;flex-direction:column;gap:4px;font-size:11px;font-weight:600;color:var(--rp-mute)}.nxRpComG input{height:36px;border:1px solid rgba(0,0,0,.16);border-radius:10px;padding:0 10px;font-size:14px;background:#fff;font-variant-numeric:tabular-nums;min-width:0}.nxRpComCfg{font-size:12px;color:var(--rp-mute);margin:0 0 8px}.nxRpComCfg b{color:var(--rp-ink)}
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
html #v-pos .nxTNav.nxTRepTop i.chev{background:none!important;box-shadow:none!important;border:0!important;width:auto!important;height:auto!important;min-width:0!important;padding:0!important;color:inherit!important}.nxTRepTop .chev{margin-left:auto;font-size:14px;opacity:.5;transition:transform .2s}.nxTRep:not(.ab) .nxTRepTop .chev{transform:rotate(90deg)}
.nxTRepL{display:none;padding:2px 0 6px 8px}.nxTRep.ab .nxTRepL{display:block}
.nxTRepH,.nxTRepI{display:flex;align-items:center;gap:8px;width:100%;border:0;background:transparent;cursor:pointer;font-family:inherit;text-align:left;text-transform:none;letter-spacing:0}
.nxTRepH{min-height:34px;padding:4px 10px;border-radius:8px;color:rgba(255,254,250,.78);font-size:13px;font-weight:600}.nxTRepH>i:first-child{font-size:15px;width:18px;color:var(--studio-gold,#c9a227)}.nxTRepH span{flex:1}
.nxTRepH .chev{font-size:13px;opacity:.45;transition:transform .2s}.nxTRepG:not(.ab) .nxTRepH .chev{transform:rotate(90deg)}.nxTRepH:hover,.nxTRepI:hover{background:rgba(255,255,255,.06);color:#fffefa}
.nxTRepS{display:none;margin:0 0 4px 18px;padding-left:8px;border-left:1px solid rgba(255,255,255,.1)}.nxTRepG.ab .nxTRepS{display:block}
.nxTRepI{min-height:30px;padding:5px 10px;border-radius:7px;color:rgba(255,254,250,.6);font-size:12.5px;font-weight:500;line-height:1.3}.nxTRepI.res{color:rgba(255,254,250,.78);font-weight:600;font-size:13px}.nxTRepI.res i{font-size:15px;width:18px;color:var(--studio-gold,#c9a227)}
.nxTRepI.on{background:var(--studio-gold,#c9a227);color:#0a0a0a!important;font-weight:700}.nxTRepI.on i{color:#0a0a0a!important}
@media(max-width:900px){.nxTRepH{min-height:42px;font-size:14px}.nxTRepI{min-height:40px;font-size:14px}}
@media(prefers-reduced-motion:reduce){.nxTRepTop .chev,.nxTRepH .chev{transition:none}}
.nxRpGan{margin:0 0 14px}.nxRpGan .nxRpKpis{grid-template-columns:repeat(auto-fit,minmax(170px,1fr))}.nxRpGan .nxRpK b{font-size:18px}
.nxRpCien{margin:4px 0 10px;padding:12px 14px;border:1px solid var(--rp-line);border-radius:12px;background:#fcfbf7}.nxRpCien .t{font-size:13.5px;line-height:1.45;margin-bottom:8px}.nxRpCien b.ok{color:#15803d}.nxRpCien b.bad{color:#b91c1c}
.nxRpCien .bar{display:flex;height:14px;border-radius:7px;overflow:hidden;background:rgba(10,10,10,.06)}.nxRpCien .bar i{display:block;height:100%}
.nxRpCien i.cos{background:#262626}.nxRpCien i.itb{background:#c9a227}.nxRpCien i.gan{background:#16a34a}
.nxRpCien .ley{display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:6px;font-size:11.5px;color:var(--rp-mute)}.nxRpCien .ley span{display:inline-flex;align-items:center;gap:5px}.nxRpCien .ley i{width:10px;height:10px;border-radius:3px;display:inline-block}
.nxRpAl{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}.nxRpAl li{display:flex;gap:9px;align-items:flex-start;padding:9px 12px;border-radius:10px;font-size:12.5px;line-height:1.45;border:1px solid var(--rp-line);background:#fff}
.nxRpAl li i{font-size:17px;flex:none;margin-top:1px}.nxRpAl li.bad{background:#fef2f2;border-color:#fecaca}.nxRpAl li.bad i{color:#b91c1c}.nxRpAl li.warn{background:#fffbeb;border-color:#fde68a}.nxRpAl li.warn i{color:#b45309}.nxRpAl li.info i{color:var(--rp-gold-d)}
@media(max-width:760px){.nxRpGan .nxRpKpis{grid-template-columns:1fr 1fr}.nxRpGan .nxRpK.main{grid-column:1/-1}.nxRpGan .nxRpK b{font-size:16px}.nxRpGan .nxRpK small{font-size:11px}}
@media print{.nxRpCien{break-inside:avoid}.nxRpAl li{break-inside:avoid}}
.nxRpItb{display:inline-flex;align-items:center;gap:8px;height:36px;padding:0 14px 0 10px;border:1px solid rgba(0,0,0,.14);border-radius:999px;background:#fff;font-size:13px;font-weight:600;color:var(--rp-ink);cursor:pointer;user-select:none}
.nxRpItb input{width:18px;height:18px;margin:0;accent-color:#0a0a0a;cursor:pointer}
.nxRpPag{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px 14px;margin:8px 0;font-size:12.5px;color:var(--rp-mute)}
.nxRpPag label{display:inline-flex;align-items:center;gap:6px}.nxRpPag select{height:32px;border:1px solid rgba(0,0,0,.16);border-radius:8px;padding:0 8px;background:#fff;font-size:13px;color:var(--rp-ink)}
.nxRpPag .b{display:inline-flex;align-items:center;gap:4px}.nxRpPag .b b{min-width:64px;text-align:center;color:var(--rp-ink);font-variant-numeric:tabular-nums}
.nxRpPag button{width:34px;height:34px;border:1px solid rgba(0,0,0,.14);border-radius:9px;background:#fff;color:var(--rp-ink);font-size:16px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center}
.nxRpPag button[disabled]{opacity:.35;cursor:default}.nxRpPag button:not([disabled]):active{background:#0a0a0a;color:#fffefa}
.nxRpPag.mini{margin:0 0 8px}.nxRpST tr.g .cont{font-weight:500;color:var(--rp-mute);font-size:11.5px}
.nxRpRange input,.nxRpFil select,.nxRpBus input{min-width:0;max-width:100%;box-sizing:border-box}
@media(max-width:900px){.nxRp{overflow-x:hidden}.nxRpRange{display:grid!important;grid-template-columns:1fr 1fr;gap:8px;width:100%}.nxRpRange label{min-width:0}.nxRpRange input[type=date]{-webkit-appearance:none;appearance:none;display:block;width:100%;min-width:0;text-align:left;line-height:40px}.nxRpFil,.nxRpBus{grid-column:1/-1}.nxRpBus input{min-width:0;width:100%;height:40px;font-size:16px}
.nxRpPres{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;width:100%;padding-bottom:2px}.nxRpPres::-webkit-scrollbar{display:none}.nxRpChip{flex:none}.nxRpItb{height:40px}.nxRpPag{justify-content:space-between}.nxRpPag .b button:has(.ti-chevrons-left),.nxRpPag .b button:has(.ti-chevrons-right){display:none}.nxRpPag button{width:40px;height:40px}
.nxRpCat{padding:6px}.nxRpCatRes,.nxRpCatH{min-height:48px}}
@media(max-width:900px){.nxRpLay{grid-template-columns:minmax(0,1fr)}.nxRpMain{min-width:0}.nxRpRange{flex-wrap:wrap}.nxRpRange label{flex:1 1 40%}.nxRpST{min-width:560px}.nxRpST td.r,.nxRpST td.m{white-space:nowrap}.nxRpST td:not(.r):not(.m){min-width:120px;max-width:220px;white-space:normal}.nxRpCat{position:static;max-height:none}.nxRp.conRep .nxRpCat{display:none}.nxRpBack{display:inline-flex}
.nxRpSheet{padding:16px 14px 12px;border-radius:12px}.nxRpSH{flex-direction:column;gap:8px}.nxRpSH .tit{text-align:left}.nxRpFil{flex:1 1 100%}.nxRpBus input{height:36px;border:1px solid rgba(0,0,0,.16);border-radius:10px;padding:0 10px;font-size:13px;background:#fff;min-width:220px;text-transform:none}.nxRpFil select{max-width:none;height:40px;font-size:16px}.nxRpCatI{min-height:42px;font-size:14.5px}}`;
    document.head.appendChild(st);
  }

  // ── Reportes en la barra lateral del POS (pedido del dueño: «que los reportes se vean desde la barra lateral», como Infoplus) ──
  // parches-pos.js (shellTienda) llama navHTML() en lugar del botón plano «Reportes». Abrir/cerrar grupos se hace directo en el
  // DOM (sin volver a dibujar la barra, así no salta el scroll); elegir un reporte navega y conserva la posición de la barra.
  let sideAb = null;
  function navHTML(activo) {
    ensureCSS();
    const vc = puedeCosto();
    const ab = sideAb == null ? !!activo : sideAb;
    return `<div class="nxTRep${ab ? ' ab' : ''}">
      <button type="button" class="nxTNav nxTRepTop${activo ? ' on' : ''}" aria-expanded="${ab}" onclick="window.nxReportes.sideToggle(this)"><i class="ti ti-chart-pie"></i> Reportes<i class="ti ti-chevron-down chev"></i></button>
      <div class="nxTRepL">
        <button type="button" class="nxTRepI res${activo && !rep ? ' on' : ''}" onclick="window.nxReportes.ir('')"><i class="ti ti-layout-dashboard"></i> Resumen general</button>
        ${CAT.map(c => { const reps = c[3].filter(r => vc || !sens(r[0])); if (!reps.length) return ''; const g = !!abierto[c[0]]; return `<div class="nxTRepG${g ? ' ab' : ''}"><button type="button" class="nxTRepH" aria-expanded="${g}" onclick="window.nxReportes.sideCat(this,'${c[0]}')"><i class="ti ${c[2]}"></i><span>${esc(c[1])}</span><i class="ti ti-chevron-down chev"></i></button><div class="nxTRepS">${reps.map(r => `<button type="button" class="nxTRepI${activo && rep === r[0] ? ' on' : ''}" onclick="window.nxReportes.ir('${r[0]}')">${esc(r[1])}</button>`).join('')}</div></div>`; }).join('')}
      </div>
    </div>`;
  }
  function scrollSide() { const e = document.querySelector('#nxTSide .nxTScroll'); return e ? e.scrollTop : 0; }
  function restaurarSide(y) { const e = document.querySelector('#nxTSide .nxTScroll'); if (e) e.scrollTop = y; }
  async function ir(id) {
    rep = REP[id] ? id : ''; if (rep) abierto[REP[rep].cat] = true; sideAb = true;
    try { localStorage.setItem('studio_rep_sel', rep); localStorage.setItem('studio_rep_cat', JSON.stringify(abierto)); } catch (e) {}
    const y = scrollSide();
    try { document.body.classList.remove('nxTDrawer'); } catch (e) {}
    if (!document.getElementById('nxRpRoot') && window.nxPosTab) await window.nxPosTab('reportes'); else repintar();
    restaurarSide(y);
    try { const m = document.querySelector('#nxRpRoot'); if (m && m.getBoundingClientRect().top < 0) m.scrollIntoView({ block: 'start' }); } catch (e) {}
  }

  window.nxReportes = {
    navHTML, ir,
    menu: function () { if (window.nxPosToggleSide) window.nxPosToggleSide(); setTimeout(() => { const w = document.querySelector('#nxTSide .nxTRep'), sc = document.querySelector('#nxTSide .nxTScroll'); if (w && sc) sc.scrollTop = Math.max(0, w.offsetTop - sc.offsetTop - 8); }, 60); },
    sideToggle: function (b) { const w = b.closest('.nxTRep'); if (!w) return; sideAb = w.classList.toggle('ab'); b.setAttribute('aria-expanded', String(sideAb)); },
    sideCat: function (b, k) { const g = b.closest('.nxTRepG'); if (!g) return; abierto[k] = g.classList.toggle('ab'); b.setAttribute('aria-expanded', String(abierto[k])); try { localStorage.setItem('studio_rep_cat', JSON.stringify(abierto)); } catch (e) {} },
    cargar, render, postRender, recargar, preset, csv, imprimir,
    abrir: function (id) { rep = REP[id] ? id : ''; if (rep) abierto[REP[rep].cat] = true; try { localStorage.setItem('studio_rep_sel', rep); localStorage.setItem('studio_rep_cat', JSON.stringify(abierto)); } catch (e) {} repintar(); try { const m = document.querySelector('#nxRpRoot .nxRpMain'); if (m && window.innerWidth < 900 && rep) m.scrollIntoView({ block: 'start' }); } catch (e) {} },
    cat: function (k) { abierto[k] = !abierto[k]; try { localStorage.setItem('studio_rep_cat', JSON.stringify(abierto)); } catch (e) {} repintar(); },
    com: function (k, v) { com[k] = k === 'tipo' ? v : String(v || '').replace(',', '.').replace(/[^\d.]/g, ''); try { localStorage.setItem('studio_rep_com', JSON.stringify(com)); } catch (e) {} if (rep) pag[rep] = 0; repintar(); },
    filtro: function (v) { if (rep) { fsel[rep] = v; pag[rep] = 0; } repintar(); },
    buscar: function (v) { if (rep) { fbus[rep] = v; pag[rep] = 0; } repintar(); },
    pagina: function (p) { if (rep) pag[rep] = Math.max(0, p | 0); repintar(); try { const t = document.getElementById('nxRpSheet'); if (t && t.getBoundingClientRect().top < 0) t.scrollIntoView({ block: 'start' }); } catch (e) {} },
    tam: function (v) { tam = parseInt(v, 10) || 0; try { localStorage.setItem('studio_rep_tam', String(tam)); } catch (e) {} if (rep) pag[rep] = 0; repintar(); },
    itbis: function (on) { conItbis = !!on; try { localStorage.setItem('studio_rep_itbis', on ? '1' : '0'); } catch (e) {} repintar(); },
    rango: function (k, v) { if (!v) return; if (k === 'd') desde = v; else { hasta = v; if (desde > hasta) desde = hasta; } if (desde > hasta) { const x = desde; desde = hasta; hasta = x; } recargar(); }
  };
})();
