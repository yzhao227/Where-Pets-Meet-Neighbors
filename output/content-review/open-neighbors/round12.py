import json
from importlib.machinery import SourceFileLoader
helper = SourceFileLoader('record', 'output/content-review/open-neighbors/record-review.py').load_module()
index = json.load(open('output/content-review/open-neighbors/latest-index.json'))
selected = {
    56628996: ('浅色台面上的小刺猬', '一只刺猬伏在浅色台面边缘，鼻尖朝向左侧，背部的短刺与腹部的柔软毛发形成对比。', 'other-small-pets', 'small-mammal'),
    155967668: ('白色雪貂的粉色鼻尖', '一只白色雪貂靠近镜头，浅粉色鼻尖和向两侧伸展的胡须十分清晰，背景是深色布面。', 'other-small-pets', 'small-mammal'),
    62231316: ('雪貂停在一束光里', '一只深色雪貂伏在地面上，低着头，斜射的光线照亮了它的背部和身前的一小片地面。', 'other-small-pets', 'small-mammal'),
}
excluded = {}
for r in index['records']:
    if r['pageid'] in selected:
        continue
    excluded[r['pageid']] = '绘画作品，不是生活实拍' if r['pageid'] in [85579923, 147025245, 84136872] else '装甲车辆照片，关键词 Ferret 同名造成检索误入'
helper.record(selected, excluded, [r['pageid'] for r in index['records']])
