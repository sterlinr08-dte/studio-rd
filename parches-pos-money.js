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

  function attach(input) {
    if (!input || input.__nxMoney) return;
    input.__nxMoney = true;
    try { if (input.type !== 'text') input.type = 'text'; } catch (e) {}
    input.setAttribute('inputmode', 'decimal');
    input.setAttribute('autocomplete', 'off');
    if (input.value) input.value = formatLive(input.value);
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

  window.nxMoney = { parse: parse, format: formatLive, attach: attach, scan: scan, strip: strip };

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
