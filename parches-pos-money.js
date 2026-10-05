/* STUDIO — utilidad global de montos (nxMoney)
   Extraída sin cambios de parches-seguros-base.js (NEXUS PRO) el 2026-09-22, porque
   parches-pos.js la usa para leer y formatear montos (miles con coma, teclado decimal
   en móvil) y los parches de Seguros ya no se cargan en STUDIO.
   Se aplica a cualquier <input data-nx-money>. Valor real: window.nxMoney.parse(v). */
(function () {
  'use strict';
  if (window.nxMoney) return;

  // Normaliza una cadena escrita por el usuario (notación RD o US) a sus partes.
  // REGLA: el ÚLTIMO separador ('.' o ',') es DECIMAL solo si va seguido de 1 o 2
  // dígitos. En cualquier otro caso, TODOS los separadores son de miles.
  // Así "4.000" (RD) → 4000, "4.50" → 4.5, "1.234,56" → 1234.56, "40,000" → 40000.
  function _norm(raw) {
    let s = String(raw == null ? '' : raw).replace(/[^\d.,\-]/g, '');
    const neg = s.indexOf('-') !== -1;
    s = s.replace(/-/g, '');
    const lastSep = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
    let ent, dec = '';
    if (lastSep === -1) {
      ent = s.replace(/[.,]/g, '');
    } else {
      const after = s.slice(lastSep + 1).replace(/[.,]/g, '');
      if (after.length >= 1 && after.length <= 2) {
        ent = s.slice(0, lastSep).replace(/[.,]/g, '');
        dec = after;
      } else {
        ent = s.replace(/[.,]/g, ''); // todos los separadores son de miles
      }
    }
    ent = ent.replace(/^0+(?=\d)/, ''); // sin ceros a la izquierda
    return { neg: neg, ent: ent, dec: dec };
  }

  // "1,234.56" / "4.000" / "RD$ 1,234" → número real
  function parse(v) {
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    const n = _norm(v);
    const num = Number((n.neg ? '-' : '') + (n.ent || '0') + (n.dec ? '.' + n.dec : ''));
    return isNaN(num) ? 0 : num;
  }

  // Formatea en vivo: miles con coma, hasta 2 decimales. Acepta '.' o ',' como
  // separador. Mientras se escribe, un separador con 3+ dígitos detrás pasa a ser
  // de miles (ej. "4.000" → "4,000"); con 1-2 dígitos es decimal ("4.50").
  function formatLive(raw) {
    let s = String(raw == null ? '' : raw).replace(/[^\d.,]/g, '');
    if (s === '') return '';
    const trailingSep = /[.,]$/.test(s); // usuario empezando los decimales
    const n = _norm(s);
    let out = n.ent ? Number(n.ent).toLocaleString('en-US') : '';
    if (n.dec !== '') {
      if (out === '') out = '0';
      out += '.' + n.dec.slice(0, 2);
    } else if (trailingSep) {
      if (out === '') out = '0';
      out += '.';
    }
    return out;
  }

  // Dueño 05-oct-2026 («RD$ 1,250.00»): al terminar de escribir, el monto queda con coma de miles y dos decimales.
  function fixed(v) {
    if (v === '' || v == null) return '';
    const n = parse(v);
    return (n < 0 ? '-' : '') + Math.abs(Math.round(n * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  // Signo de dinero dentro del campo. Si ya trae su adorno (span.cur o el «RD$» del cobro), se usa ese; si no, se
  // envuelve el campo y el «RD$» se dibuja a la izquierda. El VALOR sigue siendo solo el número: nada cambia al leerlo.
  // data-nx-money="sinsigno": sin signo (celdas muy angostas). data-nx-money="entero": sin decimales.
  function signo(input) {
    const modo = input.getAttribute('data-nx-money') || '';
    if (modo.indexOf('sinsigno') >= 0) return;
    const prev = input.previousElementSibling;
    if (prev && prev.classList && prev.classList.contains('cur')) {
      if (prev.textContent.trim() === '$') prev.textContent = 'RD$';
      requestAnimationFrame(function () { const w = prev.offsetWidth; if (w) { const pl = parseFloat(getComputedStyle(input).paddingLeft) || 0; if (pl < w + 16) input.style.paddingLeft = (w + 16) + 'px'; } });
      return;
    }
    const par = input.parentElement;
    if (!par || (par.classList && (par.classList.contains('nxPgBig') || par.classList.contains('nxMon')))) return;
    const cs = getComputedStyle(input);
    const w = document.createElement('span'); w.className = 'nxMon';
    w.style.display = (cs.display === 'inline' || cs.display === 'inline-block') && input.style.width !== '100%' ? 'inline-block' : 'block';
    if (input.style.width && input.style.width !== '100%') { w.style.width = input.style.width; input.style.width = '100%'; }
    if (input.style.flex) { w.style.flex = input.style.flex; input.style.flex = ''; }
    par.insertBefore(w, input); w.appendChild(input);
    const pl = parseFloat(cs.paddingLeft) || 0; if (pl < 36) input.style.paddingLeft = '36px';
  }
  function css() {
    if (document.getElementById('nxMonCSS')) return;
    const st = document.createElement('style'); st.id = 'nxMonCSS';
    st.textContent = '.nxMon{position:relative;min-width:0}.nxMon>input{width:100%;box-sizing:border-box}.nxMon::before{content:"RD$";position:absolute;left:10px;top:50%;transform:translateY(-50%);font-size:12px;font-weight:700;color:#8a877f;pointer-events:none;z-index:1}';
    (document.head || document.documentElement).appendChild(st);
  }
  function attach(input) {
    if (!input || input.__nxMoney) return;
    input.__nxMoney = true;
    const entero = (input.getAttribute('data-nx-money') || '').indexOf('entero') >= 0;
    try { if (input.type !== 'text') input.type = 'text'; } catch (e) {}
    input.setAttribute('inputmode', 'decimal');
    input.setAttribute('autocomplete', 'off');
    if (input.value) input.value = entero ? formatLive(input.value) : fixed(input.value);
    try { css(); signo(input); } catch (e) {}
    input.addEventListener('blur', function () {
      if (entero || !input.value) return;
      const after = fixed(input.value);
      if (after !== input.value) { input.value = after; try { input.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {} }
    });
    input.addEventListener('input', function () {
      const before = input.value;
      const after = formatLive(before);
      if (after !== before) {
        input.value = after;
        try { const L = input.value.length; input.setSelectionRange(L, L); } catch (e) {}
      }
    });
    // Reformatear valores pre-cargados (p. ej. al abrir un editar) al enfocar
    input.addEventListener('focus', function () {
      if (input.value) {
        const after = formatLive(input.value);
        if (after !== input.value) input.value = after;
      }
    });
  }

  function scan(root) {
    const r = (root && root.querySelectorAll) ? root : document;
    r.querySelectorAll('input[data-nx-money]').forEach(attach);
  }

  // Devuelve un string numérico limpio (sin separadores de miles) para guardar.
  // Entiende notación RD/US igual que parse(); conserva el vacío como vacío.
  function strip(v) {
    const s = String(v == null ? '' : v).trim();
    if (s === '') return '';
    const n = _norm(s);
    return (n.neg ? '-' : '') + (n.ent || '0') + (n.dec ? '.' + n.dec : '');
  }

  window.nxMoney = { parse: parse, format: formatLive, fixed: fixed, attach: attach, scan: scan, strip: strip };

  let pending = null;
  function schedule() {
    if (pending) return;
    pending = setTimeout(function () { pending = null; scan(document); }, 150);
  }
  try { new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true }); } catch (e) {}
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', schedule, { once: true });
  else schedule();
  try { window.addEventListener('nexus:reinit', schedule); } catch (e) {}
})();
