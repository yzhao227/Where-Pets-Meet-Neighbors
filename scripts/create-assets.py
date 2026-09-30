"""Create the original local illustration and icon set; no remote assets required."""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1] / 'miniprogram' / 'assets'
ROOT.mkdir(parents=True, exist_ok=True)
INK = '#304c3a'

class Canvas:
    def __init__(self, w=1000, h=620, bg='#e8eddc'):
        self.w, self.h = w, h
        self.im = Image.new('RGBA', (w * 2, h * 2), bg)
        self.d = ImageDraw.Draw(self.im)
    def box(self, v): return tuple(int(x * 2) for x in v)
    def ellipse(self, box, fill, outline=None, width=2): self.d.ellipse(self.box(box), fill, outline, width*2)
    def rect(self, box, fill, r=0): self.d.rounded_rectangle(self.box(box), r*2, fill=fill)
    def poly(self, points, fill): self.d.polygon([(int(x*2),int(y*2)) for x,y in points], fill=fill)
    def line(self, points, fill=INK, width=5): self.d.line([(int(x*2),int(y*2)) for x,y in points],fill=fill,width=width*2,joint='curve')
    def save(self, name): self.im.resize((self.w,self.h),Image.Resampling.LANCZOS).save(ROOT / name, optimize=True)

def sprig(c, x, y, scale=1, color='#718e63'):
    c.line([(x,y),(x-8*scale,y-105*scale),(x+6*scale,y-180*scale)],color,5)
    for dx,dy in [(-35,-53),(24,-80),(-34,-115),(25,-143)]:
        c.ellipse((x+dx*scale-22*scale,y+dy*scale-10*scale,x+dx*scale+22*scale,y+dy*scale+10*scale),color)

def cat(c,x,y,s=1,color='#cc8b55',asleep=False):
    def b(v): return (x+v[0]*s,y+v[1]*s,x+v[2]*s,y+v[3]*s)
    c.line([(x+64*s,y+92*s),(x+116*s,y+89*s),(x+140*s,y+55*s),(x+125*s,y+21*s)],color,25)
    c.ellipse(b((-55,0,84,135)),color)
    c.poly([(x-69*s,y-5*s),(x-66*s,y-86*s),(x-17*s,y-53*s)],color)
    c.poly([(x+22*s,y-55*s),(x+72*s,y-87*s),(x+75*s,y-6*s)],color)
    c.ellipse(b((-75,-63,75,63)),color)
    c.poly([(x-58*s,y-65*s),(x-55*s,y-23*s),(x-29*s,y-43*s)],'#e9ba92')
    c.poly([(x+56*s,y-65*s),(x+57*s,y-24*s),(x+30*s,y-42*s)],'#e9ba92')
    c.ellipse(b((-32,7,39,50)),'#f6e5ca')
    if asleep:
        c.line([(x-45*s,y+1*s),(x-30*s,y+8*s),(x-15*s,y+1*s)],INK,4)
        c.line([(x+15*s,y+1*s),(x+29*s,y+8*s),(x+44*s,y+1*s)],INK,4)
    else:
        c.ellipse(b((-36,-7,-28,4)),INK);c.ellipse(b((28,-7,36,4)),INK)
    c.poly([(x-6*s,y+12*s),(x+7*s,y+12*s),(x,y+20*s)],INK)
    c.line([(x,y+20*s),(x,y+26*s)],INK,3)
    c.line([(x-49*s,y+21*s),(x-85*s,y+13*s)],INK,2)
    c.line([(x+49*s,y+21*s),(x+85*s,y+13*s)],INK,2)
    c.ellipse(b((-45,115,-3,142)),'#eed8b7');c.ellipse(b((20,115,63,142)),'#eed8b7')

def dog(c,x,y,s=1,color='#f0d5a5'):
    def b(v): return (x+v[0]*s,y+v[1]*s,x+v[2]*s,y+v[3]*s)
    c.ellipse(b((-76,2,93,173)),color)
    c.line([(x+80*s,y+114*s),(x+130*s,y+89*s),(x+144*s,y+42*s)],color,25)
    c.ellipse(b((-98,-83,-37,45)),'#b08256');c.ellipse(b((41,-83,102,45)),'#b08256')
    c.ellipse(b((-75,-90,80,64)),color)
    c.ellipse(b((-51,-5,55,60)),'#fcf1d5')
    c.ellipse(b((-42,-33,-30,-18)),INK);c.ellipse(b((34,-33,46,-18)),INK)
    c.ellipse(b((-12,2,17,19)),INK)
    c.line([(x+2*s,y+18*s),(x+2*s,y+32*s)],INK,4)
    c.ellipse(b((-4,31,15,54)),'#d78b7d')
    c.rect(b((-48,60,52,75)),'#487458',r=6)
    c.ellipse(b((-61,139,-10,183)),color);c.ellipse(b((34,139,83,183)),color)

def landscape(c):
    c.ellipse((672,-125,1110,300),'#e2c979')
    c.ellipse((-100,364,1100,1040),'#cad6b4')
    c.ellipse((-330,450,580,900),'#b6c9a7')
    sprig(c,95,460,1.55,'#6d8b68');sprig(c,905,485,1.1,'#6d8b68')
    for x,y in [(270,95),(140,145),(485,74)]:
        c.line([(x-7,y),(x+7,y)],'#fbfaf0',4);c.line([(x,y-7),(x,y+7)],'#fbfaf0',4)

c=Canvas();landscape(c)
c.rect((245,338,820,374),'#9b7450',16)
c.rect((295,366,314,536),'#7f6349',4);c.rect((746,365,766,536),'#7f6349',4)
c.ellipse((425,155,527,261),'#e3b699');c.ellipse((435,143,530,213),'#425143')
c.rect((410,253,545,374),'#f4efe0',35)
c.line([(427,368),(404,457),(433,523)],'#647d63',28);c.line([(518,368),(550,454),(577,511)],'#647d63',28)
c.line([(421,272),(357,311),(329,340)],'#e3b699',24)
c.line([(539,276),(608,301),(639,338)],'#e3b699',24)
cat(c,675,397,.9);dog(c,265,403,.95)
c.ellipse((584,513,615,544),'#cf8057');c.save('hero-neighbors.png')

c=Canvas(bg='#f4e7d4')
c.rect((155,63,550,460),'#e9d7b5',180);c.rect((178,86,528,435),'#f8f3e4',165)
c.line([(350,98),(350,436)],'#e0c89f',10);c.line([(180,265),(523,265)],'#e0c89f',10)
c.ellipse((-40,463,1060,940),'#dccaaa');sprig(c,804,440,1.5,'#738769')
c.rect((733,390,866,507),'#b37654',18)
c.ellipse((211,476,743,580),'#aeba9d');cat(c,440,318,1.6,asleep=True)
c.save('story-cat.png')

c=Canvas(bg='#dfeadd');landscape(c);dog(c,484,323,1.5)
c.ellipse((683,450,777,544),'#d5895d');c.line([(686,486),(771,510)],'#f3dcbc',8)
c.ellipse((174,446,223,465),'#8aa679');c.save('story-dog.png')

c=Canvas(bg='#e5ecdc');landscape(c)
c.ellipse((157,198,245,291),'#dba88a');c.rect((135,284,272,432),'#52745a',33)
c.line([(166,425),(158,513),(118,567)],'#415347',28);c.line([(236,425),(260,498),(303,550)],'#415347',28)
c.line([(250,309),(339,356),(387,346)],'#dba88a',24)
c.line([(386,347),(539,435)],'#a47c59',5);dog(c,583,365,1.1)
c.ellipse((772,516,797,537),'#f8f5df');c.save('event-walk.png')

c=Canvas(bg='#f0e5d3')
c.rect((135,85,486,495),'#d4dbc1',150);sprig(c,809,440,1.4,'#65835d')
c.rect((738,397,868,520),'#b87a57',17)
c.ellipse((90,387,875,622),'#b5946b');cat(c,611,332,1.05,'#bd895d')
c.rect((259,362,350,457),'#f6f0e2',12);c.ellipse((325,378,385,431),'#f6f0e2');c.ellipse((341,388,372,420),'#b5946b')
c.ellipse((267,354,343,375),'#a17b5f');c.rect((392,449,578,476),'#5b795f',5)
c.rect((409,461,585,486),'#f3dbc0',4);c.save('event-coffee.png')

palettes=[('#e7ddca','#b67c50'),('#d8e6d0','#b48b60'),('#ebd8c6','#6b7c5d'),('#dae3d4','#d18c64'),('#eadfd7','#aa826b'),('#d8e6df','#799872')]
for i,(bg,color) in enumerate(palettes,1):
    c=Canvas(200,200,bg)
    if i in [1,4]:cat(c,99,98,.75,color)
    elif i in [2,5]:dog(c,98,102,.75,color)
    else:
        c.ellipse((60,36,140,121),'#e4b999');c.ellipse((50,21,146,79),color)
        c.ellipse((34,119,172,264),color);c.ellipse((82,78,87,84),INK);c.ellipse((116,78,121,84),INK)
    c.save('avatar-'+str(i)+'.png')

for active,color in [(False,'#8a948a'),(True,'#346c50')]:
    for kind in ['community','nearby','messages','me']:
        c=Canvas(72,72,(0,0,0,0));d=c.d
        if kind=='community':
            c.ellipse((8,7,29,28),color);c.ellipse((43,7,64,28),color)
            c.ellipse((5,31,24,49),color);c.ellipse((48,31,67,49),color)
            c.ellipse((20,31,52,65),color)
        elif kind=='nearby':
            c.ellipse((15,8,57,50),None,color,4);c.line([(17,39),(36,66),(55,39)],color,4);c.ellipse((29,22,43,36),None,color,4)
        elif kind=='messages':
            d.rounded_rectangle(c.box((8,10,64,53)),16,outline=color,width=8)
            c.line([(16,53),(16,65),(30,53)],color,4)
            for x in [23,36,49]:c.ellipse((x-2,29,x+2,33),color)
        else:
            c.ellipse((23,7,49,33),None,color,4)
            d.arc(c.box((12,37,60,85)),180,360,fill=color,width=8);c.line([(12,61),(60,61)],color,4)
        c.save('tab-'+kind+('-active' if active else '')+'.png')
print('Created',len(list(ROOT.glob('*.png'))),'local image assets.')
