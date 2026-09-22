/* STUDIO · WhatsApp loader (2026-09-22)
   Carga el Inbox corporativo de WhatsApp y sus capas visuales (parches-whatsapp-*), en el mismo
   orden que tenían en NEXUS PRO, SOLO cuando la bandera pos_config.whatsapp_inbox está activa.
   Mientras STUDIO no tenga su propio backend de WhatsApp (tablas whatsapp_*, RPC, Edge Functions
   y número propio), la bandera queda en false y este archivo no carga nada.
   Quedan fuera a propósito las capas que eran de Seguros: cobranza de pólizas, pagos por validar,
   solicitudes y el enrutamiento por clientes de Seguros. */
(function(){
  'use strict';
  if(window.__nxStudioWaLoader)return;
  window.__nxStudioWaLoader=true;

  var V=(typeof APP_VERSION!=='undefined'?APP_VERSION:'1');
  var pasos=[
    ['js','parches-whatsapp-inbox.js'],
    ['js','parches-whatsapp-visual.js'],
    ['css','parches-whatsapp-visual-v2.css'],
    ['js','parches-whatsapp-visual-v3.js'],
    ['js','parches-whatsapp-visual-v4.js'],
    ['js','parches-whatsapp-visual-v5.js'],
    ['js','parches-whatsapp-visual-v6.js'],
    ['js','parches-whatsapp-visual-v7.js'],
    ['js','parches-whatsapp-contactos-uhd.js'],
    ['js','parches-whatsapp-contactos-fix.js'],
    ['js','parches-whatsapp-inbox-uhd.js'],
    ['js','parches-whatsapp-animaciones.js'],
    ['js','parches-whatsapp-iconos-flat.js'],
    ['js','parches-whatsapp-chat-acciones.js'],
    ['js','parches-whatsapp-chat-final.js'],
    ['js','parches-whatsapp-voz-mensajes.js'],
    ['js','parches-whatsapp-media-historial.js'],
    ['js','parches-whatsapp-scroll-estable.js'],
    ['js','parches-whatsapp-menu-flotante.js'],
    ['js','parches-whatsapp-aura.js'],
    ['js','parches-whatsapp-aura-compact.js'],
    ['js','parches-whatsapp-aura-size-fix.js'],
    ['js','parches-whatsapp-aura-safari-fix.js'],
    ['js','parches-whatsapp-burbuja-fit-final.js'],
    ['js','parches-whatsapp-replica-referencia.js'],
    ['js','parches-whatsapp-composer-minimal-final.js'],
    ['js','parches-whatsapp-ventana-redonda-final.js'],
    ['js','parches-whatsapp-marco-redondo-definitivo.js'],
    ['js','parches-whatsapp-send-flight.js'],
    ['js','parches-whatsapp-plantillas-facil.js'],
    ['js','parches-whatsapp-automatizaciones.js'],
    ['js','parches-whatsapp-reglas-inteligentes.js'],
    ['js','parches-whatsapp-automatizaciones-acceso-mobile.js'],
    ['js','parches-whatsapp-admin-delete.js'],
    ['js','parches-whatsapp-sin-3d.js'],
    ['js','parches-whatsapp-iconos-sistema.js'],
    ['js','parches-whatsapp-motion-v2.js'],
    ['js','parches-whatsapp-texto-natural.js'],
    ['js','parches-whatsapp-inbox-compact-mobile.js']
  ];

  function load(src,done){
    var s=document.createElement('script');
    s.src=src+'?v='+V; s.async=false;
    s.onload=function(){if(done)done();};
    s.onerror=function(){console.error('[STUDIO] No se pudo cargar '+src);if(done)done();};
    (document.head||document.documentElement).appendChild(s);
  }
  function css(src){
    var l=document.createElement('link');
    l.rel='stylesheet'; l.href=src+'?v='+V;
    (document.head||document.documentElement).appendChild(l);
  }
  function correr(i){
    if(i>=pasos.length){try{window.dispatchEvent(new Event('nexus:reinit'));}catch(e){}return;}
    var p=pasos[i];
    if(p[0]==='css'){css(p[1]);correr(i+1);}
    else load(p[1],function(){correr(i+1);});
  }

  // Espera a que parches-pos.js haya leído pos_config (hasta ~60 s: la sesión puede tardar).
  var n=0;
  (function esperar(){
    n++;
    if(window.nxPosCfgListo===true){
      if(typeof window.nxPosFlag==='function'&&window.nxPosFlag('whatsapp_inbox'))correr(0);
      return;
    }
    if(n<400)setTimeout(esperar,150);
  })();
})();
