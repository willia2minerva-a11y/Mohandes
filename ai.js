// الذكاء الاصطناعي: تدوير مفاتيح Gemini + Bytez، تنظيف ردود و OCR.
const fs=require('fs'),path=require('path'),S=require('./store');

const clean=s=>String(s||'').replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF\u00A0]/g,'').trim();
const list=s=>clean(s).split(/[,\n;،]+/).map(x=>clean(x).replace(/^["'`]+|["'`]+$/g,'')).filter(Boolean);
const normKey=k=>String(k||'').trim().replace(/^["'`]+|["'`]+$/g,'').replace(/[^\w.\-]/g,'');

// ---------- مفاتيح Gemini ----------
const KEYS=list(process.env.GEMINI_API_KEYS||process.env.GEMINI_API_KEY).map(normKey).filter(Boolean);
const MODELS=list(process.env.GEMINI_MODELS||process.env.GEMINI_MODEL||'gemini-flash-latest').map(m=>m.replace(/^models\//,'').replace(/[^\w.\-]/g,'')).filter(Boolean);
const BASE=process.env.GEMINI_BASE||'https://generativelanguage.googleapis.com';

// ---------- مفاتيح Bytez (احتياط عند تعطل Gemini) ----------
const BYTEZ_KEYS=list(process.env.BYTEZ_API_KEYS||process.env.BYTEZ_API_KEY).map(normKey).filter(Boolean);
const BYTEZ_MODELS=list(process.env.BYTEZ_MODELS||'meta-llama/Meta-Llama-3.1-70B-Instruct,google/gemma-2-27b-it').map(x=>String(x).trim()).filter(Boolean);
const BYTEZ_BASE=process.env.BYTEZ_BASE||'https://api.bytez.com/models/v2';

let rr=0,rrB=0,preferred=null,lastModel='',lastError='',auto={t:0,list:[]};const bad=new Map(),badB=new Map();
console.log('نماذج Gemini:',MODELS.join(' , '),'· Bytez:',BYTEZ_KEYS.length?BYTEZ_MODELS.join(' , '):'لا يوجد');

const H=k=>({'Content-Type':'application/json','x-goog-api-key':k});
const HB=k=>({'Content-Type':'application/json','Authorization':k.startsWith('Bearer ')?k:'Bearer '+k});
const urlFor=(model,k,useQuery)=>`${BASE}/v1beta/models/${model}:generateContent${useQuery?`?key=${encodeURIComponent(k)}`:''}`;

async function listModels(k){const r=await fetch(`${BASE}/v1beta/models?pageSize=200`,{headers:H(k),signal:AbortSignal.timeout(20000)}),j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(r.status+' '+(j.error?.message||''));return(j.models||[]).filter(m=>(m.supportedGenerationMethods||[]).includes('generateContent')).map(m=>m.name.replace(/^models\//,''))}
const ver=n=>parseFloat((n.match(/^gemini-([\d.]+)/)||[])[1])||0;
async function discover(){if(Date.now()-auto.t<3600e3&&auto.list.length)return auto.list;
 for(const k of KEYS){try{const f=(await listModels(k)).filter(n=>/^gemini-[\d.]+-flash(-lite)?$/.test(n)).sort((a,b)=>ver(b)-ver(a)||(/lite/.test(a)?1:0)-(/lite/.test(b)?1:0));if(f.length){auto={t:Date.now(),list:f.slice(0,3)};return auto.list}}catch{}}return[]}

// ---------- محرك Gemini ----------
async function attempt(models,body){let last='لا توجد مفاتيح Gemini',modelOnly=models.length>0&&KEYS.length>0;
 for(const model of models){let ks=KEYS.filter(k=>(bad.get(k)||0)<=Date.now());if(!ks.length)ks=KEYS;
  for(let i=0;i<ks.length;i++){const k=ks[(rr+i)%ks.length];
   for(const useQuery of [false,true]){
    try{const r=await fetch(urlFor(model,k,useQuery),{method:'POST',headers:useQuery?{'Content-Type':'application/json'}:H(k),body:JSON.stringify(body),signal:AbortSignal.timeout(120000)}),j=await r.json().catch(()=>({}));
     if(r.ok){const t=(j.candidates?.[0]?.content?.parts||[]).map(p=>p.text||'').join('');if(t){rr=(rr+i+1)%ks.length;lastModel='gemini:'+model;lastError='';return t}last=`[${model}] رد فارغ`;modelOnly=false;break}
     const m=j.error?.message||'';last=`[${model}] ${r.status} ${m}`.replace(/\s+/g,' ').slice(0,260);
     if(r.status===404||(r.status===400&&/model/i.test(m))){console.log('نموذج غير صالح:',last);break}
     if(!useQuery&&/api key|auth|permission|invalid/i.test(m)){continue}
     modelOnly=false;bad.set(k,Date.now()+(r.status===429?60e3:(r.status===401||r.status===403||(r.status===400&&/api key/i.test(m)))?3600e3:10e3));console.log('مفتاح Gemini تعطّل #'+(KEYS.indexOf(k)+1),last);break}
    catch(e){last=`[${model}] ${e.message}`;modelOnly=false;if(!useQuery)continue;bad.set(k,Date.now()+10e3);break}
   }
  }}
 const e=new Error(last);e.modelOnly=modelOnly;throw e}

// ---------- محرك Bytez ----------
// Bytez API: POST https://api.bytez.com/models/v2/{model}
// Body: {messages:[{role,content}], stream:false}
// Response: {output:{content:[{text}]}} أو {output:"..."} حسب النموذج
async function bytezCall(model,k,messages,system){
 const body={messages:[...(system?[{role:'system',content:system}]:[]),...messages],stream:false,temperature:0.4,max_tokens:2048};
 const r=await fetch(`${BYTEZ_BASE}/${model}`,{method:'POST',headers:HB(k),body:JSON.stringify(body),signal:AbortSignal.timeout(120000)});
 const j=await r.json().catch(()=>({}));
 if(!r.ok)throw new Error(`${r.status} ${(j.error||j.message||'').toString().slice(0,200)}`);
 const o=j.output;
 if(typeof o==='string')return o;
 if(o?.content?.[0]?.text)return o.content[0].text;
 if(Array.isArray(o)&&o[0]?.content)return o[0].content;
 if(j.choices?.[0]?.message?.content)return j.choices[0].message.content;
 throw new Error('رد Bytez غير معروف');
}
async function bytezAttempt(messages,system){let last='لا توجد مفاتيح Bytez';
 for(const model of BYTEZ_MODELS){let ks=BYTEZ_KEYS.filter(k=>(badB.get(k)||0)<=Date.now());if(!ks.length)ks=BYTEZ_KEYS;
  for(let i=0;i<ks.length;i++){const k=ks[(rrB+i)%ks.length];
   try{const t=await bytezCall(model,k,messages,system);if(t){rrB=(rrB+i+1)%ks.length;lastModel='bytez:'+model;lastError='';return t}}
   catch(e){last=`[${model}] ${e.message}`;console.log('مفتاح Bytez تعطّل #'+(BYTEZ_KEYS.indexOf(k)+1),last);badB.set(k,Date.now()+60e3)}
  }}
 throw new Error(last)}

// ---------- محرك موحّد: Gemini أولًا ثم Bytez ----------
async function geminiOnly(body){
 try{return await attempt([...(preferred&&preferred.startsWith('gemini:')?[preferred.slice(7)]:[]),...MODELS.filter(m=>m!==preferred)],body)}
 catch(e){lastError=e.message;if(!e.modelOnly||process.env.AUTO_MODELS==='0')throw e;
  const d=(await discover()).filter(x=>!MODELS.includes(x));if(!d.length)throw e;console.log('جرّب نماذج Gemini متاحة تلقائيًا:',d.join(' , '));
  try{const t=await attempt(d,body);preferred='gemini:'+lastModel;return t}catch(e2){lastError=e2.message;throw e2}}}
async function gemini(body){
 try{return await geminiOnly(body)}
 catch(e){
  if(!BYTEZ_KEYS.length)throw e;
  // Fallback إلى Bytez: نحوّل body إلى رسائل
  const sys=(body.systemInstruction?.parts||[]).map(p=>p.text).join('\n');
  const msgs=(body.contents||[]).map(c=>({role:c.role==='model'?'assistant':'user',content:(c.parts||[]).map(p=>p.text||'').join('\n')})).filter(m=>m.content);
  try{const t=await bytezAttempt(msgs,sys);return t}catch(e2){lastError='Gemini: '+e.message+' | Bytez: '+e2.message;throw new Error(lastError)}
 }}

async function check(){const out=[];for(let i=0;i<KEYS.length;i++){const k=KEYS[i],o={n:i+1,models:[],test:'',provider:'gemini'};
  try{const all=await listModels(k);o.models=all.filter(n=>/^gemini-[\d.]+-(flash|pro)(-lite)?(-preview)?$/.test(n)).sort((a,b)=>ver(b)-ver(a)).slice(0,8);o.list='ok'}catch(e){o.list=e.message.slice(0,160)}
  for(const m of MODELS.slice(0,2)){try{const r=await fetch(urlFor(m,k,false),{method:'POST',headers:H(k),body:JSON.stringify({contents:[{parts:[{text:'قل: تم'}]}]}),signal:AbortSignal.timeout(30000)}),j=await r.json().catch(()=>({}));o.test+=`${m}: ${r.ok?'يعمل ✓':r.status+' '+(j.error?.message||'').replace(/\s+/g,' ').slice(0,140)}\n`}catch(e){o.test+=`${m}: ${e.message}\n`}}
  out.push(o)}
 for(let i=0;i<BYTEZ_KEYS.length;i++){const k=BYTEZ_KEYS[i],o={n:i+1,models:BYTEZ_MODELS,test:'',provider:'bytez'};let ok=false;
  for(const m of BYTEZ_MODELS.slice(0,2)){try{const t=await bytezCall(m,k,[{role:'user',content:'قل: تم'}],null);o.test+=`${m}: ${t?'يعمل ✓':'رد فارغ'}\n`;ok=true}catch(e){o.test+=`${m}: ${e.message}\n`}}
  o.list=ok?'ok':'فشل';out.push(o)}
 return{models:MODELS,preferred,auto:auto.list,keys:out,bytez:{keys:BYTEZ_KEYS.length,models:BYTEZ_MODELS}}}

// ---------- تعليمات صارمة للمعلم ----------
const SYS=`أنت معلم صبور لطلبة السنة الأولى هندسة مدنية (الجزائر)، تشرح بعربية فصحى مبسطة.

قواعد إلزامية للتنسيق:
- لا تستعمل أبدًا النجوم ** أو # أو ## أو --- أو الرموز التعبيرية.
- اكتب العناوين كسطر عادي ينتهي بنقطتين، مثل: "الفكرة ببساطة:"
- اكتب القوائم بأرقام عربية "١." أو بشرطة "-" في بداية السطر فقط.
- لا تكرر السطر الفارغ أكثر من مرة واحدة.
- اكتب المعادلات بنص بسيط: x²، √، ∑، بدون LaTeX وبدون أقواس زائدة.
- لا تفتح الجواب بعبارات مجاملة؛ ابدأ بالمعلومة مباشرة.

هيكل الجواب (اختصر إن كان السؤال بسيطًا):
الفكرة ببساطة: جملتان بكلمات سهلة.
الشرح خطوة بخطوة: خطوات مرقمة قصيرة، واشرح كل مصطلح عند أول ذكره، وأظهر الحساب بأرقامه.
مثال محلول: مثال رقمي أو عملي من دروس الطالب مع تشبيه من الحياة اليومية.
انتبه: الخطأ الشائع هنا.
اختبر نفسك: سؤال قصير دون إجابته.

المصادر: [صورة N] مصدر أصلي، و[درس N] مصدر ثانوي. عند التعارض اعتمد الصورة ونبّه على الاختلاف.
الإحالات: عند الاستدلال بفكرة من صورة اكتب [صورة 3] بعد الجملة مباشرة، وبدرس نصي [درس 2]. لا تخترع رقمًا غير موجود.
إن لم تجد المعلومة في المصادر قل: "لا أجد هذا في دروسك" ثم اكتب "إضافة توضيحية:" قبل الشرح العام.`;

const LV={simple:'\nالمستوى الآن: مبسّط جدًا. افترض أن الطالب لم يفهم شيئًا، وأطل في الخطوات الصغيرة، واستعمل تشبيهات وأمثلة رقمية صغيرة.',normal:'\nالمستوى الآن: عادي. اشرح بوضوح مع اختصار الخطوات البديهية.'};

function cleanAnswer(t){
  return String(t||'')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu,'')
    .replace(/^\s*#{1,6}\s*/gm,'')
    .replace(/\*\*(.+?)\*\*/g,'$1')
    .replace(/__(.+?)__/g,'$1')
    .replace(/^\s*[-*]\s+/gm,'- ')
    .replace(/^\s*-{3,}\s*$/gm,'')
    .replace(/\n{3,}/g,'\n\n')
    .replace(/[ \t]+$/gm,'')
    .replace(/`{1,3}([^`]+)`{1,3}/g,'$1')
    .trim();
}

const cache={};
function ctx(slug){const v=S.version(),c=cache[slug];if(c&&c.v===v&&Date.now()-c.t<60e3)return c;
 const m=S.manifest(false),s=m.subjects.find(x=>x.slug===slug);if(!s)return null;const cn=id=>m.categories.find(x=>x.id===id)?.name,lab=x=>[cn(x.cat),x.chapter].filter(Boolean).map(t=>' | '+t).join('');let text='',pdfs=[],size=0;
 s.images.forEach((i,k)=>{const f=i.ocr&&path.join(S.ROOT,i.ocr);if(f&&fs.existsSync(f))text+=`\n--- [صورة ${k+1}${lab(i)}]${i.title?' '+i.title:''} ---\n`+fs.readFileSync(f,'utf8')});
 s.texts.forEach((x,k)=>{const f=path.join(S.ROOT,x.file);if(!fs.existsSync(f))return;if(x.pdf){const b=fs.readFileSync(f);if(size+b.length<8e6){size+=b.length;pdfs.push(b.toString('base64'))}}else text+=`\n--- [درس ${k+1}: ${x.title}${lab(x)}] ---\n`+fs.readFileSync(f,'utf8')});
 return cache[slug]={v,t:Date.now(),text,pdfs}}

async function chat(slug,q,history,level){const c=ctx(slug);if(!c)return null;
 const hist=(Array.isArray(history)?history:[]).slice(-8).map(m=>({role:m.role==='user'?'user':'model',parts:[{text:String(m.text).slice(0,5000)}]})),first=c.pdfs.map(d=>({inlineData:{mimeType:'application/pdf',data:d}}));
 const contents=[...hist,{role:'user',parts:[...(hist.length?[]:first),{text:String(q||'').slice(0,4000)}]}];if(hist.length&&first.length)contents.unshift({role:'user',parts:[...first,{text:'ملفات PDF للمادة (مصدر ثانوي).'}]},{role:'model',parts:[{text:'تم الاطلاع.'}]});
 const raw=await gemini({systemInstruction:{parts:[{text:SYS+(LV[level]||LV.simple)+'\n\n=== مصادر المادة ===\n'+c.text.slice(0,600000)}]},contents});
 return cleanAnswer(raw);
}

// ---------- OCR: تعليمات + تنظيف مخرجات ----------
const OCRP='انسخ كل ما في الصورة بنفس لغة الكاتب وبنفس الترتيب: النصوص، المعادلات، الجداول، والرسوم موصوفة بإيجاز بين قوسين مثل (شكل: مثلث قائم). اكتب المعادلات بصيغة نصية واضحة (x²، √، ∑). لا تستعمل LaTeX ولا رموز تنسيق مثل ** أو # أو ---. ضع [غير واضح] عند الشك، ولا تخمّن. لا تضف شرحًا.';
function cleanOcr(t){
  return String(t||'')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g,'')
    .replace(/\\[a-zA-Z]+/g,'')  // بقايا LaTeX مثل \frac
    .replace(/\${1,2}([^$]+)\${1,2}/g,'$1')
    .replace(/\*\*(.+?)\*\*/g,'$1')
    .replace(/^\s*#{1,6}\s*/gm,'')
    .replace(/^\s*-{3,}\s*$/gm,'')
    .replace(/\n{3,}/g,'\n\n')
    .replace(/[ \t]+$/gm,'')
    .trim();
}
const busy=new Set();let bulk={total:0,done:0};
async function ocr(slug,file){const key=slug+'/'+file;if(busy.has(key))return;busy.add(key);
 try{const f=path.join(S.ROOT,'content',slug,'images',file),mime=/\.png$/i.test(f)?'image/png':/\.webp$/i.test(f)?'image/webp':'image/jpeg';
  const b64=fs.readFileSync(f).toString('base64');
  let t;
  if(KEYS.length){t=await geminiOnly({contents:[{parts:[{text:OCRP},{inline_data:{mime_type:mime,data:b64}}]}]})}
  else if(BYTEZ_KEYS.length){
    // Bytez يدعم نماذج رؤية عبر رسائل multimodal
    const model=BYTEZ_MODELS[0];
    const r=await fetch(`${BYTEZ_BASE}/${model}`,{method:'POST',headers:HB(BYTEZ_KEYS[0]),body:JSON.stringify({messages:[{role:'user',content:[{type:'text',text:OCRP},{type:'image_url',image_url:{url:`data:${mime};base64,${b64}`}}]}],stream:false}),signal:AbortSignal.timeout(120000)});
    const j=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error('Bytez OCR: '+(j.error||j.message||r.status));
    t=typeof j.output==='string'?j.output:(j.output?.content?.[0]?.text||j.output?.[0]?.content||'');
  } else throw new Error('لا توجد مفاتيح لقراءة الصورة');
  S.put(`content/${slug}/ocr/${file.replace(/\.[^.]+$/,'')}.txt`,cleanOcr(t));
 }catch(e){console.log('فشلت قراءة الصورة',key,e.message)}finally{busy.delete(key)}}
async function ocrMissing(){if(bulk.done<bulk.total)return;const todo=S.manifest(true).subjects.flatMap(s=>s.images.filter(i=>!i.ocr).map(i=>[s.slug,i.file]));bulk={total:todo.length,done:0};
 (async()=>{for(const[s,f]of todo){await ocr(s,f);bulk.done++}})();return todo.length}
module.exports={chat,ocr,ocrMissing,check,busy:()=>({now:[...busy],bulk}),keys:KEYS.length+BYTEZ_KEYS.length,info:()=>({keys:KEYS.length,bytezKeys:BYTEZ_KEYS.length,models:MODELS,model:lastModel,lastErr:lastError})};
