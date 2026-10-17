/* Empaqueta el juego para publicarlo: un solo JS en vez de scripts separados.
 *   node tools/build.js
 *
 * - dev.html es la página "fuente": carga cada script por separado (para
 *   programar y depurar cómodamente). SE EDITA dev.html, no index.html.
 * - index.html se genera a partir de dev.html, cambiando el bloque de scripts
 *   por js/app.min.js (con la huella en la URL para que no se quede en caché).
 * - node tools/build.js --sin-seo  ->  sin lo de SEO (hasta tener pokesurvivor.com).
 * - Después hay que regenerar en/index.html: python tools/make_seo_pages.py
 */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
const DEV = path.join(ROOT, 'dev.html'), OUT = path.join(ROOT, 'index.html');
const BEGIN = '<!-- scripts:begin -->', END = '<!-- scripts:end -->';

const dev = fs.readFileSync(DEV, 'utf8');
const i = dev.indexOf(BEGIN), j = dev.indexOf(END);
if (i < 0 || j < 0) throw new Error('dev.html no tiene las marcas ' + BEGIN + ' / ' + END);
const block = dev.slice(i, j + END.length);
const files = [...block.matchAll(/<script[^>]*src="(js\/[^"]+\.js)"/g)].map(m => m[1]);

// Une los archivos en orden; cada uno separado por ';' por si alguno no acaba en punto y coma.
let joined = files.map(f => `/* ${f} */\n` + fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n;\n');
// Anti-trampas: en la versión publicada el juego va ENCERRADO en una función:
// G deja de existir en la consola del navegador (F12), y con él los atajos para
// hacerse invencible, saltar el reloj, etc. (dev.html sigue igual, para programar).
//   --expose   sin encerrar ni ofuscar (para las pruebas automáticas)
const EXPOSE = process.argv.includes('--expose');
if (!EXPOSE) {
  const WIN_G = 'window.G = window.G || {};';
  if (!joined.includes(WIN_G)) throw new Error('util.js ya no crea G como se esperaba: revisa build.js');
  joined = '(() => {\n' + joined.replace(WIN_G, 'var G = {};') + '\n})();\n';
}
const tmp = path.join(ROOT, 'tools', 'cache', 'app.js');
fs.mkdirSync(path.dirname(tmp), { recursive: true });
fs.writeFileSync(tmp, joined);
const outJs = path.join(ROOT, 'js', 'app.min.js');
// 自架版只使用本機來源合併，不執行 npx 或臨時下載建置工具。
fs.copyFileSync(tmp, outJs);
const min = fs.readFileSync(outJs);
const hash = crypto.createHash('sha1').update(min).digest('hex').slice(0, 10);

let html = dev.slice(0, i) + `<script defer src="js/app.min.js?v=${hash}"></script>` + dev.slice(j + END.length);
html = html.replace(/<meta name="robots" content="noindex">\s*/, '');
// --sin-seo: sin canonical/redes/datos estructurados ni enlaces a las páginas
// (para publicar antes de tener el dominio pokesurvivor.com).
const SIN_SEO = process.argv.includes('--sin-seo');
html = SIN_SEO ? html.replace(/<!-- seo:begin -->[\s\S]*?<!-- seo:end -->\n?/g, '') : html.replace(/<!-- seo:(begin|end) -->\n?/g, '');
html = html.replace(/<!-- dev.html: página fuente[^>]*-->/, '<!-- GENERADO desde dev.html por tools/build.js: no editar a mano (se edita dev.html). -->');
fs.writeFileSync(OUT, html);
// 自架的語言入口與主入口共用同一份建置，避免引用舊版 Firebase bundle。
for (const [folder, lang] of [['en', 'en'], ['zh-TW', 'zh-Hant']]) {
  const target = path.join(ROOT, folder);
  fs.mkdirSync(target, { recursive: true });
  const localized = html.replace('<head>', '<head>\n<base href="../">').replace('<html lang="es">', `<html lang="${lang}">`);
  fs.writeFileSync(path.join(target, 'index.html'), localized);
}
// Versión publicada: los jugadores la miran cada 5 min y, si cambia, el juego se
// actualiza solo (en el menú, o al acabar la partida). Ver js/core/updater.js.
// --forzar: versión obligatoria, también corta las partidas en curso (guardándolas).
const FORZAR = process.argv.includes('--forzar');
fs.writeFileSync(path.join(ROOT, 'version.json'), JSON.stringify(Object.assign({ v: hash, at: new Date().toISOString() }, FORZAR ? { force: true } : {})) + '\n');
console.log(`${FORZAR ? '[OBLIGATORIA] ' : ''}${SIN_SEO ? '[sin SEO] ' : ''}${EXPOSE ? '[SIN PROTEGER, sólo pruebas] ' : ''}ok: ${files.length} scripts · ${(joined.length / 1024).toFixed(0)} KB -> ${(min.length / 1024).toFixed(0)} KB (app.min.js?v=${hash})`);
