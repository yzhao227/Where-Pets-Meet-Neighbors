import json
from importlib.machinery import SourceFileLoader
helper = SourceFileLoader('record', 'output/content-review/open-neighbors/record-review.py').load_module()
index = json.load(open('output/content-review/open-neighbors/latest-index.json'))
selected = {
    91368362: ('浅色地面上的环纹蛇', '几条带有红色、黑色和浅色环纹的蛇盘曲在一起，身体花纹沿着弯曲的线条连续展开。', 'snakes', 'reptile'),
    195520635: ('垫料上的球蟒', '一条棕黑相间的球蟒盘在浅色垫料上，身体表面有不规则浅色斑块，头部靠在盘曲的身体上方。', 'snakes', 'reptile'),
    97673453: ('白色坐垫上的橙色玉米蛇', '一条橙色玉米蛇盘在白色坐垫角落，背部的红棕色斑纹沿着身体排列，头部停在内侧。', 'snakes', 'reptile'),
}
excluded = {
    148811527: '容器边框遮挡较多且光线暗，已有更完整蛇类照片',
    134960646: '与已选玉米蛇侧脸为相似构图，控制蛇类近景数量',
    91368181: '来源明确为交配与咬合场景，不选入本轮一般生活图库',
    129144197: '户外地面较杂，已有更清晰环纹蛇画面',
    44302692: '与已选盘曲蛇类画面构图相近，控制蛇类数量',
    26329170: '画面较暗且报纸与木枝遮挡，未选入首批',
}
assert set(selected) | set(excluded) == {r['pageid'] for r in index['records']}
helper.record(selected, excluded, [r['pageid'] for r in index['records']])
