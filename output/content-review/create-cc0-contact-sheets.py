"""Read locally downloaded Commons candidates and build visual review sheets.

No network calls, publication or source-file edits. All output stays alongside
this script under output/content-review. Run after the collector has finished.
"""
from pathlib import Path
import argparse
import hashlib
import json
from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'content/batch-002/sources'
OUTPUT = Path(__file__).resolve().parent
FONT_PATH = '/System/Library/Fonts/Supplemental/Arial.ttf'
FONT = ImageFont.truetype(FONT_PATH, 17)
SMALL = ImageFont.truetype(FONT_PATH, 12)
CELL_W, CELL_H = 270, 228
COLS, ROWS = 5, 4


def records():
    result = []
    known = set()
    for species in ['cats', 'dogs']:
        for candidate in sorted(SOURCE.glob(species + '*-candidates.json')):
            for row in json.loads(candidate.read_text()):
                if row['pageid'] not in known and (ROOT / row['localFile']).exists():
                    result.append(dict(row, species=species))
                    known.add(row['pageid'])
    return result


def dhash(image):
    pixels = list(image.convert('L').resize((9, 8), Image.Resampling.LANCZOS).getdata())
    number = 0
    for row in range(8):
        for col in range(8):
            number = (number << 1) | int(pixels[row * 9 + col] > pixels[row * 9 + col + 1])
    return number


def thumbnail(record):
    with Image.open(ROOT / record['localFile']) as source:
        image = ImageOps.exif_transpose(source).convert('RGB')
        record['reviewDimensions'] = list(image.size)
        record['reviewDhash'] = dhash(image)
        record['reviewSha256'] = hashlib.sha256((ROOT / record['localFile']).read_bytes()).hexdigest()
        return ImageOps.contain(image, (CELL_W - 16, CELL_H - 50))


def sheet(rows, name):
    board = Image.new('RGB', (COLS * CELL_W, ROWS * CELL_H + 38), '#F5F3EF')
    draw = ImageDraw.Draw(board)
    draw.text((12, 8), name + ' | page ID below each source image', font=FONT, fill='#25272C')
    for index, record in enumerate(rows):
        x, y = (index % COLS) * CELL_W, (index // COLS) * CELL_H + 38
        draw.rectangle((x+4, y+4, x+CELL_W-4, y+CELL_H-4), fill='white', outline='#D9D6D2')
        try:
            thumb = thumbnail(record)
            board.paste(thumb, (x+(CELL_W-thumb.width)//2, y+7+(CELL_H-50-thumb.height)//2))
        except Exception as error:
            record['reviewError'] = str(error)
            draw.text((x+10, y+60), 'UNREADABLE IMAGE', font=FONT, fill='#B44534')
        draw.text((x+9, y+CELL_H-39), str(record['pageid']) + ' | ' + record['species'], font=FONT, fill='#25272C')
        title = record.get('title', '').replace('File:', '')
        draw.text((x+9, y+CELL_H-19), title[:37], font=SMALL, fill='#565B63')
    target = OUTPUT / (name + '.jpg')
    board.save(target, quality=92)
    return str(target.relative_to(ROOT))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--species', choices=['cats', 'dogs', 'all'], default='all')
    parser.add_argument('--only-new', action='store_true')
    parser.add_argument('--batch', default='')
    args = parser.parse_args()
    available = [dict(row) for row in records() if args.species in ['all', row['species']]]
    if args.only_new:
        reviewed_file = SOURCE / 'cats-dogs-review.json'
        reviewed = set(json.loads(reviewed_file.read_text()).get('reviewedPageids', [])) if reviewed_file.exists() else set()
        available = [row for row in available if row['pageid'] not in reviewed]
    if not available:
        raise SystemExit('No completed local candidate images yet; no sheets written.')
    inventory = {'sheets': [], 'records': available, 'possibleDuplicates': []}
    for species in ['cats', 'dogs']:
        group = [row for row in available if row['species'] == species]
        for offset in range(0, len(group), COLS * ROWS):
            batch = group[offset:offset+COLS*ROWS]
            name = 'cc0-' + (args.batch + '-' if args.batch else '') + f'{species}-{offset // (COLS*ROWS) + 1:02}'
            inventory['sheets'].append({'path': sheet(batch, name), 'pageids': [row['pageid'] for row in batch]})
    for index, row in enumerate(available):
        if 'reviewDhash' not in row:
            continue
        for other in available[:index]:
            if 'reviewDhash' not in other or other['species'] != row['species']:
                continue
            distance = bin(row['reviewDhash'] ^ other['reviewDhash']).count('1')
            if distance <= 7 or row['reviewSha256'] == other['reviewSha256']:
                inventory['possibleDuplicates'].append({'a': other['pageid'], 'b': row['pageid'], 'distance': distance})
    target = OUTPUT / ('cc0-review-index-' + (args.batch or args.species) + '.json')
    target.write_text(json.dumps(inventory, ensure_ascii=False, indent=2))
    print(json.dumps({'images': len(available), 'sheets': inventory['sheets'],
                      'possibleDuplicates': inventory['possibleDuplicates'],
                      'index': str(target.relative_to(ROOT))}, ensure_ascii=False))


if __name__ == '__main__':
    main()
