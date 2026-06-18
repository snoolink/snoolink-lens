/**
 * Local Video Metadata Extractor Module
 *
 * Purpose:
 * - Extract local-only video metadata and deterministic filter-ready fields.
 * - Keep filter/transform methods small, named, and independently testable.
 *
 * Filter composition model:
 * - Parse primitive values from ffprobe and file system.
 * - Apply single-purpose filter/normalization helpers.
 * - Compose outputs into `video_info`, `source`, `content_hints`, and `filtering`.
 *
 * Author/date:
 * - Snoolink Studios team
 * - Refactor completed: 2026-05-02
 *
 * Notes:
 * - ffprobe is optional. If not available, extraction gracefully falls back.
 * - No cloud calls are made in this module.
 */

import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

const VIDEO_EXTENSIONS = new Set([
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
  ".ts",
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
]);

/**
 * Normalize an optional binary path from env/config.
 * @param {string|undefined|null} rawPath - Raw binary path.
 * @param {string} binaryName - Binary name for fallback join.
 * @returns {string} Normalized path or empty string.
 */
function normalizeBinaryPath(rawPath, binaryName) {
  const candidate = String(rawPath || "").trim();
  if (!candidate) {
    return "";
  }

  const expanded = candidate.startsWith("~")
    ? path.join(process.env.HOME || "", candidate.slice(1))
    : candidate;
  const resolved = path.resolve(expanded);

  if (path.extname(resolved)) {
    return resolved;
  }
  return path.join(resolved, binaryName);
}

/**
 * Resolve likely ffprobe binaries for the current platform.
 * @returns {string[]} Ordered, de-duplicated candidate list.
 */
function resolveFfprobeCandidates() {
  const rows = [];

  const fromEnv = normalizeBinaryPath(process.env.FFPROBE_PATH, "ffprobe");
  if (fromEnv) {
    rows.push(fromEnv);
  }

  // If only FFMPEG_PATH is set, try sibling ffprobe in the same bin folder.
  const ffmpegFromEnv = normalizeBinaryPath(process.env.FFMPEG_PATH, "ffmpeg");
  if (ffmpegFromEnv) {
    rows.push(path.join(path.dirname(ffmpegFromEnv), "ffprobe"));
  }

  if (process.platform === "darwin") {
    rows.push(
      "/opt/homebrew/bin/ffprobe",
      "/usr/local/bin/ffprobe",
      "/opt/local/bin/ffprobe",
      "/usr/bin/ffprobe",
    );
  } else if (process.platform === "linux") {
    rows.push(
      "/usr/bin/ffprobe",
      "/usr/local/bin/ffprobe",
      "/snap/bin/ffprobe",
    );
  }

  // Last fallback: rely on PATH lookup.
  rows.push("ffprobe");

  return Array.from(new Set(rows.filter(Boolean)));
}

/**
 * Convert an input date-like value to ISO string.
 * @param {unknown} value - Date-like value.
 * @returns {string|null} ISO timestamp or null when invalid.
 */
function toIsoOrNull(value) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}

/**
 * Parse numeric-like value to finite number.
 * @param {unknown} value - Numeric candidate.
 * @returns {number|null} Parsed number or null.
 */
function toNumberOrNull(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

/**
 * Parse numeric-like value to finite integer.
 * @param {unknown} value - Integer candidate.
 * @returns {number|null} Parsed integer or null.
 */
function toIntOrNull(value) {
  const num = Number.parseInt(String(value), 10);
  return Number.isFinite(num) ? num : null;
}

/**
 * Parse raw frame-rate fraction strings (e.g. `30000/1001`).
 * @param {unknown} value - Fraction or numeric string.
 * @returns {number|null} Parsed rate or null.
 */
function parseFraction(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return null;
  }

  const normalizedRaw = raw.replace(/\s+/g, "");

  if (normalizedRaw.includes("/")) {
    const [a, b] = normalizedRaw.split("/");
    const n = Number(a);
    const d = Number(b);
    if (Number.isFinite(n) && Number.isFinite(d) && d !== 0) {
      return n / d;
    }
    return null;
  }

  const numericMatch = normalizedRaw.match(/-?\d+(?:\.\d+)?/);
  const parsed = numericMatch ? Number(numericMatch[0]) : Number(normalizedRaw);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Parse duration variants from ffprobe values/tags.
 * Supports seconds, numeric strings, and HH:MM:SS(.sss) formats.
 * @param {unknown} value - Raw duration candidate.
 * @returns {number|null} Duration in seconds or null.
 */
function parseDurationSeconds(value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  const raw = String(value).trim();
  if (!raw) {
    return null;
  }

  const directNumber = Number(raw);
  if (Number.isFinite(directNumber) && directNumber > 0) {
    return directNumber;
  }

  const hhmmssMatch = raw.match(/^(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/);
  if (hhmmssMatch) {
    const hours = Number(hhmmssMatch[1]);
    const minutes = Number(hhmmssMatch[2]);
    const seconds = Number(hhmmssMatch[3]);
    if (Number.isFinite(hours) && Number.isFinite(minutes) && Number.isFinite(seconds)) {
      return (hours * 3600) + (minutes * 60) + seconds;
    }
  }

  const secondsTokenMatch = raw.match(/(\d+(?:\.\d+)?)\s*s(?:ec(?:ond)?s?)?$/i);
  if (secondsTokenMatch) {
    const seconds = Number(secondsTokenMatch[1]);
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
  }

  return null;
}

/**
 * Extract best-known duration from ffprobe stream row.
 * @param {object} stream - ffprobe stream object.
 * @returns {number|null} Duration in seconds or null.
 */
function parseStreamDurationSeconds(stream) {
  const streamRow = stream && typeof stream === "object" ? stream : {};
  const tagMap = streamRow.tags && typeof streamRow.tags === "object" ? streamRow.tags : {};

  const directCandidates = [
    streamRow.duration,
    tagMap.DURATION,
    tagMap.duration,
    tagMap["com.apple.quicktime.duration"],
  ];

  for (const candidate of directCandidates) {
    const parsed = parseDurationSeconds(candidate);
    if (parsed != null) {
      return parsed;
    }
  }

  const durationTs = toNumberOrNull(streamRow.duration_ts);
  const timeBase = parseFraction(streamRow.time_base);
  if (
    Number.isFinite(durationTs)
    && durationTs > 0
    && Number.isFinite(timeBase)
    && timeBase > 0
  ) {
    return durationTs * timeBase;
  }

  return null;
}

/**
 * Extract best-known FPS from ffprobe stream row.
 * @param {object} stream - ffprobe stream object.
 * @returns {{fps:number|null,raw:string|null}} Parsed FPS and source token.
 */
function parseStreamFrameRate(stream) {
  const streamRow = stream && typeof stream === "object" ? stream : {};
  const tagMap = streamRow.tags && typeof streamRow.tags === "object" ? streamRow.tags : {};
  const candidates = [
    streamRow.avg_frame_rate,
    streamRow.r_frame_rate,
    streamRow.frame_rate,
    tagMap["com.apple.quicktime.nominal-frame-rate"],
    tagMap.framerate,
    tagMap.frame_rate,
    tagMap.FRAMERATE,
  ];

  for (const candidate of candidates) {
    const parsed = parseFraction(candidate);
    if (Number.isFinite(parsed) && parsed > 0) {
      return {
        fps: Number(parsed.toFixed(4)),
        raw: String(candidate || "") || null,
      };
    }
  }

  return { fps: null, raw: null };
}

/**
 * Extract best-known duration from ffprobe format payload.
 * @param {object} formatData - ffprobe format object.
 * @returns {number|null} Duration in seconds or null.
 */
function parseFormatDurationSeconds(formatData) {
  const formatRow = formatData && typeof formatData === "object" ? formatData : {};
  const tagMap = formatRow.tags && typeof formatRow.tags === "object" ? formatRow.tags : {};
  const candidates = [
    formatRow.duration,
    tagMap.DURATION,
    tagMap.duration,
    tagMap["com.apple.quicktime.duration"],
  ];

  for (const candidate of candidates) {
    const parsed = parseDurationSeconds(candidate);
    if (parsed != null) {
      return parsed;
    }
  }

  return null;
}

/**
 * Convert numeric aspect ratio into common ratio label.
 * @param {number} ratio - Numeric width/height ratio.
 * @returns {string} Named ratio label or `custom`.
 */
function getAspectRatioString(ratio) {
  if (!Number.isFinite(ratio) || ratio <= 0) {
    return "custom";
  }

  const commonRatios = {
    "1:1": 1,
    "4:3": 4 / 3,
    "3:2": 3 / 2,
    "16:9": 16 / 9,
    "21:9": 21 / 9,
    "9:16": 9 / 16,
    "3:4": 3 / 4,
    "2:3": 2 / 3,
  };

  for (const [label, value] of Object.entries(commonRatios)) {
    if (Math.abs(ratio - value) < 0.05) {
      return label;
    }
  }

  return "custom";
}

/**
 * Categorize resolution bucket by total pixels.
 * @param {number} width - Video width.
 * @param {number} height - Video height.
 * @returns {string} Resolution bucket (`8k`, `4k`, ... `sd`, `unknown`).
 */
function getResolutionCategory(width, height) {
  const w = Number(width || 0);
  const h = Number(height || 0);
  if (w <= 0 || h <= 0) {
    return "unknown";
  }

  const pixels = w * h;
  if (pixels >= 7680 * 4320) return "8k";
  if (pixels >= 3840 * 2160) return "4k";
  if (pixels >= 2560 * 1440) return "1440p";
  if (pixels >= 1920 * 1080) return "1080p";
  if (pixels >= 1280 * 720) return "720p";
  if (pixels >= 854 * 480) return "480p";
  return "sd";
}

/**
 * Infer orientation from dimensions.
 * @param {number} width - Width.
 * @param {number} height - Height.
 * @returns {"landscape"|"portrait"|"square"|"unknown"} Orientation label.
 */
function inferOrientation(width, height) {
  const w = Number(width || 0);
  const h = Number(height || 0);
  if (w <= 0 || h <= 0) {
    return "unknown";
  }
  if (Math.abs(w - h) < Math.max(2, Math.min(w, h) * 0.02)) {
    return "square";
  }
  return w > h ? "landscape" : "portrait";
}

/**
 * Parse stream rotation degrees from ffprobe variants.
 * @param {object} stream - ffprobe stream object.
 * @returns {number} Rotation degrees (defaults to `0`).
 */
function parseRotationDegrees(stream) {
  const parseNumericRotation = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };

  const parseDisplayMatrixRotation = (value) => {
    const text = String(value || "");
    if (!text) {
      return null;
    }
    const match = text.match(/rotation\s+of\s+(-?\d+(?:\.\d+)?)\s+degrees/i);
    if (!match) {
      return null;
    }
    const n = Number(match[1]);
    return Number.isFinite(n) ? n : null;
  };

  const directCandidates = [stream?.rotate, stream?.rotation];
  for (const candidate of directCandidates) {
    const value = parseNumericRotation(candidate);
    if (value != null) {
      return value;
    }
  }

  const sideData = Array.isArray(stream?.side_data_list) ? stream.side_data_list : [];
  for (const entry of sideData) {
    const value = parseNumericRotation(entry?.rotation);
    if (value != null) {
      return value;
    }

    const displayMatrixRotation = parseDisplayMatrixRotation(entry?.displaymatrix);
    if (displayMatrixRotation != null) {
      return displayMatrixRotation;
    }

    const rotateValue = parseNumericRotation(entry?.rotate);
    if (rotateValue != null) {
      return rotateValue;
    }
  }

  const tags = stream?.tags && typeof stream.tags === "object" ? stream.tags : null;
  if (tags) {
    const preferredTagKeys = ["rotate", "rotation", "com.apple.quicktime.video-orientation"];
    for (const key of preferredTagKeys) {
      const value = parseNumericRotation(tags[key]);
      if (value != null) {
        return value;
      }
    }

    for (const [key, raw] of Object.entries(tags)) {
      const normalizedKey = String(key || "").trim().toLowerCase();
      if (!normalizedKey.includes("rotate") && !normalizedKey.includes("orientation")) {
        continue;
      }
      const value = parseNumericRotation(raw);
      if (value != null) {
        return value;
      }
    }
  }

  return 0;
}

/**
 * Compute effective display dimensions after rotation.
 * @param {number} width - Encoded width.
 * @param {number} height - Encoded height.
 * @param {number} rotationDegrees - Rotation metadata.
 * @returns {{width:number,height:number,rotation:number}} Effective display dimensions and normalized rotation.
 */
function getEffectiveDisplayDimensions(width, height, rotationDegrees) {
  const w = Number(width || 0);
  const h = Number(height || 0);
  if (w <= 0 || h <= 0) {
    return {
      width: w,
      height: h,
      rotation: 0,
    };
  }

  const rotation = Number(rotationDegrees || 0);
  const normalizedRotation = ((Math.round(rotation) % 360) + 360) % 360;
  const swapsDimensions = normalizedRotation === 90 || normalizedRotation === 270;

  return {
    width: swapsDimensions ? h : w,
    height: swapsDimensions ? w : h,
    rotation: normalizedRotation,
  };
}

/**
 * Normalize video orientation accounting for rotation metadata.
 * @param {number} width - Encoded width.
 * @param {number} height - Encoded height.
 * @param {number} rotationDegrees - Rotation metadata.
 * @returns {"landscape"|"portrait"|"square"|"unknown"} Orientation label.
 */
function normalizeVideoOrientation(width, height, rotationDegrees) {
  const display = getEffectiveDisplayDimensions(width, height, rotationDegrees);
  return inferOrientation(display.width, display.height);
}

/**
 * Normalize codec identifier to safe lowercase value.
 * @param {unknown} value - Raw codec string.
 * @returns {string} Normalized codec name.
 */
function normalizeCodecName(value) {
  const codec = String(value || "").trim().toLowerCase();
  if (!codec) {
    return "unknown";
  }
  return codec;
}

/**
 * Normalize ffprobe tags object to string-valued map.
 * @param {unknown} tags - Raw tag object.
 * @returns {Record<string,string>} Normalized tags map.
 */
function parseTags(tags) {
  if (!tags || typeof tags !== "object") {
    return {};
  }

  const safe = {};
  for (const [k, v] of Object.entries(tags)) {
    const key = String(k || "").trim();
    if (!key) {
      continue;
    }
    safe[key] = String(v ?? "");
  }
  return safe;
}

/**
 * Categorize frame-rate level.
 * @param {number} fps - Frames per second.
 * @returns {"ultra_high"|"high"|"standard"|"low"|"unknown"} Category label.
 */
function deriveFrameRateCategory(fps) {
  if (!Number.isFinite(fps) || fps <= 0) {
    return "unknown";
  }
  if (fps >= 120) return "ultra_high";
  if (fps >= 60) return "high";
  if (fps >= 30) return "standard";
  return "low";
}

/**
 * Categorize bitrate level.
 * @param {number} bitsPerSecond - Bitrate value.
 * @returns {"very_high"|"high"|"medium"|"low"|"unknown"} Bitrate category.
 */
function deriveBitrateCategory(bitsPerSecond) {
  const bps = Number(bitsPerSecond || 0);
  if (!Number.isFinite(bps) || bps <= 0) {
    return "unknown";
  }
  if (bps >= 35_000_000) return "very_high";
  if (bps >= 12_000_000) return "high";
  if (bps >= 4_000_000) return "medium";
  return "low";
}

/**
 * Build title-safe name from path.
 * @param {string} filePath - Video file path.
 * @returns {string} Human-friendly title candidate.
 */
function cleanNameForTitle(filePath) {
  const base = path.basename(filePath, path.extname(filePath));
  const normalized = base.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return normalized || base || "Untitled video";
}

/**
 * Compose human-readable summary from video/audio/subtitle info.
 * @param {object} videoInfo - Video info block.
 * @param {object[]} audioTracks - Audio track list.
 * @param {object[]} subtitleTracks - Subtitle track list.
 * @returns {string} Summary text.
 */
function buildVideoSummary(videoInfo, audioTracks, subtitleTracks) {
  const codec = videoInfo.codec || "unknown";
  const width = Number(videoInfo.width || 0);
  const height = Number(videoInfo.height || 0);
  const resolution = width > 0 && height > 0 ? `${width}x${height}` : "unknown resolution";
  const fps = Number(videoInfo.frame_rate || 0);
  const fpsText = Number.isFinite(fps) && fps > 0 ? `${fps.toFixed(2)}fps` : "unknown fps";
  const audioCount = Array.isArray(audioTracks) ? audioTracks.length : 0;
  const subtitleCount = Array.isArray(subtitleTracks) ? subtitleTracks.length : 0;
  return `${codec.toUpperCase()} ${resolution} ${fpsText}; audio tracks: ${audioCount}; subtitles: ${subtitleCount}`;
}

/**
 * Compute md5/sha256 hashes for dedupe.
 * @param {string} filePath - File path.
 * @returns {Promise<{md5:string,sha256:string}>} Hash payload.
 */
async function extractHashes(filePath) {
  const buffer = await fs.readFile(filePath);
  return {
    md5: crypto.createHash("md5").update(buffer).digest("hex"),
    sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
  };
}

/**
 * Execute ffprobe and parse JSON payload.
 * @param {string} filePath - Video path.
 * @returns {Promise<{ok:boolean,data?:object,binary?:string,error?:string}>} Probe result.
 */
async function runFfprobe(filePath) {
  const args = [
    "-v",
    "error",
    "-show_format",
    "-show_streams",
    "-show_chapters",
    "-print_format",
    "json",
    filePath,
  ];

  const candidates = resolveFfprobeCandidates();

  let lastError = null;
  for (const binary of candidates) {
    try {
      const { stdout } = await execFileAsync(binary, args, {
        windowsHide: true,
        maxBuffer: 20 * 1024 * 1024,
      });
      const parsed = JSON.parse(stdout || "{}");
      return { ok: true, data: parsed, binary };
    } catch (error) {
      lastError = error;
    }
  }

  return {
    ok: false,
    error: String(lastError?.message || `ffprobe not available (candidates: ${candidates.join(", ")})`),
  };
}

/**
 * Parse and normalize video stream rows.
 * @param {object[]} streams - ffprobe streams array.
 * @returns {{count:number,primary:object|null,tracks:object[]}} Video stream projection.
 */
function parseVideoStreams(streams) {
  const videoStreams = (Array.isArray(streams) ? streams : []).filter((s) => s?.codec_type === "video");

  const details = videoStreams.map((stream, idx) => {
    const width = toIntOrNull(stream.width);
    const height = toIntOrNull(stream.height);
    const rotation = parseRotationDegrees(stream);
    const display = getEffectiveDisplayDimensions(width, height, rotation);
    const frameRateInfo = parseStreamFrameRate(stream);
    const frameRate = frameRateInfo.fps;
    const displayAspectRatio = String(stream.display_aspect_ratio || "").trim();
    const sampleAspectRatio = String(stream.sample_aspect_ratio || "").trim();
    const calculatedAspect = display.width && display.height ? display.width / display.height : null;
    const durationSeconds = parseStreamDurationSeconds(stream);

    return {
      index: Number(stream.index ?? idx),
      codec: normalizeCodecName(stream.codec_name),
      codec_long_name: String(stream.codec_long_name || ""),
      profile: String(stream.profile || ""),
      level: toIntOrNull(stream.level),
      width,
      height,
      display_width: toIntOrNull(display.width),
      display_height: toIntOrNull(display.height),
      orientation: inferOrientation(display.width, display.height),
      rotation_degrees: Number(rotation || 0),
      aspect_ratio: calculatedAspect,
      aspect_ratio_string: getAspectRatioString(calculatedAspect),
      display_aspect_ratio: displayAspectRatio || null,
      sample_aspect_ratio: sampleAspectRatio || null,
      pixel_format: String(stream.pix_fmt || "") || null,
      color_space: String(stream.color_space || "") || null,
      color_transfer: String(stream.color_transfer || "") || null,
      color_primaries: String(stream.color_primaries || "") || null,
      frame_rate: Number.isFinite(frameRate) ? frameRate : null,
      frame_rate_raw: frameRateInfo.raw,
      frame_rate_category: deriveFrameRateCategory(frameRate),
      bitrate: toNumberOrNull(stream.bit_rate),
      bitrate_category: deriveBitrateCategory(stream.bit_rate),
      duration_seconds: durationSeconds,
      frame_count: toIntOrNull(stream.nb_frames),
      field_order: String(stream.field_order || "") || null,
      is_avc: stream.is_avc === "true" || stream.is_avc === true,
      nal_length_size: String(stream.nal_length_size || "") || null,
      tags: parseTags(stream.tags),
    };
  });

  const primary = details[0] || null;

  return {
    count: details.length,
    primary,
    tracks: details,
  };
}

/**
 * Parse and normalize audio stream rows.
 * @param {object[]} streams - ffprobe streams array.
 * @returns {{count:number,tracks:object[]}} Audio stream projection.
 */
function parseAudioStreams(streams) {
  const audioStreams = (Array.isArray(streams) ? streams : []).filter((s) => s?.codec_type === "audio");

  const details = audioStreams.map((stream, idx) => ({
    index: Number(stream.index ?? idx),
    codec: normalizeCodecName(stream.codec_name),
    codec_long_name: String(stream.codec_long_name || ""),
    profile: String(stream.profile || "") || null,
    channels: toIntOrNull(stream.channels),
    channel_layout: String(stream.channel_layout || "") || null,
    sample_rate: toIntOrNull(stream.sample_rate),
    sample_format: String(stream.sample_fmt || "") || null,
    bitrate: toNumberOrNull(stream.bit_rate),
    duration_seconds: toNumberOrNull(stream.duration),
    language: String(stream.tags?.language || "").toLowerCase() || null,
    tags: parseTags(stream.tags),
  }));

  return {
    count: details.length,
    tracks: details,
  };
}

/**
 * Parse and normalize subtitle stream rows.
 * @param {object[]} streams - ffprobe streams array.
 * @returns {{count:number,tracks:object[]}} Subtitle stream projection.
 */
function parseSubtitleStreams(streams) {
  const subtitleStreams = (Array.isArray(streams) ? streams : []).filter((s) => s?.codec_type === "subtitle");

  const details = subtitleStreams.map((stream, idx) => ({
    index: Number(stream.index ?? idx),
    codec: normalizeCodecName(stream.codec_name),
    codec_long_name: String(stream.codec_long_name || ""),
    language: String(stream.tags?.language || "").toLowerCase() || null,
    title: String(stream.tags?.title || "") || null,
    tags: parseTags(stream.tags),
  }));

  return {
    count: details.length,
    tracks: details,
  };
}

/**
 * Parse ffprobe chapter rows.
 * @param {object[]} chapters - ffprobe chapters array.
 * @returns {object[]} Normalized chapter rows.
 */
function parseChapters(chapters) {
  const rows = Array.isArray(chapters) ? chapters : [];
  return rows.map((chapter, idx) => ({
    index: Number(chapter.id ?? idx),
    start_seconds: parseDurationSeconds(chapter.start_time),
    end_seconds: parseDurationSeconds(chapter.end_time),
    title: String(chapter.tags?.title || "") || null,
    tags: parseTags(chapter.tags),
  }));
}

/**
 * Detect whether path/name appears to be a screen recording.
 * @param {string} fileName - Lowercased file name.
 * @param {string} dirName - Lowercased directory path.
 * @returns {boolean} Screen-recording flag.
 */
function detectScreenRecordingFlag(fileName, dirName) {
  const screenshotPatterns = [/screen\s?record/i, /^capture_/i, /^recording/i, /^obs/i];
  return screenshotPatterns.some((pattern) => pattern.test(fileName) || pattern.test(dirName));
}

/**
 * Detect whether path/name appears to be a camera capture.
 * @param {string} fileName - Lowercased file name.
 * @param {string} dirName - Lowercased directory path.
 * @returns {boolean} Camera-capture flag.
 */
function detectCameraCaptureFlag(fileName, dirName) {
  const cameraPatterns = [/^dji_/i, /^gopro/i, /^img_/i, /^vid_/i, /^mvimg_/i, /^pxl_/i, /dcim/i];
  return cameraPatterns.some((pattern) => pattern.test(fileName) || pattern.test(dirName));
}

/**
 * Detect whether directory suggests downloaded media.
 * @param {string} dirName - Lowercased directory path.
 * @returns {boolean} Download source flag.
 */
function detectVideoDownloadFlag(dirName) {
  const value = String(dirName || "");
  return value.includes("download") || value.includes("downloads");
}

/**
 * Determine likely source label from detected source flags.
 * @param {boolean} isScreenRecording - Screen-recording flag.
 * @param {boolean} isCameraCapture - Camera-capture flag.
 * @param {boolean} isDownload - Download flag.
 * @returns {"screen_recording"|"camera_video"|"web_download"|"unknown"} Source label.
 */
function determineLikelyVideoSource(isScreenRecording, isCameraCapture, isDownload) {
  if (isScreenRecording) {
    return "screen_recording";
  }
  if (isCameraCapture) {
    return "camera_video";
  }
  if (isDownload) {
    return "web_download";
  }
  return "unknown";
}

/**
 * Check whether filename includes long sequential digits.
 * @param {string} fileName - Lowercased file name.
 * @returns {boolean} Sequential-naming flag.
 */
function hasSequentialVideoName(fileName) {
  return /\d{4,}/.test(String(fileName || ""));
}

/**
 * Check whether filename stem starts with timestamp-like digits.
 * @param {string} fileName - Lowercased file name.
 * @returns {boolean} Timestamp-style naming flag.
 */
function hasTimestampVideoName(fileName) {
  return /^\d{10,13}/.test(path.parse(String(fileName || "")).name);
}

/**
 * Categorize file size by byte thresholds.
 * @param {number} sizeBytes - File size in bytes.
 * @returns {"small"|"medium"|"large"|"very_large"} Size bucket.
 */
function categorizeVideoFileSize(sizeBytes) {
  const bytes = Number(sizeBytes || 0);
  if (bytes < 20 * 1024 * 1024) return "small";
  if (bytes < 200 * 1024 * 1024) return "medium";
  if (bytes < 1024 * 1024 * 1024) return "large";
  return "very_large";
}

/**
 * Detect source hints from path/name heuristics.
 * @param {string} filePath - Absolute video path.
 * @returns {object} Source flags and inferred source label.
 */
function detectSource(filePath) {
  const fileName = path.basename(filePath).toLowerCase();
  const dirName = path.dirname(filePath).toLowerCase();

  const isScreenRecording = detectScreenRecordingFlag(fileName, dirName);
  const isDownload = detectVideoDownloadFlag(dirName);
  const isCameraCapture = detectCameraCaptureFlag(fileName, dirName);
  const likelySource = determineLikelyVideoSource(isScreenRecording, isCameraCapture, isDownload);

  return {
    is_screen_recording: isScreenRecording,
    is_download: isDownload,
    is_camera_capture: isCameraCapture,
    likely_source: likelySource,
    has_sequential_name: hasSequentialVideoName(fileName),
    is_timestamp_name: hasTimestampVideoName(fileName),
  };
}

/**
 * Build basic content hints used by downstream filtering/search.
 * @param {object} videoInfo - Video info block.
 * @param {object[]} audioTracks - Audio tracks.
 * @param {object[]} subtitleTracks - Subtitle tracks.
 * @param {{size?: number}} fileStats - File stats object.
 * @returns {object} Content hint flags.
 */
function buildContentHints(videoInfo, audioTracks, subtitleTracks, fileStats) {
  const duration = Number(videoInfo?.duration_seconds || 0);
  const width = Number(videoInfo?.display_width || videoInfo?.width || 0);
  const height = Number(videoInfo?.display_height || videoInfo?.height || 0);
  const fps = Number(videoInfo?.frame_rate || 0);
  const hasAudio = (Array.isArray(audioTracks) ? audioTracks.length : 0) > 0;
  const hasSubtitles = (Array.isArray(subtitleTracks) ? subtitleTracks.length : 0) > 0;
  const sizeBytes = Number(fileStats?.size || 0);
  const normalizedOrientation = String(videoInfo?.orientation || inferOrientation(width, height));

  return {
    media_type: "video",
    duration_seconds: Number.isFinite(duration) ? duration : null,
    is_short_clip: Number.isFinite(duration) ? duration < 15 : false,
    is_long_form: Number.isFinite(duration) ? duration > 30 * 60 : false,
    is_high_frame_rate: Number.isFinite(fps) ? fps >= 50 : false,
    is_vertical_video: normalizedOrientation === "portrait",
    has_audio: hasAudio,
    has_subtitles: hasSubtitles,
    likely_animated: Number.isFinite(fps) && fps >= 20 && width <= 1280 && height <= 720,
    file_size_category: categorizeVideoFileSize(sizeBytes),
  };
}

/**
 * Bucketize duration into UI/search-friendly labels.
 * @param {number} durationSeconds - Duration in seconds.
 * @returns {string} Duration bucket label.
 */
function deriveDurationBucket(durationSeconds) {
  const duration = Number(durationSeconds || 0);
  if (!Number.isFinite(duration) || duration <= 0) {
    return "unknown";
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

/**
 * Infer audio type from tracks/channels/sample-rate heuristics.
 * @param {object[]} audioTracks - Audio track rows.
 * @returns {"silent"|"speech"|"music"|"sfx"} Audio type label.
 */
function deriveAudioType(audioTracks) {
  const tracks = Array.isArray(audioTracks) ? audioTracks : [];
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

/**
 * Infer motion level from frame-rate/bitrate/source heuristics.
 * @param {object} videoInfo - Video info block.
 * @param {object} source - Source detection payload.
 * @returns {"static camera"|"slow"|"fast/action"|"unknown"} Motion category.
 */
function deriveMotionLevel(videoInfo, source) {
  const fps = Number(videoInfo?.frame_rate || 0);
  const bitrate = Number(videoInfo?.bitrate || 0);
  const likelySource = String(source?.likely_source || "").toLowerCase();

  if (likelySource === "screen_recording") {
    return "static camera";
  }

  if (!Number.isFinite(fps) || fps <= 0) {
    return "unknown";
  }

  if (fps <= 24 && bitrate < 5_000_000) {
    return "static camera";
  }
  if (fps <= 40) {
    return "slow";
  }
  return "fast/action";
}

/**
 * Build explicit filter-ready video fields.
 * @param {object} videoInfo - Video info block.
 * @param {object[]} audioTracks - Audio tracks.
 * @param {object[]} subtitleTracks - Subtitle tracks.
 * @param {object} source - Source payload.
 * @returns {object} Filter projection payload.
 */
function buildVideoFilteringData(videoInfo, audioTracks, subtitleTracks, source) {
  const width = Number(videoInfo?.display_width || videoInfo?.width || 0);
  const height = Number(videoInfo?.display_height || videoInfo?.height || 0);
  const megapixels = width > 0 && height > 0 ? (width * height) / 1_000_000 : null;
  const resolutionMegapixels =
    width > 0 && height > 0 && Number.isFinite(megapixels)
      ? `${Math.round(width)}x${Math.round(height)} (~${megapixels.toFixed(2)}mp)`
      : "";

  const fps = Number(videoInfo?.frame_rate || 0);
  const hasAudio = (Array.isArray(audioTracks) ? audioTracks.length : 0) > 0;
  const hasCaptions = (Array.isArray(subtitleTracks) ? subtitleTracks.length : 0) > 0;

  return {
    resolutionMegapixels,
    aspectRatio: String(videoInfo?.aspect_ratio_string || ""),
    orientation: String(videoInfo?.orientation || "unknown"),
    durationBucket: deriveDurationBucket(videoInfo?.duration_seconds),
    fps: Number.isFinite(fps) && fps > 0 ? Number(fps.toFixed(2)) : null,
    hasAudio,
    audioType: deriveAudioType(audioTracks),
    hasCaptions,
    motionLevel: deriveMotionLevel(videoInfo, source),
  };
}

/**
 * Build fallback format info when ffprobe is unavailable.
 * @param {string} filePath - Video file path.
 * @param {{size?: number}} fileStats - Stat payload.
 * @returns {object} Fallback format info block.
 */
function buildFallbackFormatInfo(filePath, fileStats) {
  const ext = path.extname(filePath).toLowerCase().replace(".", "");
  const durationGuess = null;
  return {
    container: ext || null,
    format_name: ext || null,
    format_long_name: null,
    duration_seconds: durationGuess,
    size_bytes: Number(fileStats?.size || 0),
    overall_bitrate: null,
    probe_source: "fallback",
    tags: {},
  };
}

/**
 * Build normalized search metadata fields for semantic search.
 * @param {object} videoMeta - Final extracted metadata object.
 * @param {string} filePath - Video path.
 * @returns {object} Search metadata projection.
 */
function buildSearchMetadata(videoMeta, filePath) {
  const format = String(videoMeta?.video_info?.format || "").toLowerCase();
  const orientation = String(videoMeta?.video_info?.orientation || "").toLowerCase();
  const quality = String(videoMeta?.video_info?.resolution_category || "").toLowerCase();
  const source = String(videoMeta?.source?.likely_source || "").toLowerCase();
  const filtering = videoMeta?.filtering && typeof videoMeta.filtering === "object" ? videoMeta.filtering : {};

  const tags = [
    format,
    orientation,
    quality,
    source,
    "video",
    String(filtering.durationBucket || "").toLowerCase(),
    String(filtering.motionLevel || "").toLowerCase(),
    String(filtering.audioType || "").toLowerCase(),
  ].filter(Boolean);

  return {
    title: String(videoMeta?.name || cleanNameForTitle(filePath)),
    description: String(videoMeta?.summary || `Video from ${path.dirname(filePath)}`),
    tags,
    objects: [],
    style: source || "video",
    dominant_colors: [],
    contains_people: null,
    contains_text: videoMeta?.content_hints?.has_subtitles === true,
    media_type: "video",
    resolution_megapixels: String(filtering.resolutionMegapixels || ""),
    aspect_ratio: String(filtering.aspectRatio || ""),
    orientation: String(filtering.orientation || orientation || ""),
    duration_bucket: String(filtering.durationBucket || ""),
    fps: Number.isFinite(Number(filtering.fps)) ? Number(filtering.fps) : null,
    has_audio: filtering.hasAudio === true,
    audio_type: String(filtering.audioType || ""),
    has_captions: filtering.hasCaptions === true,
    motion_level: String(filtering.motionLevel || ""),
  };
}

/**
 * Extract complete local metadata for a single video.
 * @param {string} filePath - Absolute video path.
 * @param {object} [basicInfo={}] - Base scan metadata.
 * @returns {Promise<object>} Fully composed video metadata object.
 */
async function extractVideoMetadata(filePath, basicInfo = {}) {
  const normalizedPath = String(filePath || "").trim();
  const ext = path.extname(normalizedPath).toLowerCase();

  if (!normalizedPath) {
    throw new Error("Video path is required.");
  }

  if (ext && !VIDEO_EXTENSIONS.has(ext)) {
    throw new Error(`Unsupported video extension: ${ext}`);
  }

  const processingErrors = [];
  const trackError = (label, error) => {
    processingErrors.push(`${label}: ${String(error?.message || error || "Unknown error")}`);
  };

  let fileStats = null;
  try {
    fileStats = await fs.stat(normalizedPath);
  } catch (error) {
    trackError("stat", error);
  }

  let hash = { md5: null, sha256: null };
  try {
    hash = await extractHashes(normalizedPath);
  } catch (error) {
    trackError("hash", error);
  }

  let ffprobe = { ok: false, error: "ffprobe not run" };
  try {
    ffprobe = await runFfprobe(normalizedPath);
    if (!ffprobe.ok) {
      trackError("ffprobe", ffprobe.error);
    }
  } catch (error) {
    trackError("ffprobe", error);
  }

  const streams = ffprobe?.data?.streams || [];
  const formatData = ffprobe?.data?.format || {};
  const chaptersData = ffprobe?.data?.chapters || [];

  const videoStreams = parseVideoStreams(streams);
  const audioStreams = parseAudioStreams(streams);
  const subtitleStreams = parseSubtitleStreams(streams);
  const chapters = parseChapters(chaptersData);

  const primaryVideo = videoStreams.primary || {};
  const durationSeconds =
    parseFormatDurationSeconds(formatData) ??
    parseDurationSeconds(primaryVideo.duration_seconds) ??
    null;

  const formatInfo = ffprobe.ok
    ? {
        container: String(formatData.format_name || "") || null,
        format_name: String(formatData.format_name || "") || null,
        format_long_name: String(formatData.format_long_name || "") || null,
        duration_seconds: durationSeconds,
        size_bytes: toNumberOrNull(formatData.size) ?? Number(fileStats?.size || 0),
        overall_bitrate: toNumberOrNull(formatData.bit_rate),
        probe_source: ffprobe.binary,
        tags: parseTags(formatData.tags),
      }
    : buildFallbackFormatInfo(normalizedPath, fileStats);

  const videoInfo = {
    codec: String(primaryVideo.codec || "") || null,
    width: toIntOrNull(primaryVideo.width),
    height: toIntOrNull(primaryVideo.height),
    display_width: toIntOrNull(primaryVideo.display_width),
    display_height: toIntOrNull(primaryVideo.display_height),
    orientation: String(primaryVideo.orientation || inferOrientation(primaryVideo.width, primaryVideo.height)),
    aspect_ratio: toNumberOrNull(primaryVideo.aspect_ratio),
    aspect_ratio_string: String(primaryVideo.aspect_ratio_string || "custom"),
    resolution_category: getResolutionCategory(primaryVideo.width, primaryVideo.height),
    frame_rate: toNumberOrNull(primaryVideo.frame_rate),
    frame_rate_category: String(primaryVideo.frame_rate_category || "unknown"),
    pixel_format: String(primaryVideo.pixel_format || "") || null,
    color_space: String(primaryVideo.color_space || "") || null,
    bitrate: toNumberOrNull(primaryVideo.bitrate),
    bitrate_category: String(primaryVideo.bitrate_category || "unknown"),
    duration_seconds: durationSeconds,
    track_count: videoStreams.count,
    tracks: videoStreams.tracks,
  };

  const source = detectSource(normalizedPath);
  const contentHints = buildContentHints(videoInfo, audioStreams.tracks, subtitleStreams.tracks, fileStats);

  const metadata = {
    id: basicInfo.id,
    path: normalizedPath,
    image_path: normalizedPath,
    name: path.basename(normalizedPath),
    extension: ext,
    directory: path.dirname(normalizedPath),
    size_bytes: Number(fileStats?.size || basicInfo.size_bytes || 0),
    created_at: toIsoOrNull(fileStats?.birthtime || basicInfo.created_at),
    modified_at: toIsoOrNull(fileStats?.mtime || basicInfo.modified_at),
    first_seen_at: toIsoOrNull(basicInfo.first_seen_at) || new Date().toISOString(),
    last_seen_at: new Date().toISOString(),
    media_type: "video",
    status: processingErrors.length > 0 && !ffprobe.ok ? "metadata_fallback" : "metadata_extracted",

    hash,
    format_info: formatInfo,
    video_info: videoInfo,
    audio_info: {
      track_count: audioStreams.count,
      tracks: audioStreams.tracks,
    },
    subtitle_info: {
      track_count: subtitleStreams.count,
      tracks: subtitleStreams.tracks,
    },
    chapters,

    source,
    content_hints: contentHints,

    // Explicit filter-ready fields for local filtering/search.
    filtering: buildVideoFilteringData(videoInfo, audioStreams.tracks, subtitleStreams.tracks, source),

    ai_analysis: {
      clip_embedding: null,
      objects_detected: [],
      scene_description: null,
      contains_people: null,
      contains_text: contentHints.has_subtitles,
      ocr_text: null,
      indexed_at: null,
    },

    summary: buildVideoSummary(videoInfo, audioStreams.tracks, subtitleStreams.tracks),
    search_metadata: null,

    processing: {
      metadata_extracted_at: new Date().toISOString(),
      extraction_version: "1.0.0",
      probe_available: ffprobe.ok,
      errors: processingErrors,
    },
  };

  metadata.search_metadata = buildSearchMetadata(metadata, normalizedPath);
  return metadata;
}

/**
 * Batch extract metadata for many video files.
 * @param {Array<{path:string}>} fileRecords - Video record list.
 * @param {{concurrency?: number, onProgress?: Function|null, onError?: Function|null}} [options={}] - Batch options.
 * @returns {Promise<{results: object[], errors: object[], summary: object}>} Batch result summary.
 */
async function batchExtractVideoMetadata(fileRecords, options = {}) {
  const { concurrency = 4, onProgress = null, onError = null } = options;
  const records = Array.isArray(fileRecords) ? fileRecords : [];

  const results = [];
  const errors = [];

  for (let i = 0; i < records.length; i += concurrency) {
    const batch = records.slice(i, i + concurrency);
    const settled = await Promise.allSettled(
      batch.map((record) => extractVideoMetadata(String(record?.path || ""), record || {})),
    );

    settled.forEach((entry, idx) => {
      if (entry.status === "fulfilled") {
        results.push(entry.value);
      } else {
        const filePath = String(batch[idx]?.path || "");
        const reason = String(entry.reason?.message || entry.reason || "Unknown error");
        errors.push({ file: filePath, error: reason });
        if (typeof onError === "function") {
          onError(filePath, entry.reason);
        }
      }
    });

    if (typeof onProgress === "function") {
      onProgress({
        processed: Math.min(i + batch.length, records.length),
        total: records.length,
        errors: errors.length,
      });
    }
  }

  return {
    results,
    errors,
    summary: {
      total: records.length,
      successful: results.length,
      failed: errors.length,
    },
  };
}

export {
  toIsoOrNull,
  toNumberOrNull,
  toIntOrNull,
  parseFraction,
  getAspectRatioString,
  getResolutionCategory,
  inferOrientation,
  parseRotationDegrees,
  getEffectiveDisplayDimensions,
  normalizeVideoOrientation,
  normalizeCodecName,
  parseTags,
  deriveFrameRateCategory,
  deriveBitrateCategory,
  cleanNameForTitle,
  buildVideoSummary,
  extractVideoMetadata,
  batchExtractVideoMetadata,
  extractHashes,
  runFfprobe,
  parseVideoStreams,
  parseAudioStreams,
  parseSubtitleStreams,
  parseChapters,
  detectScreenRecordingFlag,
  detectCameraCaptureFlag,
  detectVideoDownloadFlag,
  determineLikelyVideoSource,
  hasSequentialVideoName,
  hasTimestampVideoName,
  categorizeVideoFileSize,
  detectSource,
  buildContentHints,
  deriveDurationBucket,
  deriveAudioType,
  deriveMotionLevel,
  buildVideoFilteringData,
  buildFallbackFormatInfo,
  buildSearchMetadata,
  VIDEO_EXTENSIONS,
};

const currentFilePath = fileURLToPath(import.meta.url);
const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === currentFilePath;

if (isDirectRun) {
  const testFilePath = process.argv[2];
  if (!testFilePath) {
    console.log("Usage: node local-video-metadata-extractor.js <path-to-video>");
    process.exit(1);
  }

  extractVideoMetadata(testFilePath)
    .then((metadata) => {
      console.log(JSON.stringify(metadata, null, 2));
    })
    .catch((error) => {
      console.error("Error:", error);
      process.exit(1);
    });
}
