"""Regenerate original code-drawn static PWA icons. Optional tooling: Pillow."""
from pathlib import Path
from math import cos, sin, pi
from PIL import Image, ImageDraw

output = Path(__file__).resolve().parents[1] / 'public'
for name, size in [('pwa-192.png', 192), ('pwa-512.png', 512),
                   ('pwa-maskable-512.png', 512), ('apple-touch-icon.png', 180)]:
    image = Image.new('RGB', (512, 512), '#174e48')
    draw = ImageDraw.Draw(image)
    # The mark lies inside the maskable central safe area.
    draw.rounded_rectangle((168, 146, 348, 322), radius=70, fill='#e9f3ec')
    draw.rectangle((168, 146, 239, 388), fill='#e9f3ec')
    draw.rounded_rectangle((239, 209, 293, 263), radius=23, fill='#174e48')
    points = [(351 + (25 if index % 2 == 0 else 10) * cos(-pi/2 + index*pi/5),
               145 + (25 if index % 2 == 0 else 10) * sin(-pi/2 + index*pi/5))
              for index in range(10)]
    draw.polygon(points, fill='#a9d4ad')
    image.resize((size, size), Image.Resampling.LANCZOS).save(output / name)
print('Generated 192/512/maskable/apple-touch PNG icons')
