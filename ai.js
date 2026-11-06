// الذكاء الاصطناعي: تدوير مفاتيح Gemini، المعلم، وقراءة نص الصور.
const fs=require('fs'),path=require('path'),S=require('./store');
const list=s=>(s||'').split(',').map(x=>x.trim()).filter(Boolean);
const KEYS=list(process.env.GEMINI_API_KEYS||process.env.GEMINI_API_KEY),MODELS=list(process.env.GEMINI_MODELS||process.env.GEMINI_MODEL||'gemini-2.5-flash'),BASE=process.env.GEMINI_BASE||'https://generativelanguage.googleapis.com';
let rr=0;const bad=new Map();
async function gemini(body){let last='لا توجد مفاتيح: اضبط GEMINI_API_KEYS';
 for(const model of MODELS){let ks=KEYS.filter(k=>(bad.get(k)||0)<=Date.now());if(!ks.length)ks=KEYS;
  for(let i=0;i<ks.length;i++){const k=ks[(rr+i)%ks.length];
   try{const r=await fetch(`${BASE}/v1beta/models/${model}:generateContent`,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':k},body:JSON.stringify(body),signal:AbortSignal.timeout(120000)});const j=await r.json().catch(()=>({}));
    if(r.ok){const t=(j.candidates?.[0]?.content?.parts||[]).map(p=>p.text||'').join('');if(t){rr=(rr+i+1)%ks.length;return t}last='رد فارغ';continue}
    const m=j.error?.message||'';last=`${r.status} ${m}`.slice(0,200);bad.set(k,Date.now()+(r.status==429?60e3:(r.status==401||r.status==403||(r.status==400&&/api key/i.test(m)))?3600e3:10e3));console.log('مفتاح تعطّل #'+(KEYS.indexOf(k)+1),last)}
   catch(e){last=e.message;bad.set(k,Date.now()+10e3)}}}
 throw new Error(last)}
const SYS=`أنت معلم صبور ومتحمّس لطلبة السنة الأولى هندسة مدنية (الجزائر)، وهدفك أن يفهم حتى أضعف طالب في القسم.
أسلوب الجواب (اختصر الأقسام إن كان السؤال بسيطًا جدًا):
**الفكرة ببساطة**: جملتان بكلمات سهلة بلا مصطلح غير مشروح.
**الشرح خطوة بخطوة**: خطوات مرقمة قصيرة، واشرح كل مصطلح عند أول ذكره، وأظهر كل عملية حسابية بأرقامها دون قفز.
**مثال محلول**: مثال رقمي أو عملي، يفضّل أن يكون من دروس الطالب، مع تشبيه من الحياة اليومية إن ساعد.
**انتبه**: الخطأ الشائع الذي يقع فيه الطلبة هنا.
**اختبر نفسك**: سؤال قصير للتحقق دون إجابته.
اكتب بعربية فصحى مبسطة، والمصطلحات الفرنسية أو الإنجليزية بين قوسين كما وردت في الدروس. اجعل الجواب مفصّلًا ومرتبًا بعناوين قصيرة بلا حشو.
المصادر: كل قسم يبدأ بعنوان بين شرطات: [صورة N] نص مستخرج من صورة (دفتر الطالب أو سبورته أو شرائحه) وهي المصدر الأصلي، و[درس N] ملف نصي ثانوي للاستكمال. وقد يظهر بعد الرقم اسم التصنيف (COURS أو TD أو TP) والفصل. عند التعارض اعتمد الصورة ونبّه الطالب على الاختلاف.
الإحالات: عند استدلالك بمثال أو تمرين أو شرح من صورة اكتب رمزها بالضبط بين قوسين مربعين بعد الجملة التي تستند إليها، هكذا: [صورة 3]، وعند الاستدلال بدرس نصي اكتب [درس 2]. استعمل فقط الأرقام الموجودة في المصادر ولا تخترع رقمًا.
اعتمد على المصادر في محتوى الدروس؛ وإن لم تجد المعلومة فيها قل «لا أجد هذا في دروسك» ثم قدّم شرحًا عامًا مميّزًا بعبارة «إضافة توضيحية». نبّه على أي خطأ مطبعي أو حسابي تلاحظه في المصادر. اكتب المعادلات بنص بسيط (x², √, ∑) دون LaTeX.`;
const LV={simple:'\nالمستوى المطلوب الآن: مبسّط جدًا. افترض أن الطالب لم يفهم شيئًا من الدرس، وأطل في الخطوات الصغيرة، واستعمل تشبيهات وأمثلة رقمية صغيرة، ولا تقفز على أي خطوة.',normal:'\nالمستوى المطلوب الآن: عادي. اشرح بوضوح مع اختصار الخطوات البديهية.'};
const cache={};
function ctx(slug){const v=S.version(),c=cache[slug];if(c&&c.v===v&&Date.now()-c.t<60e3)return c;
 const m=S.manifest(false),s=m.subjects.find(x=>x.slug===slug);if(!s)return null;const cn=id=>m.categories.find(x=>x.id===id)?.name,lab=x=>[cn(x.cat),x.chapter].filter(Boolean).map(t=>' | '+t).join('');let text='',pdfs=[],size=0;
 s.images.forEach((i,k)=>{const f=i.ocr&&path.join(S.ROOT,i.ocr);if(f&&fs.existsSync(f))text+=`\n--- [صورة ${k+1}${lab(i)}]${i.title?' '+i.title:''} ---\n`+fs.readFileSync(f,'utf8')});
 s.texts.forEach((x,k)=>{const f=path.join(S.ROOT,x.file);if(!fs.existsSync(f))return;if(x.pdf){const b=fs.readFileSync(f);if(size+b.length<8e6){size+=b.length;pdfs.push(b.toString('base64'))}}else text+=`\n--- [درس ${k+1}: ${x.title}${lab(x)}] ---\n`+fs.readFileSync(f,'utf8')});
 return cache[slug]={v,t:Date.now(),text,pdfs}}
async function chat(slug,q,history,level){const c=ctx(slug);if(!c)return null;
 const hist=(Array.isArray(history)?history:[]).slice(-8).map(m=>({role:m.role==='user'?'user':'model',parts:[{text:String(m.text).slice(0,5000)}]})),first=c.pdfs.map(d=>({inlineData:{mimeType:'application/pdf',data:d}}));
 const contents=[...hist,{role:'user',parts:[...(hist.length?[]:first),{text:String(q||'').slice(0,4000)}]}];if(hist.length&&first.length)contents.unshift({role:'user',parts:[...first,{text:'ملفات PDF للمادة (مصدر ثانوي).'}]},{role:'model',parts:[{text:'تم الاطلاع.'}]});
 return gemini({systemInstruction:{parts:[{text:SYS+(LV[level]||LV.simple)+'\n\n=== مصادر المادة ===\n'+c.text.slice(0,600000)}]},contents})}
// ---------- قراءة نص الصور ----------
const OCRP='انسخ كل ما في الصورة حرفيًا (نص، معادلات، جداول، ورسومات موصوفة بإيجاز) بنفس لغة الكاتب وبنفس الترتيب. اكتب المعادلات بصيغة واضحة. ضع [غير واضح] عند الشك ولا تخمّن. لا تضف شرحًا.';
const busy=new Set();let bulk={total:0,done:0};
async function ocr(slug,file){const key=slug+'/'+file;if(busy.has(key))return;busy.add(key);
 try{const f=path.join(S.ROOT,'content',slug,'images',file),mime=/\.png$/i.test(f)?'image/png':/\.webp$/i.test(f)?'image/webp':'image/jpeg';
  const t=await gemini({contents:[{parts:[{text:OCRP},{inline_data:{mime_type:mime,data:fs.readFileSync(f).toString('base64')}}]}]});S.put(`content/${slug}/ocr/${file.replace(/\.[^.]+$/,'')}.txt`,t)}
 catch(e){console.log('فشلت قراءة الصورة',key,e.message)}finally{busy.delete(key)}}
async function ocrMissing(){if(bulk.done<bulk.total)return;const todo=S.manifest(true).subjects.flatMap(s=>s.images.filter(i=>!i.ocr).map(i=>[s.slug,i.file]));bulk={total:todo.length,done:0};
 (async()=>{for(const[s,f]of todo){await ocr(s,f);bulk.done++}})();return todo.length}
module.exports={chat,ocr,ocrMissing,busy:()=>({now:[...busy],bulk}),keys:KEYS.length};
