/**
 * Local Image Metadata Extractor Module
 *
 * Purpose:
 * - Extract local-only image metadata, source hints, and filter-ready fields.
 * - Keep filter logic deterministic and independently testable.
 *
 * Filter composition model:
 * - Gather raw technical/image data.
 * - Run small single-purpose filter/transform functions.
 * - Compose outputs into `image_info`, `source`, `content_hints`, and `filtering`.
 *
 * Author/date:
 * - Snoolink Studios team
 * - Refactor completed: 2026-05-02
 * 
 * Dependencies:
 * - sharp: Image processing
 * - exifr: EXIF data extraction
 * - file-type: File type detection
 * - image-hash: Perceptual hashing
 */

import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import exifr from "exifr";
import imageHashModule from "image-hash";

const { imageHash } = imageHashModule;
const PERCEPTUAL_HASH_UNSUPPORTED_EXTENSIONS = new Set([".heic", ".heif", ".avif"]);
const UNSUPPORTED_DECODE_PATTERNS = [
  "No decoding plugin installed",
  "bad seek",
  "heif:",
  "unsupported image format",
  "Input file contains unsupported image format",
];

/**
 * Check whether an extraction error indicates unsupported local decoding.
 * @param {unknown} error - Error thrown by image parser/decoder.
 * @returns {boolean} True when error message matches unsupported decode patterns.
 */
function isDecodeUnsupportedError(error) {
  const message = String(error?.message || error || "");
  return UNSUPPORTED_DECODE_PATTERNS.some((pattern) => message.includes(pattern));
}

/**
 * Main metadata extraction function
 * @param {string} filePath - Absolute path to image file
 * @param {object} basicInfo - Basic file info from initial scan
 * @returns {Promise<object>} Complete metadata object
 */
async function extractImageMetadata(filePath, basicInfo = {}) {
  try {
    const processingErrors = [];
    const trackStageError = (label, error) => {
      const reason = String(error?.message || error || "Unknown error");
      processingErrors.push(`${label}: ${reason}`);
    };

    let hash;
    try {
      hash = await extractHashes(filePath);
    } catch (error) {
      trackStageError("hash", error);
      hash = {
        md5: null,
        sha256: null,
        perceptual_hash: null,
        perceptual_hash_algorithm: "pHash",
      };
    }

    let imageInfo;
    try {
      imageInfo = await extractImageInfo(filePath);
    } catch (error) {
      trackStageError("image_info", error);
      imageInfo = {
        width: null,
        height: null,
        aspect_ratio: null,
        aspect_ratio_string: "custom",
        orientation: "unknown",
        format: null,
        color_space: null,
        channels: null,
        has_alpha: false,
        bit_depth: null,
        density: null,
        is_progressive: false,
        megapixels: null,
        size_category: "unknown",
        compression: null,
        is_corrupt: true,
        is_grayscale: null,
      };
    }

    const exif = await extractExifData(filePath);
    imageInfo = applyExifImageInfoFallback(imageInfo, exif, filePath);

    let colorAnalysis;
    try {
      colorAnalysis = await extractColorAnalysis(filePath);
    } catch (error) {
      trackStageError("color_analysis", error);
      colorAnalysis = null;
    }

    const source = await detectSource(filePath, basicInfo);

    let contentHints;
    try {
      contentHints = await extractContentHints(filePath);
    } catch (error) {
      trackStageError("content_hints", error);
      contentHints = {
        might_contain_text: false,
        is_icon: false,
        is_banner: false,
        is_thumbnail: false,
        is_wallpaper: false,
      };
    }

    const metadata = {
      // From initial scan
      id: basicInfo.id,
      path: filePath,
      name: path.basename(filePath),
      extension: path.extname(filePath).toLowerCase(),
      directory: path.dirname(filePath),
      size_bytes: basicInfo.size_bytes,
      created_at: basicInfo.created_at,
      modified_at: basicInfo.modified_at,
      first_seen_at: basicInfo.first_seen_at,
      last_seen_at: new Date().toISOString(),
      status: 'processing',

      // NEW: File integrity & deduplication
      hash,

      // NEW: Image technical information
      image_info: imageInfo,

      // NEW: EXIF data
      exif,

      // NEW: Color analysis
      color_analysis: colorAnalysis,

      // NEW: Source detection
      source,

      // NEW: Content detection (basic, no ML)
      content_hints: contentHints,

      // Explicit filter-ready fields for local filtering/search.
      filtering: buildImageFilteringData(imageInfo),

      // Placeholder for future AI indexing
      ai_analysis: {
        clip_embedding: null,
        objects_detected: [],
        scene_description: null,
        contains_people: null,
        contains_text: null,
        ocr_text: null,
        indexed_at: null
      },

      // Processing metadata
      processing: {
        metadata_extracted_at: new Date().toISOString(),
        extraction_version: '1.0.0',
        errors: processingErrors
      }
    };

    metadata.status = 'metadata_extracted';
    return metadata;

  } catch (error) {
    console.error(`Error processing ${filePath}:`, error);
    return {
      ...basicInfo,
      status: 'error',
      processing: {
        metadata_extracted_at: new Date().toISOString(),
        errors: [error.message]
      }
    };
  }
}

/**
 * Extract cryptographic and perceptual hashes for dedupe pipelines.
 * @param {string} filePath - Absolute path to image file.
 * @returns {Promise<{md5: string, sha256: string, perceptual_hash: string|null, perceptual_hash_algorithm: string}>} Hash payload.
 */
async function extractHashes(filePath) {
  const fileBuffer = await fs.readFile(filePath);
  
  // MD5 for exact duplicate detection
  const md5 = crypto.createHash('md5').update(fileBuffer).digest('hex');
  
  // SHA256 for more secure hashing (optional, slower)
  const sha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');
  
  // Perceptual hash for near-duplicate detection
  const perceptualHash = await getPerceptualHash(filePath);
  
  return {
    md5,
    sha256,
    perceptual_hash: perceptualHash,
    perceptual_hash_algorithm: 'pHash' // or dHash, aHash
  };
}

/**
 * Compute perceptual hash for near-duplicate comparison.
 * @param {string} filePath - Absolute image path.
 * @returns {Promise<string|null>} Perceptual hash or null when unsupported/unavailable.
 */
function getPerceptualHash(filePath) {
  return new Promise((resolve, reject) => {
    const ext = path.extname(String(filePath || "")).toLowerCase();
    if (PERCEPTUAL_HASH_UNSUPPORTED_EXTENSIONS.has(ext)) {
      resolve(null);
      return;
    }

    imageHash(filePath, 16, true, (error, data) => {
      if (error) {
        const message = String(error?.message || error || "");
        if (!message.includes("Unrecognized file extension") && !isDecodeUnsupportedError(error)) {
          console.warn("Perceptual hash failed:", message);
        }
        resolve(null);
      } else {
        resolve(data);
      }
    });
  });
}

/**
 * Normalize EXIF scalar/string values to nullable clean values.
 * @param {unknown} value - Raw EXIF value.
 * @returns {unknown|null} Trimmed value or null when empty.
 */
function cleanExifValue(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return value;
}

/**
 * Parse EXIF value into an integer when possible.
 * @param {unknown} value - Raw EXIF value (scalar or array).
 * @returns {number|null} Parsed integer or null when invalid.
 */
function parseExifNumber(value) {
  if (value === undefined || value === null) return null;
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number.parseInt(String(raw), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Determine whether EXIF orientation implies display dimension swap.
 * @param {number|null} orientation - EXIF orientation value.
 * @returns {boolean} True when width/height should be swapped.
 */
function exifOrientationSwapsDimensions(orientation) {
  const value = Number(orientation);
  return [5, 6, 7, 8].includes(value);
}

/**
 * Apply EXIF-based fallback for core image_info fields when decoder metadata is unavailable.
 * @param {object} imageInfo - Extracted image_info payload.
 * @param {object|null} exif - Extracted EXIF payload.
 * @param {string} filePath - Absolute image path.
 * @returns {object} Image info with EXIF-enriched fallback fields.
 */
function applyExifImageInfoFallback(imageInfo, exif, filePath) {
  const next = imageInfo && typeof imageInfo === "object" ? { ...imageInfo } : {};

  const currentWidth = Number(next.width || 0);
  const currentHeight = Number(next.height || 0);
  const hasDimensions = Number.isFinite(currentWidth) && currentWidth > 0 && Number.isFinite(currentHeight) && currentHeight > 0;

  const exifOrientation = parseExifNumber(exif?.orientation);
  const exifWidthRaw = parseExifNumber(exif?.dimensions?.width);
  const exifHeightRaw = parseExifNumber(exif?.dimensions?.height);
  const hasExifDimensions = Number.isFinite(exifWidthRaw) && exifWidthRaw > 0 && Number.isFinite(exifHeightRaw) && exifHeightRaw > 0;

  if (!hasDimensions && hasExifDimensions) {
    const swap = exifOrientationSwapsDimensions(exifOrientation);
    next.width = swap ? exifHeightRaw : exifWidthRaw;
    next.height = swap ? exifWidthRaw : exifHeightRaw;
  }

  const width = Number(next.width || 0);
  const height = Number(next.height || 0);
  const validDimensions = Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0;

  if (validDimensions) {
    const aspectRatio = width / height;
    if (!Number.isFinite(Number(next.aspect_ratio))) {
      next.aspect_ratio = Math.round(aspectRatio * 100) / 100;
    }
    if (!String(next.aspect_ratio_string || "").trim() || String(next.aspect_ratio_string || "").toLowerCase() === "custom") {
      next.aspect_ratio_string = getAspectRatioString(aspectRatio);
    }
    if (!String(next.orientation || "").trim() || String(next.orientation || "").toLowerCase() === "unknown") {
      next.orientation = classifyOrientationFromAspectRatio(aspectRatio);
    }
    if (!Number.isFinite(Number(next.megapixels))) {
      next.megapixels = calculateMegapixels(width, height);
    }
    if (!String(next.size_category || "").trim() || String(next.size_category || "").toLowerCase() === "unknown") {
      next.size_category = categorizeImageSizeByPixels(width * height);
    }

    // Decoder plugin absence does not mean the file is corrupt when EXIF dimensions are valid.
    next.is_corrupt = false;
  }

  if (!String(next.format || "").trim()) {
    const ext = path.extname(String(filePath || "")).toLowerCase().replace(/^\./, "");
    next.format = ext || null;
  }

  if (!String(next.orientation || "").trim()) {
    next.orientation = "unknown";
  }
  if (!String(next.aspect_ratio_string || "").trim()) {
    next.aspect_ratio_string = "custom";
  }

  return next;
}

/**
 * Calculate megapixels from width and height.
 * @param {number} width - Pixel width.
 * @param {number} height - Pixel height.
 * @returns {number|null} Megapixels rounded to 2 decimals, or null when invalid.
 * @example
 * calculateMegapixels(1920, 1080); // 2.07
 */
function calculateMegapixels(width, height) {
  const w = Number(width);
  const h = Number(height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return null;
  }
  return Math.round((w * h) / 1000000 * 100) / 100;
}

/**
 * Resolve orientation category from numeric aspect ratio.
 * @param {number} aspectRatio - Width divided by height.
 * @returns {"landscape"|"portrait"|"square"|"unknown"} Orientation label.
 */
function classifyOrientationFromAspectRatio(aspectRatio) {
  const ratio = Number(aspectRatio);
  if (!Number.isFinite(ratio) || ratio <= 0) {
    return "unknown";
  }
  if (Math.abs(ratio - 1) < 0.1) {
    return "square";
  }
  return ratio > 1 ? "landscape" : "portrait";
}

/**
 * Categorize image size bucket from pixel count.
 * @param {number} totalPixels - Total pixels (`width * height`).
 * @returns {"small"|"medium"|"large"|"very_large"|"unknown"} Size category.
 */
function categorizeImageSizeByPixels(totalPixels) {
  const pixels = Number(totalPixels);
  if (!Number.isFinite(pixels) || pixels <= 0) {
    return "unknown";
  }
  if (pixels < 500000) return "small";
  if (pixels < 2000000) return "medium";
  if (pixels < 8000000) return "large";
  return "very_large";
}

/**
 * Detect whether editing software hints indicate post-processing.
 * @param {string} software - EXIF software value.
 * @returns {boolean} True when known editor signatures are present.
 */
function detectEditedBySoftware(software) {
  const value = String(software || "");
  if (!value) {
    return false;
  }
  return (
    value.includes("Photoshop") ||
    value.includes("GIMP") ||
    value.includes("Lightroom") ||
    value.includes("Snapseed")
  );
}

/**
 * Compute brightness bucket from normalized brightness [0, 1].
 * @param {number} brightness - Brightness ratio.
 * @returns {"dark"|"medium"|"bright"} Brightness category.
 */
function categorizeBrightness(brightness) {
  const value = Number(brightness);
  if (value < 0.3) return "dark";
  if (value < 0.7) return "medium";
  return "bright";
}

/**
 * Determine whether color variance should be treated as vibrant.
 * @param {number} colorVariance - Maximum per-channel standard deviation.
 * @returns {boolean} True when variance exceeds the vibrant threshold.
 */
function isVibrantFromVariance(colorVariance) {
  return Number(colorVariance) > 50;
}

/**
 * Test whether a value matches any regex pattern in a list.
 * @param {string} value - Candidate string.
 * @param {RegExp[]} patterns - Regex patterns to test.
 * @returns {boolean} True when at least one pattern matches.
 */
function matchesAnyPattern(value, patterns) {
  const source = String(value || "");
  const rows = Array.isArray(patterns) ? patterns : [];
  return rows.some((pattern) => pattern.test(source));
}

/**
 * Detect screenshot hints from filename/directory.
 * @param {string} fileName - Lowercased file name.
 * @param {string} dirName - Lowercased directory path.
 * @returns {boolean} True when screenshot patterns match.
 */
function detectScreenshotFlag(fileName, dirName) {
  const screenshotPatterns = [
    /screenshot/i,
    /screen shot/i,
    /^scr_/i,
    /^shot_/i,
    /^capture_/i,
    /^snap_/i,
  ];
  return matchesAnyPattern(fileName, screenshotPatterns) || matchesAnyPattern(dirName, screenshotPatterns);
}

/**
 * Detect camera-capture hints from filename/directory.
 * @param {string} fileName - Lowercased file name.
 * @param {string} dirName - Lowercased directory path.
 * @returns {boolean} True when camera naming patterns match.
 */
function detectCameraPhotoFlag(fileName, dirName) {
  const cameraPatterns = [
    /^dsc_/i,
    /^img_/i,
    /^dcim/i,
    /^pano_/i,
    /^_mg_/i,
    /^dsc\d/i,
  ];
  return matchesAnyPattern(fileName, cameraPatterns) || matchesAnyPattern(dirName, cameraPatterns);
}

/**
 * Detect download-folder source hint.
 * @param {string} dirName - Lowercased directory path.
 * @returns {boolean} True when path suggests downloads origin.
 */
function detectDownloadFlag(dirName) {
  const value = String(dirName || "");
  return value.includes("download") || value.includes("downloads");
}

/**
 * Determine canonical image source label from flags.
 * @param {boolean} isScreenshot - Screenshot hint.
 * @param {boolean} isCameraPhoto - Camera hint.
 * @param {boolean} isDownload - Download hint.
 * @returns {"screenshot"|"camera"|"web_download"|"unknown"} Source label.
 */
function determineLikelyImageSource(isScreenshot, isCameraPhoto, isDownload) {
  if (isScreenshot) return "screenshot";
  if (isCameraPhoto) return "camera";
  if (isDownload) return "web_download";
  return "unknown";
}

/**
 * Check if a filename includes a long sequential number.
 * @param {string} fileName - Lowercased file name.
 * @returns {boolean} True when sequence-like numeric token exists.
 */
function hasSequentialNamePattern(fileName) {
  return /\d{4,}/.test(String(fileName || ""));
}

/**
 * Check if filename stem starts with unix-like timestamp digits.
 * @param {string} fileName - Lowercased file name.
 * @returns {boolean} True when timestamp-like naming is detected.
 */
function hasTimestampNamePattern(fileName) {
  return /^\d{10,13}/.test(path.parse(String(fileName || "")).name);
}

/**
 * Infer whether text may be present based on dimensions.
 * @param {number} width - Pixel width.
 * @param {number} height - Pixel height.
 * @returns {boolean} True when dimensions satisfy text heuristic.
 */
function inferMightContainText(width, height) {
  return Number(width) > 400 && Number(height) > 200;
}

/**
 * Infer icon-like image dimensions.
 * @param {number} width - Pixel width.
 * @param {number} height - Pixel height.
 * @returns {boolean} True when image is icon-sized.
 */
function inferIsIcon(width, height) {
  return Number(width) < 256 && Number(height) < 256;
}

/**
 * Infer banner-like geometry.
 * @param {number} width - Pixel width.
 * @param {number} height - Pixel height.
 * @returns {boolean} True when width is at least 3x height.
 */
function inferIsBanner(width, height) {
  const w = Number(width);
  const h = Number(height);
  return Number.isFinite(w) && Number.isFinite(h) && h > 0 && w > h * 3;
}

/**
 * Infer thumbnail-like dimensions.
 * @param {number} width - Pixel width.
 * @param {number} height - Pixel height.
 * @returns {boolean} True when either dimension is under 500px.
 */
function inferIsThumbnail(width, height) {
  return Number(width) < 500 || Number(height) < 500;
}

/**
 * Infer known wallpaper resolutions.
 * @param {number} width - Pixel width.
 * @param {number} height - Pixel height.
 * @returns {boolean} True when dimensions match known wallpaper sizes.
 */
function inferIsWallpaper(width, height) {
  const w = Number(width);
  const h = Number(height);
  return (
    (w === 1920 && h === 1080) ||
    (w === 2560 && h === 1440) ||
    (w === 3840 && h === 2160)
  );
}

/**
 * Build normalized filter-ready fields from image technical metadata.
 * @param {object} imageInfo - Extracted `image_info` payload.
 * @returns {{resolutionMegapixels: string, aspectRatio: string, orientation: string}} Filter projection.
 */
function buildImageFilteringData(imageInfo) {
  const width = Number(imageInfo?.width || 0);
  const height = Number(imageInfo?.height || 0);
  const megapixels = Number(imageInfo?.megapixels);
  const resolutionMegapixels =
    Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0 && Number.isFinite(megapixels)
      ? `${Math.round(width)}x${Math.round(height)} (~${megapixels.toFixed(2)}mp)`
      : "";

  return {
    resolutionMegapixels,
    aspectRatio: String(imageInfo?.aspect_ratio_string || ""),
    orientation: String(imageInfo?.orientation || "unknown"),
  };
}

/**
 * Extract local image technical metadata and derived quality fields.
 * @param {string} filePath - Absolute image path.
 * @returns {Promise<object>} Image info payload used by indexing/filtering.
 */
async function extractImageInfo(filePath) {
  try {
    const image = sharp(filePath);
    const metadata = await image.metadata();
    const stats = await image.stats();

    // Use auto-oriented dimensions when available so EXIF rotation is respected cross-platform.
    const width = Number(metadata?.autoOrient?.width || metadata.width || 0) || null;
    const height = Number(metadata?.autoOrient?.height || metadata.height || 0) || null;
    const aspectRatio = width / height;
    const totalPixels = width * height;
    const orientation = classifyOrientationFromAspectRatio(aspectRatio);
    const sizeCategory = categorizeImageSizeByPixels(totalPixels);
    const megapixels = calculateMegapixels(width, height);
  
    return {
      width,
      height,
      aspect_ratio: Math.round(aspectRatio * 100) / 100,
      aspect_ratio_string: getAspectRatioString(aspectRatio),
      orientation,
      format: metadata.format,
      color_space: metadata.space,
      channels: metadata.channels,
      has_alpha: metadata.hasAlpha,
      bit_depth: metadata.depth,
      density: metadata.density || null,
      is_progressive: metadata.isProgressive || false,
      megapixels,
      size_category: sizeCategory,
      compression: metadata.compression || null,
      
      // Check if image is valid
      is_corrupt: false,
      
      // Dominant channel (for B&W detection)
      is_grayscale: metadata.space === 'b-w' || isGrayscaleFromStats(stats)
    };
  } catch (error) {
    if (!isDecodeUnsupportedError(error)) {
      console.warn("Image info extraction failed:", String(error?.message || error));
    }
    return {
      width: null,
      height: null,
      aspect_ratio: null,
      aspect_ratio_string: 'custom',
      orientation: 'unknown',
      format: null,
      color_space: null,
      channels: null,
      has_alpha: false,
      bit_depth: null,
      density: null,
      is_progressive: false,
      megapixels: null,
      size_category: 'unknown',
      compression: null,
      is_corrupt: true,
      is_grayscale: null
    };
  }
}

/**
 * Map numeric aspect ratio to named/common ratio labels.
 * @param {number} ratio - Width/height ratio.
 * @returns {string} Named ratio label or `custom`.
 */
function getAspectRatioString(ratio) {
  const commonRatios = {
    '1:1': 1,
    '4:3': 4/3,
    '3:2': 3/2,
    '16:9': 16/9,
    '21:9': 21/9,
    '9:16': 9/16, // vertical video
    '3:4': 3/4,
    '2:3': 2/3
  };
  
  for (const [name, value] of Object.entries(commonRatios)) {
    if (Math.abs(ratio - value) < 0.05) {
      return name;
    }
  }
  
  return 'custom';
}

/**
 * Infer grayscale image from per-channel means.
 * @param {{channels?: Array<{mean: number}>}} stats - Sharp channel stats payload.
 * @returns {boolean} True when RGB means are near-equal.
 */
function isGrayscaleFromStats(stats) {
  if (!stats.channels || stats.channels.length < 3) return true;
  
  // If R, G, B channels are very similar, it's grayscale
  const r = stats.channels[0].mean;
  const g = stats.channels[1].mean;
  const b = stats.channels[2].mean;
  
  const variance = Math.max(
    Math.abs(r - g),
    Math.abs(g - b),
    Math.abs(r - b)
  );
  
  return variance < 5; // Threshold for grayscale detection
}

/**
 * Extract and normalize EXIF fields into structured groups.
 * @param {string} filePath - Absolute image path.
 * @returns {Promise<object|null>} EXIF payload, or null when unavailable.
 */
async function extractExifData(filePath) {
  try {
    const exif = await exifr.parse(filePath, {
      tiff: true,
      exif: true,
      gps: true,
      iptc: true,
      icc: true,
      xmp: true
    });
    
    if (!exif) return null;
    
    return {
      // Camera information
      camera: {
        make: exif.Make || null,
        model: exif.Model || null,
        lens_model: exif.LensModel || null,
        software: exif.Software || null
      },
      
      // Date information
      dates: {
        taken: exif.DateTimeOriginal || exif.CreateDate || null,
        digitized: exif.DateTimeDigitized || null,
        modified: exif.ModifyDate || null
      },
      
      // GPS location
      gps: exif.latitude && exif.longitude ? {
        latitude: exif.latitude,
        longitude: exif.longitude,
        altitude: exif.GPSAltitude || null,
        location_string: `${exif.latitude.toFixed(6)}, ${exif.longitude.toFixed(6)}`
      } : null,
      
      // Camera settings
      exposure: {
        iso: exif.ISO || null,
        aperture: exif.FNumber || exif.ApertureValue || null,
        shutter_speed: exif.ExposureTime || exif.ShutterSpeedValue || null,
        exposure_compensation: exif.ExposureCompensation || null,
        focal_length: exif.FocalLength || null,
        focal_length_35mm: exif.FocalLengthIn35mmFormat || null
      },
      
      // Flash and metering
      flash: exif.Flash || null,
      metering_mode: exif.MeteringMode || null,
      white_balance: exif.WhiteBalance || null,
      
      // Image processing
      sharpness: exif.Sharpness || null,
      saturation: exif.Saturation || null,
      contrast: exif.Contrast || null,
      
      // Copyright and attribution
      copyright: exif.Copyright || null,
      artist: exif.Artist || exif.Creator || null,
      
      // Additional metadata
      description: exif.ImageDescription || exif.Description || null,
      keywords: exif.Keywords || exif.Subject || null,
      rating: exif.Rating || null,

      // Burst/sequence hints used for grouping similar captures.
      burst: {
        burst_uuid: cleanExifValue(exif.BurstUUID || exif.BurstID || exif.BurstId),
        sequence_number: parseExifNumber(exif.SequenceNumber || exif.BurstSequenceNumber || exif.BurstSequence),
        canon_shot_number: parseExifNumber(exif.CanonShotInfoShotNumber || exif.CanonShotNumber || exif.ShotNumber),
        shooting_mode: cleanExifValue(exif.ShootingMode),
        burst_mode: cleanExifValue(exif.BurstMode),
      },
      
      // Orientation
      orientation: exif.Orientation || null,

      // Technical dimensions useful when decoder plugins are unavailable.
      dimensions: {
        width: parseExifNumber(exif.ExifImageWidth || exif.ImageWidth || exif.PixelXDimension),
        height: parseExifNumber(exif.ExifImageHeight || exif.ImageHeight || exif.PixelYDimension),
      },
      
      // Is this edited?
      is_edited: detectEditedBySoftware(exif.Software)
    };
    
  } catch (error) {
    console.warn("EXIF extraction failed:", error.message);
    return null;
  }
}

/**
 * Extract lightweight color analysis from local image stats.
 * @param {string} filePath - Absolute image path.
 * @returns {Promise<object|null>} Color analysis payload, or null on failure.
 */
async function extractColorAnalysis(filePath) {
  try {
    const image = sharp(filePath);
    const stats = await image.stats();
    
    // Get dominant colors from stats
    const dominantColors = stats.channels.length >= 3 ? [
      {
        color: 'primary',
        rgb: [
          Math.round(stats.channels[0].mean),
          Math.round(stats.channels[1].mean),
          Math.round(stats.channels[2].mean)
        ],
        hex: rgbToHex(
          Math.round(stats.channels[0].mean),
          Math.round(stats.channels[1].mean),
          Math.round(stats.channels[2].mean)
        )
      }
    ] : [];
    
    // Brightness analysis
    const brightness = stats.channels[0].mean / 255;
    const brightnessCategory = categorizeBrightness(brightness);
    
    // Color variance (how colorful)
    const colorVariance = stats.channels.length >= 3 ? 
      Math.max(
        stats.channels[0].stdev,
        stats.channels[1].stdev,
        stats.channels[2].stdev
      ) : 0;
    
    const isVibrant = isVibrantFromVariance(colorVariance);
    
    return {
      dominant_colors: dominantColors,
      brightness: Math.round(brightness * 100) / 100,
      brightness_category: brightnessCategory,
      is_vibrant: isVibrant,
      color_variance: Math.round(colorVariance)
    };
    
  } catch (error) {
    if (!isDecodeUnsupportedError(error)) {
      console.warn("Color analysis failed:", String(error?.message || error));
    }
    return null;
  }
}

/**
 * Convert RGB integer channels to hex color string.
 * @param {number} r - Red channel [0..255].
 * @param {number} g - Green channel [0..255].
 * @param {number} b - Blue channel [0..255].
 * @returns {string} Hex color string (e.g. `#aabbcc`).
 */
function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(x => {
    const hex = x.toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  }).join('');
}

/**
 * Detect likely image source category from path/name heuristics.
 * @param {string} filePath - Absolute image path.
 * @param {object} basicInfo - Base scan metadata (reserved for compatibility).
 * @returns {Promise<object>} Source classification flags and label.
 */
async function detectSource(filePath, basicInfo) {
  const fileName = path.basename(filePath).toLowerCase();
  const dirName = path.dirname(filePath).toLowerCase();
  
  const isScreenshot = detectScreenshotFlag(fileName, dirName);
  const isDownload = detectDownloadFlag(dirName);
  const isCameraPhoto = detectCameraPhotoFlag(fileName, dirName);
  const likelySource = determineLikelyImageSource(isScreenshot, isCameraPhoto, isDownload);
  
  return {
    is_screenshot: isScreenshot,
    is_download: isDownload,
    is_camera_photo: isCameraPhoto,
    likely_source: likelySource,
    
    // Additional context
    has_sequential_name: hasSequentialNamePattern(fileName),
    is_timestamp_name: hasTimestampNamePattern(fileName)
  };
}

/**
 * Extract lightweight non-ML content hints from image dimensions.
 * @param {string} filePath - Absolute image path.
 * @returns {Promise<object>} Content hint booleans for filtering/grouping.
 */
async function extractContentHints(filePath) {
  try {
    const image = sharp(filePath);
    const metadata = await image.metadata();
    
    const width = Number(metadata.width || 0);
    const height = Number(metadata.height || 0);
    const mightContainText = inferMightContainText(width, height);
    
    return {
      might_contain_text: mightContainText,
      is_icon: inferIsIcon(width, height),
      is_banner: inferIsBanner(width, height),
      is_thumbnail: inferIsThumbnail(width, height),
      is_wallpaper: inferIsWallpaper(width, height)
    };
  } catch (error) {
    if (!isDecodeUnsupportedError(error)) {
      console.warn("Content hints extraction failed:", String(error?.message || error));
    }
    return {
      might_contain_text: false,
      is_icon: false,
      is_banner: false,
      is_thumbnail: false,
      is_wallpaper: false,
    };
  }
}

/**
 * Batch extract image metadata with controlled concurrency.
 * @param {Array<{path: string}>} fileRecords - File records to process.
 * @param {{concurrency?: number, onProgress?: Function|null, onError?: Function|null}} [options={}] - Batch options.
 * @returns {Promise<{results: object[], errors: object[], summary: object}>} Batch results summary.
 */
async function batchExtractMetadata(fileRecords, options = {}) {
  const {
    concurrency = 5,
    onProgress = null,
    onError = null
  } = options;
  
  const results = [];
  const errors = [];
  
  // Process in batches
  for (let i = 0; i < fileRecords.length; i += concurrency) {
    const batch = fileRecords.slice(i, i + concurrency);
    
    const batchResults = await Promise.allSettled(
      batch.map(record => extractImageMetadata(record.path, record))
    );
    
    batchResults.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        errors.push({
          file: batch[index].path,
          error: result.reason.message
        });
        if (onError) onError(batch[index].path, result.reason);
      }
    });
    
    if (onProgress) {
      onProgress({
        processed: i + batch.length,
        total: fileRecords.length,
        errors: errors.length
      });
    }
  }
  
  return {
    results,
    errors,
    summary: {
      total: fileRecords.length,
      successful: results.length,
      failed: errors.length
    }
  };
}

// Export functions
export {
  isDecodeUnsupportedError,
  extractImageMetadata,
  batchExtractMetadata,
  extractHashes,
  getPerceptualHash,
  cleanExifValue,
  parseExifNumber,
  buildImageFilteringData,
  extractImageInfo,
  getAspectRatioString,
  isGrayscaleFromStats,
  extractExifData,
  extractColorAnalysis,
  rgbToHex,
  detectSource,
  extractContentHints,
  calculateMegapixels,
  classifyOrientationFromAspectRatio,
  categorizeImageSizeByPixels,
  detectEditedBySoftware,
  categorizeBrightness,
  isVibrantFromVariance,
  matchesAnyPattern,
  detectScreenshotFlag,
  detectCameraPhotoFlag,
  detectDownloadFlag,
  determineLikelyImageSource,
  hasSequentialNamePattern,
  hasTimestampNamePattern,
  inferMightContainText,
  inferIsIcon,
  inferIsBanner,
  inferIsThumbnail,
  inferIsWallpaper
};

// Example usage
const currentFilePath = fileURLToPath(import.meta.url);
const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === currentFilePath;

if (isDirectRun) {
  const testFilePath = process.argv[2];
  
  if (!testFilePath) {
    console.log("Usage: node image-metadata-extractor.js <path-to-image>");
    process.exit(1);
  }
  
  extractImageMetadata(testFilePath)
    .then(metadata => {
      console.log(JSON.stringify(metadata, null, 2));
    })
    .catch(error => {
      console.error("Error:", error);
      process.exit(1);
    });
}
