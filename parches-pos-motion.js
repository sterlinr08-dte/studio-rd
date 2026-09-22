/* STUDIO · Movimiento fluido del POS (DESIGN.md §10, §12.6) · 2026-09-22
   Capa presentacional: no toca ventas, cobros, inventario ni navegación real.
   1) Menú móvil que sigue al dedo 1:1, con resorte al soltar, velocidad heredada, proyección de momentum,
      rubber-band en el borde y animación interrumpible (se puede agarrar a mitad de camino).
   2) Entrada en cascada de las superficies al cambiar de pestaña (22 ms), nunca al refrescar datos.
   3) Total de la factura dentro de la barra fija de acciones (solo lectura del resumen ya pintado).
   Respeta prefers-reduced-motion (sin resortes: cambios inmediatos). */
(function () {
  'use strict';
  if (window.__nxStudioMotion) return;
  window.__nxStudioMotion = true;

  var reduced = function () { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };
  var movil = function () { try { return matchMedia('(max-width: 860px)').matches; } catch (e) { return false; } };
  var side = function () { return document.getElementById('nxTSide'); };
  var backdrop = function () { return document.querySelector('#v-pos .nxTBackdrop'); };

  /* ── 1. Cajón móvil ──────────────────────────────────────────────────────── */
  var anim = null, drag = null;
  function ancho(s) { return s.getBoundingClientRect().width + 12; }          // 12 = margen exterior del dock
  function actual(s) { try { var m = new DOMMatrixReadOnly(getComputedStyle(s).transform); return m.m41 || 0; } catch (e) { return 0; } }
  function abierto(s) { return s.classList.contains('open'); }
  function pintar(s, x) {
    s.style.transform = 'translateX(' + x + 'px)';
    var b = backdrop(); if (!b) return;
    var p = Math.max(0, Math.min(1, 1 + x / ancho(s)));
    b.style.display = p > 0.005 ? 'block' : 'none';
    b.style.opacity = String(p);
  }
  function asentar(s, open) {
    cancelar();
    document.body.classList.toggle('nxTDrawer', open);
    s.classList.toggle('open', open);
    s.style.transform = '';
    var b = backdrop(); if (b) { b.style.opacity = ''; b.style.display = ''; }
  }
  function cancelar() { if (anim) { cancelAnimationFrame(anim); anim = null; } }
  /* Resorte con dos parámetros (Apple): damping ratio y response (s). Integra desde el valor actual y la velocidad dada. */
  function resorte(s, hasta, v0, zeta, resp, fin) {
    cancelar();
    var omega = 2 * Math.PI / resp, k = omega * omega, c = 2 * zeta * omega;
    var pos = actual(s), vel = v0 || 0, last = performance.now();
    function paso(now) {
      var dt = Math.min(0.064, (now - last) / 1000); last = now;
      var n = Math.max(1, Math.ceil(dt / 0.004)), h = dt / n;
      for (var i = 0; i < n; i++) { var a = -k * (pos - hasta) - c * vel; vel += a * h; pos += vel * h; }
      pintar(s, pos);
      if (Math.abs(pos - hasta) < 0.5 && Math.abs(vel) < 25) { pintar(s, hasta); anim = null; if (fin) fin(); return; }
      anim = requestAnimationFrame(paso);
    }
    anim = requestAnimationFrame(paso);
  }
  function abrir(s, v0) {
    document.body.classList.add('nxTDrawer'); s.classList.add('open');
    if (reduced()) { asentar(s, true); return; }
    s.style.transform = 'translateX(' + actual(s) + 'px)';
    resorte(s, 0, v0 || 0, v0 ? 0.8 : 1, v0 ? 0.3 : 0.34, function () { asentar(s, true); });
  }
  function cerrar(s, v0) {
    if (reduced()) { asentar(s, false); return; }
    s.style.transform = 'translateX(' + actual(s) + 'px)';
    document.body.classList.remove('nxTDrawer');
    resorte(s, -ancho(s), v0 || 0, 1, 0.3, function () { asentar(s, false); });
  }
  function proyectar(v) { var d = 0.998; return (v / 1000) * d / (1 - d); }
  function rubber(over, dim, c) { c = c || 0.55; return (over * dim * c) / (dim + c * Math.abs(over)); }

  var toggleOriginal = window.nxPosToggleSide;
  window.nxPosToggleSide = function () {
    var s = side(); if (!s) return;
    if (!movil()) { if (typeof toggleOriginal === 'function') toggleOriginal(); return; }
    if (abierto(s) || document.body.classList.contains('nxTDrawer')) cerrar(s, 0); else abrir(s, 0);
  };

  /* Arrastre: dentro del cajón (cerrar), en el fondo oscurecido, o desde el borde izquierdo (abrir). */
  function inicio(e) {
    if (!movil() || e.pointerType === 'mouse' && e.button !== 0) return;
    var s = side(); if (!s) return;
    var enSide = s.contains(e.target), enFondo = e.target.classList && e.target.classList.contains('nxTBackdrop');
    var borde = !abierto(s) && !document.body.classList.contains('nxTDrawer') && e.clientX <= 24 && document.querySelector('#v-pos.on');
    if (!enSide && !enFondo && !borde) return;
    cancelar();
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, base: actual(s), activo: enFondo || borde, hist: [[e.clientX, performance.now()]], s: s, target: e.target };
    if (drag.activo) s.style.transform = 'translateX(' + drag.base + 'px)';
  }
  function mover(e) {
    if (!drag || e.pointerId !== drag.id) return;
    var dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    if (!drag.activo) { if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy)) return; drag.activo = true; try { drag.target.setPointerCapture && drag.target.setPointerCapture(e.pointerId); } catch (x) {} }
    var s = drag.s, w = ancho(s), x = drag.base + dx;
    if (x > 0) x = rubber(x, w);                      // más allá de abierto: resistencia progresiva
    if (x < -w) x = -w + rubber(x + w, w);           // más allá de cerrado
    drag.hist.push([e.clientX, performance.now()]); if (drag.hist.length > 6) drag.hist.shift();
    pintar(s, x);
    if (e.cancelable) e.preventDefault();
  }
  function fin(e) {
    if (!drag || e.pointerId !== drag.id) return;
    var d = drag; drag = null;
    if (!d.activo) return;                            // fue un toque, no un arrastre: nada que decidir
    // Un arrastre no es un clic: se traga el click que el navegador dispara tras soltar sobre un botón.
    document.addEventListener('click', function (ev) { ev.stopPropagation(); ev.preventDefault(); }, { capture: true, once: true });
    setTimeout(function () { document.removeEventListener('click', function () {}, true); }, 400);
    var s = d.s, w = ancho(s), h = d.hist, v = 0;
    if (h.length > 1) { var a = h[0], b = h[h.length - 1]; var dt = (b[1] - a[1]) / 1000; if (dt > 0) v = (b[0] - a[0]) / dt; }
    var x = actual(s), fin = x + proyectar(v);
    var abrirlo = Math.abs(v) > 300 ? v > 0 : fin > -w / 2;
    if (abrirlo) abrir(s, v); else cerrar(s, v);
  }
  document.addEventListener('pointerdown', inicio, { passive: true });
  document.addEventListener('pointermove', mover, { passive: false });
  document.addEventListener('pointerup', fin, { passive: true });
  document.addEventListener('pointercancel', fin, { passive: true });

  /* ── 2. Cascada al cambiar de pestaña ────────────────────────────────────── */
  var ultimaTab = null;
  function cascada() {
    if (reduced()) return;
    var main = document.querySelector('#v-pos .nxTMain'); if (!main) return;
    var nodos = main.querySelectorAll('.nxTKpi, .nxApp, .nxTPanel, .nxDocCard, .nxPosLeft > .card, .nxPosRight > *, .vlist > *, .tw, .card');
    var i = 0;
    for (var n = 0; n < nodos.length && i < 12; n++) {
      var el = nodos[n]; if (el.__nxEnter) continue; el.__nxEnter = true;
      el.style.animationDelay = (i * 22) + 'ms'; el.classList.add('nxStudioEnter'); i++;
      el.addEventListener('animationend', function () { this.classList.remove('nxStudioEnter'); this.style.animationDelay = ''; this.__nxEnter = false; }, { once: true });
    }
  }
  var tabOriginal = window.nxPosTab;
  function envolverTab() {
    var actualTab = window.nxPosTab;
    if (typeof actualTab !== 'function' || actualTab.__nxStudio) return;
    var w = function (k) {
      var r = actualTab.apply(this, arguments);
      var s = side(); if (s && movil() && (abierto(s) || document.body.classList.contains('nxTDrawer'))) cerrar(s, 0);
      if (k !== ultimaTab) { ultimaTab = k; requestAnimationFrame(cascada); }
      return r;
    };
    w.__nxStudio = true; window.nxPosTab = w;
  }
  envolverTab();
  var abrirOriginal = window.nxAbrirPOS;
  function envolverAbrir() {
    var f = window.nxAbrirPOS; if (typeof f !== 'function' || f.__nxStudio) return;
    var w = function () { var r = f.apply(this, arguments); Promise.resolve(r).then(function () { envolverTab(); ultimaTab = 'inicio'; requestAnimationFrame(cascada); }); return r; };
    w.__nxStudio = true; window.nxAbrirPOS = w;
  }
  envolverAbrir();
  var intentos = 0, t = setInterval(function () { envolverTab(); envolverAbrir(); if (++intentos > 60 || (window.nxPosTab && window.nxPosTab.__nxStudio && window.nxAbrirPOS && window.nxAbrirPOS.__nxStudio)) clearInterval(t); }, 250);

  /* ── 3. Total en la barra fija de Factura ────────────────────────────────── */
  function totalBarra() {
    var bar = document.getElementById('nxFacBar'); if (!bar || bar.querySelector('.fbT')) return;
    var big = document.querySelector('#facResumen .tr.big b'); if (!big) return;
    var p = bar.querySelector('.fbP'); if (!p) return;
    var span = document.createElement('span'); span.className = 'fbT';
    span.innerHTML = '<small>Total</small><b></b>'; span.querySelector('b').textContent = big.textContent;
    bar.insertBefore(span, p);
  }
  try { new MutationObserver(function () { totalBarra(); }).observe(document.body, { childList: true }); } catch (e) {}
})();
