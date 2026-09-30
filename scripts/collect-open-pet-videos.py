"""Collect original CC0 video evidence and small review copies, never publish."""
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('open_pet_photos', ROOT / 'scripts/collect-open-pet-images.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
commons, DEST = module.commons, module.DEST

records = {}
for term in ['aquarium', 'rabbit', 'budgerigar', 'hamster']:
    response = commons.api({
        'generator': 'search', 'gsrsearch': 'incategory:CC-Zero filetype:video ' + term,
        'gsrnamespace': 6, 'gsrlimit': 12, 'prop': 'videoinfo',
        'viprop': 'url|extmetadata|size|derivatives', 'viurlwidth': 640
    })
    for record in response.get('query', {}).get('pages', []):
        records[record['pageid']] = record
    print(term, len(records), flush=True)
metadata_file = DEST / 'sources/videos-metadata.json'
metadata_file.write_text(json.dumps(list(records.values()), ensure_ascii=False, indent=2) + '\n')
candidates = []
for record in records.values():
    info = (record.get('videoinfo') or [{}])[0]
    meta = info.get('extmetadata', {})
    value = lambda key: commons.plain(meta.get(key, {}).get('value', ''))
    if value('LicenseShortName') != 'CC0' or value('Restrictions') or info.get('duration', 0) < 4:
        continue
    derivatives = [item for item in info.get('derivatives', []) if item.get('transcodekey') == '480p.vp9.webm']
    if not derivatives:
        continue
    derivative = derivatives[0]
    if derivative.get('bandwidth', 0) * info['duration'] / 8 > 16000000:
        continue
    local = DEST / 'media' / (str(record['pageid']) + '.webm')
    try:
        if not local.exists():
            local.write_bytes(commons.fetch(derivative['src']))
    except Exception as error:
        print('SKIP', record['title'], str(error), flush=True)
        continue
    candidates.append({'pageid': record['pageid'], 'title': record['title'],
        'description': value('ImageDescription'), 'author': value('Artist'),
        'license': 'CC0', 'licenseUrl': value('LicenseUrl'),
        'url': derivative['src'], 'originalUrl': info['url'], 'sourceUrl': info['descriptionurl'],
        'poster': info['thumburl'], 'durationSeconds': info['duration'],
        'localFile': str(local.relative_to(ROOT)), 'metadataFile': str(metadata_file.relative_to(ROOT))})
    (DEST / 'sources/videos-candidates.json').write_text(json.dumps(candidates, ensure_ascii=False, indent=2) + '\n')
    print('downloaded', record['pageid'], record['title'], info['duration'], flush=True)
