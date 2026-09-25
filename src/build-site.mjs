import fs from "node:fs/promises";
import path from "node:path";

const archivePath = "data/archive.json";
const mediaPath = "data/media.json";
const outDir = "docs";
const siteUrl = (process.env.SITE_URL || "https://cryptocalp-art.github.io/calpe-one-engine").replace(/\/$/, "");
const now = new Date().toISOString();

const esc = (s = "") => String(s)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");
const xml = (s = "") => esc(s);

const fmtDate = (value) => {
  const d = new Date(value || now);
  return new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "long", year: "numeric", timeZone: "Europe/Madrid" }).format(d);
};

const bodyToHtml = (body = "") => body
  .split(/\n\s*\n/)
  .filter(Boolean)
  .map((p) => `<p>${esc(p.trim())}</p>`)
  .join("\n");

const sourceList = (sources = []) => sources
  .map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.name)}</a> <span class="source-type">${esc(s.type || "")}</span></li>`)
  .join("\n");

function absoluteMediaUrl(url = "") {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  return `${siteUrl}${url.startsWith("/") ? "" : "/"}${url}`;
}

function wrapWords(text, max = 28, maxLines = 4) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  let index = 0;
  while (index < words.length && lines.length < maxLines) {
    const word = words[index];
    const next = line ? `${line} ${word}` : word;
    if (next.length > max && line) {
      lines.push(line);
      line = "";
      continue;
    }
    line = next;
    index++;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (index < words.length && lines.length) {
    lines[lines.length - 1] = `${lines[lines.length - 1].replace(/[.…]+$/, "")}…`;
  }
  return lines.slice(0, maxLines);
}

function cardSvg(article) {
  const palettes = {
    LOCAL: ["#0b4f6c", "#0a6a83"],
    POLITICA: ["#343a40", "#50545a"],
    SUCESOS: ["#4b2e39", "#6d4050"],
    ECONOMIA: ["#234d3c", "#36755b"],
    SOCIEDAD: ["#5b3f8c", "#7a59b2"],
    TURISMO: ["#0f6f8f", "#22a0b8"],
    DEPORTES: ["#31572c", "#4f772d"],
    CULTURA: ["#6d3d14", "#9b5d24"],
    MEDIO_AMBIENTE: ["#2d6a4f", "#40916c"],
    OTROS: ["#334155", "#475569"]
  };
  const [a, b] = palettes[article.category] || palettes.LOCAL;
  const lines = wrapWords(article.title, 31, 4);
  const tspans = lines.map((line, i) => `<tspan x="80" dy="${i === 0 ? 0 : 58}">${xml(line)}</tspan>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675" role="img" aria-labelledby="title desc">
<title id="title">${xml(article.title)}</title>
<desc id="desc">Imagen editorial de CALPE ONE. No es una fotografía del hecho.</desc>
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
<rect width="1200" height="675" fill="url(#g)"/>
<circle cx="1040" cy="120" r="210" fill="#ffffff" opacity=".08"/>
<circle cx="1100" cy="610" r="280" fill="#ffffff" opacity=".06"/>
<text x="80" y="90" fill="#ffffff" font-family="Arial, sans-serif" font-size="34" font-weight="800" letter-spacing="3">CALPE ONE</text>
<text x="80" y="145" fill="#ffffff" opacity=".82" font-family="Arial, sans-serif" font-size="22" font-weight="700" letter-spacing="2">${xml(article.category || "LOCAL")}</text>
<text x="80" y="270" fill="#ffffff" font-family="Georgia, serif" font-size="50" font-weight="700">${tspans}</text>
<line x1="80" x2="1120" y1="585" y2="585" stroke="#ffffff" opacity=".45"/>
<text x="80" y="625" fill="#ffffff" opacity=".88" font-family="Arial, sans-serif" font-size="20">Imagen editorial · No es una fotografía del hecho</text>
</svg>`;
}

const shell = ({ title, description, canonical, content, jsonLd = null, imageUrl = "" }) => `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
<link rel="alternate" type="application/rss+xml" title="CALPE ONE RSS" href="${siteUrl}/rss.xml">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
${imageUrl ? `<meta property="og:image" content="${esc(imageUrl)}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${esc(imageUrl)}">` : ""}
<style>
:root{--ink:#101820;--muted:#667085;--line:#d9dde3;--paper:#fff;--accent:#0b4f6c;--soft:#f5f7fa}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:Georgia,'Times New Roman',serif;line-height:1.65}a{color:var(--accent)}header{border-bottom:1px solid var(--line)}.top{max-width:1120px;margin:auto;padding:24px 20px 18px}.brand{font:800 34px/1 Arial,sans-serif;letter-spacing:-1.4px;color:var(--ink);text-decoration:none}.tag{font:13px/1.4 Arial,sans-serif;color:var(--muted);margin-top:7px}.nav{border-top:1px solid var(--line);font:700 13px Arial,sans-serif}.nav div{max-width:1120px;margin:auto;padding:10px 20px;display:flex;gap:18px}.nav a{text-decoration:none;color:var(--ink)}main{max-width:1120px;margin:auto;padding:30px 20px 60px}.hero{border-bottom:2px solid var(--ink);padding-bottom:18px;margin-bottom:28px}.kicker,.meta,.source-type{font:700 12px Arial,sans-serif;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}h1{font-size:clamp(36px,6vw,64px);line-height:1.02;letter-spacing:-1.5px;margin:10px 0 14px}h2{line-height:1.12}.dek{font-size:22px;line-height:1.35;color:#303642;max-width:900px}.article{max-width:820px}.article p{font-size:19px;margin:0 0 1.15em}.article-media{margin:0 0 30px}.article-media img{display:block;width:100%;height:auto;border-radius:2px}.article-media figcaption{font:12px/1.45 Arial,sans-serif;color:var(--muted);margin-top:7px}.note{background:var(--soft);border-left:4px solid var(--accent);padding:16px 18px;margin:28px 0}.sources{border-top:1px solid var(--line);margin-top:34px;padding-top:20px}.sources li{margin-bottom:8px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:28px}.card{border-top:3px solid var(--ink);padding-top:14px}.card h2{font-size:27px;margin:8px 0}.card p{color:#343a46}.card a{text-decoration:none;color:var(--ink)}.card img{width:100%;aspect-ratio:16/9;object-fit:cover;display:block;margin-bottom:14px;background:var(--soft)}footer{border-top:1px solid var(--line);font:13px Arial,sans-serif;color:var(--muted)}footer div{max-width:1120px;margin:auto;padding:22px 20px}@media(max-width:600px){h1{font-size:40px}.dek{font-size:19px}.article p{font-size:18px}}
</style>
${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd).replaceAll("<", "\\u003c")}</script>` : ""}
</head>
<body>
<header><div class="top"><a class="brand" href="${siteUrl}/">CALPE ONE</a><div class="tag">Una ciudad. Más de 150 nacionalidades. Una comunidad.</div></div><nav class="nav"><div><a href="${siteUrl}/">Portada</a><a href="${siteUrl}/noticias/">Noticias</a><a href="${siteUrl}/rss.xml">RSS</a></div></nav></header>
<main>${content}</main>
<footer><div>CALPE ONE · Información local con trazabilidad de fuentes · Generado por CALPE ONE ENGINE</div></footer>
</body></html>`;

const archive = JSON.parse(await fs.readFile(archivePath, "utf8"));
let mediaDoc = { items: [] };
try { mediaDoc = JSON.parse(await fs.readFile(mediaPath, "utf8")); } catch {}
const mediaByArchiveId = new Map((mediaDoc.items || []).map((m) => [m.archive_id, m]));

const articles = (archive.articles || [])
  .filter((a) => a.status === "PUBLISHED")
  .filter((a) => a.slug && a.title && a.body && a.provenance?.investigation_status === "VERIFIED")
  .filter((a) => Number(a.provenance?.supported_claim_count || 0) >= 2)
  .filter((a) => Number(a.provenance?.evidence_count || 0) >= 1)
  .sort((a, b) => new Date(b.published_at || 0) - new Date(a.published_at || 0));

await fs.rm(outDir, { recursive: true, force: true });
await fs.mkdir(path.join(outDir, "noticias"), { recursive: true });
await fs.mkdir(path.join(outDir, "media"), { recursive: true });

for (const a of articles) {
  const media = mediaByArchiveId.get(a.archive_id);
  if (media?.selected?.mode === "EDITORIAL_CARD") {
    await fs.writeFile(path.join(outDir, "media", `${a.archive_id}.svg`), cardSvg(a), "utf8");
  }
}

for (const a of articles) {
  const url = `${siteUrl}/noticias/${a.slug}/`;
  const media = mediaByArchiveId.get(a.archive_id);
  const mediaUrl = absoluteMediaUrl(media?.selected?.image_url || "");
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: a.title,
    description: a.meta_description || a.summary,
    datePublished: a.published_at,
    dateModified: a.updated_at || a.published_at || now,
    mainEntityOfPage: url,
    ...(mediaUrl ? { image: [mediaUrl] } : {}),
    author: { "@type": "Organization", name: "CALPE ONE" },
    publisher: { "@type": "Organization", name: "CALPE ONE" }
  };
  const caveats = (a.provenance?.caveats || []).length
    ? `<div class="note"><strong>Nota de verificación</strong><br>${(a.provenance.caveats || []).map(esc).join("<br>")}</div>`
    : "";
  const figure = mediaUrl
    ? `<figure class="article-media"><img src="${esc(mediaUrl)}" alt="${esc(media?.selected?.alt || a.title)}" loading="eager"><figcaption>${esc(media?.selected?.label || "")} · ${esc(media?.selected?.credit || "CALPE ONE")}</figcaption></figure>`
    : "";
  const content = `<article class="article"><div class="hero"><div class="kicker">${esc(a.category || "LOCAL")}</div><h1>${esc(a.title)}</h1><div class="dek">${esc(a.summary || "")}</div><div class="meta">Publicado ${esc(fmtDate(a.published_at))} · Verificación ${esc(a.provenance?.confidence || "")}</div></div>${figure}${bodyToHtml(a.body)}${caveats}<section class="sources"><h2>Fuentes consultadas</h2><ul>${sourceList(a.sources || [])}</ul></section></article>`;
  const dir = path.join(outDir, "noticias", a.slug);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "index.html"), shell({ title: a.seo_title || a.title, description: a.meta_description || a.summary, canonical: url, content, jsonLd, imageUrl: mediaUrl }), "utf8");
}

const cards = articles.map((a) => {
  const media = mediaByArchiveId.get(a.archive_id);
  const mediaUrl = absoluteMediaUrl(media?.selected?.image_url || "");
  const image = mediaUrl ? `<a href="${siteUrl}/noticias/${esc(a.slug)}/"><img src="${esc(mediaUrl)}" alt="${esc(media?.selected?.alt || a.title)}" loading="lazy"></a>` : "";
  return `<article class="card">${image}<div class="kicker">${esc(a.category || "LOCAL")}</div><h2><a href="${siteUrl}/noticias/${esc(a.slug)}/">${esc(a.title)}</a></h2><p>${esc(a.summary || "")}</p><div class="meta">${esc(fmtDate(a.published_at))}</div></article>`;
}).join("\n");

const listing = `<div class="hero"><div class="kicker">CALPE ONE NEWS</div><h1>Noticias de Calp</h1><div class="dek">Información local investigada y redactada a partir de fuentes trazables.</div></div><section class="grid">${cards}</section>`;
const leadImage = articles.length ? absoluteMediaUrl(mediaByArchiveId.get(articles[0].archive_id)?.selected?.image_url || "") : "";
await fs.writeFile(path.join(outDir, "index.html"), shell({ title: "CALPE ONE · Noticias de Calp", description: "Noticias de Calp investigadas y verificadas por CALPE ONE.", canonical: `${siteUrl}/`, content: listing, imageUrl: leadImage }), "utf8");
await fs.writeFile(path.join(outDir, "noticias", "index.html"), shell({ title: "Noticias · CALPE ONE", description: "Últimas noticias verificadas de Calp.", canonical: `${siteUrl}/noticias/`, content: listing, imageUrl: leadImage }), "utf8");

const rssItems = articles.slice(0, 30).map((a) => `<item><title>${xml(a.title)}</title><link>${siteUrl}/noticias/${xml(a.slug)}/</link><guid>${siteUrl}/noticias/${xml(a.slug)}/</guid><pubDate>${new Date(a.published_at).toUTCString()}</pubDate><description>${xml(a.summary || "")}</description></item>`).join("\n");
const rss = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>CALPE ONE</title><link>${siteUrl}/</link><description>Noticias verificadas de Calp</description><language>es-es</language>${rssItems}</channel></rss>`;
await fs.writeFile(path.join(outDir, "rss.xml"), rss, "utf8");

const urls = [`${siteUrl}/`, `${siteUrl}/noticias/`, ...articles.map((a) => `${siteUrl}/noticias/${a.slug}/`)];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((u) => `<url><loc>${xml(u)}</loc></url>`).join("")}</urlset>`;
await fs.writeFile(path.join(outDir, "sitemap.xml"), sitemap, "utf8");
await fs.writeFile(path.join(outDir, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${siteUrl}/sitemap.xml\n`, "utf8");
await fs.writeFile(path.join(outDir, ".nojekyll"), "", "utf8");
await fs.writeFile(path.join(outDir, "build-info.json"), JSON.stringify({ engine: "CALPE ONE ENGINE", module: "WEB_PUBLISHER", source: "ARCHIVE+MEDIA", generated_at: now, site_url: siteUrl, archive_total: archive.count || articles.length, articles_published: articles.length, media_items: mediaDoc.count || 0 }, null, 2) + "\n", "utf8");

console.log(JSON.stringify({ articles_published: articles.length, archive_total: archive.count || articles.length, media_items: mediaDoc.count || 0, output: outDir, site_url: siteUrl }, null, 2));
