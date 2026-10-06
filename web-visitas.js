/* STUDIO — contador de visitas de la página pública (06-oct-2026, migración 51).
   Sin datos personales: manda solo la página, de dónde llegó, el tipo de equipo y un número al azar del navegador
   (para contar visitantes distintos). No cuenta los equipos del personal (cookie studio_staff) ni robots.
   La página se marca con <html data-pagina="tienda|lq-n9|mayoristas">. Nunca frena la página: corre al final y en silencio. */
(function () {
  'use strict';
  try {
    if (/(?:^|;\s*)studio_staff=1(?:;|$)/.test(document.cookie || '')) return;
    var ua = navigator.userAgent || '';
    if (/bot|crawl|spider|slurp|facebookexternalhit|preview|lighthouse|headless|pingdom|uptime/i.test(ua)) return;
    if (navigator.webdriver && !/[?&]qa-visitas=1/.test(location.search)) return;
    var SB = 'https://edbknlkjnlfmkkiizdbe.supabase.co';
    var ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVkYmtubGtqbmxmbWtraWl6ZGJlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAwMjg3MTYsImV4cCI6MjEwNTYwNDcxNn0.WKAda5kdWH9TxT0YbMNhJu-DoLFmXgLyrJFGD7Nr2Ec';
    var pagina = (document.documentElement.getAttribute('data-pagina') || 'tienda');
    var vis = '';
    try { vis = localStorage.getItem('studio_vis') || ''; } catch (e) {}
    if (!/^[a-z0-9]{8,24}$/.test(vis)) {
      var b = new Uint8Array(10); (window.crypto || window.msCrypto).getRandomValues(b);
      vis = Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
      try { localStorage.setItem('studio_vis', vis); } catch (e) {}
    }
    var q = new URLSearchParams(location.search);
    var utm = (q.get('utm_source') || '').toLowerCase();
    var ref = ''; try { ref = document.referrer ? new URL(document.referrer).hostname.toLowerCase() : ''; } catch (e) {}
    if (ref === location.hostname) ref = '';
    var origen =
      /instagram|^ig$/.test(utm) || q.has('igshid') || /instagram\.com$/.test(ref) || /Instagram/.test(ua) ? 'instagram' :
      /whatsapp|^wa$/.test(utm) || /whatsapp\.com$|wa\.me$/.test(ref) || /WhatsApp/.test(ua) ? 'whatsapp' :
      /tiktok/.test(utm) || /tiktok\.com$/.test(ref) || /musical_ly|TikTok/.test(ua) ? 'tiktok' :
      /facebook|^fb$/.test(utm) || q.has('fbclid') || /facebook\.com$|fb\.me$|fb\.com$/.test(ref) || /FBAN|FBAV/.test(ua) ? 'facebook' :
      /google/.test(utm) || /(^|\.)google\./.test(ref) ? 'google' :
      (!ref && !utm) ? 'directo' : 'otro';
    var tableta = /iPad|Tablet/i.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1) || (/Android/.test(ua) && !/Mobile/.test(ua));
    var dispositivo = tableta ? 'tableta' : /Mobi|iPhone|iPod|Android/i.test(ua) ? 'celular' : 'computadora';
    var enviar = function () {
      try {
        fetch(SB + '/rest/v1/rpc/web_registrar_visita', {
          method: 'POST', keepalive: true,
          headers: { apikey: ANON, Authorization: 'Bearer ' + ANON, 'Content-Type': 'application/json' },
          body: JSON.stringify({ p_pagina: pagina, p_origen: origen, p_dispositivo: dispositivo, p_visitante: vis })
        }).catch(function () {});
      } catch (e) {}
    };
    // Solo cuando la persona de verdad ve la página (no en páginas precargadas en segundo plano)
    var listo = function () { setTimeout(enviar, 1200); };
    if (document.visibilityState === 'visible') listo();
    else document.addEventListener('visibilitychange', function f() { if (document.visibilityState === 'visible') { document.removeEventListener('visibilitychange', f); listo(); } });
  } catch (e) {}
})();
