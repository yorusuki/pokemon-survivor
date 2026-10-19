/* Read boundaries for public JSON. Text stays text; DOM sinks must still escape it. */
G.PublicData = (() => {
  const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v:{};
  const list=(v,max)=>Array.isArray(v)?v.slice(0,max):[];
  const text=(v,max)=>typeof v==='string'?Array.from(v).slice(0,max).join(''):'';
  const int=(v,max,fallback=0)=>typeof v==='number'&&Number.isFinite(v)?Math.max(0,Math.min(max,Math.floor(v))):fallback;
  function rank(id,input) {
    const v=object(input),dex=list(v.dex,4).map(x=>int(x,1025));
    return {id:text(id,200),t:int(v.t,86400),uids:list(v.uids,4).map(x=>text(x,128)),names:list(v.names,4).map(x=>text(x,16)),dex,
      shiny:dex.map((_,i)=>Array.isArray(v.shiny)&&v.shiny[i]===true),lv:int(v.lv,1000,1)||1,kills:int(v.kills,1e9)};
  }
  function profile(input) {
    const v=object(input),b=object(v.best);
    return {name:text(v.name,16),title:text(v.title,40),
      favs:list(v.favs,3).filter(x=>x&&Number.isInteger(x.dex)&&x.dex>0&&x.dex<=1025&&(!G.DEX_BY||G.DEX_BY[x.dex])).map(x=>({dex:x.dex,shiny:x.shiny===true})),
      best:{solo:int(b.solo,86400),group:int(b.group,86400),level:int(b.level,1000),bosses:int(b.bosses,1e9),legends:int(b.legends,1025),kills:int(b.kills,1e12),medals:int(b.medals,1000)},
      medals:list(v.medals,8).map(x=>text(x,40))};
  }
  function rows(input) {return Object.entries(object(input)).filter(([key])=>!['__proto__','prototype','constructor'].includes(key)).slice(0,200).map(([id,v])=>rank(id,v)).sort((a,b)=>b.t-a.t);}
  function report(input){const v=object(input);return {board:text(v.board,40),e:text(v.e,160),names:list(v.names,4).map(x=>text(x,16)),t:int(v.t,86400),at:int(v.at,1e15)};}
  const top=input=>Object.fromEntries(rows(input).map(({id,...row})=>[id,row]));
  return {rank,profile,rows,report,top};
})();
