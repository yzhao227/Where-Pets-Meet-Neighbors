"""Build reviewed additions in this batch only; never mutate approved catalogue."""
import hashlib
import html
import json
from pathlib import Path
import re
import subprocess
from PIL import Image, ImageDraw

BASE = Path(__file__).resolve().parents[1]
ROOT = BASE.parents[1]
DATE = '2026-09-30'

def sha(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()

def write(file, value):
    file.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')

sources = {}
for relative in ['content/batch-002/sources/videos-metadata.json', 'content/batch-004/video-sources/metadata.json']:
    for record in json.loads((ROOT / relative).read_text()):
        sources[record['pageid']] = (record, relative)
items, evidence, posters = [], {}, []
descriptions = json.loads((BASE / 'videos/descriptions.json').read_text())
for description in descriptions:
    pid = description['pageid']
    record, metadata_file = sources[pid]
    info = record['videoinfo'][0]
    meta = info['extmetadata']
    plain = lambda key: re.sub(r'\s+', ' ', html.unescape(re.sub('<[^>]+>', '', str(meta.get(key, {}).get('value', ''))))).strip()
    if plain('LicenseShortName') != 'CC0' or plain('AttributionRequired') != 'false' or plain('Restrictions'):
        raise ValueError('Unexpected licence for ' + str(pid))
    clip = BASE / f'videos/{pid}.mp4'
    poster = BASE / f'videos/{pid}-poster.jpg'
    review = BASE / f'video-review/{pid}-review.jpg'
    source = BASE / f'video-sources/{pid}.webm'
    if not source.exists():
        source = ROOT / f'content/batch-002/media/{pid}.webm'
    probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(clip)]))
    streams = probe['streams']
    duration = float(probe['format']['duration'])
    if len(streams) != 1 or streams[0]['codec_name'] != 'h264' or duration > 8.01 or duration < 5 or clip.stat().st_size > 300 * 1024:
        raise ValueError('Unexpected encoded clip ' + str(pid))
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-ss', str(description['posterAtSeconds']), '-i', str(clip),
                    '-frames:v', '1', '-q:v', '5', str(poster)], check=True)
    author = plain('Artist')
    title = record['title'].removeprefix('File:')
    common = {'sourceUrl': info['descriptionurl'], 'author': author,
        'license': {'name': 'CC0', 'url': 'https://creativecommons.org/publicdomain/zero/1.0/'},
        'attribution': f'{author}；{title}；Wikimedia Commons；CC0'}
    poster_url = f'/assets/curated-poster/{pid}.jpg'
    item = {'id': f'video-commons-{pid}', 'contentType': 'video',
        **{key: description[key] for key in ['title', 'text', 'circleId', 'animalTypes', 'topics']},
        'editorId': 'catalog-photo',
        'source': {'title': title, 'publisher': 'Wikimedia Commons', 'url': info['descriptionurl'], 'author': author, 'checkedAt': DATE},
        'review': {'status': 'approved', 'reviewer': '有宠有邻内容复核', 'reviewedAt': DATE},
        'images': [{**common, 'url': poster_url, 'originalUrl': info['url'],
            'modifiedDescription': f"从选用片段第{description['posterAtSeconds']}秒提取JPEG封面帧，按原比例缩放，列表按比例裁切。", 'contentHash': sha(poster)}],
        'video': {**common, 'url': f'/media2/clips/{pid}.mp4', 'poster': poster_url,
            'durationSeconds': duration, 'width': streams[0]['width'], 'height': streams[0]['height'],
            'originalUrl': info['url'], 'contentHash': sha(clip),
            'modifiedDescription': f"截取原片{description.get('startSeconds',0)}–{description.get('startSeconds',0)+duration}秒，去除音轨，长边缩放至480像素后转为H.264 baseline MP4，20帧每秒。"},
        'sourceEvidence': {'metadataFile': metadata_file, 'pageid': pid,
            'downloadedFile': str(source.relative_to(ROOT)), 'preparedVideoFile': str(clip.relative_to(ROOT)),
            'posterFile': str(poster.relative_to(ROOT)), 'visualReview': str(review.relative_to(ROOT)),
            'reviewRecord': 'content/batch-004/video-review/evidence.json',
            'reviewMethod': '实际检查选用片段的每0.5秒抽帧接触图及对应封面；编码无音轨。',
            'reviewMode': 'saved-source-visual-review', 'collectionGroup': 'videos'}}
    items.append(item)
    for file in [source, clip, poster, review]: evidence[str(file.relative_to(ROOT))] = sha(file)
    posters.append((pid, poster))
write(BASE / 'videos/items.json', items)
write(BASE / 'video-review/evidence.json', {'reviewedAt': DATE, 'reviewedIds': [x['id'] for x in items],
    'reviewedFileSha256': evidence, 'note': '原始来源记录保留作者、CC0许可与源页；配文只描述画面，不虚构作者经历，不构成饲养建议。'})
sheet = Image.new('RGB', (960, ((len(posters)+3)//4)*180), '#eee')
draw = ImageDraw.Draw(sheet)
for i, (pid, file) in enumerate(posters):
    im=Image.open(file); im.thumbnail((234,154)); x=(i%4)*240; y=(i//4)*180
    sheet.paste(im,(x+(240-im.width)//2,y));draw.text((x+5,y+158),str(pid),fill='#111')
sheet.save(BASE / 'video-review/posters.jpg',quality=90)
print(json.dumps({'items':len(items),'bytes':sum((ROOT / x['sourceEvidence']['preparedVideoFile']).stat().st_size for x in items)},ensure_ascii=False))
