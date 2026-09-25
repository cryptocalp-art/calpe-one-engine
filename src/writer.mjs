import OpenAI from "openai";
import fs from "node:fs/promises";
import crypto from "node:crypto";

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error("OPENAI_API_KEY no está configurada.");

const client = new OpenAI({ apiKey });
const model = process.env.OPENAI_MODEL || "gpt-5.6-luna";
const now = new Date().toISOString();

const investigationsDoc = JSON.parse(await fs.readFile("data/investigations.json", "utf8"));
const candidatesDoc = JSON.parse(await fs.readFile("data/candidates.json", "utf8"));

const candidateByFingerprint = new Map(
  (candidatesDoc.candidates || []).map((c) => [c.fingerprint, c])
);

const eligible = (investigationsDoc.investigations || [])
  .filter((i) => i.status === "VERIFIED" && i.publishable === true)
  .slice(0, 8);

if (!eligible.length) {
  await fs.writeFile(
    "data/drafts.json",
    JSON.stringify({ engine: "CALPE ONE ENGINE", module: "WRITER", generated_at: now, model, count: 0, drafts: [] }, null, 2) + "\n"
  );
  await fs.writeFile(
    "data/writer-last-run.json",
    JSON.stringify({ status: "success", generated_at: now, model, drafts_created: 0, pending_quality_gate: 0 }, null, 2) + "\n"
  );
  console.log(JSON.stringify({ drafts_created: 0, pending_quality_gate: 0 }, null, 2));
  process.exit(0);
}

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    drafts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          investigation_id: { type: "string" },
          headline: { type: "string" },
          subheadline: { type: "string" },
          lead: { type: "string" },
          body_markdown: { type: "string" },
          seo_title: { type: "string" },
          meta_description: { type: "string" },
          slug: { type: "string" },
          editorial_notes: { type: "array", items: { type: "string" } }
        },
        required: [
          "investigation_id",
          "headline",
          "subheadline",
          "lead",
          "body_markdown",
          "seo_title",
          "meta_description",
          "slug",
          "editorial_notes"
        ]
      }
    }
  },
  required: ["drafts"]
};

const dossiers = eligible.map((inv) => {
  const candidate = candidateByFingerprint.get(inv.candidate_fingerprint) || {};
  return {
    investigation_id: inv.id,
    candidate_title: inv.title,
    category: candidate.category || "LOCAL",
    original_source: candidate.source_url || null,
    confidence: inv.confidence,
    summary: inv.summary,
    supported_claims: (inv.claims || []).filter((c) => c.status === "SUPPORTED").map((c) => c.claim),
    contradicted_or_unverified_claims: (inv.claims || []).filter((c) => c.status !== "SUPPORTED"),
    evidences: (inv.evidences || []).map((e, index) => ({
      ref: index + 1,
      source_name: e.source_name,
      source_url: e.source_url,
      source_type: e.source_type,
      evidence: e.evidence
    })),
    caveats: inv.caveats || []
  };
});

const prompt = `
Eres el WRITER de CALPE ONE, un periódico digital local de Calp.
Fecha de redacción: ${now}.

Tu misión es redactar un BORRADOR periodístico por cada expediente recibido. El borrador pasará después por un QUALITY GATE automático independiente antes de poder publicarse.

REGLAS INNEGOCIABLES:
- Usa EXCLUSIVAMENTE los hechos presentes en supported_claims y evidences del expediente.
- NO uses búsqueda web y NO añadas conocimiento externo.
- NO inventes cifras, declaraciones, fechas, contexto, antecedentes, cargos, motivaciones ni consecuencias.
- Ignora cualquier claim marcado como contradicted o unverified.
- Si caveats contiene una limitación material, refléjala con lenguaje claro y prudente.
- No conviertas inferencias en hechos.
- No copies frases largas de las fuentes; redacta de forma original.
- Mantén tono periodístico, claro, sobrio y local.
- Si el asunto es político o institucional: neutralidad estricta. No elogies, ataques, puntúes, jerarquices ni recomiendes actores políticos. Distingue hechos de declaraciones atribuidas.
- No especules sobre intenciones, competencia, salud, inteligencia o aptitud de personas.
- El titular no debe ser sensacionalista ni afirmar más de lo demostrado.
- El cuerpo debe tener entre 300 y 650 palabras cuando haya información suficiente; si no la hay, puede ser más corto.
- No escribas URLs dentro del cuerpo. Las fuentes se añadirán después automáticamente.
- slug: minúsculas, ASCII, palabras separadas por guiones, sin fecha salvo que sea necesaria.
- seo_title: máximo aproximado 65 caracteres.
- meta_description: máximo aproximado 160 caracteres.
- editorial_notes debe señalar cualquier cautela de publicación relevante; si no hay ninguna, devuelve [].
- Conserva EXACTAMENTE investigation_id.

EXPEDIENTES VERIFICADOS:
${JSON.stringify(dossiers)}
`;

const response = await client.responses.create({
  model,
  input: prompt,
  text: {
    format: {
      type: "json_schema",
      name: "calpe_one_writer",
      strict: true,
      schema
    }
  }
});

if (!response.output_text) throw new Error("OpenAI no devolvió output_text para WRITER.");
const parsed = JSON.parse(response.output_text);

const dossierById = new Map(dossiers.map((d) => [d.investigation_id, d]));
const drafts = (parsed.drafts || [])
  .filter((d) => dossierById.has(d.investigation_id))
  .map((d) => {
    const dossier = dossierById.get(d.investigation_id);
    const sources = dossier.evidences.map((e) => ({
      source_name: e.source_name,
      source_url: e.source_url,
      source_type: e.source_type
    }));
    const draftId = `drf_${crypto.createHash("sha256").update(`${d.investigation_id}|${d.headline}`).digest("hex").slice(0, 16)}`;
    const investigation = eligible.find((i) => i.id === d.investigation_id);
    return {
      id: draftId,
      investigation_id: d.investigation_id,
      candidate_fingerprint: investigation?.candidate_fingerprint || null,
      category: candidateByFingerprint.get(investigation?.candidate_fingerprint)?.category || "LOCAL",
      status: "PENDING_GATE",
      quality_gate_required: true,
      created_at: now,
      model,
      headline: d.headline,
      subheadline: d.subheadline,
      lead: d.lead,
      body_markdown: d.body_markdown,
      seo_title: d.seo_title,
      meta_description: d.meta_description,
      slug: d.slug,
      editorial_notes: d.editorial_notes,
      sources,
      provenance: {
        investigation_status: "VERIFIED",
        confidence: investigation?.confidence || null,
        supported_claim_count: dossier.supported_claims.length,
        evidence_count: dossier.evidences.length,
        caveats: dossier.caveats
      }
    };
  });

await fs.mkdir("data", { recursive: true });
await fs.writeFile(
  "data/drafts.json",
  JSON.stringify({ engine: "CALPE ONE ENGINE", module: "WRITER", generated_at: now, model, count: drafts.length, drafts }, null, 2) + "\n"
);
await fs.writeFile(
  "data/writer-last-run.json",
  JSON.stringify({ status: "success", generated_at: now, model, drafts_created: drafts.length, pending_quality_gate: drafts.length }, null, 2) + "\n"
);

console.log(JSON.stringify({ drafts_created: drafts.length, status: "PENDING_GATE", pending_quality_gate: drafts.length }, null, 2));
