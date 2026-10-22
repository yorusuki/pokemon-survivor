 'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const root=path.join(__dirname,'../..');
test('只改 CSS 也更新樣式網址與更新器版本，所有語言入口一致',()=>{
 const files=new Map(),put=(p,s)=>files.set(path.join(root,p),Buffer.from(s));
 put('tools/release-policy.json',JSON.stringify({forceVersion:'3.0.0'}));
 put('dev.html','<html lang="es"><head><link rel="stylesheet" href="css/style.css"></head><body><!-- scripts:begin --><script src="js/core/util.js"></script><!-- scripts:end --></body></html>');put('js/core/util.js','window.G = window.G || {};');put('css/style.css','.survivor-name{color:gold}');
 const fake={readFileSync(p,encoding){const b=files.get(p);if(!b)throw new Error('Missing fixture '+p);return encoding?b.toString(encoding):b;},writeFileSync(p,v){files.set(p,Buffer.from(v));},mkdirSync(){},copyFileSync(a,b){files.set(b,Buffer.from(files.get(a)));}};
 const source=fs.readFileSync(path.join(root,'tools/build.js'),'utf8');const build=()=>{vm.runInNewContext(source,{require:n=>n===path.join(root,'server/package.json')?{version:'3.0.0'}:({fs:fake,path,crypto}[n]),__dirname:path.join(root,'tools'),process:{argv:['node','build.js','--sin-seo']},console:{log(){}}});return {v:JSON.parse(files.get(path.join(root,'version.json'))).v,css:files.get(path.join(root,'index.html')).toString().match(/css\/style.css\?v=([^" ]+)/)[1],js:files.get(path.join(root,'js/app.min.js')).toString()};};
 const before=build();assert.equal(JSON.parse(files.get(path.join(root,'version.json'))).force,true);put('tools/release-policy.json',JSON.stringify({forceVersion:'2.0.0'}));build();assert.equal(JSON.parse(files.get(path.join(root,'version.json'))).force,undefined);put('css/style.css','.survivor-name{color:gold;border:1px solid gold}');const after=build();assert.notEqual(before.v,after.v);assert.notEqual(before.css,after.css);assert.equal(before.js,after.js);
 for(const p of ['index.html','en/index.html','zh-TW/index.html'])assert.ok(files.get(path.join(root,p)).toString().includes('css/style.css?v='+after.css));
});
