"""Make muted 8-second H264 excerpts and 0.5-second review sheets."""
import argparse
import json
from pathlib import Path
import subprocess
from PIL import Image, ImageDraw

BASE = Path(__file__).resolve().parents[1]
ROOT = BASE.parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('ids', nargs='+', type=int)
parser.add_argument('--start', type=float, default=0)
args = parser.parse_args()
(BASE / 'videos').mkdir(exist_ok=True)
for pid in args.ids:
    source = BASE / 'video-sources' / (str(pid) + '.webm')
    if not source.exists():
        source = ROOT / 'content/batch-002/media' / (str(pid) + '.webm')
    target = BASE / 'videos' / (str(pid) + '.mp4')
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-ss', str(args.start), '-i', str(source),
        '-t', '8', '-an', '-vf', "scale='if(gte(iw,ih),480,-2)':'if(gte(iw,ih),-2,480)',fps=20",
        '-c:v', 'libx264', '-profile:v', 'baseline', '-level', '3.0', '-preset', 'slow',
        '-crf', '29', '-maxrate', '250k', '-bufsize', '500k', '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart', str(target)], check=True)
    frames = BASE / 'video-review' / str(pid)
    frames.mkdir(exist_ok=True)
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', str(target), '-vf', 'fps=2',
        str(frames / '%02d.jpg')], check=True)
    files = sorted(frames.glob('*.jpg'))
    sheet = Image.new('RGB', (960, 4 * 165 + 28), '#eee')
    draw = ImageDraw.Draw(sheet)
    draw.text((8, 8), str(pid) + ' / every 0.5s / excerpt starts ' + str(args.start), fill='#111')
    for index, frame in enumerate(files):
        img = Image.open(frame); img.thumbnail((234, 140))
        x = (index % 4) * 240; y = (index // 4) * 165 + 28
        sheet.paste(img, (x + (240-img.width)//2, y))
        draw.text((x+6, y+142), str(index * .5) + 's', fill='#111')
    sheet.save(BASE / 'video-review' / (str(pid) + '-review.jpg'), quality=86)
    print(pid, target.stat().st_size, flush=True)
