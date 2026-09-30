"""Assemble reviewed batch-004 source records without touching active content.

Default output is a proposal. Publication requires --publish and exactly 100
reviewed additions, plus an unchanged original 260-item snapshot.
"""
import argparse
from collections import Counter
import hashlib
import html
import json
from pathlib import Path
import re
import shutil

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'content/batch-004'
parser = argparse.ArgumentParser()
parser.add_argument('--publish', action='store_true')
parser.add_argument('--allow-partial', action='store_true', help='explicitly publish the reviewed subset while collection continues')
args = parser.parse_args()
load = lambda file: json.loads((ROOT / file).read_text())
sha = lambda file: hashlib.sha256(file.read_bytes()).hexdigest()


def write(file, value):
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


baseline = load('content/batch-004/baseline-260.json')
assert len(baseline['items']) == 260
old = {row['id']: row for row in baseline['items']}
pool = {}
for file in sorted((ROOT / 'content/batch-002/sources').glob('*-candidates.json')):
    if 'video' in file.name:
        continue
    for row in json.loads(file.read_text()):
        pool[row['pageid']] = row

for row in load('content/batch-004/photo-sources/candidates-metadata.json'):
    pageid = row['pageid']
    local = BASE / f'photo-media/{pageid}.source'
    if not local.exists():
        continue
    info = row['imageinfo'][0]
    metadata = info['extmetadata']
    plain = lambda key: re.sub(r'\s+', ' ', html.unescape(re.sub('<[^>]+>', ' ', metadata.get(key, {}).get('value', '')))).strip()
    if plain('LicenseShortName') not in ['CC0', 'Public domain'] or plain('Restrictions'):
        continue
    pool[pageid] = {'pageid': pageid, 'group': row['group'], 'title': row['title'],
                   'description': plain('ImageDescription'), 'author': plain('Artist'),
                   'license': plain('LicenseShortName'), 'licenseUrl': plain('LicenseUrl'),
                   'url': info.get('thumburl') or info['url'], 'originalUrl': info['url'],
                   'sourceUrl': info['descriptionurl'], 'metadataFile': row['metadataFile'],
                   'localFile': str(local.relative_to(ROOT)), 'sha256': sha(local)}

groups = []
for group in load('content/batch-004/photo-review/mammal-groups.json')['groups']:
    for picture in group['images']:
        if picture['isNew']:
            pool[picture['pageid']] = picture
    groups.append({'slug': group['reviewId'], 'group': group['speciesGroup'],
                   'newPageids': group['newPageIds'], 'additionalPhotoIds': group['existingPhotoIds'],
                   'title': group['title'], 'text': group['text'], 'animalTypes': group['animalTypes'],
                   'circleId': group['circleId'], 'topics': group['topics'],
                   'visualReview': group['review']['evidenceFile']})

ANIMALS = {'budgerigar': 'bird', 'fischers-lovebird': 'bird', 'rosy-faced-lovebird': 'bird',
           'masked-lovebird': 'bird', 'cockatiel': 'bird', 'leopard-gecko': 'reptile',
           'bearded-dragon': 'reptile', 'crested-gecko': 'reptile', 'corn-snake': 'reptile',
           'ball-python': 'reptile', 'red-eared-slider': 'reptile', 'cherry-shrimp': 'invertebrate',
           'axolotl': 'amphibian', 'goldfish': 'fish', 'betta': 'fish', 'guppy': 'fish', 'koi': 'fish',
           'ornamental-fish': 'fish', 'endler-guppy': 'fish', 'aquarium-scene': 'fish',
           'unidentified-tortoise': 'reptile', 'unidentified-turtle': 'reptile', 'pond-slider': 'reptile'}
for group in [*load('content/batch-004/photo-review/nonmammal-groups.json'),
              *load('content/batch-004/photo-review/nonmammal-extra-groups.json')]:
    animal = ANIMALS[group['group']]
    groups.append({**group, 'animalTypes': [animal],
                   'circleId': 'circle-birds' if animal == 'bird' else 'circle-exotics' if animal in ['reptile', 'amphibian'] else 'circle-aquatics',
                   'topics': ['治愈瞬间', '行为观察'],
                   'visualReview': 'content/batch-004/photo-review/nonmammal-final-review.json'})


def asset(row):
    local = ROOT / row['localFile']
    if not local.is_file() or sha(local) != row['sha256']:
        raise ValueError('Source copy missing or changed: ' + str(row['pageid']))
    title = row['title'].removeprefix('File:')
    license_url = 'https://creativecommons.org/publicdomain/zero/1.0/' if row['license'] == 'CC0' else row['licenseUrl'].replace('http:', 'https:') or row['sourceUrl']
    return {'url': row['url'], 'originalUrl': row['originalUrl'], 'sourceUrl': row['sourceUrl'],
            'author': row['author'], 'license': {'name': row['license'], 'url': license_url},
            'attribution': f"{row['author']}；{title}；Wikimedia Commons；{row['license']}",
            'modifiedDescription': '使用来源页面提供的缩略图；列表按比例裁切，详情支持查看完整画面。',
            'contentHash': row['sha256']}


additions = []
selected_sources = []
seen = set()
for group in groups:
    new_ids = group['newPageids']
    references = group.get('additionalPhotoIds', [])
    assert new_ids and 2 <= len(new_ids) + len(references) <= 3
    assert not seen.intersection(new_ids), 'New original reused in another post'
    seen.update(new_ids)
    records = [pool[pid] for pid in new_ids]
    selected_sources.extend(records)
    first = records[0]
    images = [asset(row) for row in records]
    for photo_id in references:
        assert photo_id in old and old[photo_id]['contentType'] == 'photo'
    additions.append({'id': 'photo-b004-' + group['slug'], 'contentType': 'photo',
                      **{key: group[key] for key in ['title', 'text', 'animalTypes', 'circleId', 'topics']},
                      'editorId': 'catalog-photo',
                      'source': {'title': first['title'].removeprefix('File:'), 'publisher': 'Wikimedia Commons',
                                 'url': first['sourceUrl'], 'author': first['author'], 'checkedAt': '2026-09-30'},
                      'review': {'status': 'approved', 'reviewer': '有宠有邻素材与组图画面复核', 'reviewedAt': '2026-09-30'},
                      'images': images, **({'additionalPhotoIds': references} if references else {}),
                      'sourceEvidence': {'reviewMode': 'saved-public-metadata-and-local-visual-review',
                                         'checkedAtMeaning': '复核日期指本地来源元数据、素材副本及最终成组画面核验日期，不等同于当日重访全部来源网页。',
                                         'speciesGroup': group['group'], 'newOriginalPageids': new_ids,
                                         'visualReview': group['visualReview'],
                                         'imageSources': [{'pageid': row['pageid'], 'metadataFile': row['metadataFile'],
                                                           'downloadedFile': row['localFile'], 'sha256': row['sha256'],
                                                           'sourceUrl': row['sourceUrl']} for row in records],
                                         'existingCompanionPhotoIds': references,
                                         'editorialNote': '按动物与画面主题整理的公开许可照片，不代表同一个体、同一家庭、连续经历或编辑本人拍摄。'}})

videos = load('content/batch-004/videos/packaged-items.json')
additions.extend(videos)
assert len({row['id'] for row in additions}) == len(additions)
assert all(row['contentType'] in ['photo', 'video'] for row in additions)
counts = Counter(row['contentType'] for row in baseline['items'] + additions)
proposed = {**baseline, 'targets': dict(counts), 'items': baseline['items'] + additions}
write(BASE / 'photo-sources/selected.json', selected_sources)
write(BASE / 'additions.json', additions)
write(BASE / 'proposed-manifest.json', proposed)
currently_published = load('content/batch-001/approved.json') == proposed
write(BASE / 'status.json', {'requestedAdditions': 100, 'preparedAdditions': len(additions),
                           'contentTypes': dict(Counter(row['contentType'] for row in additions)),
                           'newPhotoOriginals': len(seen), 'photoSpecies': dict(Counter(group['group'] for group in groups)),
                           'basePreserved': True, 'published': currently_published,
                           'publicationComplete': currently_published and len(additions) == 100})
if args.publish:
    if len(additions) != 100 and not (args.allow_partial and 1 <= len(additions) < 100):
        raise ValueError('Publication needs exactly 100 reviewed additions; only ' + str(len(additions)) + ' prepared')
    current = load('content/batch-001/approved.json')
    current_ids = {row['id'] for row in current['items']}
    accepted_ids = set(old) | {row['id'] for row in additions}
    if not set(old).issubset(current_ids) or any(row['id'] not in accepted_ids or row['id'] in old and row != old[row['id']] for row in current['items']):
        raise ValueError('Current catalogue changed; merge explicitly without replacing user changes')
    if len(additions) == 100:
        reviewed = load('content/batch-004/review-evidence.json')
        for relative, expected in reviewed['reviewedFileSha256'].items():
            if sha(ROOT / relative) != expected:
                raise ValueError('Reviewed evidence changed; review again before publication: ' + relative)
    for video in videos:
        clip = ROOT / video['sourceEvidence']['preparedVideoFile']
        poster = ROOT / video['sourceEvidence']['feedPosterFile']
        for source, relative, expected in [(clip, video['video']['url'], video['video']['contentHash']),
                                            (poster, video['video']['poster'], video['images'][0]['contentHash'])]:
            if sha(source) != expected:
                raise ValueError('Reviewed packaged asset changed: ' + str(source))
            target = ROOT / 'miniprogram' / relative.lstrip('/')
            if target.exists() and sha(target) != expected:
                raise ValueError('Refusing to replace another packaged asset: ' + str(target))
            target.parent.mkdir(parents=True, exist_ok=True)
            if not target.exists():
                shutil.copyfile(source, target)
    write(ROOT / 'content/batch-001/approved.json', proposed)
    state = json.loads((BASE / 'status.json').read_text())
    state.update({'published': True, 'publicationComplete': len(additions) == 100})
    write(BASE / 'status.json', state)
print(json.dumps({'prepared': len(additions), 'types': dict(Counter(row['contentType'] for row in additions)),
                  'newPhotos': len(seen), 'activeManifestUpdated': args.publish}, ensure_ascii=False))
