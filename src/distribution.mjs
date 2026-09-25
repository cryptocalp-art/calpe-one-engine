import fs from "node:fs/promises";
import crypto from "node:crypto";

const now = new Date().toISOString();
const siteUrl = (process.env.SITE_URL || "https://cryptocalp-art.github.io/calpe-one-engine").replace(/\/$/, "");
const archive = JSON.parse(await fs.readFile("data/archive.json", "utf8"));
let media = { items: [] };
let previous = { queue: [] };
let rss = "";

try { media = JSON.parse(await fs.readFile("data/media.json", "utf8")); } catch {}
try { previous = JSON.parse(await fs.readFile("data/distribution.json", "utf8")); } catch {}
try { rss = await fs.readFile("docs/rss.xml", "utf8"); } catch {}

const mediaByArchiveId = new Map((media.items || []).map((x) => [x.archive_id, x]));
const previousByKey = new Map((previous.queue || []).map((x) => [x.dedupe_key, x]));

const channels = [
  { id: "RSS", enabled: true, adapter: "NATIVE_RSS", auto_send: true, note: "Published by CALPE ONE WEB PUBLISHER" },
  { id: "FACEBOOK", enabled: false, adapter: "CONNECTOR_REQUIRED", auto_send: false, note: "Awaiting authenticated connector" },
  { id: "INSTAGRAM", enabled: false, adapter: "CONNECTOR_REQUIRED", auto_send: false, note: "Awaiting authenticated connector" },
  { id: "X", enabled: false, adapter: "CONNECTOR_REQUIRED", auto_send: false, note: "Awaiting authenticated connector" },
  { id: "TELEGRAM", enabled: false, adapter: "CONNECTOR_REQUIRED", auto_send: false, note: "Awaiting authenticated connector" },
  { id: "WHATSAPP", enabled: false, adapter: "CONNECTOR_REQUIRED", auto_send: false, note: "Awaiting authenticated connector" },
  { id: "DISCORD", enabled: false, adapter: "CONNECTOR_REQUIRED", auto_send: false, note: "Awaiting authenticated connector" }
];

function absoluteUrl(value = "") {
  if (!value) return null;
  try { return new URL(value, `${siteUrl}/`).toString(); } catch { return null; }
}

function clip(text = "", max = 220) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function makePayload(article, mediaItem, channel) {
  const articleUrl = `${siteUrl}/noticias/${article.slug}/`;
  const imageUrl = absoluteUrl(mediaItem?.selected?.image_url || "");
  const summary = clip(article.summary || "", 320);
  const title = article.title;
  const hashtags = "#Calp #Calpe #CALPEONE";

  let text = `${title}\n\n${summary}\n\n${articleUrl}`;
  if (channel === "X") text = `${clip(title, 180)}\n${articleUrl}\n${hashtags}`;
  if (channel === "INSTAGRAM") text = `${title}\n\n${summary}\n\n${hashtags}`;
  if (channel === "TELEGRAM") text = `📰 ${title}\n\n${summary}\n\n${articleUrl}`;
  if (channel === "WHATSAPP") text = `📰 *${title}*\n\n${summary}\n\n${articleUrl}`;
  if (channel === "DISCORD") text = `**${title}**\n${summary}\n${articleUrl}`;

  return {
    title,
    summary,
    text,
    article_url: articleUrl,
    image_url: imageUrl,
    image_alt: mediaItem?.selected?.alt || null,
    image_credit: mediaItem?.selected?.credit || null,
    image_label: mediaItem?.selected?.label || null,
    image_rights_status: mediaItem?.selected?.rights_status || null
  };
}

const queue = [];
let sent = 0;
let pending = 0;
let failed = 0;
let skipped = 0;

for (const article of archive.articles || []) {
  if (article.status !== "PUBLISHED") continue;
  const mediaItem = mediaByArchiveId.get(article.archive_id);

  for (const channel of channels) {
    const dedupeKey = `${article.archive_id}:${channel.id}`;
    const old = previousByKey.get(dedupeKey);
    const payload = makePayload(article, mediaItem, channel.id);
    const distributionId = old?.distribution_id || `dst_${crypto.createHash("sha256").update(dedupeKey).digest("hex").slice(0, 16)}`;

    let status;
    let reason = null;
    let sentAt = old?.sent_at || null;

    if (old?.status === "SENT") {
      status = "SENT";
    } else if (channel.id === "RSS") {
      const inFeed = Boolean(rss) && (rss.includes(`<guid>${payload.article_url}</guid>`) || rss.includes(`<link>${payload.article_url}</link>`));
      if (inFeed) {
        status = "SENT";
        sentAt = sentAt || now;
      } else {
        status = "FAILED";
        reason = "ARTICLE_NOT_FOUND_IN_RSS";
      }
    } else if (!channel.enabled) {
      status = "SKIPPED";
      reason = "CONNECTOR_NOT_CONFIGURED";
    } else {
      status = "PENDING";
      reason = "READY_FOR_DELIVERY";
    }

    if (status === "SENT") sent++;
    else if (status === "PENDING") pending++;
    else if (status === "FAILED") failed++;
    else if (status === "SKIPPED") skipped++;

    queue.push({
      distribution_id: distributionId,
      dedupe_key: dedupeKey,
      archive_id: article.archive_id,
      slug: article.slug,
      category: article.category,
      channel: channel.id,
      adapter: channel.adapter,
      status,
      reason,
      payload,
      created_at: old?.created_at || now,
      updated_at: now,
      sent_at: sentAt,
      attempts: Number(old?.attempts || 0),
      last_error: old?.last_error || null,
      engine_version: "distribution-v1"
    });
  }
}

const output = {
  engine: "CALPE ONE ENGINE",
  module: "DISTRIBUTION",
  version: "distribution-v1",
  generated_at: now,
  archive_version: archive.version || null,
  media_version: media.version || null,
  site_url: siteUrl,
  policy: {
    dedupe_by_archive_and_channel: true,
    resend_sent_items: false,
    external_channels_require_authenticated_connector: true,
    unsafe_media_never_forced: true,
    political_copy_policy: "Neutral factual copy derived only from the published article; no endorsements or rankings"
  },
  channels,
  stats: {
    articles: (archive.articles || []).filter((x) => x.status === "PUBLISHED").length,
    deliveries: queue.length,
    sent,
    pending,
    failed,
    skipped
  },
  queue
};

await fs.writeFile("data/distribution.json", JSON.stringify(output, null, 2) + "\n", "utf8");
await fs.writeFile(
  "data/distribution-last-run.json",
  JSON.stringify({ status: failed > 0 ? "partial" : "success", generated_at: now, ...output.stats }, null, 2) + "\n",
  "utf8"
);

console.log(JSON.stringify(output.stats, null, 2));
