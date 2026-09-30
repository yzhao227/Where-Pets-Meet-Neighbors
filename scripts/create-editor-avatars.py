"""Draw six original editorial avatars from reproducible vector geometry.

No fonts, external images or AI-generated artwork are used. Each 144 px PNG
keeps its complete symbol inside a circular safe area for cropped avatars.
Only miniprogram/assets/editor-*.png is written.
"""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'miniprogram' / 'assets'
SIZE = 144
SCALE = 4
WARM = '#FAF8F5'
INK = '#24262D'
CORAL = '#EF725B'
PEACH = '#FBE6DF'
BLUE = '#EAF2F8'
MID_BLUE = '#B5CFDF'


class Avatar:
    def __init__(self, background):
        self.im = Image.new('RGB', (SIZE * SCALE, SIZE * SCALE), WARM)
        self.d = ImageDraw.Draw(self.im)
        self.ellipse((8, 8, 136, 136), background)

    @staticmethod
    def points(points):
        return [(round(x * SCALE), round(y * SCALE)) for x, y in points]

    @staticmethod
    def box(box):
        return tuple(round(v * SCALE) for v in box)

    def ellipse(self, box, fill=None, stroke=None, width=2.6):
        self.d.ellipse(self.box(box), fill, stroke, round(width * SCALE))

    def rect(self, box, radius=10, fill=WARM, stroke=INK, width=2.6):
        self.d.rounded_rectangle(self.box(box), round(radius * SCALE), fill,
                                 stroke, round(width * SCALE))

    def line(self, points, fill=INK, width=2.6):
        self.d.line(self.points(points), fill, round(width * SCALE), joint='curve')
        r = width / 2
        for x, y in (points[0], points[-1]):
            self.ellipse((x-r, y-r, x+r, y+r), fill)

    def path(self, commands, fill=None, stroke=INK, width=2.6):
        points = []
        for cmd in commands:
            if cmd[0] in ('M', 'L'):
                points.append((cmd[1], cmd[2]))
            elif cmd[0] == 'C':
                start = points[-1]
                for i in range(1, 25):
                    t = i / 24
                    u = 1-t
                    points.append((u**3*start[0]+3*u*u*t*cmd[1]+3*u*t*t*cmd[3]+t**3*cmd[5],
                                   u**3*start[1]+3*u*u*t*cmd[2]+3*u*t*t*cmd[4]+t**3*cmd[6]))
            elif cmd[0] == 'Z':
                points.append(points[0])
        if fill:
            self.d.polygon(self.points(points), fill)
        if stroke:
            self.line(points, stroke, width)

    def save(self, name):
        destination = ASSETS / f'editor-{name}.png'
        self.im.resize((SIZE, SIZE), Image.Resampling.LANCZOS).save(destination, optimize=True)
        assert destination.stat().st_size < 15 * 1024, f'{name}: exceeds 15 KiB'
        print(f'{destination.relative_to(ROOT)}: 144x144 RGB, {destination.stat().st_size} bytes')


def paw(a, x, y, size=1, fill=CORAL):
    a.path([('M',x-15*size,y+8*size),
            ('C',x-15*size,y-1*size,x-7*size,y-10*size,x,y-10*size),
            ('C',x+7*size,y-10*size,x+15*size,y-1*size,x+15*size,y+8*size),
            ('C',x+15*size,y+19*size,x+5*size,y+15*size,x,y+14*size),
            ('C',x-5*size,y+15*size,x-15*size,y+19*size,x-15*size,y+8*size),('Z',)],
           fill, None)
    for dx,dy,rx,ry in [(-20,-10,6,8),(-7.5,-23,6,8),(7.5,-23,6,8),(20,-10,6,8)]:
        a.ellipse((x+(dx-rx)*size,y+(dy-ry)*size,x+(dx+rx)*size,y+(dy+ry)*size),fill)


def cat_home():
    a = Avatar(PEACH)
    a.path([('M',39,64),('L',39,37),('L',58,50),
            ('C',66,47,78,47,86,50),('L',105,37),('L',105,64),
            ('C',119,112,25,112,39,64),('Z',)],WARM)
    a.path([('M',46,47),('L',46,63),('L',56,55),('Z',)],CORAL,None)
    a.path([('M',98,47),('L',98,63),('L',88,55),('Z',)],CORAL,None)
    for x in [57,87]:
        a.ellipse((x-2.4,70,x+2.4,76),INK)
    a.path([('M',68,79),('L',76,79),('L',72,84),('Z',)],CORAL,None)
    a.path([('M',63,88),('C',66,92,72,91,72,85),
            ('C',72,91,78,92,81,88)],width=2.2)
    a.line([(34,77),(44,80)],width=2)
    a.line([(33,86),(43,86)],width=2)
    a.line([(100,80),(110,77)],width=2)
    a.line([(101,86),(111,86)],width=2)
    return a


def cat_behavior():
    a = Avatar(BLUE)
    # A paw in a small observation bubble, without a simulated person's face.
    a.path([('M',46,36),('L',99,36),('C',109,36,115,43,115,53),
            ('L',115,87),('C',115,97,109,103,99,103),
            ('L',83,103),('L',71,115),('L',71,103),('L',46,103),
            ('C',36,103,30,97,30,87),('L',30,53),
            ('C',30,43,36,36,46,36),('Z',)],WARM)
    paw(a,72,75,.86)
    return a


def dog_life():
    a = Avatar(BLUE)
    a.path([('M',51,45),('C',29,39,25,67,33,85),
            ('C',39,98,49,86,51,75),('Z',)],MID_BLUE)
    a.path([('M',93,45),('C',115,39,119,67,111,85),
            ('C',105,98,95,86,93,75),('Z',)],MID_BLUE)
    a.path([('M',45,55),('C',46,25,98,25,99,55),
            ('L',104,78),('C',110,119,34,119,40,78),('Z',)],WARM)
    a.ellipse((55,74,89,105),PEACH)
    for x in [58,86]:
        a.ellipse((x-2.3,63,x+2.3,69),INK)
    a.path([('M',67,80),('C',67,77,77,77,77,80),
            ('C',77,84,74,86,72,86),('C',70,86,67,84,67,80),('Z',)],INK,None)
    a.line([(72,86),(72,91)],width=2.2)
    a.path([('M',64,90),('C',65,97,72,95,72,91),
            ('C',72,95,79,97,80,90)],width=2.2)
    a.rect((59,106,85,112),3,CORAL,None)
    return a


def dog_walk():
    a = Avatar(PEACH)
    a.path([('M',32,53),('L',58,44),('L',84,53),('L',111,44),
            ('L',111,101),('L',84,110),('L',58,101),('L',32,110),('Z',)],WARM)
    a.path([('M',58,44),('L',84,53),('L',84,110),('L',58,101),('Z',)],BLUE,None)
    a.line([(58,45),(58,100)],MID_BLUE,2)
    a.line([(84,54),(84,109)],MID_BLUE,2)
    a.path([('M',44,94),('C',47,72,65,71,70,87),
            ('C',74,102,89,95,95,82)],None,CORAL,3.4)
    a.ellipse((40,90,48,98),WARM,CORAL,2.5)
    a.path([('M',93,32),('C',77,32,73,46,79,56),
            ('L',93,75),('L',107,56),('C',113,46,109,32,93,32),('Z',)],CORAL)
    a.ellipse((87,41,99,53),WARM)
    return a


def pet_care():
    a = Avatar(PEACH)
    a.path([('M',31,43),('C',46,37,62,40,72,47),
            ('C',82,40,98,37,113,43),('L',113,104),
            ('C',98,98,82,101,72,108),('C',62,101,46,98,31,104),('Z',)],WARM)
    a.path([('M',72,47),('C',82,40,98,37,113,43),('L',113,104),
            ('C',98,98,82,101,72,108),('Z',)],BLUE,None)
    a.line([(72,48),(72,107)],width=2.6)
    a.line([(40,59),(59,59)],MID_BLUE,3)
    a.line([(40,70),(61,70)],MID_BLUE,3)
    a.line([(40,81),(57,81)],MID_BLUE,3)
    paw(a,92,74,.49)
    a.path([('M',84,40),('L',95,39),('L',95,58),('L',89.5,54),('L',84,58),('Z',)],CORAL,None)
    return a


def photo():
    a = Avatar(BLUE)
    a.path([('M',43,48),('L',51,48),('L',59,37),('L',84,37),
            ('L',92,48),('L',102,48),('C',111,48,115,53,115,62),
            ('L',115,95),('C',115,104,110,109,101,109),('L',42,109),
            ('C',33,109,29,104,29,95),('L',29,62),
            ('C',29,53,34,48,43,48),('Z',)],WARM)
    a.ellipse((48,55,96,103),PEACH,INK)
    a.ellipse((54,61,90,97),CORAL)
    paw(a,72,81,.50,WARM)
    a.ellipse((101,56,107,62),CORAL)
    a.line([(63,43),(80,43)],MID_BLUE,2.6)
    return a


def main():
    ASSETS.mkdir(parents=True, exist_ok=True)
    for name, painter in [('cat-home',cat_home),('cat-behavior',cat_behavior),
                          ('dog-life',dog_life),('dog-walk',dog_walk),
                          ('pet-care',pet_care),('photo',photo)]:
        painter().save(name)


if __name__ == '__main__':
    main()
