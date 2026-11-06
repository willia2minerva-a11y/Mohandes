# اختياري: يولّد صورًا مصغّرة (700px) لأي صورة في content/*/images لا مصغّرة لها. لا حاجة له إن رفعت الصور من لوحة الأدمن.
# الاستعمال: pip install pillow  ثم  python build.py
import os
from PIL import Image,ImageOps
n=0
for s in os.listdir('content'):
    d=f'content/{s}/images'
    if not os.path.isdir(d): continue
    os.makedirs(f'content/{s}/thumbs',exist_ok=True)
    for f in os.listdir(d):
        t=f'content/{s}/thumbs/{f}'
        if f.lower().endswith(('.jpg','.jpeg','.png','.webp')) and not os.path.exists(t):
            im=ImageOps.exif_transpose(Image.open(f'{d}/{f}')).convert('RGB'); im.thumbnail((700,700)); im.save(t,quality=80); n+=1
print('مصغّرات جديدة:',n)
