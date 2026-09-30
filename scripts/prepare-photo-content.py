"""Prepare reviewed Commons photos for the manifest; no networking or publish."""
import hashlib
import html
import json
import re
import argparse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'content/batch-001'


def plain(value):
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]*>', ' ', value or ''))).strip()


def main(fill=False):
    captions = json.loads((BASE / 'sources/photo-captions.json').read_text())
    review = json.loads((BASE / 'sources/photo-exclusions.json').read_text())
    reviewed = set(review['reviewedPageids'])
    excluded = {item['pageid'] for item in review['exclusions']}
    dog_captions = BASE / 'sources/dog-photo-captions.json'
    dog_review = BASE / 'sources/dog-photo-exclusions.json'
    if dog_captions.exists() and dog_review.exists():
        captions.update(json.loads(dog_captions.read_text()))
        extra_review = json.loads(dog_review.read_text())
        reviewed.update(extra_review['reviewedPageids'])
        excluded.update(item['pageid'] for item in extra_review['exclusions'])
    licenses = {
        'CC BY 4.0': 'https://creativecommons.org/licenses/by/4.0/',
        'CC BY-SA 4.0': 'https://creativecommons.org/licenses/by-sa/4.0/',
        'CC0': 'https://creativecommons.org/publicdomain/zero/1.0/'
    }
    groups = {'cats': [], 'dogs': []}
    for species in groups:
        metadata_file = BASE / ('sources/commons-' + species + '-metadata.json')
        if not metadata_file.exists():
            continue
        for record in json.loads(metadata_file.read_text()):
            pageid = record['pageid']
            if pageid not in reviewed or pageid in excluded or str(pageid) not in captions:
                continue
            local = BASE / 'media' / (str(pageid) + '.source')
            if not local.is_file():
                continue
            info = record['imageinfo'][0]
            meta = info['extmetadata']
            value = lambda key: plain(meta.get(key, {}).get('value', ''))
            license_name = value('LicenseShortName')
            author = value('Artist')
            if license_name not in licenses or not author or len(author) > 160 or value('Restrictions'):
                continue
            original_title = record['title'].removeprefix('File:')
            if len(original_title) > 300:
                continue
            caption = captions[str(pageid)]
            title = caption['title']
            source_url = info['descriptionurl']
            attribution = (value('Attribution') or author) + '；原作《' + original_title + '》；来源：Wikimedia Commons；' + license_name + '。'
            if len(attribution) > 600:
                continue
            nicknames = ['catalog-photo', 'catalog-cat-home', 'catalog-cat-behavior'] if species == 'cats' else ['catalog-photo', 'catalog-dog-life', 'catalog-dog-walk']
            post = {
                'id': 'photo-commons-' + str(pageid), 'contentType': 'photo',
                'title': title,
                'text': caption['caption'] + '\n\n原作：《' + original_title + '》。摄影：' + author + '。',
                'topics': ['宠物治愈时刻'],
                'circleId': 'circle-cats' if species == 'cats' else 'circle-walks',
                'editorId': nicknames[pageid % len(nicknames)],
                'source': {'title': original_title, 'publisher': 'Wikimedia Commons', 'url': source_url, 'author': author, 'checkedAt': '2026-09-29'},
                'review': {'status': 'approved', 'reviewer': '有宠有邻内容整理', 'reviewedAt': '2026-09-29'},
                'images': [{
                    'url': info.get('thumburl') or info['url'], 'originalUrl': info['url'],
                    'sourceUrl': source_url, 'author': author,
                    'license': {'name': license_name, 'url': licenses[license_name]},
                    'attribution': attribution,
                    'modifiedDescription': '采用原作的缩略图展示；界面可能按比例裁切，图片仍按上述许可提供。',
                    'contentHash': hashlib.sha256(local.read_bytes()).hexdigest()
                }],
                'sourceEvidence': {'metadataFile': str(metadata_file.relative_to(ROOT)), 'pageid': pageid, 'downloadedFile': str(local.relative_to(ROOT)), 'visualReview': 'content/batch-001/sources/' + ('photo-exclusions.json' if species == 'cats' else 'dog-photo-exclusions.json')}
            }
            groups[species].append(post)
    # Keep existing approved photos while filling 100 per species. New
    # candidates must not silently displace a photo users already interacted with.
    existing_file = BASE / 'approved.json'
    existing_ids = {item['id'] for item in json.loads(existing_file.read_text()).get('items', [])} if existing_file.exists() else set()
    for values in groups.values():
        values.sort(key=lambda post: (post['id'] not in existing_ids, int(post['id'].rsplit('-', 1)[-1])))
    items = []
    for index in range(max(map(len, groups.values()))):
        for values in groups.values():
            if index < min(len(values), 100):
                items.append(values[index])
    if fill and len(items) < 200:
        included = {item['id'] for item in items}
        for values in groups.values():
            items.extend(item for item in values if item['id'] not in included)
    selected = items[:200]
    output = BASE / 'photos.json'
    output.write_text(json.dumps(selected, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'reviewedEligible': sum(map(len, groups.values())), 'selected': len(selected), 'cats': sum(item['circleId'] == 'circle-cats' for item in selected), 'dogs': sum(item['circleId'] == 'circle-walks' for item in selected), 'output': str(output)}, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--fill', action='store_true', help='Use reviewed surplus from either species to fill 200 photos after the balanced selection.')
    main(parser.parse_args().fill)
