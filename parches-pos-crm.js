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

  const ET = [['nuevo', 'Nuevo', 'ti-sparkles'], ['contactado', 'Contactado', 'ti-message-circle'], ['cotizado', 'Cotizado', 'ti-file-dollar'], ['ganado', 'Vendido', 'ti-trophy'], ['perdido', 'Perdido', 'ti-circle-x']];
  const etN = e => (ET.find(x => x[0] === e) || ET[0])[1];
  const ABIERTAS = ['nuevo', 'contactado', 'cotizado'];
  const abierta = o => ABIERTAS.indexOf(o.etapa) >= 0;
  const FUENTES = ['Tienda', 'WhatsApp', 'Instagram', 'Facebook', 'Referido', 'Llamada', 'Web', 'Otro'];
  const MOTIVOS = ['Precio alto', 'Compró en otro lugar', 'Crédito no aprobado', 'No respondió', 'Ya no le interesa', 'Sin existencia', 'Otro'];
  const ACT = { nota: ['Nota', 'ti-note'], llamada: ['Llamada', 'ti-phone'], whatsapp: ['WhatsApp', 'ti-brand-whatsapp'], visita: ['Visita', 'ti-building-store'], tarea: ['Tarea', 'ti-checkbox'], etapa: ['Etapa', 'ti-arrows-right'], sistema: ['Asignación', 'ti-user-check'] };

  // Colores de etapa iguales a los de Bayol Cell (LEADS_ETAPA_INFO); «ganado» se muestra como «Vendido».
  const ETC = { nuevo: ['#1d4ed8', '#dbeafe'], contactado: ['#a16207', '#fef9c3'], cotizado: ['#7c3aed', '#ede9fe'], ganado: ['#15803d', '#dcfce7'], perdido: ['#b91c1c', '#fee2e2'] };
  const S = { ops: [], tareas: [], usuarios: [], vista: 'mensajes', leadsF: 'todos', cargado: false, error: '', ficha: null, acts: [], docs: {}, reps: [], pendiente: null, avisosCargando: false };
  try { const v = localStorage.getItem('studio_crm_vista'); if (['mensajes', 'leads', 'campanas', 'redes'].indexOf(v) >= 0) S.vista = v; } catch (e) {}

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

  // ── Pantalla igual a la del CRM de BAYOL CELL (pedido del dueño: «Yo quiero el CRM que tengo en bayol cell taller»):
  // selector de línea, pestañas Mensajes · Leads · Campañas · Redes, Buscar + Filtros, chips Todos/No leídos/Pendientes.
  function render() {
    ensureCSS();
    if (!S.cargado && !S.error) { cargar().then(repintar); }
    if (!BD.cargado) { bdCargar().then(() => { repintar(); bdTimer(); }); }
    const leadsAb = S.ops.filter(abierta).length;
    const tab = (k, l, ic, extra) => `<button class="crm-tab-seg${S.vista === k ? ' on pill-hundido' : ''}" onclick="window.nxCRM.tab('${k}')"><i class="ti ${ic}"${k === 'campanas' ? ' style="color:#e31e24"' : ''}></i> ${l}${extra || ''}</button>`;
    const lineas = BD.canales.filter(c => c.plataforma === 'whatsapp');
    const lin = lineas.find(c => String(c.id) === String(BD.linea));
    const selector = `<div class="crm-selectores"><div class="crm-selector">
        <button type="button" class="crm-pill-select pill-elevado" onclick="window.nxCRM.lineaMenu(event)"><i class="ti ti-brand-whatsapp"></i><span class="txt"><b>Línea</b>${lin ? esc(lin.nombre || lin.identificador || 'WhatsApp') : lineas.length ? 'Todas las líneas' : 'Sin línea conectada'}</span><i class="ti ti-chevron-down chev"></i></button>
        <div class="crm-selector-menu" id="crmLineaMenu">${[['', 'Todas las líneas']].concat(lineas.map(c => [c.id, (c.nombre || c.identificador || 'WhatsApp') + (c.activo ? '' : ' (apagada)')])).map(o => `<button type="button" class="crm-selector-option${String(BD.linea || '') === String(o[0]) ? ' activa' : ''}" onclick="window.nxCRM.linea('${o[0]}')">${esc(o[1])}<i class="ti ti-check"></i></button>`).join('')}</div>
      </div></div>`;
    let body;
    if (S.vista === 'leads') body = vistaLeads();
    else if (S.vista === 'campanas') body = vistaCampanas();
    else if (S.vista === 'redes') body = vistaRedes();
    else body = vistaMensajes('whatsapp');
    return `<div class="nxCrm crmB${BD.sel && (S.vista === 'mensajes' || S.vista === 'redes') ? ' chat-abierto' : ''}">
      <div class="crm-ocultar-en-chat">${S.vista === 'mensajes' ? selector : ''}
      <div class="crm-tabs-row"><div class="crm-tabs-track pill-elevado">
        ${tab('mensajes', 'Mensajes', 'ti-brand-whatsapp')}${tab('leads', 'Leads', 'ti-user-plus', leadsAb ? `<span class="crm-badge">${leadsAb}</span>` : '')}${tab('campanas', 'Campañas', 'ti-speakerphone')}${tab('redes', 'Redes', 'ti-share')}
      </div>
      <div class="crm-acciones-rapidas">${esAdmin() ? `<button class="crm-icon-btn pill-elevado" onclick="window.nxCRM.canalesModal()" title="Canales conectados" aria-label="Canales conectados"><i class="ti ti-plug-connected"></i></button>` : ''}<button class="crm-icon-btn pill-elevado" onclick="window.nxCRM.actualizar(this)" title="Actualizar" aria-label="Actualizar"><i class="ti ti-refresh"></i></button></div></div></div>
      ${body}
    </div>`;
  }

  function vistaLeads() {
    if (S.error) return `<div class="crm-vacio">No se pudieron cargar los leads: ${esc(S.error)}</div>`;
    if (!S.cargado) return '<div class="crm-vacio">Cargando leads…</div>';
    const opciones = [['todos', 'Todos']].concat(ET.map(e => [e[0], e[1]]));
    const filtros = opciones.map(o => `<button class="crm-lead-f${S.leadsF === o[0] ? ' on' : ''}" onclick="window.nxCRM.leadsFiltro('${o[0]}')">${esc(o[1])}</button>`).join('');
    let l = S.ops.slice();
    if (S.leadsF !== 'todos') l = l.filter(o => o.etapa === S.leadsF);
    const me = yo(), admin = esAdmin();
    const usrOpts = sel => `<option value="">Sin asignar</option>` + S.usuarios.map(u => `<option value="${u.id}"${String(sel || '') === String(u.id) ? ' selected' : ''}>${esc(u.nom)}</option>`).join('');
    const cards = l.map(o => {
      const c = ETC[o.etapa] || ETC.nuevo, cli = cliDe(o.cliente_id), tel = o.telefono || (cli && cli.telefono) || '', wa = waNum(tel);
      const asig = admin ? `<span class="crm-asig"><i class="ti ti-user-check"></i><select onchange="window.nxCRM.guardarCampo('${o.id}','asignado_id',this.value||null)">${usrOpts(o.asignado_id)}</select></span>`
        : o.asignado_id ? `<span class="crm-asig"><i class="ti ti-user-check"></i> ${esc(o.asignado_nombre || '')}${String(o.asignado_id) === String(me) ? ` <button class="btn-mini" onclick="window.nxCRM.soltar('${o.id}')">Soltar</button>` : ''}</span>`
        : `<button class="btn-mini" onclick="window.nxCRM.tomar('${o.id}')"><i class="ti ti-hand-grab"></i> Tomar</button>`;
      return `<div class="crm-lead card">
        <div class="t"><div class="d"><div class="n">${esc(o.nombre || o.contacto || tel || 'Sin nombre')}</div>
          ${tel || o.interes ? `<div class="s">${tel ? `<i class="ti ti-phone"></i> ${esc(tel)}` : ''}${tel && o.interes ? ' · ' : ''}${o.interes ? esc(o.interes) : ''}</div>` : ''}
          ${n(o.monto_estimado) ? `<div class="s"><b>Cotizado:</b> ${fmt(o.monto_estimado)}</div>` : ''}</div>
          <span class="et" style="background:${c[1]};color:${c[0]}">${etN(o.etapa)}</span></div>
        <div class="a"><select onchange="window.nxCRM.leadEtapa('${o.id}', this)">${ET.map(e => `<option value="${e[0]}"${o.etapa === e[0] ? ' selected' : ''}>${e[1]}</option>`).join('')}</select>
          ${cli ? `<span class="vinc"><i class="ti ti-user-check"></i> Vinculado a cliente</span>` : `<button class="btn-mini" onclick="window.nxCRM.leadCliente('${o.id}')"><i class="ti ti-user-plus"></i> Vincular cliente</button>`}
          ${asig}
          ${wa ? `<a class="btn-mini wa" href="https://wa.me/${wa}" target="_blank" rel="noopener" onclick="window.nxCRM.waAbierto('${o.id}')"><i class="ti ti-brand-whatsapp"></i></a>` : ''}
          <button class="btn-mini" onclick="window.nxCRM.abrir('${o.id}')"><i class="ti ti-pencil"></i> Editar</button></div>
        ${o.etapa === 'perdido' && o.motivo_perdida ? `<div class="nota" style="color:#b91c1c"><i class="ti ti-circle-x"></i> ${esc(o.motivo_perdida)}</div>` : ''}
        ${o.notas ? `<div class="nota"><i class="ti ti-note"></i> ${esc(o.notas)}</div>` : ''}
      </div>`;
    }).join('') || '<div class="card crm-vacio">No hay leads en esta vista.</div>';
    return `<div class="crm-leads-top"><div class="crm-leads-f">${filtros}</div><button class="crm-nuevo" onclick="window.nxCRM.nueva()"><i class="ti ti-plus"></i> Nuevo lead</button></div><div>${cards}</div>`;
  }

  function vistaCampanas() {
    return `<div class="card crm-campanas"><i class="ti ti-speakerphone"></i><h3>Campañas</h3>
      <p>Aquí se crean los envíos masivos con plantillas aprobadas por Meta, solo a clientes que dieron su permiso.</p>
      <p>Se activa cuando el WhatsApp de STUDIO esté conectado. Ninguna campaña sale sin tu autorización.</p></div>`;
  }

  function vistaRedes() {
    const pch = (k, l, ic, col) => `<button class="rs-canal${BD.red === k ? ' on' : ''}" onclick="window.nxCRM.red('${k}')"><i class="ti ${ic}" style="color:${col}"></i> ${l}</button>`;
    return `<div class="rs-hub crm-ocultar-en-chat"><div class="rs-hub-head"><div class="rs-hub-title"><div class="rs-hub-icon"><i class="ti ti-affiliate"></i></div><div><h3>Redes Sociales</h3><p>Gestiona tus mensajes desde un solo lugar</p></div></div>
        <div class="rs-hub-buscar"><i class="ti ti-search"></i><input type="text" value="${esc(BD.q)}" placeholder="Buscar conversaciones..." oninput="window.nxCRM.bdBuscar(this.value)"></div></div>
      <div class="rs-canales">${pch('instagram', 'Instagram', 'ti-brand-instagram', '#c13584')}${pch('facebook', 'Facebook', 'ti-brand-messenger', '#1877f2')}</div></div>
      ${bdShellHTML()}`;
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
  const BD = { convs: [], canales: [], sel: null, msgs: [], filtro: 'todos', asig: 'todas', linea: '', red: 'instagram', buscando: false, q: '', urls: {}, timer: null, cargado: false, enviando: false, error: '' };
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
      if (S.vista === 'redes') { if (c.plataforma !== BD.red) return false; }
      else { if (c.plataforma !== 'whatsapp') return false; if (BD.linea && String(c.canal_id) !== String(BD.linea)) return false; }
      if (BD.filtro === 'no_leidos' && !(c.no_leidos > 0)) return false;
      if (BD.filtro === 'pendientes' && !bdPendiente(c)) return false;
      if (BD.asig === 'mias' && String(c.asignado_id || '') !== String(me || '')) return false;
      if (BD.asig === 'sin_asignar' && c.asignado_id) return false;
      if (q && [bdNombre(c), c.telefono_e164, c.contacto_usuario, c.ultimo_mensaje_preview].join(' ').toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }
  function bdHoraRel(iso) {
    if (!iso) return ''; const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (m < 1) return 'ahora'; if (m < 60) return m + ' min'; const h = Math.round(m / 60); if (h < 24) return h + ' h'; const d = Math.round(h / 24); if (d < 7) return d + ' d';
    return dmy(iso).slice(0, 5);
  }
  function bdListaHTML() {
    const base = BD.convs.filter(c => S.vista === 'redes' ? c.plataforma === BD.red : c.plataforma === 'whatsapp');
    if (!base.length) return `<div class="crm-vacio">${S.vista === 'redes' ? 'Todavía no han llegado mensajes de ' + (BD.red === 'instagram' ? 'Instagram' : 'Facebook') + '.' : 'Todavía no han llegado mensajes de WhatsApp.'}</div>`;
    const l = bdLista();
    if (!l.length) return '<div class="crm-vacio">Ninguna conversación coincide con lo que buscas.</div>';
    return l.map(c => { const p = PLAT[c.plataforma] || PLAT.whatsapp, nl = c.no_leidos > 0, pend = bdPendiente(c);
      return `<div class="wa-row${String(BD.sel) === String(c.id) ? ' active' : ''}${nl ? ' no-leido' : ''}${pend ? ' pendiente' : ''}" onclick="window.nxCRM.bdAbrir('${c.id}')">
        <div class="wa-avatar-wrap"><div class="wa-avatar">${esc(ini(bdNombre(c)))}</div><span class="wa-wa-badge p-${c.plataforma}"><i class="ti ${p[1]}"></i></span></div>
        <div style="min-width:0;flex:1"><div class="r1"><span class="fila-nombre">${esc(bdNombre(c))}</span><span class="fila-hora">${bdHoraRel(c.ultimo_mensaje_at)}</span></div>
          <div class="r2"><span class="fila-preview">${esc(c.ultimo_mensaje_preview || '')}</span><span class="r2b">${pend ? '<span class="fila-pendiente"><i class="ti ti-user-exclamation"></i> Atender</span>' : ''}${nl ? `<span class="fila-badge">${c.no_leidos}</span>` : ''}${c.asignado_nombre ? `<span class="fila-asignado">${esc(c.asignado_nombre)}</span>` : ''}</span></div></div>
      </div>`; }).join('');
  }
  function bdIcono(e) { return ({ pendiente: '<i class="ti ti-clock"></i>', enviado: '<i class="ti ti-check"></i>', entregado: '<i class="ti ti-checks"></i>', leido: '<i class="ti ti-checks" style="color:#53bdeb"></i>', fallido: '<i class="ti ti-alert-circle" style="color:#dc2626"></i>' })[e] || ''; }
  function bdBurbuja(m, nombre) {
    const out = m.direccion === 'out', u = m.media_path ? BD.urls[m.media_path] : null;
    const media = m.media_path ? (u ? (m.tipo === 'imagen' ? `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="Imagen"></a>` : m.tipo === 'audio' ? `<audio controls src="${esc(u)}"></audio>` : m.tipo === 'video' ? `<video controls src="${esc(u)}"></video>` : `<a href="${esc(u)}" target="_blank" rel="noopener"><i class="ti ti-file"></i> Abrir archivo</a>`) : `<div class="ld"><i class="ti ti-paperclip"></i> ${esc(m.tipo)}…</div>`) : '';
    return `<div class="wa-brow ${out ? 'out' : 'in'}"><div class="wa-bubble-wrap" style="background:${m.estado === 'fallido' ? '#fee2e2' : out ? '#dcf8c6' : '#fff'}">
      <div class="who" style="color:${out ? '#166534' : '#128C7E'}">${out ? 'Tú (STUDIO)' + (m.enviado_por_nombre ? ' · ' + esc(m.enviado_por_nombre) : m.desde_telefono ? ' · desde el teléfono' : '') : esc(nombre)}</div>
      ${media}${m.cuerpo ? `<div class="tx">${esc(m.cuerpo)}</div>` : ''}
      <div class="wa-tick-line">${hora(m.created_at)} ${out ? bdIcono(m.estado) : ''}</div>
      ${m.estado === 'fallido' ? `<div class="err">No se envió.${m.error ? ' ' + esc(String(m.error).slice(0, 120)) : ''}</div>` : ''}</div></div>`;
  }
  function bdMsgsHTML() {
    const c = BD.convs.find(x => String(x.id) === String(BD.sel));
    if (!BD.msgs.length) return '<div class="wa-chat-empty">Cargando mensajes…</div>';
    let dia = ''; const nom = c ? bdNombre(c) : '';
    return BD.msgs.map(m => { const d = diaRD(m.created_at); const sep = d !== dia ? `<div class="wa-dia">${d === hoyISO() ? 'Hoy' : dmy(m.created_at)}</div>` : ''; dia = d; return sep + bdBurbuja(m, nom); }).join('');
  }
  function bdChatHTML() {
    const c = BD.convs.find(x => String(x.id) === String(BD.sel));
    if (!c) return '<div class="wa-chat-empty">Selecciona una conversación de la lista.</div>';
    const cli = cliDe(c.cliente_id), op = c.crm_id ? S.ops.find(o => String(o.id) === String(c.crm_id)) : null;
    const canal = BD.canales.find(x => String(x.id) === String(c.canal_id)), me = yo(), nom = bdNombre(c);
    const usrOpts = `<option value="">Sin asignar</option>` + S.usuarios.map(u => `<option value="${u.id}"${String(c.asignado_id || '') === String(u.id) ? ' selected' : ''}>${esc(u.nom)}</option>`).join('');
    const asig = esAdmin() ? `<span class="crm-asig"><i class="ti ti-user-check"></i><select onchange="window.nxCRM.bdAsignar('${c.id}', this.value || null)">${usrOpts}</select></span>`
      : !c.asignado_id ? `<button class="btn-mini" onclick="window.nxCRM.bdAsignar('${c.id}','${me}')"><i class="ti ti-hand-grab"></i> Atender yo</button>`
      : `<span class="crm-asig"><i class="ti ti-user-check"></i> ${esc(c.asignado_nombre || '')}${String(c.asignado_id) === String(me) ? ` <button class="btn-mini" onclick="window.nxCRM.bdAsignar('${c.id}', null)">Soltar</button>` : ''}</span>`;
    const sub = c.plataforma === 'whatsapp' ? `<i class="ti ti-phone"></i> ${esc(c.telefono_e164 || (String(c.contacto_id).startsWith('bsid:') ? 'Contacto desde anuncio' : ''))}` : `<i class="ti ${(PLAT[c.plataforma] || PLAT.whatsapp)[1]}"></i> ${c.contacto_usuario ? '@' + esc(c.contacto_usuario) : (PLAT[c.plataforma] || PLAT.whatsapp)[0]}`;
    const tel = c.telefono_e164 && !String(c.contacto_id).startsWith('bsid:') ? c.telefono_e164 : '';
    const puede = canal && canal.activo, abierta = bdVentana(c);
    return `<div class="wa-chat-head"><button class="wa-back" onclick="window.nxCRM.bdCerrar()" aria-label="Volver a la lista"><i class="ti ti-arrow-left"></i></button>
        <div class="wa-avatar">${esc(ini(nom))}</div>
        <div style="flex:1;min-width:0"><div class="hn">${esc(nom)}</div><div class="hs">${sub}</div></div>
        ${tel ? `<a href="tel:${esc(tel)}" class="wa-icon-btn" title="Llamar"><i class="ti ti-phone-call"></i></a>` : ''}
        ${cli ? '<span class="vinc-chip"><i class="ti ti-user-check"></i> Cliente vinculado</span>' : `<button class="wa-vinc" onclick="window.nxCRM.bdCliente('${c.id}')"><i class="ti ti-user-plus"></i> Vincular</button>`}
        <button class="wa-icon-btn" onclick="window.nxCRM.bdArchivar('${c.id}')" title="Archivar" aria-label="Archivar"><i class="ti ti-archive"></i></button></div>
      <div class="wa-chat-sub">${asig}${op ? `<button class="btn-mini" onclick="window.nxCRM.abrir('${op.id}')"><i class="ti ti-user-plus"></i> Lead: ${etN(op.etapa)}</button>` : `<button class="btn-mini" onclick="window.nxCRM.bdOportunidad('${c.id}')"><i class="ti ti-plus"></i> Crear lead</button>`}</div>
      <div id="bdMsgs" class="wa-msgs">${bdMsgsHTML()}</div>
      ${!puede ? '<div class="wa-aviso">Este canal está apagado. El administrador lo activa en <i class="ti ti-plug-connected"></i> Canales.</div>'
        : abierta ? `<div class="wa-input-bar"><label class="wa-clip" title="Adjuntar" aria-label="Adjuntar"><i class="ti ti-paperclip"></i><input type="file" id="bdFile" accept="image/*,video/*,audio/*,application/pdf" onchange="window.nxCRM.bdAdjuntar(this)"></label>
          <textarea id="bdTx" rows="1" placeholder="Escribe un mensaje" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();window.nxCRM.bdEnviar()}" oninput="this.style.height='auto';this.style.height=Math.min(this.scrollHeight,120)+'px'"></textarea>
          <button class="wa-send-btn" onclick="window.nxCRM.bdEnviar()" aria-label="Enviar"><i class="ti ti-send"></i></button></div>`
        : '<div class="wa-aviso"><i class="ti ti-clock-off"></i> Pasaron más de 24 horas desde el último mensaje del cliente. WhatsApp solo permite plantillas aprobadas.</div>'}`;
  }
  function bdShellHTML() {
    return `<div class="wa-shell${BD.sel ? ' con-chat' : ''}"><div class="wa-list-col"><div class="wa-list-scroll" id="bdList">${bdListaHTML()}</div></div><div class="wa-chat-col" id="bdChat">${bdChatHTML()}</div></div>`;
  }
  function vistaMensajes() {
    if (BD.error) return `<div class="crm-vacio">No se pudieron cargar los mensajes: ${esc(BD.error)}</div>`;
    if (!BD.cargado) return '<div class="crm-vacio">Cargando mensajes…</div>';
    bdTimer();
    const base = BD.convs.filter(c => c.plataforma === 'whatsapp' && (!BD.linea || String(c.canal_id) === String(BD.linea)));
    const def = [['todos', 'Todos', base.length], ['no_leidos', 'No leídos', base.filter(c => c.no_leidos > 0).length], ['pendientes', 'Pendientes', base.filter(bdPendiente).length]];
    const chips = def.map(d => `<button class="crm-chip pill-elevado${BD.filtro === d[0] ? ' on pill-hundido' : ''}" onclick="window.nxCRM.bdFiltro('${d[0]}')">${d[1]}${d[2] ? ` <span class="cuenta">${d[2]}</span>` : ''}</button>`).join('');
    return `<div class="crm-ocultar-en-chat"><div class="crm-busq-row">
        ${BD.buscando || BD.q ? `<input type="text" id="crmBuscarInput" class="crm-buscar-input" value="${esc(BD.q)}" placeholder="Buscar nombre o número..." oninput="window.nxCRM.bdBuscar(this.value)" onblur="window.nxCRM.bdBuscarBlur()">` : `<button class="crm-buscar pill-elevado" onclick="window.nxCRM.bdBuscarAbrir()"><i class="ti ti-search"></i> <span>Buscar</span></button>`}
        <button class="crm-filtros-btn pill-elevado${BD.asig !== 'todas' ? ' activo' : ''}" onclick="window.nxCRM.filtrosMenu(event)"><i class="ti ti-adjustments-horizontal"></i> <span>Filtros</span></button></div>
      <div class="crm-chips-row">${chips}</div></div>
      ${bdShellHTML()}`;
  }
  function canalesModal() {
    cerrar('crmCanalesM');
    const ov = document.createElement('div'); ov.id = 'crmCanalesM'; ov.className = 'overlay open';
    ov.addEventListener('click', ev => { if (ev.target === ov) ov.remove(); });
    const filas = BD.canales.map(c => { const p = PLAT[c.plataforma] || PLAT.whatsapp; return `<div class="crm-can"><i class="ti ${p[1]}" style="color:${p[2]}"></i><div><b>${esc(c.nombre || p[0])}</b><small>${p[0]}${c.identificador ? ' · ' + esc(c.identificador) : ''}${c.ultimo_evento_at ? ' · último mensaje ' + dmy(c.ultimo_evento_at) + ' ' + hora(c.ultimo_evento_at) : ''}</small></div>
      <label class="crm-sw"><input type="checkbox" ${c.activo ? 'checked' : ''} onchange="window.nxCRM.bdCanal('${c.id}', this.checked)"><span>${c.activo ? 'Activo' : 'Apagado'}</span></label></div>`; }).join('');
    ov.innerHTML = `<div class="modal nxCrmModal" style="max-width:460px"><div class="mt"><span><i class="ti ti-plug-connected"></i> Canales de STUDIO</span><button class="nxBack" type="button" onclick="document.getElementById('crmCanalesM').remove()"><i class="ti ti-arrow-left"></i> Cerrar</button></div>
      ${filas || '<p class="crm-nota">Aún no hay ninguna cuenta conectada. Cuando conectes el WhatsApp, el Facebook y el Instagram de STUDIO en Zernio y llegue el primer mensaje, cada cuenta aparece aquí <b>apagada</b> para que la actives.</p>'}
      <p class="crm-nota">Un canal apagado no guarda ni envía mensajes. Nada se envía solo: solo cuando alguien pulsa Enviar.</p></div>`;
    document.body.appendChild(ov);
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
      if (!document.querySelector('.crmB .wa-shell') || document.hidden) { if (!document.querySelector('.crmB .wa-shell')) { clearInterval(BD.timer); BD.timer = null; } return; }
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
.nxCrmBtn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:38px;padding:0 14px;border-radius:10px;border:1px solid var(--c-line);background:#fff;color:var(--c-ink);font:600 13px/1 inherit;cursor:pointer;white-space:nowrap}
.nxCrmBtn.p{background:var(--c-ink);color:#fff;border-color:var(--c-ink)}.nxCrmBtn.sm{min-height:30px;padding:0 10px;font-size:12px}.nxCrmBtn.del{color:#b91c1c;width:42px;padding:0}
.nxCrmBtn:focus-visible,.nxCrmChip:focus-visible,.nxCrmCard:focus-visible,.nxCrmEt:focus-visible{outline:2px solid var(--c-gold);outline-offset:2px}
.nxCrmChip{height:32px;padding:0 12px;border-radius:999px;border:1px solid var(--c-line);background:#fff;font:600 12.5px inherit;color:var(--c-ink);cursor:pointer;white-space:nowrap}.nxCrmChip.on{background:var(--c-ink);color:#fff;border-color:var(--c-ink)}
.nxCrm .chk,.nxCrmFicha .chk{border:0;background:none;font-size:20px;cursor:pointer;color:var(--c-ink,#111);padding:0 4px 0 0;line-height:1;vertical-align:middle}
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
.nxCrmFicha .nxCrmChip.on,.nxCrmMotL .nxCrmChip:hover{background:#111;color:#fff}
/* ── CRM al estilo BAYOL CELL (mismas clases y valores de taller.html) ── */
.crmB{color:#0f172a;max-width:1400px;margin:0 auto}
.crmB .pill-elevado{background:linear-gradient(145deg,rgba(255,255,255,.76),rgba(226,232,240,.54)),rgba(241,245,249,.58);border:1px solid rgba(255,255,255,.78);border-radius:9999px;cursor:pointer;box-shadow:inset 0 1px 0 rgba(255,255,255,.96),inset 0 -1px 0 rgba(148,163,184,.16),0 4px 12px -7px rgba(15,23,42,.24),0 12px 28px -18px rgba(15,23,42,.30);outline:none;-webkit-tap-highlight-color:transparent;transition:box-shadow .24s cubic-bezier(.2,.8,.2,1),color .2s ease,transform .2s cubic-bezier(.2,.8,.2,1)}
.crmB .pill-elevado:active{transform:translateY(1px)}
.crmB .pill-hundido{background:linear-gradient(145deg,rgba(255,255,255,.68),rgba(254,226,226,.42)),rgba(248,250,252,.58);border-color:rgba(255,255,255,.82);box-shadow:inset 0 2px 7px rgba(15,23,42,.14),inset 0 -1px 0 rgba(255,255,255,.78),0 0 0 1px rgba(220,38,38,.07),0 7px 20px -15px rgba(220,38,38,.40);border-radius:9999px}
.crmB .crm-selectores{display:flex;gap:10px;margin-bottom:12px}.crmB .crm-selector{flex:1;position:relative;min-width:0;max-width:420px}
.crmB .crm-pill-select{width:100%;display:flex;align-items:center;gap:8px;padding:11px 15px;font:inherit;font-size:13.5px;font-weight:700;color:#1e293b;border:0;text-align:left}
.crmB .crm-pill-select>i{color:#dc2626;font-size:18px;flex-shrink:0}.crmB .crm-pill-select .txt{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1.25}
.crmB .crm-pill-select .txt b{display:block;font-size:9.5px;font-weight:700;color:#475569;text-transform:uppercase!important;letter-spacing:.4px}
.crmB .crm-pill-select .chev{color:#94a3b8;font-size:14px;transition:transform .18s}.crmB .crm-pill-select.abierto .chev{transform:rotate(180deg);color:#dc2626}
.crmB .crm-selector-menu{display:none;position:absolute;z-index:1000;top:calc(100% + 7px);left:0;width:100%;min-width:180px;padding:5px;border:1px solid #dce6f4;border-radius:14px;background:#fff;box-shadow:0 16px 30px -16px rgba(15,23,42,.38)}
.crmB .crm-selector-menu.abierto{display:block}
.crmB .crm-selector-option{width:100%;display:flex;align-items:center;gap:8px;border:0;border-radius:9px;padding:9px 10px;background:transparent;color:#334155;font:600 12.5px inherit;text-align:left;cursor:pointer}
.crmB .crm-selector-option:hover{background:#eef5ff;color:#1d4ed8}.crmB .crm-selector-option.activa{background:linear-gradient(135deg,#2563eb,#3b82f6);color:#fff}
.crmB .crm-selector-option i{margin-left:auto;opacity:0}.crmB .crm-selector-option.activa i{opacity:1}
.crmB .crm-tabs-row{display:flex;gap:10px;margin-bottom:12px}.crmB .crm-tabs-track{flex:1;display:flex;overflow:hidden}
.crmB .crm-tab-seg{flex:1;display:flex;align-items:center;justify-content:center;gap:8px;padding:12px 10px;font-size:13.5px;font-weight:700;line-height:1;color:#64748b;background:none;border:none;cursor:pointer;position:relative;white-space:nowrap}
.crmB .crm-tab-seg:not(:last-child)::after{content:"";position:absolute;top:22%;bottom:22%;right:0;width:1px;background:rgba(15,23,42,.16)}
.crmB .crm-tab-seg.on::after{opacity:0}.crmB .crm-tab-seg i{font-size:16px;opacity:.62}
.crmB .crm-tab-seg.on{color:#dc2626;font-weight:800;filter:drop-shadow(0 0 3px rgba(220,38,38,.30))}.crmB .crm-tab-seg.on i{opacity:1}
.crmB .crm-badge{font-size:11px;font-weight:800;opacity:.75;margin-left:2px}
.crmB .crm-acciones-rapidas{display:flex;gap:8px}
.crmB .crm-icon-btn{width:44px;height:44px;flex-shrink:0;display:flex;align-items:center;justify-content:center;color:#475569;font-size:18px;padding:0}
@keyframes crm-girar{to{transform:rotate(360deg)}}.crmB .crm-girando{animation:crm-girar .8s linear infinite}
.crmB .crm-busq-row{display:flex;gap:10px;margin-bottom:10px}
.crmB .crm-buscar{flex:1;display:flex;align-items:center;gap:8px;padding:11px 16px;color:#64748b;font-size:13px;font-weight:600}
.crmB .crm-buscar-input{flex:1;min-width:0;padding:11px 16px;font-size:16px;border-radius:9999px;background:linear-gradient(145deg,rgba(255,255,255,.76),rgba(226,232,240,.52));color:#1e293b;outline:none;border:1px solid rgba(255,255,255,.82);box-shadow:inset 0 2px 5px rgba(15,23,42,.11),0 8px 20px -16px rgba(15,23,42,.34)}
.crmB .crm-buscar-input:focus{box-shadow:inset 0 3px 6px rgba(15,23,42,.16),0 0 0 1px rgba(220,38,38,.14)}
.crmB .crm-filtros-btn{display:flex;align-items:center;gap:7px;padding:11px 16px;font-size:13px;font-weight:700;color:#1e293b;white-space:nowrap}.crmB .crm-filtros-btn.activo{color:#dc2626}
.crmB .crm-chips-row{display:flex;gap:10px;margin-bottom:12px;flex-wrap:wrap}
.crmB .crm-chip{display:inline-flex;align-items:center;gap:6px;line-height:1;padding:10px 18px;font-size:12.5px;font-weight:600;color:#475569}
.crmB .crm-chip .cuenta{display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;padding:0 5px;border-radius:9999px;font-size:10.5px;font-weight:800;background:rgba(15,23,42,.08);color:#475569}
.crmB .crm-chip.on{color:#dc2626;font-weight:700;filter:drop-shadow(0 0 3px rgba(220,38,38,.28))}.crmB .crm-chip.on .cuenta{background:rgba(220,38,38,.12);color:#b91c1c}
.crm-filtros-menu{display:none;position:fixed;flex-direction:column;background:#fff;border-radius:12px;box-shadow:0 8px 28px rgba(15,23,42,.22);padding:6px;z-index:500;min-width:190px}
.crm-filtros-menu button{display:flex;align-items:center;gap:9px;background:none;border:none;padding:9px 12px;font-size:13px;text-align:left;border-radius:8px;cursor:pointer;color:#111b21;width:100%;text-transform:none}
.crm-filtros-menu button:hover{background:#f0f2f5}.crm-filtros-menu button.on{color:#dc2626;font-weight:800}.crm-filtros-menu button i{font-size:15px;color:#64748b}.crm-filtros-menu button.on i{color:#dc2626}
.crmB .crm-vacio{text-align:center;color:#64748b;padding:28px 14px;font-size:13px}
.crmB .wa-shell{display:flex;height:calc(100vh - 250px);min-height:420px;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;box-shadow:0 4px 16px rgba(15,23,42,.06);background:#fff}
.crmB .wa-list-col{width:320px;flex-shrink:0;background:#fff;border-right:1px solid #e9edef;display:flex;flex-direction:column}.crmB .wa-list-scroll{overflow-y:auto;flex:1}
.crmB .wa-row{display:flex;align-items:center;gap:11px;padding:11px 14px;cursor:pointer;position:relative}
.crmB .wa-row+.wa-row::before{content:'';position:absolute;left:67px;right:0;top:0;height:1px;background:rgba(15,23,42,.06)}
.crmB .wa-row:hover{background:#f5f6f6}.crmB .wa-row.active{background:#f0f2f5}.crmB .wa-row.pendiente{box-shadow:inset 3px 0 0 #f59e0b}
.crmB .wa-row .r1,.crmB .wa-row .r2{display:flex;justify-content:space-between;gap:8px;align-items:center}.crmB .wa-row .r2{margin-top:3px}.crmB .wa-row .r2b{display:flex;gap:4px;align-items:center;flex-shrink:0}
.crmB .wa-avatar-wrap{position:relative;flex-shrink:0}
.crmB .wa-avatar{width:42px;height:42px;border-radius:50%;background:linear-gradient(135deg,#128C7E,#075E54);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px;flex-shrink:0}
.crmB .wa-wa-badge{position:absolute;right:-2px;bottom:-2px;width:17px;height:17px;border-radius:50%;background:#25D366;border:2px solid #fff;display:flex;align-items:center;justify-content:center;color:#fff;font-size:10px}
.crmB .wa-wa-badge.p-instagram{background:#c13584}.crmB .wa-wa-badge.p-facebook{background:#1877f2}
.crmB .fila-nombre{font-size:14.5px;font-weight:700;color:#334155;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.crmB .wa-row.no-leido .fila-nombre{font-weight:800;color:#0f172a}
.crmB .fila-hora{font-size:11px;color:#64748b;font-weight:500;flex-shrink:0}.crmB .wa-row.no-leido .fila-hora{color:#dc2626;font-weight:700}
.crmB .fila-preview{font-size:12.5px;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.crmB .wa-row.no-leido .fila-preview{color:#1e293b;font-weight:600}
.crmB .fila-badge{background:linear-gradient(160deg,#dc2626,#b91c1c);color:#fff;border-radius:9999px;min-width:20px;height:20px;padding:0 6px;font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center}
.crmB .fila-pendiente{color:#b45309;background:#fffbeb;border:1px solid #fde68a;border-radius:999px;padding:2px 6px;font-size:9px;font-weight:800;white-space:nowrap}
.crmB .fila-asignado{font-size:10px;font-weight:700;color:#7c3aed;background:#ede9fe;border-radius:999px;padding:2px 7px;white-space:nowrap}
.crmB .wa-chat-col{flex:1;min-width:0;display:flex;flex-direction:column;background:#ECE5DD;background-image:radial-gradient(rgba(0,0,0,.02) 1px,transparent 1px);background-size:14px 14px}
.crmB .wa-chat-empty{margin:auto;color:#8696a0;font-size:13px;text-align:center;padding:20px}
.crmB .wa-chat-head{background:#f0f2f5;padding:11px 18px;display:flex;align-items:center;gap:12px;border-bottom:1px solid #e9edef}
.crmB .wa-chat-head .hn{font-weight:700;font-size:14.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.crmB .wa-chat-head .hs{font-size:11.5px;color:#64748b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.crmB .wa-back{display:none;border:1px solid #d1d7db;background:#fff;color:#075E54;border-radius:8px;padding:6px 10px;cursor:pointer;font-size:15px}
.crmB .wa-icon-btn{width:36px;height:36px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;color:#54656f;font-size:18px;background:none;border:0;cursor:pointer;text-decoration:none;flex:none}.crmB .wa-icon-btn:hover{background:rgba(0,0,0,.06)}
.crmB .wa-vinc{color:#075E54;background:#fff;border:1px solid #d1d7db;border-radius:8px;padding:6px 10px;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap}
.crmB .vinc-chip{background:#dcfce7;color:#15803d;font-size:11px;font-weight:700;padding:3px 9px;border-radius:999px;white-space:nowrap}
.crmB .wa-chat-sub{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:6px 18px 10px;background:#f0f2f5;border-bottom:1px solid #e9edef}
.crmB .btn-mini{display:inline-flex;align-items:center;gap:5px;border:1px solid #d1d7db;background:#fff;color:#334155;border-radius:8px;padding:5px 10px;font-size:11.5px;font-weight:700;cursor:pointer;text-decoration:none;white-space:nowrap}
.crmB .btn-mini.wa{color:#15803d;padding:5px 8px}
.crmB .crm-asig{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;color:#334155}.crmB .crm-asig select{font-size:12px;padding:4px 6px;border:1px solid #d1d7db;border-radius:8px;background:#fff;max-width:170px}
.crmB .wa-msgs{flex:1;min-height:0;overflow-y:auto;padding:16px 20px;display:flex;flex-direction:column;gap:6px}
.crmB .wa-dia{align-self:center;background:#e1f2fb;color:#54656f;font-size:11px;font-weight:600;border-radius:8px;padding:4px 10px;margin:6px 0;box-shadow:0 1px .5px rgba(0,0,0,.13)}
.crmB .wa-brow{display:flex}.crmB .wa-brow.out{justify-content:flex-end}
.crmB .wa-bubble-wrap{position:relative;max-width:70%;border-radius:8px;padding:6px 9px 7px;box-shadow:0 1px .5px rgba(0,0,0,.13);font-size:13.5px;color:#111b21}
.crmB .wa-bubble-wrap .who{font-size:10px;font-weight:700;margin-bottom:2px}.crmB .wa-bubble-wrap .tx{white-space:pre-wrap;word-break:break-word}
.crmB .wa-bubble-wrap img,.crmB .wa-bubble-wrap video{max-width:100%;max-height:280px;border-radius:6px;display:block;margin-bottom:3px}.crmB .wa-bubble-wrap audio{max-width:240px}
.crmB .wa-bubble-wrap .ld{font-size:12px;color:#667781}.crmB .wa-bubble-wrap .err{font-size:11px;color:#b91c1c;margin-top:2px}
.crmB .wa-tick-line{text-align:right;font-size:10px;color:#8696a0;margin-top:2px;display:flex;justify-content:flex-end;gap:3px;align-items:center}
.crmB .wa-input-bar{padding:10px 14px;background:#f0f2f5;display:flex;gap:4px;align-items:flex-end;border-top:1px solid #e2e5e7;padding-bottom:max(10px,env(safe-area-inset-bottom))}
.crmB .wa-input-bar textarea{flex:1;border:1px solid transparent;border-radius:22px;padding:10px 16px;font:13.5px/1.35 inherit;min-width:0;margin:0 6px;background:#fff;color:#111b21;box-shadow:0 1px 2px rgba(11,20,26,.08);outline:none;resize:none;min-height:40px;max-height:120px}
.crmB .wa-input-bar textarea:focus{border-color:#128C7E;box-shadow:0 0 0 3px rgba(18,140,126,.13)}
.crmB .wa-clip{width:40px;height:40px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;font-size:20px;color:#54656f;flex:none}.crmB .wa-clip input{display:none}
.crmB .wa-send-btn{width:40px;height:40px;border-radius:50%;background:#128C7E;border:none;color:#fff;font-size:17px;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 3px rgba(7,94,84,.35)}.crmB .wa-send-btn:hover{background:#0e7c6f}
.crmB .wa-aviso{padding:12px 16px;background:#fffbeb;color:#92400e;font-size:12.5px;border-top:1px solid #fde68a}
.crmB .card{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:14px;box-shadow:0 1px 2px rgba(15,23,42,.04)}
.crmB .crm-leads-top{display:flex;gap:10px;align-items:flex-start;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap}.crmB .crm-leads-f{display:flex;gap:6px;flex-wrap:wrap}
.crmB .crm-lead-f{background:#f1f5f9;border:1px solid #e2e8f0;border-radius:8px;padding:7px 12px;font-size:12px;font-weight:600;color:#334155;cursor:pointer}.crmB .crm-lead-f.on{background:#dcfce7;color:#15803d;font-weight:700;border-color:#bbf7d0}
.crmB .crm-nuevo{display:inline-flex;align-items:center;gap:6px;background:#dc2626;color:#fff;border:0;border-radius:10px;padding:9px 14px;font-size:12.5px;font-weight:700;cursor:pointer}
.crmB .crm-lead{margin-bottom:10px}.crmB .crm-lead .t{display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap}.crmB .crm-lead .d{min-width:0;flex:1}
.crmB .crm-lead .n{font-weight:700;font-size:14px}.crmB .crm-lead .s{font-size:12.5px;color:#64748b;margin-top:1px}.crmB .crm-lead .s b{color:#0f172a}
.crmB .crm-lead .et{font-size:11px;font-weight:700;padding:3px 9px;border-radius:999px}
.crmB .crm-lead .a{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px}.crmB .crm-lead .a select{font-size:12.5px;padding:5px 8px;border:1px solid #cbd5e1;border-radius:8px;background:#fff}
.crmB .crm-lead .vinc{font-size:11.5px;color:#15803d;font-weight:600}.crmB .crm-lead .nota{font-size:12px;color:#64748b;margin-top:8px}
.crmB .crm-campanas{text-align:center;padding:40px 20px;color:#475569}.crmB .crm-campanas>i{font-size:38px;color:#e31e24}.crmB .crm-campanas h3{margin:8px 0;color:#0f172a}.crmB .crm-campanas p{margin:4px auto;max-width:460px;font-size:13px}
.crmB .rs-hub{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:14px;margin-bottom:12px}
.crmB .rs-hub-head{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.crmB .rs-hub-title{display:flex;align-items:center;gap:10px;flex:1;min-width:220px}
.crmB .rs-hub-icon{width:42px;height:42px;border-radius:12px;background:linear-gradient(135deg,#f58529,#dd2a7b,#8134af);color:#fff;display:flex;align-items:center;justify-content:center;font-size:21px}
.crmB .rs-hub-title h3{margin:0;font-size:15px}.crmB .rs-hub-title p{margin:1px 0 0;font-size:12px;color:#64748b}
.crmB .rs-hub-buscar{display:flex;align-items:center;gap:8px;border:1px solid #e2e8f0;border-radius:999px;padding:8px 14px;min-width:220px;flex:1;max-width:360px}.crmB .rs-hub-buscar input{border:0;outline:0;flex:1;min-width:0;font-size:14px;background:transparent}
.crmB .rs-canales{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}.crmB .rs-canal{display:inline-flex;align-items:center;gap:6px;border:1px solid #e2e8f0;background:#fff;border-radius:999px;padding:7px 14px;font-size:12.5px;font-weight:700;color:#334155;cursor:pointer}.crmB .rs-canal.on{background:#0f172a;color:#fff;border-color:#0f172a}
.crm-can{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid #eef2f7}.crm-can>i{font-size:24px}.crm-can>div{flex:1;min-width:0;display:flex;flex-direction:column}.crm-can b{font-size:13px}.crm-can small{font-size:11px;color:#64748b}
.crm-sw{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:700;cursor:pointer}.crm-nota{font-size:12.5px;color:#64748b;margin:10px 0 0}
@media(max-width:760px){
  .crmB .crm-tab-seg{font-size:11px;gap:3px;padding:8px 2px;flex-direction:column}.crmB .crm-tab-seg i{font-size:17px}.crmB .crm-badge{position:absolute;top:4px;right:8px}
  .crmB .crm-tabs-row{gap:6px}.crmB .crm-acciones-rapidas{gap:6px}.crmB .crm-icon-btn{width:40px;height:40px}
  .crmB .crm-chips-row{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;gap:8px}.crmB .crm-chip{padding:8px 14px;flex:none}
  .crmB .crm-leads-f{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;max-width:100%}.crmB .crm-lead-f{flex:none}
  .crmB .wa-shell{height:calc(100dvh - 300px);min-height:380px}.crmB.chat-abierto .wa-shell{height:calc(100dvh - 90px)}
  .crmB .wa-list-col{width:100%;border-right:0}.crmB .wa-shell.con-chat .wa-list-col{display:none}.crmB .wa-shell:not(.con-chat) .wa-chat-col{display:none}
  .crmB.chat-abierto .crm-ocultar-en-chat{display:none}.crmB .wa-back{display:inline-flex}
  .crmB .wa-chat-head{padding:8px 12px;gap:8px}.crmB .wa-chat-sub{padding:6px 12px 8px}.crmB .wa-bubble-wrap{max-width:84%}.crmB .wa-msgs{padding:12px}
}
@media(prefers-reduced-motion:reduce){.crmB .pill-elevado,.crmB .crm-tab-seg{transition:none}.crmB .crm-girando{animation:none}}
`;
    document.head.appendChild(st);
  }

  window.nxCRM = {
    bdAbrir, bdEnviar, bdAdjuntar,
    bdCerrar: function () { BD.sel = null; BD.msgs = []; repintar(); },
    bdFiltro: function (k) { BD.filtro = k; repintar(); },
    bdBuscar: function (q) { BD.q = q || ''; const l = document.getElementById('bdList'); if (l) l.innerHTML = bdListaHTML(); },
    bdBuscarAbrir: function () { BD.buscando = true; repintar(); setTimeout(() => { const i = document.getElementById('crmBuscarInput'); if (i) i.focus(); }, 30); },
    bdBuscarBlur: function () { if (BD.q.trim()) return; BD.buscando = false; repintar(); },
    filtrosMenu: function (ev) {
      ev.stopPropagation();
      let m = document.getElementById('crmFiltrosMenu');
      if (m && m.style.display === 'flex') { m.style.display = 'none'; return; }
      if (!m) { m = document.createElement('div'); m.id = 'crmFiltrosMenu'; m.className = 'crm-filtros-menu'; document.body.appendChild(m); document.addEventListener('click', e => { if (!m.contains(e.target)) m.style.display = 'none'; }); }
      const ops = [['todas', 'Todas las conversaciones', 'ti-inbox'], ['sin_asignar', 'Sin asignar', 'ti-user-question'], ['mias', 'Asignadas a mí', 'ti-user-check']];
      m.innerHTML = ops.map(o => `<button class="${BD.asig === o[0] ? 'on' : ''}" onclick="window.nxCRM.asig('${o[0]}')"><i class="ti ${o[2]}"></i> ${o[1]}</button>`).join('');
      m.style.display = 'flex';
      const r = ev.currentTarget.getBoundingClientRect(); let top = r.bottom + 6; if (top + 130 > innerHeight) top = Math.max(8, r.top - 136);
      m.style.top = top + 'px'; m.style.left = Math.max(8, r.right - 200) + 'px';
    },
    asig: function (k) { BD.asig = k; const m = document.getElementById('crmFiltrosMenu'); if (m) m.style.display = 'none'; repintar(); },
    tab: function (k) { S.vista = k; BD.sel = null; BD.msgs = []; BD.q = ''; BD.buscando = false; try { localStorage.setItem('studio_crm_vista', k); } catch (e) {} repintar(); },
    red: function (k) { BD.red = k; BD.sel = null; BD.msgs = []; repintar(); },
    linea: function (id) { BD.linea = id || ''; BD.sel = null; BD.msgs = []; repintar(); },
    lineaMenu: function (ev) { ev.stopPropagation(); const m = document.getElementById('crmLineaMenu'); if (!m) return; const ab = m.classList.toggle('abierto'); ev.currentTarget.classList.toggle('abierto', ab); if (ab) setTimeout(() => document.addEventListener('click', function f() { m.classList.remove('abierto'); document.removeEventListener('click', f); }), 0); },
    leadsFiltro: function (k) { S.leadsF = k; repintar(); },
    leadEtapa: function (id, el) { const o = S.ops.find(x => String(x.id) === String(id)); const v = el.value; if (o && v === 'perdido') el.value = o.etapa; mover(id, v); },
    leadCliente: function (id) { try { ctx().elegirCliente(function (c) { if (c && c.id) guardarCampo(id, 'cliente_id', c.id); }); } catch (e) {} },
    canalesModal: canalesModal,
    actualizar: async function (b) { const i = b && b.querySelector('i'); if (i) i.classList.add('crm-girando'); await Promise.all([cargar(), bdCargar()]); if (BD.sel) await bdCargarMsgs(BD.sel); repintar(); },
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
