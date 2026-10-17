/* STUDIO · Tablero de ventas (16-oct-2026)
 * Pedido del dueño: «mira ese Dashboard para mi sistema» (imagen de un tablero de ventas oscuro) → maqueta con datos
 * reales aprobada («Excelente, aplícalo»). Ventas, meta, ticket promedio y facturas comparados con el período anterior;
 * ventas por día (u hora o mes) con la línea de meta; formas de pago; desempeño del equipo; productos más vendidos.
 * Solo LECTURA de pos_ventas (+ pos_venta_items) y pos_devoluciones, con los mismos criterios de Reportes:
 * facturas «completada» (las anuladas no cuentan), montos con ITBIS tal como se cobraron, fecha local RD (UTC-4) y
 * vendedor = vendedor_nombre o, si falta, quien facturó. El total cuadra con la suma de las formas de pago.
 * Metas: tabla pos_metas_ventas (migración 53). Las define solo el administrador, por mes; la meta de un rango se reparte
 * por días. Sin la migración el tablero funciona igual y la meta dice que todavía no está disponible.
 * Lo ve quien tiene Reportes (admin y gerente por defecto). Movimiento según DESIGN.md §10 y reduced-motion.
 */
(function () {
  'use strict';
  if (window.nxTablero) return;
  function api() { try { return (typeof API !== 'undefined') ? API : window.API; } catch (e) { return window.API; } }
  function ctx() { return window.nxPosCtx || {}; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function n(v) { const x = Number(v); return isFinite(x) ? x : 0; }
  function fmt(v) { const r = Math.round(n(v) * 100) / 100; return 'RD$ ' + (r === 0 ? 0 : r).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function fmtEje(v) { const a = Math.abs(v); return a >= 1e6 ? (v / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'M' : a >= 1e3 ? Math.round(v / 1e3) + 'K' : String(Math.round(v)); }
  function fmtCorto(v) { const a = Math.abs(v); return a >= 1e6 ? 'RD$ ' + (v / 1e6).toFixed(2) + ' M' : a >= 1e3 ? 'RD$ ' + Math.round(v / 1e3) + ' K' : fmt(v); }
  function fmtPct(v) { return (Math.round(v * 10) / 10).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' %'; }
  function toast(t, m, s) { try { window.toast && window.toast(t, m, s); } catch (e) {} }
  function reduced() { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }
  function rol() { try { return ctx().rolEfectivo ? ctx().rolEfectivo() : 'admin'; } catch (e) { return ''; } }
  function esAdmin() { return rol() === 'admin'; }
  // Nombre para comparar (vendedores, productos): sin acentos, sin espacios dobles ni tabuladores, en mayúsculas.
  function norm(s) { return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase(); }
  function limpio(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }

  // ── Fechas (República Dominicana: UTC-4 todo el año, sin horario de verano) ──────────────────────────────────
  const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const MESL = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const DIA = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  function hoyISO() { try { return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santo_Domingo' }); } catch (e) { return new Date(Date.now() - 4 * 3600000).toISOString().slice(0, 10); } }
  function addDays(iso, d) { const t = new Date(iso + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10); }
  function diasEntre(a, b) { return Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 86400000); }
  function iniMes(iso) { return iso.slice(0, 8) + '01'; }
  function finMes(iso) { const y = +iso.slice(0, 4), m = +iso.slice(5, 7); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); }
  function diasMes(iso) { return +finMes(iso).slice(8); }
  function mesSig(iso) { return addDays(finMes(iso), 1); }
  function mesAnt(iso) { return iniMes(addDays(iniMes(iso), -1)); }
  function minISO(a, b) { return a < b ? a : b; }
  function maxISO(a, b) { return a > b ? a : b; }
  function tsDesde(d) { return encodeURIComponent(d + 'T00:00:00-04:00'); }
  function tsHasta(d) { return encodeURIComponent(addDays(d, 1) + 'T00:00:00-04:00'); }
  function partesRD(ts) { const t = new Date(ts); if (isNaN(t)) return null; const x = new Date(t.getTime() - 4 * 3600000); return { dia: x.toISOString().slice(0, 10), hora: x.getUTCHours() }; }
  function fCorta(iso) { return (+iso.slice(8)) + ' ' + MES[+iso.slice(5, 7) - 1]; }
  function fLarga(iso) { return fCorta(iso) + ' ' + iso.slice(0, 4); }
  function rangoTxt(a, b) { if (a === b) return fLarga(a); return (a.slice(0, 4) === b.slice(0, 4) ? fCorta(a) : fLarga(a)) + ' – ' + fLarga(b); }
  function diaSemana(iso) { return DIA[new Date(iso + 'T12:00:00Z').getUTCDay()]; }

  // ── Rango elegido ──────────────────────────────────────────────────────────────────────────────────────────
  const PRE = [['hoy', 'Hoy'], ['7d', '7 días'], ['mes', 'Este mes'], ['mesant', 'Mes anterior'], ['anio', 'Este año'], ['fechas', 'Fechas']];
  let pre = 'mes', cDesde = '', cHasta = '';
  try { const g = JSON.parse(localStorage.getItem('studio_tablero_rango') || 'null'); if (g && PRE.some(p => p[0] === g.pre)) { pre = g.pre; cDesde = g.d || ''; cHasta = g.h || ''; } } catch (e) {}
  function guardarRango() { try { localStorage.setItem('studio_tablero_rango', JSON.stringify({ pre: pre, d: cDesde, h: cHasta })); } catch (e) {} }
  function mismoDiaAnio(iso, y) { const m = y + iso.slice(4, 8) + '01'; return minISO(y + iso.slice(4), finMes(m)); }
  // Período de comparación: el mismo tramo del mes o del año anterior en los rangos de calendario; si no, los mismos días justo antes.
  function rango() {
    const h = hoyISO(); let d1, d2, p1, p2;
    if (pre === 'hoy') { d1 = d2 = h; p1 = p2 = addDays(h, -1); }
    else if (pre === '7d') { d1 = addDays(h, -6); d2 = h; p2 = addDays(d1, -1); p1 = addDays(p2, -6); }
    else if (pre === 'mes') { d1 = iniMes(h); d2 = h; p1 = mesAnt(h); p2 = minISO(addDays(p1, diasEntre(d1, d2)), finMes(p1)); }
    else if (pre === 'mesant') { d1 = mesAnt(h); d2 = finMes(d1); p1 = mesAnt(d1); p2 = finMes(p1); }
    else if (pre === 'anio') { d1 = h.slice(0, 4) + '-01-01'; d2 = h; const y = String(+h.slice(0, 4) - 1); p1 = y + '-01-01'; p2 = mismoDiaAnio(h, y); }
    else {
      d1 = /^\d{4}-\d{2}-\d{2}$/.test(cDesde) ? cDesde : iniMes(h); d2 = /^\d{4}-\d{2}-\d{2}$/.test(cHasta) ? cHasta : h;
      if (d1 > d2) { const x = d1; d1 = d2; d2 = x; }
      if (diasEntre(d1, d2) > 731) d1 = addDays(d2, -731);           // tope de dos años por consulta
      p2 = addDays(d1, -1); p1 = addDays(p2, -diasEntre(d1, d2));
    }
    return { d1: d1, d2: d2, p1: p1, p2: p2, hoy: h };
  }

  // ── Carga (solo lectura, por páginas de 1,000 como Reportes) ───────────────────────────────────────────────
  async function getAll(tabla, qs) {
    const out = []; const PAG = 1000;
    for (let off = 0; off < 60000; off += PAG) {
      const r = await api().get(tabla, qs + '&limit=' + PAG + '&offset=' + off) || [];
      out.push.apply(out, r);
      if (r.length < PAG) break;
    }
    return out;
  }
  let D = null, cargando = false, error = '', pedido = 0, entrada = true;
  async function cargarMetas(desdeMes, hastaMes) {
    try { return await api().get('pos_metas_ventas', 'select=mes,vendedor,monto&mes=gte.' + desdeMes + '&mes=lte.' + hastaMes + '&order=mes.asc'); }
    catch (e) { return null; }                                    // sin la migración 53 (o sin permiso): sin metas
  }
  async function cargar(forzar) {
    const r = rango(); const clave = [r.d1, r.d2, r.p1, r.p2].join('|');
    if (!forzar && D && D.clave === clave && !error) { actualizar(); return; }
    const id = ++pedido; cargando = true; error = ''; actualizar();
    try {
      const [ventas, previas, devol, metas, ultima] = await Promise.all([
        getAll('pos_ventas', 'select=id,fecha,total,estado,pagado_efectivo,pagado_tarjeta,pagado_transferencia,pagado_otro,credito_monto,vendedor_nombre,created_by_name,pos_venta_items(producto_id,nombre,cantidad,precio,importe)&fecha=gte.' + tsDesde(r.d1) + '&fecha=lt.' + tsHasta(r.d2) + '&order=fecha.asc'),
        getAll('pos_ventas', 'select=total,fecha,estado&estado=eq.completada&fecha=gte.' + tsDesde(r.p1) + '&fecha=lt.' + tsHasta(r.p2)),
        getAll('pos_devoluciones', 'select=total,estado,fecha&fecha=gte.' + r.d1 + '&fecha=lte.' + r.d2).catch(() => []),
        cargarMetas(iniMes(r.d1), iniMes(r.d2)),
        api().get('pos_ventas', 'select=fecha&estado=eq.completada&order=fecha.desc&limit=1').catch(() => [])
      ]);
      if (id !== pedido) return;                                   // llegó otra consulta más nueva: esta se descarta
      D = { clave: clave, r: r, ventas: ventas, previas: previas, devol: devol, metas: metas, ultima: (ultima && ultima[0] && ultima[0].fecha) || '' };
    } catch (e) {
      if (id !== pedido) return;
      error = String(e && e.message || e);
    }
    cargando = false; actualizar();
  }

  // ── Cálculos ───────────────────────────────────────────────────────────────────────────────────────────────
  const PAGOS = [['efectivo', 'Efectivo'], ['transferencia', 'Transferencia'], ['tarjeta', 'Tarjeta'], ['otro', 'Otro'], ['credito', 'Crédito y financiamiento']];
  function calc() {
    const r = D.r, ven = [], anul = [];
    D.ventas.forEach(v => { const p = partesRD(v.fecha); if (!p || p.dia < r.d1 || p.dia > r.d2) return; v._p = p; (v.estado === 'completada' ? ven : anul).push(v); });
    const prev = D.previas.filter(v => { const p = partesRD(v.fecha); return p && p.dia >= r.p1 && p.dia <= r.p2 && v.estado === 'completada'; });
    const dev = D.devol.filter(d => d.estado !== 'anulada' && String(d.fecha).slice(0, 10) >= r.d1 && String(d.fecha).slice(0, 10) <= r.d2);
    const dias = diasEntre(r.d1, r.d2) + 1, gran = dias === 1 ? 'hora' : dias <= 62 ? 'dia' : 'mes';
    // Cubetas de la gráfica
    const B = [], bIdx = {};
    if (gran === 'hora') for (let h = 0; h < 24; h++) { bIdx[h] = B.length; B.push({ k: h, et: String(h).padStart(2, '0') + ':00', larga: String(h).padStart(2, '0') + ':00 – ' + String(h).padStart(2, '0') + ':59', t: 0, n: 0, meta: 0 }); }
    else if (gran === 'dia') for (let d = r.d1; d <= r.d2; d = addDays(d, 1)) { bIdx[d] = B.length; B.push({ k: d, et: fCorta(d), larga: diaSemana(d) + ' ' + fLarga(d), t: 0, n: 0, meta: 0 }); }
    else for (let m = iniMes(r.d1); m <= r.d2; m = mesSig(m)) { const k = m.slice(0, 7); bIdx[k] = B.length; B.push({ k: k, et: MES[+m.slice(5, 7) - 1] + ' ' + m.slice(2, 4), larga: MESL[+m.slice(5, 7) - 1] + ' ' + m.slice(0, 4), ini: maxISO(m, r.d1), fin: minISO(finMes(m), r.d2), t: 0, n: 0, meta: 0 }); }
    let bruto = 0; const pago = { efectivo: 0, transferencia: 0, tarjeta: 0, otro: 0, credito: 0 };
    const porVend = {}, porProd = {};
    ven.forEach(v => {
      const t = n(v.total); bruto += t;
      const b = B[gran === 'hora' ? bIdx[v._p.hora] : gran === 'dia' ? bIdx[v._p.dia] : bIdx[v._p.dia.slice(0, 7)]]; if (b) { b.t += t; b.n++; }
      pago.efectivo += n(v.pagado_efectivo); pago.transferencia += n(v.pagado_transferencia); pago.tarjeta += n(v.pagado_tarjeta); pago.otro += n(v.pagado_otro); pago.credito += n(v.credito_monto);
      const vn = limpio(v.vendedor_nombre) || limpio(v.created_by_name) || 'Sin vendedor', vk = norm(vn);
      (porVend[vk] = porVend[vk] || { nom: vn, t: 0, n: 0 }); porVend[vk].t += t; porVend[vk].n++;
      (v.pos_venta_items || []).forEach(it => {
        // Por nombre limpio, no por ficha: en el inventario hay modelos repetidos con el mismo nombre (p. ej. tres fichas
        // «IPHONE 17 PRO MAX 256GB» con un tabulador delante) y para el dueño son un solo producto.
        const nom = limpio(it.nombre) || 'Artículo', k = norm(nom), c = n(it.cantidad);
        (porProd[k] = porProd[k] || { nom: nom, cant: 0, monto: 0 }); porProd[k].cant += c; porProd[k].monto += it.importe != null ? n(it.importe) : n(it.precio) * c;
      });
    });
    const devTot = dev.reduce((s, d) => s + n(d.total), 0);
    const pBruto = prev.reduce((s, v) => s + n(v.total), 0), pN = prev.length;
    // Metas: un mes que empieza el día 1 y no se sale de ese mes usa la meta completa del mes (con proyección al cierre);
    // cualquier otro rango reparte la meta de cada mes por los días que toca.
    const metasOk = Array.isArray(D.metas), metas = metasOk ? D.metas : [];
    const mesCompleto = r.d1 === iniMes(r.d1) && r.d2.slice(0, 7) === r.d1.slice(0, 7);
    const metaMes = (m, vk) => { const f = metas.find(x => String(x.mes).slice(0, 10) === m && norm(x.vendedor) === vk); return f ? n(f.monto) : 0; };
    const metaEntre = (vk, a, b) => { let s = 0; for (let m = iniMes(a); m <= b; m = mesSig(m)) { const mm = metaMes(m, vk); if (!mm) continue; s += mesCompleto ? mm : mm * (diasEntre(maxISO(a, m), minISO(b, finMes(m))) + 1) / diasMes(m); } return s; };
    const meta = metaEntre('', r.d1, r.d2);
    if (meta > 0 && gran === 'dia') B.forEach(b => { b.meta = metaMes(iniMes(b.k), '') / diasMes(b.k); });
    if (meta > 0 && gran === 'mes') B.forEach(b => { b.meta = metaEntre('', b.ini, b.fin); });
    const enCurso = mesCompleto && r.d2 === r.hoy && r.d2 < finMes(r.d2);
    const proyeccion = enCurso && bruto > 0 ? bruto / (+r.d2.slice(8)) * diasMes(r.d2) : 0;
    // Equipo: quien vendió en el rango y quien tiene meta aunque no haya vendido.
    metas.forEach(x => { const vk = norm(x.vendedor); if (vk && !porVend[vk] && metaEntre(vk, r.d1, r.d2) > 0) porVend[vk] = { nom: limpio(x.vendedor), t: 0, n: 0 }; });
    const equipo = Object.keys(porVend).map(k => Object.assign({ meta: metaEntre(k, r.d1, r.d2) }, porVend[k])).sort((a, b) => b.t - a.t || a.nom.localeCompare(b.nom));
    const prods = Object.keys(porProd).map(k => porProd[k]).sort((a, b) => b.monto - a.monto || b.cant - a.cant);
    return {
      r: r, gran: gran, B: B, ven: ven, anul: anul, bruto: bruto, n: ven.length, ticket: ven.length ? bruto / ven.length : 0,
      devTot: devTot, devN: dev.length, pBruto: pBruto, pN: pN, pTicket: pN ? pBruto / pN : 0, pago: pago,
      metasOk: metasOk, meta: meta, mesCompleto: mesCompleto, proyeccion: proyeccion, equipo: equipo, hayMetaVend: equipo.some(e => e.meta > 0), prods: prods
    };
  }

  // ── Piezas de UI ───────────────────────────────────────────────────────────────────────────────────────────
  let C = null, vis = null, raf = 0;
  function variacion(a, b) {
    if (!b) return a ? '<span class="nxTbNeu">Sin ventas en el período anterior</span>' : '<span class="nxTbNeu">Igual que el período anterior</span>';
    const d = (a - b) / b * 100, sube = d >= 0;
    return `<span class="${sube ? 'nxTbUp' : 'nxTbDn'}"><i class="ti ${sube ? 'ti-trending-up' : 'ti-trending-down'}" aria-hidden="true"></i>${sube ? '+' : '−'}${fmtPct(Math.abs(d))}</span> vs. período anterior`;
  }
  function kpi(k, ic, titulo, valor, sub, extra) {
    return `<section class="nxTbK" data-k="${k}"><div class="nxTbKh"><span>${titulo}</span><i class="ti ${ic}" aria-hidden="true"></i></div><div class="nxTbKv" id="nxTbKv-${k}">${valor}</div>${extra || ''}<div class="nxTbKs">${sub}</div></section>`;
  }
  function valorK(k, v) { return k === 'f' ? Math.round(v).toLocaleString('en-US') : k === 'm' ? fmtPct(v) : fmt(v); }
  function kpisHTML() {
    const ini = vis && !entrada ? vis : null;                  // al cambiar de rango, los números corren desde lo que se ve
    const val = (k, v) => valorK(k, ini ? ini[k] : v);
    const r = C.r, nomMes = MESL[+r.d1.slice(5, 7) - 1];
    let metaV, metaS, metaX = '';
    if (C.meta > 0) {
      const p = C.bruto / C.meta * 100, falta = C.meta - C.bruto;
      metaV = val('m', p);
      metaX = `<div class="nxTbBar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(Math.min(100, p))}" aria-label="Avance de la meta"><i id="nxTbMetaBar" style="transform:scaleX(${Math.min(1, (ini ? ini.m : p) / 100)})"></i></div>`;
      metaS = (falta > 0 ? 'Faltan ' + fmt(falta) + ' de ' + fmt(C.meta) : 'Meta cumplida: ' + fmt(C.meta)) + (C.proyeccion ? `<br>Al ritmo actual cierra en ${fmt(C.proyeccion)}` : '');
    } else {
      metaV = '<span class="nxTbSinMeta">Sin meta</span>';
      metaS = !C.metasOk ? 'Las metas se activan al publicar esta versión.' : esAdmin() ? `<button type="button" class="nxTbLink" onclick="window.nxTablero.metas()">Definir la meta de ${esc(nomMes)}</button>` : 'El administrador todavía no definió la meta.';
    }
    const devS = C.devTot > 0 ? `<br>Devoluciones ${fmt(C.devTot)} · netas ${fmt(C.bruto - C.devTot)}` : '';
    return `<div class="nxTbKpis">
      ${kpi('v', 'ti-chart-bar', 'Ventas', val('v', C.bruto), variacion(C.bruto, C.pBruto) + devS)}
      ${kpi('m', 'ti-target-arrow', C.mesCompleto && C.meta > 0 ? 'Meta de ' + esc(nomMes) : 'Meta del período', metaV, metaS, metaX)}
      ${kpi('t', 'ti-receipt', 'Ticket promedio', val('t', C.ticket), variacion(C.ticket, C.pTicket))}
      ${kpi('f', 'ti-file-invoice', 'Facturas', val('f', C.n), variacion(C.n, C.pN) + (C.anul.length ? `<br>${C.anul.length} anulada${C.anul.length === 1 ? '' : 's'} (no cuentan)` : ''))}
    </div>`;
  }
  function graficaHTML() {
    const t = C.gran === 'hora' ? 'Ventas por hora' : C.gran === 'dia' ? 'Ventas por día' : 'Ventas por mes';
    const conMeta = C.B.some(b => b.meta > 0);
    const mejor = C.B.reduce((m, b) => b.t > (m ? m.t : 0) ? b : m, null);
    const aria = t + ': total ' + fmt(C.bruto) + (mejor ? '; el más alto ' + mejor.larga + ' con ' + fmt(mejor.t) : '');
    return `<section class="nxTbCard nxTbGraf"><header class="nxTbCh"><div class="nxTbH2" role="heading" aria-level="2">${t}</div><div class="nxTbLey"><span><i class="sw"></i>Ventas</span>${conMeta ? `<span><i class="sw ln"></i>Meta ${C.gran === 'mes' ? 'mensual' : 'diaria'}</span>` : ''}</div></header>
      <div class="nxTbChart" id="nxTbChart" role="img" aria-label="${esc(aria)}"></div></section>`;
  }
  const PAGO_COL = ['var(--tb-c1)', 'var(--tb-c2)', 'var(--tb-c3)', 'var(--tb-c4)', 'var(--tb-c5)'];
  function donaHTML() {
    const tot = PAGOS.reduce((s, p) => s + C.pago[p[0]], 0);
    let acc = 0; const arcos = PAGOS.map((p, i) => { const v = C.pago[p[0]], pc = tot ? v / tot * 100 : 0; const a = acc; acc += pc; if (pc <= 0) return ''; const g = pc > 1.2 ? 0.6 : 0; return `<circle cx="21" cy="21" r="15.9155" fill="none" stroke="${PAGO_COL[i]}" stroke-width="5" stroke-dasharray="${(pc - g).toFixed(3)} ${(100 - pc + g).toFixed(3)}" stroke-dashoffset="${(-a).toFixed(3)}"></circle>`; }).join('');
    const filas = PAGOS.map((p, i) => { const v = C.pago[p[0]]; return `<div class="nxTbLegF${v > 0 ? '' : ' cero'}"><i class="sw" style="background:${PAGO_COL[i]}"></i><span>${p[1]}</span><b>${fmt(v)}</b><em>${tot ? fmtPct(v / tot * 100) : '0.0 %'}</em></div>`; }).join('');
    return `<section class="nxTbCard nxTbPago"><header class="nxTbCh"><div class="nxTbH2" role="heading" aria-level="2">Ventas por forma de pago</div></header>
      <div class="nxTbDonaW"><div class="nxTbDona"><svg viewBox="0 0 42 42" aria-hidden="true"><circle cx="21" cy="21" r="15.9155" fill="none" stroke="var(--tb-track)" stroke-width="5"></circle>${arcos}</svg>
        <div class="c"><b>${fmtCorto(tot)}</b><small>total facturado</small></div></div>
      <div class="nxTbLeg">${filas}</div></div></section>`;
  }
  function iniciales(s) { const p = limpio(s).split(' ').filter(Boolean); return ((p[0] || '?')[0] + (p.length > 1 ? p[p.length - 1][0] : (p[0] || '')[1] || '')).toUpperCase(); }
  function equipoHTML() {
    const lista = C.equipo.slice(0, 10), conMeta = C.hayMetaVend;
    const filas = lista.map(e => {
      const p = conMeta ? (e.meta > 0 ? e.t / e.meta * 100 : null) : (C.bruto ? e.t / C.bruto * 100 : 0);
      const tono = !conMeta ? 'oro' : p == null ? '' : p >= 80 ? 'ok' : p >= 50 ? 'warn' : 'bad';
      const barra = p == null ? '<span class="nxTbMute">Sin meta</span>' : `<div class="nxTbPg"><div class="nxTbBar"><i class="${tono}" style="transform:scaleX(${Math.min(1, p / 100).toFixed(4)})"></i></div><span>${fmtPct(p)}</span></div>`;
      return `<div class="nxTbTr" role="row"><div role="cell"><div class="nxTbWho"><span class="nxTbAv" aria-hidden="true">${esc(iniciales(e.nom))}</span><div><b>${esc(e.nom)}</b><small>${e.n} factura${e.n === 1 ? '' : 's'}${conMeta && e.meta > 0 ? ' · meta ' + fmt(e.meta) : ''}</small></div></div></div><div role="cell" class="r m">${fmt(e.t)}</div><div role="cell" class="pg">${barra}</div></div>`;
    }).join('');
    const mas = C.equipo.length > 10 ? `<p class="nxTbNota">Se muestran los 10 primeros de ${C.equipo.length}.</p>` : '';
    return `<section class="nxTbCard"><header class="nxTbCh"><div class="nxTbH2" role="heading" aria-level="2">Desempeño del equipo</div>${esAdmin() && C.metasOk ? '<button type="button" class="nxTbLink" onclick="window.nxTablero.metas()">Metas</button>' : ''}</header>
      <div class="nxTbT eq" role="table" aria-label="Desempeño del equipo"><div class="nxTbTr nxTbTh" role="row"><div role="columnheader">Vendedor</div><div role="columnheader" class="r">Ventas</div><div role="columnheader">${conMeta ? '% de la meta' : '% del total'}</div></div>${filas || '<div class="nxTbVacioT">Sin ventas en el período.</div>'}</div>${mas}</section>`;
  }
  function productosHTML() {
    const filas = C.prods.slice(0, 5).map((p, i) => `<div class="nxTbTr" role="row"><div role="cell" class="nxTbRank">${i + 1}</div><div role="cell"><b class="nxTbProd">${esc(p.nom)}</b></div><div role="cell" class="r m">${(Math.round(p.cant * 100) / 100).toLocaleString('en-US')}</div><div role="cell" class="r m">${fmt(p.monto)}</div></div>`).join('');
    return `<section class="nxTbCard"><header class="nxTbCh"><div class="nxTbH2" role="heading" aria-level="2">Productos más vendidos</div></header>
      <div class="nxTbT pr" role="table" aria-label="Productos más vendidos"><div class="nxTbTr nxTbTh" role="row"><div role="columnheader" class="nxTbRank">#</div><div role="columnheader">Producto</div><div role="columnheader" class="r">Unid.</div><div role="columnheader" class="r">Ventas</div></div>${filas || '<div class="nxTbVacioT">Sin productos vendidos en el período.</div>'}</div></section>`;
  }
  function vacioHTML() {
    const r = C.r, ult = D.ultima ? partesRD(D.ultima).dia : '';
    const antes = ult && ult < r.d1;
    return `<section class="nxTbCard nxTbVacio"><i class="ti ti-chart-bar-off" aria-hidden="true"></i><div class="nxTbH2" role="heading" aria-level="2">No hay ventas registradas ${r.d1 === r.d2 ? 'el ' + fLarga(r.d1) : 'del ' + rangoTxt(r.d1, r.d2)}</div>
      <p>${ult ? 'La última venta registrada en STUDIO es del ' + fLarga(ult) + '.' : 'Todavía no hay ventas registradas en STUDIO.'}</p>
      ${antes ? `<button type="button" class="btn bc1" onclick="window.nxTablero.verHasta('${ult}')"><i class="ti ti-calendar-event"></i> Ver los 30 días hasta el ${esc(fCorta(ult))}</button>` : ''}</section>`;
  }
  function cuerpoHTML() {
    if (error) return `<section class="nxTbCard nxTbVacio"><i class="ti ti-cloud-off" aria-hidden="true"></i><div class="nxTbH2" role="heading" aria-level="2">No se pudieron cargar las ventas</div><p>${esc(error.slice(0, 220))}</p><button type="button" class="btn bc1" onclick="window.nxTablero.recargar()"><i class="ti ti-refresh"></i> Reintentar</button></section>`;
    if (!D) return esqueletoHTML();
    C = calc();
    const vacio = !C.n && !C.anul.length;
    return kpisHTML() + (vacio ? vacioHTML() : `<div class="nxTbG2">${graficaHTML()}${donaHTML()}</div><div class="nxTbG3">${equipoHTML()}${productosHTML()}</div>`)
      + `<p class="nxTbPie">Facturas completadas; las anuladas no cuentan. Montos con ITBIS, como se cobraron. Fechas en hora de República Dominicana.</p>`;
  }
  function esqueletoHTML() {
    const k = '<section class="nxTbK nxTbSk"><i></i><i></i><i></i></section>';
    return `<div class="nxTbKpis" aria-busy="true">${k + k + k + k}</div><div class="nxTbG2"><section class="nxTbCard nxTbSk alto"></section><section class="nxTbCard nxTbSk alto"></section></div>`;
  }
  function subTxt() {
    const r = rango();
    return `${rangoTxt(r.d1, r.d2)} · comparado con ${rangoTxt(r.p1, r.p2)}${cargando && D ? ' · actualizando…' : ''}`;
  }
  function render() {
    ensureCSS();
    const r = rango();
    const chips = PRE.map(p => `<button type="button" role="tab" aria-selected="${pre === p[0]}" class="nxTbSegB${pre === p[0] ? ' on' : ''}" data-p="${p[0]}" onclick="window.nxTablero.preset('${p[0]}')">${p[1]}</button>`).join('');
    return `<div class="nxTb" id="nxTbRoot">
      <header class="nxTbHead">
        <div class="nxTbTit"><div class="nxTbH1" role="heading" aria-level="1">Tablero de ventas</div><p id="nxTbSub">${esc(subTxt())}</p></div>
        <div class="nxTbSegW"><div class="nxTbSeg" id="nxTbSeg" role="tablist" aria-label="Período"><span class="nxTbThumb" id="nxTbThumb" aria-hidden="true"></span>${chips}</div></div>
        <div class="nxTbAcc">${esAdmin() ? '<button type="button" class="nxTbIcoB" onclick="window.nxTablero.metas()" title="Metas de ventas"><i class="ti ti-target-arrow"></i><span>Metas</span></button>' : ''}<button type="button" class="nxTbIcoB" onclick="window.nxTablero.recargar()" title="Actualizar" aria-label="Actualizar"><i class="ti ti-refresh"></i></button></div>
        <div class="nxTbFechas" id="nxTbFechas"${pre === 'fechas' ? '' : ' hidden'}><label>Desde<input type="date" id="nxTbDesde" value="${esc(r.d1)}" max="${esc(r.hoy)}" onchange="window.nxTablero.fechas()"></label><label>Hasta<input type="date" id="nxTbHasta" value="${esc(r.d2)}" max="${esc(r.hoy)}" onchange="window.nxTablero.fechas()"></label></div>
      </header>
      <div class="nxTbBody" id="nxTbBody">${cuerpoHTML()}</div>
    </div>`;
  }

  // ── Después de pintar: pastilla, gráfica y números ─────────────────────────────────────────────────────────
  function moverThumb(animar) {
    const seg = document.getElementById('nxTbSeg'), th = document.getElementById('nxTbThumb'); if (!seg || !th) return;
    const b = seg.querySelector('.nxTbSegB.on'); if (!b) { th.style.opacity = '0'; return; }
    if (!animar) th.style.transition = 'none';
    th.style.opacity = '1'; th.style.width = b.offsetWidth + 'px'; th.style.transform = `translateX(${b.offsetLeft}px)`;
    if (!animar) { void th.offsetWidth; th.style.transition = ''; }
    try { if (seg.parentNode.scrollWidth > seg.parentNode.clientWidth) b.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) {}
  }
  function postRender() {
    moverThumb(false);
    despuesDeCuerpo(true);
  }
  function despuesDeCuerpo(dibujoNuevo) {
    dibujar(dibujoNuevo);
    if (!C || !D) return;
    const obj = { v: C.bruto, t: C.ticket, f: C.n, m: C.meta > 0 ? C.bruto / C.meta * 100 : 0 };
    const bar = document.getElementById('nxTbMetaBar');
    if (!vis || entrada || reduced()) { vis = obj; escribir(); if (bar) bar.style.transform = `scaleX(${Math.min(1, obj.m / 100)})`; entrada = false; return; }
    if (bar) requestAnimationFrame(() => { bar.style.transform = `scaleX(${Math.min(1, obj.m / 100)})`; });
    // Los números corren desde lo que se ve hasta el valor nuevo en 520 ms con salida suave; otro cambio de rango a mitad
    // de camino arranca desde el valor que está en pantalla (interrumpible, sin saltos ni centavos arrastrándose).
    cancelAnimationFrame(raf);
    const desde = Object.assign({}, vis), T = 520; let t0 = 0;
    const paso = ts => {
      if (!t0) t0 = ts;
      const x = Math.min(1, (ts - t0) / T), e = 1 - Math.pow(1 - x, 4);
      for (const k in obj) vis[k] = x >= 1 ? obj[k] : desde[k] + (obj[k] - desde[k]) * e;
      escribir(); raf = x < 1 ? requestAnimationFrame(paso) : 0;
    };
    raf = requestAnimationFrame(paso);
  }
  function escribir() {
    ['v', 't', 'f'].forEach(k => { const e = document.getElementById('nxTbKv-' + k); if (e) e.textContent = valorK(k, vis[k]); });
    const em = document.getElementById('nxTbKv-m'); if (em && C && C.meta > 0) em.textContent = valorK('m', vis.m);
  }
  function techo(v) { if (v <= 0) return 1; const e = Math.pow(10, Math.floor(Math.log10(v / 4))); for (const f of [1, 2, 2.5, 5, 10]) if (f * e * 4 >= v) return f * e * 4; return 10 * e * 4; }
  function dibujar(animar) {
    const el = document.getElementById('nxTbChart'); if (!el || !C) return;
    const B = C.B, W = Math.max(260, el.clientWidth || 600), H = el.clientHeight || 240;
    const pl = 42, pr = 6, pt = 10, pb = 24, iw = W - pl - pr, ih = H - pt - pb;
    const top = techo(Math.max(...B.map(b => Math.max(b.t, b.meta))));
    const y = v => pt + ih - v / top * ih, bw = iw / B.length, barW = Math.max(2, Math.min(30, bw * 0.62));
    const conMeta = B.some(b => b.meta > 0), anim = animar && !reduced();
    let s = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" class="${anim ? 'anim' : ''}" aria-hidden="true" focusable="false">`;
    for (let g = 0; g <= 4; g++) { const v = top / 4 * g, yy = Math.round(y(v)) + 0.5; s += `<line x1="${pl}" x2="${W - pr}" y1="${yy}" y2="${yy}" class="gl"></line><text x="${pl - 8}" y="${yy + 3.5}" text-anchor="end" class="ax">${g ? fmtEje(v) : '0'}</text>`; }
    const maxEt = Math.max(1, Math.floor(iw / (C.gran === 'mes' ? 52 : 46))), salto = Math.ceil(B.length / maxEt);
    B.forEach((b, i) => {
      const x = pl + i * bw + (bw - barW) / 2, h = Math.max(0, pt + ih - y(b.t));
      const cls = conMeta && b.meta > 0 && b.t < b.meta ? 'b bajo' : 'b';
      if (b.t > 0) s += `<rect class="${cls}" data-i="${i}" x="${x.toFixed(2)}" y="${(pt + ih - h).toFixed(2)}" width="${barW.toFixed(2)}" height="${h.toFixed(2)}" rx="${Math.min(4, barW / 2).toFixed(1)}" style="animation-delay:${Math.min(i * 12, 300)}ms"></rect>`;
      if (i % salto === 0) s += `<text x="${(pl + i * bw + bw / 2).toFixed(2)}" y="${H - 7}" text-anchor="middle" class="ax">${esc(b.et)}</text>`;
    });
    if (conMeta) {
      let d = '';
      B.forEach((b, i) => { if (!(b.meta > 0)) return; const x0 = pl + i * bw, x1 = x0 + bw, yy = y(b.meta).toFixed(2); d += (d ? 'L' : 'M') + x0.toFixed(2) + ' ' + yy + 'L' + x1.toFixed(2) + ' ' + yy; });
      s += `<path d="${d}" class="meta"></path>`;
    }
    B.forEach((b, i) => { s += `<rect class="hit" data-i="${i}" x="${(pl + i * bw).toFixed(2)}" y="${pt}" width="${bw.toFixed(2)}" height="${ih}"></rect>`; });
    s += '</svg><div class="nxTbTip" id="nxTbTip" role="status"></div>';
    el.innerHTML = s;
    const tip = el.querySelector('#nxTbTip');
    const mostrar = i => {
      const b = B[i]; if (!b) return;
      el.classList.add('sel'); el.querySelectorAll('rect.b').forEach(r => r.classList.toggle('on', r.getAttribute('data-i') === String(i)));
      const meta = b.meta > 0 ? `<br><span class="${b.t >= b.meta ? 'nxTbUp' : 'nxTbDn'}">${b.t >= b.meta ? 'Sobre' : 'Bajo'} la meta (${fmt(b.meta)})</span>` : '';
      tip.innerHTML = `<b>${esc(b.larga)}</b><br>${fmt(b.t)} · ${b.n} factura${b.n === 1 ? '' : 's'}${meta}`;
      const cx = pl + i * bw + bw / 2, alto = y(b.t) < 64;
      tip.style.left = Math.min(W - 8, Math.max(8, cx)) + 'px'; tip.style.top = (alto ? y(b.t) + 10 : y(b.t) - 8) + 'px';
      tip.classList.toggle('abajo', alto); tip.classList.add('on');
      const w = tip.offsetWidth; tip.style.left = Math.min(W - w / 2 - 4, Math.max(w / 2 + 4, cx)) + 'px';
    };
    const ocultar = () => { el.classList.remove('sel'); tip.classList.remove('on'); el.querySelectorAll('rect.b.on').forEach(r => r.classList.remove('on')); };
    el.querySelectorAll('rect.hit').forEach(r => {
      const i = +r.getAttribute('data-i');
      r.addEventListener('pointerdown', e => { e.stopPropagation(); mostrar(i); });
      r.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') mostrar(i); });
      r.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') ocultar(); });
    });
    el.onpointerdown = ocultar;
  }

  // Cambio de rango: se repinta solo el cuerpo y la cabecera (la pastilla se desliza; nada del resto de la app se toca).
  function actualizar() {
    const root = document.getElementById('nxTbRoot'); if (!root) return;
    const sub = document.getElementById('nxTbSub'); if (sub) sub.textContent = subTxt();
    root.querySelectorAll('.nxTbSegB').forEach(b => { const on = b.getAttribute('data-p') === pre; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
    moverThumb(true);
    const f = document.getElementById('nxTbFechas'); if (f) f.hidden = pre !== 'fechas';
    const r = rango(), dd = document.getElementById('nxTbDesde'), hh = document.getElementById('nxTbHasta');
    if (dd && document.activeElement !== dd) dd.value = r.d1; if (hh && document.activeElement !== hh) hh.value = r.d2;
    if (cargando && D) return;                                     // mientras llega lo nuevo se queda lo anterior (con «actualizando…»)
    const body = document.getElementById('nxTbBody'); if (!body) return;
    body.innerHTML = cuerpoHTML();
    despuesDeCuerpo(true);
  }

  // ── Metas (solo el administrador; las guarda el servidor con pos_metas_guardar) ────────────────────────────
  let mMes = '', mFilas = [];
  async function metas() {
    if (!esAdmin()) { toast('err', 'Solo el administrador define las metas'); return; }
    const r = rango(); mMes = iniMes(r.d2);
    abrirMetas(true);
    try { await cargarFormMetas(); pintarMetas(); }
    catch (e) { const c = document.getElementById('nxTbMetasC'); if (c) c.innerHTML = '<p class="nxTbHint">' + esc(metasErr(e)) + '</p>'; }
  }
  function metasErr(e) {
    let msg = String(e && e.message || e); try { const j = JSON.parse(msg); msg = j.details || j.message || msg; } catch (x) {}
    return /pos_metas|PGRST20[25]|404|does not exist/i.test(msg) ? 'Las metas todavía no están activas en la base: se activan al publicar esta versión.' : msg;
  }
  async function cargarFormMetas() {
    const desde = addDays(hoyISO(), -120);
    const [recientes, guardadas, personal] = await Promise.all([
      getAll('pos_ventas', 'select=total,vendedor_nombre,created_by_name&estado=eq.completada&fecha=gte.' + tsDesde(desde)).catch(() => []),
      api().get('pos_metas_ventas', 'select=vendedor,monto&mes=eq.' + mMes),
      api().post('rpc/pos_personal', {}).catch(() => [])
    ]);
    const fila = {}; const add = (nom, t) => { const nm = limpio(nom); const k = norm(nm); if (!k) return; (fila[k] = fila[k] || { nom: nm, t: 0, monto: '' }); fila[k].t += t || 0; };
    (recientes || []).forEach(v => add(limpio(v.vendedor_nombre) || limpio(v.created_by_name) || '', n(v.total)));
    (D && D.ventas || []).forEach(v => add(limpio(v.vendedor_nombre) || limpio(v.created_by_name) || '', 0));
    (Array.isArray(personal) ? personal : []).filter(p => p && p.activo !== false && p.nombre).forEach(p => add(p.nombre, 0));
    let negocio = '';
    (guardadas || []).forEach(g => { if (!norm(g.vendedor)) negocio = n(g.monto); else { add(g.vendedor, 0); fila[norm(g.vendedor)].monto = n(g.monto); } });
    mFilas = [{ k: '', nom: '', monto: negocio }].concat(Object.keys(fila).map(k => Object.assign({ k: k }, fila[k])).sort((a, b) => b.t - a.t || a.nom.localeCompare(b.nom)));
  }
  function mesesOpc() { const out = []; let m = mesAnt(mesAnt(mesAnt(iniMes(hoyISO())))); for (let i = 0; i < 16; i++) { out.push(m); m = mesSig(m); } if (out.indexOf(mMes) < 0) out.unshift(mMes); return out; }
  function abrirMetas(cargandoForm) {
    const id = 'nxTbMetasM'; const o = document.getElementById(id); if (o) o.remove();
    const ov = document.createElement('div'); ov.id = id; ov.className = 'overlay open';
    ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
    ov.innerHTML = `<div class="modal nxPrForm nxTbMetas" style="max-width:520px" role="dialog" aria-modal="true" aria-labelledby="nxTbMetasT">
      <div class="mt"><span id="nxTbMetasT"><i class="ti ti-target-arrow"></i> Metas de ventas</span><button class="nxBack" type="button" onclick="document.getElementById('${id}').remove()"><i class="ti ti-arrow-left"></i> Volver</button></div>
      <div id="nxTbMetasC">${cargandoForm ? '<div class="nxTbSk alto" style="height:220px;border-radius:12px"></div>' : ''}</div></div>`;
    document.body.appendChild(ov);
    const esc2 = e => { if (e.key === 'Escape') { ov.remove(); document.removeEventListener('keydown', esc2); } }; document.addEventListener('keydown', esc2);
  }
  function pintarMetas() {
    const c = document.getElementById('nxTbMetasC'); if (!c) return;
    const opc = mesesOpc().map(m => `<option value="${m}"${m === mMes ? ' selected' : ''}>${MESL[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}</option>`).join('');
    const campo = (f, i) => `<input type="text" inputmode="decimal" data-nx-money id="nxTbMeta${i}" value="${f.monto ? String(f.monto) : ''}" placeholder="Sin meta" autocomplete="off" oninput="window.nxTablero.metasSuma()">`;
    c.innerHTML = `<p class="nxTbHint">La meta de un mes se reparte por días cuando miras otro rango. Deja un campo vacío para quitar esa meta.</p>
      <label class="nxTbMetaMes">Mes<select id="nxTbMetaMes" onchange="window.nxTablero.metasMes(this.value)">${opc}</select></label>
      <div class="nxTbMetaF neg"><span><b>Meta del negocio</b><small>Todas las ventas del mes</small></span>${campo(mFilas[0], 0)}</div>
      <div class="nxTbMetaSec">Metas por vendedor <small id="nxTbMetaSuma"></small></div>
      <div class="nxTbMetaL">${mFilas.slice(1).map((f, j) => `<div class="nxTbMetaF"><span><b>${esc(f.nom)}</b><small>${f.t ? 'Vendió ' + fmt(f.t) + ' en los últimos 120 días' : 'Sin ventas recientes'}</small></span>${campo(f, j + 1)}</div>`).join('') || '<p class="nxTbHint">No hay vendedores con ventas recientes.</p>'}</div>
      <div class="ajErr" id="nxTbMetaErr" role="alert" hidden></div>
      <div class="fe"><button class="btn bghost" type="button" onclick="document.getElementById('nxTbMetasM').remove()">Cancelar</button><button class="btn bc1" type="button" id="nxTbMetaOk" onclick="window.nxTablero.metasGuardar()"><i class="ti ti-device-floppy"></i> Guardar metas</button></div>`;
    try { window.nxMoney && window.nxMoney.scan && window.nxMoney.scan(c); } catch (e) {}
    metasSuma();
  }
  function leerMonto(i) { const e = document.getElementById('nxTbMeta' + i); if (!e) return 0; try { if (window.nxMoney && window.nxMoney.parse) return Number(window.nxMoney.parse(e.value)) || 0; } catch (er) {} return Number(String(e.value).replace(/[^0-9.]/g, '')) || 0; }
  function metasSuma() { const s = mFilas.slice(1).reduce((a, f, j) => a + leerMonto(j + 1), 0), e = document.getElementById('nxTbMetaSuma'); if (e) e.textContent = s ? 'suman ' + fmt(s) : ''; }
  async function metasMes(v) { mMes = iniMes(v); const c = document.getElementById('nxTbMetasC'); if (c) c.innerHTML = '<div class="nxTbSk alto" style="height:220px;border-radius:12px"></div>'; try { await cargarFormMetas(); pintarMetas(); } catch (e) { if (c) c.innerHTML = '<p class="nxTbHint">' + esc(metasErr(e)) + '</p>'; } }
  async function metasGuardar() {
    const btn = document.getElementById('nxTbMetaOk'), err = document.getElementById('nxTbMetaErr');
    const lista = mFilas.map((f, i) => ({ vendedor: f.nom, monto: Math.round(leerMonto(i) * 100) / 100 })).filter(x => x.monto > 0);
    if (btn) btn.disabled = true; if (err) err.hidden = true;
    try {
      await api().post('rpc/pos_metas_guardar', { p_mes: mMes, p_metas: lista });
      const neg = lista.find(x => !x.vendedor);
      try { window.logAudit && window.logAudit('POS_METAS_VENTAS', 'Metas de ' + MESL[+mMes.slice(5, 7) - 1] + ' ' + mMes.slice(0, 4) + ': negocio ' + (neg ? fmt(neg.monto) : 'sin meta') + ' · ' + lista.filter(x => x.vendedor).length + ' vendedor(es)', 'Tablero'); } catch (e) {}
      const m = document.getElementById('nxTbMetasM'); if (m) m.remove();
      toast('ok', 'Metas guardadas', MESL[+mMes.slice(5, 7) - 1] + ' ' + mMes.slice(0, 4));
      cargar(true);
    } catch (e) {
      if (err) { err.textContent = metasErr(e); err.hidden = false; } if (btn) btn.disabled = false;
    }
  }

  // ── Estilos (alcance .nxTb; tema Clásico claro y Premium Dark oscuro) ─────────────────────────────────────
  function ensureCSS() {
    if (document.getElementById('nxTbCSS')) return;
    const st = document.createElement('style'); st.id = 'nxTbCSS';
    st.textContent = `
.nxTb{--tb-card:#fff;--tb-card2:var(--studio-canvas-2,#f0ede4);--tb-line:var(--studio-line,rgba(90,72,20,.18));--tb-line2:var(--studio-line-2,rgba(128,101,21,.09));--tb-ink:var(--studio-ink,#111);--tb-steel:var(--studio-steel,#5b5951);--tb-mute:var(--studio-mute,#85817a);--tb-gold:var(--studio-gold,#c9a227);--tb-gold-t:var(--studio-gold-dark,#806515);--tb-soft:var(--studio-gold-soft,rgba(201,162,39,.16));--tb-ok:#15803d;--tb-warn:#b45309;--tb-bad:#b91c1c;--tb-bajo:#d9d2c1;--tb-track:#efebe1;--tb-tipbg:#111;--tb-tipfg:#fffefa;--tb-shadow:0 1px 2px rgba(10,10,10,.06),0 8px 20px -10px rgba(10,10,10,.16);--tb-c1:#c9a227;--tb-c2:#e3c45c;--tb-c3:#806515;--tb-c4:#5b5951;--tb-c5:#b9b2a2;--tb-ease:cubic-bezier(.22,1,.36,1);
  font-family:var(--studio-font,-apple-system,"SF Pro Text",system-ui,Inter,sans-serif);color:var(--tb-ink);display:flex;flex-direction:column;gap:14px;min-width:0;padding-bottom:24px}
/* Como Inicio y Reportes, el tablero es claro también con el tema Premium (en STUDIO el POS no cambia de fondo). Sin h1/h2/table:
   el tema Premium heredado les impone colores oscuros con !important; aquí son bloques con rol de encabezado y de tabla. */
.nxTbHead{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:10px;align-items:end}
.nxTbH1{font-size:28px;line-height:1.1;font-weight:700;letter-spacing:-.022em;color:var(--tb-ink)}
.nxTbTit{min-width:0}
.nxTbTit p{margin:4px 0 0;font-size:13px;color:var(--tb-steel);letter-spacing:-.005em}
.nxTbSegW{min-width:0;max-width:100%;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch;border-radius:999px}
.nxTbSegW::-webkit-scrollbar{display:none}
.nxTbSeg{position:relative;display:inline-flex;background:var(--tb-card);border:1px solid var(--tb-line);border-radius:999px;padding:3px;box-shadow:var(--tb-shadow);white-space:nowrap}
.nxTbThumb{position:absolute;top:3px;bottom:3px;left:0;width:0;border-radius:999px;background:var(--tb-soft);box-shadow:inset 0 0 0 1px rgba(201,162,39,.35);transition:transform .34s var(--tb-ease),width .34s var(--tb-ease);opacity:0;pointer-events:none}
html.nx-studio #v-pos .nxTb .nxTbSegB{position:relative;z-index:1;border:0;background:none;min-height:34px;padding:0 13px;border-radius:999px;font-size:13px;font-weight:500;color:var(--tb-steel);cursor:pointer;transition:color .16s ease,transform .1s ease-out}
html.nx-studio #v-pos .nxTb .nxTbSegB.on{color:var(--tb-gold-t);font-weight:600}
html.nx-studio #v-pos .nxTb .nxTbSegB:active,html.nx-studio #v-pos .nxTb .nxTbIcoB:active{transform:scale(.97)}
.nxTb .nxTbSegB:focus-visible,.nxTb .nxTbIcoB:focus-visible,.nxTb .nxTbLink:focus-visible{outline:2px solid var(--tb-gold);outline-offset:2px}
.nxTbAcc{display:flex;gap:6px}
html.nx-studio #v-pos .nxTb .nxTbIcoB{display:inline-flex;align-items:center;gap:6px;min-height:40px;min-width:40px;justify-content:center;padding:0 12px;border-radius:999px;border:1px solid var(--tb-line);background:var(--tb-card);color:var(--tb-ink);font-size:13px;font-weight:500;cursor:pointer;box-shadow:var(--tb-shadow);transition:transform .1s ease-out,border-color .16s ease}
.nxTb .nxTbIcoB i{font-size:17px;color:var(--tb-gold-t)}
.nxTbFechas{grid-column:1/-1;display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap}
.nxTbFechas[hidden]{display:none}
.nxTbFechas label{display:flex;flex-direction:column;gap:4px;font-size:11.5px;font-weight:600;color:var(--tb-steel)}
html.nx-studio #v-pos .nxTb .nxTbFechas input{height:38px;border:1px solid var(--tb-line);border-radius:10px;padding:0 10px;font-size:14px;background:var(--tb-card);color:var(--tb-ink);min-width:150px}
.nxTbBody{display:flex;flex-direction:column;gap:14px;min-width:0}
.nxTbKpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
.nxTbK,.nxTbCard{background:var(--tb-card);border:1px solid var(--tb-line);border-radius:16px;box-shadow:var(--tb-shadow);min-width:0}
.nxTbK{position:relative;padding:14px 16px 13px;display:flex;flex-direction:column;gap:4px;overflow:hidden}
.nxTbK::before{content:"";position:absolute;left:16px;right:16px;top:0;height:2px;border-radius:0 0 2px 2px;background:linear-gradient(90deg,var(--tb-gold),rgba(201,162,39,.12))}
.nxTbKh{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12.5px;font-weight:600;color:var(--tb-steel)}
.nxTbKh i{width:30px;height:30px;border-radius:9px;display:grid;place-items:center;background:var(--tb-soft);color:var(--tb-gold-t);font-size:16px;flex:none}
.nxTbKv{font-family:var(--studio-mono,ui-monospace,"SF Mono",Menlo,monospace);font-size:22px;font-weight:600;letter-spacing:-.02em;line-height:1.15;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nxTbKs{font-size:12px;color:var(--tb-mute);line-height:1.45}
.nxTbUp,.nxTbDn{display:inline-flex;align-items:center;gap:3px;font-weight:600}
.nxTbUp{color:var(--tb-ok)}.nxTbDn{color:var(--tb-bad)}.nxTbNeu{color:var(--tb-mute)}
.nxTbUp i,.nxTbDn i{font-size:14px}
.nxTbSinMeta{font-family:var(--studio-font,system-ui);font-size:18px;color:var(--tb-mute);font-weight:600;letter-spacing:-.01em}
html.nx-studio #v-pos .nxTb .nxTbLink{border:0;background:none;padding:2px 0;color:var(--tb-gold-t);font-weight:600;font-size:12.5px;cursor:pointer;text-decoration:underline;text-underline-offset:3px;min-height:0}
.nxTbBar{height:6px;border-radius:99px;background:var(--tb-track);overflow:hidden;margin:4px 0 2px}
.nxTbBar i{display:block;height:100%;border-radius:99px;background:var(--tb-gold);transform-origin:left center;transition:transform .42s var(--tb-ease)}
.nxTbBar i.ok{background:var(--tb-ok)}.nxTbBar i.warn{background:var(--tb-warn)}.nxTbBar i.bad{background:var(--tb-bad)}.nxTbBar i.oro{background:var(--tb-gold)}
.nxTbG2{display:grid;grid-template-columns:minmax(0,1.85fr) minmax(0,1fr);gap:12px}
.nxTbG3{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px}
.nxTbCard{padding:14px 16px}
.nxTbCh{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;flex-wrap:wrap}
.nxTbH2{font-size:15px;font-weight:700;letter-spacing:-.01em;line-height:1.2;color:var(--tb-ink)}
.nxTbLey{display:flex;gap:14px;font-size:12px;color:var(--tb-steel)}
.nxTbLey span{display:inline-flex;align-items:center;gap:6px}
.nxTb .sw{display:inline-block;width:10px;height:10px;border-radius:3px;background:var(--tb-gold);flex:none}
.nxTb .sw.ln{height:0;border-radius:0;background:none;border-top:2px dashed var(--tb-steel);width:14px}
.nxTbChart{position:relative;height:250px;touch-action:pan-y}
.nxTbChart svg{display:block;overflow:visible}
.nxTbChart .gl{stroke:var(--tb-line2);stroke-width:1}
.nxTbChart .ax{fill:var(--tb-mute);font-size:10.5px;font-family:var(--studio-font,system-ui);font-variant-numeric:tabular-nums}
.nxTbChart rect.b{fill:var(--tb-gold);transition:opacity .18s ease}
.nxTbChart rect.b.bajo{fill:var(--tb-bajo)}
.nxTbChart.sel rect.b:not(.on){opacity:.42}
.nxTbChart rect.hit{fill:transparent;cursor:pointer}
.nxTbChart path.meta{fill:none;stroke:var(--tb-steel);stroke-width:1.5;stroke-dasharray:5 4}
.nxTbChart svg.anim rect.b{transform-box:fill-box;transform-origin:50% 100%;animation:nxTbCrece .42s var(--tb-ease) both}
@keyframes nxTbCrece{from{transform:scaleY(0)}to{transform:scaleY(1)}}
.nxTbTip{position:absolute;z-index:2;pointer-events:none;background:var(--tb-tipbg);color:var(--tb-tipfg);font-size:12px;line-height:1.4;padding:7px 10px;border-radius:10px;white-space:nowrap;opacity:0;transform:translate(-50%,calc(-100% + 4px));transition:opacity .12s ease,transform .16s var(--tb-ease);box-shadow:0 8px 24px -8px rgba(0,0,0,.35)}
.nxTbTip.on{opacity:1;transform:translate(-50%,-100%)}
.nxTbTip.abajo{transform:translate(-50%,-4px)}.nxTbTip.abajo.on{transform:translate(-50%,0)}
.nxTbTip .nxTbUp{color:#7fd4a0}.nxTbTip .nxTbDn{color:#f19a9a}
.nxTbDonaW{display:flex;flex-direction:column;align-items:center;gap:14px}
.nxTbDona{position:relative;width:184px;height:184px}
.nxTbDona svg{width:100%;height:100%;transform:rotate(-90deg)}
.nxTbDona .c{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}
.nxTbDona .c b{font-family:var(--studio-mono,ui-monospace,monospace);font-size:17px;font-weight:600;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.nxTbDona .c small{font-size:11.5px;color:var(--tb-mute)}
.nxTbLeg{width:100%;display:flex;flex-direction:column;gap:8px}
.nxTbLegF{display:grid;grid-template-columns:12px minmax(0,1fr) auto 52px;gap:8px;align-items:center;font-size:13px}
.nxTbLegF b{font-family:var(--studio-mono,ui-monospace,monospace);font-weight:500;font-size:12.5px;font-variant-numeric:tabular-nums}
.nxTbLegF em{font-style:normal;color:var(--tb-mute);font-size:12px;text-align:right;font-variant-numeric:tabular-nums}
.nxTbLegF.cero{color:var(--tb-mute)}
.nxTbT{display:flex;flex-direction:column;font-size:13px;color:var(--tb-ink);min-width:0}
.nxTbTr{display:grid;align-items:center;gap:0 10px;padding:9px 4px;border-bottom:1px solid var(--tb-line2);min-width:0}
.nxTbTr:last-child{border-bottom:0}
.nxTbTr>*{min-width:0}
.nxTbTh{padding:0 4px 8px;font-size:10.5px;font-weight:600;color:var(--tb-mute);text-transform:uppercase;letter-spacing:.06em;white-space:nowrap}
.nxTbT.eq .nxTbTr{grid-template-columns:minmax(0,1fr) auto minmax(110px,34%)}
.nxTbT.pr .nxTbTr{grid-template-columns:22px minmax(0,1fr) auto auto}
.nxTbT .r{text-align:right}
.nxTbT .m{font-family:var(--studio-mono,ui-monospace,monospace);font-variant-numeric:tabular-nums;white-space:nowrap;font-size:12.5px}
.nxTbWho{display:flex;align-items:center;gap:9px;min-width:0}
.nxTbWho b{display:block;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:200px}
.nxTbWho small{display:block;font-size:11.5px;color:var(--tb-mute)}
.nxTbAv{width:30px;height:30px;border-radius:50%;flex:none;display:grid;place-items:center;font-size:11px;font-weight:700;color:var(--tb-gold-t);background:var(--tb-soft)}
.nxTbPg{display:flex;align-items:center;gap:8px}
.nxTbPg .nxTbBar{flex:1;margin:0}
.nxTbPg span{font-size:12px;font-variant-numeric:tabular-nums;min-width:52px;text-align:right;color:var(--tb-steel)}
.nxTbMute{font-size:12px;color:var(--tb-mute)}
.nxTbRank{width:22px;color:var(--tb-mute);font-variant-numeric:tabular-nums}
.nxTbProd{font-weight:600;overflow-wrap:anywhere}
.nxTbVacioT{text-align:center;color:var(--tb-mute);padding:18px 6px}
.nxTbNota,.nxTbPie{margin:8px 0 0;font-size:12px;color:var(--tb-mute)}
.nxTbPie{margin:0;text-align:center}
.nxTbVacio{display:flex;flex-direction:column;align-items:center;text-align:center;gap:8px;padding:34px 18px}
.nxTbVacio>i{font-size:30px;color:var(--tb-gold-t);width:56px;height:56px;border-radius:16px;display:grid;place-items:center;background:var(--tb-soft)}
.nxTbVacio .nxTbH2{font-size:16px}
.nxTbVacio p{margin:0;color:var(--tb-steel);font-size:13.5px;max-width:460px}
.nxTbVacio .btn{margin-top:6px}
.nxTbSk{position:relative;overflow:hidden;min-height:112px}
.nxTbSk.alto{min-height:290px}
.nxTbSk i{display:block;height:12px;border-radius:6px;background:var(--tb-track);margin:4px 0}
.nxTbSk i:nth-child(1){width:45%}.nxTbSk i:nth-child(2){width:75%;height:20px;margin:10px 0}.nxTbSk i:nth-child(3){width:60%}
.nxTbSk::after{content:"";position:absolute;inset:0;background:linear-gradient(100deg,transparent 20%,rgba(255,255,255,.55) 50%,transparent 80%);transform:translateX(-100%);animation:nxTbBrillo 1.3s ease-in-out infinite}
@keyframes nxTbBrillo{to{transform:translateX(100%)}}
.nxTbMetas .nxTbHint{font-size:12.5px;color:var(--studio-steel,#5b5951);margin:0 0 10px;line-height:1.45}
.nxTbMetas .nxTbMetaMes{display:flex;flex-direction:column;gap:4px;font-size:12px;font-weight:600;margin-bottom:12px}
.nxTbMetas .nxTbMetaMes select{height:40px;font-size:15px}
.nxTbMetas .nxTbMetaF{display:grid;grid-template-columns:minmax(0,1fr) 160px;gap:10px;align-items:center;padding:8px 0;border-bottom:1px solid var(--studio-line-2,rgba(128,101,21,.09))}
.nxTbMetas .nxTbMetaF.neg{border:1px solid var(--studio-line,rgba(90,72,20,.18));border-radius:12px;padding:10px 12px;margin-bottom:12px;background:var(--studio-gold-soft,rgba(201,162,39,.16))}
.nxTbMetas .nxTbMetaF b{display:block;font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nxTbMetas .nxTbMetaF small{display:block;font-size:11.5px;color:var(--studio-mute,#85817a)}
.nxTbMetas .nxTbMetaF input{height:40px;font-size:16px;text-align:right;font-family:var(--studio-mono,ui-monospace,monospace)}
.nxTbMetas .nxTbMetaSec{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--studio-mute,#85817a);margin:2px 0 2px;display:flex;justify-content:space-between;gap:8px}
.nxTbMetas .nxTbMetaSec small{text-transform:none;letter-spacing:0;font-weight:600;color:var(--studio-gold-dark,#806515)}
.nxTbMetas .nxTbMetaL{max-height:46vh;overflow-y:auto;margin-bottom:8px}
.nxTbMetas .fe{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}
@media(max-width:1180px){.nxTbKpis{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:1020px){.nxTbG2,.nxTbG3{grid-template-columns:minmax(0,1fr)}.nxTbDonaW{flex-direction:row;align-items:center}.nxTbDona{width:170px;height:170px;flex:none}}
@media(max-width:860px){.nxTbHead{grid-template-columns:minmax(0,1fr) auto}.nxTbTit{grid-column:1;grid-row:1}.nxTbAcc{grid-column:2;grid-row:1;align-self:start}.nxTbSegW{grid-column:1/-1;grid-row:2}.nxTbH1{font-size:22px;letter-spacing:-.015em}.nxTbFechas{justify-content:stretch}.nxTbFechas label{flex:1}html.nx-studio #v-pos .nxTb .nxTbFechas input{min-width:0;width:100%;font-size:16px;height:42px}}
@media(max-width:640px){.nxTbDonaW{flex-direction:column}.nxTbKv{font-size:18px}.nxTbK{padding:12px 13px 11px}.nxTbKh{font-size:12px}.nxTbKh i{width:26px;height:26px;font-size:14px}.nxTbKpis{gap:10px}.nxTbK[data-k="v"],.nxTbK[data-k="m"]{grid-column:1/-1}.nxTbK[data-k="v"] .nxTbKv{font-size:24px}.nxTbChart{height:220px}.nxTbCard{padding:13px 13px}.nxTbWho b{max-width:130px}.nxTbAv{display:none}.nxTbT.eq .nxTbTr{grid-template-columns:minmax(0,1fr) auto 92px}.nxTbAcc .nxTbIcoB span{display:none}html.nx-studio #v-pos .nxTb .nxTbIcoB{padding:0;width:40px}}
@media(max-width:480px){.nxTbMetas .nxTbMetaF{grid-template-columns:minmax(0,1fr);gap:6px}.nxTbMetas .nxTbMetaF input{width:100%}}
@media(max-width:400px){.nxTbKv{font-size:16px}.nxTbK[data-k="v"] .nxTbKv{font-size:22px}html.nx-studio #v-pos .nxTb .nxTbSegB{padding:0 10px;font-size:12.5px}}
@media(prefers-reduced-motion:reduce){.nxTbThumb,.nxTbBar i,.nxTbTip{transition:none}.nxTbChart svg.anim rect.b,.nxTbSk::after{animation:none}}
@media(prefers-contrast:more){.nxTb{--tb-line:#5b5951;--tb-line2:#85817a}}
`;
    document.head.appendChild(st);
  }

  let rz = 0;
  addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (document.getElementById('nxTbChart')) { dibujar(false); moverThumb(false); } }, 140); }, { passive: true });

  window.nxTablero = {
    render: render, postRender: postRender,
    // Entrar a la pestaña: carga lo del rango (sin bloquear la pantalla) y los números se pintan sin animación.
    entrar: function () { entrada = true; cargar(true); },
    recargar: function () { cargar(true); },
    preset: function (p) { if (!PRE.some(x => x[0] === p)) return; if (p === 'fechas') { const r = rango(); cDesde = r.d1; cHasta = r.d2; } pre = p; guardarRango(); cargar(false); },
    fechas: function () { const a = (document.getElementById('nxTbDesde') || {}).value, b = (document.getElementById('nxTbHasta') || {}).value; if (!a || !b) return; cDesde = a; cHasta = b; pre = 'fechas'; guardarRango(); cargar(false); },
    verHasta: function (iso) { if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return; cDesde = addDays(iso, -29); cHasta = iso; pre = 'fechas'; guardarRango(); cargar(false); },
    metas: metas, metasMes: metasMes, metasGuardar: metasGuardar, metasSuma: metasSuma,
    _calc: function () { return D ? calc() : null; }, _rango: rango
  };
  // Si la pestaña se abrió antes de que este archivo terminara de cargar (p. ej. al volver «donde me quedé»).
  try { if (document.querySelector('#v-pos .nxTbEspera')) { window.nxTablero.entrar(); ctx().renderPOS && ctx().renderPOS(); } } catch (e) {}
})();
