import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import http from 'node:http';
import {DEFAULT_STATE,ROOT,articleHash,evaluate,recordReview,loadState,loadEdition,safeUrl} from '../model.mjs';
import {renderEdition} from '../render.mjs';
const fixture=()=>({id:'test_article',slug:'noticia-de-prueba',title:'Noticia de prueba',summary:'Texto sintético para pruebas, sin hechos reales.',body:Array(135).fill('prueba').join(' '),category:'LOCAL',date:'2026-09-30T00:00:00Z',sources:[{name:'Fuente de prueba',url:'https://example.org/noticia',type:'PRIMARY'}],caveats:[],provenance:{investigation_status:'VERIFIED',quality_gate_status:'ELIGIBLE'},media:null});
const state=()=>structuredClone(DEFAULT_STATE);
test('Brand Hold bloquea incluso con aprobación vigente; ningún registro implica aprobación automática',()=>{const s=state(),a=fixture();assert.equal(evaluate(a,s).allowed,false);recordReview(s,a,{decision:'APPROVED',reviewer:'Revisor de prueba',confirmed:true});assert.deepEqual(evaluate(a,s).reasons,['BRAND_HOLD']);s.brandHold=false;assert.equal(evaluate(a,s).allowed,true);});
test('cambios de texto, fuentes, fecha o imagen invalidan la revisión',()=>{for(const key of ['body','sources','date','media']){const s=state(),a=fixture();recordReview(s,a,{decision:'APPROVED',reviewer:'Revisor de prueba',confirmed:true});s.brandHold=false;if(key==='body')a.body+=' cambio';if(key==='sources')a.sources.push({name:'Otra fuente',url:'https://example.org/otra'});if(key==='date')a.date='2026-09-29T00:00:00Z';if(key==='media')a.media={id:'photo',rightsStatus:'REVIEWED'};assert.ok(evaluate(a,s).reasons.includes('HUMAN_REVIEW'),key);}});
test('derechos sin revisar, fuentes inseguras y ausencia de confirmación bloquean',()=>{const s=state(),a=fixture();assert.throws(()=>recordReview(s,a,{decision:'APPROVED',reviewer:'Prueba',confirmed:false}));a.media={rightsStatus:'PENDING'};assert.ok(evaluate(a,s).reasons.includes('IMAGE_RIGHTS'));a.sources=[{url:'javascript:alert(1)'}];assert.ok(evaluate(a,s).reasons.includes('SOURCES'));assert.equal(safeUrl('javascript:alert(1)'),'');});
test('falta de estado bloquea; estado corrupto nunca abre publicación',async()=>{const dir=await fs.mkdtemp(path.join(os.tmpdir(),'calpe-state-'));try{assert.equal((await loadState(dir)).brandHold,true);await fs.writeFile(path.join(dir,'editorial.json'),'{}');await assert.rejects(loadState(dir));}finally{await fs.rm(dir,{recursive:true,force:true});}});
test('vista descargable no filtra revisores ni referencias privadas; texto no escapa del JSON',async()=>{const a=fixture();a.title='</script><img src=x onerror=alert(1)>';a.media={src:'data:image/png;base64,AA==',rightsStatus:'REVIEWED',kind:'ARCHIVE_PHOTO',credit:'Crédito público',permissionEvidence:'PRUEBA_PRIVADA',reviewer:'REVISOR_PRIVADO'};a.publication={review:{reviewer:'REVISOR_PRIVADO'}};const html=await renderEdition({name:'CALPE ONE',articles:[a],state:state(),sourceUpdated:a.date});assert.ok(!html.includes('PRUEBA_PRIVADA'));assert.ok(!html.includes('REVISOR_PRIVADO'));assert.ok(html.includes('\\u003c/script>'));assert.ok(html.includes('noindex,nofollow'));});
test('API local: origen y token, confirmación humana, persistencia y conflicto de revisión',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'calpe-api-'));await fs.mkdir(path.join(dir,'data'));const a=fixture();await fs.writeFile(path.join(dir,'data/archive.json'),JSON.stringify({updated_at:a.date,articles:[{archive_id:a.id,slug:a.slug,title:a.title,summary:a.summary,body:a.body,category:a.category,published_at:a.date,sources:a.sources,provenance:a.provenance}]}));
 const port=43841,origin=`http://127.0.0.1:${port}`,stateDir=path.join(dir,'state');const child=spawn(process.execPath,[path.join(ROOT,'newsroom/server.mjs')],{env:{...process.env,CALPE_NEWSROOM_PORT:String(port),CALPE_NEWSROOM_STATE:stateDir,CALPE_NEWSROOM_DATA_ROOT:dir},stdio:['ignore','pipe','pipe']});
 try{
  await Promise.race([once(child.stdout,'data'),new Promise((_,reject)=>{const t=setTimeout(()=>reject(new Error('El servidor no arrancó')),8000);t.unref();}),once(child,'exit').then(()=>{throw new Error('El servidor terminó antes de arrancar');})]);
  const post=(url,data,token='',headers={})=>fetch(origin+url,{method:'POST',headers:{'Content-Type':'application/json','Origin':origin,'X-Editor-Token':token,...headers},body:JSON.stringify(data)});
  assert.equal((await post('/api/article/review',{})).status,403);
  const badHostStatus=await new Promise((resolve,reject)=>{const req=http.get(origin,{headers:{Host:'evil.example'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);});
  assert.equal(badHostStatus,403);
  const token=(await (await fetch(origin+'/api/session')).json()).token;
  let edition=await (await fetch(origin+'/api/edition')).json();const current=edition.articles[0];
  const review={revision:0,articleId:current.id,contentHash:current.contentHash,reviewer:'Revisor sintético',decision:'APPROVED',confirmed:true};
  assert.equal((await post('/api/article/review',{...review,confirmed:false},token)).status,400);
  assert.equal((await post('/api/article/review',review,token,{'Origin':'https://evil.example'})).status,403);
  assert.equal((await post('/api/article/review',review,token)).status,200);
  assert.equal((await post('/api/article/review',review,token)).status,409);
  edition=await loadEdition({root:dir,stateDir});assert.equal(edition.state.brandHold,true);assert.equal(edition.state.reviews[a.id].decision,'APPROVED');assert.equal(edition.articles[0].publication.allowed,false);
  const edit={revision:1,articleId:a.id,contentHash:edition.articles[0].contentHash,reviewer:'Revisor sintético',values:{title:a.title+' revisada',summary:a.summary,body:a.body,category:a.category}};
  assert.equal((await post('/api/article/edit',edit,token)).status,200);
  edition=await loadEdition({root:dir,stateDir});assert.equal(edition.state.reviews[a.id],undefined);assert.ok(edition.articles[0].publication.reasons.includes('HUMAN_REVIEW'));assert.equal(edition.state.audit.length,2);
 }finally{child.kill();await once(child,'exit').catch(()=>{});await fs.rm(dir,{recursive:true,force:true});}
});
