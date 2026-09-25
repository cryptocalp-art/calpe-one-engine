import fs from "node:fs/promises";
import path from "node:path";

const inputPath = "data/vento-export.json";
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
const bodyToHtml = (body = "") => body.split(/\n\s*\n/).filter(Boolean).map(p => `<p>${esc(p.trim())}</p>`).join("\n");

const sourceList = (sources = []) => sources.map(s => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.name)}</a> <span class="source-type">${esc(s.type || "")}</span></li>`).join("\n");

const shell = ({ title, description, canonical, content, jsonLd = null }) => `<!doctype html>
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
<style>
:root{--ink:#101820;--muted:#667085;--line:#d9dde3;--paper:#fff;--accent:#0b4f6c;--soft:#f5f7fa}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:Georgia,'Times New Roman',serif;line-height:1.65}a{color:var(--accent)}header{border-bottom:1px solid var(--line)}.top{max-width:1120px;margin:auto;padding:24px 20px 18px}.brand{font:800 34px/1 Arial,sans-serif;letter-spacing:-1.4px;color:var(--ink);text-decoration:none}.tag{font:13px/1.4 Arial,sans-serif;color:var(--muted);margin-top:7px}.nav{border-top:1px solid var(--line);font:700 13px Arial,sans-serif}.nav div{max-width:1120px;margin:auto;padding:10px 20px;display:flex;gap:18px}.nav a{text-decoration:none;color:var(--ink)}main{max-width:1120px;margin:auto;padding:30px 20px 60px}.hero{border-bottom:2px solid var(--ink);padding-bottom:18px;margin-bottom:28px}.kicker,.meta,.source-type{font:700 12px Arial,sans-serif;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}h1{font-size:clamp(36px,6vw,64px);line-height:1.02;letter-spacing:-1.5px;margin:10px 0 14px}h2{line-height:1.12}.dek{font-size:22px;line-height:1.35;color:#303642;max-width:900px}.article{max-width:760px}.article p{font-size:19px;margin:0 0 1.15em}.note{background:var(--soft);border-left:4px solid var(--accent);padding:16px 18px;margin:28px 0}.sources{border-top:1px solid var(--line);margin-top:34px;padding-top:20px}.sources li{margin-bottom:8px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:28px}.card{border-top:3px solid var(--ink);padding-top:14px}.card h2{font-size:27px;margin:8px 0}.card p{color:#343a46}.card a{text-decoration:none;color:var(--ink)}footer{border-top:1px solid var(--line);font:13px Arial,sans-serif;color:var(--muted)}footer div{max-width:1120px;margin:auto;padding:22px 20px}@media(max-width:600px){h1{font-size:40px}.dek{font-size:19px}.article p{font-size:18px}}
</style>
${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd).replaceAll("<", "\\u003c")}</script>` : ""}
</head>
<body>
<header><div class="top"><a class="brand" href="${siteUrl}/">CALPE ONE</a><div class="tag">Una ciudad. Más de 150 nacionalidades. Una comunidad.</div></div><nav class="nav"><div><a href="${siteUrl}/">Portada</a><a href="${siteUrl}/noticias/">Noticias</a><a href="${siteUrl}/rss.xml">RSS</a></div></nav></header>
<main>${content}</main>
<footer><div>CALPE ONE · Información local con trazabilidad de fuentes · Generado por CALPE ONE ENGINE</div></footer>
</body></html>`;

const raw = JSON.parse(await fs.readFile(inputPath, "utf8"));
const articles = (raw.ready || [])
  .map(x => x.calpe_news_candidate)
  .filter(Boolean)
  .filter(a => a.slug && a.title && a.body && a.provenance?.investigation_status === "VERIFIED")
  .filter(a => Number(a.provenance?.supported_claim_count || 0) >= 2)
  .filter(a => Number(a.provenance?.evidence_count || 0) >= 1)
  .map(a => ({...a, published_at: a.published_at || a.created_at || raw.generated_at || now}));

await fs.rm(outDir, { recursive: true, force: true });
await fs.mkdir(path.join(outDir, "noticias"), { recursive: true });

for (const a of articles) {
  const url = `${siteUrl}/noticias/${a.slug}/`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: a.title,
    description: a.meta_description || a.summary,
    datePublished: a.published_at,
    dateModified: now,
    mainEntityOfPage: url,
    author: { "@type": "Organization", name: "CALPE ONE" },
    publisher: { "@type": "Organization", name: "CALPE ONE" }
  };
  const caveats = (a.provenance?.caveats || []).length ? `<div class="note"><strong>Nota de verificación</strong><br>${(a.provenance.caveats || []).map(esc).join("<br>")}</div>` : "";
  const content = `<article class="article"><div class="hero"><div class="kicker">${esc(a.category || "LOCAL")}</div><h1>${esc(a.title)}</h1><div class="dek">${esc(a.summary || "")}</div><div class="meta">Publicado ${esc(fmtDate(a.published_at))} · Verificación ${esc(a.provenance?.confidence || "")}</div></div>${bodyToHtml(a.body)}${caveats}<section class="sources"><h2>Fuentes consultadas</h2><ul>${sourceList(a.sources || [])}</ul></section></article>`;
  const dir = path.join(outDir, "noticias", a.slug);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "index.html"), shell({ title: a.seo_title || a.title, description: a.meta_description || a.summary, canonical: url, content, jsonLd }));
}

const cards = articles.map(a => `<article class="card"><div class="kicker">${esc(a.category || "LOCAL")}</div><h2><a href="${siteUrl}/noticias/${esc(a.slug)}/">${esc(a.title)}</a></h2><p>${esc(a.summary || "")}</p><div class="meta">${esc(fmtDate(a.published_at))}</div></article>`).join("\n");
const listing = `<div class="hero"><div class="kicker">CALPE ONE NEWS</div><h1>Noticias de Calp</h1><div class="dek">Información local investigada y redactada a partir de fuentes trazables.</div></div><section class="grid">${cards}</section>`;
await fs.writeFile(path.join(outDir, "index.html"), shell({title:"CALPE ONE · Noticias de Calp",description:"Noticias de Calp investigadas y verificadas por CALPE ONE.",canonical:`${siteUrl}/`,content:listing}));
await fs.writeFile(path.join(outDir, "noticias", "index.html"), shell({title:"Noticias · CALPE ONE",description:"Últimas noticias verificadas de Calp.",canonical:`${siteUrl}/noticias/`,content:listing}));

const rssItems = articles.slice(0, 30).map(a => `<item><title>${xml(a.title)}</title><link>${siteUrl}/noticias/${xml(a.slug)}/</link><guid>${siteUrl}/noticias/${xml(a.slug)}/</guid><pubDate>${new Date(a.published_at).toUTCString()}</pubDate><description>${xml(a.summary || "")}</description></item>`).join("\n");
const rss = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>CALPE ONE</title><link>${siteUrl}/</link><description>Noticias verificadas de Calp</description><language>es-es</language>${rssItems}</channel></rss>`;
await fs.writeFile(path.join(outDir, "rss.xml"), rss);

const urls = [`${siteUrl}/`, `${siteUrl}/noticias/`, ...articles.map(a => `${siteUrl}/noticias/${a.slug}/`)];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(u => `<url><loc>${xml(u)}</loc></url>`).join("")}</urlset>`;
await fs.writeFile(path.join(outDir, "sitemap.xml"), sitemap);
await fs.writeFile(path.join(outDir, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${siteUrl}/sitemap.xml\n`);
await fs.writeFile(path.join(outDir, ".nojekyll"), "");
await fs.writeFile(path.join(outDir, "build-info.json"), JSON.stringify({engine:"CALPE ONE ENGINE",module:"WEB_PUBLISHER",generated_at:now,site_url:siteUrl,articles_published:articles.length},null,2)+"\n");

console.log(JSON.stringify({articles_published:articles.length,output:outDir,site_url:siteUrl},null,2));