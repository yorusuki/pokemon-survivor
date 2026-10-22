'use strict';
const data=require('./shop-data.json');
const own=(o,k)=>Object.hasOwn(o,k),obj=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const stamp=n=>Number.isSafeInteger(n)&&n>=0&&n<=1e15;
const move=id=>typeof id==='string'&&/^[a-z][a-z0-9-]{0,79}$/.test(id);
function map(v,max,check){return v===undefined||(obj(v)&&Object.keys(v).length<=max&&Object.entries(v).every(check));}
function dexMap(v,check){return map(v,1025,([d,e])=>/^[1-9][0-9]{0,3}$/.test(d)&&own(data.abilities,d)&&check(d,e));}
function validShopSave(s){
  return map(s.bag,3,([k,n])=>['mint','cap','caph'].includes(k)&&Number.isInteger(n)&&n>=0&&n<=999)
    &&map(s.tms,58,([k,n])=>own(data.tms,k)&&Number.isInteger(n)&&n>=0&&n<=999)
    &&dexMap(s.pnat,(_,e)=>Array.isArray(e)&&e.length===2&&data.natures.includes(e[0])&&stamp(e[1]))
    &&dexMap(s.pabil,(d,e)=>Array.isArray(e)&&e.length===2&&Number.isInteger(e[0])&&e[0]>=0&&e[0]<=2&&!!data.abilities[d][e[0]]&&stamp(e[1]))
    &&dexMap(s.ptm,(d,l)=>Array.isArray(l)&&l.length<=58&&new Set(l).size===l.length&&l.every(id=>move(id)&&own(data.tms,id)&&data.tms[id].includes(Number(d))))
    &&dexMap(s.pstart2,(_,e)=>obj(e)&&Object.keys(e).every(k=>['id','at'].includes(k))&&(e.id===''||move(e.id))&&stamp(e.at));
}
module.exports={validShopSave};
