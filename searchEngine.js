import fs from "node:fs/promises";
import path from "node:path";
import { expandQuery, matchesExpandedIntent } from "./query_expander.js";
import { getMediaTypeFromPath } from "./previewVideo.js";

const inMemoryIndex = new Map();
const jsonPayloadCache = new Map();
const validationCache = new Map();
const DEFAULT_FRAME_INTERVAL_SECONDS = 1;
const DERIVED_INDEX_CACHE_VERSION = 2;
const DERIVED_INDEX_SHARD_SIZE = 1000;
const DERIVED_INDEX_DIR_NAME = ".snoolink-search-cache";
const MAX_SAFE_TOPK = 200;
const MAX_JSON_PAYLOAD_CACHE_FILE_BYTES = 64 * 1024 * 1024;
const MAX_COMPACT_DOC_TEXT_CHARS = 2400;
const MAX_COMPACT_TAGS = 24;
const MAX_COMPACT_CANDIDATE_POOL = 4000;
const COMPACT_BATCH_MIN_SCORE = 0.001;
const MAX_COMPACT_VIDEO_FRAMES = 140;
const MAX_COMPACT_FRAME_TEXT_CHARS = 420;
const MAX_TIMEFRAME_CLIPS_PER_VIDEO = 12;
const MAX_TIMEFRAME_CLIP_POOL = 2500;
const MAX_TIMEFRAME_SOURCE_ITEMS = 800;

async function resolveMetadataPath(filePath) {
  const rawPath = String(filePath || "").trim();
  if (!rawPath) {
    throw new Error("Metadata file path is required.");
  }

  const resolvedPath = path.isAbsolute(rawPath) ? rawPath : path.resolve(process.cwd(), rawPath);
  const stats = await fs.stat(resolvedPath);

  if (!stats.isFile()) {
    throw new Error("Metadata path must point to a JSON file.");
  }

  if (path.extname(resolvedPath).toLowerCase() !== ".json") {
    throw new Error("Please select a .json metadata file.");
  }

  return { resolvedPath, stats };
}

function safeArray(value) {
  return Array.isArray(value) ? value.map((v) => String(v)) : [];
}

function normalizeRecord(record) {
  if (!record || typeof record !== "object") {
    return null;
  }

  const status = String(record.status || "unknown");
  const pathValue = String(record.path || record.image_path || "").trim();
  const metadataFromRecord = record.metadata && typeof record.metadata === "object" ? record.metadata : null;

  if (metadataFromRecord) {
    return {
      id: record.id,
      status,
      path: pathValue,
      metadata: metadataFromRecord,
      raw: record,
    };
  }

  // Cloud-only row shape: derive searchable metadata from description/OCR.
  const cloudDescription = String(record.description || "").trim();
  const ocrAllText = String(record?.ocr?.all_text || "").trim();
  const sceneTags = Array.isArray(record?.sceneTags) ? record.sceneTags.map((v) => String(v || "")).filter(Boolean) : [];
  const objectTags = Array.isArray(record?.objectTags) ? record.objectTags.map((v) => String(v || "")).filter(Boolean) : [];
  const activityTags = Array.isArray(record?.activityTags) ? record.activityTags.map((v) => String(v || "")).filter(Boolean) : [];
  const derivedMetadata = {
    title: pathValue ? path.basename(pathValue) : "Untitled image",
    description: cloudDescription,
    tags: Array.from(new Set([...sceneTags, ...objectTags, ...activityTags])),
    objects: objectTags,
    style: "cloud",
    dominant_colors: [],
    contains_people: null,
    contains_text: Boolean(ocrAllText),
  };

  return {
    id: record.id,
    status,
    path: pathValue,
    metadata: derivedMetadata,
    raw: record,
  };
}

// --- TF-IDF helpers ---

function tokenize(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
}

function buildTermFrequency(tokens) {
  const tf = new Map();
  for (const token of tokens) {
    tf.set(token, (tf.get(token) || 0) + 1);
  }
  return tf;
}

function buildSparseTfIdfCorpus(docs) {
  const docTokens = docs.map(tokenize);
  const docCount = docTokens.length;
  const docTermFreqs = docTokens.map((tokens) => buildTermFrequency(tokens));

  // Document frequency: how many docs contain each term.
  const df = new Map();
  for (const tokens of docTokens) {
    const seen = new Set(tokens);
    for (const token of seen) {
      df.set(token, (df.get(token) || 0) + 1);
    }
  }

  const idfByTerm = new Map();
  for (const [term, freq] of df) {
    idfByTerm.set(term, Math.log(docCount / Math.max(1, freq)));
  }

  const docNorms = docTermFreqs.map((tf) => {
    let sumSquares = 0;
    for (const [term, count] of tf) {
      const idf = Number(idfByTerm.get(term) || 0);
      const weight = count * idf;
      sumSquares += weight * weight;
    }
    return Math.sqrt(sumSquares);
  });

  return {
    docTermFreqs,
    idfByTerm,
    docNorms,
  };
}

function buildSparseQueryVector(query, idfByTerm) {
  const tokens = tokenize(query);
  const tf = buildTermFrequency(tokens);
  const weights = new Map();
  let sumSquares = 0;

  for (const [term, count] of tf) {
    const idf = Number(idfByTerm.get(term) || 0);
    if (idf <= 0) {
      continue;
    }
    const weight = count * idf;
    weights.set(term, weight);
    sumSquares += weight * weight;
  }

  return {
    weights,
    norm: Math.sqrt(sumSquares),
  };
}

function cosineSimilaritySparse(queryVector, docTf, idfByTerm, docNorm) {
  const qNorm = Number(queryVector?.norm || 0);
  const dNorm = Number(docNorm || 0);
  if (qNorm <= 0 || dNorm <= 0) {
    return 0;
  }

  let dot = 0;
  for (const [term, qWeight] of queryVector.weights) {
    const docCount = Number(docTf.get(term) || 0);
    if (docCount <= 0) {
      continue;
    }
    const idf = Number(idfByTerm.get(term) || 0);
    const dWeight = docCount * idf;
    dot += qWeight * dWeight;
  }

  return dot / (qNorm * dNorm);
}

function buildCharNgrams(text, n = 3) {
  const normalized = String(text || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!normalized) {
    return new Set();
  }

  const padded = ` ${normalized} `;
  const grams = new Set();
  for (let i = 0; i <= padded.length - n; i += 1) {
    grams.add(padded.slice(i, i + n));
  }
  return grams;
}

function jaccardSimilarity(setA, setB) {
  if (setA.size === 0 || setB.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const value of setA) {
    if (setB.has(value)) {
      intersection += 1;
    }
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function tokenOverlapScore(queryTokens, docTokenSet) {
  if (queryTokens.length === 0) {
    return 0;
  }

  let hit = 0;
  for (const token of queryTokens) {
    if (docTokenSet.has(token)) {
      hit += 1;
    }
  }
  return hit / queryTokens.length;
}

function phraseCoverageScore(requiredPhrases, docText) {
  const phrases = Array.isArray(requiredPhrases)
    ? requiredPhrases.map((v) => String(v || "").toLowerCase().trim()).filter(Boolean)
    : [];

  if (phrases.length === 0) {
    return 0;
  }

  let matched = 0;
  for (const phrase of phrases) {
    if (docText.includes(phrase)) {
      matched += 1;
    }
  }
  return matched / phrases.length;
}

function combineScore(parts) {
  const semantic = Math.max(0, Math.min(1, Number(parts.semantic || 0)));
  const lexical = Math.max(0, Math.min(1, Number(parts.lexical || 0)));
  const fuzzy = Math.max(0, Math.min(1, Number(parts.fuzzy || 0)));
  const phrase = Math.max(0, Math.min(1, Number(parts.phrase || 0)));

  return (semantic * 0.62) + (lexical * 0.23) + (fuzzy * 0.1) + (phrase * 0.05);
}

function normalizeVideoResultMode(value) {
  return String(value || "").trim().toLowerCase() === "matching_timeframes"
    ? "matching_timeframes"
    : "full_video";
}

function toPreviewSrc(filePath) {
  return `file:///${String(filePath || "").replaceAll("\\", "/")}`;
}

function safeNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function getVideoAnalysisPayload(item) {
  const compactVideo = item?.metadata?.video_analysis_compact;
  if (compactVideo && typeof compactVideo === "object") {
    return compactVideo;
  }
  const rawVideo = item?.raw?.video_analysis;
  if (rawVideo && typeof rawVideo === "object") {
    return rawVideo;
  }
  const metaVideo = item?.metadata?.video_analysis;
  if (metaVideo && typeof metaVideo === "object") {
    return metaVideo;
  }
  return {};
}

function buildFrameText(frame) {
  const parts = [
    String(frame?.text || ""),
    String(frame?.description || ""),
    ...(Array.isArray(frame?.sceneTags) ? frame.sceneTags : []),
    ...(Array.isArray(frame?.scene_tags) ? frame.scene_tags : []),
    ...(Array.isArray(frame?.objectTags) ? frame.objectTags : []),
    ...(Array.isArray(frame?.object_tags) ? frame.object_tags : []),
    ...(Array.isArray(frame?.activityTags) ? frame.activityTags : []),
    ...(Array.isArray(frame?.activity_tags) ? frame.activity_tags : []),
    String(frame?.ocr?.all_text || ""),
    String(frame?.ocr_all_text || ""),
    String(frame?.ocr_text || ""),
  ];
  return parts.map((value) => String(value || "").trim()).filter(Boolean).join(" ");
}

function downsampleFrameCandidates(candidates, maxFrames = MAX_COMPACT_VIDEO_FRAMES) {
  const rows = Array.isArray(candidates) ? candidates : [];
  if (rows.length <= maxFrames) {
    return rows;
  }

  const sampled = [];
  const denominator = Math.max(1, maxFrames - 1);
  for (let i = 0; i < maxFrames; i += 1) {
    const index = Math.round((i * (rows.length - 1)) / denominator);
    sampled.push(rows[index]);
  }
  return sampled;
}

function buildCompactVideoAnalysis(item) {
  const mediaType = String(item?.metadata?.media_type || getMediaTypeFromPath(item?.path || "", "image")).toLowerCase();
  if (mediaType !== "video") {
    return null;
  }

  const videoAnalysis = getVideoAnalysisPayload(item);
  const durationSeconds = safeNumber(videoAnalysis?.duration_seconds);
  const frameIntervalSeconds = normalizeFrameIntervalSeconds(videoAnalysis?.frame_interval_seconds, durationSeconds);
  const frameCandidates = downsampleFrameCandidates(collectVideoFrameCandidates(item), MAX_COMPACT_VIDEO_FRAMES)
    .map((frame) => ({
      second: Number(Number(frame?.second || 0).toFixed(3)),
      text: clampCompactText(frame?.text, MAX_COMPACT_FRAME_TEXT_CHARS),
      description: clampCompactText(frame?.description, 200),
    }))
    .filter((frame) => Number.isFinite(frame.second) && frame.second >= 0 && frame.text);

  return {
    duration_seconds: durationSeconds,
    frame_interval_seconds: frameIntervalSeconds,
    frames: frameCandidates,
  };
}

function collectVideoFrameCandidates(item) {
  const videoAnalysis = getVideoAnalysisPayload(item);
  const frames = [
    ...(Array.isArray(videoAnalysis?.frames) ? videoAnalysis.frames : []),
    ...(Array.isArray(videoAnalysis?.frame_analyses) ? videoAnalysis.frame_analyses : []),
  ];

  const candidates = [];
  for (const frame of frames) {
    const second = safeNumber(frame?.second ?? frame?.timestamp_seconds ?? frame?.timestamp);
    if (!Number.isFinite(second) || second < 0) {
      continue;
    }
    const frameText = buildFrameText(frame);
    if (!frameText) {
      continue;
    }

    candidates.push({
      second,
      text: frameText,
      description: String(frame?.description || "").trim(),
    });
  }

  const bySecond = new Map();
  for (const candidate of candidates) {
    const key = Number(candidate.second.toFixed(3));
    if (!bySecond.has(key) || bySecond.get(key).text.length < candidate.text.length) {
      bySecond.set(key, candidate);
    }
  }
  return Array.from(bySecond.values()).sort((a, b) => a.second - b.second);
}

function pickFrameIntervalSeconds(durationSeconds) {
  const duration = Number(durationSeconds);
  if (!Number.isFinite(duration) || duration <= 0) {
    return DEFAULT_FRAME_INTERVAL_SECONDS;
  }

  if (duration < 6) {
    return 2;
  }
  if (duration < 15) {
    return 3;
  }
  if (duration < 30) {
    return 4;
  }
  if (duration < 60) {
    return 5;
  }

  return 10;
}

function normalizeFrameIntervalSeconds(frameIntervalSeconds, durationSeconds) {
  const explicit = Number(frameIntervalSeconds);
  if (Number.isFinite(explicit) && explicit > 0) {
    return explicit;
  }
  return pickFrameIntervalSeconds(durationSeconds);
}

function buildTimeframeWindow(frameSecond, frameIntervalSeconds, durationSeconds) {
  const interval = normalizeFrameIntervalSeconds(frameIntervalSeconds, durationSeconds);
  const duration = Number(durationSeconds);

  const safeSecond = Math.max(0, Number(frameSecond) || 0);
  const bucketIndex = Math.floor(safeSecond / interval);
  const start = bucketIndex * interval;
  let end = start + interval;
  if (Number.isFinite(duration) && duration > 0) {
    end = Math.min(end, duration);
  }
  if (end <= start) {
    end = start + interval;
  }

  return {
    start: Number(start.toFixed(3)),
    end: Number(end.toFixed(3)),
  };
}

function scoreFrameMatch(frameText, expandedTokens, queryTrigrams, expandedTrigrams, requiredPhrases) {
  const text = String(frameText || "").toLowerCase();
  if (!text) {
    return 0;
  }

  const lexical = tokenOverlapScore(expandedTokens, new Set(tokenize(text)));
  const frameTrigrams = buildCharNgrams(text, 3);
  const fuzzy = Math.max(
    jaccardSimilarity(queryTrigrams, frameTrigrams),
    jaccardSimilarity(expandedTrigrams, frameTrigrams) * 0.95,
  );
  const phrase = phraseCoverageScore(requiredPhrases, text);

  return (lexical * 0.62) + (fuzzy * 0.28) + (phrase * 0.1);
}

function toScoreNumber(value) {
  const score = Number(value);
  return Number.isFinite(score) ? score : 0;
}

function limitClipWindowsPerVideo(clipsByWindow, perVideoLimit) {
  const rows = clipsByWindow instanceof Map ? Array.from(clipsByWindow.values()) : [];
  if (rows.length <= perVideoLimit) {
    return rows;
  }
  rows.sort((a, b) => toScoreNumber(b?.score) - toScoreNumber(a?.score));
  return rows.slice(0, perVideoLimit);
}

function appendClipCandidatesWithCap(pool, nextRows, poolLimit) {
  if (!Array.isArray(pool) || !Array.isArray(nextRows) || nextRows.length === 0) {
    return;
  }

  pool.push(...nextRows);
  if (pool.length > poolLimit) {
    pool.sort((a, b) => toScoreNumber(b?.score) - toScoreNumber(a?.score));
    pool.length = poolLimit;
  }
}

function extractCloudTagCandidates(item) {
  const metadata = item?.metadata || {};
  const raw = item?.raw || {};
  const videoAnalysis = raw?.video_analysis && typeof raw.video_analysis === "object" ? raw.video_analysis : {};

  const values = [
    ...(Array.isArray(metadata?.tags) ? metadata.tags : []),
    ...(Array.isArray(metadata?.objects) ? metadata.objects : []),
    ...(Array.isArray(metadata?.scene_tags) ? metadata.scene_tags : []),
    ...(Array.isArray(metadata?.object_tags) ? metadata.object_tags : []),
    ...(Array.isArray(metadata?.activity_tags) ? metadata.activity_tags : []),
    ...(Array.isArray(raw?.sceneTags) ? raw.sceneTags : []),
    ...(Array.isArray(raw?.objectTags) ? raw.objectTags : []),
    ...(Array.isArray(raw?.activityTags) ? raw.activityTags : []),
    ...(Array.isArray(videoAnalysis?.sceneTags) ? videoAnalysis.sceneTags : []),
    ...(Array.isArray(videoAnalysis?.objectTags) ? videoAnalysis.objectTags : []),
    ...(Array.isArray(videoAnalysis?.activityTags) ? videoAnalysis.activityTags : []),
  ];

  return Array.from(new Set(
    values
      .map((value) => String(value || "").trim().toLowerCase())
      .filter(Boolean),
  ));
}

function normalizeFilterTagList(value) {
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

function computeDirectTagMatchBonus(queryText, item) {
  const query = String(queryText || "").trim().toLowerCase();
  if (!query) {
    return 0;
  }

  const tags = extractCloudTagCandidates(item);
  if (tags.length === 0) {
    return 0;
  }

  const queryTokens = new Set(tokenize(query));
  let bonus = 0;

  for (const tag of tags) {
    if (!tag) {
      continue;
    }
    if (query.includes(tag)) {
      bonus += 0.06;
      continue;
    }

    const tagTokens = tokenize(tag);
    if (tagTokens.length === 0) {
      continue;
    }
    const overlap = tagTokens.filter((token) => queryTokens.has(token)).length;
    if (overlap > 0) {
      bonus += 0.015 * overlap;
    }
  }

  return Math.min(0.25, bonus);
}

// --- File / cache helpers ---

async function readJsonFile(filePath) {
  const text = await fs.readFile(filePath, "utf-8");
  return JSON.parse(text);
}

function getMemoKey(filePath, stats, mode = "full") {
  return `${filePath}:${stats.size}:${stats.mtimeMs}:${mode}`;
}

function getSourceFingerprint(stats) {
  return `${stats.size}:${Math.round(stats.mtimeMs)}`;
}

function getDerivedCacheDir(metadataPath) {
  const sourceName = path.basename(metadataPath, path.extname(metadataPath));
  return path.join(path.dirname(metadataPath), DERIVED_INDEX_DIR_NAME, sourceName);
}

function getDerivedManifestPath(metadataPath) {
  return path.join(getDerivedCacheDir(metadataPath), "manifest.json");
}

function getDerivedShardPath(metadataPath, shardIndex) {
  const shardLabel = String(shardIndex + 1).padStart(5, "0");
  return path.join(getDerivedCacheDir(metadataPath), `items-${shardLabel}.ndjson`);
}

async function readJsonSafe(filePath) {
  try {
    const text = await fs.readFile(filePath, "utf-8");
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function readNdjsonFile(filePath) {
  const rows = [];
  const text = await fs.readFile(filePath, "utf-8");
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = String(line || "").trim();
    if (!trimmed) {
      continue;
    }
    try {
      rows.push(JSON.parse(trimmed));
    } catch {
      // Ignore malformed lines and continue reading healthy entries.
    }
  }
  return rows;
}

async function cleanupDerivedShardFiles(metadataPath) {
  const cacheDir = getDerivedCacheDir(metadataPath);
  let entries = [];
  try {
    entries = await fs.readdir(cacheDir, { withFileTypes: true });
  } catch {
    return;
  }

  const deletions = [];
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    if (!entry.name.toLowerCase().endsWith(".ndjson")) {
      continue;
    }
    deletions.push(fs.unlink(path.join(cacheDir, entry.name)).catch(() => {}));
  }
  await Promise.all(deletions);
}

async function getJsonPayload(filePath, stats, options = {}) {
  const allowCache = options?.allowCache !== false && Number(stats?.size || 0) <= MAX_JSON_PAYLOAD_CACHE_FILE_BYTES;
  const memoKey = getMemoKey(filePath, stats);
  if (allowCache && jsonPayloadCache.has(memoKey)) {
    return { memoKey, payload: jsonPayloadCache.get(memoKey) };
  }

  const payload = await readJsonFile(filePath);
  if (allowCache) {
    jsonPayloadCache.clear();
    jsonPayloadCache.set(memoKey, payload);
  }
  return { memoKey, payload };
}

function toDocText(record) {
  const m = record.metadata || {};
  const title = String(m.title || "");
  const description = String(m.description || "");
  const tags = safeArray(m.tags).join(" ");
  const objects = safeArray(m.objects).join(" ");
  const style = String(m.style || "");
  const colors = safeArray(m.dominant_colors).join(" ");

  const cloudDescription = String(record?.raw?.description || "");
  const cloudOcr = extractOcrCorpusText(record);

  return [title, description, tags, objects, style, colors, cloudDescription, cloudOcr].join(" ");
}

function clampCompactText(value, maxChars = MAX_COMPACT_DOC_TEXT_CHARS) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  if (text.length <= maxChars) {
    return text;
  }
  return text.slice(0, maxChars);
}

function toCompactCacheRow(item, docText) {
  const metadata = item?.metadata && typeof item.metadata === "object" ? item.metadata : {};
  const compactVideoAnalysis = buildCompactVideoAnalysis(item);
  return {
    id: item?.id ?? null,
    path: String(item?.path || ""),
    metadata: {
      ...metadata,
      title: clampCompactText(metadata?.title, 220),
      description: clampCompactText(metadata?.description, 1200),
      tags: Array.isArray(metadata?.tags)
        ? metadata.tags.slice(0, MAX_COMPACT_TAGS).map((value) => clampCompactText(value, 80)).filter(Boolean)
        : [],
      objects: Array.isArray(metadata?.objects)
        ? metadata.objects.slice(0, MAX_COMPACT_TAGS).map((value) => clampCompactText(value, 80)).filter(Boolean)
        : [],
      video_analysis_compact: compactVideoAnalysis,
    },
    doc: clampCompactText(docText, MAX_COMPACT_DOC_TEXT_CHARS),
  };
}

async function loadCompactRowsFromCache(metadataPath, sourceFingerprint) {
  const manifestPath = getDerivedManifestPath(metadataPath);
  const manifest = await readJsonSafe(manifestPath);
  if (!manifest || typeof manifest !== "object") {
    return null;
  }

  if (Number(manifest.version) !== DERIVED_INDEX_CACHE_VERSION) {
    return null;
  }
  if (String(manifest.sourceFingerprint || "") !== String(sourceFingerprint || "")) {
    return null;
  }

  const shardCount = Number(manifest.shardCount || 0);
  if (!Number.isInteger(shardCount) || shardCount < 0) {
    return null;
  }
  if (shardCount === 0) {
    return [];
  }

  const rows = [];
  for (let i = 0; i < shardCount; i += 1) {
    const shardPath = getDerivedShardPath(metadataPath, i);
    try {
      const shardRows = await readNdjsonFile(shardPath);
      for (const shardRow of shardRows) {
        if (!shardRow || typeof shardRow !== "object") {
          continue;
        }
        const itemPath = String(shardRow.path || "").trim();
        if (!itemPath) {
          continue;
        }
        rows.push({
          id: shardRow.id,
          path: itemPath,
          metadata: shardRow.metadata && typeof shardRow.metadata === "object" ? shardRow.metadata : {},
          doc: String(shardRow.doc || ""),
        });
      }
    } catch {
      return null;
    }
  }

  return rows;
}

async function buildCompactRowsFromPayload(metadataPath, sourceFingerprint, payload) {
  const rawResults = Array.isArray(payload?.results) ? payload.results : [];
  const items = rawResults
    .map((row) => normalizeRecord(row))
    .filter((row) => row && row.status === "ok" && row.path);
  const docs = items.map((item) => toDocText(item));
  const compactRows = items.map((item, idx) => toCompactCacheRow(item, docs[idx]));

  const cacheDir = getDerivedCacheDir(metadataPath);
  await fs.mkdir(cacheDir, { recursive: true });
  await cleanupDerivedShardFiles(metadataPath);

  let shardCount = 0;
  for (let offset = 0; offset < compactRows.length; offset += DERIVED_INDEX_SHARD_SIZE) {
    const shardRows = compactRows.slice(offset, offset + DERIVED_INDEX_SHARD_SIZE);
    if (shardRows.length === 0) {
      continue;
    }
    const shardPath = getDerivedShardPath(metadataPath, shardCount);
    const content = `${shardRows.map((row) => JSON.stringify(row)).join("\n")}\n`;
    await fs.writeFile(shardPath, content, "utf-8");
    shardCount += 1;
  }

  const manifest = {
    version: DERIVED_INDEX_CACHE_VERSION,
    sourcePath: metadataPath,
    sourceFingerprint,
    shardSize: DERIVED_INDEX_SHARD_SIZE,
    shardCount,
    total: compactRows.length,
    generatedAt: new Date().toISOString(),
  };
  await fs.writeFile(getDerivedManifestPath(metadataPath), JSON.stringify(manifest, null, 2), "utf-8");

  return compactRows;
}

async function readCompactCacheManifest(metadataPath, sourceFingerprint) {
  const manifestPath = getDerivedManifestPath(metadataPath);
  const manifest = await readJsonSafe(manifestPath);
  if (!manifest || typeof manifest !== "object") {
    return null;
  }
  if (Number(manifest.version) !== DERIVED_INDEX_CACHE_VERSION) {
    return null;
  }
  if (String(manifest.sourceFingerprint || "") !== String(sourceFingerprint || "")) {
    return null;
  }
  const shardCount = Number(manifest.shardCount || 0);
  if (!Number.isInteger(shardCount) || shardCount < 0) {
    return null;
  }
  return {
    ...manifest,
    shardCount,
  };
}

async function ensureCompactCacheManifest(metadataPath, stats, sourceFingerprint) {
  let manifest = await readCompactCacheManifest(metadataPath, sourceFingerprint);
  if (manifest) {
    return manifest;
  }

  const { payload } = await getJsonPayload(metadataPath, stats, { allowCache: false });
  await buildCompactRowsFromPayload(metadataPath, sourceFingerprint, payload);
  jsonPayloadCache.clear();
  manifest = await readCompactCacheManifest(metadataPath, sourceFingerprint);
  if (!manifest) {
    throw new Error("Failed to initialize compact search cache.");
  }
  return manifest;
}

function getCompactFilterValue(metadata, key, fallback = "") {
  const value = metadata?.[key];
  if (value == null) {
    return String(fallback || "").toLowerCase();
  }
  return String(value || "").toLowerCase();
}

function toCompactFilterTagSet(metadata, key) {
  const list = Array.isArray(metadata?.[key]) ? metadata[key] : [];
  return new Set(list.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean));
}

function compactRowMatchesFilters(row, filters, allowedImagePathSet) {
  const itemPath = String(row?.path || "").trim();
  if (!itemPath) {
    return false;
  }
  if (allowedImagePathSet && !allowedImagePathSet.has(itemPath)) {
    return false;
  }

  const activeFilters = filters && typeof filters === "object" ? filters : {};
  const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const mediaType = String(metadata?.media_type || getMediaTypeFromPath(itemPath, "image")).toLowerCase();
  const styleValue = getCompactFilterValue(metadata, "style");
  const orientationValue = getCompactFilterValue(metadata, "orientation");
  const brightnessValue = getCompactFilterValue(metadata, "brightness_category");
  const resolutionMegapixelsValue = getCompactFilterValue(metadata, "resolution_megapixels");
  const aspectRatioValue = getCompactFilterValue(metadata, "aspect_ratio");
  const fileTypeValue = String(path.extname(itemPath).replace(".", "")).toLowerCase();
  const durationBucketValue = getCompactFilterValue(metadata, "duration_bucket");
  const fpsLabelValue = getCompactFilterValue(metadata, "fps_label");
  const hasAudioValue = getCompactFilterValue(metadata, "has_audio", "");
  const audioTypeValue = getCompactFilterValue(metadata, "audio_type");
  const hasCaptionsValue = getCompactFilterValue(metadata, "has_captions", "");
  const motionLevelValue = getCompactFilterValue(metadata, "motion_level");
  const containsPeople = metadata?.contains_people === true;
  const containsText = metadata?.contains_text === true;
  const tagsSet = toCompactFilterTagSet(metadata, "tags");
  const objectsSet = toCompactFilterTagSet(metadata, "objects");
  const docLower = String(row?.doc || "").toLowerCase();
  const ocrTerms = splitOcrQueryTerms(activeFilters?.ocrTextQuery);

  const mediaTypeFilter = String(activeFilters?.mediaType || "any").toLowerCase();
  if (mediaTypeFilter !== "any" && mediaType !== mediaTypeFilter) {
    return false;
  }

  const containsPeopleFilter = String(activeFilters?.containsPeople || "any").toLowerCase();
  if (containsPeopleFilter === "yes" && !containsPeople) {
    return false;
  }
  if (containsPeopleFilter === "no" && containsPeople) {
    return false;
  }

  const containsTextFilter = String(activeFilters?.containsText || "any").toLowerCase();
  if (containsTextFilter === "yes" && !containsText) {
    return false;
  }
  if (containsTextFilter === "no" && containsText) {
    return false;
  }

  const simpleEnumChecks = [
    ["style", styleValue],
    ["orientation", orientationValue],
    ["brightnessCategory", brightnessValue],
    ["resolutionMegapixels", resolutionMegapixelsValue],
    ["aspectRatio", aspectRatioValue],
    ["fileType", fileTypeValue],
    ["durationBucket", durationBucketValue],
    ["fpsLabel", fpsLabelValue],
    ["hasAudio", hasAudioValue],
    ["audioType", audioTypeValue],
    ["hasCaptions", hasCaptionsValue],
    ["motionLevel", motionLevelValue],
  ];

  for (const [key, value] of simpleEnumChecks) {
    const filterValue = String(activeFilters?.[key] || "any").toLowerCase();
    if (filterValue !== "any" && filterValue && value !== filterValue) {
      return false;
    }
  }

  const sceneValues = Array.isArray(activeFilters?.sceneTag) ? activeFilters.sceneTag : [activeFilters?.sceneTag];
  const sceneSelected = sceneValues.map((value) => String(value || "").toLowerCase().trim()).filter((value) => value && value !== "any");
  if (sceneSelected.length > 0 && !sceneSelected.some((value) => tagsSet.has(value))) {
    return false;
  }

  const objectValues = Array.isArray(activeFilters?.objectTag) ? activeFilters.objectTag : [activeFilters?.objectTag];
  const objectSelected = objectValues.map((value) => String(value || "").toLowerCase().trim()).filter((value) => value && value !== "any");
  if (objectSelected.length > 0 && !objectSelected.some((value) => objectsSet.has(value) || tagsSet.has(value))) {
    return false;
  }

  const activityValues = Array.isArray(activeFilters?.activityTag) ? activeFilters.activityTag : [activeFilters?.activityTag];
  const activitySelected = activityValues.map((value) => String(value || "").toLowerCase().trim()).filter((value) => value && value !== "any");
  if (activitySelected.length > 0 && !activitySelected.some((value) => tagsSet.has(value))) {
    return false;
  }

  if (ocrTerms.length > 0 && !hasExactOcrTermMatch(docLower, ocrTerms)) {
    return false;
  }

  return true;
}

function scoreCompactRow(row, queryTokens, queryTrigrams, expandedTrigrams, requiredPhrases) {
  const docText = String(row?.doc || "").toLowerCase();
  if (!docText) {
    return 0;
  }

  const docTokenSet = new Set(tokenize(docText));
  const lexical = tokenOverlapScore(queryTokens, docTokenSet);
  const docTrigrams = buildCharNgrams(docText, 3);
  const fuzzy = Math.max(
    jaccardSimilarity(queryTrigrams, docTrigrams),
    jaccardSimilarity(expandedTrigrams, docTrigrams) * 0.95,
  );
  const phrase = phraseCoverageScore(requiredPhrases, docText);

  return combineScore({
    semantic: lexical,
    lexical,
    fuzzy,
    phrase,
  });
}

async function runCompactBatchedSearch(payload, context) {
  const query = String(payload?.query || "").trim();
  const topK = Math.max(1, Math.min(Number(payload?.topK || 20), MAX_SAFE_TOPK));
  const minScoreInput = Number(payload?.minScore);
  const minScore = Number.isFinite(minScoreInput) ? Math.max(0, minScoreInput) : COMPACT_BATCH_MIN_SCORE;
  const filters = payload?.filters && typeof payload.filters === "object" ? payload.filters : {};
  const allowedImagePathSet = Array.isArray(payload?.allowedImagePaths)
    ? new Set(payload.allowedImagePaths.map((value) => String(value || "").trim()).filter(Boolean))
    : null;

  const expanded = await expandQuery(query);
  const expandedTokens = tokenize(expanded.expandedQuery);
  const queryTrigrams = buildCharNgrams(query, 3);
  const expandedTrigrams = expanded.changed
    ? buildCharNgrams(expanded.expandedQuery, 3)
    : queryTrigrams;
  const requiredPhrases = expanded?.intent?.required_phrases;
  const candidatePoolLimit = Math.max(topK * 20, Math.min(MAX_COMPACT_CANDIDATE_POOL, topK * 80));

  const manifest = await ensureCompactCacheManifest(context.resolvedPath, context.stats, context.sourceFingerprint);
  let filteredCount = 0;
  const fallback = [];
  let candidates = [];

  for (let shardIndex = 0; shardIndex < manifest.shardCount; shardIndex += 1) {
    const shardPath = getDerivedShardPath(context.resolvedPath, shardIndex);
    const shardRows = await readNdjsonFile(shardPath);
    for (const row of shardRows) {
      if (!compactRowMatchesFilters(row, filters, allowedImagePathSet)) {
        continue;
      }

      filteredCount += 1;
      if (!query) {
        if (fallback.length < topK) {
          fallback.push({
            score: 0,
            id: row?.id,
            path: String(row?.path || ""),
            metadata: row?.metadata || {},
            clip_mode: "full_video",
          });
        }
        continue;
      }

      const score = scoreCompactRow(row, expandedTokens, queryTrigrams, expandedTrigrams, requiredPhrases);
      if (!Number.isFinite(score) || score < minScore) {
        continue;
      }

      candidates.push({
        score,
        id: row?.id,
        path: String(row?.path || ""),
        metadata: row?.metadata || {},
      });

      if (candidates.length > candidatePoolLimit) {
        candidates.sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
        candidates = candidates.slice(0, candidatePoolLimit);
      }
    }
  }

  if (!query) {
    return { ok: true, results: fallback, filteredCount };
  }

  candidates.sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
  return {
    ok: true,
    results: candidates.slice(0, topK).map((row) => ({
      ...row,
      clip_mode: "full_video",
    })),
    filteredCount,
    queryExpansion: {
      expanded: expanded.expandedQuery,
      addedTerms: expanded.addedTerms,
      intent: expanded.intent,
      intentSource: expanded.intentSource,
      intentFilteredCount: 0,
    },
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

function extractOcrCorpusText(record) {
  const parts = [];
  const pushText = (value) => {
    const text = String(value || "").trim();
    if (text) {
      parts.push(text);
    }
  };

  const raw = record?.raw || {};
  const meta = raw?.metadata || {};

  // Top-level OCR fields used by cloud/local/index variants.
  pushText(raw?.ocr?.all_text);
  pushText(raw?.ocr_text);
  pushText(raw?.all_text);
  pushText(raw?.local_metadata?.ai_analysis?.ocr_text);

  // Metadata-nested OCR fields used by some exports.
  pushText(meta?.ocr?.all_text);
  pushText(meta?.ocr_text);
  pushText(meta?.all_text);
  pushText(meta?.text);

  // Video OCR fields (top-level and metadata-nested variants).
  pushText(raw?.video_analysis?.ocr?.all_text);
  pushText(raw?.video_analysis?.ocr_all_text);
  pushText(raw?.video_analysis?.aggregated_ocr_text);
  pushText(raw?.video_analysis?.summary?.ocr_all_text);
  pushText(raw?.video_analysis?.summary?.ocr_text);
  pushText(meta?.video_analysis?.ocr?.all_text);
  pushText(meta?.video_analysis?.ocr_all_text);
  pushText(meta?.video_analysis?.aggregated_ocr_text);
  pushText(meta?.video_analysis?.summary?.ocr_all_text);
  pushText(meta?.video_analysis?.summary?.ocr_text);

  const frameAnalyses = Array.isArray(raw?.video_analysis?.frame_analyses)
    ? raw.video_analysis.frame_analyses
    : [];
  const sampledFrames = Array.isArray(raw?.video_analysis?.frames)
    ? raw.video_analysis.frames
    : [];
  const metaFrameAnalyses = Array.isArray(meta?.video_analysis?.frame_analyses)
    ? meta.video_analysis.frame_analyses
    : [];
  const metaSampledFrames = Array.isArray(meta?.video_analysis?.frames)
    ? meta.video_analysis.frames
    : [];

  for (const frame of [...frameAnalyses, ...sampledFrames, ...metaFrameAnalyses, ...metaSampledFrames]) {
    pushText(frame?.ocr?.all_text);
    pushText(frame?.ocr_all_text);
    pushText(frame?.ocr_text);
  }

  return parts.join(" ");
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

function normalizeAspectRatioFromLocal(localMeta) {
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

function extractFileTypeFromPath(pathValue) {
  const ext = path.extname(String(pathValue || "").trim()).toLowerCase();
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

function extractOrientationValue(item, itemMediaType) {
  const local = item?.raw?.local_metadata || {};
  const filtering = local?.filtering && typeof local.filtering === "object" ? local.filtering : {};
  const metadata = item?.metadata || {};

  const filteringOrientation = String(filtering?.orientation || "").toLowerCase();
  if (filteringOrientation) {
    return filteringOrientation;
  }

  if (itemMediaType === "video") {
    const metadataOrientation = String(metadata?.orientation || "").toLowerCase();
    if (metadataOrientation) {
      return metadataOrientation;
    }

    const videoOrientation = String(local?.video_info?.orientation || "").toLowerCase();
    if (videoOrientation) {
      return videoOrientation;
    }
  }

  const imageOrientation = String(local?.image_info?.orientation || "").toLowerCase();
  if (imageOrientation) {
    return imageOrientation;
  }

  return String(metadata?.orientation || "").toLowerCase();
}

// --- Index builder ---

async function buildIndex(filePath, options = {}) {
  const mode = String(options?.mode || "full").toLowerCase() === "compact" ? "compact" : "full";
  const { resolvedPath, stats } = await resolveMetadataPath(filePath);
  const memoKey = getMemoKey(resolvedPath, stats, mode);
  const sourceFingerprint = getSourceFingerprint(stats);
  const canUseInMemoryIndexCache = mode === "compact";

  if (canUseInMemoryIndexCache && inMemoryIndex.has(memoKey)) {
    return inMemoryIndex.get(memoKey);
  }

  let items = [];
  let docs = [];

  if (mode === "compact") {
    let compactRows = await loadCompactRowsFromCache(resolvedPath, sourceFingerprint);

    if (!compactRows) {
      const { payload } = await getJsonPayload(resolvedPath, stats, { allowCache: true });
      compactRows = await buildCompactRowsFromPayload(resolvedPath, sourceFingerprint, payload);
    }

    items = compactRows.map((row) => ({
      id: row.id,
      status: "ok",
      path: row.path,
      metadata: row.metadata,
      raw: null,
    }));
    docs = compactRows.map((row) => String(row.doc || ""));
  } else {
    // Full mode can include large raw video/frame metadata; avoid caching that payload in-process.
    const { payload } = await getJsonPayload(resolvedPath, stats, { allowCache: false });
    const rawResults = Array.isArray(payload.results) ? payload.results : [];
    items = rawResults
      .map((row) => normalizeRecord(row))
      .filter((row) => row && row.status === "ok" && row.path);
    docs = items.map((item) => toDocText(item));
  }

  const { docTermFreqs, idfByTerm, docNorms } = buildSparseTfIdfCorpus(docs);
  const docTextsLower = docs.map((doc) => String(doc || "").toLowerCase());
  const docTokenSets = docs.map((doc) => new Set(tokenize(doc)));

  const index = {
    mode,
    items,
    docTermFreqs,
    idfByTerm,
    docNorms,
    docTextsLower,
    docTokenSets,
  };
  if (!canUseInMemoryIndexCache) {
    return index;
  }

  if (inMemoryIndex.size >= 2) {
    inMemoryIndex.clear();
  }
  inMemoryIndex.set(memoKey, index);
  return index;
}

// --- Filters ---

function applyFilters(items, filters) {
  const albumIds = Array.isArray(filters?.albumIds)
    ? filters.albumIds.map((id) => Number(id)).filter((id) => Number.isFinite(id))
    : [];
  const albumIdSet = new Set(albumIds);

  const peopleFilter = filters?.containsPeople || "any";
  const textFilter = filters?.containsText || "any";
  const styleFilter = String(filters?.style || "any").toLowerCase();
  const orientationFilter = String(filters?.orientation || "any").toLowerCase();
  const brightnessFilter = String(filters?.brightnessCategory || "any").toLowerCase();
  const mediaTypeFilter = String(filters?.mediaType || "any").toLowerCase();
  const resolutionMegapixelsFilter = String(filters?.resolutionMegapixels || "any").toLowerCase();
  const aspectRatioFilter = String(filters?.aspectRatio || "any").toLowerCase();
  const fileTypeFilter = String(filters?.fileType || "any").toLowerCase();
  const durationBucketFilter = String(filters?.durationBucket || "any").toLowerCase();
  const fpsLabelFilter = String(filters?.fpsLabel || "any").toLowerCase();
  const hasAudioFilter = String(filters?.hasAudio || "any").toLowerCase();
  const audioTypeFilter = String(filters?.audioType || "any").toLowerCase();
  const hasCaptionsFilter = String(filters?.hasCaptions || "any").toLowerCase();
  const motionLevelFilter = String(filters?.motionLevel || "any").toLowerCase();
  const normalizeMultiEnumFilter = (value) => {
    const values = Array.isArray(value) ? value : [value];
    return Array.from(new Set(
      values
        .map((entry) => String(entry || "").trim().toLowerCase())
        .filter((entry) => entry && entry !== "any"),
    ));
  };
  const selectedSceneTags = normalizeMultiEnumFilter(filters?.sceneTag);
  const selectedObjectTags = normalizeMultiEnumFilter(filters?.objectTag);
  const selectedActivityTags = normalizeMultiEnumFilter(filters?.activityTag);
  const socialMediaBandFilter = String(filters?.socialMediaBand || "any").toLowerCase();
  const instagramBandFilter = String(filters?.instagramBand || "any").toLowerCase();
  const aspectRatioSuitabilityFilter = String(filters?.aspectRatioSuitability || "any").toLowerCase();
  const aestheticStyleFilter = String(filters?.aestheticStyle || "any").toLowerCase();
  const editingLevelFilter = String(filters?.editingLevel || "any").toLowerCase();
  const visualComplexityFilter = String(filters?.visualComplexity || "any").toLowerCase();
  const heroElementFilter = String(filters?.heroElement || "any").toLowerCase();
  const depthOfFieldFilter = String(filters?.depthOfField || "any").toLowerCase();
  const personLabelFilter = String(filters?.personLabel || "any").toLowerCase();
  const faceClusterIdFilter = String(filters?.faceClusterId || "any").toLowerCase();
  const ocrTextTerms = splitOcrQueryTerms(filters?.ocrTextQuery);

  return items.filter((item) => {
    const m = item.metadata || {};
    const local = item?.raw?.local_metadata || {};
    const filtering = local?.filtering && typeof local.filtering === "object" ? local.filtering : {};
    const raw = item?.raw || {};
    const cloudMeta = raw?.cloud_metadata && typeof raw.cloud_metadata === "object" ? raw.cloud_metadata : {};
    const videoAnalysis = raw?.video_analysis && typeof raw.video_analysis === "object" ? raw.video_analysis : {};
    const itemMediaType = String(m?.media_type || getMediaTypeFromPath(item?.path || "", "image")).toLowerCase();

    const styleValue = String(m.style || local?.source?.likely_source || "").toLowerCase();
    const orientationValue = extractOrientationValue(item, itemMediaType);
    const brightnessValue = String(local?.color_analysis?.brightness_category || "").toLowerCase();
    const resolutionMegapixelsValue = String(
      filtering?.resolutionMegapixels || buildResolutionMegapixelsLabel(local) || "",
    ).toLowerCase();
    const aspectRatioValue = String(
      filtering?.aspectRatio || normalizeAspectRatioFromLocal(local) || "",
    ).toLowerCase();
    const fileTypeValue = String(extractFileTypeFromPath(item?.path || item?.raw?.image_path || "") || "").toLowerCase();
    const durationBucketValue = String(
      filtering?.durationBucket || m?.duration_bucket || deriveDurationBucket(local?.video_info?.duration_seconds || local?.content_hints?.duration_seconds) || "",
    ).toLowerCase();
    const fpsLabelValue = String(toFpsLabel(filtering?.fps ?? m?.fps ?? local?.video_info?.frame_rate) || "").toLowerCase();
    const hasAudioValue = String(toYesNo(filtering?.hasAudio ?? m?.has_audio) || deriveHasAudio(local) || "").toLowerCase();
    const audioTypeValue = String(filtering?.audioType || m?.audio_type || deriveAudioType(local) || "").toLowerCase();
    const hasCaptionsValue = String(toYesNo(filtering?.hasCaptions ?? m?.has_captions) || deriveHasCaptions(local) || "").toLowerCase();
    const motionLevelValue = String(filtering?.motionLevel || m?.motion_level || deriveMotionLevel(local) || "").toLowerCase();
    const sceneTagsValue = normalizeFilterTagList(
      raw?.sceneTags || cloudMeta?.sceneTags || m?.scene_tags || videoAnalysis?.sceneTags,
    );
    const objectTagsValue = normalizeFilterTagList(
      raw?.objectTags || cloudMeta?.objectTags || m?.object_tags || videoAnalysis?.objectTags,
    );
    const activityTagsValue = normalizeFilterTagList(
      raw?.activityTags || cloudMeta?.activityTags || m?.activity_tags || videoAnalysis?.activityTags,
    );
    const aspectRatioSuitabilityValue = normalizeFilterTagList(
      raw?.aspectRatioSuitability || cloudMeta?.aspectRatioSuitability || videoAnalysis?.aspectRatioSuitability,
    );
    const socialMediaBandValue = scoreToBand(raw?.socialMediaScore ?? cloudMeta?.socialMediaScore ?? videoAnalysis?.socialMediaScore);
    const instagramBandValue = scoreToBand(raw?.instagramScore ?? cloudMeta?.instagramScore ?? videoAnalysis?.instagramScore);
    const aestheticStyleValue = String(raw?.aestheticStyle || cloudMeta?.aestheticStyle || videoAnalysis?.aestheticStyle || "").toLowerCase();
    const editingLevelValue = String(raw?.editingLevel || cloudMeta?.editingLevel || videoAnalysis?.editingLevel || "").toLowerCase();
    const visualComplexityValue = String(raw?.visualComplexity || cloudMeta?.visualComplexity || videoAnalysis?.visualComplexity || "").toLowerCase();
    const heroElementValue = String(raw?.heroElement || cloudMeta?.heroElement || videoAnalysis?.heroElement || "").toLowerCase();
    const depthOfFieldValue = String(raw?.depthOfField || cloudMeta?.depthOfField || videoAnalysis?.depthOfField || "").toLowerCase();
    const faces = Array.isArray(local?.face_analysis?.faces) ? local.face_analysis.faces : [];
    const personLabels = new Set(
      faces
        .map((face) => String(face?.person_label || "").trim().toLowerCase())
        .filter(Boolean),
    );
    const faceClusterIds = new Set(
      faces
        .map((face) => String(face?.cluster_id || "").trim().toLowerCase())
        .filter(Boolean),
    );
    const ocrCorpusLower = extractOcrCorpusText(item).toLowerCase();
    const hasDetectedText = m.contains_text === true || Boolean(ocrCorpusLower);
    const hasNoDetectedText = m.contains_text === false || (!hasDetectedText && m.contains_text !== true);

    const peopleMatch =
      peopleFilter === "any" ||
      (peopleFilter === "yes" && m.contains_people === true) ||
      (peopleFilter === "no" && m.contains_people === false);

    const textMatch =
      textFilter === "any" ||
      (textFilter === "yes" && hasDetectedText) ||
      (textFilter === "no" && hasNoDetectedText);

    const styleMatch = styleFilter === "any" || styleValue === styleFilter;
    const orientationMatch = orientationFilter === "any" || orientationValue === orientationFilter;
    const brightnessMatch = brightnessFilter === "any" || brightnessValue === brightnessFilter;
    const mediaTypeMatch = mediaTypeFilter === "any" || itemMediaType === mediaTypeFilter;
    const resolutionMegapixelsMatch =
      resolutionMegapixelsFilter === "any" || resolutionMegapixelsValue === resolutionMegapixelsFilter;
    const aspectRatioMatch = aspectRatioFilter === "any" || aspectRatioValue === aspectRatioFilter;
    const fileTypeMatch = fileTypeFilter === "any" || fileTypeValue === fileTypeFilter;
    const durationBucketMatch = durationBucketFilter === "any" || durationBucketValue === durationBucketFilter;
    const fpsLabelMatch = fpsLabelFilter === "any" || fpsLabelValue === fpsLabelFilter;
    const hasAudioMatch = hasAudioFilter === "any" || hasAudioValue === hasAudioFilter;
    const audioTypeMatch = audioTypeFilter === "any" || audioTypeValue === audioTypeFilter;
    const hasCaptionsMatch = hasCaptionsFilter === "any" || hasCaptionsValue === hasCaptionsFilter;
    const motionLevelMatch = motionLevelFilter === "any" || motionLevelValue === motionLevelFilter;
    const sceneTagMatch =
      selectedSceneTags.length === 0 || selectedSceneTags.some((value) => sceneTagsValue.includes(value));
    const objectTagMatch =
      selectedObjectTags.length === 0 || selectedObjectTags.some((value) => objectTagsValue.includes(value));
    const activityTagMatch =
      selectedActivityTags.length === 0 || selectedActivityTags.some((value) => activityTagsValue.includes(value));
    const socialMediaBandMatch = socialMediaBandFilter === "any" || socialMediaBandValue === socialMediaBandFilter;
    const instagramBandMatch = instagramBandFilter === "any" || instagramBandValue === instagramBandFilter;
    const aspectRatioSuitabilityMatch =
      aspectRatioSuitabilityFilter === "any" || aspectRatioSuitabilityValue.includes(aspectRatioSuitabilityFilter);
    const aestheticStyleMatch = aestheticStyleFilter === "any" || aestheticStyleValue === aestheticStyleFilter;
    const editingLevelMatch = editingLevelFilter === "any" || editingLevelValue === editingLevelFilter;
    const visualComplexityMatch = visualComplexityFilter === "any" || visualComplexityValue === visualComplexityFilter;
    const heroElementMatch = heroElementFilter === "any" || heroElementValue === heroElementFilter;
    const depthOfFieldMatch = depthOfFieldFilter === "any" || depthOfFieldValue === depthOfFieldFilter;
    const personLabelMatch = personLabelFilter === "any" || personLabels.has(personLabelFilter);
    const faceClusterIdMatch = faceClusterIdFilter === "any" || faceClusterIds.has(faceClusterIdFilter);
    const ocrTextMatch =
      ocrTextTerms.length === 0 ||
      hasExactOcrTermMatch(ocrCorpusLower, ocrTextTerms);

    const linkedAlbumIds = Array.isArray(item?.raw?.album_ids)
      ? item.raw.album_ids.map((id) => Number(id)).filter((id) => Number.isFinite(id))
      : [];
    const albumMatch =
      albumIdSet.size === 0 ||
      linkedAlbumIds.some((albumId) => albumIdSet.has(albumId));

    return (
      peopleMatch &&
      textMatch &&
      mediaTypeMatch &&
      styleMatch &&
      orientationMatch &&
      brightnessMatch &&
      resolutionMegapixelsMatch &&
      aspectRatioMatch &&
      fileTypeMatch &&
      durationBucketMatch &&
      fpsLabelMatch &&
      hasAudioMatch &&
      audioTypeMatch &&
      hasCaptionsMatch &&
      motionLevelMatch &&
      sceneTagMatch &&
      objectTagMatch &&
      activityTagMatch &&
      socialMediaBandMatch &&
      instagramBandMatch &&
      aspectRatioSuitabilityMatch &&
      aestheticStyleMatch &&
      editingLevelMatch &&
      visualComplexityMatch &&
      heroElementMatch &&
      depthOfFieldMatch &&
      personLabelMatch &&
      faceClusterIdMatch &&
      ocrTextMatch &&
      albumMatch
    );
  });
}

function shouldUseCompactIndex(payload) {
  return true;
}

// --- Public API ---

export async function validateMetadataFile(filePath) {
  try {
    const { resolvedPath, stats } = await resolveMetadataPath(filePath);
    const memoKey = getMemoKey(resolvedPath, stats);

    if (validationCache.has(memoKey)) {
      return validationCache.get(memoKey);
    }

    const { payload } = await getJsonPayload(resolvedPath, stats);
    if (!Array.isArray(payload?.results)) {
      const invalid = { ok: false, message: "Invalid JSON: missing results array." };
      validationCache.clear();
      validationCache.set(memoKey, invalid);
      return invalid;
    }
    const total = payload.results.length;
    const okCount = payload.results.filter((x) => x?.status === "ok").length;
    const valid = {
      ok: true,
      total,
      okCount,
      model: String(payload.model || "unknown"),
      filePath: resolvedPath,
    };
    validationCache.clear();
    validationCache.set(memoKey, valid);
    return valid;
  } catch (error) {
    return { ok: false, message: String(error.message || error) };
  }
}

export async function runSemanticSearch(payload) {
  try {
    const query = String(payload?.query || "").trim();
    const topK = Math.max(1, Math.min(Number(payload?.topK || 20), MAX_SAFE_TOPK));
    const minScoreInput = Number(payload?.minScore);
    const minScore = Number.isFinite(minScoreInput) ? Math.max(0, minScoreInput) : 0.001;
    const videoResultMode = normalizeVideoResultMode(payload?.videoResultMode);
    const filePath = String(payload?.filePath || "");

    if (!filePath) {
      return { ok: false, message: "Metadata file path is required." };
    }

    const indexMode = shouldUseCompactIndex(payload) ? "compact" : "full";

    if (indexMode === "compact") {
      const { resolvedPath, stats } = await resolveMetadataPath(filePath);
      const sourceFingerprint = getSourceFingerprint(stats);
      const compactResult = await runCompactBatchedSearch(payload, {
        resolvedPath,
        stats,
        sourceFingerprint,
      });

      if (!compactResult?.ok || videoResultMode !== "matching_timeframes" || !query) {
        return compactResult;
      }

      const expandedQuery = String(compactResult?.queryExpansion?.expanded || query);
      const expandedTokens = tokenize(expandedQuery);
      const queryTrigrams = buildCharNgrams(query, 3);
      const expandedTrigrams = buildCharNgrams(expandedQuery, 3);
      const requiredPhrases = compactResult?.queryExpansion?.intent?.required_phrases;
      const scoredRows = Array.isArray(compactResult?.results) ? compactResult.results : [];
      const perVideoClipLimit = Math.max(1, Math.min(MAX_TIMEFRAME_CLIPS_PER_VIDEO, topK));
      const clipCandidatePoolLimit = Math.max(topK * 12, Math.min(MAX_TIMEFRAME_CLIP_POOL, topK * 40));

      const clipCandidates = [];
      for (const scoredItem of scoredRows) {
        const itemMediaType = String(
          scoredItem?.metadata?.media_type || getMediaTypeFromPath(scoredItem?.path || "", "image"),
        ).toLowerCase();

        if (itemMediaType !== "video") {
          appendClipCandidatesWithCap(
            clipCandidates,
            [{ ...scoredItem, clip_mode: "full_video" }],
            clipCandidatePoolLimit,
          );
          continue;
        }

        const sourceItem = {
          path: scoredItem?.path,
          metadata: scoredItem?.metadata,
          raw: null,
        };

        const videoAnalysis = getVideoAnalysisPayload(sourceItem);
        const frameIntervalSeconds = Number(videoAnalysis?.frame_interval_seconds || 2);
        const durationSeconds = Number(videoAnalysis?.duration_seconds);
        const frameCandidates = collectVideoFrameCandidates(sourceItem);

        if (frameCandidates.length === 0) {
          appendClipCandidatesWithCap(
            clipCandidates,
            [{ ...scoredItem, clip_mode: "full_video" }],
            clipCandidatePoolLimit,
          );
          continue;
        }

        const clipsByWindow = new Map();
        let bestFrame = null;
        let bestFrameScore = 0;
        for (const frame of frameCandidates) {
          const frameScore = scoreFrameMatch(
            frame.text,
            expandedTokens,
            queryTrigrams,
            expandedTrigrams,
            requiredPhrases,
          );

          if (!bestFrame || frameScore > bestFrameScore) {
            bestFrame = frame;
            bestFrameScore = frameScore;
          }

          if (frameScore < 0.12) {
            continue;
          }

          const clipWindow = buildTimeframeWindow(frame.second, frameIntervalSeconds, durationSeconds);
          const clipScore = Math.min(1, (Number(scoredItem.score) * 0.6) + (frameScore * 0.4) + 0.04);

          const clipKey = `${clipWindow.start}:${clipWindow.end}`;
          const nextClip = {
            ...scoredItem,
            score: clipScore,
            clip_mode: "matching_timeframe",
            clip_start_seconds: clipWindow.start,
            clip_end_seconds: clipWindow.end,
            clip_match_second: Number(frame.second.toFixed(3)),
            clip_match_text: frame.description || "",
            preview_src: `${toPreviewSrc(scoredItem.path)}#t=${clipWindow.start},${clipWindow.end}`,
          };

          const existing = clipsByWindow.get(clipKey);
          if (!existing || Number(nextClip.score) > Number(existing.score || 0)) {
            clipsByWindow.set(clipKey, nextClip);
          }
        }

        if (clipsByWindow.size === 0 && bestFrame) {
          const clipWindow = buildTimeframeWindow(bestFrame.second, frameIntervalSeconds, durationSeconds);
          const fallbackClipScore = Math.min(1, (Number(scoredItem.score) * 0.72) + (bestFrameScore * 0.28));
          const fallbackClipKey = `${clipWindow.start}:${clipWindow.end}`;
          clipsByWindow.set(fallbackClipKey, {
            ...scoredItem,
            score: fallbackClipScore,
            clip_mode: "matching_timeframe",
            clip_start_seconds: clipWindow.start,
            clip_end_seconds: clipWindow.end,
            clip_match_second: Number(bestFrame.second.toFixed(3)),
            clip_match_text: bestFrame.description || "",
            preview_src: `${toPreviewSrc(scoredItem.path)}#t=${clipWindow.start},${clipWindow.end}`,
          });
        }

        appendClipCandidatesWithCap(
          clipCandidates,
          limitClipWindowsPerVideo(clipsByWindow, perVideoClipLimit),
          clipCandidatePoolLimit,
        );
      }

      clipCandidates.sort((a, b) => toScoreNumber(b?.score) - toScoreNumber(a?.score));

      const normalizedResults = (clipCandidates.length > 0 ? clipCandidates : scoredRows)
        .slice(0, topK)
        .map((row) => ({
          ...row,
          clip_mode: row?.clip_mode || "full_video",
        }));

      return {
        ...compactResult,
        results: normalizedResults,
      };
    }

    const {
      items,
      docTermFreqs,
      idfByTerm,
      docNorms,
      docTextsLower,
      docTokenSets,
    } = await buildIndex(filePath, { mode: indexMode });
    const rawFilters = payload?.filters || {};
    const allowedImagePathSet = Array.isArray(payload?.allowedImagePaths)
      ? new Set(payload.allowedImagePaths.map((value) => String(value || "").trim()).filter(Boolean))
      : null;
    const effectiveFilters = allowedImagePathSet
      ? { ...rawFilters, albumIds: [] }
      : rawFilters;
    const filteredByMeta = applyFilters(items, effectiveFilters);

    const filteredItems = allowedImagePathSet
      ? filteredByMeta.filter((item) => allowedImagePathSet.has(String(item?.path || "").trim()))
      : filteredByMeta;

    if (!query) {
      const fallback = filteredItems.slice(0, topK).map((item) => ({
        score: 0,
        id: item.id,
        path: item.path,
        metadata: item.metadata,
        clip_mode: "full_video",
      }));
      return { ok: true, results: fallback, filteredCount: filteredItems.length };
    }

    const expanded = await expandQuery(query);
    const qVec = buildSparseQueryVector(query, idfByTerm);
    const qVecExpanded = expanded.changed
      ? buildSparseQueryVector(expanded.expandedQuery, idfByTerm)
      : qVec;
    const expandedTokens = tokenize(expanded.expandedQuery);
    const queryTrigrams = buildCharNgrams(query, 3);
    const expandedTrigrams = expanded.changed
      ? buildCharNgrams(expanded.expandedQuery, 3)
      : queryTrigrams;
    const intentFilteredItems = filteredItems.filter((item) => matchesExpandedIntent(item, expanded.intent));
    const sourceItems = intentFilteredItems.length > 0 ? intentFilteredItems : filteredItems;
    const filteredSet = new Set(sourceItems);
    const itemLookupByPath = new Map(items.map((item) => [String(item?.path || ""), item]));

    const scoredPrePass = [];
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      if (!filteredSet.has(item)) {
        continue;
      }

      const baseScore = cosineSimilaritySparse(qVec, docTermFreqs[i], idfByTerm, docNorms[i]);
      const expandedScore = cosineSimilaritySparse(qVecExpanded, docTermFreqs[i], idfByTerm, docNorms[i]);
      const semanticScore = Math.max(baseScore, expandedScore * 0.94);
      const lexicalScore = tokenOverlapScore(expandedTokens, docTokenSets[i]);
      const phraseScore = phraseCoverageScore(expanded?.intent?.required_phrases, docTextsLower[i]);

      // Fast pre-pass excludes fuzzy to keep large-dataset searches responsive.
      const preScore = combineScore({
        semantic: semanticScore,
        lexical: lexicalScore,
        fuzzy: 0,
        phrase: phraseScore,
      });

      if (preScore <= 0) {
        continue;
      }

      scoredPrePass.push({
        preScore,
        semanticScore,
        lexicalScore,
        phraseScore,
        id: item.id,
        path: item.path,
        metadata: item.metadata,
        _docIndex: i,
      });
    }

    scoredPrePass.sort((a, b) => Number(b.preScore || 0) - Number(a.preScore || 0));

    const fuzzyCandidateCount = Math.min(
      scoredPrePass.length,
      Math.max(400, Math.min(3000, topK * 20)),
    );
    const fuzzyCandidates = scoredPrePass.slice(0, fuzzyCandidateCount);

    const scored = [];
    for (const candidate of fuzzyCandidates) {
      const i = Number(candidate._docIndex || 0);
      const docText = docTextsLower[i] || "";
      const docTrigrams = buildCharNgrams(docText, 3);
      const fuzzyScore = Math.max(
        jaccardSimilarity(queryTrigrams, docTrigrams),
        jaccardSimilarity(expandedTrigrams, docTrigrams) * 0.95,
      );

      const score = combineScore({
        semantic: candidate.semanticScore,
        lexical: candidate.lexicalScore,
        fuzzy: fuzzyScore,
        phrase: candidate.phraseScore,
      });
      const sourceItem = itemLookupByPath.get(String(candidate.path || ""));
      const boostedScore = Math.min(1, score + computeDirectTagMatchBonus(expanded.expandedQuery, sourceItem));
      if (boostedScore < minScore) {
        continue;
      }

      scored.push({
        score: boostedScore,
        id: candidate.id,
        path: candidate.path,
        metadata: candidate.metadata,
      });
    }

    scored.sort((a, b) => b.score - a.score);

    if (videoResultMode === "matching_timeframes") {
      const perVideoClipLimit = Math.max(1, Math.min(MAX_TIMEFRAME_CLIPS_PER_VIDEO, topK));
      const clipCandidatePoolLimit = Math.max(topK * 12, Math.min(MAX_TIMEFRAME_CLIP_POOL, topK * 40));
      const timeframeSourceLimit = Math.min(
        scored.length,
        Math.max(topK * 8, 400),
        MAX_TIMEFRAME_SOURCE_ITEMS,
      );
      const scoredForTimeframes = scored.slice(0, timeframeSourceLimit);
      const clipCandidates = [];

      for (const scoredItem of scoredForTimeframes) {
        const itemMediaType = String(
          scoredItem?.metadata?.media_type || getMediaTypeFromPath(scoredItem?.path || "", "image"),
        ).toLowerCase();

        if (itemMediaType !== "video") {
          appendClipCandidatesWithCap(
            clipCandidates,
            [{ ...scoredItem, clip_mode: "full_video" }],
            clipCandidatePoolLimit,
          );
          continue;
        }

        const sourceItem = itemLookupByPath.get(String(scoredItem.path || ""));
        if (!sourceItem) {
          appendClipCandidatesWithCap(
            clipCandidates,
            [{ ...scoredItem, clip_mode: "full_video" }],
            clipCandidatePoolLimit,
          );
          continue;
        }

        const videoAnalysis = getVideoAnalysisPayload(sourceItem);
        const frameIntervalSeconds = Number(videoAnalysis?.frame_interval_seconds || 2);
        const durationSeconds = Number(videoAnalysis?.duration_seconds);
        const frameCandidates = collectVideoFrameCandidates(sourceItem);

        if (frameCandidates.length === 0) {
          appendClipCandidatesWithCap(
            clipCandidates,
            [{ ...scoredItem, clip_mode: "full_video" }],
            clipCandidatePoolLimit,
          );
          continue;
        }

        const clipsByWindow = new Map();
        let bestFrame = null;
        let bestFrameScore = 0;
        for (const frame of frameCandidates) {
          const frameScore = scoreFrameMatch(
            frame.text,
            expandedTokens,
            queryTrigrams,
            expandedTrigrams,
            expanded?.intent?.required_phrases,
          );

          if (!bestFrame || frameScore > bestFrameScore) {
            bestFrame = frame;
            bestFrameScore = frameScore;
          }

          if (frameScore < 0.12) {
            continue;
          }

          const clipWindow = buildTimeframeWindow(frame.second, frameIntervalSeconds, durationSeconds);
          const clipScore = Math.min(1, (Number(scoredItem.score) * 0.6) + (frameScore * 0.4) + 0.04);

          const clipKey = `${clipWindow.start}:${clipWindow.end}`;
          const nextClip = {
            ...scoredItem,
            score: clipScore,
            clip_mode: "matching_timeframe",
            clip_start_seconds: clipWindow.start,
            clip_end_seconds: clipWindow.end,
            clip_match_second: Number(frame.second.toFixed(3)),
            clip_match_text: frame.description || "",
            preview_src: `${toPreviewSrc(scoredItem.path)}#t=${clipWindow.start},${clipWindow.end}`,
          };

          const existing = clipsByWindow.get(clipKey);
          if (!existing || Number(nextClip.score) > Number(existing.score || 0)) {
            clipsByWindow.set(clipKey, nextClip);
          }
        }

        if (clipsByWindow.size === 0 && bestFrame) {
          const clipWindow = buildTimeframeWindow(bestFrame.second, frameIntervalSeconds, durationSeconds);
          const fallbackClipScore = Math.min(1, (Number(scoredItem.score) * 0.72) + (bestFrameScore * 0.28));
          const fallbackClipKey = `${clipWindow.start}:${clipWindow.end}`;
          clipsByWindow.set(fallbackClipKey, {
            ...scoredItem,
            score: fallbackClipScore,
            clip_mode: "matching_timeframe",
            clip_start_seconds: clipWindow.start,
            clip_end_seconds: clipWindow.end,
            clip_match_second: Number(bestFrame.second.toFixed(3)),
            clip_match_text: bestFrame.description || "",
            preview_src: `${toPreviewSrc(scoredItem.path)}#t=${clipWindow.start},${clipWindow.end}`,
          });
        }

        appendClipCandidatesWithCap(
          clipCandidates,
          limitClipWindowsPerVideo(clipsByWindow, perVideoClipLimit),
          clipCandidatePoolLimit,
        );
      }

      clipCandidates.sort((a, b) => toScoreNumber(b?.score) - toScoreNumber(a?.score));

      const normalizedResults = (clipCandidates.length > 0 ? clipCandidates : scored)
        .slice(0, topK)
        .map((row) => ({
          ...row,
          clip_mode: row?.clip_mode || "full_video",
        }));

      return {
        ok: true,
        results: normalizedResults,
        filteredCount: sourceItems.length,
        queryExpansion: {
          expanded: expanded.expandedQuery,
          addedTerms: expanded.addedTerms,
          intent: expanded.intent,
          intentSource: expanded.intentSource,
          intentFilteredCount: intentFilteredItems.length,
        },
      };
    }

    return {
      ok: true,
      results: scored.slice(0, topK).map((row) => ({
        ...row,
        clip_mode: "full_video",
      })),
      filteredCount: sourceItems.length,
      queryExpansion: {
        expanded: expanded.expandedQuery,
        addedTerms: expanded.addedTerms,
        intent: expanded.intent,
        intentSource: expanded.intentSource,
        intentFilteredCount: intentFilteredItems.length,
      },
    };
  } catch (error) {
    return { ok: false, message: String(error.message || error) };
  }
}
