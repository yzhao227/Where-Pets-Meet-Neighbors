"""Collect public Commons photo metadata and review-size copies; never publish.

Run explicitly with network approval. Keeps per-file licence/author metadata
and a raw API record so a reviewer can select actual photos before importing.
"""
import argparse
import hashlib
import html
import json
import re
import time
from pathlib import Path
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen
from urllib.error import HTTPError

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'content/batch-001'
AGENT = 'YouChongYouLinContentPilot/1.0 (pet education; licence and attribution retained)'


def fetch(url):
    request = Request(url, headers={'User-Agent': AGENT})
    for attempt in range(4):
        try:
            with urlopen(request, timeout=40) as response:
                return response.read()
        except HTTPError as error:
            if error.code not in [429, 503] or attempt == 3:
                raise
            delay = int(error.headers.get('Retry-After', 15 * (attempt + 1)))
            print('Server requested slower collection; waiting', delay, 'seconds', flush=True)
            time.sleep(delay)


def api(parameters):
    url = 'https://commons.wikimedia.org/w/api.php?' + urlencode({
        'action': 'query', 'format': 'json', 'formatversion': 2, **parameters
    })
    cache = DEST / 'sources/commons-api-cache'
    cache.mkdir(parents=True, exist_ok=True)
    cached = cache / (hashlib.sha256(url.encode()).hexdigest() + '.json')
    if cached.exists():
        return json.loads(cached.read_text())
    result = json.loads(fetch(url))
    if 'error' in result:
        raise RuntimeError(str(result['error']))
    cached.write_text(json.dumps(result, ensure_ascii=False))
    time.sleep(1.5)
    return result


def plain(value):
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]*>', ' ', value or ''))).strip()


def candidates(species, limit):
    cached = DEST / 'sources' / ('commons-' + species + '-metadata.json')
    if cached.exists():
        return json.loads(cached.read_text())
    queue = ['Category:Quality images of ' + species]
    visited, page_ids = set(), set()
    while queue and len(page_ids) < limit and len(visited) < 50:
        category = queue.pop(0)
        if category in visited:
            continue
        visited.add(category)
        cursor = {}
        while True:
            response = api({'list': 'categorymembers', 'cmtitle': category,
                            'cmtype': 'file|subcat', 'cmlimit': 500, **cursor})
            for item in response.get('query', {}).get('categorymembers', []):
                if item['ns'] == 6:
                    page_ids.add(item['pageid'])
                elif item['ns'] == 14 and item['title'] not in visited:
                    queue.append(item['title'])
            print(species, category, 'candidate files', len(page_ids), flush=True)
            cursor = response.get('continue', {})
            if not cursor or len(page_ids) >= limit:
                break
    records = []
    selected = sorted(page_ids)[:limit]
    for offset in range(0, len(selected), 40):
        response = api({'pageids': '|'.join(map(str, selected[offset:offset + 40])),
                        'prop': 'imageinfo', 'iiprop': 'url|extmetadata|size|mime',
                        'iiurlwidth': 640})
        records.extend(response.get('query', {}).get('pages', []))
        print(species, 'metadata', len(records), '/', len(selected), flush=True)
    cached.write_text(json.dumps(records, ensure_ascii=False, indent=2))
    return records


def collect(target, species_list=None, start=0):
    (DEST / 'sources').mkdir(parents=True, exist_ok=True)
    (DEST / 'media').mkdir(parents=True, exist_ok=True)
    accepted = []
    allowed = {'CC BY 4.0', 'CC BY-SA 4.0', 'CC0'}
    for species in species_list or ['cats', 'dogs']:
        count, position = 0, 0
        for record in candidates(species, 420):
            info = (record.get('imageinfo') or [{}])[0]
            meta = info.get('extmetadata', {})
            value = lambda key: plain(meta.get(key, {}).get('value', ''))
            licence, author = value('LicenseShortName'), value('Artist')
            if licence not in allowed or not author or len(author) > 160:
                continue
            if info.get('mime') not in ['image/jpeg', 'image/png'] or min(info.get('width', 0), info.get('height', 0)) < 400:
                continue
            image_url = info.get('thumburl') or info.get('url')
            if urlsplit(image_url).hostname not in ['upload.wikimedia.org', 'thumb.wikimedia.org']:
                continue
            position += 1
            if position <= start:
                continue
            # Preview-size source copies are kept outside the mini program.
            local = DEST / 'media' / (str(record['pageid']) + '.source')
            try:
                if not local.exists():
                    local.write_bytes(fetch(image_url))
                    time.sleep(0.5)
            except Exception as error:
                print('SKIP image', record['title'], str(error), flush=True)
                continue
            accepted.append({
                'species': species, 'pageid': record['pageid'], 'title': record['title'],
                'description': value('ImageDescription'), 'author': author,
                'artistHtml': meta.get('Artist', {}).get('value', ''),
                'credit': value('Credit'), 'license': licence,
                'licenseUrl': value('LicenseUrl'), 'attribution': value('Attribution'),
                'restrictions': value('Restrictions'),
                'url': image_url, 'originalUrl': info['url'],
                'sourceUrl': info.get('descriptionurl') or 'https://commons.wikimedia.org/?curid=' + str(record['pageid']),
                'localFile': str(local.relative_to(ROOT)),
                'sha256': hashlib.sha256(local.read_bytes()).hexdigest()
            })
            count += 1
            print(species, 'downloaded', count, record['title'], flush=True)
            if count >= target:
                break
        print(species, 'eligible downloaded', count, flush=True)
    suffix = '-' + '-'.join(species_list or ['cats', 'dogs']) + '-' + str(start) if start else ''
    output = DEST / ('sources/commons-candidates' + suffix + '.json')
    output.write_text(json.dumps(accepted, ensure_ascii=False, indent=2))
    print('Saved', len(accepted), 'candidates to', output, flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--per-species', type=int, default=120)
    parser.add_argument('--species', choices=['cats', 'dogs'], nargs='+')
    parser.add_argument('--start', type=int, default=0)
    args = parser.parse_args()
    if not 1 <= args.per_species <= 200:
        parser.error('--per-species must be between 1 and 200')
    if args.start < 0:
        parser.error('--start must be nonnegative')
    collect(args.per_species, args.species, args.start)
