import json
from importlib.machinery import SourceFileLoader
helper = SourceFileLoader('record', 'output/content-review/open-neighbors/record-review.py').load_module()
index = json.load(open('output/content-review/open-neighbors/latest-index.json'))
selected = {
    121439018: ('草地上的黑色长毛豚鼠', '一只黑色长毛豚鼠面向镜头趴在草地上，下巴附近留着一小片白色毛发。', 'guinea-pigs', 'small-mammal'),
    167245525: ('豚鼠低头靠近食盆', '一只黑白棕三色豚鼠待在铺有垫料的空间内，低头靠近装着绿叶的食盆。', 'guinea-pigs', 'small-mammal'),
    93435557: ('长毛豚鼠的侧影', '一只黑棕相间的长毛豚鼠停在透明箱上，一双手从旁边扶着它，长长的毛发沿背部披散。', 'guinea-pigs', 'small-mammal'),
    121439037: ('两只豚鼠共享一盆绿草', '两只黑白长毛豚鼠分站在花盆两边，向盆中的绿草靠近，背景是室内木地板。', 'guinea-pigs', 'small-mammal'),
    129913602: ('小花旁的黑白仓鼠', '一只黑白相间的仓鼠坐在石面旁，前爪收在身体前方，脚边开着小小的黄色花朵。', 'hamsters', 'small-mammal'),
    15690260: ('仓鼠与一片黄瓜', '一只浅棕色仓鼠坐在灰色布面上，嘴边靠着一片带有绿色外皮的黄瓜。', 'hamsters', 'small-mammal'),
    167171: ('黑白仓鼠的侧面特写', '一只黑白相间的仓鼠在浅色平面上低着头，圆耳朵和鼻尖的细小胡须清晰可见。', 'hamsters', 'small-mammal'),
    156241882: ('仓鼠生活空间的一角', '室内的长方形透明围箱铺有浅色垫料，里面摆放着跑轮、木制小屋和攀爬设施。', 'hamsters', 'small-mammal'),
    163230242: ('手心里的灰色仓鼠', '一只灰色仓鼠伏在摊开的手心里，圆耳朵贴着头部两侧，鼻尖朝向镜头下方。', 'hamsters', 'small-mammal'),
    163230733: ('手心里的一团白毛', '一只白色仓鼠停在手心中，黑色眼睛和浅粉色鼻尖在白毛之间格外显眼。', 'hamsters', 'small-mammal'),
    163230241: ('灰白仓鼠靠近镜头', '一只灰白相间的仓鼠伏在手心里，额头带有灰色纹路，两只小前爪靠在身前。', 'hamsters', 'small-mammal'),
    163230240: ('棕色仓鼠的正面照', '一只棕色仓鼠安静地待在手掌上，背部颜色较深，脸颊两侧的毛发较浅。', 'hamsters', 'small-mammal'),
    108429446: ('草地上的金棕色仓鼠', '镜头从上方记录了一只金棕色仓鼠，它站在短草和枯枝之间，身体朝向画面右侧。', 'hamsters', 'small-mammal'),
    143838847: ('灰色沙发上的小身影', '一只棕白相间的仓鼠停在灰色沙发坐垫上，前爪靠在身前，身后的靠垫形成深色背景。', 'hamsters', 'small-mammal'),
}
excluded = {
    122547154: '来源为野生豚鼠，不属于本轮宠物生活照片',
    93435543: '与 93435557 同一长毛豚鼠和手持场景，保留动物完整侧面照',
    161842690: '远景隔窗拍摄，反光和围箱占主体，动物过小',
    122547075: '来源为野生豚鼠，不属于本轮宠物生活照片',
    119295001: '骨骼和解剖插图，不是宠物生活照片',
    93435547: '与 93435557 同一长毛豚鼠和手持场景，保留动物完整侧面照',
    86160272: '组织切片，不是宠物生活照片',
    74210517: '远景围场，动物主体过小',
    119295302: '线描插画，不是宠物生活照片',
    93435541: '与 93435557 同一长毛豚鼠和手持场景，保留动物完整侧面照',
    33395423: '博物馆动物标本，不是生活实拍',
    118667497: '来源为野生豚鼠，不属于本轮宠物生活照片',
    163237823: '无毛幼体巢穴特写，不选入本轮一般生活图库',
    163230734: '与已选仓鼠手心系列构图接近，控制同类场景占比',
    198260590: '主体轻微模糊且室内光线较暗，未选入首批',
    108735382: '抓持和张嘴特写不适合本轮生活展示',
    199440560: '画面较暗且主体模糊，带有时间水印',
}
assert set(selected) | set(excluded) == {r['pageid'] for r in index['records']}
helper.record(selected, excluded, [r['pageid'] for r in index['records']])
cp = helper.SRC / 'neighbor-captions.json'
captions = json.loads(cp.read_text())
for c in captions.values():
    c['topics'] = ['没养宠也能来', '宠物治愈时刻']
cp.write_text(json.dumps(captions, ensure_ascii=False, indent=2) + '\n')
