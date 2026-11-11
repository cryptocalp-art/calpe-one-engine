import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const STATE_DIR = process.env.CALPE_NEWSROOM_STATE ? path.resolve(process.env.CALPE_NEWSROOM_STATE) : path.join(ROOT, 'newsroom/state');
export const CATEGORIES = {LOCAL:'Calp',SOCIEDAD:'Sociedad',DEPORTES:'Deportes',ECONOMIA:'Economía',CULTURA:'Cultura',MEDIO_AMBIENTE:'Medio ambiente',TURISMO:'Turismo',POLITICA:'Política',SUCESOS:'Sucesos',OTROS:'Actualidad'};
export const DEFAULT_STATE = {version:1,revision:0,brandHold:true,overrides:{},reviews:{},media:[],audit:[]};
export const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function safeUrl(value) {try {const u = new URL(value);return ['https:','http:'].includes(u.protocol) && !u.username && !u.password ? u.href : '';} catch {return '';}}
export async function loadState(dir=STATE_DIR) {
  try {
    const state = JSON.parse(await fs.readFile(path.join(dir,'editorial.json'),'utf8'));
    if (state.version !== 1 || typeof state.brandHold !== 'boolean' || !Number.isSafeInteger(state.revision) || !state.overrides || !state.reviews || !Array.isArray(state.media) || !Array.isArray(state.audit)) throw new Error('Estado editorial inválido. Publicación bloqueada.');
    return state;
  } catch(e) {if(e.code === 'ENOENT') return structuredClone(DEFAULT_STATE);throw e;}
}
export async function saveState(state,dir=STATE_DIR) {
  await fs.mkdir(dir,{recursive:true,mode:0o700});
  const temp = path.join(dir,`editorial-${crypto.randomUUID()}.tmp`);
  await fs.writeFile(temp,JSON.stringify(state,null,2)+'\n',{mode:0o600});
  await fs.rename(temp,path.join(dir,'editorial.json'));
}
export function articleHash(a) {
  return digest({id:a.id,title:a.title,summary:a.summary,body:a.body,category:a.category,sources:a.sources,date:a.date,caveats:a.caveats,provenance:a.provenance,media:a.media});
}
export function evaluate(a,state) {
  const reasons=[];
  if(state.brandHold !== false) reasons.push('BRAND_HOLD');
  if(a.provenance?.investigation_status !== 'VERIFIED' || a.provenance?.quality_gate_status !== 'ELIGIBLE') reasons.push('QUALITY_GATE');
  if(!a.sources.length || !a.sources.every(s=>safeUrl(s.url))) reasons.push('SOURCES');
  if(a.body.trim().split(/\s+/).length < 120) reasons.push('BODY_TOO_SHORT');
  if(a.media && a.media.rightsStatus !== 'REVIEWED') reasons.push('IMAGE_RIGHTS');
  const review = state.reviews[a.id];
  if(!review || review.decision !== 'APPROVED' || review.contentHash !== articleHash(a) || !review.reviewer?.trim()) reasons.push('HUMAN_REVIEW');
  return {allowed:reasons.length===0,reasons,review:review || null};
}
export async function loadEdition({root=process.env.CALPE_NEWSROOM_DATA_ROOT || ROOT,stateDir=STATE_DIR}={}) {
  const [archive,state] = await Promise.all([fs.readFile(path.join(root,'data/archive.json'),'utf8').then(JSON.parse),loadState(stateDir)]);
  if(!Array.isArray(archive.articles)) throw new Error('Archivo de noticias inválido');
  const seen=new Set();
  const articles=archive.articles.filter(a=>a.archive_id && a.slug && a.title && a.body && !seen.has(a.archive_id) && seen.add(a.archive_id)).map(a=>{
    const override=state.overrides[a.archive_id] || {};
    const media=state.media.find(m=>m.id===override.mediaId) || null;
    const article={id:a.archive_id,slug:a.slug,title:override.title ?? a.title,summary:override.summary ?? a.summary ?? '',body:override.body ?? a.body,category:override.category ?? a.category ?? 'LOCAL',date:a.published_at,updated:a.updated_at,sources:(a.sources||[]).map(s=>({name:s.name||'Fuente',url:safeUrl(s.url),type:s.type||''})).filter(s=>s.url),caveats:a.provenance?.caveats||[],provenance:a.provenance||{},media};
    article.contentHash=articleHash(article);article.publication=evaluate(article,state);return article;
  }).sort((a,b)=>Date.parse(b.date)-Date.parse(a.date));
  return {name:'CALPE ONE',version:1,sourceUpdated:archive.updated_at,articles,state};
}
export function changeArticle(state,article,values,reviewer) {
  const title=String(values.title||'').trim(), summary=String(values.summary||'').trim(), body=String(values.body||'').trim(), category=values.category;
  if(!reviewer?.trim() || !title || title.length>220 || !summary || summary.length>1500 || body.length<100 || body.length>100000 || !(category in CATEGORIES)) throw new Error('Completa titular, entradilla, cuerpo, sección y nombre del revisor.');
  state.overrides[article.id]={...state.overrides[article.id],title,summary,body,category};
  delete state.reviews[article.id];
  state.audit.push({at:new Date().toISOString(),action:'EDIT',articleId:article.id,reviewer:reviewer.trim(),previousHash:article.contentHash});
}
export function recordReview(state,article,{decision,reviewer,note,confirmed}) {
  if(!['APPROVED','CHANGES_REQUESTED'].includes(decision) || !reviewer?.trim() || reviewer.length>120) throw new Error('Identifica al revisor y la decisión.');
  if(decision==='APPROVED' && confirmed!==true) throw new Error('Confirma la revisión de texto, fuentes e imagen.');
  const blocking=evaluate(article,{...state,brandHold:false}).reasons.filter(r=>r!=='HUMAN_REVIEW');
  if(decision==='APPROVED' && blocking.length) throw new Error('No se puede aprobar: '+blocking.join(', '));
  const review={decision,reviewer:reviewer.trim(),note:String(note||'').slice(0,4000),contentHash:articleHash(article),at:new Date().toISOString()};
  state.reviews[article.id]=review;state.audit.push({action:'REVIEW',articleId:article.id,...review});return review;
}
export function imageScore(article,image) {
  if(image.rightsStatus!=='REVIEWED') return 0;
  const norm=s=>String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const text=norm(article.title+' '+article.summary+' '+(CATEGORIES[article.category]||''));
  return (image.tags||[]).reduce((score,tag)=>score+(text.includes(norm(tag))?2:0),0)+(norm(image.location).includes('calp')?1:0);
}
