import fs from "node:fs/promises";

const now = new Date().toISOString();
const graphVersion = process.env.META_GRAPH_VERSION || "v26.0";
const graphBase = `https://graph.facebook.com/${graphVersion}`;
const pageId = String(process.env.META_PAGE_ID || "").trim();
const pageToken = String(process.env.META_PAGE_ACCESS_TOKEN || "").trim();
const igUserId = String(process.env.META_IG_USER_ID || "").trim();

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
  version: "meta-check-v1",
  generated_at: now,
  graph_version: graphVersion,
  configured: {
    page_id: Boolean(pageId),
    page_access_token: Boolean(pageToken),
    instagram_user_id: Boolean(igUserId)
  },
  checks: {
    page_identity: "NOT_RUN",
    page_id_match: false,
    instagram_link: "NOT_RUN",
    instagram_id_match: false,
    instagram_identity: "NOT_RUN"
  },
  page: null,
  instagram: null,
  status: "FAIL",
  errors: []
};

if (!pageId) result.errors.push("META_PAGE_ID_MISSING");
if (!pageToken) result.errors.push("META_PAGE_ACCESS_TOKEN_MISSING");
if (!igUserId) result.errors.push("META_IG_USER_ID_MISSING");

if (result.errors.length === 0) {
  try {
    const pageMe = await getJson("me", { fields: "id,name" });
    result.checks.page_identity = "PASS";
    result.checks.page_id_match = String(pageMe?.id || "") === pageId;
    result.page = { id: pageMe?.id || null, name: pageMe?.name || null };
    if (!result.checks.page_id_match) result.errors.push("PAGE_TOKEN_DOES_NOT_MATCH_META_PAGE_ID");
  } catch (error) {
    result.checks.page_identity = "FAIL";
    result.errors.push(redact(error?.message || String(error)));
  }

  try {
    const page = await getJson(pageId, { fields: "id,name,instagram_business_account" });
    const linkedIgId = String(page?.instagram_business_account?.id || "");
    result.checks.instagram_link = linkedIgId ? "PASS" : "FAIL";
    result.checks.instagram_id_match = linkedIgId === igUserId;
    if (!linkedIgId) result.errors.push("PAGE_HAS_NO_INSTAGRAM_BUSINESS_ACCOUNT");
    else if (!result.checks.instagram_id_match) result.errors.push("INSTAGRAM_ID_DOES_NOT_MATCH_PAGE_LINK");
  } catch (error) {
    result.checks.instagram_link = "FAIL";
    result.errors.push(redact(error?.message || String(error)));
  }

  try {
    const ig = await getJson(igUserId, { fields: "id,username" });
    result.checks.instagram_identity = "PASS";
    result.instagram = { id: ig?.id || null, username: ig?.username || null };
  } catch (error) {
    result.checks.instagram_identity = "FAIL";
    result.errors.push(redact(error?.message || String(error)));
  }
}

const allPass = result.checks.page_identity === "PASS"
  && result.checks.page_id_match
  && result.checks.instagram_link === "PASS"
  && result.checks.instagram_id_match
  && result.checks.instagram_identity === "PASS"
  && result.errors.length === 0;

result.status = allPass ? "PASS" : "FAIL";

await fs.writeFile("data/meta-connection-check.json", JSON.stringify(result, null, 2) + "\n", "utf8");

console.log(JSON.stringify({
  status: result.status,
  configured: result.configured,
  checks: result.checks,
  page: result.page,
  instagram: result.instagram,
  errors: result.errors
}, null, 2));

if (!allPass) process.exitCode = 1;
