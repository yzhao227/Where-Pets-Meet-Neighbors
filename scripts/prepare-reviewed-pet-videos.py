"""Package three visually reviewed CC0 excerpts with reproducible source evidence."""
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'content/batch-002'
spec = importlib.util.spec_from_file_location('open_pet_photos', ROOT / 'scripts/collect-open-pet-images.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
commons = module.commons
REVIEWED = {
    77198954: ('兔兔的摸摸时刻', '一只手轻抚兔子的颈侧，兔子靠在浅色墙旁，小嘴轻轻动着。镜头拉近后，鼻尖、胡须和脸颊的细小变化都看得清楚。停下来看看这几秒，也是一段轻松的陪伴。', 'circle-small-pets', ['rabbit'], ['陪伴日常']),
    164819779: ('台沿边的小鸟', '黄绿色的小鸟站在浅色台沿边，不时转头，还会俯身向前探一探。羽毛在明亮的背景里很醒目，几次小小的动作就让画面有了变化。安静看它一会儿，也能发现不少细节。', 'circle-birds', ['bird'], ['行为观察']),
    112285953: ('背着壳慢慢走', '水族箱里的寄居蟹背着螺壳沿石面缓缓走动，细长的触角伸向前方。镜头把步足、甲壳和砂砾拍得很近，平时容易忽略的小动作也显出来了。一次短短的水族观察。', 'circle-aquatics', ['invertebrate'], ['行为观察'])
}
records = {}
for filename in ['videos-metadata.json', 'bird-video-metadata.json']:
    for item in json.loads((BASE / 'sources' / filename).read_text()):
        records[item['pageid']] = (item, 'content/batch-002/sources/' + filename)
items = []
bundled_dir = ROOT / 'miniprogram/media/clips'
bundled_dir.mkdir(parents=True, exist_ok=True)
for pid, (title, text, circle, animals, topics) in REVIEWED.items():
    record, metadata_file = records[pid]
    info = record['videoinfo'][0]
    meta = info['extmetadata']
    value = lambda key: commons.plain(meta.get(key, {}).get('value', ''))
    if value('LicenseShortName') != 'CC0' or value('AttributionRequired') != 'false' or value('Restrictions'):
        raise ValueError('Unexpected licence for ' + str(pid))
    source = BASE / 'media' / (str(pid) + '.mp4')
    probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(source)]))
    streams = probe['streams']
    duration = float(probe['format']['duration'])
    if len(streams) != 1 or streams[0]['codec_name'] != 'h264' or abs(duration - 8) > 0.01 or source.stat().st_size > 300*1024:
        raise ValueError('Unexpected encoded excerpt ' + str(pid))
    poster_url = info['thumburl']
    poster_file = BASE / 'media' / (str(pid) + '-poster.source')
    if not poster_file.exists():
        poster_file.write_bytes(commons.fetch(poster_url))
    bundled = bundled_dir / (str(pid) + '.mp4')
    shutil.copyfile(source, bundled)
    author = value('Artist')
    original_title = record['title'].removeprefix('File:')
    license = {'name': 'CC0', 'url': 'https://creativecommons.org/publicdomain/zero/1.0/'}
    attribution = author + '；' + original_title + '；Wikimedia Commons；CC0'
    common = {'sourceUrl': info['descriptionurl'], 'author': author, 'license': license, 'attribution': attribution}
    item = {'id': 'video-commons-' + str(pid), 'contentType': 'video', 'title': title, 'text': text,
            'circleId': circle, 'animalTypes': animals, 'topics': topics, 'editorId': 'catalog-photo',
            'source': {'title': original_title, 'publisher': 'Wikimedia Commons', 'url': info['descriptionurl'],
                       'author': author, 'checkedAt': '2026-09-29'},
            'review': {'status': 'approved', 'reviewer': '有宠有邻内容复核', 'reviewedAt': '2026-09-29'},
            'images': [{**common, 'url': poster_url, 'originalUrl': poster_url,
                        'modifiedDescription': '使用原片缩略图作为封面，列表按比例裁切。',
                        'contentHash': hashlib.sha256(poster_file.read_bytes()).hexdigest()}],
            'video': {**common, 'url': '/assets/curated-video/' + str(pid) + '.mp4', 'poster': poster_url,
                      'durationSeconds': duration, 'width': streams[0]['width'], 'height': streams[0]['height'],
                      'originalUrl': info['url'], 'contentHash': hashlib.sha256(bundled.read_bytes()).hexdigest(),
                      'modifiedDescription': '截取原片前8秒，去除原音轨，缩放后转为H.264 MP4，20帧每秒。'},
            'sourceEvidence': {'metadataFile': metadata_file, 'pageid': pid,
                               'downloadedFile': str((BASE / 'media' / (str(pid) + '.webm')).relative_to(ROOT)),
                               'posterFile': str(poster_file.relative_to(ROOT)),
                               'visualReview': 'output/content-review/video/' + str(pid) + '-review.jpg',
                               'reviewMethod': '复核选用8秒片段，每0.5秒一帧；无音轨。',
                               'collectionGroup': 'videos'}}
    items.append(item)
(BASE / 'videos.json').write_text(json.dumps(items, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'count': len(items), 'bytes': sum((bundled_dir / (str(p['sourceEvidence']['pageid']) + '.mp4')).stat().st_size for p in items),
                  'ids': [p['id'] for p in items]}, ensure_ascii=False))
