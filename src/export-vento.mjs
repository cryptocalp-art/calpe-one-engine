import fs from "node:fs/promises";
import crypto from "node:crypto";

const now = new Date().toISOString();
const draftsDoc = JSON.parse(await fs.readFile("data/drafts.json", "utf8"));
const drafts = Array.isArray(draftsDoc.drafts) ? draftsDoc.drafts : [];

let qualityGateDoc = { version: null, decisions: [] };
try {
  qualityGateDoc = JSON.parse(await fs.readFile("data/quality-gate.json", "utf8"));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const gateByDraftId = new Map(
  (qualityGateDoc.decisions || []).map((d) => [d.draft_id, d])
);

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeSources(sources = []) {
  return sources
    .filter((s) => s && s.source_url)
    .map((s) => ({
      name: cleanText(s.source_name),
      url: cleanText(s.source_url),
      type: cleanText(s.source_type) || "SECONDARY"
    }));
}

function sourceUrls(sources = []) {
  return [...new Set(normalizeSources(sources).map((s) => s.url).filter(Boolean))];
}

function validateDraft(draft, gateDecision) {
  const errors = [];
  if (draft?.status !== "PENDING_GATE") errors.push("status_not_pending_gate");
  if (!gateDecision) errors.push("quality_gate_decision_missing");
  else if (gateDecision.status !== "ELIGIBLE") errors.push("quality_gate_not_eligible");
  if (gateDecision && gateDecision.draft_id !== draft?.id) errors.push("quality_gate_draft_mismatch");
  if (gateDecision && gateDecision.investigation_id !== draft?.investigation_id) errors.push("quality_gate_investigation_mismatch");
  if (draft?.provenance?.investigation_status !== "VERIFIED") errors.push("investigation_not_verified");
  if (!draft?.headline) errors.push("missing_headline");
  if (!draft?.slug) errors.push("missing_slug");
  if (!draft?.lead) errors.push("missing_lead");
  if (!draft?.body_markdown) errors.push("missing_body");
  if (!draft?.category) errors.push("missing_category");
  if ((draft?.provenance?.supported_claim_count ?? 0) < 2) errors.push("insufficient_supported_claims");
  if ((draft?.provenance?.evidence_count ?? 0) < 1) errors.push("no_evidence");
  if (sourceUrls(draft?.sources).length < 1) errors.push("no_source_urls");
  return errors;
}

const ready = [];
const quarantined = [];

for (const draft of drafts) {
  const gateDecision = gateByDraftId.get(draft?.id);
  const errors = validateDraft(draft, gateDecision);
  const exportId = `exp_${crypto
    .createHash("sha256")
    .update(`${draft?.id || "unknown"}|${draft?.slug || "unknown"}`)
    .digest("hex")
    .slice(0, 16)}`;

  if (errors.length) {
    quarantined.push({
      export_id: exportId,
      draft_id: draft?.id ?? null,
      investigation_id: draft?.investigation_id ?? null,
      slug: draft?.slug ?? null,
      reasons: errors,
      quality_gate_status: gateDecision?.status || "MISSING",
      quality_gate_reasons: gateDecision?.reasons || []
    });
    continue;
  }

  const sources = normalizeSources(draft.sources);
  const urls = sourceUrls(draft.sources);
  const provenance = {
    ...(draft.provenance || {}),
    quality_gate_status: "ELIGIBLE",
    quality_gate_version: qualityGateDoc.version || gateDecision.engine_version || "quality-gate-v1",
    quality_gate_id: gateDecision.gate_id,
    quality_gate_evaluated_at: gateDecision.evaluated_at,
    quality_gate_warnings: gateDecision.warnings || []
  };

  ready.push({
    export_id: exportId,
    target: "VENTO",
    target_storage_draft: "calpe_drafts",
    target_storage_news: "calpe_news",
    delivery_mode: "EXPORT_ONLY",
    bridge_status: "READY_FOR_VENTO",
    generated_at: now,
    source_draft_id: draft.id,
    source_investigation_id: draft.investigation_id,
    candidate_fingerprint: draft.candidate_fingerprint,
    quality_gate_id: gateDecision.gate_id,
    quality_gate_status: "ELIGIBLE",

    calpe_drafts: {
      external_id: draft.id,
      investigation_id: draft.investigation_id,
      candidate_fingerprint: draft.candidate_fingerprint,
      title: draft.headline,
      subtitle: draft.subheadline || "",
      summary: draft.lead,
      body: draft.body_markdown,
      category: draft.category,
      slug: draft.slug,
      seo_title: draft.seo_title || draft.headline,
      meta_description: draft.meta_description || draft.lead,
      status: "ELIGIBLE",
      review_required: false,
      publishable_by_engine: true,
      quality_gate_status: "ELIGIBLE",
      quality_gate_id: gateDecision.gate_id,
      editorial_notes: draft.editorial_notes || [],
      sources,
      source_urls: urls,
      provenance,
      created_at: draft.created_at,
      engine_version: "publisher-export-v2"
    },

    calpe_news_candidate: {
      external_id: draft.id,
      title: draft.headline,
      slug: draft.slug,
      summary: draft.lead,
      body: draft.body_markdown,
      category: draft.category,
      seo_title: draft.seo_title || draft.headline,
      meta_description: draft.meta_description || draft.lead,
      status: "READY",
      quality_gate_status: "ELIGIBLE",
      quality_gate_id: gateDecision.gate_id,
      published_at: null,
      source_urls: urls,
      sources,
      investigation_id: draft.investigation_id,
      candidate_fingerprint: draft.candidate_fingerprint,
      provenance,
      engine_version: "publisher-export-v2"
    }
  });
}

const exportDoc = {
  engine: "CALPE ONE ENGINE",
  module: "PUBLISHER_EXPORT",
  contract_version: "vento-export-v1",
  quality_gate_version: qualityGateDoc.version || null,
  generated_at: now,
  delivery_mode: "EXPORT_ONLY",
  destination: "VENTO",
  drafts_seen: drafts.length,
  ready_count: ready.length,
  quarantined_count: quarantined.length,
  ready,
  quarantined
};

await fs.mkdir("data", { recursive: true });
await fs.writeFile("data/vento-export.json", JSON.stringify(exportDoc, null, 2) + "\n", "utf8");
await fs.writeFile(
  "data/publisher-last-run.json",
  JSON.stringify(
    {
      status: "success",
      generated_at: now,
      contract_version: "vento-export-v1",
      quality_gate_version: qualityGateDoc.version || null,
      delivery_mode: "EXPORT_ONLY",
      drafts_seen: drafts.length,
      quality_gate_decisions_seen: (qualityGateDoc.decisions || []).length,
      ready_for_vento: ready.length,
      quarantined: quarantined.length
    },
    null,
    2
  ) + "\n",
  "utf8"
);

console.log(JSON.stringify({
  drafts_seen: drafts.length,
  quality_gate_decisions_seen: (qualityGateDoc.decisions || []).length,
  ready_for_vento: ready.length,
  quarantined: quarantined.length
}, null, 2));
