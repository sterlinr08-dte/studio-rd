/* STUDIO · Luz de vidrio y brillo fijo (04-oct-2026, dueño: «vamos a ponerle los efectos reflector que hicimos a
   NEXUS PRO»). Port de parches-vidrio-global.js (NEXUS PRO 59.05–59.07), solo visual:
   1) REFLECTOR: una sola capa flotante (position:fixed, pointer-events:none, aria-hidden) que se desliza con resorte
      sobre lo que se señala o toca, se inclina hacia el puntero, toma el color de los botones de color, onda desde el
      clic, se aparta al desplazar o escribir. En el iPhone, destello al tocar y sigue al dedo al deslizar listas.
   2) BRILLO FIJO: lo elegido (pestaña, filtro, chip, ítem del menú) lleva una rayita de luz fija arriba; en el menú
      lateral, vertical a la izquierda.
   No toca datos ni lógica. Con «reducir movimiento» no se carga. Dibujo en studio-pulido.css §30–31. */
(function(){
  'use strict';
  if(window.__nxVidrioGlobal)return;
  window.__nxVidrioGlobal=true;
  if(!document.documentElement.classList.contains('nx-studio'))return;
  var mq=function(q){return !!(window.matchMedia&&window.matchMedia(q).matches);};
  if(mq('(prefers-reduced-motion: reduce)'))return;
  var FINO=mq('(hover: hover) and (pointer: fine)');
  if(!FINO&&navigator.deviceMemory&&navigator.deviceMemory<=2)return; // celulares muy limitados: nada
  var TOCABLE='button,a[href],[role="button"],[role="tab"],[role="menuitem"],[role="option"],[role="switch"],summary,select,label[for],.ni,.btn,.ab,.chip,.nxTNav,.facQ,[onclick],[tabindex="0"]';
  var NO='input,textarea,[contenteditable="true"],.nx-vidrio-no,iframe,video,canvas';
  var GRUPO='.nxTSide,.facQs,.toolbar2,.nxTTop,nav,[role="tablist"],[role="menu"],[role="listbox"],[role="toolbar"],ul,ol,.sb-nav,.tn-r,thead,tbody,form';
  var capa=null,actual=null,raf=0,visible=false,ultimo=0,prev=null,mx=0,my=0,tScroll=0,escribiendo=false,tSalir=0,apagadoEn=0;

  function crear(){
    if(capa&&document.body.contains(capa))return capa;
    capa=document.createElement('div');capa.className='nx-vidrio';capa.setAttribute('aria-hidden','true');
    document.body.appendChild(capa);return capa;
  }
  function objetivo(t){
    if(!t||!t.closest)return null;
    if(t.closest(NO))return null;
    var el=t.closest(TOCABLE);
    if(!el||el===document.body||el===document.documentElement)return null;
    if(el.disabled||el.getAttribute('aria-disabled')==='true')return null;
    // Tarjetas (clientes, pólizas, prospectos…): la luz abarca la tarjeta entera, no solo la zona tocable de adentro.
    // Solo si lo tocable es la parte principal (≥ 35 % de la tarjeta/fila): un chip dentro de una fila de chips no
    // ilumina la fila entera.
    var card=el.parentElement&&el.parentElement.closest('[class*="Card"],[class*="card"],[class*="row"],[class*="Row"],[class*="item"],[class*="fila"]');
    if(card&&card!==el&&card.contains(el)&&!card.closest(NO)&&(el.parentElement===card||el.parentElement.parentElement===card)){
      var rc=card.getBoundingClientRect(),re=el.getBoundingClientRect();
      // …o si es lo ÚNICO tocable entre sus hermanos (la zona del nombre en una fila de clientes).
      var hermanos=0,ch=el.parentElement.children;
      for(var i=0;i<ch.length;i++){if(ch[i]!==el&&ch[i].matches&&ch[i].matches(TOCABLE))hermanos++;}
      if(rc.height>=40&&rc.height<=260&&rc.width<=window.innerWidth&&(re.width*re.height>=0.35*rc.width*rc.height||hermanos===0))el=card;
    }
    var r=el.getBoundingClientRect();
    // Controles y tarjetas/filas tocables: nada diminuto ni paneles enteros (fondos de ventanas, secciones).
    if(r.width<14||r.height<14||r.height>260||r.width>window.innerWidth)return null;
    if(r.height>120&&!/card|row|item|fila/i.test(el.className||'')&&el.tagName!=='TR')return null;
    return el;
  }
  // Táctil: si el dedo está sobre los datos de una fila o tarjeta (agente, prima…), la luz toma la fila entera, siempre
  // que la fila tenga algo que la abra (nombre del cliente, etc.).
  var FILA='[class*="Card"],[class*="card"],[class*="row"],[class*="Row"],[class*="item"],[class*="fila"]';
  function objetivoTactil(t){
    var el=objetivo(t);
    if(el)return el;
    if(!t||!t.closest||t.closest(NO))return null;
    var f=t.closest(FILA);
    if(!f||f===document.body)return null;
    var r=f.getBoundingClientRect();
    if(r.height<40||r.height>260||r.width>window.innerWidth)return null;
    return f.querySelector('[role="button"],[onclick],a[href]')?f:null;
  }
  function grupoDe(el){var g=el.parentElement&&el.parentElement.closest(GRUPO);return g||el.parentElement;}
  // ¿Deslizar o aparecer? Solo se desliza entre vecinos: mismo grupo y a menos de 320 px.
  function vecinos(a,b){
    if(!a||!b||!document.documentElement.contains(a))return false;
    var ra=a.getBoundingClientRect(),rb=b.getBoundingClientRect();
    var d=Math.hypot((ra.left+ra.width/2)-(rb.left+rb.width/2),(ra.top+ra.height/2)-(rb.top+rb.height/2));
    return d<Math.max(320,(ra.height+rb.height)*1.3)&&(a.parentElement===b.parentElement||grupoDe(a)===grupoDe(b));
  }
  function recorte(el,r){
    var top=0,left=0,right=window.innerWidth,bottom=window.innerHeight,p=el.parentElement,n=0;
    while(p&&p!==document.body&&n<12){
      var cs=getComputedStyle(p);
      if(/(auto|scroll|hidden|clip)/.test(cs.overflowY+cs.overflowX)){
        var q=p.getBoundingClientRect();
        top=Math.max(top,q.top);left=Math.max(left,q.left);right=Math.min(right,q.right);bottom=Math.min(bottom,q.bottom);
      }
      p=p.parentElement;n++;
    }
    return 'inset('+Math.max(0,top-r.top).toFixed(1)+'px '+Math.max(0,r.right-right).toFixed(1)+'px '+Math.max(0,r.bottom-bottom).toFixed(1)+'px '+Math.max(0,left-r.left).toFixed(1)+'px)';
  }
  // Color del botón (si es un botón de color: azul, rojo, verde…) para teñir la luz.
  function tinte(cs){
    var re=/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/;
    var m=re.exec(cs.backgroundColor||'');
    // Muchos botones de color usan degradado: entonces el color sale del degradado.
    if(!m||(m[4]!==undefined&&+m[4]<0.35))m=re.exec(cs.backgroundImage||'')||m;
    if(!m)return '';
    var r=+m[1],g=+m[2],b=+m[3],a=m[4]===undefined?1:+m[4];
    if(a<0.35)return '';
    var mx_=Math.max(r,g,b),mn=Math.min(r,g,b);
    if(mx_-mn<60)return ''; // grises: sin tinte
    return Math.min(255,r+40)+','+Math.min(255,g+40)+','+Math.min(255,b+40);
  }
  function esActivo(el){
    return el.classList.contains('on')||el.classList.contains('active')||el.classList.contains('activo')||
      el.getAttribute('aria-current')==='page'||el.getAttribute('aria-selected')==='true'||el.getAttribute('aria-pressed')==='true';
  }
  function colocar(el,deslizar){
    var c=crear(),r=el.getBoundingClientRect(),cs=getComputedStyle(el);
    var rad=parseFloat(cs.borderTopLeftRadius)||0;
    if(rad<6)rad=Math.min(10,r.height/2);
    if(rad>r.height/2)rad=r.height/2;
    if(!deslizar)c.classList.add('sin');
    c.style.setProperty('--v-x',r.left.toFixed(1)+'px');
    c.style.setProperty('--v-y',r.top.toFixed(1)+'px');
    c.style.setProperty('--v-w',r.width.toFixed(1)+'px');
    c.style.setProperty('--v-h',r.height.toFixed(1)+'px');
    c.style.setProperty('--v-r',rad.toFixed(1)+'px');
    c.style.clipPath=recorte(el,r);
    var t=tinte(cs);
    if(t){c.style.setProperty('--v-tinte',t);c.classList.add('tinte');}else{c.classList.remove('tinte');}
    c.classList.toggle('alto',r.height>56);
    c.classList.toggle('oscuro',!!el.closest('.nxTSide,.nxTTop'));
    c.classList.toggle('actual',esActivo(el));
    iman(r);
    if(!deslizar){void c.offsetWidth;c.classList.remove('sin');}
  }
  // Imán: la luz se inclina un poco hacia el puntero y su brillo de arriba lo sigue.
  function iman(r){
    if(!capa||!r)return;
    var cx=r.left+r.width/2,cy=r.top+r.height/2;
    var dx=Math.max(-1,Math.min(1,(mx-cx)/(r.width/2||1))),dy=Math.max(-1,Math.min(1,(my-cy)/(r.height/2||1)));
    capa.style.setProperty('--v-dx',(dx*Math.min(3,r.width*0.04)).toFixed(2)+'px');
    capa.style.setProperty('--v-dy',(dy*Math.min(2,r.height*0.04)).toFixed(2)+'px');
    capa.style.setProperty('--v-mx',(Math.max(0,Math.min(100,(mx-r.left)/r.width*100))).toFixed(1)+'%');
  }
  function pintar(){
    raf=0;
    if(!actual)return;
    if(!document.documentElement.contains(actual)){apagar();return;}
    var r=actual.getBoundingClientRect();
    if(r.width<1){apagar();return;}
    // Si la luz se apagó hace un instante (cruzó un hueco), recuerda dónde estaba y se desliza desde ahí.
    var reciente=visible||(Date.now()-apagadoEn<450);
    var deslizar=reciente&&prev&&prev!==actual&&vecinos(prev,actual);
    if(prev===actual&&visible){iman(r);return;}
    colocar(actual,deslizar);
    crear().classList.add('on');visible=true;prev=actual;
  }
  function apagar(){if(capa){capa.classList.remove('on','press');}visible=false;actual=null;prev=null;}
  function programar(){if(!raf)raf=requestAnimationFrame(pintar);}
  function onda(ev,el){
    if(!capa||!el)return;
    var r=el.getBoundingClientRect();
    capa.style.setProperty('--v-ox',(ev.clientX-r.left).toFixed(1)+'px');
    capa.style.setProperty('--v-oy',(ev.clientY-r.top).toFixed(1)+'px');
    capa.classList.remove('onda');void capa.offsetWidth;capa.classList.add('onda');
  }

  document.addEventListener('visibilitychange',function(){if(document.hidden)apagar();});
  window.addEventListener('blur',apagar,{passive:true});

  if(FINO){
    document.addEventListener('pointermove',function(ev){
      if(ev.pointerType&&ev.pointerType!=='mouse')return;
      mx=ev.clientX;my=ev.clientY;
      if(escribiendo){escribiendo=false;if(capa)capa.classList.remove('quieto');}
      var el=objetivo(ev.target);
      if(el===actual){if(el)programar();return;}
      // Huecos entre controles (márgenes del menú, separaciones): la luz espera 140 ms antes de apagarse, así al
      // llegar al siguiente control se desliza en vez de apagarse y reaparecer.
      if(!el){
        actual=null;
        if(!tSalir)tSalir=setTimeout(function(){tSalir=0;if(!actual){if(capa)capa.classList.remove('on');visible=false;apagadoEn=Date.now();}},140);
        return;
      }
      if(tSalir){clearTimeout(tSalir);tSalir=0;}
      actual=el;
      programar();
    },{passive:true});
    document.addEventListener('pointerdown',function(ev){
      if(ev.pointerType&&ev.pointerType!=='mouse')return;
      if(actual&&capa){capa.classList.add('press');onda(ev,actual);}
    },{passive:true});
    document.addEventListener('pointerup',function(){if(capa)capa.classList.remove('press');},{passive:true});
    document.addEventListener('pointerleave',apagar,{passive:true});
    // Desplazarse: se esconde y vuelve sobre el control que quede debajo al quedarse quieto.
    window.addEventListener('scroll',function(){
      if(!capa)return;
      capa.classList.add('quieto');clearTimeout(tScroll);
      tScroll=setTimeout(function(){
        capa.classList.remove('quieto');
        var bajo=document.elementFromPoint(mx,my);
        actual=objetivo(bajo);visible=false;prev=null;
        if(actual)programar();else capa.classList.remove('on');
      },140);
    },{passive:true,capture:true});
    window.addEventListener('resize',function(){if(actual){visible=false;programar();}},{passive:true});
    // Escribir: la luz se aparta; Tab: la luz acompaña al control enfocado (teclado).
    document.addEventListener('keydown',function(ev){
      if(ev.key==='Tab')return;
      if(capa&&!escribiendo){escribiendo=true;capa.classList.add('quieto');}
    },true);
    document.addEventListener('focusin',function(ev){
      var el=ev.target;
      try{if(!el.matches(':focus-visible'))return;}catch(e){return;}
      var o=objetivo(el);if(!o)return;
      escribiendo=false;if(capa)capa.classList.remove('quieto');
      var r=o.getBoundingClientRect();mx=r.left+r.width/2;my=r.top+r.height/2;
      actual=o;programar();
    },true);
    // Si la pantalla se redibuja y el control desaparece, se apaga.
    document.addEventListener('click',function(){setTimeout(function(){if(actual&&!document.documentElement.contains(actual))apagar();},60);},{passive:true,capture:true});
  }else{
    // Táctil (iPhone): al tocar, la luz aparece con onda desde el dedo y se queda mientras el dedo está puesto.
    // Al DESLIZAR una lista se apaga al instante (dueño 05-oct-2026, igual que en NEXUS PRO 59.13): antes perseguía al
    // dedo de tarjeta en tarjeta con resorte y, con el desplazamiento, quedaba atrasada y cruzada entre dos tarjetas.
    var tocando=false,tFade=0,tVivo=0;
    function apagarYa(){clearTimeout(tFade);if(capa){capa.classList.remove('on','onda');}visible=false;prev=null;actual=null;}
    function fade(ms){clearTimeout(tFade);tFade=setTimeout(function(){if(!tocando)apagarYa();},ms);}
    document.addEventListener('pointerdown',function(ev){
      if(ev.pointerType==='mouse')return;
      var el=objetivoTactil(ev.target);
      tocando=true;tVivo=Date.now();
      if(!el)return;
      mx=ev.clientX;my=ev.clientY;
      var deslizar=visible&&prev&&prev!==el&&vecinos(prev,el);
      colocar(el,deslizar);crear().classList.add('on');visible=true;prev=el;actual=el;
      onda(ev,el);clearTimeout(tFade);
    },{passive:true});
    function soltar(){tocando=false;fade(450);}
    document.addEventListener('pointerup',soltar,{passive:true});
    document.addEventListener('touchend',soltar,{passive:true});
    document.addEventListener('pointercancel',function(){tocando=false;apagarYa();},{passive:true}); // empezó a desplazar
    window.addEventListener('scroll',function(){
      if(!visible)return;
      if(Date.now()-tVivo>2500&&!tocando)return; // desplazamientos que no hizo el dedo (programáticos): nada
      apagarYa();
    },{passive:true,capture:true});
  }
})();

/* 2) BRILLO FIJO en lo elegido (port de parches-brillo-fijo.js de NEXUS PRO 59.07, sin la parte de WhatsApp). */
(function(){
  'use strict';
  if(window.__nxBrilloFijo)return;
  window.__nxBrilloFijo=true;
  if(!document.documentElement.classList.contains('nx-studio'))return;
  var SEL='.on,.active,.activo,.selected,.is-active,[aria-selected="true"],[aria-pressed="true"],[aria-current="page"]';
  var CONTROL='button,a,[role="button"],[role="tab"],[role="option"],[role="menuitem"],[onclick],.nxTNav,.chip,.tab,.btn,.ab,[class*="tab"],[class*="Tab"],[class*="chip"],[class*="pill"],[class*="seg"],[class*="Seg"],[class*="filtro"],[class*="item"]';
  // Nunca: campos, interruptores, ventanas/paneles, capas de efectos, tablas.
  var NO='input,textarea,select,[contenteditable="true"],[role="switch"],[class*="switch"],[class*="toggle"],[class*="tgl"],.nx-vidrio,.nx-vidrio-no,iframe,video,canvas,tr,td,th,dialog,[role="dialog"],[class*="overlay"],[class*="backdrop"],[class*="sheet"],[class*="drawer"],[class*="toast"]';
  var marcados=[],raf=0,vueltas=typeof WeakMap!=='undefined'?new WeakMap():null;
  function claro(el){
    var cs=getComputedStyle(el),m=/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/.exec(cs.backgroundColor||'');
    if(!m||(m[4]!==undefined&&+m[4]<0.5))return true; // transparente sobre el fondo crema: claro
    return (0.2126*m[1]+0.7152*m[2]+0.0722*m[3])/255>0.6;
  }
  function apto(el){
    if(!el||!el.matches||el.closest(NO))return false;
    if(!el.matches(CONTROL))return false;
    var r=el.getBoundingClientRect();
    return !(r.width<24||r.height<18||r.height>76||r.width>560);
  }
  function marcar(el){
    var m=el.querySelector(':scope > .nx-marca');
    var vertical=el.classList.contains('nxTNav')&&!!el.closest('.nxTSide,#nxTSide');
    if(!m){
      if(vueltas){var n=(vueltas.get(el)||0)+1;vueltas.set(el,n);if(n>40)return null;}
      m=document.createElement('nx-luz');m.className='nx-marca';m.setAttribute('aria-hidden','true');
      if(getComputedStyle(el).position==='static'){el.style.position='relative';el.setAttribute('data-nx-marca-pos','1');}
      el.appendChild(m);
    }
    m.classList.toggle('v',vertical);
    m.classList.toggle('oro',!vertical&&claro(el));
    return el;
  }
  function desmarcar(el){
    var m=el.querySelector(':scope > .nx-marca');if(m)m.remove();
    if(el.getAttribute('data-nx-marca-pos')){el.style.position='';el.removeAttribute('data-nx-marca-pos');}
  }
  function revisar(){
    raf=0;
    var nuevos=[],lista=document.querySelectorAll(SEL),x;
    for(var i=0;i<lista.length&&nuevos.length<60;i++){if(apto(lista[i])&&(x=marcar(lista[i])))nuevos.push(x);}
    for(var j=0;j<marcados.length;j++){if(nuevos.indexOf(marcados[j])<0)desmarcar(marcados[j]);}
    marcados=nuevos;
  }
  function pedir(){if(!raf)raf=requestAnimationFrame(revisar);}
  function propio(n){return n&&n.nodeType===1&&(n.classList.contains('nx-marca')||n.classList.contains('nx-vidrio'));}
  function iniciar(){
    pedir();
    new MutationObserver(function(rs){
      for(var i=0;i<rs.length;i++){
        var r=rs[i];
        if(r.type==='attributes'){if(!propio(r.target))return pedir();continue;}
        var k,n;
        for(k=0;k<r.addedNodes.length;k++){n=r.addedNodes[k];if(n.nodeType===1&&!propio(n))return pedir();}
        for(k=0;k<r.removedNodes.length;k++){n=r.removedNodes[k];if(n.nodeType===1&&!propio(n))return pedir();}
      }
    }).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','aria-selected','aria-pressed','aria-current']});
    window.addEventListener('resize',pedir,{passive:true});
    setInterval(function(){if(!document.hidden)pedir();},2000);
    document.addEventListener('transitionend',function(e){if(!propio(e.target))pedir();},true);
  }
  if(document.body)iniciar();else document.addEventListener('DOMContentLoaded',iniciar);
})();
