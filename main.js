import { app, BrowserWindow, ipcMain, dialog, shell, clipboard, nativeImage } from "electron";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import { createHash } from "node:crypto";
import { runSemanticSearch, validateMetadataFile } from "./searchEngine.js";
import { getMediaTypeFromPath } from "./previewVideo.js";
import { registerScanHandlers } from "./scanManager.js";
import {
  buildSimilarityGroupsFromLocalTargets,
  buildCloudGroupsFromLocalTargets,
} from "./local-group-by.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const nodeRequire = createRequire(import.meta.url);
const WORKSPACE_DATA_DIR_PATH = path.join(process.cwd(), "data");
const MODULE_DATA_DIR_PATH = path.join(__dirname, "data");
const USER_DATA_DIR_PATH = path.join(app.getPath("userData"), "data");
const DEV_MODE = !app.isPackaged && fsSync.existsSync(path.join(process.cwd(), "package.json"));
const DATA_DIR_PATH = app.isPackaged
  ? USER_DATA_DIR_PATH
  : DEV_MODE
    ? WORKSPACE_DATA_DIR_PATH
    : MODULE_DATA_DIR_PATH;
const MASTER_DIRECTORY_PATH = path.join(DATA_DIR_PATH, "master_image_directory.json");
const ALBUMS_DATA_PATH = path.join(DATA_DIR_PATH, "albums_data.json");
const USER_SETTINGS_PATH = path.join(DATA_DIR_PATH, "app_settings.json");
const LEGACY_USER_SETTINGS_PATH = path.join(DATA_DIR_PATH, "user_settings.json");
const LEGACY_USER_SETTINGS_SJON_PATH = path.join(DATA_DIR_PATH, "user_setting.sjon");
const ENV_FILE_PATH = app.isPackaged
  ? path.join(app.getPath("userData"), ".env")
  : DEV_MODE
    ? path.join(__dirname, ".env")
    : path.join(app.getPath("userData"), ".env");
const BUNDLED_ENV_SEED_PATH = app.isPackaged
  ? path.join(process.resourcesPath, "config", "default.env")
  : path.join(__dirname, "config", "default.env");
const DEFAULT_ENV_TEMPLATE = [
  "AWS_REGION=us-east-1",
  "AWS_ACCESS_KEY_ID=",
  "AWS_SECRET_ACCESS_KEY=",
  "BEDROCK_VISION_MODEL=qwen.qwen3-vl-235b-a22b",
].join("\n");
const LOCAL_EXTRACTOR_MODULE_CANDIDATES = [
  path.join(__dirname, "local-image-metadata-extractor.js"),
  path.join(__dirname, "image-metadata-extractor.js"),
];
const LOCAL_VIDEO_EXTRACTOR_MODULE_PATH = path.join(__dirname, "local-video-metadata-extractor.js");
const CLOUD_EXTRACTOR_MODULE_PATH = path.join(__dirname, "cloud-image-metadata-extractor.js");
const CLOUD_VIDEO_EXTRACTOR_MODULE_PATH = path.join(__dirname, "cloud-video-metadata-extractor.js");
const PREVIEW_CONVERTIBLE_EXTENSIONS = new Set([".heic", ".heif", ".avif", ".tif", ".tiff"]);
const PREVIEW_CACHE_DIR_PATH = path.join(DATA_DIR_PATH, "preview-cache");
const CLOUD_GROUPS_OUTPUT_PATH = path.join(DATA_DIR_PATH, "cloud_index_groups.json");
const LOCAL_GROUPS_OUTPUT_PATH = path.join(DATA_DIR_PATH, "local_index_groups.json");
const LOCAL_FACE_CLUSTERS_OUTPUT_PATH = path.join(DATA_DIR_PATH, "local_face_clusters.json");
const SEARCH_HISTORY_PATH = path.join(DATA_DIR_PATH, "search_history.json");
const MAX_SEARCH_HISTORY_ENTRIES = 10000;

const IMAGE_FILE_TYPES = [
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".svg",
  ".tiff",
  ".heic",
  ".heif",
  ".avif",
];
const VIDEO_FILE_TYPES = [
  ".mp4",
  ".m4v",
  ".mov",
  ".mkv",
  ".webm",
  ".avi",
  ".wmv",
  ".flv",
  ".mpeg",
  ".mpg",
  ".m2v",
  ".mts",
  ".m2ts",
  ".3gp",
  ".3g2",
  ".ogv",
  ".asf",
  ".vob",
  ".rm",
  ".rmvb",
  ".f4v",
  ".mxf",
  ".dv",
];
const EXTENDED_FILE_TYPES = [".bmp"];
const FALLBACK_INDEXABLE_FILE_TYPES = new Set([
  ...IMAGE_FILE_TYPES,
  ...VIDEO_FILE_TYPES,
  ...EXTENDED_FILE_TYPES,
]);

const indexState = {
  running: false,
  paused: false,
  cancelled: false,
  lastResult: null,
};

function sendToRenderer(channel, payload) {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win || win.isDestroyed()) {
    return;
  }
  win.webContents.send(channel, payload);
}

async function waitWhilePaused(state) {
  while (state.paused && !state.cancelled) {
    await new Promise((resolve) => setTimeout(resolve, 180));
  }
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function cloneJsonSafe(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

async function appendSearchHistoryEntry(entry) {
  const safeEntry = entry && typeof entry === "object" ? entry : {};

  const nextRow = {
    id: createHash("sha1")
      .update(`${Date.now()}-${Math.random()}-${String(safeEntry?.query || "")}`)
      .digest("hex")
      .slice(0, 16),
    timestamp: new Date().toISOString(),
    query: String(safeEntry?.query || ""),
    file_path: String(safeEntry?.filePath || ""),
    top_k: Number.isFinite(Number(safeEntry?.topK)) ? Number(safeEntry.topK) : null,
    min_score: Number.isFinite(Number(safeEntry?.minScore)) ? Number(safeEntry.minScore) : null,
    filters: cloneJsonSafe(safeEntry?.filters) || {},
    allowed_image_paths_count: Number.isFinite(Number(safeEntry?.allowedImagePathsCount))
      ? Number(safeEntry.allowedImagePathsCount)
      : 0,
    result_ok: safeEntry?.result?.ok === true,
    filtered_count: Number.isFinite(Number(safeEntry?.result?.filteredCount))
      ? Number(safeEntry.result.filteredCount)
      : 0,
    shown_count: Array.isArray(safeEntry?.result?.results)
      ? safeEntry.result.results.length
      : 0,
    error_message: safeEntry?.result?.ok === false
      ? String(safeEntry?.result?.message || "")
      : "",
    query_expansion: cloneJsonSafe(safeEntry?.result?.queryExpansion) || null,
  };

  let existing = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    total: 0,
    entries: [],
  };

  if (await pathExists(SEARCH_HISTORY_PATH)) {
    try {
      const parsed = JSON.parse(await fs.readFile(SEARCH_HISTORY_PATH, "utf-8"));
      if (parsed && typeof parsed === "object") {
        existing = {
          schema_version: Number(parsed.schema_version || 1),
          generated_at: String(parsed.generated_at || existing.generated_at),
          total: Number(parsed.total || 0),
          entries: Array.isArray(parsed.entries) ? parsed.entries : [],
        };
      }
    } catch {
      // Recreate file if unreadable.
    }
  }

  const entries = Array.isArray(existing.entries) ? existing.entries : [];
  entries.push(nextRow);
  const trimmed = entries.length > MAX_SEARCH_HISTORY_ENTRIES
    ? entries.slice(entries.length - MAX_SEARCH_HISTORY_ENTRIES)
    : entries;

  const payload = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    total: trimmed.length,
    entries: trimmed,
  };

  await fs.mkdir(DATA_DIR_PATH, { recursive: true });
  await fs.writeFile(SEARCH_HISTORY_PATH, JSON.stringify(payload, null, 2), "utf-8");
}

function makeMetadataForMedia(filePath, mediaType = "image") {
  const base = path.basename(filePath, path.extname(filePath));
  const normalized = base.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  const words = normalized.split(" ").filter(Boolean);
  const mediaLabel = mediaType === "video" ? "video" : "image";
  const title = words.length > 0 ? normalized : `Untitled ${mediaLabel}`;

  return {
    title,
    description: `${mediaType === "video" ? "Video" : "Image"} from ${path.dirname(filePath)}`,
    tags: words.slice(0, 10),
    objects: [],
    style: mediaType,
    dominant_colors: [],
    contains_people: false,
    contains_text: false,
    media_type: mediaType,
  };
}

function canUseLocalMetadataFallback(filePath) {
  const ext = path.extname(String(filePath || "")).toLowerCase();
  return FALLBACK_INDEXABLE_FILE_TYPES.has(ext);
}

function buildFallbackLocalMetadata(mediaPath, fallbackReason, mediaType = "image") {
  const baseName = path.basename(mediaPath, path.extname(mediaPath));
  const normalizedName = baseName.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  const format = path.extname(mediaPath).replace(".", "").toLowerCase();
  return {
    status: "metadata_fallback",
    name: normalizedName || baseName || `Untitled ${mediaType}`,
    media_type: mediaType,
    source: {
      likely_source: "fallback",
      path: mediaPath,
    },
    image_info: {
      format,
      orientation: "unknown",
      size_category: "unknown",
    },
    color_analysis: {
      brightness_category: "unknown",
      dominant_colors: [],
    },
    ai_analysis: {
      objects_detected: [],
      contains_people: false,
    },
    content_hints: {
      might_contain_text: false,
    },
    filtering: {
      resolutionMegapixels: "",
      aspectRatio: "",
      orientation: "unknown",
      durationBucket: mediaType === "video" ? "unknown" : "",
      fps: null,
      hasAudio: mediaType === "video" ? false : null,
      audioType: mediaType === "video" ? "silent" : "",
      hasCaptions: mediaType === "video" ? false : null,
      motionLevel: mediaType === "video" ? "unknown" : "",
    },
    processing: {
      warnings: [String(fallbackReason || "Extractor fallback used.")],
      errors: [],
    },
  };
}

function toPreviewSrc(filePath) {
  return `file:///${String(filePath || "").replaceAll("\\", "/")}`;
}

async function loadMasterDirectory() {
  try {
    const text = await fs.readFile(MASTER_DIRECTORY_PATH, "utf-8");
    const payload = JSON.parse(text);
    if (Array.isArray(payload)) {
      return { items: payload };
    }
    if (Array.isArray(payload?.items)) {
      return payload;
    }
    return { items: [] };
  } catch {
    return { items: [] };
  }
}

async function loadAlbumsData() {
  const defaults = {
    generated_at: new Date().toISOString(),
    albums: [],
    image_album_map: {},
  };

  try {
    const text = await fs.readFile(ALBUMS_DATA_PATH, "utf-8");
    const payload = JSON.parse(text);
    return {
      generated_at: String(payload?.generated_at || defaults.generated_at),
      albums: Array.isArray(payload?.albums) ? payload.albums : [],
      image_album_map:
        payload?.image_album_map && typeof payload.image_album_map === "object"
          ? payload.image_album_map
          : {},
    };
  } catch {
    return defaults;
  }
}

async function saveAlbumsData(payload) {
  const normalizedAlbums = Array.isArray(payload?.albums)
    ? payload.albums
        .map((album) => ({
          id: Number(album?.id),
          name: String(album?.name || "").trim(),
          created_at: String(album?.created_at || new Date().toISOString()),
          updated_at: String(album?.updated_at || new Date().toISOString()),
        }))
        .filter((album) => Number.isFinite(album.id) && album.name)
    : [];

  const imageAlbumMap = {};
  const rawMap = payload?.image_album_map && typeof payload.image_album_map === "object"
    ? payload.image_album_map
    : {};

  for (const [imagePath, albumIds] of Object.entries(rawMap)) {
    const normalizedPath = String(imagePath || "").trim();
    if (!normalizedPath) {
      continue;
    }
    const normalizedIds = Array.isArray(albumIds)
      ? Array.from(new Set(albumIds.map((id) => Number(id)).filter((id) => Number.isFinite(id))))
      : [];
    if (normalizedIds.length > 0) {
      imageAlbumMap[normalizedPath] = normalizedIds;
    }
  }

  const nextPayload = {
    generated_at: new Date().toISOString(),
    albums: normalizedAlbums,
    image_album_map: imageAlbumMap,
  };

  await fs.mkdir(DATA_DIR_PATH, { recursive: true });
  await fs.writeFile(ALBUMS_DATA_PATH, JSON.stringify(nextPayload, null, 2), "utf-8");
  return nextPayload;
}

async function ensureAlbumsDataFileExists() {
  if (await pathExists(ALBUMS_DATA_PATH)) {
    return;
  }
  await saveAlbumsData({ albums: [], image_album_map: {} });
}

function computeAlbumImageCounts(albumsData) {
  const counts = new Map();
  const albums = Array.isArray(albumsData?.albums) ? albumsData.albums : [];
  for (const album of albums) {
    counts.set(Number(album.id), 0);
  }

  const imageMap = albumsData?.image_album_map || {};
  for (const albumIds of Object.values(imageMap)) {
    const uniqIds = new Set(Array.isArray(albumIds) ? albumIds : []);
    for (const id of uniqIds) {
      const numericId = Number(id);
      if (counts.has(numericId)) {
        counts.set(numericId, Number(counts.get(numericId) || 0) + 1);
      }
    }
  }

  return counts;
}

function nextAlbumId(albums) {
  let nextId = 1;
  for (const album of albums) {
    const numericId = Number(album?.id);
    if (Number.isFinite(numericId) && numericId >= nextId) {
      nextId = numericId + 1;
    }
  }
  return nextId;
}

async function createAlbumByName(name) {
  const normalizedName = String(name || "").trim();
  if (!normalizedName) {
    return { ok: false, message: "Album name is required." };
  }

  const data = await loadAlbumsData();
  const existing = data.albums.find((album) => String(album?.name || "").toLowerCase() === normalizedName.toLowerCase());
  if (existing) {
    return { ok: true, album: existing, alreadyExists: true };
  }

  const album = {
    id: nextAlbumId(data.albums),
    name: normalizedName,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  data.albums.push(album);
  const saved = await saveAlbumsData(data);
  const counts = computeAlbumImageCounts(saved);
  return {
    ok: true,
    album: {
      ...album,
      image_count: Number(counts.get(album.id) || 0),
    },
    path: ALBUMS_DATA_PATH,
  };
}

async function assignImagePathsToAlbums(imagePaths, albumIds) {
  const normalizedPaths = Array.isArray(imagePaths)
    ? Array.from(new Set(imagePaths.map((value) => String(value || "").trim()).filter(Boolean)))
    : [];
  const normalizedAlbumIds = Array.isArray(albumIds)
    ? Array.from(new Set(albumIds.map((id) => Number(id)).filter((id) => Number.isFinite(id))))
    : [];

  if (normalizedPaths.length === 0 || normalizedAlbumIds.length === 0) {
    return { ok: true, assignedCount: 0 };
  }

  const data = await loadAlbumsData();
  const validAlbumIds = new Set(data.albums.map((album) => Number(album.id)));
  const targetAlbumIds = normalizedAlbumIds.filter((id) => validAlbumIds.has(id));

  if (targetAlbumIds.length === 0) {
    return { ok: false, message: "No valid albums selected." };
  }

  let assignedCount = 0;
  for (const imagePath of normalizedPaths) {
    const existingIds = Array.isArray(data.image_album_map[imagePath]) ? data.image_album_map[imagePath] : [];
    const nextIds = new Set(existingIds.map((id) => Number(id)).filter((id) => Number.isFinite(id)));
    const before = nextIds.size;
    for (const albumId of targetAlbumIds) {
      nextIds.add(albumId);
    }
    if (nextIds.size !== before) {
      assignedCount += 1;
    }
    data.image_album_map[imagePath] = Array.from(nextIds);
  }

  await saveAlbumsData(data);
  return { ok: true, assignedCount, albumIds: targetAlbumIds, path: ALBUMS_DATA_PATH };
}

function filterItemsByAlbumIds(items, albumData, albumIds) {
  const normalizedIds = Array.isArray(albumIds)
    ? albumIds.map((id) => Number(id)).filter((id) => Number.isFinite(id))
    : [];
  if (normalizedIds.length === 0) {
    return items;
  }

  const idSet = new Set(normalizedIds);
  const map = albumData?.image_album_map || {};

  return items.filter((item) => {
    const imagePath = String(item?.path || "").trim();
    if (!imagePath) {
      return false;
    }
    const linkedIds = Array.isArray(map[imagePath]) ? map[imagePath] : [];
    return linkedIds.some((id) => idSet.has(Number(id)));
  });
}

async function buildMasterDirectoryItem(filePath, existingItem, id) {
  let stats = null;
  try {
    stats = await fs.stat(filePath);
  } catch {
    return null;
  }

  const ext = path.extname(filePath).toLowerCase();
  const mediaType = getMediaTypeFromPath(filePath, "image");
  const name = path.basename(filePath);
  const createdAt = stats.birthtime ? new Date(stats.birthtime).toISOString() : null;
  const modifiedAt = stats.mtime ? new Date(stats.mtime).toISOString() : null;

  return {
    id,
    path: filePath,
    preview_src: toPreviewSrc(filePath),
    name,
    extension: ext,
    media_type: mediaType,
    directory: path.dirname(filePath),
    size_bytes: Number(stats.size || 0),
    created_at: createdAt,
    modified_at: modifiedAt,
    first_seen_at: existingItem?.first_seen_at || new Date().toISOString(),
    last_seen_at: new Date().toISOString(),
    status: "ok",
  };
}

async function updateMasterDirectoryFromScan(files) {
  await fs.mkdir(DATA_DIR_PATH, { recursive: true });

  const existingPayload = await loadMasterDirectory();
  const existingItems = Array.isArray(existingPayload?.items) ? existingPayload.items : [];
  const existingByPath = new Map(existingItems.map((item) => [item.path, item]));

  let nextId = 1;
  for (const item of existingItems) {
    const currentId = Number(item?.id || 0);
    if (currentId >= nextId) {
      nextId = currentId + 1;
    }
  }

  const mergedItemsByPath = new Map(existingItems.map((item) => [item.path, item]));
  let newItems = 0;
  let refreshedItems = 0;

  for (const filePath of files) {
    const existing = existingByPath.get(filePath);
    const id = existing?.id || nextId++;
    const item = await buildMasterDirectoryItem(filePath, existing, id);
    if (!item) {
      continue;
    }

    if (existing) {
      refreshedItems += 1;
    } else {
      newItems += 1;
    }

    mergedItemsByPath.set(filePath, item);
  }

  const mergedItems = Array.from(mergedItemsByPath.values()).sort(
    (a, b) => Number(a?.id || 0) - Number(b?.id || 0),
  );

  const payload = {
    generated_at: new Date().toISOString(),
    total: mergedItems.length,
    new_items: newItems,
    refreshed_items: refreshedItems,
    items: mergedItems,
  };

  await fs.writeFile(MASTER_DIRECTORY_PATH, JSON.stringify(payload, null, 2), "utf-8");

  return {
    path: MASTER_DIRECTORY_PATH,
    total: payload.total,
    newItems,
    refreshedItems,
  };
}

async function writeCloudIndexFile(results, modelLabel) {
  const payload = {
    model: modelLabel,
    prefix: "cloud",
    indexing_mode: "cloud",
    generated_at: new Date().toISOString(),
    results,
  };

  await fs.mkdir(DATA_DIR_PATH, { recursive: true });
  const target = path.join(DATA_DIR_PATH, "cloud-image_metadata_results.json");
  await fs.writeFile(target, JSON.stringify(payload, null, 2), "utf-8");
  return target;
}

async function loadLocalIndexRows() {
  const localFilePath = path.join(DATA_DIR_PATH, "local-image_metadata_results.json");
  if (!(await pathExists(localFilePath))) {
    return [];
  }

  try {
    const payload = JSON.parse(await fs.readFile(localFilePath, "utf-8"));
    return Array.isArray(payload?.results) ? payload.results : [];
  } catch {
    return [];
  }
}


async function writeCloudGroupingFile(payload) {
  await fs.mkdir(DATA_DIR_PATH, { recursive: true });
  await fs.writeFile(CLOUD_GROUPS_OUTPUT_PATH, JSON.stringify(payload, null, 2), "utf-8");
  return CLOUD_GROUPS_OUTPUT_PATH;
}

async function writeLocalGroupingFile(payload) {
  await fs.mkdir(DATA_DIR_PATH, { recursive: true });
  await fs.writeFile(LOCAL_GROUPS_OUTPUT_PATH, JSON.stringify(payload, null, 2), "utf-8");
  return LOCAL_GROUPS_OUTPUT_PATH;
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

function normalizeFaceClusterDistanceThreshold(value) {
  const threshold = Number(value);
  if (!Number.isFinite(threshold)) {
    return 0.2;
  }
  return Math.max(0.05, Math.min(1, threshold));
}

function normalizeFaceModelVersion(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return "face-api-ssd-v1";
  }

  const aliases = new Map([
    ["face-api-ssd-v1", "face-api-ssd-v1"],
    ["ssd", "face-api-ssd-v1"],
    ["ssd-v1", "face-api-ssd-v1"],
    ["ssd-mobilenet", "face-api-ssd-v1"],
    ["ssd-mobilenet-v1", "face-api-ssd-v1"],
    ["face-api-tiny-v1", "face-api-tiny-v1"],
    ["tiny", "face-api-tiny-v1"],
    ["tiny-v1", "face-api-tiny-v1"],
    ["tinyfacedetector", "face-api-tiny-v1"],
    // Backward compatibility for previously stored placeholder value.
    ["insightface-arcface-v1", "face-api-tiny-v1"],
  ]);

  return aliases.get(normalized) || "face-api-ssd-v1";
}

function normalizeFaceEmbedding(value) {
  const vector = Array.isArray(value) ? value.map((n) => Number(n)) : [];
  const filtered = vector.filter((n) => Number.isFinite(n));
  if (filtered.length === 0) {
    return null;
  }
  const magnitude = Math.sqrt(filtered.reduce((sum, n) => sum + (n * n), 0));
  if (!Number.isFinite(magnitude) || magnitude <= 0) {
    return null;
  }
  return filtered.map((n) => n / magnitude);
}

function cosineDistance(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) {
    return Number.POSITIVE_INFINITY;
  }
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
  }
  return 1 - dot;
}

function sanitizePersonLabel(value) {
  const label = String(value || "").trim();
  return label;
}

function applyFaceClusteringToRows(rows, settings) {
  const allRows = Array.isArray(rows) ? rows : [];
  const threshold = normalizeFaceClusterDistanceThreshold(settings?.clusterDistanceThreshold);
  const clonedRows = allRows.map((row) => {
    const localMeta = row?.local_metadata && typeof row.local_metadata === "object"
      ? { ...row.local_metadata }
      : row?.local_metadata;
    const analysis = localMeta?.face_analysis && typeof localMeta.face_analysis === "object"
      ? { ...localMeta.face_analysis }
      : null;
    if (analysis) {
      analysis.faces = Array.isArray(analysis.faces)
        ? analysis.faces.map((face) => ({ ...face }))
        : [];
      localMeta.face_analysis = analysis;
    }
    return {
      ...row,
      local_metadata: localMeta,
    };
  });

  const vectors = [];
  for (let rowIndex = 0; rowIndex < clonedRows.length; rowIndex += 1) {
    const row = clonedRows[rowIndex];
    const rowPath = String(row?.path || row?.image_path || "").trim();
    const faces = Array.isArray(row?.local_metadata?.face_analysis?.faces)
      ? row.local_metadata.face_analysis.faces
      : [];
    for (let faceIndex = 0; faceIndex < faces.length; faceIndex += 1) {
      const face = faces[faceIndex];
      const embedding = normalizeFaceEmbedding(face?.embedding);
      if (!embedding) {
        continue;
      }
      vectors.push({
        rowIndex,
        faceIndex,
        rowPath,
        faceId: String(face?.face_id || `${rowPath}#${faceIndex + 1}`),
        qualityScore: Number(face?.quality_score),
        existingLabel: sanitizePersonLabel(face?.person_label),
        embedding,
      });
    }
  }

  if (vectors.length === 0) {
    return {
      rows: clonedRows,
      clusters: [],
      threshold,
      totalFaces: 0,
    };
  }

  const sortedIndexes = Array.from({ length: vectors.length }, (_, i) => i)
    .sort((a, b) => {
      const qa = Number(vectors[a]?.qualityScore || 0);
      const qb = Number(vectors[b]?.qualityScore || 0);
      return qb - qa;
    });

  const maxIntraClusterDistance = Math.max(0.01, threshold * 0.92);

  function buildCentroid(indexes) {
    if (!Array.isArray(indexes) || indexes.length === 0) {
      return null;
    }
    const dimension = Array.isArray(vectors[indexes[0]]?.embedding) ? vectors[indexes[0]].embedding.length : 0;
    if (!dimension) {
      return null;
    }

    const sum = new Array(dimension).fill(0);
    for (const idx of indexes) {
      const vec = vectors[idx]?.embedding;
      if (!Array.isArray(vec) || vec.length !== dimension) {
        continue;
      }
      for (let i = 0; i < dimension; i += 1) {
        sum[i] += vec[i];
      }
    }

    const count = indexes.length;
    const mean = sum.map((value) => value / Math.max(1, count));
    return normalizeFaceEmbedding(mean);
  }

  const workingClusters = [];
  for (const vectorIndex of sortedIndexes) {
    const candidateVector = vectors[vectorIndex];
    let bestCluster = null;
    let bestClusterScore = Number.POSITIVE_INFINITY;

    for (const cluster of workingClusters) {
      const centroidDistance = cosineDistance(candidateVector.embedding, cluster.centroid);
      if (!(centroidDistance <= threshold)) {
        continue;
      }

      let maxMemberDistance = 0;
      for (const memberIndex of cluster.memberIndexes) {
        const distance = cosineDistance(candidateVector.embedding, vectors[memberIndex].embedding);
        if (distance > maxMemberDistance) {
          maxMemberDistance = distance;
        }
        if (maxMemberDistance > maxIntraClusterDistance) {
          break;
        }
      }

      if (maxMemberDistance > maxIntraClusterDistance) {
        continue;
      }

      if (centroidDistance < bestClusterScore) {
        bestClusterScore = centroidDistance;
        bestCluster = cluster;
      }
    }

    if (!bestCluster) {
      workingClusters.push({
        memberIndexes: [vectorIndex],
        centroid: vectors[vectorIndex].embedding,
      });
      continue;
    }

    bestCluster.memberIndexes.push(vectorIndex);
    bestCluster.centroid = buildCentroid(bestCluster.memberIndexes) || bestCluster.centroid;
  }

  const grouped = workingClusters
    .map((cluster) => cluster.memberIndexes.map((idx) => vectors[idx]))
    .sort((a, b) => b.length - a.length);

  const clusters = [];
  grouped.forEach((members, clusterIndex) => {
    const clusterId = `face-cluster-${String(clusterIndex + 1).padStart(4, "0")}`;
    const labelCounts = new Map();

    for (const member of members) {
      if (member.existingLabel) {
        labelCounts.set(member.existingLabel, Number(labelCounts.get(member.existingLabel) || 0) + 1);
      }
    }

    const clusterLabel = Array.from(labelCounts.entries())
      .sort((a, b) => b[1] - a[1])[0]?.[0] || "";

    for (const member of members) {
      const targetFace = clonedRows[member.rowIndex]?.local_metadata?.face_analysis?.faces?.[member.faceIndex];
      if (!targetFace || typeof targetFace !== "object") {
        continue;
      }
      targetFace.cluster_id = clusterId;
      if (!sanitizePersonLabel(targetFace.person_label) && clusterLabel) {
        targetFace.person_label = clusterLabel;
      }
    }

    const imagePaths = Array.from(new Set(
      members
        .map((member) => String(member.rowPath || "").trim())
        .filter(Boolean),
    ));
    const averageQuality = members
      .map((member) => member.qualityScore)
      .filter((score) => Number.isFinite(score));

    clusters.push({
      cluster_id: clusterId,
      person_label: clusterLabel || null,
      face_count: members.length,
      image_count: imagePaths.length,
      sample_paths: imagePaths.slice(0, 10),
      average_quality_score: averageQuality.length > 0
        ? Number((averageQuality.reduce((sum, score) => sum + score, 0) / averageQuality.length).toFixed(4))
        : null,
      members: members.map((member) => ({
        path: member.rowPath,
        face_id: member.faceId,
      })),
    });
  });

  return {
    rows: clonedRows,
    clusters,
    threshold,
    totalFaces: vectors.length,
  };
}

async function writeLocalFaceClustersFile(payload) {
  await fs.mkdir(DATA_DIR_PATH, { recursive: true });
  await fs.writeFile(LOCAL_FACE_CLUSTERS_OUTPUT_PATH, JSON.stringify(payload, null, 2), "utf-8");
  return LOCAL_FACE_CLUSTERS_OUTPUT_PATH;
}

async function readLocalIndexPayload() {
  const localFilePath = path.join(DATA_DIR_PATH, "local-image_metadata_results.json");
  if (!(await pathExists(localFilePath))) {
    return null;
  }
  try {
    return JSON.parse(await fs.readFile(localFilePath, "utf-8"));
  } catch {
    return null;
  }
}

async function readLocalFaceClustersPayload() {
  if (!(await pathExists(LOCAL_FACE_CLUSTERS_OUTPUT_PATH))) {
    return null;
  }
  try {
    return JSON.parse(await fs.readFile(LOCAL_FACE_CLUSTERS_OUTPUT_PATH, "utf-8"));
  } catch {
    return null;
  }
}

async function rebuildLocalFaceClusters(settings) {
  const payload = await readLocalIndexPayload();
  const rows = Array.isArray(payload?.results) ? payload.results : [];
  const clustering = applyFaceClusteringToRows(rows, settings);

  const nextPayload = {
    ...(payload && typeof payload === "object" ? payload : {}),
    model: String(payload?.model || "local-metadata-extractor-v1"),
    prefix: "local",
    indexing_mode: "local",
    generated_at: new Date().toISOString(),
    results: clustering.rows,
  };

  await fs.mkdir(DATA_DIR_PATH, { recursive: true });
  const localPath = path.join(DATA_DIR_PATH, "local-image_metadata_results.json");
  await fs.writeFile(localPath, JSON.stringify(nextPayload, null, 2), "utf-8");

  const clustersPayload = {
    generated_at: new Date().toISOString(),
    threshold: clustering.threshold,
    total_faces_clustered: clustering.totalFaces,
    cluster_count: clustering.clusters.length,
    clusters: clustering.clusters,
  };
  const clustersPath = await writeLocalFaceClustersFile(clustersPayload);

  return {
    ok: true,
    outputPath: localPath,
    clustersPath,
    clusterCount: clustering.clusters.length,
    totalFaces: clustering.totalFaces,
    clusters: clustering.clusters,
  };
}

async function setLocalFaceClusterLabel(clusterId, label) {
  const targetClusterId = String(clusterId || "").trim();
  if (!targetClusterId) {
    return { ok: false, message: "clusterId is required." };
  }

  const normalizedLabel = sanitizePersonLabel(label);
  const localPayload = await readLocalIndexPayload();
  const rows = Array.isArray(localPayload?.results) ? localPayload.results : [];
  let updatedFaceCount = 0;

  for (const row of rows) {
    const faces = Array.isArray(row?.local_metadata?.face_analysis?.faces)
      ? row.local_metadata.face_analysis.faces
      : [];
    for (const face of faces) {
      if (String(face?.cluster_id || "") !== targetClusterId) {
        continue;
      }
      if (normalizedLabel) {
        face.person_label = normalizedLabel;
      } else {
        face.person_label = null;
      }
      updatedFaceCount += 1;
    }
  }

  if (updatedFaceCount === 0) {
    return { ok: false, message: `No faces found for cluster ${targetClusterId}.` };
  }

  const nextLocalPayload = {
    ...(localPayload && typeof localPayload === "object" ? localPayload : {}),
    generated_at: new Date().toISOString(),
    results: rows,
  };
  await fs.mkdir(DATA_DIR_PATH, { recursive: true });
  const localPath = path.join(DATA_DIR_PATH, "local-image_metadata_results.json");
  await fs.writeFile(localPath, JSON.stringify(nextLocalPayload, null, 2), "utf-8");

  const clusterPayload = await readLocalFaceClustersPayload();
  const clusterRows = Array.isArray(clusterPayload?.clusters) ? clusterPayload.clusters : [];
  for (const cluster of clusterRows) {
    if (String(cluster?.cluster_id || "") === targetClusterId) {
      cluster.person_label = normalizedLabel || null;
      cluster.updated_at = new Date().toISOString();
    }
  }
  await writeLocalFaceClustersFile({
    ...(clusterPayload && typeof clusterPayload === "object" ? clusterPayload : {}),
    generated_at: new Date().toISOString(),
    clusters: clusterRows,
  });

  return {
    ok: true,
    clusterId: targetClusterId,
    personLabel: normalizedLabel || null,
    updatedFaceCount,
    outputPath: localPath,
    clustersPath: LOCAL_FACE_CLUSTERS_OUTPUT_PATH,
  };
}

let cachedLocalExtractor = null;
let cachedLocalVideoExtractor = null;
let cachedCloudExtractor = null;
let cachedCloudVideoExtractor = null;
let cachedSharpModule = null;
let cachedFaceApiModule = null;
let cachedFaceApiLoadError = null;
let cachedFaceModelDirPath = "";
let cachedFaceTfBackendReady = false;
let cachedFaceDetectorMode = "";
let loggedSsdFallbackWarning = false;
const imagePreviewSrcCache = new Map();

async function loadSharpModule() {
  if (cachedSharpModule) {
    return cachedSharpModule;
  }

  try {
    const sharpModule = await import("sharp");
    cachedSharpModule = sharpModule?.default || sharpModule;
    return cachedSharpModule;
  } catch {
    return null;
  }
}

async function resolvePreviewSrcForImage(imagePath, mediaTypeHint = "image") {
  const normalizedPath = String(imagePath || "").trim();
  const mediaType = String(mediaTypeHint || getMediaTypeFromPath(normalizedPath, "image")).toLowerCase();
  if (!normalizedPath) {
    return { ok: false, message: "imagePath is required." };
  }

  if (!(await pathExists(normalizedPath))) {
    return { ok: false, message: "Image file not found.", imagePath: normalizedPath };
  }

  if (mediaType === "video") {
    return {
      ok: true,
      previewSrc: toPreviewSrc(normalizedPath),
      converted: false,
      imagePath: normalizedPath,
    };
  }

  const ext = path.extname(normalizedPath).toLowerCase();
  if (!PREVIEW_CONVERTIBLE_EXTENSIONS.has(ext)) {
    return {
      ok: true,
      previewSrc: toPreviewSrc(normalizedPath),
      converted: false,
      imagePath: normalizedPath,
    };
  }

  const cached = imagePreviewSrcCache.get(normalizedPath);
  if (cached && (await pathExists(cached.path))) {
    return {
      ok: true,
      previewSrc: toPreviewSrc(cached.path),
      converted: true,
      converter: cached.converter,
      imagePath: normalizedPath,
    };
  }

  const cacheFileName = `${createHash("sha1").update(normalizedPath.toLowerCase()).digest("hex")}.png`;
  const cacheFilePath = path.join(PREVIEW_CACHE_DIR_PATH, cacheFileName);
  if (await pathExists(cacheFilePath)) {
    imagePreviewSrcCache.set(normalizedPath, {
      path: cacheFilePath,
      converter: "cache",
    });
    return {
      ok: true,
      previewSrc: toPreviewSrc(cacheFilePath),
      converted: true,
      converter: "cache",
      imagePath: normalizedPath,
    };
  }

  await fs.mkdir(PREVIEW_CACHE_DIR_PATH, { recursive: true });

  const sharp = await loadSharpModule();
  let sharpError = null;

  if (sharp) {
    try {
      await sharp(normalizedPath)
        .rotate()
        .resize({
          width: 720,
          height: 720,
          fit: "inside",
          withoutEnlargement: true,
        })
        .png({ quality: 86 })
        .toFile(cacheFilePath);

      if (imagePreviewSrcCache.size > 400) {
        const firstKey = imagePreviewSrcCache.keys().next().value;
        if (firstKey) {
          imagePreviewSrcCache.delete(firstKey);
        }
      }
      imagePreviewSrcCache.set(normalizedPath, {
        path: cacheFilePath,
        converter: "sharp",
      });

      return {
        ok: true,
        previewSrc: toPreviewSrc(cacheFilePath),
        converted: true,
        converter: "sharp",
        imagePath: normalizedPath,
      };
    } catch (error) {
      sharpError = String(error?.message || error);
    }
  }

  try {
    const thumbnail = await nativeImage.createThumbnailFromPath(normalizedPath, {
      width: 720,
      height: 720,
    });

    if (thumbnail && !thumbnail.isEmpty()) {
      await fs.writeFile(cacheFilePath, thumbnail.toPNG());
      if (imagePreviewSrcCache.size > 400) {
        const firstKey = imagePreviewSrcCache.keys().next().value;
        if (firstKey) {
          imagePreviewSrcCache.delete(firstKey);
        }
      }
      imagePreviewSrcCache.set(normalizedPath, {
        path: cacheFilePath,
        converter: "native-thumbnail",
      });

      return {
        ok: true,
        previewSrc: toPreviewSrc(cacheFilePath),
        converted: true,
        converter: "native-thumbnail",
        imagePath: normalizedPath,
      };
    }
  } catch {
    // Fall through to original path return.
  }

  return {
    ok: true,
    previewSrc: toPreviewSrc(normalizedPath),
    converted: false,
    imagePath: normalizedPath,
    warning: sharpError || "Could not convert preview.",
  };

}

async function loadLocalMetadataExtractor() {
  if (cachedLocalExtractor) {
    return cachedLocalExtractor;
  }

  try {
    let resolvedExtractorPath = "";
    for (const candidatePath of LOCAL_EXTRACTOR_MODULE_CANDIDATES) {
      if (await pathExists(candidatePath)) {
        resolvedExtractorPath = candidatePath;
        break;
      }
    }

    if (!resolvedExtractorPath) {
      throw new Error("No local extractor module file found.");
    }

    const extractorModuleUrl = pathToFileURL(resolvedExtractorPath).href;
    const extractor = await import(extractorModuleUrl);
    if (typeof extractor?.extractImageMetadata !== "function") {
      throw new Error(`${path.basename(resolvedExtractorPath)} does not export extractImageMetadata.`);
    }
    cachedLocalExtractor = extractor;
    return extractor;
  } catch (error) {
    throw new Error(
      `Local metadata extractor is unavailable: ${String(error?.message || error)}. Install extractor dependencies (sharp, exifr, image-hash, file-type).`,
    );
  }
}

async function loadCloudMetadataExtractor() {
  if (cachedCloudExtractor) {
    return cachedCloudExtractor;
  }

  try {
    const extractorModuleUrl = pathToFileURL(CLOUD_EXTRACTOR_MODULE_PATH).href;
    const extractor = await import(extractorModuleUrl);
    if (typeof extractor?.describeImage !== "function") {
      throw new Error("cloud-image-metadata-extractor.js does not export describeImage.");
    }
    cachedCloudExtractor = extractor;
    return extractor;
  } catch (error) {
    throw new Error(`Cloud metadata extractor is unavailable: ${String(error?.message || error)}`);
  }
}

async function loadCloudVideoMetadataExtractor() {
  if (cachedCloudVideoExtractor) {
    return cachedCloudVideoExtractor;
  }

  try {
    const extractorModuleUrl = pathToFileURL(CLOUD_VIDEO_EXTRACTOR_MODULE_PATH).href;
    const extractor = await import(extractorModuleUrl);
    if (typeof extractor?.describeVideo !== "function") {
      throw new Error("cloud-video-metadata-extractor.js does not export describeVideo.");
    }
    cachedCloudVideoExtractor = extractor;
    return extractor;
  } catch (error) {
    throw new Error(`Cloud video metadata extractor is unavailable: ${String(error?.message || error)}`);
  }
}

async function loadLocalVideoMetadataExtractor() {
  if (cachedLocalVideoExtractor) {
    return cachedLocalVideoExtractor;
  }

  if (!(await pathExists(LOCAL_VIDEO_EXTRACTOR_MODULE_PATH))) {
    throw new Error("local-video-metadata-extractor.js was not found.");
  }

  try {
    const extractorModuleUrl = pathToFileURL(LOCAL_VIDEO_EXTRACTOR_MODULE_PATH).href;
    const extractor = await import(extractorModuleUrl);
    if (typeof extractor?.extractVideoMetadata !== "function") {
      throw new Error("local-video-metadata-extractor.js does not export extractVideoMetadata.");
    }
    cachedLocalVideoExtractor = extractor;
    return extractor;
  } catch (error) {
    throw new Error(
      `Local video metadata extractor is unavailable: ${String(error?.message || error)}.`,
    );
  }
}

function buildSearchMetadataFromLocal(localMetadata, imagePath) {
  const mediaType = String(localMetadata?.media_type || getMediaTypeFromPath(imagePath, "image"));
  const filtering = localMetadata?.filtering && typeof localMetadata.filtering === "object"
    ? localMetadata.filtering
    : {};
  const colorRows = Array.isArray(localMetadata?.color_analysis?.dominant_colors)
    ? localMetadata.color_analysis.dominant_colors
    : [];
  const dominantColors = colorRows
    .map((row) => row?.hex || null)
    .filter(Boolean)
    .slice(0, 5);

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
    title: String(localMetadata?.name || path.basename(imagePath, path.extname(imagePath)) || `Untitled ${mediaType}`),
    description: String(
      localMetadata?.source?.likely_source
        ? `Source: ${localMetadata.source.likely_source}`
        : `${mediaType === "video" ? "Video" : "Image"} from ${path.dirname(imagePath)}`,
    ),
    tags,
    objects: Array.isArray(localMetadata?.ai_analysis?.objects_detected) ? localMetadata.ai_analysis.objects_detected : [],
    style: String(localMetadata?.source?.likely_source || "unknown"),
    dominant_colors: dominantColors,
    contains_people:
      (Number(localMetadata?.face_analysis?.face_count || 0) > 0) ||
      localMetadata?.ai_analysis?.contains_people === true,
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

async function writeLocalIndexFile(results) {
  const payload = {
    model: "local-metadata-extractor-v1",
    prefix: "local",
    indexing_mode: "local",
    generated_at: new Date().toISOString(),
    results,
  };

  await fs.mkdir(DATA_DIR_PATH, { recursive: true });
  const target = path.join(DATA_DIR_PATH, "local-image_metadata_results.json");
  await fs.writeFile(target, JSON.stringify(payload, null, 2), "utf-8");
  return target;
}

async function loadExistingIndexResults(useCloud) {
  const filePath = useCloud
    ? path.join(DATA_DIR_PATH, "cloud-image_metadata_results.json")
    : path.join(DATA_DIR_PATH, "local-image_metadata_results.json");

  if (!(await pathExists(filePath))) {
    return {
      rows: [],
      byPath: new Set(),
      byId: new Set(),
      retryableFailedCount: 0,
    };
  }

  try {
    const payload = JSON.parse(await fs.readFile(filePath, "utf-8"));
    const allRows = Array.isArray(payload?.results) ? payload.results : [];
    const rows = [];
    const byPath = new Set();
    const byId = new Set();
    let retryableFailedCount = 0;

    for (const row of allRows) {
      const rowStatus = String(row?.status || "").toLowerCase();
      const isRetryableCloudFailure = useCloud && rowStatus === "failed";
      if (isRetryableCloudFailure) {
        retryableFailedCount += 1;
        continue;
      }

      rows.push(row);

      const rowPath = String(row?.path || row?.image_path || "").trim();
      const rowId = Number(row?.id);
      if (rowPath) {
        byPath.add(rowPath);
      }
      if (Number.isFinite(rowId)) {
        byId.add(rowId);
      }
    }

    return {
      rows,
      byPath,
      byId,
      retryableFailedCount,
    };
  } catch {
    return {
      rows: [],
      byPath: new Set(),
      byId: new Set(),
      retryableFailedCount: 0,
    };
  }
}

async function loadSuccessfulLocalIndexLookup() {
  const localFilePath = path.join(DATA_DIR_PATH, "local-image_metadata_results.json");
  const byPath = new Set();
  const byId = new Set();

  if (!(await pathExists(localFilePath))) {
    return { byPath, byId };
  }

  try {
    const payload = JSON.parse(await fs.readFile(localFilePath, "utf-8"));
    const rows = Array.isArray(payload?.results) ? payload.results : [];

    for (const row of rows) {
      if (String(row?.status || "") !== "ok") {
        continue;
      }

      const rowPath = String(row?.path || "").trim();
      const rowId = Number(row?.id);
      if (rowPath) {
        byPath.add(rowPath);
      }
      if (Number.isFinite(rowId)) {
        byId.add(rowId);
      }
    }
  } catch {
    return { byPath, byId };
  }

  return { byPath, byId };
}

async function getMasterDirectoryIdByPath() {
  const payload = await loadMasterDirectory();
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const byPath = new Map();

  for (const item of items) {
    const itemPath = String(item?.path || "");
    const itemId = Number(item?.id);
    if (!itemPath || !Number.isFinite(itemId)) {
      continue;
    }
    byPath.set(itemPath, itemId);
  }

  return byPath;
}

async function getMasterDirectoryPaths() {
  const payload = await loadMasterDirectory();
  const items = Array.isArray(payload?.items) ? payload.items : [];
  return items
    .map((item) => String(item?.path || "").trim())
    .filter(Boolean);
}

function buildSuccessfulIndexSets(payload) {
  const byPath = new Set();
  const byId = new Set();
  const rows = Array.isArray(payload?.results) ? payload.results : [];

  for (const row of rows) {
    if (String(row?.status || "") !== "ok") {
      continue;
    }

    const imagePath = String(row?.path || row?.image_path || "").trim();
    const imageId = Number(row?.id);
    if (imagePath) {
      byPath.add(imagePath);
    }
    if (Number.isFinite(imageId)) {
      byId.add(imageId);
    }
  }

  return { byPath, byId };
}

async function loadIndexingStageLookup() {
  const localFilePath = path.join(DATA_DIR_PATH, "local-image_metadata_results.json");
  const cloudFilePath = path.join(DATA_DIR_PATH, "cloud-image_metadata_results.json");

  let localPayload = null;
  let cloudPayload = null;

  if (await pathExists(localFilePath)) {
    try {
      localPayload = JSON.parse(await fs.readFile(localFilePath, "utf-8"));
    } catch {
      localPayload = null;
    }
  }

  if (await pathExists(cloudFilePath)) {
    try {
      cloudPayload = JSON.parse(await fs.readFile(cloudFilePath, "utf-8"));
    } catch {
      cloudPayload = null;
    }
  }

  const localSets = buildSuccessfulIndexSets(localPayload);
  const cloudSets = buildSuccessfulIndexSets(cloudPayload);

  return {
    localByPath: localSets.byPath,
    localById: localSets.byId,
    cloudByPath: cloudSets.byPath,
    cloudById: cloudSets.byId,
  };
}

async function readUserSettings() {
  const defaults = {
    enabledFilters: [
      "style",
      "orientation",
      "mediaType",
      "resolutionMegapixels",
      "durationBucket",
      "fpsLabel",
      "aspectRatio",
      "fileType",
    ],
    user_name: "youremail@email.com",
    user_password: "password",
    aws_region: "us-east-1",
    aws_key: "",
    secret_key: "",
    model: "qwen.qwen3-vl-235b-a22b",
    min_match_score: 0.03,
    ui_theme: "aurora",
    results_density: "comfortable",
    auto_expand_filters: false,
    auto_close_sidebar_on_settings_nav: true,
    enable_face_indexing: true,
    face_model_version: "face-api-ssd-v1",
    face_min_detection_confidence: 0.3,
    face_min_quality_score: 0.3,
    face_cluster_distance_threshold: 0.16,
    updated_at: null,
  };

  const candidatePaths = [
    USER_SETTINGS_PATH,
    LEGACY_USER_SETTINGS_PATH,
    LEGACY_USER_SETTINGS_SJON_PATH,
  ];
  let settingsPath = null;
  for (const candidate of candidatePaths) {
    if (await pathExists(candidate)) {
      settingsPath = candidate;
      break;
    }
  }

  if (!settingsPath) {
    return defaults;
  }

  try {
    const payload = JSON.parse(await fs.readFile(settingsPath, "utf-8"));
    const enabledFilters = Array.isArray(payload?.enabledFilters)
      ? payload.enabledFilters.map((v) => String(v)).filter(Boolean)
      : defaults.enabledFilters;
    const minMatchScoreValue = Number(payload?.min_match_score);
    const minMatchScore = Number.isFinite(minMatchScoreValue)
      ? Math.max(0, minMatchScoreValue)
      : defaults.min_match_score;
    return {
      enabledFilters,
      user_name: String(payload?.user_name || ""),
      user_password: String(payload?.user_password || ""),
      aws_region: String(payload?.aws_region || defaults.aws_region),
      aws_key: String(payload?.aws_key || ""),
      secret_key: String(payload?.secret_key || ""),
      model: String(payload?.model || defaults.model),
      min_match_score: minMatchScore,
      ui_theme: String(payload?.ui_theme || defaults.ui_theme),
      results_density: String(payload?.results_density || defaults.results_density),
      auto_expand_filters: Boolean(payload?.auto_expand_filters),
      auto_close_sidebar_on_settings_nav:
        payload?.auto_close_sidebar_on_settings_nav === undefined
          ? defaults.auto_close_sidebar_on_settings_nav
          : Boolean(payload?.auto_close_sidebar_on_settings_nav),
      enable_face_indexing:
        payload?.enable_face_indexing === undefined
          ? defaults.enable_face_indexing
          : Boolean(payload?.enable_face_indexing),
      face_model_version: normalizeFaceModelVersion(payload?.face_model_version || defaults.face_model_version),
      face_min_detection_confidence: Number.isFinite(Number(payload?.face_min_detection_confidence))
        ? Math.max(0, Math.min(1, Number(payload?.face_min_detection_confidence)))
        : defaults.face_min_detection_confidence,
      face_min_quality_score: Number.isFinite(Number(payload?.face_min_quality_score))
        ? Math.max(0, Math.min(1, Number(payload?.face_min_quality_score)))
        : defaults.face_min_quality_score,
      face_cluster_distance_threshold: normalizeFaceClusterDistanceThreshold(payload?.face_cluster_distance_threshold),
      updated_at: payload?.updated_at || null,
    };
  } catch {
    return defaults;
  }
}

function parseEnvText(envText) {
  const parsed = {};
  const lines = String(envText || "").split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const idx = line.indexOf("=");
    if (idx <= 0) {
      continue;
    }
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  }
  return parsed;
}

async function readEnvSettings() {
  const defaults = {
    aws_region: "us-east-1",
    aws_key: "",
    secret_key: "",
    model: "qwen.qwen3-vl-235b-a22b",
  };

  if (!(await pathExists(ENV_FILE_PATH))) {
    return defaults;
  }

  try {
    const envText = await fs.readFile(ENV_FILE_PATH, "utf-8");
    const parsed = parseEnvText(envText);
    return {
      aws_region: String(parsed.AWS_REGION || defaults.aws_region),
      aws_key: String(parsed.AWS_ACCESS_KEY_ID || ""),
      secret_key: String(parsed.AWS_SECRET_ACCESS_KEY || ""),
      model: String(parsed.BEDROCK_VISION_MODEL || defaults.model),
    };
  } catch {
    return defaults;
  }
}

async function ensureEnvFileExists() {
  if (await pathExists(ENV_FILE_PATH)) {
    return;
  }

  const candidatePaths = [
    BUNDLED_ENV_SEED_PATH,
    path.join(process.cwd(), "config", "default.env"),
  ];

  for (const candidate of candidatePaths) {
    if (!(await pathExists(candidate))) {
      continue;
    }
    const seedText = await fs.readFile(candidate, "utf-8");
    await fs.mkdir(path.dirname(ENV_FILE_PATH), { recursive: true });
    await fs.writeFile(ENV_FILE_PATH, seedText, "utf-8");
    return;
  }

  await fs.mkdir(path.dirname(ENV_FILE_PATH), { recursive: true });
  await fs.writeFile(ENV_FILE_PATH, DEFAULT_ENV_TEMPLATE, "utf-8");
}

async function writeEnvSettings(settings) {
  const isMaskedSecretValue = (value) => /^(?:\*|•){4,}$/.test(String(value || "").trim());
  const existing = await readEnvSettings();
  const incomingAwsKey = String(settings?.aws_key || "").trim();
  const incomingSecretKey = String(settings?.secret_key || "").trim();

  const nextValues = {
    AWS_REGION: String(settings?.aws_region || "us-east-1"),
    AWS_ACCESS_KEY_ID: isMaskedSecretValue(incomingAwsKey)
      ? String(existing?.aws_key || "")
      : incomingAwsKey,
    AWS_SECRET_ACCESS_KEY: isMaskedSecretValue(incomingSecretKey)
      ? String(existing?.secret_key || "")
      : incomingSecretKey,
    BEDROCK_VISION_MODEL: String(settings?.model || "qwen.qwen3-vl-235b-a22b"),
  };

  const existingText = (await pathExists(ENV_FILE_PATH))
    ? await fs.readFile(ENV_FILE_PATH, "utf-8")
    : "";
  const lines = existingText.split(/\r?\n/);
  const seen = new Set();
  const updatedLines = lines.map((line) => {
    const idx = line.indexOf("=");
    if (idx <= 0) {
      return line;
    }
    const key = line.slice(0, idx).trim();
    if (!(key in nextValues)) {
      return line;
    }
    seen.add(key);
    return `${key}=${nextValues[key]}`;
  });

  for (const [key, value] of Object.entries(nextValues)) {
    if (!seen.has(key)) {
      updatedLines.push(`${key}=${value}`);
    }
  }

  const normalizedText = updatedLines.join("\n").replace(/\n{3,}/g, "\n\n");
  await fs.writeFile(ENV_FILE_PATH, normalizedText, "utf-8");

  process.env.AWS_REGION = nextValues.AWS_REGION;
  process.env.AWS_ACCESS_KEY_ID = nextValues.AWS_ACCESS_KEY_ID;
  process.env.AWS_SECRET_ACCESS_KEY = nextValues.AWS_SECRET_ACCESS_KEY;
  process.env.BEDROCK_VISION_MODEL = nextValues.BEDROCK_VISION_MODEL;
}

async function writeUserSettings(settings) {
  const MASKED_SECRET_TOKEN = "********";
  const isMaskedSecretValue = (value) => /^(?:\*|•){4,}$/.test(String(value || "").trim());
  const maskSecretValue = (value) => {
    const raw = String(value || "").trim();
    if (!raw) {
      return "";
    }
    return isMaskedSecretValue(raw) ? raw : MASKED_SECRET_TOKEN;
  };

  const enabledFilters = Array.isArray(settings?.enabledFilters)
    ? settings.enabledFilters.map((v) => String(v)).filter(Boolean)
    : [];

  const payload = {
    enabledFilters,
    user_name: String(settings?.user_name || ""),
    user_password: String(settings?.user_password || ""),
    aws_region: String(settings?.aws_region || "us-east-1"),
    aws_key: maskSecretValue(settings?.aws_key),
    secret_key: maskSecretValue(settings?.secret_key),
    model: String(settings?.model || "qwen.qwen3-vl-235b-a22b"),
    min_match_score: Number.isFinite(Number(settings?.min_match_score))
      ? Math.max(0, Number(settings.min_match_score))
      : 0.03,
    ui_theme: String(settings?.ui_theme || "aurora"),
    results_density: String(settings?.results_density || "comfortable"),
    auto_expand_filters: Boolean(settings?.auto_expand_filters),
    auto_close_sidebar_on_settings_nav:
      settings?.auto_close_sidebar_on_settings_nav === undefined
        ? true
        : Boolean(settings?.auto_close_sidebar_on_settings_nav),
    enable_face_indexing:
      settings?.enable_face_indexing === undefined
        ? true
        : Boolean(settings?.enable_face_indexing),
    face_model_version: normalizeFaceModelVersion(settings?.face_model_version || "face-api-ssd-v1"),
    face_min_detection_confidence: Number.isFinite(Number(settings?.face_min_detection_confidence))
      ? Math.max(0, Math.min(1, Number(settings.face_min_detection_confidence)))
      : 0.3,
    face_min_quality_score: Number.isFinite(Number(settings?.face_min_quality_score))
      ? Math.max(0, Math.min(1, Number(settings.face_min_quality_score)))
      : 0.3,
    face_cluster_distance_threshold: normalizeFaceClusterDistanceThreshold(settings?.face_cluster_distance_threshold),
    updated_at: new Date().toISOString(),
  };

  await fs.mkdir(DATA_DIR_PATH, { recursive: true });
  await fs.writeFile(USER_SETTINGS_PATH, JSON.stringify(payload, null, 2), "utf-8");
  return payload;
}

function getFaceIndexingSettings(settings) {
  const source = settings && typeof settings === "object" ? settings : {};
  return {
    enabled: Boolean(source.enable_face_indexing),
    modelVersion: normalizeFaceModelVersion(source.face_model_version || "face-api-ssd-v1"),
    minDetectionConfidence: Number.isFinite(Number(source.face_min_detection_confidence))
      ? Math.max(0, Math.min(1, Number(source.face_min_detection_confidence)))
      : 0.6,
    minQualityScore: Number.isFinite(Number(source.face_min_quality_score))
      ? Math.max(0, Math.min(1, Number(source.face_min_quality_score)))
      : 0.45,
    clusterDistanceThreshold: normalizeFaceClusterDistanceThreshold(source.face_cluster_distance_threshold),
  };
}

function normalizeFaceAnalysisResult(result, fallbackVersion) {
  const parsed = result && typeof result === "object" ? result : {};
  const facesRaw = Array.isArray(parsed.faces) ? parsed.faces : [];
  const faces = facesRaw.map((face, i) => {
    const bbox = face?.bbox && typeof face.bbox === "object" ? face.bbox : {};
    const embedding = Array.isArray(face?.embedding)
      ? face.embedding.map((value) => Number(value)).filter((value) => Number.isFinite(value))
      : [];
    return {
      face_id: String(face?.face_id || `face-${i + 1}`),
      bbox: {
        x: Number.isFinite(Number(bbox?.x)) ? Number(bbox.x) : 0,
        y: Number.isFinite(Number(bbox?.y)) ? Number(bbox.y) : 0,
        width: Number.isFinite(Number(bbox?.width)) ? Number(bbox.width) : 0,
        height: Number.isFinite(Number(bbox?.height)) ? Number(bbox.height) : 0,
      },
      detection_confidence: Number.isFinite(Number(face?.detection_confidence))
        ? Number(face.detection_confidence)
        : 0,
      embedding,
      quality_score: Number.isFinite(Number(face?.quality_score)) ? Number(face.quality_score) : 0,
      cluster_id: face?.cluster_id == null ? null : String(face.cluster_id),
      person_label: face?.person_label == null ? null : String(face.person_label),
    };
  });

  return {
    version: String(parsed.version || fallbackVersion || "insightface-arcface-v1"),
    processed_at: String(parsed.processed_at || new Date().toISOString()),
    face_count: faces.length,
    faces,
  };
}

function isFaceAnalysisCurrent(localRow, faceSettings) {
  const localMeta = localRow?.local_metadata && typeof localRow.local_metadata === "object"
    ? localRow.local_metadata
    : null;
  const faceAnalysis = localMeta?.face_analysis && typeof localMeta.face_analysis === "object"
    ? localMeta.face_analysis
    : null;
  if (!faceAnalysis) {
    return false;
  }
  return String(faceAnalysis.version || "") === String(faceSettings?.modelVersion || "");
}

async function runLocalFaceAnalysis(imagePath, faceSettings) {
  const modelVersion = normalizeFaceModelVersion(faceSettings?.modelVersion || "face-api-ssd-v1");
  const requestedDetectorType = modelVersion === "face-api-ssd-v1" ? "ssd" : "tiny";
  let activeDetectorType = cachedFaceDetectorMode || requestedDetectorType;

  async function loadFaceApiModule() {
    if (cachedFaceApiModule) {
      return cachedFaceApiModule;
    }
    if (cachedFaceApiLoadError) {
      throw cachedFaceApiLoadError;
    }

    const requireCandidates = [
      "@vladmandic/face-api/dist/face-api.node-wasm.js",
      "@vladmandic/face-api",
    ];

    function normalizeFaceApiModule(mod) {
      if (mod?.default && mod.default.nets) {
        return mod.default;
      }
      return mod;
    }

    let lastError = null;
    for (const specifier of requireCandidates) {
      try {
        const faceApiModule = normalizeFaceApiModule(nodeRequire(specifier));
        cachedFaceApiModule = faceApiModule;
        cachedFaceApiLoadError = null;
        return faceApiModule;
      } catch (error) {
        lastError = error;
      }
    }

    try {
      const imported = await import("@vladmandic/face-api");
      const faceApiModule = normalizeFaceApiModule(imported);
      cachedFaceApiModule = faceApiModule;
      cachedFaceApiLoadError = null;
      return faceApiModule;
    } catch (error) {
      lastError = error;
    }

    const reason = String(lastError?.message || lastError || "unknown error");
    cachedFaceApiLoadError = new Error(`Unable to load face-api backend: ${reason}`);
    throw cachedFaceApiLoadError;
  }

  async function resolveFaceModelDirPath(requiredDetectorType) {
    const detector = String(requiredDetectorType || "tiny").toLowerCase() === "ssd" ? "ssd" : "tiny";

    async function hasRequiredFaceModelFiles(modelDir) {
      if (!(await pathExists(modelDir))) {
        return false;
      }

      const detectorManifest = detector === "ssd"
        ? "ssd_mobilenetv1_model-weights_manifest.json"
        : "tiny_face_detector_model-weights_manifest.json";

      const requiredFiles = [
        detectorManifest,
        "face_landmark_68_model-weights_manifest.json",
        "face_recognition_model-weights_manifest.json",
      ];

      for (const fileName of requiredFiles) {
        if (!(await pathExists(path.join(modelDir, fileName)))) {
          return false;
        }
      }

      return true;
    }

    if (cachedFaceModelDirPath && await hasRequiredFaceModelFiles(cachedFaceModelDirPath)) {
      return cachedFaceModelDirPath;
    }

    const candidates = [
      process.env.FACE_API_MODEL_DIR,
      path.join(process.cwd(), "assets", "face-models"),
      path.join(__dirname, "assets", "face-models"),
      path.join(process.resourcesPath, "assets", "face-models"),
      path.join(process.cwd(), "models", "face-api"),
      path.join(__dirname, "models", "face-api"),
      path.join(process.resourcesPath, "models", "face-api"),
      path.join(process.cwd(), "node_modules", "@vladmandic", "face-api", "model"),
      path.join(__dirname, "node_modules", "@vladmandic", "face-api", "model"),
    ].filter(Boolean);

    for (const candidate of candidates) {
      if (await hasRequiredFaceModelFiles(candidate)) {
        cachedFaceModelDirPath = candidate;
        return candidate;
      }
    }

    return "";
  }

  async function ensureFaceApiModelsLoaded(faceapi) {
    const modelDir = await resolveFaceModelDirPath(activeDetectorType);
    if (!modelDir) {
      throw new Error("Face model files not found. Set FACE_API_MODEL_DIR or place models in models/face-api (or assets/face-models).");
    }

    let loadedDetectorType = activeDetectorType;

    if (activeDetectorType === "ssd") {
      try {
        if (!faceapi?.nets?.ssdMobilenetv1?.isLoaded) {
          await faceapi.nets.ssdMobilenetv1.loadFromDisk(modelDir);
        }
      } catch (error) {
        const message = String(error?.message || error || "").toLowerCase();
        const missingSsdWeights = message.includes("ssd_mobilenetv1_model-weights_manifest.json") || message.includes("enoent");
        if (!missingSsdWeights) {
          throw error;
        }

        loadedDetectorType = "tiny";
        if (!faceapi?.nets?.tinyFaceDetector?.isLoaded) {
          await faceapi.nets.tinyFaceDetector.loadFromDisk(modelDir);
        }
        cachedFaceDetectorMode = "tiny";

        if (!loggedSsdFallbackWarning) {
          sendToRenderer("index-log", {
            message: "SSD face model weights are missing; falling back to TinyFaceDetector. Add ssd_mobilenetv1 weights to re-enable SSD accuracy.",
          });
          loggedSsdFallbackWarning = true;
        }
      }
    } else if (!faceapi?.nets?.tinyFaceDetector?.isLoaded) {
      await faceapi.nets.tinyFaceDetector.loadFromDisk(modelDir);
      loadedDetectorType = "tiny";
    }
    if (!faceapi?.nets?.faceLandmark68Net?.isLoaded) {
      await faceapi.nets.faceLandmark68Net.loadFromDisk(modelDir);
    }
    if (!faceapi?.nets?.faceRecognitionNet?.isLoaded) {
      await faceapi.nets.faceRecognitionNet.loadFromDisk(modelDir);
    }

    return loadedDetectorType;
  }

  async function ensureFaceTfBackendReady(faceapi) {
    if (cachedFaceTfBackendReady) {
      return;
    }

    const tf = faceapi?.tf;
    if (!tf || typeof tf.ready !== "function") {
      throw new Error("TensorFlow backend is unavailable in face-api module.");
    }

    if (typeof tf.setBackend === "function") {
      const currentBackend = typeof tf.getBackend === "function" ? String(tf.getBackend() || "") : "";
      if (currentBackend !== "wasm") {
        await tf.setBackend("wasm");
      }
    }

    await tf.ready();
    cachedFaceTfBackendReady = true;
  }

  try {
    const sharp = await loadSharpModule();
    if (!sharp) {
      return { ok: false, message: "sharp is unavailable for face analysis input decoding." };
    }

    const faceapi = await loadFaceApiModule();
    await ensureFaceTfBackendReady(faceapi);
    activeDetectorType = await ensureFaceApiModelsLoaded(faceapi);

    const raw = await sharp(imagePath)
      .rotate()
      .toColorspace("srgb")
      .raw()
      .toBuffer({ resolveWithObject: true });

    const width = Number(raw?.info?.width || 0);
    const height = Number(raw?.info?.height || 0);
    const channels = Number(raw?.info?.channels || 3);
    if (!width || !height) {
      return { ok: false, message: "Invalid image dimensions for face analysis." };
    }

    const tensor = faceapi.tf.tensor3d(new Uint8Array(raw.data), [height, width, channels], "int32");

    try {
      const minDetectionConfidence = Number(faceSettings?.minDetectionConfidence ?? 0.6);
      const detectionOptions = activeDetectorType === "ssd"
        ? new faceapi.SsdMobilenetv1Options({ minConfidence: minDetectionConfidence })
        : new faceapi.TinyFaceDetectorOptions({
          inputSize: 416,
          scoreThreshold: minDetectionConfidence,
        });

      const detections = await faceapi
        .detectAllFaces(tensor, detectionOptions)
        .withFaceLandmarks()
        .withFaceDescriptors();

      const minQuality = Number(faceSettings?.minQualityScore ?? 0.45);
      const faces = [];
      for (let i = 0; i < detections.length; i += 1) {
        const row = detections[i];
        const box = row?.detection?.box;
        const score = Number(row?.detection?.score || 0);
        if (!box || !Number.isFinite(score)) {
          continue;
        }

        const areaRatio = Math.max(0, Math.min(1, (Number(box.width || 0) * Number(box.height || 0)) / (width * height)));
        const qualityScore = Math.max(0, Math.min(1, (score * 0.7) + (areaRatio * 0.3)));
        if (qualityScore < minQuality) {
          continue;
        }

        const descriptor = Array.isArray(row?.descriptor)
          ? row.descriptor
          : row?.descriptor?.length
            ? Array.from(row.descriptor)
            : [];
        const embedding = descriptor.map((value) => Number(value)).filter((value) => Number.isFinite(value));

        const faceKey = `${imagePath}:${i}:${box.x}:${box.y}:${box.width}:${box.height}`;
        faces.push({
          face_id: createHash("sha1").update(faceKey).digest("hex").slice(0, 16),
          bbox: {
            x: Number(box.x || 0) / width,
            y: Number(box.y || 0) / height,
            width: Number(box.width || 0) / width,
            height: Number(box.height || 0) / height,
          },
          detection_confidence: score,
          embedding,
          quality_score: qualityScore,
          cluster_id: null,
          person_label: null,
        });
      }

      return {
        ok: true,
        result: {
          version: modelVersion,
          processed_at: new Date().toISOString(),
          face_count: faces.length,
          faces,
        },
      };
    } finally {
      if (typeof tensor?.dispose === "function") {
        tensor.dispose();
      }
    }
  } catch (error) {
    return { ok: false, message: String(error?.message || error) };
  }
}

async function ensureUserSettingsFileExists() {
  if (await pathExists(USER_SETTINGS_PATH)) {
    return;
  }

  const settings = await readUserSettings();
  await writeUserSettings(settings);
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
  const width = Number(localMeta?.image_info?.width ?? localMeta?.video_info?.width);
  const height = Number(localMeta?.image_info?.height ?? localMeta?.video_info?.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return "";
  }

  const mp = (width * height) / 1_000_000;
  return `${Math.round(width)}x${Math.round(height)} (~${mp.toFixed(2)}mp)`;
}

function extractFileTypeValue(row) {
  const rawPath = String(row?.path || row?.image_path || "").trim();
  const ext = path.extname(rawPath).toLowerCase();
  return ext.startsWith(".") ? ext.slice(1) : ext;
}

function toYesNo(value) {
  return value === true ? "yes" : value === false ? "no" : "";
}

function toFpsLabel(value) {
  const fps = Number(value);
  if (!Number.isFinite(fps) || fps <= 0) {
    return "";
  }
  const common = [24, 25, 30, 48, 50, 60, 120];
  for (const candidate of common) {
    if (Math.abs(fps - candidate) <= 1) {
      return candidate >= 120 ? "120fps+" : `${candidate}fps`;
    }
  }
  const rounded = Math.round(fps);
  return rounded >= 120 ? "120fps+" : `${rounded}fps`;
}

function deriveDurationBucket(value) {
  const duration = Number(value || 0);
  if (!Number.isFinite(duration) || duration <= 0) {
    return "";
  }
  if (duration < 6) {
    return "0-6 secs";
  }
  if (duration < 15) {
    return "6-15 secs";
  }
  if (duration < 30) {
    return "15-30 secs";
  }
  if (duration < 45) {
    return "30-45 secs";
  }
  if (duration < 60) {
    return "45-60 secs";
  }
  return "more than 1 minute";
}

function deriveHasAudio(localMeta) {
  if (localMeta?.content_hints?.has_audio === true) {
    return "yes";
  }
  if (localMeta?.content_hints?.has_audio === false) {
    return "no";
  }
  const trackCount = Number(localMeta?.audio_info?.track_count || 0);
  if (Number.isFinite(trackCount) && trackCount > 0) {
    return "yes";
  }
  return "";
}

function deriveHasCaptions(localMeta) {
  if (localMeta?.content_hints?.has_subtitles === true) {
    return "yes";
  }
  if (localMeta?.content_hints?.has_subtitles === false) {
    return "no";
  }
  const trackCount = Number(localMeta?.subtitle_info?.track_count || 0);
  if (Number.isFinite(trackCount) && trackCount > 0) {
    return "yes";
  }
  return "";
}

function deriveAudioType(localMeta) {
  const tracks = Array.isArray(localMeta?.audio_info?.tracks) ? localMeta.audio_info.tracks : [];
  if (tracks.length === 0) {
    return "silent";
  }

  const totalChannels = tracks.reduce((sum, track) => sum + Number(track?.channels || 0), 0);
  const avgChannels = tracks.length > 0 ? totalChannels / tracks.length : 0;
  const avgSampleRate = tracks.reduce((sum, track) => sum + Number(track?.sample_rate || 0), 0) / tracks.length;

  if (avgChannels >= 6) {
    return "sfx";
  }
  if (avgChannels >= 2 && Number.isFinite(avgSampleRate) && avgSampleRate >= 44100) {
    return "music";
  }
  return "speech";
}

function deriveMotionLevel(localMeta) {
  const fps = Number(localMeta?.video_info?.frame_rate || 0);
  const bitrate = Number(localMeta?.video_info?.bitrate || 0);
  const likelySource = String(localMeta?.source?.likely_source || "").toLowerCase();

  if (likelySource === "screen_recording") {
    return "static camera";
  }
  if (!Number.isFinite(fps) || fps <= 0) {
    return "";
  }
  if (fps <= 24 && bitrate < 5_000_000) {
    return "static camera";
  }
  if (fps <= 40) {
    return "slow";
  }
  return "fast/action";
}

function normalizeTagList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(new Set(
    value
      .map((entry) => String(entry || "").trim().toLowerCase())
      .filter(Boolean),
  ));
}

function scoreToBand(value) {
  const score = Number(value);
  if (!Number.isFinite(score)) {
    return "";
  }
  if (score >= 70) {
    return "high";
  }
  if (score >= 40) {
    return "medium";
  }
  return "low";
}

function extractLocalFilterData(row) {
  const metadata = row?.metadata || {};
  const localMeta = row?.local_metadata || {};
  const cloudMeta = row?.cloud_metadata && typeof row.cloud_metadata === "object" ? row.cloud_metadata : {};
  const videoAnalysis = row?.video_analysis && typeof row.video_analysis === "object"
    ? row.video_analysis
    : metadata?.video_analysis && typeof metadata.video_analysis === "object"
      ? metadata.video_analysis
      : {};
  const filtering = localMeta?.filtering && typeof localMeta.filtering === "object"
    ? localMeta.filtering
    : {};
  const mediaType = String(metadata?.media_type || row?.media_type || localMeta?.media_type || "image").toLowerCase();
  const orientationValue = String(
    filtering?.orientation || (
      mediaType === "video"
        ? localMeta?.video_info?.orientation
        : localMeta?.image_info?.orientation
    ) || "",
  ).toLowerCase();

  const sceneTags = normalizeTagList(
    row?.sceneTags || cloudMeta?.sceneTags || metadata?.scene_tags || videoAnalysis?.sceneTags,
  );
  const objectTags = normalizeTagList(
    row?.objectTags || cloudMeta?.objectTags || metadata?.object_tags || videoAnalysis?.objectTags,
  );
  const activityTags = normalizeTagList(
    row?.activityTags || cloudMeta?.activityTags || metadata?.activity_tags || videoAnalysis?.activityTags,
  );
  const aspectRatioSuitabilityValues = normalizeTagList(
    row?.aspectRatioSuitability || cloudMeta?.aspectRatioSuitability || videoAnalysis?.aspectRatioSuitability,
  );

  const socialMediaBand = scoreToBand(
    row?.socialMediaScore ?? cloudMeta?.socialMediaScore ?? videoAnalysis?.socialMediaScore,
  );
  const instagramBand = scoreToBand(
    row?.instagramScore ?? cloudMeta?.instagramScore ?? videoAnalysis?.instagramScore,
  );
  const faceAnalysis = localMeta?.face_analysis && typeof localMeta.face_analysis === "object"
    ? localMeta.face_analysis
    : {};
  const faceRows = Array.isArray(faceAnalysis.faces) ? faceAnalysis.faces : [];
  const personLabels = Array.from(new Set(
    faceRows
      .map((face) => sanitizePersonLabel(face?.person_label).toLowerCase())
      .filter(Boolean),
  ));
  const faceClusterIds = Array.from(new Set(
    faceRows
      .map((face) => String(face?.cluster_id || "").trim().toLowerCase())
      .filter(Boolean),
  ));

  return {
    containsPeople: metadata?.contains_people === true ? "yes" : metadata?.contains_people === false ? "no" : "any",
    containsText: metadata?.contains_text === true ? "yes" : metadata?.contains_text === false ? "no" : "any",
    ocrCorpus: extractOcrCorpusFromRow(row),
    resolutionMegapixels: String(filtering?.resolutionMegapixels || buildResolutionMegapixelsLabel(localMeta) || "").toLowerCase(),
    aspectRatio: String(filtering?.aspectRatio || normalizeAspectRatioFromMeta(localMeta) || "").toLowerCase(),
    fileType: String(extractFileTypeValue(row) || "").toLowerCase(),
    durationBucket: String(
      filtering?.durationBucket || deriveDurationBucket(localMeta?.video_info?.duration_seconds || localMeta?.content_hints?.duration_seconds) || "",
    ).toLowerCase(),
    fpsLabel: String(toFpsLabel(filtering?.fps || localMeta?.video_info?.frame_rate) || "").toLowerCase(),
    hasAudio: String(toYesNo(filtering?.hasAudio) || deriveHasAudio(localMeta) || "").toLowerCase(),
    audioType: String(filtering?.audioType || deriveAudioType(localMeta) || "").toLowerCase(),
    hasCaptions: String(toYesNo(filtering?.hasCaptions) || deriveHasCaptions(localMeta) || "").toLowerCase(),
    motionLevel: String(filtering?.motionLevel || deriveMotionLevel(localMeta) || "").toLowerCase(),
    style: String(metadata?.style || localMeta?.source?.likely_source || "").toLowerCase(),
    orientation: orientationValue,
    brightnessCategory: String(localMeta?.color_analysis?.brightness_category || "").toLowerCase(),
    sceneTags,
    objectTags,
    activityTags,
    socialMediaBand,
    instagramBand,
    aspectRatioSuitabilityValues,
    aestheticStyle: String(
      row?.aestheticStyle || cloudMeta?.aestheticStyle || videoAnalysis?.aestheticStyle || "",
    ).toLowerCase(),
    editingLevel: String(
      row?.editingLevel || cloudMeta?.editingLevel || videoAnalysis?.editingLevel || "",
    ).toLowerCase(),
    visualComplexity: String(
      row?.visualComplexity || cloudMeta?.visualComplexity || videoAnalysis?.visualComplexity || "",
    ).toLowerCase(),
    heroElement: String(
      row?.heroElement || cloudMeta?.heroElement || videoAnalysis?.heroElement || "",
    ).toLowerCase(),
    depthOfField: String(
      row?.depthOfField || cloudMeta?.depthOfField || videoAnalysis?.depthOfField || "",
    ).toLowerCase(),
    personLabels,
    faceClusterIds,
  };
}

function splitOcrQueryTerms(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return [];
  }

  const terms = raw
    .split(/[\n,;|]+/)
    .map((term) => term.trim().toLowerCase())
    .filter(Boolean);

  return Array.from(new Set(terms));
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasExactOcrTermMatch(ocrCorpusText, terms) {
  const corpus = String(ocrCorpusText || "").toLowerCase();
  if (!corpus || !Array.isArray(terms) || terms.length === 0) {
    return false;
  }

  return terms.every((term) => {
    const normalizedTerm = String(term || "").trim().toLowerCase();
    if (!normalizedTerm) {
      return true;
    }

    const termPattern = escapeRegex(normalizedTerm).replace(/\s+/g, "\\s+");
    const regex = new RegExp(`(^|[^a-z0-9])${termPattern}([^a-z0-9]|$)`, "i");
    return regex.test(corpus);
  });
}

function extractOcrCorpusFromRow(row) {
  const parts = [];
  const pushText = (value) => {
    const text = String(value || "").trim();
    if (text) {
      parts.push(text);
    }
  };

  const metadata = row?.metadata || {};

  // Top-level OCR fields used by cloud/local/index variants.
  pushText(row?.ocr?.all_text);
  pushText(row?.ocr_text);
  pushText(row?.all_text);
  pushText(row?.local_metadata?.ai_analysis?.ocr_text);

  // Metadata-nested OCR fields used by some exports.
  pushText(metadata?.ocr?.all_text);
  pushText(metadata?.ocr_text);
  pushText(metadata?.all_text);
  pushText(metadata?.text);

  // Video OCR fields (top-level and metadata-nested variants).
  pushText(row?.video_analysis?.ocr?.all_text);
  pushText(row?.video_analysis?.ocr_all_text);
  pushText(row?.video_analysis?.aggregated_ocr_text);
  pushText(row?.video_analysis?.summary?.ocr_all_text);
  pushText(row?.video_analysis?.summary?.ocr_text);
  pushText(metadata?.video_analysis?.ocr?.all_text);
  pushText(metadata?.video_analysis?.ocr_all_text);
  pushText(metadata?.video_analysis?.aggregated_ocr_text);
  pushText(metadata?.video_analysis?.summary?.ocr_all_text);
  pushText(metadata?.video_analysis?.summary?.ocr_text);

  const frameAnalyses = Array.isArray(row?.video_analysis?.frame_analyses)
    ? row.video_analysis.frame_analyses
    : [];
  const sampledFrames = Array.isArray(row?.video_analysis?.frames)
    ? row.video_analysis.frames
    : [];
  const metadataFrameAnalyses = Array.isArray(metadata?.video_analysis?.frame_analyses)
    ? metadata.video_analysis.frame_analyses
    : [];
  const metadataSampledFrames = Array.isArray(metadata?.video_analysis?.frames)
    ? metadata.video_analysis.frames
    : [];

  for (const frame of [...frameAnalyses, ...sampledFrames, ...metadataFrameAnalyses, ...metadataSampledFrames]) {
    pushText(frame?.ocr?.all_text);
    pushText(frame?.ocr_all_text);
    pushText(frame?.ocr_text);
  }

  return parts.join(" ").toLowerCase();
}

function mergeFilterData(currentValue, nextValue) {
  const current = currentValue && typeof currentValue === "object" ? currentValue : {};
  const next = nextValue && typeof nextValue === "object" ? nextValue : {};

  return {
    containsPeople: next.containsPeople !== "any" ? next.containsPeople : (current.containsPeople || "any"),
    containsText: next.containsText !== "any" ? next.containsText : (current.containsText || "any"),
    ocrCorpus: String(next.ocrCorpus || current.ocrCorpus || ""),
    resolutionMegapixels: String(next.resolutionMegapixels || current.resolutionMegapixels || ""),
    aspectRatio: String(next.aspectRatio || current.aspectRatio || ""),
    fileType: String(next.fileType || current.fileType || ""),
    durationBucket: String(next.durationBucket || current.durationBucket || ""),
    fpsLabel: String(next.fpsLabel || current.fpsLabel || ""),
    hasAudio: String(next.hasAudio || current.hasAudio || ""),
    audioType: String(next.audioType || current.audioType || ""),
    hasCaptions: String(next.hasCaptions || current.hasCaptions || ""),
    motionLevel: String(next.motionLevel || current.motionLevel || ""),
    style: String(next.style || current.style || ""),
    orientation: String(next.orientation || current.orientation || ""),
    brightnessCategory: String(next.brightnessCategory || current.brightnessCategory || ""),
    sceneTags: Array.from(new Set([
      ...(Array.isArray(current.sceneTags) ? current.sceneTags : []),
      ...(Array.isArray(next.sceneTags) ? next.sceneTags : []),
    ])),
    objectTags: Array.from(new Set([
      ...(Array.isArray(current.objectTags) ? current.objectTags : []),
      ...(Array.isArray(next.objectTags) ? next.objectTags : []),
    ])),
    activityTags: Array.from(new Set([
      ...(Array.isArray(current.activityTags) ? current.activityTags : []),
      ...(Array.isArray(next.activityTags) ? next.activityTags : []),
    ])),
    socialMediaBand: String(next.socialMediaBand || current.socialMediaBand || ""),
    instagramBand: String(next.instagramBand || current.instagramBand || ""),
    aspectRatioSuitabilityValues: Array.from(new Set([
      ...(Array.isArray(current.aspectRatioSuitabilityValues) ? current.aspectRatioSuitabilityValues : []),
      ...(Array.isArray(next.aspectRatioSuitabilityValues) ? next.aspectRatioSuitabilityValues : []),
    ])),
    aestheticStyle: String(next.aestheticStyle || current.aestheticStyle || ""),
    editingLevel: String(next.editingLevel || current.editingLevel || ""),
    visualComplexity: String(next.visualComplexity || current.visualComplexity || ""),
    heroElement: String(next.heroElement || current.heroElement || ""),
    depthOfField: String(next.depthOfField || current.depthOfField || ""),
    personLabels: Array.from(new Set([
      ...(Array.isArray(current.personLabels) ? current.personLabels : []),
      ...(Array.isArray(next.personLabels) ? next.personLabels : []),
    ])),
    faceClusterIds: Array.from(new Set([
      ...(Array.isArray(current.faceClusterIds) ? current.faceClusterIds : []),
      ...(Array.isArray(next.faceClusterIds) ? next.faceClusterIds : []),
    ])),
  };
}

async function loadLocalFilterLookup() {
  const localFilePath = path.join(DATA_DIR_PATH, "local-image_metadata_results.json");
  const cloudFilePath = path.join(DATA_DIR_PATH, "cloud-image_metadata_results.json");
  const lookup = new Map();

  const sourcePaths = [localFilePath, cloudFilePath];
  for (const sourcePath of sourcePaths) {
    if (!(await pathExists(sourcePath))) {
      continue;
    }
    try {
      const payload = JSON.parse(await fs.readFile(sourcePath, "utf-8"));
      const rows = Array.isArray(payload?.results) ? payload.results : [];
      for (const row of rows) {
        if (String(row?.status || "") !== "ok") {
          continue;
        }
        const rowPath = String(row?.path || row?.image_path || "").trim();
        if (!rowPath) {
          continue;
        }
        const existing = lookup.get(rowPath);
        lookup.set(rowPath, mergeFilterData(existing, extractLocalFilterData(row)));
      }
    } catch {
      // Continue with available sources.
    }
  }

  return lookup;
}

function applyGalleryFilters(items, localFilterLookup, filters) {
  const activeFilters = filters && typeof filters === "object" ? filters : {};
  const mediaTypeFilter = String(activeFilters.mediaType || "any").toLowerCase();
  const ocrTextTerms = splitOcrQueryTerms(activeFilters.ocrTextQuery);
  const normalizeMultiEnumFilter = (value) => {
    const values = Array.isArray(value) ? value : [value];
    return Array.from(new Set(
      values
        .map((entry) => String(entry || "").trim().toLowerCase())
        .filter((entry) => entry && entry !== "any"),
    ));
  };
  const selectedSceneTags = normalizeMultiEnumFilter(activeFilters.sceneTag);
  const selectedObjectTags = normalizeMultiEnumFilter(activeFilters.objectTag);
  const selectedActivityTags = normalizeMultiEnumFilter(activeFilters.activityTag);

  return items.filter((item) => {
    const itemPath = String(item?.path || "");
    const itemMediaType = String(item?.media_type || getMediaTypeFromPath(itemPath, "image")).toLowerCase();
    const filterData = localFilterLookup.get(String(item?.path || "")) || {};
    const containsPeople = String(activeFilters.containsPeople || "any").toLowerCase();
    const containsText = String(activeFilters.containsText || "any").toLowerCase();
    const style = String(activeFilters.style || "any").toLowerCase();
    const orientation = String(activeFilters.orientation || "any").toLowerCase();
    const brightnessCategory = String(activeFilters.brightnessCategory || "any").toLowerCase();
    const resolutionMegapixels = String(activeFilters.resolutionMegapixels || "any").toLowerCase();
    const aspectRatio = String(activeFilters.aspectRatio || "any").toLowerCase();
    const fileType = String(activeFilters.fileType || "any").toLowerCase();
    const durationBucket = String(activeFilters.durationBucket || "any").toLowerCase();
    const fpsLabel = String(activeFilters.fpsLabel || "any").toLowerCase();
    const hasAudio = String(activeFilters.hasAudio || "any").toLowerCase();
    const audioType = String(activeFilters.audioType || "any").toLowerCase();
    const hasCaptions = String(activeFilters.hasCaptions || "any").toLowerCase();
    const motionLevel = String(activeFilters.motionLevel || "any").toLowerCase();
    const socialMediaBand = String(activeFilters.socialMediaBand || "any").toLowerCase();
    const instagramBand = String(activeFilters.instagramBand || "any").toLowerCase();
    const aspectRatioSuitability = String(activeFilters.aspectRatioSuitability || "any").toLowerCase();
    const aestheticStyle = String(activeFilters.aestheticStyle || "any").toLowerCase();
    const editingLevel = String(activeFilters.editingLevel || "any").toLowerCase();
    const visualComplexity = String(activeFilters.visualComplexity || "any").toLowerCase();
    const heroElement = String(activeFilters.heroElement || "any").toLowerCase();
    const depthOfField = String(activeFilters.depthOfField || "any").toLowerCase();
    const personLabel = String(activeFilters.personLabel || "any").toLowerCase();
    const faceClusterId = String(activeFilters.faceClusterId || "any").toLowerCase();

    if (mediaTypeFilter !== "any" && itemMediaType !== mediaTypeFilter) {
      return false;
    }

    if (containsPeople !== "any" && String(filterData.containsPeople || "any") !== containsPeople) {
      return false;
    }
    if (containsText !== "any" && String(filterData.containsText || "any") !== containsText) {
      return false;
    }
    if (style !== "any" && String(filterData.style || "") !== style) {
      return false;
    }
    if (orientation !== "any" && String(filterData.orientation || "") !== orientation) {
      return false;
    }
    if (brightnessCategory !== "any" && String(filterData.brightnessCategory || "") !== brightnessCategory) {
      return false;
    }
    if (resolutionMegapixels !== "any" && String(filterData.resolutionMegapixels || "") !== resolutionMegapixels) {
      return false;
    }
    if (aspectRatio !== "any" && String(filterData.aspectRatio || "") !== aspectRatio) {
      return false;
    }
    if (fileType !== "any" && String(filterData.fileType || "") !== fileType) {
      return false;
    }
    if (durationBucket !== "any" && String(filterData.durationBucket || "") !== durationBucket) {
      return false;
    }
    if (fpsLabel !== "any" && String(filterData.fpsLabel || "") !== fpsLabel) {
      return false;
    }
    if (hasAudio !== "any" && String(filterData.hasAudio || "") !== hasAudio) {
      return false;
    }
    if (audioType !== "any" && String(filterData.audioType || "") !== audioType) {
      return false;
    }
    if (hasCaptions !== "any" && String(filterData.hasCaptions || "") !== hasCaptions) {
      return false;
    }
    if (motionLevel !== "any" && String(filterData.motionLevel || "") !== motionLevel) {
      return false;
    }
    if (
      selectedSceneTags.length > 0 &&
      !(Array.isArray(filterData.sceneTags) && selectedSceneTags.some((value) => filterData.sceneTags.includes(value)))
    ) {
      return false;
    }
    if (
      selectedObjectTags.length > 0 &&
      !(Array.isArray(filterData.objectTags) && selectedObjectTags.some((value) => filterData.objectTags.includes(value)))
    ) {
      return false;
    }
    if (
      selectedActivityTags.length > 0 &&
      !(Array.isArray(filterData.activityTags) && selectedActivityTags.some((value) => filterData.activityTags.includes(value)))
    ) {
      return false;
    }
    if (socialMediaBand !== "any" && String(filterData.socialMediaBand || "") !== socialMediaBand) {
      return false;
    }
    if (instagramBand !== "any" && String(filterData.instagramBand || "") !== instagramBand) {
      return false;
    }
    if (
      aspectRatioSuitability !== "any" &&
      !(Array.isArray(filterData.aspectRatioSuitabilityValues) && filterData.aspectRatioSuitabilityValues.includes(aspectRatioSuitability))
    ) {
      return false;
    }
    if (aestheticStyle !== "any" && String(filterData.aestheticStyle || "") !== aestheticStyle) {
      return false;
    }
    if (editingLevel !== "any" && String(filterData.editingLevel || "") !== editingLevel) {
      return false;
    }
    if (visualComplexity !== "any" && String(filterData.visualComplexity || "") !== visualComplexity) {
      return false;
    }
    if (heroElement !== "any" && String(filterData.heroElement || "") !== heroElement) {
      return false;
    }
    if (depthOfField !== "any" && String(filterData.depthOfField || "") !== depthOfField) {
      return false;
    }
    if (personLabel !== "any" && !(Array.isArray(filterData.personLabels) && filterData.personLabels.includes(personLabel))) {
      return false;
    }
    if (faceClusterId !== "any" && !(Array.isArray(filterData.faceClusterIds) && filterData.faceClusterIds.includes(faceClusterId))) {
      return false;
    }
    if (ocrTextTerms.length > 0) {
      const ocrCorpus = String(filterData.ocrCorpus || "").toLowerCase();
      if (!hasExactOcrTermMatch(ocrCorpus, ocrTextTerms)) {
        return false;
      }
    }

    return true;
  });
}

async function getLocalFilterOptions() {
  const localLookup = await loadLocalFilterLookup();
  const options = {
    resolutionMegapixels: new Set(),
    aspectRatio: new Set(),
    fileType: new Set(),
    durationBucket: new Set(),
    fpsLabel: new Set(),
    hasAudio: new Set(),
    audioType: new Set(),
    hasCaptions: new Set(),
    motionLevel: new Set(),
    style: new Set(),
    orientation: new Set(),
    brightnessCategory: new Set(),
    sceneTag: new Set(),
    objectTag: new Set(),
    activityTag: new Set(),
    socialMediaBand: new Set(),
    instagramBand: new Set(),
    aspectRatioSuitability: new Set(),
    aestheticStyle: new Set(),
    editingLevel: new Set(),
    visualComplexity: new Set(),
    heroElement: new Set(),
    depthOfField: new Set(),
    personLabel: new Set(),
    faceClusterId: new Set(),
  };

  for (const filterData of localLookup.values()) {
    if (filterData.resolutionMegapixels) {
      options.resolutionMegapixels.add(filterData.resolutionMegapixels);
    }
    if (filterData.aspectRatio) {
      options.aspectRatio.add(filterData.aspectRatio);
    }
    if (filterData.fileType) {
      options.fileType.add(filterData.fileType);
    }
    if (filterData.durationBucket) {
      options.durationBucket.add(filterData.durationBucket);
    }
    if (filterData.fpsLabel) {
      options.fpsLabel.add(filterData.fpsLabel);
    }
    if (filterData.hasAudio) {
      options.hasAudio.add(filterData.hasAudio);
    }
    if (filterData.audioType) {
      options.audioType.add(filterData.audioType);
    }
    if (filterData.hasCaptions) {
      options.hasCaptions.add(filterData.hasCaptions);
    }
    if (filterData.motionLevel) {
      options.motionLevel.add(filterData.motionLevel);
    }
    if (filterData.style) {
      options.style.add(filterData.style);
    }
    if (filterData.orientation) {
      options.orientation.add(filterData.orientation);
    }
    if (filterData.brightnessCategory) {
      options.brightnessCategory.add(filterData.brightnessCategory);
    }
    for (const value of Array.isArray(filterData.sceneTags) ? filterData.sceneTags : []) {
      options.sceneTag.add(String(value));
    }
    for (const value of Array.isArray(filterData.objectTags) ? filterData.objectTags : []) {
      options.objectTag.add(String(value));
    }
    for (const value of Array.isArray(filterData.activityTags) ? filterData.activityTags : []) {
      options.activityTag.add(String(value));
    }
    if (filterData.socialMediaBand) {
      options.socialMediaBand.add(filterData.socialMediaBand);
    }
    if (filterData.instagramBand) {
      options.instagramBand.add(filterData.instagramBand);
    }
    for (const value of Array.isArray(filterData.aspectRatioSuitabilityValues) ? filterData.aspectRatioSuitabilityValues : []) {
      options.aspectRatioSuitability.add(String(value));
    }
    if (filterData.aestheticStyle) {
      options.aestheticStyle.add(filterData.aestheticStyle);
    }
    if (filterData.editingLevel) {
      options.editingLevel.add(filterData.editingLevel);
    }
    if (filterData.visualComplexity) {
      options.visualComplexity.add(filterData.visualComplexity);
    }
    if (filterData.heroElement) {
      options.heroElement.add(filterData.heroElement);
    }
    if (filterData.depthOfField) {
      options.depthOfField.add(filterData.depthOfField);
    }
    for (const value of Array.isArray(filterData.personLabels) ? filterData.personLabels : []) {
      options.personLabel.add(String(value));
    }
    for (const value of Array.isArray(filterData.faceClusterIds) ? filterData.faceClusterIds : []) {
      options.faceClusterId.add(String(value));
    }
  }

  return {
    resolutionMegapixels: Array.from(options.resolutionMegapixels).sort(),
    aspectRatio: Array.from(options.aspectRatio).sort(),
    fileType: Array.from(options.fileType).sort(),
    durationBucket: Array.from(options.durationBucket).sort(),
    fpsLabel: Array.from(options.fpsLabel).sort(),
    hasAudio: Array.from(options.hasAudio).sort(),
    audioType: Array.from(options.audioType).sort(),
    hasCaptions: Array.from(options.hasCaptions).sort(),
    motionLevel: Array.from(options.motionLevel).sort(),
    style: Array.from(options.style).sort(),
    orientation: Array.from(options.orientation).sort(),
    brightnessCategory: Array.from(options.brightnessCategory).sort(),
    sceneTag: Array.from(options.sceneTag).sort(),
    objectTag: Array.from(options.objectTag).sort(),
    activityTag: Array.from(options.activityTag).sort(),
    socialMediaBand: Array.from(options.socialMediaBand).sort(),
    instagramBand: Array.from(options.instagramBand).sort(),
    aspectRatioSuitability: Array.from(options.aspectRatioSuitability).sort(),
    aestheticStyle: Array.from(options.aestheticStyle).sort(),
    editingLevel: Array.from(options.editingLevel).sort(),
    visualComplexity: Array.from(options.visualComplexity).sort(),
    heroElement: Array.from(options.heroElement).sort(),
    depthOfField: Array.from(options.depthOfField).sort(),
    personLabel: Array.from(options.personLabel).sort(),
    faceClusterId: Array.from(options.faceClusterId).sort(),
  };
}

function getIndexingStageForItem(item, lookup) {
  const imagePath = String(item?.path || "").trim();
  const imageId = Number(item?.id);

  const hasLocal = lookup.localByPath.has(imagePath) || (Number.isFinite(imageId) && lookup.localById.has(imageId));
  const hasCloud = lookup.cloudByPath.has(imagePath) || (Number.isFinite(imageId) && lookup.cloudById.has(imageId));

  if (hasLocal && hasCloud) {
    return "full";
  }
  if (hasLocal) {
    return "local";
  }
  return "none";
}

async function resolveDefaultMetadataFilePath() {
  const candidates = [
    path.join(DATA_DIR_PATH, "cloud-image_metadata_results.json"),
    path.join(DATA_DIR_PATH, "local-image_metadata_results.json"),
    path.join(DATA_DIR_PATH, "metadata_results.json"),
    path.join(DATA_DIR_PATH, "image_metadata_results.json"),
    path.join(__dirname, "image_metadata_results.json"),
  ];

  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }

  return "";
}

function createWindow() {
  const appIconPath = path.join(__dirname, "assets", "app-icon-32.ico");

  const win = new BrowserWindow({
    width: 1240,
    height: 860,
    minWidth: 980,
    minHeight: 700,
    backgroundColor: "#1e1e1e",
    icon: appIconPath,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, "index.html"));
}

ipcMain.handle("pick-metadata-file", async (event) => {
  try {
    const parentWindow = BrowserWindow.fromWebContents(event.sender) || undefined;
    const result = await dialog.showOpenDialog(parentWindow, {
      title: "Choose image metadata JSON",
      filters: [{ name: "JSON", extensions: ["json"] }],
      properties: ["openFile"],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, message: "No file selected." };
    }

    return { ok: true, filePath: result.filePaths[0] };
  } catch (error) {
    return { ok: false, message: String(error?.message || error) };
  }
});

ipcMain.handle("validate-metadata-file", async (_event, filePath) => {
  return validateMetadataFile(filePath);
});

ipcMain.handle("semantic-search", async (_event, payload) => {
  const filters = payload?.filters && typeof payload.filters === "object" ? payload.filters : {};
  const requestedAlbumIds = Array.isArray(filters.albumIds)
    ? filters.albumIds.map((id) => Number(id)).filter((id) => Number.isFinite(id))
    : [];
  let allowedImagePaths = null;

  if (requestedAlbumIds.length > 0) {
    const albumsData = await loadAlbumsData();
    const allowed = new Set();
    for (const [imagePath, ids] of Object.entries(albumsData?.image_album_map || {})) {
      const linked = Array.isArray(ids) ? ids.map((id) => Number(id)) : [];
      if (linked.some((id) => requestedAlbumIds.includes(id))) {
        allowed.add(imagePath);
      }
    }
    allowedImagePaths = Array.from(allowed);
  }

  const minMatchFromPayload = Number(payload?.minScore);
  let effectiveMinScore = minMatchFromPayload;
  if (!Number.isFinite(effectiveMinScore)) {
    const settings = await readUserSettings();
    effectiveMinScore = Number(settings?.min_match_score || 0.001);
  }

  const runPayload = {
    ...(payload || {}),
    minScore: effectiveMinScore,
    allowedImagePaths,
  };

  const result = await runSemanticSearch(runPayload);

  try {
    await appendSearchHistoryEntry({
      query: String(payload?.query || ""),
      filePath: String(payload?.filePath || ""),
      topK: Number(payload?.topK || 20),
      minScore: effectiveMinScore,
      filters,
      allowedImagePathsCount: Array.isArray(allowedImagePaths) ? allowedImagePaths.length : 0,
      result,
    });
  } catch {
    // Logging must never break search.
  }

  return result;
});

ipcMain.handle("get-default-metadata-file", async () => {
  try {
    const filePath = await resolveDefaultMetadataFilePath();
    if (!filePath) {
      return { ok: false, message: "No metadata file found in data folder." };
    }

    return { ok: true, filePath };
  } catch (error) {
    return { ok: false, message: String(error?.message || error) };
  }
});

ipcMain.handle("get-image-metadata-by-path", async (_event, payload) => {
  try {
    const metadataFilePath = String(payload?.filePath || "").trim();
    const imagePath = String(payload?.imagePath || "").trim();
    if (!metadataFilePath || !imagePath) {
      return { ok: false, message: "filePath and imagePath are required." };
    }

    const resolvedPath = path.isAbsolute(metadataFilePath)
      ? metadataFilePath
      : path.resolve(process.cwd(), metadataFilePath);
    const text = await fs.readFile(resolvedPath, "utf-8");
    const json = JSON.parse(text);
    const rows = Array.isArray(json?.results) ? json.results : [];
    const needle = imagePath.toLowerCase();

    const exact = rows.find((row) => String(row?.path || row?.image_path || "") === imagePath);
    const windowsNormalized = exact || rows.find((row) => String(row?.path || row?.image_path || "").toLowerCase() === needle);

    if (!windowsNormalized) {
      return { ok: false, message: "Image metadata not found in the selected metadata file." };
    }

    const findRowByPath = (list, targetPath) => {
      const targetNeedle = String(targetPath || "").toLowerCase();
      const byExact = list.find((row) => String(row?.path || row?.image_path || "") === targetPath);
      if (byExact) {
        return byExact;
      }
      return list.find((row) => String(row?.path || row?.image_path || "").toLowerCase() === targetNeedle) || null;
    };

    const localPath = path.join(DATA_DIR_PATH, "local-image_metadata_results.json");
    const cloudPath = path.join(DATA_DIR_PATH, "cloud-image_metadata_results.json");

    let localRow = null;
    let cloudRow = null;

    if (await pathExists(localPath)) {
      try {
        const localJson = JSON.parse(await fs.readFile(localPath, "utf-8"));
        const localRows = Array.isArray(localJson?.results) ? localJson.results : [];
        localRow = findRowByPath(localRows, imagePath);
      } catch {
        localRow = null;
      }
    }

    if (await pathExists(cloudPath)) {
      try {
        const cloudJson = JSON.parse(await fs.readFile(cloudPath, "utf-8"));
        const cloudRows = Array.isArray(cloudJson?.results) ? cloudJson.results : [];
        cloudRow = findRowByPath(cloudRows, imagePath);
      } catch {
        cloudRow = null;
      }
    }

    const selectedPath = String(windowsNormalized?.path || windowsNormalized?.image_path || imagePath);
    const selectedCloudLike = Object.prototype.hasOwnProperty.call(windowsNormalized, "image_path");
    const selectedLocalLike = Object.prototype.hasOwnProperty.call(windowsNormalized, "local_metadata");

    const effectiveLocalRow = localRow || (selectedLocalLike ? windowsNormalized : null);
    const effectiveCloudRow = cloudRow || (selectedCloudLike ? windowsNormalized : null);

    const inferredMediaType = String(
      windowsNormalized?.media_type ||
      effectiveLocalRow?.media_type ||
      effectiveLocalRow?.metadata?.media_type ||
      effectiveCloudRow?.media_type ||
      getMediaTypeFromPath(selectedPath || imagePath, "image"),
    );

    const derivedMetadata = effectiveLocalRow?.metadata
      ? effectiveLocalRow.metadata
      : {
          title: path.basename(selectedPath || imagePath) || `Untitled ${inferredMediaType}`,
          description: String(effectiveCloudRow?.description || ""),
          tags: [],
          objects: [],
          style: "cloud",
          dominant_colors: [],
          contains_people: null,
          contains_text: Boolean(effectiveCloudRow?.ocr?.all_text),
          media_type: inferredMediaType,
        };

    const cloudMetadata = effectiveCloudRow
      ? {
          ...effectiveCloudRow,
          id: effectiveCloudRow?.id ?? null,
          image_path: String(effectiveCloudRow?.image_path || effectiveCloudRow?.path || imagePath),
          model_id: effectiveCloudRow?.model_id || null,
          analyzed_at: effectiveCloudRow?.analyzed_at || null,
          description: String(effectiveCloudRow?.description || ""),
          ocr: effectiveCloudRow?.ocr || { all_text: "", entries: [] },
          status: effectiveCloudRow?.status || "unknown",
          error: effectiveCloudRow?.error || "",
        }
      : null;

    const localMetadata = effectiveLocalRow
      ? effectiveLocalRow?.local_metadata || effectiveLocalRow
      : null;

    const mergedResult = {
      id: windowsNormalized?.id ?? effectiveLocalRow?.id ?? effectiveCloudRow?.id ?? null,
      path: selectedPath,
      image_path: String(effectiveCloudRow?.image_path || selectedPath || imagePath),
      media_type: inferredMediaType,
      status: windowsNormalized?.status || "ok",
      metadata: derivedMetadata,
      local_metadata: localMetadata,
      cloud_metadata: cloudMetadata,
      model_id: cloudMetadata?.model_id || null,
      analyzed_at: cloudMetadata?.analyzed_at || null,
      description: cloudMetadata?.description || null,
      ocr: cloudMetadata?.ocr || null,
      error:
        windowsNormalized?.error ||
        effectiveLocalRow?.error ||
        effectiveCloudRow?.error ||
        "",
    };

    return {
      ok: true,
      result: mergedResult,
    };
  } catch (error) {
    return { ok: false, message: String(error?.message || error) };
  }
});

ipcMain.handle("open-original-source-folder", async (_event, imagePath) => {
  try {
    const targetPath = String(imagePath || "").trim();
    if (!targetPath) {
      return { ok: false, message: "Image path is required." };
    }

    const targetDirectory = path.dirname(targetPath);
    const openError = await shell.openPath(targetDirectory);
    if (openError) {
      return { ok: false, message: openError };
    }

    return { ok: true, directory: targetDirectory };
  } catch (error) {
    return { ok: false, message: String(error?.message || error) };
  }
});

ipcMain.handle("export-media-file", async (_event, payload) => {
  try {
    const imagePath = String(payload?.imagePath || "").trim();
    if (!imagePath) {
      return { ok: false, message: "imagePath is required." };
    }

    const sourcePath = path.resolve(imagePath);
    if (!(await pathExists(sourcePath))) {
      return { ok: false, message: "Source file not found." };
    }

    const defaultName = path.basename(sourcePath);
    const defaultDir = app.getPath("downloads");
    const saveResult = await dialog.showSaveDialog({
      title: "Export Media File",
      defaultPath: path.join(defaultDir, defaultName),
      buttonLabel: "Export",
    });

    if (saveResult.canceled || !saveResult.filePath) {
      return { ok: false, message: "Export cancelled." };
    }

    const targetPath = path.resolve(saveResult.filePath);
    await fs.copyFile(sourcePath, targetPath);
    return { ok: true, path: targetPath };
  } catch (error) {
    return { ok: false, message: String(error?.message || error) };
  }
});

ipcMain.handle("delete-media-file", async (_event, payload) => {
  try {
    const imagePath = String(payload?.imagePath || "").trim();
    if (!imagePath) {
      return { ok: false, message: "imagePath is required." };
    }

    const sourcePath = path.resolve(imagePath);
    if (!(await pathExists(sourcePath))) {
      return { ok: false, message: "Source file not found." };
    }

    await shell.trashItem(sourcePath);
    return { ok: true, path: sourcePath };
  } catch (error) {
    return { ok: false, message: String(error?.message || error) };
  }
});

ipcMain.handle("copy-text", async (_event, text) => {
  try {
    clipboard.writeText(String(text || ""));
    return { ok: true };
  } catch (error) {
    return { ok: false, message: String(error?.message || error) };
  }
});

ipcMain.handle("get-ui-partial", async (_event, payload) => {
  try {
    const name = String(payload?.name || "").trim();
    const allowed = new Set(["settings-ui.html", "faces-ui.html"]);
    if (!allowed.has(name)) {
      return { ok: false, message: "Requested UI partial is not allowed." };
    }

    const targetPath = path.join(__dirname, name);
    if (!(await pathExists(targetPath))) {
      return { ok: false, message: `UI partial not found: ${name}` };
    }

    const text = await fs.readFile(targetPath, "utf-8");
    return { ok: true, text };
  } catch (error) {
    return { ok: false, message: String(error?.message || error) };
  }
});

ipcMain.handle("get-image-preview-src", async (_event, payload) => {
  try {
    const imagePath = String(payload?.imagePath || "").trim();
    const mediaType = String(payload?.mediaType || getMediaTypeFromPath(imagePath, "image"));
    return await resolvePreviewSrcForImage(imagePath, mediaType);
  } catch (error) {
    return { ok: false, message: String(error?.message || error) };
  }
});

ipcMain.handle("get-master-directory", async (_event, options) => {
  try {
    const payload = await loadMasterDirectory();
    const albumData = await loadAlbumsData();
    const items = Array.isArray(payload?.items) ? payload.items : [];
    const stageLookup = await loadIndexingStageLookup();
    const localFilterLookup = await loadLocalFilterLookup();
    const requestedOffset = Number(options?.offset);
    const requestedLimit = Number(options?.limit);
    const offset = Number.isFinite(requestedOffset)
      ? Math.max(0, Math.floor(requestedOffset))
      : 0;
    const limit = Number.isFinite(requestedLimit)
      ? Math.max(1, Math.min(Math.floor(requestedLimit), 500))
      : 120;

    const filteredByAlbums = filterItemsByAlbumIds(items, albumData, options?.filters?.albumIds);
    const filteredItems = applyGalleryFilters(filteredByAlbums, localFilterLookup, options?.filters);

    // Returning the full directory for very large libraries can OOM the renderer.
    const pageItems = filteredItems.slice(offset, offset + limit);
    const limitedItems = await Promise.all(
      pageItems.map(async (item) => {
        const itemPath = String(item?.path || "");
        const itemMediaType = String(item?.media_type || getMediaTypeFromPath(itemPath, "image"));
        const resolvedPreview = await resolvePreviewSrcForImage(itemPath, itemMediaType);
        return {
          ...item,
          media_type: itemMediaType,
          preview_src:
            resolvedPreview?.ok && resolvedPreview?.previewSrc
              ? resolvedPreview.previewSrc
              : item?.preview_src || toPreviewSrc(itemPath),
          indexing_stage: getIndexingStageForItem(item, stageLookup),
          local_filter_data: localFilterLookup.get(String(item?.path || "")) || null,
        };
      }),
    );
    return {
      ok: true,
      path: MASTER_DIRECTORY_PATH,
      total: filteredItems.length,
      offset,
      hasMore: offset + limitedItems.length < filteredItems.length,
      shown: limitedItems.length,
      generatedAt: payload?.generated_at || null,
      items: limitedItems,
    };
  } catch (error) {
    return { ok: false, message: String(error?.message || error), items: [] };
  }
});

ipcMain.handle("pick-custom-folders", async (event) => {
  try {
    const parentWindow = BrowserWindow.fromWebContents(event.sender) || undefined;
    const result = await dialog.showOpenDialog(parentWindow, {
      title: "Choose folders to scan",
      properties: ["openDirectory", "multiSelections", "createDirectory"],
    });

    if (result.canceled) {
      return { ok: false, message: "Folder selection cancelled.", paths: [] };
    }

    return { ok: true, paths: result.filePaths };
  } catch (error) {
    return { ok: false, message: String(error?.message || error), paths: [] };
  }
});

ipcMain.handle("get-user-settings", async () => {
  try {
    await ensureEnvFileExists();
    await ensureUserSettingsFileExists();
    const [storedSettings, envSettings] = await Promise.all([
      readUserSettings(),
      readEnvSettings(),
    ]);
    const settings = {
      ...storedSettings,
      aws_region: envSettings.aws_region || storedSettings.aws_region,
      aws_key: envSettings.aws_key || storedSettings.aws_key,
      secret_key: envSettings.secret_key || storedSettings.secret_key,
      model: envSettings.model || storedSettings.model,
    };
    return { ok: true, settings, envPath: ENV_FILE_PATH };
  } catch (error) {
    return { ok: false, message: String(error?.message || error) };
  }
});

ipcMain.handle("save-user-settings", async (_event, settings) => {
  try {
    const payload = settings || {};
    const saved = await writeUserSettings(payload);
    let envWarning = null;
    try {
      await writeEnvSettings(payload);
    } catch (error) {
      envWarning = String(error?.message || error);
    }
    await ensureUserSettingsFileExists();
    return {
      ok: true,
      settings: saved,
      path: USER_SETTINGS_PATH,
      envPath: ENV_FILE_PATH,
      warning: envWarning,
    };
  } catch (error) {
    return { ok: false, message: String(error?.message || error) };
  }
});

ipcMain.handle("get-local-filter-options", async () => {
  try {
    const options = await getLocalFilterOptions();
    return { ok: true, options };
  } catch (error) {
    return { ok: false, message: String(error?.message || error), options: {} };
  }
});

ipcMain.handle("get-face-clusters", async () => {
  try {
    const payload = await readLocalFaceClustersPayload();
    return {
      ok: true,
      path: LOCAL_FACE_CLUSTERS_OUTPUT_PATH,
      clusters: Array.isArray(payload?.clusters) ? payload.clusters : [],
      cluster_count: Number(payload?.cluster_count) || 0,
      total_faces_clustered: Number(payload?.total_faces_clustered) || 0,
      threshold: Number(payload?.threshold),
      generated_at: payload?.generated_at || null,
    };
  } catch (error) {
    return { ok: false, message: String(error?.message || error), clusters: [] };
  }
});

ipcMain.handle("set-face-cluster-label", async (_event, payload) => {
  try {
    return await setLocalFaceClusterLabel(payload?.clusterId, payload?.personLabel);
  } catch (error) {
    return { ok: false, message: String(error?.message || error) };
  }
});

ipcMain.handle("rebuild-face-clusters", async () => {
  try {
    const settings = await readUserSettings();
    return await rebuildLocalFaceClusters(getFaceIndexingSettings(settings));
  } catch (error) {
    return { ok: false, message: String(error?.message || error) };
  }
});

ipcMain.handle("get-albums", async () => {
  try {
    await ensureAlbumsDataFileExists();
    const data = await loadAlbumsData();
    const counts = computeAlbumImageCounts(data);
    const albums = (Array.isArray(data.albums) ? data.albums : [])
      .map((album) => ({
        ...album,
        image_count: Number(counts.get(Number(album.id)) || 0),
      }))
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
    return {
      ok: true,
      albums,
      path: ALBUMS_DATA_PATH,
    };
  } catch (error) {
    return { ok: false, message: String(error?.message || error), albums: [] };
  }
});

ipcMain.handle("create-album", async (_event, payload) => {
  try {
    const result = await createAlbumByName(payload?.name);
    if (!result?.ok) {
      return result;
    }
    return result;
  } catch (error) {
    return { ok: false, message: String(error?.message || error) };
  }
});

ipcMain.handle("rename-album", async (_event, payload) => {
  try {
    const albumId = Number(payload?.albumId);
    const name = String(payload?.name || "").trim();
    if (!Number.isFinite(albumId)) {
      return { ok: false, message: "albumId is required." };
    }
    if (!name) {
      return { ok: false, message: "Album name is required." };
    }

    const data = await loadAlbumsData();
    const duplicate = data.albums.find(
      (album) => Number(album?.id) !== albumId && String(album?.name || "").toLowerCase() === name.toLowerCase(),
    );
    if (duplicate) {
      return { ok: false, message: "An album with this name already exists." };
    }

    const target = data.albums.find((album) => Number(album?.id) === albumId);
    if (!target) {
      return { ok: false, message: "Album not found." };
    }

    target.name = name;
    target.updated_at = new Date().toISOString();
    const saved = await saveAlbumsData(data);
    const counts = computeAlbumImageCounts(saved);

    return {
      ok: true,
      album: {
        ...target,
        image_count: Number(counts.get(albumId) || 0),
      },
      path: ALBUMS_DATA_PATH,
    };
  } catch (error) {
    return { ok: false, message: String(error?.message || error) };
  }
});

ipcMain.handle("delete-album", async (_event, payload) => {
  try {
    const albumId = Number(payload?.albumId);
    if (!Number.isFinite(albumId)) {
      return { ok: false, message: "albumId is required." };
    }

    const data = await loadAlbumsData();
    const nextAlbums = data.albums.filter((album) => Number(album?.id) !== albumId);
    if (nextAlbums.length === data.albums.length) {
      return { ok: false, message: "Album not found." };
    }

    const nextMap = {};
    for (const [imagePath, ids] of Object.entries(data.image_album_map || {})) {
      const filtered = Array.isArray(ids)
        ? ids.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id !== albumId)
        : [];
      if (filtered.length > 0) {
        nextMap[imagePath] = Array.from(new Set(filtered));
      }
    }

    const saved = await saveAlbumsData({
      ...data,
      albums: nextAlbums,
      image_album_map: nextMap,
    });

    return {
      ok: true,
      albums: saved.albums,
      path: ALBUMS_DATA_PATH,
    };
  } catch (error) {
    return { ok: false, message: String(error?.message || error) };
  }
});

ipcMain.handle("assign-images-to-albums", async (_event, payload) => {
  try {
    const imagePaths = Array.isArray(payload?.imagePaths) ? payload.imagePaths : [];
    const albumIds = Array.isArray(payload?.albumIds) ? payload.albumIds : [];
    const createAlbumName = String(payload?.createAlbumName || "").trim();

    const targetAlbumIds = albumIds.map((id) => Number(id)).filter((id) => Number.isFinite(id));
    if (createAlbumName) {
      const created = await createAlbumByName(createAlbumName);
      if (!created?.ok) {
        return created;
      }
      targetAlbumIds.push(Number(created.album.id));
    }

    const deduped = Array.from(new Set(targetAlbumIds));
    const result = await assignImagePathsToAlbums(imagePaths, deduped);
    if (!result?.ok) {
      return result;
    }

    return {
      ok: true,
      assignedCount: result.assignedCount,
      albumIds: deduped,
      path: ALBUMS_DATA_PATH,
    };
  } catch (error) {
    return { ok: false, message: String(error?.message || error) };
  }
});

ipcMain.handle("remove-images-from-album", async (_event, payload) => {
  try {
    const albumId = Number(payload?.albumId);
    const imagePaths = Array.isArray(payload?.imagePaths)
      ? payload.imagePaths.map((value) => String(value || "").trim()).filter(Boolean)
      : [];
    if (!Number.isFinite(albumId)) {
      return { ok: false, message: "albumId is required." };
    }

    const data = await loadAlbumsData();
    let changed = 0;
    for (const imagePath of imagePaths) {
      const existing = Array.isArray(data.image_album_map[imagePath]) ? data.image_album_map[imagePath] : [];
      const filtered = existing.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id !== albumId);
      if (filtered.length === existing.length) {
        continue;
      }
      changed += 1;
      if (filtered.length === 0) {
        delete data.image_album_map[imagePath];
      } else {
        data.image_album_map[imagePath] = Array.from(new Set(filtered));
      }
    }

    await saveAlbumsData(data);
    return {
      ok: true,
      removedCount: changed,
      path: ALBUMS_DATA_PATH,
    };
  } catch (error) {
    return { ok: false, message: String(error?.message || error) };
  }
});

ipcMain.handle("get-album-images", async (_event, payload) => {
  try {
    const albumId = Number(payload?.albumId);
    if (!Number.isFinite(albumId)) {
      return { ok: false, message: "albumId is required.", items: [] };
    }

    const data = await loadAlbumsData();
    const album = data.albums.find((row) => Number(row?.id) === albumId);
    if (!album) {
      return { ok: false, message: "Album not found.", items: [] };
    }

    const payloadMaster = await loadMasterDirectory();
    const allItems = Array.isArray(payloadMaster?.items) ? payloadMaster.items : [];
    const stageLookup = await loadIndexingStageLookup();
    const localFilterLookup = await loadLocalFilterLookup();

    const requestedOffset = Number(payload?.offset);
    const requestedLimit = Number(payload?.limit);
    const offset = Number.isFinite(requestedOffset)
      ? Math.max(0, Math.floor(requestedOffset))
      : 0;
    const limit = Number.isFinite(requestedLimit)
      ? Math.max(1, Math.min(Math.floor(requestedLimit), 500))
      : 120;

    const filteredByAlbum = filterItemsByAlbumIds(allItems, data, [albumId]);
    const filtered = applyGalleryFilters(filteredByAlbum, localFilterLookup, payload?.filters);
    const pageItems = filtered.slice(offset, offset + limit);
    const paged = await Promise.all(
      pageItems.map(async (item) => {
        const itemPath = String(item?.path || "");
        const itemMediaType = String(item?.media_type || getMediaTypeFromPath(itemPath, "image"));
        const resolvedPreview = await resolvePreviewSrcForImage(itemPath, itemMediaType);
        return {
          ...item,
          media_type: itemMediaType,
          preview_src:
            resolvedPreview?.ok && resolvedPreview?.previewSrc
              ? resolvedPreview.previewSrc
              : item?.preview_src || toPreviewSrc(itemPath),
          indexing_stage: getIndexingStageForItem(item, stageLookup),
          local_filter_data: localFilterLookup.get(String(item?.path || "")) || null,
        };
      }),
    );

    return {
      ok: true,
      album: {
        ...album,
        image_count: filteredByAlbum.length,
      },
      total: filtered.length,
      offset,
      hasMore: offset + paged.length < filtered.length,
      items: paged,
      path: ALBUMS_DATA_PATH,
    };
  } catch (error) {
    return { ok: false, message: String(error?.message || error), items: [] };
  }
});

registerScanHandlers({
  ipcMain,
  sendToRenderer,
  waitWhilePaused,
  pathExists,
  updateMasterDirectoryFromScan,
  createAlbumByName,
  assignImagePathsToAlbums,
  startIndexingInternal,
  imageFileTypes: IMAGE_FILE_TYPES,
  videoFileTypes: VIDEO_FILE_TYPES,
  extendedFileTypes: EXTENDED_FILE_TYPES,
});

async function startIndexingInternal({ files, mode = "local" }) {
  if (indexState.running) {
    return { ok: false, message: "Indexing is already running." };
  }

  indexState.running = true;
  indexState.paused = false;
  indexState.cancelled = false;

  try {
    const explicitTargets = Array.isArray(files)
      ? files.map((entry) => String(entry || "").trim()).filter(Boolean)
      : [];
    let targets = explicitTargets;
    if (targets.length === 0) {
      targets = await getMasterDirectoryPaths();
      sendToRenderer("index-log", {
        message: `Indexing from master directory (${targets.length} media files).`,
      });
    }

    if (targets.length === 0) {
      const message = "No scanned files available to index.";
      sendToRenderer("index-complete", {
        ok: false,
        cancelled: false,
        message,
      });
      return { ok: false, message };
    }

    const normalizedMode = ["local", "cloud", "auto"].includes(String(mode || "").toLowerCase())
      ? String(mode).toLowerCase()
      : "local";
    const useCloud = normalizedMode === "cloud" || normalizedMode === "auto";
    const cloudModelId = process.env.BEDROCK_VISION_MODEL || "qwen.qwen3-vl-235b-a22b";
    const settings = await readUserSettings();
    const faceSettings = getFaceIndexingSettings(settings);

    const localExtractor = await loadLocalMetadataExtractor();
    let localVideoExtractor = null;
    if (!useCloud) {
      try {
        localVideoExtractor = await loadLocalVideoMetadataExtractor();
      } catch (error) {
        sendToRenderer("index-log", {
          message: `Video extractor unavailable, using video fallback metadata. ${String(error?.message || error)}`,
        });
      }
    }
    const cloudExtractor = useCloud ? await loadCloudMetadataExtractor() : null;
    const cloudVideoExtractor = useCloud ? await loadCloudVideoMetadataExtractor() : null;
    const idByPath = await getMasterDirectoryIdByPath();
    const existingIndex = await loadExistingIndexResults(useCloud);
    const existingRowsByPath = new Map();
    const existingRowsById = new Map();
    if (!useCloud) {
      for (const row of existingIndex.rows) {
        const rowPath = String(row?.path || "").trim();
        const rowId = Number(row?.id);
        if (rowPath) {
          existingRowsByPath.set(rowPath, row);
        }
        if (Number.isFinite(rowId)) {
          existingRowsById.set(rowId, row);
        }
      }
    }
    const localSuccessLookup = useCloud ? await loadSuccessfulLocalIndexLookup() : null;

    if (useCloud && Number(existingIndex.retryableFailedCount) > 0) {
      sendToRenderer("index-log", {
        message: `Cloud retry enabled: reprocessing ${existingIndex.retryableFailedCount} previously failed image${existingIndex.retryableFailedCount === 1 ? "" : "s"}.`,
      });
    }

    let skippedNotLocalIndexedCount = 0;
    if (useCloud) {
      targets = targets.filter((imagePath, i) => {
        const imageId = idByPath.get(imagePath) ?? i + 1;
        const hasLocalPath = localSuccessLookup.byPath.has(imagePath);
        const hasLocalId = localSuccessLookup.byId.has(imageId);
        const eligible = hasLocalPath || hasLocalId;
        if (!eligible) {
          skippedNotLocalIndexedCount += 1;
        }
        return eligible;
      });

      if (skippedNotLocalIndexedCount > 0) {
        sendToRenderer("index-log", {
          message: `Cloud prerequisite: skipped ${skippedNotLocalIndexedCount} media files not locally indexed yet.`,
        });
      }

    }

    const originalTargetCount = targets.length;
    const faceReprocessPaths = new Set();
    targets = targets.filter((imagePath, i) => {
      const imageId = idByPath.get(imagePath) ?? i + 1;

      if (!useCloud) {
        const existingRow = existingRowsByPath.get(imagePath) || existingRowsById.get(imageId) || null;
        if (existingRow) {
          const mediaType = getMediaTypeFromPath(imagePath, "image");
          if (faceSettings.enabled && mediaType === "image" && !isFaceAnalysisCurrent(existingRow, faceSettings)) {
            faceReprocessPaths.add(imagePath);
            return true;
          }
          return false;
        }
      } else {
        if (existingIndex.byPath.has(imagePath)) {
          return false;
        }
        if (existingIndex.byId.has(imageId)) {
          return false;
        }
      }

      return true;
    });

    const skippedCount = originalTargetCount - targets.length;
    if (skippedCount > 0) {
      sendToRenderer("index-log", {
        message: `Skipping ${skippedCount} already indexed media files.`,
      });
    }

    if (!useCloud && faceReprocessPaths.size > 0) {
      sendToRenderer("index-log", {
        message: `Face refresh enabled for ${faceReprocessPaths.size} image${faceReprocessPaths.size === 1 ? "" : "s"}.`,
      });
    }

    let cloudGroupingPath = "";
    let localGroupingPath = "";
    let localFaceClustersPath = "";
    let cloudGroups = [];
    let cloudGroupByRepresentative = new Map();
    if (useCloud && targets.length > 0) {
      const localRows = await loadLocalIndexRows();
      const grouping = buildCloudGroupsFromLocalTargets(targets, localRows);
      const groupedOutCount = targets.length - grouping.representativeTargets.length;

      targets = grouping.representativeTargets;
      cloudGroups = grouping.groups;
      cloudGroupByRepresentative = new Map(cloudGroups.map((group) => [group.representative, group]));
      cloudGroupingPath = await writeCloudGroupingFile({
        generated_at: new Date().toISOString(),
        total_candidates: originalTargetCount,
        eligible_after_prereq_and_skip: originalTargetCount - skippedCount,
        grouped_out: groupedOutCount,
        representative_count: grouping.representativeTargets.length,
        groups: grouping.groups.map((group) => ({
          representative: group.representative,
          members: group.members,
          group_id: group.group_id,
        })),
      });

      sendToRenderer("index-log", {
        message: `Cloud grouping reduced ${originalTargetCount - skippedCount} eligible media files to ${targets.length} representative items.`,
      });
      sendToRenderer("index-log", {
        message: `Cloud grouping file saved: ${cloudGroupingPath}`,
      });
    }

    if (targets.length === 0) {
      let outputPath = useCloud
        ? await writeCloudIndexFile(existingIndex.rows, cloudModelId)
        : await writeLocalIndexFile(applyLocalGroupingToRows(existingIndex.rows).rows);

      if (!useCloud) {
        const grouped = applyLocalGroupingToRows(existingIndex.rows);
        const clustered = applyFaceClusteringToRows(grouped.rows, faceSettings);
        outputPath = await writeLocalIndexFile(clustered.rows);
        localGroupingPath = await writeLocalGroupingFile({
          generated_at: new Date().toISOString(),
          total_images: clustered.rows.length,
          group_count: grouped.groups.length,
          groups: grouped.groups,
        });
        localFaceClustersPath = await writeLocalFaceClustersFile({
          generated_at: new Date().toISOString(),
          threshold: clustered.threshold,
          total_faces_clustered: clustered.totalFaces,
          cluster_count: clustered.clusters.length,
          clusters: clustered.clusters,
        });
      }

      sendToRenderer("index-complete", {
        ok: true,
        cancelled: false,
        success: 0,
        failed: 0,
        total: 0,
        outputPath,
        cloudGroupingPath,
        localGroupingPath,
        localFaceClustersPath,
        failures: [],
      });
      return { ok: true, outputPath, success: 0, failed: 0, total: 0, skipped: skippedCount };
    }

    let success = 0;
    let failed = 0;
    const failures = [];
    const results = !useCloud && faceReprocessPaths.size > 0
      ? existingIndex.rows.filter((row) => !faceReprocessPaths.has(String(row?.path || "").trim()))
      : [...existingIndex.rows];

    sendToRenderer("index-log", {
      message: useCloud
        ? `Cloud indexing with Bedrock model ${cloudModelId}...`
        : "Local indexing enabled (metadata-only, no cloud calls).",
    });

    let outputPath = "";
    // Create checkpoint file immediately so progress is durable from item 1 onward.
    outputPath = useCloud
      ? await writeCloudIndexFile(results, cloudModelId)
      : await writeLocalIndexFile(results);

    const totalWorkItems = useCloud
      ? cloudGroups.reduce((sum, group) => sum + (Array.isArray(group?.members) ? group.members.length : 0), 0)
      : targets.length;
    let processedWorkItems = 0;

    sendToRenderer("index-progress", {
      phase: "index",
      percent: 0,
      processed: 0,
      total: totalWorkItems,
      current: targets[0] || "",
      success,
      failed,
    });

    for (let i = 0; i < targets.length; i += 1) {
      if (indexState.cancelled) {
        outputPath = useCloud
          ? await writeCloudIndexFile(results, cloudModelId)
          : await writeLocalIndexFile(results);
        sendToRenderer("index-complete", {
          ok: false,
          cancelled: true,
          success,
          failed,
          total: totalWorkItems,
          failures,
          outputPath,
        });
        return { ok: false, cancelled: true, outputPath };
      }

      await waitWhilePaused(indexState);
      const imagePath = targets[i];
      const activeCloudGroup = useCloud
        ? (cloudGroupByRepresentative.get(imagePath) || {
          group_id: null,
          representative: imagePath,
          members: [imagePath],
        })
        : null;
      const groupMemberPaths = useCloud
        ? (Array.isArray(activeCloudGroup?.members) && activeCloudGroup.members.length > 0
          ? activeCloudGroup.members
          : [imagePath])
        : [imagePath];

      sendToRenderer("index-log", {
        message: useCloud
          ? `Processing representative ${i + 1}/${targets.length}: ${path.basename(imagePath)} (${groupMemberPaths.length} group item${groupMemberPaths.length === 1 ? "" : "s"})`
          : `Processing ${i + 1}/${targets.length}: ${path.basename(imagePath)}`,
      });
      const mediaType = getMediaTypeFromPath(imagePath, "image");
      let metadata = makeMetadataForMedia(imagePath, mediaType);
      let embedding = [];
      let status = "ok";
      let errorMessage = "";
      let localMetadata = null;
      const imageId = idByPath.get(imagePath) ?? i + 1;

      try {
        if (useCloud) {
          const isVideo = mediaType === "video";
          const cloudResult = isVideo
            ? await cloudVideoExtractor.describeVideo(imagePath, { modelId: cloudModelId })
            : await cloudExtractor.describeImage(imagePath, { modelId: cloudModelId });

          const sceneTags = Array.isArray(cloudResult?.sceneTags) ? cloudResult.sceneTags : [];
          const objectTags = Array.isArray(cloudResult?.objectTags) ? cloudResult.objectTags : [];
          const activityTags = Array.isArray(cloudResult?.activityTags) ? cloudResult.activityTags : [];
          const mergedTags = Array.from(new Set([
            ...(isVideo ? ["video", "cloud"] : []),
            ...sceneTags,
            ...objectTags,
            ...activityTags,
          ]));

          metadata = {
            title: path.basename(imagePath, path.extname(imagePath)) || (isVideo ? "Untitled video" : "Untitled image"),
            description: String(cloudResult?.description || ""),
            tags: mergedTags,
            objects: objectTags,
            style: "cloud",
            dominant_colors: [],
            contains_people: null,
            contains_text: Boolean(cloudResult?.ocr?.all_text),
            media_type: isVideo ? "video" : "image",
            scene_tags: sceneTags,
            object_tags: objectTags,
            activity_tags: activityTags,
            social_media_score: Number(cloudResult?.socialMediaScore || 0),
            instagram_score: Number(cloudResult?.instagramScore || 0),
            aspect_ratio_suitability: Array.isArray(cloudResult?.aspectRatioSuitability) ? cloudResult.aspectRatioSuitability : [],
            aesthetic_style: String(cloudResult?.aestheticStyle || ""),
            editing_level: String(cloudResult?.editingLevel || ""),
            visual_complexity: String(cloudResult?.visualComplexity || ""),
            hero_element: String(cloudResult?.heroElement || ""),
            depth_of_field: String(cloudResult?.depthOfField || ""),
          };
          embedding = [];

          for (const memberPath of groupMemberPaths) {
            const memberId = idByPath.get(memberPath) ?? imageId;
            results.push({
              id: memberId,
              image_path: memberPath,
              model_id: cloudResult?.model_id || cloudModelId,
              analyzed_at: cloudResult?.analyzed_at || new Date().toISOString(),
              description: String(cloudResult?.description || ""),
              sceneTags: sceneTags,
              objectTags: objectTags,
              activityTags: activityTags,
              socialMediaScore: Number(cloudResult?.socialMediaScore || 0),
              instagramScore: Number(cloudResult?.instagramScore || 0),
              aspectRatioSuitability: Array.isArray(cloudResult?.aspectRatioSuitability) ? cloudResult.aspectRatioSuitability : [],
              aestheticStyle: String(cloudResult?.aestheticStyle || ""),
              editingLevel: String(cloudResult?.editingLevel || ""),
              visualComplexity: String(cloudResult?.visualComplexity || ""),
              heroElement: String(cloudResult?.heroElement || ""),
              depthOfField: String(cloudResult?.depthOfField || ""),
              ocr: cloudResult?.ocr || { all_text: "", entries: [] },
              video_analysis: isVideo ? cloudResult : null,
              status,
              error: "",
              media_type: isVideo ? "video" : "image",
              similar_group_id: activeCloudGroup?.group_id || null,
              similar_group_representative_path: activeCloudGroup?.representative || imagePath,
              similar_group_member_count: groupMemberPaths.length,
              similar_group_member_paths: [...groupMemberPaths],
              ai_description_source_path: imagePath,
            });
          }
        } else {
          if (mediaType === "video") {
            if (localVideoExtractor && typeof localVideoExtractor.extractVideoMetadata === "function") {
              localMetadata = await localVideoExtractor.extractVideoMetadata(imagePath, {
                id: imageId,
                size_bytes: null,
                created_at: null,
                modified_at: null,
                first_seen_at: new Date().toISOString(),
                last_seen_at: new Date().toISOString(),
              });

              const candidateVideoMetadata =
                localMetadata?.search_metadata && typeof localMetadata.search_metadata === "object"
                  ? localMetadata.search_metadata
                  : buildSearchMetadataFromLocal(localMetadata, imagePath);

              metadata = {
                ...makeMetadataForMedia(imagePath, "video"),
                ...candidateVideoMetadata,
                media_type: "video",
              };

              const videoStatus = String(localMetadata?.status || "").toLowerCase();
              if (!["metadata_extracted", "metadata_fallback"].includes(videoStatus)) {
                const firstVideoExtractorError = Array.isArray(localMetadata?.processing?.errors)
                  ? localMetadata.processing.errors[0]
                  : "Video metadata extraction failed.";
                errorMessage = String(firstVideoExtractorError || "Video metadata extraction failed.");

                if (canUseLocalMetadataFallback(imagePath)) {
                  status = "ok";
                  metadata = makeMetadataForMedia(imagePath, mediaType);
                  localMetadata = buildFallbackLocalMetadata(imagePath, errorMessage, mediaType);
                  sendToRenderer("index-log", {
                    message: `Using fallback video metadata for ${path.basename(imagePath)} (${errorMessage}).`,
                  });
                  errorMessage = "";
                } else {
                  status = "failed";
                }
              }
            } else {
              localMetadata = buildFallbackLocalMetadata(
                imagePath,
                "Video local extractor uses fallback metadata.",
                "video",
              );
              metadata = makeMetadataForMedia(imagePath, "video");
              metadata.tags = Array.from(new Set([...(metadata.tags || []), "video"]));
            }
          } else {
            localMetadata = await localExtractor.extractImageMetadata(imagePath, {
              id: imageId,
              size_bytes: null,
              created_at: null,
              modified_at: null,
              first_seen_at: new Date().toISOString(),
              last_seen_at: new Date().toISOString(),
            });
            metadata = buildSearchMetadataFromLocal(localMetadata, imagePath);
            if (localMetadata?.status !== "metadata_extracted") {
              const firstExtractorError = Array.isArray(localMetadata?.processing?.errors)
                ? localMetadata.processing.errors[0]
                : "Metadata extraction failed.";
              errorMessage = String(firstExtractorError || "Metadata extraction failed.");

              if (canUseLocalMetadataFallback(imagePath)) {
                status = "ok";
                metadata = makeMetadataForMedia(imagePath, mediaType);
                localMetadata = buildFallbackLocalMetadata(imagePath, errorMessage, mediaType);
                sendToRenderer("index-log", {
                  message: `Using fallback metadata for ${path.basename(imagePath)} (${errorMessage}).`,
                });
                errorMessage = "";
              } else {
                status = "failed";
              }
            }

            if (status === "ok" && faceSettings.enabled && localMetadata && typeof localMetadata === "object") {
              const faceResult = await runLocalFaceAnalysis(imagePath, faceSettings);
              if (faceResult?.ok) {
                localMetadata.face_analysis = normalizeFaceAnalysisResult(faceResult.result, faceSettings.modelVersion);
                delete localMetadata.face_analysis_error;
              } else {
                localMetadata.face_analysis = {
                  version: String(faceSettings.modelVersion),
                  processed_at: new Date().toISOString(),
                  face_count: 0,
                  faces: [],
                };
                localMetadata.face_analysis_error = String(faceResult?.message || "Face analysis unavailable.");
                sendToRenderer("index-log", {
                  message: `Face indexing warning for ${path.basename(imagePath)}: ${localMetadata.face_analysis_error}`,
                });
              }
            }
          }

          metadata.media_type = mediaType;
          results.push({
            id: imageId,
            path: imagePath,
            status,
            metadata,
            embedding,
            media_type: mediaType,
            local_metadata: localMetadata,
            cloud_metadata: null,
            error: status === "ok" ? "" : errorMessage,
          });
        }
      } catch (error) {
        errorMessage = String(error?.message || error);

        if (useCloud) {
          status = "failed";
          for (const memberPath of groupMemberPaths) {
            const memberId = idByPath.get(memberPath) ?? imageId;
            results.push({
              id: memberId,
              image_path: memberPath,
              model_id: cloudModelId,
              analyzed_at: new Date().toISOString(),
              description: "",
              ocr: { all_text: "", entries: [] },
              video_analysis: mediaType === "video" ? {
                frames: [],
                error: errorMessage,
              } : null,
              status,
              error: errorMessage,
              media_type: mediaType,
              similar_group_id: activeCloudGroup?.group_id || null,
              similar_group_representative_path: activeCloudGroup?.representative || imagePath,
              similar_group_member_count: groupMemberPaths.length,
              similar_group_member_paths: [...groupMemberPaths],
              ai_description_source_path: imagePath,
            });
          }
        } else {
          if (canUseLocalMetadataFallback(imagePath)) {
            status = "ok";
            metadata = makeMetadataForMedia(imagePath, mediaType);
            localMetadata = buildFallbackLocalMetadata(imagePath, errorMessage, mediaType);
            sendToRenderer("index-log", {
              message: `Using fallback metadata for ${path.basename(imagePath)} (${errorMessage}).`,
            });
            errorMessage = "";
          } else {
            status = "failed";
          }

          results.push({
            id: imageId,
            path: imagePath,
            status,
            metadata,
            embedding,
            media_type: mediaType,
            local_metadata: localMetadata,
            cloud_metadata: null,
            error: status === "ok" ? "" : errorMessage,
          });
        }
      }

      if (status === "ok") {
        success += groupMemberPaths.length;
      } else {
        failed += groupMemberPaths.length;
        for (const memberPath of groupMemberPaths) {
          failures.push({ path: memberPath, message: errorMessage });
        }
      }

      processedWorkItems += useCloud ? groupMemberPaths.length : 1;

      outputPath = useCloud
        ? await writeCloudIndexFile(results, cloudModelId)
        : await writeLocalIndexFile(results);

      const processed = processedWorkItems;
      const percent = Math.floor((processed / Math.max(1, totalWorkItems)) * 100);
      sendToRenderer("index-progress", {
        phase: "index",
        percent,
        processed,
        total: totalWorkItems,
        current: imagePath,
        success,
        failed,
      });
    }

    if (!useCloud) {
      const grouped = applyLocalGroupingToRows(results);
      const clustered = applyFaceClusteringToRows(grouped.rows, faceSettings);
      results.splice(0, results.length, ...clustered.rows);
      localGroupingPath = await writeLocalGroupingFile({
        generated_at: new Date().toISOString(),
        total_images: clustered.rows.length,
        group_count: grouped.groups.length,
        groups: grouped.groups,
      });
      localFaceClustersPath = await writeLocalFaceClustersFile({
        generated_at: new Date().toISOString(),
        threshold: clustered.threshold,
        total_faces_clustered: clustered.totalFaces,
        cluster_count: clustered.clusters.length,
        clusters: clustered.clusters,
      });

      sendToRenderer("index-log", {
        message: `Local grouping saved: ${grouped.groups.length} groups (${localGroupingPath}).`,
      });
      sendToRenderer("index-log", {
        message: `Face clustering saved: ${clustered.clusters.length} clusters (${localFaceClustersPath}).`,
      });
    }

    outputPath = useCloud
      ? await writeCloudIndexFile(results, cloudModelId)
      : await writeLocalIndexFile(results);
    indexState.lastResult = { failures, outputPath, total: totalWorkItems };

    sendToRenderer("index-complete", {
      ok: true,
      cancelled: false,
      success,
      failed,
      total: totalWorkItems,
      outputPath,
      cloudGroupingPath,
      localGroupingPath,
      localFaceClustersPath,
      failures,
    });

    return { ok: true, outputPath, success, failed, total: totalWorkItems };
  } catch (error) {
    sendToRenderer("index-complete", {
      ok: false,
      cancelled: false,
      message: String(error?.message || error),
    });
    return { ok: false, message: String(error?.message || error) };
  } finally {
    indexState.running = false;
    indexState.paused = false;
    indexState.cancelled = false;
  }
}

ipcMain.handle("start-indexing", async (_event, payload) => {
  const files = Array.isArray(payload?.files) ? payload.files : undefined;
  const auto = Boolean(payload?.auto);
  const mode = String(payload?.mode || "local").toLowerCase();
  if (indexState.running) {
    return { ok: false, message: "Indexing already running." };
  }

  if (mode === "local") {
    try {
      await loadLocalMetadataExtractor();
      try {
        await loadLocalVideoMetadataExtractor();
      } catch {
        // Video extractor is optional at startup; runtime path will fallback per file.
      }
    } catch (error) {
      return { ok: false, message: String(error?.message || error) };
    }
  }

  (async () => {
    await startIndexingInternal({ files, mode });
  })();

  return { ok: true, message: auto ? "Auto indexing started." : "Indexing started." };
});

ipcMain.handle("pause-indexing", async () => {
  if (!indexState.running) {
    return { ok: false, message: "No running indexing job." };
  }
  indexState.paused = true;
  sendToRenderer("index-log", { message: "Indexing paused." });
  return { ok: true };
});

ipcMain.handle("resume-indexing", async () => {
  if (!indexState.running) {
    return { ok: false, message: "No running indexing job." };
  }
  indexState.paused = false;
  sendToRenderer("index-log", { message: "Indexing resumed." });
  return { ok: true };
});

ipcMain.handle("cancel-indexing", async () => {
  if (!indexState.running) {
    return { ok: false, message: "No running indexing job." };
  }
  indexState.cancelled = true;
  return { ok: true };
});

ipcMain.handle("retry-failed-indexing", async () => {
  const failedFiles = Array.isArray(indexState.lastResult?.failures)
    ? indexState.lastResult.failures.map((item) => item.path)
    : [];

  if (failedFiles.length === 0) {
    return { ok: false, message: "No failed items to retry." };
  }

  if (indexState.running) {
    return { ok: false, message: "Indexing already running." };
  }

  (async () => {
    await startIndexingInternal({ files: failedFiles });
  })();

  return { ok: true, message: `Retrying ${failedFiles.length} failed items.` };
});

app.whenReady().then(async () => {
  await ensureEnvFileExists();
  const envSettings = await readEnvSettings();
  process.env.AWS_REGION = String(envSettings.aws_region || "us-east-1");
  process.env.AWS_ACCESS_KEY_ID = String(envSettings.aws_key || "");
  process.env.AWS_SECRET_ACCESS_KEY = String(envSettings.secret_key || "");
  process.env.BEDROCK_VISION_MODEL = String(envSettings.model || "qwen.qwen3-vl-235b-a22b");

  await ensureUserSettingsFileExists();
  await ensureAlbumsDataFileExists();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => { 
  if (process.platform !== "darwin") { 
    app.quit(); 
  } 
});  
