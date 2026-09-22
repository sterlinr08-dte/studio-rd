/* ═══════════════════════════════════════════════════════════════════════════════════════════
   STUDIO · Reacondicionado (taller de lotes) — réplica del módulo "Reacondicionados" de BAYOL CELL
   (taller.html #v-refurb) adaptada al POS de STUDIO. 2026-09-22.

   Se conserva la estructura y el flujo del original: 5 pestañas (Lotes · Catálogo de Fallas ·
   Devoluciones · Pedidos de Piezas · Rentabilidad), 6 etapas (01 Recibidos · 02 Diagnóstico ·
   03 En reparación · 04 Control de calidad · 05 Listo para venta · 06 Despachados), tarjetas de
   lote con contadores por etapa, detalle del lote con KPI, chips de técnico, buscador/filtros,
   selección múltiple con "Asignar a técnico" y "Pasar a ▾", tarjetas de equipo con la acción de
   su etapa, evaluación (fallas → piezas → resumen), panel de reparación (stepper, piezas con doble
   confirmación, fallas y tareas, reparación externa, reasignar, control de calidad), ficha del
   equipo, historial, label, devoluciones y centro de rentabilidad.

   Cambios respecto a BAYOL (solo por la plataforma):
   - Info Plus → inventario del POS (pos_productos / pos_seriales / pos_compras). El despacho y el
     descuento de piezas se hacen con RPC atómicas (pos_reacond_despachar, pos_reacond_descontar_piezas).
   - Técnicos = usuarios del sistema (usuarios_sistema). Admin = rol admin o gerente.
   - Tablas pos_reacond_* (ver supabase/studio/18_reacondicionado.sql).
   - Colores de marca STUDIO (negro / blanco cálido / oro) en el marco; los colores de estado
     (ámbar, azul, naranja, morado, violeta, verde) se conservan porque tienen significado.
   Se muestra solo si pos_config.reacondicionado = true (lo lee parches-pos.js).
   ═══════════════════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.nxReacond) return;

  // ─────────────────────────── utilidades compartidas ───────────────────────────
  function api() { try { return (typeof API !== 'undefined') ? API : window.API; } catch (e) { return window.API; } }
  function ctx() { return window.nxPosCtx || {}; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c])); }
  function money(n) { return 'RD$ ' + Number(n || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function toast(msg, tipo) { try { if (window.toast) window.toast(tipo === 'error' ? 'err' : 'ok', tipo === 'error' ? 'Reacondicionado' : 'Listo', String(msg || '')); } catch (e) {} }
  function toastError(msg) { toast(msg, 'error'); }
  function friendly(e) { const m = String((e && e.message) || e || 'Error'); try { const j = JSON.parse(m); return j.message || j.hint || m; } catch (_) { return m; } }
  function logError(ctxTxt, e) { try { console.error('[reacond] ' + ctxTxt, e); } catch (_) {} }
  function sesion() { try { return (typeof window.sesion !== 'undefined' && window.sesion) ? window.sesion : (ctx().sesion ? ctx().sesion() : null); } catch (e) { return null; } }
  function miId() { const s = sesion(); return s ? String(s.id || '') : ''; }
  function miNombre() { const s = sesion(); return (s && s.nom) || 'Usuario'; }
  function rol() { try { return ctx().rolEfectivo ? ctx().rolEfectivo() : ((sesion() || {}).rol || 'admin'); } catch (e) { return 'admin'; } }
  function isAdminUser() { const r = String(rol() || '').toLowerCase(); return r === 'admin' || r === 'gerente'; }
  function tienePermiso(p) { return isAdminUser(); }
  function permBtn(p, html) { return tienePermiso(p) ? html : ''; }
  function soloAdmin(accion) { if (isAdminUser()) return true; toast(`Solo el administrador puede ${accion || 'realizar esta acción'}. El técnico no tiene este permiso.`, 'error'); return false; }
  function nowISO() { return new Date().toISOString(); }
  function fechaDO(d) { return d ? new Date(d).toLocaleDateString('es-DO') : '—'; }
  function fechaHoraDO(d) { return d ? new Date(d).toLocaleString('es-DO', { dateStyle: 'short', timeStyle: 'short' }) : ''; }
  function hoyYMD() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function diasDesde(f) { if (!f) return 0; return Math.floor((Date.now() - new Date(f).getTime()) / 86400000); }
  function tiempoDesde(f) {
    if (!f) return ''; const ini = new Date(f); if (isNaN(ini)) return '';
    const exacta = ini.toLocaleString('es-DO', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const ms = Date.now() - ini.getTime(); if (ms < 0) return exacta;
    const min = Math.floor(ms / 60000), horas = Math.floor(min / 60), dias = Math.floor(horas / 24);
    const t = dias >= 1 ? `hace ${dias}d ${horas % 24}h` : horas >= 1 ? `hace ${horas}h ${min % 60}min` : `hace ${min}min`;
    return `${exacta} · ${t}`;
  }
  function q(sel) { return document.querySelector(sel); }
  function byId(id) { return document.getElementById(id); }
  function val(id) { const e = byId(id); return e ? String(e.value || '').trim() : ''; }
  function inList(arr, v) { return (arr || []).indexOf(v) >= 0; }
  function rerenderPOS() { try { if (ctx().renderPOS) ctx().renderPOS(); } catch (e) {} }

  // ─────────────────────────── estado del módulo (mismos nombres que BAYOL) ───────────────────────────
  const UI_LIST_PAGE_SIZE = 10;
  const _REACOND_ESTADOS_REPARACION = ['en_proceso', 'tecnico_recibio', 'espera_pieza', 'reasignado', 'reparacion_externa'];
  const _REACOND_ESTADOS_TRABAJO = [..._REACOND_ESTADOS_REPARACION, 'listo_revision'];
  const cache = { lotes: [], refurb: [], piezasReacond: [], tareas: [], fallaCategorias: [], fallas: [], tecnicos: [], proveedores: [], productos: [], almacenes: [], compras: [] };
  let _cargado = false, _cargando = null;
  let reacondMainTab = 'lotes';
  let reacondTabActual = 'recibidos';
  let reacondLoteAbiertoId = null;
  let _reacondSel = new Set();
  let _reacondSelCosto = new Set();
  let _reacondFiltroTec = '';
  let _reacondVisibleEquipos = [];
  let _reacondPiezasVista = 'solicitudes';
  let _panelProcesoEquipoId = null;
  let _devolucionesCache = [];
  let _repFiltroFechas = { desde: null, hasta: null, label: '1 mes' };
  const _uiListPages = {};
  const _uiListRenderers = {};
  const _filtros = { busq: '', estado: '', fechaDesde: '', fechaHasta: '', busqGlobal: '', fallasBusq: '' };
  const _evalState = { equipoId: null, fallasSeleccionadas: new Set(), fallasNotas: {}, piezasSeleccionadas: [], categoriasContraidas: new Set(), tabActiva: 'fallas' };
  try { const t = localStorage.getItem('studio_subtab_reacond'); if (t) reacondMainTab = t; } catch (e) {}
  (function () { const h = new Date(), d = new Date(); d.setDate(d.getDate() - 30); _repFiltroFechas = { desde: d.toISOString().slice(0, 10), hasta: h.toISOString().slice(0, 10), label: '1 mes' }; })();

  // ─────────────────────────── carga de datos (loadAll de BAYOL) ───────────────────────────
  async function loadAll() {
    if (_cargando) return _cargando;
    _cargando = (async () => {
      const g = (t, qs) => api().get(t, qs).catch(e => { logError('cargar ' + t, e); return null; });
      const [lotes, refurb, piezas, tareas, cats, fallas, tecs, provs, alms] = await Promise.all([
        g('pos_reacond_lotes', 'select=*&order=creado_en.desc&limit=5000'),
        g('pos_reacond_equipos', 'select=*&order=creado_en.asc&limit=20000'),
        g('pos_reacond_piezas', 'select=*&order=creado_en.asc&limit=20000'),
        g('pos_reacond_tareas', 'select=*&order=creado_en.asc&limit=20000'),
        g('pos_reacond_falla_categorias', 'select=*&order=orden.asc'),
        g('pos_reacond_fallas', 'select=*&order=nombre.asc'),
        g('usuarios_sistema', 'select=id,nom,cargo,rol,activo,login&order=nom.asc'),
        g('pos_proveedores', 'select=id,nombre&order=nombre.asc'),
        g('pos_almacenes', 'select=*&activo=eq.true&order=es_principal.desc,nombre.asc')
      ]);
      cache.lotes = lotes || []; cache.refurb = refurb || []; cache.piezasReacond = piezas || []; cache.tareas = tareas || [];
      cache.fallaCategorias = cats || []; cache.fallas = fallas || [];
      cache.tecnicos = (tecs || []).map(u => ({ id: u.id, nombre: u.nom || u.login || 'Usuario', activo: u.activo !== false, rol: u.rol, especialidad: u.cargo || '', telefono: '' }));
      cache.proveedores = provs || []; cache.almacenes = alms || [];
      _cargado = true;
    })();
    try { await _cargando; } finally { _cargando = null; }
  }
  async function cargarProductos() {
    if (cache.productos.length) return cache.productos;
    try { cache.productos = await api().get('pos_productos', 'select=id,nombre,codigo,marca,referencia,costo,precio,stock,serial,tipo,activo&activo=eq.true&order=nombre.asc&limit=20000') || []; } catch (e) { cache.productos = []; }
    return cache.productos;
  }
  function nombreEmpleado(id) { if (!id) return '—'; const t = cache.tecnicos.find(x => String(x.id) === String(id)); return t ? t.nombre : '—'; }
  function tecnicosActivos() { return cache.tecnicos.filter(t => t.activo); }
  function esTecnicoNoAdmin() { return !isAdminUser(); }
  function lote(id) { return cache.lotes.find(l => String(l.id) === String(id)); }
  function equipo(id) { return cache.refurb.find(r => String(r.id) === String(id)); }
  function prov(id) { return cache.proveedores.find(p => String(p.id) === String(id)); }
  function almPrincipal() { return cache.almacenes.find(a => a.es_principal) || cache.almacenes[0] || null; }

  // ─────────────────────────── modales (patrón overlay del POS STUDIO) ───────────────────────────
  function abrirModal(id, html, ancho, z) {
    cerrarModal(id);
    const ov = document.createElement('div'); ov.id = id; ov.className = 'overlay open nxRcOverlay';
    if (z) ov.style.zIndex = z;
    ov.innerHTML = `<div class="modal nxPf nxRcModal" style="--rc-maxw:${ancho || 560}px;max-height:92vh;display:flex;flex-direction:column;padding:0;border-radius:18px;overflow:hidden">${html}</div>`;
    ov.addEventListener('click', e => { if (e.target === ov) cerrarModal(id); });
    document.body.appendChild(ov);
    try { if (window.scanMoney) window.scanMoney(ov); } catch (e) {}
    return ov;
  }
  function cerrarModal(id) { const o = byId(id); if (o) o.remove(); }
  function cabecera(icono, titulo, cerrarId, extra) {
    return `<div class="head nxRcHead"><button class="nxBack" type="button" onclick="window.nxRc.cerrar('${cerrarId}')" aria-label="Cerrar"><i class="ti ti-arrow-left"></i></button><h3><i class="ti ${icono}"></i> ${titulo}</h3>${extra || ''}</div>`;
  }
  function cuerpo(html) { return `<div class="nxRcBody" style="overflow-y:auto;flex:1;padding:14px;display:flex;flex-direction:column;gap:12px">${html}</div>`; }
  function pie(html) { return `<div class="nxRcFoot">${html}</div>`; }
  function confirmar(mensaje, opciones) {
    opciones = opciones || {};
    const ok = opciones.ok || 'Confirmar', cancel = opciones.cancel || 'Cancelar', peligro = opciones.peligro !== false;
    return new Promise(resolve => {
      cerrarModal('nxRcConfirm');
      const bg = document.createElement('div'); bg.id = 'nxRcConfirm'; bg.className = 'overlay open nxRcOverlay'; bg.style.zIndex = '10900';
      bg.innerHTML = `<div class="modal nxPf nxRcModal nxRcConfirmBox" style="max-width:400px;padding:0;border-radius:18px;overflow:hidden">
        <div style="padding:22px 22px 8px;text-align:center">
          <div class="nxRcConfIco ${peligro ? 'red' : 'blue'}"><i class="ti ${peligro ? 'ti-alert-triangle' : 'ti-help'}"></i></div>
          <div style="font-size:14.5px;line-height:1.5;white-space:pre-line">${esc(mensaje)}</div>
        </div>
        <div style="display:flex;gap:10px;padding:16px 22px 22px">
          <button id="nxRcConfCancel" class="btn nxRcBtn light" type="button" style="flex:1">${esc(cancel)}</button>
          <button id="nxRcConfOk" class="btn nxRcBtn ${peligro ? 'danger' : 'gold'}" type="button" style="flex:1">${esc(ok)}</button>
        </div></div>`;
      document.body.appendChild(bg);
      const cerrar = v => { bg.remove(); resolve(v); };
      bg.querySelector('#nxRcConfOk').onclick = () => cerrar(true);
      bg.querySelector('#nxRcConfCancel').onclick = () => cerrar(false);
      bg.onclick = e => { if (e.target === bg) cerrar(false); };
    });
  }
  function pedirTexto(mensaje, opciones) {
    opciones = opciones || {};
    const valorInicial = opciones.valor || '', placeholder = opciones.placeholder || '', multilinea = !!opciones.multilinea, tipo = opciones.tipo || 'text';
    return new Promise(resolve => {
      cerrarModal('nxRcPrompt');
      const bg = document.createElement('div'); bg.id = 'nxRcPrompt'; bg.className = 'overlay open nxRcOverlay'; bg.style.zIndex = '10900';
      const campo = multilinea
        ? `<textarea id="nxRcPromptInput" rows="3" placeholder="${esc(placeholder)}" class="nxRcInput" style="width:100%">${esc(valorInicial)}</textarea>`
        : `<input id="nxRcPromptInput" type="${tipo}" ${tipo === 'number' ? 'inputmode="decimal" step="any"' : ''} value="${esc(valorInicial)}" placeholder="${esc(placeholder)}" class="nxRcInput" style="width:100%">`;
      bg.innerHTML = `<div class="modal nxPf nxRcModal" style="max-width:420px;padding:0;border-radius:18px;overflow:hidden">
        <div style="padding:20px 22px 10px"><div style="font-size:14px;line-height:1.5;white-space:pre-line;margin-bottom:12px">${esc(mensaje)}</div>${campo}</div>
        <div style="display:flex;gap:10px;padding:14px 22px 22px">
          <button id="nxRcPromptCancel" class="btn nxRcBtn light" type="button" style="flex:1">Cancelar</button>
          <button id="nxRcPromptOk" class="btn nxRcBtn gold" type="button" style="flex:1">Aceptar</button>
        </div></div>`;
      document.body.appendChild(bg);
      const input = bg.querySelector('#nxRcPromptInput');
      setTimeout(() => { try { input.focus(); } catch (e) {} }, 50);
      const cerrar = v => { bg.remove(); resolve(v); };
      bg.querySelector('#nxRcPromptOk').onclick = () => cerrar(input.value);
      bg.querySelector('#nxRcPromptCancel').onclick = () => cerrar(null);
      bg.onclick = e => { if (e.target === bg) cerrar(null); };
      if (!multilinea) input.addEventListener('keydown', e => { if (e.key === 'Enter') cerrar(input.value); });
    });
  }
  // Selector con búsqueda (smart-select de BAYOL): input + lista filtrada; guarda el id en un hidden.
  function smartSelect(id, items, placeholder, valor) {
    const sel = items.find(i => String(i.id) === String(valor || ''));
    return `<div class="nxRcSS" id="${id}" data-items='${esc(JSON.stringify(items.map(i => ({ id: i.id, label: i.label, sub: i.sub || '', search: (i.search || i.label || '').toLowerCase(), meta: i.meta || '', extra: i.extra || null }))))}'>
      <input type="hidden" id="${id}_val" value="${esc(sel ? sel.id : '')}">
      <div class="nxRcSSBox"><i class="ti ti-search"></i><input type="text" id="${id}_txt" class="nxRcInput" autocomplete="off" placeholder="${esc(placeholder || 'Buscar…')}" value="${esc(sel ? sel.label : '')}" oninput="window.nxRc.ssFiltrar('${id}')" onfocus="window.nxRc.ssFiltrar('${id}')" onkeydown="if(event.key==='Escape'){window.nxRc.ssCerrar('${id}')}">${sel ? '' : ''}<button type="button" class="nxRcSSClear" onclick="window.nxRc.ssLimpiar('${id}')" title="Limpiar"><i class="ti ti-x"></i></button></div>
      <div class="nxRcSSList" id="${id}_list" style="display:none"></div>
    </div>`;
  }
  function ssItems(id) { const el = byId(id); try { return JSON.parse(el.getAttribute('data-items') || '[]'); } catch (e) { return []; } }
  function ssGet(id) { const h = byId(id + '_val'); return h ? h.value : ''; }
  function ssItem(id) { const v = ssGet(id); return ssItems(id).find(i => String(i.id) === String(v)) || null; }
  function ssFiltrar(id) {
    const txt = (byId(id + '_txt') || {}).value || ''; const list = byId(id + '_list'); if (!list) return;
    const ql = txt.toLowerCase().trim(); const pal = ql.split(/\s+/).filter(Boolean);
    const items = ssItems(id).filter(i => !pal.length || pal.every(p => i.search.includes(p))).slice(0, 60);
    list.style.display = 'block';
    list.innerHTML = items.length ? items.map(i => `<div class="nxRcSSItem" onmousedown="event.preventDefault();window.nxRc.ssPick('${id}','${esc(String(i.id))}')"><div><b>${esc(i.label)}</b>${i.meta ? ` <span class="nxRcSSMeta">${esc(i.meta)}</span>` : ''}</div>${i.sub ? `<small>${esc(i.sub)}</small>` : ''}</div>`).join('') : '<div class="nxRcSSItem" style="color:#94a3b8">Sin resultados</div>';
    const cerrar = ev => { if (!byId(id) || !byId(id).contains(ev.target)) { ssCerrar(id); document.removeEventListener('click', cerrar); } };
    setTimeout(() => document.addEventListener('click', cerrar), 0);
  }
  function ssCerrar(id) { const l = byId(id + '_list'); if (l) l.style.display = 'none'; }
  function ssPick(id, v) {
    const it = ssItems(id).find(i => String(i.id) === String(v)); if (!it) return;
    byId(id + '_val').value = it.id; byId(id + '_txt').value = it.label; ssCerrar(id);
    const el = byId(id); if (el) el.dispatchEvent(new CustomEvent('nxrc-change', { detail: it, bubbles: true }));
  }
  function ssLimpiar(id) { const h = byId(id + '_val'), t = byId(id + '_txt'); if (h) h.value = ''; if (t) { t.value = ''; t.focus(); } ssFiltrar(id); }

  // ─────────────────────────── paginación (igual que BAYOL: 10 por página) ───────────────────────────
  function _uiListPage(key, total) {
    const pages = Math.max(1, Math.ceil(total / UI_LIST_PAGE_SIZE));
    let page = Number(_uiListPages[key] || 1); page = Math.max(1, Math.min(page, pages)); _uiListPages[key] = page;
    return { page, pages, start: (page - 1) * UI_LIST_PAGE_SIZE };
  }
  function _uiListPageNums(page, pages) {
    if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
    const s = new Set([1, pages, page, page - 1, page + 1, page - 2, page + 2].filter(n => n >= 1 && n <= pages));
    const arr = [...s].sort((a, b) => a - b); const out = [];
    arr.forEach((n, i) => { if (i && n - arr[i - 1] > 1) out.push('...'); out.push(n); });
    return out;
  }
  function _uiListPager(key, total, label) {
    const p = _uiListPage(key, total); if (p.pages <= 1) return '';
    const nums = _uiListPageNums(p.page, p.pages).map(n => n === '...' ? '<span class="nxRcPgEll">…</span>' : `<button type="button" class="nxRcPg${n === p.page ? ' on' : ''}" onclick="window.nxRc.pagina('${key}',${n})">${n}</button>`).join('');
    const desde = (p.page - 1) * UI_LIST_PAGE_SIZE + 1, hasta = Math.min(p.page * UI_LIST_PAGE_SIZE, total);
    return `<div class="nxRcPager" aria-label="Paginación de ${esc(label)}"><button type="button" class="nxRcPg" onclick="window.nxRc.pagina('${key}',${p.page - 1})" ${p.page === 1 ? 'disabled' : ''}><i class="ti ti-chevron-left"></i></button><div>${nums}</div><button type="button" class="nxRcPg" onclick="window.nxRc.pagina('${key}',${p.page + 1})" ${p.page === p.pages ? 'disabled' : ''}><i class="ti ti-chevron-right"></i></button><span class="nxRcPgSum">Mostrando ${desde}–${hasta} de ${total}</span></div>`;
  }
  function _uiSetListPage(key, page) { _uiListPages[key] = page; const r = _uiListRenderers[key]; if (r) r(); }

  // ─────────────────────────── etiquetas de estado (obtenerEtiquetaEstado / etiquetaEstadoPiezaReacond) ───────────────────────────
  function obtenerEtiquetaEstado(estado) {
    const map = {
      pendiente: { text: 'Recibido', bg: '#fef3c7', color: '#92400e' },
      en_evaluacion: { text: 'Diagnóstico en curso', bg: '#dbeafe', color: '#1d4ed8' },
      evaluado: { text: 'Diagnóstico listo', bg: '#d1fae5', color: '#065f46' },
      en_proceso: { text: 'En reparación', bg: '#fed7aa', color: '#9a3412' },
      tecnico_recibio: { text: 'En reparación · recibido', bg: '#fed7aa', color: '#9a3412' },
      espera_pieza: { text: 'En reparación · espera pieza', bg: '#fde68a', color: '#92400e' },
      listo_revision: { text: 'Control de calidad', bg: '#e9d5ff', color: '#6b21a8' },
      listo_venta: { text: 'Listo para venta', bg: '#ddd6fe', color: '#5b21b6' },
      vendido: { text: 'Despachado', bg: '#dcfce7', color: '#166534' },
      reasignado: { text: 'En reparación · reasignado', bg: '#fef3c7', color: '#92400e' },
      reparacion_externa: { text: 'En reparación · externa', bg: '#e0e7ff', color: '#3730a3' },
      completado: { text: 'Registro cerrado', bg: '#e2e8f0', color: '#334155' }
    };
    const r = map[estado] || { text: estado || '', bg: '#f1f5f9', color: '#475569' };
    return Object.assign({}, r, { text: (r.text || '').toUpperCase() });
  }
  function etiquetaEstadoPiezaReacond(estado) {
    const map = {
      pendiente: { txt: '🟡 Pedida', bg: '#fef3c7', color: '#92400e' }, solicitada: { txt: '🟡 Pedida', bg: '#fef3c7', color: '#92400e' },
      aprobada: { txt: '✅ Aprobada', bg: '#dcfce7', color: '#166534' }, entregada: { txt: '📦 Entregada', bg: '#dbeafe', color: '#1d4ed8' },
      recibida: { txt: '🔧 En uso', bg: '#dcfce7', color: '#166534' }, devolucion_pendiente: { txt: '🔄 Devolución...', bg: '#fed7aa', color: '#9a3412' },
      devuelta: { txt: '↩️ Devuelta', bg: '#f1f5f9', color: '#475569' }, extra: { txt: '➕ Extra', bg: '#e9d5ff', color: '#6b21a8' },
      extra_pendiente: { txt: '⏳ Extra pendiente', bg: '#ffedd5', color: '#9a3412' }, rechazada: { txt: '❌ Rechazada', bg: '#fee2e2', color: '#b91c1c' }
    };
    return map[estado] || { txt: estado || 'Sin estado', bg: '#f1f5f9', color: '#475569' };
  }
  function badge(txt, bg, color, extra) { return `<span class="nxRcBadge" style="background:${bg};color:${color};${extra || ''}">${txt}</span>`; }

  // ─────────────────────────── reglas (mismas de BAYOL) ───────────────────────────
  function _reacondEquipoPasaEstado(e, f) {
    const estado = e.estado_evaluacion || 'pendiente';
    if (f === 'recibido') return estado === 'pendiente';
    if (f === 'diagnostico') return inList(['en_evaluacion', 'evaluado'], estado);
    if (f === 'reparacion') return inList(_REACOND_ESTADOS_REPARACION, estado);
    if (f === 'control_calidad') return estado === 'listo_revision';
    if (f === 'despachado') return estado === 'vendido';
    if (f === 'completado') return estado === 'vendido' && e.completado;
    if (f === 'vendido') return estado === 'vendido' && !e.completado;
    if (f === 'en_proceso') return inList(_REACOND_ESTADOS_TRABAJO, estado);
    if (f) return estado === f;
    return true;
  }
  function _reacondValidarMovimientoMasivo(eq, destino) {
    const estado = eq.estado_evaluacion || 'pendiente';
    if (destino === 'evaluado') return estado === 'en_evaluacion';
    if (destino === 'en_proceso') return estado === 'evaluado' && !!eq.tecnico_asignado_id;
    if (destino === 'listo_venta') return estado === 'listo_revision' || (estado === 'evaluado' && !eq.tecnico_asignado_id);
    if (destino === 'vendido') return estado === 'listo_venta';
    if (destino === 'completado') return estado === 'vendido' && !eq.completado;
    return false;
  }
  function _reacondEsPiezaCostoInfoPlus(p) { return !!p && !p.agregada_por_tecnico && !!p.producto_id && p.estado === 'aprobada' && !p.tecnico_id; }
  function _reacondEsSolicitudTecnico(p) { return !!p && !_reacondEsPiezaCostoInfoPlus(p); }
  function _reacondTienePiezasPendientes(filas) {
    return (filas || []).some(p => (!!p.agregada_por_tecnico || !!p.tecnico_id) && inList(['pendiente', 'extra_pendiente', 'aprobada', 'entregada'], p.estado) && !(p.estado === 'aprobada' && !p.agregada_por_tecnico));
  }
  function _tienePiezasInfoPlus(equipoId) { return cache.piezasReacond.some(p => p.equipo_id === equipoId && _reacondEsPiezaCostoInfoPlus(p) && p.estado !== 'rechazada' && p.estado !== 'devuelta'); }
  function fallasPendientesDe(tipo, refId) { return cache.tareas.filter(t => t.tipo === tipo && t.ref_id === refId && t.estado !== 'hecha').length; }
  function calcularFleteEquipo(eq) {
    if (!eq || !eq.lote_id) return 0;
    const l = lote(eq.lote_id); const total = Number(l && l.gastos_envio) || 0; if (total <= 0) return 0;
    const equipos = cache.refurb.filter(r => r.lote_id === eq.lote_id);
    const base = equipos.reduce((s, e) => s + (Number(e.costo_compra) || 0), 0);
    if (base > 0) return total * ((Number(eq.costo_compra) || 0) / base);
    return equipos.length ? total / equipos.length : 0;
  }
  function _costoEquipoRep(e) { const compra = Number(e.costo_compra) || 0, flete = calcularFleteEquipo(e), piezas = Number(e.costo_repuestos) || 0; return { compra, flete, piezas, fin: compra + flete + piezas }; }
  function _modeloRep(e) { let m = (e.modelo || '').toString().trim(); const cap = (e.capacidad || '').toString().trim(); if (cap && !m.toUpperCase().includes(cap.toUpperCase())) m = (m + ' ' + cap).trim(); return m; }
  function _loteConcluido(loteId) { const eq = cache.refurb.filter(r => r.lote_id === loteId); return eq.length > 0 && eq.every(e => inList(['listo_venta', 'vendido'], e.estado_evaluacion)); }
  function _equiposEvaluadosDisponibles() { if (!reacondLoteAbiertoId) return []; return cache.refurb.filter(r => r.lote_id === reacondLoteAbiertoId && r.estado_evaluacion === 'evaluado' && !r.tecnico_asignado_id).sort((a, b) => (a.creado_en || '').localeCompare(b.creado_en || '')); }
  async function historial(equipoId, anterior, nuevo, accion, notas) {
    try { await api().post('pos_reacond_historial', { equipo_id: equipoId, estado_anterior: anterior || null, estado_nuevo: nuevo || null, accion: accion || 'Cambio de estado', notas: notas || null, usuario: miNombre() }); } catch (e) { logError('historial', e); }
  }
  async function _recalcularCostoRepuestos(equipoId) {
    try {
      const pz = await api().get('pos_reacond_piezas', 'select=cantidad,costo_unitario,estado&equipo_id=eq.' + equipoId) || [];
      const total = pz.filter(p => !inList(['rechazada', 'devuelta'], p.estado)).reduce((s, p) => s + (Number(p.cantidad) || 1) * (Number(p.costo_unitario) || 0), 0);
      await api().patch('pos_reacond_equipos', 'id=eq.' + equipoId, { costo_repuestos: total });
    } catch (e) { logError('recalcular costo repuestos', e); }
  }
  async function asignarFallasSinDueno(tipo, refId, tecnicoId) {
    if (!tecnicoId) return;
    try { await api().patch('pos_reacond_tareas', 'tipo=eq.' + tipo + '&ref_id=eq.' + refId + '&tecnico_id=is.null', { tecnico_id: tecnicoId }); } catch (e) { logError('asignar fallas sin dueño', e); }
  }

  // ═══════════════════════════ VISTA PRINCIPAL (#v-refurb) ═══════════════════════════
  function render() {
    ensureCSS();
    if (!_cargado) return `<div class="nxRc"><div class="nxRcCard" style="text-align:center;color:#85817a;padding:40px"><i class="ti ti-loader-2 nxRcSpin"></i> Cargando reacondicionados…</div></div>`;
    if (esTecnicoNoAdmin() && reacondMainTab === 'mis') return `<div class="nxRc">${moduleNav()}<div id="misReacondContenido" class="nxRcCard"></div></div>`;
    const cont = {
      lotes: () => reacondLoteAbiertoId ? htmlDetalleLote() : htmlListaLotes(),
      catalogo: () => window.__nxRcInt.htmlCatalogo(), devoluciones: () => window.__nxRcInt.htmlDevoluciones(), piezas: () => window.__nxRcInt.htmlPedidosPiezas(), rentabilidad: () => window.__nxRcInt.htmlRentabilidad(), mis: () => '<div id="misReacondContenido" class="nxRcCard"></div>'
    };
    return `<div class="nxRc">${moduleNav()}${(cont[reacondMainTab] || cont.lotes)()}</div>`;
  }
  function postRender() {
    if (!_cargado) return;
    if (reacondMainTab === 'lotes') { if (reacondLoteAbiertoId) renderDetalleLoteReacond(); else cargarLotesReacond(); }
    else if (reacondMainTab === 'catalogo') window.__nxRcInt.renderCatalogoFallas();
    else if (reacondMainTab === 'devoluciones') window.__nxRcInt.cargarDevoluciones();
    else if (reacondMainTab === 'piezas') window.__nxRcInt.renderPedidosPiezasReacond();
    else if (reacondMainTab === 'rentabilidad') window.__nxRcInt.renderRentabilidadReacond();
    else if (reacondMainTab === 'mis') window.__nxRcInt.renderMisReacond();
  }
  function moduleNav() {
    const tabs = [['lotes', 'ti-stack', 'Lotes'], ['catalogo', 'ti-list-details', 'Catálogo de Fallas'], ['devoluciones', 'ti-rotate-2', 'Devoluciones'], ['piezas', 'ti-packages', 'Pedidos de Piezas'], ['rentabilidad', 'ti-cash', 'Rentabilidad']];
    const mine = esTecnicoNoAdmin() ? [['mis', 'ti-user-cog', 'Mis reacondicionados']] : [];
    const vis = mine.concat(tabs.filter(t => t[0] !== 'rentabilidad' || isAdminUser()));
    return `<div class="reacond-module-nav nxRcNav">${vis.map(t => `<button type="button" id="reacondMainTab_${t[0]}" class="reacond-main-tab${reacondMainTab === t[0] ? ' tab-active' : ''}" onclick="window.nxRc.mainTab('${t[0]}')"><span class="reacond-main-icon"><i class="ti ${t[1]}"></i></span><span class="reacond-main-label">${t[2]}</span></button>`).join('')}</div>`;
  }
  function cambiarMainTabReacond(tab) {
    const validas = ['lotes', 'catalogo', 'devoluciones', 'piezas', 'rentabilidad', 'mis'];
    if (!inList(validas, tab)) tab = 'lotes';
    if (tab === 'rentabilidad' && !isAdminUser()) tab = 'lotes';
    reacondMainTab = tab; try { localStorage.setItem('studio_subtab_reacond', tab); } catch (e) {}
    rerenderPOS();
  }

  // ─────────────────────────── VISTA 1: lista de lotes por etapa ───────────────────────────
  function htmlListaLotes() {
    const stages = [['recibidos', '01', 'Recibidos', 'cntPendientes', '#fef3c7', '#92400e'], ['evaluacion', '02', 'Diagnóstico', 'cntEvaluacion', '#dbeafe', '#1d4ed8'], ['proceso', '03', 'En reparación', 'cntProceso', '#fed7aa', '#9a3412'], ['control_calidad', '04', 'Control de calidad', 'cntControlCalidad', '#f3e8ff', '#7e22ce'], ['listo_venta', '05', 'Listo para venta', 'cntListoVenta', '#ddd6fe', '#5b21b6'], ['despachados', '06', 'Despachados', 'cntTerminados', '#d1fae5', '#065f46']];
    return `<div id="reacondListaLotes"><div class="nxRcCard reacond-overview-card">
      <div class="nxRcRow" style="margin-bottom:14px">
        <h3 class="nxRcH3"><i class="ti ti-recycle"></i> Reacondicionados</h3>
        <div class="nxRcActs">
          ${isAdminUser() ? `<button type="button" class="btn nxRcBtn gold" onclick="window.nxRc.nuevoLote()"><i class="ti ti-plus"></i> Nuevo lote</button>
          <button type="button" class="btn nxRcBtn dark" onclick="window.nxRc.loteDesdeCompra()"><i class="ti ti-truck-delivery"></i> Lote desde compra</button>
          <button type="button" class="btn nxRcBtn light" id="btnRegistrarExistente" onclick="window.nxRc.registrarExistente()"><i class="ti ti-archive"></i> Registrar equipo existente</button>` : ''}
          <button type="button" class="btn nxRcBtn light" onclick="window.nxRc.refrescar()"><i class="ti ti-refresh"></i> Actualizar</button>
        </div>
      </div>
      <div style="margin-bottom:14px">
        <div class="nxRcSearch"><i class="ti ti-search"></i><input id="reacondBuscadorGlobal" type="text" class="nxRcInput" placeholder="Buscar equipo por IMEI, código o modelo en TODOS los lotes…" value="${esc(_filtros.busqGlobal)}" oninput="window.nxRc.buscarGlobal(this.value)" autocomplete="off"></div>
        <div id="reacondBuscadorGlobalResultados"></div>
      </div>
      <div class="tabs reacond-tabs-scroll nxRcStages">
        ${stages.map(s => `<button type="button" class="tab-btn${reacondTabActual === s[0] ? ' active' : ''}" data-tab="${s[0]}" onclick="window.nxRc.tab('${s[0]}')"><span class="reacond-stage-number">${s[1]}</span><span class="reacond-stage-label">${s[2]}</span><span id="${s[3]}" class="badge" style="background:${s[4]};color:${s[5]}">0</span></button>`).join('')}
      </div>
      <div id="lotesReacondContainer"><p class="nxRcMuted" style="text-align:center;padding:20px">Cargando...</p></div>
      <div id="lotesReacondPagination"></div>
    </div></div>`;
  }
  function cambiarTabReacond(tab) { reacondTabActual = tab; document.querySelectorAll('#reacondListaLotes .tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab)); cargarLotesReacond(); }
  function cargarLotesReacond() {
    const lotesReacond = cache.lotes.filter(l => l.enviado_reacond !== false);
    const lotesConEstado = lotesReacond.map(l => {
      const equipos = cache.refurb.filter(r => r.lote_id === l.id);
      const pendientes = equipos.filter(e => (e.estado_evaluacion || 'pendiente') === 'pendiente').length;
      const enEval = equipos.filter(e => e.estado_evaluacion === 'en_evaluacion').length;
      const evaluados = equipos.filter(e => e.estado_evaluacion === 'evaluado').length;
      const enProceso = equipos.filter(e => inList(_REACOND_ESTADOS_REPARACION, e.estado_evaluacion)).length;
      const controlCalidad = equipos.filter(e => e.estado_evaluacion === 'listo_revision').length;
      const listoVenta = equipos.filter(e => e.estado_evaluacion === 'listo_venta').length;
      const vendidos = equipos.filter(e => e.estado_evaluacion === 'vendido').length;
      const completados = equipos.filter(e => e.estado_evaluacion === 'vendido' && e.completado).length;
      return { lote: l, equipos, pendientes, enEval, evaluados, diagnostico: enEval + evaluados, enProceso, controlCalidad, listoVenta, vendidos, completados, despachadosNC: vendidos - completados, total: equipos.length };
    });
    const setBadge = (id, n) => { const el = byId(id); if (el) el.textContent = n; };
    setBadge('cntPendientes', lotesConEstado.reduce((s, d) => s + d.pendientes, 0));
    setBadge('cntEvaluacion', lotesConEstado.reduce((s, d) => s + d.diagnostico, 0));
    setBadge('cntProceso', lotesConEstado.reduce((s, d) => s + d.enProceso, 0));
    setBadge('cntControlCalidad', lotesConEstado.reduce((s, d) => s + d.controlCalidad, 0));
    setBadge('cntListoVenta', lotesConEstado.reduce((s, d) => s + d.listoVenta, 0));
    setBadge('cntTerminados', lotesConEstado.reduce((s, d) => s + d.vendidos, 0));
    renderLotesReacondTab(lotesConEstado);
  }
  function renderLotesReacondTab(lotesConEstado) {
    const cont = byId('lotesReacondContainer'); if (!cont) return;
    let filtrados;
    if (reacondTabActual === 'recibidos') filtrados = lotesConEstado.filter(d => d.pendientes > 0);
    else if (reacondTabActual === 'evaluacion') filtrados = lotesConEstado.filter(d => d.diagnostico > 0);
    else if (reacondTabActual === 'proceso') filtrados = lotesConEstado.filter(d => d.enProceso > 0);
    else if (reacondTabActual === 'control_calidad') filtrados = lotesConEstado.filter(d => d.controlCalidad > 0);
    else if (reacondTabActual === 'listo_venta') filtrados = lotesConEstado.filter(d => d.listoVenta > 0);
    else if (reacondTabActual === 'despachados') filtrados = lotesConEstado.filter(d => d.vendidos > 0);
    else filtrados = lotesConEstado;
    if (!filtrados.length) {
      const msg = { recibidos: 'No hay equipos recibidos pendientes de diagnóstico.', evaluacion: 'No hay equipos en diagnóstico.', proceso: 'No hay equipos en reparación.', control_calidad: 'No hay equipos esperando control de calidad.', listo_venta: 'No hay lotes con equipos listos para venta.' }[reacondTabActual] || 'No hay lotes con equipos despachados.';
      const vacioTotal = !cache.lotes.length && isAdminUser() ? `<div style="margin-top:10px"><button type="button" class="btn nxRcBtn gold" onclick="window.nxRc.nuevoLote()"><i class="ti ti-plus"></i> Crear el primer lote</button></div>` : '';
      cont.innerHTML = `<p class="nxRcMuted" style="text-align:center;padding:30px;font-size:13px">${msg}${vacioTotal}</p>`;
      const pg = byId('lotesReacondPagination'); if (pg) pg.innerHTML = ''; return;
    }
    const p = _uiListPage('lotesReacond', filtrados.length);
    cont.innerHTML = filtrados.slice(p.start, p.start + UI_LIST_PAGE_SIZE).map(d => {
      const l = d.lote, pv = prov(l.proveedor_id);
      const nombreLote = l.codigo_lote || ('Lote #' + (l.id || '').slice(0, 8));
      const progreso = d.total > 0 ? Math.round(((d.controlCalidad + d.listoVenta + d.vendidos) / d.total) * 100) : 0;
      return `<div class="reacond-lote-card nxRcLote">
        <div class="nxRcRow" style="align-items:flex-start">
          <div style="flex:1;min-width:200px">
            <div class="reacond-lote-name">${esc(nombreLote)}</div>
            <div class="reacond-lote-meta nxRcMuted"><i class="ti ti-truck"></i> ${esc(pv ? pv.nombre : 'Sin proveedor')}<br><i class="ti ti-calendar"></i> Compra: ${fechaDO(l.fecha_compra)} · Enviado: ${fechaDO(l.fecha_envio_reacond)}</div>
          </div>
          <button type="button" class="btn nxRcBtn gold" onclick="window.nxRc.abrirLote('${l.id}')"><i class="ti ti-folder-open"></i> Abrir Lote</button>
        </div>
        <div class="reacond-lote-stages">
          <div class="reacond-lote-stage" style="background:#fef3c7"><b style="color:#92400e">${d.pendientes}</b><br>Recibidos</div>
          <div class="reacond-lote-stage" style="background:#dbeafe"><b style="color:#1d4ed8">${d.diagnostico}</b><br>Diagnóstico</div>
          <div class="reacond-lote-stage" style="background:#fed7aa"><b style="color:#9a3412">${d.enProceso}</b><br>Reparación</div>
          <div class="reacond-lote-stage" style="background:#f3e8ff"><b style="color:#7e22ce">${d.controlCalidad}</b><br>Calidad</div>
          <div class="reacond-lote-stage" style="background:#ddd6fe"><b style="color:#5b21b6">${d.listoVenta}</b><br>Listo Venta</div>
          <div class="reacond-lote-stage" style="background:#dcfce7"><b style="color:#15803d">${d.vendidos}</b><br>Despachados</div>
          <div class="reacond-lote-stage reacond-lote-total"><b>${d.total}</b><br>Total</div>
        </div>
        <div class="reacond-lote-progress"><div style="width:${progreso}%"></div></div>
        <div class="reacond-lote-progress-label">${progreso}% completado</div>
      </div>`;
    }).join('');
    const pg = byId('lotesReacondPagination'); if (pg) pg.innerHTML = _uiListPager('lotesReacond', filtrados.length, 'lotes');
    _uiListRenderers.lotesReacond = () => renderLotesReacondTab(lotesConEstado);
  }
  function buscarEquipoGlobalReacond(v) {
    _filtros.busqGlobal = v || '';
    const ql = _filtros.busqGlobal.toLowerCase().trim(); const cont = byId('reacondBuscadorGlobalResultados'); if (!cont) return;
    if (ql.length < 2) { cont.innerHTML = ''; return; }
    const pal = ql.split(/\s+/).filter(Boolean);
    const matches = cache.refurb.filter(e => { const hay = [e.imei, e.articulo_codigo, e.modelo, e.marca, e.capacidad, e.color].filter(Boolean).join(' ').toLowerCase(); return pal.every(p => hay.includes(p)); }).slice(0, 40);
    if (!matches.length) { cont.innerHTML = `<div class="nxRcMuted" style="padding:10px;font-size:13px">Ningún equipo coincide con "${esc(ql)}".</div>`; return; }
    cont.innerHTML = `<div class="nxRcGlobalRes">` + matches.map(e => {
      const l = lote(e.lote_id); const loteName = l ? (l.codigo_lote || (l.id || '').slice(0, 8)) : 'Sin lote';
      let et = obtenerEtiquetaEstado(e.estado_evaluacion); if (e.estado_evaluacion === 'vendido') et = { text: '🚚 DESPACHADO', bg: '#dcfce7', color: '#15803d' };
      const qArg = (e.imei || e.articulo_codigo || e.modelo || '').toString().replace(/'/g, '');
      return `<div class="nxRcGlobalItem" onclick="window.nxRc.irAEquipo('${e.id}','${e.lote_id}','${esc(qArg)}')"><div style="min-width:0"><div style="font-weight:700;font-size:13px">${esc(e.modelo || 'Equipo')}</div><div class="nxRcMuted" style="font-size:11.5px">IMEI: ${esc(e.imei || '—')}${e.articulo_codigo ? ' · cód ' + esc(e.articulo_codigo) : ''}</div></div><div style="text-align:right;white-space:nowrap">${badge(et.text, et.bg, et.color)}<div style="font-size:12px;font-weight:800;color:#806515;margin-top:3px">📦 ${esc(loteName)}</div></div></div>`;
    }).join('') + '</div>';
  }
  function _irAEquipoReacond(equipoId, loteId, qq) { _filtros.busqGlobal = ''; _filtros.estado = ''; _filtros.busq = qq || ''; abrirLoteReacond(loteId, true); }

  // ─────────────────────────── VISTA 2: detalle del lote ───────────────────────────
  function abrirLoteReacond(loteId, mantenerBusq) {
    reacondLoteAbiertoId = loteId; _reacondSel = new Set(); _reacondSelCosto = new Set(); _reacondFiltroTec = '';
    if (!mantenerBusq) { _filtros.busq = ''; const mapa = { recibidos: 'recibido', evaluacion: 'diagnostico', proceso: 'reparacion', control_calidad: 'control_calidad', listo_venta: 'listo_venta', despachados: 'despachado' }; _filtros.estado = mapa[reacondTabActual] || ''; }
    _uiListPages.reacondEquipos = 1;
    rerenderPOS();
  }
  function volverListaLotesReacond() { reacondLoteAbiertoId = null; rerenderPOS(); }
  function htmlDetalleLote() {
    const l = lote(reacondLoteAbiertoId); if (!l) { reacondLoteAbiertoId = null; return htmlListaLotes(); }
    const kpi = (id, filtro, titulo, bg, color, num, label) => `<div id="${id}" class="reacond-kpi-card" onclick="window.nxRc.filtrarEstado('${filtro}')" title="${titulo}" style="background:${bg}"><div style="color:${color}" id="${num}">0</div><div style="color:${color}">${label}</div></div>`;
    const admin = isAdminUser();
    return `<div id="reacondDetalleLote"><div class="nxRcCard reacond-detail-card">
      <div class="nxRcRow" style="margin-bottom:14px">
        <button type="button" class="btn nxRcBtn light" onclick="window.nxRc.volver()"><i class="ti ti-arrow-left"></i> Volver</button>
        <h3 id="reacondLoteTitulo" class="nxRcH3" style="flex:1;text-align:center;justify-content:center">Lote</h3>
        <span id="reacondLoteEstadoBadge" class="nxRcBadge"></span>
      </div>
      <div id="reacondLoteInfo" class="nxRcLoteInfo"></div>
      <div class="reacond-detail-kpis">
        ${kpi('kpiCardPendiente', 'recibido', 'Clic para filtrar', '#fef3c7', '#92400e', 'kpiPendientes', 'RECIBIDOS')}
        ${kpi('kpiCardDiagnostico', 'diagnostico', 'Incluye diagnósticos abiertos y terminados por asignar', '#dbeafe', '#1d4ed8', 'kpiDiagnostico', 'DIAGNÓSTICO')}
        ${kpi('kpiCardProceso', 'reparacion', 'Las incidencias se muestran como etiquetas', '#fed7aa', '#9a3412', 'kpiProceso', 'EN REPARACIÓN')}
        ${kpi('kpiCardCalidad', 'control_calidad', 'Equipos esperando revisión administrativa', '#f3e8ff', '#7e22ce', 'kpiCalidad', 'CONTROL DE CALIDAD')}
        ${kpi('kpiCardListoV', 'listo_venta', 'Clic para filtrar', '#ddd6fe', '#5b21b6', 'kpiListoV', 'LISTO')}
        ${kpi('kpiCardDespachado', 'despachado', 'Equipos que ya salieron del taller', '#dcfce7', '#15803d', 'kpiDespachado', 'DESPACHADO')}
      </div>
      <div class="nxRcRow" style="margin:14px 0 10px">
        <h4 class="nxRcH4"><i class="ti ti-devices-pc"></i> Equipos del Lote</h4>
        <div class="nxRcActs">
          <label class="nxRcChk"><input type="checkbox" id="reacondSelTodos" onclick="window.nxRc.selTodos(this.checked)"> Marcar todos</label>
          <span class="nxRcDateFilt" title="Filtrar por fecha (Despachado)"><i class="ti ti-calendar"></i><input id="reacondFechaDesde" type="date" value="${esc(_filtros.fechaDesde)}" onchange="window.nxRc.fecha('desde',this.value)"><span>–</span><input id="reacondFechaHasta" type="date" value="${esc(_filtros.fechaHasta)}" onchange="window.nxRc.fecha('hasta',this.value)"><button type="button" onclick="window.nxRc.limpiarFecha()" title="Limpiar fecha"><i class="ti ti-x"></i></button></span>
          <span id="reacondSelCount" style="font-size:12px;color:#b45309;font-weight:700"></span>
          ${admin ? `<button type="button" class="btn nxRcBtn" style="background:#f59e0b;color:#fff;border-color:#f59e0b" onclick="window.nxRc.abrirAsignarLote()"><i class="ti ti-users"></i> Asignar a técnico</button>` : ''}
          ${admin ? `<div style="position:relative;display:inline-block">
            <button type="button" class="btn nxRcBtn" style="background:#5b21b6;color:#fff;border-color:#5b21b6" onclick="window.nxRc.togglePasar(event)"><i class="ti ti-arrows-exchange"></i> Pasar a ▾</button>
            <div id="reacondPasarMenu" class="nxRcMenu" style="display:none">
              <div class="nxRcMenuTit">Acción válida para la selección:</div>
              <button type="button" onclick="window.nxRc.pasarA('evaluado')"><i class="ti ti-clipboard-check"></i> Diagnóstico listo</button>
              <button type="button" onclick="window.nxRc.pasarA('en_proceso')"><i class="ti ti-tool"></i> En reparación</button>
              <button type="button" onclick="window.nxRc.pasarA('listo_venta')"><i class="ti ti-shopping-cart"></i> Listo para venta</button>
              <button type="button" onclick="window.nxRc.pasarA('vendido')"><i class="ti ti-truck-delivery"></i> Despachado</button>
              <button type="button" style="border-top:1px solid #f1f5f9" onclick="window.nxRc.pasarA('completado')"><i class="ti ti-lock-check"></i> Cerrar salida</button>
            </div></div>` : ''}
          ${admin ? `<button type="button" class="btn nxRcBtn light" onclick="window.nxRc.agregarEquipo()"><i class="ti ti-plus"></i> Agregar equipo</button>
          <button type="button" class="btn nxRcBtn light" style="color:#166534;border-color:#86efac" onclick="window.nxRc.imprimirCostos()"><i class="ti ti-printer"></i> Imprimir</button>
          <button type="button" class="btn nxRcBtn light" style="color:#15803d;border-color:#86efac" onclick="window.nxRc.excelCostos()"><i class="ti ti-file-spreadsheet"></i> Exportar Excel</button>
          <button type="button" class="btn nxRcBtn light" onclick="window.nxRc.editarLote()"><i class="ti ti-edit"></i> Datos del lote</button>
          <button type="button" class="btn nxRcBtn light" id="btnImprimirSelCosto" style="display:none" onclick="window.nxRc.imprimirCostos(true)"></button>
          <button type="button" class="btn nxRcBtn light" id="btnCompletarSel" style="display:none" onclick="window.nxRc.marcarCompletado()"></button>
          <button type="button" class="btn nxRcBtn light" id="btnDescompletarSel" style="display:none" onclick="window.nxRc.regresarDespachado()"></button>` : ''}
        </div>
      </div>
      <div id="reacondTecnicosRow" class="nxRcTecRow"></div>
      <div class="nxRcFiltRow">
        <div class="nxRcSearch" style="flex:1;min-width:220px"><i class="ti ti-search"></i><input id="reacondBusq" class="nxRcInput" placeholder="Buscar / escanear por IMEI, código o modelo…" value="${esc(_filtros.busq)}" oninput="window.nxRc.busq(this.value)" onkeydown="if(event.key==='Enter'){event.preventDefault();window.nxRc.busq(this.value)}" autocomplete="off"></div>
        <select id="reacondFiltroEstado" class="nxRcInput" onchange="window.nxRc.filtroEstado(this.value)">
          <option value="">Todas las etapas</option><option value="recibido">Recibido</option><option value="diagnostico">Diagnóstico</option><option value="reparacion">En reparación</option><option value="control_calidad">Control de calidad</option><option value="listo_venta">Listo para venta</option><option value="despachado">Despachado</option>
        </select>
      </div>
      <div id="reacondEquiposLista"></div>
      <div id="reacondEquiposPagination"></div>
    </div></div>`;
  }
  function _reacondTecnicosResumen() {
    const res = {}; const TERM = ['listo_venta', 'vendido', 'completado'];
    const fEstado = _filtros.estado, ql = _filtros.busq.toLowerCase().trim(); const pal = ql ? ql.split(/\s+/).filter(Boolean) : [];
    cache.refurb.filter(r => r.lote_id === reacondLoteAbiertoId && r.tecnico_asignado_id).filter(r => _reacondEquipoPasaEstado(r, fEstado))
      .filter(r => { if (!pal.length) return true; const hay = [r.imei, r.articulo_codigo, r.modelo, r.marca, r.capacidad, r.color].filter(Boolean).join(' ').toLowerCase(); return pal.every(p => hay.includes(p)); })
      .forEach(r => { const k = r.tecnico_asignado_id; if (!res[k]) res[k] = { total: 0, term: 0 }; res[k].total++; if (inList(TERM, r.estado_evaluacion) || r.completado) res[k].term++; });
    return res;
  }
  function _reacondPasaFecha(eq) {
    const d1 = _filtros.fechaDesde, d2 = _filtros.fechaHasta; if (!d1 && !d2) return true;
    const f = eq.fecha_completado || eq.fecha_despacho; if (!f) return false;
    const fecha = new Date(f).toLocaleDateString('en-CA'); if (d1 && fecha < d1) return false; if (d2 && fecha > d2) return false; return true;
  }
  function renderDetalleLoteReacond() {
    if (!reacondLoteAbiertoId) return;
    const l = lote(reacondLoteAbiertoId); if (!l) { volverListaLotesReacond(); return; }
    const pv = prov(l.proveedor_id);
    const equipos = cache.refurb.filter(r => r.lote_id === reacondLoteAbiertoId);
    const tit = byId('reacondLoteTitulo'); if (tit) tit.textContent = l.codigo_lote || ('Lote #' + (l.id || '').slice(0, 8));
    const pendientes = equipos.filter(e => (e.estado_evaluacion || 'pendiente') === 'pendiente').length;
    const diagnostico = equipos.filter(e => inList(['en_evaluacion', 'evaluado'], e.estado_evaluacion)).length;
    const enProceso = equipos.filter(e => inList(_REACOND_ESTADOS_REPARACION, e.estado_evaluacion)).length;
    const controlCalidad = equipos.filter(e => e.estado_evaluacion === 'listo_revision').length;
    const listoV = equipos.filter(e => e.estado_evaluacion === 'listo_venta').length;
    const despachados = equipos.filter(e => e.estado_evaluacion === 'vendido').length;
    const setK = (id, v) => { const e = byId(id); if (e) e.textContent = v; };
    setK('kpiPendientes', pendientes); setK('kpiDiagnostico', diagnostico); setK('kpiProceso', enProceso); setK('kpiCalidad', controlCalidad); setK('kpiListoV', listoV); setK('kpiDespachado', despachados);
    const bd = byId('reacondLoteEstadoBadge');
    if (bd) {
      if (equipos.length > 0 && (listoV + despachados) === equipos.length) { bd.innerHTML = '<i class="ti ti-circle-check"></i> Lote concluido'; bd.style.cssText = 'background:#ede9fe;color:#5b21b6'; }
      else if (controlCalidad > 0) { bd.innerHTML = '<i class="ti ti-shield-check"></i> Control de calidad'; bd.style.cssText = 'background:#f3e8ff;color:#7e22ce'; }
      else if (enProceso > 0) { bd.innerHTML = '<i class="ti ti-tool"></i> En reparación'; bd.style.cssText = 'background:#fed7aa;color:#9a3412'; }
      else if (diagnostico > 0) { bd.innerHTML = '<i class="ti ti-clipboard-list"></i> Diagnóstico'; bd.style.cssText = 'background:#dbeafe;color:#1d4ed8'; }
      else { bd.innerHTML = '<i class="ti ti-package-import"></i> Recibido'; bd.style.cssText = 'background:#fef3c7;color:#92400e'; }
    }
    const info = byId('reacondLoteInfo');
    if (info) info.innerHTML = `<div class="nxRcInfoGrid">
      <div><b><i class="ti ti-truck"></i> Proveedor:</b><br>${esc(pv ? pv.nombre : 'Sin proveedor')}</div>
      <div><b><i class="ti ti-calendar"></i> Compra:</b><br>${fechaDO(l.fecha_compra)}</div>
      <div><b><i class="ti ti-package"></i> Total equipos:</b><br>${equipos.length}</div>
      ${isAdminUser() ? `<div><b><i class="ti ti-plane-departure"></i> Envío (courier):</b><br><span>${money(Number(l.gastos_envio) || 0)}</span> <a onclick="window.nxRc.editarEnvio()" style="cursor:pointer;color:#806515;font-size:11px"><i class="ti ti-edit"></i> editar</a></div>` : ''}
      ${l.notas ? `<div style="grid-column:1/-1"><b><i class="ti ti-note"></i> Notas:</b><br>${esc(l.notas)}</div>` : ''}
    </div>`;
    const rowTec = byId('reacondTecnicosRow');
    if (rowTec) {
      const resTec = _reacondTecnicosResumen(); const keys = Object.keys(resTec);
      if (!keys.length) rowTec.innerHTML = '';
      else rowTec.innerHTML = `<span class="nxRcMuted" style="font-size:12px;align-self:center"><i class="ti ti-user-cog"></i> Técnicos:</span>` + keys.map(tid => {
        const activo = _reacondFiltroTec === tid, r = resTec[tid];
        const sub = (!_filtros.estado && r.term > 0) ? ` <span style="font-weight:600;opacity:.85">(${r.term} listo${r.term > 1 ? 's' : ''})</span>` : '';
        return `<button type="button" class="nxRcTecChip${activo ? ' on' : ''}" onclick="window.nxRc.filtrarTec('${tid}')"><i class="ti ti-user"></i> ${esc(nombreEmpleado(tid))} · ${r.total}${sub}</button>`;
      }).join('') + (_reacondFiltroTec ? `<button type="button" class="nxRcLink red" onclick="window.nxRc.filtrarTec('${_reacondFiltroTec}')"><i class="ti ti-x"></i> quitar filtro</button>` : '');
    }
    const sel = byId('reacondFiltroEstado'); if (sel) sel.value = _filtros.estado;
    const cont = byId('reacondEquiposLista'); if (!cont) return;
    const pg = byId('reacondEquiposPagination');
    if (!equipos.length) { cont.innerHTML = `<p class="nxRcMuted" style="text-align:center;padding:20px">Este lote no tiene equipos.${isAdminUser() ? ' Usa <b>Agregar equipo</b> para registrar el primero.' : ''}</p>`; if (pg) pg.innerHTML = ''; return; }
    const cardMap = { recibido: 'kpiCardPendiente', diagnostico: 'kpiCardDiagnostico', reparacion: 'kpiCardProceso', control_calidad: 'kpiCardCalidad', listo_venta: 'kpiCardListoV', despachado: 'kpiCardDespachado' };
    Object.values(cardMap).forEach(id => { const c = byId(id); if (c) c.classList.remove('is-filtered'); });
    if (cardMap[_filtros.estado]) { const c = byId(cardMap[_filtros.estado]); if (c) c.classList.add('is-filtered'); }
    let filtrados = equipos.map((eq, i) => ({ eq, num: i + 1 }));
    if (_reacondFiltroTec) filtrados = filtrados.filter(x => x.eq.tecnico_asignado_id === _reacondFiltroTec);
    filtrados = filtrados.filter(x => _reacondEquipoPasaEstado(x.eq, _filtros.estado)).filter(x => _reacondPasaFecha(x.eq));
    const ql = _filtros.busq.toLowerCase().trim();
    if (ql) { const pal = ql.split(/\s+/).filter(Boolean); filtrados = filtrados.filter(x => { const e = x.eq; const hay = [e.imei, e.articulo_codigo, e.modelo, e.marca, e.capacidad, e.color].filter(Boolean).join(' ').toLowerCase(); return pal.every(p => hay.includes(p)); }); }
    if (!filtrados.length) { cont.innerHTML = '<p class="nxRcMuted" style="text-align:center;padding:20px">Ningún equipo coincide con la búsqueda/filtro.</p>'; if (pg) pg.innerHTML = ''; _reacondVisibleEquipos = []; _reacondActualizarSelUI(); return; }
    _reacondVisibleEquipos = filtrados.map(x => x.eq);
    const p = _uiListPage('reacondEquipos', filtrados.length);
    cont.innerHTML = filtrados.slice(p.start, p.start + UI_LIST_PAGE_SIZE).map(x => renderEquipoReacondCard(x.eq, x.num)).join('');
    if (pg) pg.innerHTML = _uiListPager('reacondEquipos', filtrados.length, 'equipos reacondicionados');
    _uiListRenderers.reacondEquipos = () => renderDetalleLoteReacond();
    _reacondActualizarSelUI(); _reacondActualizarSelCostoUI();
    const todos = byId('reacondSelTodos'); if (todos) { const vis = _reacondVisibleEquipos; todos.checked = vis.length > 0 && vis.every(e => _reacondSel.has(e.id)); }
  }
  function renderEquipoReacondCard(eq, num) {
    const estado = eq.estado_evaluacion || 'pendiente';
    const tec = eq.tecnico_asignado_id ? cache.tecnicos.find(t => String(t.id) === String(eq.tecnico_asignado_id)) : null;
    let badgeColor, badgeText, accion = '', botones = '', indicador = '';
    if (estado === 'pendiente') { badgeColor = 'background:#fef3c7;color:#92400e'; badgeText = '📥 Recibido'; accion = `window.nxRc.empezarEvaluacion('${eq.id}')`; }
    else if (estado === 'en_evaluacion') { badgeColor = 'background:#dbeafe;color:#1d4ed8'; badgeText = '🩺 Diagnóstico en curso'; accion = `window.nxRc.continuarEvaluacion('${eq.id}')`; }
    else if (estado === 'evaluado') { badgeColor = 'background:#d1fae5;color:#065f46'; badgeText = '✅ Diagnóstico listo'; accion = isAdminUser() ? `window.nxRc.abrirAsignarTecnico('${eq.id}')` : `window.nxRc.verHistorial('${eq.id}')`; }
    else if (inList(_REACOND_ESTADOS_REPARACION, estado)) {
      badgeColor = 'background:#fed7aa;color:#9a3412'; badgeText = '🔧 En reparación';
      const ind = { tecnico_recibio: ['📦 Técnico recibió', '#dbeafe', '#1d4ed8'], espera_pieza: ['⏳ Bloqueado por pieza', '#fef3c7', '#92400e'], reasignado: ['👥 Reasignado', '#fef3c7', '#92400e'], reparacion_externa: ['↗ Reparación externa', '#e0f2fe', '#0369a1'] }[estado];
      if (ind) indicador = badge(ind[0], ind[1], ind[2], 'font-size:10px');
      accion = `window.nxRc.abrirPanelProceso('${eq.id}')`;
    }
    else if (estado === 'listo_revision') { badgeColor = 'background:#e9d5ff;color:#6b21a8'; badgeText = '🛡️ Control de calidad'; accion = `window.nxRc.abrirPanelProceso('${eq.id}')`; }
    else if (estado === 'listo_venta') {
      badgeColor = 'background:#ddd6fe;color:#5b21b6'; badgeText = '🛒 Listo'; accion = `window.nxRc.verFichaDespacho('${eq.id}')`;
      botones = permBtn('estado_despachar', `<button type="button" class="btn nxRcBtn" style="background:linear-gradient(180deg,#10b981,#059669);color:#fff;border-color:#059669" onclick="event.stopPropagation();window.nxRc.marcarDespachado('${eq.id}')"><i class="ti ti-truck-delivery"></i> Registrar salida</button>`);
    }
    else if (estado === 'vendido') {
      badgeColor = 'background:#dcfce7;color:#15803d'; badgeText = '🚚 Despachado';
      indicador = eq.completado ? badge('Registro cerrado', '#e2e8f0', '#334155', 'font-size:10px') : badge('Salida por cerrar', '#fef3c7', '#92400e', 'font-size:10px');
      accion = `window.nxRc.verFichaDespacho('${eq.id}')`;
    }
    else { badgeColor = 'background:#f1f5f9;color:#475569'; badgeText = estado; accion = `window.nxRc.continuarEvaluacion('${eq.id}')`; }
    const verFicha = estado === 'vendido' || estado === 'listo_venta';
    const chkCosto = (isAdminUser() && verFicha) ? `<input type="checkbox" class="nxRcChkCosto" title="Marcar para reporte de costos / cerrar salida" onclick="event.stopPropagation();window.nxRc.toggleSelCosto('${eq.id}',this.checked)" ${_reacondSelCosto.has(eq.id) ? 'checked' : ''}>` : '';
    return `<div class="reacond-equipo-card nxRcEq" onclick="${accion}" title="Clic para continuar">
      <div class="reacond-equipo-layout">
        <div style="flex:1;min-width:200px">
          <div class="reacond-equipo-head">
            <input type="checkbox" class="nxRcChkSel" onclick="event.stopPropagation();window.nxRc.toggleSel('${eq.id}',this.checked)" ${_reacondSel.has(eq.id) ? 'checked' : ''} title="Seleccionar (para asignar o 'Pasar a')">
            ${chkCosto}
            <span class="reacond-equipo-number">#${num}</span>
            ${eq.veces_devuelto > 0 ? `<span title="Equipo devuelto ${eq.veces_devuelto} vez(es)" style="font-size:16px">🔄</span>` : ''}
            <b>${esc(eq.modelo || 'Sin modelo')}</b>
            <span class="nxRcBadge" style="${badgeColor}">${badgeText}</span>
            ${indicador}
            <button type="button" class="nxRcMini" style="background:#cffafe;color:#0e7490;border-color:#67e8f9" onclick="event.stopPropagation();${verFicha ? `window.nxRc.verFichaDespacho('${eq.id}')` : `window.nxRc.verHistorial('${eq.id}')`}" title="${verFicha ? 'Ver ficha (costos y piezas)' : 'Ver historial completo (trabajo, técnicos y costos)'}"><i class="ti ti-eye"></i></button>
            ${verFicha ? `<button type="button" class="nxRcMini" style="background:#fef3c7;color:#92400e;border-color:#fcd34d" onclick="event.stopPropagation();window.nxRc.imprimirLabel('${eq.id}')" title="Imprimir label"><i class="ti ti-printer"></i></button>` : ''}
            ${estado === 'evaluado' ? `<button type="button" class="nxRcMini" style="background:#d1fae5;color:#065f46;border-color:#6ee7b7" onclick="event.stopPropagation();window.nxRc.continuarEvaluacion('${eq.id}')" title="Editar evaluación"><i class="ti ti-pencil"></i></button>` : ''}
            ${isAdminUser() && inList(['pendiente', 'en_evaluacion', 'evaluado'], estado) ? `<button type="button" class="nxRcMini" style="background:#f1f5f9;color:#475569;border-color:#cbd5e1" onclick="event.stopPropagation();window.nxRc.editarEquipo('${eq.id}')" title="Corregir equipo"><i class="ti ti-edit"></i></button>` : ''}
            ${eq.veces_devuelto > 0 ? badge('DEVUELTO ' + eq.veces_devuelto + '×', '#fee2e2', '#991b1b', 'font-size:10px') : ''}
            ${tec ? badge('<i class="ti ti-user"></i> ' + esc(tec.nombre), '#e0e7ff', '#3730a3') : ''}
            ${_tienePiezasInfoPlus(eq.id) ? badge('<i class="ti ti-shopping-cart"></i> Piezas ✓', '#bae6fd', '#075985') : ''}
          </div>
          <div class="reacond-equipo-meta"><i class="ti ti-barcode"></i> IMEI: ${esc(eq.imei || '—')}${eq.color ? ' · ' + esc(eq.color) : ''}${eq.capacidad ? ' · ' + esc(eq.capacidad) : ''}${eq.articulo_codigo ? ' · cód ' + esc(eq.articulo_codigo) : ''}</div>
          ${estado === 'vendido' && eq.fecha_despacho ? `<div style="font-size:11px;font-weight:700;margin-top:5px;color:#15803d"><i class="ti ti-truck-delivery"></i> Salida: ${fechaDO(eq.fecha_despacho)}</div>` : ''}
          ${tec && eq.fecha_asignacion ? `<div style="font-size:11px;color:#0891b2;font-weight:600;margin-top:4px"><i class="ti ti-stopwatch"></i> Tomado: ${tiempoDesde(eq.fecha_asignacion)}</div>` : ''}
          ${eq.notas_diagnostico ? `<div class="nxRcNota"><b>Notas:</b> ${esc(eq.notas_diagnostico)}</div>` : ''}
        </div>
        <div class="reacond-equipo-actions">${botones}<i class="ti ti-chevron-right" style="color:#85817a;font-size:20px" title="Clic para abrir"></i></div>
      </div>
    </div>`;
  }
  function _reacondActualizarSelUI() { const el = byId('reacondSelCount'); if (el) el.textContent = _reacondSel.size ? `${_reacondSel.size} seleccionado(s)` : ''; }
  function _reacondActualizarSelCostoUI() {
    const n = _reacondSelCosto.size; const show = (isAdminUser() && n > 0) ? '' : 'none';
    const b = byId('btnImprimirSelCosto'); if (b) { b.style.display = show; b.innerHTML = `<i class="ti ti-printer"></i> Imprimir costos (${n})`; }
    const selEq = cache.refurb.filter(r => _reacondSelCosto.has(r.id) && r.estado_evaluacion === 'vendido');
    const paraCompletar = selEq.filter(r => !r.completado).length, paraRegresar = selEq.filter(r => r.completado).length;
    const bc = byId('btnCompletarSel'); if (bc) { bc.style.display = (isAdminUser() && paraCompletar > 0) ? '' : 'none'; bc.innerHTML = `<i class="ti ti-lock-check"></i> Cerrar salida (${paraCompletar})`; }
    const bd = byId('btnDescompletarSel'); if (bd) { bd.style.display = (isAdminUser() && paraRegresar > 0) ? '' : 'none'; bd.innerHTML = `<i class="ti ti-lock-open"></i> Reabrir salida (${paraRegresar})`; }
  }
  function _reacondToggleSel(id, checked) { if (checked) _reacondSel.add(id); else _reacondSel.delete(id); _reacondActualizarSelUI(); }
  function _reacondToggleSelCosto(id, checked) { if (checked) _reacondSelCosto.add(id); else _reacondSelCosto.delete(id); _reacondActualizarSelCostoUI(); }
  function _reacondSelTodos(checked) { (_reacondVisibleEquipos || []).forEach(e => { if (checked) _reacondSel.add(e.id); else _reacondSel.delete(e.id); }); if (reacondLoteAbiertoId) renderDetalleLoteReacond(); }
  function _reacondFiltrarPorEstado(estado) { _filtros.estado = (_filtros.estado === estado) ? '' : estado; _uiListPages.reacondEquipos = 1; renderDetalleLoteReacond(); }
  function _reacondFiltrarTec(tid) { _reacondFiltroTec = (_reacondFiltroTec === tid) ? '' : tid; _uiListPages.reacondEquipos = 1; renderDetalleLoteReacond(); }
  function _reacondTogglePasarMenu(e) { if (e) e.stopPropagation(); const m = byId('reacondPasarMenu'); if (!m) return; const abrir = m.style.display === 'none' || !m.style.display; m.style.display = abrir ? 'block' : 'none'; if (abrir) setTimeout(() => document.addEventListener('click', _reacondCerrarPasarMenu), 0); }
  function _reacondCerrarPasarMenu(ev) { const m = byId('reacondPasarMenu'); if (m && !m.contains(ev.target)) { m.style.display = 'none'; document.removeEventListener('click', _reacondCerrarPasarMenu); } }
  async function _reacondPasarA(destino) {
    const m = byId('reacondPasarMenu'); if (m) m.style.display = 'none'; document.removeEventListener('click', _reacondCerrarPasarMenu);
    const ids = [..._reacondSel]; if (!ids.length) return toast('Marca primero los equipos que quieres mover.', 'error');
    const labels = { pendiente: 'Recibido', evaluado: 'Diagnóstico listo', en_proceso: 'En reparación', listo_venta: 'Listo para venta', vendido: 'Despachado', completado: 'Cerrar salida' };
    const equiposCache = cache.refurb.filter(r => _reacondSel.has(r.id));
    const bloqueado = equiposCache.find(r => !_reacondValidarMovimientoMasivo(r, destino));
    if (bloqueado) return toast(`No se puede mover en bloque a «${labels[destino] || destino}». «${bloqueado.modelo || 'Este equipo'}» está en «${obtenerEtiquetaEstado(bloqueado.estado_evaluacion).text.toLowerCase()}». Usa la acción de su etapa para conservar los controles.`, 'error');
    if (!await confirmar(`¿Pasar ${ids.length} equipo(s) a "${labels[destino] || destino}"?`)) return;
    try {
      if (destino === 'vendido') {
        let nPz = 0;
        for (const id of ids) { const r = await api().post('rpc/pos_reacond_despachar', { p_equipo_id: id, p_almacen_id: null, p_usuario: miNombre() }); try { nPz += Number((r && r.piezas && r.piezas.descontadas) || 0); } catch (e) {} }
        _reacondSel = new Set(); await loadAll();
        toast(`✅ ${ids.length} equipo(s) pasado(s) a "Despachado".${nPz ? ' 🧩 ' + nPz + ' pieza(s) descontada(s).' : ''}`);
        renderDetalleLoteReacond(); return;
      }
      const patch = {};
      if (destino === 'completado') { patch.estado_evaluacion = 'vendido'; patch.completado = true; patch.fecha_completado = nowISO(); }
      else { patch.estado_evaluacion = destino; patch.completado = false; patch.fecha_completado = null; }
      await api().patch('pos_reacond_equipos', 'id=in.(' + ids.join(',') + ')', patch);
      try { await api().post('pos_reacond_historial', equiposCache.map(r => ({ equipo_id: r.id, estado_anterior: r.estado_evaluacion, estado_nuevo: patch.estado_evaluacion, accion: 'pasar_a_' + destino, notas: 'Cambio masivo a ' + (labels[destino] || destino), usuario: miNombre() }))); } catch (_) {}
      equiposCache.forEach(r => Object.assign(r, patch));
      _reacondSel = new Set();
      toast(`✅ ${ids.length} equipo(s) pasado(s) a "${labels[destino] || destino}".`);
      renderDetalleLoteReacond();
    } catch (e) { logError('Pasar a estado', e); toastError(friendly(e)); }
  }
  async function _reacondMarcarCompletado() {
    if (!isAdminUser()) return toast('Solo el administrador.', 'error');
    const ids = cache.refurb.filter(r => _reacondSelCosto.has(r.id) && r.estado_evaluacion === 'vendido' && !r.completado).map(r => r.id);
    if (!ids.length) return toast('Marca primero salidas pendientes de cierre.', 'error');
    if (!await confirmar(`¿Cerrar administrativamente ${ids.length} salida(s)? Los equipos seguirán disponibles para garantías.`)) return;
    try {
      await api().patch('pos_reacond_equipos', 'id=in.(' + ids.join(',') + ')', { completado: true, fecha_completado: nowISO() });
      ids.forEach(id => { const r = equipo(id); if (r) { r.completado = true; r.fecha_completado = nowISO(); } _reacondSelCosto.delete(id); });
      toast(`🔒 ${ids.length} salida(s) cerrada(s).`); renderDetalleLoteReacond();
    } catch (e) { logError('Marcar completado', e); toastError(friendly(e)); }
  }
  async function _reacondRegresarDespachado() {
    if (!isAdminUser()) return toast('Solo el administrador.', 'error');
    const ids = cache.refurb.filter(r => _reacondSelCosto.has(r.id) && r.estado_evaluacion === 'vendido' && r.completado).map(r => r.id);
    if (!ids.length) return toast('Marca primero salidas cerradas.', 'error');
    try {
      await api().patch('pos_reacond_equipos', 'id=in.(' + ids.join(',') + ')', { completado: false, fecha_completado: null });
      ids.forEach(id => { const r = equipo(id); if (r) { r.completado = false; r.fecha_completado = null; } _reacondSelCosto.delete(id); });
      toast(`↩️ ${ids.length} salida(s) reabierta(s).`); renderDetalleLoteReacond();
    } catch (e) { logError('Regresar a despachado', e); toastError(friendly(e)); }
  }

  // exportación parcial (el resto del módulo se completa más abajo en el mismo archivo)
  window.nxReacond = {
    cargar: async function () { try { await loadAll(); } catch (e) { logError('cargar', e); } },
    render, postRender, loadAll, cache, get cargado() { return _cargado; }
  };
  window.nxRc = {
    cerrar: cerrarModal, ssFiltrar, ssCerrar, ssPick, ssLimpiar, pagina: _uiSetListPage,
    mainTab: cambiarMainTabReacond, tab: cambiarTabReacond, refrescar: async () => { await loadAll(); rerenderPOS(); toast('Actualizado.'); },
    buscarGlobal: buscarEquipoGlobalReacond, irAEquipo: _irAEquipoReacond, abrirLote: id => abrirLoteReacond(id), volver: volverListaLotesReacond,
    filtrarEstado: _reacondFiltrarPorEstado, filtrarTec: _reacondFiltrarTec, selTodos: _reacondSelTodos, toggleSel: _reacondToggleSel, toggleSelCosto: _reacondToggleSelCosto,
    busq: v => { _filtros.busq = v || ''; _uiListPages.reacondEquipos = 1; renderDetalleLoteReacond(); },
    filtroEstado: v => { _filtros.estado = v || ''; _uiListPages.reacondEquipos = 1; renderDetalleLoteReacond(); },
    fecha: (k, v) => { if (k === 'desde') _filtros.fechaDesde = v || ''; else _filtros.fechaHasta = v || ''; renderDetalleLoteReacond(); },
    limpiarFecha: () => { _filtros.fechaDesde = ''; _filtros.fechaHasta = ''; renderDetalleLoteReacond(); },
    togglePasar: _reacondTogglePasarMenu, pasarA: _reacondPasarA, marcarCompletado: _reacondMarcarCompletado, regresarDespachado: _reacondRegresarDespachado
  };

  // Internos compartidos con la segunda mitad del archivo
  window.__nxRcInt = { api, ctx, esc, money, toast, toastError, friendly, logError, sesion, miId, miNombre, rol, isAdminUser, tienePermiso, permBtn, soloAdmin, nowISO, fechaDO, fechaHoraDO, hoyYMD, diasDesde, tiempoDesde, byId, val, inList, rerenderPOS,
    cache, loadAll, cargarProductos, nombreEmpleado, tecnicosActivos, esTecnicoNoAdmin, lote, equipo, prov, almPrincipal,
    abrirModal, cerrarModal, cabecera, cuerpo, pie, confirmar, pedirTexto, smartSelect, ssGet, ssItem,
    _uiListPage, _uiListPager, _uiListRenderers, _uiListPages, obtenerEtiquetaEstado, etiquetaEstadoPiezaReacond, badge,
    _REACOND_ESTADOS_REPARACION, _REACOND_ESTADOS_TRABAJO, _reacondEquipoPasaEstado, _reacondEsPiezaCostoInfoPlus, _reacondEsSolicitudTecnico, _reacondTienePiezasPendientes, _tienePiezasInfoPlus, fallasPendientesDe,
    calcularFleteEquipo, _costoEquipoRep, _modeloRep, _loteConcluido, _equiposEvaluadosDisponibles, historial, _recalcularCostoRepuestos, asignarFallasSinDueno,
    renderDetalleLoteReacond, cargarLotesReacond, get reacondLoteAbiertoId() { return reacondLoteAbiertoId; }, set reacondLoteAbiertoId(v) { reacondLoteAbiertoId = v; },
    get _reacondSel() { return _reacondSel; }, set _reacondSel(v) { _reacondSel = v; }, get _reacondSelCosto() { return _reacondSelCosto; }, get _reacondFiltroTec() { return _reacondFiltroTec; },
    get _reacondVisibleEquipos() { return _reacondVisibleEquipos; }, _filtros, _evalState, get _panelProcesoEquipoId() { return _panelProcesoEquipoId; }, set _panelProcesoEquipoId(v) { _panelProcesoEquipoId = v; },
    get _devolucionesCache() { return _devolucionesCache; }, set _devolucionesCache(v) { _devolucionesCache = v; }, get _repFiltroFechas() { return _repFiltroFechas; }, set _repFiltroFechas(v) { _repFiltroFechas = v; },
    get _reacondPiezasVista() { return _reacondPiezasVista; }, set _reacondPiezasVista(v) { _reacondPiezasVista = v; }, get reacondMainTab() { return reacondMainTab; }, set reacondMainTab(v) { reacondMainTab = v; },
    abrirLoteReacond, UI_LIST_PAGE_SIZE };

  // ─────────────────────────── CSS del módulo (marco STUDIO negro/oro; estados con su color) ───────────────────────────
  function ensureCSS() {
    if (byId('nxRcCSS')) return;
    const st = document.createElement('style'); st.id = 'nxRcCSS';
    st.textContent = `
.nxRc{--rc-gold:#c9a227;--rc-gold-d:#806515;--rc-ink:#111;--rc-steel:#5b5951;--rc-mute:#85817a;--rc-line:rgba(90,72,20,.18);--rc-panel:#fff;--rc-canvas:#f3f0e8;--rc-radius:16px;--rc-shadow:0 1px 2px rgba(10,10,10,.07),0 8px 20px -6px rgba(10,10,10,.14);font-size:13px;color:var(--rc-ink);min-width:0}
.nxRc *{box-sizing:border-box}
.nxRcCard{background:var(--rc-panel);border:1px solid var(--rc-line);border-radius:var(--rc-radius);box-shadow:var(--rc-shadow),inset 0 1px 0 rgba(255,255,255,.9);padding:16px;min-width:0}
.nxRcH3{margin:0;font-size:15px;font-weight:800;display:flex;align-items:center;gap:8px}.nxRcH3 .ti{color:var(--rc-gold)}
.nxRcH4{margin:0;font-size:13px;font-weight:800;display:flex;align-items:center;gap:6px}
.nxRcRow{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px}
.nxRcActs{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.nxRcMuted{color:var(--rc-mute)}
.nxRc .btn.nxRcBtn,.nxRcModal .btn.nxRcBtn,.nxRcOverlay .btn.nxRcBtn{display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 12px;border-radius:10px;border:1px solid var(--rc-line,rgba(90,72,20,.18));background:#fff;color:#111;font:inherit;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;box-shadow:0 1px 2px rgba(10,10,10,.06)}
.btn.nxRcBtn.gold{background:linear-gradient(180deg,#dcb63e 0%,#c9a227 55%,#b8921f 100%);border-color:#a8851b;color:#0a0a0a}
.btn.nxRcBtn.dark{background:#0a0a0a;border-color:#0a0a0a;color:#fffefa}
.btn.nxRcBtn.light{background:#fff;color:#5b5951}
.btn.nxRcBtn.danger{background:linear-gradient(180deg,#ef4444,#b91c1c);border-color:#991b1b;color:#fff}
.btn.nxRcBtn.green{background:linear-gradient(180deg,#10b981,#059669);border-color:#047857;color:#fff}
.btn.nxRcBtn:active{transform:scale(.98)}.btn.nxRcBtn[disabled]{opacity:.55;cursor:default}
.nxRcInput,.nxRc select.nxRcInput,.nxRcModal select.nxRcInput{height:38px;border-radius:11px;border:1.5px solid var(--rc-line,rgba(90,72,20,.18));background:#fff;padding:0 12px;font:inherit;font-size:13px;color:#111;outline:0;box-shadow:inset 0 1px 2px rgba(0,0,0,.05);min-width:0}
textarea.nxRcInput{height:auto;padding:8px 12px;resize:vertical}
.nxRcInput:focus{border-color:#c9a227;box-shadow:0 0 0 3px rgba(201,162,39,.18)}
.nxRcSearch{position:relative;display:flex;align-items:center}.nxRcSearch>.ti{position:absolute;left:11px;color:#85817a;font-size:15px}.nxRcSearch>input{width:100%;padding-left:34px}
.nxRcNav{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:6px;padding:6px;margin-bottom:14px;background:rgba(255,255,255,.75);border:1px solid var(--rc-line);border-radius:18px;box-shadow:var(--rc-shadow)}
.nxRcNav.reacond-module-nav:has(> :nth-child(6)){grid-template-columns:repeat(6,minmax(0,1fr))}
.reacond-main-tab{display:flex;align-items:center;gap:8px;min-height:48px;padding:6px 10px;border:1px solid transparent;border-radius:13px;background:transparent;color:#5b5951;font:inherit;font-size:12px;font-weight:800;cursor:pointer;text-align:left;min-width:0}
.reacond-main-tab.tab-active{background:#0a0a0a;color:#fffefa;border-color:#0a0a0a;box-shadow:0 8px 18px -10px rgba(10,10,10,.6)}
.reacond-main-icon{display:inline-flex;align-items:center;justify-content:center;flex:0 0 30px;width:30px;height:30px;border-radius:50%;background:#f3f0e8;color:#806515;border:1px solid var(--rc-line);font-size:15px}
.reacond-main-tab.tab-active .reacond-main-icon{background:linear-gradient(180deg,#e3c45c,#c9a227 60%,#b8921f);color:#0a0a0a;border-color:#a8851b}
.reacond-main-label{min-width:0;overflow-wrap:anywhere;line-height:1.2}
.nxRcStages{display:flex;gap:6px;margin-bottom:14px;padding:6px;overflow-x:auto;overflow-y:hidden;-webkit-overflow-scrolling:touch;border:1px solid var(--rc-line);border-radius:16px;background:#faf8f2;scrollbar-width:none}.nxRcStages::-webkit-scrollbar{display:none}
.nxRcStages .tab-btn{flex:0 0 auto;display:inline-flex;align-items:center;gap:7px;min-height:40px;padding:5px 11px 5px 6px;border:1px solid transparent;border-radius:999px;background:transparent;color:#5b5951;font:inherit;font-size:12px;font-weight:800;cursor:pointer;white-space:nowrap}
.nxRcStages .tab-btn.active{background:#fff;color:#111;border-color:#c9a227;box-shadow:0 6px 14px -10px rgba(201,162,39,.7)}
.reacond-stage-number{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;background:#fff;color:#85817a;border:1px solid var(--rc-line);font-size:10.5px;font-weight:800}
.nxRcStages .tab-btn.active .reacond-stage-number{background:linear-gradient(180deg,#e3c45c,#c9a227 60%,#b8921f);color:#0a0a0a;border-color:#a8851b}
.nxRcStages .badge{padding:2px 7px;border-radius:10px;font-size:11px;font-weight:800}
.nxRcLote{background:#fff;border:1px solid var(--rc-line);border-radius:14px;padding:14px;margin-bottom:10px;box-shadow:var(--rc-shadow)}
.reacond-lote-name{font-weight:800;font-size:15px;color:#806515}.reacond-lote-meta{font-size:12px;margin-top:4px;line-height:1.5}
.reacond-lote-stages{display:grid;grid-template-columns:repeat(auto-fit,minmax(72px,1fr));gap:8px;margin-top:12px}
.reacond-lote-stage{padding:7px 6px;border-radius:10px;text-align:center;font-size:11px;color:#5b5951;border:1px solid rgba(0,0,0,.04)}.reacond-lote-stage b{font-size:17px}.reacond-lote-total{background:#f3f0e8}
.reacond-lote-progress{background:#e9e5da;height:7px;border-radius:999px;margin-top:10px;overflow:hidden}.reacond-lote-progress>div{background:linear-gradient(90deg,#e3c45c,#b8921f);height:100%;transition:width .3s}
.reacond-lote-progress-label{font-size:10px;color:#85817a;text-align:right;margin-top:2px;font-weight:700}
.nxRcLoteInfo{background:#faf8f2;border:1px solid var(--rc-line);padding:12px;border-radius:12px;margin-bottom:14px;font-size:12.5px;color:#5b5951}.nxRcLoteInfo b{color:#111}
.nxRcInfoGrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.reacond-detail-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:14px}
.reacond-kpi-card{padding:12px;border-radius:12px;text-align:center;cursor:pointer;border:2px solid transparent;box-shadow:var(--rc-shadow)}.reacond-kpi-card>div:first-child{font-size:24px;font-weight:800;line-height:1}.reacond-kpi-card>div:last-child{font-size:10.5px;font-weight:700;margin-top:4px;letter-spacing:.03em}
.reacond-kpi-card.is-filtered{border-color:#0a0a0a}
.nxRcChk{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:#5b5951;cursor:pointer}.nxRcChk input{width:16px;height:16px;accent-color:#c9a227}
.nxRcDateFilt{display:inline-flex;align-items:center;gap:3px;padding-left:4px;border-left:1px solid var(--rc-line);font-size:11px;color:#5b5951}.nxRcDateFilt input{padding:3px 5px;font-size:11px;border:1px solid var(--rc-line);border-radius:6px;font:inherit}.nxRcDateFilt button{border:1px solid var(--rc-line);background:#faf8f2;color:#b91c1c;border-radius:6px;padding:3px 6px;cursor:pointer;font-size:11px}
.nxRcMenu{position:absolute;top:calc(100% + 4px);right:0;background:#fff;border:1px solid var(--rc-line);border-radius:10px;box-shadow:0 8px 20px rgba(15,23,42,.18);z-index:50;min-width:210px;overflow:hidden}.nxRcMenuTit{font-size:10px;color:#85817a;text-transform:uppercase;padding:8px 14px 4px}
.nxRcMenu>button{display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:9px 14px;border:0;background:#fff;cursor:pointer;font:inherit;font-size:13px}.nxRcMenu>button:hover{background:#faf8f2}
.nxRcTecRow{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}
.nxRcTecChip{border:1px solid #c7d2fe;background:#e0e7ff;color:#3730a3;padding:5px 11px;border-radius:999px;cursor:pointer;font:inherit;font-size:12px;font-weight:700}.nxRcTecChip.on{background:#0a0a0a;color:#fff;border-color:#0a0a0a}
.nxRcLink{border:0;background:transparent;cursor:pointer;font:inherit;font-size:12px;color:#806515}.nxRcLink.red{color:#b91c1c}
.nxRcFiltRow{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px}
.nxRcEq{background:#fff;border:1px solid var(--rc-line);border-radius:12px;padding:12px;margin-bottom:8px;cursor:pointer;box-shadow:0 1px 3px rgba(10,10,10,.05);transition:background .15s,box-shadow .15s}.nxRcEq:hover{background:#faf8f2;box-shadow:var(--rc-shadow)}
.reacond-equipo-layout{display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px}
.reacond-equipo-head{display:flex;align-items:center;gap:7px;flex-wrap:wrap}.reacond-equipo-head b{font-size:14px}
.nxRcChkSel,.nxRcChkCosto{width:18px;height:18px;cursor:pointer;accent-color:#5b21b6;margin:0}.nxRcChkCosto{accent-color:#c9a227}
.reacond-equipo-number{background:#0a0a0a;color:#fff;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:800}
.nxRcBadge{display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:999px;font-size:11px;font-weight:700;line-height:1.2;white-space:nowrap}
.nxRcMini{border:1px solid;border-radius:6px;padding:2px 7px;cursor:pointer;font-size:12px;background:#fff;line-height:1.4}
.reacond-equipo-meta{font-size:12px;color:#85817a;margin-top:6px}
.nxRcNota{background:#faf8f2;padding:6px 10px;border-radius:6px;margin-top:6px;font-size:12px}
.reacond-equipo-actions{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.nxRcGlobalRes{border:1px solid var(--rc-line);border-radius:10px;margin-top:6px;overflow:hidden;background:#fff}.nxRcGlobalItem{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:9px 11px;border-bottom:1px solid #f1efe8;cursor:pointer}.nxRcGlobalItem:hover{background:#faf8f2}
.nxRcPager{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:10px;font-size:12px}.nxRcPg{border:1px solid var(--rc-line);background:#fff;border-radius:8px;padding:5px 9px;cursor:pointer;font:inherit;font-weight:700}.nxRcPg.on{background:#0a0a0a;color:#fff;border-color:#0a0a0a}.nxRcPg[disabled]{opacity:.4}.nxRcPgEll{padding:0 4px}.nxRcPgSum{color:#85817a;margin-left:auto}
.nxRcOverlay{z-index:10800}
.nxRcModal{background:#fff;color:#111;font-size:13px}.nxRcModal .nxRcHead{display:flex;align-items:center;gap:10px;padding:12px 16px;background:#0a0a0a;color:#fffefa;border-bottom:1px solid rgba(255,255,255,.08)}.nxRcModal .nxRcHead h3{margin:0;font-size:14.5px;font-weight:800;flex:1;min-width:0;color:#fffefa;display:flex;align-items:center;gap:8px}.nxRcModal .nxRcHead h3 .ti{color:#e3c45c}
.nxRcModal .nxBack{width:34px;height:34px;border-radius:9px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.08);color:#fffefa;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;font-size:16px}
.nxRcFoot{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;padding:12px 16px;border-top:1px solid var(--rc-line,rgba(90,72,20,.18));background:#faf8f2}
.nxRcSec{background:#fff;border:1px solid rgba(90,72,20,.18);border-radius:12px;padding:12px}.nxRcSec h4{margin:0 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#5b5951;display:flex;align-items:center;gap:6px}
.nxRcFld{display:flex;flex-direction:column;gap:4px;min-width:0}.nxRcFld>label{font-size:10.5px;font-weight:700;color:#5b5951;text-transform:uppercase;letter-spacing:.3px}.nxRcFld .nxRcInput{width:100%}
.nxRcG2{display:grid;grid-template-columns:1fr;gap:10px}@media(min-width:540px){.nxRcG2{grid-template-columns:1fr 1fr}}
.nxRcConfIco{width:52px;height:52px;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 14px;font-size:26px}.nxRcConfIco.red{background:#fee2e2;color:#dc2626}.nxRcConfIco.blue{background:#f3f0e8;color:#806515}
.nxRcSS{position:relative}.nxRcSSBox{position:relative;display:flex;align-items:center}.nxRcSSBox>.ti{position:absolute;left:11px;color:#85817a;font-size:14px}.nxRcSSBox>input{width:100%;padding-left:32px;padding-right:32px}.nxRcSSClear{position:absolute;right:6px;border:0;background:transparent;color:#85817a;cursor:pointer;font-size:14px;padding:4px}
.nxRcSSList{position:absolute;left:0;right:0;top:calc(100% + 4px);background:#fff;border:1px solid var(--rc-line,rgba(90,72,20,.18));border-radius:10px;box-shadow:0 10px 26px rgba(15,23,42,.18);z-index:60;max-height:240px;overflow-y:auto}.nxRcSSItem{padding:8px 11px;border-bottom:1px solid #f1efe8;cursor:pointer;font-size:12.5px}.nxRcSSItem:hover{background:#faf8f2}.nxRcSSItem small{color:#85817a;display:block}.nxRcSSMeta{font-size:9.5px;background:#0a0a0a;color:#fff;padding:1px 6px;border-radius:6px;margin-left:4px}
.nxRcTbl{width:100%;border-collapse:collapse;font-size:12.5px}.nxRcTbl th{text-align:left;font-size:10px;text-transform:uppercase;color:#5b5951;padding:7px 8px;border-bottom:1px solid var(--rc-line,rgba(90,72,20,.18));background:#faf8f2}.nxRcTbl td{padding:7px 8px;border-bottom:1px solid #f1efe8;vertical-align:top}
.nxRcSpin{display:inline-block;animation:nxRcSpin 1s linear infinite}@keyframes nxRcSpin{to{transform:rotate(360deg)}}
.nxRcStepper{display:flex;justify-content:space-between;position:relative;padding:6px 4px}.nxRcStepper .line{position:absolute;left:30px;right:30px;top:24px;height:3px;background:#e2e8f0;z-index:0}.nxRcStepper .fill{position:absolute;left:30px;top:24px;height:3px;background:#10b981;z-index:0;transition:width .3s}
.stepper-step{position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;gap:6px;width:70px;text-align:center;cursor:default}.stepper-circle{width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:#fff;border:2px solid #e2e8f0;color:#94a3b8;font-size:16px}.stepper-label{font-size:10.5px;font-weight:700;color:#64748b;line-height:1.2}
.stepper-step.completado .stepper-circle{background:#10b981;border-color:#10b981;color:#fff}.stepper-step.actual .stepper-circle{background:#0a0a0a;border-color:#c9a227;color:#e3c45c;box-shadow:0 0 0 4px rgba(201,162,39,.2)}.stepper-step.actual .stepper-label{color:#111}
.stepper-step[onclick]{cursor:pointer}.stepper-step[onclick]:hover .stepper-circle{border-color:#c9a227}.stepper-step.bloqueado{opacity:.55}
.pieza-card{background:#fff;border:1px solid rgba(90,72,20,.18);border-radius:10px;padding:10px 12px;margin-bottom:8px}.pieza-status-row{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}.pieza-status-col{flex:1;min-width:140px;font-size:11px;font-weight:700;padding:6px 8px;border-radius:7px;text-align:center}.pieza-status-col.ok{background:#dcfce7;color:#166534}.pieza-status-col.esperando{background:#fef3c7;color:#92400e}.pieza-status-col.pendiente{background:#f1f5f9;color:#475569}
.pieza-action-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;width:100%;margin-top:6px;padding:9px 12px;border-radius:8px;border:1px solid transparent;cursor:pointer;font:inherit;font-size:12px;font-weight:700}.pieza-action-btn.entregar{background:linear-gradient(180deg,#2563eb,#1d4ed8);color:#fff}.pieza-action-btn.recibir{background:linear-gradient(180deg,#10b981,#059669);color:#fff}
.eval-tab{padding:10px 14px;background:none;border:0;border-bottom:3px solid transparent;cursor:pointer;font:inherit;font-weight:700;color:#85817a;display:inline-flex;align-items:center;gap:6px}.eval-tab.active{border-bottom-color:#c9a227;color:#111}
.kpi-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}.kpi-box{background:#fff;border:1px solid rgba(90,72,20,.18);border-top:3px solid #c9a227;border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:4px}.kpi-box small{font-size:11px;color:#5b5951;font-weight:700}.kpi-box strong{font-size:18px}
@media(max-width:640px){.nxRcNav{grid-template-columns:repeat(2,minmax(0,1fr))!important}.reacond-detail-kpis{grid-template-columns:repeat(3,1fr)}.reacond-lote-stages{grid-template-columns:repeat(3,1fr)}.nxRcModal{max-width:100%!important}.stepper-step{width:58px}}
@media print{.nxRcOverlay{display:none!important}}
/* overrides tema */
html.nx-studio .overlay.nxRcOverlay{left:0;right:0;top:0;bottom:0;width:auto;padding:12px 8px;align-items:flex-start}
html.nx-studio .modal.nxRcModal,html.nx-studio .modal.nxRcModal *{text-transform:none;letter-spacing:-.005em}
html.nx-studio .modal.nxRcModal .nxRcFld>label,html.nx-studio .modal.nxRcModal .nxRcSec>h4,html.nx-studio .modal.nxRcModal .nxRcH4,html.nx-studio .modal.nxRcModal .nxRcTbl th,html.nx-studio .modal.nxRcModal .nxRcUp{text-transform:uppercase;letter-spacing:.04em}
html.nx-studio .modal.nxRcModal{width:100%;max-width:100%}
@media(min-width:600px){html.nx-studio .modal.nxRcModal{max-width:var(--rc-maxw,560px)}}
html.nx-studio #v-pos .btn.nxRcBtn,html.nx-studio .nxRcOverlay .btn.nxRcBtn,html.nx-studio #v-pos .btn.nxRcBtn:hover,html.nx-studio .nxRcOverlay .btn.nxRcBtn:hover{background:#fff;color:#111;border-color:rgba(90,72,20,.18);box-shadow:0 1px 2px rgba(10,10,10,.06)}
html.nx-studio #v-pos .btn.nxRcBtn.light,html.nx-studio .nxRcOverlay .btn.nxRcBtn.light{color:#5b5951}
html.nx-studio #v-pos .btn.nxRcBtn.light:hover,html.nx-studio .nxRcOverlay .btn.nxRcBtn.light:hover,html.nx-studio #v-pos .btn.nxRcBtn:hover{background:#fff9e8;border-color:#c9a227;color:#5e4a0d}
html.nx-studio #v-pos .btn.nxRcBtn.gold,html.nx-studio .nxRcOverlay .btn.nxRcBtn.gold,html.nx-studio #v-pos .btn.nxRcBtn.gold:hover,html.nx-studio .nxRcOverlay .btn.nxRcBtn.gold:hover{background:linear-gradient(180deg,#dcb63e 0%,#c9a227 55%,#b8921f 100%);border-color:#a8851b;color:#0a0a0a;box-shadow:0 6px 14px -8px rgba(201,162,39,.9)}
html.nx-studio #v-pos .btn.nxRcBtn.dark,html.nx-studio .nxRcOverlay .btn.nxRcBtn.dark,html.nx-studio #v-pos .btn.nxRcBtn.dark:hover,html.nx-studio .nxRcOverlay .btn.nxRcBtn.dark:hover{background:#0a0a0a;border-color:#0a0a0a;color:#fffefa}
html.nx-studio #v-pos .btn.nxRcBtn.danger,html.nx-studio .nxRcOverlay .btn.nxRcBtn.danger,html.nx-studio #v-pos .btn.nxRcBtn.danger:hover,html.nx-studio .nxRcOverlay .btn.nxRcBtn.danger:hover{background:linear-gradient(180deg,#ef4444,#b91c1c);border-color:#991b1b;color:#fff}
html.nx-studio #v-pos .btn.nxRcBtn.green,html.nx-studio .nxRcOverlay .btn.nxRcBtn.green,html.nx-studio #v-pos .btn.nxRcBtn.green:hover,html.nx-studio .nxRcOverlay .btn.nxRcBtn.green:hover{background:linear-gradient(180deg,#10b981,#059669);border-color:#047857;color:#fff}
html.nx-studio #v-pos .btn.nxRcBtn[style*="background"],html.nx-studio .nxRcOverlay .btn.nxRcBtn[style*="background"]{color:inherit}

`;
    document.head.appendChild(st);
  }
})();

/* ═══════════════ Parte 2 · evaluación, asignación, panel de reparación, piezas, tareas, despacho ═══════════════ */
(function () {
  'use strict';
  const I = window.__nxRcInt; if (!I) return;
  const { api, esc, money, toast, toastError, friendly, logError, miId, miNombre, isAdminUser, tienePermiso, permBtn, soloAdmin, nowISO, fechaDO, fechaHoraDO, byId, val, inList, rerenderPOS,
    cache, loadAll, cargarProductos, nombreEmpleado, tecnicosActivos, lote, equipo, prov, almPrincipal,
    abrirModal, cerrarModal, cabecera, cuerpo, pie, confirmar, pedirTexto, smartSelect, ssGet, ssItem,
    obtenerEtiquetaEstado, etiquetaEstadoPiezaReacond, badge, _REACOND_ESTADOS_REPARACION, _reacondTienePiezasPendientes, fallasPendientesDe,
    calcularFleteEquipo, _costoEquipoRep, _modeloRep, _equiposEvaluadosDisponibles, historial, _recalcularCostoRepuestos, asignarFallasSinDueno, renderDetalleLoteReacond, _evalState } = I;
  const refrescarLote = () => { if (I.reacondLoteAbiertoId) renderDetalleLoteReacond(); else rerenderPOS(); };
  const tecItems = (excluir) => tecnicosActivos().filter(t => String(t.id) !== String(excluir || '')).map(t => ({ id: t.id, label: t.nombre, sub: t.especialidad || '', search: (t.nombre + ' ' + (t.especialidad || '')).toLowerCase(), meta: (t.rol === 'admin' || t.rol === 'gerente') ? 'ADMIN' : '' }));
  const soyAsignado = (eq) => String(eq.tecnico_asignado_id || '') === miId();

  // ═══════════════ EVALUACIÓN (empezarEvaluacion / abrirModalEvaluacion / guardarEvaluacion) ═══════════════
  async function empezarEvaluacion(equipoId) {
    const eq = equipo(equipoId); if (!eq) return toast('Equipo no encontrado.', 'error');
    try {
      if ((eq.estado_evaluacion || 'pendiente') === 'pendiente') { await api().patch('pos_reacond_equipos', 'id=eq.' + equipoId, { estado_evaluacion: 'en_evaluacion' }); eq.estado_evaluacion = 'en_evaluacion'; }
      await abrirModalEvaluacion(equipoId);
    } catch (e) { logError('Empezar evaluación', e); toastError(friendly(e)); }
  }
  function continuarEvaluacion(equipoId) { abrirModalEvaluacion(equipoId); }
  async function abrirModalEvaluacion(equipoId) {
    const eq = equipo(equipoId); if (!eq) return toast('Equipo no encontrado.', 'error');
    _evalState.equipoId = equipoId; _evalState.fallasSeleccionadas = new Set(); _evalState.fallasNotas = {}; _evalState.piezasSeleccionadas = []; _evalState.categoriasContraidas = new Set(); _evalState.tabActiva = 'fallas';
    try {
      const [fallasEq, piezasEq] = await Promise.all([api().get('pos_reacond_equipo_fallas', 'select=falla_id,nota&equipo_id=eq.' + equipoId), api().get('pos_reacond_piezas', 'select=*&equipo_id=eq.' + equipoId + '&order=creado_en.asc')]);
      (fallasEq || []).forEach(f => { if (f.falla_id) { _evalState.fallasSeleccionadas.add(f.falla_id); if (f.nota) _evalState.fallasNotas[f.falla_id] = f.nota; } });
      _evalState.piezasSeleccionadas = (piezasEq || []).map(p => ({ id: p.id, producto_id: p.producto_id, pieza_codigo: p.pieza_codigo || null, pieza_nombre: p.pieza_nombre, cantidad: p.cantidad || 1, costo_unitario: Number(p.costo_unitario) || 0, estado: p.estado || 'pendiente', descontada_cant: Number(p.descontada_cant) || 0, agregada_por_tecnico: !!p.agregada_por_tecnico, tecnico_id: p.tecnico_id || null }));
    } catch (e) { logError('Cargar evaluación previa', e); }
    await cargarProductos();
    const piezasItems = cache.productos.filter(p => !p.serial && p.tipo !== 'servicio').map(p => ({ id: p.id, label: p.nombre, sub: [p.codigo, p.marca, 'Stock ' + Number(p.stock || 0), isAdminUser() ? 'Costo ' + money(p.costo) : ''].filter(Boolean).join(' · '), search: [p.nombre, p.codigo, p.marca, p.referencia].filter(Boolean).join(' ').toLowerCase(), extra: { costo: Number(p.costo) || 0, codigo: p.codigo } }));
    abrirModal('nxRcEvalM', cabecera('ti-clipboard-list', `<span id="evalTituloModal">Evaluando: ${esc(eq.modelo || 'Equipo')}</span>`, 'nxRcEvalM') + `
      <div style="overflow-y:auto;flex:1;background:#f3f0e8">
        <div id="evalEquipoInfo" style="background:#fff;padding:12px 16px;border-bottom:1px solid rgba(90,72,20,.18);font-size:12.5px"><div class="nxRcInfoGrid">
          <div><b><i class="ti ti-device-mobile"></i> Modelo:</b><br>${esc(eq.modelo || '—')}</div><div><b><i class="ti ti-barcode"></i> IMEI:</b><br>${esc(eq.imei || '—')}</div>
          ${eq.color ? `<div><b><i class="ti ti-palette"></i> Color:</b><br>${esc(eq.color)}</div>` : ''}${eq.capacidad ? `<div><b><i class="ti ti-database"></i> Capacidad:</b><br>${esc(eq.capacidad)}</div>` : ''}</div></div>
        <div style="padding:14px 16px">
          <div style="display:flex;gap:4px;border-bottom:2px solid rgba(90,72,20,.18);margin-bottom:14px;overflow-x:auto">
            <button type="button" class="eval-tab active" data-tab="fallas" onclick="window.nxRc.evalTab('fallas')">⚠️ Fallas <span id="evalCntFallas" class="nxRcBadge" style="background:#fef3c7;color:#92400e">0</span></button>
            <button type="button" class="eval-tab" data-tab="piezas" onclick="window.nxRc.evalTab('piezas')">🔧 Piezas <span id="evalCntPiezas" class="nxRcBadge" style="background:#dbeafe;color:#1d4ed8">0</span></button>
            <button type="button" class="eval-tab" data-tab="resumen" onclick="window.nxRc.evalTab('resumen')">📋 Resumen</button>
          </div>
          <div id="evalTabFallas" class="nxRcSec">
            <div id="evalFallasSelWrap" style="display:none;background:linear-gradient(135deg,#fef3c7,#fde68a);border:1px solid #f59e0b;padding:10px 12px;border-radius:8px;margin-bottom:12px"><b style="font-size:12px;color:#92400e"><i class="ti ti-checklist"></i> Fallas seleccionadas (<span id="evalFallasSelCount">0</span>):</b><div id="evalFallasSelChips" style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap"></div></div>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px">
              <div class="nxRcSearch" style="flex:1;min-width:180px"><i class="ti ti-search"></i><input type="text" id="evalBuscarFalla" class="nxRcInput" placeholder="Buscar falla..." oninput="window.nxRc.evalRenderFallas()"></div>
              <button type="button" class="btn nxRcBtn light" onclick="window.nxRc.evalExpandir()"><i class="ti ti-square-arrow-down"></i> Expandir</button>
              <button type="button" class="btn nxRcBtn light" onclick="window.nxRc.evalContraer()"><i class="ti ti-square-arrow-up"></i> Contraer</button>
            </div>
            <div id="evalFallasContenedor"></div>
          </div>
          <div id="evalTabPiezas" class="nxRcSec" style="display:none">
            <div id="evalPiezasFallasResumen" style="background:linear-gradient(135deg,#fef3c7,#fde68a);border:1px solid #f59e0b;padding:12px;border-radius:8px;margin-bottom:12px"><b style="font-size:12px;color:#92400e"><i class="ti ti-alert-triangle"></i> Fallas detectadas en este equipo:</b><div id="evalPiezasFallasChips" style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap"></div></div>
            <div style="background:#dbeafe;border:1px solid #93c5fd;padding:10px;border-radius:8px;margin-bottom:12px;font-size:12px;color:#1e3a8a"><b><i class="ti ti-info-circle"></i> Selecciona las piezas del inventario que el técnico necesitará para reparar este equipo.</b></div>
            <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;margin-bottom:14px">
              <div class="nxRcFld" style="flex:1;min-width:200px"><label>Buscar pieza del inventario</label>${smartSelect('ss-eval-pieza', piezasItems, '🔍 Nombre, código o marca…', '')}</div>
              <div class="nxRcFld" style="width:90px"><label>Cantidad</label><input type="number" id="eval_pieza_cantidad" class="nxRcInput" value="1" min="1" max="50" style="font-weight:700"></div>
              <button type="button" class="btn nxRcBtn gold" onclick="window.nxRc.evalAgregarPieza()"><i class="ti ti-plus"></i> Agregar</button>
            </div>
            <div id="evalPiezasLista"></div>
          </div>
          <div id="evalTabResumen" class="nxRcSec" style="display:none">
            <div class="nxRcFld"><label><i class="ti ti-note"></i> Notas adicionales (van en el label)</label><textarea id="eval_notas" class="nxRcInput" rows="3" placeholder="Resultado del diagnóstico: estado físico, batería, pruebas o por qué no requiere reparación…">${esc(eq.notas_diagnostico || '')}</textarea></div>
            <div style="background:#faf8f2;border:1px solid rgba(90,72,20,.18);border-radius:8px;padding:14px;margin-top:14px"><h4 style="margin:0 0 10px;font-size:13px"><i class="ti ti-list-check"></i> Fallas detectadas</h4><div id="evalResumenFallas" style="font-size:13px"></div></div>
            <div style="background:#faf8f2;border:1px solid rgba(90,72,20,.18);border-radius:8px;padding:14px;margin-top:12px"><h4 style="margin:0 0 10px;font-size:13px"><i class="ti ti-tools"></i> Piezas necesarias</h4><div id="evalResumenPiezas" style="font-size:13px"></div><div id="evalCostoTotal" style="margin-top:10px;padding-top:10px;border-top:1px dashed rgba(90,72,20,.3);font-weight:800;font-size:14px;color:#806515"></div></div>
            <div style="background:linear-gradient(135deg,#f3f0e8,#e9e5da);border:1px solid rgba(90,72,20,.25);border-radius:8px;padding:14px;margin-top:12px;text-align:center">
              <p style="font-size:12px;color:#5b5951;margin:0 0 10px"><i class="ti ti-printer"></i> Imprime el label de diagnóstico con las fallas de este equipo.</p>
              <button type="button" class="btn nxRcBtn dark" onclick="window.nxRc.imprimirLabelDiag()"><i class="ti ti-printer"></i> Imprimir Label de Diagnóstico</button>
              <p style="font-size:11px;color:#806515;margin:8px 0 0">💡 Al imprimir, el equipo queda marcado como <b>✅ Evaluado</b>.</p>
            </div>
          </div>
        </div>
      </div>` + pie(`
        <button type="button" class="btn nxRcBtn light" onclick="window.nxRc.cerrar('nxRcEvalM')">Cancelar</button>
        <button type="button" class="btn nxRcBtn light" id="evalBtnAtras" onclick="window.nxRc.evalAtras()" style="display:none"><i class="ti ti-arrow-left"></i> Atrás</button>
        <button type="button" class="btn nxRcBtn dark" id="evalBtnSiguiente" onclick="window.nxRc.evalSiguiente()">Siguiente <i class="ti ti-arrow-right"></i></button>
        <button type="button" class="btn nxRcBtn light" id="evalBtnGuardar" onclick="window.nxRc.guardarEvaluacion(false)" style="display:none"><i class="ti ti-device-floppy"></i> Solo Guardar</button>
        <button type="button" class="btn nxRcBtn green" id="evalBtnGuardarEvaluado" onclick="window.nxRc.guardarEvaluacion(true)" style="display:none"><i class="ti ti-circle-check"></i> Guardar y marcar evaluado</button>`), 900);
    renderFallasEvaluacion(); renderPiezasEvaluacion(); renderResumenEvaluacion(); actualizarContadoresEvaluacion(); cambiarTabEvaluacion('fallas');
  }
  function cerrarModalEvaluacion() { cerrarModal('nxRcEvalM'); }
  function actualizarContadoresEvaluacion() { const a = byId('evalCntFallas'), b = byId('evalCntPiezas'); if (a) a.textContent = _evalState.fallasSeleccionadas.size; if (b) b.textContent = _evalState.piezasSeleccionadas.length; }
  function cambiarTabEvaluacion(tab) {
    _evalState.tabActiva = tab;
    document.querySelectorAll('#nxRcEvalM .eval-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    ['fallas', 'piezas', 'resumen'].forEach(t => { const el = byId('evalTab' + t[0].toUpperCase() + t.slice(1)); if (el) el.style.display = tab === t ? 'block' : 'none'; });
    if (tab === 'piezas') renderFallasEnTabPiezas();
    if (tab === 'resumen') renderResumenEvaluacion();
    const orden = ['fallas', 'piezas', 'resumen'], i = orden.indexOf(tab);
    const show = (id, on) => { const el = byId(id); if (el) el.style.display = on ? '' : 'none'; };
    show('evalBtnAtras', i > 0); show('evalBtnSiguiente', i < 2); show('evalBtnGuardar', i === 2); show('evalBtnGuardarEvaluado', i === 2);
  }
  function evalNavegar(d) { const o = ['fallas', 'piezas', 'resumen']; const i = Math.max(0, Math.min(2, o.indexOf(_evalState.tabActiva) + d)); cambiarTabEvaluacion(o[i]); }
  function renderFallasEvaluacion() {
    const cont = byId('evalFallasContenedor'); if (!cont) return;
    const buscador = (val('evalBuscarFalla') || '').toLowerCase();
    const cats = cache.fallaCategorias.filter(c => c.activa !== false); const fallas = cache.fallas.filter(f => f.activa !== false);
    const filtradas = buscador ? fallas.filter(f => (f.nombre || '').toLowerCase().includes(buscador) || (f.nombre_corto || '').toLowerCase().includes(buscador)) : fallas;
    const porCat = {}; filtradas.forEach(f => { const cid = f.categoria_id || 'sin_cat'; (porCat[cid] = porCat[cid] || []).push(f); });
    if (!filtradas.length) { cont.innerHTML = `<p class="nxRcMuted" style="text-align:center;padding:30px">${buscador ? 'Sin resultados.' : 'No hay fallas en el catálogo. Crea fallas en la pestaña Catálogo.'}</p>`; return; }
    const fila = (f, color) => { const checked = _evalState.fallasSeleccionadas.has(f.id); return `<label style="display:flex;align-items:center;gap:8px;padding:6px 4px;cursor:pointer;border-bottom:1px solid #f1efe8"><input type="checkbox" ${checked ? 'checked' : ''} onchange="window.nxRc.evalToggleFalla('${f.id}')" style="width:18px;height:18px;cursor:pointer;accent-color:${color}"><div style="flex:1;min-width:0"><div style="font-size:13px;${checked ? 'font-weight:600' : ''}">${esc(f.nombre)}</div><div style="font-size:10px;color:#806515;font-weight:700">${esc(f.nombre_corto || '')}</div></div></label>`; };
    let html = '';
    cats.forEach(cat => {
      const lista = porCat[cat.id] || []; if (!lista.length) return;
      const marcadas = lista.filter(f => _evalState.fallasSeleccionadas.has(f.id)).length, contraida = _evalState.categoriasContraidas.has(cat.id);
      html += `<div style="margin-bottom:10px;border:1px solid ${cat.color}40;border-radius:8px;overflow:hidden">
        <div onclick="window.nxRc.evalToggleCat('${cat.id}')" style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:${cat.color}15;cursor:pointer;user-select:none">
          <div style="display:flex;align-items:center;gap:8px"><i class="ti ${contraida ? 'ti-chevron-right' : 'ti-chevron-down'}" style="color:${cat.color}"></i><i class="ti ${esc(cat.icono)}" style="color:${cat.color}"></i><b style="color:${cat.color};font-size:13px;text-transform:uppercase">${esc(cat.nombre)}</b></div>
          <span style="background:${marcadas > 0 ? cat.color : '#cbd5e1'};color:#fff;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700">${marcadas}/${lista.length}</span></div>
        ${!contraida ? `<div style="padding:6px 14px 10px">${lista.map(f => fila(f, cat.color)).join('')}</div>` : ''}</div>`;
    });
    if (porCat.sin_cat) { const lista = porCat.sin_cat; const marcadas = lista.filter(f => _evalState.fallasSeleccionadas.has(f.id)).length; html += `<div style="margin-bottom:10px;border:1px solid #cbd5e1;border-radius:8px;overflow:hidden"><div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:#f1f5f9"><b style="color:#475569;font-size:13px">SIN CATEGORÍA</b><span style="background:#475569;color:#fff;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700">${marcadas}/${lista.length}</span></div><div style="padding:6px 14px 10px">${lista.map(f => fila(f, '#475569')).join('')}</div></div>`; }
    cont.innerHTML = html; renderFallasSelChips();
  }
  function renderFallasSelChips() {
    const wrap = byId('evalFallasSelWrap'), chips = byId('evalFallasSelChips'), cnt = byId('evalFallasSelCount'); if (!wrap || !chips) return;
    const sel = cache.fallas.filter(f => _evalState.fallasSeleccionadas.has(f.id)); if (cnt) cnt.textContent = sel.length;
    if (!sel.length) { wrap.style.display = 'none'; chips.innerHTML = ''; return; }
    wrap.style.display = 'block';
    chips.innerHTML = sel.map(f => `<span style="background:#fff;border:1px solid #f59e0b;color:#92400e;padding:3px 9px;border-radius:12px;font-size:11px;font-weight:700;display:inline-flex;align-items:center;gap:6px">${esc(f.nombre_corto || f.nombre)} <span onclick="window.nxRc.evalToggleFalla('${f.id}')" style="cursor:pointer;color:#b91c1c;font-weight:900" title="Quitar">✕</span></span>`).join('');
  }
  function evalToggleFalla(id) { if (_evalState.fallasSeleccionadas.has(id)) _evalState.fallasSeleccionadas.delete(id); else _evalState.fallasSeleccionadas.add(id); actualizarContadoresEvaluacion(); renderFallasEvaluacion(); }
  function evalToggleCategoria(id) { if (_evalState.categoriasContraidas.has(id)) _evalState.categoriasContraidas.delete(id); else _evalState.categoriasContraidas.add(id); renderFallasEvaluacion(); }
  function evalExpandirTodas() { _evalState.categoriasContraidas = new Set(); renderFallasEvaluacion(); }
  function evalContraerTodas() { _evalState.categoriasContraidas = new Set(cache.fallaCategorias.map(c => c.id)); renderFallasEvaluacion(); }
  function renderFallasEnTabPiezas() {
    const chips = byId('evalPiezasFallasChips'), wrap = byId('evalPiezasFallasResumen'); if (!chips) return;
    const sel = cache.fallas.filter(f => _evalState.fallasSeleccionadas.has(f.id));
    if (wrap) wrap.style.display = sel.length ? '' : 'none';
    chips.innerHTML = sel.map(f => { const cat = cache.fallaCategorias.find(c => c.id === f.categoria_id); const color = (cat && cat.color) || '#475569'; return `<span style="background:${color};color:#fff;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700">${esc(f.nombre_corto || f.nombre)}</span>`; }).join('');
  }
  function evalAgregarPieza() {
    const it = ssItem('ss-eval-pieza'); if (!it) return toast('Selecciona una pieza primero.', 'error');
    const cantidad = parseInt(val('eval_pieza_cantidad')) || 1; if (cantidad < 1) return toast('Cantidad inválida.', 'error');
    const ex = _evalState.piezasSeleccionadas.find(p => String(p.producto_id || '') === String(it.id));
    if (ex && !ex.descontada_cant) ex.cantidad = (ex.cantidad || 0) + cantidad;
    else _evalState.piezasSeleccionadas.push({ producto_id: it.id, pieza_codigo: (it.extra && it.extra.codigo) || null, pieza_nombre: it.label, cantidad, costo_unitario: (it.extra && it.extra.costo) || 0, estado: 'pendiente', descontada_cant: 0 });
    window.nxRc.ssLimpiar('ss-eval-pieza'); window.nxRc.ssCerrar('ss-eval-pieza'); const c = byId('eval_pieza_cantidad'); if (c) c.value = 1;
    actualizarContadoresEvaluacion(); renderPiezasEvaluacion();
  }
  function evalQuitarPieza(idx) { _evalState.piezasSeleccionadas.splice(idx, 1); actualizarContadoresEvaluacion(); renderPiezasEvaluacion(); }
  function evalCambiarCantidadPieza(idx, n) { n = parseInt(n) || 1; if (n < 1) return; if (_evalState.piezasSeleccionadas[idx]) { _evalState.piezasSeleccionadas[idx].cantidad = n; renderPiezasEvaluacion(); } }
  function renderPiezasEvaluacion() {
    const cont = byId('evalPiezasLista'); if (!cont) return;
    if (!_evalState.piezasSeleccionadas.length) { cont.innerHTML = '<p class="nxRcMuted" style="text-align:center;padding:20px;font-size:13px">Aún no has agregado piezas. Selecciona una arriba y dale "Agregar".</p>'; return; }
    const verCosto = isAdminUser(); let total = 0;
    cont.innerHTML = _evalState.piezasSeleccionadas.map((p, idx) => {
      const sub = (p.cantidad || 1) * (p.costo_unitario || 0); total += sub;
      const descontada = (Number(p.descontada_cant) || 0) > 0;
      const estadoBadge = !p.producto_id ? '' : (descontada ? ' ' + badge('✓ descontada', '#dcfce7', '#166534', 'font-size:10px') : ' ' + badge('⏳ por descontar', '#fef9c3', '#854d0e', 'font-size:10px'));
      return `<div style="display:flex;gap:10px;align-items:center;padding:10px 12px;background:#fff;border:1px solid rgba(90,72,20,.18);border-radius:8px;margin-bottom:6px">
        <div style="flex:1;min-width:0"><div style="font-weight:600;font-size:13px">${esc(p.pieza_nombre || 'Pieza')}${estadoBadge}</div>${verCosto ? `<div style="font-size:11px;color:#85817a">Costo unitario: ${money(p.costo_unitario || 0)} · Subtotal: <b style="color:#806515">${money(sub)}</b></div>` : ''}</div>
        <input type="number" class="nxRcInput" value="${p.cantidad || 1}" min="1" max="50" ${descontada ? 'disabled' : ''} onchange="window.nxRc.evalCantPieza(${idx},this.value)" style="width:65px;font-weight:700;padding:0 6px">
        ${descontada ? '<span title="Ya descontada del inventario" style="background:#f1f5f9;color:#475569;padding:8px 10px;border-radius:6px"><i class="ti ti-lock"></i></span>' : `<button type="button" onclick="window.nxRc.evalQuitarPieza(${idx})" style="background:#fee2e2;color:#991b1b;border:0;padding:8px 10px;border-radius:6px;cursor:pointer" title="Quitar"><i class="ti ti-trash"></i></button>`}
      </div>`;
    }).join('') + (verCosto ? `<div style="margin-top:12px;padding:12px;background:#f3f0e8;border-radius:8px;text-align:right;font-weight:800;color:#806515">TOTAL PIEZAS: ${money(total)}</div>` : '');
  }
  function renderResumenEvaluacion() {
    const fallasEl = byId('evalResumenFallas');
    if (fallasEl) {
      if (!_evalState.fallasSeleccionadas.size) fallasEl.innerHTML = '<p class="nxRcMuted" style="font-size:12px">No has marcado fallas todavía.</p>';
      else fallasEl.innerHTML = cache.fallas.filter(f => _evalState.fallasSeleccionadas.has(f.id)).map(f => { const cat = cache.fallaCategorias.find(c => c.id === f.categoria_id); const color = (cat && cat.color) || '#475569'; return `<div style="display:flex;gap:8px;padding:4px 0;align-items:center"><span style="background:${color};color:#fff;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;min-width:80px;text-align:center">${esc(f.nombre_corto || '')}</span><span>${esc(f.nombre)}</span></div>`; }).join('');
    }
    const piezasEl = byId('evalResumenPiezas'), costoEl = byId('evalCostoTotal');
    if (piezasEl) {
      const verCosto = isAdminUser();
      if (!_evalState.piezasSeleccionadas.length) { piezasEl.innerHTML = '<p class="nxRcMuted" style="font-size:12px">No has agregado piezas todavía.</p>'; if (costoEl) costoEl.innerHTML = ''; }
      else { let total = 0; piezasEl.innerHTML = _evalState.piezasSeleccionadas.map(p => { const sub = (p.cantidad || 1) * (p.costo_unitario || 0); total += sub; return `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px dashed #e5e7eb"><span>${esc(p.pieza_nombre)} ×${p.cantidad}</span>${verCosto ? `<span style="font-weight:600">${money(sub)}</span>` : ''}</div>`; }).join(''); if (costoEl) costoEl.innerHTML = verCosto ? `<div style="display:flex;justify-content:space-between"><span>TOTAL PIEZAS:</span><span>${money(total)}</span></div>` : ''; }
    }
  }
  async function guardarEvaluacion(marcarEvaluado) {
    const equipoId = _evalState.equipoId; if (!equipoId) return toast('No hay equipo activo.', 'error');
    const notas = val('eval_notas') || null; const fallasArray = [..._evalState.fallasSeleccionadas];
    if (marcarEvaluado && !fallasArray.length && !notas) return toast('Escribe el resultado del diagnóstico o selecciona una falla antes de cerrar la evaluación.', 'error');
    try {
      await api().del('pos_reacond_equipo_fallas', 'equipo_id=eq.' + equipoId);
      if (fallasArray.length) {
        const inserts = cache.fallas.filter(f => _evalState.fallasSeleccionadas.has(f.id)).map(f => { const cat = cache.fallaCategorias.find(c => c.id === f.categoria_id); return { equipo_id: equipoId, falla_id: f.id, falla_nombre: f.nombre, falla_corto: f.nombre_corto, falla_categoria: (cat && cat.nombre) || null, nota: _evalState.fallasNotas[f.id] || null }; });
        await api().post('pos_reacond_equipo_fallas', inserts);
      }
      // Piezas: se conservan las ya descontadas del inventario; el resto se reescribe.
      await api().del('pos_reacond_piezas', 'equipo_id=eq.' + equipoId + '&descontada_cant=eq.0');
      const porGuardar = _evalState.piezasSeleccionadas.filter(p => (Number(p.descontada_cant) || 0) === 0);
      if (porGuardar.length) await api().post('pos_reacond_piezas', porGuardar.map(p => ({ equipo_id: equipoId, producto_id: p.producto_id || null, pieza_codigo: p.pieza_codigo || null, pieza_nombre: p.pieza_nombre, cantidad: p.cantidad, costo_unitario: p.costo_unitario, estado: p.estado || 'pendiente', agregada_por_tecnico: !!p.agregada_por_tecnico, tecnico_id: p.tecnico_id || null })));
      const totalPiezas = _evalState.piezasSeleccionadas.reduce((s, p) => s + (p.cantidad || 1) * (p.costo_unitario || 0), 0);
      await api().patch('pos_reacond_equipos', 'id=eq.' + equipoId, { notas_diagnostico: notas, estado_evaluacion: marcarEvaluado ? 'evaluado' : 'en_evaluacion', costo_repuestos: totalPiezas });
      if (marcarEvaluado) await historial(equipoId, 'en_evaluacion', 'evaluado', 'Diagnóstico terminado', fallasArray.length ? fallasArray.length + ' falla(s)' : null);
      toast(marcarEvaluado ? 'Evaluación guardada y equipo marcado como evaluado.' : 'Evaluación guardada.');
      cerrarModalEvaluacion();
      const textos = cache.fallas.filter(f => _evalState.fallasSeleccionadas.has(f.id)).map(f => f.nombre_corto || f.nombre);
      await loadAll(); await crearTareasDesdeFallas('equipo', equipoId, textos); await loadAll(); refrescarLote();
    } catch (e) { logError('Guardar evaluación', e); toastError(friendly(e)); }
  }
  async function imprimirLabelDesdeEvaluacion() { await guardarEvaluacion(true); const eq = equipo(_evalState.equipoId); if (eq) imprimirLabelEquipo(eq.id, true); }

  // ═══════════════ TAREAS (crearTarea / crearTareasDesdeFallas / completar / reabrir / eliminar / reasignar) ═══════════════
  async function crearTareasDesdeFallas(tipo, refId, lista) {
    if (!refId || !Array.isArray(lista) || !lista.length) return 0;
    if (cache.tareas.some(t => t.tipo === tipo && t.ref_id === refId)) return 0;
    const textos = [...new Set(lista.map(s => String(s || '').trim()).filter(Boolean))]; if (!textos.length) return 0;
    try { await api().post('pos_reacond_tareas', textos.map(txt => ({ tipo, ref_id: refId, descripcion: txt, tecnico_id: null, estado: 'pendiente', creado_por: miId() || null }))); return textos.length; } catch (e) { logError('Crear tareas desde fallas', e); return 0; }
  }
  async function refrescarPanelTareas(tipo, refId) { await loadAll(); if (tipo === 'equipo') await abrirPanelProceso(refId); }
  async function agregarFallaAdicional(equipoId) {
    const desc = await pedirTexto('🔧 FALLA ADICIONAL\n\n¿Qué falla o trabajo apareció durante la reparación?\n\nEjemplo: "Cambiar pantalla", "Microsoldadura", "Cambiar batería"'); if (desc === null) return;
    if (!desc.trim()) return toast('Escribe qué hay que hacer.', 'error');
    const eq = equipo(equipoId);
    try {
      await api().post('pos_reacond_tareas', { tipo: 'equipo', ref_id: equipoId, descripcion: desc.trim(), tecnico_id: (eq && eq.tecnico_asignado_id) || null, estado: 'pendiente', adicional: true, creado_por: miId() || null });
      try { await api().post('pos_reacond_equipo_fallas', { equipo_id: equipoId, falla_id: null, falla_nombre: desc.trim(), falla_corto: desc.trim().toUpperCase().slice(0, 40), adicional: true }); } catch (_) {}
      toast('✅ Falla adicional agregada.'); await refrescarPanelTareas('equipo', equipoId);
    } catch (e) { logError('Agregar falla adicional', e); toastError(friendly(e)); }
  }
  async function completarTarea(tareaId, tipo, refId) {
    const nota = await pedirTexto('¿Alguna nota sobre el trabajo? (opcional)'); if (nota === null) { await abrirPanelProceso(refId); return; }
    try {
      const upd = { estado: 'hecha', fecha_completada: nowISO() }; if (nota && nota.trim()) upd.notas = nota.trim();
      await api().patch('pos_reacond_tareas', 'id=eq.' + tareaId, upd); toast('✅ Tarea completada.'); await loadAll();
      const ref = cache.tareas.filter(t => t.tipo === tipo && t.ref_id === refId); const todas = ref.length > 0 && ref.every(t => t.estado === 'hecha');
      if (todas && await confirmar('✅ ¡Todas las tareas completadas!\n\n¿Marcar el equipo como FINALIZADO para que la administración lo reciba?', { peligro: false, ok: 'Sí, continuar' })) {
        const eq = equipo(refId); await api().patch('pos_reacond_equipos', 'id=eq.' + refId, { estado_evaluacion: 'listo_revision' }); await historial(refId, eq && eq.estado_evaluacion, 'listo_revision', 'Técnico terminó → Control de calidad'); toast('✅ Equipo marcado como finalizado.'); await loadAll();
      }
      await abrirPanelProceso(refId); refrescarLote();
    } catch (e) { logError('Completar tarea', e); toastError(friendly(e)); }
  }
  async function reabrirTarea(tareaId, tipo, refId) { try { await api().patch('pos_reacond_tareas', 'id=eq.' + tareaId, { estado: 'pendiente', fecha_completada: null }); toast('Tarea reabierta.'); await refrescarPanelTareas(tipo, refId); } catch (e) { logError('Reabrir tarea', e); toastError(friendly(e)); } }
  async function eliminarTarea(tareaId, tipo, refId) {
    if (!isAdminUser()) return toast('No tienes permiso para eliminar tareas.', 'error');
    if (!await confirmar('¿Eliminar esta tarea?')) return;
    try { await api().del('pos_reacond_tareas', 'id=eq.' + tareaId); toast('Tarea eliminada.'); await refrescarPanelTareas(tipo, refId); } catch (e) { logError('Eliminar tarea', e); toastError(friendly(e)); }
  }
  async function reasignarTarea(tareaId, tipo, refId) {
    const t = cache.tareas.find(x => x.id === tareaId); if (!t) return;
    const tecs = tecnicosActivos().filter(x => String(x.id) !== String(t.tecnico_id || '')); if (!tecs.length) return toast('No hay otros técnicos.', 'error');
    const lista = tecs.map((x, i) => `${i + 1}. ${x.nombre}`).join('\n');
    const sel = await pedirTexto(`¿A qué técnico se reasigna "${t.descripcion}"?\n\n${lista}\n\nEscribe el número:`); if (sel === null) return;
    const idx = parseInt(sel) - 1; if (isNaN(idx) || !tecs[idx]) return toast('Número inválido.', 'error');
    try { await api().patch('pos_reacond_tareas', 'id=eq.' + tareaId, { tecnico_id: tecs[idx].id, tecnico_anterior_id: t.tecnico_id || null }); toast('Tarea reasignada a ' + tecs[idx].nombre + '.'); await refrescarPanelTareas(tipo, refId); } catch (e) { logError('Reasignar tarea', e); toastError(friendly(e)); }
  }
  function construirSeccionTareas(tipo, refId, tareas, cerrada) {
    tareas = tareas || []; const total = tareas.length, hechas = tareas.filter(t => t.estado === 'hecha').length, pct = total ? Math.round(hechas / total * 100) : 0, todasHechas = total > 0 && hechas === total;
    const eq = equipo(refId) || {}; const nrm = s => String(s || '').trim().toLowerCase();
    const filas = tareas.map(t => {
      const hecha = t.estado === 'hecha', esMia = String(t.tecnico_id || '') === miId(), puedeCompletar = isAdminUser() || esMia || soyAsignado(eq);
      const reasignada = t.tecnico_anterior_id ? nombreEmpleado(t.tecnico_anterior_id) : null;
      let piezaBtn = '';
      if (!cerrada) {
        const pz = cache.piezasReacond.find(p => p.equipo_id === refId && p.estado !== 'rechazada' && p.estado !== 'devuelta' && nrm(p.pieza_nombre) === nrm(t.descripcion));
        const puedePieza = isAdminUser() || esMia || soyAsignado(eq);
        if (pz) {
          if (pz.estado === 'recibida') piezaBtn = `<button type="button" onclick="window.nxRc.solicitarDevolucionPieza('${pz.id}')" class="nxRcMini" style="background:#e0e7ff;color:#3730a3;border-color:#c7d2fe;font-size:10px" title="Devolver pieza"><i class="ti ti-rotate-2"></i></button>`;
          else { const mp = { pendiente: ['🟡', 'Solicitada'], solicitada: ['🟡', 'Solicitada'], extra_pendiente: ['🟡', 'Solicitada'], entregada: ['📦', 'Entregada'], aprobada: ['📦', 'Entregada'] }; const [ic, lbl] = mp[pz.estado] || ['•', pz.estado]; piezaBtn = `<span title="Pieza: ${lbl}" style="font-size:12px;padding:3px 5px">${ic}</span>`; }
        } else if (puedePieza && !hecha) piezaBtn = `<button type="button" onclick="window.nxRc.solicitarPiezaDeFalla('${refId}','${encodeURIComponent(t.descripcion)}')" class="nxRcMini" style="background:#fef3c7;color:#92400e;border-color:#fcd34d;font-size:10px" title="Solicitar pieza"><i class="ti ti-shopping-cart"></i></button>`;
      }
      return `<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid ${hecha ? '#bbf7d0' : 'rgba(90,72,20,.18)'};background:${hecha ? '#f0fdf4' : '#fff'};border-radius:8px;margin-bottom:5px">
        <input type="checkbox" ${hecha ? 'checked' : ''} ${(puedeCompletar && !cerrada) ? '' : 'disabled'} onchange="${hecha ? `window.nxRc.reabrirTarea('${t.id}','${tipo}','${refId}')` : `window.nxRc.completarTarea('${t.id}','${tipo}','${refId}')`}" style="width:20px;height:20px;cursor:pointer;accent-color:#16a34a;flex-shrink:0" title="${hecha ? 'Desmarcar (reabrir)' : 'Marcar como lista'}">
        <div style="flex:1;min-width:0"><div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap"><span style="font-weight:600;font-size:13px;${hecha ? 'text-decoration:line-through;color:#16a34a' : ''}">${esc(t.descripcion)}</span>${t.adicional ? '<span style="background:#fde68a;color:#92400e;font-size:9px;font-weight:800;padding:1px 7px;border-radius:10px">ADICIONAL</span>' : ''}</div>
          <div style="font-size:10px;color:#85817a;margin-top:1px"><i class="ti ti-user"></i> ${esc(t.tecnico_id ? nombreEmpleado(t.tecnico_id) : 'Sin asignar')}</div>
          ${reasignada && !hecha ? `<div style="font-size:9px;color:#d97706;margin-top:1px"><i class="ti ti-arrow-right"></i> Reasignada desde ${esc(reasignada)}</div>` : ''}${t.notas ? `<div style="font-size:10px;color:#475569;margin-top:1px">📝 ${esc(t.notas)}</div>` : ''}</div>
        <div style="display:flex;gap:3px;flex-shrink:0;align-items:center">${cerrada ? '' : `${piezaBtn}${!hecha ? `<button type="button" onclick="window.nxRc.reasignarTarea('${t.id}','${tipo}','${refId}')" class="nxRcMini" style="background:#fef3c7;color:#92400e;border-color:#fcd34d;font-size:10px" title="Reasignar a otro técnico"><i class="ti ti-user-share"></i></button>` : ''}${isAdminUser() ? `<button type="button" onclick="window.nxRc.eliminarTarea('${t.id}','${tipo}','${refId}')" class="nxRcMini" style="background:#fee2e2;color:#991b1b;border-color:#fecaca;font-size:10px" title="Eliminar"><i class="ti ti-trash"></i></button>` : ''}`}</div>
      </div>`;
    }).join('');
    return `<div style="background:#fff;border:2px solid rgba(90,72,20,.18);padding:10px;border-radius:10px;margin-top:14px">
      <div class="nxRcRow" style="margin-bottom:8px"><b style="font-size:13px"><i class="ti ti-list-check" style="color:#806515"></i> Fallas y Tareas del Equipo</b>${!cerrada ? `<button type="button" onclick="window.nxRc.agregarFallaAdicional('${refId}')" class="btn nxRcBtn dark" style="height:30px;font-size:11px"><i class="ti ti-plus"></i> Agregar falla adicional</button>` : ''}</div>
      ${total ? `<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px"><span>Progreso: ${hechas} de ${total} fallas resueltas</span><span style="font-weight:700;color:${todasHechas ? '#16a34a' : '#806515'}">${pct}%</span></div><div style="background:#e9e5da;border-radius:6px;height:10px;overflow:hidden"><div style="width:${pct}%;height:100%;background:${todasHechas ? '#16a34a' : 'linear-gradient(90deg,#e3c45c,#b8921f)'};border-radius:6px;transition:width .3s"></div></div></div>${filas}${todasHechas ? '<div style="background:#f0fdf4;border:1px solid #86efac;padding:8px;border-radius:8px;margin-top:6px;text-align:center;font-size:12px;color:#166534"><i class="ti ti-circle-check"></i> ¡Todas las fallas resueltas! El equipo está listo.</div>' : ''}` : `<div class="nxRcMuted" style="font-size:12px;padding:8px 0">${cerrada ? 'Este equipo está cerrado. No se pueden agregar tareas.' : 'No hay fallas registradas. Usa el botón "Agregar falla adicional".'}</div>`}
    </div>`;
  }

  // ═══════════════ ASIGNAR TÉCNICO (individual y en bloque) ═══════════════
  function abrirModalAsignarTecnico(equipoId) {
    const eq = equipo(equipoId); if (!eq) return toast('Equipo no encontrado.', 'error');
    abrirModal('nxRcAsigM', cabecera('ti-user-check', 'Asignar Técnico', 'nxRcAsigM') + cuerpo(`
      <div class="nxRcLoteInfo" style="margin:0"><b>${esc(eq.modelo || 'Equipo')}</b><br><span class="nxRcMuted" style="font-size:12px">IMEI: ${esc(eq.imei || '—')}</span></div>
      <div class="nxRcFld"><label>Selecciona técnico</label>${smartSelect('ss-asign-tecnico', tecItems(), 'Buscar técnico...', eq.tecnico_asignado_id || '')}</div>
      <div class="nxRcFld"><label>Notas para el técnico (opcional)</label><textarea id="asign_notas" class="nxRcInput" rows="3" placeholder="Instrucciones especiales..."></textarea></div>
      <div style="background:#fef3c7;border:1px solid #fcd34d;padding:10px;border-radius:8px;font-size:12px;color:#92400e"><b><i class="ti ti-alert-triangle"></i> Al asignar, el equipo pasa a estado "En Proceso".</b> El técnico verá este equipo en su lista de trabajo.</div>`) +
      pie(`<button type="button" class="btn nxRcBtn light" onclick="window.nxRc.cerrar('nxRcAsigM')">Cancelar</button><button type="button" class="btn nxRcBtn gold" onclick="window.nxRc.confirmarAsignarTecnico('${equipoId}')"><i class="ti ti-check"></i> Asignar y pasar a Proceso</button>`), 550);
  }
  async function confirmarAsignarTecnico(equipoId) {
    const tecnicoId = ssGet('ss-asign-tecnico'), notas = val('asign_notas'); if (!tecnicoId) return toast('Selecciona un técnico.', 'error');
    try {
      const eq = equipo(equipoId) || {}; const upd = { tecnico_asignado_id: tecnicoId, fecha_asignacion: nowISO(), estado_evaluacion: 'en_proceso' };
      if (notas) { const prev = eq.notas_diagnostico || ''; upd.notas_diagnostico = prev + (prev ? '\n\n' : '') + '[Asignación] ' + notas; }
      await api().patch('pos_reacond_equipos', 'id=eq.' + equipoId, upd);
      await historial(equipoId, 'evaluado', 'en_proceso', `Asignado a ${nombreEmpleado(tecnicoId)}`, notas || null);
      toast(`Equipo asignado a ${nombreEmpleado(tecnicoId)}.`); await asignarFallasSinDueno('equipo', equipoId, tecnicoId);
      cerrarModal('nxRcAsigM'); await loadAll(); refrescarLote();
    } catch (e) { logError('Asignar técnico', e); toastError(friendly(e)); }
  }
  function abrirModalAsignarLote() {
    if (!I.reacondLoteAbiertoId) return toast('Abre un lote primero.', 'error');
    const disp = _equiposEvaluadosDisponibles(); if (!disp.length) return toast('No hay equipos evaluados sin asignar en este lote.', 'error');
    const sel = disp.filter(e => I._reacondSel.has(e.id));
    abrirModal('nxRcAsigLoteM', cabecera('ti-users', 'Asignar equipos a un técnico', 'nxRcAsigLoteM') + cuerpo(`
      <p class="nxRcMuted" style="font-size:12.5px;margin:0">Elige el técnico y cuántos equipos <b>evaluados</b> (sin asignar) va a empezar a trabajar. Se le asignan los primeros de la lista y pasan a <b>En Proceso</b>.</p>
      <div class="nxRcFld"><label>Técnico</label>${smartSelect('ss-asignlote-tecnico', tecItems(), '🔍 Buscar técnico...', '')}</div>
      <div class="nxRcFld" id="asignlote_cantidadRow"><label>Cantidad de equipos a asignar</label><input id="asignlote_cantidad" type="number" class="nxRcInput" min="1" max="${disp.length}" value="${sel.length ? sel.length : disp.length}" style="font-weight:700" oninput="window.nxRc.asignloteRefrescar()"></div>
      <div id="asignlote_disp" style="font-size:12px;color:#475569"></div><div id="asignlote_modelos"></div>
      <div class="nxRcFld"><label>Nota (opcional)</label><textarea id="asignlote_nota" class="nxRcInput" rows="2" placeholder="Instrucciones..."></textarea></div>`) +
      pie(`<button type="button" class="btn nxRcBtn light" onclick="window.nxRc.cerrar('nxRcAsigLoteM')">Cancelar</button><button type="button" class="btn nxRcBtn gold" onclick="window.nxRc.confirmarAsignarLote(this)"><i class="ti ti-check"></i> Asignar</button>`), 520);
    _asignloteRefrescar();
  }
  function _asignloteRefrescar() {
    const disp = _equiposEvaluadosDisponibles(), marcados = disp.filter(e => I._reacondSel.has(e.id)); const cantRow = byId('asignlote_cantidadRow'); let elegidos, txt;
    if (marcados.length) { if (cantRow) cantRow.style.display = 'none'; elegidos = marcados; txt = `Se asignarán los ${marcados.length} equipo(s) que marcaste.`; }
    else { if (cantRow) cantRow.style.display = ''; const inp = byId('asignlote_cantidad'); let cant = parseInt(inp && inp.value) || 0; if (cant < 0) cant = 0; if (cant > disp.length) { cant = disp.length; if (inp) inp.value = cant; } elegidos = disp.slice(0, cant); txt = `Hay ${disp.length} equipo(s) evaluado(s) disponibles. (O marca con casilla los que quieras.)`; }
    const d = byId('asignlote_disp'); if (d) d.textContent = txt;
    const m = byId('asignlote_modelos'); if (m) { const cnt = {}; elegidos.forEach(e => { const k = e.modelo || 'Equipo'; cnt[k] = (cnt[k] || 0) + 1; }); m.innerHTML = Object.keys(cnt).length ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin:6px 0 10px">${Object.entries(cnt).map(([k, n]) => badge(esc(k) + ' ×' + n, '#f3f0e8', '#5b5951')).join('')}</div>` : ''; }
  }
  async function confirmarAsignarLote(btn) {
    const tecnicoId = ssGet('ss-asignlote-tecnico'); if (!tecnicoId) return toast('Selecciona un técnico.', 'error');
    const disp = _equiposEvaluadosDisponibles(), marcados = disp.filter(e => I._reacondSel.has(e.id)); let elegidos;
    if (marcados.length) elegidos = marcados; else { let cant = parseInt(val('asignlote_cantidad')) || 0; if (cant < 1) return toast('Marca equipos con la casilla o pon una cantidad.', 'error'); if (cant > disp.length) cant = disp.length; elegidos = disp.slice(0, cant); }
    const nota = val('asignlote_nota'); const nombre = nombreEmpleado(tecnicoId);
    if (!await confirmar(`¿Asignar ${elegidos.length} equipo(s) a ${nombre}?\n\nPasarán a "En Proceso".`)) return;
    const orig = btn ? btn.innerHTML : ''; if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader nxRcSpin"></i> Asignando…'; }
    try {
      const ids = elegidos.map(e => e.id);
      await api().patch('pos_reacond_equipos', 'id=in.(' + ids.join(',') + ')', { tecnico_asignado_id: tecnicoId, fecha_asignacion: nowISO(), estado_evaluacion: 'en_proceso' });
      try { await api().post('pos_reacond_historial', elegidos.map(e => ({ equipo_id: e.id, estado_anterior: 'evaluado', estado_nuevo: 'en_proceso', accion: `Asignado a ${nombre} (en bloque)`, notas: nota || null, usuario: miNombre() }))); } catch (_) {}
      for (const e of elegidos) await asignarFallasSinDueno('equipo', e.id, tecnicoId);
      toast(`✅ ${elegidos.length} equipo(s) asignado(s) a ${nombre}.`); I._reacondSel = new Set(); cerrarModal('nxRcAsigLoteM'); await loadAll(); refrescarLote();
    } catch (e) { logError('Asignar en bloque', e); toastError(friendly(e)); } finally { if (btn) { btn.disabled = false; btn.innerHTML = orig; } }
  }
  function abrirModalReasignar(equipoId) {
    const eq = equipo(equipoId) || {};
    abrirModal('nxRcReasigM', cabecera('ti-user-share', 'Reasignar a otro técnico', 'nxRcReasigM') + cuerpo(`
      <div style="background:#fef3c7;border:1px solid #fcd34d;padding:10px;border-radius:8px;font-size:12px;color:#92400e"><b><i class="ti ti-info-circle"></i> El equipo pasará al nuevo técnico</b>, quien deberá recibirlo (con las piezas actuales o limpio para otra reparación).</div>
      <div class="nxRcFld"><label>Nuevo técnico *</label>${smartSelect('ss-reasig-tecnico', tecItems(eq.tecnico_asignado_id), '🔍 Buscar técnico...', '')}</div>
      <div class="nxRcFld"><label>Motivo de la reasignación *</label><textarea id="reasig_motivo" class="nxRcInput" rows="2" placeholder="Ej: El técnico anterior está ocupado, requiere especialista, etc."></textarea></div>`) +
      pie(`<button type="button" class="btn nxRcBtn light" onclick="window.nxRc.cerrar('nxRcReasigM')">Cancelar</button><button type="button" class="btn nxRcBtn" style="background:linear-gradient(180deg,#f59e0b,#d97706);color:#fff;border-color:#b45309" onclick="window.nxRc.guardarReasignacion('${equipoId}')"><i class="ti ti-user-share"></i> Reasignar</button>`), 500, '10850');
  }
  async function guardarReasignacion(equipoId) {
    const nuevo = ssGet('ss-reasig-tecnico'), motivo = val('reasig_motivo'); if (!nuevo) return toast('Selecciona el nuevo técnico.', 'error'); if (!motivo) return toast('Escribe el motivo.', 'error');
    const eq = equipo(equipoId); if (!eq) return;
    try {
      await api().patch('pos_reacond_equipos', 'id=eq.' + equipoId, { tecnico_anterior_id: eq.tecnico_asignado_id || null, tecnico_asignado_id: nuevo, fecha_reasignacion: nowISO(), motivo_reasignacion: motivo, estado_evaluacion: 'reasignado' });
      try { await api().patch('pos_reacond_tareas', 'tipo=eq.equipo&ref_id=eq.' + equipoId + '&estado=eq.pendiente', { tecnico_id: nuevo, tecnico_anterior_id: eq.tecnico_asignado_id || null }); } catch (_) {}
      await historial(equipoId, eq.estado_evaluacion, 'reasignado', `Reasignado de ${nombreEmpleado(eq.tecnico_asignado_id)} a ${nombreEmpleado(nuevo)}`, motivo);
      toast('Equipo reasignado a ' + nombreEmpleado(nuevo) + '.'); cerrarModal('nxRcReasigM'); await loadAll(); await abrirPanelProceso(equipoId); refrescarLote();
    } catch (e) { logError('Reasignar', e); toastError(friendly(e)); }
  }
  async function recibirEquipoReasignado(equipoId, modo) {
    const eq = equipo(equipoId); if (!eq) return;
    if (!isAdminUser() && !soyAsignado(eq)) return toast('No puedes recibir este equipo. Solo el técnico al que fue reasignado puede recibirlo.', 'error');
    if (!await confirmar(modo === 'limpio' ? '¿Recibir el equipo LIMPIO? Las piezas anteriores se marcarán como no usadas en esta nueva reparación.' : '¿Recibir el equipo CON las piezas actuales para continuar la reparación?')) return;
    try {
      await api().patch('pos_reacond_equipos', 'id=eq.' + equipoId, { estado_evaluacion: 'en_proceso', fecha_asignacion: nowISO() });
      if (modo === 'limpio') await api().patch('pos_reacond_piezas', 'equipo_id=eq.' + equipoId + '&estado=in.(recibida,entregada,aprobada,pendiente)', { estado: 'devuelta' });
      await historial(equipoId, 'reasignado', 'en_proceso', modo === 'limpio' ? '📦 Equipo recibido LIMPIO (nueva reparación)' : '📦 Equipo recibido con piezas actuales');
      toast(modo === 'limpio' ? '📦 Equipo recibido limpio. Puedes solicitar piezas nuevas.' : '📦 Equipo recibido con sus piezas.'); await loadAll(); await abrirPanelProceso(equipoId); refrescarLote();
    } catch (e) { logError('Recibir equipo reasignado', e); toastError(friendly(e)); }
  }

  // ═══════════════ PANEL DE REPARACIÓN (abrirPanelProceso) ═══════════════
  async function cambiarEstadoProceso(equipoId, nuevo) {
    const eq = equipo(equipoId); if (!eq) return; const anterior = eq.estado_evaluacion;
    if (nuevo === 'listo_revision' && anterior === 'tecnico_recibio' && _reacondTienePiezasPendientes(cache.piezasReacond.filter(p => p.equipo_id === equipoId))) return toast('Este equipo todavía tiene piezas pendientes. Confirma su recepción o resuelve la solicitud antes de enviarlo a calidad.', 'error');
    if (nuevo === 'listo_revision') { const pend = fallasPendientesDe('equipo', equipoId); if (pend > 0) { if (isAdminUser()) { if (!await confirmar(`⚠️ Este equipo tiene ${pend} falla(s) SIN resolver.\n\nComo administrador puedes pasarlo a revisión de todos modos.\n\n¿Forzar?`)) return; } else return toast(`⚠️ No puedes pasar a revisión todavía.\n\nQuedan ${pend} falla(s) pendiente(s). Marca todas las fallas como resueltas (✓) primero.`, 'error'); } }
    try {
      await api().patch('pos_reacond_equipos', 'id=eq.' + equipoId, { estado_evaluacion: nuevo, fecha_terminado: nuevo === 'listo_venta' ? nowISO() : eq.fecha_terminado || null });
      await historial(equipoId, anterior, nuevo, 'Cambio de estado'); toast('Estado actualizado.'); await loadAll(); await abrirPanelProceso(equipoId); refrescarLote();
    } catch (e) { logError('Cambiar estado proceso', e); toastError(friendly(e)); }
  }
  function cerrarPanelProceso() { cerrarModal('nxRcPanelM'); I._panelProcesoEquipoId = null; }
  async function abrirPanelProceso(equipoId) {
    I._panelProcesoEquipoId = equipoId; const eq = equipo(equipoId); if (!eq) return toast('Equipo no encontrado.', 'error');
    let piezas = [], devsPrev = [], tareas = [];
    try { const [pz, dv, tk] = await Promise.all([api().get('pos_reacond_piezas', 'select=*&equipo_id=eq.' + equipoId + '&order=creado_en.asc'), api().get('pos_reacond_devoluciones', 'select=*&equipo_id=eq.' + equipoId + '&order=fecha_devolucion.desc'), api().get('pos_reacond_tareas', 'select=*&tipo=eq.equipo&ref_id=eq.' + equipoId + '&order=creado_en.asc')]); piezas = pz || []; devsPrev = dv || []; tareas = tk || []; } catch (e) { logError('Cargar panel proceso', e); }
    const tecnico = eq.tecnico_asignado_id ? cache.tecnicos.find(t => String(t.id) === String(eq.tecnico_asignado_id)) : null;
    const estado = eq.estado_evaluacion || 'en_proceso', esDevuelto = (eq.veces_devuelto || 0) > 0, estaReasignado = estado === 'reasignado';
    const tecAnterior = eq.tecnico_anterior_id ? nombreEmpleado(eq.tecnico_anterior_id) : null;
    const puedeRecibirReasignado = isAdminUser() || soyAsignado(eq), hayPiezasPendientes = _reacondTienePiezasPendientes(piezas), esAdmin = isAdminUser();
    const pasos = [{ id: 'en_proceso', label: 'Reparación', icono: 'ti-tool' }, { id: 'tecnico_recibio', label: 'Recibido', icono: 'ti-package' }, { id: 'espera_pieza', label: 'Bloqueado', icono: 'ti-hourglass' }, { id: 'listo_revision', label: 'Control de calidad', icono: 'ti-shield-check' }];
    let idx = pasos.findIndex(p => p.id === estado); if (idx === -1) idx = 0;
    const canGoto = i => { if (i === idx) return false; if (i === idx + 1) return true; if (i === idx - 1) return true; if (estado === 'tecnico_recibio' && pasos[i].id === 'listo_revision') return !hayPiezasPendientes; if (estado === 'espera_pieza' && pasos[i].id === 'tecnico_recibio') return true; return false; };
    const enFlujo = inList(['en_proceso', 'tecnico_recibio', 'espera_pieza', 'listo_revision'], estado);
    const stepsHtml = pasos.map((p, i) => { let cls = 'pendiente'; if (i < idx) cls = 'completado'; else if (i === idx) cls = 'actual'; const hab = enFlujo && canGoto(i); return `<div class="stepper-step ${cls}${!hab && i !== idx ? ' bloqueado' : ''}" ${hab ? `onclick="window.nxRc.cambiarEstadoProceso('${equipoId}','${p.id}')"` : ''}><div class="stepper-circle">${cls === 'completado' ? '<i class="ti ti-check"></i>' : `<i class="ti ${p.icono}"></i>`}</div><div class="stepper-label">${p.label}</div></div>`; }).join('');
    const fillW = idx === 0 ? '0%' : `calc(${(idx / (pasos.length - 1)) * 100}% - 60px)`;
    const piezasHtml = piezas.length ? piezas.map(p => {
      const esExtra = !!p.agregada_por_tecnico, esExtraNoAprobado = p.estado === 'extra_pendiente', esRechazada = p.estado === 'rechazada', estaEntregada = p.estado === 'entregada' || p.estado === 'aprobada', estaRecibida = p.estado === 'recibida', devPend = p.estado === 'devolucion_pendiente', estaDevuelta = p.estado === 'devuelta';
      const esCosto = I._reacondEsPiezaCostoInfoPlus(p) || (!p.agregada_por_tecnico && !p.tecnico_id && p.estado === 'aprobada');
      let adminCol, tecCol;
      if (esRechazada) adminCol = '<div class="pieza-status-col pendiente"><i class="ti ti-x"></i> Pieza rechazada</div>';
      else if (estaDevuelta) adminCol = '<div class="pieza-status-col" style="background:#e0e7ff;color:#3730a3"><i class="ti ti-rotate-2"></i> Devuelta al inventario</div>';
      else if (devPend) adminCol = '<div class="pieza-status-col esperando"><i class="ti ti-refresh"></i> Devolución solicitada</div>';
      else if (esExtraNoAprobado) adminCol = '<div class="pieza-status-col esperando"><i class="ti ti-alert-triangle"></i> Extra pendiente de aprobación</div>';
      else if (estaEntregada || estaRecibida) adminCol = '<div class="pieza-status-col ok"><i class="ti ti-check"></i> Admin: Entregada</div>';
      else adminCol = '<div class="pieza-status-col pendiente"><i class="ti ti-hourglass"></i> Admin: NO entregada</div>';
      if (esRechazada) tecCol = '<div class="pieza-status-col pendiente">—</div>';
      else if (estaDevuelta) tecCol = '<div class="pieza-status-col" style="background:#e0e7ff;color:#3730a3">Pieza devuelta</div>';
      else if (devPend) tecCol = '<div class="pieza-status-col esperando"><i class="ti ti-hourglass"></i> Esperando aprobación admin</div>';
      else if (esExtraNoAprobado) tecCol = '<div class="pieza-status-col pendiente">—</div>';
      else if (estaRecibida) tecCol = '<div class="pieza-status-col ok"><i class="ti ti-check"></i> Técnico: Recibida</div>';
      else if (estaEntregada) tecCol = '<div class="pieza-status-col esperando"><i class="ti ti-hourglass"></i> Esperando técnico confirme</div>';
      else tecCol = '<div class="pieza-status-col pendiente">Pendiente admin</div>';
      if (esCosto) { adminCol = '<div class="pieza-status-col" style="background:#e0f2fe;color:#075985"><i class="ti ti-shopping-cart"></i> Pieza del inventario (suma al costo)</div>'; tecCol = ''; }
      const botones = [];
      if (esCosto) { if (esAdmin) botones.push(`<div style="display:flex;gap:6px;margin-top:6px"><button type="button" class="pieza-action-btn" onclick="window.nxRc.editarPiezaInfoPlus('${p.id}')" style="flex:1;background:#fff;color:#0369a1;border:1px solid #7dd3fc;margin-top:0"><i class="ti ti-edit"></i> Editar</button><button type="button" class="pieza-action-btn" onclick="window.nxRc.eliminarPiezaInfoPlus('${p.id}')" style="flex:1;background:#fee2e2;color:#991b1b;margin-top:0"><i class="ti ti-trash"></i> Quitar</button></div>`); }
      else if (esExtraNoAprobado) { if (esAdmin) { botones.push(`<button type="button" class="pieza-action-btn" onclick="window.nxRc.aprobarPiezaExtra('${p.id}')" style="background:linear-gradient(180deg,#10b981,#059669);color:#fff"><i class="ti ti-check"></i> Aprobar pieza extra</button>`); botones.push(`<button type="button" class="pieza-action-btn" onclick="window.nxRc.rechazarPiezaExtra('${p.id}')" style="background:#fee2e2;color:#991b1b"><i class="ti ti-x"></i> Rechazar</button>`); } else botones.push('<div style="text-align:center;font-size:11px;color:#92400e;padding:4px"><i class="ti ti-clock"></i> Esperando aprobación del administrador</div>'); }
      else if (devPend) { botones.push(`<div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:6px;padding:8px;margin-top:6px;font-size:11px;color:#92400e"><b>Motivo:</b> ${esc(p.motivo_devolucion_pieza || 'Sin motivo')}</div>`); if (esAdmin) { botones.push(`<button type="button" class="pieza-action-btn" onclick="window.nxRc.aprobarDevolucionPieza('${p.id}')" style="background:linear-gradient(180deg,#6366f1,#4338ca);color:#fff"><i class="ti ti-check"></i> Aprobar devolución</button>`); botones.push(`<button type="button" class="pieza-action-btn" onclick="window.nxRc.rechazarDevolucionPieza('${p.id}')" style="background:#fee2e2;color:#991b1b"><i class="ti ti-x"></i> Rechazar</button>`); } else botones.push('<div style="text-align:center;font-size:11px;color:#92400e;padding:4px"><i class="ti ti-clock"></i> Esperando que el administrador apruebe</div>'); }
      else if (p.estado === 'pendiente' || p.estado === 'solicitada') { if (esAdmin) botones.push(`<button type="button" class="pieza-action-btn entregar" onclick="window.nxRc.marcarPiezaEntregada('${p.id}')"><i class="ti ti-truck"></i> Marcar como ENTREGADA</button>`); else botones.push('<div style="text-align:center;font-size:11px;color:#92400e;padding:4px"><i class="ti ti-clock"></i> Esperando que el administrador entregue la pieza</div>'); }
      else if (p.estado === 'entregada' || p.estado === 'aprobada') botones.push(`<button type="button" class="pieza-action-btn recibir" onclick="window.nxRc.marcarPiezaRecibida('${p.id}')"><i class="ti ti-check"></i> Confirmo RECIBIDA</button>`);
      else if (estaRecibida) botones.push(`<button type="button" class="pieza-action-btn" onclick="window.nxRc.solicitarDevolucionPieza('${p.id}')" style="background:#fff;color:#6366f1;border:1px solid #c4b5fd"><i class="ti ti-rotate-2"></i> Devolver pieza</button>`);
      return `<div class="pieza-card"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px"><div style="flex:1;min-width:0"><b style="font-size:14px;${estaDevuelta ? 'text-decoration:line-through;color:#475569' : ''}">${esc(p.pieza_nombre || 'Pieza')} ×${p.cantidad || 1}</b>${esExtra ? ' ' + badge('EXTRA', '#fbbf24', '#78350f', 'font-size:10px') : ''}${esCosto ? ' ' + badge('INVENTARIO', '#bae6fd', '#075985', 'font-size:10px') : ''}${p.pieza_codigo ? `<span style="font-size:10px;color:#475569;margin-left:4px">cód. ${esc(p.pieza_codigo)}</span>` : ''}${esAdmin ? `<div style="font-size:11px;color:#475569;margin-top:2px">${money((p.cantidad || 1) * (p.costo_unitario || 0))}</div>` : ''}</div></div><div class="pieza-status-row">${adminCol}${tecCol}</div>${botones.join('')}</div>`;
    }).join('') : '<p class="nxRcMuted" style="text-align:center;padding:10px">Sin piezas asignadas.</p>';
    const sumPiezas = piezas.filter(p => !inList(['rechazada', 'devuelta'], p.estado)).reduce((s, p) => s + (Number(p.cantidad) || 1) * (Number(p.costo_unitario) || 0), 0);
    const compra = Number(eq.costo_compra) || 0, flete = calcularFleteEquipo(eq), final = compra + flete + sumPiezas;
    const html = cabecera('ti-tool', 'Panel de Reparación', 'nxRcPanelM') + `<div style="overflow-y:auto;flex:1;padding:14px;background:#f3f0e8">
      <div class="nxRcLoteInfo"><b style="font-size:15px">${esc(eq.modelo || 'Equipo')}</b>${esDevuelto ? ' ' + badge('<i class="ti ti-refresh"></i> DEVUELTO ' + eq.veces_devuelto + '×', '#fee2e2', '#991b1b') : ''}<br><span style="font-size:12px">IMEI: ${esc(eq.imei || '—')}${tecnico ? ` · <i class="ti ti-user"></i> ${esc(tecnico.nombre)}` : ''}${eq.ciclo_actual > 1 ? ` · Ciclo ${eq.ciclo_actual}` : ''} · ${badge(obtenerEtiquetaEstado(estado).text, obtenerEtiquetaEstado(estado).bg, obtenerEtiquetaEstado(estado).color, 'font-size:10px')}</span></div>
      ${esDevuelto && devsPrev.length ? `<div style="background:linear-gradient(135deg,#fef2f2,#fee2e2);border:2px solid #dc2626;padding:14px;border-radius:12px;margin-bottom:14px"><div style="display:flex;align-items:center;gap:8px;margin-bottom:10px"><i class="ti ti-rotate-2" style="color:#dc2626;font-size:22px"></i><b style="color:#991b1b;font-size:14px"><i class="ti ti-alert-triangle"></i> EQUIPO DEVUELTO - Historial de Devoluciones</b></div><div style="font-size:12px;color:#7f1d1d">${devsPrev.slice(0, 5).map((d, i) => `<div style="background:#fff;padding:8px 10px;border-radius:6px;margin-bottom:6px;border-left:3px solid #dc2626"><b>Devolución ${devsPrev.length - i} · ${esc(fechaDO(d.fecha_devolucion))}</b>${d.cliente_que_devolvio ? `<span style="color:#475569"> · ${esc(d.cliente_que_devolvio)}</span>` : ''}<div style="margin-top:3px"><b>Motivo:</b> ${esc(d.motivo_devolucion)}</div>${d.problemas_reportados ? `<div><b>Problemas:</b> ${esc(d.problemas_reportados)}</div>` : ''}${d.diagnostico_inicial ? `<div><b>Diagnóstico:</b> ${esc(d.diagnostico_inicial)}</div>` : ''}</div>`).join('')}</div></div>` : ''}
      <h4 class="nxRcH4" style="margin:0 0 8px;color:#806515;text-transform:uppercase;font-size:12px"><i class="ti ti-progress"></i> Progreso de Reparación</h4>
      <div style="background:#fff;border:1px solid rgba(90,72,20,.18);border-radius:12px;padding:8px;margin-bottom:16px;overflow-x:auto"><div class="nxRcStepper" style="min-width:300px"><div class="line"></div><div class="fill" style="width:${fillW}"></div>${stepsHtml}</div></div>
      <h4 class="nxRcH4" style="margin:0 0 8px;color:#b91c1c;text-transform:uppercase;font-size:12px"><i class="ti ti-tools"></i> Piezas para la reparación</h4>
      ${piezasHtml}
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px">
        <button type="button" class="btn nxRcBtn light" onclick="window.nxRc.agregarPiezaExtra('${equipoId}')"><i class="ti ti-plus"></i> Agregar pieza adicional</button>
        ${estado === 'reparacion_externa' ? '' : `<button type="button" class="btn nxRcBtn light" style="color:#3730a3;border-color:#c7d2fe" onclick="window.nxRc.enviarRefurbExterno('${equipoId}')"><i class="ti ti-external-link"></i> Enviar a reparación externa</button>`}
      </div>
      ${esAdmin ? `<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:12px;margin-top:14px"><b style="color:#166534;font-size:13px"><i class="ti ti-cash"></i> Costo del equipo</b>
        <div style="display:flex;justify-content:space-between;font-size:13px;margin-top:8px"><span>Costo de compra:</span><b>${money(compra)}</b></div>${flete > 0 ? `<div style="display:flex;justify-content:space-between;font-size:13px;margin-top:4px"><span>Envío (proporcional):</span><b>${money(flete)}</b></div>` : ''}
        <div style="display:flex;justify-content:space-between;font-size:13px;margin-top:4px"><span>Piezas usadas (${piezas.length}):</span><b>${money(sumPiezas)}</b></div>
        <div style="display:flex;justify-content:space-between;font-size:16px;margin-top:8px;padding-top:8px;border-top:1px dashed #86efac;font-weight:800;color:#166534"><span>COSTO FINAL:</span><span>${money(final)}</span></div>${_piezasDescuentoHTML(piezas)}
        ${estado === 'listo_venta' ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px"><button type="button" class="btn nxRcBtn light" style="color:#0369a1;border-color:#7dd3fc" onclick="window.nxRc.agregarPiezaInfoPlus('${equipoId}')"><i class="ti ti-search"></i> Agregar piezas (inventario)</button><button type="button" class="btn nxRcBtn light" style="color:#7c3aed;border-color:#c4b5fd" onclick="window.nxRc.agregarPiezaExterna('${equipoId}')"><i class="ti ti-plus"></i> Pieza externa</button><button type="button" class="btn nxRcBtn light" style="color:#0f766e;border-color:#5eead4" onclick="window.nxRc.marcarEquipoCompletado('${equipoId}')"><i class="ti ti-lock-check"></i> Cerrar salida</button></div>` : ''}</div>` : ''}
      ${estado === 'reparacion_externa' ? `<div style="background:#e0e7ff;border:2px solid #6366f1;padding:14px;border-radius:12px;margin-top:14px"><b style="color:#3730a3"><i class="ti ti-external-link"></i> EN REPARACIÓN EXTERNA</b><p style="font-size:12px;color:#3730a3;margin:6px 0">Enviado a: <b>${esc(eq.taller_externo || '—')}</b></p><button type="button" class="btn nxRcBtn dark" onclick="window.nxRc.cambiarEstadoProceso('${equipoId}','tecnico_recibio')"><i class="ti ti-rotate"></i> Volvió de reparación externa</button></div>` : ''}
      ${estaReasignado ? `<div style="background:linear-gradient(135deg,#fef3c7,#fde68a);border:2px solid #f59e0b;padding:16px;border-radius:12px;margin-top:18px"><b style="color:#78350f"><i class="ti ti-user-share"></i> Equipo reasignado</b><p style="font-size:12px;color:#92400e;margin:8px 0">${soyAsignado(eq) ? 'Este equipo te fue reasignado' : 'Equipo reasignado a <b>' + esc(nombreEmpleado(eq.tecnico_asignado_id)) + '</b>'}${tecAnterior ? ` (antes lo tenía <b>${esc(tecAnterior)}</b>)` : ''}.${eq.motivo_reasignacion ? `<br><b>Motivo:</b> ${esc(eq.motivo_reasignacion)}` : ''}</p>
        ${puedeRecibirReasignado ? `<p style="font-size:12px;color:#92400e;margin:8px 0">¿Cómo quieres recibirlo?</p><button type="button" class="pieza-action-btn recibir" onclick="window.nxRc.recibirEquipoReasignado('${equipoId}','con_piezas')" style="padding:12px"><i class="ti ti-package"></i> Recibir CON las piezas actuales</button><button type="button" class="pieza-action-btn" onclick="window.nxRc.recibirEquipoReasignado('${equipoId}','limpio')" style="background:linear-gradient(180deg,#ef4444,#b91c1c);color:#fff;padding:12px"><i class="ti ti-refresh"></i> Recibir equipo LIMPIO (otra reparación)</button>` : '<div style="background:#fff;border-radius:8px;padding:10px;font-size:12px;color:#92400e;text-align:center"><i class="ti ti-clock"></i> Esperando que el técnico asignado lo reciba.<br><small>No puedes recibir un equipo que tú reasignaste.</small></div>'}</div>` : ''}
      ${(!estaReasignado && estado !== 'listo_venta' && estado !== 'vendido') ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px"><button type="button" class="btn nxRcBtn light" style="background:#fef3c7;color:#92400e;border-color:#fcd34d" onclick="window.nxRc.abrirModalReasignar('${equipoId}')"><i class="ti ti-user-share"></i> Reasignar a otro técnico</button><button type="button" class="btn nxRcBtn light" style="background:#ddd6fe;color:#5b21b6;border-color:#c4b5fd" onclick="window.nxRc.marcarListoVentaDirecto('${equipoId}')"><i class="ti ti-shopping-cart"></i> No requiere reparación → Listo para venta</button></div>` : ''}
      ${construirSeccionTareas('equipo', equipoId, tareas, estado === 'vendido')}
      ${estado === 'listo_revision' ? (esAdmin ? `<div style="background:linear-gradient(135deg,#fef3c7,#fde68a);border:2px solid #f59e0b;padding:16px;border-radius:12px;margin-top:18px"><b style="color:#78350f"><i class="ti ti-shield-check"></i> Control de calidad (Administración)</b><p style="font-size:12px;color:#92400e;margin:8px 0">El técnico envió este equipo a <b>CONTROL DE CALIDAD</b>. Revísalo y apruébalo para pasarlo a Listo para venta.</p><button type="button" class="pieza-action-btn recibir" onclick="window.nxRc.aprobarTerminado('${equipoId}')" style="padding:14px 20px;font-size:14px"><i class="ti ti-shield-check"></i> APROBAR Y PASAR A LISTO</button><button type="button" class="pieza-action-btn" onclick="window.nxRc.cambiarEstadoProceso('${equipoId}','tecnico_recibio')" style="background:#fff;color:#9a3412;border:1px solid #fdba74"><i class="ti ti-arrow-back-up"></i> Devolver al técnico (no pasó la revisión)</button></div>` : '<div style="background:#f1f5f9;border:1px solid #cbd5e1;padding:14px;border-radius:12px;margin-top:18px;text-align:center"><b style="color:#475569"><i class="ti ti-clock"></i> Enviado a control de calidad</b><p style="font-size:12px;color:#475569;margin:6px 0 0">Este equipo está esperando la revisión de <b>administración</b>.</p></div>') : ''}
    </div>` + pie(`<button type="button" class="btn nxRcBtn light" onclick="window.nxRc.verHistorial('${equipoId}')"><i class="ti ti-history"></i> Historial</button><button type="button" class="btn nxRcBtn dark" onclick="window.nxRc.cerrarPanel()">Cerrar</button>`);
    const prev = byId('nxRcPanelM');
    if (prev) { const box = prev.querySelector('.nxRcModal'); const top = box ? box.querySelector('[style*="overflow-y:auto"]') : null; const sc = top ? top.scrollTop : 0; box.innerHTML = html; const t2 = box.querySelector('[style*="overflow-y:auto"]'); if (t2) t2.scrollTop = sc; }
    else abrirModal('nxRcPanelM', html, 850);
  }
  function _piezasDescuentoHTML(piezas) {
    const ip = (piezas || []).filter(p => p.producto_id && !inList(['rechazada', 'devuelta'], p.estado)); if (!ip.length) return '';
    const pend = ip.filter(p => (Number(p.descontada_cant) || 0) === 0);
    const filas = ip.map(p => { const desc = (Number(p.descontada_cant) || 0) > 0; return `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:4px 0;border-bottom:1px dashed #e5e7eb"><span style="font-size:11.5px;flex:1;min-width:0">${esc(p.pieza_nombre || 'Pieza')}${desc ? '' : ' <span style="font-size:9px;font-weight:800;background:#fef9c3;color:#854d0e;padding:1px 6px;border-radius:7px">⏳</span>'}</span>${desc ? '<span style="font-size:11px;font-weight:700;color:#166534;white-space:nowrap">✓ descontada del inventario</span>' : `<button type="button" class="btn nxRcBtn light" style="height:26px;font-size:11px;color:#0369a1;border-color:#7dd3fc" onclick="window.nxRc.descontarPieza('${p.equipo_id}','${p.id}')"><i class="ti ti-arrow-down-circle"></i> Descontar</button>`}</div>`; }).join('');
    const todas = pend.length > 1 ? `<button type="button" class="btn nxRcBtn light" style="margin-top:6px;font-size:11px;color:#0369a1;border-color:#7dd3fc;width:100%" onclick="window.nxRc.descontarPieza('${ip[0].equipo_id}',null)"><i class="ti ti-arrow-down-circle"></i> Confirmar y descontar todas (${pend.length})</button>` : '';
    return `<div style="margin-top:10px;padding-top:8px;border-top:1px dashed #86efac"><div style="font-size:11px;font-weight:800;color:#475569;margin-bottom:4px">🧩 PIEZAS DEL INVENTARIO</div>${filas}${todas}</div>`;
  }
  async function descontarPieza(equipoId, piezaId) {
    if (!isAdminUser()) return toast('Solo el administrador.', 'error');
    try { const r = await api().post('rpc/pos_reacond_descontar_piezas', { p_equipo_id: equipoId, p_pieza_id: piezaId || null, p_usuario: miNombre() }); const om = (r && r.omitidas) || []; toast(`${(r && r.descontadas) || 0} pieza(s) descontada(s) del inventario.${om.length ? ' Omitidas: ' + om.join('; ') : ''}`, om.length ? 'error' : undefined); await loadAll(); _refrescarVistaEquipo(equipoId); } catch (e) { logError('descontar pieza', e); toastError(friendly(e)); }
  }
  function _refrescarVistaEquipo(equipoId) { if (byId('nxRcFichaM')) verFichaDespacho(equipoId); if (byId('nxRcPanelM')) abrirPanelProceso(equipoId); refrescarLote(); }
  async function marcarListoVentaDirecto(equipoId) {
    if (_reacondTienePiezasPendientes(cache.piezasReacond.filter(p => p.equipo_id === equipoId))) return toast('Este equipo todavía tiene piezas pendientes. Resuelve la solicitud antes de pasarlo a Listo para venta.', 'error');
    if (!await confirmar('¿Este equipo NO requiere reparación y pasa directo a "🛒 Listo para venta"?')) return;
    await cambiarEstadoProceso(equipoId, 'listo_venta');
  }
  async function aprobarTerminado(equipoId) {
    if (!isAdminUser()) return toast('Solo el administrador puede aprobar equipos. El técnico no puede aprobar su propio trabajo.', 'error');
    if (!await confirmar('¿Aprobar este equipo en CONTROL DE CALIDAD? Pasará a Listo para venta.', { peligro: false, ok: 'Aprobar' })) return;
    try { await api().patch('pos_reacond_equipos', 'id=eq.' + equipoId, { estado_evaluacion: 'listo_venta', fecha_terminado: nowISO() }); await historial(equipoId, 'listo_revision', 'listo_venta', 'Aprobado por admin → Listo para venta'); toast('Equipo aprobado y enviado a Listo para venta.'); cerrarPanelProceso(); await loadAll(); refrescarLote(); } catch (e) { logError('Aprobar terminado', e); toastError(friendly(e)); }
  }
  async function enviarRefurbExterno(equipoId) {
    const eq = equipo(equipoId); if (!eq) return toast('Equipo no encontrado.', 'error');
    let destino = '';
    while (true) { destino = await pedirTexto('🔧 REPARACIÓN EXTERNA\n\n¿A dónde / a quién se envía el equipo? (OBLIGATORIO)\n\nEjemplo: "Taller microsoldadura Juan", "Centro X - capital"'); if (destino === null) return; if (destino.trim()) break; toast('Indica a dónde se envió el equipo.', 'error'); }
    const nota = await pedirTexto('Nota / motivo (opcional):\n\nEjemplo: "Requiere reballing de CPU"', { valor: '' }); if (nota === null) return;
    try { await api().patch('pos_reacond_equipos', 'id=eq.' + equipoId, { estado_evaluacion: 'reparacion_externa', taller_externo: destino.trim() + (nota.trim() ? ' · ' + nota.trim() : '') }); await historial(equipoId, eq.estado_evaluacion, 'reparacion_externa', 'Enviado a reparación externa: ' + destino.trim(), nota.trim() || null); toast('🔧 Equipo enviado a reparación externa: ' + destino.trim()); await loadAll(); await abrirPanelProceso(equipoId); refrescarLote(); } catch (e) { logError('Reparación externa', e); toastError(friendly(e)); }
  }

  // ═══════════════ PIEZAS (entregar / recibir / extra / devolución / costo) ═══════════════
  const refrescarPanel = () => { if (I._panelProcesoEquipoId) abrirPanelProceso(I._panelProcesoEquipoId); };
  async function marcarPiezaEntregada(piezaId) { if (!soloAdmin('entregar piezas')) return; try { await api().patch('pos_reacond_piezas', 'id=eq.' + piezaId, { estado: 'entregada', fecha_entrega: nowISO() }); toast('📦 Pieza marcada como entregada. Esperando confirmación del técnico.'); await loadAll(); refrescarPanel(); } catch (e) { logError('Marcar pieza entregada', e); toastError(friendly(e)); } }
  async function marcarPiezaRecibida(piezaId) {
    try {
      const pz = cache.piezasReacond.find(p => p.id === piezaId) || {};
      await api().patch('pos_reacond_piezas', 'id=eq.' + piezaId, { estado: 'recibida' });
      let extra = '';
      if (pz.producto_id && !(Number(pz.descontada_cant) || 0)) { try { const r = await api().post('rpc/pos_reacond_descontar_piezas', { p_equipo_id: pz.equipo_id, p_pieza_id: piezaId, p_usuario: miNombre() }); if (r && r.descontadas) extra = ' Stock actualizado.'; else if (r && r.omitidas && r.omitidas.length) extra = ' (No se descontó del inventario: ' + r.omitidas.join('; ') + ')'; } catch (e2) { extra = ' (No se pudo descontar del inventario: ' + friendly(e2) + ')'; } }
      toast('✅ Pieza confirmada como recibida.' + extra); await loadAll(); refrescarPanel();
    } catch (e) { logError('Marcar pieza recibida', e); toastError(friendly(e)); }
  }
  async function aprobarPiezaExtra(piezaId) { if (!soloAdmin('aprobar piezas extra')) return; try { await api().patch('pos_reacond_piezas', 'id=eq.' + piezaId, { estado: 'aprobada', aprobada_por_admin: true }); toast('Pieza extra aprobada.'); await loadAll(); refrescarPanel(); } catch (e) { logError('Aprobar pieza extra', e); toastError(friendly(e)); } }
  async function rechazarPiezaExtra(piezaId) { if (!soloAdmin('rechazar piezas extra')) return; if (!await confirmar('¿Rechazar esta pieza extra?')) return; try { await api().patch('pos_reacond_piezas', 'id=eq.' + piezaId, { estado: 'rechazada' }); toast('Pieza rechazada.'); await loadAll(); refrescarPanel(); } catch (e) { logError('Rechazar pieza', e); toastError(friendly(e)); } }
  async function agregarPiezaExtra(equipoId) {
    const nombre = await pedirTexto('Nombre de la pieza extra que apareció durante la reparación:'); if (!nombre || !nombre.trim()) return;
    const costoStr = await pedirTexto('Costo unitario de la pieza (RD$):', { valor: '0', tipo: 'number' }); const costo = parseFloat(costoStr) || 0;
    const cantStr = await pedirTexto('Cantidad:', { valor: '1', tipo: 'number' }); const cantidad = parseInt(cantStr) || 1;
    try { await api().post('pos_reacond_piezas', { equipo_id: equipoId, pieza_nombre: nombre.trim(), cantidad, costo_unitario: costo, estado: 'extra_pendiente', agregada_por_tecnico: true, tecnico_id: miId() || null }); toast('Pieza extra agregada, esperando aprobación del admin.'); await loadAll(); refrescarPanel(); } catch (e) { logError('Agregar pieza extra', e); toastError(friendly(e)); }
  }
  async function solicitarPiezaDeFalla(equipoId, nombreEnc) {
    const nombre = decodeURIComponent(nombreEnc || '').trim(); if (!nombre) return;
    if (!await confirmar(`¿Solicitar la pieza "${nombre}" para este equipo?\n\nAparecerá en Pedidos de Piezas.`, { peligro: false, ok: 'Solicitar' })) return;
    try { await api().post('pos_reacond_piezas', { equipo_id: equipoId, tecnico_id: miId() || null, pieza_nombre: nombre, cantidad: 1, estado: 'pendiente', agregada_por_tecnico: true }); toast('✅ Pieza solicitada: ' + nombre + '. Aparece en Pedidos de Piezas.'); await loadAll(); refrescarPanel(); } catch (e) { logError('Solicitar pieza de falla', e); toastError(friendly(e)); }
  }
  async function solicitarDevolucionPieza(piezaId) {
    const motivo = await pedirTexto('¿Por qué devuelves esta pieza?\n(Ej: No se necesitó, pieza defectuosa, sobró...)'); if (motivo === null) return; if (!motivo.trim()) return toast('Debes indicar un motivo para devolver la pieza.', 'error');
    try { await api().patch('pos_reacond_piezas', 'id=eq.' + piezaId, { estado: 'devolucion_pendiente', devolucion_solicitada: true, motivo_devolucion_pieza: motivo.trim(), fecha_solicitud_devolucion: nowISO() }); toast('🔄 Devolución solicitada. Esperando aprobación del admin.'); await loadAll(); refrescarPanel(); } catch (e) { logError('Solicitar devolución pieza', e); toastError(friendly(e)); }
  }
  async function aprobarDevolucionPieza(piezaId) {
    if (!soloAdmin('aprobar devoluciones de piezas')) return;
    if (!await confirmar('¿Aprobar la devolución de esta pieza?\n\nLa pieza se marcará como devuelta, volverá al inventario si fue descontada y se descontará del costo del equipo.')) return;
    try {
      const pieza = cache.piezasReacond.find(p => p.id === piezaId); if (!pieza) throw new Error('Pieza no encontrada');
      await api().patch('pos_reacond_piezas', 'id=eq.' + piezaId, { estado: 'devuelta' });
      if (pieza.producto_id && (Number(pieza.descontada_cant) || 0) > 0) {
        try { await api().post('rpc/pos_mover_stock_atomico', { p_producto_id: pieza.producto_id, p_tipo: 'taller', p_delta: Number(pieza.descontada_cant), p_almacen_id: pieza.descontada_almacen_id || (almPrincipal() && almPrincipal().id) || null, p_referencia: 'REACOND devolución', p_motivo: 'Pieza devuelta del reacondicionado: ' + (pieza.pieza_nombre || ''), p_costo: null }); await api().patch('pos_reacond_piezas', 'id=eq.' + piezaId, { descontada_cant: 0 }); } catch (e2) { toast('La pieza quedó devuelta pero no se pudo reingresar al inventario: ' + friendly(e2), 'error'); }
      }
      const eq = equipo(pieza.equipo_id); const costoPieza = (pieza.cantidad || 1) * (pieza.costo_unitario || 0);
      if (eq) { await api().patch('pos_reacond_equipos', 'id=eq.' + eq.id, { costo_repuestos: Math.max(0, (Number(eq.costo_repuestos) || 0) - costoPieza) }); await historial(eq.id, 'pieza_entregada', 'pieza_devuelta', `🔄 Pieza devuelta: ${pieza.pieza_nombre} (−${money(costoPieza)})`, pieza.motivo_devolucion_pieza || null); }
      toast('✅ Devolución aprobada. Pieza devuelta y costo actualizado.'); await loadAll(); refrescarPanel();
    } catch (e) { logError('Aprobar devolución pieza', e); toastError(friendly(e)); }
  }
  async function rechazarDevolucionPieza(piezaId) { if (!soloAdmin('rechazar devoluciones de piezas')) return; if (!await confirmar('¿Rechazar la devolución? La pieza vuelve a estar como recibida.')) return; try { await api().patch('pos_reacond_piezas', 'id=eq.' + piezaId, { estado: 'recibida', devolucion_solicitada: false }); toast('La devolución fue rechazada. La pieza sigue asignada.'); await loadAll(); refrescarPanel(); } catch (e) { logError('Rechazar devolución pieza', e); toastError(friendly(e)); } }
  async function agregarPiezaExterna(equipoId) {
    if (!isAdminUser()) return toast('Solo el administrador puede agregar piezas al costo.', 'error');
    const nombre = await pedirTexto('Nombre de la pieza externa (no está en el inventario):'); if (nombre === null) return; if (!nombre.trim()) return toast('Escribe el nombre de la pieza.', 'error');
    const costoStr = await pedirTexto(`Pieza: ${nombre.trim()}\n\nCosto unitario (RD$):`, { valor: '0', tipo: 'number' }); if (costoStr === null) return; const costo = parseFloat(String(costoStr).replace(/[^0-9.]/g, '')) || 0;
    const cantStr = await pedirTexto('Cantidad:', { valor: '1', tipo: 'number' }); if (cantStr === null) return; const cantidad = parseInt(cantStr, 10) || 1;
    try { await api().post('pos_reacond_piezas', { equipo_id: equipoId, producto_id: null, pieza_codigo: null, pieza_nombre: nombre.trim(), cantidad, costo_unitario: costo, estado: 'aprobada', agregada_por_tecnico: false }); await _recalcularCostoRepuestos(equipoId); toast('✅ Pieza externa agregada al costo: ' + nombre.trim() + ' (' + money(costo * cantidad) + ')'); await loadAll(); _refrescarVistaEquipo(equipoId); } catch (e) { logError('agregarPiezaExterna', e); toastError(friendly(e)); }
  }
  async function agregarPiezaInfoPlus(equipoId) {
    if (!isAdminUser()) return toast('Solo el administrador puede agregar piezas al costo.', 'error');
    await cargarProductos();
    const items = cache.productos.filter(p => !p.serial && p.tipo !== 'servicio').map(p => ({ id: p.id, label: p.nombre, sub: [p.codigo, p.marca, 'Stock ' + Number(p.stock || 0), 'Costo ' + money(p.costo)].filter(Boolean).join(' · '), search: [p.nombre, p.codigo, p.marca, p.referencia].filter(Boolean).join(' ').toLowerCase(), extra: { costo: Number(p.costo) || 0, codigo: p.codigo } }));
    const fallas = await api().get('pos_reacond_equipo_fallas', 'select=*&equipo_id=eq.' + equipoId).catch(() => []) || [];
    abrirModal('nxRcPzIpM', cabecera('ti-search', 'Agregar piezas del inventario', 'nxRcPzIpM') + cuerpo(`
      ${fallas.length ? `<div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:8px 10px"><div style="font-size:11px;font-weight:700;color:#9a3412;margin-bottom:4px">FALLAS DEL EQUIPO (referencia)</div>${fallas.map(f => badge('<i class="ti ti-alert-triangle"></i> ' + esc(f.falla_corto || f.falla_nombre || '') + (f.adicional ? ' (adic.)' : ''), '#fee2e2', '#991b1b', 'margin:2px')).join('')}</div>` : ''}
      <div class="nxRcFld"><label>Pieza *</label>${smartSelect('ss-pzip', items, '🔍 Nombre, código o marca…', '')}</div>
      <div class="nxRcG2"><div class="nxRcFld"><label>Cantidad</label><input id="pzip_cant" type="number" class="nxRcInput" value="1" min="1"></div><div class="nxRcFld"><label>Costo unitario (RD$)</label><input id="pzip_costo" type="number" class="nxRcInput" step="any" placeholder="Se toma del inventario"></div></div>
      <p class="nxRcMuted" style="font-size:11.5px;margin:0">La pieza suma al costo del equipo y se descuenta del inventario al despacharlo (o antes, con "Descontar").</p>`) +
      pie(`<button type="button" class="btn nxRcBtn light" onclick="window.nxRc.cerrar('nxRcPzIpM')">Cancelar</button><button type="button" class="btn nxRcBtn gold" onclick="window.nxRc.confirmarPiezaInfoPlus('${equipoId}')"><i class="ti ti-plus"></i> Agregar al costo</button>`), 520, '10850');
    const el = byId('ss-pzip'); if (el) el.addEventListener('nxrc-change', ev => { const c = byId('pzip_costo'); if (c && ev.detail && ev.detail.extra && (!c.value || Number(c.value) === 0)) c.value = ev.detail.extra.costo; });
  }
  async function confirmarPiezaInfoPlus(equipoId) {
    const it = ssItem('ss-pzip'); if (!it) return toast('Selecciona una pieza.', 'error');
    const cantidad = parseInt(val('pzip_cant')) || 1; const costo = val('pzip_costo') !== '' ? (parseFloat(val('pzip_costo')) || 0) : ((it.extra && it.extra.costo) || 0);
    try { await api().post('pos_reacond_piezas', { equipo_id: equipoId, producto_id: it.id, pieza_codigo: (it.extra && it.extra.codigo) || null, pieza_nombre: it.label, cantidad, costo_unitario: costo, estado: 'aprobada', agregada_por_tecnico: false }); await _recalcularCostoRepuestos(equipoId); toast('✅ Pieza agregada al costo: ' + it.label); cerrarModal('nxRcPzIpM'); await loadAll(); _refrescarVistaEquipo(equipoId); } catch (e) { logError('agregar pieza inventario', e); toastError(friendly(e)); }
  }
  async function editarPiezaInfoPlus(piezaId) {
    if (!isAdminUser()) return toast('Solo el administrador puede editar el costo.', 'error');
    try {
      const pz = cache.piezasReacond.find(p => p.id === piezaId); if (!pz) throw new Error('Pieza no encontrada');
      if ((Number(pz.descontada_cant) || 0) > 0) return toast('Esta pieza ya se descontó del inventario. Quítala (vuelve al inventario) y agrégala de nuevo si cambió la cantidad.', 'error');
      const cantStr = await pedirTexto(`Pieza: ${pz.pieza_nombre || ''}\n\nCantidad:`, { valor: String(pz.cantidad || 1), tipo: 'number' }); if (cantStr === null) return; const cantidad = parseInt(cantStr) || 1;
      const costoStr = await pedirTexto('Costo unitario (RD$):', { valor: String(pz.costo_unitario || 0), tipo: 'number' }); if (costoStr === null) return; const costo = parseFloat(String(costoStr).replace(/[^0-9.]/g, '')) || 0;
      await api().patch('pos_reacond_piezas', 'id=eq.' + piezaId, { cantidad, costo_unitario: costo }); await _recalcularCostoRepuestos(pz.equipo_id); toast('✅ Pieza actualizada.'); await loadAll(); _refrescarVistaEquipo(pz.equipo_id);
    } catch (e) { logError('editarPiezaInfoPlus', e); toastError(friendly(e)); }
  }
  async function eliminarPiezaInfoPlus(piezaId) {
    if (!isAdminUser()) return toast('Solo el administrador puede quitar la pieza.', 'error');
    try {
      const pz = cache.piezasReacond.find(p => p.id === piezaId); if (!pz) throw new Error('Pieza no encontrada');
      if (!await confirmar(`¿Quitar la pieza "${pz.pieza_nombre || 'pieza'}" del costo del equipo?${(Number(pz.descontada_cant) || 0) > 0 ? '\n\nVolverá al inventario.' : ''}`)) return;
      if (pz.producto_id && (Number(pz.descontada_cant) || 0) > 0) { try { await api().post('rpc/pos_mover_stock_atomico', { p_producto_id: pz.producto_id, p_tipo: 'taller', p_delta: Number(pz.descontada_cant), p_almacen_id: pz.descontada_almacen_id || (almPrincipal() && almPrincipal().id) || null, p_referencia: 'REACOND devolución', p_motivo: 'Pieza quitada del reacondicionado: ' + (pz.pieza_nombre || ''), p_costo: null }); } catch (e2) { toast('No se pudo devolver al inventario: ' + friendly(e2) + ' (devuélvela a mano en Kardex)', 'error'); } }
      await api().del('pos_reacond_piezas', 'id=eq.' + piezaId); await _recalcularCostoRepuestos(pz.equipo_id); toast('✅ Pieza quitada del costo.'); await loadAll(); _refrescarVistaEquipo(pz.equipo_id);
    } catch (e) { logError('eliminarPiezaInfoPlus', e); toastError(friendly(e)); }
  }

  // ═══════════════ DESPACHO / SALIDA (marcarDespachado, marcarEquipoCompletado, marcarEquipoListo) ═══════════════
  async function marcarDespachado(equipoId) {
    if (!isAdminUser()) return toast('No tienes permiso para despachar equipos.', 'error');
    const eq = equipo(equipoId); if (!eq) return;
    const conInv = eq.producto_id ? '\n\nEl teléfono quedará DISPONIBLE en el inventario (almacén principal) con su IMEI.' : '';
    if (!await confirmar(`¿Registrar la salida de "${eq.modelo}"?\n\nEl equipo pasará a Despachado.${conInv}`, { peligro: false, ok: 'Registrar salida' })) return;
    try {
      const r = await api().post('rpc/pos_reacond_despachar', { p_equipo_id: equipoId, p_almacen_id: null, p_usuario: miNombre() });
      const nPz = Number((r && r.piezas && r.piezas.descontadas) || 0), om = (r && r.piezas && r.piezas.omitidas) || [];
      const ser = (r && r.serial) || ''; const serTxt = ser === 'creado' ? ' Entró al inventario con su IMEI.' : ser === 'reactivado' ? ' Volvió a estar disponible en el inventario.' : '';
      toast(`Salida registrada.${serTxt}${nPz ? ' ' + nPz + ' pieza(s) descontada(s).' : ''}${om.length ? ' Piezas no descontadas: ' + om.join('; ') : ''}`, om.length ? 'error' : undefined);
      cerrarModal('nxRcFichaM'); await loadAll(); refrescarLote();
    } catch (e) { logError('Marcar despachado', e); toastError(friendly(e)); }
  }
  async function marcarEquipoCompletado(equipoId) {
    if (!isAdminUser()) return toast('No tienes permiso para completar equipos.', 'error');
    const eq = equipo(equipoId); if (!eq) return; if (eq.completado) return toast('La salida de este equipo ya está cerrada.');
    if (!await confirmar(`¿Cerrar la salida de "${eq.modelo || 'equipo'}"?\n\nEl equipo seguirá disponible para garantías.`)) return;
    try {
      if (eq.estado_evaluacion === 'listo_venta') { await api().post('rpc/pos_reacond_despachar', { p_equipo_id: equipoId, p_almacen_id: null, p_usuario: miNombre() }); }
      await api().patch('pos_reacond_equipos', 'id=eq.' + equipoId, { estado_evaluacion: 'vendido', completado: true, fecha_completado: nowISO() });
      await historial(equipoId, null, 'completado', 'Salida cerrada administrativamente'); toast('Salida cerrada.'); cerrarPanelProceso(); cerrarModal('nxRcFichaM'); await loadAll(); refrescarLote();
    } catch (e) { logError('marcarEquipoCompletado', e); toastError(friendly(e)); }
  }
  async function marcarEquipoListo(equipoId) {
    if (!isAdminUser()) return toast('Solo el administrador puede cambiar el estado.', 'error');
    const eq = equipo(equipoId); if (!eq) return; if (eq.estado_evaluacion === 'listo_venta' && !eq.completado) return toast('Este equipo ya está en Listo.');
    if (!await confirmar(`¿Pasar "${eq.modelo || 'equipo'}" al estado LISTO para venta?`, { peligro: false, ok: 'Marcar Listo' })) return;
    try { const antes = eq.completado ? 'completado' : (eq.estado_evaluacion || ''); await api().patch('pos_reacond_equipos', 'id=eq.' + equipoId, { estado_evaluacion: 'listo_venta', completado: false, fecha_terminado: eq.fecha_terminado || nowISO() }); await historial(equipoId, antes, 'listo_venta', 'Marcado como Listo para venta'); toast('Equipo marcado como Listo para venta.'); cerrarModal('nxRcFichaM'); await loadAll(); refrescarLote(); } catch (e) { logError('marcarEquipoListo', e); toastError(friendly(e)); }
  }

  Object.assign(window.nxRc, {
    empezarEvaluacion, continuarEvaluacion, guardarEvaluacion, evalTab: cambiarTabEvaluacion, evalAtras: () => evalNavegar(-1), evalSiguiente: () => evalNavegar(1), evalRenderFallas: renderFallasEvaluacion, evalToggleFalla, evalToggleCat: evalToggleCategoria, evalExpandir: evalExpandirTodas, evalContraer: evalContraerTodas, evalAgregarPieza, evalQuitarPieza, evalCantPieza: evalCambiarCantidadPieza, imprimirLabelDiag: imprimirLabelDesdeEvaluacion,
    abrirAsignarTecnico: abrirModalAsignarTecnico, confirmarAsignarTecnico, abrirAsignarLote: abrirModalAsignarLote, asignloteRefrescar: _asignloteRefrescar, confirmarAsignarLote, abrirModalReasignar, guardarReasignacion, recibirEquipoReasignado,
    abrirPanelProceso, cerrarPanel: cerrarPanelProceso, cambiarEstadoProceso, marcarListoVentaDirecto, aprobarTerminado, enviarRefurbExterno, descontarPieza,
    agregarFallaAdicional, completarTarea, reabrirTarea, eliminarTarea, reasignarTarea,
    marcarPiezaEntregada, marcarPiezaRecibida, aprobarPiezaExtra, rechazarPiezaExtra, agregarPiezaExtra, solicitarPiezaDeFalla, solicitarDevolucionPieza, aprobarDevolucionPieza, rechazarDevolucionPieza, agregarPiezaExterna, agregarPiezaInfoPlus, confirmarPiezaInfoPlus, editarPiezaInfoPlus, eliminarPiezaInfoPlus,
    marcarDespachado, marcarEquipoCompletado, marcarEquipoListo
  });
  Object.assign(I, { abrirPanelProceso, construirSeccionTareas, _piezasDescuentoHTML, imprimirLabelEquipo: null });
  // la ficha, el historial y el label se definen en la parte 3 y se registran en window.nxRc
  function verFichaDespacho(id) { if (window.nxRc.verFichaDespacho) window.nxRc.verFichaDespacho(id); }
  function imprimirLabelEquipo(id, diag) { if (window.nxRc.imprimirLabel) window.nxRc.imprimirLabel(id, diag); }
})();

/* ═══════════════ Parte 3 · ficha, historial, label, lotes (alta/edición), catálogo, devoluciones, pedidos, rentabilidad, mis reacondicionados, reportes ═══════════════ */
(function () {
  'use strict';
  const I = window.__nxRcInt; if (!I) return;
  const { api, esc, money, toast, toastError, friendly, logError, miId, miNombre, isAdminUser, nowISO, fechaDO, fechaHoraDO, hoyYMD, diasDesde, tiempoDesde, byId, val, inList, rerenderPOS,
    cache, loadAll, cargarProductos, nombreEmpleado, tecnicosActivos, lote, equipo, prov, almPrincipal,
    abrirModal, cerrarModal, cabecera, cuerpo, pie, confirmar, pedirTexto, smartSelect, ssGet, ssItem,
    _uiListPage, _uiListPager, _uiListRenderers, _uiListPages, obtenerEtiquetaEstado, etiquetaEstadoPiezaReacond, badge, _REACOND_ESTADOS_REPARACION, _reacondEquipoPasaEstado, _reacondEsPiezaCostoInfoPlus, _reacondEsSolicitudTecnico,
    calcularFleteEquipo, _costoEquipoRep, _modeloRep, _loteConcluido, historial, renderDetalleLoteReacond, cargarLotesReacond, abrirLoteReacond, _filtros, UI_LIST_PAGE_SIZE } = I;
  const refrescarLote = () => { if (I.reacondLoteAbiertoId) renderDetalleLoteReacond(); else rerenderPOS(); };
  const tecItems = () => tecnicosActivos().map(t => ({ id: t.id, label: t.nombre, sub: t.especialidad || '', search: (t.nombre + ' ' + (t.especialidad || '')).toLowerCase(), meta: (t.rol === 'admin' || t.rol === 'gerente') ? 'ADMIN' : '' }));
  const seccion = (titulo, contenido) => `<div style="margin-top:14px"><h4 style="margin:0 0 6px;font-size:12px;text-transform:uppercase;color:#5b5951;letter-spacing:.3px">${titulo}</h4>${contenido}</div>`;

  // ═══════════════ FICHA DEL EQUIPO (verFichaDespacho) ═══════════════
  async function verFichaDespacho(equipoId) {
    const eq = equipo(equipoId); if (!eq) return toast('Equipo no encontrado.', 'error');
    let fallas = [], piezas = [], hist = [];
    try { const [rf, rp, rh] = await Promise.all([api().get('pos_reacond_equipo_fallas', 'select=*&equipo_id=eq.' + equipoId), api().get('pos_reacond_piezas', 'select=*&equipo_id=eq.' + equipoId + '&order=creado_en.asc'), api().get('pos_reacond_historial', 'select=*&equipo_id=eq.' + equipoId + '&order=fecha.asc')]); fallas = rf || []; piezas = rp || []; hist = rh || []; } catch (e) { logError('Ficha despacho', e); }
    const esVendido = eq.estado_evaluacion === 'vendido', admin = isAdminUser();
    const fallasHtml = fallas.length ? fallas.map(f => badge('<i class="ti ti-alert-triangle"></i> ' + esc(f.falla_corto || f.falla_nombre || '') + (f.adicional ? ' (adic.)' : ''), '#fef2f2', '#b91c1c', 'margin:3px;border:1px solid rgba(185,28,28,.12)')).join('') : '<span class="nxRcMuted" style="font-size:12.5px">Sin fallas registradas.</span>';
    let costoHtml = '';
    if (admin) {
      const compra = Number(eq.costo_compra) || 0, flete = calcularFleteEquipo(eq);
      const usadas = piezas.filter(p => inList(['recibida', 'entregada', 'aprobada'], p.estado)); const sumP = usadas.reduce((s, p) => s + (Number(p.cantidad) || 1) * (Number(p.costo_unitario) || 0), 0);
      const repuestos = Number(eq.costo_repuestos) || sumP, final = compra + flete + repuestos; const conCosto = usadas.filter(p => (Number(p.cantidad) || 1) * (Number(p.costo_unitario) || 0) > 0);
      const pct = x => final > 0 ? (x / final * 100) : 0;
      const lineas = conCosto.map(p => { const esInv = !!p.producto_id, esExt = !p.producto_id && !p.agregada_por_tecnico; return `<div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;gap:8px;margin-top:2px"><span style="flex:1;min-width:0">${esc(p.pieza_nombre || 'Pieza')} ×${p.cantidad || 1}${esInv ? ' ' + badge('INVENTARIO', '#bae6fd', '#075985', 'font-size:9px') : esExt ? ' ' + badge('EXTERNA', '#ede9fe', '#6d28d9', 'font-size:9px') : ''}</span><b>${money((p.cantidad || 1) * (p.costo_unitario || 0))}</b><span style="white-space:nowrap"><a onclick="window.nxRc.editarPiezaInfoPlus('${p.id}')" title="Editar" style="cursor:pointer;color:#0369a1;font-size:13px"><i class="ti ti-edit"></i></a> <a onclick="window.nxRc.eliminarPiezaInfoPlus('${p.id}')" title="Quitar" style="cursor:pointer;color:#b91c1c;font-size:13px;margin-left:6px"><i class="ti ti-trash"></i></a></span></div>`; }).join('');
      costoHtml = `<div class="nxRcSec" style="padding:0;overflow:hidden">
        <div style="background:#0a0a0a;color:#fffefa;padding:14px"><span class="nxRcBadge" style="background:${esVendido ? '#dcfce7' : '#ede9fe'};color:${esVendido ? '#166534' : '#5b21b6'}">${esVendido ? 'DESPACHADO' : 'LISTO PARA VENTA'}</span><div style="font-size:11px;letter-spacing:.1em;color:#e3c45c;font-weight:600;margin-top:8px"><i class="ti ti-cash"></i> COSTO DEL EQUIPO</div><div style="font-size:11px;color:rgba(255,254,250,.7)">Costo final</div><div style="font-size:24px;font-weight:800">${money(final)}</div>
          <div style="display:flex;height:6px;border-radius:999px;overflow:hidden;background:rgba(255,255,255,.15);margin-top:8px"><span style="width:${pct(compra)}%;background:#0f9d58"></span>${flete > 0 ? `<span style="width:${pct(flete)}%;background:#a7f3d0"></span>` : ''}${repuestos > 0 ? `<span style="width:${pct(repuestos)}%;background:#fbbf24"></span>` : ''}</div></div>
        <div style="padding:12px">
          <div style="display:flex;justify-content:space-between;font-size:13px;padding:4px 0"><span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#0f9d58;margin-right:6px"></span>Costo de compra</span><b>${money(compra)}</b></div>
          ${flete > 0 ? `<div style="display:flex;justify-content:space-between;font-size:13px;padding:4px 0"><span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#a7f3d0;margin-right:6px"></span>Envío <small>(proporcional)</small></span><b>${money(flete)}</b></div>` : ''}
          <div style="display:flex;justify-content:space-between;font-size:13px;padding:4px 0"><span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${repuestos > 0 ? '#fbbf24' : '#e2e8f0'};margin-right:6px"></span>Piezas con costo <small>(${conCosto.length})</small></span><b>${money(repuestos)}</b></div>
          ${lineas ? `<div style="margin-top:6px;padding-top:6px;border-top:1px dashed #e5e7eb">${lineas}</div>` : '<div class="nxRcMuted" style="font-size:12px;margin-top:6px">Sin piezas agregadas todavía</div>'}
          ${I._piezasDescuentoHTML(piezas)}
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:12px">
            <button type="button" class="btn nxRcBtn light" style="height:auto;padding:8px 6px;flex-direction:column;font-size:11px;color:#0369a1" onclick="window.nxRc.agregarPiezaInfoPlus('${equipoId}')"><i class="ti ti-search" style="font-size:18px"></i>Agregar piezas<br>(inventario)</button>
            <button type="button" class="btn nxRcBtn light" style="height:auto;padding:8px 6px;flex-direction:column;font-size:11px;color:#7c3aed" onclick="window.nxRc.agregarPiezaExterna('${equipoId}')"><i class="ti ti-plus" style="font-size:18px"></i>Pieza<br>externa</button>
            <button type="button" class="btn nxRcBtn light" style="height:auto;padding:8px 6px;flex-direction:column;font-size:11px;color:#166534" onclick="window.nxRc.marcarEquipoListo('${equipoId}')"><i class="ti ti-checkbox" style="font-size:18px"></i>Marcar<br>Listo</button>
          </div></div></div>`;
    }
    const delLote = cache.refurb.filter(r => r.lote_id === eq.lote_id); const nc = fn => delLote.filter(fn).length;
    const kpis = [{ n: nc(r => r.estado_evaluacion === 'pendiente'), t: 'Recibidos', ic: 'ti-package-import', bg: '#fffbeb', c: '#b45309' }, { n: nc(r => inList(['en_evaluacion', 'evaluado'], r.estado_evaluacion)), t: 'Diagnóstico', ic: 'ti-clipboard-list', bg: '#eff6ff', c: '#1d4ed8' }, { n: nc(r => inList(_REACOND_ESTADOS_REPARACION, r.estado_evaluacion)), t: 'Reparación', ic: 'ti-tool', bg: '#fff7ed', c: '#9a3412' }, { n: nc(r => r.estado_evaluacion === 'listo_revision'), t: 'Calidad', ic: 'ti-shield-check', bg: '#faf5ff', c: '#7e22ce' }, { n: nc(r => r.estado_evaluacion === 'listo_venta' && !r.completado), t: 'Listo', ic: 'ti-list-check', bg: '#f5f3ff', c: '#6d28d9' }, { n: nc(r => r.estado_evaluacion === 'vendido'), t: 'Despachado', ic: 'ti-truck-delivery', bg: '#ecfdf5', c: '#047857' }];
    const l = lote(eq.lote_id) || {}, envio = Number(l.gastos_envio) || 0, pv = prov(eq.proveedor_id || l.proveedor_id);
    const tecNombre = eq.tecnico_asignado_id ? nombreEmpleado(eq.tecnico_asignado_id) : 'Sin asignar'; const ini = tecNombre === 'Sin asignar' ? '' : tecNombre.split(' ').filter(Boolean).slice(0, 2).map(s => s[0]).join('').toUpperCase();
    const infoRows = [['Modelo', esc(eq.modelo || '—')], ['Color', esc(eq.color || '—')], ['Capacidad', esc(eq.capacidad || '—')], ['Código', esc(eq.articulo_codigo || '—')], ['Proveedor', esc(pv ? pv.nombre : '—')], ['Lote', esc(l.codigo_lote || '—')]];
    const idxMap = { pendiente: 0, en_evaluacion: 1, evaluado: 1, en_proceso: 2, tecnico_recibio: 2, espera_pieza: 2, reasignado: 2, reparacion_externa: 2, listo_revision: 3, listo_venta: 4, vendido: 5 };
    let cur = idxMap[eq.estado_evaluacion]; if (cur === undefined) cur = 0; if (eq.completado) cur = 5;
    const histFecha = re => { const h = hist.find(x => re.test((x.estado_nuevo || '') + ' ' + (x.accion || ''))); return h ? h.fecha : null; };
    const pasos = [{ t: 'Recibido', f: eq.creado_en }, { t: 'Evaluado', f: histFecha(/evaluado|Diagnóstico/i) || eq.fecha_asignacion }, { t: 'Reparado', f: histFecha(/proceso|repar|recibio/i) }, { t: 'Probado', f: histFecha(/revision|prob/i) }, { t: 'Listo para venta', f: eq.fecha_terminado || histFecha(/listo_venta|listo para/i) }, { t: 'Despachado', f: eq.fecha_despacho || eq.fecha_completado }];
    const tl = pasos.map((p, i) => { const done = i < cur, isCur = i === cur; const col = done ? '#16a34a' : isCur ? '#c9a227' : '#cbd5e1'; return `<div style="display:flex;flex-direction:column;align-items:center;text-align:center;flex:0 0 auto;width:100px"><div style="width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:2px solid ${col};background:${isCur ? '#0a0a0a' : done ? '#f0fdf4' : '#fff'};color:${isCur ? '#e3c45c' : col}"><i class="ti ${done ? 'ti-check' : isCur ? 'ti-tag' : i === 5 ? 'ti-truck-delivery' : 'ti-circle'}"></i></div><div style="font-size:11.5px;font-weight:700;color:${done ? '#16a34a' : isCur ? '#111' : '#5b5951'};margin-top:6px">${p.t}</div><div style="font-size:10px;color:#85817a;margin-top:2px">${p.f ? fechaHoraDO(p.f) : (isCur ? '' : 'Pendiente')}</div></div>`; }).join('<div style="flex:1;height:2px;background:#e9e5da;margin-top:16px;min-width:14px"></div>');
    const nEnLote = (delLote.findIndex(r => r.id === eq.id) + 1) || '-';
    abrirModal('nxRcFichaM', cabecera('ti-device-mobile', 'Ficha del Equipo', 'nxRcFichaM', `<span class="nxRcBadge" style="background:${esVendido ? '#dcfce7' : '#ede9fe'};color:${esVendido ? '#166534' : '#5b21b6'}">${esVendido ? 'DESPACHADO' : 'LISTO'}</span>`) + `<div style="overflow-y:auto;flex:1;padding:14px;background:#f3f0e8;display:flex;flex-direction:column;gap:12px">
      <div class="nxRcActs">
        <button type="button" class="btn nxRcBtn" style="background:linear-gradient(180deg,#e11d48,#be123c);color:#fff;border-color:#9f1239" onclick="window.nxRc.imprimirLabel('${equipoId}')"><i class="ti ti-printer"></i> Imprimir Label</button>
        <button type="button" class="btn nxRcBtn light" onclick="window.nxRc.verHistorial('${equipoId}')"><i class="ti ti-history"></i> Ver historial</button>
        ${admin && !esVendido ? `<button type="button" class="btn nxRcBtn green" onclick="window.nxRc.marcarDespachado('${equipoId}')"><i class="ti ti-truck-delivery"></i> Registrar salida</button>` : ''}
        ${admin && esVendido && !eq.completado ? `<button type="button" class="btn nxRcBtn light" onclick="window.nxRc.marcarEquipoCompletado('${equipoId}')"><i class="ti ti-lock-check"></i> Cerrar salida</button>` : ''}
      </div>
      <div class="nxRcSec" style="display:grid;grid-template-columns:110px 1fr;gap:16px;align-items:center"><div style="background:linear-gradient(160deg,#f3f0e8,#e9e5da);border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:52px;min-height:110px">📱</div>
        <div><h1 style="margin:0;font-size:22px;font-weight:900;line-height:1.1">${esc(_modeloRep(eq) || 'Equipo')}</h1><div class="nxRcMuted" style="font-weight:600;font-size:13px;margin-top:3px">${esc(((eq.marca || '') + ' ' + (eq.modelo || '')).trim())}</div>
          <div style="margin:8px 0"><span class="reacond-equipo-number">#${nEnLote}</span> <span class="nxRcBadge" style="background:${esVendido ? '#dcfce7' : '#ede9fe'};color:${esVendido ? '#166534' : '#5b21b6'}"><i class="ti ti-circle-check"></i> ${esVendido ? 'DESPACHADO' : 'LISTO PARA VENTA'}${esVendido && eq.completado ? ' · REGISTRO CERRADO' : ''}</span></div>
          <div style="font-size:13px"><i class="ti ti-device-mobile"></i> IMEI: <b>${esc(eq.imei || '—')}</b> <a onclick="try{navigator.clipboard.writeText('${esc(eq.imei || '')}');window.toast&&window.toast('ok','IMEI copiado','')}catch(e){}" style="cursor:pointer;color:#85817a"><i class="ti ti-copy"></i></a></div>
          ${eq.serial ? `<div class="nxRcMuted" style="font-size:12px;margin-top:4px">Serial: ${esc(eq.serial)}</div>` : ''}<div class="nxRcMuted" style="font-size:12px;margin-top:4px">Tomado: ${fechaHoraDO(eq.creado_en)}${tecNombre !== 'Sin asignar' ? `<br><span style="color:#e11d48;font-weight:700">por ${esc(tecNombre)}</span>` : ''}</div></div></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(95px,1fr));gap:8px">${kpis.map(k => `<div style="background:${k.bg};border-radius:12px;padding:10px 12px"><div style="font-size:16px;color:${k.c};opacity:.8"><i class="ti ${k.ic}"></i></div><div style="font-size:24px;font-weight:900;line-height:1;margin:4px 0 2px;color:${k.c}">${k.n}</div><div style="font-size:10px;font-weight:700;letter-spacing:.05em;color:#64748b;text-transform:uppercase">${k.t}</div></div>`).join('')}</div>
      <div class="nxRcSec" style="display:flex;align-items:center;justify-content:space-between;gap:10px;${admin ? 'cursor:pointer' : ''}" ${admin ? 'onclick="window.nxRc.editarEnvio()"' : ''}><div style="display:flex;align-items:center;gap:12px"><div style="width:40px;height:40px;border-radius:11px;background:#f3f0e8;color:#806515;display:flex;align-items:center;justify-content:center;font-size:19px"><i class="ti ti-truck"></i></div><div><div style="font-weight:800">ENVÍO (COURIER)</div><div class="nxRcMuted" style="font-size:12px">Gasto del lote, repartido por costo</div></div></div><div style="display:flex;align-items:center;gap:8px"><b style="font-size:18px">${money(envio)}</b>${admin ? '<i class="ti ti-chevron-right" style="color:#94a3b8"></i>' : ''}</div></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;align-items:start">
        <div style="display:flex;flex-direction:column;gap:12px"><div class="nxRcSec"><h4><i class="ti ti-device-mobile" style="color:#e11d48"></i> Información del equipo</h4>${infoRows.map(r => `<div style="display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px solid #f1efe8;font-size:13px;color:#5b5951"><span>${r[0]}</span><b style="color:#111">${r[1]}</b></div>`).join('')}</div>
          <div class="nxRcSec"><h4><i class="ti ti-user" style="color:#e11d48"></i> Técnico asignado</h4><div style="display:flex;align-items:center;gap:10px"><span style="width:36px;height:36px;border-radius:50%;background:#ede9fe;color:#6d28d9;font-weight:800;font-size:13px;display:flex;align-items:center;justify-content:center">${ini || '—'}</span><b>${esc(tecNombre)}</b></div></div></div>
        <div style="display:flex;flex-direction:column;gap:12px"><div class="nxRcSec"><h4><i class="ti ti-alert-triangle" style="color:#d97706"></i> Fallas que tenía el equipo</h4><div>${fallasHtml}</div></div>
          <div class="nxRcSec"><h4><i class="ti ti-message" style="color:#64748b"></i> Notas internas</h4><div style="background:#faf8f2;border-radius:10px;padding:10px 12px;font-size:13px;color:#5b5951;line-height:1.5">${esc((eq.notas_diagnostico || '').trim()) || '<span style="color:#94a3b8">Sin notas.</span>'}</div></div></div>
        <div>${costoHtml || '<div class="nxRcSec nxRcMuted">Costo visible solo para el administrador.</div>'}</div>
      </div>
      <div class="nxRcSec" style="overflow-x:auto"><h4>Proceso del equipo</h4><div style="display:flex;align-items:flex-start;min-width:640px">${tl}</div></div>
      <div class="nxRcMuted" style="font-size:11.5px">Creado: ${fechaHoraDO(eq.creado_en)} &nbsp;|&nbsp; Última actualización: ${fechaHoraDO(eq.actualizado_en || eq.creado_en)}</div>
    </div>` + pie(`<button type="button" class="btn nxRcBtn dark" onclick="window.nxRc.cerrar('nxRcFichaM')">Cerrar</button>`), 1100);
  }

  // ═══════════════ HISTORIAL (verHistorialEquipoReacond) ═══════════════
  async function verHistorialEquipoReacond(equipoId) {
    const eq = equipo(equipoId); if (!eq) return toast('Equipo no encontrado.', 'error'); const esAdmin = isAdminUser();
    let hst = [], tareas = [], fallas = [], piezas = [];
    try { const [h, t, f, p] = await Promise.all([api().get('pos_reacond_historial', 'select=*&equipo_id=eq.' + equipoId + '&order=fecha.asc'), api().get('pos_reacond_tareas', 'select=*&tipo=eq.equipo&ref_id=eq.' + equipoId + '&order=creado_en.asc'), api().get('pos_reacond_equipo_fallas', 'select=*&equipo_id=eq.' + equipoId), api().get('pos_reacond_piezas', 'select=*&equipo_id=eq.' + equipoId + '&order=creado_en.asc')]); hst = h || []; tareas = t || []; fallas = f || []; piezas = p || []; } catch (e) { logError('Ver historial equipo', e); }
    const et = obtenerEtiquetaEstado(eq.estado_evaluacion || 'pendiente'); const tecActual = eq.tecnico_asignado_id ? nombreEmpleado(eq.tecnico_asignado_id) : null;
    const compra = Number(eq.costo_compra) || 0, flete = calcularFleteEquipo(eq), sumPiezas = piezas.filter(p => !inList(['rechazada', 'devuelta'], p.estado)).reduce((s, p) => s + (Number(p.cantidad) || 1) * (Number(p.costo_unitario) || 0), 0);
    const costosHtml = esAdmin ? `<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:12px"><div style="display:flex;justify-content:space-between;font-size:13px"><span>Costo de compra:</span><b>${money(compra)}</b></div>${flete > 0 ? `<div style="display:flex;justify-content:space-between;font-size:13px;margin-top:3px"><span>Envío (proporcional):</span><b>${money(flete)}</b></div>` : ''}<div style="display:flex;justify-content:space-between;font-size:13px;margin-top:3px"><span>Piezas (${piezas.length}):</span><b>${money(sumPiezas)}</b></div><div style="display:flex;justify-content:space-between;font-size:15px;margin-top:6px;padding-top:6px;border-top:1px dashed #86efac;font-weight:800;color:#166534"><span>COSTO FINAL:</span><span>${money(compra + flete + sumPiezas)}</span></div></div>` : '<div class="nxRcMuted" style="font-size:12px">Los costos solo los ve el administrador.</div>';
    const porTec = {}; tareas.forEach(t => { const k = t.tecnico_id || '_sin'; (porTec[k] = porTec[k] || []).push(t); });
    const trabajoHtml = Object.keys(porTec).length ? Object.entries(porTec).map(([tid, arr]) => `<div style="margin-bottom:8px"><b style="font-size:13px;color:#3730a3"><i class="ti ti-user"></i> ${esc(tid === '_sin' ? 'Sin asignar' : nombreEmpleado(tid))}</b> <span style="font-size:11px;color:#475569">(${arr.filter(t => t.estado === 'hecha').length}/${arr.length} hechas)</span><ul style="margin:4px 0 0;padding-left:18px;font-size:12px">${arr.map(t => `<li style="margin:2px 0;${t.estado === 'hecha' ? 'color:#16a34a' : ''}">${t.estado === 'hecha' ? '<i class="ti ti-check"></i>' : '<i class="ti ti-hourglass"></i>'} ${esc(t.descripcion || '')}${t.notas ? ` <span style="color:#475569">— ${esc(t.notas)}</span>` : ''}${t.fecha_completada ? ` <span style="color:#475569;font-size:10px">(${fechaHoraDO(t.fecha_completada)})</span>` : ''}</li>`).join('')}</ul></div>`).join('') : '<div class="nxRcMuted" style="font-size:12px">Aún no hay tareas registradas.</div>';
    const piezasHtml = piezas.length ? piezas.map(p => `<div style="display:flex;justify-content:space-between;font-size:12px;padding:4px 0;border-bottom:1px solid #f1efe8"><span>${esc(p.pieza_nombre || 'Pieza')} ×${p.cantidad || 1} <span style="color:#475569">(${esc(etiquetaEstadoPiezaReacond(p.estado).txt)}${p.agregada_por_tecnico ? ' · agregada por técnico' : ''})</span></span>${esAdmin ? `<b>${money((Number(p.cantidad) || 1) * (Number(p.costo_unitario) || 0))}</b>` : ''}</div>`).join('') : '<div class="nxRcMuted" style="font-size:12px">Sin piezas registradas.</div>';
    const fallasHtml = fallas.length ? fallas.map(f => badge(esc(f.falla_corto || f.falla_nombre || 'Falla'), '#fee2e2', '#991b1b', 'margin:2px;font-size:10px')).join('') : '<span class="nxRcMuted" style="font-size:12px">Sin fallas registradas.</span>';
    const timeline = hst.length ? hst.map(h => { const de = h.estado_anterior ? obtenerEtiquetaEstado(h.estado_anterior).text : '', a = h.estado_nuevo ? obtenerEtiquetaEstado(h.estado_nuevo).text : ''; return `<div style="border-left:2px solid #cbd5e1;padding:3px 0 6px 12px;margin-left:4px"><div style="font-size:12px;font-weight:600">${esc(h.accion || 'Cambio de estado')} ${de && a ? `<span style="color:#475569;font-weight:400;font-size:11px">(${de} → ${a})</span>` : ''}</div>${h.notas ? `<div style="font-size:11px;color:#475569">${esc(h.notas)}</div>` : ''}<div style="font-size:10px;color:#475569">${fechaHoraDO(h.fecha)}${h.usuario ? ' · ' + esc(h.usuario) : ''}</div></div>`; }).join('') : '<div class="nxRcMuted" style="font-size:12px">Sin movimientos registrados.</div>';
    abrirModal('nxRcHistM', cabecera('ti-history', 'Historial del equipo', 'nxRcHistM') + cuerpo(`
      <div class="nxRcLoteInfo" style="margin:0"><b style="font-size:15px">${esc(eq.modelo || 'Equipo')}</b> ${badge(et.text, et.bg, et.color)}${eq.veces_devuelto > 0 ? ' ' + badge('<i class="ti ti-refresh"></i> DEVUELTO ' + eq.veces_devuelto + '×', '#fee2e2', '#991b1b', 'font-size:10px') : ''}<div style="font-size:12px;color:#475569;margin-top:4px">IMEI: ${esc(eq.imei || '—')}${tecActual ? ` · <i class="ti ti-user"></i> Técnico actual: <b>${esc(tecActual)}</b>` : ''}</div></div>
      ${seccion('<i class="ti ti-currency-dollar"></i> Costos', costosHtml)}${seccion('<i class="ti ti-user-cog"></i> Trabajo por técnico', trabajoHtml)}${seccion('<i class="ti ti-puzzle"></i> Piezas usadas', `<div style="background:#fff;border:1px solid rgba(90,72,20,.18);border-radius:8px;padding:8px 10px">${piezasHtml}</div>`)}${seccion('<i class="ti ti-alert-triangle"></i> Fallas registradas', `<div>${fallasHtml}</div>`)}${seccion('<i class="ti ti-history"></i> Línea de tiempo', `<div style="margin-top:4px">${timeline}</div>`)}`) +
      pie(`${eq.estado_evaluacion !== 'vendido' ? `<button type="button" class="btn nxRcBtn light" onclick="window.nxRc.cerrar('nxRcHistM');window.nxRc.continuarEvaluacion('${equipoId}')"><i class="ti ti-pencil"></i> Editar evaluación</button>` : ''}<button type="button" class="btn nxRcBtn dark" onclick="window.nxRc.cerrar('nxRcHistM')">Cerrar</button>`), 680, '10850');
  }

  // ═══════════════ LABEL (imprimirLabelEquipo + label de diagnóstico) ═══════════════
  function _parseModeloCapacidad(raw) {
    let modelo = String(raw || '').trim(); const caps = [];
    modelo = modelo.replace(/(\d+)\s*GB\s*RAM/ig, (_m, g) => { caps.push({ t: 'ram', v: g + 'GB RAM' }); return ' '; });
    modelo = modelo.replace(/(\d+)\s*(GB|TB)\b/ig, (_m, n, u) => { caps.push({ t: 'sto', v: n + u.toUpperCase() }); return ' '; });
    modelo = modelo.replace(/\bCELULAR\b/ig, ' ').replace(/\s*[\+\/]\s*/g, ' ').replace(/\s{2,}/g, ' ').trim().replace(/\b([A-Za-zÁÉÍÓÚÑáéíóúñ0-9]+)(\s+\1\b)+/ig, '$1').trim();
    const sto = caps.filter(c => c.t === 'sto').map(c => c.v), ram = caps.filter(c => c.t === 'ram').map(c => c.v);
    return { modelo, capacidad: [sto.join(' '), ram.join(' ')].filter(Boolean).join(' + ') };
  }
  async function imprimirLabelEquipo(equipoId, diag) {
    const eq = equipo(equipoId); if (!eq) return toast('Equipo no encontrado.', 'error');
    const parsed = _parseModeloCapacidad([eq.modelo, eq.color].filter(Boolean).join(' ')); const marca = eq.marca || (/iphone|apple/i.test(eq.modelo || '') ? 'Apple' : '');
    let modeloLimpio = parsed.modelo; const esApple = /iphone|apple/i.test(marca + ' ' + (eq.modelo || ''));
    (esApple ? ['iphone', 'apple'] : [marca]).forEach(w => { if (w) modeloLimpio = modeloLimpio.replace(new RegExp('\\b' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'ig'), ' '); });
    modeloLimpio = modeloLimpio.replace(/\s{2,}/g, ' ').trim() || parsed.modelo; if (esApple) modeloLimpio = ('iP ' + modeloLimpio).trim();
    const capac = (eq.capacidad && String(eq.capacidad).trim()) ? String(eq.capacidad).trim() : parsed.capacidad;
    let fallas = []; if (diag) { try { fallas = await api().get('pos_reacond_equipo_fallas', 'select=*&equipo_id=eq.' + equipoId) || []; } catch (e) {} }
    const l = lote(eq.lote_id) || {};
    let w = 58, h = 28, f = 13; try { w = parseInt(localStorage.getItem('studio_lbl_w')) || 58; h = parseInt(localStorage.getItem('studio_lbl_h')) || 28; f = parseInt(localStorage.getItem('studio_lbl_f')) || 13; } catch (e) {}
    abrirModal('nxRcLabelM', cabecera('ti-printer', diag ? 'Imprimir label de diagnóstico' : 'Imprimir label', 'nxRcLabelM') + cuerpo(`
      <div class="nxRcG2"><div class="nxRcFld"><label>Marca</label><input id="lr_marca" class="nxRcInput" value="${esc(marca)}" oninput="window.nxRc.lrPreview()"></div><div class="nxRcFld"><label>Modelo</label><input id="lr_modelo" class="nxRcInput" value="${esc(modeloLimpio)}" oninput="window.nxRc.lrPreview()"></div>
      <div class="nxRcFld"><label>Capacidad (GB / RAM)</label><input id="lr_gb" class="nxRcInput" value="${esc(capac)}" oninput="window.nxRc.lrPreview()"></div><div class="nxRcFld"><label>IMEI / Serial</label><input id="lr_imei" class="nxRcInput" value="${esc(eq.imei || '')}" oninput="window.nxRc.lrPreview()"></div>
      <div class="nxRcFld"><label>Texto de estado (opcional)</label><input id="lr_estado" class="nxRcInput" placeholder="Ej. CLASE A" value="${diag ? 'DIAGNÓSTICO' : ''}" oninput="window.nxRc.lrPreview()"></div><div class="nxRcFld"><label>Copias</label><input id="lr_copias" type="number" class="nxRcInput" min="1" value="1" style="font-weight:700"></div></div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px"><div class="nxRcFld"><label>Ancho (mm)</label><input id="lr_w" type="number" class="nxRcInput" value="${w}" oninput="window.nxRc.lrPreview()"></div><div class="nxRcFld"><label>Alto (mm)</label><input id="lr_h" type="number" class="nxRcInput" value="${h}" oninput="window.nxRc.lrPreview()"></div><div class="nxRcFld"><label>Letra (px)</label><div style="display:flex;align-items:center;gap:6px"><button type="button" class="btn nxRcBtn light" style="width:34px;padding:0" onclick="window.nxRc.lrFuente(-1)">−</button><span id="lr_font_val" style="font-size:11px;min-width:32px;text-align:center">${f}px</span><button type="button" class="btn nxRcBtn light" style="width:34px;padding:0" onclick="window.nxRc.lrFuente(1)">+</button><input id="lr_f" type="hidden" value="${f}"></div></div></div>
      <input type="hidden" id="lr_fallas" value="${esc(fallas.map(x => (x.falla_corto || x.falla_nombre || '').toUpperCase()).join('|'))}"><input type="hidden" id="lr_lote" value="${esc(l.codigo_lote || '')}"><input type="hidden" id="lr_notas" value="${esc(diag ? (eq.notas_diagnostico || '') : '')}">
      <div style="font-size:11px;color:#85817a;text-transform:uppercase"><i class="ti ti-photo"></i> Vista previa</div>
      <div style="display:flex;justify-content:center;background:#faf8f2;border-radius:8px;padding:14px;overflow:auto"><div id="lr_preview"></div></div>
      <p class="nxRcMuted" style="font-size:11px;margin:0">Se abre el diálogo de impresión del navegador con el tamaño indicado (mm). La medida y la letra quedan guardadas en este dispositivo.</p>`) +
      pie(`<button type="button" class="btn nxRcBtn light" onclick="window.nxRc.cerrar('nxRcLabelM')">Cancelar</button><button type="button" class="btn nxRcBtn gold" onclick="window.nxRc.lrImprimir()"><i class="ti ti-printer"></i> Imprimir</button>`), 520, '10860');
    _lrPreview();
  }
  function _lrHtml() {
    const v = id => (byId(id) || {}).value || ''; const w = parseInt(v('lr_w')) || 58, h = parseInt(v('lr_h')) || 28, f = parseInt(v('lr_f')) || 13;
    const fallas = v('lr_fallas').split('|').filter(Boolean); const cols = fallas.length >= 4 ? 2 : 1;
    const linea = t => `<div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${t}</div>`;
    return `<div class="nxRcLabel" style="width:${w}mm;min-height:${h}mm;font-size:${f}px;font-weight:800;line-height:1.15;padding:0.8mm 3mm 0.8mm 4mm;box-sizing:border-box;overflow:hidden;font-family:'Arial Black',Arial,Helvetica,sans-serif;color:#000;background:#fff">
      ${v('lr_estado') ? `<div style="text-align:center;border-bottom:2px solid #000;padding-bottom:0.4mm;margin-bottom:0.4mm">${esc(v('lr_estado').toUpperCase())}</div>` : ''}
      ${linea(esc([v('lr_marca'), v('lr_modelo'), v('lr_gb')].filter(Boolean).join(' ').toUpperCase()))}
      ${linea('IMEI: <span style="font-family:\'Courier New\',Courier,monospace;letter-spacing:.3px">' + esc(v('lr_imei').toUpperCase() || 'SIN IMEI') + '</span>')}
      ${linea('FECHA: ' + esc(fechaDO(new Date())) + (v('lr_lote') ? ' · LOTE: ' + esc(v('lr_lote').toUpperCase()) : ''))}
      ${v('lr_notas') ? `<div style="border-top:2px dashed #000;padding-top:0.4mm;font-size:${Math.max(6, f - 1)}px">NOTAS: ${esc(v('lr_notas').toUpperCase())}</div>` : ''}
      ${fallas.length ? `<div style="border-top:2px dashed #000;padding-top:0.4mm;margin-top:0.4mm;font-size:${Math.max(6, f - 1)}px"><div>REVISAR:</div><div style="display:grid;grid-template-columns:repeat(${cols},1fr);gap:0 6px">${fallas.map(x => `<div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">☐ ${esc(x)}</div>`).join('')}</div></div>` : ''}
    </div>`;
  }
  function _lrPreview() { const p = byId('lr_preview'); if (!p) return; p.innerHTML = _lrHtml(); const c = p.firstElementChild; if (c) c.style.outline = '2px dashed #85817a'; const d = byId('lr_font_val'); if (d) d.textContent = ((byId('lr_f') || {}).value || 13) + 'px'; }
  function _lrAjustarFuente(delta) { const i = byId('lr_f'); if (!i) return; i.value = Math.max(6, Math.min(22, (parseInt(i.value) || 13) + delta)); _lrPreview(); }
  function imprimirLabelRapido() {
    const v = id => (byId(id) || {}).value || ''; const copias = Math.max(1, parseInt(v('lr_copias')) || 1); const w = parseInt(v('lr_w')) || 58, h = parseInt(v('lr_h')) || 28;
    try { localStorage.setItem('studio_lbl_w', w); localStorage.setItem('studio_lbl_h', h); localStorage.setItem('studio_lbl_f', parseInt(v('lr_f')) || 13); } catch (e) {}
    const html = Array.from({ length: copias }, () => _lrHtml()).join('');
    const win = window.open('', '_blank', 'width=600,height=500'); if (!win) return toast('El navegador bloqueó la ventana de impresión. Permite ventanas emergentes para studiord.net.', 'error');
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Label</title><style>@page{size:${w}mm ${h}mm;margin:0}body{margin:0}.nxRcLabel{page-break-after:always}</style></head><body>${html}<script>window.onload=function(){window.print();setTimeout(function(){window.close()},400)}<\/script></body></html>`);
    win.document.close(); cerrarModal('nxRcLabelM');
  }

  // ═══════════════ LOTES: nuevo lote, desde compra, datos, envío, agregar/editar/eliminar equipo, registrar existente ═══════════════
  function calcularSiguienteCodigoLote() { const n = new Date(); const pref = String(n.getFullYear()) + String(n.getMonth() + 1).padStart(2, '0') + '-'; let max = 0; cache.lotes.forEach(l => { const c = (l.codigo_lote || '').trim(); if (c.startsWith(pref)) { const k = parseInt(c.slice(pref.length), 10); if (!isNaN(k) && k > max) max = k; } }); return pref + String(max + 1).padStart(4, '0'); }
  const provItems = () => cache.proveedores.map(p => ({ id: p.id, label: p.nombre, search: (p.nombre || '').toLowerCase() }));
  function abrirModalNuevoLote() {
    if (!isAdminUser()) return toast('Solo el administrador.', 'error');
    abrirModal('nxRcLoteM', cabecera('ti-stack', 'Nuevo lote de reacondicionado', 'nxRcLoteM') + cuerpo(`
      <p class="nxRcMuted" style="font-size:12.5px;margin:0">Un lote agrupa los teléfonos que llegaron juntos de un proveedor. Después agregas cada equipo con su IMEI (o crea el lote desde una compra para traerlos automáticamente).</p>
      <div class="nxRcG2"><div class="nxRcFld"><label>Código del lote *</label><input id="lt_codigo" class="nxRcInput" value="${esc(calcularSiguienteCodigoLote())}" style="font-weight:700"></div><div class="nxRcFld"><label>Fecha de compra</label><input id="lt_fecha" type="date" class="nxRcInput" value="${hoyYMD()}"></div></div>
      <div class="nxRcFld"><label>Proveedor</label>${smartSelect('ss-lt-prov', provItems(), '🔍 Buscar proveedor…', '')}</div>
      <div class="nxRcG2"><div class="nxRcFld"><label>Gastos de envío / courier (RD$)</label><input id="lt_envio" type="number" class="nxRcInput" step="any" min="0" value="0"></div><div class="nxRcFld"><label>Notas</label><input id="lt_notas" class="nxRcInput" placeholder="Opcional"></div></div>`) +
      pie(`<button type="button" class="btn nxRcBtn light" onclick="window.nxRc.cerrar('nxRcLoteM')">Cancelar</button><button type="button" class="btn nxRcBtn gold" onclick="window.nxRc.guardarNuevoLote()"><i class="ti ti-check"></i> Crear lote</button>`), 520);
  }
  async function guardarNuevoLote() {
    const codigo = val('lt_codigo'); if (!codigo) return toast('El código del lote es obligatorio.', 'error');
    if (cache.lotes.some(l => (l.codigo_lote || '').toLowerCase() === codigo.toLowerCase())) return toast('Ya existe un lote con ese código.', 'error');
    try {
      const r = await api().post('pos_reacond_lotes', { codigo_lote: codigo, proveedor_id: ssGet('ss-lt-prov') || null, fecha_compra: val('lt_fecha') || hoyYMD(), gastos_envio: parseFloat(val('lt_envio')) || 0, notas: val('lt_notas') || null, estado: 'Abierto', enviado_reacond: true, fecha_envio_reacond: nowISO(), creado_por: miId() || null });
      const nuevo = r && r[0]; toast(`Lote ${codigo} creado.`); cerrarModal('nxRcLoteM'); await loadAll(); if (nuevo && nuevo.id) abrirLoteReacond(nuevo.id); else rerenderPOS();
    } catch (e) { logError('Crear lote', e); toastError(friendly(e)); }
  }
  async function abrirModalLoteDesdeCompra() {
    if (!isAdminUser()) return toast('Solo el administrador.', 'error');
    let compras = []; try { compras = await api().get('pos_compras', 'select=id,numero,fecha,proveedor_nombre,total,estado,gastos_total&order=fecha.desc,numero.desc&limit=200') || []; } catch (e) { return toastError(friendly(e)); }
    const usadas = new Set(cache.lotes.map(l => l.compra_id).filter(Boolean));
    const items = compras.filter(c => !usadas.has(c.id)).map(c => ({ id: c.id, label: `Compra #${c.numero || ''} · ${c.proveedor_nombre || 'Sin proveedor'}`, sub: `${fechaDO(c.fecha)} · ${money(c.total)}`, search: `${c.numero} ${c.proveedor_nombre || ''} ${c.fecha || ''}`.toLowerCase() }));
    abrirModal('nxRcLoteCM', cabecera('ti-truck-delivery', 'Crear lote desde una compra', 'nxRcLoteCM') + cuerpo(`
      <p class="nxRcMuted" style="font-size:12.5px;margin:0">Se crea un equipo por cada <b>IMEI</b> registrado en la compra (artículos con serial), con el costo unitario de la compra. Esos IMEI quedan <b>apartados para el taller</b> hasta que se despachen.</p>
      ${items.length ? `<div class="nxRcFld"><label>Compra *</label>${smartSelect('ss-lt-compra', items, '🔍 Número o proveedor…', '')}</div>` : '<div style="background:#fef3c7;border:1px solid #fcd34d;padding:10px;border-radius:8px;font-size:12px;color:#92400e">No hay compras disponibles (o todas ya tienen lote). Registra primero la compra en <b>Compras</b>.</div>'}
      <div class="nxRcG2"><div class="nxRcFld"><label>Código del lote</label><input id="ltc_codigo" class="nxRcInput" placeholder="Automático: C + nº de compra"></div><div class="nxRcFld"><label>Gastos de envío / courier (RD$)</label><input id="ltc_envio" type="number" class="nxRcInput" step="any" min="0" value="0"></div></div>`) +
      pie(`<button type="button" class="btn nxRcBtn light" onclick="window.nxRc.cerrar('nxRcLoteCM')">Cancelar</button>${items.length ? `<button type="button" class="btn nxRcBtn gold" onclick="window.nxRc.guardarLoteDesdeCompra(this)"><i class="ti ti-check"></i> Crear lote</button>` : ''}`), 520);
  }
  async function guardarLoteDesdeCompra(btn) {
    const compraId = ssGet('ss-lt-compra'); if (!compraId) return toast('Selecciona la compra.', 'error');
    const orig = btn ? btn.innerHTML : ''; if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader nxRcSpin"></i> Creando…'; }
    try {
      const r = await api().post('rpc/pos_reacond_lote_desde_compra', { p_compra_id: compraId, p_codigo: val('ltc_codigo') || null, p_gastos_envio: parseFloat(val('ltc_envio')) || 0, p_notas: null });
      if (!r || !r.equipos) { toast('La compra no tiene artículos con IMEI. El lote se creó vacío: agrega los equipos a mano.', 'error'); } else toast(`Lote ${r.codigo} creado con ${r.equipos} equipo(s).`);
      cerrarModal('nxRcLoteCM'); await loadAll(); if (r && r.lote_id) abrirLoteReacond(r.lote_id); else rerenderPOS();
    } catch (e) { logError('lote desde compra', e); toastError(friendly(e)); } finally { if (btn) { btn.disabled = false; btn.innerHTML = orig; } }
  }
  function abrirModalDatosLote() {
    const l = lote(I.reacondLoteAbiertoId); if (!l || !isAdminUser()) return;
    const eqs = cache.refurb.filter(r => r.lote_id === l.id).length;
    abrirModal('nxRcLoteEM', cabecera('ti-edit', 'Datos del lote', 'nxRcLoteEM') + cuerpo(`
      <div class="nxRcG2"><div class="nxRcFld"><label>Código del lote *</label><input id="lte_codigo" class="nxRcInput" value="${esc(l.codigo_lote || '')}" style="font-weight:700"></div><div class="nxRcFld"><label>Fecha de compra</label><input id="lte_fecha" type="date" class="nxRcInput" value="${esc(l.fecha_compra || '')}"></div></div>
      <div class="nxRcFld"><label>Proveedor</label>${smartSelect('ss-lte-prov', provItems(), '🔍 Buscar proveedor…', l.proveedor_id || '')}</div>
      <div class="nxRcG2"><div class="nxRcFld"><label>Gastos de envío / courier (RD$)</label><input id="lte_envio" type="number" class="nxRcInput" step="any" min="0" value="${Number(l.gastos_envio) || 0}"></div><div class="nxRcFld"><label>Estado</label><select id="lte_estado" class="nxRcInput">${['Abierto', 'En proceso', 'Cerrado'].map(s => `<option ${l.estado === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div></div>
      <div class="nxRcFld"><label>Notas</label><textarea id="lte_notas" class="nxRcInput" rows="2">${esc(l.notas || '')}</textarea></div>
      <div class="nxRcMuted" style="font-size:11.5px">${eqs} equipo(s) en el lote${l.compra_id ? ' · creado desde una compra' : ''}.</div>`) +
      pie(`<button type="button" class="btn nxRcBtn light" style="color:#b91c1c;margin-right:auto" onclick="window.nxRc.eliminarLote('${l.id}')"><i class="ti ti-trash"></i> Eliminar lote</button><button type="button" class="btn nxRcBtn light" onclick="window.nxRc.cerrar('nxRcLoteEM')">Cancelar</button><button type="button" class="btn nxRcBtn gold" onclick="window.nxRc.guardarDatosLote('${l.id}')"><i class="ti ti-device-floppy"></i> Guardar</button>`), 520);
  }
  async function guardarDatosLote(loteId) {
    const codigo = val('lte_codigo'); if (!codigo) return toast('El código del lote no puede quedar vacío.', 'error');
    try { await api().patch('pos_reacond_lotes', 'id=eq.' + loteId, { codigo_lote: codigo, fecha_compra: val('lte_fecha') || null, proveedor_id: ssGet('ss-lte-prov') || null, gastos_envio: parseFloat(val('lte_envio')) || 0, estado: val('lte_estado') || 'Abierto', notas: val('lte_notas') || null }); toast('Datos del lote guardados.'); cerrarModal('nxRcLoteEM'); await loadAll(); refrescarLote(); } catch (e) { logError('Guardar lote', e); toastError(friendly(e)); }
  }
  async function editarGastosEnvioLote() {
    if (!isAdminUser()) return toast('Solo el administrador.', 'error'); const l = lote(I.reacondLoteAbiertoId); if (!l) return;
    const v = await pedirTexto('Gastos de envío del lote (courier).\n\nSe repartirá proporcional al costo de compra de cada equipo.\n\nMonto total:', { valor: String(Number(l.gastos_envio) || 0), tipo: 'number' }); if (v === null) return;
    const monto = parseFloat(String(v).replace(/[^0-9.]/g, '')) || 0;
    try { await api().patch('pos_reacond_lotes', 'id=eq.' + l.id, { gastos_envio: monto }); toast('Gastos de envío guardados: ' + money(monto)); await loadAll(); refrescarLote(); if (byId('nxRcFichaM')) { const eqAb = cache.refurb.find(r => byId('nxRcFichaM') && r.lote_id === l.id); } } catch (e) { logError('Editar gastos envío', e); toastError(friendly(e)); }
  }
  async function eliminarLote(loteId) {
    const l = lote(loteId); if (!l) return; const n = cache.refurb.filter(r => r.lote_id === loteId).length;
    if (!await confirmar(`¿Eliminar el lote ${l.codigo_lote}?${n ? `\n\n⚠️ Este lote tiene ${n} equipo(s) que también serán eliminados.` : ''}`)) return;
    try { await liberarSeriales(cache.refurb.filter(r => r.lote_id === loteId)); await api().del('pos_reacond_lotes', 'id=eq.' + loteId); toast('Lote eliminado.'); cerrarModal('nxRcLoteEM'); I.reacondLoteAbiertoId = null; await loadAll(); rerenderPOS(); } catch (e) { logError('Eliminar lote', e); toastError(friendly(e)); }
  }
  async function liberarSeriales(equipos) { for (const e of equipos) { if (e.serial_id && e.estado_evaluacion !== 'vendido') { try { await api().patch('pos_seriales', 'id=eq.' + e.serial_id + '&estado=eq.reservado', { estado: 'disponible' }); } catch (_) {} } } }
  const prodItems = async () => { await cargarProductos(); return cache.productos.filter(p => p.tipo !== 'servicio').map(p => ({ id: p.id, label: `${p.codigo ? p.codigo + ' · ' : ''}${p.nombre}`, sub: [p.marca, p.referencia ? 'Ref: ' + p.referencia : '', p.serial ? 'con IMEI' : 'sin IMEI', isAdminUser() && Number(p.costo) > 0 ? 'Costo ' + money(p.costo) : ''].filter(Boolean).join(' · '), search: [p.codigo, p.nombre, p.marca, p.referencia].filter(Boolean).join(' ').toLowerCase(), extra: { costo: Number(p.costo) || 0, codigo: p.codigo, nombre: p.nombre, marca: p.marca, referencia: p.referencia, serial: !!p.serial } })); };
  async function abrirModalAgregarEquipo() {
    if (!I.reacondLoteAbiertoId || !isAdminUser()) return; const l = lote(I.reacondLoteAbiertoId);
    const items = await prodItems();
    abrirModal('nxRcEqM', cabecera('ti-device-mobile-plus', 'Agregar equipo al lote ' + esc(l.codigo_lote || ''), 'nxRcEqM') + cuerpo(`
      <div class="nxRcFld"><label>Artículo del inventario (opcional, recomendado)</label>${smartSelect('ss-eq-articulo', items, '🔍 Código, nombre o marca…', '')}<small class="nxRcMuted" style="font-size:11px">Si lo eliges, al despachar el teléfono entra al inventario con su IMEI.</small></div>
      <div class="nxRcG2"><div class="nxRcFld"><label>Modelo *</label><input id="eq_modelo" class="nxRcInput" placeholder="Ej. iPhone 12 128GB"></div><div class="nxRcFld"><label>Marca</label><input id="eq_marca" class="nxRcInput" placeholder="Apple, Samsung…"></div></div>
      <div class="nxRcG2"><div class="nxRcFld"><label>IMEI / Serial *</label><input id="eq_imei" class="nxRcInput" placeholder="Escanea o escribe" inputmode="numeric" style="font-weight:700"></div><div class="nxRcFld"><label>Color</label><input id="eq_color" class="nxRcInput" placeholder="Ej. Negro, Azul, Dorado…"></div></div>
      <div class="nxRcG2"><div class="nxRcFld"><label>Capacidad</label><input id="eq_capacidad" class="nxRcInput" placeholder="128GB"></div><div class="nxRcFld"><label>Costo unidad (RD$) *</label><input id="eq_costo" type="number" class="nxRcInput" step="any" min="0" placeholder="0.00"></div></div>
      <div class="nxRcFld"><label>Notas</label><input id="eq_notas" class="nxRcInput" placeholder="Opcional"></div>
      <label class="nxRcChk"><input type="checkbox" id="eq_garantia"> <i class="ti ti-shield"></i> Es por garantía (permite repetir el mismo IMEI)</label>
      <div class="nxRcMuted" style="font-size:11.5px">Modo rápido: al guardar se conservan artículo, costo y color; solo se limpia el IMEI para escanear el siguiente.</div>`) +
      pie(`<button type="button" class="btn nxRcBtn light" onclick="window.nxRc.cerrar('nxRcEqM')">Cerrar</button><button type="button" class="btn nxRcBtn gold" onclick="window.nxRc.agregarEquipoAlLote()"><i class="ti ti-plus"></i> Agregar equipo</button>`), 560);
    const el = byId('ss-eq-articulo'); if (el) el.addEventListener('nxrc-change', ev => { const x = ev.detail && ev.detail.extra; if (!x) return; const set = (id, v) => { const e = byId(id); if (e && !e.value) e.value = v || ''; }; set('eq_modelo', x.nombre); set('eq_marca', x.marca); set('eq_capacidad', x.referencia); const c = byId('eq_costo'); if (c && (!c.value || Number(c.value) === 0) && x.costo > 0) c.value = x.costo; const im = byId('eq_imei'); if (im) im.focus(); });
    setTimeout(() => { const m = byId('eq_modelo'); if (m) m.focus(); }, 60);
  }
  async function agregarEquipoAlLote() {
    const loteId = I.reacondLoteAbiertoId; if (!loteId) return; const l = lote(loteId);
    const art = ssItem('ss-eq-articulo'); const modelo = val('eq_modelo') || (art && art.extra && art.extra.nombre) || ''; const imei = val('eq_imei'); const notas = val('eq_notas'); const esGarantia = !!(byId('eq_garantia') && byId('eq_garantia').checked);
    if (!modelo) return toast('Escribe el modelo o elige un artículo.', 'error'); if (!imei) return toast('Este equipo requiere IMEI / Serial.', 'error');
    if (!esGarantia) { const rep = cache.refurb.find(r => (r.imei || '').toLowerCase().trim() === imei.toLowerCase()); if (rep) { const lr = lote(rep.lote_id); return toast(`Ese IMEI (${imei}) ya está registrado en ${lr ? 'lote ' + (lr.codigo_lote || '') : 'otro lote'}. Si el equipo volvió por garantía, marca la casilla "Es por garantía".`, 'error'); } }
    const costo = parseFloat(val('eq_costo')) || 0; if (costo <= 0) return toast('Costo debe ser mayor a 0.', 'error');
    const color = val('eq_color');
    try {
      let serialId = null;
      if (art && art.extra && art.extra.serial) { try { const s = await api().get('pos_seriales', 'select=id,estado&producto_id=eq.' + art.id + '&serial=eq.' + encodeURIComponent(imei) + '&limit=1'); if (s && s[0]) { serialId = s[0].id; if (s[0].estado === 'disponible') await api().patch('pos_seriales', 'id=eq.' + serialId, { estado: 'reservado', notas: 'Taller reacondicionado ' + (l.codigo_lote || '') }); } } catch (_) {} }
      await api().post('pos_reacond_equipos', { lote_id: loteId, producto_id: art ? art.id : null, serial_id: serialId, articulo_codigo: (art && art.extra && art.extra.codigo) || null, modelo, marca: val('eq_marca') || (art && art.extra && art.extra.marca) || null, capacidad: val('eq_capacidad') || null, color: color || null, imei, costo_compra: costo, costo_repuestos: 0, estado_evaluacion: 'pendiente', es_garantia: esGarantia, proveedor_id: l.proveedor_id || null, fecha_compra: l.fecha_compra || hoyYMD(), notas_diagnostico: esGarantia ? 'GARANTÍA' + (notas ? ' · ' + notas : '') : (notas || null) });
      toast(`${esGarantia ? 'Equipo por garantía agregado' : 'Equipo agregado'}: ${modelo}${color ? ' · ' + color : ''}`);
      const g = byId('eq_garantia'); if (g) g.checked = false; ['eq_imei', 'eq_notas'].forEach(id => { const e = byId(id); if (e) e.value = ''; }); const im = byId('eq_imei'); if (im) im.focus();
      await loadAll(); const eqs = cache.refurb.filter(r => r.lote_id === loteId); try { await api().patch('pos_reacond_lotes', 'id=eq.' + loteId, { cantidad_equipos: eqs.length, costo_total_lote: Math.round(eqs.reduce((s, e) => s + (Number(e.costo_compra) || 0), 0) * 100) / 100 }); } catch (_) {}
      renderDetalleLoteReacond();
    } catch (e) { logError('Agregar equipo al lote', e); toastError(friendly(e)); }
  }
  function _editarEquipoLote(id) {
    const e = equipo(id); if (!e || !isAdminUser()) return; const notas = (e.notas_diagnostico || '').replace(/^GARANT[IÍ]A(\s*·\s*)?/i, '').trim();
    abrirModal('nxRcEqEM', cabecera('ti-edit', 'Corregir equipo', 'nxRcEqEM') + cuerpo(`
      <div class="nxRcG2"><div class="nxRcFld"><label>Modelo *</label><input id="editEq_modelo" class="nxRcInput" value="${esc(e.modelo || '')}"></div><div class="nxRcFld"><label>Marca</label><input id="editEq_marca" class="nxRcInput" value="${esc(e.marca || '')}"></div></div>
      <div class="nxRcG2"><div class="nxRcFld"><label>IMEI / Serial *</label><input id="editEq_imei" class="nxRcInput" value="${esc(e.imei || '')}"></div><div class="nxRcFld"><label>Color</label><input id="editEq_color" class="nxRcInput" value="${esc(e.color || '')}"></div></div>
      <div class="nxRcG2"><div class="nxRcFld"><label>Capacidad</label><input id="editEq_capacidad" class="nxRcInput" value="${esc(e.capacidad || '')}"></div><div class="nxRcFld"><label>Costo unidad (RD$) *</label><input id="editEq_costo" type="number" class="nxRcInput" step="any" value="${Number(e.costo_compra) || 0}"></div></div>
      <div class="nxRcFld"><label>Notas</label><input id="editEq_notas" class="nxRcInput" value="${esc(notas)}" placeholder="Opcional"></div>
      <label class="nxRcChk"><input type="checkbox" id="editEq_garantia" ${e.es_garantia ? 'checked' : ''}> <i class="ti ti-shield"></i> Es por garantía (permite repetir el mismo IMEI)</label>`) +
      pie(`<button type="button" class="btn nxRcBtn light" style="color:#b91c1c;margin-right:auto" onclick="window.nxRc.eliminarEquipo('${id}')"><i class="ti ti-trash"></i> Quitar del lote</button><button type="button" class="btn nxRcBtn light" onclick="window.nxRc.cerrar('nxRcEqEM')">Cancelar</button><button type="button" class="btn nxRcBtn gold" onclick="window.nxRc.guardarEdicionEquipo('${id}')"><i class="ti ti-device-floppy"></i> Guardar cambios</button>`), 480);
  }
  async function _guardarEdicionEquipoLote(id) {
    const e = equipo(id); if (!e) return; const imei = val('editEq_imei'); if (!imei) return toast('El IMEI / Serial es obligatorio.', 'error'); const esGar = !!(byId('editEq_garantia') && byId('editEq_garantia').checked);
    if (!esGar) { const rep = cache.refurb.find(r => r.id !== id && (r.imei || '').toLowerCase().trim() === imei.toLowerCase()); if (rep) return toast(`Ese IMEI (${imei}) ya está registrado en otro equipo. Si volvió por garantía, marca la casilla.`, 'error'); }
    const c = parseFloat(val('editEq_costo')) || 0; if (c <= 0) return toast('El costo debe ser mayor a 0.', 'error'); const notas = val('editEq_notas');
    try { await api().patch('pos_reacond_equipos', 'id=eq.' + id, { modelo: val('editEq_modelo') || e.modelo, marca: val('editEq_marca') || null, imei, color: val('editEq_color') || null, capacidad: val('editEq_capacidad') || null, costo_compra: c, es_garantia: esGar, notas_diagnostico: esGar ? ('GARANTÍA' + (notas ? ' · ' + notas : '')) : (notas || null) }); toast('Equipo corregido.'); cerrarModal('nxRcEqEM'); await loadAll(); refrescarLote(); } catch (err) { logError('editar equipo lote', err); toastError(friendly(err)); }
  }
  async function eliminarEquipoLote(equipoId) {
    const e = equipo(equipoId); if (!e) return; if (!await confirmar('¿Quitar este equipo del lote?')) return;
    try { await liberarSeriales([e]); await api().del('pos_reacond_equipos', 'id=eq.' + equipoId); toast('Equipo eliminado.'); cerrarModal('nxRcEqEM'); await loadAll(); refrescarLote(); } catch (err) { logError('Eliminar equipo', err); toastError(friendly(err)); }
  }
  async function abrirModalRegistrarExistente() {
    if (!isAdminUser()) return toast('Solo el administrador puede registrar equipos existentes.', 'error');
    const items = await prodItems();
    abrirModal('nxRcRexM', cabecera('ti-archive', 'Registrar equipo existente', 'nxRcRexM') + cuerpo(`
      <p class="nxRcMuted" style="font-size:12px;margin:0">Para equipos que ya tenías <b>antes del sistema</b>. Cae directo en su estado real y asignado a su técnico. Quedan en el lote <b>HISTÓRICO</b>.</p>
      <div class="nxRcFld"><label>Artículo del inventario (opcional)</label>${smartSelect('ss-rex-modelo', items, '🔍 Código, nombre o marca…', '')}</div>
      <div class="nxRcG2"><div class="nxRcFld"><label>Modelo *</label><input id="rex_modelo" class="nxRcInput"></div><div class="nxRcFld"><label>Costo de compra (opcional)</label><input id="rex_costo" type="number" class="nxRcInput" step="any" min="0" placeholder="0.00"></div></div>
      <div class="nxRcG2"><div class="nxRcFld"><label>IMEI *</label><input id="rex_imei" class="nxRcInput" placeholder="IMEI"></div><div class="nxRcFld"><label>Serial</label><input id="rex_serial" class="nxRcInput" placeholder="Serial / opcional"></div></div>
      <div class="nxRcFld"><label>Técnico que lo tiene *</label>${smartSelect('ss-rex-tecnico', tecItems(), '🔍 Buscar técnico…', '')}</div>
      <div class="nxRcFld"><label>Estado actual *</label><select id="rex_estado" class="nxRcInput"><option value="en_proceso">🔧 En Proceso</option><option value="espera_pieza">⏳ Espera pieza</option><option value="listo_revision">👍 Finalizado (por recibir)</option><option value="listo_venta">🛒 Listo para venta</option><option value="pendiente">🟡 Pendiente (sin empezar)</option></select></div>
      <div class="nxRcFld"><label>Nota (opcional)</label><textarea id="rex_nota" class="nxRcInput" rows="2" placeholder="Detalle de en qué punto va, falla, etc."></textarea></div>`) +
      pie(`<button type="button" class="btn nxRcBtn light" onclick="window.nxRc.cerrar('nxRcRexM')">Cancelar</button><button type="button" class="btn nxRcBtn gold" onclick="window.nxRc.guardarEquipoExistente(this)"><i class="ti ti-device-floppy"></i> Registrar equipo</button>`), 560);
    const el = byId('ss-rex-modelo'); if (el) el.addEventListener('nxrc-change', ev => { const x = ev.detail && ev.detail.extra; if (!x) return; const m = byId('rex_modelo'); if (m && !m.value) m.value = x.nombre || ''; const c = byId('rex_costo'); if (c && !c.value && x.costo > 0) c.value = x.costo; });
  }
  async function guardarEquipoExistente(btn) {
    const modelo = val('rex_modelo'), imei = val('rex_imei'), tecnicoId = ssGet('ss-rex-tecnico'), estado = val('rex_estado') || 'en_proceso'; const art = ssItem('ss-rex-modelo');
    if (!modelo) return toast('Escribe el modelo.', 'error'); if (!imei) return toast('El IMEI es obligatorio.', 'error'); if (!tecnicoId && estado !== 'pendiente') return toast('Selecciona el técnico.', 'error');
    const orig = btn ? btn.innerHTML : ''; if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader nxRcSpin"></i> Guardando…'; }
    try {
      let hist = cache.lotes.find(l => l.codigo_lote === 'HISTORICO'); let loteId = hist && hist.id;
      if (!loteId) { const r = await api().post('pos_reacond_lotes', { codigo_lote: 'HISTORICO', notas: 'Equipos que ya existían antes del sistema', estado: 'En proceso', enviado_reacond: true, fecha_envio_reacond: nowISO(), creado_por: miId() || null }); loteId = r && r[0] && r[0].id; }
      const r2 = await api().post('pos_reacond_equipos', { lote_id: loteId, producto_id: art ? art.id : null, articulo_codigo: (art && art.extra && art.extra.codigo) || null, modelo, marca: (art && art.extra && art.extra.marca) || null, capacidad: (art && art.extra && art.extra.referencia) || null, imei, serial: val('rex_serial') || null, costo_compra: parseFloat(val('rex_costo')) || 0, estado_evaluacion: estado, tecnico_asignado_id: tecnicoId || null, fecha_asignacion: tecnicoId ? nowISO() : null, notas_diagnostico: val('rex_nota') || null });
      const nuevo = r2 && r2[0]; if (nuevo) await historial(nuevo.id, null, estado, 'Registrado como equipo existente (histórico)', val('rex_nota') || null);
      toast('Equipo registrado en el lote HISTÓRICO.'); cerrarModal('nxRcRexM'); await loadAll(); rerenderPOS();
    } catch (e) { logError('registrar existente', e); toastError(friendly(e)); } finally { if (btn) { btn.disabled = false; btn.innerHTML = orig; } }
  }

  // ═══════════════ REPORTE DE COSTOS DEL LOTE (imprimir / Excel) ═══════════════
  function _datosReporteCostosLote(soloSel) {
    if (!isAdminUser()) { toast('Solo el administrador.', 'error'); return null; } if (!I.reacondLoteAbiertoId) { toast('Abre un lote primero.', 'error'); return null; }
    const l = lote(I.reacondLoteAbiertoId); let equipos = cache.refurb.filter(r => r.lote_id === l.id); const filtrosTxt = [];
    if (soloSel) { equipos = equipos.filter(e => I._reacondSelCosto.has(e.id)); filtrosTxt.push('Selección: ' + equipos.length); }
    else {
      if (I._reacondFiltroTec) { equipos = equipos.filter(e => e.tecnico_asignado_id === I._reacondFiltroTec); filtrosTxt.push('Técnico: ' + nombreEmpleado(I._reacondFiltroTec)); }
      if (_filtros.estado) { equipos = equipos.filter(e => _reacondEquipoPasaEstado(e, _filtros.estado)); filtrosTxt.push('Estado: ' + ({ recibido: 'Recibido', diagnostico: 'Diagnóstico', reparacion: 'En reparación', control_calidad: 'Control de calidad', listo_venta: 'Listo para venta', despachado: 'Despachado' }[_filtros.estado] || _filtros.estado)); }
      const ql = _filtros.busq.toLowerCase().trim(); if (ql) { equipos = equipos.filter(e => [e.imei, e.articulo_codigo, e.modelo, e.marca].filter(Boolean).join(' ').toLowerCase().includes(ql)); filtrosTxt.push('Búsqueda: "' + ql + '"'); }
    }
    if (!equipos.length) { toast('No hay equipos para el reporte (revisa los filtros).', 'error'); return null; }
    return { lote: l, equipos, prov: prov(l.proveedor_id), filtrosTxt };
  }
  function _filasCostos(equipos) { let tot = { compra: 0, flete: 0, piezas: 0, fin: 0 }; const filas = equipos.map((e, i) => { const c = _costoEquipoRep(e); tot.compra += c.compra; tot.flete += c.flete; tot.piezas += c.piezas; tot.fin += c.fin; return { n: i + 1, modelo: _modeloRep(e), imei: e.imei || '', estado: obtenerEtiquetaEstado(e.estado_evaluacion).text, tec: e.tecnico_asignado_id ? nombreEmpleado(e.tecnico_asignado_id) : '', ...c }; }); return { filas, tot }; }
  function imprimirReporteCostosLote(soloSel) {
    const d = _datosReporteCostosLote(soloSel); if (!d) return; const { filas, tot } = _filasCostos(d.equipos); const concl = _loteConcluido(d.lote.id);
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Costos lote ${esc(d.lote.codigo_lote || '')}</title><style>body{font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#111;margin:18px}h1{font-size:18px;margin:0 0 4px}h2{font-size:13px;margin:0 0 12px;color:#555;font-weight:normal}.chips span{display:inline-block;border:1px solid #ccc;border-radius:999px;padding:3px 10px;margin:2px 4px 8px 0;font-size:11px}table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid #ddd;padding:6px 8px;text-align:left;font-size:11.5px}th{background:#f3f0e8;font-size:10px;text-transform:uppercase}td.n,th.n{text-align:right;white-space:nowrap}tfoot td{font-weight:bold;background:#faf8f2}@media print{body{margin:8mm}}</style></head><body>
      <h1>${concl ? 'Informe general' : 'Reporte de costos'} — Lote ${esc(d.lote.codigo_lote || '')}</h1><h2>STUDIO · Reacondicionado · ${esc(fechaHoraDO(new Date()))}</h2>
      <div class="chips"><span><b>Proveedor:</b> ${esc(d.prov ? d.prov.nombre : 'Sin proveedor')}</span><span><b>Compra:</b> ${fechaDO(d.lote.fecha_compra)}</span><span><b>Envío total:</b> ${money(Number(d.lote.gastos_envio) || 0)}</span>${concl ? '<span><b>Estado:</b> Lote concluido</span>' : ''}${d.filtrosTxt.length ? `<span><b>Filtro:</b> ${esc(d.filtrosTxt.join(' · '))}</span>` : ''}</div>
      <table><thead><tr><th>#</th><th>Modelo</th><th>IMEI</th><th>Estado</th><th>Técnico</th><th class="n">Compra</th><th class="n">Envío</th><th class="n">Piezas</th><th class="n">Costo final</th></tr></thead>
      <tbody>${filas.map(f => `<tr><td>${f.n}</td><td>${esc(f.modelo)}</td><td>${esc(f.imei)}</td><td>${esc(f.estado)}</td><td>${esc(f.tec)}</td><td class="n">${money(f.compra)}</td><td class="n">${money(f.flete)}</td><td class="n">${money(f.piezas)}</td><td class="n">${money(f.fin)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="5">TOTAL (${filas.length} equipos)</td><td class="n">${money(tot.compra)}</td><td class="n">${money(tot.flete)}</td><td class="n">${money(tot.piezas)}</td><td class="n">${money(tot.fin)}</td></tr></tfoot></table>
      <script>window.onload=function(){window.print()}<\/script></body></html>`;
    const win = window.open('', '_blank'); if (!win) return toast('El navegador bloqueó la ventana de impresión.', 'error'); win.document.write(html); win.document.close();
  }
  function exportarReporteCostosLoteExcel() {
    const d = _datosReporteCostosLote(false); if (!d) return; const { filas, tot } = _filasCostos(d.equipos);
    const csv = ['Lote;' + (d.lote.codigo_lote || ''), 'Proveedor;' + (d.prov ? d.prov.nombre : ''), 'Envío total;' + (Number(d.lote.gastos_envio) || 0).toFixed(2), '', '#;Modelo;IMEI;Estado;Técnico;Compra;Envío;Piezas;Costo final']
      .concat(filas.map(f => [f.n, f.modelo, f.imei, f.estado, f.tec, f.compra.toFixed(2), f.flete.toFixed(2), f.piezas.toFixed(2), f.fin.toFixed(2)].map(x => String(x).replace(/;/g, ',')).join(';')))
      .concat(['TOTAL;;;;;' + tot.compra.toFixed(2) + ';' + tot.flete.toFixed(2) + ';' + tot.piezas.toFixed(2) + ';' + tot.fin.toFixed(2)]).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `Costos_${(d.lote.codigo_lote || 'lote').replace(/[^A-Za-z0-9_-]/g, '')}_${hoyYMD()}.csv`; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    toast('Archivo exportado (se abre en Excel).');
  }

  // ═══════════════ CATÁLOGO DE FALLAS ═══════════════
  function htmlCatalogo() {
    return `<div id="reacondMainContentCatalogo"><div class="nxRcCard">
      <div class="nxRcRow" style="margin-bottom:14px"><h3 class="nxRcH3"><i class="ti ti-list-details"></i> Catálogo de Fallas</h3><div class="nxRcActs">${isAdminUser() ? `<button type="button" class="btn nxRcBtn light" onclick="window.nxRc.abrirModalCategoria()"><i class="ti ti-category"></i> Nueva categoría</button><button type="button" class="btn nxRcBtn gold" onclick="window.nxRc.abrirModalFalla()"><i class="ti ti-plus"></i> Nueva Falla</button>` : ''}</div></div>
      <div style="background:#dbeafe;border:1px solid #93c5fd;padding:10px;border-radius:8px;margin-bottom:14px;font-size:12px;color:#1e3a8a"><b><i class="ti ti-info-circle"></i> Estas fallas se usarán en la evaluación.</b> Cada una tiene un nombre completo y uno corto para imprimir en el label.</div>
      <div class="nxRcSearch" style="margin-bottom:14px"><i class="ti ti-search"></i><input type="text" id="fallasBuscador" class="nxRcInput" placeholder="Buscar falla..." value="${esc(_filtros.fallasBusq)}" oninput="window.nxRc.fallasBusq(this.value)"></div>
      <div id="fallasContainer"></div></div></div>`;
  }
  function renderCatalogoFallas() {
    const cont = byId('fallasContainer'); if (!cont) return; const q = _filtros.fallasBusq.toLowerCase().trim();
    const cats = cache.fallaCategorias; const fallas = q ? cache.fallas.filter(f => (f.nombre || '').toLowerCase().includes(q) || (f.nombre_corto || '').toLowerCase().includes(q)) : cache.fallas;
    const porCat = {}; fallas.forEach(f => { const k = f.categoria_id || 'sin'; (porCat[k] = porCat[k] || []).push(f); });
    if (!fallas.length && !cats.length) { cont.innerHTML = `<p class="nxRcMuted" style="text-align:center;padding:30px">No hay fallas registradas. Crea la primera con "+ Nueva Falla".</p>`; return; }
    if (!fallas.length) { cont.innerHTML = `<p class="nxRcMuted" style="text-align:center;padding:30px">${q ? `No hay fallas que coincidan con "${esc(q)}"` : 'No hay fallas registradas. Crea la primera con "+ Nueva Falla".'}</p>`; return; }
    const admin = isAdminUser();
    const item = f => `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;border-bottom:1px solid #f1efe8;gap:8px"><div style="flex:1;min-width:0"><div style="font-size:13px;${f.activa === false ? 'text-decoration:line-through;color:#85817a' : ''}">${esc(f.nombre)}</div><div style="font-size:10px;color:#806515;font-weight:700;margin-top:2px">${esc(f.nombre_corto || '')}</div></div>${admin ? `<div style="display:flex;gap:4px;flex-shrink:0"><button type="button" class="nxRcMini" style="background:#dbeafe;color:#1d4ed8;border-color:#93c5fd" onclick="window.nxRc.editarFalla('${f.id}')" title="Editar"><i class="ti ti-edit"></i></button><button type="button" class="nxRcMini" style="background:#fee2e2;color:#991b1b;border-color:#fecaca" onclick="window.nxRc.eliminarFalla('${f.id}')" title="Eliminar"><i class="ti ti-trash"></i></button></div>` : ''}</div>`;
    let html = '';
    cats.forEach(cat => { const lista = porCat[cat.id] || []; if (!lista.length && q) return; html += `<div style="margin-bottom:20px"><div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:${cat.color}15;border-left:4px solid ${cat.color};border-radius:6px;margin-bottom:8px"><i class="ti ${esc(cat.icono)}" style="color:${cat.color};font-size:18px"></i><b style="color:${cat.color};font-size:14px;text-transform:uppercase">${esc(cat.nombre)}</b>${cat.activa === false ? badge('INACTIVA', '#f1f5f9', '#475569', 'font-size:9px') : ''}<span style="background:${cat.color};color:#fff;padding:2px 8px;border-radius:10px;font-size:11px;margin-left:auto">${lista.length}</span>${admin ? `<button type="button" class="nxRcMini" style="background:#fff;color:#5b5951;border-color:#cbd5e1" onclick="window.nxRc.editarCategoria('${cat.id}')" title="Editar categoría"><i class="ti ti-edit"></i></button>` : ''}</div><div style="padding-left:8px">${lista.map(item).join('') || '<div class="nxRcMuted" style="font-size:12px;padding:4px 10px">Sin fallas en esta categoría.</div>'}</div></div>`; });
    if (porCat.sin) html += `<div style="margin-bottom:20px"><div style="padding:8px 12px;background:#f1f5f9;border-radius:6px;margin-bottom:8px"><b style="color:#475569;font-size:14px">SIN CATEGORÍA</b></div>${porCat.sin.map(item).join('')}</div>`;
    cont.innerHTML = html;
  }
  function abrirModalFalla(id) {
    const f = id ? cache.fallas.find(x => x.id === id) : null;
    abrirModal('nxRcFallaM', cabecera('ti-alert-triangle', f ? 'Editar Falla' : 'Nueva Falla', 'nxRcFallaM') + cuerpo(`
      <div class="nxRcFld"><label>Categoría *</label><select id="mod_falla_categoria" class="nxRcInput"><option value="">-- Seleccionar categoría --</option>${cache.fallaCategorias.filter(c => c.activa !== false).map(c => `<option value="${c.id}" ${f && c.id === f.categoria_id ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('')}</select></div>
      <div class="nxRcFld"><label>Nombre completo de la falla *</label><input id="mod_falla_nombre" class="nxRcInput" value="${esc(f ? f.nombre : '')}" placeholder="Ej. Pantalla rayada en esquina superior"><small class="nxRcMuted" style="font-size:11px">Nombre que verás en la evaluación.</small></div>
      <div class="nxRcFld"><label>Nombre corto para label *</label><input id="mod_falla_corto" class="nxRcInput" value="${esc(f ? f.nombre_corto || '' : '')}" placeholder="Ej. PANT RAYADA" maxlength="40" style="text-transform:uppercase"><small class="nxRcMuted" style="font-size:11px">Texto corto que sale impreso en el label adhesivo. Máximo 40 caracteres.</small></div>
      <div class="nxRcFld"><label>Descripción (opcional)</label><textarea id="mod_falla_desc" class="nxRcInput" rows="2" placeholder="Detalles adicionales...">${esc(f ? f.descripcion || '' : '')}</textarea></div>
      <label class="nxRcChk"><input type="checkbox" id="mod_falla_activa" ${!f || f.activa !== false ? 'checked' : ''}> Falla activa (disponible para usar)</label>`) +
      pie(`<button type="button" class="btn nxRcBtn light" onclick="window.nxRc.cerrar('nxRcFallaM')">Cancelar</button><button type="button" class="btn nxRcBtn gold" onclick="window.nxRc.guardarFalla('${f ? f.id : ''}')"><i class="ti ti-check"></i> Guardar</button>`), 480);
  }
  async function guardarFalla(id) {
    const datos = { categoria_id: val('mod_falla_categoria') || null, nombre: val('mod_falla_nombre'), nombre_corto: val('mod_falla_corto').toUpperCase(), descripcion: val('mod_falla_desc') || null, activa: !!(byId('mod_falla_activa') && byId('mod_falla_activa').checked) };
    if (!datos.nombre) return toast('El nombre completo es obligatorio.', 'error'); if (!datos.nombre_corto) return toast('El nombre corto para label es obligatorio.', 'error'); if (datos.nombre_corto.length > 40) return toast('El nombre corto debe tener máximo 40 caracteres.', 'error');
    try { if (id) { await api().patch('pos_reacond_fallas', 'id=eq.' + id, datos); toast('✅ Falla actualizada.'); } else { await api().post('pos_reacond_fallas', datos); toast('✅ Falla creada.'); } cerrarModal('nxRcFallaM'); await loadAll(); renderCatalogoFallas(); } catch (e) { logError('Guardar falla', e); toastError(friendly(e)); }
  }
  async function eliminarFalla(id) { const f = cache.fallas.find(x => x.id === id); if (!f) return; if (!await confirmar(`¿Eliminar la falla "${f.nombre}"?\n\nEsta acción no se puede deshacer.`)) return; try { await api().del('pos_reacond_fallas', 'id=eq.' + id); toast('🗑️ Falla eliminada.'); await loadAll(); renderCatalogoFallas(); } catch (e) { logError('Eliminar falla', e); toastError(friendly(e)); } }
  function abrirModalCategoria(id) {
    const c = id ? cache.fallaCategorias.find(x => x.id === id) : null;
    abrirModal('nxRcCatM', cabecera('ti-category', c ? 'Editar Categoría' : 'Nueva Categoría', 'nxRcCatM') + cuerpo(`
      <div class="nxRcFld"><label>Nombre *</label><input id="mod_cat_nombre" class="nxRcInput" value="${esc(c ? c.nombre : '')}" placeholder="Ej. Pantalla"></div>
      <div class="nxRcG2"><div class="nxRcFld"><label>Color</label><input id="mod_cat_color" type="color" class="nxRcInput" value="${esc(c ? c.color : '#c9a227')}" style="padding:2px 6px"></div><div class="nxRcFld"><label>Icono (Tabler)</label><input id="mod_cat_icono" class="nxRcInput" value="${esc(c ? c.icono : 'ti-circle')}" placeholder="ti-device-mobile"></div></div>
      <div class="nxRcG2"><div class="nxRcFld"><label>Orden</label><input id="mod_cat_orden" type="number" class="nxRcInput" value="${c ? c.orden : cache.fallaCategorias.length + 1}"></div><div class="nxRcFld" style="justify-content:flex-end"><label class="nxRcChk"><input type="checkbox" id="mod_cat_activa" ${!c || c.activa !== false ? 'checked' : ''}> Activa</label></div></div>`) +
      pie(`${c ? `<button type="button" class="btn nxRcBtn light" style="color:#b91c1c;margin-right:auto" onclick="window.nxRc.eliminarCategoria('${c.id}')"><i class="ti ti-trash"></i> Eliminar</button>` : ''}<button type="button" class="btn nxRcBtn light" onclick="window.nxRc.cerrar('nxRcCatM')">Cancelar</button><button type="button" class="btn nxRcBtn gold" onclick="window.nxRc.guardarCategoria('${c ? c.id : ''}')"><i class="ti ti-check"></i> Guardar</button>`), 440);
  }
  async function guardarCategoria(id) {
    const datos = { nombre: val('mod_cat_nombre'), color: val('mod_cat_color') || '#c9a227', icono: val('mod_cat_icono') || 'ti-circle', orden: parseInt(val('mod_cat_orden')) || 0, activa: !!(byId('mod_cat_activa') && byId('mod_cat_activa').checked) };
    if (!datos.nombre) return toast('El nombre es obligatorio.', 'error');
    try { if (id) await api().patch('pos_reacond_falla_categorias', 'id=eq.' + id, datos); else await api().post('pos_reacond_falla_categorias', datos); toast(id ? '✅ Categoría actualizada.' : '✅ Categoría creada.'); cerrarModal('nxRcCatM'); await loadAll(); renderCatalogoFallas(); } catch (e) { logError('Guardar categoría', e); toastError(friendly(e)); }
  }
  async function eliminarCategoria(id) { const c = cache.fallaCategorias.find(x => x.id === id); if (!c) return; if (!await confirmar(`¿Eliminar la categoría "${c.nombre}"? Sus fallas quedarán sin categoría.`)) return; try { await api().del('pos_reacond_falla_categorias', 'id=eq.' + id); toast('🗑️ Categoría eliminada.'); cerrarModal('nxRcCatM'); await loadAll(); renderCatalogoFallas(); } catch (e) { logError('Eliminar categoría', e); toastError(friendly(e)); } }

  // ═══════════════ DEVOLUCIONES ═══════════════
  function htmlDevoluciones() {
    return `<div id="reacondMainContentDevoluciones"><div class="nxRcCard">
      <div class="nxRcRow" style="margin-bottom:14px"><h3 class="nxRcH3"><i class="ti ti-rotate-2" style="color:#dc2626"></i> Devoluciones de Equipos</h3><button type="button" class="btn nxRcBtn danger" onclick="window.nxRc.abrirNuevaDevolucion()"><i class="ti ti-plus"></i> Registrar Devolución</button></div>
      <div style="background:#fef2f2;border:1px solid #fecaca;padding:12px;border-radius:8px;margin-bottom:14px;font-size:12px;color:#991b1b"><b><i class="ti ti-info-circle"></i> Aquí registras equipos que el cliente devolvió.</b> El sistema detecta automáticamente el historial completo y devuelve el equipo al flujo de reparación.</div>
      <div id="devolucionesLista"><p class="nxRcMuted" style="text-align:center;padding:30px;font-size:13px">Cargando devoluciones...</p></div><div id="devolucionesPagination"></div></div></div>`;
  }
  async function cargarDevoluciones() {
    const cont = byId('devolucionesLista'); if (!cont) return;
    try { I._devolucionesCache = await api().get('pos_reacond_devoluciones', 'select=*&order=fecha_devolucion.desc&limit=2000') || []; renderDevoluciones(); } catch (e) { logError('Cargar devoluciones', e); cont.innerHTML = `<p style="color:#dc2626;text-align:center;padding:20px">Error al cargar: ${esc(friendly(e))}</p>`; }
  }
  function renderDevoluciones() {
    const cont = byId('devolucionesLista'); if (!cont) return; const lista = I._devolucionesCache;
    if (!lista.length) { cont.innerHTML = '<p class="nxRcMuted" style="text-align:center;padding:30px;font-size:13px">No hay devoluciones registradas. Cuando un cliente devuelva un equipo, regístralo aquí.</p>'; return; }
    const p = _uiListPage('devoluciones', lista.length);
    cont.innerHTML = lista.slice(p.start, p.start + UI_LIST_PAGE_SIZE).map(d => { const eq = equipo(d.equipo_id); const et = obtenerEtiquetaEstado(eq ? eq.estado_evaluacion || 'pendiente' : 'desconocido'); return `<div class="pieza-card" style="border-left:4px solid #dc2626"><div class="nxRcRow" style="align-items:flex-start"><div style="flex:1;min-width:200px"><div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><i class="ti ti-rotate-2" style="color:#dc2626;font-size:18px"></i><b style="font-size:14px">${esc(eq ? eq.modelo : 'Equipo desconocido')}</b>${d.ciclo > 1 ? badge('DEVUELTO ' + (d.ciclo - 1) + '× ANTES', '#fee2e2', '#991b1b', 'font-size:10px') : ''}${badge(et.text, et.bg, et.color, 'font-size:10px')}</div><div class="nxRcMuted" style="font-size:11px;margin-top:4px"><i class="ti ti-barcode"></i> IMEI: ${esc(eq ? eq.imei || '—' : '—')} · <i class="ti ti-calendar"></i> ${esc(fechaHoraDO(d.fecha_devolucion))}${d.ciclo > 1 ? ' · Ciclo ' + d.ciclo : ''}${d.cliente_que_devolvio ? ` · <i class="ti ti-user"></i> ${esc(d.cliente_que_devolvio)}` : ''}</div><div style="background:#fef2f2;padding:8px 10px;border-radius:6px;margin-top:8px;font-size:12px"><b style="color:#991b1b">Motivo:</b> ${esc(d.motivo_devolucion)}</div>${d.problemas_reportados ? `<div style="background:#fef3c7;padding:6px 10px;border-radius:6px;margin-top:4px;font-size:11px"><b style="color:#92400e">Problemas:</b> ${esc(d.problemas_reportados)}</div>` : ''}${d.diagnostico_inicial ? `<div style="background:#f1f5f9;padding:6px 10px;border-radius:6px;margin-top:4px;font-size:11px"><b>Diagnóstico:</b> ${esc(d.diagnostico_inicial)}</div>` : ''}</div>${eq ? `<button type="button" class="btn nxRcBtn dark" onclick="window.nxRc.abrirPanelProceso('${eq.id}')"><i class="ti ti-tool"></i> Trabajar</button>` : ''}</div></div>`; }).join('');
    const pg = byId('devolucionesPagination'); if (pg) pg.innerHTML = _uiListPager('devoluciones', lista.length, 'devoluciones'); _uiListRenderers.devoluciones = renderDevoluciones;
  }
  function abrirModalNuevaDevolucion() {
    const desp = cache.refurb.filter(r => r.estado_evaluacion === 'vendido'); if (!desp.length) return toast('No hay equipos terminados aún. Primero debes tener equipos en estado "Despachado" para poder registrar devoluciones.', 'error');
    const items = desp.map(eq => ({ id: eq.id, label: `${eq.modelo || 'Equipo'} · IMEI: ${eq.imei || '—'}`, sub: [eq.marca, eq.capacidad, eq.veces_devuelto > 0 ? `Devuelto ${eq.veces_devuelto}×` : null].filter(Boolean).join(' · '), search: [eq.modelo, eq.imei, eq.marca, eq.capacidad].filter(Boolean).join(' ').toLowerCase(), meta: eq.veces_devuelto > 0 ? eq.veces_devuelto + '×' : '' }));
    abrirModal('nxRcDevM', cabecera('ti-rotate-2', 'Registrar Devolución', 'nxRcDevM') + cuerpo(`
      <h4 class="nxRcH4" style="color:#dc2626;text-transform:uppercase;font-size:12px"><i class="ti ti-search"></i> 1. Buscar equipo despachado</h4>
      <div class="nxRcFld"><label>Selecciona el equipo que el cliente devolvió</label>${smartSelect('ss-dev-equipo', items, '🔍 Buscar por IMEI, modelo o marca...', '')}<small class="nxRcMuted" style="font-size:11px">Busca por IMEI, modelo o cliente.</small></div>
      <div id="devInfoEquipo" style="display:none"></div>
      <div id="devCamposExtras" style="display:none;flex-direction:column;gap:12px">
        <h4 class="nxRcH4" style="color:#dc2626;text-transform:uppercase;font-size:12px"><i class="ti ti-message"></i> 2. Motivo de la devolución</h4>
        <div class="nxRcFld"><label>¿Por qué devolvió el cliente? *</label><textarea id="dev_motivo" class="nxRcInput" rows="2" placeholder="Ej. El equipo se apaga solo, no carga, etc."></textarea></div>
        <h4 class="nxRcH4" style="color:#dc2626;text-transform:uppercase;font-size:12px"><i class="ti ti-list-check"></i> 3. Problemas reportados</h4>
        <div style="background:#faf8f2;padding:10px;border-radius:8px"><p class="nxRcMuted" style="font-size:11px;margin:0 0 8px">Selecciona los problemas que el cliente reportó (las fallas detectadas en evaluación):</p><div id="devProblemasChecklist" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:6px"></div></div>
        <div class="nxRcFld"><label>Cliente que devolvió (opcional)</label><input id="dev_cliente" class="nxRcInput" placeholder="Nombre del cliente"></div>
        <h4 class="nxRcH4" style="color:#dc2626;text-transform:uppercase;font-size:12px"><i class="ti ti-user-plus"></i> 4. Asignar técnico para la nueva reparación</h4>
        <div class="nxRcFld"><label>Técnico a cargo (puede ser el mismo de antes)</label>${smartSelect('ss-dev-tecnico', tecItems(), '🔍 Buscar técnico...', '')}</div>
        <div class="nxRcFld"><label>Diagnóstico inicial (opcional)</label><textarea id="dev_diagnostico" class="nxRcInput" rows="2" placeholder="Tu primera impresión al revisar el equipo..."></textarea></div>
        <div style="background:linear-gradient(135deg,#fef3c7,#fde68a);border:2px solid #f59e0b;padding:12px;border-radius:10px;font-size:12px;color:#78350f"><b><i class="ti ti-alert-triangle"></i> ¿Qué sucederá al guardar?</b><ul style="margin:6px 0 0 18px;padding:0;line-height:1.5"><li>El equipo cambiará a estado <b>"En Proceso"</b></li><li>Se incrementará el contador "Devuelto X veces"</li><li>Si estaba disponible en el inventario, vuelve a quedar <b>apartado para el taller</b></li><li>El técnico verá el equipo en su panel con historial completo</li><li>Quedará registrado en el historial del equipo</li></ul></div>
      </div>`) + pie(`<button type="button" class="btn nxRcBtn light" onclick="window.nxRc.cerrar('nxRcDevM')">Cancelar</button><button type="button" class="btn nxRcBtn danger" onclick="window.nxRc.guardarDevolucion()"><i class="ti ti-check"></i> Registrar Devolución</button>`), 850);
    const el = byId('ss-dev-equipo'); if (el) el.addEventListener('nxrc-change', ev => { if (ev.detail && ev.detail.id) cargarHistorialEquipoDevolucion(ev.detail.id); });
  }
  async function cargarHistorialEquipoDevolucion(equipoId) {
    const eq = equipo(equipoId); if (!eq) return;
    try {
      const [fallas, piezas, devsPrev] = await Promise.all([api().get('pos_reacond_equipo_fallas', 'select=*&equipo_id=eq.' + equipoId), api().get('pos_reacond_piezas', 'select=*&equipo_id=eq.' + equipoId), api().get('pos_reacond_devoluciones', 'select=*&equipo_id=eq.' + equipoId + '&order=fecha_devolucion.desc')]);
      const l = lote(eq.lote_id), pv = l ? prov(l.proveedor_id) : null; const totalPiezas = (piezas || []).reduce((s, p) => s + (p.cantidad || 1) * (p.costo_unitario || 0), 0); const costoTotal = (Number(eq.costo_compra) || 0) + totalPiezas + calcularFleteEquipo(eq);
      const info = byId('devInfoEquipo'); info.style.display = 'block';
      info.innerHTML = `<div style="background:linear-gradient(135deg,#f3f0e8,#e9e5da);border-radius:10px;padding:14px"><div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap"><i class="ti ti-device-mobile" style="color:#806515;font-size:20px"></i><b style="font-size:15px">${esc(eq.modelo || 'Equipo')}</b>${eq.veces_devuelto > 0 ? badge('⚠️ Ya devuelto ' + eq.veces_devuelto + '×', '#fee2e2', '#991b1b') : ''}</div>
        <div class="nxRcInfoGrid" style="font-size:12px"><div><b>IMEI:</b><br>${esc(eq.imei || '—')}</div>${eq.capacidad ? `<div><b>Capacidad:</b><br>${esc(eq.capacidad)}</div>` : ''}<div><b>Compra:</b><br>${fechaDO(l ? (l.fecha_compra || l.creado_en) : null)}</div>${pv ? `<div><b>Proveedor:</b><br>${esc(pv.nombre)}</div>` : ''}${l ? `<div><b>Lote:</b><br>${esc(l.codigo_lote || '—')}</div>` : ''}${isAdminUser() ? `<div><b>Costo total invertido:</b><br><span style="color:#dc2626;font-weight:700">${money(costoTotal)}</span></div>` : ''}</div>
        ${(fallas || []).length ? `<div style="margin-top:10px;padding-top:10px;border-top:1px dashed #cbd5e1"><b style="font-size:11px;color:#991b1b;text-transform:uppercase"><i class="ti ti-alert-triangle"></i> Fallas detectadas anteriormente:</b><div style="margin-top:6px">${fallas.map(f => badge(esc(f.falla_corto || f.falla_nombre), '#fee2e2', '#991b1b', 'font-size:10px;margin:2px')).join('')}</div></div>` : ''}
        ${(piezas || []).length ? `<div style="margin-top:10px;padding-top:10px;border-top:1px dashed #cbd5e1"><b style="font-size:11px;color:#1d4ed8;text-transform:uppercase"><i class="ti ti-tools"></i> Piezas usadas en reparaciones previas:</b><div style="margin-top:4px;font-size:11px">${piezas.map(p => `<div>• ${esc(p.pieza_nombre || 'Pieza')} ×${p.cantidad || 1} ${p.estado === 'rechazada' ? '(rechazada)' : ''}</div>`).join('')}</div></div>` : ''}
        ${(devsPrev || []).length ? `<div style="margin-top:10px;padding-top:10px;border-top:1px dashed #cbd5e1"><b style="font-size:11px;color:#dc2626;text-transform:uppercase"><i class="ti ti-rotate-2"></i> Devoluciones anteriores (${devsPrev.length}):</b><div style="margin-top:4px;font-size:11px">${devsPrev.slice(0, 3).map(d => `<div style="background:#fef2f2;padding:4px 8px;border-radius:4px;margin-top:3px">• ${esc(fechaDO(d.fecha_devolucion))}: ${esc(String(d.motivo_devolucion || '').slice(0, 80))}${String(d.motivo_devolucion || '').length > 80 ? '...' : ''}</div>`).join('')}</div></div>` : ''}</div>`;
      byId('devProblemasChecklist').innerHTML = cache.fallas.filter(f => f.activa !== false).map(f => { const ya = (fallas || []).some(ef => ef.falla_id === f.id); return `<label style="display:flex;align-items:center;gap:6px;padding:6px 8px;background:${ya ? '#fef3c7' : '#fff'};border:1px solid rgba(90,72,20,.18);border-radius:6px;cursor:pointer;font-size:12px"><input type="checkbox" name="dev_problema" value="${esc(f.nombre_corto || f.nombre)}"><span>${esc(f.nombre)}${ya ? ' <small style="color:#92400e">(falla previa)</small>' : ''}</span></label>`; }).join('');
      byId('devCamposExtras').style.display = 'flex';
    } catch (e) { logError('Cargar historial devolución', e); toastError(friendly(e)); }
  }
  async function guardarDevolucion() {
    const equipoId = ssGet('ss-dev-equipo'), motivo = val('dev_motivo'), cliente = val('dev_cliente'), diagnostico = val('dev_diagnostico'), tecnicoId = ssGet('ss-dev-tecnico');
    if (!equipoId) return toast('Selecciona el equipo que se devolvió.', 'error'); if (!motivo) return toast('El motivo de devolución es obligatorio.', 'error'); if (!tecnicoId) return toast('Selecciona un técnico para esta reparación.', 'error');
    const eq = equipo(equipoId); if (!eq) return toast('Equipo no encontrado.', 'error'); if (eq.estado_evaluacion !== 'vendido') return toast('Este equipo no está terminado. Solo se pueden devolver equipos en estado "Despachado".', 'error');
    const problemas = Array.from(document.querySelectorAll('#devProblemasChecklist input:checked')).map(c => c.value); const problemasStr = problemas.length ? problemas.join(', ') : null;
    const cicloNuevo = (eq.ciclo_actual || 1) + 1, veces = (eq.veces_devuelto || 0) + 1;
    try {
      await api().post('pos_reacond_devoluciones', { equipo_id: equipoId, motivo_devolucion: motivo, problemas_reportados: problemasStr, ciclo: veces, cliente_que_devolvio: cliente || null, diagnostico_inicial: diagnostico || null, registrado_por: miNombre() });
      await api().patch('pos_reacond_equipos', 'id=eq.' + equipoId, { estado_evaluacion: 'en_proceso', tecnico_asignado_id: tecnicoId, fecha_asignacion: nowISO(), fecha_terminado: null, fecha_despacho: null, completado: false, fecha_completado: null, veces_devuelto: veces, ultima_devolucion: nowISO(), ciclo_actual: cicloNuevo });
      if (eq.serial_id) { try { await api().patch('pos_seriales', 'id=eq.' + eq.serial_id + '&estado=eq.disponible', { estado: 'reservado', notas: 'Taller reacondicionado (devolución)' }); } catch (_) {} }
      await historial(equipoId, 'vendido', 'en_proceso', `🔄 Equipo devuelto (${veces}× total) → asignado a ${nombreEmpleado(tecnicoId)}`, `Motivo: ${motivo}${problemasStr ? ' | Problemas: ' + problemasStr : ''}${diagnostico ? ' | Diagnóstico: ' + diagnostico : ''}`);
      toast('🔄 Devolución registrada. Equipo vuelto a "En Proceso".'); cerrarModal('nxRcDevM'); await loadAll(); cargarDevoluciones();
    } catch (e) { logError('Guardar devolución', e); toastError(friendly(e)); }
  }

  // ═══════════════ PEDIDOS DE PIEZAS ═══════════════
  function htmlPedidosPiezas() {
    return `<div id="reacondMainContentPiezas"><div class="nxRcCard">
      <div class="nxRcRow" style="margin-bottom:14px"><h3 class="nxRcH3"><i class="ti ti-packages"></i> Pedidos de Piezas (Reacondicionados)</h3><div class="nxRcActs"><button type="button" class="btn nxRcBtn light" onclick="window.nxRc.solicitarPiezaLibre()"><i class="ti ti-plus"></i> Solicitar pieza</button><button type="button" class="btn nxRcBtn light" onclick="window.nxRc.refrescar()"><i class="ti ti-refresh"></i> Actualizar</button></div></div>
      <div style="background:#ecfeff;border:1px solid #a5f3fc;padding:12px;border-radius:8px;margin-bottom:14px;font-size:12px;color:#0e7490"><b><i class="ti ti-info-circle"></i> Separa el trabajo operativo de los costos.</b> Las solicitudes técnicas muestran lo que debe gestionarse; las piezas del inventario que agrega el admin quedan como consulta de costo y no cuentan como pedidos pendientes.</div>
      <div id="pedidosPiezasReacondCont"></div></div></div>`;
  }
  function renderPedidosPiezasReacond() {
    const cont = byId('pedidosPiezasReacondCont'); if (!cont) return; const vista = I._reacondPiezasVista === 'costos' ? 'costos' : 'solicitudes';
    const todas = cache.piezasReacond; const solicitudes = todas.filter(_reacondEsSolicitudTecnico).length, costos = todas.filter(_reacondEsPiezaCostoInfoPlus).length;
    const bv = (clave, icono, texto, n) => { const on = vista === clave; return `<button type="button" role="tab" aria-selected="${on}" class="btn nxRcBtn ${on ? 'dark' : 'light'}" onclick="window.nxRc.vistaPiezas('${clave}')"><i class="ti ti-${icono}"></i> ${texto} <span style="opacity:.85">(${n})</span></button>`; };
    cont.innerHTML = `<div role="tablist" class="nxRcActs" style="margin-bottom:12px">${bv('solicitudes', 'tool', 'Solicitudes técnicas', solicitudes)}${bv('costos', 'receipt', 'Costos del inventario', costos)}</div>${construirPanelPedidosPiezas(null, vista)}`;
  }
  function construirPanelPedidosPiezas(soloTecnicoId, vista) {
    let piezas = cache.piezasReacond.slice();
    if (soloTecnicoId) { const mis = new Set(cache.refurb.filter(e => e.tecnico_asignado_id === soloTecnicoId).map(e => e.id)); piezas = piezas.filter(p => mis.has(p.equipo_id) || p.tecnico_id === soloTecnicoId); }
    piezas = piezas.filter(p => vista === 'costos' ? _reacondEsPiezaCostoInfoPlus(p) : _reacondEsSolicitudTecnico(p));
    if (!piezas.length) return construirAlertaPiezasNoUsadas(soloTecnicoId) + `<div class="nxRcMuted" style="font-size:13px;padding:10px 0">${vista === 'costos' ? 'No hay costos de inventario registrados.' : 'No hay solicitudes técnicas de piezas.'}</div>`;
    if (vista === 'costos') { const unidades = piezas.reduce((s, p) => s + (Number(p.cantidad) || 1), 0), total = piezas.reduce((s, p) => s + (Number(p.cantidad) || 1) * (Number(p.costo_unitario) || 0), 0); return `<div class="nxRcActs" style="margin-bottom:12px">${badge('🧾 ' + piezas.length + ' registros', '#e0f2fe', '#075985')}${badge('📦 ' + unidades + ' unidades', '#f1f5f9', '#475569')}${badge('💰 Total: ' + money(total), '#dcfce7', '#166534')}</div><div style="overflow-x:auto"><table class="nxRcTbl"><thead><tr><th>Pieza</th><th>Código</th><th style="text-align:center">Cant.</th><th style="text-align:right">Costo unit.</th><th style="text-align:right">Subtotal</th><th>Equipo</th><th>Inventario</th></tr></thead><tbody>${piezas.map(p => { const eq = equipo(p.equipo_id) || {}; return `<tr><td style="font-weight:600">${esc(p.pieza_nombre || 'Pieza')}</td><td><code>${esc(p.pieza_codigo || '—')}</code></td><td style="text-align:center">${p.cantidad || 1}</td><td style="text-align:right">${money(p.costo_unitario)}</td><td style="text-align:right;font-weight:700">${money((Number(p.cantidad) || 1) * (Number(p.costo_unitario) || 0))}</td><td>${eq.id ? esc(_modeloRep(eq)) : '<span style="color:#92400e">Sin equipo</span>'}</td><td>${(Number(p.descontada_cant) || 0) > 0 ? badge('✓ descontada', '#dcfce7', '#166534') : badge('⏳ por descontar', '#fef9c3', '#854d0e')}</td></tr>`; }).join('')}</tbody></table></div>`; }
    const cuenta = {}; piezas.forEach(p => { cuenta[p.estado] = (cuenta[p.estado] || 0) + 1; });
    const chips = Object.keys(cuenta).map(est => { const e = etiquetaEstadoPiezaReacond(est); return badge(e.txt + ': ' + cuenta[est], e.bg, e.color); }).join(' ');
    const filas = piezas.map(p => { const eq = equipo(p.equipo_id) || {}; const et = etiquetaEstadoPiezaReacond(p.estado); const tecId = eq.tecnico_asignado_id || p.tecnico_id || null; const prod = p.producto_id ? cache.productos.find(x => x.id === p.producto_id) : null; const stock = prod ? Number(prod.stock || 0) : null; return `<tr><td style="font-weight:600">${esc(p.pieza_nombre || '—')}</td><td style="text-align:center">${p.cantidad || 1}</td><td style="text-align:center">${stock === null ? '<span style="color:#85817a">—</span>' : `<span style="font-weight:700;color:${stock <= 0 ? '#dc2626' : stock <= 2 ? '#d97706' : '#16a34a'}">${stock}</span>`}</td><td>${eq.id ? `<a onclick="window.nxRc.abrirPanelProceso('${eq.id}')" style="cursor:pointer;color:#806515;font-weight:600">${esc(_modeloRep(eq))}</a>` : `<span style="color:#92400e">${p.equipo_id ? 'Equipo no disponible' : 'Sin equipo asociado'}</span>`}</td><td style="font-size:12px">${esc(tecId ? nombreEmpleado(tecId) : 'Sin asignar')}</td><td>${badge(et.txt, et.bg, et.color)}</td></tr>`; }).join('');
    const sinEq = piezas.filter(p => !p.equipo_id || !equipo(p.equipo_id)).length;
    return `${construirAlertaPiezasNoUsadas(soloTecnicoId)}<div class="nxRcActs" style="margin-bottom:10px">${chips}${sinEq ? badge('⚠️ ' + sinEq + ' sin equipo asociado', '#fff7ed', '#9a3412') : ''}</div><div style="overflow-x:auto"><table class="nxRcTbl"><thead><tr><th>Pieza</th><th style="text-align:center">Cant.</th><th style="text-align:center">Stock</th><th>Equipo</th><th>Técnico</th><th>Estado</th></tr></thead><tbody>${filas}</tbody></table></div>`;
  }
  function detectarPiezasNoUtilizadas(soloTecnicoId) {
    return cache.piezasReacond.filter(p => { if (!p.equipo_id) return false; const eq = equipo(p.equipo_id); if (!eq) return false; if (soloTecnicoId && eq.tecnico_asignado_id !== soloTecnicoId) return false; if (!_reacondEsSolicitudTecnico(p)) return false; const term = inList(['listo_venta', 'vendido'], eq.estado_evaluacion); return (term && inList(['recibida', 'entregada'], p.estado)) || (p.estado === 'entregada' && diasDesde(p.fecha_entrega) >= 3); });
  }
  function construirAlertaPiezasNoUsadas(soloTecnicoId) {
    const noUsadas = detectarPiezasNoUtilizadas(soloTecnicoId); if (!noUsadas.length) return '';
    return `<div style="background:#fff7ed;border:2px solid #fb923c;border-radius:10px;padding:12px;margin-bottom:14px"><div style="font-weight:700;color:#9a3412;margin-bottom:8px"><i class="ti ti-alert-triangle"></i> Piezas No Utilizadas (${noUsadas.length}) — requieren revisión</div><div style="font-size:12px;color:#9a3412;margin-bottom:10px">Estas piezas están en manos de un técnico pero el equipo ya terminó, o no fueron confirmadas. Conviene devolverlas al inventario o confirmar su uso.</div><div style="overflow-x:auto"><table class="nxRcTbl"><thead><tr><th>Pieza</th><th style="text-align:center">Cant.</th><th>Equipo</th><th>Técnico</th><th>Estado</th><th>Motivo</th></tr></thead><tbody>${noUsadas.map(p => { const eq = equipo(p.equipo_id) || {}; const et = etiquetaEstadoPiezaReacond(p.estado); const term = inList(['listo_venta', 'vendido'], eq.estado_evaluacion); return `<tr><td style="font-weight:600">${esc(p.pieza_nombre || '—')}</td><td style="text-align:center">${p.cantidad || 1}</td><td>${esc(_modeloRep(eq))}</td><td style="font-size:12px">${esc(eq.tecnico_asignado_id ? nombreEmpleado(eq.tecnico_asignado_id) : 'Sin asignar')}</td><td>${badge(et.txt, et.bg, et.color)}</td><td style="font-size:11px;color:#9a3412">${term ? 'Equipo terminado, pieza no devuelta' : 'Entregada sin confirmar'}</td></tr>`; }).join('')}</tbody></table></div></div>`;
  }
  async function solicitarPiezaReacondLibre() {
    let nombre = ''; while (true) { nombre = await pedirTexto('🔧 SOLICITAR PIEZA (Reacondicionados)\n\nEscribe la pieza que necesitas:\n\nEjemplo: "Pantalla iPhone 11", "Batería 13 Pro", "Flex de carga"'); if (nombre === null) return; if (nombre.trim()) break; toast('Escribe el nombre de la pieza.', 'error'); }
    const cantStr = await pedirTexto('¿Cuántas unidades? (deja 1 si es una sola)', { valor: '1', tipo: 'number' }); if (cantStr === null) return;
    try { await api().post('pos_reacond_piezas', { equipo_id: null, tecnico_id: miId() || null, pieza_nombre: nombre.trim(), cantidad: parseInt(cantStr) || 1, estado: 'pendiente', agregada_por_tecnico: true }); toast('✅ Pieza solicitada. Aparece en Pedidos de Piezas.'); await loadAll(); rerenderPOS(); } catch (e) { logError('Solicitar pieza libre', e); toastError(friendly(e)); }
  }

  // ═══════════════ RENTABILIDAD ═══════════════
  function htmlRentabilidad() { return `<div id="reacondMainContentRentabilidad"><div id="rentabilidadReacondCont"><p class="nxRcMuted" style="text-align:center;padding:30px;font-size:13px">Cargando rentabilidad...</p></div></div>`; }
  function fechaEnRango(f) { if (!f) return false; const d = new Date(f); if (isNaN(d)) return false; const r = I._repFiltroFechas; if (r.desde && d < new Date(r.desde)) return false; if (r.hasta && d > new Date(r.hasta + 'T23:59:59')) return false; return true; }
  function setPeriodoRentabilidad(dias, label) { if (dias === 'todo') I._repFiltroFechas = { desde: null, hasta: null, label: 'Todo' }; else { const h = new Date(), d = new Date(); d.setDate(d.getDate() - dias); I._repFiltroFechas = { desde: d.toISOString().slice(0, 10), hasta: h.toISOString().slice(0, 10), label }; } renderRentabilidadReacond(); }
  async function precioVentaRealDesdeVentas() {
    // STUDIO: el precio real sale de la venta del IMEI (pos_seriales.venta_id → pos_venta_items.precio) cuando existe.
    try {
      const ids = cache.refurb.filter(e => e.estado_evaluacion === 'vendido' && e.serial_id).map(e => e.serial_id); if (!ids.length) return;
      const ser = await api().get('pos_seriales', 'select=id,venta_id,producto_id&id=in.(' + ids.join(',') + ')&estado=eq.vendido') || []; if (!ser.length) return;
      const vids = [...new Set(ser.map(s => s.venta_id).filter(Boolean))]; if (!vids.length) return;
      const items = await api().get('pos_venta_items', 'select=venta_id,producto_id,precio,precio_unitario&venta_id=in.(' + vids.join(',') + ')') || [];
      cache.refurb.forEach(e => { const s = ser.find(x => x.id === e.serial_id); if (!s || !s.venta_id) return; const it = items.find(i => i.venta_id === s.venta_id && i.producto_id === s.producto_id); const p = it ? Number(it.precio_unitario != null ? it.precio_unitario : it.precio) : 0; if (p > 0 && !(Number(e.precio_venta_real) > 0)) { e.precio_venta_real = p; e._precioDeVenta = true; } });
    } catch (e) { logError('precio real desde ventas', e); }
  }
  async function renderRentabilidadReacond() {
    const cont = byId('rentabilidadReacondCont'); if (!cont) return;
    if (!isAdminUser()) { cont.innerHTML = '<div class="nxRcCard nxRcMuted" style="text-align:center;padding:34px"><i class="ti ti-lock" style="font-size:34px;color:#cbd5e1"></i><p style="margin:10px 0 0;font-size:13px">El centro de rentabilidad es solo para administradores.</p></div>'; return; }
    await precioVentaRealDesdeVentas();
    const equipos = cache.refurb; const inv = e => (Number(e.costo_compra) || 0) + (Number(e.costo_repuestos) || 0) + calcularFleteEquipo(e); const esVendido = e => e.estado_evaluacion === 'vendido'; const tieneP = e => e.precio_venta_real != null && Number(e.precio_venta_real) > 0;
    const vendidosRango = equipos.filter(e => esVendido(e) && fechaEnRango(e.fecha_despacho || e.creado_en)); let ingresos = 0, inversionRecup = 0, conPrecio = 0, sinPrecio = 0;
    vendidosRango.forEach(e => { if (tieneP(e)) { ingresos += Number(e.precio_venta_real); inversionRecup += inv(e); conPrecio++; } else sinPrecio++; });
    const ganancia = ingresos - inversionRecup, margen = inversionRecup > 0 ? (ganancia / inversionRecup) * 100 : 0, ticketProm = conPrecio ? ingresos / conPrecio : 0, gColor = ganancia >= 0 ? '#16a34a' : '#dc2626';
    const enInventario = equipos.filter(e => !esVendido(e)); const capitalCongelado = enInventario.reduce((s, e) => s + inv(e), 0);
    const estancados = enInventario.map(e => ({ e, dias: diasDesde(e.fecha_compra || e.creado_en) })).sort((a, b) => b.dias - a.dias).slice(0, 5);
    const porLote = {}; equipos.forEach(e => { const lid = e.lote_id || '_sin'; if (!porLote[lid]) porLote[lid] = { invTotal: 0, invVendidos: 0, ingresos: 0, vendidos: 0, total: 0 }; const L = porLote[lid]; L.invTotal += inv(e); L.total++; if (esVendido(e) && tieneP(e)) { L.ingresos += Number(e.precio_venta_real); L.invVendidos += inv(e); L.vendidos++; } });
    const lotesRank = Object.entries(porLote).map(([lid, d]) => { const l = lid === '_sin' ? null : lote(lid); const pv = l ? prov(l.proveedor_id) : null; const ganReal = d.ingresos - d.invVendidos; return { codigo: (l && l.codigo_lote) || 'Sin lote', prov: (pv && pv.nombre) || '—', ...d, ganReal, pendiente: d.invTotal - d.invVendidos, roi: d.invVendidos > 0 ? (ganReal / d.invVendidos) * 100 : 0, pctVendido: d.total ? Math.round(d.vendidos / d.total * 100) : 0 }; }).sort((a, b) => b.ganReal - a.ganReal);
    const porTec = {}; vendidosRango.forEach(e => { if (!tieneP(e)) return; const tid = e.tecnico_asignado_id || '_sin'; if (!porTec[tid]) porTec[tid] = { ganancia: 0, n: 0 }; porTec[tid].ganancia += Number(e.precio_venta_real) - inv(e); porTec[tid].n++; });
    const tecRank = Object.entries(porTec).map(([tid, d]) => ({ nombre: tid === '_sin' ? 'Sin técnico asignado' : nombreEmpleado(tid), ...d })).sort((a, b) => b.ganancia - a.ganancia);
    const periodoBtn = (dias, texto) => { const on = I._repFiltroFechas.label === texto; return `<button type="button" class="btn nxRcBtn ${on ? 'dark' : 'light'}" style="height:30px;font-size:12px" onclick="window.nxRc.periodo(${dias === 'todo' ? "'todo'" : dias},'${texto}')">${texto}</button>`; };
    const kpi = (label, v, color, sub) => `<div class="kpi-box" style="border-top-color:${color}"><small>${label}</small><strong>${v}</strong>${sub ? `<span style="font-size:10px;color:#85817a">${sub}</span>` : ''}</div>`;
    const maxL = lotesRank.length ? Math.max(1, ...lotesRank.map(l => Math.abs(l.ganReal))) : 1;
    const filasLotes = lotesRank.length ? lotesRank.map(l => { const pct = Math.round(Math.abs(l.ganReal) / maxL * 100), col = l.ganReal >= 0 ? '#16a34a' : '#dc2626'; return `<div style="border:1px solid rgba(90,72,20,.18);border-radius:10px;padding:11px 13px;margin-bottom:9px;background:#fff"><div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap"><b style="font-size:13px">📦 ${esc(l.codigo)} <span class="nxRcMuted" style="font-weight:400;font-size:11px">· ${esc(l.prov)}</span></b><span style="font-weight:800;color:${col}">${money(l.ganReal)} <span style="font-size:10px;color:#85817a">(ROI ${l.roi.toFixed(0)}%)</span></span></div><div style="background:#e9e5da;border-radius:5px;height:7px;overflow:hidden;margin:6px 0"><div style="width:${pct}%;height:100%;background:${col};border-radius:5px"></div></div><div style="display:flex;gap:14px;flex-wrap:wrap;font-size:11px;color:#475569"><span>Inversión: <b>${money(l.invTotal)}</b></span><span>Vendido: <b>${l.vendidos}/${l.total}</b> (${l.pctVendido}%)</span><span>Recuperado: <b style="color:#16a34a">${money(l.ingresos)}</b></span>${l.pendiente > 0 ? `<span>Pendiente: <b style="color:#b45309">${money(l.pendiente)}</b></span>` : ''}</div></div>`; }).join('') : '<div class="nxRcMuted" style="font-size:12px;padding:6px 0">Aún no hay lotes con datos.</div>';
    const maxT = tecRank.length ? Math.max(1, ...tecRank.map(t => Math.abs(t.ganancia))) : 1;
    const filasTec = tecRank.length ? tecRank.map(t => { const pct = Math.round(Math.abs(t.ganancia) / maxT * 100), col = t.ganancia >= 0 ? '#16a34a' : '#dc2626'; return `<div style="margin-bottom:9px"><div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:3px"><span style="font-weight:600">${esc(t.nombre)} <span class="nxRcMuted" style="font-weight:400">(${t.n} vendido${t.n === 1 ? '' : 's'})</span></span><span style="font-weight:800;color:${col}">${money(t.ganancia)}</span></div><div style="background:#e9e5da;border-radius:5px;height:8px;overflow:hidden"><div style="width:${pct}%;height:100%;background:${col};border-radius:5px"></div></div></div>`; }).join('') : '<div class="nxRcMuted" style="font-size:12px;padding:6px 0">Sin ventas con precio en el período.</div>';
    const filasEst = estancados.length ? estancados.map(({ e, dias }) => `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:7px 0;border-bottom:1px dashed #e9e5da;font-size:12px"><span><i class="ti ti-device-mobile" style="color:#475569"></i> ${esc(e.modelo || 'Equipo')} <span class="nxRcMuted">· ${money(inv(e))}</span></span><span style="font-weight:700;color:${dias >= 30 ? '#dc2626' : '#b45309'}">${dias} día${dias === 1 ? '' : 's'}</span></div>`).join('') : '<div class="nxRcMuted" style="font-size:12px;padding:6px 0">Sin equipos en inventario. 🎉</div>';
    cont.innerHTML = `<div class="nxRcCard" style="margin-bottom:14px;background:linear-gradient(135deg,#f0fdf4,#ecfdf5)">
      <div class="nxRcRow" style="align-items:flex-start"><div><h3 class="nxRcH3" style="margin-bottom:3px"><i class="ti ti-cash" style="color:#16a34a"></i> Centro de Rentabilidad</h3><p class="nxRcMuted" style="font-size:12px;margin:0">Cuánto inviertes, cuánto vendes y cuánto ganas de verdad con los reacondicionados.</p></div><button type="button" class="btn nxRcBtn light" onclick="window.nxRc.refrescar()"><i class="ti ti-refresh"></i> Actualizar</button></div>
      <div class="nxRcActs" style="margin:12px 0 14px"><span style="font-size:12px;font-weight:700;color:#85817a"><i class="ti ti-calendar"></i> Ventas del período:</span>${periodoBtn(1, 'Hoy')}${periodoBtn(15, '15 días')}${periodoBtn(30, '1 mes')}${periodoBtn(90, '3 meses')}${periodoBtn('todo', 'Todo')}</div>
      <div class="kpi-grid">${kpi('💰 Ingresos por ventas', money(ingresos), '#16a34a', conPrecio + ' equipo(s)')}${kpi('🛒 Inversión recuperada', money(inversionRecup), '#0891b2')}${kpi('📈 Ganancia neta', money(ganancia), gColor, 'margen ' + margen.toFixed(1) + '%')}${kpi('🎯 Ticket promedio', money(ticketProm), '#6366f1')}</div>
      ${sinPrecio ? `<div style="background:#fef3c7;border:1px solid #fcd34d;color:#92400e;font-size:11px;border-radius:8px;padding:8px 10px;margin-top:10px"><i class="ti ti-alert-triangle"></i> ${sinPrecio} equipo(s) despachado(s) sin precio de venta todavía (se toma de la factura cuando el IMEI se vende en Vender/Factura). No suman a los ingresos.</div>` : ''}</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px">
        <div class="nxRcCard"><h4 class="nxRcH4" style="margin-bottom:4px;font-size:14px"><i class="ti ti-snowflake" style="color:#0891b2"></i> Capital congelado en inventario</h4><p class="nxRcMuted" style="font-size:11px;margin:0 0 10px">Dinero invertido en equipos que todavía no se han vendido.</p><div style="font-size:26px;font-weight:800;color:#b45309">${money(capitalCongelado)}</div><div class="nxRcMuted" style="font-size:12px;margin-bottom:10px">${enInventario.length} equipo(s) en inventario</div><h5 style="margin:8px 0 4px;font-size:12px;color:#475569">⏳ Más tiempo sin venderse</h5>${filasEst}</div>
        <div class="nxRcCard"><h4 class="nxRcH4" style="margin-bottom:10px;font-size:14px"><i class="ti ti-trophy" style="color:#16a34a"></i> Ganancia por técnico <span class="nxRcMuted" style="font-size:11px;font-weight:400">(${esc(I._repFiltroFechas.label)})</span></h4>${filasTec}</div>
      </div>
      <div class="nxRcCard" style="margin-top:14px"><h4 class="nxRcH4" style="margin-bottom:4px;font-size:14px"><i class="ti ti-stack-2" style="color:#6366f1"></i> Rentabilidad por lote</h4><p class="nxRcMuted" style="font-size:11px;margin:0 0 12px">Ganancia ya realizada (unidades vendidas) y capital aún pendiente por recuperar, por cada lote de compra.</p>${filasLotes}</div>`;
  }

  // ═══════════════ MIS REACONDICIONADOS (vista del técnico) ═══════════════
  function renderMisReacond() {
    const cont = byId('misReacondContenido'); if (!cont) return; const mi = miId();
    const mis = cache.refurb.filter(e => String(e.tecnico_asignado_id || '') === mi && e.estado_evaluacion !== 'vendido');
    const cards = mis.length ? mis.map(eq => { const tareasEq = cache.tareas.filter(t => t.tipo === 'equipo' && t.ref_id === eq.id); const pend = tareasEq.filter(t => t.estado !== 'hecha').length; const et = obtenerEtiquetaEstado(eq.estado_evaluacion || 'en_proceso'); return `<div class="nxRcEq" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;cursor:default"><div><b>${esc(eq.marca || '')} ${esc(eq.modelo || '')}</b> ${eq.capacidad ? '· ' + esc(eq.capacidad) : ''} ${badge(et.text, et.bg, et.color, 'font-size:10px')}<div class="nxRcMuted" style="font-size:12px;margin-top:2px">IMEI: ${esc(eq.imei || '—')} ${pend > 0 ? `· ${pend} falla(s) pendiente(s)` : '· ✅ sin pendientes'}</div>${eq.fecha_asignacion ? `<div style="font-size:11px;color:#0891b2;font-weight:600;margin-top:2px"><i class="ti ti-stopwatch"></i> Tomado: ${tiempoDesde(eq.fecha_asignacion)}</div>` : ''}</div><button type="button" class="btn nxRcBtn dark" onclick="window.nxRc.abrirPanelProceso('${eq.id}')"><i class="ti ti-tool"></i> Trabajar</button></div>`; }).join('') : '<div class="nxRcMuted" style="font-size:13px;padding:8px 0">No tienes equipos reacondicionados asignados.</div>';
    const terminados = cache.refurb.filter(e => String(e.tecnico_asignado_id || '') === mi && inList(['listo_venta', 'vendido'], e.estado_evaluacion)).sort((a, b) => new Date(b.fecha_despacho || b.fecha_terminado || 0) - new Date(a.fecha_despacho || a.fecha_terminado || 0)).slice(0, 30);
    cont.innerHTML = `<h4 class="nxRcH4" style="color:#92400e;text-transform:uppercase;font-size:12px;margin-bottom:8px"><i class="ti ti-device-mobile"></i> Mis Equipos</h4>${cards}
      <h4 class="nxRcH4" style="color:#92400e;text-transform:uppercase;font-size:12px;margin:18px 0 8px"><i class="ti ti-packages"></i> Mis Pedidos de Piezas</h4>${construirPanelPedidosPiezas(mi, 'solicitudes')}
      <h4 class="nxRcH4" style="color:#92400e;text-transform:uppercase;font-size:12px;margin:18px 0 8px"><i class="ti ti-history"></i> Mi Historial</h4>${terminados.length ? `<div style="overflow-x:auto"><table class="nxRcTbl"><thead><tr><th>Fecha</th><th>Equipo</th><th>Estado</th></tr></thead><tbody>${terminados.map(e => { const et = obtenerEtiquetaEstado(e.estado_evaluacion); return `<tr><td style="white-space:nowrap;font-size:12px">${fechaDO(e.fecha_despacho || e.fecha_terminado)}</td><td style="font-weight:600">${esc(_modeloRep(e))}</td><td>${badge(et.text, et.bg, et.color)}</td></tr>`; }).join('')}</tbody></table></div>` : '<div class="nxRcMuted" style="font-size:13px;padding:8px 0">No hay reparaciones terminadas todavía.</div>'}`;
  }

  Object.assign(I, { htmlCatalogo, htmlDevoluciones, htmlPedidosPiezas, htmlRentabilidad, renderCatalogoFallas, cargarDevoluciones, renderPedidosPiezasReacond, renderRentabilidadReacond, renderMisReacond });
  Object.assign(window.nxRc, {
    verFichaDespacho, verHistorial: verHistorialEquipoReacond, imprimirLabel: imprimirLabelEquipo, lrPreview: _lrPreview, lrFuente: _lrAjustarFuente, lrImprimir: imprimirLabelRapido,
    nuevoLote: abrirModalNuevoLote, guardarNuevoLote, loteDesdeCompra: abrirModalLoteDesdeCompra, guardarLoteDesdeCompra, editarLote: abrirModalDatosLote, guardarDatosLote, editarEnvio: editarGastosEnvioLote, eliminarLote, agregarEquipo: abrirModalAgregarEquipo, agregarEquipoAlLote, editarEquipo: _editarEquipoLote, guardarEdicionEquipo: _guardarEdicionEquipoLote, eliminarEquipo: eliminarEquipoLote, registrarExistente: abrirModalRegistrarExistente, guardarEquipoExistente,
    imprimirCostos: imprimirReporteCostosLote, excelCostos: exportarReporteCostosLoteExcel,
    fallasBusq: v => { _filtros.fallasBusq = v || ''; renderCatalogoFallas(); }, abrirModalFalla: () => abrirModalFalla(null), editarFalla: id => abrirModalFalla(id), guardarFalla, eliminarFalla, abrirModalCategoria: () => abrirModalCategoria(null), editarCategoria: id => abrirModalCategoria(id), guardarCategoria, eliminarCategoria,
    abrirNuevaDevolucion: abrirModalNuevaDevolucion, guardarDevolucion, vistaPiezas: v => { I._reacondPiezasVista = v === 'costos' ? 'costos' : 'solicitudes'; renderPedidosPiezasReacond(); }, solicitarPiezaLibre: solicitarPiezaReacondLibre, periodo: setPeriodoRentabilidad
  });
})();
