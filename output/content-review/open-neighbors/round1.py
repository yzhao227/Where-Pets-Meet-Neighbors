import json
from importlib.machinery import SourceFileLoader
helper = SourceFileLoader('record', 'output/content-review/open-neighbors/record-review.py').load_module()
index = json.load(open('output/content-review/open-neighbors/latest-index.json'))
selected = {
    138202191: ('篮子里的灰兔', '一只灰色兔子待在篮子里，竖起双耳，镜头旁的一只手轻触它的背部。', 'rabbits', 'rabbit'),
    171805594: ('绿叶间的长耳朵', '一只棕灰色兔子伏在绿叶间，双耳竖起，身后可以看到围栏。', 'rabbits', 'rabbit'),
    199018349: ('兔子整理脸颊的瞬间', '一只浅色兔子坐在室内垫子上，把前爪抬到脸前。', 'rabbits', 'rabbit'),
    147718507: ('围栏前的小兔', '一只浅棕色兔子在围栏后抬起身体，耳朵朝上，前爪靠在网格附近。', 'rabbits', 'rabbit'),
    143883376: ('黑兔抬起前爪', '一只黑色垂耳兔直起身体站在室内地毯上，两只前爪收在胸前。', 'rabbits', 'rabbit'),
    147359521: ('黑白兔与地上的绿叶', '一只黑白相间的兔子坐在地上的绿叶旁，黑色耳朵和眼周毛色格外显眼。', 'rabbits', 'rabbit'),
    141266248: ('灰兔安静地趴着', '一只灰色兔子趴在围挡旁，前爪向前伸展，身边散落着绿叶。', 'rabbits', 'rabbit'),
    34900452: ('白兔的脸部特写', '近距离镜头记录了白色兔子的脸，鼻尖、眼睛和细细的胡须清晰可见。', 'rabbits', 'rabbit'),
    80427912: ('草地上的紫色胸背带', '一只棕色兔子低头靠近草地，身上穿着紫色胸背带，画面里还能看到连接的牵引绳。', 'rabbits', 'rabbit'),
    69295425: ('兔子低头整理毛发', '一只浅棕色兔子坐在草地上，低头靠向身体侧面，白色尾巴露在身后。', 'rabbits', 'rabbit'),
    147342436: ('白兔与一盘绿叶', '一只白色兔子俯身靠近红色盘子，盘中盛着绿色叶片，背景是室内桌椅。', 'rabbits', 'rabbit'),
    150949970: ('毯子上的棕兔', '一只棕色兔子坐在带有红白条纹的毯子上，耳朵直立，身体朝向镜头。', 'rabbits', 'rabbit'),
    198496329: ('花色垫子上的豚鼠', '几只毛色不同的豚鼠挤在花色布垫上，前方的一只棕白色豚鼠朝镜头探出头。', 'guinea-pigs', 'small-mammal'),
    186642120: ('食盆旁的白色豚鼠', '一只白色豚鼠待在铺有垫料的空间里，身前的食盆中可以看到绿色叶片。', 'guinea-pigs', 'small-mammal'),
    198523592: ('豚鼠的胡须特写', '一只深棕色豚鼠靠近镜头，鼻尖和胡须清晰可见，背部夹杂着浅色毛发。', 'guinea-pigs', 'small-mammal'),
    122210138: ('草地上的棕色豚鼠', '一只棕色豚鼠停在草地上，身体侧向镜头，圆圆的耳朵贴在头部两侧。', 'guinea-pigs', 'small-mammal'),
    156038624: ('布垫上的金棕色豚鼠', '一只金棕色豚鼠坐在浅色布垫上，身体侧对镜头，鼻尖微微向前探。', 'guinea-pigs', 'small-mammal'),
    63987793: ('黑白豚鼠与同伴', '前景的一只黑白豚鼠低着头，后方还有几只不同毛色的豚鼠散布在草地上。', 'guinea-pigs', 'small-mammal'),
}
special = {
    181371592: '主体偏小且雪地画面较杂，未选入首批',
    199018348: '与已选室内浅色兔场景接近，保留整理脸颊的一张',
    171259102: '兔子占画面很小且以禽鸟场景为主',
    27504159: '画面偏暗且眼部闪光明显，未选入首批',
    73092788: '来源描述为洞穴周边兔子，宠物属性不明确',
    52039778: '笼网遮挡明显，画面杂乱',
    80427913: '与 80427912 为同一胸背带兔子近似场景，保留更清晰近景',
    147369619: '周转筐与兔群画面较杂，未选入首批',
    58018865: '灌丛中的野兔场景，不属于本轮宠物实拍',
    66924890: '野外幼兔巢穴场景，不属于本轮宠物实拍',
    195138333: '野外草地兔子，宠物属性不明确',
    151462341: '来源为野生棉尾兔，不属于本轮宠物实拍',
    195138334: '野外草地兔子，且与 195138333 场景相近',
    153868623: '以现场人物与笼具为主，动物主体较小',
    154500730: '地面散落食物较杂，豚鼠主体较小',
    154500731: '与 154500730 为同一场景且主体较小',
}
excluded = {}
for r in index['records']:
    pid = r['pageid']
    if pid in selected:
        continue
    reason = special.get(pid)
    if not reason:
        title = r['title'].lower()
        if 'cavia porcellus (ypm' in title:
            reason = '显微组织切片，不是宠物生活照片'
        elif any(w in title for w in ['cranium', 'neurocranium']):
            reason = '骨骼标本，不是宠物生活照片'
        elif 'anus' in title:
            reason = '局部解剖展示，不适合本轮生活图库'
        elif 'performs' in title or 'girl' in title:
            reason = '人物照片，与宠物图库无关'
        else:
            reason = '插画、雕塑或商品造型，不是真实宠物照片'
    excluded[pid] = reason
helper.record(selected, excluded, [r['pageid'] for r in index['records']])
