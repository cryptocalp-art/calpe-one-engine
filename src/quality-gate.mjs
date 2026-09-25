import fs from "node:fs/promises";
import crypto from "node:crypto";

const now = new Date().toISOString();
const VERSION = "quality-gate-v1";

async function readJson(path, fallback = {}) {
  try {
    return JSON.parse(await fs.readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

const [draftsDoc, investigationsDoc, candidatesDoc] = await Promise.all([
  readJson("data/drafts.json", { drafts: [] }),
  readJson("data/investigations.json", { investigations: [] }),
  readJson("data/candidates.json", { candidates: [] })
]);

const drafts = Array.isArray(draftsDoc.drafts) ? draftsDoc.drafts : [];
const investigations = Array.isArray(investigationsDoc.investigations) ? investigationsDoc.investigations : [];
const candidates = Array.isArray(candidatesDoc.candidates) ? candidatesDoc.candidates : [];

const investigationById = new Map(investigations.map((x) => [x.id, x]));
const candidateByFingerprint = new Map(candidates.map((x) => [x.fingerprint, x]));

function clean(value = "") {
  return String(value ?? "").trim();
}

function fold(value = "") {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function words(value = "") {
  return clean(value).split(/\s+/).filter(Boolean);
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function validHttpUrl(value = "") {
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

function hostOf(value = "") {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function isInstitutionalOrPolitical(draft, candidate) {
  const category = fold(draft?.category || candidate?.category || "");
  if (/(politic|institucional|eleccion|gobierno|administracion)/.test(category)) return true;

  const text = fold(`${draft?.headline || ""} ${draft?.lead || ""}`);
  return /\b(ayuntamiento|alcald[ea]|concejal|pleno|partido|eleccion|candidato|gobierno municipal|oposicion|diputacion|generalitat|consell)\b/.test(text);
}

function unsafePoliticalLanguage(text = "") {
  const normalized = fold(text);
  const patterns = [
    /\b(vota|votad)\s+(por|a)\b/,
    /\b(no\s+votes|no\s+vote)\b/,
    /\b(deberias|deberia|deben|debemos|hay\s+que)\s+votar\b/,
    /\b(es|seria)\s+el\s+mejor\s+candidat[oa]\b/,
    /\b(es|seria)\s+el\s+peor\s+candidat[oa]\b/,
    /\b(la|el)\s+mejor\s+opcion\s+politica\b/,
    /\b(la|el)\s+peor\s+opcion\s+politica\b/,
    /\bdebes\s+apoyar\s+a\b/,
    /\bhay\s+que\s+apoyar\s+a\b/
  ];
  return patterns.some((re) => re.test(normalized));
}

function sensationalHeadline(headline = "") {
  const h = clean(headline);
  const normalized = fold(h);
  const clickbait = [
    "no te lo vas a creer",
    "bombazo",
    "escandalo total",
    "impactante revelacion",
    "lo nunca visto"
  ];
  const letters = h.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g, "");
  const upper = letters.replace(/[^A-ZÁÉÍÓÚÜÑ]/g, "");
  const upperRatio = letters.length >= 12 ? upper.length / letters.length : 0;
  return h.includes("!") || /\?{2,}|!{2,}/.test(h) || upperRatio > 0.65 || clickbait.some((x) => normalized.includes(x));
}

function caveatLooksMaterial(caveats = []) {
  const text = fold(caveats.join(" "));
  return /(no\s+acredita|no\s+se\s+ha\s+podido\s+confirmar|sin\s+corroborar|no\s+confirmad|contradic|unica\s+fuente|solo\s+una\s+fuente|no\s+consta)/.test(text);
}

function draftReflectsCaution(draft) {
  const text = fold(`${draft?.headline || ""} ${draft?.lead || ""} ${draft?.body_markdown || ""} ${(draft?.editorial_notes || []).join(" ")}`);
  const markers = [
    "segun",
    "no consta",
    "no acredita",
    "no se ha confirmado",
    "no se ha podido confirmar",
    "previsto",
    "estimado",
    "podria",
    "podria",
    "cautela",
    "sin confirmar",
    "no aporta"
  ];
  return markers.some((x) => text.includes(x));
}

const slugCounts = new Map();
for (const draft of drafts) {
  const slug = clean(draft?.slug);
  if (slug) slugCounts.set(slug, (slugCounts.get(slug) || 0) + 1);
}

const decisions = [];

for (const draft of drafts) {
  const reasons = [];
  const warnings = [];
  const investigation = investigationById.get(draft?.investigation_id);
  const candidate = candidateByFingerprint.get(draft?.candidate_fingerprint) || {};

  const checks = {
    writer_status: draft?.status || null,
    investigation_linked: Boolean(investigation),
    investigation_verified: false,
    investigation_publishable: false,
    confidence_sufficient: false,
    supported_claim_count: 0,
    contradicted_claim_count: 0,
    unverified_claim_count: 0,
    evidence_count: 0,
    primary_evidence_count: 0,
    secondary_evidence_count: 0,
    distinct_evidence_urls: 0,
    distinct_evidence_hosts: 0,
    institutional_or_political: false,
    material_caveat: false,
    caveat_reflected: true,
    neutral_political_language: true,
    headline_not_sensational: true,
    slug_unique: false,
    source_urls_valid: false,
    sources_trace_to_investigation: false,
    provenance_consistent: false,
    structure_complete: false,
    body_word_count: words(draft?.body_markdown).length
  };

  if (!["PENDING_GATE", "DRAFT"].includes(draft?.status)) reasons.push("WRITER_STATUS_NOT_PENDING_GATE");
  if (draft?.status === "DRAFT") warnings.push("LEGACY_DRAFT_STATUS_ACCEPTED_FOR_TRANSITION");

  if (!investigation) {
    reasons.push("INVESTIGATION_NOT_FOUND");
  } else {
    checks.investigation_verified = investigation.status === "VERIFIED";
    checks.investigation_publishable = investigation.publishable === true;
    checks.confidence_sufficient = ["MEDIUM", "HIGH"].includes(investigation.confidence);

    if (!checks.investigation_verified) reasons.push("INVESTIGATION_NOT_VERIFIED");
    if (!checks.investigation_publishable) reasons.push("INVESTIGATION_NOT_PUBLISHABLE");
    if (!checks.confidence_sufficient) reasons.push("CONFIDENCE_TOO_LOW");

    const claims = Array.isArray(investigation.claims) ? investigation.claims : [];
    const evidences = Array.isArray(investigation.evidences) ? investigation.evidences : [];
    const supported = claims.filter((c) => c.status === "SUPPORTED");
    const contradicted = claims.filter((c) => c.status === "CONTRADICTED");
    const unverified = claims.filter((c) => c.status === "UNVERIFIED");
    const primary = evidences.filter((e) => e.source_type === "PRIMARY");
    const secondary = evidences.filter((e) => e.source_type === "SECONDARY");
    const evidenceUrls = unique(evidences.map((e) => clean(e.source_url)).filter(validHttpUrl));
    const evidenceHosts = unique(evidenceUrls.map(hostOf));

    checks.supported_claim_count = supported.length;
    checks.contradicted_claim_count = contradicted.length;
    checks.unverified_claim_count = unverified.length;
    checks.evidence_count = evidences.length;
    checks.primary_evidence_count = primary.length;
    checks.secondary_evidence_count = secondary.length;
    checks.distinct_evidence_urls = evidenceUrls.length;
    checks.distinct_evidence_hosts = evidenceHosts.length;

    if (supported.length < 2) reasons.push("INSUFFICIENT_SUPPORTED_CLAIMS");
    if (contradicted.length > 0) reasons.push("CONTRADICTED_CLAIM_PRESENT");
    if (evidences.length < 1 || evidenceUrls.length < 1) reasons.push("INSUFFICIENT_EVIDENCE");
    if (unverified.length > 0) warnings.push("UNVERIFIED_CLAIMS_EXCLUDED_FROM_DRAFT");

    checks.institutional_or_political = isInstitutionalOrPolitical(draft, candidate);
    checks.material_caveat = caveatLooksMaterial(investigation.caveats || []);
    checks.caveat_reflected = !checks.material_caveat || draftReflectsCaution(draft);

    if (checks.institutional_or_political && primary.length < 1) {
      reasons.push("INSTITUTIONAL_OR_POLITICAL_NEEDS_PRIMARY_SOURCE");
    }

    if (checks.institutional_or_political && (unverified.length > 0 || checks.material_caveat)) {
      const corroborated = evidenceUrls.length >= 2 && secondary.length >= 1;
      if (!corroborated) reasons.push("CONTESTED_OR_CAVEATED_ITEM_NEEDS_INDEPENDENT_CORROBORATION");
    }

    if (!checks.caveat_reflected) reasons.push("MATERIAL_CAVEAT_NOT_REFLECTED_IN_DRAFT");

    const investigationUrls = new Set(evidenceUrls);
    const draftSourceUrls = unique((draft?.sources || []).map((s) => clean(s?.source_url)).filter(Boolean));
    checks.source_urls_valid = draftSourceUrls.length >= 1 && draftSourceUrls.every(validHttpUrl);
    checks.sources_trace_to_investigation = draftSourceUrls.length >= 1 && draftSourceUrls.every((url) => investigationUrls.has(url));

    if (!checks.source_urls_valid) reasons.push("DRAFT_SOURCE_URL_INVALID_OR_MISSING");
    if (!checks.sources_trace_to_investigation) reasons.push("DRAFT_SOURCE_NOT_TRACEABLE_TO_INVESTIGATION");

    const p = draft?.provenance || {};
    checks.provenance_consistent = p.investigation_status === investigation.status
      && p.confidence === investigation.confidence
      && Number(p.supported_claim_count || 0) === supported.length
      && Number(p.evidence_count || 0) === evidences.length;
    if (!checks.provenance_consistent) reasons.push("DRAFT_PROVENANCE_MISMATCH");
  }

  checks.neutral_political_language = !checks.institutional_or_political || !unsafePoliticalLanguage(`${draft?.headline || ""} ${draft?.subheadline || ""} ${draft?.lead || ""} ${draft?.body_markdown || ""}`);
  if (!checks.neutral_political_language) reasons.push("POLITICAL_PERSUASION_OR_RANKING_LANGUAGE_DETECTED");

  checks.headline_not_sensational = !sensationalHeadline(draft?.headline);
  if (!checks.headline_not_sensational) reasons.push("SENSATIONAL_HEADLINE_DETECTED");

  checks.slug_unique = Boolean(draft?.slug) && slugCounts.get(clean(draft.slug)) === 1;
  if (!checks.slug_unique) reasons.push("DUPLICATE_OR_MISSING_SLUG");

  const slugValid = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(clean(draft?.slug));
  const bodyHasUrl = /https?:\/\//i.test(clean(draft?.body_markdown));
  const requiredText = [draft?.headline, draft?.lead, draft?.body_markdown, draft?.seo_title, draft?.meta_description, draft?.slug]
    .every((x) => clean(x).length > 0);
  checks.structure_complete = requiredText && slugValid && checks.body_word_count >= 120 && !bodyHasUrl;

  if (!requiredText) reasons.push("REQUIRED_EDITORIAL_FIELD_MISSING");
  if (!slugValid) reasons.push("INVALID_SLUG_FORMAT");
  if (checks.body_word_count < 120) reasons.push("BODY_TOO_SHORT_FOR_AUTOMATED_PUBLICATION");
  if (bodyHasUrl) reasons.push("BODY_CONTAINS_RAW_URL");

  if (clean(draft?.seo_title).length > 75) warnings.push("SEO_TITLE_LONG");
  if (clean(draft?.meta_description).length > 180) warnings.push("META_DESCRIPTION_LONG");

  const status = reasons.length === 0 ? "ELIGIBLE" : "QUARANTINED";
  const gateId = `qg_${crypto.createHash("sha256").update(`${draft?.id || "unknown"}|${VERSION}`).digest("hex").slice(0, 16)}`;

  decisions.push({
    gate_id: gateId,
    draft_id: draft?.id || null,
    investigation_id: draft?.investigation_id || null,
    candidate_fingerprint: draft?.candidate_fingerprint || null,
    slug: draft?.slug || null,
    category: draft?.category || candidate?.category || "LOCAL",
    status,
    reasons,
    warnings,
    checks,
    evaluated_at: now,
    engine_version: VERSION
  });
}

const eligible = decisions.filter((x) => x.status === "ELIGIBLE");
const quarantined = decisions.filter((x) => x.status === "QUARANTINED");

const output = {
  engine: "CALPE ONE ENGINE",
  module: "AUTOMATED_QUALITY_GATE",
  version: VERSION,
  generated_at: now,
  policy: {
    human_approval_required: false,
    default_on_uncertainty: "QUARANTINED",
    requires_verified_investigation: true,
    requires_investigation_publishable: true,
    accepted_confidence: ["MEDIUM", "HIGH"],
    minimum_supported_claims: 2,
    minimum_evidence_items: 1,
    contradicted_claims_allowed: false,
    institutional_or_political_requires_primary_source: true,
    caveated_or_contested_institutional_items_require_independent_corroboration: true,
    political_persuasion_or_ranking_language_allowed: false,
    sensational_headlines_allowed: false,
    untraceable_sources_allowed: false
  },
  drafts_seen: drafts.length,
  eligible_count: eligible.length,
  quarantined_count: quarantined.length,
  decisions
};

await fs.mkdir("data", { recursive: true });
await fs.writeFile("data/quality-gate.json", JSON.stringify(output, null, 2) + "\n", "utf8");
await fs.writeFile(
  "data/quality-gate-last-run.json",
  JSON.stringify({
    status: "success",
    generated_at: now,
    version: VERSION,
    drafts_seen: drafts.length,
    eligible: eligible.length,
    quarantined: quarantined.length,
    quarantine_reasons: quarantined.reduce((acc, item) => {
      for (const reason of item.reasons) acc[reason] = (acc[reason] || 0) + 1;
      return acc;
    }, {})
  }, null, 2) + "\n",
  "utf8"
);

console.log(JSON.stringify({
  version: VERSION,
  drafts_seen: drafts.length,
  eligible: eligible.length,
  quarantined: quarantined.length
}, null, 2));
