import OpenAI from "openai";
import fs from "node:fs/promises";
import crypto from "node:crypto";

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  throw new Error("OPENAI_API_KEY no está configurada.");
}

const client = new OpenAI({ apiKey });
const model = process.env.OPENAI_MODEL || "gpt-6-astra";
const now = new Date().toISOString();

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
          category: {
            type: "string",
            enum: [
              "LOCAL",
              "POLITICA",
              "SUCESOS",
              "ECONOMIA",
              "SOCIEDAD",
              "TURISMO",
              "DEPORTES",
              "CULTURA",
              "MEDIO_AMBIENTE",
              "OTROS"
            ]
          },
          relevance: { type: "number" },
          reason: { type: "string" }
        },
        required: [
          "title",
          "summary",
          "source_name",
          "source_url",
          "published_at",
          "category",
          "relevance",
          "reason"
        ]
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
`;

const response = await client.responses.create({
  model,
  tools: [
    {
      type: "web_search",
      search_context_size: "high"
    }
  ],
  input: prompt,
  text: {
    format: {
      type: "json_schema",
      name: "calpe_one_radar",
      strict: true,
      schema
    }
  }
});

if (!response.output_text) {
  throw new Error("OpenAI no devolvió contenido en output_text.");
}

let parsed;
try {
  parsed = JSON.parse(response.output_text);
} catch (error) {
  throw new Error(`La respuesta del Radar no es JSON válido: ${error.message}`);
}

const candidates = parsed.candidates
  .filter((item) => item.source_url && /^https?:\\/\\//i.test(item.source_url))
  .map((item) => ({
    ...item,
    relevance: Math.max(0, Math.min(100, Number(item.relevance) || 0)),
    detected_at: now,
    fingerprint: crypto
      .createHash("sha256")
      .update(`${item.title}|${item.source_url}`.toLowerCase())
      .digest("hex")
  }));

const deduped = [];
const fingerprints = new Set();
for (const item of candidates) {
  if (fingerprints.has(item.fingerprint)) continue;
  fingerprints.add(item.fingerprint);
  deduped.push(item);
}

const output = {
  engine: "CALPE ONE ENGINE",
  module: "RADAR",
  generated_at: now,
  model,
  count: deduped.length,
  candidates: deduped
};

await fs.mkdir("data", { recursive: true });
await fs.writeFile(
  "data/candidates.json",
  JSON.stringify(output, null, 2) + "\n",
  "utf8"
);
await fs.writeFile(
  "data/last-run.json",
  JSON.stringify(
    {
      status: "success",
      generated_at: now,
      count: deduped.length,
      model
    },
    null,
    2
  ) + "\n",
  "utf8"
);

console.log(JSON.stringify(output, null, 2));
