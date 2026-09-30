"""Render a brand avatar using the project's existing cat/dog illustration style.

This is deterministic illustration, not an AI-generated or downloaded image.
It creates new brand files only; existing app assets and releases are unchanged.
"""
import argparse
from pathlib import Path
from PIL import Image, ImageDraw

PALETTES = {
    'original': dict(suffix='v1', bg='#F7F1E5', bubble='#345F4A', ink='#304C3A',
                     cat='#D99B70', inner_ear='#EDBC91', cat_muzzle='#F9E9CE',
                     dog_ear='#B78658', dog='#F0D5A5', dog_muzzle='#FFF0D4', tongue='#CD8A7C'),
    'coral': dict(suffix='v2-coral', bg='#FFF7F3', bubble='#FF7B70', ink='#593F3F',
                  cat='#FFE5AD', inner_ear='#F5BB9F', cat_muzzle='#FFFAEF',
                  dog_ear='#D99F80', dog='#FFFCF5', dog_muzzle='#FBE9D8', tongue='#E89299'),
    'sky': dict(suffix='v2-sky', bg='#F3F9FF', bubble='#579FDD', ink='#354D66',
                cat='#FFD494', inner_ear='#F4BDA2', cat_muzzle='#FFF7E9',
                dog_ear='#B9CCE2', dog='#FFFCF5', dog_muzzle='#F4E8D8', tongue='#E394A3'),
    'lilac': dict(suffix='v2-lilac', bg='#FAF7FF', bubble='#9986DF', ink='#49405F',
                  cat='#FFE0A5', inner_ear='#F1B9AD', cat_muzzle='#FFF9ED',
                  dog_ear='#CEB5CF', dog='#FFFAF3', dog_muzzle='#F5E5DD', tongue='#E197AA'),
}
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--palette', choices=PALETTES, default='original')
palette = PALETTES[parser.parse_args().palette]

OUT = Path(__file__).resolve().parents[1] / 'output' / 'brand'
OUT.mkdir(parents=True, exist_ok=True)
S = 3
SIZE = 1024
BG = palette['bg']
BUBBLE = palette['bubble']
INK = palette['ink']
PREFIX = 'youchong-youlin-avatar-' + palette['suffix']
im = Image.new('RGB', (SIZE * S, SIZE * S), BG)
d = ImageDraw.Draw(im)


def box(v):
    return tuple(round(n * S) for n in v)


def ellipse(v, color):
    d.ellipse(box(v), fill=color)


def polygon(points, color):
    d.polygon([(round(x * S), round(y * S)) for x, y in points], fill=color)


def curve(points, color, width):
    # A cubic Bezier sampled densely before high-resolution downsampling.
    a, b, c, e = points
    sampled = []
    for n in range(101):
        t = n / 100
        x = (1-t)**3*a[0] + 3*(1-t)**2*t*b[0] + 3*(1-t)*t*t*c[0] + t**3*e[0]
        y = (1-t)**3*a[1] + 3*(1-t)**2*t*b[1] + 3*(1-t)*t*t*c[1] + t**3*e[1]
        sampled.append((round(x * S), round(y * S)))
    d.line(sampled, fill=color, width=width * S, joint='curve')
    r = width / 2
    for x, y in [a, e]:
        ellipse((x-r, y-r, x+r, y+r), color)


def filled_curve(start, segments, color):
    points = [start]
    a = start
    for b, c, e in segments:
        for n in range(1, 81):
            t = n / 80
            points.append(((1-t)**3*a[0] + 3*(1-t)**2*t*b[0] + 3*(1-t)*t*t*c[0] + t**3*e[0],
                           (1-t)**3*a[1] + 3*(1-t)**2*t*b[1] + 3*(1-t)*t*t*c[1] + t**3*e[1]))
        a = e
    polygon(points, color)


# One conversation bubble: no wordmark, fine borders, or corner details.
d.rounded_rectangle(box((146, 170, 878, 798)), radius=190*S, fill=BUBBLE)
filled_curve((637, 748), [
    ((680, 736), (731, 733), (757, 745)),
    ((763, 780), (775, 824), (782, 850)),
    ((787, 863), (779, 868), (768, 862)),
    ((724, 843), (687, 817), (650, 783)),
], BUBBLE)

# Cat: triangular ears and warm terracotta face match create-assets.py.
CAT = palette['cat']
polygon([(245, 469), (253, 325), (355, 416)], CAT)
polygon([(389, 415), (485, 325), (499, 470)], CAT)
ellipse((241, 389, 505, 673), CAT)
polygon([(268, 366), (272, 428), (315, 402)], palette['inner_ear'])
polygon([(469, 366), (467, 429), (427, 402)], palette['inner_ear'])
ellipse((304, 519, 443, 615), palette['cat_muzzle'])
ellipse((301, 479, 322, 507), INK)
ellipse((425, 479, 446, 507), INK)
polygon([(360, 542), (388, 542), (374, 557)], INK)
curve([(374, 556), (372, 573), (357, 580), (349, 572)], INK, 7)
curve([(374, 556), (377, 573), (391, 580), (400, 572)], INK, 7)

# Dog: floppy ears, cream muzzle and a small tongue from the original palette.
ellipse((531, 402, 609, 589), palette['dog_ear'])
ellipse((735, 402, 810, 589), palette['dog_ear'])
ellipse((565, 370, 778, 675), palette['dog'])
ellipse((591, 509, 752, 628), palette['dog_muzzle'])
ellipse((602, 478, 624, 505), INK)
ellipse((717, 478, 739, 505), INK)
ellipse((655, 536, 686, 555), INK)
curve([(670, 551), (670, 565), (670, 570), (670, 576)], INK, 7)
ellipse((660, 573, 681, 598), palette['tongue'])
curve([(645, 570), (652, 581), (661, 584), (670, 576)], INK, 6)
curve([(670, 576), (680, 584), (688, 581), (695, 570)], INK, 6)

master = im.resize((SIZE, SIZE), Image.Resampling.LANCZOS)
for size in [1024, 512, 144]:
    master.resize((size, size), Image.Resampling.LANCZOS).save(
        OUT / f'{PREFIX}-{size}.png', optimize=True)

# Local visual QA only: inspect the actual icon at small sizes and in a circle.
qa = Image.new('RGB', (1000, 640), '#E7E9E4')
qa.paste(master.resize((512, 512), Image.Resampling.LANCZOS), (32, 32))
circle = master.resize((288, 288), Image.Resampling.LANCZOS)
mask = Image.new('L', (288, 288), 0)
ImageDraw.Draw(mask).ellipse((0, 0, 287, 287), fill=255)
qa.paste(circle, (612, 44), mask)
for size, x in [(144, 596), (64, 774), (48, 882)]:
    qa.paste(master.resize((size, size), Image.Resampling.LANCZOS), (x, 382))
qa.save(OUT / f'{PREFIX}-preview.png', optimize=True)

for file in sorted(OUT.glob(f'{PREFIX}-*.png')):
    with Image.open(file) as check:
        print(f'{file.name}: {check.width} x {check.height}, {file.stat().st_size} bytes')
