# اختياري (لوحة الأدمن تفعل هذا تلقائيًا): يقرأ كل صورة جديدة بـ Gemini مرة واحدة ويحفظ نصها في content/<مادة>/ocr/ . الاستعمال:
#   GEMINI_API_KEYS=مفتاح1,مفتاح2 python ocr.py     ثم:  python build.py
# عند تعطل مفتاح ينتقل تلقائيًا للتالي، ويتخطى الصور المقروءة سابقًا.
import os,json,base64,urllib.request,urllib.error,time
KEYS=[k.strip() for k in (os.environ.get('GEMINI_API_KEYS') or os.environ.get('GEMINI_API_KEY','')).split(',') if k.strip()]
MODELS=[m.strip() for m in (os.environ.get('GEMINI_MODELS') or os.environ.get('GEMINI_MODEL','gemini-2.5-flash')).split(',') if m.strip()]
BASE=os.environ.get('GEMINI_BASE','https://generativelanguage.googleapis.com'); dead=set()
P="انسخ كل ما في الصورة حرفيًا (نص، معادلات، جداول، ورسومات موصوفة بإيجاز) بنفس لغة الكاتب وبنفس الترتيب. اكتب المعادلات بصيغة واضحة. ضع [غير واضح] عند الشك ولا تخمّن. لا تضف شرحًا."
def call(body):
    last='لا توجد مفاتيح: اضبط GEMINI_API_KEYS'
    for m in MODELS:
        for k in [k for k in KEYS if k not in dead] or KEYS:
            try:
                r=urllib.request.Request(f'{BASE}/v1beta/models/{m}:generateContent',json.dumps(body).encode(),{'Content-Type':'application/json','x-goog-api-key':k})
                return json.load(urllib.request.urlopen(r,timeout=120))['candidates'][0]['content']['parts'][0]['text']
            except urllib.error.HTTPError as e:
                last=f'{e.code} {e.read()[:150]}'
                if e.code in (401,403,429): dead.add(k)
                print('مفتاح تعطل → التالي:','#'+str(KEYS.index(k)+1),e.code); time.sleep(1)
            except Exception as e: last=str(e)
    raise RuntimeError(last)
for s in sorted(os.listdir('content')):
    d=f'content/{s}/images'
    if not os.path.isdir(d): continue
    os.makedirs(f'content/{s}/ocr',exist_ok=True)
    for f in sorted(os.listdir(d)):
        o=f'content/{s}/ocr/{os.path.splitext(f)[0]}.txt'
        if os.path.exists(o) or not f.lower().endswith(('.jpg','.jpeg','.png','.webp')): continue
        mime='image/png' if f.lower().endswith('.png') else 'image/webp' if f.lower().endswith('.webp') else 'image/jpeg'
        b=base64.b64encode(open(f'{d}/{f}','rb').read()).decode()
        t=call({'contents':[{'parts':[{'text':P},{'inline_data':{'mime_type':mime,'data':b}}]}]})
        open(o,'w',encoding='utf-8').write(t); print('تم',s,f)
