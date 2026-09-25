import OpenAI from "openai";
import fs from "node:fs/promises";
import crypto from "node:crypto";

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error("OPENAI_API_KEY no está configurada.");
const client = new OpenAI({ apiKey });
const model = process.env.OPENAI_MODEL || "gpt-5.6-luna";
const now = new Date().toISOString();
const candidatesDoc = JSON.parse(await fs.readFile("data/candidates.json", "utf8"));
const candidates = (candidatesDoc.candidates || []).filter(x => Number(x.relevance) >= 80).slice(0, 8);

const schema = {
  type: "object", additionalProperties: false,
  properties: {
    investigations: { type: "array", items: { type: "object", additionalProperties: false,
      properties: {
        candidate_fingerprint:{type:"string"}, title:{type:"string"}, status:{type:"string",enum:["VERIFIED","NEEDS_RESEARCH","REJECTED"]}, confidence:{type:"string",enum:["LOW","MEDIUM","HIGH"]}, publishable:{type:"boolean"}, summary:{type:"string"},
        claims:{type:"array",items:{type:"object",additionalProperties:false,properties:{claim:{type:"string"},status:{type:"string",enum:["SUPPORTED","CONTRADICTED","UNVERIFIED"]}},required:["claim","status"]}},
        evidences:{type:"array",items:{type:"object",additionalProperties:false,properties:{source_name:{type:"string"},source_url:{type:"string"},evidence:{type:"string"},source_type:{type:"string",enum:["PRIMARY","SECONDARY"]}},required:["source_name","source_url","evidence","source_type"]}},
        caveats:{type:"array",items:{type:"string"}}
      }, required:["candidate_fingerprint","title","status","confidence","publishable","summary","claims","evidences","caveats"]
    }}
  }, required:["investigations"]
};

const compact = candidates.map(c => ({title:c.title,summary:c.summary,source_name:c.source_name,source_url:c.source_url,published_at:c.published_at,category:c.category,relevance:c.relevance,fingerprint:c.fingerprint}));
const prompt = `Eres el INVESTIGATION ENGINE de CALPE ONE, periódico local de Calp. Fecha: ${now}.
Investiga estos candidatos usando búsqueda web real: ${JSON.stringify(compact)}
REGLAS: no inventes. Para cada candidato busca corroboración independiente y, cuando exista, fuente primaria/oficial. Descompón la noticia en afirmaciones comprobables. Evidencia debe resumir solo lo que respalda la fuente indicada. VERIFIED solo si los hechos esenciales están suficientemente respaldados; NEEDS_RESEARCH si falta evidencia material o hay dudas; REJECTED si es falso, contradictorio o no corresponde. publishable=true únicamente para VERIFIED con confidence HIGH o MEDIUM y sin contradicción material. No confundas repetición de una nota de prensa con corroboración independiente. URLs deben ser reales y encontradas. Conserva exactamente candidate_fingerprint.`;

const response = await client.responses.create({model,tools:[{type:"web_search",search_context_size:"high"}],input:prompt,text:{format:{type:"json_schema",name:"calpe_one_investigation",strict:true,schema}}});
if (!response.output_text) throw new Error("OpenAI no devolvió output_text.");
const parsed = JSON.parse(response.output_text);
const investigations = parsed.investigations.map(i => ({...i,id:`inv_${crypto.createHash("sha256").update(i.candidate_fingerprint).digest("hex").slice(0,16)}`,investigated_at:now,model}));
const claims=[]; const evidences=[]; const links=[];
for (const inv of investigations) {
  inv.claims.forEach((c,idx)=>{const id=`clm_${crypto.createHash("sha256").update(`${inv.id}|${idx}|${c.claim}`).digest("hex").slice(0,16)}`; claims.push({id,investigation_id:inv.id,...c});});
  inv.evidences.forEach((e,idx)=>{const id=`evd_${crypto.createHash("sha256").update(`${inv.id}|${e.source_url}|${idx}`).digest("hex").slice(0,16)}`; evidences.push({id,investigation_id:inv.id,...e});});
}
for (const c of claims) for (const e of evidences.filter(x=>x.investigation_id===c.investigation_id)) links.push({claim_id:c.id,evidence_id:e.id,relationship:"RELATED"});
await fs.mkdir("data",{recursive:true});
await Promise.all([
 fs.writeFile("data/investigations.json",JSON.stringify({engine:"CALPE ONE ENGINE",module:"INVESTIGATION",generated_at:now,model,count:investigations.length,investigations},null,2)+"\n"),
 fs.writeFile("data/claims.json",JSON.stringify({generated_at:now,count:claims.length,claims},null,2)+"\n"),
 fs.writeFile("data/evidences.json",JSON.stringify({generated_at:now,count:evidences.length,evidences},null,2)+"\n"),
 fs.writeFile("data/claim-evidence.json",JSON.stringify({generated_at:now,count:links.length,relationships:links},null,2)+"\n"),
 fs.writeFile("data/investigation-last-run.json",JSON.stringify({status:"success",generated_at:now,model,candidates_processed:candidates.length,verified:investigations.filter(x=>x.status==="VERIFIED").length,needs_research:investigations.filter(x=>x.status==="NEEDS_RESEARCH").length,rejected:investigations.filter(x=>x.status==="REJECTED").length},null,2)+"\n")
]);
console.log(JSON.stringify({processed:investigations.length,verified:investigations.filter(x=>x.status==="VERIFIED").length,needs_research:investigations.filter(x=>x.status==="NEEDS_RESEARCH").length,rejected:investigations.filter(x=>x.status==="REJECTED").length},null,2));