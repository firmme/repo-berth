"""Regenerate the original vector mark and platform icons (requires Pillow)."""
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parent.parent
assets = root / 'assets'
assets.mkdir(exist_ok=True)
svg = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#173740"/><g fill="none" stroke="#e1f0e9" stroke-width="24" stroke-linecap="round" stroke-linejoin="round"><path d="M152 144v162c0 64 40 96 96 96s96-32 96-96V144M152 242h192M344 306h56"/></g><circle cx="152" cy="144" r="31" fill="#8edbc7"/><circle cx="344" cy="144" r="31" fill="#f2d9a6"/></svg>'''
(assets / 'app-icon.svg').write_text(svg, encoding='utf-8')
(root / 'frontend/public').mkdir(exist_ok=True)
(root / 'frontend/public/app-icon.svg').write_text(svg, encoding='utf-8')
scale=4
image=Image.new('RGBA',(512*scale,512*scale))
draw=ImageDraw.Draw(image)
draw.rounded_rectangle((0,0,512*scale-1,512*scale-1),radius=112*scale,fill='#173740')
def cubic(a,b,c,d):
    return [tuple((1-t)**3*a[k]+3*(1-t)**2*t*b[k]+3*(1-t)*t*t*c[k]+t**3*d[k] for k in (0,1)) for t in [i/80 for i in range(81)]]
points=[(152,144),(152,306)]+cubic((152,306),(152,370),(192,402),(248,402))+cubic((248,402),(304,402),(344,370),(344,306))+[(344,144)]
for line in [points,[(152,242),(344,242)],[(344,306),(400,306)]]:
    draw.line([(round(x*scale),round(y*scale)) for x,y in line],fill='#e1f0e9',width=24*scale,joint='curve')
    for x,y in [line[0],line[-1]]:draw.ellipse(((x-12)*scale,(y-12)*scale,(x+12)*scale,(y+12)*scale),fill='#e1f0e9')
for x,color in [(152,'#8edbc7'),(344,'#f2d9a6')]:
    draw.ellipse(((x-31)*scale,113*scale,(x+31)*scale,175*scale),fill=color)
image=image.resize((1024,1024),Image.Resampling.LANCZOS)
image.save(assets/'app.icns')
image.resize((512,512),Image.Resampling.LANCZOS).save(assets/'app-icon.png')
image.save(assets/'app.ico',sizes=[(s,s) for s in [16,20,24,32,40,48,64,128,256]])
print('Generated SVG, PNG, multi-size ICO and ICNS')
