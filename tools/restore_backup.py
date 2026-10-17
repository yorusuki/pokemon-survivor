"""驗證備份並解壓到新目錄；不覆蓋現有專案或資料庫。"""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import stat
import zipfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    archive = args.archive.resolve(strict=True)
    metadata = json.loads(archive.with_suffix('.manifest.json').read_text(encoding='utf-8'))
    if metadata['archive'] != archive.name or hashlib.sha256(archive.read_bytes()).hexdigest() != metadata['sha256']:
        raise ValueError('備份封存的 SHA-256 不符')
    target = args.output.resolve()
    if target.exists():
        raise ValueError('輸出目錄已存在；為避免覆蓋資料，請指定全新目錄')
    with zipfile.ZipFile(archive) as z:
        if len(z.namelist()) != len(set(z.namelist())) or set(z.namelist()) != set(metadata['files']):
            raise ValueError('備份檔案清單不符')
        for info in z.infolist():
            rel = PurePosixPath(info.filename)
            destination = (target / info.filename).resolve()
            if rel.is_absolute() or '..' in rel.parts or '\\' in info.filename or ':' in info.filename or not destination.is_relative_to(target):
                raise ValueError('備份包含不安全路徑')
            if stat.S_ISLNK(info.external_attr >> 16):
                raise ValueError('備份不允許 symbolic link')
            if hashlib.sha256(z.read(info)).hexdigest() != metadata['files'][info.filename]:
                raise ValueError('備份內的檔案 SHA-256 不符：' + info.filename)
        target.mkdir(parents=True)
        for info in z.infolist():
            destination = target / info.filename
            destination.parent.mkdir(parents=True, exist_ok=True)
            with destination.open('xb') as output:
                output.write(z.read(info))
    print('Verified and restored to:', target)
    print('Database and secrets were not changed.')


if __name__ == '__main__':
    main()
