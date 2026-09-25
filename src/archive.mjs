import fs from "node:fs/promises";
import crypto from "node:crypto";

const archivePath = "data/archive.json";
const exportPath = "data/vento-export.json";
const lastRunPath = "data/archive-last-run.json";
const now = new Date().toISOString();

async function readJson(path, fallback) {
  try {
    return JSON.parse(await fs.readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

function normalizeUrl(value = "") {
  try {
    const url = new URL(value);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      const k = key.toLowerCase();
      if (k.startsWith("utm_") || ["fbclid", "gclid", "mc_cid", "mc_eid"].includes(k)) {
        url.searchParams.delete(key);
      }
    }
    url.hostname = url.hostname.toLowerCase();
    let out = url.toString();
    if (out.endsWith("/")) out = out.slice(0, -1);
    return out;
  } catch {
    return String(value || "").trim();
  }
}

const STOP = new Set([
  "a","al","ante","bajo","con","contra","de","del","desde","durante","e","el","ella","en","entre","es","esta","este","ha","la","las","lo","los","para","por","que","se","sin","sobre","su","sus","un","una","y","calp","calpe"
]);

function titleTokens(value = "") {
  return new Set(
    String(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .filter((x) => x.length >= 3 && !STOP.has(x))
  );
}

function titleSimilarity(a, b) {
  const A = titleTokens(a);
  const B = titleTokens(b);
  if (!A.size || !B.size) return 0;
  let intersection = 0;
  for (const token of A) if (B.has(token)) intersection += 1;
  const union = new Set([...A, ...B]).size;
  return union ? intersection / union : 0;
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function packetToArticle(packet, exportDoc) {
  const news = packet?.calpe_news_candidate || {};
  const draft = packet?.calpe_drafts || {};
  const provenance = news.provenance || draft.provenance || {};
  const sources = Array.isArray(news.sources) && news.sources.length ? news.sources : (draft.sources || []);
  const sourceUrls = unique([
    ...(news.source_urls || []),
    ...(draft.source_urls || []),
    ...sources.map((s) => s?.url)
  ]).map(normalizeUrl).filter(Boolean);

  if (!news.title || !news.slug || !news.body) return null;
  if (provenance.investigation_status !== "VERIFIED") return null;
  if (provenance.quality_gate_status !== "ELIGIBLE") return null;
  if (Number(provenance.supported_claim_count || 0) < 2) return null;
  if (Number(provenance.evidence_count || 0) < 1) return null;

  return {
    archive_id: `arc_${crypto.createHash("sha256").update(`${packet.candidate_fingerprint || news.external_id || news.slug}|${sourceUrls[0] || news.slug}`).digest("hex").slice(0, 16)}`,
    external_id: news.external_id || draft.external_id || null,
    investigation_id: news.investigation_id || draft.investigation_id || packet.source_investigation_id || null,
    candidate_fingerprints: unique([packet.candidate_fingerprint, news.candidate_fingerprint, draft.candidate_fingerprint]),
    title: news.title,
    slug: news.slug,
    summary: news.summary || draft.summary || "",
    body: news.body,
    category: news.category || draft.category || "LOCAL",
    seo_title: news.seo_title || draft.seo_title || news.title,
    meta_description: news.meta_description || draft.meta_description || news.summary || "",
    sources,
    source_urls: sourceUrls,
    provenance,
    editorial_notes: draft.editorial_notes || [],
    published_at: news.published_at || draft.created_at || packet.generated_at || exportDoc.generated_at || now,
    updated_at: now,
    status: "PUBLISHED",
    engine_version: "archive-v1"
  };
}

function findDuplicate(articles, incoming) {
  const fingerprints = new Set(incoming.candidate_fingerprints || []);
  const urls = new Set(incoming.source_urls || []);

  for (const article of articles) {
    if ((article.candidate_fingerprints || []).some((fp) => fingerprints.has(fp))) {
      return { article, reason: "fingerprint" };
    }
  }

  for (const article of articles) {
    if ((article.source_urls || []).some((url) => urls.has(normalizeUrl(url)))) {
      return { article, reason: "source_url" };
    }
  }

  let best = null;
  for (const article of articles) {
    if ((article.category || "LOCAL") !== (incoming.category || "LOCAL")) continue;
    const score = titleSimilarity(article.title, incoming.title);
    if (score >= 0.86 && (!best || score > best.score)) best = { article, reason: "title_similarity", score };
  }
  return best;
}

function uniqueSlug(base, articles) {
  const used = new Set(articles.map((a) => a.slug));
  if (!used.has(base)) return base;
  const suffix = crypto.createHash("sha256").update(base + now).digest("hex").slice(0, 6);
  return `${base}-${suffix}`;
}

await fs.mkdir("data", { recursive: true });

const archive = await readJson(archivePath, {
  engine: "CALPE ONE ENGINE",
  module: "ARCHIVE",
  version: "archive-v1",
  created_at: now,
  updated_at: now,
  count: 0,
  articles: []
});
const exportDoc = await readJson(exportPath, { ready: [], generated_at: now });
const articles = Array.isArray(archive.articles) ? archive.articles : [];

let added = 0;
let duplicates = 0;
let enriched = 0;
const duplicateReasons = { fingerprint: 0, source_url: 0, title_similarity: 0 };

for (const packet of exportDoc.ready || []) {
  const incoming = packetToArticle(packet, exportDoc);
  if (!incoming) continue;

  const match = findDuplicate(articles, incoming);
  if (match) {
    duplicates += 1;
    duplicateReasons[match.reason] = (duplicateReasons[match.reason] || 0) + 1;

    const oldFingerprints = match.article.candidate_fingerprints || [];
    const oldUrls = (match.article.source_urls || []).map(normalizeUrl);
    const mergedFingerprints = unique([...oldFingerprints, ...incoming.candidate_fingerprints]);
    const mergedUrls = unique([...oldUrls, ...incoming.source_urls]);

    if (mergedFingerprints.length !== oldFingerprints.length || mergedUrls.length !== oldUrls.length) {
      match.article.candidate_fingerprints = mergedFingerprints;
      match.article.source_urls = mergedUrls;
      match.article.updated_at = now;
      enriched += 1;
    }
    continue;
  }

  incoming.slug = uniqueSlug(incoming.slug, articles);
  articles.push(incoming);
  added += 1;
}

articles.sort((a, b) => new Date(b.published_at || 0) - new Date(a.published_at || 0));

const changed = added > 0 || enriched > 0 || !archive.version;
const out = {
  engine: "CALPE ONE ENGINE",
  module: "ARCHIVE",
  version: "archive-v1",
  created_at: archive.created_at || now,
  updated_at: changed ? now : (archive.updated_at || now),
  count: articles.length,
  articles
};

await fs.writeFile(archivePath, JSON.stringify(out, null, 2) + "\n", "utf8");
await fs.writeFile(lastRunPath, JSON.stringify({
  status: "success",
  generated_at: now,
  incoming: (exportDoc.ready || []).length,
  added,
  duplicates,
  enriched,
  duplicate_reasons: duplicateReasons,
  archive_total: articles.length
}, null, 2) + "\n", "utf8");

console.log(JSON.stringify({ incoming: (exportDoc.ready || []).length, added, duplicates, enriched, archive_total: articles.length }, null, 2));
