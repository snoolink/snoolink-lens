import fs from "node:fs/promises";
import path from "node:path";

import { extractImageMetadata } from "../local-image-metadata-extractor.js";
import {
  extractVideoMetadata,
  buildSearchMetadata as buildVideoSearchMetadata,
  VIDEO_EXTENSIONS,
} from "../local-video-metadata-extractor.js";
import { buildSimilarityGroupsFromLocalTargets } from "../local-group-by.js";

const dataDir = path.join(process.cwd(), "data");
const masterPath = path.join(dataDir, "master_image_directory.json");
const localPath = path.join(dataDir, "local-image_metadata_results.json");
const localGroupsPath = path.join(dataDir, "local_index_groups.json");

function getMediaTypeFromPath(filePath, fallback = "image") {
  const ext = path.extname(String(filePath || "")).toLowerCase();
  if (VIDEO_EXTENSIONS.has(ext)) {
    return "video";
  }
  return fallback;
}

function gcd(a, b) {
  let x = Math.abs(Number(a) || 0);
  let y = Math.abs(Number(b) || 0);
  while (y) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

function toAspectRatioString(width, height) {
  const w = Number(width);
  const h = Number(height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return "";
  }
  const d = gcd(w, h);
  return `${Math.round(w / d)}:${Math.round(h / d)}`;
}

function parseAspectRatioString(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  const match = raw.match(/^(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)$/);
  if (!match) {
    return "";
  }
  const left = Number(match[1]);
  const right = Number(match[2]);
  if (!Number.isFinite(left) || !Number.isFinite(right) || left <= 0 || right <= 0) {
    return "";
  }
  const scale = 1000;
  return toAspectRatioString(Math.round(left * scale), Math.round(right * scale));
}

function normalizeAspectRatioFromMeta(localMeta) {
  const candidates = [
    localMeta?.filtering?.aspectRatio,
    localMeta?.image_info?.aspect_ratio_string,
    localMeta?.video_info?.aspect_ratio_string,
    localMeta?.video_info?.display_aspect_ratio,
    localMeta?.video_info?.aspect_ratio,
  ];

  for (const candidate of candidates) {
    const parsed = parseAspectRatioString(candidate);
    if (parsed) {
      return parsed;
    }
  }

  const width = localMeta?.image_info?.width ?? localMeta?.video_info?.width;
  const height = localMeta?.image_info?.height ?? localMeta?.video_info?.height;
  return toAspectRatioString(width, height);
}

function buildResolutionMegapixelsLabel(localMeta) {
  if (localMeta?.filtering?.resolutionMegapixels) {
    return String(localMeta.filtering.resolutionMegapixels);
  }
  const width = Number(localMeta?.image_info?.width ?? localMeta?.video_info?.width);
  const height = Number(localMeta?.image_info?.height ?? localMeta?.video_info?.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return "";
  }

  const mp = (width * height) / 1_000_000;
  return `${Math.round(width)}x${Math.round(height)} (~${mp.toFixed(2)}mp)`;
}

function buildSearchMetadataFromLocal(localMetadata, mediaPath) {
  const mediaType = String(localMetadata?.media_type || getMediaTypeFromPath(mediaPath, "image"));
  const colorRows = Array.isArray(localMetadata?.color_analysis?.dominant_colors)
    ? localMetadata.color_analysis.dominant_colors
    : [];
  const dominantColors = colorRows
    .map((row) => row?.hex || null)
    .filter(Boolean)
    .slice(0, 5);

  const filtering = localMetadata?.filtering && typeof localMetadata.filtering === "object"
    ? localMetadata.filtering
    : {};

  const resolutionMegapixels = String(
    filtering?.resolutionMegapixels || buildResolutionMegapixelsLabel(localMetadata) || "",
  );
  const aspectRatio = String(
    filtering?.aspectRatio || normalizeAspectRatioFromMeta(localMetadata) || "",
  );
  const orientation = String(
    filtering?.orientation || localMetadata?.image_info?.orientation || localMetadata?.video_info?.orientation || "",
  ).toLowerCase();

  const tags = [
    String(localMetadata?.image_info?.format || "").toLowerCase(),
    orientation,
    String(localMetadata?.image_info?.size_category || "").toLowerCase(),
    String(localMetadata?.source?.likely_source || "").toLowerCase(),
    String(localMetadata?.color_analysis?.brightness_category || "").toLowerCase(),
    String(filtering?.durationBucket || "").toLowerCase(),
    String(filtering?.audioType || "").toLowerCase(),
    String(filtering?.motionLevel || "").toLowerCase(),
  ].filter(Boolean);

  return {
    title: String(localMetadata?.name || path.basename(mediaPath, path.extname(mediaPath)) || `Untitled ${mediaType}`),
    description: String(
      localMetadata?.source?.likely_source
        ? `Source: ${localMetadata.source.likely_source}`
        : `${mediaType === "video" ? "Video" : "Image"} from ${path.dirname(mediaPath)}`,
    ),
    tags,
    objects: Array.isArray(localMetadata?.ai_analysis?.objects_detected) ? localMetadata.ai_analysis.objects_detected : [],
    style: String(localMetadata?.source?.likely_source || "unknown"),
    dominant_colors: dominantColors,
    contains_people: localMetadata?.ai_analysis?.contains_people === true,
    contains_text: localMetadata?.content_hints?.might_contain_text === true,
    media_type: mediaType,
    resolution_megapixels: resolutionMegapixels,
    aspect_ratio: aspectRatio,
    orientation,
    duration_bucket: String(filtering?.durationBucket || ""),
    fps: Number.isFinite(Number(filtering?.fps)) ? Number(filtering.fps) : null,
    has_audio: filtering?.hasAudio === true,
    audio_type: String(filtering?.audioType || ""),
    has_captions: filtering?.hasCaptions === true,
    motion_level: String(filtering?.motionLevel || ""),
  };
}

function applyLocalGroupingToRows(rows) {
  const allRows = Array.isArray(rows) ? rows : [];
  const targetPaths = allRows
    .map((row) => String(row?.path || "").trim())
    .filter(Boolean);

  const grouping = buildSimilarityGroupsFromLocalTargets(targetPaths, allRows);
  const updatedRows = allRows.map((row) => {
    const rowPath = String(row?.path || "").trim();
    const group = grouping.byPath.get(rowPath);
    const localMeta = row?.local_metadata && typeof row.local_metadata === "object"
      ? { ...row.local_metadata }
      : row?.local_metadata;

    if (localMeta && group) {
      localMeta.grouping = {
        group_id: group.group_id,
        representative_path: group.representative,
        member_paths: [...group.members],
        member_count: group.members.length,
        role: rowPath === group.representative ? "representative" : "member",
      };
    }

    return {
      ...row,
      similar_group_id: group?.group_id || null,
      similar_group_representative_path: group?.representative || null,
      similar_group_member_count: Array.isArray(group?.members) ? group.members.length : 0,
      similar_group_member_paths: Array.isArray(group?.members) ? [...group.members] : [],
      similar_group_role: group ? (rowPath === group.representative ? "representative" : "member") : null,
      local_metadata: localMeta,
    };
  });

  return {
    rows: updatedRows,
    groups: grouping.groups,
  };
}

async function main() {
  const master = JSON.parse(await fs.readFile(masterPath, "utf-8"));
  const items = Array.isArray(master?.items) ? master.items : [];

  if (items.length === 0) {
    throw new Error("No master directory items found.");
  }

  try {
    await fs.access(localPath);
    const backupPath = path.join(dataDir, `local-image_metadata_results.backup.${Date.now()}.json`);
    await fs.copyFile(localPath, backupPath);
    console.log(`Backup created: ${backupPath}`);
  } catch {
    // No prior local file.
  }

  const rows = [];
  let okCount = 0;
  let failCount = 0;

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i] || {};
    const mediaPath = String(item.path || "").trim();
    if (!mediaPath) {
      continue;
    }

    const mediaType = String(item.media_type || getMediaTypeFromPath(mediaPath, "image")).toLowerCase();
    const baseInfo = {
      id: Number(item.id),
      path: mediaPath,
      size_bytes: item.size_bytes ?? null,
      created_at: item.created_at ?? null,
      modified_at: item.modified_at ?? null,
      first_seen_at: item.first_seen_at ?? new Date().toISOString(),
      last_seen_at: item.last_seen_at ?? new Date().toISOString(),
    };

    let status = "ok";
    let error = "";
    let localMetadata = null;
    let metadata = {
      title: path.basename(mediaPath, path.extname(mediaPath)) || `Untitled ${mediaType}`,
      description: `${mediaType === "video" ? "Video" : "Image"} from ${path.dirname(mediaPath)}`,
      tags: [],
      objects: [],
      style: mediaType,
      dominant_colors: [],
      contains_people: false,
      contains_text: false,
      media_type: mediaType,
    };

    try {
      if (mediaType === "video") {
        localMetadata = await extractVideoMetadata(mediaPath, baseInfo);
        metadata = localMetadata?.search_metadata && typeof localMetadata.search_metadata === "object"
          ? { ...localMetadata.search_metadata, media_type: "video" }
          : { ...buildVideoSearchMetadata(localMetadata, mediaPath), media_type: "video" };
      } else {
        localMetadata = await extractImageMetadata(mediaPath, baseInfo);
        metadata = buildSearchMetadataFromLocal(localMetadata, mediaPath);
      }
    } catch (err) {
      status = "failed";
      error = String(err?.message || err);
    }

    rows.push({
      id: Number(item.id),
      path: mediaPath,
      status,
      metadata,
      embedding: [],
      media_type: mediaType,
      local_metadata: localMetadata,
      cloud_metadata: null,
      error,
    });

    if (status === "ok") {
      okCount += 1;
    } else {
      failCount += 1;
    }

    if ((i + 1) % 20 === 0 || i + 1 === items.length) {
      console.log(`Processed ${i + 1}/${items.length} (ok=${okCount}, failed=${failCount})`);
    }
  }

  const grouped = applyLocalGroupingToRows(rows);
  const payload = {
    model: "local-metadata-extractor-v1",
    prefix: "local",
    indexing_mode: "local",
    generated_at: new Date().toISOString(),
    results: grouped.rows,
  };

  await fs.writeFile(localPath, JSON.stringify(payload, null, 2), "utf-8");

  const groupingPayload = {
    generated_at: new Date().toISOString(),
    total_images: grouped.rows.length,
    group_count: grouped.groups.length,
    groups: grouped.groups,
  };
  await fs.writeFile(localGroupsPath, JSON.stringify(groupingPayload, null, 2), "utf-8");

  console.log(`WROTE ${localPath} rows=${grouped.rows.length} ok=${okCount} failed=${failCount}`);
  console.log(`WROTE ${localGroupsPath} groups=${grouped.groups.length}`);
}

main().catch((error) => {
  console.error(String(error?.stack || error));
  process.exit(1);
});
