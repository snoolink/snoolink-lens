import {
  BedrockRuntimeClient,
  ConverseCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { readFileSync, existsSync } from "fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join } from "path";
import { fileURLToPath } from "url";
import heicConvert from "heic-convert";
import sharp from "sharp";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadDotEnvFile() {
  const candidatePaths = [
    join(process.cwd(), ".env"),
    join(__dirname, ".env"),
  ];

  let envText = "";
  for (const candidatePath of candidatePaths) {
    if (!existsSync(candidatePath)) {
      continue;
    }

    try {
      envText = readFileSync(candidatePath, "utf-8");
      break;
    } catch {
      // Continue to next candidate path.
    }
  }

  if (!envText) {
    return;
  }

  const lines = envText.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadDotEnvFile();

// ── Config ────────────────────────────────────────────────────────────────────
const MODEL_ID = process.env.BEDROCK_VISION_MODEL || "qwen.qwen3-vl-235b-a22b";
const AWS_REGION = process.env.AWS_REGION || "us-east-1";
const MAX_MODEL_IMAGE_BYTES = 3_800_000;
const MAX_IMAGE_DIMENSION = 2048;
const MIN_JPEG_QUALITY = 45;

const AWS_CONFIG = {
  region: AWS_REGION,
  // Some local Node runtimes can fail Bedrock calls with HTTP/2 protocol errors.
  // Explicitly use Node HTTP handler for a stable transport path.
  requestHandler: new NodeHttpHandler(),
};

if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
  AWS_CONFIG.credentials = {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    ...(process.env.AWS_SESSION_TOKEN
      ? { sessionToken: process.env.AWS_SESSION_TOKEN }
      : {}),
  };
}
// ── Prompt ────────────────────────────────────────────────────────────────────
const DESCRIPTION_PROMPT = `
Analyze this image and return ONLY a valid JSON object — no markdown, no backticks, no explanation.

The JSON must include exactly these keys:

{
  "description": "<rich prose description here>",
  "sceneTags": ["sunset", "ocean", "couple", "golden hour"],
  "objectTags": ["surfboard", "passport", "backpack", "food"],
  "activityTags": ["hiking", "swimming", "eating", "sightseeing"],
  "socialMediaScore": 0,
  "instagramScore": 0,
  "aspectRatioSuitability": ["feed", "reel", "story", "youtube_thumbnail"],
  "aestheticStyle": "cinematic",
  "editingLevel": "lightly edited",
  "visualComplexity": "moderate",
  "heroElement": "person",
  "depthOfField": "shallow",
  "ocr": {
    "all_text": "<every word visible in the image concatenated into one searchable string>",
    "entries": [
      {
        "text": "<exact text as it appears>",
        "location": "sign | label | shirt | poster | screen | watermark | caption | background | other",
        "position": "top-left | top-center | top-right | center-left | center | center-right | bottom-left | bottom-center | bottom-right",
        "confidence": 0.0-1.0
      }
    ]
  }
}

--- DESCRIPTION RULES ---
Write one continuous paragraph of rich, thorough prose covering:
- Overall scene: what is happening, where, and when (time of day, season, setting)
- Subjects: every person, animal, or main object — appearance, clothing colors and styles, accessories, actions, expressions, body language
- Shot and framing: camera distance (close up, medium, wide), what part of subject is visible (half body, full body, face only), camera angle, depth of field
- Objects and spatial relationships: what is in the foreground, midground, and background and how they relate
- Colors: dominant colors, palette mood, lighting quality and direction
- Mood and atmosphere: emotional tone, aesthetic feel, energy
- Named locations or landmarks: state the full proper name if identifiable
- People count: state the exact number of people if any are visible
- Context: what activity or occasion this depicts, what content category it fits

--- SEARCH RETRIEVAL BOOST RULES ---
To improve downstream text matching, append this EXACT tail at the end of the description paragraph:
" Search vocabulary: <comma-separated terms>"

Rules for "Search vocabulary":
- Include 20-45 compact terms.
- Include canonical nouns + common synonyms for visible key entities.
- Include accessory and apparel terms whenever visible (for example: sunglasses, shades, aviators, eyewear, dark glasses, eyeglasses, spectacles, hat, cap, backpack, handbag, purse, sneakers, heels, boots, jacket, hoodie, dress, shirt).
- Include scene and photo-type terms (portrait, solo, group, selfie, close-up, full-body, outdoor, indoor, street, travel, event) when applicable.
- Include key attribute terms (color words, age cues like young/adult/child if strongly evident, and gender cues only if visually clear).
- Include obvious alternate spellings and likely user typo variants for the main terms when common (for example: sunglasses,sunglasses; eyeglasses,eye glasses).
- Never include terms that are not visually supported by the image.
- Keep terms short and lowercase, no sentences, no punctuation except commas.

--- AI METADATA RULES ---
- sceneTags/objectTags/activityTags: return 4-20 concise lowercase tags each, no duplicates.
- socialMediaScore and instagramScore must be integers in [0,100].
- aspectRatioSuitability values allowed: feed, reel, story, youtube_thumbnail.
- aestheticStyle allowed values: dark and moody, bright and airy, cinematic, vsco, editorial, documentary, high contrast, pastel, vintage, clean commercial.
- editingLevel allowed values: raw/natural, lightly edited, heavily filtered, hdr.
- visualComplexity allowed values: minimal, moderate, busy.
- heroElement allowed values: person, landscape, food, architecture, product, animal, group, vehicle, event, other.
- depthOfField allowed values: shallow, deep.

--- OCR RULES ---
- Scan the ENTIRE image for any visible text — signs, banners, shirts, hats, labels, price tags, menus, screens, watermarks, graffiti, license plates, book covers, logos, stickers, anything
- "all_text" must be a single space-separated string of every word found, in reading order, exactly as written including punctuation, capitalization, and numbers
- Each entry in "entries" captures one distinct text element with its exact wording, type, and position
- If no text is visible anywhere, set "all_text" to "" and "entries" to []
- Never paraphrase or summarize text — quote it exactly as it appears in the image

Return ONLY the raw JSON. No prose outside the JSON object.
`.trim();

// ── Helpers ───────────────────────────────────────────────────────────────────
function resolveFormat(imagePath) {
  const ext = extname(imagePath).toLowerCase().replace(".", "");
  const formatMap = { jpg: "jpeg", jpeg: "jpeg", png: "png", gif: "gif", webp: "webp" };
  const format = formatMap[ext];
  if (!format) throw new Error(`Unsupported image format: .${ext}`);
  return format;
}

function isHeicLikePath(imagePath) {
  const ext = extname(String(imagePath || "")).toLowerCase();
  return ext === ".heic" || ext === ".heif";
}

function loadImage(imagePath) {
  if (!existsSync(imagePath)) throw new Error(`Image not found: ${imagePath}`);
  return {
    bytes: readFileSync(imagePath),
    format: resolveFormat(imagePath),
  };
}

async function createTempJpegFromHeic(imagePath) {
  const sourceBytes = await readFile(imagePath);
  const convertedBytes = await heicConvert({
    buffer: sourceBytes,
    format: "JPEG",
    quality: 0.82,
  });

  const jpegBytes = await optimizeImageForModel(Buffer.from(convertedBytes));

  const tempDir = await mkdtemp(join(tmpdir(), "snoolink-cloud-heic-"));
  const baseName = basename(imagePath, extname(imagePath));
  const tempImagePath = join(tempDir, `${baseName}.jpg`);
  await writeFile(tempImagePath, Buffer.from(jpegBytes));

  return {
    tempDir,
    tempImagePath,
    bytes: Buffer.from(jpegBytes),
    format: "jpeg",
  };
}

async function optimizeImageForModel(inputBuffer) {
  let candidate = Buffer.from(inputBuffer);
  if (candidate.length <= MAX_MODEL_IMAGE_BYTES) {
    return candidate;
  }

  const qualities = [82, 74, 66, 58, MIN_JPEG_QUALITY];
  const dimensions = [MAX_IMAGE_DIMENSION, 1800, 1600, 1400, 1280, 1024];

  for (const dimension of dimensions) {
    for (const quality of qualities) {
      const out = await sharp(candidate)
        .rotate()
        .resize({
          width: dimension,
          height: dimension,
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality, mozjpeg: true })
        .toBuffer();

      if (out.length <= MAX_MODEL_IMAGE_BYTES) {
        return out;
      }

      candidate = out;
    }
  }

  throw new Error(
    `Image is too large for model request after optimization (${candidate.length} bytes > ${MAX_MODEL_IMAGE_BYTES} bytes).`,
  );
}

async function prepareImageForCloud(imagePath) {
  if (!existsSync(imagePath)) {
    throw new Error(`Image not found: ${imagePath}`);
  }

  if (!isHeicLikePath(imagePath)) {
    const direct = loadImage(imagePath);
    if (direct.bytes.length <= MAX_MODEL_IMAGE_BYTES) {
      return {
        imagePathUsedForModel: imagePath,
        bytes: direct.bytes,
        format: direct.format,
        cleanup: null,
      };
    }

    const optimizedBytes = await optimizeImageForModel(direct.bytes);
    const tempDir = await mkdtemp(join(tmpdir(), "snoolink-cloud-img-"));
    const baseName = basename(imagePath, extname(imagePath));
    const tempImagePath = join(tempDir, `${baseName}.jpg`);
    await writeFile(tempImagePath, optimizedBytes);

    return {
      imagePathUsedForModel: tempImagePath,
      bytes: optimizedBytes,
      format: "jpeg",
      cleanup: async () => {
        await rm(tempDir, { recursive: true, force: true });
      },
    };
  }

  try {
    const converted = await createTempJpegFromHeic(imagePath);
    return {
      imagePathUsedForModel: converted.tempImagePath,
      bytes: converted.bytes,
      format: converted.format,
      cleanup: async () => {
        await rm(converted.tempDir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    throw new Error(`Failed to convert HEIC/HEIF to temporary JPEG: ${String(error?.message || error)}`);
  }
}

function extractText(response) {
  return (response?.output?.message?.content ?? [])
    .filter((b) => "text" in b)
    .map((b) => b.text)
    .join("")
    .trim();
}

function parseResponse(raw) {
  const clean = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  try {
    return JSON.parse(clean);
  } catch (err) {
    throw new Error(`Failed to parse model response as JSON:\n${clean}\n\nParse error: ${err.message}`);
  }
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set();
  const out = [];
  for (const entry of value) {
    const tag = String(entry || "").trim().toLowerCase();
    if (!tag || seen.has(tag)) {
      continue;
    }
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

function clampScore(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(num)));
}

function normalizeAspectRatioSuitability(value) {
  const allowed = new Set(["feed", "reel", "story", "youtube_thumbnail"]);
  return normalizeStringArray(value).filter((item) => allowed.has(item));
}

function normalizeCategorical(value, allowed, fallback = "") {
  const normalized = String(value || "").trim().toLowerCase();
  return allowed.has(normalized) ? normalized : fallback;
}

function normalizeCloudImageMetadata(parsed) {
  const aestheticAllowed = new Set([
    "dark and moody",
    "bright and airy",
    "cinematic",
    "vsco",
    "editorial",
    "documentary",
    "high contrast",
    "pastel",
    "vintage",
    "clean commercial",
  ]);
  const editingAllowed = new Set(["raw/natural", "lightly edited", "heavily filtered", "hdr"]);
  const complexityAllowed = new Set(["minimal", "moderate", "busy"]);
  const heroAllowed = new Set([
    "person",
    "landscape",
    "food",
    "architecture",
    "product",
    "animal",
    "group",
    "vehicle",
    "event",
    "other",
  ]);
  const dofAllowed = new Set(["shallow", "deep"]);

  return {
    description: String(parsed?.description || ""),
    sceneTags: normalizeStringArray(parsed?.sceneTags),
    objectTags: normalizeStringArray(parsed?.objectTags),
    activityTags: normalizeStringArray(parsed?.activityTags),
    socialMediaScore: clampScore(parsed?.socialMediaScore),
    instagramScore: clampScore(parsed?.instagramScore),
    aspectRatioSuitability: normalizeAspectRatioSuitability(parsed?.aspectRatioSuitability),
    aestheticStyle: normalizeCategorical(parsed?.aestheticStyle, aestheticAllowed, ""),
    editingLevel: normalizeCategorical(parsed?.editingLevel, editingAllowed, ""),
    visualComplexity: normalizeCategorical(parsed?.visualComplexity, complexityAllowed, ""),
    heroElement: normalizeCategorical(parsed?.heroElement, heroAllowed, "other"),
    depthOfField: normalizeCategorical(parsed?.depthOfField, dofAllowed, ""),
    ocr: parsed?.ocr && typeof parsed.ocr === "object"
      ? {
          all_text: String(parsed.ocr.all_text || ""),
          entries: Array.isArray(parsed.ocr.entries) ? parsed.ocr.entries : [],
        }
      : { all_text: "", entries: [] },
  };
}

function isRequestBodyTooLargeError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return (
    message.includes("length limit exceeded") ||
    message.includes("failed to buffer the request body") ||
    message.includes("validation_error")
  );
}

async function buildAggressiveImageVariants(inputBuffer) {
  const variants = [];
  const recipes = [
    { width: 1400, quality: 58 },
    { width: 1200, quality: 50 },
    { width: 1024, quality: 44 },
    { width: 900, quality: 38 },
  ];

  for (const recipe of recipes) {
    const out = await sharp(inputBuffer)
      .rotate()
      .resize({
        width: recipe.width,
        height: recipe.width,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: recipe.quality, mozjpeg: true })
      .toBuffer();
    variants.push(out);
  }

  return variants;
}

async function invokeVisionModel(client, { modelId, bytes, format, prompt, maxTokens }) {
  const command = new ConverseCommand({
    modelId,
    messages: [
      {
        role: "user",
        content: [
          { image: { format, source: { bytes } } },
          { text: prompt },
        ],
      },
    ],
    inferenceConfig: {
      maxTokens,
      temperature: 0.1,
    },
  });

  const response = await client.send(command);
  const raw = extractText(response);
  return parseResponse(raw);
}

// ── Core function ─────────────────────────────────────────────────────────────
/**
 * Sends an image to AWS Bedrock (Qwen) and returns a structured object with
 * a rich prose description and fully extracted OCR data.
 *
 * @param {string} imagePath   - Path to the image file
 * @param {object} [options]
 * @param {string} [options.modelId]
 * @param {string} [options.prompt]
 * @param {number} [options.maxTokens]
 * @returns {Promise<{
 *   image_path: string,
 *   model_id: string,
 *   analyzed_at: string,
 *   description: string,
 *   ocr: { all_text: string, entries: Array }
 * }>}
 */
export async function describeImage(imagePath, options = {}) {
  const {
    modelId = MODEL_ID,
    prompt = DESCRIPTION_PROMPT,
    maxTokens = 2048,
  } = options;

  const prepared = await prepareImageForCloud(imagePath);
  try {
    const { bytes, format } = prepared;
    const client = new BedrockRuntimeClient(AWS_CONFIG);

    let parsed = null;
    try {
      parsed = await invokeVisionModel(client, {
        modelId,
        bytes,
        format,
        prompt,
        maxTokens,
      });
    } catch (error) {
      if (!isRequestBodyTooLargeError(error)) {
        throw error;
      }

      const fallbackVariants = await buildAggressiveImageVariants(bytes);
      let success = false;
      let lastError = error;

      for (const variantBytes of fallbackVariants) {
        try {
          parsed = await invokeVisionModel(client, {
            modelId,
            bytes: variantBytes,
            format: "jpeg",
            prompt,
            maxTokens,
          });
          success = true;
          break;
        } catch (variantError) {
          lastError = variantError;
          if (!isRequestBodyTooLargeError(variantError)) {
            throw variantError;
          }
        }
      }

      if (!success) {
        throw new Error(
          `Cloud image request exceeded model request limits after aggressive compression attempts. ${String(lastError?.message || lastError)}`,
        );
      }
    }

    const normalized = normalizeCloudImageMetadata(parsed);

    return {
      image_path: imagePath,
      model_id: modelId,
      analyzed_at: new Date().toISOString(),
      description: normalized.description,
      sceneTags: normalized.sceneTags,
      objectTags: normalized.objectTags,
      activityTags: normalized.activityTags,
      socialMediaScore: normalized.socialMediaScore,
      instagramScore: normalized.instagramScore,
      aspectRatioSuitability: normalized.aspectRatioSuitability,
      aestheticStyle: normalized.aestheticStyle,
      editingLevel: normalized.editingLevel,
      visualComplexity: normalized.visualComplexity,
      heroElement: normalized.heroElement,
      depthOfField: normalized.depthOfField,
      ocr: normalized.ocr,
    };
  } finally {
    if (typeof prepared.cleanup === "function") {
      await prepared.cleanup();
    }
  }
}

// ── CLI entrypoint ────────────────────────────────────────────────────────────
async function main() {
  const imagePath = process.argv[2];

  if (!imagePath) {
    console.error("Usage: node describeImage.js <image_path>");
    process.exit(1);
  }

  console.log(`Image : ${imagePath}`);
  console.log(`Model : ${MODEL_ID}`);
  console.log("-".repeat(50));

  try {
    const result = await describeImage(imagePath);

    console.log("\nDescription:\n");
    console.log(result.description);

    console.log("\nOCR — all text:\n");
    console.log(result.ocr.all_text || "(none)");

    if (result.ocr.entries.length > 0) {
      console.log("\nOCR — entries:\n");
      result.ocr.entries.forEach((e, i) => {
        console.log(`  [${i + 1}] "${e.text}" · ${e.location} · ${e.position} · confidence ${e.confidence}`);
      });
    }
  } catch (err) {
    console.error(`Error: ${err?.message || err}`);
    if (err?.name) {
      console.error(`Name: ${err.name}`);
    }
    if (err?.Code || err?.code) {
      console.error(`Code: ${err.Code || err.code}`);
    }
    if (err?.$metadata) {
      console.error(`Metadata: ${JSON.stringify(err.$metadata)}`);
    }
    if (err?.cause) {
      console.error(`Cause: ${String(err.cause?.message || err.cause)}`);
    }
    if (err?.stack) {
      console.error(err.stack);
    }
    process.exit(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}