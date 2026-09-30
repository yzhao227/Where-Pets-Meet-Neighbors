"""Download review copies from saved public Commons metadata; never publish."""
import concurrent.futures
import hashlib
import html
import json
from pathlib import Path
import re
import subprocess
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'content/batch-004'
records = json.loads((BASE / 'photo-sources/candidates-metadata.json').read_text())
counts = {}
selected = []
for record in records:
    group = record['group']
    counts[group] = counts.get(group, 0) + 1
    if counts[group] > ({'cats': 36, 'dogs': 36}.get(group, 100)):
        continue
    selected.append(record)


def download(record):
    pageid = record['pageid']
    info = record['imageinfo'][0]
    metadata = info['extmetadata']
    plain = lambda key: re.sub(r'\s+', ' ', html.unescape(re.sub('<[^>]+>', ' ', metadata.get(key, {}).get('value', '')))).strip()
    if plain('LicenseShortName') not in ['CC0', 'Public domain'] or plain('Restrictions'):
        return {'pageid': pageid, 'error': 'licence restrictions'}
    url = info.get('thumburl') or info['url']
    if urlsplit(url).hostname not in ['upload.wikimedia.org', 'thumb.wikimedia.org']:
        return {'pageid': pageid, 'error': 'unexpected host'}
    local = BASE / f'photo-media/{pageid}.source'
    previous = ROOT / f'content/batch-002/media/{pageid}.source'
    if not local.exists() and previous.exists():
        local.write_bytes(previous.read_bytes())
    if not local.exists():
        command = ['curl', '--fail', '--silent', '--show-error', '--location',
                   '--connect-timeout', '8', '--max-time', '20', '--retry', '1',
                   '--user-agent', 'YouChongYouLinContentReview/1.0 (public pet images; attribution retained)', url]
        result = subprocess.run(command, capture_output=True)
        if result.returncode:
            return {'pageid': pageid, 'error': result.stderr.decode(errors='replace')[-200:]}
        local.write_bytes(result.stdout)
    return {'pageid': pageid, 'group': record['group'], 'title': record['title'],
            'description': plain('ImageDescription'), 'author': plain('Artist'),
            'license': plain('LicenseShortName'), 'licenseUrl': plain('LicenseUrl'),
            'url': url, 'originalUrl': info['url'], 'sourceUrl': info['descriptionurl'],
            'metadataFile': record['metadataFile'], 'localFile': str(local.relative_to(ROOT)),
            'sha256': hashlib.sha256(local.read_bytes()).hexdigest()}


results = []
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
    for item in pool.map(download, selected):
        results.append(item)
        (BASE / 'photo-sources/downloads.json').write_text(json.dumps(results, ensure_ascii=False, indent=2) + '\n')
        print(item['pageid'], item.get('group', ''), item.get('error', 'ready'), flush=True)
print(json.dumps({'total': len(results), 'ready': sum('error' not in row for row in results)}, ensure_ascii=False))
