"""Collect public CC0 video evidence only; no content publishing."""
import argparse
import hashlib
import html
import json
from pathlib import Path
import re
import subprocess
import time
from urllib.parse import urlencode, urlsplit

BASE = Path(__file__).resolve().parent
ROOT = BASE.parents[2]
AGENT = 'YouChongYouLinContentPilot/1.0 (source and licence retained)'

def fetch(url):
    if urlsplit(url).hostname not in {'commons.wikimedia.org', 'upload.wikimedia.org', 'thumb.wikimedia.org'}:
        raise ValueError('Unexpected media host')
    return subprocess.check_output(['curl', '--fail', '--silent', '--show-error', '--location',
        '--connect-timeout', '12', '--max-time', '45', '--retry', '2', '--retry-delay', '2',
        '--retry-max-time', '100', '--user-agent', AGENT, url])

def plain(value):
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]*>', ' ', value or ''))).strip()

def api(parameters):
    url = 'https://commons.wikimedia.org/w/api.php?' + urlencode({
        'action': 'query', 'format': 'json', 'formatversion': 2, **parameters})
    cache = BASE / 'api-cache'
    cache.mkdir(parents=True, exist_ok=True)
    path = cache / (hashlib.sha256(url.encode()).hexdigest() + '.json')
    if path.exists():
        return json.loads(path.read_text())
    result = json.loads(fetch(url))
    if 'error' in result:
        raise ValueError(result['error'])
    path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    time.sleep(1)
    return result

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--search', nargs='+')
    parser.add_argument('--download', nargs='+', type=int)
    args = parser.parse_args()
    path = BASE / 'metadata.json'
    records = {r['pageid']: r for r in json.loads(path.read_text())} if path.exists() else {}
    for term in args.search or []:
        result = api({'generator': 'search', 'gsrsearch': 'incategory:CC-Zero filetype:video ' + term,
            'gsrnamespace': 6, 'gsrlimit': 20, 'prop': 'videoinfo',
            'viprop': 'url|extmetadata|size|derivatives', 'viurlwidth': 640})
        for record in result.get('query', {}).get('pages', []):
            records[record['pageid']] = record
        path.write_text(json.dumps(list(records.values()), ensure_ascii=False, indent=2) + '\n')
        print('SEARCH', term, len(records), flush=True)
    for pid in args.download or []:
        record = records[pid]
        info = record['videoinfo'][0]
        meta = info.get('extmetadata', {})
        value = lambda k: plain(meta.get(k, {}).get('value', ''))
        if value('LicenseShortName') != 'CC0' or value('Restrictions') or info.get('duration', 0) < 5:
            raise ValueError('Rejected licence/duration for ' + str(pid))
        choices = [d for d in info['derivatives'] if d.get('transcodekey') == '480p.vp9.webm']
        if not choices:
            raise ValueError('No compatible review copy for ' + str(pid))
        selected = choices[0]
        if selected.get('bandwidth', 0) * info['duration'] / 8 > 25000000:
            raise ValueError('Review copy too large ' + str(pid))
        target = BASE / (str(pid) + '.webm')
        if not target.exists():
            try:
                target.write_bytes(fetch(selected['src']))
            except subprocess.CalledProcessError:
                print('FAILED', pid, flush=True)
                continue
        print('DOWNLOADED', pid, target.stat().st_size, record['title'], flush=True)
