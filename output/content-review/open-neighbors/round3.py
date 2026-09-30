import json
from importlib.machinery import SourceFileLoader
helper = SourceFileLoader('record', 'output/content-review/open-neighbors/record-review.py').load_module()
index = json.load(open('output/content-review/open-neighbors/latest-index.json'))
selected = {
    91733769: ('棕白仓鼠直起身体', '一只棕白色仓鼠直起身体，前爪收在胸前，嘴边的胡须向两侧展开。', 'hamsters', 'small-mammal'),
    71852953: ('树杈间的仓鼠', '一只黑棕相间的仓鼠停在树杈之间，脸部朝向镜头，树皮和绿叶围在它身旁。', 'hamsters', 'small-mammal'),
    18094679: ('跑轮边的小仓鼠', '一只灰白色仓鼠停在深色跑轮边，身体下方铺着浅色垫料，细小的前爪露在毛发外。', 'hamsters', 'small-mammal'),
}
excluded = {
    166043337: '概念示意图，不是宠物生活照片',
    184258756: '主体较小且画面模糊，未选入首批',
    80965532: '人物服装照片，与宠物图库无关',
    198535520: '整体对焦偏软，动物主体较模糊',
    80965534: '人物服装照片，与宠物图库无关',
    14469241: '人物合影，与宠物图库无关',
    186906111: '来源与野外画面不足以明确为宠物，且主体模糊',
    190389136: '动物店远景，主体为售卖陈列和人物',
    20743826: '人物活动照片，与宠物图库无关',
}
assert set(selected) | set(excluded) == {r['pageid'] for r in index['records']}
helper.record(selected, excluded, [r['pageid'] for r in index['records']])
