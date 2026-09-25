import OpenAI from "openai";
import fs from "node:fs/promises";
import crypto from "node:crypto";

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error("OPENAI_API_KEY no está configurada.");

const client = new OpenAI({ apiKey });
const model = process.env.OPENAI_MODEL || "gpt-5.6-luna";
const now = new Date().toISOString();

async function readArchive() {
  try {
    return JSON.parse(await fs.readFile("data/archive.json", "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return { articles: [] };
    throw error;
  }
}

function normalizeUrl(value = "") {
  try {
    const url = new URL(value);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      const k = key.toLowerCase();
      if (k.startsWith("utm_") || ["fbclid", "gclid", "mc_cid", "mc_eid"].includes(k)) url.searchParams.delete(key);
    }
    url.hostname = url.hostname.toLowerCase();
    let out = url.toString();
    if (out.endsWith("/")) out = out.slice(0, -1);
    return out;
  } catch {
    return String(value || "").trim();
  }
}

const STOP = new Set(["a","al","ante","bajo","con","contra","de","del","desde","durante","e","el","ella","en","entre","es","esta","este","ha","la","las","lo","los","para","por","que","se","sin","sobre","su","sus","un","una","y","calp","calpe"]);
function titleTokens(value = "") {
  return new Set(String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((x) => x.length >= 3 && !STOP.has(x)));
}
function titleSimilarity(a, b) {
  const A = titleTokens(a); const B = titleTokens(b);
  if (!A.size || !B.size) return 0;
  let intersection = 0;
  for (const token of A) if (B.has(token)) intersection += 1;
  const union = new Set([...A, ...B]).size;
  return union ? intersection / union : 0;
}

const archive = await readArchive();
const archivedArticles = Array.isArray(archive.articles) ? archive.articles : [];
const archivedUrls = new Set(archivedArticles.flatMap((a) => a.source_urls || []).map(normalizeUrl));
const recentArchiveTitles = archivedArticles.slice(0, 80).map((a) => a.title).filter(Boolean);

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    candidates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          summary: { type: "string" },
          source_name: { type: "string" },
          source_url: { type: "string" },
          published_at: { type: ["string", "null"] },
          category: { type: "string", enum: ["LOCAL", "POLITICA", "SUCESOS", "ECONOMIA", "SOCIEDAD", "TURISMO", "DEPORTES", "CULTURA", "MEDIO_AMBIENTE", "OTROS"] },
          relevance: { type: "number" },
          reason: { type: "string" }
        },
        required: ["title", "summary", "source_name", "source_url", "published_at", "category", "relevance", "reason"]
      }
    }
  },
  required: ["candidates"]
};

const prompt = `
Eres el Radar editorial automático de CALPE ONE.
Fecha y hora actual: ${now}.
Busca noticias REALES Y RECIENTES que afecten a Calpe/Calp (Alicante), la Marina Alta y, cuando tengan impacto claro en Calp, la provincia de Alicante.
Prioridad:
1. Ayuntamiento, administración pública y servicios municipales.
2. Seguridad, sucesos, emergencias y protección civil.
3. Economía local, comercio y empleo.
4. Turismo, playas, movilidad y eventos.
5. Medio ambiente y urbanismo.
6. Sociedad, cultura y deporte local.
Reglas estrictas:
- Usa búsqueda web en tiempo real.
- No inventes noticias, fuentes, fechas ni URLs.
- No conviertas rumores o publicaciones sin fuente fiable en noticia.
- Excluye noticias antiguas salvo que exista una actualización nueva relevante.
- Devuelve como máximo 15 candidatos.
- La relevancia debe ser un número de 0 a 100.
- Solo incluye candidatos con una URL de fuente verificable encontrada durante la búsqueda.
- Si una información aparece repetida, conserva una sola entrada usando la fuente más directa o fiable.
- En published_at usa la fecha/hora solo cuando esté disponible en la fuente; si no, usa null.
- En reason explica por qué es relevante para CALPE ONE.
- NO vuelvas a proponer una noticia ya publicada salvo que exista un hecho NUEVO y material, preferiblemente en una URL nueva.

Titulares ya publicados recientemente, solo como lista de exclusión:
${JSON.stringify(recentArchiveTitles)}
`;

const response = await client.responses.create({
  model,
  tools: [{ type: "web_search", search_context_size: "high" }],
  input: prompt,
  text: { format: { type: "json_schema", name: "calpe_one_radar", strict: true, schema } }
});

if (!response.output_text) throw new Error("OpenAI no devolvió contenido en output_text.");
const parsed = JSON.parse(response.output_text);

const candidates = parsed.candidates
  .filter((item) => {
    if (!item.source_url) return false;
    try {
      const url = new URL(item.source_url);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  })
  .map((item) => ({
    ...item,
    source_url: normalizeUrl(item.source_url),
    relevance: Math.max(0, Math.min(100, Number(item.relevance) || 0)),
    detected_at: now,
    fingerprint: crypto.createHash("sha256").update(`${item.title}|${normalizeUrl(item.source_url)}`.toLowerCase()).digest("hex")
  }));

const withinRun = [];
const fingerprints = new Set();
for (const item of candidates) {
  if (fingerprints.has(item.fingerprint)) continue;
  fingerprints.add(item.fingerprint);
  withinRun.push(item);
}

let archiveDuplicates = 0;
const fresh = withinRun.filter((item) => {
  if (archivedUrls.has(normalizeUrl(item.source_url))) {
    archiveDuplicates += 1;
    return false;
  }
  const similar = archivedArticles.some((a) => (a.category || "LOCAL") === (item.category || "LOCAL") && titleSimilarity(a.title, item.title) >= 0.86);
  if (similar) {
    archiveDuplicates += 1;
    return false;
  }
  return true;
});

const output = {
  engine: "CALPE ONE ENGINE",
  module: "RADAR",
  generated_at: now,
  model,
  archive_count: archivedArticles.length,
  duplicates_filtered: archiveDuplicates,
  count: fresh.length,
  candidates: fresh
};

await fs.mkdir("data", { recursive: true });
await fs.writeFile("data/candidates.json", JSON.stringify(output, null, 2) + "\n", "utf8");
await fs.writeFile("data/last-run.json", JSON.stringify({ status: "success", generated_at: now, count: fresh.length, duplicates_filtered: archiveDuplicates, archive_count: archivedArticles.length, model }, null, 2) + "\n", "utf8");
console.log(JSON.stringify(output, null, 2));
