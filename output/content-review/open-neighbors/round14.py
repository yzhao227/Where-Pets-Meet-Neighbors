import json
from importlib.machinery import SourceFileLoader
helper = SourceFileLoader('record', 'output/content-review/open-neighbors/record-review.py').load_module()
index = json.load(open('output/content-review/open-neighbors/latest-index.json'))
selected = {
    193433386: ('水草前的蓝绿孔雀鱼', '一条蓝绿色孔雀鱼侧身停在水草前，背鳍和尾鳍上布满深浅相间的斑点，细小鳍条清晰可见。', 'aquarium', 'fish'),
    175432775: ('岩石旁的橙色小鱼', '一条橙色小鱼侧身停在岩石造景旁，半透明胸鳍向外展开，鱼缸底部铺着浅色砂粒。', 'aquarium', 'fish'),
    155032662: ('水波里的红白身影', '几条红白相间的鱼靠近水面，水波和泡沫在它们周围泛起，鱼背的色块在水中交错。', 'aquarium', 'fish'),
}
excluded = {
    155032663: '与 155032662 为同一鱼群水面场景，保留主体较完整的一张',
    183715172: '与 193433386 为同一孔雀鱼照片的不同裁剪，保留完整尾鳍版本',
    155032661: '与 155032662 为同一鱼群水面场景，保留主体较完整的一张',
    151348509: '建筑远景，不是动物主体照片',
    18280749: '前景叶片遮挡且鱼主体很小，未选入首批',
    155032660: '与 155032662 为同一鱼群水面场景，保留主体较完整的一张',
}
assert set(selected) | set(excluded) == {r['pageid'] for r in index['records']}
helper.record(selected, excluded, [r['pageid'] for r in index['records']])
cp = helper.SRC / 'neighbor-captions.json'
rp = helper.SRC / 'neighbor-review.json'
captions = json.loads(cp.read_text())
review = json.loads(rp.read_text())
removals = {
    163230241: '手心仓鼠系列画面相似，不作为本轮配额；优先保留站立、树杈和跑轮场景',
    163230240: '手心仓鼠系列画面相似，不作为本轮配额；优先保留站立、树杈和跑轮场景',
    156241882: '只有生活围箱设施、没有清晰动物，不作为本轮配额',
}
for pid, reason in removals.items():
    captions.pop(str(pid), None)
    review['exclusions'].append({'pageid': pid, 'reason': reason})
cp.write_text(json.dumps(captions, ensure_ascii=False, indent=2) + '\n')
rp.write_text(json.dumps(review, ensure_ascii=False, indent=2) + '\n')
print({'afterSelection': len(captions)})
