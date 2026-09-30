import json
from importlib.machinery import SourceFileLoader
helper = SourceFileLoader('record', 'output/content-review/open-neighbors/record-review.py').load_module()
index = json.load(open('output/content-review/open-neighbors/latest-index.json'))
selected = {
    181503615: ('树枝上的黄色小鸟', '一只黄绿色鹦鹉停在粗树枝上，头部微微侧向镜头，脸颊上有深色的小斑点。', 'birds', 'bird'),
    176605947: ('并排停在枝头的小鸟', '两只浅色鹦鹉并排停在树枝上，一只带有淡蓝色羽毛，另一只以浅黄和白色为主。', 'birds', 'bird'),
    181503664: ('枝头的黄绿羽毛', '几只黄绿色鹦鹉停在木头上，前方的一只面向镜头，背部和翅膀带有深色条纹。', 'birds', 'bird'),
    152771179: ('灰白羽毛与黄色冠羽', '一只灰白色鹦鹉停在斜伸的树枝上，黄色冠羽向上竖起，脸颊处有橙色斑块。', 'birds', 'bird'),
    31705969: ('鹦鹉的正面特写', '镜头正对一只黄绿色鹦鹉的头部，鼻部的蓝色、脸颊的深色斑点和细密羽毛清楚可见。', 'birds', 'bird'),
    61696100: ('木枝间的一抹绿', '一只绿色鹦鹉停在室内围网前的木枝上，黄色头部低垂，身体被两侧树枝轻轻围住。', 'birds', 'bird'),
    61695010: ('悬挂木台上的两只鸟', '两只绿身橙脸的小鸟停在悬挂的木台上，一只站得稍高，周围交错着细树枝。', 'birds', 'bird'),
    14759520: ('手掌上并排的小鸟', '几只白色和蓝灰色的小鸟停在摊开的双手上，长尾羽沿着手掌边缘向后伸展。', 'birds', 'bird'),
}
excluded = {
    155993920: '照片来源为自然观察记录，未能确认圈养或宠物属性',
    144290773: '野外树梢远景，鸟类主体很小',
    42247637: '强烈红色灯光造成偏色，且主体较小',
    113232166: '绘画作品，不是宠物生活照片',
    150608349: '野外树梢远景，宠物属性不明确且主体很小',
    182948828: '鸟类剥制标本，不是生活实拍',
    98902286: '未长齐羽毛的幼鸟局部特写，不选入本轮一般生活图库',
    181227204: '来源为马达加斯加自然观察记录，不属于本轮宠物照片',
    181219121: '来源为坦桑尼亚自然观察记录，不属于本轮宠物照片',
    31705968: '与 31705969 同一鹦鹉相近特写，保留正面照',
    181221475: '来源为纳米比亚自然观察记录，不属于本轮宠物照片',
}
assert set(selected) | set(excluded) == {r['pageid'] for r in index['records']}
helper.record(selected, excluded, [r['pageid'] for r in index['records']])
cp = helper.SRC / 'neighbor-captions.json'
captions = json.loads(cp.read_text())
for c in captions.values():
    c['topics'] = ['治愈瞬间', '陪伴日常']
    if c['group'] in ['rabbits', 'hamsters', 'guinea-pigs']:
        c['circleId'] = 'circle-small-pets'
captions['156241882']['topics'] = ['居家布置']
cp.write_text(json.dumps(captions, ensure_ascii=False, indent=2) + '\n')
