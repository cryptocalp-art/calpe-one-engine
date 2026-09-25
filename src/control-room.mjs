import fs from "node:fs/promises";
import path from "node:path";

const SITE_URL = (process.env.SITE_URL || "https://cryptocalp-art.github.io/calpe-one-engine").replace(/\/$/, "");
const OUT_DIR = "docs/control-room";
const REPORT_PATH = "data/control-room.json";
const now = new Date();

async function readJson(file, fallback = {}) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); }
  catch { return fallback; }
}

const esc = (value = "") => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

const madridDateKey = (value) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit"
}).format(new Date(value));

const fmtDateTime = (value) => {
  if (!value) return "Sin dato";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sin dato";
  return new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid",
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit"
  }).format(date);
};

const archive = await readJson("data/archive.json", { articles: [] });
const radar = await readJson("data/last-run.json", {});
const investigation = await readJson("data/investigation-last-run.json", {});
const writer = await readJson("data/writer-last-run.json", {});
const gateLast = await readJson("data/quality-gate-last-run.json", {});
const gate = await readJson("data/quality-gate.json", { decisions: [] });
const publisher = await readJson("data/publisher-last-run.json", {});
const archiveLast = await readJson("data/archive-last-run.json", {});
const mediaLast = await readJson("data/media-last-run.json", {});
const distributionLast = await readJson("data/distribution-last-run.json", {});
const distribution = await readJson("data/distribution.json", { queue: [] });
const safety = await readJson("data/production-safety-last-run.json", {});
const metaLast = await readJson("data/meta-delivery-last-run.json", {});
const metaState = await readJson("data/meta-production-state.json", {});
const metaDelivery = await readJson("data/meta-delivery.json", { deliveries: {} });

const articles = (archive.articles || [])
  .filter((x) => x.status === "PUBLISHED")
  .sort((a, b) => new Date(b.published_at || 0) - new Date(a.published_at || 0));

const todayKey = madridDateKey(now);
const sevenDaysAgo = now.getTime() - (7 * 24 * 60 * 60 * 1000);
const publishedToday = articles.filter((a) => a.published_at && madridDateKey(a.published_at) === todayKey).length;
const published7d = articles.filter((a) => new Date(a.published_at || 0).getTime() >= sevenDaysAgo).length;

const categoryCounts = {};
for (const article of articles) {
  const key = article.category || "OTROS";
  categoryCounts[key] = (categoryCounts[key] || 0) + 1;
}

const quarantine = (gate.decisions || []).filter((d) => d.status === "QUARANTINED");
const metaDeliveries = Object.entries(metaDelivery.deliveries || {});
const metaSentFb = metaDeliveries.filter(([key, value]) => key.endsWith(":FACEBOOK") && value?.status === "SENT").length;
const metaSentIg = metaDeliveries.filter(([key, value]) => key.endsWith(":INSTAGRAM") && value?.status === "SENT").length;
const distFailed = Number(distributionLast.failed || 0);
const metaFailed = Number(metaLast.failed || 0);
const safetyPass = safety.status === "PASS";
const metaEnabled = metaState.enabled === true && metaLast.enabled === true;
const identityClean = metaLast.identity_resolution_error == null;

let overall = "OPERATIVO";
let overallTone = "ok";
if (!safetyPass || distFailed > 0 || metaFailed > 0 || !identityClean) {
  overall = "ATENCIÓN";
  overallTone = "bad";
} else if (!metaEnabled || quarantine.length > 0) {
  overall = "OPERATIVO CON AVISOS";
  overallTone = "warn";
}

const generatedCandidates = [
  radar.generated_at, investigation.generated_at, writer.generated_at, gateLast.generated_at,
  archiveLast.generated_at, mediaLast.generated_at, distributionLast.generated_at,
  safety.generated_at, metaLast.generated_at, metaState.updated_at
].filter(Boolean).map((x) => new Date(x)).filter((x) => !Number.isNaN(x.getTime()));
const lastActivity = generatedCandidates.length ? new Date(Math.max(...generatedCandidates.map((x) => x.getTime()))).toISOString() : null;

const report = {
  engine: "CALPE ONE ENGINE",
  module: "CONTROL_ROOM",
  version: "control-room-v1",
  generated_at: now.toISOString(),
  overall_status: overall,
  last_activity: lastActivity,
  newspaper: {
    archive_total: articles.length,
    published_today: publishedToday,
    published_last_7_days: published7d,
    categories: categoryCounts,
    latest_articles: articles.slice(0, 8).map((a) => ({
      archive_id: a.archive_id,
      title: a.title,
      category: a.category,
      slug: a.slug,
      published_at: a.published_at
    }))
  },
  editorial_cycle: {
    radar_candidates: Number(radar.count ?? radar.candidates_found ?? 0),
    investigated: Number(investigation.processed ?? investigation.investigations_created ?? investigation.count ?? 0),
    drafts: Number(writer.drafts_created ?? writer.count ?? 0),
    eligible: Number(gateLast.eligible ?? 0),
    quarantined: Number(gateLast.quarantined ?? 0),
    archive_added: Number(archiveLast.added ?? 0)
  },
  delivery: {
    distribution_failed: distFailed,
    meta_enabled: metaEnabled,
    meta_failed_last_run: metaFailed,
    facebook_sent_total: metaSentFb,
    instagram_sent_total: metaSentIg,
    production_activated_at: metaState.production_activated_at || null,
    send_backlog: metaState.send_backlog === true
  },
  safety: {
    status: safety.status || "UNKNOWN",
    blocking_issues: safety.blocking_issues || [],
    npm_high: Number(safety?.checks?.npm_audit?.counts?.high || 0),
    npm_critical: Number(safety?.checks?.npm_audit?.counts?.critical || 0)
  },
  quarantine: quarantine.slice(0, 8).map((d) => ({
    draft_id: d.draft_id,
    slug: d.slug,
    category: d.category,
    reasons: d.reasons || [],
    evaluated_at: d.evaluated_at
  }))
};

function statusClass(ok, warn = false) {
  if (warn) return "warn";
  return ok ? "ok" : "bad";
}

function moduleCard(name, state, detail, tone = "ok") {
  return `<article class="module"><div class="module-head"><strong>${esc(name)}</strong><span class="pill ${tone}">${esc(state)}</span></div><div class="module-detail">${esc(detail)}</div></article>`;
}

const modules = [
  moduleCard("RADAR", radar.status === "success" ? "OK" : "REVISAR", `${Number(radar.count ?? 0)} candidatos en el último ciclo`, statusClass(radar.status === "success")),
  moduleCard("INVESTIGACIÓN", investigation.status === "success" ? "OK" : "REVISAR", `${Number(investigation.processed ?? investigation.count ?? 0)} procesadas`, statusClass(investigation.status === "success")),
  moduleCard("WRITER", writer.status === "success" ? "OK" : "REVISAR", `${Number(writer.drafts_created ?? 0)} borradores creados`, statusClass(writer.status === "success")),
  moduleCard("QUALITY GATE", gateLast.status === "success" ? "OK" : "REVISAR", `${Number(gateLast.eligible ?? 0)} elegibles · ${Number(gateLast.quarantined ?? 0)} en cuarentena`, statusClass(gateLast.status === "success", Number(gateLast.quarantined || 0) > 0)),
  moduleCard("ARCHIVE", archiveLast.status === "success" ? "OK" : "REVISAR", `${articles.length} noticias publicadas · ${Number(archiveLast.added ?? 0)} nuevas`, statusClass(archiveLast.status === "success")),
  moduleCard("MEDIA", mediaLast.status === "success" ? "OK" : "REVISAR", `${Number(mediaLast.media_items ?? mediaLast.count ?? articles.length)} elementos gestionados`, statusClass(mediaLast.status === "success")),
  moduleCard("DISTRIBUCIÓN", distFailed === 0 ? "OK" : "ERROR", `${Number(distributionLast.deliveries || 0)} entregas · ${distFailed} fallos`, statusClass(distFailed === 0)),
  moduleCard("PRODUCTION SAFETY", safetyPass ? "PASS" : "FAIL", `${Number(safety?.checks?.npm_audit?.counts?.high || 0)} high · ${Number(safety?.checks?.npm_audit?.counts?.critical || 0)} critical`, statusClass(safetyPass)),
  moduleCard("META", metaEnabled && identityClean ? "ACTIVO" : "REVISAR", `Facebook ${metaSentFb} · Instagram ${metaSentIg} · último fallo ${metaFailed}`, statusClass(metaEnabled && identityClean && metaFailed === 0))
].join("");

const latestRows = articles.slice(0, 8).map((a) => `<tr>
  <td><span class="cat">${esc(a.category || "LOCAL")}</span></td>
  <td><a href="${SITE_URL}/noticias/${encodeURIComponent(a.slug)}/">${esc(a.title)}</a></td>
  <td>${esc(fmtDateTime(a.published_at))}</td>
</tr>`).join("") || `<tr><td colspan="3">Aún no hay artículos.</td></tr>`;

const quarantineRows = quarantine.slice(0, 8).map((d) => `<tr>
  <td>${esc(d.category || "-")}</td>
  <td>${esc(d.slug || d.draft_id || "-")}</td>
  <td>${esc((d.reasons || []).join(", ") || "Sin motivo registrado")}</td>
</tr>`).join("") || `<tr><td colspan="3">No hay elementos en cuarentena en el último gate.</td></tr>`;

const categoryBars = Object.entries(categoryCounts)
  .sort((a, b) => b[1] - a[1])
  .map(([name, count]) => {
    const width = articles.length ? Math.max(4, Math.round((count / articles.length) * 100)) : 4;
    return `<div class="bar-row"><span>${esc(name)}</span><div class="bar"><i style="width:${width}%"></i></div><b>${count}</b></div>`;
  }).join("") || `<div class="empty">Sin categorías todavía.</div>`;

const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>CALPE ONE · Control Room</title>
<meta name="description" content="Panel operativo de CALPE ONE">
<style>
:root{--bg:#0b1020;--panel:#121a2c;--panel2:#182238;--line:#263451;--text:#edf3ff;--muted:#9fb0cc;--ok:#36d399;--warn:#f8c451;--bad:#ff6b7a;--accent:#6ea8ff}*{box-sizing:border-box}body{margin:0;background:linear-gradient(180deg,#080c18,#0d1424 50%,#0a1020);color:var(--text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,Segoe UI,Arial,sans-serif}.wrap{max-width:1280px;margin:auto;padding:28px 20px 60px}.top{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;margin-bottom:24px}.brand{font-size:32px;font-weight:900;letter-spacing:-1px}.subtitle{color:var(--muted);margin-top:5px}.state{display:flex;align-items:center;gap:10px;background:var(--panel);border:1px solid var(--line);border-radius:999px;padding:10px 14px;font-weight:800}.dot{width:10px;height:10px;border-radius:50%}.dot.ok{background:var(--ok);box-shadow:0 0 14px var(--ok)}.dot.warn{background:var(--warn);box-shadow:0 0 14px var(--warn)}.dot.bad{background:var(--bad);box-shadow:0 0 14px var(--bad)}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}.metric,.panel,.module{background:rgba(18,26,44,.92);border:1px solid var(--line);border-radius:16px}.metric{padding:20px}.metric .label{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;font-weight:800}.metric .value{font-size:36px;font-weight:900;margin-top:6px}.metric .hint{font-size:13px;color:var(--muted);margin-top:3px}.section-title{font-size:18px;font-weight:900;margin:28px 0 12px}.modules{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.module{padding:15px}.module-head{display:flex;justify-content:space-between;gap:10px;align-items:center}.module-detail{color:var(--muted);font-size:13px;margin-top:10px}.pill{font-size:11px;border-radius:999px;padding:5px 8px;font-weight:900}.pill.ok{color:#071a13;background:var(--ok)}.pill.warn{color:#211604;background:var(--warn)}.pill.bad{color:#26070b;background:var(--bad)}.two{display:grid;grid-template-columns:1.5fr 1fr;gap:14px}.panel{padding:18px;overflow:hidden}.panel h2{font-size:17px;margin:0 0 14px}table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;border-top:1px solid var(--line);padding:11px 8px;vertical-align:top}th{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.07em}a{color:#cfe0ff;text-decoration:none}a:hover{text-decoration:underline}.cat{color:var(--muted);font-weight:800;font-size:11px}.bar-row{display:grid;grid-template-columns:120px 1fr 32px;gap:9px;align-items:center;margin:11px 0;font-size:12px}.bar{height:9px;background:#25314a;border-radius:999px;overflow:hidden}.bar i{display:block;height:100%;background:linear-gradient(90deg,#528cff,#70d7ff);border-radius:999px}.quick{display:flex;gap:10px;flex-wrap:wrap}.quick a{display:inline-flex;background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:9px 11px;font-size:13px;font-weight:700}.foot{margin-top:24px;color:var(--muted);font-size:12px}.empty{color:var(--muted);font-size:13px}@media(max-width:900px){.grid{grid-template-columns:repeat(2,1fr)}.modules{grid-template-columns:1fr 1fr}.two{grid-template-columns:1fr}.top{flex-direction:column}}@media(max-width:560px){.grid,.modules{grid-template-columns:1fr}.metric .value{font-size:30px}.wrap{padding:20px 14px 45px}.bar-row{grid-template-columns:95px 1fr 28px}}
</style>
</head>
<body><main class="wrap">
<div class="top"><div><div class="brand">CALPE ONE · CONTROL ROOM</div><div class="subtitle">Estado operativo del periódico automático · actualización ${esc(fmtDateTime(now.toISOString()))}</div></div><div class="state"><span class="dot ${overallTone}"></span>${esc(overall)}</div></div>

<section class="grid">
  <div class="metric"><div class="label">Archivo publicado</div><div class="value">${articles.length}</div><div class="hint">noticias acumuladas</div></div>
  <div class="metric"><div class="label">Publicadas hoy</div><div class="value">${publishedToday}</div><div class="hint">hora de Calp</div></div>
  <div class="metric"><div class="label">Últimos 7 días</div><div class="value">${published7d}</div><div class="hint">ritmo editorial</div></div>
  <div class="metric"><div class="label">Cuarentena</div><div class="value">${quarantine.length}</div><div class="hint">último Quality Gate</div></div>
</section>

<div class="section-title">Motor editorial</div>
<section class="modules">${modules}</section>

<div class="section-title">Última actividad</div>
<section class="two">
  <div class="panel"><h2>Últimas noticias publicadas</h2><table><thead><tr><th>Categoría</th><th>Noticia</th><th>Publicación</th></tr></thead><tbody>${latestRows}</tbody></table></div>
  <div class="panel"><h2>Categorías</h2>${categoryBars}</div>
</section>

<div class="section-title">Control editorial</div>
<section class="two">
  <div class="panel"><h2>Elementos en cuarentena</h2><table><thead><tr><th>Categoría</th><th>Elemento</th><th>Motivo</th></tr></thead><tbody>${quarantineRows}</tbody></table></div>
  <div class="panel"><h2>Distribución</h2>
    <div class="bar-row"><span>Facebook</span><div class="bar"><i style="width:${Math.min(100, metaSentFb * 5)}%"></i></div><b>${metaSentFb}</b></div>
    <div class="bar-row"><span>Instagram</span><div class="bar"><i style="width:${Math.min(100, metaSentIg * 5)}%"></i></div><b>${metaSentIg}</b></div>
    <div class="bar-row"><span>Fallos último ciclo</span><div class="bar"><i style="width:${Math.min(100, (distFailed + metaFailed) * 20)}%"></i></div><b>${distFailed + metaFailed}</b></div>
    <p class="subtitle">Meta producción: <strong>${metaEnabled ? "ACTIVA" : "NO ACTIVA"}</strong><br>Backlog histórico: <strong>${metaState.send_backlog === true ? "ACTIVO" : "BLOQUEADO"}</strong><br>Activación: ${esc(fmtDateTime(metaState.production_activated_at))}</p>
  </div>
</section>

<div class="section-title">Accesos rápidos</div>
<div class="quick"><a href="${SITE_URL}/">Portada</a><a href="${SITE_URL}/noticias/">Noticias</a><a href="${SITE_URL}/rss.xml">RSS</a><a href="https://github.com/cryptocalp-art/calpe-one-engine/actions">GitHub Actions</a></div>
<div class="foot">Última actividad detectada: ${esc(fmtDateTime(lastActivity))} · Este panel muestra datos operativos agregados y no expone credenciales ni secretos.</div>
</main></body></html>`;

await fs.mkdir(OUT_DIR, { recursive: true });
await fs.mkdir(path.dirname(REPORT_PATH), { recursive: true });
await fs.writeFile(path.join(OUT_DIR, "index.html"), html, "utf8");
await fs.writeFile(REPORT_PATH, JSON.stringify(report, null, 2) + "\n", "utf8");

console.log(JSON.stringify({
  status: "success",
  version: "control-room-v1",
  overall_status: overall,
  archive_total: articles.length,
  published_today: publishedToday,
  quarantined: quarantine.length,
  meta_enabled: metaEnabled,
  distribution_failed: distFailed,
  meta_failed: metaFailed,
  output: `${OUT_DIR}/index.html`
}, null, 2));
