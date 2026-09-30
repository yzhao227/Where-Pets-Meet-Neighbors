from pathlib import Path
import json,sys
from PIL import Image, ImageDraw, ImageFont, ImageOps
root=Path.cwd(); out=root/'output/content-review/open-neighbors'; out.mkdir(exist_ok=True)
src=root/'content/batch-002/sources'
review=src/'neighbor-review.json'; done=set(json.loads(review.read_text()).get('reviewedPageids',[])) if review.exists() else set()
groups=sys.argv[1:]
rows=[]
for p in sorted(src.glob('*-candidates.json')):
 group=p.name.replace('-candidates.json','')
 if group in ['cats','dogs'] or (groups and group not in groups): continue
 for r in json.loads(p.read_text()):
  if str(r['pageid']) not in {str(x) for x in done}: rows.append(r)
font=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',17); small=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',12)
CW,CH=270,238; sheets=[]
for group in dict.fromkeys(r['group'] for r in rows):
 group_rows=[r for r in rows if r['group']==group]
 for offset in range(0,len(group_rows),20):
  batch=group_rows[offset:offset+20]; im=Image.new('RGB',(5*CW,4*CH+35),'#eeeae5'); d=ImageDraw.Draw(im); d.text((10,8),group+' '+str(offset//20+1),font=font,fill='black')
  for j,r in enumerate(batch):
   x=(j%5)*CW; y=(j//5)*CH+35; d.rectangle((x+3,y+3,x+CW-3,y+CH-3),fill='white')
   try:
    with Image.open(root/r['localFile']) as s: thumb=ImageOps.contain(ImageOps.exif_transpose(s).convert('RGB'),(CW-14,CH-52))
    im.paste(thumb,(x+(CW-thumb.width)//2,y+6+(CH-52-thumb.height)//2))
   except Exception as e: d.text((x+8,y+40),'UNREADABLE',font=font,fill='red')
   d.text((x+8,y+CH-42),str(r['pageid']),font=font,fill='black'); d.text((x+8,y+CH-21),r['title'][5:][:38],font=small,fill='#333333')
  name=group+'-'+str(offset//20+1)+'-'+str(batch[0]['pageid'])+'.jpg'; im.save(out/name,quality=92); sheets.append({'path':str((out/name).relative_to(root)),'pageids':[r['pageid'] for r in batch]})
(out/'latest-index.json').write_text(json.dumps({'sheets':sheets,'records':rows},ensure_ascii=False,indent=2))
print(json.dumps(sheets,ensure_ascii=False))
