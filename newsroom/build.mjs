import fs from 'node:fs/promises';
import path from 'node:path';
import {ROOT,STATE_DIR,loadEdition} from './model.mjs';
import {renderEdition} from './render.mjs';
const mode=process.argv.includes('--publish')?'publish':'preview';
const edition=await loadEdition();
if(mode==='publish') {
  if(edition.state.brandHold!==false) throw new Error('BRAND_HOLD: exportación pública bloqueada. La aprobación de noticias no levanta este bloqueo.');
  edition.articles=edition.articles.filter(a=>a.publication.allowed);
  if(!edition.articles.length) throw new Error('No hay noticias con aprobación humana vigente.');
}
const out=path.join(ROOT,'newsroom-output',mode);
await fs.mkdir(out,{recursive:true});
for(const a of edition.articles){
  if(a.media){
    if(!/^[a-f0-9-]+\.(png|jpg|webp)$/.test(a.media.fileName))throw new Error('Nombre de imagen inválido');
    const bytes=await fs.readFile(path.join(STATE_DIR,'media',a.media.fileName));
    a.media={...a.media,src:`data:${a.media.mime};base64,${bytes.toString('base64')}`};
  }
}
await fs.writeFile(path.join(out,'index.html'),await renderEdition(edition,{mode}));
await fs.writeFile(path.join(out,'build-info.json'),JSON.stringify({mode,createdAt:new Date().toISOString(),articles:edition.articles.length,brandHold:edition.state.brandHold},null,2));
console.log(JSON.stringify({mode,articles:edition.articles.length,path:path.join(out,'index.html')}));
