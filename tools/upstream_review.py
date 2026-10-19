#!/usr/bin/env python3
"""唯讀原作差異檢查：不合併、不執行上游程式、不改審查基準。"""
import argparse
import datetime
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPOSITORY = 'https://github.com/JPTER78/pokesurvivor.git'
SHA = re.compile(r'^[0-9a-f]{40}$')

def git(repo, *args):
    result = subprocess.run(['git', '-C', str(repo), *args], capture_output=True,
                            encoding='utf-8', errors='replace', timeout=300)
    if result.returncode:
        raise RuntimeError('Git 操作失敗：' + result.stderr.strip())
    return result.stdout

def category(name):
    if name == 'firestore.rules' or name.startswith(('firebase.', '.firebaserc')):
        return 'Firebase 專屬：略過'
    if name == 'js/core/db.js':
        return 'Firebase／儲存介面：人工拆分審查'
    if name in ('js/app.min.js', 'version.json', 'sitemap.xml') or name.endswith('/index.html') or name == 'index.html':
        return '產生檔：不直接移植，依來源重建'
    return '需審查：玩法／介面／工具（不可自動採用）'

def safe_path(name):
    p = Path(name)
    if name.startswith('/') or p.is_absolute() or '..' in p.parts or '\\' in name or ':' in name:
        raise RuntimeError('拒絕不安全的上游檔案路徑')
    return name

def blob(repo, ref, name):
    exists = subprocess.run(['git', '-C', str(repo), 'cat-file', '-e', ref + ':' + name],
                            capture_output=True, timeout=30)
    return git(repo, 'show', ref + ':' + name).replace('\r\n', '\n') if exists.returncode == 0 else None

def collect(repo, root, base, head):
    if not SHA.fullmatch(base) or not SHA.fullmatch(head):
        raise ValueError('提交必須為完整的 40 位 SHA')
    git(repo, 'merge-base', '--is-ancestor', base, head)
    names = [safe_path(x) for x in git(repo, 'diff', '--name-only', '--no-renames', base, head).splitlines()]
    tracked = set(git(root, 'ls-files').splitlines())
    files = []
    for name in names:
        # 只比較已追蹤來源；不讀 .env、未追蹤資料或快取內容。
        if (root / name).is_symlink():
            raise RuntimeError('拒絕讀取來源符號連結')
        local = (root / name).read_text('utf-8', errors='replace').replace('\r\n', '\n') if name in tracked and (root / name).is_file() else None
        before, after = blob(repo, base, name), blob(repo, head, name)
        state = '與原作最新一致' if local is not None and local == after else '目前仍與原作基準一致' if local is not None and local == before else '本分支另有改動，需三方比對' if local is not None else '本分支無此檔案或已移除'
        files.append({'path': name, 'category': category(name), 'comparison': state})
    commits = []
    for line in git(repo, 'log', '--format=%H%x09%as%x09%s', base + '..' + head).splitlines():
        sha, date, subject = line.split('\t', 2)
        commits.append({'sha': sha, 'date': date, 'subject': subject})
    return {'base': base, 'head': head, 'localHead': git(root, 'rev-parse', 'HEAD').strip(),
            'commits': commits, 'files': files}

def render(data):
    lines = ['# 原作自動檢查結果', '', '此檔由工具產生，不代表已移植或完成語意審查。Firebase 專屬檔略過，混合檔案須人工拆分。', '',
             f"基準：`{data['base']}`", f"原作最新：`{data['head']}`", f"本分支快照：`{data['localHead']}`", '',
             '## 提交', '']
    for c in data['commits']:
        lines.append(f"- {c['date']} `{c['sha'][:7]}` {c['subject']}")
    lines += ['', '## 檔案差異', '', '| 檔案 | 分類 | 文字比對 |', '|---|---|---|']
    for f in data['files']:
        lines.append('| ' + ' | '.join(x.replace('|', '\\|') for x in [f['path'], f['category'], f['comparison']]) + ' |')
    if not data['commits']:
        lines += ['', '此範圍沒有新提交。']
    return '\n'.join(lines) + '\n'

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fetch', action='store_true', help='從固定原作 main 更新隔離快取；否則只讀既有快取')
    args = parser.parse_args()
    state = json.loads((ROOT / 'docs/upstream-sync-state.json').read_text('utf-8'))
    base = state['reviewedThrough']
    if not SHA.fullmatch(base):
        raise ValueError('審查基準不是完整提交 SHA')
    cache = ROOT / 'tools/cache/upstream.git'
    if args.fetch:
        if not cache.exists():
            cache.parent.mkdir(parents=True, exist_ok=True)
            subprocess.run(['git', 'init', '--bare', str(cache)], check=True, capture_output=True, timeout=30)
        if git(cache, 'rev-parse', '--is-bare-repository').strip() != 'true':
            raise RuntimeError('快取必須是獨立 bare repository')
        git(cache, 'fetch', '--no-tags', '--depth=200', REPOSITORY, 'main')
    if not cache.exists():
        raise RuntimeError('尚無原作快取，請先使用 --fetch')
    head = git(cache, 'rev-parse', '--verify', 'FETCH_HEAD^{commit}').strip()
    data = collect(cache, ROOT, base, head)
    data['checkedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    out = ROOT / 'tools/cache/upstream-review'
    out.mkdir(parents=True, exist_ok=True)
    (out / 'report.json').write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (out / 'report.md').write_text(render(data), encoding='utf-8')
    # 保留完整上游來源 patch 供閱讀，不包含任何本機設定，也不執行 apply。
    (out / 'upstream.patch').write_text(git(cache, 'diff', '--no-ext-diff', '--no-renames', base, head, '--', 'js', 'css', 'dev.html', 'tools', 'firestore.rules'), encoding='utf-8')
    print(f"原作 {head[:7]}；{len(data['commits'])} 個提交、{len(data['files'])} 個變動檔案。")
    print('輸出：tools/cache/upstream-review/report.md、report.json、upstream.patch；未修改分支或審查基準。')

if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, ValueError, KeyError, OSError, subprocess.SubprocessError) as exc:
        raise SystemExit('檢查失敗（未套用更新）：' + str(exc))
