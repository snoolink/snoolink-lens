import { app, BrowserWindow, ipcMain, dialog, shell, clipboard, nativeImage } from "electron";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import http from "node:http";
import os from "node:os";
import {
  BedrockRuntimeClient,
  ConverseCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { TwelveLabs } from "twelvelabs-js";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
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
const APP_CACHE_SLUG = String(app.getName() || "snoolink-lens")
  .toLowerCase()
  .replace(/[^a-z0-9._-]+/g, "-");

// --- Mobile share server state ---
const shareServerState = {
  server: null,
  filePath: "",
  port: 0,
  autoStopTimer: null,
  activeConnections: new Set(),
};

function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  // Prefer Wi-Fi / Ethernet over other adapters
  const preferred = ["wi-fi", "wifi", "wlan", "ethernet", "en0", "en1", "eth"];
  for (const pref of preferred) {
    for (const name of Object.keys(interfaces)) {
      if (!name.toLowerCase().includes(pref)) continue;
      for (const iface of interfaces[name] || []) {
        if (iface.family === "IPv4" && !iface.internal) return iface.address;
      }
    }
  }
  // Fallback: first non-internal IPv4
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === "IPv4" && !iface.internal) return iface.address;
    }
  }
  return "127.0.0.1";
}

function stopShareServer() {
  if (shareServerState.autoStopTimer) {
    clearTimeout(shareServerState.autoStopTimer);
    shareServerState.autoStopTimer = null;
  }
  // Destroy all open sockets so server.close() resolves immediately
  for (const socket of shareServerState.activeConnections) {
    try { socket.destroy(); } catch { /* ignore */ }
  }
  shareServerState.activeConnections.clear();
  if (shareServerState.server) {
    shareServerState.server.close();
    shareServerState.server = null;
  }
  shareServerState.filePath = "";
  shareServerState.port = 0;
}

async function startShareServer(filePath, autoStopMs = 10 * 60 * 1000) {
  stopShareServer();

  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat) {
    return { ok: false, message: `File not found: ${filePath}` };
  }
  const fileSize = stat.size;
  const fileName = path.basename(filePath);

  return new Promise((resolve) => {
    const videoPath = `/${encodeURIComponent(fileName)}`;
    const fileSizeMB = (fileSize / (1024 * 1024)).toFixed(1);

    const landingPage = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Download – ${fileName}</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#060b14;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#dce8ff;}
  .card{background:#0c1624;border:1px solid rgba(100,150,240,.25);border-radius:20px;padding:32px 28px;max-width:360px;width:92%;text-align:center;box-shadow:0 24px 60px rgba(0,0,0,.6);}
  h1{font-size:1.15rem;margin:0 0 6px;}
  p{color:#9bb0d4;font-size:.85rem;margin:0 0 24px;}
  video{width:100%;border-radius:12px;background:#000;margin-bottom:20px;max-height:260px;}
  a.dl{display:block;background:linear-gradient(120deg,#3fd4a0,#27b6a0);color:#05201a;font-weight:700;font-size:1rem;padding:14px 20px;border-radius:12px;text-decoration:none;margin-bottom:10px;}
  .hint{font-size:.72rem;color:#6a85b0;line-height:1.5;}
</style>
</head>
<body>
<div class="card">
  <h1>Your Snoolink Stitch</h1>
  <p>${fileName} &nbsp;·&nbsp; ${fileSizeMB} MB</p>
  <video src="${videoPath}" controls playsinline preload="metadata"></video>
  <a class="dl" href="${videoPath}" download="${fileName}">⬇ Save to Device</a>
  <p class="hint">iOS: tap Save → Files app → Downloads<br>Android: tap Download → Files app → Downloads</p>
</div>
</body>
</html>`;

    const server = http.createServer((req, res) => {
      // Reset idle-stop timer on every request
      if (shareServerState.autoStopTimer) clearTimeout(shareServerState.autoStopTimer);
      shareServerState.autoStopTimer = setTimeout(stopShareServer, autoStopMs);

      const url = new URL(req.url || "/", `http://localhost`);
      const isVideoRequest = url.pathname === videoPath || url.pathname === `/${fileName}`;

      // Serve landing page for root or non-video paths
      if (!isVideoRequest) {
        const html = Buffer.from(landingPage, "utf8");
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Length": String(html.length), "Cache-Control": "no-store" });
        res.end(html);
        return;
      }

      // Serve the video file (with range support for streaming)
      const baseHeaders = {
        "Content-Type": "video/mp4",
        "Accept-Ranges": "bytes",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
        "Connection": "keep-alive",
      };

      if (req.method === "OPTIONS" || req.method === "HEAD") {
        res.writeHead(200, { ...baseHeaders, "Content-Length": String(fileSize) });
        res.end();
        return;
      }

      const rangeHeader = req.headers["range"];
      let start = 0;
      let end = fileSize - 1;
      let statusCode = 200;

      if (rangeHeader) {
        const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
        if (match) {
          start = Number(match[1]);
          end = match[2] ? Math.min(Number(match[2]), fileSize - 1) : fileSize - 1;
          statusCode = 206;
        }
      }

      if (start > end || start >= fileSize) {
        res.writeHead(416, { "Content-Range": `bytes */${fileSize}` });
        res.end();
        return;
      }

      const chunkSize = end - start + 1;
      const headers = { ...baseHeaders, "Content-Length": String(chunkSize) };
      if (statusCode === 206) {
        headers["Content-Range"] = `bytes ${start}-${end}/${fileSize}`;
      } else {
        headers["Content-Disposition"] = `attachment; filename="${fileName}"`;
      }

      res.writeHead(statusCode, headers);

      if (req.method === "GET") {
        const stream = fsSync.createReadStream(filePath, { start, end });
        stream.on("error", (err) => {
          console.error("[share-server] stream error:", err.message);
          if (!res.headersSent) res.writeHead(500);
          res.end();
        });
        res.on("close", () => stream.destroy());
        stream.pipe(res);
      } else {
        res.end();
      }
    });

    // Track all open sockets so we can force-close on stop
    server.on("connection", (socket) => {
      shareServerState.activeConnections.add(socket);
      socket.on("close", () => shareServerState.activeConnections.delete(socket));
    });

    server.on("error", (err) => {
      resolve({ ok: false, message: String(err?.message || err) });
    });

    server.listen(0, "0.0.0.0", () => {
      const addr = server.address();
      const port = addr?.port || 0;
      const ip = getLocalIpAddress();
      shareServerState.server = server;
      shareServerState.filePath = filePath;
      shareServerState.port = port;

      shareServerState.autoStopTimer = setTimeout(stopShareServer, autoStopMs);

      resolve({ ok: true, url: `http://${ip}:${port}`, port, ip });
    });
  });
}

function configureChromiumCachePaths() {
  const candidates = [
    path.join(app.getPath("temp"), APP_CACHE_SLUG, "session-data"),
    path.join(DATA_DIR_PATH, "session-data"),
    path.join(app.getPath("userData"), "session-data"),
  ];

  for (const candidate of candidates) {
    try {
      fsSync.mkdirSync(candidate, { recursive: true });
      app.setPath("sessionData", candidate);
      app.commandLine.appendSwitch("disk-cache-dir", path.join(candidate, "Cache"));
      return;
    } catch {
      // Try the next writable candidate.
    }
  }
}

configureChromiumCachePaths();
// Periodically force V8 to trim memory if supported (Node 14+)
setInterval(() => {
  if (global.gc) {
    try {
      global.gc();
    } catch {}
  }
  if (typeof process.memoryUsage === "function") {
    const mem = process.memoryUsage();
    const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1);
    console.log(`[snoolink-lens][periodic] Heap: ${mb(mem.heapUsed)} MB / ${mb(mem.heapTotal)} MB | RSS: ${mb(mem.rss)} MB | External: ${mb(mem.external)} MB`);
  }
}, 60000);

// Runtime safety net for large metadata/video sessions.
app.commandLine.appendSwitch("js-flags", "--max-old-space-size=4096");

// Periodically force V8 to trim memory if supported (Node 14+)
setInterval(() => {
  if (global.gc) {
    try {
      global.gc();
    } catch {}
  }
  if (typeof process.memoryUsage === "function") {
    const mem = process.memoryUsage();
    const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1);
    console.log(`[snoolink-lens][periodic] Heap: ${mb(mem.heapUsed)} MB / ${mb(mem.heapTotal)} MB | RSS: ${mb(mem.rss)} MB | External: ${mb(mem.external)} MB`);
  }
}, 60000);

const MASTER_DIRECTORY_PATH = path.join(DATA_DIR_PATH, "master_image_directory.json");
const ALBUMS_DATA_PATH = path.join(DATA_DIR_PATH, "albums_data.json");
const USER_SETTINGS_PATH = path.join(DATA_DIR_PATH, "app_settings.json");
const LEGACY_USER_SETTINGS_PATH = path.join(DATA_DIR_PATH, "user_settings.json");
const LEGACY_USER_SETTINGS_SJON_PATH = path.join(DATA_DIR_PATH, "user_setting.sjon");
const LOCAL_IMAGE_METADATA_PATH = path.join(DATA_DIR_PATH, "local-image_metadata_results.json");
const CLOUD_IMAGE_METADATA_PATH = path.join(DATA_DIR_PATH, "cloud-image_metadata_results.json");
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
  "TWELVELABS_API_KEY=",
].join("\n");
const INSTAGRAM_REEL_ANALYZER_INDEX_ID = "694237c9fa043d83a491de49";
const LOCAL_EXTRACTOR_MODULE_CANDIDATES = [
  path.join(__dirname, "local-image-metadata-extractor.js"),
  path.join(__dirname, "image-metadata-extractor.js"),
];
const LOCAL_VIDEO_EXTRACTOR_MODULE_PATH = path.join(__dirname, "local-video-metadata-extractor.js");
const CLOUD_EXTRACTOR_MODULE_PATH = path.join(__dirname, "cloud-image-metadata-extractor.js");
const CLOUD_VIDEO_EXTRACTOR_MODULE_PATH = path.join(__dirname, "cloud-video-metadata-extractor.js");
const PREVIEW_CONVERTIBLE_EXTENSIONS = new Set([".heic", ".heif", ".avif", ".tif", ".tiff"]);
const PREVIEW_CACHE_DIR_PATH = path.join(DATA_DIR_PATH, "preview-cache");
const DOWNLOAD_FOLDER_NAME = "Snoolink Lens";
const CLOUD_GROUPS_OUTPUT_PATH = path.join(DATA_DIR_PATH, "cloud_index_groups.json");
const LOCAL_GROUPS_OUTPUT_PATH = path.join(DATA_DIR_PATH, "local_index_groups.json");
const LOCAL_FACE_CLUSTERS_OUTPUT_PATH = path.join(DATA_DIR_PATH, "local_face_clusters.json");
const SEARCH_HISTORY_PATH = path.join(DATA_DIR_PATH, "search_history.json");
const STITCH_EXPORT_DIR_PATH = path.join(DATA_DIR_PATH, "stitch-exports");
const MAX_SEARCH_HISTORY_ENTRIES = 10000;
const MAX_FILTER_LOOKUP_OCR_CORPUS_CHARS = 1200;
const MAX_FILTER_LOOKUP_FRAME_ROWS = 8;
const MAX_FILTER_LOOKUP_ROWS = 50000;
const FACE_ANALYSIS_MAX_DIMENSION_ATTEMPTS = [1920, 1280, 960];
const MAX_SEARCH_RESULT_TEXT_CHARS = 1200;
const MAX_SEARCH_RESULT_TITLE_CHARS = 220;
const MAX_SEARCH_RESULT_TAGS = 24;
const execFileAsync = promisify(execFile);

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
  ".mpv",
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

let reelAnalyzerWindow = null;

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

function buildBackupTimestampSlug(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  const year = String(date.getFullYear());
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hour = pad(date.getHours());
  const minute = pad(date.getMinutes());
  const second = pad(date.getSeconds());
  return `${year}${month}${day}-${hour}${minute}${second}`;
}

function getBackupFileSpecs() {
  return [
    { key: "cloudMetadata", sourcePath: CLOUD_IMAGE_METADATA_PATH, fileName: "cloud-image_metadata_results.json", required: true },
    { key: "localMetadata", sourcePath: LOCAL_IMAGE_METADATA_PATH, fileName: "local-image_metadata_results.json", required: true },
    { key: "masterDirectory", sourcePath: MASTER_DIRECTORY_PATH, fileName: "master_image_directory.json", required: false },
    { key: "albums", sourcePath: ALBUMS_DATA_PATH, fileName: "albums_data.json", required: false },
    { key: "settings", sourcePath: USER_SETTINGS_PATH, fileName: "app_settings.json", required: false },
    { key: "cloudGroups", sourcePath: CLOUD_GROUPS_OUTPUT_PATH, fileName: "cloud_index_groups.json", required: false },
    { key: "localGroups", sourcePath: LOCAL_GROUPS_OUTPUT_PATH, fileName: "local_index_groups.json", required: false },
    { key: "faceClusters", sourcePath: LOCAL_FACE_CLUSTERS_OUTPUT_PATH, fileName: "local_face_clusters.json", required: false },
    { key: "searchHistory", sourcePath: SEARCH_HISTORY_PATH, fileName: "search_history.json", required: false },
    { key: "env", sourcePath: ENV_FILE_PATH, fileName: "env.backup", required: false },
  ];
}

async function getUniquePathInDirectory(directoryPath, fileName) {
  const safeFileName = String(fileName || "downloaded-file").trim() || "downloaded-file";
  const parsed = path.parse(safeFileName);
  const ext = parsed.ext || "";
  const baseName = parsed.name || "downloaded-file";

  let candidate = path.join(directoryPath, `${baseName}${ext}`);
  let suffix = 1;

  while (await pathExists(candidate)) {
    candidate = path.join(directoryPath, `${baseName} (${suffix})${ext}`);
    suffix += 1;
  }

  return candidate;
}

function cloneJsonSafe(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

function trimSearchResultText(value, maxChars = MAX_SEARCH_RESULT_TEXT_CHARS) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxChars - 1))}…`;
}

function compactSearchResultRows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return list.map((row) => {
    const safeRow = row && typeof row === "object" ? row : {};
    const metadata = safeRow?.metadata && typeof safeRow.metadata === "object" ? safeRow.metadata : {};
    const tags = Array.isArray(metadata?.tags)
      ? metadata.tags.slice(0, MAX_SEARCH_RESULT_TAGS).map((value) => trimSearchResultText(value, 80))
      : [];
    const objects = Array.isArray(metadata?.objects)
      ? metadata.objects.slice(0, MAX_SEARCH_RESULT_TAGS).map((value) => trimSearchResultText(value, 80))
      : [];

    return {
      id: safeRow?.id,
      score: Number(safeRow?.score || 0),
      path: String(safeRow?.path || safeRow?.image_path || "").trim(),
      image_path: String(safeRow?.image_path || safeRow?.path || "").trim(),
      media_type: String(safeRow?.media_type || metadata?.media_type || "").trim(),
      preview_src: String(safeRow?.preview_src || "").trim(),
      status: String(safeRow?.status || "ok"),
      clip_mode: safeRow?.clip_mode || null,
      clip_start_seconds: safeRow?.clip_start_seconds,
      clip_end_seconds: safeRow?.clip_end_seconds,
      clip_match_second: safeRow?.clip_match_second,
      clip_match_text: trimSearchResultText(safeRow?.clip_match_text, 420),
      metadata: {
        title: trimSearchResultText(metadata?.title, MAX_SEARCH_RESULT_TITLE_CHARS),
        description: trimSearchResultText(metadata?.description, MAX_SEARCH_RESULT_TEXT_CHARS),
        tags,
        objects,
        media_type: String(metadata?.media_type || safeRow?.media_type || "").trim(),
      },
    };
  });
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

function normalizeVideoSearchResultMode(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "matching_timeframes") {
    return "matching_timeframes";
  }
  return "full_video";
}

async function loadMasterDirectory() {
  const fingerprint = await getPathFingerprint(MASTER_DIRECTORY_PATH);
  if (masterDirectoryCache.payload && masterDirectoryCache.fingerprint === fingerprint) {
    return masterDirectoryCache.payload;
  }

  let payload = { items: [] };
  try {
    const text = await fs.readFile(MASTER_DIRECTORY_PATH, "utf-8");
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      payload = { items: parsed };
    } else if (Array.isArray(parsed?.items)) {
      payload = parsed;
    }
  } catch {
    payload = { items: [] };
  }

  masterDirectoryCache = {
    fingerprint,
    payload,
  };

  return payload;
}

async function loadAlbumsData() {
  const defaults = {
    generated_at: new Date().toISOString(),
    albums: [],
    image_album_map: {},
  };

  const fingerprint = await getPathFingerprint(ALBUMS_DATA_PATH);
  if (albumsDataCache.payload && albumsDataCache.fingerprint === fingerprint) {
    return albumsDataCache.payload;
  }

  let payload = defaults;
  try {
    const text = await fs.readFile(ALBUMS_DATA_PATH, "utf-8");
    const parsed = JSON.parse(text);
    payload = {
      generated_at: String(parsed?.generated_at || defaults.generated_at),
      albums: Array.isArray(parsed?.albums) ? parsed.albums : [],
      image_album_map:
        parsed?.image_album_map && typeof parsed.image_album_map === "object"
          ? parsed.image_album_map
          : {},
    };
  } catch {
    payload = defaults;
  }

  albumsDataCache = {
    fingerprint,
    payload,
  };

  return payload;
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

  albumsDataCache = {
    fingerprint: await getPathFingerprint(ALBUMS_DATA_PATH),
    payload: nextPayload,
  };

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
  masterDirectoryCache = {
    fingerprint: await getPathFingerprint(MASTER_DIRECTORY_PATH),
    payload,
  };

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
let cachedFfmpegBinary = "";
const imagePreviewSrcCache = new Map();
const PREVIEW_SRC_CACHE_MAX_ENTRIES = 240;
let masterDirectoryCache = {
  fingerprint: "",
  payload: null,
};
let albumsDataCache = {
  fingerprint: "",
  payload: null,
};
let indexingStageLookupCache = {
  fingerprint: "",
  payload: null,
};
let localFilterLookupCache = {
  fingerprint: "",
  payload: null,
};
let localFilterOptionsCache = {
  fingerprint: "",
  payload: null,
};
let stitchSelectionState = {
  items: [],
  updatedAt: null,
};
const METADATA_PATH_LOOKUP_CACHE_MAX_ENTRIES = 240;
const metadataPathLookupCache = new Map();

async function getPathFingerprint(targetPath) {
  try {
    const stats = await fs.stat(targetPath);
    return `${stats.size}:${Math.round(stats.mtimeMs)}`;
  } catch {
    return "missing";
  }
}

function setMetadataPathLookupCacheEntry(cacheKey, value) {
  if (!cacheKey) {
    return;
  }
  if (metadataPathLookupCache.has(cacheKey)) {
    metadataPathLookupCache.delete(cacheKey);
  }
  metadataPathLookupCache.set(cacheKey, value);
  if (metadataPathLookupCache.size > METADATA_PATH_LOOKUP_CACHE_MAX_ENTRIES) {
    const oldestKey = metadataPathLookupCache.keys().next().value;
    metadataPathLookupCache.delete(oldestKey);
  }
}

async function findMetadataRowByPathInResultsJson(resultsFilePath, targetPath) {
  const normalizedPath = String(targetPath || "").trim();
  if (!normalizedPath) {
    return null;
  }

  const cacheKey = `${resultsFilePath}::${normalizedPath.toLowerCase()}`;
  if (metadataPathLookupCache.has(cacheKey)) {
    return metadataPathLookupCache.get(cacheKey);
  }

  if (!(await pathExists(resultsFilePath))) {
    setMetadataPathLookupCacheEntry(cacheKey, null);
    return null;
  }

  const needle = normalizedPath.toLowerCase();

  const foundRow = await new Promise((resolve) => {
    const stream = fsSync.createReadStream(resultsFilePath, { encoding: "utf-8" });
    const resultsPattern = '"results"';
    let resultsPatternIndex = 0;
    let waitingForResultsColon = false;
    let waitingForResultsArrayStart = false;
    let inResultsArray = false;
    let resultsArrayDepth = 0;
    let inString = false;
    let escaped = false;
    let collectingObject = false;
    let currentObjectDepth = 0;
    let currentObjectBuffer = "";
    let settled = false;

    const finish = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      try {
        stream.destroy();
      } catch {
        // Ignore stream close errors.
      }
      resolve(value || null);
    };

    stream.on("error", () => finish(null));
    stream.on("end", () => finish(null));

    stream.on("data", (chunk) => {
      if (settled) {
        return;
      }

      const text = String(chunk || "");
      for (let i = 0; i < text.length; i += 1) {
        const ch = text[i];

        if (!inResultsArray) {
          if (!waitingForResultsColon && !waitingForResultsArrayStart) {
            if (ch === resultsPattern[resultsPatternIndex]) {
              resultsPatternIndex += 1;
              if (resultsPatternIndex === resultsPattern.length) {
                waitingForResultsColon = true;
                resultsPatternIndex = 0;
              }
            } else {
              resultsPatternIndex = ch === resultsPattern[0] ? 1 : 0;
            }
            continue;
          }

          if (waitingForResultsColon) {
            if (/\s/.test(ch)) {
              continue;
            }
            waitingForResultsColon = false;
            waitingForResultsArrayStart = ch === ":";
            continue;
          }

          if (waitingForResultsArrayStart) {
            if (/\s/.test(ch)) {
              continue;
            }
            waitingForResultsArrayStart = false;
            if (ch === "[") {
              inResultsArray = true;
              resultsArrayDepth = 1;
            }
            continue;
          }

          continue;
        }

        if (collectingObject) {
          currentObjectBuffer += ch;
        }

        if (inString) {
          if (escaped) {
            escaped = false;
            continue;
          }
          if (ch === "\\") {
            escaped = true;
            continue;
          }
          if (ch === '"') {
            inString = false;
          }
          continue;
        }

        if (ch === '"') {
          inString = true;
          continue;
        }

        if (ch === "[") {
          resultsArrayDepth += 1;
          continue;
        }

        if (ch === "]") {
          resultsArrayDepth -= 1;
          if (resultsArrayDepth <= 0) {
            finish(null);
            return;
          }
          continue;
        }

        if (ch === "{") {
          if (!collectingObject && resultsArrayDepth === 1) {
            collectingObject = true;
            currentObjectDepth = 1;
            currentObjectBuffer = "{";
            continue;
          }

          if (collectingObject) {
            currentObjectDepth += 1;
          }
          continue;
        }

        if (ch === "}" && collectingObject) {
          currentObjectDepth -= 1;
          if (currentObjectDepth === 0) {
            let parsed = null;
            try {
              parsed = JSON.parse(currentObjectBuffer);
            } catch {
              parsed = null;
            }

            collectingObject = false;
            currentObjectBuffer = "";

            const candidatePath = String(parsed?.path || parsed?.image_path || "").trim().toLowerCase();
            if (candidatePath && candidatePath === needle) {
              finish(parsed);
              return;
            }
          }
        }
      }
    });
  });

  setMetadataPathLookupCacheEntry(cacheKey, foundRow || null);
  return foundRow || null;
}

function normalizeBinaryFromEnv(pathOrDir, binaryName) {
  const value = String(pathOrDir || "").trim();
  if (!value) {
    return "";
  }

  const exeName = process.platform === "win32" ? `${binaryName}.exe` : binaryName;
  if (fsSync.existsSync(value)) {
    return value;
  }

  const combined = path.join(value, exeName);
  if (fsSync.existsSync(combined)) {
    return combined;
  }

  return "";
}

async function resolveWingetFfmpegBinary() {
  if (process.platform !== "win32") {
    return "";
  }

  const localAppData = String(process.env.LOCALAPPDATA || "").trim();
  if (!localAppData) {
    return "";
  }

  const packagesRoot = path.join(localAppData, "Microsoft", "WinGet", "Packages");
  if (!fsSync.existsSync(packagesRoot)) {
    return "";
  }

  let packageEntries = [];
  try {
    packageEntries = await fs.readdir(packagesRoot, { withFileTypes: true });
  } catch {
    return "";
  }

  const ffmpegPackages = packageEntries
    .filter((entry) => entry.isDirectory() && entry.name.toLowerCase().startsWith("gyan.ffmpeg_"))
    .map((entry) => path.join(packagesRoot, entry.name));

  for (const pkgPath of ffmpegPackages) {
    let childEntries = [];
    try {
      childEntries = await fs.readdir(pkgPath, { withFileTypes: true });
    } catch {
      childEntries = [];
    }

    for (const child of childEntries) {
      if (!child.isDirectory()) {
        continue;
      }
      const candidate = path.join(pkgPath, child.name, "bin", "ffmpeg.exe");
      if (fsSync.existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return "";
}

function resolveCommonFfmpegBinaryPath() {
  const candidates = [];

  if (process.platform === "darwin") {
    candidates.push(
      "/opt/homebrew/bin/ffmpeg",
      "/opt/local/bin/ffmpeg"
    );
  }

  if (process.platform === "linux") {
    candidates.push(
      "/usr/bin/ffmpeg",
      "/usr/local/bin/ffmpeg",
      "/snap/bin/ffmpeg"
    );
  }

  for (const candidate of candidates) {
    if (fsSync.existsSync(candidate)) {
      return candidate;
    }
  }

  return "";
}

async function resolveFfmpegBinary() {
  if (cachedFfmpegBinary) {
    return cachedFfmpegBinary;
  }

  const fromEnv = normalizeBinaryFromEnv(process.env.FFMPEG_PATH, "ffmpeg");
  if (fromEnv) {
    cachedFfmpegBinary = fromEnv;
    return fromEnv;
  }

  const fromWinget = await resolveWingetFfmpegBinary();
  if (fromWinget) {
    cachedFfmpegBinary = fromWinget;
    return fromWinget;
  }

  const fromCommonPath = resolveCommonFfmpegBinaryPath();
  if (fromCommonPath) {
    cachedFfmpegBinary = fromCommonPath;
    return fromCommonPath;
  }

  cachedFfmpegBinary = "ffmpeg";
  return cachedFfmpegBinary;
}

function getCachedPreviewEntry(cacheKey) {
  const cached = imagePreviewSrcCache.get(cacheKey);
  if (!cached?.path) {
    return null;
  }

  // Touch entry to keep most recently used items longer.
  imagePreviewSrcCache.delete(cacheKey);
  imagePreviewSrcCache.set(cacheKey, cached);
  return cached;
}

function getCachedPreviewPath(cacheKey) {
  const cached = getCachedPreviewEntry(cacheKey);
  if (!cached?.path) {
    return "";
  }
  return String(cached.path || "");
}

function prunePreviewCacheMap(maxEntries = PREVIEW_SRC_CACHE_MAX_ENTRIES) {
  while (imagePreviewSrcCache.size > maxEntries) {
    const firstKey = imagePreviewSrcCache.keys().next().value;
    if (!firstKey) {
      break;
    }
    imagePreviewSrcCache.delete(firstKey);
  }
}

function rememberPreviewCache(cacheKey, cacheFilePath, converter) {
  imagePreviewSrcCache.set(cacheKey, {
    path: cacheFilePath,
    converter,
  });
  prunePreviewCacheMap(PREVIEW_SRC_CACHE_MAX_ENTRIES);
}

async function transcodeMovPreviewToMp4(sourcePath, outputPath) {
  const ffmpegBinary = await resolveFfmpegBinary();

  // Preserve source look whenever possible by re-wrapping compatible MOV streams.
  const remuxArgs = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    sourcePath,
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-c:v",
    "copy",
    "-c:a",
    "copy",
    "-movflags",
    "+faststart",
    outputPath,
  ];

  try {
    await execFileAsync(ffmpegBinary, remuxArgs, {
      windowsHide: true,
      maxBuffer: 20 * 1024 * 1024,
    });
    return;
  } catch {
    // Fall through to full re-encode for incompatible stream combinations.
  }

  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    sourcePath,
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-c:v",
    "libx264",
    "-profile:v",
    "high",
    "-level:v",
    "4.1",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    "-preset",
    "medium",
    "-movflags",
    "+faststart+use_metadata_tags",
    "-map_metadata",
    "0",
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-ac",
    "2",
    "-ar",
    "48000",
    outputPath,
  ];

  await execFileAsync(ffmpegBinary, args, {
    windowsHide: true,
    maxBuffer: 20 * 1024 * 1024,
  });
}

async function transcodeVideoTimeframePreviewToMp4(sourcePath, outputPath, startSeconds, endSeconds) {
  const ffmpegBinary = await resolveFfmpegBinary();
  const safeStart = Math.max(0, Number(startSeconds) || 0);
  const safeEnd = Math.max(safeStart + 0.3, Number(endSeconds) || (safeStart + 3));

  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-ss",
    String(safeStart),
    "-to",
    String(safeEnd),
    "-i",
    sourcePath,
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    outputPath,
  ];

  await execFileAsync(ffmpegBinary, args, {
    windowsHide: true,
    maxBuffer: 30 * 1024 * 1024,
  });
}

function parseStitchResolution(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{3,5})x(\d{3,5})$/i);
  if (!match) {
    return { width: 1080, height: 1920, value: "1080x1920" };
  }
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 320 || height < 320) {
    return { width: 1080, height: 1920, value: "1080x1920" };
  }
  return { width, height, value: `${width}x${height}` };
}

function sanitizeStitchSelectionItems(items) {
  const list = Array.isArray(items) ? items : [];
  const byPath = new Map();
  for (const item of list) {
    const itemPath = String(item?.path || item?.image_path || "").trim();
    if (!itemPath) {
      continue;
    }
    const mediaType = String(item?.media_type || getMediaTypeFromPath(itemPath, "image")).toLowerCase();
    if (mediaType !== "video") {
      continue;
    }
    byPath.set(itemPath, {
      path: itemPath,
      media_type: "video",
      title: String(item?.title || item?.metadata?.title || path.basename(itemPath) || "Untitled video"),
      preview_src: String(item?.preview_src || ""),
    });
  }
  return Array.from(byPath.values());
}

function escapeConcatListPath(filePath) {
  return String(filePath || "").replace(/'/g, "'\\''");
}

async function generateStitchVideo(payload = {}) {
  const requestedItems = sanitizeStitchSelectionItems(payload?.items);
  const selectedItems = requestedItems.length > 0
    ? requestedItems
    : sanitizeStitchSelectionItems(stitchSelectionState.items);

  const requestedCount = Math.max(2, Math.min(50, Number(payload?.videoCount || selectedItems.length || 2)));
  const secondsPerVideo = Math.max(0.1, Math.min(60, Number(payload?.secondsPerVideo || 2)));
  const resolution = parseStitchResolution(payload?.resolution || "1080x1920");
  const muteAll = Boolean(payload?.muteAll ?? true);
  const stitchFps = 24;
  const stitchGop = stitchFps * 2;

  const trimmed = selectedItems.slice(0, requestedCount);
  const verifiedItems = [];
  for (const item of trimmed) {
    if (await pathExists(item.path)) {
      verifiedItems.push(item);
    }
  }

  if (verifiedItems.length < 2) {
    return { ok: false, message: "Please select at least 2 available videos." };
  }

  await fs.mkdir(STITCH_EXPORT_DIR_PATH, { recursive: true });
  const runToken = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const tempDir = path.join(STITCH_EXPORT_DIR_PATH, `tmp-${runToken}`);
  await fs.mkdir(tempDir, { recursive: true });

  sendToRenderer("stitch-progress", {
    phase: "start",
    progress: 0,
    message: `Preparing ${verifiedItems.length} clips...`,
    current: 0,
    total: verifiedItems.length,
  });

  try {
    const ffmpegBinary = await resolveFfmpegBinary();
    const clipPaths = [];
    for (let i = 0; i < verifiedItems.length; i += 1) {
      const item = verifiedItems[i];
      const clipPath = path.join(tempDir, `clip-${String(i + 1).padStart(3, "0")}.mp4`);
      const filter = [
        `scale=${resolution.width}:${resolution.height}:force_original_aspect_ratio=increase:flags=bicubic`,
        `crop=${resolution.width}:${resolution.height}`,
        `fps=${stitchFps}`,
        "format=yuv420p",
        "setsar=1",
      ].join(",");
      const args = [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-stream_loop",
        "-1",
        "-i",
        item.path,
        "-t",
        String(secondsPerVideo),
        "-vf",
        filter,
        "-r",
        String(stitchFps),
        "-vsync",
        "cfr",
        "-c:v",
        "libx264",
        "-preset",
        "superfast",
        "-g",
        String(stitchGop),
        "-keyint_min",
        String(stitchGop),
        "-sc_threshold",
        "0",
        "-crf",
        "24",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        clipPath,
      ];
      const outputArgIndex = Math.max(0, args.indexOf("-movflags"));

      if (muteAll) {
        args.splice(outputArgIndex, 0, "-an");
      } else {
        args.splice(outputArgIndex, 0, "-af", "aresample=async=1:first_pts=0", "-c:a", "aac", "-b:a", "128k", "-shortest");
      }

      await execFileAsync(ffmpegBinary, args, {
        windowsHide: true,
        maxBuffer: 60 * 1024 * 1024,
      });

      clipPaths.push(clipPath);
      sendToRenderer("stitch-progress", {
        phase: "clips",
        progress: Math.round(((i + 1) / (verifiedItems.length + 1)) * 90),
        message: `Processing clip ${i + 1} of ${verifiedItems.length}...`,
        current: i + 1,
        total: verifiedItems.length,
      });
    }

    const concatListPath = path.join(tempDir, "concat-list.txt");
    const concatLines = clipPaths.map((clipPath) => `file '${escapeConcatListPath(clipPath)}'`).join("\n");
    await fs.writeFile(concatListPath, `${concatLines}\n`, "utf-8");

    const outputName = `snoolink-stich-${Date.now()}-${Math.random().toString(16).slice(2, 8)}.mp4`;
    const outputPath = path.join(STITCH_EXPORT_DIR_PATH, outputName);
    const concatArgs = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      concatListPath,
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      outputPath,
    ];

    sendToRenderer("stitch-progress", {
      phase: "merge",
      progress: 92,
      message: "Merging clips into one video...",
      current: verifiedItems.length,
      total: verifiedItems.length,
    });

    await execFileAsync(ffmpegBinary, concatArgs, {
      windowsHide: true,
      maxBuffer: 80 * 1024 * 1024,
    });

    sendToRenderer("stitch-progress", {
      phase: "complete",
      progress: 100,
      message: "Stitch complete.",
      current: verifiedItems.length,
      total: verifiedItems.length,
      path: outputPath,
    });

    return {
      ok: true,
      path: outputPath,
      fileName: outputName,
      usedCount: verifiedItems.length,
      secondsPerVideo,
      resolution: resolution.value,
      durationSeconds: verifiedItems.length * secondsPerVideo,
    };
  } catch (error) {
    const message = String(error?.message || error || "Unknown error");
    const isMissingFfmpeg = /ENOENT|not found|not recognized/i.test(message);
    const safeMessage = isMissingFfmpeg
      ? "ffmpeg was not found. Install FFmpeg and/or set FFMPEG_PATH to the ffmpeg binary path."
      : message;
    sendToRenderer("stitch-progress", {
      phase: "error",
      progress: 0,
      message: safeMessage,
      current: 0,
      total: 0,
    });
    return {
      ok: false,
      message: safeMessage,
    };
  } finally {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors.
    }
  }
}

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

async function renderImagePreviewPng(sourcePath) {
  const sharp = await loadSharpModule();
  let sharpError = null;
  if (sharp) {
    try {
      const buffer = await sharp(sourcePath)
        .rotate()
        .resize({
          width: 720,
          height: 720,
          fit: "inside",
          withoutEnlargement: true,
        })
        .png({ quality: 86 })
        .toBuffer();

      if (buffer?.length) {
        return {
          ok: true,
          buffer,
          converter: "sharp",
        };
      }
    } catch (error) {
      sharpError = String(error?.message || error);
    }
  }

  try {
    const thumbnail = await nativeImage.createThumbnailFromPath(sourcePath, {
      width: 720,
      height: 720,
    });

    if (thumbnail && !thumbnail.isEmpty()) {
      return {
        ok: true,
        buffer: thumbnail.toPNG(),
        converter: "native-thumbnail",
      };
    }
  } catch {
    // Fall through.
  }

  return {
    ok: false,
    message: sharpError || "Could not convert preview.",
  };
}

async function resolvePreviewSrcForImage(imagePath, mediaTypeHint = "image", options = {}) {
  const normalizedPath = String(imagePath || "").trim();
  const mediaType = String(mediaTypeHint || getMediaTypeFromPath(normalizedPath, "image")).toLowerCase();
  const cacheTranscodedMovPreview = options?.cacheTranscodedMovPreview === true;
  const cacheTranscodedHeicPreview = options?.cacheTranscodedHeicPreview === true;
  const cacheTranscodedHeifPreview = options?.cacheTranscodedHeifPreview === true;
  const clipStartSeconds = Number(options?.clipStartSeconds);
  const clipEndSeconds = Number(options?.clipEndSeconds);
  const hasClipRange = Number.isFinite(clipStartSeconds)
    && Number.isFinite(clipEndSeconds)
    && clipEndSeconds > clipStartSeconds;
  if (!normalizedPath) {
    return { ok: false, message: "imagePath is required." };
  }

  if (!(await pathExists(normalizedPath))) {
    return { ok: false, message: "Image file not found.", imagePath: normalizedPath };
  }

  const ext = path.extname(normalizedPath).toLowerCase();
  if (mediaType === "video") {
    if (hasClipRange) {
      // Only force transcoding if explicitly requested in options
      const forceTranscode = options?.forceTranscode === true;
      const startKey = Number(clipStartSeconds.toFixed(3));
      const endKey = Number(clipEndSeconds.toFixed(3));
      if (!forceTranscode) {
        // Return original file path for timeframe preview, let renderer handle seeking
        return {
          ok: true,
          previewSrc: toPreviewSrc(normalizedPath),
          converted: false,
          imagePath: normalizedPath,
          clipStartSeconds: startKey,
          clipEndSeconds: endKey,
        };
      }
      // Fallback: legacy cache/transcode logic for .mov or forced
      await fs.mkdir(PREVIEW_CACHE_DIR_PATH, { recursive: true });
      let sourceFingerprint = "";
      try {
        const stats = await fs.stat(normalizedPath);
        sourceFingerprint = `${stats.size}:${Math.round(stats.mtimeMs)}`;
      } catch {
        sourceFingerprint = "";
      }
      const cacheKey = `video-clip-v1:${normalizedPath.toLowerCase()}:${sourceFingerprint}:${startKey}:${endKey}`;
      const cacheFileName = `${createHash("sha1").update(cacheKey).digest("hex")}.mp4`;
      const cacheFilePath = path.join(PREVIEW_CACHE_DIR_PATH, cacheFileName);
      if (await pathExists(cacheFilePath)) {
        rememberPreviewCache(cacheKey, cacheFilePath, "cache-video-clip");
        return {
          ok: true,
          previewSrc: toPreviewSrc(cacheFilePath),
          converted: true,
          converter: "cache-video-clip",
          imagePath: normalizedPath,
          clipStartSeconds: startKey,
          clipEndSeconds: endKey,
        };
      }
      try {
        await transcodeVideoTimeframePreviewToMp4(normalizedPath, cacheFilePath, startKey, endKey);
        rememberPreviewCache(cacheKey, cacheFilePath, "ffmpeg-video-clip");
        return {
          ok: true,
          previewSrc: toPreviewSrc(cacheFilePath),
          converted: true,
          converter: "ffmpeg-video-clip",
          imagePath: normalizedPath,
          clipStartSeconds: startKey,
          clipEndSeconds: endKey,
        };
      } catch (error) {
        const code = String(error?.code || "").toUpperCase();
        const missingBinaryMessage =
          code === "ENOENT"
            ? "ffmpeg was not found. Install FFmpeg and/or set FFMPEG_PATH to the ffmpeg binary path."
            : "";
        return {
          ok: true,
          previewSrc: toPreviewSrc(normalizedPath),
          converted: false,
          imagePath: normalizedPath,
          warning: missingBinaryMessage || String(error?.message || error),
          clipStartSeconds: startKey,
          clipEndSeconds: endKey,
        };
      }
    }

    if (ext !== ".mov") {
      return {
        ok: true,
        previewSrc: toPreviewSrc(normalizedPath),
        converted: false,
        imagePath: normalizedPath,
      };
    }

    if (!cacheTranscodedMovPreview) {
      return {
        ok: true,
        previewSrc: toPreviewSrc(normalizedPath),
        converted: false,
        imagePath: normalizedPath,
      };
    }

    await fs.mkdir(PREVIEW_CACHE_DIR_PATH, { recursive: true });
    let sourceFingerprint = "";
    try {
      const stats = await fs.stat(normalizedPath);
      sourceFingerprint = `${stats.size}:${Math.round(stats.mtimeMs)}`;
    } catch {
      sourceFingerprint = "";
    }
    const cacheKey = `video-mov-v2:${normalizedPath.toLowerCase()}:${sourceFingerprint}`;
    const cachedPath = getCachedPreviewPath(cacheKey);
    if (cachedPath && (await pathExists(cachedPath))) {
      return {
        ok: true,
        previewSrc: toPreviewSrc(cachedPath),
        converted: true,
        converter: "ffmpeg-mov-h264-aac",
        imagePath: normalizedPath,
      };
    }

    const cacheFileName = `${createHash("sha1").update(cacheKey).digest("hex")}.mp4`;
    const cacheFilePath = path.join(PREVIEW_CACHE_DIR_PATH, cacheFileName);
    if (await pathExists(cacheFilePath)) {
      rememberPreviewCache(cacheKey, cacheFilePath, "cache");
      return {
        ok: true,
        previewSrc: toPreviewSrc(cacheFilePath),
        converted: true,
        converter: "cache",
        imagePath: normalizedPath,
      };
    }

    try {
      await transcodeMovPreviewToMp4(normalizedPath, cacheFilePath);
      rememberPreviewCache(cacheKey, cacheFilePath, "ffmpeg-mov-h264-aac");
      return {
        ok: true,
        previewSrc: toPreviewSrc(cacheFilePath),
        converted: true,
        converter: "ffmpeg-mov-h264-aac",
        imagePath: normalizedPath,
      };
    } catch (error) {
      const code = String(error?.code || "").toUpperCase();
      const missingBinaryMessage =
        code === "ENOENT"
          ? "ffmpeg was not found. Install FFmpeg and/or set FFMPEG_PATH to the ffmpeg binary path."
          : "";
      return {
        ok: true,
        previewSrc: toPreviewSrc(normalizedPath),
        converted: false,
        imagePath: normalizedPath,
        warning: missingBinaryMessage || String(error?.message || error),
      };
    }
  }

  if (!PREVIEW_CONVERTIBLE_EXTENSIONS.has(ext)) {
    return {
      ok: true,
      previewSrc: toPreviewSrc(normalizedPath),
      converted: false,
      imagePath: normalizedPath,
    };
  }

  const shouldCacheConvertedPreviewForExt =
    (ext === ".heic" && cacheTranscodedHeicPreview)
    || (ext === ".heif" && cacheTranscodedHeifPreview);

  const shouldInlineDecodePreview =
    (ext === ".heic" || ext === ".heif")
    && !shouldCacheConvertedPreviewForExt;

  if (shouldInlineDecodePreview) {
    const rendered = await renderImagePreviewPng(normalizedPath);
    if (rendered?.ok && rendered.buffer?.length) {
      return {
        ok: true,
        previewSrc: `data:image/png;base64,${rendered.buffer.toString("base64")}`,
        converted: true,
        converter: `${rendered.converter}-inline`,
        imagePath: normalizedPath,
      };
    }

    return {
      ok: true,
      previewSrc: toPreviewSrc(normalizedPath),
      converted: false,
      imagePath: normalizedPath,
      warning: String(rendered?.message || "Could not decode HEIC/HEIF preview."),
    };
  }

  if (!shouldCacheConvertedPreviewForExt) {
    return {
      ok: true,
      previewSrc: toPreviewSrc(normalizedPath),
      converted: false,
      imagePath: normalizedPath,
    };
  }

  const cached = getCachedPreviewEntry(normalizedPath);
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
    rememberPreviewCache(normalizedPath, cacheFilePath, "cache");
    return {
      ok: true,
      previewSrc: toPreviewSrc(cacheFilePath),
      converted: true,
      converter: "cache",
      imagePath: normalizedPath,
    };
  }

  await fs.mkdir(PREVIEW_CACHE_DIR_PATH, { recursive: true });
  const rendered = await renderImagePreviewPng(normalizedPath);
  if (rendered?.ok && rendered.buffer?.length) {
    await fs.writeFile(cacheFilePath, rendered.buffer);
    rememberPreviewCache(normalizedPath, cacheFilePath, rendered.converter);

    return {
      ok: true,
      previewSrc: toPreviewSrc(cacheFilePath),
      converted: true,
      converter: rendered.converter,
      imagePath: normalizedPath,
    };
  }

  return {
    ok: true,
    previewSrc: toPreviewSrc(normalizedPath),
    converted: false,
    imagePath: normalizedPath,
    warning: String(rendered?.message || "Could not convert preview."),
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
      retryableFailedCount: 0
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
      retryableFailedCount
    };
  } catch {
    return {
      rows: [],
      byPath: new Set(),
      byId: new Set(),
      retryableFailedCount: 0
    };
  }
} // ← this was missing

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
  const [localFingerprint, cloudFingerprint] = await Promise.all([
    getPathFingerprint(localFilePath),
    getPathFingerprint(cloudFilePath),
  ]);
  const combinedFingerprint = `${localFingerprint}|${cloudFingerprint}`;

  if (
    indexingStageLookupCache.payload
    && indexingStageLookupCache.fingerprint === combinedFingerprint
  ) {
    return indexingStageLookupCache.payload;
  }

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

  const payload = {
    localByPath: localSets.byPath,
    localById: localSets.byId,
    cloudByPath: cloudSets.byPath,
    cloudById: cloudSets.byId,
  };

  indexingStageLookupCache = {
    fingerprint: combinedFingerprint,
    payload,
  };

  return payload;
}

async function loadSuccessfulLocalIndexLookup() {
  const lookup = await loadIndexingStageLookup();
  return {
    byPath: lookup?.localByPath instanceof Set ? lookup.localByPath : new Set(),
    byId: lookup?.localById instanceof Set ? lookup.localById : new Set(),
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
    twelvelabs_api_key: "",
    model: "qwen.qwen3-vl-235b-a22b",
    min_match_score: 0.03,
    ui_theme: "aurora",
    results_density: "comfortable",
    auto_expand_filters: false,
    auto_close_sidebar_on_settings_nav: true,
    gallery_video_autoplay: false,
    enable_tooltips: true,
    cache_transcoded_mov_preview: false,
    cache_transcoded_heic_preview: false,
    cache_transcoded_heif_preview: false,
    video_search_result_mode: "full_video",
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
      twelvelabs_api_key: String(payload?.twelvelabs_api_key || ""),
      model: String(payload?.model || defaults.model),
      min_match_score: minMatchScore,
      ui_theme: String(payload?.ui_theme || defaults.ui_theme),
      results_density: String(payload?.results_density || defaults.results_density),
      auto_expand_filters: Boolean(payload?.auto_expand_filters),
      auto_close_sidebar_on_settings_nav:
        payload?.auto_close_sidebar_on_settings_nav === undefined
          ? defaults.auto_close_sidebar_on_settings_nav
          : Boolean(payload?.auto_close_sidebar_on_settings_nav),
      gallery_video_autoplay:
        payload?.gallery_video_autoplay === undefined
          ? defaults.gallery_video_autoplay
          : Boolean(payload?.gallery_video_autoplay),
      enable_tooltips:
        payload?.enable_tooltips === undefined
          ? defaults.enable_tooltips
          : Boolean(payload?.enable_tooltips),
      cache_transcoded_mov_preview:
        payload?.cache_transcoded_mov_preview === undefined
          ? Boolean(payload?.cache_transcoded_preview_media)
          : Boolean(payload?.cache_transcoded_mov_preview),
      cache_transcoded_heic_preview:
        payload?.cache_transcoded_heic_preview === undefined
          ? Boolean(payload?.cache_transcoded_preview_media)
          : Boolean(payload?.cache_transcoded_heic_preview),
      cache_transcoded_heif_preview:
        payload?.cache_transcoded_heif_preview === undefined
          ? Boolean(payload?.cache_transcoded_preview_media)
          : Boolean(payload?.cache_transcoded_heif_preview),
      video_search_result_mode: normalizeVideoSearchResultMode(
        payload?.video_search_result_mode ?? defaults.video_search_result_mode,
      ),
      enable_face_indexing:
        payload?.enable_face_indexing === undefined
          ? true
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
    twelvelabs_api_key: "",
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
      twelvelabs_api_key: String(parsed.TWELVELABS_API_KEY || ""),
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
  const incomingTwelveLabsApiKey = String(settings?.twelvelabs_api_key || "").trim();

  const nextValues = {
    AWS_REGION: String(settings?.aws_region || "us-east-1"),
    AWS_ACCESS_KEY_ID: isMaskedSecretValue(incomingAwsKey)
      ? String(existing?.aws_key || "")
      : incomingAwsKey,
    AWS_SECRET_ACCESS_KEY: isMaskedSecretValue(incomingSecretKey)
      ? String(existing?.secret_key || "")
      : incomingSecretKey,
    TWELVELABS_API_KEY: isMaskedSecretValue(incomingTwelveLabsApiKey)
      ? String(existing?.twelvelabs_api_key || "")
      : incomingTwelveLabsApiKey,
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
  process.env.TWELVELABS_API_KEY = nextValues.TWELVELABS_API_KEY;
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
    twelvelabs_api_key: maskSecretValue(settings?.twelvelabs_api_key),
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
    gallery_video_autoplay:
      settings?.gallery_video_autoplay === undefined
        ? false
        : Boolean(settings?.gallery_video_autoplay),
    enable_tooltips:
      settings?.enable_tooltips === undefined
        ? true
        : Boolean(settings?.enable_tooltips),
    cache_transcoded_mov_preview: Boolean(settings?.cache_transcoded_mov_preview),
    cache_transcoded_heic_preview: Boolean(settings?.cache_transcoded_heic_preview),
    cache_transcoded_heif_preview: Boolean(settings?.cache_transcoded_heif_preview),
    video_search_result_mode: normalizeVideoSearchResultMode(settings?.video_search_result_mode),
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

  function toRgbPixelBuffer(rawPixelData, width, height, channels) {
    const source = rawPixelData instanceof Uint8Array ? rawPixelData : new Uint8Array(rawPixelData);
    const pixelCount = width * height;
    const target = new Uint8Array(pixelCount * 3);

    if (channels === 3) {
      if (source.length !== target.length) {
        throw new Error(`Unexpected RGB buffer size ${source.length}; expected ${target.length}.`);
      }
      target.set(source);
      return target;
    }

    if (channels === 4) {
      if (source.length !== pixelCount * 4) {
        throw new Error(`Unexpected RGBA buffer size ${source.length}; expected ${pixelCount * 4}.`);
      }
      for (let i = 0, j = 0; i < source.length; i += 4, j += 3) {
        target[j] = source[i];
        target[j + 1] = source[i + 1];
        target[j + 2] = source[i + 2];
      }
      return target;
    }

    if (channels === 1 || channels === 2) {
      const stride = channels;
      if (source.length !== pixelCount * stride) {
        throw new Error(`Unexpected grayscale buffer size ${source.length}; expected ${pixelCount * stride}.`);
      }
      for (let i = 0, j = 0; i < source.length; i += stride, j += 3) {
        const value = source[i];
        target[j] = value;
        target[j + 1] = value;
        target[j + 2] = value;
      }
      return target;
    }

    throw new Error(`Unsupported raw image channel count: ${channels}.`);
  }

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

    const minDetectionConfidence = Number(faceSettings?.minDetectionConfidence ?? 0.6);
    const detectionOptions = activeDetectorType === "ssd"
      ? new faceapi.SsdMobilenetv1Options({ minConfidence: minDetectionConfidence })
      : new faceapi.TinyFaceDetectorOptions({
        inputSize: 416,
        scoreThreshold: minDetectionConfidence,
      });

    let lastError = null;
    for (const maxDimension of FACE_ANALYSIS_MAX_DIMENSION_ATTEMPTS) {
      const raw = await sharp(imagePath)
        .rotate()
        .resize({
          width: maxDimension,
          height: maxDimension,
          fit: "inside",
          withoutEnlargement: true,
        })
        .toColorspace("srgb")
        .raw()
        .toBuffer({ resolveWithObject: true });

      const width = Number(raw?.info?.width || 0);
      const height = Number(raw?.info?.height || 0);
      const channels = Number(raw?.info?.channels || 0);
      if (!width || !height) {
        return { ok: false, message: "Invalid image dimensions for face analysis." };
      }

      const rgbPixels = toRgbPixelBuffer(raw?.data, width, height, channels);
      const tensor = faceapi.tf.tensor3d(rgbPixels, [height, width, 3], "int32");

      try {
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
      } catch (error) {
        const message = String(error?.message || error || "").toLowerCase();
        const isWasmTensorAllocationError =
          message.includes("invalid typed array length")
          || message.includes("out of memory")
          || message.includes("wasm");
        lastError = error;
        if (!isWasmTensorAllocationError) {
          throw error;
        }
      } finally {
        if (typeof tensor?.dispose === "function") {
          tensor.dispose();
        }
      }
    }

    throw (lastError || new Error("Face analysis failed after all resize attempts."));
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

function normalizeFilterLookupPath(pathValue) {
  const raw = String(pathValue || "").trim();
  if (!raw) {
    return "";
  }
  const slashNormalized = raw.replace(/\//g, "\\");
  return process.platform === "win32"
    ? slashNormalized.toLowerCase()
    : slashNormalized;
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

function extractLocalFilterData(row, options = {}) {
  const includeOcrCorpus = options?.includeOcrCorpus === true;
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
    ocrCorpus: includeOcrCorpus ? extractOcrCorpusFromRow(row) : "",
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
  let totalChars = 0;

  const canAcceptMoreText = () => totalChars < MAX_FILTER_LOOKUP_OCR_CORPUS_CHARS;
  const pushText = (value) => {
    if (!canAcceptMoreText()) {
      return;
    }
    const text = String(value || "").trim();
    if (text) {
      const remaining = Math.max(0, MAX_FILTER_LOOKUP_OCR_CORPUS_CHARS - totalChars);
      if (remaining <= 0) {
        return;
      }
      const nextText = text.length > remaining ? text.slice(0, remaining) : text;
      if (nextText) {
        parts.push(nextText);
        totalChars += nextText.length;
      }
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

  const allFrames = [
    ...frameAnalyses,
    ...sampledFrames,
    ...metadataFrameAnalyses,
    ...metadataSampledFrames,
  ];

  for (const frame of allFrames.slice(0, MAX_FILTER_LOOKUP_FRAME_ROWS)) {
    if (!canAcceptMoreText()) {
      break;
    }
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
    personLabel: String(next.personLabel || current.personLabel || ""),
    faceClusterId: String(next.faceClusterId || current.faceClusterId || ""),
  };
}

function hasLookupDependentGalleryFilters(filters) {
  const activeFilters = filters && typeof filters === "object" ? filters : {};
  const scalarFilterKeys = [
    "containsPeople",
    "containsText",
    "style",
    "orientation",
    "brightnessCategory",
    "resolutionMegapixels",
    "aspectRatio",
    "fileType",
    "durationBucket",
    "fpsLabel",
    "hasAudio",
    "audioType",
    "hasCaptions",
    "motionLevel",
    "socialMediaBand",
    "instagramBand",
    "aspectRatioSuitability",
    "aestheticStyle",
    "editingLevel",
    "visualComplexity",
    "heroElement",
    "depthOfField",
    "personLabel",
    "faceClusterId",
  ];

  for (const key of scalarFilterKeys) {
    const value = String(activeFilters?.[key] || "").trim().toLowerCase();
    if (value && value !== "any") {
      return true;
    }
  }

  const multiFilterKeys = ["sceneTag", "objectTag", "activityTag"];
  for (const key of multiFilterKeys) {
    const values = Array.isArray(activeFilters?.[key]) ? activeFilters[key] : [activeFilters?.[key]];
    const hasSelection = values
      .map((value) => String(value || "").trim().toLowerCase())
      .some((value) => value && value !== "any");
    if (hasSelection) {
      return true;
    }
  }

  return String(activeFilters.ocrTextQuery || "").trim().length > 0;
}

function hasActiveOcrGalleryFilter(filters) {
  const activeFilters = filters && typeof filters === "object" ? filters : {};
  return String(activeFilters.ocrTextQuery || "").trim().length > 0;
}

async function loadLocalFilterLookup(options = {}) {
  const includeOcrCorpus = options?.includeOcrCorpus === true;
  const selectedMetadataFilePathRaw = String(options?.selectedMetadataFilePath || "").trim();
  const selectedMetadataFilePath = selectedMetadataFilePathRaw
    ? (path.isAbsolute(selectedMetadataFilePathRaw)
      ? selectedMetadataFilePathRaw
      : path.resolve(process.cwd(), selectedMetadataFilePathRaw))
    : "";
  const localFilePath = path.join(DATA_DIR_PATH, "local-image_metadata_results.json");
  const cloudFilePath = path.join(DATA_DIR_PATH, "cloud-image_metadata_results.json");
  const selectedFingerprint = selectedMetadataFilePath
    ? await getPathFingerprint(selectedMetadataFilePath)
    : "none";
  const [localFingerprint, cloudFingerprint] = await Promise.all([
    getPathFingerprint(localFilePath),
    getPathFingerprint(cloudFilePath),
  ]);
  const combinedFingerprint = `${localFingerprint}|${cloudFingerprint}|selected=${selectedMetadataFilePath}|selectedFp=${selectedFingerprint}|ocr=${includeOcrCorpus ? "1" : "0"}`;

  if (
    localFilterLookupCache.payload
    && localFilterLookupCache.fingerprint === combinedFingerprint
  ) {
    return localFilterLookupCache.payload;
  }

  const lookup = new Map();

  const sourcePaths = [];
  const hasSelectedMetadataSource =
    selectedMetadataFilePath
    && path.extname(selectedMetadataFilePath).toLowerCase() === ".json"
    && await pathExists(selectedMetadataFilePath);

  if (hasSelectedMetadataSource) {
    sourcePaths.push(selectedMetadataFilePath);
  } else {
    sourcePaths.push(localFilePath, cloudFilePath);
  }

  const dedupedSourcePaths = Array.from(new Set(
    sourcePaths
      .map((entry) => String(entry || "").trim())
      .filter(Boolean),
  ));

  for (const sourcePath of dedupedSourcePaths) {
    if (!(await pathExists(sourcePath))) {
      continue;
    }
    try {
      const payload = JSON.parse(await fs.readFile(sourcePath, "utf-8"));
      const rows = Array.isArray(payload?.results) ? payload.results : [];
      for (const row of rows) {
        if (lookup.size >= MAX_FILTER_LOOKUP_ROWS) {
          break;
        }
        if (String(row?.status || "") !== "ok") {
          continue;
        }
        const rowPath = String(row?.path || row?.image_path || "").trim();
        const rowKey = normalizeFilterLookupPath(rowPath);
        if (!rowKey) {
          continue;
        }
        const existing = lookup.get(rowKey);
        lookup.set(rowKey, mergeFilterData(existing, extractLocalFilterData(row, { includeOcrCorpus })));
      }
    } catch {
      // Continue with available sources.
    }
    if (lookup.size >= MAX_FILTER_LOOKUP_ROWS) {
      break;
    }
  }

  localFilterLookupCache = {
    fingerprint: combinedFingerprint,
    payload: lookup,
  };

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
    const itemLookupKey = normalizeFilterLookupPath(itemPath);
    const itemMediaType = String(item?.media_type || getMediaTypeFromPath(itemPath, "image")).toLowerCase();
    const filterData = localFilterLookup.get(itemLookupKey) || {};
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

async function forEachResultRowInResultsJson(resultsFilePath, onRow) {
  if (!(await pathExists(resultsFilePath)) || typeof onRow !== "function") {
    return;
  }

  await new Promise((resolve) => {
    const stream = fsSync.createReadStream(resultsFilePath, { encoding: "utf-8" });
    let stage = "seekKey"; // seekKey -> seekColon -> seekArray -> inArray
    let keyWindow = "";
    let resultsArrayDepth = 0;
    let collectingObject = false;
    let objectInString = false;
    let objectEscaped = false;
    let currentObjectDepth = 0;
    let currentObjectBuffer = "";
    let settled = false;

    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      try {
        stream.destroy();
      } catch {
        // Ignore stream destroy errors.
      }
      resolve();
    };

    stream.on("error", () => finish());
    stream.on("end", () => finish());

    stream.on("data", (chunk) => {
      if (settled) {
        return;
      }

      for (let i = 0; i < chunk.length; i += 1) {
        const ch = chunk[i];

        if (collectingObject) {
          currentObjectBuffer += ch;

          if (objectInString) {
            if (objectEscaped) {
              objectEscaped = false;
              continue;
            }
            if (ch === "\\") {
              objectEscaped = true;
              continue;
            }
            if (ch === '"') {
              objectInString = false;
            }
            continue;
          }

          if (ch === '"') {
            objectInString = true;
            continue;
          }

          if (ch === "{") {
            currentObjectDepth += 1;
            continue;
          }

          if (ch === "}") {
            currentObjectDepth -= 1;
            if (currentObjectDepth === 0) {
              collectingObject = false;
              try {
                const parsedRow = JSON.parse(currentObjectBuffer);
                onRow(parsedRow);
              } catch {
                // Ignore malformed rows and continue.
              }
              currentObjectBuffer = "";
            }
            continue;
          }
          continue;
        }

        if (stage === "seekKey") {
          keyWindow = `${keyWindow}${ch}`.slice(-32);
          if (keyWindow.includes('"results"')) {
            stage = "seekColon";
            keyWindow = "";
          }
          continue;
        }

        if (stage === "seekColon") {
          if (/\s/.test(ch)) {
            continue;
          }
          stage = ch === ":" ? "seekArray" : "seekKey";
          continue;
        }

        if (stage === "seekArray") {
          if (/\s/.test(ch)) {
            continue;
          }
          if (ch === "[") {
            stage = "inArray";
            resultsArrayDepth = 1;
            continue;
          }
          stage = "seekKey";
          continue;
        }

        if (stage === "inArray") {
          if (ch === "[") {
            resultsArrayDepth += 1;
            continue;
          }
          if (ch === "]") {
            resultsArrayDepth -= 1;
            if (resultsArrayDepth <= 0) {
              stage = "seekKey";
            }
            continue;
          }
          if (resultsArrayDepth === 1 && ch === "{") {
            collectingObject = true;
            objectInString = false;
            objectEscaped = false;
            currentObjectDepth = 1;
            currentObjectBuffer = "{";
          }
        }
      }
    });
  });
}

async function getLocalFilterOptions(selectedMetadataFilePath = "") {
  const localFilePath = path.join(DATA_DIR_PATH, "local-image_metadata_results.json");
  const cloudFilePath = path.join(DATA_DIR_PATH, "cloud-image_metadata_results.json");
  const normalizedSelectedPathRaw = String(selectedMetadataFilePath || "").trim();
  const normalizedSelectedPath = normalizedSelectedPathRaw
    ? (path.isAbsolute(normalizedSelectedPathRaw)
      ? normalizedSelectedPathRaw
      : path.resolve(process.cwd(), normalizedSelectedPathRaw))
    : "";
  const selectedPathFingerprint = normalizedSelectedPath
    ? await getPathFingerprint(normalizedSelectedPath)
    : "none";

  const [localFingerprint, cloudFingerprint] = await Promise.all([
    getPathFingerprint(localFilePath),
    getPathFingerprint(cloudFilePath),
  ]);
  const combinedFingerprint = `${localFingerprint}|${cloudFingerprint}|selected=${normalizedSelectedPath}|selectedFp=${selectedPathFingerprint}`;

  if (
    localFilterOptionsCache.payload
    && localFilterOptionsCache.fingerprint === combinedFingerprint
  ) {
    return localFilterOptionsCache.payload;
  }

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

  const addScalar = (set, value) => {
    const normalized = String(value || "").trim().toLowerCase();
    if (normalized) {
      set.add(normalized);
    }
  };

  const addList = (set, values) => {
    for (const value of Array.isArray(values) ? values : []) {
      addScalar(set, value);
    }
  };

  const collectFromRow = (row) => {
    if (String(row?.status || "").toLowerCase() !== "ok") {
      return;
    }

    const filterData = extractLocalFilterData(row, { includeOcrCorpus: false });
    addScalar(options.resolutionMegapixels, filterData.resolutionMegapixels);
    addScalar(options.aspectRatio, filterData.aspectRatio);
    addScalar(options.fileType, filterData.fileType);
    addScalar(options.durationBucket, filterData.durationBucket);
    addScalar(options.fpsLabel, filterData.fpsLabel);
    addScalar(options.hasAudio, filterData.hasAudio);
    addScalar(options.audioType, filterData.audioType);
    addScalar(options.hasCaptions, filterData.hasCaptions);
    addScalar(options.motionLevel, filterData.motionLevel);
    addScalar(options.style, filterData.style);
    addScalar(options.orientation, filterData.orientation);
    addScalar(options.brightnessCategory, filterData.brightnessCategory);
    addList(options.sceneTag, filterData.sceneTags);
    addList(options.objectTag, filterData.objectTags);
    addList(options.activityTag, filterData.activityTags);
    addScalar(options.socialMediaBand, filterData.socialMediaBand);
    addScalar(options.instagramBand, filterData.instagramBand);
    addList(options.aspectRatioSuitability, filterData.aspectRatioSuitabilityValues);
    addScalar(options.aestheticStyle, filterData.aestheticStyle);
    addScalar(options.editingLevel, filterData.editingLevel);
    addScalar(options.visualComplexity, filterData.visualComplexity);
    addScalar(options.heroElement, filterData.heroElement);
    addScalar(options.depthOfField, filterData.depthOfField);
    addList(options.personLabel, filterData.personLabels);
    addList(options.faceClusterId, filterData.faceClusterIds);
  };

  const sourcePaths = [];
  const hasSelectedMetadataSource =
    normalizedSelectedPath
    && path.extname(normalizedSelectedPath).toLowerCase() === ".json"
    && await pathExists(normalizedSelectedPath);

  if (hasSelectedMetadataSource) {
    sourcePaths.push(normalizedSelectedPath);
  } else {
    sourcePaths.push(localFilePath, cloudFilePath);
  }

  const dedupedSourcePaths = Array.from(new Set(
    sourcePaths
      .map((entry) => String(entry || "").trim())
      .filter(Boolean),
  ));
  for (const sourcePath of dedupedSourcePaths) {
    try {
      await forEachResultRowInResultsJson(sourcePath, collectFromRow);
    } catch {
      // Continue with remaining metadata sources.
    }
  }

  const payload = {
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

  localFilterOptionsCache = {
    fingerprint: combinedFingerprint,
    payload,
  };

  return payload;
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

function parseBedrockConverseText(response) {
  const outputs = response?.output?.message?.content;
  if (!Array.isArray(outputs)) {
    return "";
  }

  return outputs
    .map((part) => {
      if (typeof part?.text === "string") {
        return part.text;
      }
      if (part?.text && typeof part.text?.toString === "function") {
        return String(part.text);
      }
      return "";
    })
    .join("\n")
    .trim();
}

async function generateWizardPlanWithBedrock(payload) {
  const request = payload && typeof payload === "object" ? payload : {};
  const systemPrompt = String(request.systemPrompt || "").trim();
  const userPrompt = String(request.userPrompt || "").trim();
  const maxTokens = Number.isFinite(Number(request.maxTokens))
    ? Math.max(256, Math.min(4000, Number(request.maxTokens)))
    : 2200;

  // Ensure the userPrompt is passed as-is without modifications
  const finalUserPrompt = userPrompt;

  if (!systemPrompt || !userPrompt) {
    return { ok: false, message: "Wizard request is missing required prompts." };
  }

  await ensureEnvFileExists();
  const envSettings = await readEnvSettings();
  const region = String(envSettings.aws_region || process.env.AWS_REGION || "us-east-1").trim();
  const modelId = String(
    process.env.BEDROCK_QUERY_MODEL || envSettings.model || process.env.BEDROCK_VISION_MODEL || "qwen.qwen3-vl-235b-a22b"
  ).trim();
  const accessKeyId = String(envSettings.aws_key || process.env.AWS_ACCESS_KEY_ID || "").trim();
  const secretAccessKey = String(envSettings.secret_key || process.env.AWS_SECRET_ACCESS_KEY || "").trim();

  if (!accessKeyId || !secretAccessKey) {
    return {
      ok: false,
      message:
        "AWS credentials are missing. Configure AWS Access Key and Secret Key in App Settings first.",
    };
  }

  const client = new BedrockRuntimeClient({
    region,
    requestHandler: new NodeHttpHandler(),
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  const command = new ConverseCommand({
    modelId,
    system: [{ text: systemPrompt }],
    messages: [{ role: "user", content: [{ text: userPrompt }] }],
    inferenceConfig: {
      maxTokens,
      temperature: 0.25,
      topP: 0.95,
    },
  });

  try {
    const response = await client.send(command);
    const text = parseBedrockConverseText(response)
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    if (!text) {
      return { ok: false, message: "Bedrock returned an empty response." };
    }

    return { ok: true, text, modelId, region };
  } catch (error) {
    return { ok: false, message: String(error?.message || error) };
  }
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

function createInstagramReelAnalyzerWindow() {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win || win.isDestroyed()) {
    console.error("No active window to load the analyzer.");
    return;
  }

  win.loadFile(path.join(__dirname, "instagram-reel-analyzer.html"));
  win.setTitle("Instagram Reel Analyzer");
}

function stripMarkdownCodeFence(text) {
  return String(text || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function toSafeNumberOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeStructuredReelPayload(raw, fallbackText) {
  const payload = raw && typeof raw === "object" ? raw : {};
  const clipTypesRaw = Array.isArray(payload.clip_types)
    ? payload.clip_types
    : Array.isArray(payload.clipTypes)
      ? payload.clipTypes
      : [];
  const textsRaw = Array.isArray(payload.texts)
    ? payload.texts
    : Array.isArray(payload.texts_present)
      ? payload.texts_present
      : [];

  const texts = textsRaw
    .map((row) => ({
      text: String(row?.text || row?.quote || "").trim(),
      start: toSafeNumberOrNull(row?.start ?? row?.start_sec ?? row?.startSeconds),
      end: toSafeNumberOrNull(row?.end ?? row?.end_sec ?? row?.endSeconds),
      timeframe: String(row?.timeframe || "").trim(),
    }))
    .filter((row) => row.text);

  const clipTypes = clipTypesRaw
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  const clipCount = toSafeNumberOrNull(payload.clip_count ?? payload.clipCount);
  const mainQuote = String(payload.main_quote ?? payload.mainQuote ?? "").trim();

  return {
    clip_count: clipCount,
    clip_types: clipTypes,
    main_quote: mainQuote,
    texts,
    narrative: String(fallbackText || "").trim(),
  };
}

function parseStructuredReelPayloadFromText(rawText, fallbackText) {
  const cleaned = stripMarkdownCodeFence(rawText);
  if (!cleaned) {
    return normalizeStructuredReelPayload(null, fallbackText);
  }

  try {
    return normalizeStructuredReelPayload(JSON.parse(cleaned), fallbackText);
  } catch {
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      const sliced = cleaned.slice(firstBrace, lastBrace + 1);
      try {
        return normalizeStructuredReelPayload(JSON.parse(sliced), fallbackText);
      } catch {
        // Fall back below.
      }
    }
  }

  return normalizeStructuredReelPayload(null, fallbackText || cleaned);
}

async function runInstagramReelAnalysisWithTwelveLabs(payload) {
  const request = payload && typeof payload === "object" ? payload : {};
  const videoPath = String(request.videoPath || "").trim();
  const videoUrl = String(request.videoUrl || "").trim();
  const indexId = String(request.indexId || INSTAGRAM_REEL_ANALYZER_INDEX_ID).trim();
  const prompt = String(request.prompt || "").trim() || [
    "Analyze this Instagram reel and return the most practical breakdown for production recreation.",
    "Include the likely clip sequence, clip purposes, and a concise core quote.",
    "Also include any on-screen text with rough timeframe references.",
  ].join(" ");

  if (!videoPath && !videoUrl) {
    return { ok: false, message: "Provide a local video file or a direct video URL." };
  }

  const settings = await readUserSettings();
  const envSettings = await readEnvSettings();
  const apiKey = String(envSettings.twelvelabs_api_key || settings.twelvelabs_api_key || "").trim();
  if (!apiKey) {
    return {
      ok: false,
      message: "TwelveLabs API key is missing. Add it in App Settings first.",
    };
  }

  if (videoPath) {
    const exists = await pathExists(videoPath);
    if (!exists) {
      return { ok: false, message: "Selected video file was not found." };
    }
  }

  const client = new TwelveLabs({ apiKey });

  try {
    const task = await client.task.create({
      indexId,
      ...(videoPath ? { file: videoPath } : { url: videoUrl }),
    });

    if (!task?.id) {
      return { ok: false, message: "TwelveLabs did not return a task id." };
    }

    const completedTask = await task.waitForDone(5000);
    const finalStatus = String(completedTask?.status || "").toLowerCase();
    if (finalStatus !== "ready") {
      return {
        ok: false,
        message: `TwelveLabs indexing task did not complete successfully (status: ${completedTask?.status || "unknown"}).`,
      };
    }

    const videoId = String(completedTask?.videoId || "").trim();
    if (!videoId) {
      return { ok: false, message: "TwelveLabs did not return a video id after indexing." };
    }

    const narrative = await client.analyze(videoId, prompt);

    const narrativeText = String(narrative?.data || "").trim();

    const structuringPrompt = [
      "Return ONLY valid JSON.",
      "Extract a production-focused Instagram reel breakdown using this exact schema:",
      '{"clip_count": number|null, "clip_types": string[], "main_quote": string, "texts": [{"text": string, "timeframe": string, "start": number|null, "end": number|null}] }',
      "Rules:",
      "- clip_count is the number of sequential clips you can infer.",
      "- clip_types should be reusable categories (hook shot, talking head, b-roll, cta, etc).",
      "- main_quote should be the strongest line spoken or shown.",
      "- texts should include on-screen text or quote text with rough timeframe when possible.",
      "- If unknown, use null or empty arrays.",
    ].join("\n");

    const structured = await client.analyze(videoId, structuringPrompt);

    const structuredText = String(structured?.data || "").trim();
    const normalizedStructured = parseStructuredReelPayloadFromText(structuredText, narrativeText);

    return {
      ok: true,
      indexId,
      assetId: String(task.id),
      indexedAssetId: videoId,
      prompt,
      source: videoPath ? "local" : "url",
      sourceValue: videoPath || videoUrl,
      analysisText: narrativeText,
      structured: normalizedStructured,
      rawStructuredText: structuredText,
    };
  } catch (error) {
    return {
      ok: false,
      message: String(error?.message || error),
    };
  }
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

ipcMain.handle("open-instagram-reel-analyzer-window", async () => {
  try {
    createInstagramReelAnalyzerWindow();
    return { ok: true };
  } catch (error) {
    return { ok: false, message: String(error?.message || error) };
  }
});

ipcMain.handle("pick-instagram-reel-video", async (event) => {
  try {
    const parentWindow = BrowserWindow.fromWebContents(event.sender) || undefined;
    const result = await dialog.showOpenDialog(parentWindow, {
      title: "Choose a video for Instagram Reel analysis",
      filters: [{ name: "Video", extensions: Array.from(VIDEO_FILE_TYPES).map((v) => v.replace(".", "")) }],
      properties: ["openFile"],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, message: "No video selected." };
    }

    return { ok: true, filePath: result.filePaths[0] };
  } catch (error) {
    return { ok: false, message: String(error?.message || error) };
  }
});

ipcMain.handle("analyze-instagram-reel", async (_event, payload) => {
  return runInstagramReelAnalysisWithTwelveLabs(payload);
});

ipcMain.handle("validate-metadata-file", async (_event, filePath) => {
  return validateMetadataFile(filePath);
});

ipcMain.handle("semantic-search", async (_event, payload) => {
    // Log memory usage at start of handler
    try {
      const mem = process.memoryUsage();
      const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1);
      console.log(`[snoolink-lens][search] Heap: ${mb(mem.heapUsed)} MB / ${mb(mem.heapTotal)} MB | RSS: ${mb(mem.rss)} MB | External: ${mb(mem.external)} MB`);
    } catch {}
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

  const settings = await readUserSettings();
  const minMatchFromPayload = Number(payload?.minScore);
  let effectiveMinScore = minMatchFromPayload;
  if (!Number.isFinite(effectiveMinScore)) {
    effectiveMinScore = Number(settings?.min_match_score || 0.001);
  }

  const effectiveVideoResultMode = normalizeVideoSearchResultMode(
    payload?.videoResultMode ?? settings?.video_search_result_mode,
  );

  const runPayload = {
    ...(payload || {}),
    minScore: effectiveMinScore,
    videoResultMode: effectiveVideoResultMode,
    allowedImagePaths,
  };

  const result = await runSemanticSearch(runPayload);
  const compactResult = result?.ok === true
    ? {
      ...result,
      results: compactSearchResultRows(result?.results),
    }
    : result;

  try {
    await appendSearchHistoryEntry({
      query: String(payload?.query || ""),
      filePath: String(payload?.filePath || ""),
      topK: Number(payload?.topK || 20),
      minScore: effectiveMinScore,
      filters,
      allowedImagePathsCount: Array.isArray(allowedImagePaths) ? allowedImagePaths.length : 0,
      result: {
        ok: result?.ok === true,
        filteredCount: Number(result?.filteredCount || 0),
        results: Array.isArray(result?.results) ? new Array(result.results.length) : [],
        message: String(result?.message || ""),
        queryExpansion: cloneJsonSafe(result?.queryExpansion) || null,
      },
    });
  } catch {
    // Logging must never break search.
  }

  return compactResult;
});

ipcMain.handle("wizard-generate-plan", async (_event, payload) => {
  return generateWizardPlanWithBedrock(payload);
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
    const pathOnly = payload?.pathOnly === true;
    if (!imagePath) {
      return { ok: false, message: "imagePath is required." };
    }
    if (!pathOnly && !metadataFilePath) {
      return { ok: false, message: "filePath and imagePath are required." };
    }

    if (pathOnly) {
      const snapshot = payload?.rowSnapshot && typeof payload.rowSnapshot === "object"
        ? payload.rowSnapshot
        : {};
      let sizeBytes = null;
      let modifiedAt = null;
      try {
        const stats = await fs.stat(imagePath);
        sizeBytes = Number(stats?.size || 0);
        modifiedAt = stats?.mtime ? new Date(stats.mtime).toISOString() : null;
      } catch {
        // Keep metadata lightweight even when file stat fails.
      }

      const inferredMediaType = String(
        snapshot?.media_type ||
        snapshot?.metadata?.media_type ||
        getMediaTypeFromPath(imagePath, "image"),
      );

      const localPath = path.join(DATA_DIR_PATH, "local-image_metadata_results.json");
      const cloudPath = path.join(DATA_DIR_PATH, "cloud-image_metadata_results.json");
      const [localRow, cloudRow] = await Promise.all([
        findMetadataRowByPathInResultsJson(localPath, imagePath),
        findMetadataRowByPathInResultsJson(cloudPath, imagePath),
      ]);

      const effectiveLocalRow = localRow || null;
      const effectiveCloudRow = cloudRow || null;

      const metadata = effectiveLocalRow?.metadata && typeof effectiveLocalRow.metadata === "object"
        ? effectiveLocalRow.metadata
        : snapshot?.metadata && typeof snapshot.metadata === "object"
          ? snapshot.metadata
        : {
          title: path.basename(imagePath) || `Untitled ${inferredMediaType}`,
          description: String(effectiveCloudRow?.description || ""),
          tags: [],
          objects: [],
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
        : snapshot?.cloud_metadata || null;

      const localMetadata = effectiveLocalRow
        ? effectiveLocalRow?.local_metadata || effectiveLocalRow
        : snapshot?.local_metadata || null;

      const pathOnlyResult = {
        id: effectiveLocalRow?.id ?? effectiveCloudRow?.id ?? snapshot?.id ?? null,
        path: imagePath,
        image_path: imagePath,
        media_type: inferredMediaType,
        status: String(effectiveLocalRow?.status || effectiveCloudRow?.status || snapshot?.status || "ok"),
        metadata,
        local_metadata: {
          ...(localMetadata && typeof localMetadata === "object" ? localMetadata : {}),
          size_bytes: sizeBytes,
          modified_at: modifiedAt,
        },
        cloud_metadata: cloudMetadata,
        model_id: cloudMetadata?.model_id || snapshot?.model_id || null,
        analyzed_at: cloudMetadata?.analyzed_at || snapshot?.analyzed_at || null,
        description: cloudMetadata?.description || snapshot?.description || null,
        ocr: cloudMetadata?.ocr || snapshot?.ocr || null,
        error: String(
          effectiveLocalRow?.error ||
          effectiveCloudRow?.error ||
          snapshot?.error ||
          "",
        ),
      };

      return {
        ok: true,
        result: pathOnlyResult,
      };
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

ipcMain.handle("set-stitch-selection", async (_event, payload) => {
  try {
    const items = sanitizeStitchSelectionItems(payload?.items);
    stitchSelectionState = {
      items,
      updatedAt: new Date().toISOString(),
    };
    return {
      ok: true,
      count: items.length,
      updatedAt: stitchSelectionState.updatedAt,
    };
  } catch (error) {
    return { ok: false, message: String(error?.message || error) };
  }
});

ipcMain.handle("get-stitch-selection", async () => {
  return {
    ok: true,
    items: Array.isArray(stitchSelectionState.items) ? stitchSelectionState.items.slice() : [],
    count: Array.isArray(stitchSelectionState.items) ? stitchSelectionState.items.length : 0,
    updatedAt: stitchSelectionState.updatedAt,
  };
});

ipcMain.handle("clear-stitch-selection", async () => {
  stitchSelectionState = {
    items: [],
    updatedAt: new Date().toISOString(),
  };
  return {
    ok: true,
    count: 0,
    updatedAt: stitchSelectionState.updatedAt,
  };
});

ipcMain.handle("generate-stitch-video", async (_event, payload) => {
  try {
    return await generateStitchVideo(payload);
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
    const sourcePathRaw = String(payload?.sourcePath || "").trim();
    const clipStartSeconds = Number(payload?.clipStartSeconds);
    const clipEndSeconds = Number(payload?.clipEndSeconds);
    const shouldExportTrimmedClip = Number.isFinite(clipStartSeconds)
      && Number.isFinite(clipEndSeconds)
      && clipEndSeconds > clipStartSeconds;
    if (!imagePath && !sourcePathRaw) {
      return { ok: false, message: "imagePath or sourcePath is required." };
    }

    let sourcePath = "";
    if (sourcePathRaw) {
      if (sourcePathRaw.startsWith("file://")) {
        sourcePath = fileURLToPath(sourcePathRaw);
      } else {
        sourcePath = path.resolve(sourcePathRaw);
      }
    } else {
      sourcePath = path.resolve(imagePath);
    }

    if (!(await pathExists(sourcePath))) {
      return { ok: false, message: "Source file not found." };
    }

    const desktopDir = app.getPath("desktop");
    const targetDir = path.join(desktopDir, DOWNLOAD_FOLDER_NAME);
    await fs.mkdir(targetDir, { recursive: true });

    const sourceName = path.basename(sourcePath);
    let targetPath = "";

    if (shouldExportTrimmedClip) {
      const parsed = path.parse(sourceName);
      const clipStartLabel = Number(clipStartSeconds.toFixed(3)).toString().replace(".", "-");
      const clipEndLabel = Number(clipEndSeconds.toFixed(3)).toString().replace(".", "-");
      const trimmedFileName = `${parsed.name}_clip_${clipStartLabel}s-${clipEndLabel}s.mp4`;
      targetPath = await getUniquePathInDirectory(targetDir, trimmedFileName);
      try {
        await transcodeVideoTimeframePreviewToMp4(sourcePath, targetPath, clipStartSeconds, clipEndSeconds);
      } catch (error) {
        const code = String(error?.code || "").toUpperCase();
        if (code === "ENOENT") {
          return {
            ok: false,
            message: "ffmpeg was not found. Install FFmpeg and/or set FFMPEG_PATH to the ffmpeg binary path.",
          };
        }
        throw error;
      }
    } else {
      targetPath = await getUniquePathInDirectory(targetDir, sourceName);
      await fs.copyFile(sourcePath, targetPath);
    }

    return { ok: true, path: targetPath, directory: targetDir };
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

ipcMain.handle("start-share-server", async (_event, payload) => {
  try {
    let filePath = String(payload?.filePath || "").trim();

    // If bytes are provided instead of a path, write them to a temp file first
    if (!filePath && payload?.bytes) {
      const fileName = String(payload?.fileName || `snoolink-share-${Date.now()}.mp4`).replace(/[^a-z0-9._-]/gi, "_");
      const tmpDir = path.join(app.getPath("temp"), "snoolink-share");
      await fs.mkdir(tmpDir, { recursive: true });
      filePath = path.join(tmpDir, fileName);
      await fs.writeFile(filePath, Buffer.from(payload.bytes));
    }

    if (!filePath) {
      return { ok: false, message: "filePath or bytes is required." };
    }
    const qrcode = nodeRequire("qrcode");
    const result = await startShareServer(filePath);
    if (!result.ok) {
      return result;
    }
    const qrDataUrl = await qrcode.toDataURL(result.url, {
      width: 280,
      margin: 2,
      color: { dark: "#000000", light: "#ffffff" },
    });
    return { ...result, qrDataUrl };
  } catch (error) {
    return { ok: false, message: String(error?.message || error) };
  }
});

ipcMain.handle("stop-share-server", async () => {
  try {
    stopShareServer();
    return { ok: true };
  } catch (error) {
    return { ok: false, message: String(error?.message || error) };
  }
});

ipcMain.handle("read-binary-file", async (_event, payload) => {
  try {
    const sourcePath = String(payload?.path || "").trim();
    if (!sourcePath) {
      return { ok: false, message: "path is required." };
    }

    const normalizedPath = path.resolve(sourcePath);
    if (!(await pathExists(normalizedPath))) {
      return { ok: false, message: "Source file not found." };
    }

    const bytes = await fs.readFile(normalizedPath);
    return { ok: true, bytes };
  } catch (error) {
    return { ok: false, message: String(error?.message || error) };
  }
});

ipcMain.handle("get-ui-partial", async (_event, payload) => {
  try {
    const name = String(payload?.name || "").trim();
    const allowed = new Set(["sidebar.html", "user-settings.html", "faces-ui.html"]);
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
  // Log memory usage at start of handler
  try {
    const mem = process.memoryUsage();
    const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1);
    console.log(`[snoolink-lens][preview] Heap: ${mb(mem.heapUsed)} MB / ${mb(mem.heapTotal)} MB | RSS: ${mb(mem.rss)} MB | External: ${mb(mem.external)} MB`);
  } catch {}
  try {
    const imagePath = String(payload?.imagePath || "").trim();
    const mediaType = String(payload?.mediaType || getMediaTypeFromPath(imagePath, "image"));
    const settings = await readUserSettings();
    return await resolvePreviewSrcForImage(imagePath, mediaType, {
      clipStartSeconds: payload?.clipStartSeconds,
      clipEndSeconds: payload?.clipEndSeconds,
      cacheTranscodedMovPreview: Boolean(settings?.cache_transcoded_mov_preview),
      cacheTranscodedHeicPreview: Boolean(settings?.cache_transcoded_heic_preview),
      cacheTranscodedHeifPreview: Boolean(settings?.cache_transcoded_heif_preview),
    });
  } catch (error) {
    return { ok: false, message: String(error?.message || error) };
  }
});

function normalizeRandomSeed(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.abs(Math.floor(numeric)) >>> 0;
}

function fnv1a32(input) {
  const text = String(input || "");
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function sortItemsBySeed(items, seed) {
  const normalizedSeed = normalizeRandomSeed(seed);
  if (!Array.isArray(items) || items.length <= 1) {
    return Array.isArray(items) ? items.slice() : [];
  }

  return items
    .map((item, index) => {
      const itemPath = String(item?.path || "");
      const stableId = itemPath || `item-${index}`;
      return {
        item,
        index,
        key: fnv1a32(`${normalizedSeed}:${stableId}`),
      };
    })
    .sort((a, b) => {
      if (a.key !== b.key) {
        return a.key - b.key;
      }
      return a.index - b.index;
    })
    .map((entry) => entry.item);
}

function buildLightweightGalleryItem(item, overrides = {}) {
  const safeItem = item && typeof item === "object" ? item : {};
  const itemPath = String(safeItem?.path || "").trim();
  const itemMediaType = String(safeItem?.media_type || getMediaTypeFromPath(itemPath, "image"));
  const name = String(safeItem?.name || path.basename(itemPath) || "Untitled media");
  const directory = String(safeItem?.directory || path.dirname(itemPath) || "");

  return {
    id: safeItem?.id ?? null,
    path: itemPath,
    media_type: itemMediaType,
    preview_src: String(overrides?.preview_src || safeItem?.preview_src || toPreviewSrc(itemPath)),
    indexing_stage: String(overrides?.indexing_stage || "none"),
    metadata: {
      title: name,
      description: directory,
      tags: [],
      objects: [],
      media_type: itemMediaType,
    },
  };
}

ipcMain.handle("get-master-directory", async (_event, options) => {
  // Log memory usage at start of handler
  try {
    const mem = process.memoryUsage();
    const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1);
    console.log(`[snoolink-lens][search] Heap: ${mb(mem.heapUsed)} MB / ${mb(mem.heapTotal)} MB | RSS: ${mb(mem.rss)} MB | External: ${mb(mem.external)} MB`);
    const payload = await loadMasterDirectory();
    const albumData = await loadAlbumsData();
    const activeFilters = options?.filters && typeof options.filters === "object" ? options.filters : {};
    const requiresLookupFilters = hasLookupDependentGalleryFilters(activeFilters) || hasActiveOcrGalleryFilter(activeFilters);
    const includeOcrCorpus = hasActiveOcrGalleryFilter(activeFilters);
    const selectedMetadataFilePath = String(activeFilters?.metadataFilePath || "").trim();
    const settings = await readUserSettings();
    const cacheTranscodedMovPreview = Boolean(settings?.cache_transcoded_mov_preview);
    const cacheTranscodedHeicPreview = Boolean(settings?.cache_transcoded_heic_preview);
    const cacheTranscodedHeifPreview = Boolean(settings?.cache_transcoded_heif_preview);
    const items = Array.isArray(payload?.items) ? payload.items : [];
    const stageLookup = await loadIndexingStageLookup();
    const localFilterLookup = requiresLookupFilters
      ? await loadLocalFilterLookup({ includeOcrCorpus, selectedMetadataFilePath })
      : new Map();
    const requestedOffset = Number(options?.offset);
    const requestedLimit = Number(options?.limit);
    const deferPreviewResolution = options?.deferPreviewResolution !== false;
    const offset = Number.isFinite(requestedOffset)
      ? Math.max(0, Math.floor(requestedOffset))
      : 0;
    const limit = Number.isFinite(requestedLimit)
      ? Math.max(1, Math.min(Math.floor(requestedLimit), 500))
      : 120;

    const filteredByAlbums = filterItemsByAlbumIds(items, albumData, activeFilters?.albumIds);
    const randomize = options?.randomize === true;
    const randomSeed = normalizeRandomSeed(options?.randomSeed);
    let filteredItems = applyGalleryFilters(filteredByAlbums, localFilterLookup, activeFilters);
    if (randomize && filteredItems.length > 1) {
      filteredItems = sortItemsBySeed(filteredItems, randomSeed);
    }

    // Returning the full directory for very large libraries can OOM the renderer.
    const pageItems = filteredItems.slice(offset, offset + limit);
    const limitedItems = await Promise.all(
      pageItems.map(async (item) => {
        const itemPath = String(item?.path || "");
        const itemMediaType = String(item?.media_type || getMediaTypeFromPath(itemPath, "image"));
        const resolvedPreview = deferPreviewResolution
          ? null
          : await resolvePreviewSrcForImage(itemPath, itemMediaType, {
            cacheTranscodedMovPreview,
            cacheTranscodedHeicPreview,
            cacheTranscodedHeifPreview,
          });
        return buildLightweightGalleryItem(item, {
          preview_src:
            resolvedPreview?.ok && resolvedPreview?.previewSrc
              ? resolvedPreview.previewSrc
              : item?.preview_src || toPreviewSrc(itemPath),
          indexing_stage: getIndexingStageForItem(item, stageLookup),
        });
      })
    );
    return {
      ok: true,
      path: MASTER_DIRECTORY_PATH,
      total: filteredItems.length,
      offset,
      randomSeed,
      hasMore: offset + limitedItems.length < filteredItems.length,
      shown: limitedItems.length,
      generatedAt: payload?.generated_at || null,
      items: limitedItems
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
      twelvelabs_api_key: envSettings.twelvelabs_api_key || storedSettings.twelvelabs_api_key,
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

ipcMain.handle("backup-app-data", async (event) => {
  try {
    const parentWindow = BrowserWindow.fromWebContents(event.sender) || undefined;
    const folderResult = await dialog.showOpenDialog(parentWindow, {
      title: "Choose backup destination folder",
      properties: ["openDirectory", "createDirectory"],
    });

    if (folderResult.canceled || !Array.isArray(folderResult.filePaths) || folderResult.filePaths.length === 0) {
      return { ok: false, cancelled: true, message: "Backup cancelled." };
    }

    await ensureEnvFileExists();
    await ensureUserSettingsFileExists();
    await ensureAlbumsDataFileExists();

    const targetRoot = folderResult.filePaths[0];
    const timestampSlug = buildBackupTimestampSlug();
    const backupDirName = `snoolink-lens-backup-${timestampSlug}`;
    const backupDirPath = path.join(targetRoot, backupDirName);
    await fs.mkdir(backupDirPath, { recursive: true });

    const specs = getBackupFileSpecs();
    const backedUpFiles = [];
    const missingFiles = [];
    const skippedRequiredFiles = [];
    const manifest = {
      generated_at: new Date().toISOString(),
      source_data_dir: DATA_DIR_PATH,
      backup_dir_name: backupDirName,
      backup_dir_path: backupDirPath,
      files: [],
    };

    for (const spec of specs) {
      const sourcePath = spec.sourcePath;
      const fileName = String(spec.fileName || "").trim();
      const isRequired = Boolean(spec.required);

      if (!(await pathExists(sourcePath))) {
        missingFiles.push({
          key: spec.key,
          fileName,
          sourcePath,
          required: isRequired,
          reason: "not_found",
        });
        if (isRequired) {
          skippedRequiredFiles.push(fileName || spec.key);
        }
        continue;
      }

      try {
        const targetPath = path.join(backupDirPath, fileName || path.basename(sourcePath));
        await fs.copyFile(sourcePath, targetPath);
        const stat = await fs.stat(targetPath);

        backedUpFiles.push({
          key: spec.key,
          fileName: fileName || path.basename(sourcePath),
          sourcePath,
          targetPath,
          size_bytes: Number(stat.size) || 0,
        });
        manifest.files.push({
          key: spec.key,
          file_name: fileName || path.basename(sourcePath),
          source_path: sourcePath,
          target_path: targetPath,
          size_bytes: Number(stat.size) || 0,
          required: isRequired,
        });
      } catch (error) {
        missingFiles.push({
          key: spec.key,
          fileName,
          sourcePath,
          required: isRequired,
          reason: String(error?.message || error),
        });
        if (isRequired) {
          skippedRequiredFiles.push(fileName || spec.key);
        }
      }
    }
    await fs.writeFile(
      path.join(backupDirPath, "backup-manifest.json"),
      JSON.stringify(manifest, null, 2),
      "utf-8",
    );

    if (backedUpFiles.length === 0) {
      return {
        ok: false,
        message: "No data files were available to back up yet.",
        backupDir: backupDirPath,
        filesBackedUp: 0,
        missingFiles,
      };
    }

    const message = skippedRequiredFiles.length > 0
      ? `Backup completed with missing required file(s): ${skippedRequiredFiles.join(", ")}.`
      : "Backup completed.";

    return {
      ok: true,
      message,
      backupDir: backupDirPath,
      filesBackedUp: backedUpFiles.length,
      missingFiles,
      requiredFilesMissing: skippedRequiredFiles,
    };
  } catch (error) {
    return { ok: false, message: String(error?.message || error) };
  }
});

ipcMain.handle("get-local-filter-options", async (_event, payload) => {
  try {
    const options = await getLocalFilterOptions(payload?.filePath);
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
    const activeFilters = payload?.filters && typeof payload.filters === "object" ? payload.filters : {};
    const requiresLookupFilters = hasLookupDependentGalleryFilters(activeFilters) || hasActiveOcrGalleryFilter(activeFilters);
    const includeOcrCorpus = hasActiveOcrGalleryFilter(activeFilters);
    const selectedMetadataFilePath = String(activeFilters?.metadataFilePath || "").trim();
    const settings = await readUserSettings();
    const cacheTranscodedMovPreview = Boolean(settings?.cache_transcoded_mov_preview);
    const cacheTranscodedHeicPreview = Boolean(settings?.cache_transcoded_heic_preview);
    const cacheTranscodedHeifPreview = Boolean(settings?.cache_transcoded_heif_preview);
    const stageLookup = await loadIndexingStageLookup();
    const localFilterLookup = requiresLookupFilters
      ? await loadLocalFilterLookup({ includeOcrCorpus, selectedMetadataFilePath })
      : new Map();

    const requestedOffset = Number(payload?.offset);
    const requestedLimit = Number(payload?.limit);
    const offset = Number.isFinite(requestedOffset)
      ? Math.max(0, Math.floor(requestedOffset))
      : 0;
    const limit = Number.isFinite(requestedLimit)
      ? Math.max(1, Math.min(Math.floor(requestedLimit), 500))
      : 120;

    const filteredByAlbum = filterItemsByAlbumIds(allItems, data, [albumId]);
    const filtered = applyGalleryFilters(filteredByAlbum, localFilterLookup, activeFilters);
    const pageItems = filtered.slice(offset, offset + limit);
    const paged = await Promise.all(
      pageItems.map(async (item) => {
        const itemPath = String(item?.path || "");
        const itemMediaType = String(item?.media_type || getMediaTypeFromPath(itemPath, "image"));
        const resolvedPreview = payload?.deferPreviewResolution === false
          ? await resolvePreviewSrcForImage(itemPath, itemMediaType, {
            cacheTranscodedMovPreview,
            cacheTranscodedHeicPreview,
            cacheTranscodedHeifPreview,
          })
          : null;
        return buildLightweightGalleryItem(item, {
          preview_src:
            resolvedPreview?.ok && resolvedPreview?.previewSrc
              ? resolvedPreview.previewSrc
              : item?.preview_src || toPreviewSrc(itemPath),
          indexing_stage: getIndexingStageForItem(item, stageLookup),
        });
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
        // Video extractor is optional at startup; runtime path will fallback per file.
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
    let localRowsForCloud = [];
    if (useCloud && targets.length > 0) {
      localRowsForCloud = await loadLocalIndexRows();
      const grouping = buildCloudGroupsFromLocalTargets(targets, localRowsForCloud);
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

    const requestedParallelism = Number(
      process.env.SNOOLINK_INDEX_CONCURRENCY
      || (useCloud ? 4 : 1),
    );
    const indexingConcurrency = Math.max(1, Math.min(8, Math.floor(requestedParallelism || 1)));
    sendToRenderer("index-log", {
      message: `Index parallelism: ${indexingConcurrency} worker${indexingConcurrency === 1 ? "" : "s"}.`,
    });

    function chunkArray(items, size) {
      const rows = Array.isArray(items) ? items : [];
      const chunkSize = Math.max(1, Number(size || 1));
      const out = [];
      for (let i = 0; i < rows.length; i += chunkSize) {
        out.push(rows.slice(i, i + chunkSize));
      }
      return out;
    }

    function getVideoDurationBatchKey(seconds) {
      const value = Number(seconds);
      if (!Number.isFinite(value) || value <= 0) {
        return "unknown";
      }
      if (value < 30) {
        return "v-00-under-30s";
      }
      if (value < 90) {
        return "v-01-30s-90s";
      }
      if (value < 240) {
        return "v-02-90s-4m";
      }
      if (value < 600) {
        return "v-03-4m-10m";
      }
      return "v-04-10m-plus";
    }

    function resolveRepresentativeVideoDurationSeconds(imagePath, localDurationByPath) {
      const direct = Number(localDurationByPath.get(imagePath));
      if (Number.isFinite(direct) && direct > 0) {
        return direct;
      }

      const group = cloudGroupByRepresentative.get(imagePath);
      const members = Array.isArray(group?.members) ? group.members : [];
      for (const memberPath of members) {
        const candidate = Number(localDurationByPath.get(memberPath));
        if (Number.isFinite(candidate) && candidate > 0) {
          return candidate;
        }
      }

      return null;
    }

    let executionBatches = chunkArray(targets, indexingConcurrency);
    if (useCloud) {
      const localDurationByPath = new Map();
      for (const row of localRowsForCloud) {
        const rowPath = String(row?.path || row?.image_path || "").trim();
        if (!rowPath) {
          continue;
        }

        const seconds = Number(
          row?.local_metadata?.video_info?.duration_seconds
          ?? row?.local_metadata?.content_hints?.duration_seconds
          ?? row?.filtering?.duration_seconds,
        );
        if (Number.isFinite(seconds) && seconds > 0) {
          localDurationByPath.set(rowPath, seconds);
        }
      }

      const imageTargets = [];
      const videoTargets = [];
      for (const imagePath of targets) {
        const mediaType = getMediaTypeFromPath(imagePath, "image");
        if (mediaType === "video") {
          videoTargets.push({
            path: imagePath,
            durationSeconds: resolveRepresentativeVideoDurationSeconds(imagePath, localDurationByPath),
          });
        } else {
          imageTargets.push(imagePath);
        }
      }

      const imageBatches = chunkArray(imageTargets, indexingConcurrency);

      const videoBuckets = new Map();
      for (const row of videoTargets) {
        const bucketKey = getVideoDurationBatchKey(row.durationSeconds);
        if (!videoBuckets.has(bucketKey)) {
          videoBuckets.set(bucketKey, []);
        }
        videoBuckets.get(bucketKey).push(row);
      }

      const orderedVideoBucketKeys = Array.from(videoBuckets.keys()).sort();
      const videoBatches = [];
      for (const bucketKey of orderedVideoBucketKeys) {
        const bucketRows = videoBuckets.get(bucketKey) || [];
        bucketRows.sort((a, b) => {
          const aDuration = Number(a?.durationSeconds);
          const bDuration = Number(b?.durationSeconds);
          const safeA = Number.isFinite(aDuration) ? aDuration : Number.POSITIVE_INFINITY;
          const safeB = Number.isFinite(bDuration) ? bDuration : Number.POSITIVE_INFINITY;
          return safeA - safeB;
        });
        const chunked = chunkArray(bucketRows.map((row) => row.path), indexingConcurrency);
        videoBatches.push(...chunked);
      }

      executionBatches = [...imageBatches, ...videoBatches];
      sendToRenderer("index-log", {
        message: `Cloud batching strategy: ${imageTargets.length} image representative(s) in image-only batches and ${videoTargets.length} video representative(s) in duration-grouped video-only batches.`,
      });
    }

    const targetIndexByPath = new Map(targets.map((row, idx) => [row, idx]));

    async function processSingleTarget(imagePath, targetIndex) {
      const activeCloudGroup = useCloud
        ? (cloudGroupByRepresentative.get(imagePath) || {
          members: [imagePath],
        })
        : null;
      const groupMemberPaths = useCloud
        ? (Array.isArray(activeCloudGroup?.members) && activeCloudGroup.members.length > 0
          ? activeCloudGroup.members
          : [imagePath])
        : [imagePath];

      const mediaType = getMediaTypeFromPath(imagePath, "image");
      let metadata = makeMetadataForMedia(imagePath, mediaType);
      let embedding = [];
      let status = "ok";
      let errorMessage = "";
      let localMetadata = null;
      const imageId = idByPath.get(imagePath) ?? targetIndex + 1;
      const producedRows = [];

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
            producedRows.push({
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
              media_type: mediaType,
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
          producedRows.push({
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
            producedRows.push({
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

          producedRows.push({
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

      return {
        imagePath,
        status,
        errorMessage,
        groupMemberPaths,
        producedRows,
        processedCount: useCloud ? groupMemberPaths.length : 1,
      };
    }

    let cancelledDuringLoop = false;
    let announcedTargetCount = 0;
    for (const batch of executionBatches) {
      if (indexState.cancelled) {
        cancelledDuringLoop = true;
        break;
      }

      await waitWhilePaused(indexState);
      if (indexState.cancelled) {
        cancelledDuringLoop = true;
        break;
      }

      for (let b = 0; b < batch.length; b += 1) {
        const imagePath = batch[b];
        announcedTargetCount += 1;
        const batchIndex = announcedTargetCount - 1;
        const activeCloudGroup = useCloud
          ? (cloudGroupByRepresentative.get(imagePath) || {
            members: [imagePath],
          })
          : null;
        const groupSize = useCloud
          ? ((Array.isArray(activeCloudGroup?.members) && activeCloudGroup.members.length > 0)
            ? activeCloudGroup.members.length
            : 1)
          : 1;

        sendToRenderer("index-log", {
          message: useCloud
            ? `Processing representative ${batchIndex + 1}/${targets.length}: ${path.basename(imagePath)} (${groupSize} group item${groupSize === 1 ? "" : "s"})`
            : `Processing ${batchIndex + 1}/${targets.length}: ${path.basename(imagePath)}`,
        });
      }

      const settled = await Promise.allSettled(
        batch.map((imagePath) => processSingleTarget(imagePath, targetIndexByPath.get(imagePath) ?? 0)),
      );

      for (const item of settled) {
        const task = item.status === "fulfilled"
          ? item.value
          : {
            imagePath: "",
            status: "failed",
            errorMessage: String(item.reason?.message || item.reason || "Unknown error"),
            groupMemberPaths: [],
            producedRows: [],
            processedCount: 0,
          };

        if (Array.isArray(task.producedRows) && task.producedRows.length > 0) {
          results.push(...task.producedRows);
        }

        if (task.status === "ok") {
          success += Number(task.processedCount || 0);
        } else {
          failed += Number(task.processedCount || 0);
          for (const memberPath of task.groupMemberPaths) {
            failures.push({ path: memberPath, message: task.errorMessage });
          }
        }

        processedWorkItems += Number(task.processedCount || 0);

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
          current: task.imagePath || "",
          success,
          failed,
        });
      }
    }

    if (cancelledDuringLoop) {
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
  // Periodic memory usage logging for debugging OOM
  setInterval(() => {
    try {
      const mem = process.memoryUsage();
      const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1);
      console.log(`[snoolink-lens] Heap: ${mb(mem.heapUsed)} MB / ${mb(mem.heapTotal)} MB | RSS: ${mb(mem.rss)} MB | External: ${mb(mem.external)} MB`);
    } catch {}
  }, 15000);
  await ensureEnvFileExists();
  const envSettings = await readEnvSettings();
  process.env.AWS_REGION = String(envSettings.aws_region || "us-east-1");
  process.env.AWS_ACCESS_KEY_ID = String(envSettings.aws_key || "");
  process.env.AWS_SECRET_ACCESS_KEY = String(envSettings.secret_key || "");
  process.env.TWELVELABS_API_KEY = String(envSettings.twelvelabs_api_key || "");
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
