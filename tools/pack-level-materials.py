"""Trim Blender props to visible bounds and export lossless runtime WebP."""
from pathlib import Path
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]
out=ROOT/'assets/sprites/architecture'
for file in out.glob('*.png'):
    with Image.open(file) as image:
        if '-rock-' in file.name:image=image.crop(image.getchannel('A').getbbox())
        image.save(file.with_suffix('.webp'),lossless=True,method=6)
print('Packed architecture materials and rocks')
