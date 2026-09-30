import json
from importlib.machinery import SourceFileLoader
helper = SourceFileLoader('record', 'output/content-review/open-neighbors/record-review.py').load_module()
index = json.load(open('output/content-review/open-neighbors/latest-index.json'))
selected = {
    200255842: ('浅色砂粒上的蓝色小虾', '一只蓝色小虾停在浅色砂粒上，细长触须向前伸展，半透明身体透出深浅不同的蓝色。', 'shrimp', 'invertebrate'),
    193124568: ('白石上的半透明小虾', '一只浅棕色小虾停在白色圆石上，触须和步足清晰可见，旁边铺着浅色砂粒。', 'shrimp', 'invertebrate'),
    38484097: ('叶片边缘的红色小虾', '一只红色小虾侧身停在水中叶片边缘，细长触须伸向画面上方，腹部带着浅黄色色块。', 'shrimp', 'invertebrate'),
    18707726: ('石子上的两种虾纹', '两只小虾停在彩色石子上，一只通体偏红，另一只带着红白相间的花纹，身后是细长水草。', 'shrimp', 'invertebrate'),
}
excluded = {
    144000514: '主体是水生植物，没有清晰宠物主体',
    144000517: '主体是水生植物，且与 144000514 为近似场景',
    18707713: '尾部裁切且圆形暗角明显，已有更完整小虾照片',
    18707789: '小虾较小且对焦偏软，未选入首批',
    18707806: '与已选 18707726 为相近虾缸系列，控制重复场景',
    18707654: '主体局部裁切且暗角明显，未选入首批',
    144000513: '主体是水生植物，且与 144000514 为近似场景',
    18707732: '与已选红虾画面构图相近，且暗角明显',
    144000518: '主体是水生植物，且与 144000514 为近似场景',
    113170311: '馆藏卵标本，不是生活实拍',
    81685020: '绘画作品，不是生活实拍',
    194406656: '人物面部清晰可见，不选入本轮图库',
    57043780: '已有 4 张较清晰蛇类照片，控制蛇类比例',
    156284514: '捕食画面，不选入本轮一般生活图库',
    156284462: '与 156284514 同一捕食画面，不选入本轮一般生活图库',
}
assert set(selected) | set(excluded) == {r['pageid'] for r in index['records']}
helper.record(selected, excluded, [r['pageid'] for r in index['records']])
