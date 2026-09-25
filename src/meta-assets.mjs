import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const now = new Date().toISOString();
const siteUrl = (process.env.SITE_URL || "https://cryptocalp-art.github.io/calpe-one-engine").replace(/\/$/, "");
const media = JSON.parse(await fs.readFile("data/media.json", "utf8"));

const outDir = "docs/media";
await fs.mkdir(outDir, { recursive: true });

function absoluteUrl(value = "") {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  return `${siteUrl}${value.startsWith("/") ? "" : "/"}${value}`;
}

function isJpegUrl(value = "") {
  try {
    const u = new URL(value);
    return /\.(jpe?g)$/i.test(u.pathname);
  } catch {
    return false;
  }
}

const items = [];
let generated = 0;
let instagramReady = 0;
let unavailable = 0;

for (const item of media.items || []) {
  const selected = item?.selected || {};
  let metaImageUrl = absoluteUrl(selected.image_url || "");
  let localJpeg = null;
  let ready = false;
  let reason = null;

  if (selected.mode === "EDITORIAL_CARD") {
    const svgPath = path.join(outDir, `${item.archive_id}.svg`);
    const jpgPath = path.join(outDir, `${item.archive_id}.jpg`);
    try {
      const svg = await fs.readFile(svgPath);
      await sharp(svg)
        .flatten({ background: "#ffffff" })
        .jpeg({ quality: 90, mozjpeg: true })
        .toFile(jpgPath);
      localJpeg = jpgPath;
      metaImageUrl = `${siteUrl}/media/${item.archive_id}.jpg`;
      ready = true;
      generated++;
    } catch (error) {
      reason = `JPEG_GENERATION_FAILED: ${String(error?.message || error).slice(0, 240)}`;
    }
  } else if (selected.mode === "LICENSED_REMOTE" && isJpegUrl(metaImageUrl || "")) {
    ready = true;
  } else {
    reason = "NO_META_COMPATIBLE_JPEG";
  }

  if (ready) instagramReady++;
  else unavailable++;

  items.push({
    archive_id: item.archive_id,
    media_id: item.media_id,
    slug: item.slug,
    media_mode: selected.mode || null,
    rights_status: selected.rights_status || null,
    source_image_url: absoluteUrl(selected.image_url || ""),
    meta_image_url: metaImageUrl,
    local_jpeg: localJpeg,
    instagram_ready: ready,
    reason,
    generated_at: now,
    engine_version: "meta-assets-v1"
  });
}

const output = {
  engine: "CALPE ONE ENGINE",
  module: "META_ASSETS",
  version: "meta-assets-v1",
  generated_at: now,
  site_url: siteUrl,
  count: items.length,
  stats: {
    jpeg_generated: generated,
    instagram_ready: instagramReady,
    unavailable
  },
  items
};

await fs.writeFile("data/meta-assets.json", JSON.stringify(output, null, 2) + "\n", "utf8");
await fs.writeFile(
  "data/meta-assets-last-run.json",
  JSON.stringify({ status: unavailable > 0 ? "partial" : "success", generated_at: now, ...output.stats }, null, 2) + "\n",
  "utf8"
);

console.log(JSON.stringify({ meta_assets: items.length, ...output.stats }, null, 2));
