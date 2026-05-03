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
const MAX_ANALYZED_FRAMES = 300;
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
        "ffprobe was not found. Install FFmpeg and/or set FFPROBE_PATH to ffprobe.exe.",
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
    return 1;
  }
  if (duration < 15) {
    return 1.5;
  }
  if (duration < 30) {
    return 2;
  }
  if (duration < 60) {
    return 3;
  }

  return 5;
}

async function extractFramesByInterval(videoPath, outputDir, frameIntervalSeconds) {
  const ffmpegBinary = await resolveMediaBinary("ffmpeg");
  const outputPattern = join(outputDir, "frame-%06d.jpg");
  const safeInterval = Number(frameIntervalSeconds) > 0 ? Number(frameIntervalSeconds) : DEFAULT_FRAME_INTERVAL_SECONDS;
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    videoPath,
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
        "ffmpeg was not found. Install FFmpeg and/or set FFMPEG_PATH to ffmpeg.exe.",
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
    await extractFramesByInterval(normalizedVideoPath, tempDir, frameIntervalSeconds);

    let frameFiles = (await readdir(tempDir))
      .filter((name) => name.toLowerCase().endsWith(".jpg"))
      .sort((a, b) => a.localeCompare(b));

    if (frameFiles.length === 0) {
      throw new Error("No frames extracted from video. Ensure ffmpeg is installed and the video is readable.");
    }

    if (Number.isFinite(maxFrames) && maxFrames > 0 && frameFiles.length > maxFrames) {
      frameFiles = frameFiles.slice(0, maxFrames);
    }

    const frames = [];
    for (let i = 0; i < frameFiles.length; i += 1) {
      const framePath = join(tempDir, frameFiles[i]);
      const second = Number((i * frameIntervalSeconds).toFixed(3));

      try {
        const frameResult = await describeImage(framePath, {
          modelId,
          prompt,
          maxTokens,
        });

        frames.push({
          second,
          frame_file: frameFiles[i],
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
          frame_file: frameFiles[i],
          description: "",
          ocr: { all_text: "", entries: [] },
          status: "failed",
          error: String(error?.message || error),
        });
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
