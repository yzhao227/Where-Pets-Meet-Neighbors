import json
from importlib.machinery import SourceFileLoader
helper = SourceFileLoader('record', 'output/content-review/open-neighbors/record-review.py').load_module()
index = json.load(open('output/content-review/open-neighbors/latest-index.json'))
selected = {
    24887320: ('鱼缸里的小小洞口', '两条橙色金鱼停在鱼缸装饰的洞口附近，底部铺着彩色石子，后方可见绿色水草。', 'fish', 'fish'),
    146730506: ('水面绿叶下的橙色鱼群', '多条橙色小鱼聚在水面下，圆形叶片沿水边铺开，水面还映着周围的枝叶。', 'fish', 'fish'),
}
excluded = {
    148817527: '主体为猫而非鱼，与本轮新增非猫狗宠物范围不符',
    135231680: '鱼尾被边缘裁切，未选入首批',
    148659842: '海岸风景，与宠物图库无关',
    139199240: '与 139199242 为相同蓝色鱼缸场景，保留一张',
    39413769: '冰面反光与杂草遮挡，动物主体过小',
    76102761: '来源明确提到鳃部异常，不选入本轮一般生活图库',
    94262356: '售卖设施远景，动物主体过小',
    142855175: '水体偏暗且主体过小，未选入首批',
    94262265: '售卖设施远景，动物主体过小',
    94262291: '售卖设施远景，动物主体过小',
    113559470: '水面反光明显，主体辨识度较低',
    28587680: '来源明确提到鱼身红斑，不选入本轮一般生活图库',
    174317197: '雕刻作品，不是生活实拍',
    31546335: '照片较暗，且已有更清晰金鱼侧面照',
    173285607: '雕刻作品，不是生活实拍',
    139199243: '与 139199242 为同一蓝色鱼缸场景，保留一张',
    71722069: '绘画作品，不是生活实拍',
}
assert set(selected) | set(excluded) == {r['pageid'] for r in index['records']}
helper.record(selected, excluded, [r['pageid'] for r in index['records']])
