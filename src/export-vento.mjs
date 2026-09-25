import fs from "node:fs/promises";
import crypto from "node:crypto";

const now = new Date().toISOString();
const draftsDoc = JSON.parse(await fs.readFile("data/drafts.json", "utf8"));
const drafts = Array.isArray(draftsDoc.drafts) ? draftsDoc.drafts : [];

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

function validateDraft(draft) {
  const errors = [];
  if (draft?.status !== "DRAFT") errors.push("status_not_draft");
  if (draft?.provenance?.investigation_status !== "VERIFIED") errors.push("investigation_not_verified");
  if (!draft?.headline) errors.push("missing_headline");
  if (!draft?.slug) errors.push("missing_slug");
  if (!draft?.lead) errors.push("missing_lead");
  if (!draft?.body_markdown) errors.push("missing_body");
  if (!draft?.category) errors.push("missing_category");
  if ((draft?.provenance?.supported_claim_count ?? 0) < 1) errors.push("no_supported_claims");
  if ((draft?.provenance?.evidence_count ?? 0) < 1) errors.push("no_evidence");
  if (sourceUrls(draft?.sources).length < 1) errors.push("no_source_urls");
  return errors;
}

const ready = [];
const quarantined = [];

for (const draft of drafts) {
  const errors = validateDraft(draft);
  const exportId = `exp_${crypto
    .createHash("sha256")
    .update(`${draft.id}|${draft.slug}`)
    .digest("hex")
    .slice(0, 16)}`;

  if (errors.length) {
    quarantined.push({
      export_id: exportId,
      draft_id: draft?.id ?? null,
      slug: draft?.slug ?? null,
      reasons: errors
    });
    continue;
  }

  const sources = normalizeSources(draft.sources);
  const urls = sourceUrls(draft.sources);

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
      status: "DRAFT",
      review_required: Boolean(draft.review_required),
      publishable_by_engine: Boolean(draft.publishable_by_engine),
      editorial_notes: draft.editorial_notes || [],
      sources,
      source_urls: urls,
      provenance: draft.provenance || {},
      created_at: draft.created_at,
      engine_version: "publisher-export-v1"
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
      status: "DRAFT",
      published_at: null,
      source_urls: urls,
      sources,
      investigation_id: draft.investigation_id,
      candidate_fingerprint: draft.candidate_fingerprint,
      engine_version: "publisher-export-v1"
    }
  });
}

const exportDoc = {
  engine: "CALPE ONE ENGINE",
  module: "PUBLISHER_EXPORT",
  contract_version: "vento-export-v1",
  generated_at: now,
  delivery_mode: "EXPORT_ONLY",
  destination: "VENTO",
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
      delivery_mode: "EXPORT_ONLY",
      drafts_seen: drafts.length,
      ready_for_vento: ready.length,
      quarantined: quarantined.length
    },
    null,
    2
  ) + "\n",
  "utf8"
);

console.log(JSON.stringify({ drafts_seen: drafts.length, ready_for_vento: ready.length, quarantined: quarantined.length }, null, 2));
