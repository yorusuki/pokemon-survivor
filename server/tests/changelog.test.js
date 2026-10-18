'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'../..');
test('遊戲更新每日一筆、倒序分類，且每條內容都有雙語',()=>{
 const scope={G:{}};vm.runInNewContext(fs.readFileSync(path.join(root,'js/data/changelog.js'),'utf8'),scope);
 const days=scope.G.CHANGELOG.map(x=>x.d);assert.equal(new Set(days).size,days.length);assert.deepEqual(days.slice().sort().reverse(),days);
 for(const entry of scope.G.CHANGELOG){assert.match(entry.d,/^\d{4}-\d{2}-\d{2}$/);for(const key of ['new','chg','fix'])for(const line of entry[key]||[]){assert.equal(line.length,2);assert.ok(line.every(x=>typeof x==='string'&&x.trim()));}}
});
test('公開更新日期不重複，比較表及 README 入口存在',()=>{
 const notes=fs.readFileSync(path.join(root,'CHANGELOG.md'),'utf8');const days=[...notes.matchAll(/^## (\d{4}-\d{2}-\d{2})\b/gm)].map(x=>x[1]);assert.ok(days.length);assert.equal(new Set(days).size,days.length);assert.deepEqual(days.slice().sort().reverse(),days);
 const readme=fs.readFileSync(path.join(root,'README.md'),'utf8');assert.ok(readme.includes('(docs/UPSTREAM_COMPARISON.md)'));assert.ok(fs.existsSync(path.join(root,'docs/UPSTREAM_COMPARISON.md')));
});
