import fs from "node:fs/promises";
import crypto from "node:crypto";

const now = new Date().toISOString();
const archivePath = "data/archive.json";
const mediaPath = "data/media.json";

const archive = JSON.parse(await fs.readFile(archivePath, "utf8"));
let previous = { items: [] };
try {
  previous = JSON.parse(await fs.readFile(mediaPath, "utf8"));
} catch {}

const previousByArchiveId = new Map((previous.items || []).map((x) => [x.archive_id, x]));
const OFFICIAL_HOSTS = new Set([
  "noticias.calp.es",
  "calp.es",
  "www.calp.es",
  "diputacionalicante.es",
  "www.diputacionalicante.es",
  "gva.es",
  "www.gva.es"
]);

function clean(value = "") {
  return String(value || "").trim();
}

function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ""; }
}

function decodeHtml(value = "") {
  return String(value)
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function metaContent(html, key, attr = "property") {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+${attr}=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+${attr}=["']${escaped}["'][^>]*>`, "i")
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return decodeHtml(m[1]);
  }
  return "";
}

function hasExplicitLicense(html = "") {
  const s = html.toLowerCase();
  return [
    "creativecommons.org/licenses/",
    "creative commons",
    "cc by-sa",
    "cc-by-sa",
    "cc by ",
    "cc-by ",
    "public domain",
    "dominio público",
    "dominio publico"
  ].some((x) => s.includes(x));
}

function isCommons(url = "") {
  const h = hostOf(url);
  return h === "commons.wikimedia.org" || h === "upload.wikimedia.org";
}

async function inspectSource(sourceUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const res = await fetch(sourceUrl, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": "CALPE-ONE-MEDIA/1.0 (+https://github.com/cryptocalp-art/calpe-one-engine)" }
    });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") || "";
    if (!type.includes("text/html")) return null;
    const html = (await res.text()).slice(0, 1_500_000);
    const image = metaContent(html, "og:image") || metaContent(html, "twitter:image", "name");
    if (!image) return null;
    let imageUrl = image;
    try { imageUrl = new URL(image, res.url || sourceUrl).toString(); } catch {}
    return {
      page_url: sourceUrl,
      image_url: imageUrl,
      page_host: hostOf(sourceUrl),
      official_source: OFFICIAL_HOSTS.has(hostOf(sourceUrl)),
      explicit_license_signal: hasExplicitLicense(html),
      commons_image: isCommons(imageUrl)
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function aiPolicy(article) {
  const blocked = new Set(["POLITICA", "SUCESOS"]);
  if (blocked.has(article.category)) {
    return { eligible: false, reason: `AI illustration disabled for ${article.category}` };
  }
  return {
    eligible: true,
    reason: "Only as a clearly labelled conceptual illustration; never as documentary evidence"
  };
}

const items = [];
let licensedSelected = 0;
let officialCandidates = 0;
let brandedFallbacks = 0;
let reused = 0;

for (const article of archive.articles || []) {
  if (article.status !== "PUBLISHED") continue;

  const old = previousByArchiveId.get(article.archive_id);
  if (old?.selected?.stable === true) {
    items.push({ ...old, checked_at: now });
    reused++;
    continue;
  }

  const candidates = [];
  for (const source of (article.sources || []).slice(0, 4)) {
    if (!source?.url) continue;
    const found = await inspectSource(source.url);
    if (!found) continue;
    const rights = found.commons_image && found.explicit_license_signal
      ? "EXPLICIT_LICENSE_SIGNAL"
      : found.official_source
        ? "OFFICIAL_SOURCE_RIGHTS_UNVERIFIED"
        : "RIGHTS_UNVERIFIED";
    candidates.push({
      type: "SOURCE_IMAGE",
      source_name: source.name || hostOf(source.url),
      source_page: source.url,
      image_url: found.image_url,
      official_source: found.official_source,
      rights_status: rights,
      auto_publish: rights === "EXPLICIT_LICENSE_SIGNAL"
    });
  }

  const licensed = candidates.find((c) => c.auto_publish === true);
  let selected;
  if (licensed) {
    selected = {
      mode: "LICENSED_REMOTE",
      stable: true,
      image_url: licensed.image_url,
      alt: article.title,
      credit: licensed.source_name,
      label: "Imagen con señal explícita de licencia en la fuente",
      rights_status: licensed.rights_status
    };
    licensedSelected++;
  } else {
    const official = candidates.find((c) => c.official_source);
    if (official) officialCandidates++;
    selected = {
      mode: "EDITORIAL_CARD",
      stable: true,
      image_url: `/media/${article.archive_id}.svg`,
      alt: `Imagen editorial de CALPE ONE para: ${article.title}`,
      credit: "CALPE ONE",
      label: "Imagen editorial · No es una fotografía del hecho",
      rights_status: "CALPE_ONE_OWNED"
    };
    brandedFallbacks++;
  }

  items.push({
    media_id: `med_${crypto.createHash("sha256").update(article.archive_id).digest("hex").slice(0, 16)}`,
    archive_id: article.archive_id,
    slug: article.slug,
    title: article.title,
    category: article.category,
    selected,
    candidates,
    ai_policy: aiPolicy(article),
    checked_at: now,
    engine_version: "media-v1"
  });
}

const output = {
  engine: "CALPE ONE ENGINE",
  module: "MEDIA",
  version: "media-v1",
  generated_at: now,
  archive_version: archive.version || null,
  count: items.length,
  policy: {
    official_or_licensed_first: true,
    unverified_rights_never_auto_published: true,
    branded_editorial_card_fallback: true,
    ai_generation_enabled: false,
    ai_rule: "Never depict a real event as if the generated image were documentary photography"
  },
  stats: {
    reused,
    licensed_selected: licensedSelected,
    official_candidates_not_auto_published: officialCandidates,
    branded_fallbacks: brandedFallbacks
  },
  items
};

await fs.writeFile(mediaPath, JSON.stringify(output, null, 2) + "\n", "utf8");
await fs.writeFile(
  "data/media-last-run.json",
  JSON.stringify({ status: "success", generated_at: now, count: items.length, ...output.stats }, null, 2) + "\n",
  "utf8"
);

console.log(JSON.stringify({ media_items: items.length, ...output.stats }, null, 2));
