/* STUDIO · CRM Fase 1 (24-sep-2026) — réplica mejorada del CRM de BAYOL CELL Taller, sin canales externos.
 * Pedido del dueño: «Vamos a replicar el CRM de bayol cell taller y aplicarle mejoras» + «Si» a la Fase 1.
 * Del de Bayol: embudo nuevo → contactado → cotizado → ganado | perdido, asignación (admin ve todo, el resto lo suyo
 * y lo libre), vincular cliente, permiso de mensajes. Mejoras (lo que a Bayol le falta, ver bitácora 2026-09-24-2115):
 *   · tablero por etapas con arrastrar y soltar (y botón «avanzar» en móvil), días en la etapa;
 *   · ficha con notas, llamadas, visitas, WhatsApp (manual: solo abre wa.me, nunca envía nada solo) y TAREAS con fecha;
 *   · historial de etapas y asignación escrito por el SERVIDOR (migración 33), motivo de pérdida obligatorio;
 *   · permisos en el servidor (RLS), no en el navegador;
 *   · vínculo con cotización, venta y reparación: «Cotizar» / «Facturar» desde la ficha enlazan el documento guardado;
 *   · tareas vencidas y de hoy en Avisos; reportes de conversión, ciclo, por vendedor, por fuente y motivos de pérdida.
 * Datos: pos_crm (ampliada), pos_crm_actividades, RPC pos_crm_usuarios. Todo lo demás lo hace el servidor.
 */
(function () {
  'use strict';
  if (window.nxCRM) return;
  function api() { try { return (typeof API !== 'undefined') ? API : window.API; } catch (e) { return window.API; } }
  function ctx() { return window.nxPosCtx || {}; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function n(v) { const x = Number(v); return isFinite(x) ? x : 0; }
  function fmt(v) { const r = Math.round(n(v)); return 'RD$ ' + (r === 0 ? 0 : r).toLocaleString('en-US'); }
  function toast(t, m, s) { try { window.toast && window.toast(t, m, s); } catch (e) {} }
  function hoyISO() { try { return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santo_Domingo' }); } catch (e) { return new Date().toISOString().slice(0, 10); } }
  function diaRD(ts) { if (!ts) return ''; const s = String(ts); if (s.length === 10) return s; try { return new Date(s).toLocaleDateString('en-CA', { timeZone: 'America/Santo_Domingo' }); } catch (e) { return s.slice(0, 10); } }
  function addDays(iso, d) { const t = new Date(iso + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10); }
  function diasEntre(a, b) { return Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 86400000); }
  function dmy(ts) { const d = diaRD(ts); return d ? d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4) : ''; }
  function hora(ts) { try { return new Date(ts).toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Santo_Domingo' }); } catch (e) { return ''; } }
  function ini(nom) { const t = String(nom || '').trim(); if (!/[a-záéíóúñ]/i.test(t)) return t.replace(/\D/g, '').slice(-2) || '?'; const p = t.split(/\s+/).filter(Boolean); return ((p[0] || '?')[0] + (p[1] ? p[1][0] : '')).toUpperCase(); }
  function yo() { try { const s = ctx().sesion ? ctx().sesion() : window.sesion; return (s && s.id) || null; } catch (e) { return null; } }
  function esAdmin() { try { const r = ctx().rolEfectivo ? ctx().rolEfectivo() : 'admin'; return r === 'admin' || r === 'gerente'; } catch (e) { return false; } }
  function clientes() { try { return ctx().clientes ? ctx().clientes() : []; } catch (e) { return []; } }
  function cliDe(id) { return id ? clientes().find(c => String(c.id) === String(id)) : null; }
  function waNum(t) { const d = String(t || '').replace(/\D/g, ''); if (d.length === 10) return '1' + d; if (d.length === 11 && d[0] === '1') return d; return ''; }
  function errTxt(e) {
    const m = String((e && e.message) || e || '');
    const map = { CRM_ASIGNAR_SOLO_ADMIN: 'Solo el administrador o el gerente pueden asignar a otra persona', CRM_FALTA_MOTIVO_PERDIDA: 'Indica el motivo de la pérdida', CRM_ETAPA_INVALIDA: 'Etapa no válida', CRM_HISTORIAL_NO_EDITABLE: 'El historial no se puede modificar' };
    for (const k in map) if (m.indexOf(k) >= 0) return map[k];
    if (/row-level security|permission denied/i.test(m)) return 'No tienes permiso para esta oportunidad';
    return m || 'Error';
  }
  function repintar() { try { ctx().renderPOS && ctx().renderPOS(); } catch (e) {} }
  function cerrar(id) { const o = document.getElementById(id); if (o) o.remove(); }

  const ET = [['nuevo', 'Nuevo', 'ti-sparkles'], ['contactado', 'Contactado', 'ti-message-circle'], ['cotizado', 'Cotizado', 'ti-file-dollar'], ['ganado', 'Ganado', 'ti-trophy'], ['perdido', 'Perdido', 'ti-circle-x']];
  const etN = e => (ET.find(x => x[0] === e) || ET[0])[1];
  const ABIERTAS = ['nuevo', 'contactado', 'cotizado'];
  const abierta = o => ABIERTAS.indexOf(o.etapa) >= 0;
  const FUENTES = ['Tienda', 'WhatsApp', 'Instagram', 'Facebook', 'Referido', 'Llamada', 'Web', 'Otro'];
  const MOTIVOS = ['Precio alto', 'Compró en otro lugar', 'Crédito no aprobado', 'No respondió', 'Ya no le interesa', 'Sin existencia', 'Otro'];
  const ACT = { nota: ['Nota', 'ti-note'], llamada: ['Llamada', 'ti-phone'], whatsapp: ['WhatsApp', 'ti-brand-whatsapp'], visita: ['Visita', 'ti-building-store'], tarea: ['Tarea', 'ti-checkbox'], etapa: ['Etapa', 'ti-arrows-right'], sistema: ['Asignación', 'ti-user-check'] };

  const S = { ops: [], tareas: [], usuarios: [], vista: 'tablero', filtro: 'todas', q: '', cargado: false, error: '', ficha: null, acts: [], docs: {}, reps: [], pendiente: null, repDesde: '', repHasta: '', avisosCargando: false };
  try { const v = localStorage.getItem('studio_crm_vista'); if (['bandeja', 'tablero', 'tareas', 'reportes'].indexOf(v) >= 0) S.vista = v; } catch (e) {}

  async function cargar() {
    S.error = '';
    try {
      const [ops, tareas, usuarios] = await Promise.all([
        api().get('pos_crm', 'select=*&order=actualizado_at.desc&limit=1000'),
        api().get('pos_crm_actividades', 'select=id,crm_id,cliente_id,tipo,texto,vence_at,hecha,asignado_id,asignado_nombre,created_by_name,created_at&tipo=eq.tarea&hecha=eq.false&order=vence_at.asc.nullslast&limit=500').catch(() => []),
        api().post('rpc/pos_crm_usuarios', {}).catch(() => [])
      ]);
      S.ops = ops || []; S.tareas = (tareas || []).filter(t => t.tipo === 'tarea' && !t.hecha); S.usuarios = Array.isArray(usuarios) ? usuarios : []; S.cargado = true;
    } catch (e) { S.error = errTxt(e); }
  }
  async function recargar() { await cargar(); repintar(); if (S.ficha) pintarFicha(); }

  // ── Filtros ────────────────────────────────────────────────────────
  function visibles() {
    const q = S.q.trim().toLowerCase(), me = yo();
    return S.ops.filter(o => {
      if (S.filtro === 'mias' && String(o.asignado_id || '') !== String(me || '')) return false;
      if (S.filtro === 'libres' && o.asignado_id) return false;
      if (!q) return true;
      const c = cliDe(o.cliente_id);
      return [o.nombre, o.contacto, o.telefono, o.email, o.interes, o.numero, c && c.nombre, o.asignado_nombre].join(' ').toLowerCase().indexOf(q) >= 0;
    });
  }
  function tareaDe(crmId) { return S.tareas.find(t => String(t.crm_id) === String(crmId)); }

  // ── Render principal ───────────────────────────────────────────────
  function render() {
    ensureCSS();
    if (!S.cargado && !S.error) { cargar().then(repintar); return '<div class="nxCrm"><div class="nxCrmLoad"><span class="spin"></span> Cargando CRM…</div></div>'; }
    const abiertas = S.ops.filter(abierta), hoy = hoyISO();
    const pipe = abiertas.reduce((s, o) => s + n(o.monto_estimado), 0);
    const mesIni = hoy.slice(0, 8) + '01';
    const ganMes = S.ops.filter(o => o.etapa === 'ganado' && diaRD(o.cerrado_at) >= mesIni);
    const cerradasMes = S.ops.filter(o => (o.etapa === 'ganado' || o.etapa === 'perdido') && diaRD(o.cerrado_at) >= mesIni);
    const venc = S.tareas.filter(t => t.vence_at && diaRD(t.vence_at) <= hoy).length;
    const tab = (k, l, ic, badge) => `<button type="button" role="tab" aria-selected="${S.vista === k}" class="${S.vista === k ? 'on' : ''}" onclick="window.nxCRM.vista('${k}')"><i class="ti ${ic}"></i> ${l}${badge ? `<span class="b">${badge}</span>` : ''}</button>`;
    let body = '';
    if (S.error) body = `<div class="nxCrmErr">No se pudo cargar el CRM: ${esc(S.error)} <button class="btn bsm" type="button" onclick="window.nxCRM.recargar()">Reintentar</button></div>`;
    else if (S.vista === 'tareas') body = vistaTareas();
    else if (S.vista === 'reportes') body = vistaReportes();
    else if (S.vista === 'bandeja') body = vistaBandeja();
    else body = vistaTablero();
    return `<div class="nxCrm">
      <div class="nxCrmHead"><div><h2>CRM</h2><p>Oportunidades de venta, seguimiento y tareas</p></div>
        <button type="button" class="nxCrmBtn p" onclick="window.nxCRM.nueva()"><i class="ti ti-plus"></i> Nueva oportunidad</button></div>
      <div class="nxCrmKpis"${S.vista === 'bandeja' ? ' hidden' : ''}>
        <div class="k"><span>Abiertas</span><b>${abiertas.length}</b></div>
        <div class="k"><span>En el embudo</span><b>${fmt(pipe)}</b></div>
        <div class="k"><span>Ganado este mes</span><b>${fmt(ganMes.reduce((s, o) => s + n(o.monto_estimado), 0))}</b><small>${ganMes.length} oportunidad(es)</small></div>
        <div class="k"><span>Conversión del mes</span><b>${cerradasMes.length ? Math.round(ganMes.length / cerradasMes.length * 100) + ' %' : '—'}</b><small>ganadas / cerradas</small></div>
        <div class="k${venc ? ' warn' : ''}"><span>Tareas vencidas o de hoy</span><b>${venc}</b></div>
      </div>
      <div class="nxCrmTabs" role="tablist">${tab('bandeja', 'Bandeja', 'ti-messages', BD.convs.reduce((s, c) => s + (c.no_leidos > 0 ? 1 : 0), 0) || '')}${tab('tablero', 'Tablero', 'ti-layout-kanban')}${tab('tareas', 'Tareas', 'ti-checklist', S.tareas.length || '')}${tab('reportes', 'Reportes', 'ti-chart-bar')}</div>
      ${body}
    </div>`;
  }

  function barraFiltros() {
    const chip = (k, l) => `<button type="button" class="nxCrmChip${S.filtro === k ? ' on' : ''}" aria-pressed="${S.filtro === k}" onclick="window.nxCRM.filtro('${k}')">${l}</button>`;
    return `<div class="nxCrmBar"><div class="nxCrmChips">${chip('todas', esAdmin() ? 'Todas' : 'Todas las visibles')}${chip('mias', 'Mías')}${chip('libres', 'Sin asignar')}</div>
      <label class="nxCrmQ"><i class="ti ti-search"></i><input type="search" value="${esc(S.q)}" placeholder="Buscar nombre, teléfono, cliente…" oninput="window.nxCRM.buscar(this.value)" aria-label="Buscar oportunidad"></label></div>`;
  }

  function tarjeta(o) {
    const c = cliDe(o.cliente_id), hoy = hoyISO();
    const dias = o.etapa_at ? Math.max(0, diasEntre(diaRD(o.etapa_at), hoy)) : 0;
    const t = tareaDe(o.id);
    const tVenc = t && t.vence_at && diaRD(t.vence_at) <= hoy;
    const sig = ABIERTAS.indexOf(o.etapa) >= 0 ? ET[ET.findIndex(x => x[0] === o.etapa) + 1] : null;
    return `<article class="nxCrmCard" draggable="true" data-id="${o.id}" ondragstart="window.nxCRM.drag(event,'${o.id}')" onclick="window.nxCRM.abrir('${o.id}')" tabindex="0" onkeydown="if(event.key==='Enter')window.nxCRM.abrir('${o.id}')">
      <div class="t"><b>${esc(o.nombre)}</b></div>
      ${n(o.monto_estimado) ? `<div class="m">${fmt(o.monto_estimado)}</div>` : ''}
      <div class="s">${esc((c && c.nombre) || o.contacto || 'Sin contacto')}${o.interes ? ' · ' + esc(o.interes) : ''}</div>
      ${o.etapa === 'perdido' && o.motivo_perdida ? `<div class="s mot"><i class="ti ti-circle-x"></i> ${esc(o.motivo_perdida)}</div>` : ''}
      ${t ? `<div class="tk${tVenc ? ' venc' : ''}"><i class="ti ti-checkbox"></i> ${esc(t.texto)}${t.vence_at ? ' · ' + (diaRD(t.vence_at) === hoy ? 'hoy' : dmy(t.vence_at)) : ''}</div>` : ''}
      <div class="f"><span class="av" title="${esc(o.asignado_nombre || 'Sin asignar')}">${o.asignado_nombre ? esc(ini(o.asignado_nombre)) : '<i class="ti ti-user-question"></i>'}</span>
        ${abierta(o) ? `<span class="d${dias >= 7 ? ' old' : ''}" title="Días en esta etapa">${dias === 0 ? 'hoy' : dias + ' d'}</span>` : `<span class="d">${dmy(o.cerrado_at)}</span>`}
        ${sig && sig[0] !== 'perdido' ? `<button type="button" class="adv" title="Pasar a ${sig[1]}" aria-label="Pasar a ${sig[1]}" onclick="event.stopPropagation();window.nxCRM.mover('${o.id}','${sig[0]}')"><i class="ti ti-arrow-right"></i></button>` : ''}
      </div>
    </article>`;
  }

  function vistaTablero() {
    const lista = visibles(), hoy = hoyISO(), desde30 = addDays(hoy, -30);
    const cols = ET.map(e => {
      let items = lista.filter(o => o.etapa === e[0]);
      if (e[0] === 'ganado' || e[0] === 'perdido') items = items.filter(o => diaRD(o.cerrado_at) >= desde30);
      const tot = items.reduce((s, o) => s + n(o.monto_estimado), 0);
      return `<section class="nxCrmCol c-${e[0]}" data-et="${e[0]}" ondragover="event.preventDefault();this.classList.add('over')" ondragleave="this.classList.remove('over')" ondrop="window.nxCRM.drop(event,'${e[0]}');this.classList.remove('over')" aria-label="${e[1]}">
        <header><span><i class="ti ${e[2]}"></i> ${e[1]} <b class="n">${items.length}</b></span><span class="c">${tot ? fmt(tot) : ''}</span></header>
        <div class="lst">${items.map(tarjeta).join('') || `<div class="vac">${e[0] === 'ganado' || e[0] === 'perdido' ? 'Nada en los últimos 30 días' : 'Arrastra aquí'}</div>`}</div>
      </section>`;
    }).join('');
    return barraFiltros() + `<div class="nxCrmBoard">${cols}</div><p class="nxCrmNote">Ganado y Perdido muestran los últimos 30 días; el historial completo está en Reportes.</p>`;
  }

  function vistaTareas() {
    const hoy = hoyISO(), me = yo();
    let l = S.tareas.slice();
    if (S.filtro === 'mias') l = l.filter(t => String(t.asignado_id || '') === String(me || ''));
    if (S.filtro === 'libres') l = l.filter(t => !t.asignado_id);
    const grupos = [['Vencidas', t => t.vence_at && diaRD(t.vence_at) < hoy], ['Hoy', t => t.vence_at && diaRD(t.vence_at) === hoy], ['Próximas', t => t.vence_at && diaRD(t.vence_at) > hoy], ['Sin fecha', t => !t.vence_at]];
    const opN = id => { const o = S.ops.find(x => String(x.id) === String(id)); return o ? o.nombre : ''; };
    const html = grupos.map(([g, f]) => {
      const ts = l.filter(f); if (!ts.length) return '';
      return `<div class="nxCrmTG"><h4 class="${g === 'Vencidas' ? 'bad' : ''}">${g} <span>${ts.length}</span></h4>${ts.map(t => `<div class="nxCrmTask">
        <button type="button" class="chk" aria-label="Marcar como hecha" onclick="window.nxCRM.tareaHecha('${t.id}')"><i class="ti ti-square"></i></button>
        <div class="tx" onclick="${t.crm_id ? `window.nxCRM.abrir('${t.crm_id}')` : ''}"><b>${esc(t.texto)}</b><small>${esc(opN(t.crm_id))}${t.vence_at ? ' · ' + dmy(t.vence_at) + ' ' + hora(t.vence_at) : ''}${t.asignado_nombre ? ' · ' + esc(t.asignado_nombre) : ''}</small></div>
      </div>`).join('')}</div>`;
    }).join('');
    return barraFiltros().replace(/<label class="nxCrmQ">[\s\S]*<\/label>/, '') + (html || '<div class="nxCrmEmpty"><i class="ti ti-checks"></i><b>Sin tareas pendientes</b><span>Agrega tareas con fecha desde la ficha de una oportunidad.</span></div>');
  }

  // ── Reportes ───────────────────────────────────────────────────────
  function vistaReportes() {
    const hoy = hoyISO();
    if (!S.repDesde) S.repDesde = hoy.slice(0, 8) + '01';
    if (!S.repHasta) S.repHasta = hoy;
    const en = ts => { const d = diaRD(ts); return d >= S.repDesde && d <= S.repHasta; };
    const cerr = S.ops.filter(o => (o.etapa === 'ganado' || o.etapa === 'perdido') && en(o.cerrado_at));
    const gan = cerr.filter(o => o.etapa === 'ganado'), per = cerr.filter(o => o.etapa === 'perdido');
    const creadas = S.ops.filter(o => en(o.created_at));
    const ciclo = gan.length ? Math.round(gan.reduce((s, o) => s + Math.max(0, diasEntre(diaRD(o.created_at), diaRD(o.cerrado_at))), 0) / gan.length) : null;
    const pct = (a, b) => b ? Math.round(a / b * 100) + ' %' : '—';
    // Por vendedor
    const pv = {};
    const k = o => o.asignado_nombre || 'Sin asignar';
    S.ops.forEach(o => { const x = pv[k(o)] = pv[k(o)] || { ab: 0, g: 0, p: 0, m: 0 }; if (abierta(o)) x.ab++; });
    cerr.forEach(o => { const x = pv[k(o)] = pv[k(o)] || { ab: 0, g: 0, p: 0, m: 0 }; if (o.etapa === 'ganado') { x.g++; x.m += n(o.monto_estimado); } else x.p++; });
    const filasV = Object.entries(pv).sort((a, b) => b[1].m - a[1].m).map(([nm, x]) => `<tr><td>${esc(nm)}</td><td class="r">${x.ab}</td><td class="r">${x.g}</td><td class="r">${x.p}</td><td class="r">${pct(x.g, x.g + x.p)}</td><td class="r">${fmt(x.m)}</td></tr>`).join('') || '<tr><td colspan="6" class="vac">Sin datos</td></tr>';
    // Por fuente
    const pf = {};
    creadas.forEach(o => { const f = o.fuente || 'Sin fuente'; const x = pf[f] = pf[f] || { c: 0, g: 0 }; x.c++; });
    gan.forEach(o => { const f = o.fuente || 'Sin fuente'; const x = pf[f] = pf[f] || { c: 0, g: 0 }; x.g++; });
    const filasF = Object.entries(pf).sort((a, b) => b[1].c - a[1].c).map(([f, x]) => `<tr><td>${esc(f)}</td><td class="r">${x.c}</td><td class="r">${x.g}</td></tr>`).join('') || '<tr><td colspan="3" class="vac">Sin datos</td></tr>';
    // Motivos de pérdida
    const pm = {}; per.forEach(o => { const m = o.motivo_perdida || 'Sin motivo'; pm[m] = (pm[m] || 0) + 1; });
    const maxM = Math.max(1, ...Object.values(pm));
    const barrasM = Object.entries(pm).sort((a, b) => b[1] - a[1]).map(([m, c]) => `<div class="nxCrmBarR"><span>${esc(m)}</span><div><i style="width:${Math.round(c / maxM * 100)}%"></i></div><b>${c}</b></div>`).join('') || '<div class="vac">Ninguna oportunidad perdida en el período</div>';
    // Embudo actual
    const maxE = Math.max(1, ...ABIERTAS.map(e => S.ops.filter(o => o.etapa === e).length));
    const embudo = ABIERTAS.map(e => { const c = S.ops.filter(o => o.etapa === e); return `<div class="nxCrmBarR"><span>${etN(e)}</span><div><i style="width:${Math.round(c.length / maxE * 100)}%"></i></div><b>${c.length} · ${fmt(c.reduce((s, o) => s + n(o.monto_estimado), 0))}</b></div>`; }).join('');
    return `<div class="nxCrmRange"><label>Desde<input type="date" value="${S.repDesde}" onchange="window.nxCRM.rango('d',this.value)"></label><label>Hasta<input type="date" value="${S.repHasta}" onchange="window.nxCRM.rango('h',this.value)"></label></div>
      <div class="nxCrmKpis sm">
        <div class="k"><span>Creadas</span><b>${creadas.length}</b></div>
        <div class="k"><span>Ganadas</span><b>${gan.length}</b><small>${fmt(gan.reduce((s, o) => s + n(o.monto_estimado), 0))}</small></div>
        <div class="k"><span>Perdidas</span><b>${per.length}</b></div>
        <div class="k"><span>Conversión</span><b>${pct(gan.length, cerr.length)}</b><small>ganadas / cerradas</small></div>
        <div class="k"><span>Ciclo promedio</span><b>${ciclo == null ? '—' : ciclo + ' días'}</b><small>de creada a ganada</small></div>
      </div>
      <div class="nxCrmGrid">
        <section class="nxCrmPanel"><h4>Embudo actual</h4>${embudo}</section>
        <section class="nxCrmPanel"><h4>Motivos de pérdida</h4>${barrasM}</section>
      </div>
      <section class="nxCrmPanel"><h4>Por vendedor</h4><div class="tw"><table class="nxCrmT"><thead><tr><th>Vendedor</th><th class="r">Abiertas</th><th class="r">Ganadas</th><th class="r">Perdidas</th><th class="r">Conversión</th><th class="r">Monto ganado</th></tr></thead><tbody>${filasV}</tbody></table></div></section>
      <section class="nxCrmPanel"><h4>Por fuente</h4><div class="tw"><table class="nxCrmT"><thead><tr><th>Fuente</th><th class="r">Creadas</th><th class="r">Ganadas</th></tr></thead><tbody>${filasF}</tbody></table></div></section>`;
  }

  // ── Mover etapa ────────────────────────────────────────────────────
  async function mover(id, etapa, motivo) {
    const o = S.ops.find(x => String(x.id) === String(id)); if (!o || o.etapa === etapa) return;
    if (etapa === 'perdido' && !motivo) { pedirMotivo(id); return; }
    const body = { etapa: etapa }; if (etapa === 'perdido') body.motivo_perdida = motivo;
    const antes = o.etapa; o.etapa = etapa; repintar();
    try {
      const r = await api().patch('pos_crm', 'id=eq.' + id, body);
      const fila = Array.isArray(r) ? r[0] : r; if (fila && fila.id) Object.assign(o, fila);
      toast('ok', etN(etapa), o.nombre);
      if (S.ficha && String(S.ficha) === String(id)) await cargarActs(id);
    } catch (e) { o.etapa = antes; toast('err', 'No se pudo mover', errTxt(e)); }
    repintar(); if (S.ficha) pintarFicha();
  }
  function pedirMotivo(id) {
    cerrar('nxCrmMot');
    const ov = document.createElement('div'); ov.id = 'nxCrmMot'; ov.className = 'overlay open';
    ov.addEventListener('click', ev => { if (ev.target === ov) ov.remove(); });
    ov.innerHTML = `<div class="modal nxCrmModal" style="max-width:380px" role="dialog" aria-labelledby="nxCrmMotT">
      <div class="mt"><span id="nxCrmMotT"><i class="ti ti-circle-x"></i> ¿Por qué se perdió?</span><button class="nxBack" type="button" onclick="document.getElementById('nxCrmMot').remove()"><i class="ti ti-arrow-left"></i> Volver</button></div>
      <div class="nxCrmMotL">${MOTIVOS.map(m => `<button type="button" class="nxCrmChip" onclick="window.nxCRM.motivo('${id}', ${JSON.stringify(m).replace(/"/g, '&quot;')})">${esc(m)}</button>`).join('')}</div>
      <label class="nxCrmF"><span>Otro motivo o detalle</span><input id="nxCrmMotTx" placeholder="Escribe el motivo…" onkeydown="if(event.key==='Enter')window.nxCRM.motivo('${id}', this.value)"></label>
      <button type="button" class="nxCrmBtn p" style="width:100%;margin-top:10px" onclick="window.nxCRM.motivo('${id}', document.getElementById('nxCrmMotTx').value)">Marcar como perdida</button>
    </div>`;
    document.body.appendChild(ov);
  }

  // ── Ficha ──────────────────────────────────────────────────────────
  async function cargarActs(id) {
    try { S.acts = await api().get('pos_crm_actividades', 'select=*&crm_id=eq.' + id + '&order=created_at.desc&limit=300') || []; } catch (e) { S.acts = []; }
  }
  async function cargarDocs(o) {
    const d = {};
    const q = (t, sel, id) => id ? api().get(t, 'select=' + sel + '&id=eq.' + id).then(r => (r || [])[0] || null).catch(() => null) : Promise.resolve(null);
    [d.cot, d.venta, d.rep] = await Promise.all([q('pos_cotizaciones', 'id,numero,total,estado', o.cotizacion_id), q('pos_ventas', 'id,numero,numero_factura,total,estado', o.venta_id), q('pos_reparaciones', 'id,numero,equipo,estado', o.reparacion_id)]);
    S.docs = d;
    S.reps = o.cliente_id ? await api().get('pos_reparaciones', 'select=id,numero,equipo,estado&cliente_id=eq.' + o.cliente_id + '&order=created_at.desc&limit=20').catch(() => []) || [] : [];
  }
  async function abrir(id) {
    const o = S.ops.find(x => String(x.id) === String(id)); if (!o) return;
    S.ficha = o.id; S.acts = []; S.docs = {}; S.reps = [];
    pintarFicha();
    await Promise.all([cargarActs(o.id), cargarDocs(o)]);
    if (String(S.ficha) === String(o.id)) pintarFicha();
  }
  function nueva() {
    cerrar('nxCrmFicha');
    S.ficha = 'nueva'; S.acts = []; S.docs = {}; S.reps = [];
    pintarFicha();
  }
  function pintarFicha() {
    const nuevaOp = S.ficha === 'nueva';
    const o = nuevaOp ? { etapa: 'nuevo', asignado_id: esAdmin() ? null : yo(), fuente: '' } : S.ops.find(x => String(x.id) === String(S.ficha));
    if (!o) { cerrar('nxCrmFicha'); S.ficha = null; return; }
    const c = cliDe(o.cliente_id);
    let ov = document.getElementById('nxCrmFicha');
    const scroll = ov ? (ov.querySelector('.nxCrmFB') || {}).scrollTop : 0;
    if (!ov) { ov = document.createElement('div'); ov.id = 'nxCrmFicha'; ov.className = 'overlay open'; ov.addEventListener('click', ev => { if (ev.target === ov) window.nxCRM.cerrarFicha(); }); document.body.appendChild(ov); }
    const puedeAsignar = esAdmin();
    const usrOpts = `<option value="">Sin asignar</option>` + S.usuarios.map(u => `<option value="${u.id}"${String(o.asignado_id || '') === String(u.id) ? ' selected' : ''}>${esc(u.nom)}${u.rol ? ' · ' + esc(u.rol) : ''}</option>`).join('');
    const etapas = ET.map(e => `<button type="button" class="nxCrmEt e-${e[0]}${o.etapa === e[0] ? ' on' : ''}" aria-pressed="${o.etapa === e[0]}" ${nuevaOp ? `onclick="window.nxCRM.etNueva('${e[0]}')"` : `onclick="window.nxCRM.mover('${o.id}','${e[0]}')"`}><i class="ti ${e[2]}"></i> ${e[1]}</button>`).join('');
    const tel = o.telefono || (c && c.telefono) || '';
    const wa = waNum(tel);
    const d = S.docs || {};
    const vinc = nuevaOp ? '' : `<section class="nxCrmSec"><h4>Documentos</h4>
      <div class="nxCrmDocs">
        <div class="doc"><i class="ti ti-file-dollar"></i><span>${d.cot ? 'Cotización ' + esc(d.cot.numero || '') + ' · ' + fmt(d.cot.total) : 'Sin cotización'}</span><button type="button" class="nxCrmBtn sm" onclick="window.nxCRM.cotizar('${o.id}')">${d.cot ? 'Nueva' : 'Cotizar'}</button></div>
        <div class="doc"><i class="ti ti-receipt"></i><span>${d.venta ? 'Factura ' + esc(d.venta.numero_factura || d.venta.numero || '') + ' · ' + fmt(d.venta.total) : 'Sin venta'}</span>${d.venta ? '' : `<button type="button" class="nxCrmBtn sm" onclick="window.nxCRM.facturar('${o.id}')">Facturar</button>`}</div>
        <div class="doc"><i class="ti ti-tool"></i>${o.cliente_id ? `<select aria-label="Reparación vinculada" onchange="window.nxCRM.guardarCampo('${o.id}','reparacion_id',this.value||null)"><option value="">Sin reparación</option>${(S.reps || []).map(r => `<option value="${r.id}"${String(o.reparacion_id || '') === String(r.id) ? ' selected' : ''}>#${esc(r.numero || '')} · ${esc(r.equipo || '')} · ${esc(r.estado || '')}</option>`).join('')}</select>` : '<span>Vincula un cliente para elegir una reparación</span>'}</div>
      </div></section>`;
    const acts = nuevaOp ? '' : `<section class="nxCrmSec"><h4>Actividad</h4>
      <div class="nxCrmComp">
        <div class="tipos" role="group" aria-label="Tipo de actividad">${['nota', 'llamada', 'visita', 'tarea'].map((t, i) => `<label><input type="radio" name="nxCrmTipo" value="${t}"${i === 0 ? ' checked' : ''} onchange="document.getElementById('nxCrmVenc').style.display=this.value==='tarea'?'':'none'"><span><i class="ti ${ACT[t][1]}"></i> ${ACT[t][0]}</span></label>`).join('')}</div>
        <textarea id="nxCrmTx" rows="2" placeholder="¿Qué pasó o qué hay que hacer?"></textarea>
        <div id="nxCrmVenc" class="venc" style="display:none"><label>Para<input type="datetime-local" id="nxCrmVencAt" value="${addDays(hoyISO(), 1)}T09:00"></label>${puedeAsignar ? `<label>Responsable<select id="nxCrmVencA">${usrOpts.replace(/ selected/g, '')}</select></label>` : ''}</div>
        <button type="button" class="nxCrmBtn p" onclick="window.nxCRM.agregarAct('${o.id}')"><i class="ti ti-plus"></i> Agregar</button>
      </div>
      <ol class="nxCrmTL">${S.acts.length ? S.acts.map(a => `<li class="a-${a.tipo}${a.tipo === 'tarea' && a.hecha ? ' done' : ''}"><i class="ti ${(ACT[a.tipo] || ACT.nota)[1]}"></i><div>
        <p>${a.tipo === 'tarea' ? `<button type="button" class="chk" aria-label="${a.hecha ? 'Marcar pendiente' : 'Marcar hecha'}" onclick="window.nxCRM.tareaHecha('${a.id}', ${!a.hecha})"><i class="ti ${a.hecha ? 'ti-square-check' : 'ti-square'}"></i></button>` : ''}${esc(a.texto)}</p>
        <small>${esc((ACT[a.tipo] || ACT.nota)[0])} · ${dmy(a.created_at)} ${hora(a.created_at)}${a.created_by_name ? ' · ' + esc(a.created_by_name) : ''}${a.tipo === 'tarea' && a.vence_at ? ' · para ' + dmy(a.vence_at) + ' ' + hora(a.vence_at) : ''}${a.asignado_nombre ? ' · ' + esc(a.asignado_nombre) : ''}</small>
      </div></li>`).join('') : '<li class="vac">Cargando actividad…</li>'}</ol></section>`;
    const consent = c ? `<label class="nxCrmChk"><input type="checkbox" ${c.acepta_whatsapp ? 'checked' : ''} onchange="window.nxCRM.consentimiento('${c.id}', this.checked)"> Acepta recibir mensajes y ofertas por WhatsApp${c.acepta_whatsapp_fecha ? ` <small>(desde ${dmy(c.acepta_whatsapp_fecha)})</small>` : ''}</label>` : '';
    ov.innerHTML = `<div class="modal nxCrmModal nxCrmFicha" role="dialog" aria-labelledby="nxCrmFT">
      <div class="mt"><span id="nxCrmFT"><i class="ti ti-target-arrow"></i> ${nuevaOp ? 'Nueva oportunidad' : esc(o.nombre) + (o.numero ? ` <small>${esc(o.numero)}</small>` : '')}</span>
        <button class="nxBack" type="button" onclick="window.nxCRM.cerrarFicha()"><i class="ti ti-arrow-left"></i> Cerrar</button></div>
      <div class="nxCrmFB">
        <div class="nxCrmEts" role="group" aria-label="Etapa">${etapas}</div>
        ${o.etapa === 'perdido' && o.motivo_perdida ? `<div class="nxCrmLost"><i class="ti ti-circle-x"></i> Perdida: ${esc(o.motivo_perdida)}</div>` : ''}
        <section class="nxCrmSec"><h4>Datos</h4>
          <label class="nxCrmF"><span>Nombre de la oportunidad *</span><input id="ocNom" value="${esc(o.nombre || '')}" placeholder="Ej.: iPhone 15 a crédito para Juan"></label>
          <div class="g2">
            <div class="nxCrmF"><span>Cliente</span><button type="button" class="nxCrmPick" onclick="window.nxCRM.elegirCliente()"><i class="ti ti-user-search"></i> <span id="ocCliTx">${c ? esc(c.nombre) : 'Buscar cliente…'}</span></button><input type="hidden" id="ocCli" value="${esc(o.cliente_id || '')}"></div>
            <label class="nxCrmF"><span>Interés</span><input id="ocInt" value="${esc(o.interes || '')}" placeholder="Producto o servicio"></label>
          </div>
          <div class="g2">
            <label class="nxCrmF"><span>Contacto</span><input id="ocCont" value="${esc(o.contacto || '')}" placeholder="Nombre de la persona"></label>
            <label class="nxCrmF"><span>Teléfono</span><div class="tel"><input id="ocTel" inputmode="tel" value="${esc(o.telefono || '')}" placeholder="${esc((c && c.telefono) || '809…')}">${wa && !nuevaOp ? `<a class="wa" href="https://wa.me/${wa}" target="_blank" rel="noopener" onclick="window.nxCRM.waAbierto('${o.id}')" aria-label="Abrir WhatsApp"><i class="ti ti-brand-whatsapp"></i></a>` : ''}</div></label>
          </div>
          <div class="g2">
            <label class="nxCrmF"><span>Monto estimado (RD$)</span><input id="ocMonto" inputmode="decimal" value="${n(o.monto_estimado) ? Math.round(n(o.monto_estimado)) : ''}" placeholder="0"></label>
            <label class="nxCrmF"><span>Fuente</span><select id="ocFuente"><option value="">—</option>${FUENTES.map(f => `<option${o.fuente === f ? ' selected' : ''}>${f}</option>`).join('')}${o.fuente && FUENTES.indexOf(o.fuente) < 0 ? `<option selected>${esc(o.fuente)}</option>` : ''}</select></label>
          </div>
          <div class="g2">
            <label class="nxCrmF"><span>Email</span><input id="ocEmail" type="email" value="${esc(o.email || '')}" placeholder="Opcional"></label>
            <label class="nxCrmF"><span>Responsable</span>${puedeAsignar ? `<select id="ocAsig">${usrOpts}</select>` : `<div class="asig">${o.asignado_nombre ? esc(o.asignado_nombre) : 'Sin asignar'}${!nuevaOp && !o.asignado_id ? ` <button type="button" class="nxCrmBtn sm" onclick="window.nxCRM.tomar('${o.id}')">Tomarla</button>` : ''}${!nuevaOp && String(o.asignado_id || '') === String(yo() || '') ? ` <button type="button" class="nxCrmBtn sm" onclick="window.nxCRM.soltar('${o.id}')">Soltarla</button>` : ''}</div>`}</label>
          </div>
          <label class="nxCrmF"><span>Notas generales</span><textarea id="ocNotas" rows="2">${esc(o.notas || '')}</textarea></label>
          ${consent}
          <div class="acts">${!nuevaOp && esAdmin() ? `<button type="button" class="nxCrmBtn del" onclick="window.nxCRM.borrar('${o.id}')" aria-label="Eliminar oportunidad"><i class="ti ti-trash"></i></button>` : ''}<button type="button" class="nxCrmBtn p" onclick="window.nxCRM.guardar()"><i class="ti ti-device-floppy"></i> ${nuevaOp ? 'Crear oportunidad' : 'Guardar datos'}</button></div>
        </section>
        ${vinc}${acts}
      </div>
    </div>`;
    const fb = ov.querySelector('.nxCrmFB'); if (fb && scroll) fb.scrollTop = scroll;
    if (nuevaOp) setTimeout(() => { const i = document.getElementById('ocNom'); if (i) i.focus(); }, 60);
  }
  let _etNueva = 'nuevo';
  function leerForm() {
    const v = id => { const e = document.getElementById(id); return e ? String(e.value || '').trim() : ''; };
    const b = { nombre: v('ocNom'), cliente_id: v('ocCli') || null, interes: v('ocInt') || null, contacto: v('ocCont') || null, telefono: v('ocTel') || null,
      monto_estimado: n(String(v('ocMonto')).replace(/[^\d.]/g, '')), fuente: v('ocFuente') || null, email: v('ocEmail') || null, notas: v('ocNotas') || null };
    if (document.getElementById('ocAsig')) b.asignado_id = v('ocAsig') || null;
    return b;
  }
  async function guardar() {
    const nuevaOp = S.ficha === 'nueva';
    const b = leerForm();
    if (!b.nombre) { toast('err', 'Falta el nombre de la oportunidad'); return; }
    try {
      if (nuevaOp) {
        b.etapa = _etNueva === 'perdido' ? 'nuevo' : _etNueva;
        if (!('asignado_id' in b)) b.asignado_id = yo();
        try { b.created_by_name = (ctx().sesion && ctx().sesion() || {}).nom || null; } catch (e) {}
        try { if (ctx().nextSeq) b.numero = await ctx().nextSeq('crm'); } catch (e) {}
        const r = await api().post('pos_crm', b);
        const fila = Array.isArray(r) ? r[0] : r;
        toast('ok', 'Oportunidad creada', b.nombre);
        _etNueva = 'nuevo';
        await cargar();
        if (fila && fila.id) { S.ficha = fila.id; await abrir(fila.id); } else { window.nxCRM.cerrarFicha(); }
      } else {
        const r = await api().patch('pos_crm', 'id=eq.' + S.ficha, b);
        const fila = Array.isArray(r) ? r[0] : r; const o = S.ops.find(x => String(x.id) === String(S.ficha)); if (o) Object.assign(o, fila && fila.id ? fila : b);
        toast('ok', 'Datos guardados');
        await cargarActs(S.ficha); pintarFicha();
      }
      repintar();
    } catch (e) { toast('err', 'No se pudo guardar', errTxt(e)); }
  }
  async function guardarCampo(id, campo, valor) {
    const b = {}; b[campo] = valor;
    try { const r = await api().patch('pos_crm', 'id=eq.' + id, b); const fila = Array.isArray(r) ? r[0] : r; const o = S.ops.find(x => String(x.id) === String(id)); if (o) Object.assign(o, fila && fila.id ? fila : b); toast('ok', 'Guardado'); await cargarActs(id); pintarFicha(); repintar(); }
    catch (e) { toast('err', 'No se pudo', errTxt(e)); }
  }
  async function agregarAct(id) {
    const tx = (document.getElementById('nxCrmTx') || {}).value || '';
    const tipo = ((document.querySelector('input[name="nxCrmTipo"]:checked') || {}).value) || 'nota';
    if (!tx.trim()) { toast('warn', 'Escribe la actividad'); return; }
    const b = { crm_id: id, tipo: tipo, texto: tx.trim() };
    if (tipo === 'tarea') {
      const at = (document.getElementById('nxCrmVencAt') || {}).value;
      if (at) b.vence_at = new Date(at).toISOString();
      const a = document.getElementById('nxCrmVencA'); b.asignado_id = a ? (a.value || null) : yo();
      if (!b.asignado_id) { const o = S.ops.find(x => String(x.id) === String(id)); b.asignado_id = (o && o.asignado_id) || yo(); }
    }
    try {
      await api().post('pos_crm_actividades', b);
      toast('ok', tipo === 'tarea' ? 'Tarea agregada' : 'Actividad agregada');
      await Promise.all([cargarActs(id), cargar()]); pintarFicha(); repintar();
    } catch (e) { toast('err', 'No se pudo agregar', errTxt(e)); }
  }
  async function tareaHecha(id, hecha) {
    if (hecha === undefined) hecha = true;
    try {
      await api().patch('pos_crm_actividades', 'id=eq.' + id, { hecha: hecha });
      toast('ok', hecha ? 'Tarea completada' : 'Tarea pendiente');
      await cargar(); if (S.ficha && S.ficha !== 'nueva') { await cargarActs(S.ficha); pintarFicha(); } repintar();
    } catch (e) { toast('err', 'No se pudo', errTxt(e)); }
  }
  async function consentimiento(cliId, on) {
    const b = { acepta_whatsapp: !!on, acepta_whatsapp_fecha: on ? new Date().toISOString() : null };
    try {
      await api().patch('pos_clientes', 'id=eq.' + cliId, b);
      const c = cliDe(cliId); if (c) Object.assign(c, b);
      if (S.ficha && S.ficha !== 'nueva') { try { await api().post('pos_crm_actividades', { crm_id: S.ficha, tipo: 'nota', texto: on ? 'El cliente autorizó recibir mensajes y ofertas por WhatsApp' : 'El cliente retiró el permiso de mensajes por WhatsApp' }); await cargarActs(S.ficha); } catch (e) {} }
      toast('ok', on ? 'Permiso registrado' : 'Permiso retirado'); pintarFicha();
    } catch (e) { toast('err', 'No se pudo guardar el permiso', errTxt(e)); }
  }

  // ── Vínculos con Cotización / Factura ──────────────────────────────
  function cotizar(id) {
    const o = S.ops.find(x => String(x.id) === String(id)); if (!o) return;
    S.pendiente = { crm: o.id, tipo: 'cot', en: Date.now() };
    const c = cliDe(o.cliente_id);
    window.nxCRM.cerrarFicha();
    try { ctx().cotizar(c || null); } catch (e) { toast('err', 'No se pudo abrir la cotización'); }
  }
  function facturar(id) {
    const o = S.ops.find(x => String(x.id) === String(id)); if (!o) return;
    S.pendiente = { crm: o.id, tipo: 'venta', en: Date.now() };
    window.nxCRM.cerrarFicha();
    toast('ok', 'Factura abierta para esta oportunidad', 'Al cobrar, la oportunidad queda Ganada y enlazada a la factura');
    try { ctx().facturar(o.cliente_id || ''); } catch (e) {}
  }
  const PEND_MS = 2 * 60 * 60 * 1000;
  async function docGuardado(tipo, d) {
    const p = S.pendiente; if (!p || p.tipo !== 'cot' || tipo !== 'cot' || !d || !d.id || Date.now() - p.en > PEND_MS) return;
    S.pendiente = null;
    const o = S.ops.find(x => String(x.id) === String(p.crm));
    const b = { cotizacion_id: d.id };
    if (o && (o.etapa === 'nuevo' || o.etapa === 'contactado')) b.etapa = 'cotizado';
    if (o && !n(o.monto_estimado) && n(d.total)) b.monto_estimado = n(d.total);
    try { await api().patch('pos_crm', 'id=eq.' + p.crm, b); await api().post('pos_crm_actividades', { crm_id: p.crm, tipo: 'nota', texto: 'Cotización ' + (d.numero || '') + ' por ' + fmt(d.total) + ' enlazada' }); toast('ok', 'Cotización enlazada a la oportunidad'); await cargar(); } catch (e) {}
  }
  async function ventaCreada(v) {
    const p = S.pendiente; if (!p || p.tipo !== 'venta' || !v || !v.id || Date.now() - p.en > PEND_MS) return;
    S.pendiente = null;
    const o = S.ops.find(x => String(x.id) === String(p.crm));
    const b = { venta_id: v.id, etapa: 'ganado' };
    if (o && !n(o.monto_estimado)) b.monto_estimado = n(v.total);
    try { await api().patch('pos_crm', 'id=eq.' + p.crm, b); await api().post('pos_crm_actividades', { crm_id: p.crm, tipo: 'nota', texto: 'Factura ' + (v.numero_factura || v.numero || '') + ' por ' + fmt(v.total) + ' — oportunidad ganada' }); toast('ok', 'Oportunidad ganada', 'Enlazada a la factura'); await cargar(); } catch (e) {}
  }

  // ── Avisos ─────────────────────────────────────────────────────────
  function avisosHTML(fila) {
    if (!S.cargado && !S.avisosCargando) { S.avisosCargando = true; cargar().then(() => { S.avisosCargando = false; repintar(); }); return ''; }
    const hoy = hoyISO(), me = yo();
    const l = S.tareas.filter(t => t.vence_at && diaRD(t.vence_at) <= hoy && (esAdmin() || !t.asignado_id || String(t.asignado_id) === String(me || '')));
    const opN = id => { const o = S.ops.find(x => String(x.id) === String(id)); return o ? o.nombre : ''; };
    return l.slice(0, 30).map(t => fila(esc(t.texto), (diaRD(t.vence_at) < hoy ? '<b style="color:var(--pf-red)">Vencida ' + dmy(t.vence_at) + '</b>' : 'Hoy ' + hora(t.vence_at)) + ' · ' + esc(opN(t.crm_id)) + (t.asignado_nombre ? ' · ' + esc(t.asignado_nombre) : ''),
      `<button class="ab g3" style="height:30px;width:auto;padding:0 10px" onclick="window.nxCRM.tareaHecha('${t.id}')"><i class="ti ti-check"></i> Hecha</button><button class="ab g2" style="height:30px;width:30px;padding:0" onclick="window.nxPosTab('crm').then(function(){window.nxCRM.abrir('${t.crm_id}')})" aria-label="Abrir oportunidad"><i class="ti ti-target-arrow"></i></button>`)).join('');
  }


  // ── Bandeja (Fase 2): WhatsApp, Instagram y Facebook vía Zernio ─────────
  // Lectura con la RLS del usuario; el envío pasa SIEMPRE por la función crm-enviar (clave de idempotencia, ventana de
  // 24 h de WhatsApp, canal activo). Nada se envía solo: únicamente cuando el empleado pulsa Enviar.
  const PLAT = { whatsapp: ['WhatsApp', 'ti-brand-whatsapp', '#15803d'], instagram: ['Instagram', 'ti-brand-instagram', '#c13584'], facebook: ['Facebook', 'ti-brand-messenger', '#1877f2'] };
  const BD = { convs: [], canales: [], sel: null, msgs: [], filtro: 'todas', canalF: '', q: '', urls: {}, timer: null, cargado: false, enviando: false, error: '' };
  function apiBase() { const a = api() || {}; return { url: a.url, key: a.key, tok: a.token || a.key }; }
  function bdPendiente(c) { return c.ultimo_inbound_at && (!c.ultima_respuesta_at || c.ultima_respuesta_at < c.ultimo_inbound_at); }
  function bdVentana(c) { if (!c || c.plataforma !== 'whatsapp') return true; return !!c.ultimo_inbound_at && (Date.now() - new Date(c.ultimo_inbound_at).getTime()) < 24 * 3600e3; }
  function bdHora(ts) { if (!ts) return ''; const d = diaRD(ts), h = hoyISO(); return d === h ? hora(ts) : d === addDays(h, -1) ? 'ayer' : dmy(ts).slice(0, 5); }
  function bdNombre(c) { const cli = cliDe(c.cliente_id); return (cli && cli.nombre) || c.contacto_nombre || c.contacto_usuario || c.telefono_e164 || 'Contacto'; }
  async function bdCargar() {
    try {
      const [convs, canales] = await Promise.all([
        api().get('crm_conversaciones', 'select=*&archivada=eq.false&order=ultimo_mensaje_at.desc.nullslast&limit=300'),
        api().get('crm_canales', 'select=*&order=plataforma.asc')
      ]);
      BD.convs = convs || []; BD.canales = canales || []; BD.cargado = true; BD.error = '';
    } catch (e) { BD.error = errTxt(e); BD.cargado = true; }
  }
  async function bdCargarMsgs(id) {
    try { BD.msgs = await api().get('crm_mensajes', 'select=*&conversacion_id=eq.' + id + '&order=created_at.asc&limit=500') || []; } catch (e) { BD.msgs = []; }
  }
  function bdLista() {
    const q = BD.q.trim().toLowerCase(), me = yo();
    return BD.convs.filter(c => {
      if (BD.canalF && c.plataforma !== BD.canalF) return false;
      if (BD.filtro === 'noleidas' && !(c.no_leidos > 0)) return false;
      if (BD.filtro === 'pendientes' && !bdPendiente(c)) return false;
      if (BD.filtro === 'mias' && String(c.asignado_id || '') !== String(me || '')) return false;
      if (BD.filtro === 'libres' && c.asignado_id) return false;
      if (q && [bdNombre(c), c.telefono_e164, c.contacto_usuario, c.ultimo_mensaje_preview].join(' ').toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }
  function bdListaHTML() {
    const l = bdLista();
    if (!l.length) return `<div class="bdVac">${BD.convs.length ? 'Ninguna conversación con este filtro.' : 'Todavía no hay conversaciones.'}</div>`;
    return l.map(c => { const p = PLAT[c.plataforma] || PLAT.whatsapp; return `<button type="button" class="bdIt${String(BD.sel) === String(c.id) ? ' on' : ''}${c.no_leidos > 0 ? ' unread' : ''}" onclick="window.nxCRM.bdAbrir('${c.id}')">
      <span class="av"><b>${esc(ini(bdNombre(c)))}</b><i class="ti ${p[1]}" style="color:${p[2]}" aria-label="${p[0]}"></i></span>
      <span class="tx"><span class="r1"><b>${esc(bdNombre(c))}</b><small>${bdHora(c.ultimo_mensaje_at)}</small></span>
        <span class="r2"><span class="pv">${esc(c.ultimo_mensaje_preview || '')}</span>${c.no_leidos > 0 ? `<span class="nl">${c.no_leidos}</span>` : bdPendiente(c) ? '<span class="pd" title="Sin responder"></span>' : ''}</span>
        ${c.asignado_nombre ? `<span class="r3"><i class="ti ti-user"></i> ${esc(c.asignado_nombre)}</span>` : ''}</span></button>`; }).join('');
  }
  function bdBurbuja(m) {
    const media = m.media_path ? (BD.urls[m.media_path] ? (m.tipo === 'imagen' ? `<a href="${esc(BD.urls[m.media_path])}" target="_blank" rel="noopener"><img src="${esc(BD.urls[m.media_path])}" alt="Imagen"></a>` : m.tipo === 'audio' ? `<audio controls src="${esc(BD.urls[m.media_path])}"></audio>` : m.tipo === 'video' ? `<video controls src="${esc(BD.urls[m.media_path])}"></video>` : `<a class="doc" href="${esc(BD.urls[m.media_path])}" target="_blank" rel="noopener"><i class="ti ti-file"></i> Abrir archivo</a>`) : `<span class="ld"><i class="ti ti-paperclip"></i> ${esc(m.tipo)}…</span>`) : '';
    const tick = m.direccion === 'out' ? ({ pendiente: '<i class="ti ti-clock" title="Enviando"></i>', enviado: '<i class="ti ti-check" title="Enviado"></i>', entregado: '<i class="ti ti-checks" title="Entregado"></i>', leido: '<i class="ti ti-checks lei" title="Leído"></i>', fallido: '<i class="ti ti-alert-circle err" title="No se envió"></i>' }[m.estado] || '') : '';
    return `<div class="bdM ${m.direccion}${m.estado === 'fallido' ? ' fail' : ''}">${media}${m.cuerpo ? `<p>${esc(m.cuerpo)}</p>` : ''}<small>${m.direccion === 'out' && (m.enviado_por_nombre || m.desde_telefono) ? esc(m.enviado_por_nombre || 'desde el teléfono') + ' · ' : ''}${bdHora(m.created_at)} ${tick}</small>${m.estado === 'fallido' && m.error ? `<em>No se envió. ${esc(String(m.error).slice(0, 120))}</em>` : ''}</div>`;
  }
  function bdMsgsHTML() {
    if (!BD.msgs.length) return '<div class="bdVac">Cargando mensajes…</div>';
    let dia = '';
    return BD.msgs.map(m => { const d = diaRD(m.created_at); const sep = d !== dia ? `<div class="bdDia">${d === hoyISO() ? 'Hoy' : dmy(m.created_at)}</div>` : ''; dia = d; return sep + bdBurbuja(m); }).join('');
  }
  function bdChatHTML() {
    const c = BD.convs.find(x => String(x.id) === String(BD.sel));
    if (!c) return `<div class="bdEmpty"><i class="ti ti-messages"></i><b>Elige una conversación</b><span>Los mensajes de WhatsApp, Instagram y Facebook de STUDIO llegan aquí.</span></div>`;
    const p = PLAT[c.plataforma] || PLAT.whatsapp, cli = cliDe(c.cliente_id), op = c.crm_id ? S.ops.find(o => String(o.id) === String(c.crm_id)) : null;
    const canal = BD.canales.find(x => String(x.id) === String(c.canal_id));
    const abierta = bdVentana(c), me = yo();
    const usrOpts = `<option value="">Sin asignar</option>` + S.usuarios.map(u => `<option value="${u.id}"${String(c.asignado_id || '') === String(u.id) ? ' selected' : ''}>${esc(u.nom)}</option>`).join('');
    return `<header class="bdH"><button type="button" class="bdBack" onclick="window.nxCRM.bdCerrar()" aria-label="Volver a la lista"><i class="ti ti-arrow-left"></i></button>
        <span class="av"><b>${esc(ini(bdNombre(c)))}</b></span>
        <div class="who"><b>${esc(bdNombre(c))}</b><small><i class="ti ${p[1]}" style="color:${p[2]}"></i> ${p[0]}${canal && canal.nombre ? ' · ' + esc(canal.nombre) : ''}${c.telefono_e164 ? ' · ' + esc(c.telefono_e164) : c.contacto_usuario ? ' · @' + esc(c.contacto_usuario) : ''}</small></div>
        <button type="button" class="nxCrmBtn sm" onclick="window.nxCRM.bdArchivar('${c.id}')" title="Archivar conversación" aria-label="Archivar"><i class="ti ti-archive"></i></button></header>
      <div class="bdTools">
        <button type="button" class="nxCrmChip" onclick="window.nxCRM.bdCliente('${c.id}')"><i class="ti ti-user"></i> ${cli ? esc(cli.nombre) : 'Vincular cliente'}</button>
        ${op ? `<button type="button" class="nxCrmChip" onclick="window.nxCRM.abrir('${op.id}')"><i class="ti ti-target-arrow"></i> ${esc(op.nombre)} · ${etN(op.etapa)}</button>` : `<button type="button" class="nxCrmChip" onclick="window.nxCRM.bdOportunidad('${c.id}')"><i class="ti ti-plus"></i> Crear oportunidad</button>`}
        ${esAdmin() ? `<label class="bdAsig"><i class="ti ti-user-check"></i><select aria-label="Responsable" onchange="window.nxCRM.bdAsignar('${c.id}', this.value || null)">${usrOpts}</select></label>` : !c.asignado_id ? `<button type="button" class="nxCrmChip" onclick="window.nxCRM.bdAsignar('${c.id}','${me}')"><i class="ti ti-hand-grab"></i> Tomarla</button>` : String(c.asignado_id) === String(me) ? `<button type="button" class="nxCrmChip" onclick="window.nxCRM.bdAsignar('${c.id}', null)">Soltarla</button>` : ''}
      </div>
      <div class="bdMsgs" id="bdMsgs">${bdMsgsHTML()}</div>
      ${canal && !canal.activo ? '<div class="bdAviso">Este canal está apagado. Actívalo en «Canales» para poder responder.</div>' : abierta ? `<div class="bdComp">
        <label class="bdClip" title="Adjuntar archivo" aria-label="Adjuntar archivo"><i class="ti ti-paperclip"></i><input type="file" id="bdFile" accept="image/*,video/*,audio/*,application/pdf" onchange="window.nxCRM.bdAdjuntar(this)"></label>
        <textarea id="bdTx" rows="1" placeholder="Escribe una respuesta…" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();window.nxCRM.bdEnviar()}" oninput="this.style.height='auto';this.style.height=Math.min(this.scrollHeight,140)+'px'"></textarea>
        <button type="button" class="bdSend" onclick="window.nxCRM.bdEnviar()" aria-label="Enviar"><i class="ti ti-send"></i></button></div>`
      : '<div class="bdAviso"><i class="ti ti-clock-off"></i> Pasaron más de 24 horas desde el último mensaje del cliente. WhatsApp solo permite plantillas aprobadas; el envío de plantillas llega en la Fase 3.</div>'}`;
  }
  function bdCanalesHTML() {
    if (!esAdmin()) return '';
    const filas = BD.canales.map(c => { const p = PLAT[c.plataforma] || PLAT.whatsapp; return `<div class="bdCan"><i class="ti ${p[1]}" style="color:${p[2]}"></i><div><b>${esc(c.nombre || p[0])}</b><small>${p[0]}${c.identificador ? ' · ' + esc(c.identificador) : ''}${c.ultimo_evento_at ? ' · último evento ' + dmy(c.ultimo_evento_at) + ' ' + hora(c.ultimo_evento_at) : ''}</small></div>
      <label class="sw"><input type="checkbox" ${c.activo ? 'checked' : ''} onchange="window.nxCRM.bdCanal('${c.id}', this.checked)"><span>${c.activo ? 'Activo' : 'Apagado'}</span></label></div>`; }).join('');
    return `<details class="bdCanales"${BD.canales.some(c => c.activo) ? '' : ' open'}><summary><i class="ti ti-plug-connected"></i> Canales (${BD.canales.filter(c => c.activo).length} activos)</summary>
      ${filas || '<p class="bdNota">Aún no se ha conectado ninguna cuenta. Cuando conectes el WhatsApp, el Facebook y el Instagram de STUDIO en Zernio y llegue el primer mensaje, cada cuenta aparecerá aquí <b>apagada</b> para que la actives.</p>'}
      <p class="bdNota">Un canal apagado no guarda ni envía mensajes. Nada se envía solo: solo cuando alguien pulsa Enviar.</p></details>`;
  }
  function vistaBandeja() {
    if (!BD.cargado) { bdCargar().then(() => { repintar(); bdTimer(); }); return '<div class="nxCrmLoad"><span class="spin"></span> Cargando bandeja…</div>'; }
    bdTimer();
    if (BD.error) return `<div class="nxCrmErr">No se pudo cargar la bandeja: ${esc(BD.error)}</div>`;
    const chip = (k, l) => `<button type="button" class="nxCrmChip${BD.filtro === k ? ' on' : ''}" aria-pressed="${BD.filtro === k}" onclick="window.nxCRM.bdFiltro('${k}')">${l}</button>`;
    const pch = (k, l) => `<button type="button" class="nxCrmChip${BD.canalF === k ? ' on' : ''}" aria-pressed="${BD.canalF === k}" onclick="window.nxCRM.bdCanalF('${k}')">${l}</button>`;
    return bdCanalesHTML() + `<div class="nxCrmBd${BD.sel ? ' sel' : ''}">
      <aside class="bdL"><div class="bdF"><label class="nxCrmQ"><i class="ti ti-search"></i><input type="search" value="${esc(BD.q)}" placeholder="Buscar nombre o teléfono…" oninput="window.nxCRM.bdBuscar(this.value)" aria-label="Buscar conversación"></label>
        <div class="nxCrmChips">${chip('todas', 'Todas')}${chip('noleidas', 'No leídas')}${chip('pendientes', 'Sin responder')}${chip('mias', 'Mías')}${chip('libres', 'Sin asignar')}</div>
        <div class="nxCrmChips">${pch('', 'Todos los canales')}${pch('whatsapp', '<i class="ti ti-brand-whatsapp"></i> WhatsApp')}${pch('instagram', '<i class="ti ti-brand-instagram"></i> Instagram')}${pch('facebook', '<i class="ti ti-brand-messenger"></i> Facebook')}</div></div>
        <div class="bdList" id="bdList">${bdListaHTML()}</div></aside>
      <section class="bdC" id="bdChat">${bdChatHTML()}</section></div>`;
  }
  function bdPintarParcial() {
    const l = document.getElementById('bdList'); if (l) l.innerHTML = bdListaHTML();
    const m = document.getElementById('bdMsgs'); if (m) { const abajo = m.scrollHeight - m.scrollTop - m.clientHeight < 80; m.innerHTML = bdMsgsHTML(); if (abajo) m.scrollTop = m.scrollHeight; }
    bdFirmar();
  }
  function bdAlFondo() { const m = document.getElementById('bdMsgs'); if (m) m.scrollTop = m.scrollHeight; }
  async function bdFirmar() {
    const b = apiBase(); const faltan = BD.msgs.filter(m => m.media_path && !BD.urls[m.media_path]).map(m => m.media_path);
    for (const path of faltan) {
      try {
        const r = await fetch(`${b.url}/storage/v1/object/sign/crm-media/${path.split('/').map(encodeURIComponent).join('/')}`, { method: 'POST', headers: { apikey: b.key, Authorization: 'Bearer ' + b.tok, 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: 3600 }) });
        const j = await r.json(); if (j && (j.signedURL || j.signedUrl)) BD.urls[path] = `${b.url}/storage/v1${j.signedURL || j.signedUrl}`;
      } catch (e) {}
    }
    if (faltan.length) { const m = document.getElementById('bdMsgs'); if (m) { m.innerHTML = bdMsgsHTML(); bdAlFondo(); } }
  }
  function bdTimer() {
    if (BD.timer) return;
    BD.timer = setInterval(async () => {
      if (!document.querySelector('.nxCrmBd') || document.hidden) { if (!document.querySelector('.nxCrmBd')) { clearInterval(BD.timer); BD.timer = null; } return; }
      const antes = BD.sel ? (BD.convs.find(x => String(x.id) === String(BD.sel)) || {}).ultimo_mensaje_at : null;
      await bdCargar();
      if (BD.sel) { const c = BD.convs.find(x => String(x.id) === String(BD.sel)); if (c && c.ultimo_mensaje_at !== antes) { await bdCargarMsgs(BD.sel); if (c.no_leidos > 0) api().patch('crm_conversaciones', 'id=eq.' + c.id, { no_leidos: 0 }).catch(() => {}); } }
      bdPintarParcial();
    }, 10000);
  }
  async function bdAbrir(id) {
    BD.sel = id; BD.msgs = []; repintar();
    await bdCargarMsgs(id);
    const c = BD.convs.find(x => String(x.id) === String(id));
    if (c && c.no_leidos > 0) { c.no_leidos = 0; api().patch('crm_conversaciones', 'id=eq.' + id, { no_leidos: 0 }).catch(() => {}); }
    const ch = document.getElementById('bdChat'); if (ch) ch.innerHTML = bdChatHTML();
    const l = document.getElementById('bdList'); if (l) l.innerHTML = bdListaHTML();
    bdAlFondo(); bdFirmar();
    const t = document.getElementById('bdTx'); if (t && window.innerWidth > 760) t.focus();
  }
  function uuid() { try { return crypto.randomUUID(); } catch (e) { return 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => (Math.random() * 16 | 0).toString(16)); } }
  async function bdEnviarCuerpo(body) {
    const b = apiBase();
    const r = await fetch(`${b.url}/functions/v1/crm-enviar`, { method: 'POST', headers: { apikey: b.key, Authorization: 'Bearer ' + b.tok, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.mensaje || ({ ventana_cerrada: 'Pasaron más de 24 horas: WhatsApp solo permite plantillas', canal_apagado: 'El canal está apagado', sin_configurar: 'Falta configurar Zernio en el servidor', sin_permiso: 'No tienes permiso para esta conversación', zernio_error: 'Zernio rechazó el envío' }[j.error]) || j.error || ('HTTP ' + r.status));
    return j;
  }
  async function bdEnviar() {
    if (BD.enviando) return;
    const t = document.getElementById('bdTx'); const texto = t ? t.value.trim() : '';
    if (!texto || !BD.sel) return;
    BD.enviando = true; const key = uuid();
    const temp = { id: 'tmp-' + key, direccion: 'out', cuerpo: texto, estado: 'pendiente', created_at: new Date().toISOString(), tipo: 'texto' };
    BD.msgs.push(temp); t.value = ''; t.style.height = 'auto'; bdPintarParcial(); bdAlFondo();
    try { await bdEnviarCuerpo({ conversacion_id: BD.sel, texto: texto, idempotency_key: key }); }
    catch (e) { toast('err', 'No se envió', String(e.message || e)); }
    BD.enviando = false;
    await Promise.all([bdCargarMsgs(BD.sel), bdCargar()]); bdPintarParcial(); bdAlFondo();
  }
  async function bdAdjuntar(inp) {
    const f = inp && inp.files && inp.files[0]; if (!f || !BD.sel) return;
    if (f.size > 16 * 1024 * 1024) { toast('warn', 'Archivo muy grande', 'Máximo 16 MB'); inp.value = ''; return; }
    const tipo = /^image\//.test(f.type) ? 'imagen' : /^video\//.test(f.type) ? 'video' : /^audio\//.test(f.type) ? 'audio' : 'documento';
    const ext = (f.name.split('.').pop() || 'bin').replace(/[^a-z0-9]/gi, '').toLowerCase();
    const path = `salientes/${uuid()}.${ext}`; const b = apiBase();
    const t = document.getElementById('bdTx'); const texto = t ? t.value.trim() : '';
    try {
      const up = await fetch(`${b.url}/storage/v1/object/crm-media/${path}`, { method: 'POST', headers: { apikey: b.key, Authorization: 'Bearer ' + b.tok, 'Content-Type': f.type || 'application/octet-stream' }, body: f });
      if (!up.ok) throw new Error('No se pudo subir el archivo');
      await bdEnviarCuerpo({ conversacion_id: BD.sel, texto: texto, adjunto_path: path, adjunto_tipo: tipo, adjunto_nombre: f.name, idempotency_key: uuid() });
      if (t) t.value = '';
    } catch (e) { toast('err', 'No se envió el archivo', String(e.message || e)); }
    inp.value = '';
    await Promise.all([bdCargarMsgs(BD.sel), bdCargar()]); bdPintarParcial(); bdAlFondo();
  }
  async function bdPatch(id, body, ok) {
    try { const r = await api().patch('crm_conversaciones', 'id=eq.' + id, body); const fila = Array.isArray(r) ? r[0] : r; const c = BD.convs.find(x => String(x.id) === String(id)); if (c) Object.assign(c, fila && fila.id ? fila : body); if (ok) toast('ok', ok); repintar(); bdAlFondo(); }
    catch (e) { toast('err', 'No se pudo', errTxt(e)); }
  }

  // ── Estilos ────────────────────────────────────────────────────────
  function ensureCSS() {
    if (document.getElementById('nxCrmCSS')) return;
    const st = document.createElement('style'); st.id = 'nxCrmCSS';
    st.textContent = `
.nxCrm{--c-ink:var(--studio-ink,#111);--c-mute:var(--studio-steel,#5b5951);--c-line:var(--studio-hair,rgba(0,0,0,.1));--c-gold:var(--studio-gold,#c9a227);--c-gold-d:var(--studio-gold-dark,#806515);--c-paper:var(--studio-paper,#fff);max-width:1440px;margin:0 auto;color:var(--c-ink)}
.nxCrm h2,.nxCrm h4{text-transform:none!important;letter-spacing:-.01em;margin:0}
.nxCrmHead{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;margin-bottom:12px}.nxCrmHead h2{font-size:22px;font-weight:700}.nxCrmHead p{margin:2px 0 0;color:var(--c-mute);font-size:13px}
.nxCrmBtn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:38px;padding:0 14px;border-radius:10px;border:1px solid var(--c-line);background:#fff;color:var(--c-ink);font:600 13px/1 inherit;cursor:pointer;white-space:nowrap}
.nxCrmBtn.p{background:var(--c-ink);color:#fff;border-color:var(--c-ink)}.nxCrmBtn.sm{min-height:30px;padding:0 10px;font-size:12px}.nxCrmBtn.del{color:#b91c1c;width:42px;padding:0}
.nxCrmBtn:focus-visible,.nxCrmChip:focus-visible,.nxCrmCard:focus-visible,.nxCrmEt:focus-visible{outline:2px solid var(--c-gold);outline-offset:2px}
.nxCrmKpis{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;margin-bottom:12px}.nxCrmKpis .k{background:var(--c-paper);border:1px solid var(--c-line);border-radius:14px;padding:12px 14px;display:flex;flex-direction:column;gap:3px;min-width:0}
.nxCrmKpis .k span{font-size:11px;font-weight:600;color:var(--c-mute)}.nxCrmKpis .k b{font-size:19px;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.nxCrmKpis .k small{font-size:11px;color:var(--c-mute)}.nxCrmKpis .k.warn b{color:#b91c1c}
.nxCrmTabs{display:flex;gap:4px;border-bottom:1px solid var(--c-line);margin-bottom:12px;overflow-x:auto;scrollbar-width:none}.nxCrmTabs button{display:inline-flex;align-items:center;gap:6px;height:40px;padding:0 14px;border:0;border-bottom:2px solid transparent;background:none;font:600 13px inherit;color:var(--c-mute);cursor:pointer;white-space:nowrap}
.nxCrmTabs button.on{color:var(--c-ink);border-bottom-color:var(--c-gold)}.nxCrmTabs .b{background:var(--c-ink);color:#fff;border-radius:999px;font-size:10.5px;padding:1px 7px}
.nxCrmBar{display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap}.nxCrmChips{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none}
.nxCrmChip{height:32px;padding:0 12px;border-radius:999px;border:1px solid var(--c-line);background:#fff;font:600 12.5px inherit;color:var(--c-ink);cursor:pointer;white-space:nowrap}.nxCrmChip.on{background:var(--c-ink);color:#fff;border-color:var(--c-ink)}
.nxCrmQ{flex:1;min-width:200px;display:flex;align-items:center;gap:8px;height:38px;border:1px solid var(--c-line);border-radius:10px;background:#fff;padding:0 12px}.nxCrmQ input{border:0;outline:0;flex:1;min-width:0;font-size:14px;background:transparent;text-transform:none}.nxCrmQ i{color:var(--c-mute)}
.nxCrmBoard{display:grid;grid-template-columns:repeat(5,minmax(172px,1fr));gap:10px;overflow-x:auto;padding-bottom:6px;scroll-snap-type:x mandatory}
.nxCrmCol{background:rgba(0,0,0,.025);border:1px solid var(--c-line);border-radius:14px;display:flex;flex-direction:column;min-height:220px;scroll-snap-align:start;transition:background .15s}.nxCrmCol.over{background:rgba(201,162,39,.12);border-color:var(--c-gold)}
.nxCrmCol header{display:flex;flex-direction:column;gap:2px;padding:10px 12px;font-size:12.5px;font-weight:700;border-bottom:1px solid var(--c-line)}.nxCrmCol header .n{font-size:11px;background:rgba(0,0,0,.07);border-radius:99px;padding:1px 7px;margin-left:2px}.nxCrmCol header .c{font-weight:600;color:var(--c-mute);font-size:11.5px;font-variant-numeric:tabular-nums}
.nxCrmCol.c-ganado header{color:#15803d}.nxCrmCol.c-perdido header{color:#b91c1c}
.nxCrmCol .lst{display:flex;flex-direction:column;gap:8px;padding:8px;max-height:62vh;overflow-y:auto}.nxCrmCol .vac{font-size:12px;color:var(--c-mute);text-align:center;padding:18px 6px;border:1px dashed var(--c-line);border-radius:10px}
.nxCrmCard{background:#fff;border:1px solid var(--c-line);border-radius:12px;padding:10px 11px;cursor:pointer;display:flex;flex-direction:column;gap:5px;box-shadow:0 1px 2px rgba(0,0,0,.04)}.nxCrmCard:hover{border-color:var(--c-gold)}
.nxCrmCard .t{display:flex;justify-content:space-between;gap:8px;align-items:flex-start}.nxCrmCard .t b{font-size:13px;line-height:1.25;min-width:0;overflow-wrap:anywhere}.nxCrmCard .m{font-size:13px;font-weight:700;white-space:nowrap;font-variant-numeric:tabular-nums}
.nxCrmCard .s{font-size:11.5px;color:var(--c-mute);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.nxCrmCard .s.mot{color:#b91c1c}
.nxCrmCard .tk{font-size:11px;color:var(--c-gold-d);background:rgba(201,162,39,.1);border-radius:7px;padding:3px 7px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.nxCrmCard .tk.venc{color:#b91c1c;background:rgba(185,28,28,.08)}
.nxCrmCard .f{display:flex;align-items:center;gap:6px;margin-top:2px}.nxCrmCard .av{width:24px;height:24px;border-radius:50%;background:var(--c-ink);color:#fff;font-size:10px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;flex:none}
.nxCrmCard .d{font-size:10.5px;color:var(--c-mute);flex:1;white-space:nowrap}.nxCrmCard .d.old{color:#b45309;font-weight:700}
.nxCrmCard .adv{width:28px;height:28px;border-radius:8px;border:1px solid var(--c-line);background:#fff;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;color:var(--c-ink)}.nxCrmCard .adv:hover{background:var(--c-ink);color:#fff}
.nxCrmNote{font-size:11.5px;color:var(--c-mute);margin:8px 2px}
.nxCrmLoad,.nxCrmErr{padding:30px;text-align:center;color:var(--c-mute);font-size:13px}.nxCrmErr{color:#b91c1c}
.nxCrmEmpty{display:flex;flex-direction:column;align-items:center;gap:6px;padding:40px 16px;color:var(--c-mute);text-align:center}.nxCrmEmpty i{font-size:30px}.nxCrmEmpty b{color:var(--c-ink)}
.nxCrmTG{margin-bottom:14px}.nxCrmTG h4{font-size:13px;margin-bottom:6px;display:flex;gap:6px;align-items:center}.nxCrmTG h4.bad{color:#b91c1c}.nxCrmTG h4 span{font-size:11px;color:var(--c-mute);font-weight:600}
.nxCrmTask{display:flex;gap:10px;align-items:center;background:#fff;border:1px solid var(--c-line);border-radius:12px;padding:9px 11px;margin-bottom:6px}.nxCrmTask .tx{flex:1;min-width:0;cursor:pointer;display:flex;flex-direction:column;gap:2px}.nxCrmTask .tx b{font-size:13px}.nxCrmTask .tx small{font-size:11.5px;color:var(--c-mute)}
.nxCrm .chk,.nxCrmFicha .chk{border:0;background:none;font-size:20px;cursor:pointer;color:var(--c-ink,#111);padding:0 4px 0 0;line-height:1;vertical-align:middle}
.nxCrmRange{display:flex;gap:10px;margin-bottom:12px;flex-wrap:wrap}.nxCrmRange label{display:flex;flex-direction:column;gap:4px;font-size:11px;font-weight:600;color:var(--c-mute)}.nxCrmRange input{height:38px;border:1px solid var(--c-line);border-radius:10px;padding:0 10px;font-size:14px;background:#fff}
.nxCrmGrid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.nxCrmPanel{background:var(--c-paper);border:1px solid var(--c-line);border-radius:14px;padding:14px;margin-bottom:10px;min-width:0}.nxCrmPanel h4{font-size:13.5px;margin-bottom:10px}
.nxCrmBarR{display:grid;grid-template-columns:minmax(90px,1fr) 2fr auto;gap:8px;align-items:center;font-size:12px;margin-bottom:7px}.nxCrmBarR div{height:8px;background:rgba(0,0,0,.06);border-radius:99px;overflow:hidden}.nxCrmBarR div i{display:block;height:100%;background:var(--c-gold);border-radius:99px}.nxCrmBarR b{font-variant-numeric:tabular-nums;font-size:11.5px}
.nxCrmT{width:100%;border-collapse:collapse;font-size:12.5px}.nxCrmT th{text-align:left;font-size:10.5px;text-transform:uppercase;letter-spacing:.04em;color:var(--c-mute);padding:6px 8px;border-bottom:1px solid var(--c-line)}.nxCrmT td{padding:7px 8px;border-bottom:1px solid var(--c-line)}.nxCrmT .r{text-align:right;font-variant-numeric:tabular-nums}.nxCrmT .vac,.nxCrmPanel .vac{color:var(--c-mute);text-align:center;font-size:12px}
.nxCrmPanel .tw{overflow-x:auto}
.nxCrmModal{--c-ink:var(--studio-ink,#111);--c-mute:var(--studio-steel,#5b5951);--c-line:var(--studio-hair,rgba(0,0,0,.1));--c-gold:var(--studio-gold,#c9a227);color:var(--c-ink)}
.nxCrmFicha{max-width:720px;width:100%;max-height:92vh;display:flex;flex-direction:column}.nxCrmFicha .mt small{font-size:11px;color:var(--c-mute);font-weight:600}.nxCrmFB{overflow-y:auto;flex:1;display:flex;flex-direction:column;gap:12px;padding-bottom:6px}
.nxCrmEts{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none}.nxCrmEt{flex:1;min-width:max-content;display:inline-flex;align-items:center;justify-content:center;gap:5px;height:36px;padding:0 10px;border:1px solid var(--c-line);border-radius:10px;background:#fff;font:600 12px inherit;color:var(--c-ink);cursor:pointer}
.nxCrmEt.on{background:var(--c-ink);color:#fff;border-color:var(--c-ink)}.nxCrmEt.e-ganado.on{background:#15803d;border-color:#15803d}.nxCrmEt.e-perdido.on{background:#b91c1c;border-color:#b91c1c}
.nxCrmLost{font-size:12.5px;color:#b91c1c;background:rgba(185,28,28,.07);border-radius:10px;padding:8px 10px}
.nxCrmSec{border:1px solid var(--c-line);border-radius:14px;padding:12px;display:flex;flex-direction:column;gap:10px}.nxCrmSec h4{font-size:13px}
.nxCrmSec .g2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.nxCrmF{display:flex;flex-direction:column;gap:4px;min-width:0}.nxCrmF>span{font-size:11px;font-weight:600;color:var(--c-mute)}
.nxCrmF input,.nxCrmF select,.nxCrmF textarea,.nxCrmComp textarea,.nxCrmDocs select,.nxCrmComp .venc input,.nxCrmComp .venc select{width:100%;box-sizing:border-box;min-height:38px;border:1px solid var(--c-line);border-radius:10px;padding:8px 10px;font:14px inherit;background:#fff;color:var(--c-ink);text-transform:none}
.nxCrmF textarea,.nxCrmComp textarea{resize:vertical}
.nxCrmF .tel{display:flex;gap:6px}.nxCrmF .tel .wa{flex:none;width:38px;display:inline-flex;align-items:center;justify-content:center;border-radius:10px;border:1px solid var(--c-line);color:#15803d;font-size:18px;text-decoration:none}
.nxCrmPick{min-height:38px;border:1px solid var(--c-line);border-radius:10px;background:#fff;display:flex;align-items:center;gap:8px;padding:0 10px;font:14px inherit;color:var(--c-ink);cursor:pointer;text-align:left;overflow:hidden}.nxCrmPick span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nxCrmF .asig{min-height:38px;display:flex;align-items:center;gap:8px;font-size:13.5px;flex-wrap:wrap}
.nxCrmChk{display:flex;gap:8px;align-items:center;font-size:12.5px}.nxCrmChk small{color:var(--c-mute)}
.nxCrmSec .acts{display:flex;justify-content:flex-end;gap:8px}
.nxCrmDocs{display:flex;flex-direction:column;gap:8px}.nxCrmDocs .doc{display:flex;align-items:center;gap:10px;font-size:13px}.nxCrmDocs .doc>i{font-size:18px;color:var(--c-mute)}.nxCrmDocs .doc>span{flex:1;min-width:0}.nxCrmDocs .doc select{flex:1}
.nxCrmComp{display:flex;flex-direction:column;gap:8px}.nxCrmComp .tipos{display:flex;gap:6px;flex-wrap:wrap}.nxCrmComp .tipos input{position:absolute;opacity:0;pointer-events:none}
.nxCrmComp .tipos span{display:inline-flex;align-items:center;gap:5px;height:32px;padding:0 12px;border:1px solid var(--c-line);border-radius:999px;font-size:12.5px;font-weight:600;cursor:pointer;background:#fff}.nxCrmComp .tipos input:checked+span{background:var(--c-ink);color:#fff;border-color:var(--c-ink)}.nxCrmComp .tipos input:focus-visible+span{outline:2px solid var(--c-gold)}
.nxCrmComp .venc{display:grid;grid-template-columns:1fr 1fr;gap:8px}.nxCrmComp .venc label{display:flex;flex-direction:column;gap:4px;font-size:11px;font-weight:600;color:var(--c-mute)}.nxCrmComp>.nxCrmBtn{align-self:flex-end}
.nxCrmTL{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px}.nxCrmTL li{display:flex;gap:10px;padding:8px 2px;border-bottom:1px solid var(--c-line)}.nxCrmTL li>i{font-size:16px;color:var(--c-mute);margin-top:2px;flex:none}
.nxCrmTL li p{margin:0;font-size:13px;overflow-wrap:anywhere}.nxCrmTL li small{font-size:11px;color:var(--c-mute)}.nxCrmTL li.a-etapa p,.nxCrmTL li.a-sistema p{font-weight:600}.nxCrmTL li.a-tarea>i{color:var(--c-gold-d,#806515)}.nxCrmTL li.done p{text-decoration:line-through;color:var(--c-mute)}.nxCrmTL li.vac{color:var(--c-mute);font-size:12px}
.nxCrmMotL{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
.nxCrm *,.nxCrmModal *,.nxCrm ::placeholder,.nxCrmModal ::placeholder{text-transform:none!important}.nxCrm .nxCrmT th{text-transform:uppercase!important}
.nxCrmFB>*{flex:none}
.nxCrmKpis[hidden]{display:none}
.nxCrmBd{display:grid;grid-template-columns:minmax(280px,360px) 1fr;border:1px solid var(--c-line);border-radius:16px;background:var(--c-paper);overflow:hidden;height:min(72vh,760px)}
.nxCrmBd .bdL{display:flex;flex-direction:column;border-right:1px solid var(--c-line);min-width:0;min-height:0}
.nxCrmBd .bdF{display:flex;flex-direction:column;gap:8px;padding:10px;border-bottom:1px solid var(--c-line)}.nxCrmBd .bdF>*{flex:none}.nxCrmBd .bdF .nxCrmQ{min-width:0}.nxCrmBd .bdF .nxCrmChip{height:28px;font-size:12px;padding:0 10px}
.nxCrmBd .bdList{overflow-y:auto;flex:1;min-height:0}
.bdIt{display:flex;gap:10px;width:100%;text-align:left;padding:10px 12px;border:0;border-bottom:1px solid var(--c-line);background:none;cursor:pointer;font:inherit;color:var(--c-ink)}.bdIt:hover{background:rgba(0,0,0,.025)}.bdIt.on{background:rgba(201,162,39,.12)}
.bdIt .av,.bdH .av{position:relative;width:40px;height:40px;border-radius:50%;background:var(--c-ink);color:#fff;display:inline-flex;align-items:center;justify-content:center;flex:none;font-size:13px}.bdIt .av i{position:absolute;right:-3px;bottom:-3px;background:#fff;border-radius:50%;font-size:15px;padding:1px}
.bdIt .tx{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}.bdIt .r1,.bdIt .r2{display:flex;justify-content:space-between;align-items:center;gap:6px}.bdIt .r1 b{font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bdIt .r1 small{font-size:11px;color:var(--c-mute);flex:none}
.bdIt .pv{font-size:12.5px;color:var(--c-mute);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bdIt.unread .pv{color:var(--c-ink);font-weight:600}.bdIt .nl{background:#15803d;color:#fff;border-radius:99px;font-size:10.5px;font-weight:700;padding:1px 7px;flex:none}.bdIt .pd{width:8px;height:8px;border-radius:50%;background:var(--c-gold);flex:none}
.bdIt .r3{font-size:10.5px;color:var(--c-mute)}
.bdVac{padding:24px;text-align:center;color:var(--c-mute);font-size:12.5px}
.nxCrmBd .bdC{display:flex;flex-direction:column;min-width:0;min-height:0;background:linear-gradient(0deg,rgba(201,162,39,.04),rgba(201,162,39,.04)),var(--c-paper)}
.bdEmpty{margin:auto;display:flex;flex-direction:column;align-items:center;gap:6px;color:var(--c-mute);text-align:center;padding:30px}.bdEmpty i{font-size:34px}.bdEmpty b{color:var(--c-ink)}
.bdH{display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid var(--c-line);background:var(--c-paper)}.bdH .who{flex:1;min-width:0;display:flex;flex-direction:column}.bdH .who b{font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bdH .who small{font-size:11.5px;color:var(--c-mute);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bdBack{display:none;border:0;background:none;font-size:20px;cursor:pointer;color:var(--c-ink);padding:4px}
.bdTools{display:flex;gap:6px;padding:8px 12px;border-bottom:1px solid var(--c-line);overflow-x:auto;scrollbar-width:none;background:var(--c-paper)}.bdTools .nxCrmChip{height:30px;font-size:12px;display:inline-flex;align-items:center;gap:5px;max-width:260px;overflow:hidden;text-overflow:ellipsis}
.bdAsig{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--c-line);border-radius:999px;padding:0 4px 0 10px;background:#fff;font-size:12px}.bdAsig select{border:0;background:none;font:600 12px inherit;height:28px;max-width:160px}
.bdMsgs{flex:1;min-height:0;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:6px}
.bdDia{align-self:center;font-size:11px;color:var(--c-mute);background:rgba(0,0,0,.05);border-radius:99px;padding:2px 10px;margin:6px 0}
.bdM{max-width:min(78%,520px);padding:8px 10px 5px;border-radius:14px;background:#fff;border:1px solid var(--c-line);align-self:flex-start;display:flex;flex-direction:column;gap:4px}
.bdM.out{align-self:flex-end;background:var(--c-ink);color:#fff;border-color:var(--c-ink)}.bdM.fail{background:#fff5f5;color:var(--c-ink);border-color:#fca5a5}
.bdM p{margin:0;font-size:13.5px;white-space:pre-wrap;overflow-wrap:anywhere}.bdM small{font-size:10.5px;opacity:.7;align-self:flex-end;display:inline-flex;gap:3px;align-items:center}.bdM small .lei{color:#60a5fa;opacity:1}.bdM small .err{color:#b91c1c}.bdM em{font-size:11px;color:#b91c1c;font-style:normal}
.bdM img,.bdM video{max-width:100%;max-height:280px;border-radius:10px;display:block}.bdM audio{max-width:240px}.bdM .doc{color:inherit;font-size:13px}.bdM .ld{font-size:12px;opacity:.7}
.bdComp{display:flex;align-items:flex-end;gap:8px;padding:10px 12px;border-top:1px solid var(--c-line);background:var(--c-paper);padding-bottom:max(10px,env(safe-area-inset-bottom))}
.bdComp textarea{flex:1;min-height:40px;max-height:140px;border:1px solid var(--c-line);border-radius:20px;padding:10px 14px;font:14px/1.35 inherit;resize:none;background:#fff}
.bdClip{width:40px;height:40px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;font-size:19px;color:var(--c-mute);flex:none}.bdClip input{display:none}
.bdSend{width:40px;height:40px;border-radius:50%;border:0;background:var(--c-ink);color:#fff;font-size:17px;cursor:pointer;flex:none}
.bdAviso{padding:12px 14px;border-top:1px solid var(--c-line);font-size:12.5px;color:#92400e;background:#fffbeb}
.bdCanales{border:1px solid var(--c-line);border-radius:14px;padding:10px 12px;margin-bottom:10px;background:var(--c-paper)}.bdCanales summary{cursor:pointer;font-weight:700;font-size:13px;display:flex;align-items:center;gap:6px}
.bdCan{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--c-line)}.bdCan>i{font-size:22px}.bdCan>div{flex:1;min-width:0;display:flex;flex-direction:column}.bdCan b{font-size:13px}.bdCan small{font-size:11px;color:var(--c-mute)}
.bdCan .sw{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;cursor:pointer}.bdNota{font-size:12px;color:var(--c-mute);margin:8px 0 0}
@media(max-width:1100px){.nxCrmKpis{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media(max-width:760px){.nxCrmBd{grid-template-columns:1fr;height:calc(100dvh - 190px);border-radius:14px}.nxCrmBd .bdL{border-right:0}.nxCrmBd.sel .bdL{display:none}.nxCrmBd:not(.sel) .bdC{display:none}.bdBack{display:inline-flex}.bdM{max-width:86%}}
@media(max-width:760px){.nxCrmKpis{grid-template-columns:1fr 1fr;gap:8px}.nxCrmKpis .k{padding:10px 12px}.nxCrmKpis .k b{font-size:17px}.nxCrmBoard{grid-template-columns:repeat(5,82vw)}.nxCrmGrid{grid-template-columns:1fr}.nxCrmSec .g2,.nxCrmComp .venc{grid-template-columns:1fr}.nxCrmHead h2{font-size:20px}.nxCrmHead .nxCrmBtn{padding:0 12px}}
@media(prefers-reduced-motion:reduce){.nxCrmCol{transition:none}}
`;
    document.head.appendChild(st);
  }

  window.nxCRM = {
    bdAbrir, bdEnviar, bdAdjuntar,
    bdCerrar: function () { BD.sel = null; BD.msgs = []; repintar(); },
    bdFiltro: function (k) { BD.filtro = k; repintar(); },
    bdCanalF: function (k) { BD.canalF = k; repintar(); },
    bdBuscar: function (q) { BD.q = q || ''; const l = document.getElementById('bdList'); if (l) l.innerHTML = bdListaHTML(); },
    bdArchivar: function (id) { if (!confirm('¿Archivar esta conversación? Vuelve sola a la bandeja si el cliente escribe de nuevo.')) return; BD.sel = null; bdPatch(id, { archivada: true }, 'Conversación archivada').then(() => { BD.convs = BD.convs.filter(c => String(c.id) !== String(id)); repintar(); }); },
    bdAsignar: function (id, u) { bdPatch(id, { asignado_id: u || null }, u ? 'Conversación asignada' : 'Conversación liberada'); },
    bdCliente: function (id) { try { ctx().elegirCliente(function (c) { if (c && c.id) bdPatch(id, { cliente_id: c.id }, 'Cliente vinculado'); }); } catch (e) {} },
    bdOportunidad: async function (id) {
      const c = BD.convs.find(x => String(x.id) === String(id)); if (!c) return;
      const f = (PLAT[c.plataforma] || PLAT.whatsapp)[0];
      try {
        const b = { nombre: (f + ' · ' + bdNombre(c)).slice(0, 120), cliente_id: c.cliente_id || null, contacto: c.contacto_nombre || null, telefono: c.telefono_e164 || null, fuente: f, etapa: 'nuevo', asignado_id: c.asignado_id || (esAdmin() ? null : yo()) };
        try { if (ctx().nextSeq) b.numero = await ctx().nextSeq('crm'); } catch (e) {}
        const r = await api().post('pos_crm', b); const op = Array.isArray(r) ? r[0] : r;
        if (op && op.id) { await bdPatch(id, { crm_id: op.id }, 'Oportunidad creada'); await cargar(); repintar(); }
      } catch (e) { toast('err', 'No se pudo crear la oportunidad', errTxt(e)); }
    },
    bdCanal: async function (id, on) { try { await api().patch('crm_canales', 'id=eq.' + id, { activo: !!on }); toast('ok', on ? 'Canal activado' : 'Canal apagado'); await bdCargar(); repintar(); } catch (e) { toast('err', 'No se pudo', errTxt(e)); } },
    cargar, render, recargar, avisosHTML, docGuardado, ventaCreada, abrir, nueva, guardar, guardarCampo, agregarAct, tareaHecha, consentimiento, cotizar, facturar,
    mover: function (id, etapa) { mover(id, etapa); },
    motivo: function (id, m) { m = String(m || '').trim(); if (!m) { toast('warn', 'Escribe o elige el motivo'); return; } cerrar('nxCrmMot'); mover(id, 'perdido', m); },
    vista: function (k) { S.vista = k; try { localStorage.setItem('studio_crm_vista', k); } catch (e) {} repintar(); },
    filtro: function (k) { S.filtro = k; repintar(); },
    buscar: function (q) { S.q = q || ''; const b = document.querySelector('.nxCrmBoard'); if (!b) { repintar(); return; } const tmp = document.createElement('div'); tmp.innerHTML = vistaTablero(); const nb = tmp.querySelector('.nxCrmBoard'); if (nb) b.replaceWith(nb); },
    rango: function (k, v) { if (!v) return; if (k === 'd') S.repDesde = v; else S.repHasta = v; if (S.repDesde > S.repHasta) { const x = S.repDesde; S.repDesde = S.repHasta; S.repHasta = x; } repintar(); },
    drag: function (ev, id) { try { ev.dataTransfer.setData('text/plain', String(id)); ev.dataTransfer.effectAllowed = 'move'; } catch (e) {} },
    drop: function (ev, etapa) { ev.preventDefault(); let id = ''; try { id = ev.dataTransfer.getData('text/plain'); } catch (e) {} if (id) mover(id, etapa); },
    etNueva: function (e) { if (e === 'perdido' || e === 'ganado') { toast('warn', 'Primero crea la oportunidad'); return; } _etNueva = e; document.querySelectorAll('#nxCrmFicha .nxCrmEt').forEach(b => { const on = b.className.indexOf('e-' + e) >= 0; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }); },
    cerrarFicha: function () { cerrar('nxCrmFicha'); S.ficha = null; _etNueva = 'nuevo'; },
    elegirCliente: function () {
      try {
        ctx().elegirCliente(function (c) {
          if (!c || !c.id) return;
          const h = document.getElementById('ocCli'), t = document.getElementById('ocCliTx'); if (h) h.value = c.id; if (t) t.textContent = c.nombre || '';
          const tel = document.getElementById('ocTel'); if (tel && !tel.value && c.telefono) tel.value = c.telefono;
          const co = document.getElementById('ocCont'); if (co && !co.value && c.contacto) co.value = c.contacto;
          const nm = document.getElementById('ocNom'); if (nm && !nm.value) nm.value = c.nombre || '';
        });
      } catch (e) { toast('err', 'No se pudo abrir el buscador de clientes'); }
    },
    tomar: function (id) { guardarCampo(id, 'asignado_id', yo()); },
    soltar: function (id) { guardarCampo(id, 'asignado_id', null); },
    waAbierto: function (id) { api().post('pos_crm_actividades', { crm_id: id, tipo: 'whatsapp', texto: 'Se abrió WhatsApp para contactar al cliente' }).then(() => cargarActs(id)).then(() => { if (String(S.ficha) === String(id)) pintarFicha(); }).catch(() => {}); },
    borrar: async function (id) {
      const o = S.ops.find(x => String(x.id) === String(id)); if (!o) return;
      if (!confirm('¿Eliminar la oportunidad «' + o.nombre + '» y toda su actividad? Esto no se puede deshacer.')) return;
      try { await api().del('pos_crm', 'id=eq.' + id); toast('ok', 'Oportunidad eliminada'); window.nxCRM.cerrarFicha(); await cargar(); repintar(); } catch (e) { toast('err', 'No se pudo eliminar', errTxt(e)); }
    }
  };
})();
