import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {ROOT,STATE_DIR,loadEdition,saveState,changeArticle,recordReview,imageScore} from './model.mjs';
import {renderEdition} from './render.mjs';

const port=Number(process.env.CALPE_NEWSROOM_PORT||4317);
if(!Number.isSafeInteger(port)||port<1024||port>65535)throw new Error('Puerto inválido');
const hosts=new Set([`127.0.0.1:${port}`,`localhost:${port}`]);
const csrfToken=crypto.randomBytes(32).toString('hex');
let mutationQueue=Promise.resolve();
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"};
function send(res,status,body,type='application/json; charset=utf-8'){res.writeHead(status,{'Content-Type':type,...headers});res.end(typeof body==='string'||Buffer.isBuffer(body)?body:JSON.stringify(body));}
async function bodyJson(req){
 if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))throw Object.assign(new Error('Solo se admite JSON'),{status:415});
 let size=0;const chunks=[];
 for await(const chunk of req){size+=chunk.length;if(size>8*1024*1024)throw Object.assign(new Error('Archivo demasiado grande'),{status:413});chunks.push(chunk);}
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Object.assign(new Error('JSON inválido'),{status:400});}
}
function checkRevision(input,state){if(input.revision!==state.revision)throw Object.assign(new Error('La edición ha cambiado. Recarga antes de guardar.'),{status:409});}
async function hydrate(edition){
 for(const m of edition.state.media)m.src=`/media/${m.fileName}`;
 for(const a of edition.articles)if(a.media)a.media.src=`/media/${a.media.fileName}`;
 return edition;
}
function imageType(bytes){
 if(bytes.length>=8&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return ['png','image/png'];
 if(bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return ['jpg','image/jpeg'];
 if(bytes.length>=12&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP')return ['webp','image/webp'];
 return null;
}
const server=http.createServer(async(req,res)=>{
 try{
  if(!hosts.has(req.headers.host))return send(res,403,{error:'Solo se permite acceso local.'});
  const url=new URL(req.url,`http://${req.headers.host}`);
  if(req.method==='GET'&&url.pathname==='/api/session')return send(res,200,{token:csrfToken});
  if(req.method==='GET'&&url.pathname==='/api/edition')return send(res,200,await hydrate(await loadEdition()));
  if(req.method==='GET'&&url.pathname==='/')return send(res,200,await renderEdition(await hydrate(await loadEdition()),{localEditor:true}),'text/html; charset=utf-8');
  if(req.method==='GET'&&url.pathname.startsWith('/media/')){
   const name=decodeURIComponent(url.pathname.slice(7));const edition=await loadEdition();const media=edition.state.media.find(m=>m.fileName===name);
   if(!media||!/^[a-f0-9-]+\.(png|jpg|webp)$/.test(name))return send(res,404,{error:'Imagen no encontrada'});
   return send(res,200,await fs.readFile(path.join(STATE_DIR,'media',name)),media.mime);
  }
  if(req.method==='POST'&&url.pathname.startsWith('/api/')){
   if(req.headers.origin!==`http://${req.headers.host}`||req.headers['x-editor-token']!==csrfToken)return send(res,403,{error:'Sesión editorial no válida. Abre la mesa desde este equipo.'});
   const input=await bodyJson(req);
   const operation=mutationQueue.then(async()=>{
    const edition=await loadEdition();const state=edition.state;checkRevision(input,state);
    if(url.pathname==='/api/media/import'){
     const m=input.metadata||{};const fields=['author','credit','license','permissionEvidence','location','captureDate','alt','reviewer'];
     if(fields.some(k=>typeof m[k]!=='string'||!m[k].trim()||m[k].length>1500)||!['CURRENT_PHOTO','ARCHIVE_PHOTO','ILLUSTRATION'].includes(m.kind)||m.rightsConfirmed!==true)throw new Error('Completa autoría, derechos, crédito, lugar, fecha, descripción y revisión de la imagen.');
     if(!/^\d{4}-\d{2}-\d{2}$/.test(m.captureDate)||Number.isNaN(Date.parse(m.captureDate)))throw new Error('Fecha de captura inválida.');
     if(typeof input.base64!=='string'||!/^[A-Za-z0-9+/]*={0,2}$/.test(input.base64))throw new Error('Contenido de imagen inválido');
     const bytes=Buffer.from(input.base64,'base64');if(bytes.length>5*1024*1024||bytes.length<20)throw new Error('La imagen debe ocupar entre 20 bytes y 5 MB.');
     const type=imageType(bytes);if(!type)throw new Error('Utiliza PNG, JPEG o WebP. SVG no está admitido.');
     const sha256=crypto.createHash('sha256').update(bytes).digest('hex');if(state.media.some(x=>x.sha256===sha256))throw new Error('Esta imagen ya está en el catálogo.');
     const id=crypto.randomUUID(),fileName=`${id}.${type[0]}`;
     const item={id,fileName,mime:type[1],sha256,kind:m.kind,rightsStatus:'REVIEWED',author:m.author.trim(),credit:m.credit.trim(),license:m.license.trim(),permissionEvidence:m.permissionEvidence.trim(),location:m.location.trim(),captureDate:m.captureDate,alt:m.alt.trim(),tags:String(m.tags||'').split(',').map(t=>t.trim()).filter(Boolean).slice(0,20),reviewer:m.reviewer.trim(),reviewedAt:new Date().toISOString()};
     await fs.mkdir(path.join(STATE_DIR,'media'),{recursive:true,mode:0o700});await fs.writeFile(path.join(STATE_DIR,'media',fileName),bytes,{mode:0o600,flag:'wx'});state.media.push(item);state.audit.push({at:new Date().toISOString(),action:'IMAGE_IMPORT',mediaId:id,sha256,reviewer:item.reviewer});
    }else{
     const article=edition.articles.find(a=>a.id===input.articleId);if(!article)throw Object.assign(new Error('Noticia no encontrada'),{status:404});
     if(input.contentHash!==article.contentHash)throw Object.assign(new Error('El texto o la imagen han cambiado. Recarga y revisa la versión vigente.'),{status:409});
     if(url.pathname==='/api/article/edit')changeArticle(state,article,input.values,String(input.reviewer||''));
     else if(url.pathname==='/api/article/review')recordReview(state,article,input);
     else if(url.pathname==='/api/article/image'){
      if(!input.reviewer?.trim())throw new Error('Identifica al revisor.');
      const media=input.mediaId?state.media.find(m=>m.id===input.mediaId):null;
      if(input.mediaId&&(!media||media.rightsStatus!=='REVIEWED'))throw new Error('La imagen no está revisada.');
      state.overrides[article.id]={...state.overrides[article.id],mediaId:media?.id||null};delete state.reviews[article.id];state.audit.push({at:new Date().toISOString(),action:'IMAGE_ASSIGN',articleId:article.id,mediaId:media?.id||null,reviewer:input.reviewer.trim()});
     }else throw Object.assign(new Error('Acción no disponible'),{status:404});
    }
    state.revision++;await saveState(state);return {ok:true,revision:state.revision,brandHold:state.brandHold};
   });
   mutationQueue=operation.catch(()=>{});return send(res,200,await operation);
  }
  return send(res,404,{error:'Página no encontrada'});
 }catch(e){send(res,e.status||400,{error:e.message||'No se ha podido completar la operación.'});}
});
server.listen(port,'127.0.0.1',()=>console.log(`CALPE ONE · vista previa y mesa local: http://127.0.0.1:${port}\nBrand Hold se conserva. Este servidor no publica ni llama a IA.`));
