import json,os,glob,re,html,hashlib
from PIL import Image,ImageOps,ImageDraw
base='content/batch-004/'
new={x['pageid']:x for f in ['downloads.json','extra-local.json'] for x in json.load(open(base+'photo-sources/'+f)) if 'group' in x}
old={x['sourceEvidence']['pageid']:x for x in json.load(open(base+'baseline-260.json'))['items'] if x.get('contentType')=='photo'}
for f in glob.glob('content/batch-002/sources/*metadata.json'):
 for p in json.load(open(f)):
  if not isinstance(p,dict) or p.get('pageid') in new or p.get('pageid') in old or not p.get('imageinfo'):continue
  id=p['pageid'];path=next((q for q in [base+f'photo-media/{id}.source',f'content/batch-002/media/{id}.source'] if os.path.exists(q)),None)
  if not path:continue
  ii=p['imageinfo'][0];m=ii.get('extmetadata',{})
  def clean(k):return html.unescape(re.sub('<[^>]+>','',str(m.get(k,{}).get('value',''))))
  if clean('LicenseShortName')!='CC0':continue
  new[id]={'pageid':id,'group':os.path.basename(f).replace('-metadata.json',''),'title':p['title'],'description':clean('ImageDescription'),'author':clean('Artist'),'license':clean('LicenseShortName'),'licenseUrl':clean('LicenseUrl'),'url':ii.get('thumburl') or ii['url'],'originalUrl':ii['url'],'sourceUrl':ii['descriptionurl'],'metadataFile':f,'localFile':path,'sha256':hashlib.sha256(open(path,'rb').read()).hexdigest()}
rows=[
('cat',[104456864,148653075],'蓝眼睛，白手套','一张把蓝眼睛拍得很近，一张连前爪也一起入镜。两张布偶猫的日常肖像，表情各有各的认真。','不同来源的布偶猫肖像；面部近景与全身趴卧，均为新原片。'),
('cat',[26074500,26074504],'在绿叶旁打个滚','橘色长毛猫躺在绿叶边，一会儿蜷着，一会儿把爪子伸向空中。这组小动作，看着就很放松。','同作者同文件系列；蜷卧与翻身两个不同动作，非同一照片裁切。'),
('cat',[183656267,184464086],'床上的两张认真脸','花床单上趴着一只，深色靠垫前坐着一只。明明都是休息时间，望向镜头的样子却很认真。','不同来源的室内猫肖像；不采信第一张来源中不可核实的拟人性别叙事。'),
('cat',[123312276,103631675],'把午觉睡成一团','一只把尾巴绕在身边，一只把爪子贴在脸边。两张窝成小圆团的睡姿，隔着照片也觉得安静。','两张新原片，布偶与短毛猫各自蜷卧，统一午睡主题，不称同一个体。'),
('cat',[72027807,148387430],'客厅里的长毛小伙伴','一张是在地毯上坐好的猫咪，一张是纸箱边凑过来的两张脸。把不同的室内小表情放在一起，怎么看都不无聊。','两张新原片，坐姿与双猫纸箱边近景，统一室内长毛猫主题。'),
('cat',[169640874,128463261],'把身子舒展开','石台上的猫侧躺着，路上的猫低头伸展。两张街边偶遇，一个松松地睡，一个认真地伸懒腰。','来源明确为街猫；不能写我家宠物，也不认定同一地点或同一只。'),
('cat',[50392730,174043170],'床边的安静时间','银色被面上趴一只，深色床单上窝一只。没有什么大事发生，光看两张安静的小脸就很舒服。','两张新原片，不同来源的卧室休息场景。'),
('cat',[165164872,158445391],'离镜头近一点','橘猫把鼻尖凑得很近，浅色猫也正望向镜头。胡须、耳尖和眼神，都被这两张近照留了下来。','两张新原片，不同个体的面部近景，色彩与构图差异清楚。'),
('dog',[13408720,13408834],'坐好了，再加一位同伴','先看黑棕色小狗端端正正的坐姿，再看两只一起面对镜头。多了个同伴，画面一下就热闹起来。','同作者 Rick 的 Akina/Tucker 文件组；第一张单犬，第二张双犬；不作亲缘推断。'),
('dog',[131641155,131640573],'林间小路上的两种表情','柴犬站在树影和小路前，一张安静望着，一张张大了嘴。两张林间镜头，把散步时的小表情留住。','同 Picography 森林散步文件系列，一新一旧，两个不同动作。'),
('dog',[176378450,176378453],'车门边歇一歇','近一点看，耳朵和白色胸毛都很蓬松；镜头拉远，才发现它正趴在车门边。两张不同角度的休息照。','同作者同边牧汽车系列，两张新原片，面部近景和车内全景；不宣称车辆行驶中。'),
('dog',[179042404,195882865],'两只柴柴，凑在一起','一张是在床上并排看镜头，一张是在草地上靠在一起。两组柴犬合影，都有一点双倍的可爱。','不同来源的两组双犬合影，不称同一对或亲子关系。'),
('dog',[116675282,116675285],'正脸和侧脸都拍一张','正面看，耳朵一高一低；转到侧面，鼻尖的轮廓又很清楚。这组拳师犬肖像，两个角度各有表情。','同作者伊朗拳师犬系列，两张新原片，正脸与侧脸。'),
('dog',[81984200,81984199],'巧克力色的小困包','白色垫子上，两张近景都把小狗拍得软软的。一个角度看见鼻尖，另一个角度更像刚要睡着。','同作者巧克力拉布拉多幼犬系列，两张新原片，不将照片次序写成真实时间线。'),
('dog',[158982766,12782675],'有飞盘，也有小障碍','跨过栏杆的身影，飞盘旁竖起的耳朵。两张边牧玩耍照，活力都快装不下画面了。','两张不同来源的新原片；图一边牧跳过栏杆，图二两只边牧在主人身旁，地面可见彩色飞盘，不称同一活动。'),
('dog',[102694357,158343797],'卷毛的休息时间','黑色卷毛狗趴在浅色地面上，白色卷毛狗把前爪伸到身前。两张休息照，蓬松的轮廓很抢眼。','两张新原片，不同来源的贵宾犬休息主题，不归为同一家庭。'),
('rabbit',[142199768,27504159],'软乎乎的白色近景','一张是两只白兔凑近，一张是低头时的脸部近景。粉色耳朵和细细胡须，越看越软乎。','两张新原片，白兔主题；不推断红眼基因或疾病。'),
('rabbit',[199018348,199018349],'草莓旁边，抬爪之间','草莓旁边的鼻尖，抬爪时的小脸，两张近景都把兔子的胡须拍得很清楚。小动作也值得慢慢看。','同作者 BlueBunnyRabbit 的兔子系列，一新一旧；不写摄入量、喂养建议或固定时间顺序。'),
('rabbit',[73092788,52040577],'长耳朵停一停','石头边和地砖上，长耳朵都竖得直直的。两张户外停留的画面，各有一点安静。','两张新原片；一张洞穴附近、另一张铺装地面，不称同地点或同一只。'),
('rabbit',[80427913,80427912],'草地上的紫色小点缀','远一点能看到圆圆的尾巴，近一点能看到耳朵和胡须。草地上的两张兔子照片，都有那抹醒目的紫色胸背带。','同作者 Lottie 的草地兔子系列，一张新背部全景、一张旧侧面特写；不是同一原图的裁切。'),
('small-mammal',[163230240,163230242],'手心里的一团灰','两个镜头里的灰色仓鼠，都把自己缩成圆圆的一团。小爪子轻轻搭着，胡须却伸得很认真。','同作者冬白仓鼠系列，一新一旧，图1较深毛色、图2浅灰；不称同一个体。'),
('small-mammal',[163230241,163230734],'小圆脸，浅色花纹','两张浅色仓鼠的近照，一张额头上有深色细纹，一张脸边的灰色更明显。圆圆的小脸都看向镜头。','同作者冬白仓鼠不同毛色，两张新原片；不附育种、遗传知识。'),
('small-mammal',[198260590,163230733],'圆滚滚的两张近照','灰色仓鼠侧着身子，白色仓鼠把脸朝向前方。两个近景里，小耳朵都像轻轻折起的圆边。','均为冬白仓鼠，一新一旧，来自不同作者，不称同一个体或前后对比。'),
('small-mammal',[93435557,93435543],'长毛豚鼠，换个角度看','侧面能看到小脸，换到背后，金棕色长毛就铺成一片。两张角度不同的近照，像给毛茸茸拍了一组肖像。','同作者 9868 豚鼠系列，一旧一新，侧面含脸与俯视背部角度，不采用另两张高度相似背部图。'),
('small-mammal',[154500730,154500731],'豚鼠们的露天小聚','绿叶边聚着几只，石头旁也冒出几个小脑袋。这组豚鼠的露天镜头，每翻一张都会多看见一位。','同作者同场地两张新原片；均为豚鼠，不是鸽子；只描述场景，不提供喂养或卫生建议。'),
]
items=[]
for idx,(animal,ids,title,text,note) in enumerate(rows,1):
 refs=[]
 for id in ids:
  if id in new:
   r=new[id].copy();r['isNew']=True
  else:
   p=old[id];r={'pageid':id,'isNew':False,'existingPhotoId':p['id'],'localFile':p['sourceEvidence']['downloadedFile'],'metadataFile':p['sourceEvidence']['metadataFile'],'sourceUrl':p['source']['url'],'title':p['source']['title'],'author':p['source'].get('author'),'license':p['images'][0]['license']['name']}
  if id==52643906:r['requiredTransform']={'rotateClockwiseDegrees':90,'reason':'原图地面在右边，顺时针旋转后地面位于下方。','reviewPreview':'content/batch-004/photo-review/52643906-orientation-review.jpg'}
  refs.append(r)
 items.append({'reviewId':f'mammal-{idx:02d}','contentType':'photo','title':title,'text':text,'animalTypes':[animal],'speciesGroup':('guinea-pig' if idx>=24 else 'hamster') if animal=='small-mammal' else animal,'topics':['治愈瞬间'],'circleId':{'cat':'circle-cats','dog':'circle-walks','rabbit':'circle-small-pets','small-mammal':'circle-small-pets'}[animal],'imagePageIds':ids,'newPageIds':[i for i in ids if i in new],'existingPhotoIds':[old[i]['id'] for i in ids if i not in new],'images':refs,'review':{'status':'approved-for-integration','reviewer':'Codex mammal visual review','reviewedAt':'2026-09-30','note':note,'evidenceFile':f'content/batch-004/photo-review/mammal-pairs-{(idx-1)//5+1}.jpg'},'editorialStatus':'公开授权照片主题整理；不冒充用户原创、本人拍摄、同一家或同一次经历。'})
rejected=[
(94948283,'兔子内脏解剖实拍，不适合日常宠物图片内容。'),(94822353,'Chinchilla 是地名，实际为西瓜雕塑，误命中。'),(132379513,'街景建筑为主体，不是宠物照片。'),(128089554,'来源明确 Midjourney AI 插画，不是真实宠物照片。'),(186906111,'画面和标注仓鼠不一致，实际野外大型啮齿动物，物种不确定。'),(46671157,'与已发布 46704078 为同原作的编辑/原始版本，构图像素重复，不计新素材。'),(46704077,'与已发布 46671383 为同原作的编辑/原始版本，构图像素重复，不计新素材。'),(163237823,'新生无毛幼崽，非本批普通日常主题且易造成不适。'),(190389136,'商贩笼具全景，宠物个体太小，展示质量不足。'),(161842690,'远景动物园展箱，动物个体过小。'),(198535520,'主体明显失焦。'),(199440560,'偏暗且有日期水印，现有更清晰仓鼠素材。'),(93435541,'与选用 93435543/旧93435557 角度过近，避免同系列凑数。'),(93435547,'与选用 93435543 高度接近，避免同系列凑数。')]
result={'reviewVersion':1,'reviewedAt':'2026-09-30','scope':'只负责猫、狗、兔、仓鼠、豚鼠；未改 miniprogram 或 approved。','counts':{'groups':len(items),'cats':8,'dogs':8,'rabbits':4,'hamsters':3,'guineaPigs':2,'newOriginalPhotos':sum(len(x['newPageIds']) for x in items),'existingPhotos':sum(len(x['existingPhotoIds']) for x in items)},'groups':items,'rejections':[{'pageid':i,'reason':s} for i,s in rejected]}
json.dump(result,open(base+'photo-review/mammal-groups.json','w'),ensure_ascii=False,indent=2)
for start in range(0,len(items),5):
 out=Image.new('RGB',(1000,5*270),(247,247,247));d=ImageDraw.Draw(out)
 for j,p in enumerate(items[start:start+5]):
  for k,r in enumerate(p['images']):
   im=ImageOps.exif_transpose(Image.open(r['localFile']))
   if r.get('requiredTransform'):im=im.transpose(Image.Transpose.ROTATE_270)
   im.thumbnail((475,238));xx=k*500+(500-im.width)//2;yy=j*270;out.paste(im.convert('RGB'),(xx,yy))
   d.text((k*500+10,yy+242),f"{p['reviewId']}  {r['pageid']}  {'NEW' if r['isNew'] else 'EXISTING'}",fill='black')
 out.save(base+f'photo-review/mammal-pairs-{start//5+1}.jpg',quality=92)
print(result['counts'])
