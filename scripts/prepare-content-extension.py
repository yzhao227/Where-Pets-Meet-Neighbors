"""Reproduce the offline, visually reviewed batch-003 extension; never fetch URLs.

--prepare-media re-encodes local source clips and extracts posters for review.
The default mode accepts only the exact files recorded in review/evidence.json.
"""
import argparse
import hashlib
import html
import json
from pathlib import Path
import re
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'content/batch-003'
MINI = ROOT / 'miniprogram'
REVIEW_DATE = '2026-09-30'
parser = argparse.ArgumentParser()
parser.add_argument('--prepare-media', action='store_true')
args = parser.parse_args()


def read(relative):
    return json.loads((ROOT / relative).read_text())


def sha(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()


def write(file, value):
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


descriptions = read('content/batch-003/video-descriptions.json')
for folder in [BASE / 'media', MINI / 'media/clips', MINI / 'assets/curated-poster']:
    folder.mkdir(parents=True, exist_ok=True)

if args.prepare_media:
    prepared = []
    for description in descriptions:
        pid = description['pageid']
        source = ROOT / f'content/batch-002/media/{pid}.webm'
        output = BASE / f'media/{pid}.mp4'
        poster = MINI / f'assets/curated-poster/{pid}.jpg'
        subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', str(source), '-t', '8', '-an',
                        '-vf', 'scale=480:-2,fps=20', '-c:v', 'libx264', '-profile:v', 'baseline',
                        '-level', '3.0', '-pix_fmt', 'yuv420p', '-preset', 'slow', '-crf', '29',
                        '-maxrate', '260k', '-bufsize', '520k', '-movflags', '+faststart', str(output)], check=True)
        subprocess.run(['ffmpeg', '-y', '-v', 'error', '-ss', str(description['posterAtSeconds']),
                        '-i', str(source), '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '5', str(poster)], check=True)
        prepared.append({'pageid': pid, 'clipSha256': sha(output), 'posterSha256': sha(poster),
                         'clipBytes': output.stat().st_size, 'posterBytes': poster.stat().st_size})
    print(json.dumps({'reviewRequired': True, 'media': prepared}, ensure_ascii=False, indent=2))
    raise SystemExit(0)

evidence = read('content/batch-003/review/evidence.json')
for relative, expected in evidence['reviewedFileSha256'].items():
    if sha(ROOT / relative) != expected:
        raise ValueError('Reviewed evidence changed; re-review before building: ' + relative)

baseline = read('content/batch-003/baseline-250.json')
by_id = {item['id']: item for item in baseline['items']}
assert len(by_id) == 250
groups = read('content/batch-003/groups.json')
assert len(groups) == 8
additions = []
for group in groups:
    references = [by_id[pid] for pid in group['imagePhotoIds']]
    assert all(item['contentType'] == 'photo' and item['review']['status'] == 'approved' for item in references)
    additions.append({**group, 'contentType': 'knowledge', 'editorId': 'catalog-pet-care',
                      'source': references[0]['source'], 'images': [],
                      'review': {'status': 'approved', 'reviewer': '有宠有邻编辑图解离线复核', 'reviewedAt': REVIEW_DATE},
                      'sourceEvidence': {'reviewMode': 'offline-existing-evidence', 'editorialReviewedAt': REVIEW_DATE,
                                         'publicPagesFetchedInThisBatch': False,
                                         'visualReview': 'content/batch-003/review/photo-groups.jpg',
                                         'reviewRecord': 'content/batch-003/review/evidence.json',
                                         'imageSources': [{'photoId': item['id'], 'source': item['source'],
                                                          'sourceEvidence': item['sourceEvidence']} for item in references],
                                         'note': '仅对原已采集图片、来源记录及编辑配文作离线复核；各图为不同个体或场景，不构成连续经历。'}})

records = {item['pageid']: item for item in read('content/batch-002/sources/videos-metadata.json')}
for description in descriptions:
    pid = description['pageid']
    record = records[pid]
    info = record['videoinfo'][0]
    meta = info['extmetadata']
    plain = lambda key: html.unescape(re.sub('<[^>]+>', '', str(meta.get(key, {}).get('value', '')))).strip()
    if plain('LicenseShortName') != 'CC0' or plain('AttributionRequired') != 'false' or plain('Restrictions'):
        raise ValueError('Unexpected licence for ' + str(pid))
    clip = BASE / f'media/{pid}.mp4'
    poster = MINI / f'assets/curated-poster/{pid}.jpg'
    probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(clip)]))
    streams = probe['streams']
    if len(streams) != 1 or streams[0]['codec_name'] != 'h264' or abs(float(probe['format']['duration']) - 8) > .01 or clip.stat().st_size > 300 * 1024:
        raise ValueError('Unexpected encoded clip ' + str(pid))
    shutil.copyfile(clip, MINI / f'media/clips/{pid}.mp4')
    author = plain('Artist')
    title = record['title'].removeprefix('File:')
    common = {'sourceUrl': info['descriptionurl'], 'author': author,
              'license': {'name': 'CC0', 'url': 'https://creativecommons.org/publicdomain/zero/1.0/'},
              'attribution': f'{author}；{title}；Wikimedia Commons；CC0'}
    poster_url = f'/assets/curated-poster/{pid}.jpg'
    additions.append({'id': f'video-commons-{pid}', 'contentType': 'video',
                      **{key: description[key] for key in ['title', 'text', 'circleId', 'animalTypes', 'topics']},
                      'editorId': 'catalog-photo',
                      'source': {'title': title, 'publisher': 'Wikimedia Commons', 'url': info['descriptionurl'],
                                 'author': author, 'checkedAt': REVIEW_DATE},
                      'review': {'status': 'approved', 'reviewer': '有宠有邻内容离线复核', 'reviewedAt': REVIEW_DATE},
                      'images': [{**common, 'url': poster_url, 'originalUrl': info['url'],
                                  'modifiedDescription': f"从原片第{description['posterAtSeconds']}秒提取JPEG封面帧，宽度缩放至480像素，列表按比例裁切。",
                                  'contentHash': sha(poster)}],
                      'video': {**common, 'url': f'/media/clips/{pid}.mp4', 'poster': poster_url,
                                'durationSeconds': 8, 'width': streams[0]['width'], 'height': streams[0]['height'],
                                'originalUrl': info['url'], 'contentHash': sha(clip),
                                'modifiedDescription': '截取原片前8秒，去除音轨，宽度缩放至480像素后转为H.264 MP4，20帧每秒。'},
                      'sourceEvidence': {'metadataFile': 'content/batch-002/sources/videos-metadata.json', 'pageid': pid,
                                         'downloadedFile': f'content/batch-002/media/{pid}.webm',
                                         'posterFile': f'miniprogram/assets/curated-poster/{pid}.jpg',
                                         'visualReview': f'content/batch-003/review/{pid}-review.jpg',
                                         'reviewRecord': 'content/batch-003/review/evidence.json',
                                         'reviewMode': 'offline-existing-evidence', 'publicPagesFetchedInThisBatch': False,
                                         'checkedAtMeaning': '2026-09-30离线复核已保存的来源元数据、原片、每0.5秒抽帧及封面，不代表当日重新请求来源网页。',
                                         'reviewMethod': '检查8秒片段的16张间隔0.5秒帧及对应原片封面；编码无音轨。',
                                         'collectionGroup': 'videos'}})

assert len(additions) == 10
current = read('content/batch-001/approved.json')
permitted = set(by_id) | {item['id'] for item in additions}
if any(item['id'] not in permitted for item in current['items']):
    raise ValueError('Current snapshot has other additions; merge them explicitly instead of replacing them.')
for item in current['items']:
    if item['id'] in by_id and item != by_id[item['id']]:
        raise ValueError('Baseline record was edited: ' + item['id'])
expanded = {**baseline, 'targets': {'knowledge': 58, 'photo': 197, 'video': 5}, 'items': [*baseline['items'], *additions]}
write(BASE / 'additions.json', additions)
write(ROOT / 'content/batch-001/approved.json', expanded)
print(json.dumps({'total': len(expanded['items']), 'targets': expanded['targets'],
                  'groupImages': sum(len(item['imagePhotoIds']) for item in groups),
                  'networkRequested': False, 'baselinePreserved': True}, ensure_ascii=False))
