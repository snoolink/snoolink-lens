import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import path, { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { describeImage } from "./cloud-image-metadata-extractor.js";

const execFileAsync = promisify(execFile);

const VIDEO_EXTENSIONS = new Set([
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

const DEFAULT_FRAME_INTERVAL_SECONDS = 1;
// Lowered default max frames for RAM efficiency
const MAX_ANALYZED_FRAMES = 100;
let cachedFfmpegBinary = "";
let cachedFfprobeBinary = "";

function ensureVideoPath(videoPath) {
  const normalized = String(videoPath || "").trim();
  if (!normalized) {
    throw new Error("Video path is required.");
  }

  if (!existsSync(normalized)) {
    throw new Error(`Video not found: ${normalized}`);
  }

  const ext = path.extname(normalized).toLowerCase();
  if (ext && !VIDEO_EXTENSIONS.has(ext)) {
    throw new Error(`Unsupported video extension: ${ext}`);
  }

  return normalized;
}

function normalizeBinaryFromEnv(pathOrDir, binaryName) {
  const value = String(pathOrDir || "").trim();
  if (!value) {
    return "";
  }

  const exeName = process.platform === "win32" ? `${binaryName}.exe` : binaryName;
  if (existsSync(value)) {
    return value;
  }

  const combined = join(value, exeName);
  if (existsSync(combined)) {
    return combined;
  }

  return "";
}

async function resolveWingetBinary(binaryName) {
  if (process.platform !== "win32") {
    return "";
  }

  const localAppData = String(process.env.LOCALAPPDATA || "").trim();
  if (!localAppData) {
    return "";
  }

  const packagesRoot = join(localAppData, "Microsoft", "WinGet", "Packages");
  if (!existsSync(packagesRoot)) {
    return "";
  }

  let packageEntries = [];
  try {
    packageEntries = await readdir(packagesRoot, { withFileTypes: true });
  } catch {
    return "";
  }

  const ffmpegPackages = packageEntries
    .filter((entry) => entry.isDirectory() && entry.name.toLowerCase().startsWith("gyan.ffmpeg_"))
    .map((entry) => join(packagesRoot, entry.name));

  const binaryFileName = `${binaryName}.exe`;
  for (const pkgPath of ffmpegPackages) {
    let childEntries = [];
    try {
      childEntries = await readdir(pkgPath, { withFileTypes: true });
    } catch {
      childEntries = [];
    }

    for (const child of childEntries) {
      if (!child.isDirectory()) {
        continue;
      }
      const candidate = join(pkgPath, child.name, "bin", binaryFileName);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return "";
}

function resolveCommonBinaryPath(binaryName) {
  const candidates = [];

  if (process.platform === "darwin") {
    candidates.push(
      `/opt/homebrew/bin/${binaryName}`,
      `/usr/local/bin/${binaryName}`,
      `/opt/local/bin/${binaryName}`,
    );
  }

  if (process.platform === "linux") {
    candidates.push(
      `/usr/bin/${binaryName}`,
      `/usr/local/bin/${binaryName}`,
      `/snap/bin/${binaryName}`,
    );
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return "";
}

async function resolveMediaBinary(binaryName) {
  if (binaryName === "ffmpeg" && cachedFfmpegBinary) {
    return cachedFfmpegBinary;
  }
  if (binaryName === "ffprobe" && cachedFfprobeBinary) {
    return cachedFfprobeBinary;
  }

  const envVarName = binaryName === "ffmpeg" ? "FFMPEG_PATH" : "FFPROBE_PATH";
  const fromEnv = normalizeBinaryFromEnv(process.env[envVarName], binaryName);
  if (fromEnv) {
    if (binaryName === "ffmpeg") {
      cachedFfmpegBinary = fromEnv;
    } else {
      cachedFfprobeBinary = fromEnv;
    }
    return fromEnv;
  }

  const fromWinget = await resolveWingetBinary(binaryName);
  if (fromWinget) {
    if (binaryName === "ffmpeg") {
      cachedFfmpegBinary = fromWinget;
    } else {
      cachedFfprobeBinary = fromWinget;
    }
    return fromWinget;
  }

  const fromCommonPath = resolveCommonBinaryPath(binaryName);
  if (fromCommonPath) {
    if (binaryName === "ffmpeg") {
      cachedFfmpegBinary = fromCommonPath;
    } else {
      cachedFfprobeBinary = fromCommonPath;
    }
    return fromCommonPath;
  }

  if (binaryName === "ffmpeg") {
    cachedFfmpegBinary = binaryName;
  } else {
    cachedFfprobeBinary = binaryName;
  }
  return binaryName;
}

async function probeVideoDurationSeconds(videoPath) {
  const ffprobeBinary = await resolveMediaBinary("ffprobe");
  const args = [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    videoPath,
  ];

  let stdout = "";
  try {
    const output = await execFileAsync(ffprobeBinary, args, {
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    });
    stdout = output.stdout;
  } catch (error) {
    const code = String(error?.code || "").toUpperCase();
    if (code === "ENOENT") {
      throw new Error(
        "ffprobe was not found. Install FFmpeg and/or set FFPROBE_PATH to the ffprobe binary path.",
      );
    }
    throw error;
  }

  const parsed = Number(String(stdout || "").trim());
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
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

async function extractFramesByInterval(videoPath, outputDir, frameIntervalSeconds) {
  const ffmpegBinary = await resolveMediaBinary("ffmpeg");
  const outputPattern = join(outputDir, "frame-%06d.jpg");
  const safeInterval = Number(frameIntervalSeconds) > 0 ? Number(frameIntervalSeconds) : DEFAULT_FRAME_INTERVAL_SECONDS;
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    videoPath,
    "-map",
    "0:v:0",
    "-vf",
    `fps=1/${safeInterval}`,
    "-q:v",
    "3",
    outputPattern,
  ];

  try {
    await execFileAsync(ffmpegBinary, args, {
      windowsHide: true,
      maxBuffer: 20 * 1024 * 1024,
    });
  } catch (error) {
    const code = String(error?.code || "").toUpperCase();
    if (code === "ENOENT") {
      throw new Error(
        "ffmpeg was not found. Install FFmpeg and/or set FFMPEG_PATH to the ffmpeg binary path.",
      );
    }
    throw error;
  }
}

async function normalizeMovToMp4(sourcePath, targetPath) {
  const ffmpegBinary = await resolveMediaBinary("ffmpeg");

  const remuxArgs = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    sourcePath,
    "-map",
    "0:v:0",
    "-an",
    "-c:v",
    "copy",
    "-movflags",
    "+faststart",
    targetPath,
  ];

  try {
    await execFileAsync(ffmpegBinary, remuxArgs, {
      windowsHide: true,
      maxBuffer: 20 * 1024 * 1024,
    });
    return;
  } catch {
    // Fall through to full re-encode when stream-copy is not possible.
  }

  const reencodeArgs = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    sourcePath,
    "-map",
    "0:v:0",
    "-an",
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
    targetPath,
  ];

  try {
    await execFileAsync(ffmpegBinary, reencodeArgs, {
      windowsHide: true,
      maxBuffer: 20 * 1024 * 1024,
    });
  } catch (error) {
    const code = String(error?.code || "").toUpperCase();
    if (code === "ENOENT") {
      throw new Error(
        "ffmpeg was not found. Install FFmpeg and/or set FFMPEG_PATH to the ffmpeg binary path.",
      );
    }
    throw error;
  }
}

function aggregateOcr(frameRows) {
  const entries = [];
  const allTextParts = [];

  for (const frame of frameRows) {
    const ocr = frame?.ocr || { all_text: "", entries: [] };
    const allText = String(ocr?.all_text || "").trim();
    if (allText) {
      allTextParts.push(allText);
    }

    const ocrEntries = Array.isArray(ocr?.entries) ? ocr.entries : [];
    for (const entry of ocrEntries) {
      entries.push({
        ...entry,
        second: frame.second,
      });
    }
  }

  return {
    all_text: allTextParts.join(" ").trim(),
    entries,
  };
}

function buildCombinedDescription(frameRows) {
  const lines = frameRows
    .map((frame) => {
      const description = String(frame?.description || "").trim();
      if (!description) {
        return "";
      }
      return `second ${frame.second}: ${description}`;
    })
    .filter(Boolean);

  return lines.join(" ").trim();
}

function uniqueLowerTags(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const tag = String(value || "").trim().toLowerCase();
    if (!tag || seen.has(tag)) {
      continue;
    }
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

function averageScore(values) {
  const nums = values.map((v) => Number(v)).filter((v) => Number.isFinite(v));
  if (nums.length === 0) {
    return 0;
  }
  const avg = nums.reduce((sum, value) => sum + value, 0) / nums.length;
  return Math.max(0, Math.min(100, Math.round(avg)));
}

function modeOf(values, fallback = "") {
  const freq = new Map();
  for (const value of values) {
    const key = String(value || "").trim().toLowerCase();
    if (!key) {
      continue;
    }
    freq.set(key, (freq.get(key) || 0) + 1);
  }
  let best = fallback;
  let bestCount = 0;
  for (const [key, count] of freq.entries()) {
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  }
  return best;
}

function aggregateAiMetadata(frameRows) {
  const sceneTags = uniqueLowerTags(frameRows.flatMap((frame) => frame?.sceneTags || []));
  const objectTags = uniqueLowerTags(frameRows.flatMap((frame) => frame?.objectTags || []));
  const activityTags = uniqueLowerTags(frameRows.flatMap((frame) => frame?.activityTags || []));
  const aspectRatioSuitability = uniqueLowerTags(frameRows.flatMap((frame) => frame?.aspectRatioSuitability || []));

  return {
    sceneTags,
    objectTags,
    activityTags,
    socialMediaScore: averageScore(frameRows.map((frame) => frame?.socialMediaScore)),
    instagramScore: averageScore(frameRows.map((frame) => frame?.instagramScore)),
    aspectRatioSuitability,
    aestheticStyle: modeOf(frameRows.map((frame) => frame?.aestheticStyle), ""),
    editingLevel: modeOf(frameRows.map((frame) => frame?.editingLevel), ""),
    visualComplexity: modeOf(frameRows.map((frame) => frame?.visualComplexity), ""),
    heroElement: modeOf(frameRows.map((frame) => frame?.heroElement), "other"),
    depthOfField: modeOf(frameRows.map((frame) => frame?.depthOfField), ""),
  };
}

export async function describeVideo(videoPath, options = {}) {
  const normalizedVideoPath = ensureVideoPath(videoPath);
  const {
    modelId,
    prompt,
    maxTokens = 2048,
    maxFrames = MAX_ANALYZED_FRAMES,
    batchSize = 10, // New: process frames in batches
  } = options;

  const tempDir = await mkdtemp(join(tmpdir(), "snoolink-cloud-video-"));

  try {
    let durationSeconds = null;
    try {
      durationSeconds = await probeVideoDurationSeconds(normalizedVideoPath);
    } catch {
      durationSeconds = null;
    }

    const frameIntervalSeconds = pickFrameIntervalSeconds(durationSeconds);
    let extractionSourcePath = normalizedVideoPath;
    let frameFiles = [];
    let firstExtractionError = "";

    try {
      await extractFramesByInterval(extractionSourcePath, tempDir, frameIntervalSeconds);
      frameFiles = (await readdir(tempDir))
        .filter((name) => name.toLowerCase().endsWith(".jpg"))
        .sort((a, b) => a.localeCompare(b));
    } catch (error) {
      firstExtractionError = String(error?.message || error);
    }

    // Some MOV containers/codecs fail direct frame extraction; normalize to MP4 and retry.
    if (frameFiles.length === 0 && path.extname(normalizedVideoPath).toLowerCase() === ".mov") {
      const normalizedMovPath = join(tempDir, "normalized-mov.mp4");
      await normalizeMovToMp4(normalizedVideoPath, normalizedMovPath);
      extractionSourcePath = normalizedMovPath;
      await extractFramesByInterval(extractionSourcePath, tempDir, frameIntervalSeconds);
      frameFiles = (await readdir(tempDir))
        .filter((name) => name.toLowerCase().endsWith(".jpg"))
        .sort((a, b) => a.localeCompare(b));
    }

    if (frameFiles.length === 0) {
      const details = firstExtractionError ? ` Initial extraction error: ${firstExtractionError}` : "";
      throw new Error(`No frames extracted from video. Ensure ffmpeg is installed and the video is readable.${details}`);
    }

    if (Number.isFinite(maxFrames) && maxFrames > 0 && frameFiles.length > maxFrames) {
      frameFiles = frameFiles.slice(0, maxFrames);
    }

    // Batch processing for RAM efficiency
    const frames = [];
    for (let batchStart = 0; batchStart < frameFiles.length; batchStart += batchSize) {
      const batchEnd = Math.min(batchStart + batchSize, frameFiles.length);
      const batch = frameFiles.slice(batchStart, batchEnd);
      for (let i = 0; i < batch.length; i += 1) {
        const frameIdx = batchStart + i;
        const framePath = join(tempDir, batch[i]);
        const second = Number((frameIdx * frameIntervalSeconds).toFixed(3));
        try {
          const frameResult = await describeImage(framePath, {
            modelId,
            prompt,
            maxTokens,
          });
          frames.push({
            second,
            frame_file: batch[i],
            description: String(frameResult?.description || ""),
            sceneTags: Array.isArray(frameResult?.sceneTags) ? frameResult.sceneTags : [],
            objectTags: Array.isArray(frameResult?.objectTags) ? frameResult.objectTags : [],
            activityTags: Array.isArray(frameResult?.activityTags) ? frameResult.activityTags : [],
            socialMediaScore: Number(frameResult?.socialMediaScore || 0),
            instagramScore: Number(frameResult?.instagramScore || 0),
            aspectRatioSuitability: Array.isArray(frameResult?.aspectRatioSuitability) ? frameResult.aspectRatioSuitability : [],
            aestheticStyle: String(frameResult?.aestheticStyle || ""),
            editingLevel: String(frameResult?.editingLevel || ""),
            visualComplexity: String(frameResult?.visualComplexity || ""),
            heroElement: String(frameResult?.heroElement || ""),
            depthOfField: String(frameResult?.depthOfField || ""),
            ocr: frameResult?.ocr || { all_text: "", entries: [] },
            status: "ok",
            error: "",
          });
        } catch (error) {
          frames.push({
            second,
            frame_file: batch[i],
            description: "",
            ocr: { all_text: "", entries: [] },
            status: "failed",
            error: String(error?.message || error),
          });
        }
        // Explicit dereference and optional GC
        if (global.gc) global.gc();
      }
    }

    const successfulFrames = frames.filter((row) => row.status === "ok");
    const failedFrames = frames.length - successfulFrames.length;

    if (successfulFrames.length === 0) {
      const firstError = frames[0]?.error || "Video frame analysis failed for all sampled frames.";
      throw new Error(firstError);
    }

    const combinedDescription = buildCombinedDescription(successfulFrames);
    const aggregatedOcr = aggregateOcr(successfulFrames);
    const aggregatedAi = aggregateAiMetadata(successfulFrames);

    return {
      video_path: normalizedVideoPath,
      model_id: String(modelId || process.env.BEDROCK_VISION_MODEL || "qwen.qwen3-vl-235b-a22b"),
      analyzed_at: new Date().toISOString(),
      media_type: "video",
      duration_seconds: durationSeconds,
      frame_interval_seconds: frameIntervalSeconds,
      total_frames_extracted: frameFiles.length,
      successful_frames: successfulFrames.length,
      failed_frames: failedFrames,
      description: combinedDescription,
      sceneTags: aggregatedAi.sceneTags,
      objectTags: aggregatedAi.objectTags,
      activityTags: aggregatedAi.activityTags,
      socialMediaScore: aggregatedAi.socialMediaScore,
      instagramScore: aggregatedAi.instagramScore,
      aspectRatioSuitability: aggregatedAi.aspectRatioSuitability,
      aestheticStyle: aggregatedAi.aestheticStyle,
      editingLevel: aggregatedAi.editingLevel,
      visualComplexity: aggregatedAi.visualComplexity,
      heroElement: aggregatedAi.heroElement,
      depthOfField: aggregatedAi.depthOfField,
      ocr: aggregatedOcr,
      frames,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function main() {
  const videoPath = process.argv[2];

  if (!videoPath) {
    console.error("Usage: node cloud-video-metadata-extractor.js <video_path>");
    process.exit(1);
  }

  try {
    const result = await describeVideo(videoPath);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(String(error?.message || error));
    process.exit(1);
  }
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main();
}
