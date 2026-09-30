import json
from importlib.machinery import SourceFileLoader
helper = SourceFileLoader('record', 'output/content-review/open-neighbors/record-review.py').load_module()
index = json.load(open('output/content-review/open-neighbors/latest-index.json'))
selected = {
    18280751: ('浅色水中展开的花尾巴', '一条浅黄色孔雀鱼侧身停在水中，宽大的尾鳍上布满黑色纹路，身体后方透着柔和光线。', 'aquarium', 'fish'),
    17797779: ('暖色鱼缸中的蓝色斗鱼', '一条蓝色斗鱼在暖色背景前展开尾鳍，底部铺着细小石子，身后有绿色水草。', 'aquarium', 'fish'),
}
excluded = {
    181898540: '水生植物为主体，小鱼较小，不作为本轮动物图片配额',
    74629395: '拖船照片，Guppy 同名造成检索误入',
    27169891: '尾鳍接近边缘且背景杂乱，已有更清晰斗鱼照片',
    200252634: '水生植物局部，没有清晰动物主体',
    74629397: '拖船照片，Guppy 同名造成检索误入',
    24869476: '物种与拍摄场景说明有限，本轮优先明确家养水族来源照片',
    151348506: '头骨标本展示，不是生活实拍',
}
assert set(selected) | set(excluded) == {r['pageid'] for r in index['records']}
helper.record(selected, excluded, [r['pageid'] for r in index['records']])
