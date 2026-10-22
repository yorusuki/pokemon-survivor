/* ============ settings-ui.js — pantalla de Ajustes (PC y móvil) ============
 * Se abre por encima de lo que haya (menú o pausa) y al cerrar vuelve ahí.
 * Pestañas: Sonido · Gráficos · Controles · Cuenta · Acerca de.
 * Los ajustes son de este dispositivo (G.Settings / G.Audio en el navegador).
 */
G.SettingsUI = (() => {
  const $ = G.UI.$;
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const VERSION = '3.0.0 · 2026-10-23';
  const REPO = 'https://github.com/JPTER78/pokesurvivor';
  let tab = 'sound';

  function init() {
    if(G.Settings.touch)document.querySelector('#set-tabs [data-t="a11y"]')?.classList.add('hidden');
    document.querySelectorAll('#set-tabs .gen-tab').forEach(b => { b.onclick = () => { tab = b.dataset.t; render(); }; });
    for (const ev of ['gamepadconnected','gamepaddisconnected']) addEventListener(ev,()=>{if(isOpen()&&tab==='ctl')render();});
    $('set-close').onclick = close;
    $('btn-settings').innerHTML = G.Icons.html('gear', 20);
    $('btn-settings').onclick = () => open();
    $('btn-pause-settings').onclick = () => open('sound');
    // Pantalla completa (si el navegador la permite; en iPhone, cómo conseguirla).
    if (canFull() || iosTip()) {
      $('btn-full').classList.remove('hidden');
      $('btn-full').innerHTML = G.Icons.html('full', 20);
      $('btn-full').onclick = toggleFull;
    }
  }

  function open(t) {
    if (t) tab = t;
    $('scr-settings').classList.remove('hidden');
    render();
    if(G.DB.online)G.Social.refreshAccount().then(()=>{if(isOpen()&&tab==='acc')render();}).catch(()=>{
      if(isOpen()&&tab==='acc'&&$('set-msg'))$('set-msg').textContent=G.T('No se pudo cargar la cuenta. Inténtalo de nuevo.');
    });
  }
  function close() { $('scr-settings').classList.add('hidden'); }
  const isOpen = () => !$('scr-settings').classList.contains('hidden');

  // ---------------- pantalla completa ----------------
  function canFull() { return !!(document.fullscreenEnabled || document.webkitFullscreenEnabled); }
  function isFull() { return !!(document.fullscreenElement || document.webkitFullscreenElement); }
  // iPhone: Safari no deja poner una web a pantalla completa (por eso a veces
  // no salía la opción). Sí se puede abriéndola desde la pantalla de inicio.
  const IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = () => !!navigator.standalone || (window.matchMedia && matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches);
  function iosTip() { return IOS && !canFull() && !standalone(); }
  const IOS_TIP = 'En iPhone, Safari no deja poner las webs a pantalla completa. Pulsa Compartir y luego "Añadir a pantalla de inicio": abriendo el juego desde ese icono se juega a pantalla completa.';
  function toggleFull() {
    if (!canFull()) { if (iosTip()) G.UI.toast(IOS_TIP, 9000); return; }
    if (isFull()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    else {
      const el = document.documentElement;
      const p = (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
      // En móvil, además se intenta fijar la pantalla en horizontal.
      if (p && p.then) p.then(() => { try { screen.orientation.lock('landscape').catch(() => {}); } catch (e) { /* nada */ } }).catch(() => {});
    }
    setTimeout(() => { if (isOpen()) render(); }, 300);
  }

  // ---------------- piezas ----------------
  function section(title, sub) { return `<h3 class="set-h">${esc(title)}</h3>${sub ? `<p class="sub">${sub}</p>` : ''}`; }
  function toggle(key, label, desc) {
    const on = !!G.Settings.get(key);
    return `<div class="set-row"><div class="grow"><b>${esc(label)}</b><small>${esc(desc)}</small></div>
      <button class="btn small switch ${on ? 'gold' : ''}" data-k="${key}">${on ? 'Sí' : 'No'}</button></div>`;
  }
  function choice(key, opts) {
    const cur = G.Settings.get(key);
    return `<div class="chips set-chips">${opts.map(([v, l]) => `<button class="chip ${v === cur ? 'on' : ''}" data-k="${key}" data-v="${v}">${esc(l)}</button>`).join('')}</div>`;
  }

  function render() {
    document.querySelectorAll('#set-tabs .gen-tab').forEach(b => b.classList.toggle('on', b.dataset.t === tab));
    const box = $('set-body');
    box.scrollTop = 0;
    if (tab === 'sound') {
      box.innerHTML = section('Sonido') + '<div id="set-sound" class="sound-inline"></div>';
      G.UI.soundControls($('set-sound'));
    } else if (tab === 'gfx') {
      const auto = ['baja', 'media', 'alta'][G.Settings.autoLevel];
      box.innerHTML = section('Idioma', 'El juego se recarga al cambiarlo.')
        + `<div class="chips set-chips" translate="no">${[['es', 'Español'], ['en', 'English'], ['zh-TW', '繁體中文']].map(([v, l]) =>
             `<button class="chip ${G.I18n.lang === v ? 'on' : ''}" data-lang="${v}">${l}</button>`).join('')}</div>`
        + section('Fuente de la interfaz')
        + choice('fontStyle', [['smooth','Suave'],['pixel','Cubic 11 · Píxel']])
        + section('Panel de bonificaciones')
        + choice('bonusPosition', [['left','Abajo a la izquierda'],['right','Abajo a la derecha'],['hidden','No mostrar']])
        + section('Calidad', G.I18n.f('Ajusta los efectos y las partículas. En modo automático, la calidad baja si el juego pierde fluidez. Calidad actual: {x}.', G.T(auto)))
        + choice('quality', [['auto', 'Auto'], ['high', 'Alta'], ['mid', 'Media'], ['low', 'Baja']])
        + section('Opacidad de ataques aliados', 'Solo cambia los efectos visuales; no reduce el daño ni oculta ataques enemigos.')
        + `<div class="set-row"><input aria-label="${esc(G.T('Opacidad de ataques aliados'))}" type="range" min="0" max="100" step="5" id="set-attack-opacity" value="${Math.round(G.Settings.get('attackOpacity')*100)}"><output id="set-attack-value">${Math.round(G.Settings.get('attackOpacity')*100)}%</output></div>`
        + section('Vida del personaje')
        + choice('healthPosition', [['hud','Esquina superior'],['below','Debajo del personaje']])
        + toggle('healthNumbers','Mostrar vida numérica','Muestra la vida actual y máxima junto a la barra.')
        + section('Pantalla')
        + toggle('dmgNumbers', 'Números de daño', 'Los números que salen al golpear y al recibir daño.')
        + toggle('calm', 'Menos sacudidas y destellos', 'La cámara tiembla menos y los fogonazos son suaves.')
        + toggle('fps', 'Mostrar FPS', 'Fotogramas por segundo, en la esquina de abajo.')
        + (canFull() ? `<div class="set-row"><div class="grow"><b>Pantalla completa</b><small>Sin barras del navegador.</small></div>
             <button class="btn small" id="set-full">${isFull() ? 'Salir de pantalla completa' : 'Activar'}</button></div>`
           : iosTip() ? `<div class="set-row"><div class="grow"><b>Pantalla completa</b><small>${esc(IOS_TIP)}</small></div></div>` : '');
    } else if (tab === 'ctl') {
      const pn = G.Pad.name;
      box.innerHTML = section('Con mando', pn
          ? 'Mando conectado: <b translate="no">' + esc(pn.replace(/\s*\(.*$/, '')) + '</b>'
          : 'Xbox, PlayStation, Switch y la mayoría de mandos USB o Bluetooth. Conéctalo y pulsa cualquier botón.')
        + toggle('gamepad', 'Usar mando', 'Moverte, cambiar de ataque y manejar los menús con el mando.')
        + toggle('padRumble', 'Vibración', 'El mando vibra al recibir daño (si el mando y el navegador lo permiten).')
        + `<div class="keys">
             <div><span class="padkey">Stick izq.</span> o <span class="padkey">Cruceta</span></div><span>moverse · elegir en los menús</span>
             <div><span class="padkey">LB</span> / <span class="padkey">RB</span></div><span>ataque anterior / siguiente</span>
             <div><span class="padkey">Start</span></div><span>pausa</span>
             <div><span class="padkey">A</span></div><span>pulsar (en los menús) · saltar la animación de Arceus</span>
             <div><span class="padkey">B</span></div><span>atrás / cerrar</span>
             <div><span class="padkey">Y</span></div><span>cambiar las cartas al subir de nivel</span>
             <div><span class="padkey">Stick der.</span></div><span>desplazar las listas · apuntar (si activas Apuntar a mano en Accesibilidad)</span>
           </div>`
        + section('En móvil o tablet')
        + `<p class="sub">Pon el dedo en cualquier parte y arrastra para moverte: el joystick aparece donde tocas. Toca un ataque de abajo para cambiarlo y el botón de arriba a la derecha para pausar. Se juega en horizontal.</p>`
        + `<div class="set-row"><div class="grow"><b>Tamaño del joystick</b><small>Cuánto hay que arrastrar el dedo.</small></div></div>`
        + choice('stick', [[0.8, 'Pequeño'], [1, 'Mediano'], [1.25, 'Grande']])
        + `<div class="set-row"><div class="grow"><b>Colocar los botones</b><small>Pon los ataques, la pausa y el joystick (fijo, si quieres) donde quieras de la pantalla.</small></div>
             <button class="btn small" id="set-layout">Colocar</button></div>`
        + section('En PC')
        + `<div class="keys">
             <div><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> o flechas</div><span>moverse</span>
             <div><kbd>1</kbd>–<kbd>4</kbd> o clic en el icono</div><span>elegir ataque</span>
             <div><kbd>Q</kbd> / <kbd>E</kbd></div><span>ataque anterior / siguiente</span>
             <div><kbd>Esc</kbd> o <kbd>P</kbd></div><span>pausa</span>
             <div><kbd>1</kbd>–<kbd>3</kbd></div><span>elegir carta al subir de nivel</span>
           </div>`;
    } else if (tab === 'a11y') {
      box.innerHTML = section('Apuntado')
        + toggle('aimManual', 'Apuntar a mano', 'Tus ataques van hacia el ratón (o hacia donde empujes el stick derecho del mando) en vez de al enemigo más cercano. Si sueltas el stick y no mueves el ratón, vuelve a apuntar solo. La cadena y los meteoros siguen buscando a los enemigos solos.');
    } else if (tab === 'acc') {
      renderAccount(box);
    } else {
      box.innerHTML = `<div class="about-logo">PokéSurvivor</div><p class="sub center">Versión ${esc(VERSION)}</p>`
        + `<p class="sub">${esc(G.T('Este juego de fans es gratuito y sin ánimo de lucro. No tiene anuncios ni compras. Pokémon y sus personajes pertenecen a Nintendo, Creatures y GAME FREAK; este proyecto no está afiliado a ellas.'))}</p>`
        + section('Créditos')
        + `<ul class="credits">
             <li><b>Sprites:</b> PMD SpriteCollab y sus artistas (CC BY-NC 4.0).</li>
             <li><b>Datos de los Pokémon:</b> PokéAPI.</li>
             <li><b>Música y sonidos:</b> originales, generados por el propio juego.</li>
             <li><b>Fuente:</b> Pixelify Sans / Cubic 11 (OFL).</li>
           </ul>`
        + `<div class="row wrap" style="justify-content:center;gap:8px">
             ${window.PS_PAGES ? `<a class="btn small" href="${G.I18n.lang === 'zh-TW' ? 'zh-TW/guide/' : G.I18n.lang === 'en' ? 'en/guide/' : 'guia/'}" target="_blank">Guía y preguntas</a>
             <a class="btn small" href="${G.I18n.lang === 'zh-TW' ? 'zh-TW/pokedex/' : G.I18n.lang === 'en' ? 'en/pokedex/' : 'pokedex/'}" target="_blank">Pokédex</a>` : ''}
             <button class="btn small" data-legal>Aviso legal y privacidad</button>
             <a class="btn small" href="contacto/" target="_blank" rel="noopener">Contacto</a>
             <a class="btn small" href="${REPO}" target="_blank" rel="noopener">Código (GitHub)</a>
           </div>`;
    }
    wire(box);
  }

  function renderAccount(box) {
    const st = G.DB.guest ? 'guest' : G.DB.syncState;
    const SYNC = { ok: 'Guardado en la nube', syncing: 'Guardando…', pending: 'Pendiente de subir (se sube al salir del juego)',
                   offline: 'Sin conexión: se subirá al volver', local: 'Guardado sólo en este navegador', guest: 'Invitado: no se guarda' };
    if (G.DB.guest) {
      box.innerHTML = section('Cuenta', G.T('Modo invitado: el progreso no se conserva al salir.'))
        + `<button class="btn gold" id="set-login">Crear cuenta o entrar</button>`;
      return;
    }
    const nick = G.Social.me ? G.Social.me.name : (G.DB.user || '');
    const kind = G.DB.mode === 'local' ? 'Cuenta de este navegador' : G.DB.nameAccount ? 'Nombre y contraseña' : 'Google';
    box.innerHTML = section('Cuenta')
      + `<div class="set-row"><div class="grow"><b>Apodo</b><small>${esc(G.T('Una vez cada 24 horas. El apodo anterior queda reservado durante 7 días.'))}</small></div><span class="gold" translate="no">${esc(nick)}</span></div>`
      + (G.DB.online ? `<form id="set-rename-form" class="account-rename"><input id="set-rename-name" class="field" maxlength="16" autocomplete="off" aria-label="${esc(G.T('Nuevo apodo'))}" placeholder="${esc(G.T('Nuevo apodo'))}"><button class="btn small" id="set-rename" type="submit" ${G.Social.room||G.Game.state!=='ui'||G.Social.account?.nextRenameAt>Date.now()?'disabled':''}>${esc(G.T('Cambiar apodo'))}</button></form>
          <p class="note">${esc(G.T(G.Social.room||G.Game.state!=='ui'?'Sal de la sala y vuelve al menú antes de cambiar tu apodo.':'Tu nombre de acceso no cambia.'))}</p>
          ${G.Social.account?.loginName?`<p class="note">${esc(G.T('Nombre de acceso'))}: <span translate="no">${esc(G.Social.account.loginName)}</span></p>`:''}
          ${G.Social.account?.nextRenameAt>Date.now()?`<p class="note">${esc(G.T('Próximo cambio disponible'))}: ${esc(new Date(G.Social.account.nextRenameAt).toLocaleString())}</p>`:''}` : '')
      + `<div class="set-row"><div class="grow"><b>Tipo de cuenta</b></div><span>${esc(kind)}</span></div>`
      + `<div class="set-row"><div class="grow"><b>Estado del guardado</b></div><span>${esc(SYNC[st] || st)}</span></div>`
      + `<div class="row wrap" style="gap:8px;margin-top:12px">
           <button class="btn" id="set-logout">Cerrar sesión</button>
           <button class="btn danger" id="set-delete">Borrar cuenta</button>
         </div><p class="note" id="set-msg"></p>`;
    if(G.DB.mode==='cloud' && G.Backend.googleEnabled) {
      const node=document.createElement(G.DB.nameAccount && !G.DB.hasGoogle ? 'button':'p');
      node.textContent=G.DB.hasGoogle ? '已綁定 Google' : '綁定 Google';
      if(node.tagName==='BUTTON') { node.id='set-google'; node.className='btn'; }
      box.append(node);
    }
  }

  function wire(box) {
    const renameForm=$('set-rename-form');
    if(renameForm)renameForm.onsubmit=async e=>{
      e.preventDefault();const button=$('set-rename');button.disabled=true;
      try {
        const result=await G.Social.rename($('set-rename-name').value);
        if(!result.ok){$('set-msg').textContent=G.T(result.error);return;}
        render();$('set-msg').textContent=G.T('Apodo actualizado.');
      } catch(e) { $('set-msg').textContent=G.T('No se pudo completar la operación. Comprueba tu conexión.'); }
      finally {if(button.isConnected)button.disabled=!!G.Social.room||G.Game.state!=='ui'||G.Social.account?.nextRenameAt>Date.now();}
    };
    const opacity=$('set-attack-opacity');
    if(opacity) opacity.oninput=()=>{ G.Settings.set('attackOpacity',Number(opacity.value)/100); $('set-attack-value').textContent=Math.round(G.Settings.get('attackOpacity')*100)+'%'; };
    box.querySelectorAll('.switch[data-k]').forEach(b => { b.onclick = () => { G.Settings.set(b.dataset.k, !G.Settings.get(b.dataset.k)); render(); }; });
    box.querySelectorAll('.chip[data-k]').forEach(b => {
      b.onclick = () => { const v = b.dataset.v; G.Settings.set(b.dataset.k, isNaN(+v) ? v : +v); render(); };
    });
    const full = $('set-full'); if (full) full.onclick = toggleFull;
    const lay = $('set-layout'); if (lay) lay.onclick = () => G.LayoutUI.open();
    box.querySelectorAll('[data-lang]').forEach(b => { b.onclick = () => { if (b.dataset.lang !== G.I18n.lang) G.I18n.set(b.dataset.lang); }; });
    const lo = $('set-login'); if (lo) lo.onclick = () => { close(); leave(); };
    const out = $('set-logout'); if (out) out.onclick = () => { close(); leave(); };
    const link=$('set-google');
    if(link) link.onclick=async()=>{
      const password=await G.UI.requestPassword(); if(password===null) return;
      link.disabled=true; const r=await G.DB.linkGoogle(password);
      if(!r.ok) { $('set-msg').textContent=r.error; link.disabled=false; }
    };
    const del = $('set-delete');
    if (del) del.onclick = async () => {
      const ok = await G.UI.confirmDelete();
      if (!ok) return;
      del.disabled = true;
      const r = await G.DB.deleteAccount(ok.pass);
      if (!r.ok) { $('set-msg').textContent = r.error; del.disabled = false; return; }
      if(r.redirecting) return;
      close();
      G.UI.toast('Cuenta borrada');
      G.Audio.music(null);
      G.Flow.toLogin();
    };
  }

  /** Cerrar sesión (si estás en una partida, se abandona). */
  function leave() {
    if (G.DB.guest && !confirm('Eres invitado: se perderá todo el progreso. ¿Salir?')) return;
    if (G.Game.state !== 'ui') G.Game.quit && G.Game.quit();
    G.Audio.music(null);
    G.DB.logout().then(() => G.Flow.toLogin());
  }

  return { init, open, close, get isOpen() { return isOpen(); } };
})();
