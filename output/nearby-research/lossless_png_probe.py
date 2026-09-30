"""Read four existing PNGs and compare lossless encodings; never edits assets."""
from pathlib import Path
import hashlib
import io
import json
import struct
import zlib
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent / 'lossless-candidates'
OUT.mkdir(parents=True, exist_ok=True)
NAMES = ['event-walk.png', 'event-coffee.png', 'story-dog.png', 'story-cat.png']


def chunk(kind, value):
    return struct.pack('>I', len(value)) + kind + value + struct.pack('>I', zlib.crc32(kind + value) & 0xffffffff)


def png(width, height, payload):
    header = struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', header) + chunk(b'IDAT', payload) + chunk(b'IEND', b'')


report = []
for name in NAMES:
    source = ROOT / 'miniprogram/assets' / name
    original = source.read_bytes()
    with Image.open(io.BytesIO(original)) as image:
        image.load()
        rgba = image.convert('RGBA')
        pixel_hash = hashlib.sha256(rgba.tobytes()).hexdigest()
        assert rgba.getchannel('A').getextrema() == (255, 255)
        width, height = image.size
        best = original
        method = 'original'
        for mode in ['RGBA', 'RGB']:
            for optimize in [False, True]:
                buffer = io.BytesIO()
                image.convert(mode).save(buffer, format='PNG', optimize=optimize, compress_level=9)
                candidate = buffer.getvalue()
                if len(candidate) < len(best):
                    best, method = candidate, f'pillow:{mode}:optimize={optimize}:level=9'
        raw = np.asarray(image.convert('RGB'), dtype=np.int16).reshape(height, width * 3)

    left = np.zeros_like(raw)
    left[:, 3:] = raw[:, :-3]
    up = np.zeros_like(raw)
    up[1:] = raw[:-1]
    corner = np.zeros_like(raw)
    corner[1:, 3:] = raw[:-1, :-3]
    predictor = left + up - corner
    pa, pb, pc = np.abs(predictor-left), np.abs(predictor-up), np.abs(predictor-corner)
    paeth = np.where((pa <= pb) & (pa <= pc), left, np.where(pb <= pc, up, corner))
    filters = np.stack([raw, raw-left, raw-up, raw-(left+up)//2, raw-paeth]).astype(np.uint8)
    choices = {f'fixed-{number}': np.full(height, number, dtype=np.uint8) for number in range(5)}
    signed = filters.astype(np.int16)
    signed[signed >= 128] -= 256
    choices['min-absolute'] = np.abs(signed).sum(axis=2).argmin(axis=0)
    choices['max-zeros'] = (filters == 0).sum(axis=2).argmax(axis=0)
    entropy = np.zeros((5, height))
    for number in range(5):
        for row in range(height):
            counts = np.bincount(filters[number, row], minlength=256)
            counts = counts[counts != 0]
            entropy[number, row] = -(counts * np.log2(counts / counts.sum())).sum()
    choices['min-entropy'] = entropy.argmin(axis=0)
    for filter_name, selection in choices.items():
        stream = np.empty((height, width * 3 + 1), dtype=np.uint8)
        stream[:, 0] = selection
        stream[:, 1:] = filters[selection, np.arange(height)]
        payload = stream.tobytes()
        for strategy_name in ['Z_DEFAULT_STRATEGY', 'Z_FILTERED', 'Z_RLE']:
            for memory in [8, 9]:
                compressor = zlib.compressobj(9, zlib.DEFLATED, 15, memory, getattr(zlib, strategy_name))
                encoded = compressor.compress(payload) + compressor.flush()
                candidate = png(width, height, encoded)
                if len(candidate) < len(best):
                    best = candidate
                    method = f'png-filter:{filter_name}:deflate={strategy_name}:memory={memory}'
    with Image.open(io.BytesIO(best)) as candidate:
        assert candidate.size == (width, height)
        assert hashlib.sha256(candidate.convert('RGBA').tobytes()).hexdigest() == pixel_hash
    (OUT / name).write_bytes(best)
    result = {'file': name, 'originalBytes': len(original), 'candidateBytes': len(best),
              'savedBytes': len(original)-len(best), 'rgbaSha256': pixel_hash,
              'originalSha256': hashlib.sha256(original).hexdigest(),
              'candidateSha256': hashlib.sha256(best).hexdigest(),
              'dimensions': [width, height], 'method': method}
    report.append(result)
    print(json.dumps(result), flush=True)
summary = {'files': report, 'totalSavedBytes': sum(r['savedBytes'] for r in report), 'assetsModified': False}
(OUT.parent / 'lossless-png-probe.json').write_text(json.dumps(summary, indent=2) + '\n')
print(json.dumps({'totalSavedBytes': summary['totalSavedBytes']}), flush=True)
