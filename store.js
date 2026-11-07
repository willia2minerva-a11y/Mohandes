// طبقة البيانات: المواد والملفات والتصنيفات + حفظ التعديلات في GitHub على دفعات.
const fs=require('fs'),path=require('path');
const ROOT=__dirname,rd=(f,d)=>{try{return JSON.parse(fs.readFileSync(path.join(ROOT,f),'utf8'))}catch{return d}};
const ls=d=>{try{return fs.readdirSync(d)}catch{return[]}},IMG=/\.(jpe?g|png|webp)$/i,TXT=/\.(txt|md|pdf)$/i;
let ver=0;
// ---------- GitHub ----------
const GH={tok:process.env.GITHUB_TOKEN,repo:process.env.GITHUB_REPO,br:process.env.GITHUB_BRANCH||'main',pre:(process.env.GITHUB_PREFIX||'').replace(/^\/|\/$/g,''),api:process.env.GITHUB_API||'https://api.github.com'};
const gp=r=>(GH.pre?GH.pre+'/':'')+r,pend=new Map();let timer=null,flushing=false,lastErr='',lastOk=0;
const MG={uri:process.env.MONGODB_URI,db:process.env.MONGODB_DB||'mohandis'};let mcol=null,mready=false;
const queue=(rel,buf)=>{ver++;if(MG.uri){pend.set(rel,buf);clearTimeout(timer);timer=setTimeout(flushMongo,300);return}if(!GH.tok||!GH.repo)return;pend.set(rel,buf);clearTimeout(timer);timer=setTimeout(flush,+process.env.GITHUB_DELAY_MS||20000)};
async function gh(m,u,b){const r=await fetch(`${GH.api}/repos/${GH.repo}${u}`,{method:m,headers:{Authorization:'Bearer '+GH.tok,Accept:'application/vnd.github+json','User-Agent':'mohandis-dawla','Content-Type':'application/json'},body:b&&JSON.stringify(b)});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(r.status+' '+(j.message||''));return j}
async function flush(){if(!GH.tok||!GH.repo||!pend.size||flushing)return;flushing=true;const batch=new Map(pend);pend.clear();
 try{const head=(await gh('GET',`/git/ref/heads/${GH.br}`)).object.sha,cm=await gh('GET',`/git/commits/${head}`);let have=null;
  if([...batch.values()].includes(null))have=new Set((await gh('GET',`/git/trees/${cm.tree.sha}?recursive=1`)).tree.map(x=>x.path));
  const tree=[];for(const[rel,buf]of batch){if(buf===null){if(have.has(gp(rel)))tree.push({path:gp(rel),mode:'100644',type:'blob',sha:null})}else{const b=await gh('POST','/git/blobs',{content:buf.toString('base64'),encoding:'base64'});tree.push({path:gp(rel),mode:'100644',type:'blob',sha:b.sha})}}
  if(tree.length){const t=await gh('POST','/git/trees',{base_tree:cm.tree.sha,tree}),c=await gh('POST','/git/commits',{message:`تحديث من لوحة الأدمن (${tree.length} ملف)`,tree:t.sha,parents:[head]});await gh('PATCH',`/git/refs/heads/${GH.br}`,{sha:c.sha})}
  lastOk=Date.now();lastErr=''}
 catch(e){lastErr=e.message;for(const[k,v]of batch)if(!pend.has(k))pend.set(k,v);clearTimeout(timer);timer=setTimeout(flush,60000)}finally{flushing=false}}
// ---------- MongoDB: يعكس شجرة الملفات (content/** و subjects.json و settings.json) كوثائق، وهو المصدر الدائم ----------
async function flushMongo(){if(!mready||!pend.size||flushing)return;flushing=true;const batch=new Map(pend);pend.clear();
 try{const{Binary}=require('mongodb'),ops=[];for(const[rel,buf]of batch)ops.push(buf===null?{deleteOne:{filter:{_id:rel}}}:{replaceOne:{filter:{_id:rel},replacement:{_id:rel,data:new Binary(buf),size:buf.length,t:new Date()},upsert:true}});
  for(let i=0;i<ops.length;i+=20)await mcol.bulkWrite(ops.slice(i,i+20),{ordered:false});lastOk=Date.now();lastErr=''}
 catch(e){lastErr=e.message;for(const[k,v]of batch)if(!pend.has(k))pend.set(k,v);clearTimeout(timer);timer=setTimeout(flushMongo,15000)}finally{flushing=false}}
const walk=d=>ls(path.join(ROOT,d)).flatMap(f=>{const p=d+'/'+f;return fs.statSync(path.join(ROOT,p)).isDirectory()?walk(p):[p]});
const okId=id=>typeof id==='string'&&(id==='subjects.json'||id==='settings.json'||(id.startsWith('content/')&&!id.includes('..')));
async function seed(){const{Binary}=require('mongodb'),all=['subjects.json','settings.json',...walk('content')].filter(p=>fs.existsSync(path.join(ROOT,p)));let ops=[],sz=0;
 const go=async()=>{if(ops.length)await mcol.bulkWrite(ops,{ordered:false});ops=[];sz=0};
 for(const p of all){const b=fs.readFileSync(path.join(ROOT,p));ops.push({replaceOne:{filter:{_id:p},replacement:{_id:p,data:new Binary(b),size:b.length,t:new Date()},upsert:true}});sz+=b.length;if(ops.length>=20||sz>8e6)await go()}await go();console.log('MongoDB: نُسخ',all.length,'ملف من المستودع')}
async function hydrate(){const keep=new Set();for await(const d of mcol.find({})){if(!okId(d._id))continue;keep.add(d._id);const f=path.join(ROOT,d._id);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,Buffer.from(d.data.buffer.subarray(0,d.data.position)))}
 for(const p of walk('content'))if(!keep.has(p))fs.rmSync(path.join(ROOT,p),{force:true});console.log('MongoDB: حُمّل',keep.size,'ملف')}
async function init(){if(!MG.uri)return;const go=async()=>{try{const{MongoClient}=require('mongodb'),cli=new MongoClient(MG.uri,{serverSelectionTimeoutMS:10000});await cli.connect();mcol=cli.db(MG.db).collection('files');
  if(await mcol.countDocuments({})===0)await seed();else await hydrate();mready=true;lastErr='';ver++;if(pend.size)flushMongo()}
 catch(e){lastErr=e.code==='MODULE_NOT_FOUND'?'حزمة mongodb غير مثبّتة (اضبط Build Command على npm install)':e.message;console.log('MongoDB:',lastErr);setTimeout(go,30000)}};await go()}
const writable=()=>!MG.uri||mready;
const flushNow=async()=>{clearTimeout(timer);while(flushing)await new Promise(r=>setTimeout(r,200));await(MG.uri?flushMongo():flush())};
const status=()=>({backend:MG.uri?'mongo':(GH.tok&&GH.repo?'github':'none'),ready:writable(),github:!!(GH.tok&&GH.repo),pending:pend.size,lastErr,lastOk});
// ---------- الملفات ----------
function put(rel,data){const f=path.join(ROOT,rel);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,data);queue(rel,Buffer.isBuffer(data)?data:Buffer.from(data))}
function del(rel){fs.rmSync(path.join(ROOT,rel),{force:true});queue(rel,null)}
function delTree(rel){const walk=d=>ls(path.join(ROOT,d)).flatMap(f=>{const p=d+'/'+f;return fs.statSync(path.join(ROOT,p)).isDirectory()?walk(p):[p]});walk(rel).forEach(p=>queue(p,null));fs.rmSync(path.join(ROOT,rel),{recursive:true,force:true})}
const saveJ=(rel,o)=>put(rel,JSON.stringify(o,null,1));
const subjects=()=>rd('subjects.json',[]),saveSubjects=a=>saveJ('subjects.json',a);
const settings=()=>({site:'مهندس دولة',categories:[],...rd('settings.json',{})}),saveSettings=o=>saveJ('settings.json',o);
const meta=s=>{const m=rd(`content/${s}/meta.json`,{});return{items:m.items||{},order:m.order||{}}},saveMeta=(s,m)=>saveJ(`content/${s}/meta.json`,m);
const wc=new Map(),words=f=>{try{const k=f+fs.statSync(f).mtimeMs;if(!wc.has(k))wc.set(k,fs.readFileSync(f,'utf8').split(/\s+/).filter(Boolean).length);return wc.get(k)}catch{return 0}};
const files=(s,kind)=>ls(path.join(ROOT,'content',s,kind)).filter(f=>(kind=='images'?IMG:TXT).test(f));
function ordered(s,kind,fl=files(s,kind)){const o=meta(s).order[kind]||[];return[...o.filter(f=>fl.includes(f)),...fl.filter(f=>!o.includes(f)).sort()]}
function manifest(admin){const S=settings();return{site:S.site,categories:S.categories,subjects:subjects().map(s=>{const d=`content/${s.slug}`,m=meta(s.slug),ex=p=>fs.existsSync(path.join(ROOT,p));
 const base=(kind,f)=>{const it=m.items[kind+'/'+f]||{};return{file:f,title:it.title||'',cat:it.cat||'',chapter:it.chapter||'',hidden:!!it.hidden}};
 const images=ordered(s.slug,'images').map(f=>{const stem=f.replace(/\.[^.]+$/,'');return{...base('images',f),src:`${d}/images/${f}`,thumb:ex(`${d}/thumbs/${f}`)?`${d}/thumbs/${f}`:`${d}/images/${f}`,ocr:ex(`${d}/ocr/${stem}.txt`)?`${d}/ocr/${stem}.txt`:null}});
 const texts=ordered(s.slug,'texts').map(f=>{const b=base('texts',f),pdf=/\.pdf$/i.test(f);return{...b,name:f,file:`${d}/texts/${f}`,title:b.title||f.replace(/\.[^.]+$/,'').replace(/_/g,' ').trim(),pdf,words:pdf?0:words(path.join(ROOT,d,'texts',f))}});
 return{slug:s.slug,name:s.name,images:admin?images:images.filter(i=>!i.hidden),texts:admin?texts:texts.filter(t=>!t.hidden)}})}}
function addItem(s,kind,f,props){const m=meta(s);m.items[kind+'/'+f]=props;m.order[kind]=[...ordered(s,kind,files(s,kind).filter(x=>x!==f)),f];saveMeta(s,m)}
function setItem(s,kind,f,patch){const m=meta(s);m.items[kind+'/'+f]={...(m.items[kind+'/'+f]||{}),...patch};saveMeta(s,m)}
function removeItem(s,kind,f){const d=`content/${s}`,stem=f.replace(/\.[^.]+$/,'');del(`${d}/${kind}/${f}`);if(kind=='images'){del(`${d}/thumbs/${f}`);del(`${d}/ocr/${stem}.txt`)}
 const m=meta(s);delete m.items[kind+'/'+f];m.order[kind]=ordered(s,kind).filter(x=>x!==f);saveMeta(s,m)}
function moveItem(s,kind,f,dir){const m=meta(s),o=ordered(s,kind),i=o.indexOf(f),j=i+dir;if(i<0||j<0||j>=o.length)return;[o[i],o[j]]=[o[j],o[i]];m.order[kind]=o;saveMeta(s,m)}
module.exports={ROOT,put,del,delTree,subjects,saveSubjects,settings,saveSettings,manifest,addItem,setItem,removeItem,moveItem,status,flushNow,init,writable,version:()=>ver};
