'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.join(__dirname, '../..');
function load(lang) {
  const noop = () => {}, ctx = {};
  const c = { console, location: { pathname: '/' }, navigator: { language: lang }, localStorage: { getItem: () => lang },
    document: { documentElement: {}, createElement: () => ({ getContext: () => new Proxy({}, { get: () => noop }) }) },
    CanvasRenderingContext2D: function () {} };
  c.window = c; vm.createContext(c);
  for (const f of ['js/core/util.js', 'js/core/i18n.js', 'js/data/lang-en.js', 'js/data/lang-zh-TW.js', 'js/data/pokedex.js', 'js/data/moves.js', 'js/data/starters.js', 'js/data/items.js', 'js/core/localized-data.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), c, { filename: f });
  return c.G;
}
test('繁中名稱涵蓋全部寶可夢、招式及道具，招式 ID 不變', () => {
  const g = load('zh-TW'), report = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/terminology-zh-TW.json')));
  for (const kind of ['pokemon', 'moves', 'items']) assert.equal(report.coverage[kind].matched, report.coverage[kind].total);
  assert.equal(g.DEX_BY[1].name, '妙蛙種子');
  assert.equal(g.Moves.BY_ID['flamethrower'].name, '噴射火焰');
  assert.equal(g.Moves.BY_ID['psychic'].name, '精神強念');
  assert.equal(g.T('Psíquico'), '超能力');
  assert.equal(g.Items.LIST.find(x => x.id === 'leftovers').name, '吃剩的東西');
  assert.equal(g.T('¡Has conseguido a Bulbasaur shiny!'), '你得到了異色妙蛙種子！');
});
test('英文及西文資料不受繁中詞典污染', () => {
  const en = load('en'), es = load('es');
  assert.equal(en.T('Volver'), 'Back'); assert.equal(es.T('Volver'), 'Volver');
  assert.equal(en.DEX_BY[1].name, 'Bulbasaur'); assert.equal(es.DEX_BY[1].name, 'Bulbasaur');
});

test('測驗題目、選項與全部性格描述都有語境譯文', () => {
  const g = load('zh-TW');
  assert.equal(g.PERSONALITY_TEST.length, 8);
  for (const q of g.PERSONALITY_TEST) {
    for (const text of [q.q, ...q.a.map(a => a.t)]) {
      assert.notEqual(g.T(text), text, text);
      assert.match(g.T(text), /[\u3400-\u9fff]/, text);
    }
  }
  for (const [trait, text] of Object.entries(g.TRAIT_TEXT)) {
    const title = trait.charAt(0).toUpperCase() + trait.slice(1);
    assert.notEqual(g.T(title), title);
    assert.notEqual(g.T(text), text);
  }
  assert.equal(g.T(g.PERSONALITY_TEST[0].q), '城鎮裡有人打起來了！你會怎麼做？');
  assert.equal(g.T('Me meto a ayudar sin pensarlo.'), '想也不想，立刻上前幫忙。');
  assert.equal(g.T('Impulsivo'), '行動派');
  assert.equal(g.T('Te cuesta dar el primer paso, pero sientes mucho.'), '你不太敢主動踏出第一步，心思卻比誰都細膩。');
});

test('設定及操作中的同字異義分開處理', () => {
  const g = load('zh-TW');
  assert.equal(g.T('moverse ·'), '移動 ·');
  assert.equal(g.T('movimiento ·'), '切換招式 ·');
  assert.equal(g.T('Salir'), '登出');
  assert.equal(g.T('Salir de pantalla completa'), '離開全螢幕');
  assert.equal(g.T('Libre'), '空位');
  assert.equal(g.T('Sin asignar'), '不指定');
  assert.equal(g.T('Mediano'), '標準');
  assert.equal(g.T('Estado del guardado'), '存檔狀態');
  assert.equal(g.I18n.f('Ajusta los efectos y las partículas. En modo automático, la calidad baja si el juego pierde fluidez. Calidad actual: {x}.', g.T('media')),
    '調整特效與粒子的顯示數量。自動模式會在畫面不順暢時降低品質。目前品質：中。');
});

test('動態任務與卡池說明保留數值、屬性的正確位置', () => {
  const g = load('zh-TW');
  assert.equal(g.T('Aguanta 5 minutos con un Pokémon de tipo Fuego'), '生存 5 分鐘（使用火屬性的寶可夢）');
  assert.equal(g.T('Los 151 Pokémon de la generación 1. ¡Los legendarios esperan!'), '共有 151 隻寶可夢，皆來自第 1 世代。');
  assert.equal(g.T('Pregunta 2 de 8'), '第 2 題，共 8 題');
  assert.equal(g.T('Pausa: Alice está eligiendo…'), '遊戲暫停：Alice正在選擇…');
});

test('校訂詞典保留所有動態參數，工具不再引用機翻快取或服務', () => {
  const editorial = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/translations/zh-TW.json')));
  assert.ok(Object.keys(editorial).length >= 1500);
  for (const [source, value] of Object.entries(editorial)) {
    assert.equal((source.match(/\{x\}/g) || []).length, (value.match(/\{x\}/g) || []).length, source);
  }
  const tool = fs.readFileSync(path.join(ROOT, 'tools/localize_zh_tw.py'), 'utf8');
  assert.doesNotMatch(tool, /translate\.googleapis|machine-zh-TW|translate_batch/);
});

test('暱稱說明改版後的真實 HTML 文字均有完整繁中譯文', () => {
  const g=load('zh-TW'),html=fs.readFileSync(path.join(ROOT,'dev.html'),'utf8');
  const section=html.match(/<section id="scr-nick"[\s\S]*?<\/section>/)[0];
  const paragraphs=[...section.matchAll(/<p class="sub">([^<]+)<\/p>/g)].map(m=>m[1].trim());
  assert.equal(paragraphs.length,2);
  assert.equal(g.T(paragraphs[0]),'好友與排行榜會顯示這個暱稱。');
  assert.equal(g.T(paragraphs[1]),'其他玩家可以查看你的暱稱與排行榜成績；密碼與 Google 電子郵件不會公開。');
  for(const text of ['Elige tu apodo','Guardar apodo','3-16 letras, números o _','El apodo debe tener 3-16 letras, números o _.','Ese apodo ya lo tiene otro jugador.']) assert.notEqual(g.T(text),text,text);
});

test('實際排行榜 UI 的繁中頁籤、名次狀態、寶可夢篩選與列資料不落入西文分支',async()=>{
  const g=load('zh-TW'),nodes=new Map();
  function node() {
    return {children:[],html:'',value:'',classList:{toggle(){},add(){},remove(){}},
      set innerHTML(v){this.html=v;this.children=[];},get innerHTML(){return this.html;},
      appendChild(n){this.children.push(n);},insertAdjacentHTML(_,html){this.html+=html;},querySelectorAll(){return [];}};
  }
  const $=id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);};
  let rank=null,rows=[],failed=false;
  g.UI={$ ,show(){},toast(){},spriteCanvas:()=>node()};g.Icons={html:()=>''};
  g.Social={me:{name:'測試玩家'},uid:'fixture',started:true};g.SocialUI={needOnline:()=>true};
  g.Ranking={PERIODS:[['d','Diario'],['w','Semanal'],['m','Mensual'],['a','Histórico']],isAdmin:()=>false,
    top:async()=>{if(failed)throw {code:'fixture-error'};return rows;},myRank:async()=>rank,board:()=>'',reported:()=>new Set()};
  vm.runInNewContext(fs.readFileSync(path.join(ROOT,'js/ui/ranking-ui.js'),'utf8'),{G:g,document:{createElement:node},console});
  const tick=()=>new Promise(setImmediate);
  g.RankingUI.init();g.RankingUI.open();await tick();
  assert.deepEqual($('rk-period').children.map(x=>x.innerHTML),['今日','本週','本月','歷史總榜']);
  assert.ok($('rk-mode').children[0].innerHTML.includes('單人'));
  assert.deepEqual($('rk-scope').children.map(x=>x.innerHTML),['全部','只看好友']);
  assert.ok($('rk-me').innerHTML.includes('本週・單人：你還沒有上榜紀錄。'));
  assert.ok($('rk-list').innerHTML.includes('這裡還沒有紀錄'));
  rank={out:true};g.RankingUI.open();await tick();assert.ok($('rk-me').innerHTML.includes('尚未進入前 50 名'));
  rank={pos:7,t:125};g.RankingUI.open();await tick();assert.ok($('rk-me').innerHTML.includes('第 7 名，生存時間 2:05'));
  $('rk-mode').children[1].onclick();await tick();assert.ok($('rk-me').innerHTML.includes('合作'));
  $('rk-period').children[0].onclick();await tick();assert.ok($('rk-me').innerHTML.includes('今日'));
  $('rk-poke').value='妙蛙種子';$('rk-poke').onchange();await tick();assert.ok($('rk-me').innerHTML.includes('歷史總榜・合作／妙蛙種子'));
  rows=[{id:'r1',uids:['fixture'],names:['Diario<script>'],dex:[1],shiny:[false],lv:12,kills:1234,t:125}];g.RankingUI.open();await tick();
  const rendered=$('rk-list').children[0].innerHTML;
  assert.ok(rendered.includes('等級 12 · 擊敗 1,234 隻'));
  assert.ok(rendered.includes('Diario&lt;script&gt;'));assert.ok(!rendered.includes('<script>'));
  failed=true;g.RankingUI.open();await tick();assert.ok($('rk-list').innerHTML.includes('無法載入排行榜（fixture-error）。'));
  failed=false;rows=[];g.Social.me=null;g.RankingUI.open();await tick();assert.ok($('rk-me').innerHTML.includes('先到「好友」設定暱稱'));
});


test('收藏的夥伴按鈕以完整句翻譯，普通與異色都不殘留西文介系詞',()=>{
 const zh=load('zh-TW'),en=load('en');
 for(const [shiny,expected,english] of [[false,'設為夥伴','Choose as partner'],[true,'設為夥伴（異色）','Choose shiny as partner']]) {
  const label=`Elegir de compañero${shiny?' (shiny)':''}`;
  assert.equal(zh.T(label),expected);assert.equal(zh.T(zh.T(label)),expected);
  assert.equal(en.T(label),english);
 }
 assert.equal(zh.T('Es tu compañero'),'目前的夥伴');
});
