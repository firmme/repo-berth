"""Regenerate Repo Berth platform icons from the 1024px master artwork."""
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parent.parent
assets = root / 'assets'
source = assets / 'app-icon-source.png'
if not source.exists():
    source = root / 'icon-new.png'

image = Image.open(source).convert('RGBA')
alpha = image.getchannel('A').point(lambda p: 255 if p >= 32 else 0)
bbox = alpha.getbbox()
if not bbox:
    raise SystemExit('Icon source has no visible pixels')

left, top, right, bottom = bbox
side = max(right - left, bottom - top)
center_x, center_y = (left + right) / 2, (top + bottom) / 2
image = image.crop(
    (
        round(center_x - side / 2),
        round(center_y - side / 2),
        round(center_x + side / 2),
        round(center_y + side / 2),
    )
)
master = image.resize((1024, 1024), Image.Resampling.LANCZOS)


def platform_icon(size):
    """Center the artwork on the standard macOS icon grid: 87.5% content."""
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    content = round(size * 0.875)
    art = master.resize((content, content), Image.Resampling.LANCZOS)
    offset = (size - content) // 2
    canvas.alpha_composite(art, (offset, offset))
    return canvas


platform_icon(1024).save(assets / 'app.icns')
platform_icon(512).save(assets / 'app-icon.png')
platform_icon(128).save(assets / 'app-icon-preview.png')
platform_icon(1024).save(
    assets / 'app.ico',
    sizes=[(s, s) for s in [16, 20, 24, 32, 40, 48, 64, 128, 256]],
)
(root / 'frontend/public').mkdir(exist_ok=True)
master.resize((512, 512), Image.Resampling.LANCZOS).save(
    root / 'frontend/public/app-icon.png'
)
print('Generated PNG, multi-size ICO and ICNS')
