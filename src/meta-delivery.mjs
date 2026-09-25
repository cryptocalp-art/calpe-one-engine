import fs from "node:fs/promises";

const now = new Date().toISOString();
const graphVersion = process.env.META_GRAPH_VERSION || "v26.0";
const graphBase = `https://graph.facebook.com/${graphVersion}`;
const enabled = /^(1|true|yes)$/i.test(process.env.META_DELIVERY_ENABLED || "false");
const sendBacklog = /^(1|true|yes)$/i.test(process.env.META_SEND_BACKLOG || "false");
const testArchiveId = String(process.env.META_TEST_ARCHIVE_ID || "").trim();
const maxPerRun = Math.max(1, Math.min(20, Number(process.env.META_MAX_PER_RUN || 4)));
const pageId = String(process.env.META_PAGE_ID || "").trim();
const pageToken = String(process.env.META_PAGE_ACCESS_TOKEN || "").trim();
const igUserId = String(process.env.META_IG_USER_ID || "").trim();

const distributionPath = "data/distribution.json";
const statePath = "data/meta-delivery.json";
const lastRunPath = "data/meta-delivery-last-run.json";

const distribution = JSON.parse(await fs.readFile(distributionPath, "utf8"));
let assets = { items: [] };
let previous = { activated_at: null, deliveries: {} };
try { assets = JSON.parse(await fs.readFile("data/meta-assets.json", "utf8")); } catch {}
try { previous = JSON.parse(await fs.readFile(statePath, "utf8")); } catch {}

const assetByArchiveId = new Map((assets.items || []).map((x) => [x.archive_id, x]));
const safeRights = new Set(["CALPE_ONE_OWNED", "EXPLICIT_LICENSE_SIGNAL"]);
const hasFacebook = Boolean(pageId && pageToken);
const hasInstagram = Boolean(igUserId && pageToken);
const canActivate = enabled && (hasFacebook || hasInstagram);
const activationWasCreatedNow = canActivate && !previous.activated_at;
const activatedAt = previous.activated_at || (canActivate ? now : null);
const deliveryState = { ...(previous.deliveries || {}) };

function trimError(error) {
  const raw = String(error?.message || error || "UNKNOWN_ERROR");
  return raw
    .replaceAll(pageToken, pageToken ? "[REDACTED]" : "")
    .slice(0, 500);
}

async function parseResponse(res) {
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 500) }; }
  if (!res.ok || data?.error) {
    const msg = data?.error?.message || data?.raw || `HTTP ${res.status}`;
    const code = data?.error?.code ? ` code=${data.error.code}` : "";
    throw new Error(`META_API_ERROR ${res.status}${code}: ${msg}`);
  }
  return data;
}

async function postForm(url, params) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") body.set(key, String(value));
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body
  });
  return parseResponse(res);
}

async function getJson(url, params) {
  const u = new URL(url);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") u.searchParams.set(key, String(value));
  }
  return parseResponse(await fetch(u));
}

async function publishFacebook(item) {
  return postForm(`${graphBase}/${pageId}/feed`, {
    message: item.payload?.text || item.payload?.title,
    link: item.payload?.article_url,
    access_token: pageToken
  });
}

async function publishInstagram(item) {
  const asset = assetByArchiveId.get(item.archive_id);
  if (!asset?.instagram_ready || !asset?.meta_image_url) {
    throw new Error("INSTAGRAM_IMAGE_NOT_READY");
  }
  if (!safeRights.has(item.payload?.image_rights_status || asset.rights_status)) {
    throw new Error("UNSAFE_MEDIA_RIGHTS");
  }

  const captionBase = String(item.payload?.text || "").trim();
  const caption = captionBase.includes(item.payload?.article_url || "")
    ? captionBase
    : `${captionBase}\n\n${item.payload?.article_url || ""}`.trim();

  const created = await postForm(`${graphBase}/${igUserId}/media`, {
    image_url: asset.meta_image_url,
    caption,
    alt_text: item.payload?.image_alt || item.payload?.title || "CALPE ONE",
    access_token: pageToken
  });
  const creationId = created?.id;
  if (!creationId) throw new Error("INSTAGRAM_CONTAINER_ID_MISSING");

  let finished = false;
  let lastStatus = "UNKNOWN";
  for (let i = 0; i < 12; i++) {
    const status = await getJson(`${graphBase}/${creationId}`, {
      fields: "status_code,status",
      access_token: pageToken
    });
    lastStatus = status?.status_code || "UNKNOWN";
    if (lastStatus === "FINISHED") {
      finished = true;
      break;
    }
    if (["ERROR", "EXPIRED"].includes(lastStatus)) {
      throw new Error(`INSTAGRAM_CONTAINER_${lastStatus}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }
  if (!finished) throw new Error(`INSTAGRAM_CONTAINER_NOT_READY:${lastStatus}`);

  return postForm(`${graphBase}/${igUserId}/media_publish`, {
    creation_id: creationId,
    access_token: pageToken
  });
}

let attempted = 0;
let sent = 0;
let failed = 0;
let skipped = 0;
let preActivationSkipped = 0;
const channelStats = {
  FACEBOOK: { sent: 0, failed: 0, skipped: 0 },
  INSTAGRAM: { sent: 0, failed: 0, skipped: 0 }
};
const results = [];

for (const item of distribution.queue || []) {
  if (!["FACEBOOK", "INSTAGRAM"].includes(item.channel)) continue;

  const oldMeta = deliveryState[item.dedupe_key] || null;
  const hasCredentials = item.channel === "FACEBOOK" ? hasFacebook : hasInstagram;
  const isTestTarget = testArchiveId && item.archive_id === testArchiveId;
  const isPreActivation = activatedAt && new Date(item.created_at || 0) < new Date(activatedAt);
  const alreadySent = item.status === "SENT" || oldMeta?.status === "SENT";

  if (alreadySent) {
    skipped++;
    channelStats[item.channel].skipped++;
    results.push({ dedupe_key: item.dedupe_key, channel: item.channel, status: "ALREADY_SENT" });
    continue;
  }

  if (!enabled) {
    skipped++;
    channelStats[item.channel].skipped++;
    results.push({ dedupe_key: item.dedupe_key, channel: item.channel, status: "DELIVERY_DISABLED" });
    continue;
  }

  if (!hasCredentials) {
    skipped++;
    channelStats[item.channel].skipped++;
    results.push({ dedupe_key: item.dedupe_key, channel: item.channel, status: "CREDENTIALS_MISSING" });
    continue;
  }

  if (activationWasCreatedNow && !sendBacklog && !isTestTarget) {
    item.status = "SKIPPED";
    item.reason = "META_PRE_ACTIVATION_BACKLOG";
    item.adapter = "META_GRAPH_API";
    item.updated_at = now;
    deliveryState[item.dedupe_key] = {
      status: "SKIPPED",
      reason: "META_PRE_ACTIVATION_BACKLOG",
      updated_at: now
    };
    skipped++;
    preActivationSkipped++;
    channelStats[item.channel].skipped++;
    results.push({ dedupe_key: item.dedupe_key, channel: item.channel, status: "PRE_ACTIVATION_BACKLOG" });
    continue;
  }

  if (!sendBacklog && !isTestTarget && isPreActivation) {
    item.status = "SKIPPED";
    item.reason = "META_PRE_ACTIVATION_BACKLOG";
    item.adapter = "META_GRAPH_API";
    item.updated_at = now;
    skipped++;
    preActivationSkipped++;
    channelStats[item.channel].skipped++;
    results.push({ dedupe_key: item.dedupe_key, channel: item.channel, status: "PRE_ACTIVATION_BACKLOG" });
    continue;
  }

  if (testArchiveId && !isTestTarget) continue;
  if (attempted >= maxPerRun) continue;

  if (!safeRights.has(item.payload?.image_rights_status) && item.channel === "INSTAGRAM") {
    item.status = "FAILED";
    item.reason = "UNSAFE_MEDIA_RIGHTS";
    item.last_error = "UNSAFE_MEDIA_RIGHTS";
    item.updated_at = now;
    failed++;
    channelStats[item.channel].failed++;
    results.push({ dedupe_key: item.dedupe_key, channel: item.channel, status: "FAILED", error: "UNSAFE_MEDIA_RIGHTS" });
    continue;
  }

  attempted++;
  const startedAt = new Date().toISOString();
  try {
    const response = item.channel === "FACEBOOK"
      ? await publishFacebook(item)
      : await publishInstagram(item);
    const externalId = response?.id || null;

    item.status = "SENT";
    item.reason = null;
    item.adapter = "META_GRAPH_API";
    item.sent_at = now;
    item.updated_at = now;
    item.attempts = Number(item.attempts || 0) + 1;
    item.last_error = null;
    item.external_id = externalId;

    deliveryState[item.dedupe_key] = {
      status: "SENT",
      channel: item.channel,
      external_id: externalId,
      attempted_at: startedAt,
      sent_at: now,
      updated_at: now
    };
    sent++;
    channelStats[item.channel].sent++;
    results.push({ dedupe_key: item.dedupe_key, channel: item.channel, status: "SENT", external_id: externalId });
  } catch (error) {
    const message = trimError(error);
    item.status = "FAILED";
    item.reason = "META_DELIVERY_FAILED";
    item.adapter = "META_GRAPH_API";
    item.updated_at = now;
    item.attempts = Number(item.attempts || 0) + 1;
    item.last_error = message;

    deliveryState[item.dedupe_key] = {
      status: "FAILED",
      channel: item.channel,
      attempted_at: startedAt,
      last_error: message,
      updated_at: now
    };
    failed++;
    channelStats[item.channel].failed++;
    results.push({ dedupe_key: item.dedupe_key, channel: item.channel, status: "FAILED", error: message });
  }
}

const state = {
  engine: "CALPE ONE ENGINE",
  module: "META_DELIVERY",
  version: "meta-delivery-v1",
  activated_at: activatedAt,
  updated_at: now,
  configuration: {
    enabled,
    graph_version: graphVersion,
    facebook_configured: hasFacebook,
    instagram_configured: hasInstagram,
    send_backlog: sendBacklog,
    max_per_run: maxPerRun
  },
  policy: {
    existing_backlog_is_not_sent_on_first_activation: true,
    only_sent_after_api_confirmation: true,
    sent_items_are_not_republished: true,
    instagram_requires_safe_jpeg_asset: true,
    political_copy_is_inherited_from_neutral_distribution_payload: true
  },
  stats: { attempted, sent, failed, skipped, pre_activation_skipped: preActivationSkipped },
  channel_stats: channelStats,
  deliveries: deliveryState,
  last_results: results.slice(-100)
};

await fs.writeFile(distributionPath, JSON.stringify(distribution, null, 2) + "\n", "utf8");
await fs.writeFile(statePath, JSON.stringify(state, null, 2) + "\n", "utf8");
await fs.writeFile(
  lastRunPath,
  JSON.stringify({
    status: failed > 0 ? "partial" : "success",
    generated_at: now,
    enabled,
    facebook_configured: hasFacebook,
    instagram_configured: hasInstagram,
    activated_at: activatedAt,
    attempted,
    sent,
    failed,
    skipped,
    pre_activation_skipped: preActivationSkipped
  }, null, 2) + "\n",
  "utf8"
);

console.log(JSON.stringify({
  enabled,
  facebook_configured: hasFacebook,
  instagram_configured: hasInstagram,
  activated_at: activatedAt,
  attempted,
  sent,
  failed,
  skipped,
  pre_activation_skipped: preActivationSkipped
}, null, 2));
