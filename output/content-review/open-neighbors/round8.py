import json
from importlib.machinery import SourceFileLoader
helper = SourceFileLoader('record', 'output/content-review/open-neighbors/record-review.py').load_module()
index = json.load(open('output/content-review/open-neighbors/latest-index.json'))
selected = {
    69452935: ('水面上的小龟', '一只龟浮在绿色水面上，头部和四肢伸出背甲，眼睛后方带有红色斑纹。画面记录的是户外水面上的动物。', 'turtles', 'reptile'),
    55029475: ('岩石上的龟侧影', '一只龟停在岩石表面，头部向上伸展，深色背甲与颈部浅色条纹清楚可见。', 'turtles', 'reptile'),
}
excluded = {
    168576129: '明确野外陆龟但物种与适养属性不确定，不选作本轮常见宠物观察图',
    121679964: '大型龟局部特写，物种不明确且缺少完整主体，不选入本轮',
    162963776: '湖面远景，龟主体太小',
    168576191: '与 168576129 为同一野外陆龟场景，主体较小',
    121679942: '龟甲局部，主体辨识不完整',
    69453309: '与 69452935 为相近水面红耳龟系列，保留四肢更清晰的一张',
    144991011: '背甲局部，主体辨识不完整',
    113355227: '绘画作品，不是生活实拍',
    151256561: '海龟水族馆画面，不属于常见饲养宠物范围',
    69453906: '与 69452935 为相近水面红耳龟系列，保留主体较清晰的一张',
    113355182: '绘画作品，不是生活实拍',
    103395655: '骨骼解剖插图，不是生活实拍',
    69454998: '与 69452935 为相近水面红耳龟系列，保留主体较清晰的一张',
    113355216: '绘画作品，不是生活实拍',
    103405663: '骨骼解剖插图，不是生活实拍',
    113355237: '绘画作品，不是生活实拍',
}
assert set(selected) | set(excluded) == {r['pageid'] for r in index['records']}
helper.record(selected, excluded, [r['pageid'] for r in index['records']])
