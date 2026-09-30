"""Build the app's original 72px navigation icons from simple vector geometry.

Only tab-*.png assets are written; content illustrations and uploaded photos are
not touched. Pillow supersampling gives consistent strokes at native tab size.
"""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'miniprogram' / 'assets'
SCALE = 4
SIZE = 72
COLORS = {False: '#7B818A', True: '#CC4A37'}


def bezier(points, steps=16):
    output = []
    for index in range(steps + 1):
        t = index / steps
        mt = 1 - t
        output.append((mt ** 3 * points[0][0] + 3 * mt ** 2 * t * points[1][0] + 3 * mt * t ** 2 * points[2][0] + t ** 3 * points[3][0],
                       mt ** 3 * points[0][1] + 3 * mt ** 2 * t * points[1][1] + 3 * mt * t ** 2 * points[2][1] + t ** 3 * points[3][1]))
    return output


class Icon:
    def __init__(self, active):
        self.image = Image.new('RGBA', (SIZE * SCALE, SIZE * SCALE))
        self.draw = ImageDraw.Draw(self.image)
        self.color = COLORS[active]
        self.fill = '#FFF0E9' if active else None
        self.active = active

    @staticmethod
    def box(values):
        return tuple(round(value * SCALE) for value in values)

    def ellipse(self, values, fill=None, outline=True, width=3.5):
        self.draw.ellipse(self.box(values), fill=fill, outline=self.color if outline else None, width=round(width * SCALE))

    def line(self, points, width=3.5, color=None):
        points = [(round(x * SCALE), round(y * SCALE)) for x, y in points]
        self.draw.line(points, fill=color or self.color, width=round(width * SCALE), joint='curve')
        radius = width * SCALE / 2
        for x, y in (points[0], points[-1]):
            self.draw.ellipse((x-radius,y-radius,x+radius,y+radius),fill=color or self.color)

    def path(self, points, fill=None, stroke=True):
        scaled = [(round(x * SCALE), round(y * SCALE)) for x, y in points]
        if fill:
            self.draw.polygon(scaled,fill=fill)
        if stroke:
            self.line(points + [points[0]])

    def save(self, name):
        self.image.resize((SIZE, SIZE), Image.Resampling.LANCZOS).save(OUT / name, optimize=True)


def paw(icon):
    fill = icon.color if icon.active else None
    for bounds in [(10,25,23,42),(24,12,37,30),(41,15,54,33),(53,31,65,46)]:
        icon.ellipse(bounds, fill=fill, width=3)
    points = []
    for segment in [((21,53),(20,47),(29,34),(36,36)),((36,36),(44,36),(55,49),(54,55)),((54,55),(52,65),(43,59),(38,59)),((38,59),(30,59),(21,64),(21,53))]:
        points += bezier(segment)
    icon.path(points, fill=fill)


def nearby(icon):
    points = []
    for segment in [((36,63),(28,52),(14,37),(14,28)),((14,28),(14,1),(58,1),(58,28)),((58,28),(58,38),(44,53),(36,63))]:
        points += bezier(segment)
    icon.path(points, fill=icon.fill)
    icon.ellipse((27,19,45,37), fill=icon.color if icon.active else None, width=3.5)


def message(icon):
    points = []
    for segment in [((16,12),(10,12),(8,16),(8,23)),((8,23),(8,31),(8,37),(8,44)),((8,44),(8,50),(13,53),(19,53))]:
        points += bezier(segment)
    points += [(19,63),(33,53),(54,53)]
    for segment in [((54,53),(60,53),(64,48),(64,43)),((64,43),(64,35),(64,29),(64,22)),((64,22),(64,16),(60,12),(54,12))]:
        points += bezier(segment)
    icon.path(points, fill=icon.fill)
    for x in [23,36,49]:
        icon.ellipse((x-2,30,x+2,34),fill=icon.color,outline=False)


def person(icon):
    icon.ellipse((24,9,48,33),fill=icon.fill)
    points = []
    for segment in [((13,61),(13,32),(59,32),(59,61))]:
        points += bezier(segment)
    icon.path(points,fill=icon.fill)


for active in (False,True):
    for name,painter in [('community',paw),('nearby',nearby),('messages',message),('me',person)]:
        icon=Icon(active)
        painter(icon)
        icon.save('tab-'+name+('-active' if active else '')+'.png')
print('Updated 8 original navigation icons (72 × 72 RGBA).')
