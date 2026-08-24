from PIL import Image, ImageDraw, ImageFont
for size in (192, 512):
    im = Image.new("RGB", (size, size), (60, 132, 96))
    d = ImageDraw.Draw(im)
    f = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", int(size * 0.42))
    d.text((size // 2, size // 2 - size // 20), "fk", font=f, anchor="mm", fill=(242, 246, 241))
    d.ellipse((size * 0.30, size * 0.72, size * 0.38, size * 0.80), fill=(215, 236, 200))
    d.ellipse((size * 0.62, size * 0.72, size * 0.70, size * 0.80), fill=(215, 236, 200))
    im.save(f"icon-{size}.png", optimize=True)
print("아이콘 2종 생성")
