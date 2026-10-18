/* Shared numeric view for the live HUD and level-up cards; does not change combat. */
G.Bonuses = (() => {
  const finite = v => Number.isFinite(v) ? v : 0;
  const n = (v,d=0) => finite(v).toFixed(d);
  const t = s => G.T ? G.T(s) : s;
  let panel=null, lastAt=-Infinity, lastHTML='';
  function rows(pl) {
    if(!pl) return [];
    const melee=pl.activeGroup?.().some(m=>m.kind==='melee');
    const result=[];
    const add=(id,label,value)=>result.push({id,label:t(label),value});
    const changed=(a,b)=>Number.isFinite(a)&&Math.abs(a-b)>.00001;
    if(changed(pl.maxHp,pl.mon?.hp||pl.maxHp)) add('hp','Vida máxima',n(pl.maxHp));
    if(changed(pl.atk,pl.baseAtk)) add('atk','Ataque',n(pl.atk,2));
    if(changed(pl.spd,pl.baseSpd)) add('spd','Velocidad',n(pl.spd));
    if(changed(pl.cdMul,1)) add('cd','Recarga general',n(pl.cdMul*100,1)+'%');
    if(pl.reduction>0||melee) add('def','Reducción de daño',n((1-(1-finite(pl.reduction))*(melee?.75:1))*100,1)+'%');
    if(pl.regen>0) add('rgn','Regeneración fija',n(pl.regen,1)+'/s');
    if(pl.critChance>0) add('crit','Probabilidad crítica',n(pl.critChance*100,1)+'%');
    if(changed(pl.xpMul,1)) add('xp','Experiencia personal',n(pl.xpMul*100,1)+'%');
    if(changed(pl.coinMul,1)) add('coins','Monedas',n(pl.coinMul*100,1)+'%');
    if(changed(pl.magnet,78)) add('mag','Radio de recogida',n(pl.magnet));
    if(pl.rerollBonus>0) add('reroll','Cambios restantes',n(Math.max(0,1+pl.rerollBonus-(pl.rerolls||0)))+'/'+n(1+pl.rerollBonus));
    if(pl.banned?.size) add('ban','Movimientos vetados',n(pl.banned.size));
    if(pl.item) add('item','Objeto equipado',t(G.Items?.BY?.[pl.item]?.name||pl.item));
    if(pl.power) add('power','Poder temporal',t(pl.power.def.name)+' '+n(pl.power.t)+'s');
    return result;
  }
  function summary(pl) { return rows(pl).map(r=>r.label+': '+r.value).join(' · '); }
  function cardSummary(card,pl) {
    if(!pl) return '';
    const [kind,id]=(card.key||'').split(':');
    if(kind==='stat') {
      const rule=G.LevelUp?.STATS.find(s=>s.id===id);
      if(!rule)return '';
      // Preview on a detached player; use the actual rule without FX or save writes.
      const after=Object.assign(Object.create(Object.getPrototypeOf(pl)),pl);
      after.heal=amount=>{after.hp=Math.min(after.maxHp,after.hp+amount);};
      rule.apply(after);
      const value=(p)=>{
        switch(id){
          case 'hp':return n(p.maxHp);case 'atk':return n(p.atk,2);case 'spd':return n(p.spd);
          case 'cd':return n(p.cdMul*100,1)+'%';
          case 'def':return n((1-(1-p.reduction)*(p.activeGroup?.().some(m=>m.kind==='melee')?.75:1))*100,1)+'%';
          case 'rgn':return n(p.regen,1)+'/s';case 'mag':return n(p.magnet);
          case 'xp':return n(p.xpMul*100,1)+'%';case 'heal':return n(p.hp);
          default:return '';
        }
      };
      const labels={hp:'Vida máxima',atk:'Ataque',spd:'Velocidad',cd:'Recarga general',def:'Reducción de daño',rgn:'Regeneración fija',mag:'Radio de recogida',xp:'Experiencia personal',heal:'Vida'};
      return t(labels[id])+': '+value(pl)+' → '+value(after);
    }
    const move=pl.moves?.find(m=>m.id===id);
    if(move && kind==='up') return t('Nivel actual')+': '+n(move.lvl)+' → '+n(move.lvl+1);
    return '';
  }
  function update(pl,visible) {
    const side=G.Settings.get('bonusPosition');
    if(!visible || !pl || side==='hidden') {if(panel)panel.hidden=true;return;}
    if(!panel){panel=document.createElement('aside');panel.id='run-bonuses';panel.setAttribute('aria-label',t('Bonificaciones actuales'));document.body.appendChild(panel);}
    panel.dataset.side=side;
    const now=performance.now();if(now-lastAt<250)return;lastAt=now;
    const active=rows(pl);panel.hidden=!active.length;if(!active.length)return;
    const esc=G.U.escapeHTML;
    const html='<b>'+esc(t('Bonificaciones actuales'))+'</b><dl>'+active.map(r=>'<dt>'+esc(r.label)+'</dt><dd>'+esc(r.value)+'</dd>').join('')+'</dl><small>'+esc(t('Tipos, clima de daño, órbitas y daño puro se calculan aparte.'))+'</small>';
    if(html!==lastHTML){panel.innerHTML=html;lastHTML=html;}
  }
  return {rows,summary,cardSummary,update};
})();
