"""Collect public pet photos with licences that do not require public credits.

Saves metadata and review copies only. Visual review is required before import.
Uses the public Commons API, its cache, and Retry-After handling.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import time
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'content/batch-002'
spec = importlib.util.spec_from_file_location('commons_collector', ROOT / 'scripts/collect-commons.py')
commons = importlib.util.module_from_spec(spec)
spec.loader.exec_module(commons)
commons.DEST = DEST
def fetch_with_retry(url):
    # curl retries transient failures and honors HTTP Retry-After. Its separate
    # connection timeout avoids waiting forty seconds on a stalled TLS handshake.
    result = subprocess.run([
        'curl', '--fail', '--silent', '--show-error', '--location',
        '--connect-timeout', '12', '--max-time', '45',
        '--retry', '3', '--retry-delay', '3', '--retry-max-time', '120',
        '--user-agent', commons.AGENT, url
    ], capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr.decode('utf8', errors='replace')[-600:])
    return result.stdout


commons.fetch = fetch_with_retry

QUERIES = {
    'rabbits': ['rabbit', 'domestic rabbit'],
    'guinea-pigs': ['"guinea pig"', '"Cavia porcellus"'],
    'hamsters': ['hamster'],
    'birds': ['budgerigar', 'cockatiel', 'lovebird'],
    'fish': ['goldfish', '"betta fish"'],
    'cats': ['cat', 'kitten'],
    'dogs': ['dog', 'puppy'],
    'cats-more': ['"British Shorthair"', '"Maine Coon"', '"Ragdoll"', '"Siamese cat"', '"tabby cat"'],
    'dogs-more': ['"Shiba Inu"', '"Border Collie"', '"Labrador"', '"Poodle"'],
    'turtles': ['tortoise', '"pet turtle"', '"red-eared slider"'],
    'lizards': ['"leopard gecko"', '"bearded dragon"', '"crested gecko"'],
    'snakes': ['"corn snake"', '"ball python"', '"king snake"'],
    'shrimp': ['Neocaridina', '"aquarium shrimp"', '"cherry shrimp"'],
    'other-small-pets': ['"pet hedgehog"', 'ferret', 'chinchilla'],
    'small-pets-more': ['"Atelerix albiventris"', '"domestic ferret"', '"Mustela furo"', 'chinchilla'],
    'amphibians': ['axolotl', '"pet frog"', '"Ceratophrys"'],
    'aquarium': ['guppy', '"aquarium fish"', '"freshwater aquarium"'],
    'snails': ['"aquarium snail"', '"Pomacea diffusa"', 'Neritina', '"pet snail"'],
}


def metadata(group, pages):
    output = DEST / 'sources' / (group + '-metadata.json')
    records = {p['pageid']: p for p in json.loads(output.read_text())} if output.exists() else {}
    for term in QUERIES[group]:
        for page in range(pages):
            try:
                result = commons.api({
                    'generator': 'search', 'gsrsearch': 'incategory:CC-Zero filetype:bitmap ' + term,
                    'gsrnamespace': 6, 'gsrlimit': 50, 'gsroffset': page * 50,
                    'prop': 'imageinfo', 'iiprop': 'url|extmetadata|size|mime', 'iiurlwidth': 640
                })
            except Exception as error:
                print('SKIP search', group, term, page + 1, str(error), flush=True)
                continue
            for record in result.get('query', {}).get('pages', []):
                records[record['pageid']] = record
            output.write_text(json.dumps(list(records.values()), ensure_ascii=False, indent=2) + '\n')
            print(group, 'metadata', len(records), 'query', term, 'page', page + 1, flush=True)
            if not result.get('continue'):
                break
    return list(records.values())


def collect(group, limit, pages, metadata_only=False):
    source_dir = DEST / 'sources'
    source_dir.mkdir(parents=True, exist_ok=True)
    (DEST / 'media').mkdir(parents=True, exist_ok=True)
    records = metadata(group, pages)
    if metadata_only:
        return
    manifest = source_dir / (group + '-candidates.json')
    accepted = []
    for record in sorted(records, key=lambda item: item.get('index', 1000000)):
        if re.search(r'\b(MET|Tenniel|painting|painted|drawing|sculpture|statue|helmet|linchpin|rhyton|woodcut|engraving|stamp|logo|diagram|skull|skeleton|slide|histology|netsuke|Museum|illustration|lithograph|book|books|cartoon|marionette|genetics|Guggenheim)\b', record['title'], re.I):
            continue
        info = (record.get('imageinfo') or [{}])[0]
        meta = info.get('extmetadata', {})
        value = lambda key: commons.plain(meta.get(key, {}).get('value', ''))
        license_name = value('LicenseShortName')
        if license_name not in ['CC0', 'Public domain'] or value('Restrictions'):
            continue
        if info.get('mime') not in ['image/jpeg', 'image/png'] or min(info.get('width', 0), info.get('height', 0)) < 500:
            continue
        author = value('Artist') or '原页面未署名'
        if len(author) > 160:
            continue
        image_url = info.get('thumburl') or info.get('url', '')
        if urlsplit(image_url).hostname not in ['upload.wikimedia.org', 'thumb.wikimedia.org']:
            continue
        local = DEST / 'media' / (str(record['pageid']) + '.source')
        try:
            if not local.exists():
                data = commons.fetch(image_url)
                local.write_bytes(data)
                time.sleep(0.4)
        except Exception as error:
            print('SKIP', group, record['title'], str(error), flush=True)
            continue
        accepted.append({
            'group': group, 'pageid': record['pageid'], 'title': record['title'],
            'description': value('ImageDescription'), 'author': author,
            'license': license_name, 'licenseUrl': value('LicenseUrl'),
            'url': image_url, 'originalUrl': info['url'], 'sourceUrl': info['descriptionurl'],
            'localFile': str(local.relative_to(ROOT)), 'metadataFile': str((source_dir / (group + '-metadata.json')).relative_to(ROOT)),
            'sha256': hashlib.sha256(local.read_bytes()).hexdigest()
        })
        manifest.write_text(json.dumps(accepted, ensure_ascii=False, indent=2) + '\n')
        print(group, 'downloaded', len(accepted), record['pageid'], record['title'], flush=True)
        if len(accepted) >= limit:
            break
    print(group, 'saved', len(accepted), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--groups', nargs='+', choices=list(QUERIES), default=list(QUERIES))
    parser.add_argument('--limit', type=int, default=55)
    parser.add_argument('--pages', type=int, default=1)
    parser.add_argument('--metadata-only', action='store_true')
    args = parser.parse_args()
    if not 1 <= args.limit <= 200 or not 1 <= args.pages <= 5:
        parser.error('limit must be 1..200 and pages 1..5')
    for group in args.groups:
        collect(group, args.limit, args.pages, args.metadata_only)
