import fs from "node:fs/promises";

const configPath = "config/meta-production.json";
const deliveryStatePath = "data/meta-delivery.json";
const productionStatePath = "data/meta-production-state.json";
const isTrue = (value) => /^(1|true|yes)$/i.test(String(value || ""));

async function readJson(path, fallback = {}) {
  try { return JSON.parse(await fs.readFile(path, "utf8")); }
  catch { return fallback; }
}

const config = await readJson(configPath, {});
const productionRun = isTrue(process.env.META_PRODUCTION_RUN);
const liveTest = isTrue(process.env.META_LIVE_TEST) && Boolean(String(process.env.META_TEST_ARCHIVE_ID || "").trim());
const safety = await readJson("data/production-safety-last-run.json", {});
let productionState = await readJson(productionStatePath, {
  version: "meta-production-state-v1",
  production_activated_at: null
});

if (productionRun) {
  const requested = config.activation_requested === true;
  const enabled = requested && config.enabled === true && config.block_until_token_rotated !== true;
  const safetyRequired = config.require_production_safety_pass !== false;
  const safetyPass = safety.status === "PASS" && safety.ready_for_meta_activation === true;

  if (enabled && safetyRequired && !safetyPass) {
    throw new Error("META_PRODUCTION_BLOCKED_BY_PRODUCTION_SAFETY");
  }

  process.env.META_DELIVERY_ENABLED = enabled ? "true" : "false";
  process.env.META_SEND_BACKLOG = config.send_backlog === true ? "true" : "false";
  process.env.META_MAX_PER_RUN = String(config.max_per_run || 4);
  process.env.META_TEST_ARCHIVE_ID = "";

  if (enabled && !productionState.production_activated_at) {
    const legacy = await readJson(deliveryStatePath, {});
    const sanitized = {
      engine: "CALPE ONE ENGINE",
      module: "META_DELIVERY",
      version: "meta-delivery-v2",
      activated_at: null,
      updated_at: new Date().toISOString(),
      configuration: {
        enabled: false,
        graph_version: legacy?.configuration?.graph_version || process.env.META_GRAPH_VERSION || "v26.0",
        facebook_configured: false,
        instagram_configured: false,
        send_backlog: false,
        max_per_run: Number(config.max_per_run || 4),
        test_archive_id: null,
        resolved_page_id: null,
        resolved_instagram_user_id: null,
        identity_warnings: [],
        identity_resolution_error: null
      },
      policy: {
        existing_backlog_is_not_sent_on_first_activation: true,
        only_sent_after_api_confirmation: true,
        sent_items_are_not_republished: true,
        instagram_requires_safe_jpeg_asset: true,
        political_copy_is_inherited_from_neutral_distribution_payload: true,
        page_and_instagram_ids_are_resolved_from_page_token_when_enabled: true
      },
      stats: { attempted: 0, sent: 0, failed: 0, skipped: 0, pre_activation_skipped: 0 },
      channel_stats: {
        FACEBOOK: { sent: 0, failed: 0, skipped: 0 },
        INSTAGRAM: { sent: 0, failed: 0, skipped: 0 }
      },
      deliveries: {},
      last_results: []
    };
    await fs.writeFile(deliveryStatePath, JSON.stringify(sanitized, null, 2) + "\n", "utf8");
  }
} else if (liveTest) {
  process.env.META_DELIVERY_ENABLED = "true";
  process.env.META_SEND_BACKLOG = "false";
  process.env.META_MAX_PER_RUN = "2";
} else {
  process.env.META_DELIVERY_ENABLED = "false";
  process.env.META_SEND_BACKLOG = "false";
}

// Never allow configured ID secrets to be persisted while delivery is disabled.
if (!isTrue(process.env.META_DELIVERY_ENABLED)) {
  process.env.META_PAGE_ID = "";
  process.env.META_IG_USER_ID = "";
}

await import("./meta-delivery.mjs");

if (productionRun && isTrue(process.env.META_DELIVERY_ENABLED)) {
  const delivery = await readJson(deliveryStatePath, {});
  const activatedAt = delivery.activated_at || new Date().toISOString();
  productionState = {
    version: "meta-production-state-v1",
    production_activated_at: productionState.production_activated_at || activatedAt,
    updated_at: new Date().toISOString(),
    enabled: true,
    send_backlog: false,
    channels: Array.isArray(config.channels) ? config.channels : ["FACEBOOK", "INSTAGRAM"]
  };
  await fs.writeFile(productionStatePath, JSON.stringify(productionState, null, 2) + "\n", "utf8");
}
