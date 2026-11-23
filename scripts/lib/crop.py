import sys
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
x, y, w, h = (int(v) for v in sys.argv[3:7])
tw, th = (int(v) for v in sys.argv[7:9])

image = Image.open(src).convert('RGB')
image = image.crop((x, y, x + w, y + h)).resize((tw, th), Image.LANCZOS)
image.save(dst, format='JPEG', quality=92)
