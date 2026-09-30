"""Draw the three original empty-state illustrations from reproducible geometry.

No fonts, external images, or generated AI assets are used. All artwork is drawn
at 3x resolution and reduced to transparent 480 x 320 PNGs.
"""
from pathlib import Path
from math import hypot
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'miniprogram' / 'assets'
REVIEW = ROOT / 'output' / 'design' / 'empty-art-review.png'
SCALE = 3
INK = '#24262D'
CORAL = '#EF725B'
PEACH = '#FFF0E9'
BLUE = '#EAF2F8'
WHITE = '#FFFEFB'
PALE_CORAL = '#F7B6A7'
MID_BLUE = '#B5CFDF'


class Art:
    def __init__(self):
        self.im = Image.new('RGBA', (480 * SCALE, 320 * SCALE))
        self.d = ImageDraw.Draw(self.im)

    def points(self, points):
        return [(round(x * SCALE), round(y * SCALE)) for x, y in points]

    def box(self, box):
        return tuple(round(v * SCALE) for v in box)

    def ellipse(self, box, fill=None, stroke=None, width=2.2):
        self.d.ellipse(self.box(box), fill, stroke, round(width * SCALE))

    def rect(self, box, radius=18, fill=WHITE, stroke=None, width=2.2):
        self.d.rounded_rectangle(self.box(box), radius * SCALE, fill,
                                 stroke, round(width * SCALE))

    def line(self, points, fill=INK, width=2.2, closed=False):
        points = list(points)
        if closed:
            points.append(points[0])
        self.d.line(self.points(points), fill, round(width * SCALE), joint='curve')
        # Round caps also keep the little facial features friendly at small size.
        r = width / 2
        for x, y in (points[0], points[-1]):
            self.ellipse((x-r, y-r, x+r, y+r), fill)

    def path(self, commands, fill=None, stroke=INK, width=2.2):
        points = []
        for cmd in commands:
            if cmd[0] in ('M', 'L'):
                points.append((cmd[1], cmd[2]))
            elif cmd[0] == 'C':
                start = points[-1]
                for i in range(1, 31):
                    t = i / 30
                    u = 1-t
                    points.append((u**3*start[0]+3*u*u*t*cmd[1]+3*u*t*t*cmd[3]+t**3*cmd[5],
                                   u**3*start[1]+3*u*u*t*cmd[2]+3*u*t*t*cmd[4]+t**3*cmd[6]))
            elif cmd[0] == 'Z':
                points.append(points[0])
        if fill:
            self.d.polygon(self.points(points), fill)
        if stroke:
            self.line(points, stroke, width)
        return points

    def dashed(self, points, fill=CORAL, width=3, dash=7, gap=7):
        offset = 0
        for p1, p2 in zip(points, points[1:]):
            length = hypot(p2[0]-p1[0], p2[1]-p1[1])
            if not length:
                continue
            position = 0
            while position < length:
                phase = offset % (dash + gap)
                step = min(length-position, (dash if phase < dash else dash+gap)-phase)
                if phase < dash:
                    self.line([(p1[0]+(p2[0]-p1[0])*position/length,
                                p1[1]+(p2[1]-p1[1])*position/length),
                               (p1[0]+(p2[0]-p1[0])*(position+step)/length,
                                p1[1]+(p2[1]-p1[1])*(position+step)/length)], fill, width)
                position += step
                offset += step

    def image(self):
        return self.im.resize((480, 320), Image.Resampling.LANCZOS)


def paw(a, x, y, size=1, color=CORAL):
    a.path([('M', x-9*size, y+5*size),
            ('C', x-9*size, y-1*size, x-4*size, y-7*size, x, y-7*size),
            ('C', x+4*size, y-7*size, x+9*size, y-1*size, x+9*size, y+5*size),
            ('C', x+9*size, y+12*size, x+3*size, y+9*size, x, y+9*size),
            ('C', x-3*size, y+9*size, x-9*size, y+12*size, x-9*size, y+5*size), ('Z',)],
           fill=color, stroke=None)
    for dx, dy, rx, ry in [(-12,-7,3.7,5),(-4.5,-15,3.8,5.2),(4.5,-15,3.8,5.2),(12,-7,3.7,5)]:
        a.ellipse((x+(dx-rx)*size,y+(dy-ry)*size,x+(dx+rx)*size,y+(dy+ry)*size), color)


def cat(a, x, y):
    a.path([('M',x-30,y-5),('L',x-30,y-37),('L',x-13,y-25),
            ('C',x-6,y-28,x+7,y-28,x+13,y-25),('L',x+30,y-37),('L',x+30,y-5),
            ('C',x+37,y+32,x-37,y+32,x-30,y-5),('Z',)], PEACH)
    a.path([('M',x-24,y-26),('L',x-24,y-13),('L',x-15,y-20),('Z',)], PALE_CORAL, None)
    a.path([('M',x+24,y-26),('L',x+24,y-13),('L',x+15,y-20),('Z',)], PALE_CORAL, None)
    for dx in [-12,12]:
        a.ellipse((x+dx-2,y-3,x+dx+2,y+2), INK)
    a.path([('M',x-3,y+6),('L',x+3,y+6),('L',x,y+9),('Z',)], INK, None)
    a.path([('M',x-7,y+12),('C',x-4,y+16,x,y+14,x,y+10),
            ('C',x,y+14,x+4,y+16,x+7,y+12)], None, INK, 1.7)


def dog(a, x, y):
    a.ellipse((x-35,y-29,x-16,y+12), MID_BLUE, INK)
    a.ellipse((x+16,y-29,x+35,y+12), MID_BLUE, INK)
    a.path([('M',x-24,y-22),('C',x-18,y-45,x+20,y-45,x+25,y-20),
            ('C',x+35,y+29,x-35,y+29,x-24,y-22),('Z',)], BLUE)
    a.ellipse((x-16,y-2,x+17,y+22), WHITE)
    for dx in [-11,11]:
        a.ellipse((x+dx-2,y-13,x+dx+2,y-8), INK)
    a.ellipse((x-4,y+1,x+4,y+6), INK)
    a.path([('M',x,y+6),('L',x,y+11),
            ('C',x,y+16,x+6,y+16,x+8,y+11)], None, INK, 1.7)
    a.path([('M',x,y+11),('C',x,y+16,x-6,y+16,x-8,y+11)], None, INK, 1.7)


def community():
    a = Art()
    a.ellipse((95,100,278,279), BLUE)
    # A single conversation grows from a shared cat-and-dog photograph.
    a.path([('M',294,59),('L',352,59),('C',365,59,374,68,374,81),
            ('L',374,113),('C',374,126,365,135,352,135),('L',335,135),
            ('L',321,151),('L',321,135),('L',294,135),
            ('C',281,135,272,126,272,113),('L',272,81),
            ('C',272,68,281,59,294,59),('Z',)], PEACH)
    for x in [307,323,339]:
        a.ellipse((x-2.5,94.5,x+2.5,99.5), CORAL)
    a.rect((123,103,332,248), 17, WHITE, INK)
    a.rect((136,116,319,215), 11, '#F9F8F4')
    cat(a, 185, 178)
    dog(a, 268, 177)
    a.line([(141,231),(200,231)], MID_BLUE, 3)
    a.ellipse((304,227,312,235), CORAL)
    a.ellipse((97,78,106,87), CORAL)
    a.line([(357,227),(362,234),(373,218)], CORAL, 3)
    return a.image()


def nearby():
    a = Art()
    a.ellipse((204,58,375,226), PEACH)
    outline = [('M',102,137),('L',183,113),('L',271,137),('L',358,112),
               ('L',358,239),('L',271,264),('L',183,239),('L',102,262),('Z',)]
    a.path(outline, WHITE, None)
    a.path([('M',183,113),('L',271,137),('L',271,264),('L',183,239),('Z',)], BLUE, None)
    a.path(outline, None)
    a.line([(183,114),(183,239)])
    a.line([(271,138),(271,263)])
    route = a.path([('M',135,223),('C',148,185,171,166,196,185),
                    ('C',221,205,231,235,252,210),('C',270,186,280,187,302,180)], None, None)
    a.dashed(route)
    a.ellipse((128,216,141,229), WHITE, CORAL, 2.5)
    # The pet marker is one unified silhouette rather than a pile of symbols.
    a.path([('M',303,73),('C',277,73,265,91,269,111),
            ('C',273,131,296,153,303,161),
            ('C',310,153,333,131,337,111),('C',341,91,329,73,303,73),('Z',)], CORAL)
    paw(a, 303, 108, .87, WHITE)
    a.line([(112,88),(112,104)], MID_BLUE, 2.5)
    a.line([(104,96),(120,96)], MID_BLUE, 2.5)
    a.ellipse((363,258,371,266), CORAL)
    return a.image()


def messages():
    a = Art()
    a.ellipse((94,77,295,276), BLUE)
    # The open envelope, letter, and paw seal read as a single object.
    a.path([('M',124,147),('L',228,79),('C',234,75,241,75,247,79),
            ('L',352,147),('L',352,242),('C',352,252,344,260,334,260),
            ('L',142,260),('C',132,260,124,252,124,242),('Z',)], PALE_CORAL)
    a.rect((151,101,325,230), 12, WHITE, INK)
    a.line([(174,126),(228,126)], MID_BLUE, 4)
    a.line([(174,144),(287,144)], BLUE, 4)
    a.path([('M',124,149),('L',230,212),('C',235,215,241,215,246,212),
            ('L',352,149),('L',352,242),('C',352,252,344,260,334,260),
            ('L',142,260),('C',132,260,124,252,124,242),('Z',)], PEACH)
    a.line([(125,249),(207,198)])
    a.line([(351,249),(269,198)])
    a.ellipse((216,195,260,239), CORAL)
    paw(a,238,220,.64,WHITE)
    a.path([('M',353,91),('C',342,78,328,93,339,104),
            ('L',353,116),('L',367,104),('C',378,93,364,78,353,91),('Z',)], CORAL, None)
    a.ellipse((117,66,125,74), MID_BLUE)
    return a.image()


def main():
    ASSETS.mkdir(parents=True, exist_ok=True)
    REVIEW.parent.mkdir(parents=True, exist_ok=True)
    illustrations = [('community', community()), ('nearby', nearby()), ('messages', messages())]
    sheet = Image.new('RGB', (1440, 640), '#FFFEFB')
    for i, (name, artwork) in enumerate(illustrations):
        destination = ASSETS / f'empty-{name}.png'
        artwork.save(destination, optimize=True)
        assert destination.stat().st_size < 50 * 1024, f'{name}: exceeds 50 KiB'
        sheet.paste(artwork, (i * 480, 0), artwork)
        small = artwork.resize((240, 160), Image.Resampling.LANCZOS)
        sheet.paste(small, (i * 480 + 120, 400), small)
        print(f'{destination.relative_to(ROOT)}: 480x320 RGBA, {destination.stat().st_size} bytes')
    sheet.save(REVIEW, optimize=True)
    print(REVIEW.relative_to(ROOT))


if __name__ == '__main__':
    main()
