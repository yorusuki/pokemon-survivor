#!/usr/bin/env python3
"""產生繁中資源：專有名稱使用 PokéAPI，其餘文字只採專案內校訂譯文。
先執行 node tools/export_data.js。缺少譯文或動態參數不符時停止，不使用翻譯服務。
"""
import csv
import datetime
import hashlib
import html
from html.parser import HTMLParser
import io
import json
from pathlib import Path
import re
import time
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / 'tools/cache'
BASE = 'https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/'
SOURCE_FILES = [('pokemon', 'pokemon_species_names.csv', 'pokemon_species_id'),
                ('moves', 'move_names.csv', 'move_id'), ('items', 'item_names.csv', 'item_id'),
                ('types', 'type_names.csv', 'type_id'), ('abilities', 'ability_names.csv', 'ability_id')]


def get(url):
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'PokeSurvivor-localization/1.0'})
            with urllib.request.urlopen(req, timeout=45) as response:
                return response.read()
        except Exception:
            if attempt == 3:
                raise
            time.sleep(1 + attempt)


def sources():
    result, provenance = {}, []
    for kind, file, idkey in SOURCE_FILES:
        target = CACHE / file
        if not target.exists():
            target.write_bytes(get(BASE + file))
        raw = target.read_bytes()
        rows = {}
        for row in csv.DictReader(io.StringIO(raw.decode('utf-8-sig'))):
            lang = {'4': 'zh-TW', '7': 'es', '9': 'en'}.get(row['local_language_id'])
            if lang:
                rows.setdefault(row[idkey], {})[lang] = row['name']
        result[kind] = rows
        provenance.append({'url': BASE + file, 'sha256': hashlib.sha256(raw).hexdigest()})
    return result, provenance


def normalized(s):
    return re.sub(r'[\s\-’\u2019\u0027.:]', '', s).casefold()


class Page(HTMLParser):
    def __init__(self, text):
        super().__init__(convert_charrefs=True)
        self.tokens, self.skip = [], 0
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        raw = self.get_starttag_text()
        if tag in ('script', 'style'):
            self.skip += 1
        self.tokens.append(('raw', raw))

    def handle_startendtag(self, tag, attrs):
        self.tokens.append(('raw', self.get_starttag_text()))

    def handle_endtag(self, tag):
        if tag in ('script', 'style'):
            self.skip -= 1
        self.tokens.append(('raw', '</' + tag + '>'))

    def handle_data(self, data):
        self.tokens.append(('raw' if self.skip or not data.strip() else 'text', data))

    def handle_entityref(self, name):
        self.tokens.append(('raw', '&' + name + ';'))

    def handle_charref(self, name):
        self.tokens.append(('raw', '&#' + name + ';'))

    def handle_decl(self, data):
        self.tokens.append(('raw', '<!' + data + '>'))

    def handle_comment(self, data):
        self.tokens.append(('raw', '<!--' + data + '-->'))



def translate_attributes(tag, resolve):
    if not tag.startswith('<') or tag.startswith('<!--'):
        return tag
    def attribute(match):
        return match[1] + '="' + html.escape(resolve(html.unescape(match[2])), quote=True) + '"'
    tag = re.sub(r'\b(alt|title|placeholder|aria-label)="([^"]+)"', attribute, tag)
    if tag.startswith('<meta') and re.search(r'(?:name|property)="(?:description|og:title|og:description|twitter:title|twitter:description)"', tag):
        tag = re.sub(r'\b(content)="([^"]+)"', attribute, tag)
    return tag


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    d = json.loads((CACHE / 'gamedata.json').read_text(encoding='utf-8'))
    source, provenance = sources()
    glossary, records = {}, []
    for kind, entries in source.items():
        for id_, row in entries.items():
            zh = row.get('zh-TW')
            if zh:
                for lang in ('en', 'es'):
                    if row.get(lang):
                        glossary[row[lang]] = zh
    coverage = {}
    for kind, entries in [('pokemon', d['dex']), ('moves', d['moves']), ('items', d['items'])]:
        by_en = {normalized(v.get('en', '')): (k, v) for k, v in source[kind].items()}
        matched = 0
        for entry in entries:
            if kind == 'pokemon':
                id_ = str(entry['dex']); row = source[kind].get(id_, {})
            else:
                english = d['en'].get(entry['name'], entry['name'])
                id_, row = by_en.get(normalized(english), ('', {}))
            if not row.get('zh-TW'):
                raise ValueError('找不到可靠名稱: ' + kind + ':' + entry['name'])
            glossary[entry['name']] = row['zh-TW']
            records.append({'kind': kind, 'gameId': entry.get('dex', entry.get('id')), 'sourceId': id_,
                            'original': entry['name'], 'en': row.get('en'), 'zh-TW': row['zh-TW'], 'source': 'PokeAPI CSV'})
            matched += 1
        coverage[kind] = {'matched': matched, 'total': len(entries)}
    evolutions = {m['evo']['name'] for m in d['moves'] if m.get('evo')}
    for name in sorted(evolutions):
        english = d['en'].get(name, name)
        found = None
        for source_kind in ('moves', 'abilities'):
            for id_, row in source[source_kind].items():
                if normalized(row.get('en', '')) == normalized(english) and row.get('zh-TW'):
                    found = (source_kind, id_, row)
                    break
            if found:
                break
        if not found:
            raise ValueError('進化招式名稱待人工確認: ' + name)
        source_kind, id_, row = found
        glossary[name] = row['zh-TW']
        records.append({'kind': 'evolutionMoves', 'gameId': name, 'sourceId': id_, 'sourceKind': source_kind,
                        'original': name, 'en': row.get('en'), 'zh-TW': row['zh-TW'], 'source': 'PokeAPI CSV',
                        'note': '原作借用特性名稱作為自訂招式' if source_kind == 'abilities' else ''})
    coverage['evolutionMoves'] = {'matched': len(evolutions), 'total': len(evolutions)}
    editorial = json.loads((ROOT / 'tools/translations/zh-TW.json').read_text(encoding='utf-8'))
    contextual = json.loads((ROOT / 'tools/translations/zh-TW-context.json').read_text(encoding='utf-8'))
    pages = {}
    for file in (ROOT / 'en').rglob('*.html'):
        if file in (ROOT / 'en/index.html', ROOT / 'en/guide/index.html'):
            continue
        pages[file.relative_to(ROOT / 'en')] = Page(file.read_text(encoding='utf-8'))
    missing = set()
    def resolve(text):
        value = editorial.get(text, glossary.get(text))
        if value is None:
            if re.search(r'[A-Za-z]', text):
                missing.add(text)
            return text
        if text.count('{x}') != value.count('{x}'):
            raise ValueError('譯文動態參數數量不符: ' + text)
        return value
    dictionary = {es: resolve(en) for es, en in d['en'].items()}
    dictionary.update(glossary)
    dictionary.update({en: resolve(en) for en in d['en'].values()})
    # 資料名稱由 ID 決定，避免同名的屬性與招式互相覆蓋。
    for row in source['types'].values():
        if row.get('es') and row.get('zh-TW'):
            dictionary[row['es']] = row['zh-TW']
    dictionary.update(contextual)
    for page in pages.values():
        for kind, value in page.tokens:
            if kind == 'text':
                resolve(value.strip())
            else:
                translate_attributes(value, resolve)
    if missing:
        target = CACHE / 'missing-zh-TW.json'
        target.write_text(json.dumps(sorted(missing), ensure_ascii=False, indent=2), encoding='utf-8')
        raise ValueError(f'缺少 {len(missing)} 項校訂譯文，請檢查 {target}')
    (ROOT / 'js/data/lang-zh-TW.js').write_text(
        '/* 一般文案依遊戲語境重譯；名稱來源見 docs/terminology-zh-TW.json。 */\n'
        + 'G.I18n.add(' + json.dumps(dictionary, ensure_ascii=False, indent=2) + ', "zh-TW");\n'
        + 'G.ZH_NAMES = ' + json.dumps({k: {str(r['gameId']): r['zh-TW'] for r in records if r['kind'] == k} for k in coverage}, ensure_ascii=False) + ';\n', encoding='utf-8')
    english_terms = {k: v for k, v in glossary.items() if re.search('[A-Za-z]', k)}
    fragments = sorted(english_terms, key=len, reverse=True)
    pattern = re.compile(r'(?<![\w])(' + '|'.join(re.escape(s) for s in fragments) + r')(?![\w])', re.I)
    low = {k.casefold(): v for k, v in english_terms.items()}
    def render_text(s):
        body = s.strip()
        out = resolve(body)
        out = pattern.sub(lambda m: low[m.group().casefold()], out)
        lead = s[:len(s) - len(s.lstrip())]; tail = s[len(s.rstrip()):]
        return lead + html.escape(out, quote=False) + tail
    for relative, page in pages.items():
        target = ROOT / 'zh-TW' / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        content = ''.join(render_text(v) if k == 'text' else translate_attributes(v, resolve) for k, v in page.tokens)
        content = content.replace('lang="en"', 'lang="zh-Hant"').replace('hreflang="en"', 'hreflang="zh-Hant"')
        content = content.replace('https://pokesurvivor.com/en/', '/zh-TW/').replace('/en/', '/zh-TW/')
        # 本地化版本不宣稱是原作者官方站點；移除其 canonical。
        content = re.sub(r'<link\s+rel="canonical"[^>]*>', '', content)
        content = re.sub(r'<script[^>]*type="application/ld\+json"[^>]*>[\s\S]*?</script>', '', content)
        content = content.replace('content="en_US"', 'content="zh_TW"')
        target.write_text(content, encoding='utf-8')
    guide_template = ROOT / 'tools/templates/guide-zh-TW.html'
    if guide_template.exists():
        (ROOT / 'zh-TW/guide/index.html').write_text(guide_template.read_text(encoding='utf-8'), encoding='utf-8')
    report = {'generatedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'sources': provenance, 'fontSources': [{'name': 'Cubic 11', 'repository': 'https://github.com/ACh-K/Cubic-11', 'license': 'SIL Open Font License 1.1', 'localFile': 'assets/fonts/Cubic_11.woff2', 'sha256': hashlib.sha256((ROOT / 'assets/fonts/Cubic_11.woff2').read_bytes()).hexdigest(), 'licenseFile': 'assets/fonts/Cubic11-OFL.txt', 'provenance': '上游與授權經查核，未驗證其與特定上游版本二進位相同'}], 'coverage': coverage, 'records': records,
              'reliability': '名稱依 PokéAPI zh-Hant CSV 比對，屬社群維護資料，非逐筆官方認證。一般文案依遊戲語境撰寫，不使用外部機翻服務。',
              'officialSpotChecks': [{'dex': 1, 'name': '妙蛙種子', 'url': 'https://tw.portal-pokemon.com/pokedex/0001/'}],
              'editorialTextCount': len(editorial), 'missingEditorialTexts': 0, 'guidePages': len(pages) + 1}
    (ROOT / 'docs/terminology-zh-TW.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(coverage, ensure_ascii=False), '內容頁', len(pages) + 1, '校訂譯文', len(editorial), flush=True)


if __name__ == '__main__':
    main()
