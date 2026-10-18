/* ============ settings.js — ajustes de este dispositivo ============
 * Se guardan en el navegador (no en la cuenta): cada PC o móvil tiene los
 * suyos. El volumen lo guarda audio.js aparte.
 *
 *   quality     'auto' | 'high' | 'mid' | 'low'   efectos y partículas
 *   dmgNumbers  true/false                        números de daño
 *   calm        true/false                        menos sacudidas y destellos
 *   fps         true/false                        contador de FPS
 *   stick       0.8 | 1 | 1.25                    tamaño del joystick táctil
 *   stickMode   'float' | 'fixed'                 joystick donde pones el dedo, o siempre en su sitio
 *   pad         { bar, pause, stick } | null      dónde van los botones en móvil (centro, en
 *                                                 proporción a la pantalla); lo pone layout-ui.js
 *
 *   G.Settings.get('quality')  ·  G.Settings.set('fps', true)  ·  G.Settings.on(fn)
 *   G.Settings.fx   nivel efectivo 0 (bajo) .. 2 (alto), ya resuelto el 'auto'
 */
G.Settings = (() => {
  const KEY = 'ps.settings';
  const DEF = { quality: 'auto', dmgNumbers: true, calm: false, fps: false, stick: 1, stickMode: 'float', pad: null, attackOpacity: 1, healthPosition: 'hud', healthNumbers: true, fontStyle: 'pixel', bonusPosition: 'right' };
  let s = Object.assign({}, DEF);
  try { Object.assign(s, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { /* nada */ }
  const opacity = v => typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1,v)) : 1;
  s.attackOpacity=opacity(s.attackOpacity);
  if(!['hud','below'].includes(s.healthPosition)) s.healthPosition='hud';
  if(typeof s.healthNumbers!=='boolean') s.healthNumbers=true;
  if(!['smooth','pixel'].includes(s.fontStyle)) s.fontStyle='pixel';
  if(!['left','right','hidden'].includes(s.bonusPosition)) s.bonusPosition='right';
  function applyFont() {
    if(document.documentElement?.dataset) document.documentElement.dataset.font=s.fontStyle;
    if(s.fontStyle==='pixel' && document.fonts) document.fonts.load('12px "Cubic 11"').catch(()=>console.warn('[Settings] pixel_font_load_failed'));
  }
  applyFont();
  // Also cover hard-coded Canvas font families, including measurement and non-Chinese UI.
  if(typeof CanvasRenderingContext2D!=='undefined') for(const method of ['fillText','strokeText','measureText']) {
    const original=CanvasRenderingContext2D.prototype[method];
    if(typeof original!=='function') continue;
    CanvasRenderingContext2D.prototype[method]=function(...args) {
      const before=this.font;
      if(s.fontStyle==='pixel') this.font=before.replace(/^((?:.*?\s)?[0-9.]+px(?:\/[^ ]+)?\s+).+$/, '$1"Cubic 11",system-ui,sans-serif');
      else if(before.includes('Cubic 11')) this.font=before.replace(/"Cubic 11",?/, 'system-ui,');
      try{return original.apply(this,args);}finally{this.font=before;}
    };
  }
  const fns = new Set();

  // Calidad automática: empieza alta (media en móvil) y baja si va a tirones.
  const touchy = matchMedia('(pointer: coarse)').matches;
  let autoLevel = touchy ? 1 : 2;
  let acc = 0, frames = 0, slowT = 0, fastT = 0;

  function save() { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* nada */ } }
  function get(k) { return s[k]; }
  function set(k, v) { if(k==='fontStyle'&&!['smooth','pixel'].includes(v)) return; if(k==='bonusPosition'&&!['left','right','hidden'].includes(v)) return; if(k==='attackOpacity') v=opacity(v); if(k==='healthPosition'&&!['hud','below'].includes(v)) return; if(k==='healthNumbers'&&typeof v!=='boolean') return; s[k] = v; if(k==='fontStyle') applyFont(); save(); fns.forEach(fn => { try { fn(k, v); } catch (e) { /* nada */ } }); }

  /** Lo llama el bucle del juego en cada fotograma (sólo durante la partida). */
  function sample(dt) {
    if (s.quality !== 'auto' || dt <= 0) return;
    acc += dt; frames++;
    if (acc < 1) return;
    const fps = frames / acc;
    acc = 0; frames = 0;
    // 3 s seguidos por debajo de 45 FPS: baja un nivel; 8 s por encima de 57: sube.
    if (fps < 45) { slowT++; fastT = 0; } else if (fps > 57) { fastT++; slowT = 0; } else { slowT = fastT = 0; }
    if (slowT >= 3 && autoLevel > 0) { autoLevel--; slowT = 0; }
    if (fastT >= 8 && autoLevel < (touchy ? 1 : 2)) { autoLevel++; fastT = 0; }
  }

  return {
    get, set, sample, DEF,
    on(fn) { fns.add(fn); },
    get all() { return Object.assign({}, s); },
    get fx() { return s.quality === 'auto' ? autoLevel : s.quality === 'high' ? 2 : s.quality === 'mid' ? 1 : 0; },
    get autoLevel() { return autoLevel; },
    get touch() { return touchy; }
  };
})();
