/* STUDIO · CRM (pantalla tipo BAYOL CELL: Mensajes · Redes · Leads · Campañas) + Bandeja de WhatsApp/Instagram/Facebook.
 * 02-oct-2026 «CRM afinado» (bitácora 2026-10-01-2245-claude): abrir/cerrar un chat ya no redibuja todo el POS; lista
 * paginada por plataforma con «Cargar más», búsqueda en el servidor y Archivadas; tiempo real que se reconecta bien;
 * enlaces de fotos/audios que se renuevan antes de vencer; estados de carga y error con «Reintentar»; 16 px en iPhone.
 * Historia del módulo: CRM Fase 1 (24-sep-2026) — réplica mejorada del CRM de BAYOL CELL Taller, sin canales externos.
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
  function fmt(v) { const r = Math.round(n(v) * 100) / 100; return 'RD$ ' + (r === 0 ? 0 : r).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function toast(t, m, s) { try { window.toast && window.toast(t, m, s); } catch (e) {} }
  function hoyISO() { try { return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santo_Domingo' }); } catch (e) { return new Date().toISOString().slice(0, 10); } }
  function diaRD(ts) { if (!ts) return ''; const s = String(ts); if (s.length === 10) return s; try { return new Date(s).toLocaleDateString('en-CA', { timeZone: 'America/Santo_Domingo' }); } catch (e) { return s.slice(0, 10); } }
  function addDays(iso, d) { const t = new Date(iso + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10); }
  function diasEntre(a, b) { return Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 86400000); }
  function dmy(ts) { const d = diaRD(ts); return d ? d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4) : ''; }
  function hora(ts) { try { return new Date(ts).toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Santo_Domingo' }); } catch (e) { return ''; } }
  function ini(nom) { const t = String(nom || '').trim(); if (!/[a-záéíóúñ]/i.test(t)) return t.replace(/\D/g, '').slice(-2) || '?'; const p = t.split(/\s+/).filter(Boolean); return ((p[0] || '?')[0] + (p[1] ? p[1][0] : '')).toUpperCase(); }
  function yo() { try { const s = ctx().sesion ? ctx().sesion() : window.sesion; return (s && s.id) || null; } catch (e) { return null; } }
  // Permisos por rol (dueño 02-oct-2026): «crm» = Leads y Campañas; «bandeja» = Mensajes y Redes. El servidor los vuelve a
  // comprobar (crm_permiso, migración 41); aquí solo se decide qué pestañas se muestran y qué se carga.
  function perm() { try { const p = ctx().crmPermisos ? ctx().crmPermisos() : null; if (p) return p; } catch (e) {} return { crm: true, bandeja: true }; }
  // Funciones del CRM POR EMPLEADO (dueño 03-oct-2026, «solo por empleado»): canales que atiende y si puede transferir.
  // Las marca el administrador en Ajustes → Equipo; el servidor las vuelve a comprobar (RLS + crm_transferir_conversacion,
  // migración 44). Mientras no cargan (o si la migración no está), se asume lo de siempre: todos los canales.
  const FN = { canales: ['whatsapp', 'instagram', 'facebook'], transferir: true, cargado: false, pidiendo: false, trPend: 0 };
  function canalOk(p) { return FN.canales.indexOf(p) >= 0; }
  function redesPermitidas() { return ['instagram', 'facebook'].filter(canalOk); }
  function vistasPermitidas() {
    const p = perm();
    const bd = p.bandeja ? (canalOk('whatsapp') ? ['mensajes'] : []).concat(redesPermitidas().length ? ['redes'] : []) : [];
    return bd.concat(p.crm ? ['leads', 'campanas'] : []);
  }
  async function cargarFunciones() {
    try {
      const f = await api().post('rpc/crm_mis_funciones', {});
      if (f && Array.isArray(f.canales)) { FN.canales = f.canales; FN.transferir = f.transferir !== false; }
    } catch (e) {}
    FN.cargado = true;
    const rs = redesPermitidas();
    if (rs.length && rs.indexOf(BD.red) < 0) { BD.red = rs[0]; if (S.vista === 'redes') { BD.sel = null; BD.msgs = []; BD.clave = ''; bdCargar().then(() => { BD.listaHTML = ''; repintar(); }); } }
    trContar();
  }
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
  function repintar() {
    // Al repintar el módulo se conserva lo que el empleado estaba escribiendo, el cursor y la posición del chat.
    const tx = document.getElementById('bdTx'), mm = document.getElementById('bdMsgs');
    const ll = document.getElementById('bdList');
    let snap = { foco: false, ini: 0, fin: 0, scroll: null, abajo: true, lista: 0 };
    try { snap = { foco: !!tx && document.activeElement === tx, ini: tx ? tx.selectionStart : 0, fin: tx ? tx.selectionEnd : 0, scroll: mm ? mm.scrollTop : null, abajo: BD.pegadoAbajo, lista: ll ? ll.scrollTop : 0 }; } catch (e) {}
    try { ctx().renderPOS && ctx().renderPOS(); } catch (e) {}
    BD.listaHTML = '';
    try {
      const l2 = document.getElementById('bdList'); if (l2 && snap.lista) l2.scrollTop = snap.lista;
      const t2 = document.getElementById('bdTx'); if (t2 && snap.foco) { t2.focus(); try { t2.setSelectionRange(snap.ini, snap.fin); } catch (e) {} }
      const m2 = document.getElementById('bdMsgs'); if (m2) { if (snap.abajo || snap.scroll === null) m2.scrollTop = m2.scrollHeight; else m2.scrollTop = snap.scroll; bdEnganchar(m2); }
      bdAltoVisual();
    } catch (e) {}
  }
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
  // selector de línea, pestañas Mensajes · Redes · Leads · Campañas (Redes junto a WhatsApp, pedido del dueño 28-sep-2026), Buscar + Filtros, chips Todos/No leídos/Pendientes.
  function render() {
    ensureCSS();
    const P = perm(), vistas = vistasPermitidas();
    if (!vistas.length) return '<div class="nxCrm crmB"><div class="crm-vacio">Tu rol no tiene acceso al CRM. Pídele al administrador que lo active en Permisos por rol.</div></div>';
    if (vistas.indexOf(S.vista) < 0) { S.vista = vistas[0]; BD.sel = null; BD.msgs = []; }
    if (!FN.cargado && !FN.pidiendo) { FN.pidiendo = true; cargarFunciones().then(repintar); }
    if (!S.cargado && !S.error) { cargar().then(repintar); }
    if (P.bandeja && !BD.cargado) { bdCargar().then(() => { repintar(); bdTimer(); }); }
    const leadsAb = S.ops.filter(abierta).length;
    const tab = (k, l, ic, extra) => `<button class="crm-tab-seg${S.vista === k ? ' on pill-hundido' : ''}" onclick="window.nxCRM.tab('${k}')"><i class="ti ${ic}"></i> ${l}${extra || ''}</button>`;
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
        ${vistas.indexOf('mensajes') >= 0 ? tab('mensajes', 'Mensajes', 'ti-brand-whatsapp') : ''}${vistas.indexOf('redes') >= 0 ? tab('redes', 'Redes', 'ti-share') : ''}${P.crm ? tab('leads', 'Prospectos', 'ti-user-plus', leadsAb ? `<span class="crm-badge">${leadsAb}</span>` : '') + tab('campanas', 'Campañas', 'ti-speakerphone') : ''}
      </div>
      <div class="crm-acciones-rapidas">${P.bandeja ? `<button class="crm-icon-btn pill-elevado crm-tr-btn" onclick="window.nxCRM.trBandeja()" title="Clientes transferidos a mí" aria-label="Clientes transferidos a mí"><i class="ti ti-arrows-transfer-down"></i><span id="crmTrBadge" class="crm-tr-badge"${FN.trPend ? '' : ' hidden'}>${FN.trPend || ''}</span></button>` : ''}${esAdmin() ? `<button class="crm-icon-btn pill-elevado" onclick="window.nxCRM.bdSincronizar()" title="Sincronizar conversaciones" aria-label="Sincronizar conversaciones"><i class="ti ti-cloud-download"></i></button><button class="crm-icon-btn pill-elevado" onclick="window.nxCRM.canalesModal()" title="Canales conectados" aria-label="Canales conectados"><i class="ti ti-plug-connected"></i></button>` : ''}<button class="crm-icon-btn pill-elevado" onclick="window.nxCRM.actualizar(this)" title="Actualizar" aria-label="Actualizar"><i class="ti ti-refresh"></i></button></div></div></div>
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
    if (BD.cargado) bdTimer();   // Instagram/Facebook también en tiempo real
    const pch = (k, l, ic, col) => `<button class="rs-canal${BD.red === k ? ' on' : ''}" onclick="window.nxCRM.red('${k}')"><i class="ti ${ic}" style="color:${col}"></i> ${l}</button>`;
    return `<div class="rs-hub crm-ocultar-en-chat"><div class="rs-hub-head"><div class="rs-hub-title"><div class="rs-hub-icon"><i class="ti ti-affiliate"></i></div><div><h3>Redes Sociales</h3><p>Gestiona tus mensajes desde un solo lugar</p></div></div>
        <div class="rs-hub-buscar"><i class="ti ti-search"></i><input type="text" value="${esc(BD.q)}" placeholder="Buscar conversaciones..." oninput="window.nxCRM.bdBuscar(this.value)"></div></div>
      <div class="rs-canales">${canalOk('instagram') ? pch('instagram', 'Instagram', 'ti-brand-instagram', '#c13584') : ''}${canalOk('facebook') ? pch('facebook', 'Facebook', 'ti-brand-messenger', '#1877f2') : ''}<button class="crm-filtros-btn pill-elevado rs-filtros${BD.asig !== 'todas' ? ' activo' : ''}" onclick="window.nxCRM.filtrosMenu(event)"><i class="ti ti-adjustments-horizontal"></i> <span>Filtros</span></button></div>
      <div class="crm-chips-row" id="bdChips">${bdChipsHTML()}</div></div>
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
            <label class="nxCrmF"><span>Monto estimado (RD$)</span><input id="ocMonto" data-nx-money inputmode="decimal" value="${n(o.monto_estimado) ? n(o.monto_estimado) : ''}" placeholder="0.00"></label>
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
      monto_estimado: window.nxMoney ? window.nxMoney.parse(v('ocMonto')) : n(String(v('ocMonto')).replace(/[^\d.]/g, '')), fuente: v('ocFuente') || null, email: v('ocEmail') || null, notas: v('ocNotas') || null };
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
  const BD = { convs: [], canales: [], sel: null, msgs: [], filtro: 'todos', asig: 'todas', linea: '', red: 'instagram', buscando: false, q: '', urls: {}, timer: null, cargado: false, enviando: false, error: '',
    hayMas: false, cargandoViejos: false, pegadoAbajo: true, borr: {}, cita: null, firmaFallo: {}, nuevos: 0, bq: '', bqI: 0, grab: null, reenv: null,
    // 02-oct-2026 (CRM afinado): lista paginada por plataforma, búsqueda en el servidor, archivadas, estado de carga del
    // chat y repintado por partes (cabecera, lista y pie) en vez de redibujar todo el POS.
    clave: '', convsMas: false, cargandoMas: false, cargandoLista: false, avisoRed: '', listaHTML: '', listaScroll: 0, msgsEstado: '', firmaCab: '', firmaPie: '' };
  const PAG = 80;   // mensajes por página (los más nuevos primero; al subir se cargan los anteriores, como en Bayol)
  const PAGC = 200; // conversaciones por página de la lista («Cargar más» trae las siguientes)
  function apiBase() { const a = api() || {}; return { url: a.url, key: a.key, tok: a.token || a.key }; }
  function bdPendiente(c) { return c.ultimo_inbound_at && (!c.ultima_respuesta_at || c.ultima_respuesta_at < c.ultimo_inbound_at); }
  function bdVentana(c) { if (!c || c.plataforma !== 'whatsapp') return true; return !!c.ultimo_inbound_at && (Date.now() - new Date(c.ultimo_inbound_at).getTime()) < 24 * 3600e3; }
  function bdHora(ts) { if (!ts) return ''; const d = diaRD(ts), h = hoyISO(); return d === h ? hora(ts) : d === addDays(h, -1) ? 'ayer' : dmy(ts).slice(0, 5); }
  function bdNombre(c) { const cli = cliDe(c.cliente_id); return (cli && cli.nombre) || c.contacto_nombre || c.contacto_usuario || c.telefono_e164 || 'Contacto'; }
  function bdPlat() { return S.vista === 'redes' ? BD.red : 'whatsapp'; }
  // Borradores por conversación guardados en este equipo (paridad Bayol): no se pierden al recargar la página.
  try { const g = JSON.parse(localStorage.getItem('studio_crm_borr') || '{}'); if (g && typeof g === 'object') BD.borr = g; } catch (e) {}
  let bdBorrT = null;
  function bdGuardarBorr() { clearTimeout(bdBorrT); bdBorrT = setTimeout(() => { try { const o = {}; for (const k in BD.borr) if (BD.borr[k] && String(BD.borr[k]).trim()) o[k] = String(BD.borr[k]).slice(0, 2000); localStorage.setItem('studio_crm_borr', JSON.stringify(o)); } catch (e) {} }, 400); }
  function bdArch() { return BD.filtro === 'archivadas'; }
  function bdFiltroBase() { return 'plataforma=eq.' + bdPlat() + '&archivada=eq.' + bdArch(); }
  async function bdCargar() {
    const clave = bdPlat() + '|' + bdArch();
    try {
      const [convs, canales] = await Promise.all([
        api().get('crm_conversaciones', 'select=*&' + bdFiltroBase() + '&order=ultimo_mensaje_at.desc.nullslast&limit=' + PAGC),
        api().get('crm_canales', 'select=*&order=plataforma.asc')
      ]);
      if (clave !== bdPlat() + '|' + bdArch()) return;   // el usuario cambió de pestaña mientras cargaba
      const nuevas = convs || [];
      if (BD.clave !== clave) { BD.convs = nuevas; BD.convsMas = nuevas.length === PAGC; }
      else {
        // Se conservan las conversaciones más antiguas ya cargadas («Cargar más» o encontradas al buscar).
        const ids = new Set(nuevas.map(c => String(c.id)));
        const corte = nuevas.length === PAGC ? Date.parse(nuevas[nuevas.length - 1].ultimo_mensaje_at || 0) || 0 : 0;
        const resto = corte ? BD.convs.filter(c => !ids.has(String(c.id)) && c.plataforma === bdPlat() && !!c.archivada === bdArch() && (Date.parse(c.ultimo_mensaje_at || 0) || 0) < corte) : [];
        BD.convs = nuevas.concat(resto);
        if (!resto.length) BD.convsMas = nuevas.length === PAGC;
      }
      BD.clave = clave; bdOrdenar();
      BD.canales = canales || []; BD.cargado = true; BD.error = ''; BD.avisoRed = ''; BD.cargandoLista = false;
    } catch (e) {
      BD.cargandoLista = false;
      if (BD.cargado && !BD.error && BD.convs.length) BD.avisoRed = errTxt(e);   // la lista se queda; solo un aviso
      else { BD.error = errTxt(e); BD.cargado = true; }
    }
  }
  async function bdCargarMas() {
    if (BD.cargandoMas || !BD.convsMas) return;
    const ult = BD.convs.filter(c => c.ultimo_mensaje_at && c.plataforma === bdPlat()).slice(-1)[0];
    if (!ult) { BD.convsMas = false; return; }
    BD.cargandoMas = true; bdPintarLista();
    const clave = bdPlat() + '|' + bdArch();
    try {
      const filas = await api().get('crm_conversaciones', 'select=*&' + bdFiltroBase() + '&ultimo_mensaje_at=lt.' + encodeURIComponent(ult.ultimo_mensaje_at) + '&order=ultimo_mensaje_at.desc.nullslast&limit=' + PAGC) || [];
      if (clave === BD.clave) {
        const ids = new Set(BD.convs.map(c => String(c.id)));
        filas.forEach(f => { if (!ids.has(String(f.id))) BD.convs.push(f); });
        BD.convsMas = filas.length === PAGC; bdOrdenar();
      }
    } catch (e) { toast('err', 'No se pudieron cargar más conversaciones', errTxt(e)); }
    BD.cargandoMas = false; bdPintarLista();
  }
  // Búsqueda en el servidor (nombre, teléfono, usuario o último mensaje): encuentra también los chats viejos que aún no
  // se han cargado en la lista. Se espera a que el usuario deje de escribir.
  let bdBuscarT = null;
  function bdBuscarServidor() {
    clearTimeout(bdBuscarT);
    const q = BD.q.trim(); if (q.length < 2) return;
    bdBuscarT = setTimeout(async () => {
      const limpio = q.replace(/[(),*%:"\\]/g, ' ').replace(/\s+/g, ' ').trim(), dig = q.replace(/\D/g, '');
      if (!limpio && !dig) return;
      const cond = [];
      if (limpio) ['contacto_nombre', 'contacto_usuario', 'ultimo_mensaje_preview'].forEach(k => cond.push(k + '.ilike.*' + limpio + '*'));
      if (dig.length >= 3) cond.push('telefono_e164.ilike.*' + dig + '*');
      const clave = BD.clave;
      try {
        const filas = await api().get('crm_conversaciones', 'select=*&' + bdFiltroBase() + '&or=' + encodeURIComponent('(' + cond.join(',') + ')') + '&order=ultimo_mensaje_at.desc.nullslast&limit=60') || [];
        if (clave !== BD.clave || BD.q.trim() !== q) return;
        const ids = new Set(BD.convs.map(c => String(c.id))); let hay = false;
        filas.forEach(f => { if (!ids.has(String(f.id))) { BD.convs.push(f); hay = true; } });
        if (hay) { bdOrdenar(); bdPintarLista(); }
      } catch (e) {}
    }, 350);
  }
  function bdFusionar(filas, id) {
    if (String(BD.sel) !== String(id)) return;
    const porId = new Map(BD.msgs.filter(m => !String(m.id).startsWith('tmp-')).map(m => [String(m.id), m]));
    filas.forEach(f => porId.set(String(f.id), Object.assign({}, porId.get(String(f.id)) || {}, f)));
    const reales = [...porId.values()];
    // Burbujas provisionales: se quedan hasta que aparezca el mensaje real con el mismo texto.
    const tmps = BD.msgs.filter(m => String(m.id).startsWith('tmp-') && String(m._conv) === String(id) && !reales.some(r => (r.idempotency_key && 'tmp-' + r.idempotency_key === String(m.id)) || (r.direccion === 'out' && r.cuerpo === m.cuerpo && Date.parse(r.created_at) >= Date.parse(m._desde) - 120000)));
    BD.msgs = reales.concat(tmps).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  }
  async function bdCargarMsgs(id) {
    try {
      const filas = await api().get('crm_mensajes', 'select=*&conversacion_id=eq.' + id + '&order=created_at.desc&limit=' + PAG) || [];
      if (String(BD.sel) !== String(id)) return;
      if (!BD.msgs.some(m => !String(m.id).startsWith('tmp-'))) BD.hayMas = filas.length === PAG;
      bdFusionar(filas, id);
      BD.msgsEstado = BD.msgs.length ? 'ok' : 'vacio';
    } catch (e) { if (String(BD.sel) === String(id) && !BD.msgs.some(m => !String(m.id).startsWith('tmp-'))) BD.msgsEstado = 'error'; }
  }
  async function bdCargarViejos() {
    if (!BD.sel || !BD.hayMas || BD.cargandoViejos) return;
    const primero = BD.msgs.find(m => !String(m.id).startsWith('tmp-')); if (!primero) return;
    BD.cargandoViejos = true; const id = BD.sel;
    try {
      const filas = await api().get('crm_mensajes', 'select=*&conversacion_id=eq.' + id + '&created_at=lt.' + encodeURIComponent(primero.created_at) + '&order=created_at.desc&limit=' + PAG) || [];
      if (String(BD.sel) !== String(id)) return;
      BD.hayMas = filas.length === PAG;
      const box = document.getElementById('bdMsgs'), alto = box ? box.scrollHeight : 0, top = box ? box.scrollTop : 0;
      bdFusionar(filas, id); bdSyncMsgs(false);
      if (box) box.scrollTop = top + (box.scrollHeight - alto);   // mantiene a la vista el mismo mensaje
      bdFirmar();
    } catch (e) { toast('err', 'No se pudieron cargar los mensajes anteriores', 'Revisa la conexión y vuelve a subir.'); } finally { BD.cargandoViejos = false; }
  }
  function bdLista() {
    const q = BD.q.trim().toLowerCase(), me = yo();
    return BD.convs.filter(c => {
      if (S.vista === 'redes') { if (c.plataforma !== BD.red) return false; }
      else { if (c.plataforma !== 'whatsapp') return false; if (BD.linea && String(c.canal_id) !== String(BD.linea)) return false; }
      if (!!c.archivada !== bdArch()) return false;
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
    const aviso = BD.avisoRed ? '<div class="bd-aviso-red"><i class="ti ti-wifi-off"></i> Sin conexión con el servidor. Reintentando…</div>' : '';
    const base = BD.convs.filter(c => c.plataforma === bdPlat() && !!c.archivada === bdArch());
    if (!base.length) {
      if (BD.cargandoLista) return aviso + '<div class="crm-vacio">Cargando conversaciones…</div>';
      if (bdArch()) return aviso + '<div class="crm-vacio">No hay conversaciones archivadas.</div>';
      return aviso + `<div class="crm-vacio">${S.vista === 'redes' ? 'Todavía no han llegado mensajes de ' + (BD.red === 'instagram' ? 'Instagram' : 'Facebook') + '.' : 'Todavía no han llegado mensajes de WhatsApp.'}</div>`;
    }
    const l = bdLista();
    const mas = BD.convsMas ? `<button type="button" class="bd-mas-convs" onclick="window.nxCRM.bdCargarMas()"${BD.cargandoMas ? ' disabled' : ''}>${BD.cargandoMas ? '<i class="ti ti-loader-2 crm-girando"></i> Cargando…' : '<i class="ti ti-chevron-down"></i> Cargar más conversaciones'}</button>` : '';
    if (!l.length) return aviso + `<div class="crm-vacio">${BD.q.trim() ? 'Buscando también en las conversaciones anteriores…' : 'Ninguna conversación coincide con este filtro.'}</div>` + mas;
    return aviso + l.map(c => { const p = PLAT[c.plataforma] || PLAT.whatsapp, nl = c.no_leidos > 0, pend = bdPendiente(c);
      return `<div class="wa-row${String(BD.sel) === String(c.id) ? ' active' : ''}${nl ? ' no-leido' : ''}${pend ? ' pendiente' : ''}" data-id="${esc(c.id)}" onclick="window.nxCRM.bdAbrir('${c.id}')">
        <div class="wa-avatar-wrap"><div class="wa-avatar">${esc(ini(bdNombre(c)))}</div><span class="wa-wa-badge p-${c.plataforma}"><i class="ti ${p[1]}"></i></span></div>
        <div style="min-width:0;flex:1"><div class="r1"><span class="fila-nombre">${esc(bdNombre(c))}</span><span class="fila-hora">${c.fijado_at ? '<i class="ti ti-pin fila-ic" title="Fijada"></i>' : ''}${bdSilenciada(c) ? '<i class="ti ti-bell-off fila-ic" title="Silenciada"></i>' : ''}${bdHoraRel(c.ultimo_mensaje_at)}</span></div>${(c.etiquetas || []).length ? `<div class="fila-etq">${c.etiquetas.slice(0, 3).map(t => `<em>${esc(t)}</em>`).join('')}${c.etiquetas.length > 3 ? `<em>+${c.etiquetas.length - 3}</em>` : ''}</div>` : ''}
          <div class="r2"><span class="fila-preview">${String(BD.sel) !== String(c.id) && BD.borr[c.id] && String(BD.borr[c.id]).trim() ? `<b class="fila-borr">Borrador:</b> ${esc(String(BD.borr[c.id]).trim().slice(0, 80))}` : esc(c.ultimo_mensaje_preview || '')}</span><span class="r2b">${pend ? '<span class="fila-pendiente"><i class="ti ti-user-exclamation"></i> Atender</span>' : ''}${nl ? `<span class="fila-badge">${c.no_leidos}</span>` : ''}${c.asignado_nombre ? `<span class="fila-asignado">${esc(c.asignado_nombre)}</span>` : ''}</span></div></div>
      </div>`; }).join('') + mas;
  }
  // La lista solo se toca si cambió lo que se ve (cada evento de tiempo real ya no la redibuja entera sin necesidad).
  function bdPintarLista() {
    const l = document.getElementById('bdList'); if (!l) return;
    const h = bdListaHTML(); if (h === BD.listaHTML && l.childElementCount) return;
    BD.listaHTML = h; l.innerHTML = h; bdEngancharLista(l);
  }
  function bdEngancharLista(l) {
    if (!l || l._bd) return; l._bd = true;
    l.addEventListener('scroll', () => { if (BD.convsMas && !BD.cargandoMas && !BD.q.trim() && l.scrollHeight - l.scrollTop - l.clientHeight < 240) bdCargarMas(); }, { passive: true });
  }
  function bdIcono(e) { return ({ pendiente: '<i class="ti ti-clock"></i>', enviado: '<i class="ti ti-check"></i>', entregado: '<i class="ti ti-checks"></i>', leido: '<i class="ti ti-checks" style="color:#53bdeb"></i>', fallido: '<i class="ti ti-alert-circle" style="color:#dc2626"></i>' })[e] || ''; }
  function bdQuien(m, nombre) { return m.direccion === 'out' ? 'Tú' : (nombre || 'Cliente'); }
  function bdResumen(m) { if (!m) return ''; if (m.tipo === 'ubicacion') return '📍 Ubicación'; if (m.tipo === 'contacto') { const j = bdJson(m.cuerpo); return '👤 ' + ((j && j.nombre) || 'Contacto'); } if (m.cuerpo) return String(m.cuerpo); return ({ imagen: '📷 Foto', video: '🎥 Video', audio: '🎤 Audio', documento: '📄 Documento', plantilla: '📋 Plantilla' })[m.tipo] || 'Mensaje'; }
  function bdJson(t) { try { const j = JSON.parse(t); return j && typeof j === 'object' ? j : null; } catch (e) { return null; } }
  // Ubicación y contacto (paridad Bayol): tarjetas en vez del JSON crudo.
  function bdTarjeta(m) {
    const j = bdJson(m.cuerpo);
    if (m.tipo === 'ubicacion' && j && isFinite(+j.lat) && isFinite(+j.lng)) return `<a class="bd-card" href="https://www.google.com/maps?q=${+j.lat},${+j.lng}" target="_blank" rel="noopener"><i class="ti ti-map-pin"></i><span><b>${esc(j.nombre || 'Ubicación')}</b><small>Abrir en Google Maps</small></span></a>`;
    if (m.tipo === 'contacto' && j) return `<div class="bd-card"><i class="ti ti-user-circle"></i><span><b>${esc(j.nombre || 'Contacto')}</b>${j.telefono ? `<a href="tel:${esc(j.telefono)}">${esc(j.telefono)}</a>` : ''}</span></div>`;
    return '';
  }
  function bdPuedeCitar(c) { return !!c && c.plataforma === 'whatsapp'; }
  function bdBurbuja(m, nombre) {
    const out = m.direccion === 'out', u = bdUrl(m.media_path), tmp = String(m.id).startsWith('tmp-');
    const local = !m.media_path && m._local ? (m.tipo === 'imagen' ? `<img src="${esc(m._local)}" alt="Imagen">` : m.tipo === 'video' ? `<video src="${esc(m._local)}" muted></video>` : m.tipo === 'audio' ? `<audio controls src="${esc(m._local)}"></audio>` : `<div class="ld"><i class="ti ti-file"></i> ${esc(m._nombre || 'Archivo')}</div>`) + (m.estado === 'pendiente' ? '<div class="bd-subiendo"><i class="ti ti-loader-2 crm-girando"></i> Enviando…</div>' : '') : '';
    const tarjeta = (m.tipo === 'ubicacion' || m.tipo === 'contacto') ? bdTarjeta(m) : '';
    const media = local || (m.media_path ? (u ? (m.tipo === 'imagen' ? `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="Imagen" onload="window.nxCRM.bdMediaLista()" onerror="window.nxCRM.bdMediaFallo('${esc(m.media_path)}')"></a>` : m.tipo === 'audio' ? `<audio controls preload="metadata" src="${esc(u)}"></audio>` : m.tipo === 'video' ? `<video controls preload="metadata" src="${esc(u)}" onloadedmetadata="window.nxCRM.bdMediaLista()"></video>` : `<a href="${esc(u)}" target="_blank" rel="noopener"><i class="ti ti-file"></i> Abrir archivo</a>`) : ((BD.firmaFallo[m.media_path] || 0) >= 2 ? `<div class="ld bd-nodisp"><i class="ti ti-photo-off"></i> Adjunto no disponible <button type="button" class="btn-mini" onclick="window.nxCRM.bdMediaReintentar('${esc(m.media_path)}')">Reintentar</button></div>` : `<div class="ld"><i class="ti ti-paperclip"></i> ${esc(m.tipo)}…</div>`)) : '');
    let cita = '';
    if (m.responde_a_id) {
      const o = BD.msgs.find(x => String(x.id) === String(m.responde_a_id));
      cita = `<button type="button" class="bd-cita" onclick="window.nxCRM.bdIrA('${esc(m.responde_a_id)}')"><b>${o ? esc(bdQuien(o, nombre)) : 'Mensaje citado'}</b><span>${o ? esc(bdResumen(o).slice(0, 140)) : 'Toca para buscarlo'}</span></button>`;
    }
    const plant = m.tipo === 'plantilla' ? '<div class="bd-plant"><i class="ti ti-template"></i> Plantilla</div>' : '';
    const c = BD.convs.find(x => String(x.id) === String(BD.sel));
    const resp = !tmp && bdPuedeCitar(c) ? `<button type="button" class="bd-resp" onclick="window.nxCRM.bdCitar('${m.id}')" title="Responder" aria-label="Responder a este mensaje"><i class="ti ti-arrow-back-up"></i></button>` : '';
    const fallo = m.estado === 'fallido' ? `<div class="err">No se envió.${m.error ? ' ' + esc(bdErrorLegible(m.error)) : ''}${out && (m.cuerpo || tmp) && m.tipo !== 'plantilla' ? ` <button type="button" class="bd-reint" onclick="window.nxCRM.bdReintentar('${m.id}')"><i class="ti ti-refresh"></i> Reintentar</button>` : ''}</div>` : '';
    return `<div class="wa-brow ${out ? 'out' : 'in'}"><div class="wa-bubble-wrap" style="background:${m.estado === 'fallido' ? '#fee2e2' : out ? '#dcf8c6' : '#fff'}">${resp}
      <div class="who" style="color:${out ? '#166534' : '#128C7E'}">${out ? 'Tú (STUDIO)' + (m.enviado_por_nombre ? ' · ' + esc(m.enviado_por_nombre) : m.desde_telefono ? ' · desde el teléfono' : '') : esc(nombre)}</div>
      ${!tmp ? `<button type="button" class="bd-mmenu" onclick="window.nxCRM.bdMsgMenu(event,'${esc(m.id)}')" title="Opciones" aria-label="Opciones del mensaje"><i class="ti ti-chevron-down"></i></button>` : ''}
      ${cita}${plant}${media}${tarjeta}${m.cuerpo && !tarjeta ? `<div class="tx">${bdTexto(m.cuerpo)}</div>` : ''}
      <div class="wa-tick-line">${hora(m.created_at)} ${out ? bdIcono(m.estado) : ''}</div>
      ${fallo}</div></div>`;
  }
  function bdErrorLegible(e) {
    const t = String(e || '');
    if (/ventana|24 horas/i.test(t)) return 'Pasaron más de 24 horas: usa una plantilla.';
    if (/outside of allowed window|2018278|10903|messaging window|24.?hour/i.test(t)) return 'Pasaron más de 24 horas desde el último mensaje del cliente: Instagram/Facebook no deja responder hasta que vuelva a escribir.';
    if (/131031|account locked/i.test(t)) return 'Meta tiene bloqueada la cuenta de WhatsApp (en revisión).';
    if (/apagado/i.test(t)) return 'El canal está apagado.';
    if (/sin respuesta|timeout/i.test(t)) return 'Zernio no respondió; revisa en el teléfono si salió.';
    return t.replace(/[{}"\[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  }
  // Cada mensaje es un bloque con data-id y una «firma» (data-k) de lo que se ve. Al llegar cambios solo se reemplaza el
  // bloque que cambió (p. ej. ✓ → ✓✓) o se inserta el nuevo: un audio o video que se está reproduciendo no se corta.
  function bdItems() {
    const c = BD.convs.find(x => String(x.id) === String(BD.sel)), nom = c ? bdNombre(c) : '';
    let dia = '';
    return BD.msgs.map(m => {
      const d = diaRD(m.created_at), sep = d !== dia; dia = d;
      const o = m.responde_a_id ? BD.msgs.find(x => String(x.id) === String(m.responde_a_id)) : null;
      const k = [m.estado, m.cuerpo, m._local ? 'l' : '', m.media_path ? (bdUrl(m.media_path) || ((BD.firmaFallo[m.media_path] || 0) >= 2 ? 'f' : 'p')) : '', sep ? d : '', m.responde_a_id ? (o ? 'o' : 'x') : '', m.error || '', m.enviado_por_nombre || ''].join('|');
      return { id: String(m.id), k: k, html: (sep ? `<div class="wa-dia">${bdDiaTxt(d, m.created_at)}</div>` : '') + bdBurbuja(m, nom) };
    });
  }
  function bdDiaTxt(d, ts) {
    const h = hoyISO(); if (d === h) return 'Hoy'; if (d === addDays(h, -1)) return 'Ayer';
    const n = diasEntre(d, h);
    if (n > 0 && n < 7) { try { const s = new Date(d + 'T12:00:00Z').toLocaleDateString('es-DO', { weekday: 'long', timeZone: 'UTC' }); return s.charAt(0).toUpperCase() + s.slice(1); } catch (e) {} }
    return dmy(ts);
  }
  // Texto del mensaje con enlaces que se pueden tocar (se escapa primero: nunca se inserta HTML del cliente).
  function bdTexto(t) {
    return esc(t).replace(/(\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]|\bwww\.[^\s<]+[^\s<.,;:!?)\]'"])/gi, u => `<a href="${/^www\./i.test(u) ? 'https://' + u : u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
  }
  // ── Emojis (paridad Bayol): panel con los más usados por categoría; se insertan donde está el cursor.
  const EMOJIS = [
    ['Caras', '😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 😉 😌 😍 🥰 😘 😗 😋 😛 😜 🤪 😎 🤩 🥳 😏 😒 😞 😔 😟 😕 🙁 😣 😖 😫 😩 🥺 😢 😭 😤 😠 😡 🤯 😳 🥵 🥶 😱 😨 😰 😥 😓 🤗 🤔 🤭 🤫 🤥 😶 😐 😑 😬 🙄 😯 😦 😧 😮 😲 🥱 😴 🤤 😪 😵 🤐 🥴 🤢 🤮 🤧 😷 🤒 🤕'],
    ['Manos', '👍 👎 👌 🤌 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ ✋ 🤚 🖐️ 🖖 👋 🙌 👏 🤝 🙏 💪 ✍️ 🫶'],
    ['Corazones', '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 ✨ 🔥 ⭐ 🌟 💯'],
    ['Tienda', '📱 💻 🖥️ ⌚ 🎧 📺 📷 🔋 🔌 💡 🛒 🛍️ 💳 💵 💰 🧾 📦 🚚 🏪 🎁 🏷️ ✅ ❌ ⚠️ ⏰ 📅 📍 📞 💬 📩 🔧 🛠️']
  ];
  function bdEmojiPanel(ev) {
    if (ev) ev.stopPropagation();
    let m = document.getElementById('bdEmojiP');
    if (m) { m.remove(); return; }
    m = document.createElement('div'); m.id = 'bdEmojiP'; m.className = 'bd-emoji-panel'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-label', 'Emojis');
    m.innerHTML = EMOJIS.map(g => `<div class="bd-emoji-g"><b>${g[0]}</b><div>${g[1].split(' ').map(e => `<button type="button" onclick="window.nxCRM.bdEmoji('${e}')">${e}</button>`).join('')}</div></div>`).join('');
    document.body.appendChild(m);
    const b = (ev && ev.currentTarget) || document.querySelector('.bd-emoji-btn'), r = b ? b.getBoundingClientRect() : { left: 10, top: innerHeight - 60 };
    const w = Math.min(320, innerWidth - 16); m.style.width = w + 'px';
    m.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + 'px';
    m.style.bottom = Math.max(8, innerHeight - r.top + 8) + 'px';
    setTimeout(() => document.addEventListener('pointerdown', function f(e) { if (!m.contains(e.target) && !(e.target.closest && e.target.closest('.bd-emoji-btn'))) { m.remove(); document.removeEventListener('pointerdown', f, true); } }, true), 0);
  }
  function bdEmojiInsertar(e) {
    const t = document.getElementById('bdTx'); if (!t) return;
    const a = t.selectionStart != null ? t.selectionStart : t.value.length, z = t.selectionEnd != null ? t.selectionEnd : t.value.length;
    t.value = t.value.slice(0, a) + e + t.value.slice(z);
    const pos = a + e.length; try { t.setSelectionRange(pos, pos); } catch (er) {}
    if (BD.sel) { BD.borr[BD.sel] = t.value; bdGuardarBorr(); }
    t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 120) + 'px';
    if (window.innerWidth > 860) t.focus();
  }
  function bdBloque(it) { const d = document.createElement('div'); d.className = 'bd-m'; d.dataset.id = it.id; d.dataset.k = it.k; d.innerHTML = it.html; return d; }
  function bdUrl(path) { const x = path ? BD.urls[path] : null; return x && x.vence > Date.now() ? x.u : null; }
  function bdMsgsHTML() {
    if (!BD.msgs.length) {
      if (BD.msgsEstado === 'error') return '<div class="wa-chat-empty">No se pudieron cargar los mensajes.<br><button type="button" class="btn-mini" style="margin-top:8px" onclick="window.nxCRM.bdReintentarCarga()"><i class="ti ti-refresh"></i> Reintentar</button></div>';
      if (BD.msgsEstado === 'vacio') return '<div class="wa-chat-empty">Todavía no hay mensajes en esta conversación.</div>';
      return '<div class="wa-chat-empty">Cargando mensajes…</div>';
    }
    return (BD.hayMas ? '<div class="bd-mas"><i class="ti ti-loader-2"></i> Sube para ver mensajes anteriores</div>' : '') +
      bdItems().map(it => `<div class="bd-m" data-id="${esc(it.id)}" data-k="${esc(it.k)}">${it.html}</div>`).join('');
  }
  function bdSyncMsgs(bajar) {
    const box = document.getElementById('bdMsgs'); if (!box) return;
    if (!BD.msgs.length || !box.querySelector(':scope > .bd-m')) { box.innerHTML = bdMsgsHTML(); if (bajar !== false) box.scrollTop = box.scrollHeight; bdEnganchar(box); return; }
    const abajo = BD.pegadoAbajo;
    let mas = box.querySelector(':scope > .bd-mas');
    if (BD.hayMas && !mas) { mas = document.createElement('div'); mas.className = 'bd-mas'; mas.innerHTML = '<i class="ti ti-loader-2"></i> Sube para ver mensajes anteriores'; box.prepend(mas); }
    if (!BD.hayMas && mas) { mas.remove(); mas = null; }
    box.querySelectorAll(':scope > .wa-chat-empty').forEach(n => n.remove());
    const items = bdItems(), ids = new Set(items.map(i => i.id)), hay = new Map();
    box.querySelectorAll(':scope > .bd-m').forEach(n => { if (!ids.has(n.dataset.id)) n.remove(); else hay.set(n.dataset.id, n); });
    let prev = mas;
    for (const it of items) {
      let n = hay.get(it.id);
      if (n && n.dataset.k !== it.k) { const nn = bdBloque(it); n.replaceWith(nn); n = nn; }
      if (!n) n = bdBloque(it);
      const esperado = prev ? prev.nextElementSibling : box.firstElementChild;
      if (esperado !== n) box.insertBefore(n, esperado);
      prev = n;
    }
    if (abajo && bajar !== false) box.scrollTop = box.scrollHeight;
  }
  // Scroll del chat: al subir carga los anteriores; «ir abajo» aparece si el usuario se alejó del final.
  function bdEnganchar(box) {
    if (!box || box._bd) return; box._bd = true;
    box.addEventListener('scroll', () => {
      const dist = box.scrollHeight - box.scrollTop - box.clientHeight;
      BD.pegadoAbajo = dist < 80;
      const b = document.getElementById('bdAbajo'); if (b) b.classList.toggle('on', dist > 300);
      if (BD.pegadoAbajo && BD.nuevos) bdNuevos(0);
      if (box.scrollTop < 150) bdCargarViejos();
    }, { passive: true });
    // Deslizar a la derecha sobre un mensaje = responderlo (como en WhatsApp).
    let t0 = null;
    box.addEventListener('touchstart', e => { const b = e.target.closest('.bd-m'); if (!b || e.touches.length !== 1) { t0 = null; return; } t0 = { x: e.touches[0].clientX, y: e.touches[0].clientY, b: b, dx: 0, lock: null }; }, { passive: true });
    box.addEventListener('touchmove', e => {
      if (!t0) return; const dx = e.touches[0].clientX - t0.x, dy = e.touches[0].clientY - t0.y;
      if (t0.lock === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) t0.lock = Math.abs(dx) > Math.abs(dy) && dx > 0 ? 'x' : 'y';
      if (t0.lock !== 'x') return;
      t0.dx = Math.max(0, Math.min(dx, 80)); const w = t0.b.querySelector('.wa-bubble-wrap'); if (w) w.style.transform = `translateX(${t0.dx}px)`;
    }, { passive: true });
    box.addEventListener('touchend', () => {
      if (!t0) return; const w = t0.b.querySelector('.wa-bubble-wrap'); if (w) { w.style.transition = 'transform .18s'; w.style.transform = ''; setTimeout(() => { w.style.transition = ''; }, 200); }
      const c = BD.convs.find(x => String(x.id) === String(BD.sel));
      if (t0.lock === 'x' && t0.dx > 60 && bdPuedeCitar(c) && !String(t0.b.dataset.id).startsWith('tmp-')) bdCitar(t0.b.dataset.id);
      t0 = null;
    });
  }
  function bdCitaHTML() {
    const q = BD.cita && String(BD.cita.conv) === String(BD.sel) ? BD.msgs.find(x => String(x.id) === String(BD.cita.id)) : null;
    if (!q) return '';
    const c = BD.convs.find(x => String(x.id) === String(BD.sel));
    return `<div class="bd-citabar"><i class="ti ti-arrow-back-up"></i><div><b>Respondiendo a ${esc(bdQuien(q, c ? bdNombre(c) : ''))}</b><span>${esc(bdResumen(q).slice(0, 160))}</span></div><button type="button" onclick="window.nxCRM.bdCitaQuitar()" aria-label="Quitar cita"><i class="ti ti-x"></i></button></div>`;
  }
  function bdCitar(id) {
    BD.cita = { id: id, conv: BD.sel };
    const cb = document.getElementById('bdCitaBar'); if (cb) cb.innerHTML = bdCitaHTML();
    const t = document.getElementById('bdTx'); if (t) t.focus();
  }
  async function bdIrA(id) {
    for (let i = 0; i < 6; i++) {
      const n = document.querySelector(`#bdMsgs .bd-m[data-id="${CSS.escape(String(id))}"]`);
      if (n) { n.scrollIntoView({ block: 'center', behavior: 'smooth' }); n.classList.remove('bd-flash'); void n.offsetWidth; n.classList.add('bd-flash'); return; }
      if (!BD.hayMas) break;
      await bdCargarViejos();
    }
    toast('warn', 'No se encontró el mensaje citado');
  }
  function bdConvSel() { return BD.convs.find(x => String(x.id) === String(BD.sel)); }
  function bdCanalDe(c) { return c ? BD.canales.find(x => String(x.id) === String(c.canal_id)) : null; }
  function bdFirmaCab(c) { if (!c) return ''; const op = c.crm_id ? S.ops.find(o => String(o.id) === String(c.crm_id)) : null; return [c.id, bdNombre(c), c.telefono_e164, c.contacto_usuario, c.cliente_id, c.crm_id, op ? op.etapa : '', c.asignado_id, c.asignado_nombre, c.archivada, S.usuarios.length].join('|'); }
  function bdFirmaPie(c) { if (!c) return ''; const k = bdCanalDe(c); return [c.id, !!(k && k.activo), bdVentana(c), bdRed24(c)].join('|'); }
  // Instagram/Facebook: Meta solo deja responder dentro de las 24 h del último mensaje del cliente (no hay plantillas).
  function bdRed24(c) { return !!c && c.plataforma !== 'whatsapp' && !!c.ultimo_inbound_at && (Date.now() - new Date(c.ultimo_inbound_at).getTime()) > 24 * 3600e3; }
  function bdChatHTML() {
    const c = bdConvSel();
    if (!c) return '<div class="wa-chat-empty">Selecciona una conversación de la lista.</div>';
    BD.firmaCab = bdFirmaCab(c); BD.firmaPie = bdFirmaPie(c);
    return `<div id="bdCab" class="bd-parte">${bdCabHTML(c)}</div>
      <div id="bdBusqChat" class="bd-busq-chat" hidden></div>
      <div id="bdMsgs" class="wa-msgs">${bdMsgsHTML()}</div>
      <button type="button" id="bdAbajo" class="bd-abajo" onclick="window.nxCRM.bdAbajo()" aria-label="Ir a los últimos mensajes"><i class="ti ti-chevron-down"></i><span class="bd-nuevos" hidden></span></button>
      <div id="bdPie" class="bd-parte">${bdPieHTML(c)}</div>`;
  }
  function bdCabHTML(c) {
    const cli = cliDe(c.cliente_id), op = c.crm_id ? S.ops.find(o => String(o.id) === String(c.crm_id)) : null;
    const me = yo(), nom = bdNombre(c);
    const usrOpts = `<option value="">Sin asignar</option>` + S.usuarios.map(u => `<option value="${u.id}"${String(c.asignado_id || '') === String(u.id) ? ' selected' : ''}>${esc(u.nom)}</option>`).join('');
    const asig = esAdmin() ? `<span class="crm-asig"><i class="ti ti-user-check"></i><select onchange="window.nxCRM.bdAsignar('${c.id}', this.value || null)">${usrOpts}</select></span>`
      : !c.asignado_id ? (me ? `<button class="btn-mini" onclick="window.nxCRM.bdAsignar('${c.id}','${me}')"><i class="ti ti-hand-grab"></i> Atender yo</button>` : '')
      : `<span class="crm-asig"><i class="ti ti-user-check"></i> ${esc(c.asignado_nombre || '')}${String(c.asignado_id) === String(me) ? ` <button class="btn-mini" onclick="window.nxCRM.bdAsignar('${c.id}', null)">Soltar</button>` : ''}</span>`;
    const sub = c.plataforma === 'whatsapp' ? `<i class="ti ti-phone"></i> ${esc(c.telefono_e164 || (String(c.contacto_id).startsWith('bsid:') ? 'Contacto desde anuncio' : ''))}` : `<i class="ti ${(PLAT[c.plataforma] || PLAT.whatsapp)[1]}"></i> ${c.contacto_usuario ? '@' + esc(c.contacto_usuario) : (PLAT[c.plataforma] || PLAT.whatsapp)[0]}`;
    const tel = c.telefono_e164 && !String(c.contacto_id).startsWith('bsid:') ? c.telefono_e164 : '';
    return `<div class="wa-chat-head"><button class="wa-back" onclick="window.nxCRM.bdCerrar()" aria-label="Volver a la lista"><i class="ti ti-arrow-left"></i></button>
        <div class="wa-avatar">${esc(ini(nom))}</div>
        <div style="flex:1;min-width:0"><div class="hn">${esc(nom)}</div><div class="hs">${sub}</div></div>
        <button type="button" class="wa-icon-btn" onclick="window.nxCRM.bdBuscarChat()" title="Buscar en este chat" aria-label="Buscar en este chat"><i class="ti ti-search"></i></button>
        <button type="button" class="wa-icon-btn" onclick="window.nxCRM.bdChatMenu(event)" title="Más opciones" aria-label="Más opciones del chat"><i class="ti ti-dots-vertical"></i></button>
        ${tel ? `<a href="tel:${esc(tel)}" class="wa-icon-btn" title="Llamar"><i class="ti ti-phone-call"></i></a>` : ''}
        ${cli ? '<span class="vinc-chip"><i class="ti ti-user-check"></i> Cliente vinculado</span>' : `<button class="wa-vinc" onclick="window.nxCRM.bdCliente('${c.id}')"><i class="ti ti-user-plus"></i> Vincular</button>`}
        ${c.archivada ? `<button class="wa-icon-btn" onclick="window.nxCRM.bdDesarchivar('${c.id}')" title="Devolver a la bandeja" aria-label="Devolver a la bandeja"><i class="ti ti-archive-off"></i></button>` : `<button class="wa-icon-btn" onclick="window.nxCRM.bdArchivar('${c.id}')" title="Archivar" aria-label="Archivar"><i class="ti ti-archive"></i></button>`}</div>
      <div class="wa-chat-sub">${asig}${FN.transferir && (esAdmin() || !c.asignado_id || String(c.asignado_id) === String(me)) ? `<button class="btn-mini" onclick="window.nxCRM.trAbrir('${c.id}')" title="Pasar este cliente a otro empleado"><i class="ti ti-arrows-exchange"></i> Transferir</button>` : ''}${op ? `<button class="btn-mini" onclick="window.nxCRM.abrir('${op.id}')"><i class="ti ti-user-plus"></i> Lead: ${etN(op.etapa)}</button>` : perm().crm ? `<button class="btn-mini" onclick="window.nxCRM.bdOportunidad('${c.id}')"><i class="ti ti-plus"></i> Crear lead</button>` : ''}</div>`;
  }
  function bdPieHTML(c) {
    const canal = bdCanalDe(c), puede = canal && canal.activo, abierta = bdVentana(c);
    return `${!puede ? '<div class="wa-aviso">Este canal está apagado. El administrador lo activa en <i class="ti ti-plug-connected"></i> Canales.</div>'
        : abierta ? `${bdRed24(c) ? `<div class="wa-aviso bd-aviso-red24"><i class="ti ti-clock-exclamation"></i> Pasaron más de 24 horas desde el último mensaje del cliente: ${c.plataforma === 'instagram' ? 'Instagram' : 'Facebook'} puede rechazar la respuesta hasta que el cliente vuelva a escribir.</div>` : ''}<div id="bdCitaBar">${bdCitaHTML()}</div><div class="wa-input-bar"><button type="button" class="wa-clip bd-emoji-btn" title="Emojis" aria-label="Emojis" onclick="window.nxCRM.bdEmojis(event)"><i class="ti ti-mood-smile"></i></button><button type="button" class="wa-clip bd-clip" title="Adjuntar" aria-label="Adjuntar" onclick="window.nxCRM.bdAdjMenu(event)"><i class="ti ti-paperclip"></i></button><input type="file" id="bdFile" hidden accept="image/*,video/*" onchange="window.nxCRM.bdAdjuntar(this)"><input type="file" id="bdFileDoc" hidden accept="application/pdf,.doc,.docx,.xls,.xlsx,.txt,audio/*" onchange="window.nxCRM.bdAdjuntar(this)">
          <textarea id="bdTx" rows="1" placeholder="Escribe un mensaje o / para respuestas rápidas" onkeydown="if(window.nxCRM.bdRRKey(event))return;if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&window.innerWidth>860){event.preventDefault();window.nxCRM.bdEnviar()}" oninput="this.style.height='auto';this.style.height=Math.min(this.scrollHeight,120)+'px';window.nxCRM.bdBorrador(this.value);window.nxCRM.bdRR(this)" onfocus="window.nxCRM.bdTeclado()" onblur="window.nxCRM.bdTeclado()">${esc(BD.borr[c.id] || '')}</textarea>
          <button type="button" class="wa-clip bd-mic" onclick="window.nxCRM.bdGrabar()" title="Nota de voz" aria-label="Grabar nota de voz"><i class="ti ti-microphone"></i></button>
          <button class="wa-send-btn" onclick="window.nxCRM.bdEnviar()" aria-label="Enviar"><i class="ti ti-send"></i></button></div>`
        : `<div class="wa-aviso bd-aviso-24"><span><i class="ti ti-clock-off"></i> Pasaron más de 24 horas desde el último mensaje del cliente. WhatsApp solo permite plantillas aprobadas.</span><button type="button" class="bd-btn-plant" onclick="window.nxCRM.bdPlantillas()"><i class="ti ti-template"></i> Enviar plantilla</button></div>`}`;
  }
  // Abrir o cerrar un chat ya no redibuja todo el POS: solo cambia la columna del chat y la fila marcada (la lista
  // conserva su posición y un audio que suena en otra parte no se corta).
  function bdModoChat() {
    const root = document.querySelector('.nxCrm.crmB'), sh = root && root.querySelector('.wa-shell'), ch = document.getElementById('bdChat');
    if (!root || !sh || !ch) { repintar(); return; }
    const abierto = !!BD.sel;
    root.classList.toggle('chat-abierto', abierto && (S.vista === 'mensajes' || S.vista === 'redes'));
    sh.classList.toggle('con-chat', abierto);
    ch.innerHTML = bdChatHTML();
    bdPintarLista();
    const m = document.getElementById('bdMsgs'); if (m) { bdEnganchar(m); m.scrollTop = m.scrollHeight; }
    bdAltoVisual();
  }
  function bdPintarCabPie(forzar) {
    const c = bdConvSel(), cab = document.getElementById('bdCab'), pie = document.getElementById('bdPie');
    if (!c || !cab || !pie) return;
    const fc = bdFirmaCab(c); if (forzar || fc !== BD.firmaCab) { cab.innerHTML = bdCabHTML(c); BD.firmaCab = fc; }
    const fp = bdFirmaPie(c);
    if (fp !== BD.firmaPie) {   // p. ej. el cliente escribió y se abrió la ventana de 24 h: aparece la barra de escribir
      const tx = document.getElementById('bdTx'); if (tx) BD.borr[c.id] = tx.value;
      pie.innerHTML = bdPieHTML(c); BD.firmaPie = fp; bdAltoVisual();
    }
  }
  function bdShellHTML() {
    const lista = bdListaHTML(); BD.listaHTML = lista;
    return `<div class="wa-shell${BD.sel ? ' con-chat' : ''}"><div class="wa-list-col"><div class="wa-list-scroll" id="bdList">${lista}</div></div><div class="wa-chat-col" id="bdChat">${bdChatHTML()}</div></div>`;
  }
  function vistaMensajes() {
    if (BD.error && !BD.convs.length) return `<div class="crm-vacio">No se pudieron cargar los mensajes: ${esc(BD.error)}<br><button type="button" class="btn-mini" style="margin-top:10px" onclick="window.nxCRM.actualizar()"><i class="ti ti-refresh"></i> Reintentar</button></div>`;
    if (!BD.cargado) return '<div class="crm-vacio">Cargando mensajes…</div>';
    bdTimer();
    const chips = bdChipsHTML();
    return `<div class="crm-ocultar-en-chat"><div class="crm-busq-row">
        ${BD.buscando || BD.q ? `<input type="text" id="crmBuscarInput" class="crm-buscar-input" value="${esc(BD.q)}" placeholder="Buscar nombre o número..." oninput="window.nxCRM.bdBuscar(this.value)" onblur="window.nxCRM.bdBuscarBlur()">` : `<button class="crm-buscar pill-elevado" onclick="window.nxCRM.bdBuscarAbrir(this)"><i class="ti ti-search"></i> <span>Buscar</span></button>`}
        <button class="crm-filtros-btn pill-elevado${BD.asig !== 'todas' ? ' activo' : ''}" onclick="window.nxCRM.filtrosMenu(event)"><i class="ti ti-adjustments-horizontal"></i> <span>Filtros</span></button></div>
      <div class="crm-chips-row" id="bdChips">${chips}</div></div>
      ${bdShellHTML()}`;
  }
  // Chips Todos / No leídos / Pendientes / Archivadas (WhatsApp y Redes). Paridad Bayol 03-oct-2026: también en Redes, y
  // sus números se actualizan con cada evento en tiempo real (antes solo al redibujar todo).
  function bdChipsHTML() {
    const base = BD.convs.filter(c => c.plataforma === bdPlat() && !c.archivada && (S.vista === 'redes' || !BD.linea || String(c.canal_id) === String(BD.linea)));
    const arch = bdArch();
    const def = [['todos', 'Todos', arch ? 0 : base.length], ['no_leidos', 'No leídos', arch ? 0 : base.filter(c => c.no_leidos > 0).length], ['pendientes', 'Pendientes', arch ? 0 : base.filter(bdPendiente).length], ['archivadas', 'Archivadas', 0]];
    return def.map(d => `<button class="crm-chip pill-elevado${BD.filtro === d[0] ? ' on pill-hundido' : ''}" onclick="window.nxCRM.bdFiltro('${d[0]}')">${d[1]}${d[2] ? ` <span class="cuenta">${d[2]}</span>` : ''}</button>`).join('');
  }
  function bdPintarChips() { const e = document.getElementById('bdChips'); if (!e) return; const h = bdChipsHTML(); if (e._h !== h) { e._h = h; e.innerHTML = h; } }
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
    bdPintarChips();
    if (BD.bq) setTimeout(bdBqMarcar, 0);
    bdPintarLista();
    bdPintarCabPie();
    bdSyncMsgs();
    bdFirmar();
  }
  function bdAlFondo() { const m = document.getElementById('bdMsgs'); if (m) { m.scrollTop = m.scrollHeight; BD.pegadoAbajo = true; } }
  const bdFirmando = new Set();
  const FIRMA_S = 6 * 3600;   // los enlaces de fotos/audios duran 6 h y se renuevan 5 min antes de vencer
  async function bdFirmar() {
    const b = apiBase(), ahora = Date.now();
    const faltan = [...new Set(BD.msgs.filter(m => m.media_path).map(m => m.media_path))].filter(p => !bdFirmando.has(p) && (BD.firmaFallo[p] || 0) < 2 && !(BD.urls[p] && BD.urls[p].vence - ahora > 5 * 60e3));
    if (!faltan.length) return;
    faltan.forEach(x => bdFirmando.add(x));
    const hdr = { apikey: b.key, Authorization: 'Bearer ' + b.tok, 'Content-Type': 'application/json' };
    const guardar = (path, su) => { if (path && su) BD.urls[path] = { u: `${b.url}/storage/v1${su}`, vence: Date.now() + (FIRMA_S - 60) * 1000 }; };
    try {
      for (let i = 0; i < faltan.length; i += 50) {
        const lote = faltan.slice(i, i + 50);
        let ok = false;
        try {   // una sola petición para todo el lote
          const r = await fetch(`${b.url}/storage/v1/object/sign/crm-media`, { method: 'POST', headers: hdr, body: JSON.stringify({ expiresIn: FIRMA_S, paths: lote }) });
          const j = await r.json().catch(() => null);
          if (r.ok && Array.isArray(j)) { j.forEach(x => x && guardar(x.path, x.signedURL || x.signedUrl)); ok = true; }
        } catch (e) {}
        if (!ok) await Promise.all(lote.map(async path => {   // respaldo: de una en una, en paralelo
          try {
            const r = await fetch(`${b.url}/storage/v1/object/sign/crm-media/${path.split('/').map(encodeURIComponent).join('/')}`, { method: 'POST', headers: hdr, body: JSON.stringify({ expiresIn: FIRMA_S }) });
            const j = await r.json(); if (j) guardar(path, j.signedURL || j.signedUrl);
          } catch (e) {}
        }));
      }
    } finally { faltan.forEach(x => { bdFirmando.delete(x); if (!BD.urls[x]) BD.firmaFallo[x] = (BD.firmaFallo[x] || 0) + 1; else delete BD.firmaFallo[x]; }); }
    // Solo se completan los bloques con adjunto; no se mueve el scroll (si el usuario está leyendo arriba, se queda ahí).
    bdSyncMsgs();
  }
  // Respaldo por consulta: cada 10 s si el tiempo real no está conectado; cada 60 s si lo está (por si se perdió un evento).
  let bdUltimaConsulta = 0;
  async function bdRefrescar() {
    bdUltimaConsulta = Date.now();
    const antes = BD.sel ? (BD.convs.find(x => String(x.id) === String(BD.sel)) || {}).ultimo_mensaje_at : null;
    await bdCargar();
    if (BD.sel) { const c = BD.convs.find(x => String(x.id) === String(BD.sel)); if (c && c.ultimo_mensaje_at !== antes) { await bdCargarMsgs(BD.sel); if (c.no_leidos > 0) api().patch('crm_conversaciones', 'id=eq.' + c.id, { no_leidos: 0 }).catch(() => {}); } }
    bdPintarParcial();
  }
  function bdTimer() {
    bdRealtime();
    if (BD.timer) return;
    BD.timer = setInterval(() => {
      if (!document.querySelector('.crmB .wa-shell')) { clearInterval(BD.timer); BD.timer = null; bdRealtimeCerrar(); return; }
      if (document.hidden) return;
      if (Date.now() - bdUltimaConsulta < (BD.rt.vivo ? 60000 : 10000)) return;
      bdRefrescar();
    }, 2000);
  }

  // ── Tiempo real (28-sep-2026): los mensajes entrantes, los enviados (también los del teléfono) y los cambios de estado
  // (✓ enviado, ✓✓ entregado, ✓✓ azul leído) aparecen al instante, igual que en WhatsApp. Mismo patrón probado del inbox
  // de NEXUS PRO: SDK supabase-js (UMD) y setAuth con el token del usuario ANTES de suscribirse, para que la RLS se
  // aplique como «authenticated» (sin eso cada evento llega 401). Solo LEE: nada se envía solo.
  BD.rt = { sb: null, canal: null, vivo: false, token: '', reintento: null, pintar: null, n: 0, fallos: 0 };
  function bdCargarSDK() {
    return new Promise((resolve) => {
      if (window.supabase && window.supabase.createClient) return resolve();
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js';
      s.onload = resolve; s.onerror = resolve;
      document.head.appendChild(s);
    });
  }
  function bdPintarPronto() { clearTimeout(BD.rt.pintar); BD.rt.pintar = setTimeout(bdPintarParcial, 60); }
  function bdOrdenar() { BD.convs.sort((a, b) => (b.fijado_at ? 1 : 0) - (a.fijado_at ? 1 : 0) || String(b.ultimo_mensaje_at || '').localeCompare(String(a.ultimo_mensaje_at || ''))); }
  let bdTonoUlt = 0, bdAudio = null;
  function bdTono() {
    const t = Date.now(); if (t - bdTonoUlt < 2500) return; bdTonoUlt = t;
    try { if (localStorage.getItem('studio_crm_sonido') === '0') return; } catch (e) {}
    try {
      bdAudio = bdAudio || new (window.AudioContext || window.webkitAudioContext)();
      const a = bdAudio, o = a.createOscillator(), g = a.createGain(), n0 = a.currentTime;
      o.type = 'sine'; o.frequency.setValueAtTime(880, n0); o.frequency.setValueAtTime(1175, n0 + 0.09);
      g.gain.setValueAtTime(0.0001, n0); g.gain.exponentialRampToValueAtTime(0.16, n0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, n0 + 0.28);
      o.connect(g); g.connect(a.destination); o.start(n0); o.stop(n0 + 0.3);
    } catch (e) {}
  }
  // El navegador solo deja sonar después de que el usuario tocó la página: se «despierta» el audio en el primer toque.
  document.addEventListener('pointerdown', () => { try { if (bdAudio && bdAudio.state === 'suspended') bdAudio.resume(); } catch (e) {} }, { passive: true });
  function bdEvConversacion(ev) {
    const n = ev.new || {};
    if (!n.id) return;
    const i = BD.convs.findIndex(x => String(x.id) === String(n.id));
    const ant = i >= 0 ? BD.convs[i] : null;
    const entrante = n.ultimo_inbound_at && (ev.eventType === 'INSERT' || (ant ? ant.ultimo_inbound_at !== n.ultimo_inbound_at : (ev.old && ev.old.ultimo_inbound_at !== n.ultimo_inbound_at)));
    if (entrante && !bdSilenciada(n) && !(String(n.id) === String(BD.sel) && !document.hidden) && Date.now() - Date.parse(n.ultimo_inbound_at) < 120000) bdTono();
    // Solo se guarda si pertenece a la lista que se está viendo (plataforma y archivadas / no archivadas).
    const encaja = n.plataforma === bdPlat() && !!n.archivada === bdArch();
    if (!encaja) { if (i >= 0 && String(n.id) !== String(BD.sel)) BD.convs.splice(i, 1); else if (i >= 0) BD.convs[i] = Object.assign({}, BD.convs[i], n); }
    else if (i >= 0) BD.convs[i] = Object.assign({}, BD.convs[i], n);
    else BD.convs.push(n);
    bdOrdenar();
    // Si la conversación está abierta en pantalla, lo nuevo ya se está viendo: no cuenta como no leído.
    if (String(n.id) === String(BD.sel) && n.no_leidos > 0 && !document.hidden) {
      const c = BD.convs.find(x => String(x.id) === String(n.id)); if (c) c.no_leidos = 0;
      api().patch('crm_conversaciones', 'id=eq.' + n.id, { no_leidos: 0 }).catch(() => {});
    }
    bdPintarPronto();
  }
  function bdEvMensaje(ev) {
    if (ev.eventType === 'DELETE') {   // p. ej. la copia del eco que el servidor borra: desaparece también en pantalla
      const o = ev.old || {}, j = o.id ? BD.msgs.findIndex(x => String(x.id) === String(o.id)) : -1;
      if (j >= 0) { BD.msgs.splice(j, 1); bdPintarPronto(); }
      return;
    }
    const n = ev.new || {};
    if (!n.id || String(n.conversacion_id) !== String(BD.sel)) return;
    const i = BD.msgs.findIndex(x => String(x.id) === String(n.id));
    if (i >= 0) BD.msgs[i] = Object.assign({}, BD.msgs[i], n);
    else {
      // Un mensaje más viejo que la página cargada (historial que se importa, un acuse de un mensaje antiguo) no se
      // mete en medio: aparecerá en su lugar al subir. Así «cargar anteriores» no se salta ningún tramo.
      const primero = BD.msgs.find(m => !String(m.id).startsWith('tmp-'));
      if (BD.hayMas && primero && Date.parse(n.created_at) < Date.parse(primero.created_at)) return;
      // Reemplaza la burbuja provisional («enviando…») por su clave de envío (o, de respaldo, por el mismo texto).
      const t = n.direccion === 'out' ? BD.msgs.findIndex(x => String(x.id).startsWith('tmp-') && (n.idempotency_key ? x.id === 'tmp-' + n.idempotency_key : x.cuerpo === n.cuerpo)) : -1;
      if (t >= 0) BD.msgs[t] = n; else { BD.msgs.push(n); if (n.direccion === 'in' && !BD.pegadoAbajo) bdNuevos(BD.nuevos + 1); }
      BD.msgs.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    }
    bdPintarPronto();
  }
  async function bdRealtime() {
    const A = api() || {};
    if (!A.url || !A.key) return;
    const tok = A.token || '';
    if (BD.rt.sb) {
      // El token de la sesión se renueva: se lo pasamos al socket para que no pierda los permisos.
      if (tok && tok !== BD.rt.token) { BD.rt.token = tok; try { await BD.rt.sb.realtime.setAuth(tok); } catch (e) {} }
      if (!BD.rt.canal) bdSuscribir();   // se había cerrado al salir de la bandeja
      return;
    }
    try {
      await bdCargarSDK();
      if (!window.supabase || !window.supabase.createClient) return;
      BD.rt.sb = window.supabase.createClient(A.url, A.key, { auth: { persistSession: false, autoRefreshToken: false } });
      if (tok) { BD.rt.token = tok; await BD.rt.sb.realtime.setAuth(tok); }
      bdSuscribir();
    } catch (e) { console.error('[CRM bandeja] tiempo real', e); BD.rt.sb = null; }
  }
  // Cada suscripción usa un canal con nombre propio (el SDK devuelve el MISMO objeto si el nombre se repite, aunque se
  // esté cerrando) y su callback se ignora en cuanto deja de ser el canal vigente: un «CLOSED» del canal viejo ya no
  // derriba al nuevo ni deja la bandeja reconectando en bucle. Reintentos con espera creciente (5 s → 60 s).
  function bdSuscribir() {
    const sb = BD.rt.sb; if (!sb) return;
    clearTimeout(BD.rt.reintento);
    const viejo = BD.rt.canal; BD.rt.canal = null; BD.rt.vivo = false;
    if (viejo) { try { sb.removeChannel(viejo); } catch (e) {} }
    const canal = sb.channel('studio-crm-bandeja-' + (++BD.rt.n))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_conversaciones' }, ev => { if (BD.rt.canal === canal) bdEvConversacion(ev); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_mensajes' }, ev => { if (BD.rt.canal === canal) bdEvMensaje(ev); });
    // Aviso al instante cuando un compañero me transfiere un cliente (migración 44).
    if (yo()) canal.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'crm_transferencias', filter: 'a_id=eq.' + yo() }, ev => { if (BD.rt.canal === canal) trAviso(ev); });
    BD.rt.canal = canal;
    canal.subscribe((estado) => {
      if (BD.rt.canal !== canal) return;
      const antes = BD.rt.vivo;
      BD.rt.vivo = estado === 'SUBSCRIBED';
      // Al (re)conectar se recarga una vez por si llegó algo mientras estaba desconectado.
      if (BD.rt.vivo) { BD.rt.fallos = 0; if (!antes) bdRefrescar(); }
      if (estado === 'CHANNEL_ERROR' || estado === 'TIMED_OUT' || estado === 'CLOSED') {
        clearTimeout(BD.rt.reintento);
        const espera = Math.min(60000, 5000 * Math.pow(2, BD.rt.fallos++));
        if (document.querySelector('.crmB .wa-shell')) BD.rt.reintento = setTimeout(async () => {
          if (BD.rt.canal !== canal) return;
          const A = api() || {}; if (A.token && BD.rt.sb) { BD.rt.token = A.token; try { await BD.rt.sb.realtime.setAuth(A.token); } catch (e) {} }
          bdSuscribir();
        }, espera);
      }
    });
  }
  function bdRealtimeCerrar() {
    clearTimeout(BD.rt.reintento);
    const c = BD.rt.canal; BD.rt.canal = null; BD.rt.vivo = false;
    if (BD.rt.sb && c) { try { BD.rt.sb.removeChannel(c); } catch (e) {} }
  }
  // Al volver a la pestaña (iPhone suspende el socket en segundo plano): reconectar y ponerse al día.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || !document.querySelector('.crmB .wa-shell')) return;
    if (BD.rt.sb && !BD.rt.vivo) { BD.rt.fallos = 0; bdSuscribir(); } else bdRealtime();
    bdRefrescar();
  });
  window.addEventListener('online', () => {
    if (!document.querySelector('.crmB .wa-shell')) return;
    if (BD.rt.sb) { BD.rt.fallos = 0; bdSuscribir(); } else bdRealtime();
    bdRefrescar();
  });
  async function bdAbrir(id) {
    if (String(BD.sel) === String(id) && BD.msgs.length) return;
    if (!BD.cita || String(BD.cita.conv) !== String(id)) BD.cita = null;
    const l0 = document.getElementById('bdList'); if (l0 && !BD.sel) BD.listaScroll = l0.scrollTop;
    BD.sel = id; BD.msgs = []; BD.hayMas = false; BD.pegadoAbajo = true; BD.msgsEstado = 'cargando'; BD.nuevos = 0; BD.bq = ''; if (BD.grab) bdGrabFin(false); bdModoChat();
    await bdCargarMsgs(id);
    if (String(BD.sel) !== String(id)) return;
    const c = BD.convs.find(x => String(x.id) === String(id));
    if (c && c.no_leidos > 0) { c.no_leidos = 0; api().patch('crm_conversaciones', 'id=eq.' + id, { no_leidos: 0 }).catch(() => {}); }
    bdPintarLista();
    bdSyncMsgs(); bdAlFondo(); bdFirmar(); bdAltoVisual();
    const t = document.getElementById('bdTx'); if (t && window.innerWidth > 860) t.focus();
  }
  function uuid() { try { return crypto.randomUUID(); } catch (e) { return 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => (Math.random() * 16 | 0).toString(16)); } }
  async function bdEnviarCuerpo(body) {
    const b = apiBase();
    const r = await fetch(`${b.url}/functions/v1/crm-enviar`, { method: 'POST', headers: { apikey: b.key, Authorization: 'Bearer ' + b.tok, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.mensaje || ({ ventana_cerrada: 'Pasaron más de 24 horas: WhatsApp solo permite plantillas', canal_apagado: 'El canal está apagado', sin_configurar: 'Falta configurar Zernio en el servidor', sin_permiso: 'No tienes permiso para esta conversación', zernio_error: 'Zernio rechazó el envío', zernio_sin_respuesta: 'Zernio no respondió; revisa en el teléfono si salió' }[j.error]) || j.error || ('HTTP ' + r.status));
    return j;
  }
  // Envía un texto (con cita opcional). Si falla, la burbuja queda roja con «Reintentar» y el texto vuelve a la barra.
  async function bdMandar(texto, respondeA) {
    const conv = BD.sel, key = uuid();
    const temp = { id: 'tmp-' + key, _conv: conv, _desde: new Date(Date.now() - 1000).toISOString(), direccion: 'out', cuerpo: texto, estado: 'pendiente', created_at: new Date().toISOString(), tipo: 'texto', responde_a_id: respondeA || null };
    BD.msgs.push(temp); BD.pegadoAbajo = true; bdSyncMsgs(); bdAlFondo();
    try { await bdEnviarCuerpo({ conversacion_id: conv, texto: texto, idempotency_key: key, responde_a_id: respondeA || undefined }); }
    catch (e) {
      const msg = String(e.message || e);
      const t = BD.msgs.find(x => x.id === temp.id); if (t) { t.estado = 'fallido'; t.error = msg; }
      const tx = document.getElementById('bdTx');
      if (tx && !tx.value.trim() && String(BD.sel) === String(conv)) { tx.value = texto; BD.borr[conv] = texto; }
      toast('err', 'No se envió', msg);
    }
    if (String(BD.sel) === String(conv)) { await Promise.all([bdCargarMsgs(conv), BD.rt.vivo ? null : bdCargar()]); bdPintarParcial(); }
  }
  async function bdEnviar() {
    if (BD.enviando) return;
    const t = document.getElementById('bdTx'); const texto = t ? t.value.trim() : '';
    if (!texto || !BD.sel) return;
    BD.enviando = true;
    const cita = BD.cita && String(BD.cita.conv) === String(BD.sel) ? BD.cita.id : null;
    BD.cita = null; const cb = document.getElementById('bdCitaBar'); if (cb) cb.innerHTML = '';
    t.value = ''; t.style.height = 'auto'; BD.borr[BD.sel] = ''; bdGuardarBorr();
    try { await bdMandar(texto, cita); } finally { BD.enviando = false; }
  }
  async function bdReintentar(id) {
    const m = BD.msgs.find(x => String(x.id) === String(id)); if (!m || !m.cuerpo || BD.enviando) return;
    if (String(m.id).startsWith('tmp-')) BD.msgs = BD.msgs.filter(x => x !== m);
    const tx = document.getElementById('bdTx'); if (tx && tx.value.trim() === m.cuerpo) { tx.value = ''; BD.borr[BD.sel] = ''; }
    BD.enviando = true;
    try { await bdMandar(m.cuerpo, m.responde_a_id || null); } finally { BD.enviando = false; }
  }
  // ── Paridad Bayol, fase 2 (03-oct-2026) ─────────────────────────────────────────────────────────────────────────
  // Adjuntar: menú (foto/video, documento y, en WhatsApp, ubicación y contacto) → vista previa con pie de foto → burbuja
  // «Enviando…» al instante mientras sube; un toque doble no lo manda dos veces (clave de envío única).
  const LIM_MB = { imagen: 5, video: 16, audio: 16, documento: 20 };   // límites de WhatsApp (MB), iguales a Bayol
  function bdTipoArchivo(f) { return /^image\//.test(f.type) ? 'imagen' : /^video\//.test(f.type) ? 'video' : /^audio\//.test(f.type) ? 'audio' : 'documento'; }
  function bdAdjMenu(ev) {
    if (ev) ev.stopPropagation();
    let m = document.getElementById('bdAdjM'); if (m) { m.remove(); return; }
    const c = bdConvSel(), wa = c && c.plataforma === 'whatsapp';
    m = document.createElement('div'); m.id = 'bdAdjM'; m.className = 'bd-adj-menu'; m.setAttribute('role', 'menu');
    const it = (ic, col, tx, fn) => `<button type="button" role="menuitem" onclick="document.getElementById('bdAdjM').remove();${fn}"><span style="background:${col}"><i class="ti ${ic}"></i></span>${tx}</button>`;
    m.innerHTML = it('ti-photo', '#7c3aed', 'Foto o video', "document.getElementById('bdFile').click()") + it('ti-file-text', '#2563eb', 'Documento', "document.getElementById('bdFileDoc').click()")
      + (wa ? it('ti-map-pin', '#16a34a', 'Ubicación', 'window.nxCRM.bdUbicacion()') + it('ti-user-circle', '#0891b2', 'Contacto', 'window.nxCRM.bdContacto()') : '');
    document.body.appendChild(m);
    const b = (ev && ev.currentTarget) || document.querySelector('.bd-clip'), r = b ? b.getBoundingClientRect() : { left: 10, top: innerHeight - 60 };
    m.style.left = Math.max(8, Math.min(r.left, innerWidth - 220)) + 'px'; m.style.bottom = Math.max(8, innerHeight - r.top + 8) + 'px';
    setTimeout(() => document.addEventListener('pointerdown', function f(e) { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('pointerdown', f, true); } }, true), 0);
  }
  async function bdAdjuntar(inp) {
    const f = inp && inp.files && inp.files[0]; if (inp) inp.value = '';
    if (f) bdAdjPrevia(f);
  }
  function bdAdjPrevia(f) {
    if (!f || !BD.sel) return;
    const tipo = bdTipoArchivo(f), lim = LIM_MB[tipo];
    if (f.size > lim * 1024 * 1024) { toast('warn', 'Archivo muy grande', 'Máximo ' + lim + ' MB para ' + tipo); return; }
    const url = URL.createObjectURL(f), t = document.getElementById('bdTx');
    cerrar('bdAdjP');
    const ov = document.createElement('div'); ov.id = 'bdAdjP'; ov.className = 'overlay open';
    ov.addEventListener('click', ev => { if (ev.target === ov) { URL.revokeObjectURL(url); ov.remove(); } });
    const prev = tipo === 'imagen' ? `<img src="${url}" alt="Vista previa">` : tipo === 'video' ? `<video src="${url}" controls muted></video>` : tipo === 'audio' ? `<audio src="${url}" controls></audio>` : `<div class="bd-adj-doc"><i class="ti ti-file-text"></i><b>${esc(f.name)}</b><small>${(f.size / 1024 / 1024).toFixed(2)} MB</small></div>`;
    ov.innerHTML = `<div class="modal nxCrmModal bd-adj-modal" style="max-width:460px" role="dialog" aria-labelledby="bdAdjT"><div class="mt"><span id="bdAdjT"><i class="ti ti-paperclip"></i> Enviar ${tipo === 'imagen' ? 'foto' : tipo}</span><button class="nxBack" type="button" onclick="document.getElementById('bdAdjP').remove()"><i class="ti ti-arrow-left"></i> Volver</button></div>
      <div class="bd-adj-prev">${prev}</div>
      ${tipo === 'audio' ? '' : `<label class="nxCrmF"><span>${tipo === 'documento' ? 'Mensaje (opcional)' : 'Pie de foto (opcional)'}</span><textarea id="bdAdjTx" rows="2" maxlength="1000">${esc(t ? t.value : '')}</textarea></label>`}
      <button type="button" id="bdAdjOk" class="nxCrmBtn p" style="width:100%;margin-top:10px"><i class="ti ti-send"></i> Enviar</button></div>`;
    document.body.appendChild(ov);
    const ok = document.getElementById('bdAdjOk');
    ok.onclick = () => { if (ok.disabled) return; ok.disabled = true; const pie = (document.getElementById('bdAdjTx') || {}).value || ''; ov.remove(); bdSubirYEnviar(f, tipo, pie.trim(), url, false); };
  }
  async function bdSubirYEnviar(f, tipo, pie, urlLocal, notaVoz) {
    const conv = BD.sel; if (!conv) return;
    const key = uuid(), ext = ((f.name || '').split('.').pop() || (f.type.split('/')[1] || 'bin').split(';')[0]).replace(/[^a-z0-9]/gi, '').toLowerCase() || 'bin';
    const path = `salientes/${uuid()}.${ext}`, b = apiBase();
    const temp = { id: 'tmp-' + key, _conv: conv, direccion: 'out', tipo: tipo, cuerpo: pie || null, estado: 'pendiente', created_at: new Date().toISOString(), _local: urlLocal || URL.createObjectURL(f), _nombre: f.name };
    BD.msgs.push(temp); BD.pegadoAbajo = true; bdSyncMsgs(); bdAlFondo();
    const t = document.getElementById('bdTx'); if (pie && t && t.value.trim() === pie) { t.value = ''; BD.borr[conv] = ''; bdGuardarBorr(); }
    try {
      const up = await fetch(`${b.url}/storage/v1/object/crm-media/${path}`, { method: 'POST', headers: { apikey: b.key, Authorization: 'Bearer ' + b.tok, 'Content-Type': (f.type || 'application/octet-stream').split(';')[0] }, body: f });
      if (!up.ok) throw new Error('No se pudo subir el archivo');
      await bdEnviarCuerpo({ conversacion_id: conv, texto: pie, adjunto_path: path, adjunto_tipo: tipo, adjunto_nombre: f.name || null, nota_voz: !!notaVoz, idempotency_key: key });
      temp.media_path = path; temp.estado = 'enviado';
    } catch (e) {
      temp.estado = 'fallido'; temp.error = String(e.message || e); toast('err', notaVoz ? 'No se envió la nota de voz' : 'No se envió el archivo', temp.error);
    }
    if (String(BD.sel) === String(conv)) { bdSyncMsgs(); if (!BD.rt.vivo) { await bdCargarMsgs(conv); bdPintarParcial(); } }
  }
  // Arrastrar y soltar un archivo sobre el chat abierto = adjuntarlo (con vista previa).
  document.addEventListener('dragover', e => { if (BD.sel && e.target.closest && e.target.closest('.crmB #bdChat')) { e.preventDefault(); } });
  document.addEventListener('drop', e => {
    if (!BD.sel || !e.target.closest || !e.target.closest('.crmB #bdChat')) return;
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (!f) return;
    e.preventDefault(); const c = bdConvSel(), k = bdCanalDe(c);
    if (!k || !k.activo || !bdVentana(c)) { toast('warn', 'No se puede enviar ahora', 'El canal está apagado o pasaron 24 horas'); return; }
    bdAdjPrevia(f);
  });

  // ── Notas de voz (paridad Bayol): se graba en el navegador y WhatsApp la recibe como nota de voz (crm-enviar la manda
  // con voiceNote; Zernio la convierte, así también funciona lo que graba el iPhone).
  async function bdGrabar() {
    if (BD.grab) return;
    if (!navigator.mediaDevices || !window.MediaRecorder) { toast('err', 'Este navegador no puede grabar audio'); return; }
    let st;
    try { st = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch (e) { toast('err', 'Sin acceso al micrófono', 'Permite el micrófono para este sitio'); return; }
    const tipo = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(t => { try { return MediaRecorder.isTypeSupported(t); } catch (e) { return false; } }) || '';
    const rec = new MediaRecorder(st, tipo ? { mimeType: tipo } : undefined), partes = [];
    rec.ondataavailable = e => { if (e.data && e.data.size) partes.push(e.data); };
    const g = BD.grab = { rec, st, partes, t0: Date.now(), enviar: false, conv: BD.sel, tim: null };
    rec.onstop = () => {
      st.getTracks().forEach(x => x.stop()); clearInterval(g.tim);
      const bar = document.getElementById('bdGrab'); if (bar) bar.remove();
      const ib = document.querySelector('#bdPie .wa-input-bar'); if (ib) ib.hidden = false;
      BD.grab = null;
      if (!g.enviar || !partes.length) return;
      const mime = (rec.mimeType || tipo || 'audio/webm').split(';')[0];
      const ext = /ogg/.test(mime) ? 'ogg' : /mp4|aac|m4a/.test(mime) ? 'm4a' : 'webm';
      const f = new File(partes, 'nota-voz.' + ext, { type: mime });
      if ((Date.now() - g.t0) < 800) { toast('warn', 'Nota muy corta', 'Mantén la grabación al menos 1 segundo'); return; }
      if (String(BD.sel) === String(g.conv)) bdSubirYEnviar(f, 'audio', '', null, true);
    };
    rec.start(250);
    const ib = document.querySelector('#bdPie .wa-input-bar'); if (ib) ib.hidden = true;
    const bar = document.createElement('div'); bar.id = 'bdGrab'; bar.className = 'bd-grab';
    bar.innerHTML = `<button type="button" class="bd-grab-x" onclick="window.nxCRM.bdGrabFin(false)" aria-label="Cancelar grabación"><i class="ti ti-trash"></i></button><span class="bd-grab-pt"></span><span id="bdGrabT">0:00</span><span class="bd-grab-tx">Grabando…</span><button type="button" class="wa-send-btn" onclick="window.nxCRM.bdGrabFin(true)" aria-label="Enviar nota de voz"><i class="ti ti-send"></i></button>`;
    const pie = document.getElementById('bdPie'); if (pie) pie.appendChild(bar);
    g.tim = setInterval(() => { const s2 = Math.floor((Date.now() - g.t0) / 1000), e = document.getElementById('bdGrabT'); if (e) e.textContent = Math.floor(s2 / 60) + ':' + String(s2 % 60).padStart(2, '0'); if (s2 >= 300) bdGrabFin(true); }, 250);
  }
  function bdGrabFin(enviar) { const g = BD.grab; if (!g) return; g.enviar = !!enviar; try { g.rec.stop(); } catch (e) {} }

  // ── Ubicación y contacto (solo WhatsApp) ──
  function bdUbicacion() {
    cerrar('bdUbM');
    let tienda = null; try { tienda = JSON.parse(localStorage.getItem('studio_crm_ubic_tienda') || 'null'); } catch (e) {}
    const ov = document.createElement('div'); ov.id = 'bdUbM'; ov.className = 'overlay open';
    ov.addEventListener('click', ev => { if (ev.target === ov) ov.remove(); });
    ov.innerHTML = `<div class="modal nxCrmModal" style="max-width:420px" role="dialog" aria-labelledby="bdUbT"><div class="mt"><span id="bdUbT"><i class="ti ti-map-pin"></i> Enviar ubicación</span><button class="nxBack" type="button" onclick="document.getElementById('bdUbM').remove()"><i class="ti ti-arrow-left"></i> Volver</button></div>
      ${tienda ? `<button type="button" class="nxCrmBtn p" style="width:100%;margin-bottom:10px" onclick="window.nxCRM.bdUbEnviar(${+tienda.lat},${+tienda.lng},${JSON.stringify(tienda.nombre || 'STUDIO').replace(/"/g, '&quot;')})"><i class="ti ti-building-store"></i> Enviar ubicación de ${esc(tienda.nombre || 'la tienda')}</button>` : ''}
      <button type="button" class="nxCrmBtn" style="width:100%" onclick="window.nxCRM.bdUbAqui(this)"><i class="ti ti-current-location"></i> Usar mi ubicación actual</button>
      <div class="bd-ub-g"><label class="nxCrmF"><span>Latitud</span><input id="bdUbLat" inputmode="decimal" placeholder="18.4861"></label><label class="nxCrmF"><span>Longitud</span><input id="bdUbLng" inputmode="decimal" placeholder="-69.9312"></label></div>
      <label class="nxCrmF"><span>Nombre del lugar (opcional)</span><input id="bdUbNom" maxlength="120" placeholder="STUDIO RD"></label>
      <label class="crm-nota" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="bdUbGuardar"> Guardar como ubicación de la tienda (en este equipo)</label>
      <button type="button" class="nxCrmBtn p" style="width:100%;margin-top:10px" onclick="window.nxCRM.bdUbEnviar()"><i class="ti ti-send"></i> Enviar</button></div>`;
    document.body.appendChild(ov);
  }
  function bdUbAqui(btn) {
    if (!navigator.geolocation) { toast('err', 'Este equipo no comparte su ubicación'); return; }
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader-2 crm-girando"></i> Buscando…'; }
    navigator.geolocation.getCurrentPosition(p => {
      const a = document.getElementById('bdUbLat'), o = document.getElementById('bdUbLng');
      if (a) a.value = p.coords.latitude.toFixed(6); if (o) o.value = p.coords.longitude.toFixed(6);
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-current-location"></i> Usar mi ubicación actual'; }
    }, () => { toast('err', 'No se pudo obtener la ubicación', 'Permite la ubicación o escribe las coordenadas'); if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-current-location"></i> Usar mi ubicación actual'; } }, { enableHighAccuracy: true, timeout: 12000 });
  }
  async function bdUbEnviar(lat, lng, nombre) {
    if (lat === undefined) {
      lat = parseFloat(((document.getElementById('bdUbLat') || {}).value || '').replace(',', '.'));
      lng = parseFloat(((document.getElementById('bdUbLng') || {}).value || '').replace(',', '.'));
      nombre = ((document.getElementById('bdUbNom') || {}).value || '').trim();
      if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) { toast('warn', 'Coordenadas no válidas'); return; }
      if ((document.getElementById('bdUbGuardar') || {}).checked) { try { localStorage.setItem('studio_crm_ubic_tienda', JSON.stringify({ lat, lng, nombre: nombre || 'STUDIO' })); } catch (e) {} }
    }
    cerrar('bdUbM');
    await bdEnviarEspecial('ubicacion', { lat: lat, lng: lng, nombre: nombre || null });
  }
  function bdContacto() {
    cerrar('bdCtM');
    const ov = document.createElement('div'); ov.id = 'bdCtM'; ov.className = 'overlay open';
    ov.addEventListener('click', ev => { if (ev.target === ov) ov.remove(); });
    ov.innerHTML = `<div class="modal nxCrmModal" style="max-width:420px" role="dialog" aria-labelledby="bdCtT"><div class="mt"><span id="bdCtT"><i class="ti ti-user-circle"></i> Enviar contacto</span><button class="nxBack" type="button" onclick="document.getElementById('bdCtM').remove()"><i class="ti ti-arrow-left"></i> Volver</button></div>
      <label class="nxCrmF"><span>Buscar cliente</span><input id="bdCtQ" placeholder="Nombre o teléfono…" oninput="window.nxCRM.bdCtBuscar(this.value)"></label>
      <div id="bdCtL" class="crm-tr-lista"></div>
      <div class="bd-ub-g"><label class="nxCrmF"><span>Nombre</span><input id="bdCtNom" maxlength="120"></label><label class="nxCrmF"><span>Teléfono</span><input id="bdCtTel" inputmode="tel" maxlength="20"></label></div>
      <button type="button" class="nxCrmBtn p" style="width:100%;margin-top:10px" onclick="window.nxCRM.bdCtEnviar()"><i class="ti ti-send"></i> Enviar</button></div>`;
    document.body.appendChild(ov);
  }
  function bdCtBuscar(q) {
    const l = document.getElementById('bdCtL'); if (!l) return;
    q = String(q || '').trim().toLowerCase();
    if (q.length < 2) { l.innerHTML = ''; return; }
    const r = clientes().filter(c => [c.nombre, c.telefono, c.celular, c.whatsapp].join(' ').toLowerCase().indexOf(q) >= 0).slice(0, 8);
    l.innerHTML = r.length ? r.map(c => { const tel = c.whatsapp || c.celular || c.telefono || ''; return `<button type="button" class="crm-tr-emp" onclick="document.getElementById('bdCtNom').value=${JSON.stringify(c.nombre || '').replace(/"/g, '&quot;')};document.getElementById('bdCtTel').value=${JSON.stringify(tel).replace(/"/g, '&quot;')}"><span class="av">${esc(ini(c.nombre))}</span><span class="tx"><b>${esc(c.nombre || '')}</b><small>${esc(tel)}</small></span></button>`; }).join('') : '<div class="crm-nota">Ningún cliente coincide.</div>';
  }
  async function bdCtEnviar() {
    const nombre = ((document.getElementById('bdCtNom') || {}).value || '').trim(), tel = ((document.getElementById('bdCtTel') || {}).value || '').trim();
    if (!nombre) { toast('warn', 'Pon el nombre del contacto'); return; }
    cerrar('bdCtM');
    await bdEnviarEspecial('contacto', { nombre: nombre, telefono: tel || null });
  }
  async function bdEnviarEspecial(tipo, dato) {
    const conv = BD.sel; if (!conv) return;
    const key = uuid();
    const temp = { id: 'tmp-' + key, _conv: conv, direccion: 'out', tipo: tipo, cuerpo: JSON.stringify(dato), estado: 'pendiente', created_at: new Date().toISOString() };
    BD.msgs.push(temp); BD.pegadoAbajo = true; bdSyncMsgs(); bdAlFondo();
    try { await bdEnviarCuerpo(Object.assign({ conversacion_id: conv, idempotency_key: key }, tipo === 'ubicacion' ? { ubicacion: dato } : { contacto: dato })); temp.estado = 'enviado'; }
    catch (e) { temp.estado = 'fallido'; temp.error = String(e.message || e); toast('err', 'No se envió', temp.error); }
    if (String(BD.sel) === String(conv)) bdSyncMsgs();
  }

  // ── Menú de cada mensaje: responder, copiar, reenviar ──
  function bdMsgMenu(ev, id) {
    if (ev) ev.stopPropagation();
    const m = BD.msgs.find(x => String(x.id) === String(id)); if (!m) return;
    cerrar('bdMsgM');
    const c = bdConvSel(), texto = m.tipo === 'ubicacion' || m.tipo === 'contacto' ? '' : (m.cuerpo || '');
    const reenv = (texto || (m.media_path && String(m.media_path).startsWith('salientes/')));
    const mm = document.createElement('div'); mm.id = 'bdMsgM'; mm.className = 'bd-adj-menu bd-msg-menu'; mm.setAttribute('role', 'menu');
    const it = (ic, tx, fn) => `<button type="button" role="menuitem" onclick="document.getElementById('bdMsgM').remove();${fn}"><i class="ti ${ic}"></i>${tx}</button>`;
    mm.innerHTML = (bdPuedeCitar(c) ? it('ti-arrow-back-up', 'Responder', `window.nxCRM.bdCitar('${esc(m.id)}')`) : '')
      + (texto ? it('ti-copy', 'Copiar', `window.nxCRM.bdCopiar('${esc(m.id)}')`) : '')
      + (reenv ? it('ti-share-3', 'Reenviar', `window.nxCRM.bdReenviar('${esc(m.id)}')`) : '')
      + (m.media_path && bdUrl(m.media_path) ? it('ti-download', 'Abrir / descargar', `window.open(${JSON.stringify(bdUrl(m.media_path)).replace(/"/g, '&quot;')},'_blank','noopener')`) : '');
    if (!mm.innerHTML) return;
    document.body.appendChild(mm);
    const b = ev && ev.currentTarget, r = b ? b.getBoundingClientRect() : { left: innerWidth / 2, bottom: innerHeight / 2, top: innerHeight / 2 };
    mm.style.left = Math.max(8, Math.min(r.left - 150, innerWidth - 210)) + 'px';
    if (r.bottom + 180 < innerHeight) mm.style.top = (r.bottom + 4) + 'px'; else mm.style.bottom = (innerHeight - r.top + 4) + 'px';
    setTimeout(() => document.addEventListener('pointerdown', function f(e) { if (!mm.contains(e.target)) { mm.remove(); document.removeEventListener('pointerdown', f, true); } }, true), 0);
  }
  async function bdCopiar(id) {
    const m = BD.msgs.find(x => String(x.id) === String(id)); if (!m || !m.cuerpo) return;
    try { await navigator.clipboard.writeText(m.cuerpo); toast('ok', 'Copiado'); }
    catch (e) { const t = document.createElement('textarea'); t.value = m.cuerpo; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); toast('ok', 'Copiado'); } catch (e2) {} t.remove(); }
  }
  function bdReenviar(id) {
    const m = BD.msgs.find(x => String(x.id) === String(id)); if (!m) return;
    BD.reenv = m; cerrar('bdReM');
    const ov = document.createElement('div'); ov.id = 'bdReM'; ov.className = 'overlay open';
    ov.addEventListener('click', ev => { if (ev.target === ov) ov.remove(); });
    ov.innerHTML = `<div class="modal nxCrmModal" style="max-width:420px" role="dialog" aria-labelledby="bdReT"><div class="mt"><span id="bdReT"><i class="ti ti-share-3"></i> Reenviar a…</span><button class="nxBack" type="button" onclick="document.getElementById('bdReM').remove()"><i class="ti ti-arrow-left"></i> Volver</button></div>
      <div class="crm-nota">${esc(bdResumen(m).slice(0, 120))}</div>
      <label class="nxCrmF"><span>Buscar conversación</span><input id="bdReQ" placeholder="Nombre o número…" oninput="window.nxCRM.bdReFiltrar(this.value)"></label>
      <div id="bdReL" class="crm-tr-lista"></div></div>`;
    document.body.appendChild(ov); bdReFiltrar('');
  }
  function bdReFiltrar(q) {
    const l = document.getElementById('bdReL'); if (!l) return;
    q = String(q || '').trim().toLowerCase();
    const r = BD.convs.filter(c => String(c.id) !== String(BD.sel) && bdVentana(c) && (!q || [bdNombre(c), c.telefono_e164, c.contacto_usuario].join(' ').toLowerCase().indexOf(q) >= 0)).slice(0, 30);
    l.innerHTML = r.length ? r.map(c => `<button type="button" class="crm-tr-emp" onclick="window.nxCRM.bdReEnviarA('${esc(c.id)}')"><span class="av">${esc(ini(bdNombre(c)))}</span><span class="tx"><b>${esc(bdNombre(c))}</b><small>${esc(c.telefono_e164 || (c.contacto_usuario ? '@' + c.contacto_usuario : ''))}</small></span><i class="ti ti-send"></i></button>`).join('') : '<div class="crm-nota">No hay conversaciones abiertas (dentro de las 24 h) que coincidan.</div>';
  }
  async function bdReEnviarA(convId) {
    const m = BD.reenv; if (!m) return; cerrar('bdReM');
    const body = { conversacion_id: convId, idempotency_key: uuid(), texto: m.tipo === 'ubicacion' || m.tipo === 'contacto' ? '' : (m.cuerpo || '') };
    if (m.media_path && String(m.media_path).startsWith('salientes/')) { body.adjunto_path = m.media_path; body.adjunto_tipo = m.tipo; }
    try { await bdEnviarCuerpo(body); toast('ok', 'Mensaje reenviado'); } catch (e) { toast('err', 'No se pudo reenviar', String(e.message || e)); }
  }

  // ── Buscar dentro del chat (mensajes cargados; «Cargar anteriores» amplía la búsqueda) ──
  function bdBuscarChat() {
    const bx = document.getElementById('bdBusqChat'); if (!bx) return;
    if (!bx.hidden) { BD.bq = ''; bx.hidden = true; bx.innerHTML = ''; bdBqMarcar(); return; }
    bx.hidden = false;
    bx.innerHTML = `<i class="ti ti-search"></i><input id="bdBqIn" placeholder="Buscar en este chat…" oninput="window.nxCRM.bdBq(this.value)" onkeydown="if(event.key==='Enter'){event.preventDefault();window.nxCRM.bdBqIr(event.shiftKey?-1:1)}if(event.key==='Escape')window.nxCRM.bdBuscarChat()"><span id="bdBqN"></span><button type="button" onclick="window.nxCRM.bdBqIr(-1)" aria-label="Anterior"><i class="ti ti-chevron-up"></i></button><button type="button" onclick="window.nxCRM.bdBqIr(1)" aria-label="Siguiente"><i class="ti ti-chevron-down"></i></button><button type="button" onclick="window.nxCRM.bdBuscarChat()" aria-label="Cerrar búsqueda"><i class="ti ti-x"></i></button>`;
    setTimeout(() => { const i = document.getElementById('bdBqIn'); if (i) i.focus(); }, 30);
  }
  function bdBqHits() {
    const q = BD.bq.trim().toLowerCase(); if (!q) return [];
    return BD.msgs.filter(m => !String(m.id).startsWith('tmp-') && String(bdResumen(m)).toLowerCase().indexOf(q) >= 0).map(m => String(m.id));
  }
  function bdBqMarcar() {
    const box = document.getElementById('bdMsgs'); if (!box) return;
    const hits = bdBqHits(), set = new Set(hits), cur = hits.length ? hits[Math.max(0, Math.min(BD.bqI, hits.length - 1))] : null;
    box.querySelectorAll(':scope > .bd-m').forEach(n => { n.classList.toggle('bd-hit', set.has(n.dataset.id)); n.classList.toggle('bd-hit-on', n.dataset.id === cur); });
    const nn = document.getElementById('bdBqN'); if (nn) nn.textContent = BD.bq.trim() ? (hits.length ? (Math.min(BD.bqI, hits.length - 1) + 1) + '/' + hits.length : '0') : '';
  }
  function bdBq(v) { BD.bq = v || ''; const h = bdBqHits(); BD.bqI = Math.max(0, h.length - 1); bdBqMarcar(); bdBqIr(0); }
  function bdBqIr(d) {
    const h = bdBqHits(); if (!h.length) { bdBqMarcar(); return; }
    BD.bqI = (BD.bqI + d + h.length) % h.length; bdBqMarcar();
    const n = document.querySelector(`#bdMsgs .bd-m[data-id="${CSS.escape(h[BD.bqI])}"]`); if (n) n.scrollIntoView({ block: 'center' });
  }
  function bdNuevos(n) {
    BD.nuevos = Math.max(0, n | 0);
    const e = document.querySelector('#bdAbajo .bd-nuevos'); if (e) { e.textContent = BD.nuevos > 99 ? '99+' : BD.nuevos || ''; e.hidden = !BD.nuevos; }
  }

  // ── Paridad Bayol, fase 3 (03-oct-2026): menú del chat, etiquetas, ficha del contacto, respuestas rápidas «/» ──────
  const ETIQ_SUG = ['Interesado', 'Cotizado', 'Financiamiento', 'Reparación', 'Garantía', 'Seguimiento', 'Vendido'];
  function bdSilenciada(c) { return !!(c && c.silenciado_hasta && Date.parse(c.silenciado_hasta) > Date.now()); }
  function bdConvPorId(id) { return BD.convs.find(x => String(x.id) === String(id)); }
  function bdChatMenu(ev, id) {
    if (ev) { ev.preventDefault && ev.preventDefault(); ev.stopPropagation && ev.stopPropagation(); }
    const c = bdConvPorId(id || BD.sel); if (!c) return;
    cerrar('bdChM');
    const sil = bdSilenciada(c);
    const mm = document.createElement('div'); mm.id = 'bdChM'; mm.className = 'bd-adj-menu bd-msg-menu'; mm.setAttribute('role', 'menu');
    const it = (ic, tx, fn) => `<button type="button" role="menuitem" onclick="document.getElementById('bdChM').remove();${fn}"><i class="ti ${ic}"></i>${tx}</button>`;
    mm.innerHTML = it('ti-id-badge-2', 'Ficha del contacto', `window.nxCRM.bdFicha('${c.id}')`)
      + (c.no_leidos > 0 ? '' : it('ti-mail', 'Marcar como no leído', `window.nxCRM.bdNoLeido('${c.id}')`))
      + it(c.fijado_at ? 'ti-pinned-off' : 'ti-pin', c.fijado_at ? 'Quitar fijado' : 'Fijar arriba', `window.nxCRM.bdFijar('${c.id}')`)
      + (sil ? it('ti-bell', 'Quitar silencio', `window.nxCRM.bdSilenciar('${c.id}',0)`)
        : it('ti-bell-off', 'Silenciar 8 horas', `window.nxCRM.bdSilenciar('${c.id}',8)`) + it('ti-bell-off', 'Silenciar 1 semana', `window.nxCRM.bdSilenciar('${c.id}',168)`) + it('ti-bell-off', 'Silenciar siempre', `window.nxCRM.bdSilenciar('${c.id}',-1)`))
      + it('ti-tags', 'Etiquetas', `window.nxCRM.bdEtiquetas('${c.id}')`)
      + (c.archivada ? it('ti-archive-off', 'Devolver a la bandeja', `window.nxCRM.bdDesarchivar('${c.id}')`) : it('ti-archive', 'Archivar', `window.nxCRM.bdArchivar('${c.id}')`));
    document.body.appendChild(mm);
    const x = ev && (ev.clientX || (ev.touches && ev.touches[0] && ev.touches[0].clientX)), y = ev && (ev.clientY || (ev.touches && ev.touches[0] && ev.touches[0].clientY));
    const b = ev && ev.currentTarget && ev.currentTarget.getBoundingClientRect ? ev.currentTarget.getBoundingClientRect() : null;
    const px = x || (b ? b.right - 200 : innerWidth / 2 - 100), py = y || (b ? b.bottom + 4 : innerHeight / 3);
    mm.style.left = Math.max(8, Math.min(px, innerWidth - 220)) + 'px'; mm.style.top = Math.max(8, Math.min(py, innerHeight - mm.offsetHeight - 8)) + 'px';
    setTimeout(() => document.addEventListener('pointerdown', function f(e) { if (!mm.contains(e.target)) { mm.remove(); document.removeEventListener('pointerdown', f, true); } }, true), 0);
  }
  async function bdNoLeido(id) {
    if (!(await bdPatch(id, { no_leidos: 1 }, 'Marcada como no leída'))) return;
    if (String(BD.sel) === String(id)) window.nxCRM.bdCerrar();
  }
  async function bdFijar(id) { const c = bdConvPorId(id); if (!c) return; if (await bdPatch(id, { fijado_at: c.fijado_at ? null : new Date().toISOString() }, c.fijado_at ? 'Ya no está fijada' : 'Conversación fijada')) { bdOrdenar(); bdPintarLista(); } }
  async function bdSilenciar(id, horas) {
    const v = horas === 0 ? null : horas < 0 ? '2999-12-31T00:00:00Z' : new Date(Date.now() + horas * 3600e3).toISOString();
    if (await bdPatch(id, { silenciado_hasta: v }, v ? 'Conversación silenciada' : 'Silencio quitado')) bdPintarLista();
  }
  function bdEtiquetas(id) {
    const c = bdConvPorId(id); if (!c) return;
    BD.etqSel = new Set(c.etiquetas || []); BD.etqConv = id;
    cerrar('bdEtM');
    const todas = [...new Set(ETIQ_SUG.concat(...BD.convs.map(x => x.etiquetas || [])))];
    const ov = document.createElement('div'); ov.id = 'bdEtM'; ov.className = 'overlay open';
    ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
    ov.innerHTML = `<div class="modal nxCrmModal" style="max-width:420px" role="dialog" aria-labelledby="bdEtT"><div class="mt"><span id="bdEtT"><i class="ti ti-tags"></i> Etiquetas de ${esc(bdNombre(c))}</span><button class="nxBack" type="button" onclick="document.getElementById('bdEtM').remove()"><i class="ti ti-arrow-left"></i> Volver</button></div>
      <div id="bdEtL" class="bd-etq-l">${todas.map(t => `<button type="button" class="nxCrmChip${BD.etqSel.has(t) ? ' on' : ''}" onclick="window.nxCRM.bdEtqTog(this,${JSON.stringify(t).replace(/"/g, '&quot;')})">${esc(t)}</button>`).join('')}</div>
      <label class="nxCrmF"><span>Nueva etiqueta</span><input id="bdEtN" maxlength="30" placeholder="Escribe y pulsa Enter" onkeydown="if(event.key==='Enter'){event.preventDefault();window.nxCRM.bdEtqNueva(this)}"></label>
      <button type="button" class="nxCrmBtn p" style="width:100%;margin-top:10px" onclick="window.nxCRM.bdEtqGuardar()"><i class="ti ti-check"></i> Guardar</button></div>`;
    document.body.appendChild(ov);
  }
  function bdEtqTog(b, t) { if (BD.etqSel.has(t)) BD.etqSel.delete(t); else BD.etqSel.add(t); b.classList.toggle('on', BD.etqSel.has(t)); }
  function bdEtqNueva(inp) {
    const t = String(inp.value || '').trim().slice(0, 30); if (!t) return; inp.value = '';
    const ex = [...BD.etqSel].concat(ETIQ_SUG).find(x => x.toLowerCase() === t.toLowerCase());
    if (ex) { BD.etqSel.add(ex); } else BD.etqSel.add(t);
    const l = document.getElementById('bdEtL'); if (!l) return;
    if (!ex || ![...l.children].some(x => x.textContent === ex)) { const nb = document.createElement('button'); nb.type = 'button'; nb.className = 'nxCrmChip on'; nb.textContent = ex || t; nb.onclick = () => bdEtqTog(nb, ex || t); l.appendChild(nb); }
    else [...l.children].forEach(x => { if (x.textContent === ex) x.classList.add('on'); });
  }
  async function bdEtqGuardar() {
    const id = BD.etqConv; cerrar('bdEtM');
    if (await bdPatch(id, { etiquetas: [...BD.etqSel].slice(0, 12) }, 'Etiquetas guardadas')) bdPintarLista();
  }
  // Ficha del contacto: datos, cliente (vincular o crear), etiquetas, archivos y enlaces del chat.
  function bdFicha(id) {
    const c = bdConvPorId(id); if (!c) return;
    const p = PLAT[c.plataforma] || PLAT.whatsapp, cli = cliDe(c.cliente_id), abierto = String(BD.sel) === String(id);
    const tel = c.telefono_e164 && !String(c.contacto_id).startsWith('bsid:') ? c.telefono_e164 : '';
    const media = abierto ? BD.msgs.filter(m => m.media_path && !String(m.id).startsWith('tmp-')) : [];
    const fotos = media.filter(m => m.tipo === 'imagen' && bdUrl(m.media_path)).slice(-12).reverse();
    const docs = media.filter(m => m.tipo !== 'imagen').slice(-10).reverse();
    const links = abierto ? [...new Set(BD.msgs.flatMap(m => String(m.cuerpo || '').match(/\bhttps?:\/\/[^\s<]+/gi) || []))].slice(-8).reverse() : [];
    cerrar('bdFiM');
    const ov = document.createElement('div'); ov.id = 'bdFiM'; ov.className = 'overlay open';
    ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
    ov.innerHTML = `<div class="modal nxCrmModal bd-ficha" style="max-width:440px" role="dialog" aria-labelledby="bdFiT"><div class="mt"><span id="bdFiT"><i class="ti ti-id-badge-2"></i> Ficha del contacto</span><button class="nxBack" type="button" onclick="document.getElementById('bdFiM').remove()"><i class="ti ti-arrow-left"></i> Volver</button></div>
      <div class="bd-fi-cab"><div class="wa-avatar">${esc(ini(bdNombre(c)))}</div><div><b>${esc(bdNombre(c))}</b><small><i class="ti ${p[1]}" style="color:${p[2]}"></i> ${p[0]}${c.contacto_usuario ? ' · @' + esc(c.contacto_usuario) : ''}</small></div></div>
      ${tel ? `<div class="bd-fi-f"><span>Teléfono</span><b>${esc(tel)}</b><button type="button" class="btn-mini" onclick="navigator.clipboard&&navigator.clipboard.writeText(${JSON.stringify(tel).replace(/"/g, '&quot;')});window.nxCRM.bdToast('Número copiado')"><i class="ti ti-copy"></i> Copiar</button></div>` : ''}
      <div class="bd-fi-f"><span>Cliente</span>${cli ? `<b>${esc(cli.nombre)}</b>` : `<i>Sin vincular</i><button type="button" class="btn-mini" onclick="document.getElementById('bdFiM').remove();window.nxCRM.bdCliente('${c.id}')"><i class="ti ti-link"></i> Vincular</button><button type="button" class="btn-mini" onclick="window.nxCRM.bdCrearCliente('${c.id}')"><i class="ti ti-user-plus"></i> Crear cliente</button>`}</div>
      <div class="bd-fi-f"><span>Atiende</span><b>${esc(c.asignado_nombre || 'Sin asignar')}</b></div>
      <div class="bd-fi-f"><span>Etiquetas</span><span class="bd-fi-etq">${(c.etiquetas || []).map(t => `<em>${esc(t)}</em>`).join('') || '<i>Ninguna</i>'}</span><button type="button" class="btn-mini" onclick="document.getElementById('bdFiM').remove();window.nxCRM.bdEtiquetas('${c.id}')"><i class="ti ti-tags"></i> Editar</button></div>
      ${abierto ? `<div class="ajSep bd-fi-sep">Archivos del chat</div>${fotos.length ? `<div class="bd-fi-fotos">${fotos.map(m => `<a href="${esc(bdUrl(m.media_path))}" target="_blank" rel="noopener"><img src="${esc(bdUrl(m.media_path))}" alt="Foto"></a>`).join('')}</div>` : ''}${docs.length ? docs.map(m => `<div class="bd-fi-doc"><i class="ti ${m.tipo === 'audio' ? 'ti-microphone' : m.tipo === 'video' ? 'ti-video' : 'ti-file-text'}"></i>${bdUrl(m.media_path) ? `<a href="${esc(bdUrl(m.media_path))}" target="_blank" rel="noopener">${esc(bdResumen(m).slice(0, 60))}</a>` : esc(bdResumen(m).slice(0, 60))}<small>${dmy(m.created_at)}</small></div>`).join('') : ''}${!fotos.length && !docs.length ? '<div class="crm-nota">Sin archivos en los mensajes cargados.</div>' : ''}
        ${links.length ? `<div class="ajSep bd-fi-sep">Enlaces</div>${links.map(u => `<div class="bd-fi-doc"><i class="ti ti-link"></i><a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(u.slice(0, 60))}</a></div>`).join('')}` : ''}` : ''}
    </div>`;
    document.body.appendChild(ov);
  }
  async function bdCrearCliente(id) {
    const c = bdConvPorId(id); if (!c) return;
    const sug = c.contacto_nombre || '';
    // Dueño 05-oct-2026 («que sean la misma plataforma»): el cliente se crea con la ficha de Entidades, con el nombre y
    // el teléfono del chat ya escritos; al guardarla queda vinculado a la conversación.
    const ficha = ctx().abrirFichaCliente;
    if (ficha) {
      let t0 = String(c.telefono_e164 || '').replace(/\D/g, ''); if (t0.length === 11 && t0[0] === '1') t0 = t0.slice(1);
      cerrar('bdFiM');
      ficha({ nombre: sug, telefono: t0.length === 10 ? t0 : '' }, async function (cli) {
        if (!cli || !cli.id) return;
        try { await bdPatch(id, { cliente_id: cli.id }, 'Cliente vinculado: ' + cli.nombre); } catch (e) { toast('err', 'No se pudo vincular el cliente', String((e && e.message) || e)); }
      });
      return;
    }
    const cr = ctx().crearCliente; if (!cr) { toast('err', 'No disponible', 'Actualiza la página'); return; }
    const nombre = (window.prompt('Nombre completo del cliente:', sug) || '').trim(); if (!nombre) return;
    let tel = String(c.telefono_e164 || '').replace(/\D/g, ''); if (tel.length === 11 && tel[0] === '1') tel = tel.slice(1);
    try {
      const cli = await cr({ nombre: nombre, telefono: tel.length === 10 ? tel : null });
      if (!cli || !cli.id) throw new Error('sin id');
      cerrar('bdFiM');
      await bdPatch(id, { cliente_id: cli.id }, cli._existia ? 'Vinculado al cliente que ya existía: ' + cli.nombre : 'Cliente creado y vinculado');
    } catch (e) { toast('err', 'No se pudo crear el cliente', String((e && e.message) || e)); }
  }
  // Respuestas rápidas: escribe «/» y el atajo. {nombre} se cambia por el nombre del cliente.
  async function bdRRCargar(forzar) {
    if (BD.rr && !forzar) return BD.rr;
    try { BD.rr = await api().get('crm_respuestas_rapidas', 'select=*&order=atajo.asc') || []; } catch (e) { BD.rr = BD.rr || []; }
    return BD.rr;
  }
  function bdRRCerrar() { const p = document.getElementById('bdRRP'); if (p) p.remove(); BD.rrSel = 0; }
  async function bdRR(t) {
    const v = String(t.value || '');
    if (!/^\/[a-z0-9_-]*$/i.test(v)) { bdRRCerrar(); return; }
    const lista = await bdRRCargar(), q = v.slice(1).toLowerCase();
    const r = lista.filter(x => !q || x.atajo.indexOf(q) === 0 || x.texto.toLowerCase().indexOf(q) >= 0).slice(0, 8);
    let p = document.getElementById('bdRRP');
    if (!p) { p = document.createElement('div'); p.id = 'bdRRP'; p.className = 'bd-adj-menu bd-rr'; p.setAttribute('role', 'listbox'); document.body.appendChild(p); }
    BD.rrVis = r; BD.rrSel = Math.min(BD.rrSel || 0, Math.max(0, r.length - 1));
    p.innerHTML = (r.length ? r.map((x, i) => `<button type="button" role="option" class="${i === BD.rrSel ? 'on' : ''}" onmousedown="event.preventDefault()" onclick="window.nxCRM.bdRRUsar(${i})"><b>/${esc(x.atajo)}</b><span>${esc(x.texto.slice(0, 90))}</span></button>`).join('') : '<div class="crm-nota" style="padding:6px 10px">No hay respuestas con ese atajo.</div>')
      + '<button type="button" class="bd-rr-adm" onmousedown="event.preventDefault()" onclick="window.nxCRM.bdRRAdmin()"><i class="ti ti-settings"></i> Administrar respuestas rápidas</button>';
    const rc = t.getBoundingClientRect(), w = Math.min(380, innerWidth - 16);
    p.style.width = w + 'px'; p.style.left = Math.max(8, Math.min(rc.left, innerWidth - w - 8)) + 'px'; p.style.bottom = Math.max(8, innerHeight - rc.top + 8) + 'px';
  }
  function bdRRKey(ev) {
    const p = document.getElementById('bdRRP'); if (!p || !BD.rrVis) return false;
    if (ev.key === 'Escape') { bdRRCerrar(); return true; }
    if (!BD.rrVis.length) return false;
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); BD.rrSel = (BD.rrSel + (ev.key === 'ArrowDown' ? 1 : -1) + BD.rrVis.length) % BD.rrVis.length; const t = document.getElementById('bdTx'); if (t) bdRR(t); return true; }
    if (ev.key === 'Enter' || ev.key === 'Tab') { ev.preventDefault(); bdRRUsar(BD.rrSel); return true; }
    return false;
  }
  function bdRRUsar(i) {
    const x = (BD.rrVis || [])[i], t = document.getElementById('bdTx'); if (!x || !t) return;
    const c = bdConvSel(), nom = c ? String(bdNombre(c)).split(/\s+/)[0] : '';
    t.value = x.texto.replace(/\{nombre\}/gi, /^[\d+]/.test(nom) ? '' : nom).replace(/\s{2,}/g, ' ');
    bdRRCerrar(); if (BD.sel) { BD.borr[BD.sel] = t.value; bdGuardarBorr(); }
    t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 120) + 'px'; t.focus();
  }
  async function bdRRAdmin() {
    bdRRCerrar(); cerrar('bdRRM');
    const lista = await bdRRCargar(true);
    const ov = document.createElement('div'); ov.id = 'bdRRM'; ov.className = 'overlay open';
    ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
    ov.innerHTML = `<div class="modal nxCrmModal" style="max-width:460px" role="dialog" aria-labelledby="bdRRT"><div class="mt"><span id="bdRRT"><i class="ti ti-bolt"></i> Respuestas rápidas</span><button class="nxBack" type="button" onclick="document.getElementById('bdRRM').remove()"><i class="ti ti-arrow-left"></i> Volver</button></div>
      <p class="crm-nota">En el chat escribe <b>/</b> y el atajo. <b>{nombre}</b> se cambia por el nombre del cliente.</p>
      <div class="crm-tr-lista">${lista.length ? lista.map(x => `<div class="bd-rr-fila"><b>/${esc(x.atajo)}</b><span>${esc(x.texto)}</span><button type="button" class="btn-mini" onclick="window.nxCRM.bdRRBorrar('${x.id}')" aria-label="Borrar /${esc(x.atajo)}"><i class="ti ti-trash"></i></button></div>`).join('') : '<div class="crm-nota">Todavía no hay respuestas rápidas.</div>'}</div>
      <div class="bd-ub-g"><label class="nxCrmF"><span>Atajo</span><input id="bdRRA" maxlength="24" placeholder="precio" autocapitalize="none"></label><label class="nxCrmF" style="grid-column:span 1"><span>&nbsp;</span><span class="crm-nota" style="margin:0">minúsculas, sin espacios</span></label></div>
      <label class="nxCrmF"><span>Texto</span><textarea id="bdRRX" rows="3" maxlength="1000" placeholder="Hola {nombre}, …"></textarea></label>
      <button type="button" class="nxCrmBtn p" style="width:100%;margin-top:10px" onclick="window.nxCRM.bdRRGuardar()"><i class="ti ti-plus"></i> Agregar</button></div>`;
    document.body.appendChild(ov);
  }
  async function bdRRGuardar() {
    const a = String((document.getElementById('bdRRA') || {}).value || '').trim().toLowerCase().replace(/^\//, ''), x = String((document.getElementById('bdRRX') || {}).value || '').trim();
    if (!/^[a-z0-9_-]{1,24}$/.test(a)) { toast('warn', 'Atajo no válido', 'Solo minúsculas, números, - o _ (sin espacios)'); return; }
    if (!x) { toast('warn', 'Escribe el texto'); return; }
    try { await api().post('crm_respuestas_rapidas', { atajo: a, texto: x }); toast('ok', 'Respuesta rápida guardada', '/' + a); bdRRAdmin(); }
    catch (e) { toast('err', 'No se pudo guardar', /duplicate|23505|unique/i.test(String(e && e.message)) ? 'Ese atajo ya existe' : errTxt(e)); }
  }
  async function bdRRBorrar(id) {
    if (!confirm('¿Borrar esta respuesta rápida?')) return;
    try { await api().del('crm_respuestas_rapidas', 'id=eq.' + id); bdRRAdmin(); } catch (e) { toast('err', 'No se pudo borrar', errTxt(e)); }
  }
  // Mantener pulsada una conversación de la lista (iPhone) o clic derecho (computadora) = su menú.
  (function () {
    let tm = null, ini0 = null;
    document.addEventListener('contextmenu', e => { const r = e.target.closest && e.target.closest('#bdList .wa-row'); if (!r) return; bdChatMenu(e, r.dataset.id); });
    document.addEventListener('touchstart', e => { const r = e.target.closest && e.target.closest('#bdList .wa-row'); if (!r || e.touches.length !== 1) return; ini0 = { x: e.touches[0].clientX, y: e.touches[0].clientY }; clearTimeout(tm); tm = setTimeout(() => { tm = null; r._lp = Date.now(); bdChatMenu({ clientX: ini0.x, clientY: ini0.y }, r.dataset.id); }, 520); }, { passive: true });
    document.addEventListener('touchmove', e => { if (!tm || !ini0) return; const t = e.touches[0]; if (Math.abs(t.clientX - ini0.x) > 10 || Math.abs(t.clientY - ini0.y) > 10) { clearTimeout(tm); tm = null; } }, { passive: true });
    document.addEventListener('touchend', () => { clearTimeout(tm); tm = null; }, { passive: true });
    // El toque que suelta una pulsación larga no abre el chat.
    document.addEventListener('click', e => { const r = e.target.closest && e.target.closest('#bdList .wa-row'); if (r && r._lp && Date.now() - r._lp < 700) { e.stopPropagation(); e.preventDefault(); r._lp = 0; } }, true);
  })();

  // ── Sincronizar conversaciones (28-sep-2026): trae de Zernio los chats y mensajes que ya existían antes de conectar la
  // bandeja (historial del WhatsApp Business del teléfono e Instagram). No duplica, no crea leads, no marca no leídos.
  async function bdSincronizar() {
    if (BD.sincronizando) return;
    if (!confirm('¿Sincronizar las conversaciones de WhatsApp e Instagram? Se traen los chats y mensajes anteriores que guarda Zernio. No se envía nada a los clientes.')) return;
    BD.sincronizando = true; BD.sincParar = false;
    cerrar('bdSincM');
    const ov = document.createElement('div'); ov.id = 'bdSincM'; ov.className = 'overlay open';
    ov.innerHTML = `<div class="modal nxCrmModal" style="max-width:440px"><div class="mt"><span><i class="ti ti-cloud-download"></i> Sincronizar conversaciones</span></div><div id="bdSincTx" class="bd-sinc">Preparando…</div><div class="bd-sinc-barra"><i id="bdSincBar"></i></div><p class="crm-nota">No cierres esta ventana. Puede tardar unos minutos si hay muchos chats.</p><button type="button" id="bdSincParar" class="btn-mini" style="align-self:flex-end" onclick="window.nxCRM.bdSincParar(this)"><i class="ti ti-player-stop"></i> Detener</button></div>`;
    document.body.appendChild(ov);
    const tx = t => { const e = document.getElementById('bdSincTx'); if (e) e.innerHTML = t; };
    const b = apiBase();
    const llamar = async (body) => {
      const r = await fetch(`${b.url}/functions/v1/crm-sincronizar`, { method: 'POST', headers: { apikey: b.key, Authorization: 'Bearer ' + b.tok, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({})); if (!r.ok || !j.ok) throw new Error(j.mensaje || j.error || ('HTTP ' + r.status)); return j;
    };
    const tot = { chats: 0, nuevos: 0, leidos: 0 };
    try {
      const { canales } = await llamar({});
      if (!canales || !canales.length) throw new Error('No hay canales encendidos');
      for (let ci = 0; ci < canales.length; ci++) {
        const cn = canales[ci], nom = (PLAT[cn.plataforma] || PLAT.whatsapp)[0];
        let cursor = null, vueltas = 0;
        do {
          tx(`<b>${esc(nom)}</b> (${ci + 1} de ${canales.length})<br>${tot.chats} chats revisados · ${tot.nuevos} mensajes nuevos`);
          const bar = document.getElementById('bdSincBar'); if (bar) bar.style.width = Math.min(95, ((ci + Math.min(vueltas, 9) / 10) / canales.length) * 100) + '%';
          const j = await llamar({ canal_id: cn.id, cursor: cursor, limit: 8 });
          tot.chats += j.chats || 0; tot.nuevos += j.mensajes_nuevos || 0; tot.leidos += j.mensajes_leidos || 0;
          cursor = j.siguiente_cursor || null; vueltas++;
        } while (cursor && vueltas < 500 && document.getElementById('bdSincM') && !BD.sincParar);
        if (BD.sincParar) break;
      }
      const bar = document.getElementById('bdSincBar'); if (bar) bar.style.width = '100%';
      tx(`<b>${BD.sincParar ? 'Detenido.' : 'Listo.'}</b><br>${tot.chats} chats revisados · <b>${tot.nuevos}</b> mensajes nuevos traídos.`);
      toast('ok', 'Conversaciones sincronizadas', tot.nuevos + ' mensajes nuevos');
    } catch (e) { tx(`<b>No se pudo terminar:</b> ${esc(String(e.message || e))}<br>Lo que ya se trajo queda guardado; puedes volver a intentarlo.`); }
    BD.sincronizando = false;
    const pr = document.getElementById('bdSincParar'); if (pr) pr.remove();
    const m = document.querySelector('#bdSincM .modal'); if (m) m.insertAdjacentHTML('beforeend', `<button type="button" class="bd-btn-plant" style="align-self:flex-end" onclick="document.getElementById('bdSincM').remove()">Cerrar</button>`);
    await bdCargar(); if (BD.sel) await bdCargarMsgs(BD.sel); bdPintarParcial();
  }

  // ── Plantillas (ventana de 24 h cerrada): lista las APROBADAS de la línea, rellena variables con vista previa y envía.
  async function bdPlantillas() {
    const c = BD.convs.find(x => String(x.id) === String(BD.sel)); if (!c) return;
    cerrar('bdPlantM');
    const ov = document.createElement('div'); ov.id = 'bdPlantM'; ov.className = 'overlay open';
    ov.addEventListener('click', ev => { if (ev.target === ov) ov.remove(); });
    ov.innerHTML = `<div class="modal nxCrmModal bd-plant-m"><div class="mt"><span><i class="ti ti-template"></i> Enviar plantilla</span><button class="nxBack" type="button" onclick="document.getElementById('bdPlantM').remove()"><i class="ti ti-arrow-left"></i> Cerrar</button></div><div id="bdPlantCuerpo" class="bd-plant-cuerpo"><div class="crm-vacio">Cargando plantillas aprobadas…</div></div></div>`;
    document.body.appendChild(ov);
    let lista = [];
    try {
      const b = apiBase();
      const r = await fetch(`${b.url}/functions/v1/crm-enviar`, { method: 'POST', headers: { apikey: b.key, Authorization: 'Bearer ' + b.tok, 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'plantillas', conversacion_id: c.id }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.mensaje || j.error || ('HTTP ' + r.status));
      lista = (j.plantillas || []).filter(t => !t.encabezado_media);   // las de encabezado con foto/video se envían desde Zernio
    } catch (e) { const cu = document.getElementById('bdPlantCuerpo'); if (cu) cu.innerHTML = `<div class="crm-vacio">No se pudieron cargar las plantillas: ${esc(String(e.message || e))}</div>`; return; }
    BD.plant = { lista: lista, sel: null, conv: c.id };
    bdPlantPintar();
  }
  function bdPlantTexto(t, vals) {
    let tx = String(t.cuerpo || '');
    t.variables.forEach(v => { tx = tx.split('{{' + v + '}}').join(vals[v] || '{{' + v + '}}'); });
    return (t.encabezado ? t.encabezado + '\n\n' : '') + tx + (t.pie ? '\n\n' + t.pie : '');
  }
  function bdPlantPintar() {
    const cu = document.getElementById('bdPlantCuerpo'); if (!cu || !BD.plant) return;
    const P = BD.plant, c = BD.convs.find(x => String(x.id) === String(P.conv));
    if (!P.lista.length) { cu.innerHTML = '<div class="crm-vacio">Esta línea todavía no tiene plantillas aprobadas por Meta.</div>'; return; }
    if (P.sel === null) {
      cu.innerHTML = P.lista.map((t, i) => `<button type="button" class="bd-plant-item" onclick="window.nxCRM.bdPlantElegir(${i})"><b>${esc(String(t.nombre).replace(/_/g, ' '))}</b><small>${esc(t.categoria || '')} · ${esc(t.idioma || '')}</small><span>${esc(String(t.cuerpo || '').slice(0, 160))}</span></button>`).join('');
      return;
    }
    const t = P.lista[P.sel];
    if (!P.vals) { P.vals = {}; t.variables.forEach((v, i) => { P.vals[v] = i === 0 && c ? bdNombre(c) : ''; }); }
    const campos = t.variables.map((v, i) => `<label class="nxCrmF"><span>${/^\d+$/.test(v) ? 'Variable ' + v : esc(v.replace(/_/g, ' '))}${t.ejemplos && t.ejemplos[i] ? ' · ej.: ' + esc(t.ejemplos[i]) : ''}</span><input type="text" value="${esc(P.vals[v] || '')}" oninput="window.nxCRM.bdPlantVar(${i}, this.value)"></label>`).join('');
    cu.innerHTML = `<button type="button" class="btn-mini" onclick="window.nxCRM.bdPlantElegir(null)"><i class="ti ti-arrow-left"></i> Otras plantillas</button>
      <div class="bd-plant-sel"><b>${esc(String(t.nombre).replace(/_/g, ' '))}</b></div>${campos}
      <div class="bd-plant-prev"><small>Así la verá el cliente</small><div id="bdPlantPrev" class="tx">${esc(bdPlantTexto(t, P.vals))}</div></div>
      <button type="button" class="bd-btn-plant bd-plant-enviar" onclick="window.nxCRM.bdPlantEnviar(this)"><i class="ti ti-send"></i> Enviar plantilla</button>`;
  }
  async function bdPlantEnviar(btn) {
    const P = BD.plant; if (!P || P.sel === null) return;
    const t = P.lista[P.sel];
    const falta = t.variables.filter(v => !String(P.vals[v] || '').trim());
    if (falta.length) { toast('warn', 'Completa las variables', 'Falta: ' + falta.join(', ')); return; }
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader-2"></i> Enviando…'; }
    const plantilla = { nombre: t.nombre, idioma: t.idioma };
    if (t.nombradas) plantilla.variablesNombradas = t.variables.map(v => ({ param_name: v, text: String(P.vals[v]).trim() }));
    else plantilla.variables = t.variables.map(v => String(P.vals[v]).trim());
    try {
      await bdEnviarCuerpo({ conversacion_id: P.conv, idempotency_key: uuid(), texto: bdPlantTexto(t, P.vals).slice(0, 3900), plantilla: plantilla });
      cerrar('bdPlantM'); BD.plant = null; toast('ok', 'Plantilla enviada');
    } catch (e) { toast('err', 'No se envió la plantilla', String(e.message || e)); if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-send"></i> Enviar plantilla'; } return; }
    if (String(BD.sel) === String(P.conv)) { BD.pegadoAbajo = true; await Promise.all([bdCargarMsgs(P.conv), BD.rt.vivo ? null : bdCargar()]); bdPintarParcial(); bdAlFondo(); }
  }

  // ── iPhone: el chat ocupa exactamente el alto visible, también con el teclado abierto (visualViewport), como en Bayol.
  function bdAltoVisual() {
    const sh = document.querySelector('.crmB .wa-shell'); if (!sh) return;
    const movil = window.innerWidth <= 860 && sh.classList.contains('con-chat');
    if (!movil) { sh.style.removeProperty('height'); return; }
    const vv = window.visualViewport, top = sh.getBoundingClientRect().top;
    const visible = vv ? vv.offsetTop + vv.height : window.innerHeight;
    sh.style.height = Math.max(260, Math.round(visible - top)) + 'px';
    if (BD.pegadoAbajo) bdAlFondo();
  }
  function bdTeclado() { bdAltoVisual(); requestAnimationFrame(bdAltoVisual); setTimeout(bdAltoVisual, 80); setTimeout(bdAltoVisual, 350); }
  if (window.visualViewport) { window.visualViewport.addEventListener('resize', bdAltoVisual); window.visualViewport.addEventListener('scroll', bdAltoVisual); }
  window.addEventListener('resize', bdAltoVisual);
  window.addEventListener('orientationchange', () => setTimeout(bdAltoVisual, 300));
  async function bdPatch(id, body, ok) {
    try {
      const r = await api().patch('crm_conversaciones', 'id=eq.' + id, body); const fila = Array.isArray(r) ? r[0] : r;
      const c = BD.convs.find(x => String(x.id) === String(id)); if (c) Object.assign(c, fila && fila.id ? fila : body);
      if (ok) toast('ok', ok);
      bdPintarLista(); bdPintarCabPie(true);
      return true;
    } catch (e) { toast('err', 'No se pudo', errTxt(e)); return false; }
  }

  // ── Transferir cliente (dueño 03-oct-2026): pasar la conversación a otro empleado con nota y aviso, sin que el cliente
  // tenga que volver a escribir. Todo lo valida el servidor (crm_transferir_conversacion, migración 44): solo se ofrece a
  // empleados activos con la Bandeja y ese canal; el que la recibe queda asignado y la ve aunque antes no la viera.
  const TR = { conv: null, lista: [], elegido: null, q: '', cargando: false, mias: [] };
  async function trContar() {
    if (!perm().bandeja) return;
    try { const l = await api().post('rpc/crm_mis_transferencias', {}); TR.mias = Array.isArray(l) ? l : []; } catch (e) { return; }
    FN.trPend = TR.mias.filter(t => !t.visto_at && t.sigue_mia).length;
    const b = document.getElementById('crmTrBadge'); if (b) { b.textContent = FN.trPend || ''; b.hidden = !FN.trPend; }
  }
  function trFilasHTML() {
    if (TR.cargando) return '<div class="crm-nota">Cargando empleados…</div>';
    const q = TR.q.trim().toLowerCase();
    const l = TR.lista.filter(u => !q || String(u.nom || '').toLowerCase().indexOf(q) >= 0);
    if (!l.length) return `<div class="crm-nota">${TR.lista.length ? 'Nadie coincide con la búsqueda.' : 'No hay otro empleado con este canal. El administrador lo activa en Ajustes → Equipo.'}</div>`;
    return l.map(u => `<button type="button" class="crm-tr-emp${String(TR.elegido) === String(u.id) ? ' on' : ''}" onclick="window.nxCRM.trElegir('${u.id}')"><span class="av">${esc(ini(u.nom))}</span><span class="tx"><b>${esc(u.nom || '')}</b><small>${esc(u.rol || '')}</small></span><i class="ti ti-check"></i></button>`).join('');
  }
  async function trAbrir(id) {
    const c = BD.convs.find(x => String(x.id) === String(id)); if (!c) return;
    TR.conv = id; TR.lista = []; TR.elegido = null; TR.q = ''; TR.cargando = true;
    cerrar('crmTrM');
    const ov = document.createElement('div'); ov.id = 'crmTrM'; ov.className = 'overlay open';
    ov.addEventListener('click', ev => { if (ev.target === ov) ov.remove(); });
    ov.innerHTML = `<div class="modal nxCrmModal crm-tr-modal" style="max-width:420px" role="dialog" aria-labelledby="crmTrT">
      <div class="mt"><span id="crmTrT"><i class="ti ti-arrows-exchange"></i> Transferir a ${esc(bdNombre(c))}</span><button class="nxBack" type="button" onclick="document.getElementById('crmTrM').remove()"><i class="ti ti-arrow-left"></i> Volver</button></div>
      <p class="crm-nota">El empleado que elijas lo atiende desde el mismo ${esc((PLAT[c.plataforma] || PLAT.whatsapp)[0])}. El cliente no tiene que volver a escribir.</p>
      <label class="nxCrmF"><span>Buscar empleado</span><input id="crmTrQ" placeholder="Nombre…" oninput="window.nxCRM.trBuscar(this.value)"></label>
      <div id="crmTrL" class="crm-tr-lista">${trFilasHTML()}</div>
      <label class="nxCrmF"><span>Nota para tu compañero (opcional)</span><textarea id="crmTrNota" rows="2" maxlength="500" placeholder="Ej.: quiere el iPhone 15 a crédito, ya le envié precios"></textarea></label>
      <button type="button" id="crmTrOk" class="nxCrmBtn p" style="width:100%;margin-top:10px" disabled onclick="window.nxCRM.trConfirmar()"><i class="ti ti-send"></i> Transferir</button>
    </div>`;
    document.body.appendChild(ov);
    try { const l = await api().post('rpc/crm_empleados_transferir', { p_conv: id }); TR.lista = Array.isArray(l) ? l : []; }
    catch (e) { TR.lista = []; toast('err', 'No se pudieron cargar los empleados', errTxt(e)); }
    TR.cargando = false; trPintar();
  }
  function trPintar() {
    const l = document.getElementById('crmTrL'); if (l) l.innerHTML = trFilasHTML();
    const b = document.getElementById('crmTrOk'); if (b) b.disabled = !TR.elegido;
  }
  async function trConfirmar() {
    if (!TR.conv || !TR.elegido) return;
    const b = document.getElementById('crmTrOk'); if (b) { b.disabled = true; b.innerHTML = '<i class="ti ti-loader-2 crm-girando"></i> Transfiriendo…'; }
    const nota = (document.getElementById('crmTrNota') || {}).value || '';
    try {
      const r = await api().post('rpc/crm_transferir_conversacion', { p_conv: TR.conv, p_a: TR.elegido, p_nota: nota });
      cerrar('crmTrM');
      toast('ok', 'Cliente transferido', 'Ahora lo atiende ' + ((r && r.a_nombre) || 'tu compañero'));
      const id = TR.conv, u = TR.lista.find(x => String(x.id) === String(TR.elegido));
      const c = BD.convs.find(x => String(x.id) === String(id));
      if (!esAdmin()) {   // ya no es suya: sale de su lista
        BD.convs = BD.convs.filter(x => String(x.id) !== String(id));
        if (String(BD.sel) === String(id)) { BD.sel = null; BD.msgs = []; bdModoChat(); }
        bdPintarLista();
      } else if (c) { c.asignado_id = TR.elegido; c.asignado_nombre = u ? u.nom : c.asignado_nombre; bdPintarLista(); bdPintarCabPie(true); }
    } catch (e) {
      const m = String((e && e.message) || e);
      toast('err', 'No se pudo transferir', /CRM_SIN_TRANSFERIR/.test(m) ? 'Tu usuario no puede transferir clientes. Pídeselo al administrador.' : /CRM_EMPLEADO_NO_VALIDO/.test(m) ? 'Ese empleado no atiende este canal' : /CRM_SIN_PERMISO_CONVERSACION/.test(m) ? 'Esta conversación ya no es tuya' : errTxt(e));
      if (b) { b.disabled = false; b.innerHTML = '<i class="ti ti-send"></i> Transferir'; }
    }
  }
  async function trBandeja() {
    cerrar('crmTrBM');
    const ov = document.createElement('div'); ov.id = 'crmTrBM'; ov.className = 'overlay open';
    ov.addEventListener('click', ev => { if (ev.target === ov) ov.remove(); });
    ov.innerHTML = `<div class="modal nxCrmModal" style="max-width:440px" role="dialog" aria-labelledby="crmTrBT"><div class="mt"><span id="crmTrBT"><i class="ti ti-arrows-transfer-down"></i> Transferidos a mí</span><button class="nxBack" type="button" onclick="document.getElementById('crmTrBM').remove()"><i class="ti ti-arrow-left"></i> Cerrar</button></div><div id="crmTrBL" class="crm-tr-lista"><div class="crm-nota">Cargando…</div></div></div>`;
    document.body.appendChild(ov);
    await trContar();
    const l = document.getElementById('crmTrBL'); if (!l) return;
    l.innerHTML = TR.mias.length ? TR.mias.map((t, i) => {
      const p = PLAT[t.plataforma] || PLAT.whatsapp;
      return `<button type="button" class="crm-tr-item${t.visto_at ? '' : ' nuevo'}${t.sigue_mia ? '' : ' fuera'}" onclick="window.nxCRM.trIr(${i})"${t.sigue_mia ? '' : ' disabled'}>
        <i class="ti ${p[1]}" style="color:${p[2]}"></i><span class="tx"><b>${esc(t.cliente || 'Cliente')}</b><small>De ${esc(t.de_nombre || 'un compañero')} · ${bdHora(t.created_at)}${t.sigue_mia ? '' : ' · ya no está asignado a ti'}</small>${t.nota ? `<em>“${esc(t.nota)}”</em>` : ''}</span>${t.visto_at ? '' : '<span class="pt" aria-label="Nuevo"></span>'}</button>`;
    }).join('') : '<div class="crm-nota">No te han transferido clientes en los últimos 7 días.</div>';
  }
  async function trIr(i) {
    const t = TR.mias[i]; if (!t || !t.sigue_mia) return;
    cerrar('crmTrBM');
    if (!t.visto_at) { t.visto_at = new Date().toISOString(); api().post('rpc/crm_transferencia_vista', { p_id: t.id }).catch(() => {}); FN.trPend = Math.max(0, FN.trPend - 1); }
    const k = t.plataforma === 'whatsapp' ? 'mensajes' : 'redes';
    if (k === 'redes') BD.red = t.plataforma;
    S.vista = k; BD.linea = ''; BD.filtro = 'todos'; BD.asig = 'todas'; BD.q = ''; BD.sel = null; BD.msgs = []; BD.cargandoLista = true;
    repintar();
    await bdCargar();
    if (!BD.convs.some(c => String(c.id) === String(t.conversacion_id))) {
      try { const r = await api().get('crm_conversaciones', 'select=*&id=eq.' + t.conversacion_id); if (r && r[0]) { BD.convs.unshift(r[0]); bdOrdenar(); } } catch (e) {}
    }
    BD.listaHTML = ''; repintar();
    if (BD.convs.some(c => String(c.id) === String(t.conversacion_id))) bdAbrir(t.conversacion_id);
    else toast('err', 'No se pudo abrir la conversación', 'Puede que ya no esté asignada a ti');
  }
  function trAviso(ev) {
    const t = ev && ev.new; if (!t) return;
    toast('info', 'Te transfirieron un cliente', (t.de_nombre || 'Un compañero') + (t.nota ? ': ' + t.nota : ''));
    trContar(); bdRefrescar();
  }

  // ── Estilos ────────────────────────────────────────────────────────
  function ensureCSS() {
    if (document.getElementById('nxCrmCSS')) return;
    const st = document.createElement('style'); st.id = 'nxCrmCSS';
    st.textContent = `
.nxCrmBtn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:38px;padding:0 14px;border-radius:10px;border:1px solid var(--c-line);background:#fff;color:var(--c-ink);font-weight:600;font-size:13px;line-height:1;font-family:inherit;cursor:pointer;white-space:nowrap}
.nxCrmBtn.p{background:var(--c-ink);color:#fff;border-color:var(--c-ink)}.nxCrmBtn.sm{min-height:30px;padding:0 10px;font-size:12px}.nxCrmBtn.del{color:#b91c1c;width:42px;padding:0}
.nxCrmBtn:focus-visible,.nxCrmChip:focus-visible,.nxCrmCard:focus-visible,.nxCrmEt:focus-visible{outline:2px solid var(--c-gold);outline-offset:2px}
.nxCrmChip{height:32px;padding:0 12px;border-radius:999px;border:1px solid var(--c-line);background:#fff;font-weight:600;font-size:12.5px;font-family:inherit;color:var(--c-ink);cursor:pointer;white-space:nowrap}.nxCrmChip.on{background:var(--c-ink);color:#fff;border-color:var(--c-ink)}
.nxCrm .chk,.nxCrmFicha .chk{border:0;background:none;font-size:20px;cursor:pointer;color:var(--c-ink,#111);padding:0 4px 0 0;line-height:1;vertical-align:middle}
.nxCrmModal{--c-ink:var(--studio-ink,#111);--c-mute:var(--studio-steel,#5b5951);--c-line:var(--studio-hair,rgba(0,0,0,.1));--c-gold:var(--studio-gold,#c9a227);color:var(--c-ink)}
.nxCrmFicha{max-width:720px;width:100%;max-height:92vh;display:flex;flex-direction:column}.nxCrmFicha .mt small{font-size:11px;color:var(--c-mute);font-weight:600}.nxCrmFB{overflow-y:auto;flex:1;display:flex;flex-direction:column;gap:12px;padding-bottom:6px}
.nxCrmEts{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none}.nxCrmEt{flex:1;min-width:max-content;display:inline-flex;align-items:center;justify-content:center;gap:5px;height:36px;padding:0 10px;border:1px solid var(--c-line);border-radius:10px;background:#fff;font-weight:600;font-size:12px;font-family:inherit;color:var(--c-ink);cursor:pointer}
.nxCrmEt.on{background:var(--c-ink);color:#fff;border-color:var(--c-ink)}.nxCrmEt.e-ganado.on{background:#15803d;border-color:#15803d}.nxCrmEt.e-perdido.on{background:#b91c1c;border-color:#b91c1c}
.nxCrmLost{font-size:12.5px;color:#b91c1c;background:rgba(185,28,28,.07);border-radius:10px;padding:8px 10px}
.nxCrmSec{border:1px solid var(--c-line);border-radius:14px;padding:12px;display:flex;flex-direction:column;gap:10px}.nxCrmSec h4{font-size:13px}
.nxCrmSec .g2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.nxCrmF{display:flex;flex-direction:column;gap:4px;min-width:0}.nxCrmF>span{font-size:11px;font-weight:600;color:var(--c-mute)}
.nxCrmF input,.nxCrmF select,.nxCrmF textarea,.nxCrmComp textarea,.nxCrmDocs select,.nxCrmComp .venc input,.nxCrmComp .venc select{width:100%;box-sizing:border-box;min-height:38px;border:1px solid var(--c-line);border-radius:10px;padding:8px 10px;font-size:14px;font-family:inherit;background:#fff;color:var(--c-ink);text-transform:none}
.nxCrmF textarea,.nxCrmComp textarea{resize:vertical}
.nxCrmF .tel{display:flex;gap:6px}.nxCrmF .tel .wa{flex:none;width:38px;display:inline-flex;align-items:center;justify-content:center;border-radius:10px;border:1px solid var(--c-line);color:#15803d;font-size:18px;text-decoration:none}
.nxCrmPick{min-height:38px;border:1px solid var(--c-line);border-radius:10px;background:#fff;display:flex;align-items:center;gap:8px;padding:0 10px;font-size:14px;font-family:inherit;color:var(--c-ink);cursor:pointer;text-align:left;overflow:hidden}.nxCrmPick span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
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
.bd-emoji-panel{position:fixed;z-index:9999;max-height:min(46vh,320px);overflow-y:auto;background:#fff;border:1px solid rgba(0,0,0,.1);border-radius:16px;box-shadow:0 12px 32px rgba(15,23,42,.22);padding:8px;overscroll-behavior:contain}
.bd-emoji-g b{display:block;font-size:11px;font-weight:700;color:#64748b;margin:6px 4px 2px}.bd-emoji-g>div{display:grid;grid-template-columns:repeat(8,1fr)}
.bd-emoji-g button{border:0;background:none;font-size:22px;line-height:1;padding:6px 0;border-radius:8px;cursor:pointer}.bd-emoji-g button:hover{background:#f1f5f9}
.fila-borr{color:#16a34a;font-weight:700}.bd-nodisp{color:#64748b}.bd-aviso-red24{display:flex;gap:6px;align-items:flex-start;font-size:12.5px}
.rs-filtros{margin-left:auto}.wa-bubble-wrap .tx a{color:#0b6bcb;text-decoration:underline;overflow-wrap:anywhere}
.bd-adj-menu{position:fixed;z-index:9999;min-width:200px;background:#fff;border:1px solid rgba(0,0,0,.1);border-radius:14px;box-shadow:0 12px 32px rgba(15,23,42,.22);padding:6px;display:flex;flex-direction:column}
.bd-adj-menu button{display:flex;align-items:center;gap:10px;border:0;background:none;padding:9px 10px;border-radius:10px;font:inherit;font-size:14px;color:#0f172a;cursor:pointer;text-align:left}.bd-adj-menu button:hover{background:#f1f5f9}
.bd-adj-menu button span{width:30px;height:30px;border-radius:50%;display:grid;place-items:center;color:#fff}.bd-msg-menu button i{font-size:18px;color:#475569}
.bd-adj-prev{display:grid;place-items:center;background:#0f172a0d;border-radius:12px;margin:8px 0;min-height:120px;overflow:hidden}.bd-adj-prev img,.bd-adj-prev video{max-width:100%;max-height:46vh;display:block}
.bd-adj-doc{display:flex;flex-direction:column;align-items:center;gap:4px;padding:18px}.bd-adj-doc i{font-size:40px;color:#2563eb}.bd-adj-modal textarea{resize:vertical;min-height:50px;font:inherit;font-size:14px;padding:8px 10px;border-radius:10px;border:1px solid rgba(0,0,0,.15)}
.bd-subiendo{font-size:11.5px;color:#64748b;margin-top:4px}.bd-card{display:flex;gap:10px;align-items:center;padding:8px 10px;border-radius:10px;background:rgba(0,0,0,.05);color:inherit;text-decoration:none;min-width:200px}.bd-card>i{font-size:26px;color:#16a34a}.bd-card span{display:flex;flex-direction:column}.bd-card small,.bd-card a{font-size:12px;color:#0b6bcb}
.bd-grab{display:flex;align-items:center;gap:10px;padding:8px 10px}.bd-grab-x{border:0;background:none;font-size:20px;color:#dc2626;cursor:pointer}.bd-grab-pt{width:10px;height:10px;border-radius:50%;background:#dc2626;animation:bdLate 1s infinite}.bd-grab-tx{flex:1;color:#64748b;font-size:13px}#bdGrabT{font-variant-numeric:tabular-nums;font-weight:600}
@keyframes bdLate{50%{opacity:.25}}@media (prefers-reduced-motion:reduce){.bd-grab-pt{animation:none}}
.bd-ub-g{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:8px 0}
.wa-bubble-wrap{position:relative}.bd-mmenu{position:absolute;top:2px;right:2px;border:0;background:rgba(255,255,255,.85);border-radius:50%;width:24px;height:24px;display:grid;place-items:center;cursor:pointer;opacity:0;transition:opacity .15s;z-index:2}
.wa-bubble-wrap:hover .bd-mmenu,.bd-mmenu:focus-visible{opacity:1}@media (hover:none){.bd-mmenu{opacity:.55}}
.bd-busq-chat{display:flex;align-items:center;gap:6px;padding:6px 10px;border-bottom:1px solid rgba(0,0,0,.08);background:#fff}.bd-busq-chat[hidden]{display:none}.bd-busq-chat input{flex:1;min-width:0;border:0;outline:0;font:inherit;font-size:16px;background:transparent}.bd-busq-chat button{border:0;background:none;font-size:18px;cursor:pointer;color:#475569}#bdBqN{font-size:12px;color:#64748b;font-variant-numeric:tabular-nums}
.bd-m.bd-hit .wa-bubble-wrap{box-shadow:0 0 0 2px rgba(250,204,21,.6)}.bd-m.bd-hit-on .wa-bubble-wrap{box-shadow:0 0 0 3px #f59e0b}
.bd-abajo{position:relative}.bd-nuevos{position:absolute;top:-6px;right:-6px;min-width:18px;height:18px;border-radius:999px;background:#16a34a;color:#fff;font-size:10.5px;font-weight:800;line-height:18px;padding:0 4px}.bd-nuevos[hidden]{display:none}
.fila-ic{font-size:13px;color:#64748b;margin-right:4px;vertical-align:-1px}.fila-etq{display:flex;gap:4px;flex-wrap:wrap;margin-top:2px}.fila-etq em,.bd-fi-etq em{font-style:normal;font-size:10.5px;font-weight:700;padding:1px 7px;border-radius:999px;background:#fef3c7;color:#92400e}
.bd-etq-l{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 10px}.bd-etq-l .nxCrmChip.on{background:#111;color:#fff}
.bd-fi-cab{display:flex;gap:12px;align-items:center;margin-bottom:10px}.bd-fi-cab b{display:block;font-size:16px}.bd-fi-cab small{color:#64748b}
.bd-fi-f{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 0;border-bottom:1px solid rgba(0,0,0,.06);font-size:13.5px}.bd-fi-f>span:first-child{width:76px;color:#64748b;font-size:12px}.bd-fi-etq{display:flex;gap:4px;flex-wrap:wrap;flex:1}
.bd-fi-sep{margin-top:14px}.bd-fi-fotos{display:grid;grid-template-columns:repeat(4,1fr);gap:4px}.bd-fi-fotos img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px;display:block}
.bd-fi-doc{display:flex;gap:8px;align-items:center;padding:6px 0;font-size:13px}.bd-fi-doc a{color:#0b6bcb;overflow-wrap:anywhere;flex:1}.bd-fi-doc small{color:#64748b}
.bd-rr button{flex-direction:column;align-items:flex-start;gap:1px}.bd-rr button.on{background:#f1f5f9}.bd-rr button span{font-size:12.5px;color:#475569}.bd-rr .bd-rr-adm{flex-direction:row;color:#2563eb;font-size:13px;border-top:1px solid rgba(0,0,0,.06);border-radius:0 0 10px 10px}
.bd-rr-fila{display:flex;gap:8px;align-items:flex-start;padding:8px;border:1px solid rgba(0,0,0,.08);border-radius:10px}.bd-rr-fila span{flex:1;font-size:13px;white-space:pre-wrap}
.crm-tr-btn{position:relative}.crm-tr-badge{position:absolute;top:-3px;right:-3px;min-width:17px;height:17px;padding:0 4px;border-radius:999px;background:#e31e24;color:#fff;font-size:10px;font-weight:800;line-height:17px;text-align:center}.crm-tr-badge[hidden]{display:none}
.crm-tr-lista{display:flex;flex-direction:column;gap:6px;max-height:min(46vh,340px);overflow-y:auto;margin:8px 0;overscroll-behavior:contain}
.crm-tr-emp,.crm-tr-item{display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:9px 10px;border-radius:12px;border:1px solid var(--c-line);background:#fff;color:var(--c-ink);font-family:inherit;cursor:pointer}
.crm-tr-emp .av{flex:none;width:32px;height:32px;border-radius:50%;display:grid;place-items:center;background:#111;color:#fff;font-size:12px;font-weight:700}
.crm-tr-emp .tx,.crm-tr-item .tx{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}.crm-tr-emp .tx b,.crm-tr-item .tx b{font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.crm-tr-emp .tx small,.crm-tr-item .tx small{font-size:11.5px;color:var(--c-mute)}.crm-tr-item .tx em{font-size:12px;color:var(--c-ink);font-style:normal;opacity:.8;overflow-wrap:anywhere}
.crm-tr-emp>i{color:var(--c-gold);opacity:0}.crm-tr-emp.on{border-color:var(--c-gold);box-shadow:0 0 0 2px rgba(201,162,39,.25)}.crm-tr-emp.on>i{opacity:1}
.crm-tr-item>i{font-size:20px;flex:none}.crm-tr-item.nuevo{border-color:var(--c-gold)}.crm-tr-item .pt{flex:none;width:9px;height:9px;border-radius:50%;background:#e31e24}.crm-tr-item.fuera{opacity:.55;cursor:default}
.crm-tr-modal textarea{resize:vertical;min-height:54px;font-family:inherit;font-size:13px;padding:8px 10px;border-radius:10px;border:1px solid var(--c-line)}
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
.crmB .crm-selector-option{width:100%;display:flex;align-items:center;gap:8px;border:0;border-radius:9px;padding:9px 10px;background:transparent;color:#334155;font-weight:600;font-size:12.5px;font-family:inherit;text-align:left;cursor:pointer}
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
.crmB .wa-input-bar textarea{flex:1;border:1px solid transparent;border-radius:22px;padding:10px 16px;font-size:13.5px;line-height:1.35;font-family:inherit;min-width:0;margin:0 6px;background:#fff;color:#111b21;box-shadow:0 1px 2px rgba(11,20,26,.08);outline:none;resize:none;min-height:40px;max-height:120px}
.crmB .wa-input-bar textarea:focus{border-color:#128C7E;box-shadow:0 0 0 3px rgba(18,140,126,.13)}
.crmB .wa-clip{width:40px;height:40px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;font-size:20px;color:#54656f;flex:none}.crmB .wa-clip input{display:none}
.crmB .wa-send-btn{width:40px;height:40px;border-radius:50%;background:#128C7E;border:none;color:#fff;font-size:17px;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 3px rgba(7,94,84,.35)}.crmB .wa-send-btn:hover{background:#0e7c6f}
.crmB .wa-aviso{padding:12px 16px;background:#fffbeb;color:#92400e;font-size:12.5px;border-top:1px solid #fde68a}
.crmB .bd-aviso-24{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;padding-bottom:max(12px,env(safe-area-inset-bottom))}
.bd-btn-plant{display:inline-flex;align-items:center;gap:6px;background:#128C7E;color:#fff;border:0;border-radius:999px;padding:8px 14px;font-weight:700;font-size:12.5px;font-family:inherit;cursor:pointer;white-space:nowrap}.bd-btn-plant:disabled{opacity:.6}
.crmB .wa-chat-col{position:relative}
.crmB .bd-m{display:flex;flex-direction:column;gap:6px}
.crmB .bd-m.bd-flash .wa-bubble-wrap{animation:bdFlash 1.2s ease}
@keyframes bdFlash{0%,60%{box-shadow:0 0 0 3px rgba(18,140,126,.55)}100%{box-shadow:0 1px .5px rgba(0,0,0,.13)}}
.crmB .bd-mas{align-self:center;font-size:11.5px;color:#54656f;background:rgba(255,255,255,.8);border-radius:999px;padding:4px 12px;margin-bottom:4px}
.crmB .bd-cita{display:block;width:100%;text-align:left;border:0;border-left:4px solid #128C7E;background:rgba(0,0,0,.05);border-radius:6px;padding:5px 8px;margin:2px 0 4px;cursor:pointer;font:inherit;color:inherit}
.crmB .bd-cita b{display:block;font-size:11px;color:#128C7E}.crmB .bd-cita span{display:block;font-size:12px;color:#54656f;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:260px}
.crmB .bd-plant{font-size:10.5px;font-weight:700;color:#075e54;margin-bottom:2px}
.crmB .bd-resp{position:absolute;top:4px;width:26px;height:26px;border-radius:50%;border:0;background:rgba(255,255,255,.95);box-shadow:0 1px 3px rgba(0,0,0,.2);color:#54656f;cursor:pointer;display:none;align-items:center;justify-content:center;font-size:15px}
.crmB .wa-brow.in .bd-resp{right:-32px}.crmB .wa-brow.out .bd-resp{left:-32px}
@media(hover:hover){.crmB .wa-brow:hover .bd-resp{display:inline-flex}}
.crmB .bd-reint{border:0;background:#b91c1c;color:#fff;border-radius:999px;padding:3px 9px;font-weight:700;font-size:11px;font-family:inherit;cursor:pointer;margin-left:4px;display:inline-flex;align-items:center;gap:3px}
.crmB .bd-citabar{display:flex;align-items:center;gap:10px;background:#f0f2f5;padding:8px 14px 0}.crmB .bd-citabar>i{color:#128C7E;font-size:18px}
.crmB .bd-citabar>div{flex:1;min-width:0;border-left:4px solid #128C7E;background:#fff;border-radius:6px;padding:5px 9px}
.crmB .bd-citabar b{display:block;font-size:11.5px;color:#128C7E}.crmB .bd-citabar span{display:block;font-size:12.5px;color:#54656f;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.crmB .bd-citabar button{border:0;background:none;font-size:18px;color:#54656f;cursor:pointer;width:32px;height:32px}
.crmB .bd-abajo{position:absolute;right:16px;bottom:78px;width:40px;height:40px;border-radius:50%;border:0;background:#fff;box-shadow:0 2px 8px rgba(0,0,0,.2);color:#54656f;font-size:20px;cursor:pointer;display:none;align-items:center;justify-content:center;z-index:2}
.crmB .bd-abajo.on{display:inline-flex}
.bd-plant-m{max-width:520px;width:100%;max-height:90vh;display:flex;flex-direction:column}.bd-plant-cuerpo{overflow-y:auto;display:flex;flex-direction:column;gap:10px;padding-bottom:4px}
.bd-plant-item{display:flex;flex-direction:column;gap:3px;text-align:left;border:1px solid var(--c-line,#e2e8f0);border-radius:12px;background:#fff;padding:10px 12px;cursor:pointer;font:inherit;color:inherit}
.bd-plant-item small{font-size:11px;color:#64748b;text-transform:lowercase}.bd-plant-item span{font-size:12.5px;color:#334155;white-space:pre-wrap}
.bd-plant-prev{background:#dcf8c6;border-radius:10px;padding:10px 12px}.bd-plant-prev small{font-size:11px;color:#166534;font-weight:700}.bd-plant-prev .tx{white-space:pre-wrap;font-size:13.5px;margin-top:4px}
.bd-plant-enviar{align-self:flex-end}
.bd-sinc{font-size:13.5px;line-height:1.5;color:var(--c-ink,#111);margin:6px 0 10px}
.bd-sinc-barra{height:8px;border-radius:999px;background:#e2e8f0;overflow:hidden}.bd-sinc-barra i{display:block;height:100%;width:3%;background:#128C7E;border-radius:999px;transition:width .4s}
#bdSincM .modal{display:flex;flex-direction:column;gap:6px}
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
@media(max-width:860px){
  .crmB .crm-tab-seg{font-size:11px;gap:3px;padding:8px 2px;flex-direction:column}.crmB .crm-tab-seg i{font-size:17px}.crmB .crm-badge{position:absolute;top:4px;right:8px}
  .crmB .crm-tabs-row{gap:6px}.crmB .crm-acciones-rapidas{gap:6px}.crmB .crm-icon-btn{width:40px;height:40px}
  .crmB .crm-chips-row{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;gap:8px}.crmB .crm-chip{padding:8px 14px;flex:none}
  .crmB .crm-leads-f{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;max-width:100%}.crmB .crm-lead-f{flex:none}
  .crmB .wa-shell{height:calc(100dvh - 300px);min-height:380px}.crmB.chat-abierto .wa-shell{height:calc(100dvh - 90px)}
  .crmB .wa-list-col{width:100%;border-right:0}.crmB .wa-shell.con-chat .wa-list-col{display:none}.crmB .wa-shell:not(.con-chat) .wa-chat-col{display:none}
  .crmB.chat-abierto .crm-ocultar-en-chat{display:none}.crmB .wa-back{display:inline-flex}
  .crmB .wa-chat-head{padding:8px 12px;gap:8px}.crmB .wa-chat-sub{padding:6px 12px 8px}.crmB .wa-bubble-wrap{max-width:84%}.crmB .wa-msgs{padding:12px}
}
/* 02-oct-2026: partes del chat que se repintan por separado; aviso de red; «Cargar más»; 16 px en iPhone (sin zoom). */
.crmB .bd-parte{display:contents}
.crmB .bd-aviso-red{display:flex;align-items:center;gap:6px;margin:8px 10px 4px;padding:7px 10px;border-radius:10px;background:#fffbeb;color:#92400e;font-size:12px;border:1px solid #fde68a}
.crmB .bd-mas-convs{display:flex;align-items:center;justify-content:center;gap:6px;width:calc(100% - 20px);margin:10px;padding:10px;border:1px dashed #cbd5e1;border-radius:12px;background:#f8fafc;color:#334155;font-size:12.5px;font-weight:700;font-family:inherit;cursor:pointer}
.crmB .bd-mas-convs:disabled{opacity:.7;cursor:default}
@media(max-width:860px){
  .crmB .wa-input-bar textarea,.crmB .rs-hub-buscar input,.crmB .crm-asig select,.crmB .crm-lead .a select,.nxCrmF input,.nxCrmF select,.nxCrmF textarea,.nxCrmComp textarea,.nxCrmComp .venc input,.nxCrmComp .venc select,.nxCrmDocs select,#nxCrmMotTx,.bd-plant-cuerpo input{font-size:16px}
}
@media(prefers-reduced-motion:reduce){.crmB .pill-elevado,.crmB .crm-tab-seg{transition:none}.crmB .crm-girando{animation:none}}
`;
    document.head.appendChild(st);
  }

  window.nxCRM = {
    trAbrir, trConfirmar, trBandeja, trIr,
    bdChatMenu, bdNoLeido, bdFijar, bdSilenciar, bdEtiquetas, bdEtqTog, bdEtqNueva, bdEtqGuardar, bdFicha, bdCrearCliente, bdRR, bdRRKey, bdRRUsar, bdRRAdmin, bdRRGuardar, bdRRBorrar,
    bdToast: function (m) { toast('ok', m); },
    bdAdjMenu, bdGrabar, bdGrabFin, bdUbicacion, bdUbAqui, bdUbEnviar, bdContacto, bdCtBuscar, bdCtEnviar, bdMsgMenu, bdCopiar, bdReenviar, bdReFiltrar, bdReEnviarA, bdBuscarChat, bdBq, bdBqIr,
    trBuscar: function (q) { TR.q = q || ''; trPintar(); },
    trElegir: function (id) { TR.elegido = id; trPintar(); },
    bdAbrir, bdEnviar, bdAdjuntar, bdReintentar, bdSincronizar, bdCitar, bdIrA, bdPlantillas, bdPlantEnviar, bdTeclado,
    bdCitaQuitar: function () { BD.cita = null; const cb = document.getElementById('bdCitaBar'); if (cb) cb.innerHTML = ''; },
    bdAbajo: function () { bdNuevos(0); const m = document.getElementById('bdMsgs'); if (m) m.scrollTo({ top: m.scrollHeight, behavior: 'smooth' }); BD.pegadoAbajo = true; const b = document.getElementById('bdAbajo'); if (b) b.classList.remove('on'); },
    bdBorrador: function (v) { if (BD.sel) { BD.borr[BD.sel] = v; bdGuardarBorr(); } },
    bdMediaLista: function () { if (BD.pegadoAbajo) bdAlFondo(); },
    bdMediaFallo: function (path) { if (!path || !BD.urls[path]) return; delete BD.urls[path]; BD.firmaFallo[path] = (BD.firmaFallo[path] || 0) + 1; bdFirmar(); },
    bdMediaReintentar: function (path) { delete BD.firmaFallo[path]; delete BD.urls[path]; bdSyncMsgs(false); bdFirmar(); },
    bdEmojis: function (ev) { bdEmojiPanel(ev); },
    bdEmoji: function (e) { bdEmojiInsertar(e); },
    bdPlantElegir: function (i) { if (!BD.plant) return; BD.plant.sel = i; BD.plant.vals = null; bdPlantPintar(); },
    bdPlantVar: function (i, val) { const P = BD.plant; if (!P || P.sel === null) return; const v = P.lista[P.sel].variables[i]; if (v === undefined) return; P.vals[v] = val; const pv = document.getElementById('bdPlantPrev'); if (pv) pv.textContent = bdPlantTexto(P.lista[P.sel], P.vals); },
    bdCerrar: function () { BD.sel = null; BD.msgs = []; BD.msgsEstado = ''; bdModoChat(); const l = document.getElementById('bdList'); if (l && BD.listaScroll) l.scrollTop = BD.listaScroll; },
    bdFiltro: function (k) {
      const antes = bdArch(); BD.filtro = k;
      if (antes !== bdArch()) { BD.sel = null; BD.msgs = []; BD.cargandoLista = true; repintar(); bdCargar().then(() => { BD.listaHTML = ''; repintar(); }); }
      else repintar();
    },
    bdBuscar: function (q) { BD.q = q || ''; bdPintarLista(); bdBuscarServidor(); },
    bdBuscarAbrir: function (btn) {
      BD.buscando = true;
      const b = btn || document.querySelector('.crmB .crm-buscar');
      if (!b) { repintar(); }
      else b.outerHTML = `<input type="text" id="crmBuscarInput" class="crm-buscar-input" value="${esc(BD.q)}" placeholder="Buscar nombre o número..." oninput="window.nxCRM.bdBuscar(this.value)" onblur="window.nxCRM.bdBuscarBlur()">`;
      setTimeout(() => { const i = document.getElementById('crmBuscarInput'); if (i) i.focus(); }, 30);
    },
    // Salir del buscador vacío ya no redibuja la pantalla (en iPhone eso «se tragaba» el toque sobre una conversación).
    bdBuscarBlur: function () {
      if (BD.q.trim()) return; BD.buscando = false;
      setTimeout(() => { const i = document.getElementById('crmBuscarInput'); if (i && !BD.buscando && !BD.q.trim() && document.activeElement !== i) i.outerHTML = `<button class="crm-buscar pill-elevado" onclick="window.nxCRM.bdBuscarAbrir(this)"><i class="ti ti-search"></i> <span>Buscar</span></button>`; }, 200);
    },
    bdCargarMas: bdCargarMas,
    bdReintentarCarga: async function () { if (!BD.sel) return; const id = BD.sel; BD.msgsEstado = 'cargando'; bdSyncMsgs(); await bdCargarMsgs(id); bdSyncMsgs(); bdAlFondo(); bdFirmar(); },
    bdSincParar: function (b) { BD.sincParar = true; if (b) { b.disabled = true; b.innerHTML = '<i class="ti ti-loader-2"></i> Deteniendo…'; } },
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
    tab: function (k) {
      if (vistasPermitidas().indexOf(k) < 0) return;
      const antes = bdPlat() + '|' + bdArch();
      S.vista = k; BD.sel = null; BD.msgs = []; BD.q = ''; BD.buscando = false; BD.filtro = 'todos'; BD.asig = 'todas'; try { localStorage.setItem('studio_crm_vista', k); } catch (e) {}
      const otra = (k === 'mensajes' || k === 'redes') && antes !== bdPlat() + '|' + bdArch();
      if (otra) BD.cargandoLista = true;
      repintar();
      if (otra) bdCargar().then(() => { BD.listaHTML = ''; bdPintarParcial(); });
    },
    red: function (k) { if (BD.red === k && BD.clave === k + '|' + bdArch()) return; BD.red = k; BD.sel = null; BD.msgs = []; BD.filtro = 'todos'; BD.asig = 'todas'; BD.cargandoLista = true; repintar(); bdCargar().then(() => { BD.listaHTML = ''; repintar(); }); },
    linea: function (id) { BD.linea = id || ''; BD.sel = null; BD.msgs = []; BD.listaHTML = ''; repintar(); },
    lineaMenu: function (ev) { ev.stopPropagation(); const m = document.getElementById('crmLineaMenu'); if (!m) return; const ab = m.classList.toggle('abierto'); ev.currentTarget.classList.toggle('abierto', ab); if (ab) setTimeout(() => document.addEventListener('click', function f() { m.classList.remove('abierto'); document.removeEventListener('click', f); }), 0); },
    leadsFiltro: function (k) { S.leadsF = k; repintar(); },
    leadEtapa: function (id, el) { const o = S.ops.find(x => String(x.id) === String(id)); const v = el.value; if (o && v === 'perdido') el.value = o.etapa; mover(id, v); },
    leadCliente: function (id) { try { ctx().elegirCliente(function (c) { if (c && c.id) guardarCampo(id, 'cliente_id', c.id); }); } catch (e) {} },
    canalesModal: canalesModal,
    actualizar: async function (b) {
      const i = b && b.querySelector('i'); if (i) i.classList.add('crm-girando');
      if (BD.error) { BD.error = ''; BD.cargado = false; }
      await Promise.all([cargar(), bdCargar()]); if (BD.sel) await bdCargarMsgs(BD.sel);
      if (i) i.classList.remove('crm-girando');
      if (BD.avisoRed || BD.error) toast('err', 'No se pudo actualizar', BD.avisoRed || BD.error);
      repintar();
    },
    bdArchivar: async function (id) {
      if (!confirm('¿Archivar esta conversación? Vuelve sola a la bandeja si el cliente escribe de nuevo.')) return;
      if (!(await bdPatch(id, { archivada: true }, 'Conversación archivada'))) return;
      BD.convs = BD.convs.filter(c => String(c.id) !== String(id));
      if (String(BD.sel) === String(id)) { BD.sel = null; BD.msgs = []; bdModoChat(); } else bdPintarLista();
    },
    bdDesarchivar: async function (id) {
      if (!(await bdPatch(id, { archivada: false }, 'Conversación devuelta a la bandeja'))) return;
      BD.convs = BD.convs.filter(c => String(c.id) !== String(id));
      if (String(BD.sel) === String(id)) { BD.sel = null; BD.msgs = []; bdModoChat(); } else bdPintarLista();
    },
    bdAsignar: function (id, u) { bdPatch(id, { asignado_id: u || null }, u ? 'Conversación asignada' : 'Conversación liberada'); },
    bdCliente: function (id) { try { ctx().elegirCliente(function (c) { if (c && c.id) bdPatch(id, { cliente_id: c.id }, 'Cliente vinculado'); }); } catch (e) {} },
    bdOportunidad: async function (id) {
      const c = BD.convs.find(x => String(x.id) === String(id)); if (!c) return;
      const f = (PLAT[c.plataforma] || PLAT.whatsapp)[0];
      try {
        const b = { nombre: (f + ' · ' + bdNombre(c)).slice(0, 120), cliente_id: c.cliente_id || null, contacto: c.contacto_nombre || null, telefono: c.telefono_e164 || null, fuente: f, etapa: 'nuevo', asignado_id: c.asignado_id || (esAdmin() ? null : yo()) };
        try { if (ctx().nextSeq) b.numero = await ctx().nextSeq('crm'); } catch (e) {}
        const r = await api().post('pos_crm', b); const op = Array.isArray(r) ? r[0] : r;
        if (op && op.id) { await cargar(); await bdPatch(id, { crm_id: op.id }, 'Oportunidad creada'); }
      } catch (e) { toast('err', 'No se pudo crear la oportunidad', errTxt(e)); }
    },
    bdCanal: async function (id, on) { try { await api().patch('crm_canales', 'id=eq.' + id, { activo: !!on }); toast('ok', on ? 'Canal activado' : 'Canal apagado'); await bdCargar(); bdPintarParcial(); } catch (e) { toast('err', 'No se pudo', errTxt(e)); } },
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
