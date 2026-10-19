/* External boot: no dynamic code or inline execution; keep Traditional Chinese. */
window.PS_PAGES=!!document.querySelector('meta[name=ps-pages]');
(function () {
    var s = null; try { s = localStorage.getItem('ps.lang'); } catch (e) { s=null; }
    var n = ((navigator.languages && navigator.languages[0]) || navigator.language || 'es').toLowerCase();
    var byPath=/\/zh-TW(\/|$)/i.test(location.pathname)?'zh-TW':/\/en(\/|$)/.test(location.pathname)?'en':null;
    var l=['es','en','zh-TW'].includes(s)?s:byPath||(n.indexOf('zh')===0?'zh-TW':n.indexOf('es')===0?'es':'en');
    document.documentElement.lang = l==='zh-TW'?'zh-Hant':l;
    if(l==='zh-TW'){var z=document.querySelectorAll('#boot p');z[0].textContent='與寶可夢夥伴一起迎戰大軍';z[1].textContent='載入中…';}
    if (l === 'en') {
      var p = document.querySelectorAll('#boot p');
      p[0].textContent = 'A Pokémon survival game, free in your browser and on mobile.';
      p[1].textContent = 'Loading…';
    }
  })();
