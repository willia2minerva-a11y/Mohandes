// الذكاء الاصطناعي: تدوير مفاتيح Gemini، المعلم، وقراءة نص الصور.
const fs=require('fs'),path=require('path'),S=require('./store');
// تنظيف القيم: يزيل المسافات والرموز الخفية (RLM/ZWSP...) والاقتباس، ويقبل الفاصلة العربية والسطر الجديد
const clean=s=>String(s||'').replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF\u00A0]/g,'').trim();
const list=s=>clean(s).split(/[,\n;،]+/).map(x=>clean(x).replace(/^["'`]+|["'`]+$/g,'')).filter(Boolean);
const KEYS=list(process.env.GEMINI_API_KEYS||process.env.GEMINI_API_KEY).map(k=>k.replace(/[^\w-]/g,'')).filter(Boolean);
const MODELS=list(process.env.GEMINI_MODELS||process.env.GEMINI_MODEL||'gemini-flash-latest').map(m=>m.replace(/^models\//,'').replace(/[^\w.\-]/g,'')).filter(Boolean);
const BASE=process.env.GEMINI_BASE||'https://generativelanguage.googleapis.com';
let rr=0,preferred=null,lastModel='',lastError='',auto={t:0,list:[]};const bad=new Map();
console.log('نماذج Gemini:',MODELS.join(' , '));
const H=k=>({'Content-Type':'application/json','x-goog-api-key':k});
// يكتشف أحدث نماذج flash المتاحة لمفاتيحك (يُستعمل تلقائيًا إن لم يوجد النموذج المضبوط)
async function listModels(k){const r=await fetch(`${BASE}/v1beta/models?pageSize=200`,{headers:H(k),signal:AbortSignal.timeout(20000)}),j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(r.status+' '+(j.error?.message||''));return(j.models||[]).filter(m=>(m.supportedGenerationMethods||[]).includes('generateContent')).map(m=>m.name.replace(/^models\//,''))}
const ver=n=>parseFloat((n.match(/^gemini-([\d.]+)/)||[])[1])||0;
async function discover(){if(Date.now()-auto.t<3600e3&&auto.list.length)return auto.list;
 for(const k of KEYS){try{const f=(await listModels(k)).filter(n=>/^gemini-[\d.]+-flash(-lite)?$/.test(n)).sort((a,b)=>ver(b)-ver(a)||(/lite/.test(a)?1:0)-(/lite/.test(b)?1:0));if(f.length){auto={t:Date.now(),list:f.slice(0,3)};return auto.list}}catch{}}return[]}
async function attempt(models,body){let last='لا توجد مفاتيح: اضبط GEMINI_API_KEYS',modelOnly=models.length>0&&KEYS.length>0;
 for(const model of models){let ks=KEYS.filter(k=>(bad.get(k)||0)<=Date.now());if(!ks.length)ks=KEYS;
  for(let i=0;i<ks.length;i++){const k=ks[(rr+i)%ks.length];
   try{const r=await fetch(`${BASE}/v1beta/models/${model}:generateContent`,{method:'POST',headers:H(k),body:JSON.stringify(body),signal:AbortSignal.timeout(120000)}),j=await r.json().catch(()=>({}));
    if(r.ok){const t=(j.candidates?.[0]?.content?.parts||[]).map(p=>p.text||'').join('');if(t){rr=(rr+i+1)%ks.length;lastModel=model;lastError='';return t}last=`[${model}] رد فارغ`;modelOnly=false;continue}
    const m=j.error?.message||'';last=`[${model}] ${r.status} ${m}`.replace(/\s+/g,' ').slice(0,260);
    if(r.status===404||(r.status===400&&/model/i.test(m))){console.log('نموذج غير صالح:',last);break}
    modelOnly=false;bad.set(k,Date.now()+(r.status===429?60e3:(r.status===401||r.status===403||(r.status===400&&/api key/i.test(m)))?3600e3:10e3));console.log('مفتاح تعطّل #'+(KEYS.indexOf(k)+1),last)}
   catch(e){last=`[${model}] ${e.message}`;modelOnly=false;bad.set(k,Date.now()+10e3)}}}
 const e=new Error(last);e.modelOnly=modelOnly;throw e}
async function gemini(body){
 try{return await attempt([...(preferred?[preferred]:[]),...MODELS.filter(m=>m!==preferred)],body)}
 catch(e){lastError=e.message;if(!e.modelOnly||process.env.AUTO_MODELS==='0')throw e;
  const d=(await discover()).filter(x=>!MODELS.includes(x));if(!d.length)throw e;console.log('جرّب نماذج متاحة تلقائيًا:',d.join(' , '));
  try{const t=await attempt(d,body);preferred=lastModel;return t}catch(e2){lastError=e2.message;throw e2}}}
// فحص يدوي من لوحة الأدمن: يعرض لكل مفتاح حالته والنماذج المتاحة له
async function check(){const out=[];for(let i=0;i<KEYS.length;i++){const k=KEYS[i],o={n:i+1,models:[],test:''};
  try{const all=await listModels(k);o.models=all.filter(n=>/^gemini-[\d.]+-(flash|pro)(-lite)?(-preview)?$/.test(n)).sort((a,b)=>ver(b)-ver(a)).slice(0,8);o.list='ok'}catch(e){o.list=e.message.slice(0,160)}
  for(const m of MODELS.slice(0,2)){try{const r=await fetch(`${BASE}/v1beta/models/${m}:generateContent`,{method:'POST',headers:H(k),body:JSON.stringify({contents:[{parts:[{text:'قل: تم'}]}]}),signal:AbortSignal.timeout(30000)}),j=await r.json().catch(()=>({}));o.test+=`${m}: ${r.ok?'يعمل ✓':r.status+' '+(j.error?.message||'').replace(/\s+/g,' ').slice(0,140)}\n`}catch(e){o.test+=`${m}: ${e.message}\n`}}
  out.push(o)}return{models:MODELS,preferred,auto:auto.list,keys:out}}
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
module.exports={chat,ocr,ocrMissing,check,busy:()=>({now:[...busy],bulk}),keys:KEYS.length,info:()=>({keys:KEYS.length,models:MODELS,model:lastModel,lastErr:lastError})};
