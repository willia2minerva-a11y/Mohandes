// خادم بلا اعتماديات (Node 18+): الموقع + المعلم + لوحة الأدمن.
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const S=require('./store'),AI=require('./ai'),ROOT=__dirname,PORT=process.env.PORT||3000;
const LIMIT=+process.env.CHAT_LIMIT_PER_HOUR||40,CAP=+process.env.CHAT_DAILY_CAP||1500,PASS=process.env.ADMIN_PASSWORD||'';
const SECRET=crypto.createHash('sha256').update('md|'+(process.env.ADMIN_SECRET||PASS)).digest(),sig=e=>crypto.createHmac('sha256',SECRET).update(String(e)).digest('hex');
const token=()=>{const e=Date.now()+12*3600e3;return e+'.'+sig(e)};
const valid=t=>{const[e,s]=String(t||'').split('.');if(!e||!s||+e<Date.now())return false;const a=Buffer.from(sig(e)),b=Buffer.from(s);return a.length===b.length&&crypto.timingSafeEqual(a,b)};
const isAdmin=req=>!!PASS&&valid(((req.headers.cookie||'').split(/;\s*/).find(c=>c.startsWith('adm='))||'').slice(4));
const send=(res,s,o,h={})=>{res.writeHead(s,{'Content-Type':'application/json; charset=utf-8',...h});res.end(JSON.stringify(o))};
async function body(req,max=40000){let raw='';for await(const c of req){raw+=c;if(raw.length>max)throw new Error('big')}return raw?JSON.parse(raw):{}}
const ipOf=req=>(req.headers['x-forwarded-for']||req.socket.remoteAddress||'').split(',')[0].trim();
const rate=(m,k,lim,ms)=>{const n=Date.now(),a=(m.get(k)||[]).filter(t=>n-t<ms);a.push(n);m.set(k,a);return a.length>lim};
const hits=new Map(),tries=new Map();let day='',used=0;
async function chat(req,res){let q;try{q=await body(req)}catch{return send(res,400,{answer:'طلب غير صالح أو طويل جدًا.'})}
 const d=new Date().toISOString().slice(0,10);if(d!==day){day=d;used=0}
 if(used>=CAP)return send(res,429,{answer:'بلغ المعلم حدّه اليومي. جرّب غدًا.'});
 if(rate(hits,ipOf(req),LIMIT,3600e3))return send(res,429,{answer:'وصلت للحد الأقصى من الأسئلة في هذه الساعة، حاول لاحقًا.'});
 try{const a=await AI.chat(String(q.subject||''),q.question,q.history,q.level);if(a===null)return send(res,404,{answer:'مادة غير معروفة.'});used++;send(res,200,{answer:a})}
 catch(e){console.log('فشل الطلب:',e.message);send(res,502,{answer:'تعذّر الاتصال بالمعلم الآن (كل المفاتيح مشغولة أو معطّلة). حاول بعد دقيقة.'})}}
// ---------- لوحة الأدمن ----------
let chain=Promise.resolve();const lock=fn=>{const r=chain.then(fn);chain=r.catch(()=>{});return r};
const okSub=s=>S.subjects().some(x=>x.slug===s),okFile=f=>typeof f==='string'&&f&&path.basename(f)===f&&f[0]!=='.',KIND=k=>k==='images'||k==='texts';
const id=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,5),props=b=>({title:String(b.title||'').slice(0,120),cat:String(b.cat||''),chapter:String(b.chapter||'').slice(0,80)});
function need(b,{file,kind}={}){if(!okSub(b.subject))throw new Error('مادة غير موجودة');if(kind&&!KIND(b.kind))throw new Error('نوع غير صالح');if(file&&(!okFile(b.file)||!fs.existsSync(path.join(ROOT,'content',b.subject,b.kind,b.file))))throw new Error('ملف غير موجود')}
const A={
 manifest:()=>({...S.manifest(true),storage:S.status(),ocr:AI.busy(),ai:AI.keys>0}),
 'upload-image':b=>{need(b);if(!b.data||b.data.length>14e6)throw new Error('الصورة كبيرة');const f=`p_${id()}.jpg`;S.put(`content/${b.subject}/images/${f}`,Buffer.from(b.data,'base64'));if(b.thumb)S.put(`content/${b.subject}/thumbs/${f}`,Buffer.from(b.thumb,'base64'));S.addItem(b.subject,'images',f,props(b));AI.ocr(b.subject,f);return{file:f}},
 'upload-text':b=>{need(b);const pdf=!!b.pdf,f=`t_${id()}.${pdf?'pdf':'txt'}`;S.put(`content/${b.subject}/texts/${f}`,pdf?Buffer.from(b.data||'','base64'):String(b.content||''));S.addItem(b.subject,'texts',f,props(b));return{file:f}},
 'save-text':b=>{need(b,{file:1,kind:1});if(!/\.(txt|md)$/i.test(b.file))throw new Error('لا يمكن تعديل هذا النوع');S.put(`content/${b.subject}/texts/${b.file}`,String(b.content||''));return{}},
 'update-item':b=>{need(b,{file:1,kind:1});S.setItem(b.subject,b.kind,b.file,{...props(b),hidden:!!b.hidden});return{}},
 'delete-item':b=>{need(b,{file:1,kind:1});S.removeItem(b.subject,b.kind,b.file);return{}},
 'move-item':b=>{need(b,{file:1,kind:1});S.moveItem(b.subject,b.kind,b.file,b.dir<0?-1:1);return{}},
 'ocr-save':b=>{need(b,{file:1,kind:'images'});S.put(`content/${b.subject}/ocr/${b.file.replace(/\.[^.]+$/,'')}.txt`,String(b.text||''));return{}},
 'ocr-run':b=>{need(b,{file:1,kind:'images'});AI.ocr(b.subject,b.file);return{}},
 'ocr-missing':async()=>({count:await AI.ocrMissing()||0}),
 'subject-save':b=>{const a=S.subjects(),name=String(b.name||'').trim().slice(0,60);if(!name)throw new Error('الاسم مطلوب');const s=a.find(x=>x.slug===b.slug);if(s)s.name=name;else a.push({slug:'s'+id(),name});S.saveSubjects(a);return{}},
 'subject-delete':b=>{need(b);S.saveSubjects(S.subjects().filter(x=>x.slug!==b.subject));S.delTree('content/'+b.subject);return{}},
 'subject-move':b=>{need(b);const a=S.subjects(),i=a.findIndex(x=>x.slug===b.subject),j=i+(b.dir<0?-1:1);if(j>=0&&j<a.length){[a[i],a[j]]=[a[j],a[i]];S.saveSubjects(a)}return{}},
 'settings-save':b=>{const seen=new Set(),cats=(Array.isArray(b.categories)?b.categories:[]).map(c=>({id:String(c.id||'c'+id()).replace(/[^\w-]/g,'').slice(0,30)||'c'+id(),name:String(c.name||'').trim().slice(0,30)})).filter(c=>c.name&&!seen.has(c.id)&&seen.add(c.id));S.saveSettings({...S.settings(),categories:cats});return{}},
 flush:async()=>{await S.flushNow();return S.status()}};
async function admin(req,res,p){
 if(p==='login'){if(rate(tries,ipOf(req),6,600e3))return send(res,429,{error:'محاولات كثيرة، انتظر 10 دقائق.'});let b;try{b=await body(req)}catch{return send(res,400,{})}
  const a=crypto.createHash('sha256').update(String(b.password||'')).digest(),c=crypto.createHash('sha256').update(PASS).digest();
  if(!PASS||!crypto.timingSafeEqual(a,c))return send(res,401,{error:PASS?'كلمة السر غير صحيحة.':'لم تُضبط ADMIN_PASSWORD في Render.'});
  return send(res,200,{ok:1},{'Set-Cookie':`adm=${token()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${req.headers['x-forwarded-proto']==='https'?'; Secure':''}`})}
 if(p==='logout')return send(res,200,{ok:1},{'Set-Cookie':'adm=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'});
 if(!isAdmin(req))return send(res,401,{error:'يلزم تسجيل الدخول.'});if(req.method==='POST'&&req.headers['x-admin']!=='1')return send(res,403,{error:'طلب مرفوض.'});
 if(!A[p])return send(res,404,{error:'غير موجود'});let b={};if(req.method==='POST'){try{b=await body(req,20e6)}catch{return send(res,413,{error:'الطلب كبير جدًا.'})}}
 try{send(res,200,await lock(()=>A[p](b)))}catch(e){send(res,400,{error:e.message})}}
const MIME={'.html':'text/html; charset=utf-8','.json':'application/json; charset=utf-8','.txt':'text/plain; charset=utf-8','.md':'text/plain; charset=utf-8','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.pdf':'application/pdf'};
const safe=p=>{const f=path.resolve(ROOT,p);return f.startsWith(path.join(ROOT,'content')+path.sep)?f:null};
http.createServer(async(req,res)=>{try{const u=decodeURIComponent(req.url.split('?')[0]);
 if(u==='/healthz')return res.end('ok');if(u==='/api/chat'&&req.method==='POST')return await chat(req,res);if(u.startsWith('/api/admin/'))return await admin(req,res,u.slice(11));
 if(u==='/manifest.json'){res.writeHead(200,{'Content-Type':MIME['.json'],'Cache-Control':'no-cache'});return res.end(JSON.stringify(S.manifest(false)))}
 const f=u==='/'||u==='/index.html'?path.join(ROOT,'index.html'):u==='/admin'||u==='/admin.html'?path.join(ROOT,'admin.html'):u.startsWith('/content/')?safe(u.slice(1)):null;
 if(!f||!fs.existsSync(f)||!fs.statSync(f).isFile()){res.writeHead(404);return res.end('404')}
 res.writeHead(200,{'Content-Type':MIME[path.extname(f).toLowerCase()]||'application/octet-stream','Cache-Control':/\.(jpe?g|png|webp|pdf)$/i.test(f)?'public, max-age=86400':'no-cache'});fs.createReadStream(f).pipe(res)}catch(e){res.writeHead(500);res.end('error')}
}).listen(PORT,()=>console.log(`جاهز على المنفذ ${PORT} · مفاتيح Gemini: ${AI.keys} · الأدمن: ${PASS?'مفعّل':'غير مفعّل (اضبط ADMIN_PASSWORD)'} · GitHub: ${S.status().github?'متصل':'غير متصل'}`));
process.on('SIGTERM',async()=>{try{await S.flushNow()}catch{}process.exit(0)});
