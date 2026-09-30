import json
from importlib.machinery import SourceFileLoader
helper = SourceFileLoader('record', 'output/content-review/open-neighbors/record-review.py').load_module()
index = json.load(open('output/content-review/open-neighbors/latest-index.json'))
selected = {
    105720241: ('灰白鹦鹉的侧面照', '一只灰白色鹦鹉侧身面对镜头，头部羽毛较浅，细长的冠羽沿着头顶向后延伸。', 'birds', 'bird'),
    105723260: ('食盆旁的浅色冠羽', '一只灰白色鹦鹉站在食盆边缘，头顶竖起浅色冠羽，翅膀上分布着浅色斑纹。', 'birds', 'bird'),
    70114486: ('藏在蓝色羽毛间的脸', '一只蓝绿色鹦鹉把头转向背部，浅色脸颊和深蓝色羽毛交错在一起，背景是一片深色。', 'birds', 'bird'),
    195567546: ('交错树枝上的蓝色小鸟', '几只蓝白色小鸟分别停在交错的木枝上，深色头部和浅色眼圈在画面中很醒目。', 'birds', 'bird'),
    105758621: ('一蓝一绿的枝头合影', '一只浅蓝色和一只黄绿色鹦鹉并排停在木枝上，侧着头望向彼此附近的方向。', 'birds', 'bird'),
    155186024: ('细枝上的蓝色羽毛', '一只蓝色小鸟停在细枝顶端，浅色头部转向镜头，长尾羽沿着枝条向下伸展。', 'birds', 'bird'),
}
excluded = {
    176796060: '画面较暗，围网和色偏影响主体辨识',
    177703820: '笼网遮挡且动物主体较暗，未选入首批',
    61695008: '与 61695010 为同一悬挂木台鸟群场景，保留较完整的一张',
    154262588: '笼网与阴影遮挡，动物主体较小',
    144290776: '来源为野外鸟类场景，不属于本轮宠物照片',
    154262587: '与 154262588 同一笼网场景，且动物主体较小',
    144290772: '野外树梢远景，鸟类主体很小',
    195567555: '鸟群与设施较拥挤，已有更清晰鸟类群像',
    178946804: '笼具占画面较多，鸟类主体小且被遮挡',
    144290782: '来源为野外鸟类场景，不属于本轮宠物照片',
    162653310: '电脑系统截图，与宠物图库无关',
    144290771: '野外树梢远景，鸟类主体很小',
    45020855: '地图，不是宠物生活照片',
}
assert set(selected) | set(excluded) == {r['pageid'] for r in index['records']}
helper.record(selected, excluded, [r['pageid'] for r in index['records']])
