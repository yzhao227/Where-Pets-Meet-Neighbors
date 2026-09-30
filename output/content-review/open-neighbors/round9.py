import json
from importlib.machinery import SourceFileLoader
helper = SourceFileLoader('record', 'output/content-review/open-neighbors/record-review.py').load_module()
index = json.load(open('output/content-review/open-neighbors/latest-index.json'))
selected = {
    149176678: ('斑纹守宫沿墙停留', '一只带有深色斑点的守宫停在墙边，头部朝向下方，粗长尾巴沿身体后方伸展。', 'lizards', 'reptile'),
    149187296: ('守宫背上的浅色条纹', '从背后看去，一只棕色守宫伏在浅色布面上，背部的浅色纵向条纹一直延伸到尾部。', 'lizards', 'reptile'),
    156307723: ('蓝色光线下的守宫侧脸', '近距离镜头记录了守宫的侧脸，细密斑点覆盖头部，蓝色光线照亮了颈部和下颌。', 'lizards', 'reptile'),
    15416446: ('守宫靠在容器边缘', '一只棕色守宫把头靠在浅色容器边缘，一只前爪伸向上方，眼睛和细小鳞片清楚可见。', 'lizards', 'reptile'),
    186436500: ('枯叶间的斑纹守宫', '一只浅色斑纹守宫伏在枯叶与垫料间，头部朝向镜头，圆眼睛和额头上的花纹十分清晰。', 'lizards', 'reptile'),
    113304301: ('岩石旁的守宫', '一只带有深色斑纹的守宫停在浅色地面上，身体靠近岩石，尾巴横向伸展。', 'lizards', 'reptile'),
    163103659: ('高处木台上的蜥蜴', '一只浅色蜥蜴停在木纹造景的高处，四肢撑在表面，长尾巴沿着木台向下垂。', 'lizards', 'reptile'),
    37443137: ('绿叶间露出的守宫', '茂密绿叶之间露出一只棕色守宫的头部和背部，叶片的弧线围住了它的小小身影。', 'lizards', 'reptile'),
    106922444: ('守宫脸上的深色花纹', '近距离镜头对准一只守宫的脸，深色斑纹布满额头，眼睛周围可以看到细小鳞片。', 'lizards', 'reptile'),
    71317053: ('蜥蜴颈侧的细密鳞片', '一只灰褐色蜥蜴侧身面向镜头，眼睛、耳孔与颈侧尖细的鳞片排列清晰可见。', 'lizards', 'reptile'),
    191102767: ('玉米蛇的侧脸特写', '一条玉米蛇的头部靠近镜头，浅色下颌和深色斑纹形成对比，背景是模糊的绿色叶片。', 'snakes', 'reptile'),
}
excluded = {
    195201788: '来源明确为道路上疑似逃逸宠物，画面较杂且不适合本轮一般观察图',
    149991700: '鼻尖摆放食物的摆拍场景，本轮优先自然停留姿态',
    108862724: '为 15416446 的裁剪版本，保留原图',
    155068368: '强烈橙色灯光造成偏色，已有更清晰守宫画面',
    195349410: '已有更清晰、背景更干净的蜥蜴头部特写，控制同类构图比例',
    195349423: '背景过暗且主体只占很小区域',
    73435240: '整体偏暗且主体较小，已有更清晰全身蜥蜴场景',
    153862977: '石块遮挡主体，玻璃反光影响清晰度',
}
assert set(selected) | set(excluded) == {r['pageid'] for r in index['records']}
helper.record(selected, excluded, [r['pageid'] for r in index['records']])
