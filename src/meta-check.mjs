import fs from "node:fs/promises";

const now = new Date().toISOString();
const graphVersion = process.env.META_GRAPH_VERSION || "v26.0";
const graphBase = `https://graph.facebook.com/${graphVersion}`;
const configuredPageId = String(process.env.META_PAGE_ID || "").trim();
const pageToken = String(process.env.META_PAGE_ACCESS_TOKEN || "").trim();
const configuredIgUserId = String(process.env.META_IG_USER_ID || "").trim();

function redact(value) {
  if (!value) return value;
  if (pageToken) value = String(value).replaceAll(pageToken, "[REDACTED]");
  return value;
}

async function getJson(path, params = {}) {
  const url = new URL(`${graphBase}/${path.replace(/^\//, "")}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  if (pageToken) url.searchParams.set("access_token", pageToken);
  const res = await fetch(url);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 500) }; }
  if (!res.ok || data?.error) {
    const message = data?.error?.message || data?.raw || `HTTP ${res.status}`;
    const code = data?.error?.code ? ` code=${data.error.code}` : "";
    throw new Error(redact(`META_API_ERROR ${res.status}${code}: ${message}`));
  }
  return data;
}

const result = {
  engine: "CALPE ONE ENGINE",
  module: "META_CONNECTION_CHECK",
  version: "meta-check-v2",
  generated_at: now,
  graph_version: graphVersion,
  configured: {
    page_id_present: Boolean(configuredPageId),
    page_access_token: Boolean(pageToken),
    instagram_user_id_present: Boolean(configuredIgUserId)
  },
  checks: {
    page_identity: "NOT_RUN",
    configured_page_id_match: null,
    instagram_link: "NOT_RUN",
    configured_instagram_id_match: null,
    instagram_identity: "NOT_RUN"
  },
  resolved: {
    page_id: null,
    instagram_user_id: null
  },
  page: null,
  instagram: null,
  status: "FAIL",
  warnings: [],
  errors: []
};

if (!pageToken) result.errors.push("META_PAGE_ACCESS_TOKEN_MISSING");

if (result.errors.length === 0) {
  let resolvedIgId = "";

  try {
    const pageMe = await getJson("me", { fields: "id,name,instagram_business_account" });
    const resolvedPageId = String(pageMe?.id || "");
    resolvedIgId = String(pageMe?.instagram_business_account?.id || "");

    result.checks.page_identity = resolvedPageId ? "PASS" : "FAIL";
    result.page = { id: resolvedPageId || null, name: pageMe?.name || null };
    result.resolved.page_id = resolvedPageId || null;
    result.resolved.instagram_user_id = resolvedIgId || null;

    if (!resolvedPageId) result.errors.push("PAGE_ID_NOT_RESOLVED_FROM_TOKEN");

    if (configuredPageId) {
      result.checks.configured_page_id_match = configuredPageId === resolvedPageId;
      if (!result.checks.configured_page_id_match) {
        result.warnings.push("CONFIGURED_META_PAGE_ID_DIFFERS_FROM_TOKEN_DERIVED_ID");
      }
    }

    result.checks.instagram_link = resolvedIgId ? "PASS" : "FAIL";
    if (!resolvedIgId) result.errors.push("PAGE_HAS_NO_INSTAGRAM_BUSINESS_ACCOUNT_OR_PERMISSION");

    if (configuredIgUserId) {
      result.checks.configured_instagram_id_match = configuredIgUserId === resolvedIgId;
      if (!result.checks.configured_instagram_id_match) {
        result.warnings.push("CONFIGURED_META_IG_USER_ID_DIFFERS_FROM_TOKEN_DERIVED_ID");
      }
    }
  } catch (error) {
    result.checks.page_identity = "FAIL";
    result.checks.instagram_link = "FAIL";
    result.errors.push(redact(error?.message || String(error)));
  }

  if (resolvedIgId) {
    try {
      const ig = await getJson(resolvedIgId, { fields: "id,username" });
      result.checks.instagram_identity = "PASS";
      result.instagram = { id: ig?.id || null, username: ig?.username || null };
    } catch (error) {
      result.checks.instagram_identity = "FAIL";
      result.errors.push(redact(error?.message || String(error)));
    }
  }
}

const allPass = result.checks.page_identity === "PASS"
  && result.checks.instagram_link === "PASS"
  && result.checks.instagram_identity === "PASS"
  && result.errors.length === 0;

result.status = allPass ? "PASS" : "FAIL";

await fs.writeFile("data/meta-connection-check.json", JSON.stringify(result, null, 2) + "\n", "utf8");

console.log(JSON.stringify({
  status: result.status,
  configured: result.configured,
  checks: result.checks,
  resolved: result.resolved,
  page: result.page,
  instagram: result.instagram,
  warnings: result.warnings,
  errors: result.errors
}, null, 2));

if (!allPass) process.exitCode = 1;
