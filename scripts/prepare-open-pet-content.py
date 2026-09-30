"""Prepare a reviewed, diverse snapshot. Never modifies the active catalogue."""
import copy
import hashlib
import json
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'content/batch-002'
CAPTIONS = [('neighbor-captions.json', 'neighbor-review.json'),
            ('cats-dogs-captions.json', 'cats-dogs-review.json')]
LICENSES = {'CC0': 'https://creativecommons.org/publicdomain/zero/1.0/', 'Public domain': None}
RETAINED_PHOTO_IDS = {'photo-commons-61856994', 'photo-commons-76097663', 'photo-commons-81513944',
                      'photo-commons-61369169', 'photo-commons-61619827', 'photo-commons-191392916'}
CIRCLES = {'circle-neighbors', 'circle-cats', 'circle-walks', 'circle-small-pets',
           'circle-birds', 'circle-aquatics', 'circle-exotics', 'circle-beginners'}
GROUP_CAPS = {'rabbits': 12, 'guinea-pigs': 10, 'hamsters': 10, 'birds': 14,
              'fish': 11, 'turtles': 8, 'lizards': 10, 'snakes': 4, 'shrimp': 8,
              'other-small-pets': 8, 'amphibians': 8, 'aquarium': 8}
TOPICS = {'饮食喂养', '行为观察', '健康护理', '居家布置', '户外出行', '成长记录', '治愈瞬间', '陪伴日常'}
ALIASES = {'宠物治愈时刻': '治愈瞬间', '新手养宠': '健康护理', '一起散步': '户外出行',
           '没养宠也能来': '陪伴日常', '宠物友好去处': '户外出行', '养宠经验': '成长记录'}
KNOWLEDGE_TOPICS = {
    1: ['饮食喂养'], 2: ['饮食喂养'], 3: ['陪伴日常'], 4: ['居家布置'], 5: ['户外出行'],
    6: ['健康护理'], 7: ['健康护理'], 14: ['健康护理', '行为观察'], 17: ['健康护理'], 19: ['健康护理'],
    23: ['居家布置', '行为观察'], 24: ['行为观察'], 25: ['居家布置'], 26: ['居家布置'],
    28: ['居家布置', '健康护理'], 30: ['居家布置'], 32: ['行为观察', '居家布置'],
    33: ['行为观察'], 34: ['行为观察'], 35: ['行为观察', '陪伴日常'],
    37: ['居家布置', '行为观察'], 40: ['健康护理', '行为观察'], 41: ['健康护理'],
    45: ['行为观察'], 47: ['行为观察', '健康护理'], 50: ['健康护理'],
    52: ['饮食喂养'], 53: ['户外出行'], 57: ['陪伴日常'], 61: ['户外出行', '健康护理'],
    63: ['行为观察'], 64: ['居家布置', '行为观察'], 65: ['行为观察'],
    67: ['居家布置'], 68: ['陪伴日常'], 70: ['饮食喂养', '行为观察'], 71: ['行为观察'],
    72: ['行为观察', '陪伴日常'], 76: ['行为观察', '成长记录'], 77: ['成长记录'],
    79: ['行为观察'], 80: ['健康护理'], 81: ['行为观察'], 82: ['行为观察'],
    86: ['饮食喂养', '健康护理'], 87: ['饮食喂养', '健康护理'], 89: ['饮食喂养', '健康护理'],
    91: ['饮食喂养', '健康护理'], 93: ['饮食喂养', '健康护理'], 94: ['饮食喂养', '健康护理']}
BEGINNERS = {1, 2, 3, 4, 5, 6, 7, 14, 17, 19, 52, 53, 57, 61, 67, 68, 76, 77}


def read(path):
    return json.loads(path.read_text())


def canonical_topics(values):
    result = list(dict.fromkeys(ALIASES.get(value, value) for value in values))
    if not set(result) <= TOPICS:
        raise ValueError('Unknown topics: ' + str(result))
    return result


def canonical_asset_url(value):
    """Match catalogue import deduplication, including escaped Unicode paths."""
    parsed = urlsplit(value)
    scheme, host = parsed.scheme.lower(), (parsed.hostname or '').lower()
    port = parsed.port
    if ':' in host:
        host = '[' + host + ']'
    if port and (scheme, port) not in {('https', 443), ('http', 80)}:
        host += ':' + str(port)
    try:
        path = unicodedata.normalize('NFC', unquote(parsed.path, errors='strict'))
    except UnicodeError:
        path = parsed.path
    return scheme + '://' + host + path.removesuffix('/')


def claim_assets(post, used_assets, used_hashes):
    """Reserve every image, video and poster atomically, before picking photos."""
    assets = list(post.get('images', []))
    if post.get('video'):
        assets.append(post['video'])
    originals, hashes = set(), set()
    for asset in assets:
        original = canonical_asset_url(asset['originalUrl'])
        digest = asset.get('contentHash', '').strip().lower().removeprefix('sha256:')
        if original in used_assets or original in originals or digest and (digest in used_hashes or digest in hashes):
            return False
        originals.add(original)
        if digest:
            hashes.add(digest)
    used_assets.update(originals)
    used_hashes.update(hashes)
    return True


def photo_candidates():
    available = {}
    for caption_name, review_name in CAPTIONS:
        caption_file, review_file = BASE / 'sources' / caption_name, BASE / 'sources' / review_name
        if not caption_file.exists() or not review_file.exists():
            continue
        review, captions = read(review_file), read(caption_file)
        reviewed = set(review['reviewedPageids'])
        excluded = {row['pageid'] for row in review.get('exclusions', [])}
        for candidate_file in sorted((BASE / 'sources').glob('*-candidates.json')):
            if candidate_file.name == 'videos-candidates.json':
                continue
            for candidate in read(candidate_file):
                pageid = candidate['pageid']
                if pageid not in reviewed or pageid in excluded or str(pageid) not in captions:
                    continue
                caption = captions[str(pageid)]
                license_name = candidate['license']
                if license_name not in LICENSES:
                    continue
                image_file = ROOT / candidate['localFile']
                if not image_file.is_file():
                    continue
                circle = caption['circleId']
                if circle not in CIRCLES:
                    raise ValueError('Unexpected circle: ' + circle)
                editors = ['catalog-photo', 'catalog-pet-care']
                if circle == 'circle-cats':
                    editors = ['catalog-photo', 'catalog-cat-home', 'catalog-cat-behavior']
                elif circle == 'circle-walks':
                    editors = ['catalog-photo', 'catalog-dog-life', 'catalog-dog-walk']
                title = candidate['title'].removeprefix('File:')
                available[pageid] = {
                    'id': 'photo-commons-' + str(pageid), 'contentType': 'photo',
                    'title': caption['title'], 'text': caption['caption'],
                    'topics': canonical_topics(caption['topics']), 'circleId': circle,
                    'animalTypes': caption['animalTypes'], 'editorId': editors[pageid % len(editors)],
                    'source': {'title': title, 'publisher': 'Wikimedia Commons',
                               'url': candidate['sourceUrl'], 'author': candidate['author'], 'checkedAt': '2026-09-29'},
                    'review': {'status': 'approved', 'reviewer': '有宠有邻内容复核', 'reviewedAt': '2026-09-29'},
                    'images': [{
                        'url': candidate['url'], 'originalUrl': candidate['originalUrl'],
                        'sourceUrl': candidate['sourceUrl'], 'author': candidate['author'],
                        # A missing PD licence URL is evidenced by its actual Commons file page,
                        # never by claiming the uploader attached a particular CC mark.
                        'license': {'name': license_name, 'url': LICENSES[license_name] or candidate.get('licenseUrl') or candidate['sourceUrl']},
                        'attribution': candidate['author'] + '；' + title + '；Wikimedia Commons；' + license_name,
                        'modifiedDescription': '使用缩略图，列表按比例裁切。',
                        'contentHash': hashlib.sha256(image_file.read_bytes()).hexdigest()
                    }],
                    'sourceEvidence': {'metadataFile': candidate['metadataFile'], 'pageid': pageid,
                                       'downloadedFile': candidate['localFile'],
                                       'visualReview': str(review_file.relative_to(ROOT)),
                                       'collectionGroup': caption.get('group', candidate['group'])}
                }
    return available


def main():
    available = photo_candidates()
    current = read(ROOT / 'content/batch-001/approved.json')
    old_captions = read(ROOT / 'content/batch-001/sources/photo-captions.json')
    old_captions.update(read(ROOT / 'content/batch-001/sources/dog-photo-captions.json'))
    retained = []
    for original in current['items']:
        if original['id'] not in RETAINED_PHOTO_IDS:
            continue
        if original['contentType'] != 'photo' or not original['images'] or any(image['license']['name'] not in LICENSES for image in original['images']):
            raise ValueError('Retained photo has missing or unsupported media: ' + original['id'])
        post = copy.deepcopy(original)
        pageid = int(post['id'].rsplit('-', 1)[-1])
        original_caption = old_captions.get(str(pageid))
        if original_caption:
            post['text'] = original_caption['caption']
        post['animalTypes'] = ['cat' if post['circleId'] == 'circle-cats' else 'dog']
        post['topics'] = canonical_topics(post['topics'])
        retained.append(post)
        available.pop(pageid, None)
    selected, used_assets, used_hashes = [], set(), set()

    def add(post):
        if not claim_assets(post, used_assets, used_hashes):
            return False
        selected.append(post)
        return True

    for post in retained:
        if not add(post):
            raise ValueError('Retained photos share media: ' + post['id'])
    if {post['id'] for post in retained} != RETAINED_PHOTO_IDS:
        raise ValueError('This batch must retain all six original CC0 photos')
    videos_file = BASE / 'videos.json'
    videos = read(videos_file) if videos_file.exists() else []
    if len(videos) != 3:
        raise ValueError('This batch requires exactly three reviewed bundled clips; no output was written')
    for video in videos:
        if video['contentType'] != 'video' or video['circleId'] in ['circle-cats', 'circle-walks'] or set(video.get('animalTypes', [])) & {'cat', 'dog'}:
            raise ValueError('Bundled clips must belong to the other-animal selection: ' + video['id'])
        if not claim_assets(video, used_assets, used_hashes):
            raise ValueError('Bundled video or poster shares already selected media: ' + video['id'])
    for circle in ['circle-cats', 'circle-walks']:
        for post in available.values():
            if sum(p['circleId'] == circle for p in selected) >= 50:
                break
            if post['circleId'] == circle:
                add(post)
    other_target = 100 - len(videos)
    buckets = defaultdict(list)
    for post in available.values():
        if post['circleId'] not in ['circle-cats', 'circle-walks']:
            buckets[post['sourceEvidence']['collectionGroup']].append(post)
    chosen_groups = Counter()
    while sum(chosen_groups.values()) < other_target:
        changed = False
        for group, bucket in buckets.items():
            if not bucket or chosen_groups[group] >= GROUP_CAPS.get(group, 8):
                continue
            if sum(chosen_groups.values()) >= other_target:
                break
            post = bucket.pop(0)
            if add(post):
                chosen_groups[group] += 1
            changed = True
        if not changed:
            break
    knowledge = [copy.deepcopy(p) for p in current['items'] if p['contentType'] == 'knowledge']
    cover_buckets = {animal: [p for p in selected if p.get('animalTypes') == [animal]] for animal in ['cat', 'dog']}
    cover_indices = Counter()
    for index, post in enumerate(knowledge):
        number = int(post['id'].rsplit('-', 1)[-1])
        animal = 'cat' if number <= 50 else 'dog' if number <= 82 else ('cat' if index % 2 else 'dog')
        post['animalTypes'] = ['cat', 'dog'] if number > 82 else [animal]
        post['topics'] = KNOWLEDGE_TOPICS[number]
        if number in BEGINNERS:
            post['circleId'] = 'circle-beginners'
        if cover_buckets[animal]:
            post['coverPhotoId'] = cover_buckets[animal][cover_indices[animal] % len(cover_buckets[animal])]['id']
            cover_indices[animal] += 1
        for phrase in ['ASPCA明确提醒，', 'ASPCA的基础照护建议是', 'ASPCA建议', 'ASPCA提醒，', 'ASPCA提到，',
                       'ASPCA指出，', 'ASPCA说明，', 'ASPCA给出的基础安排是', 'ASPCA将其称为', 'ASPCA强调，',
                       '原文建议', '资料提到']:
            replacement = {'ASPCA的基础照护建议是': '建议', 'ASPCA给出的基础安排是': '基础安排是',
                           'ASPCA将其称为': '这种情况称为'}.get(phrase, '')
            post['text'] = post['text'].replace(phrase, replacement)
    manifest = {'batchId': 'batch-001', 'targets': {'knowledge': 50, 'photo': 200 - len(videos), 'video': len(videos)},
                'omitPublicAttribution': True, 'items': knowledge + selected + videos}
    counts = Counter(post['contentType'] for post in manifest['items'])
    summary = {'counts': counts, 'byCircle': Counter(post['circleId'] for post in manifest['items']),
               'newPhotosByGroup': chosen_groups,
               'retainedExisting': sum(post['id'] in RETAINED_PHOTO_IDS for post in selected),
               'complete': len(knowledge) == 50 and len(selected) + len(videos) == 200 and
                  sum(p['circleId'] == 'circle-cats' for p in selected) == 50 and
                  sum(p['circleId'] == 'circle-walks' for p in selected) == 50}
    if not summary['complete']:
        raise ValueError('Incomplete reviewed batch; no output was written: ' + json.dumps(summary, ensure_ascii=False))
    if len({post['id'] for post in manifest['items']}) != len(manifest['items']):
        raise ValueError('Content IDs are duplicated; no output was written')
    if any(not post.get('coverPhotoId') or post.get('images') for post in knowledge):
        raise ValueError('Every knowledge card must reference one selected photo and have no own images')
    (BASE / 'photos.json').write_text(json.dumps(selected, ensure_ascii=False, indent=2) + '\n')
    (BASE / 'proposed-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(summary, ensure_ascii=False))


if __name__ == '__main__':
    main()
