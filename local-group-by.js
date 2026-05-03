#!/usr/bin/env node
/**
 * group_photos_local.js
 * =====================
 * Groups photos from an album by shot type using ONLY local, free signals.
 * All metadata is extracted in a single exiftool batch pass — no per-file
 * calls, no API cost, no embeddings.
 *
 * Grouping methods:
 *   similar   — near-duplicate groups (burst + timestamp + camera/settings)
 *   session   — shooting sessions + burst sub-groups (timestamp + sub-second)
 *   burst     — vendor burst groups (iPhone BurstUUID / Canon/Nikon SequenceNumber)
 *   gps       — location clusters (lat/lon + altitude + heading)
 *   settings  — shot type by camera settings (ExposureProgram + ISO + aperture + focal)
 *   filename  — sequential filename pattern fallback
 *
 * Note: perceptual hash (phash) grouping is omitted in the JS port as it
 * requires native image-decoding bindings. Use the Python version for phash.
 *
 * Install:
 *   npm install                    (no runtime dependencies needed)
 *   # macOS:  brew install exiftool
 *   # Ubuntu: sudo apt install libimage-exiftool-perl
 *   # Windows: https://exiftool.org  (add to PATH)
 *
 * Usage:
 *   node group_photos_local.js <album_dir> [options]
 *
 * Options:
 *   --methods similar session burst gps settings filename   (space-separated, default: similar session settings)
 *   --output <path>           JSON output file       (default: grouped_photos.json)
 *   --output-folders <path>   root folder for copies (default: grouped_photos)
 *   --no-copy                 skip copying files, JSON only
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// ──────────────────────────────────────────────────────────────────────────────
// Config
// ──────────────────────────────────────────────────────────────────────────────

const IMAGE_EXTENSIONS    = new Set([".jpg", ".jpeg", ".png", ".heic", ".webp", ".tiff", ".bmp", ".raw", ".arw", ".cr2", ".nef"]);
const BURST_THRESHOLD_SEC = 3;
const SESSION_GAP_MIN     = 30;
const GPS_CLUSTER_METERS  = 300;
const GPS_HEADING_DEGREES = 45;
const LOCAL_GROUP_BURST_TIME_FALLBACK_MS = 3_000;

// ──────────────────────────────────────────────────────────────────────────────
// Step 1 — exiftool batch extraction
// ──────────────────────────────────────────────────────────────────────────────

const EXIFTOOL_TAGS = [
  "-DateTimeOriginal",
  "-SubSecTimeOriginal",
  "-OffsetTimeOriginal",
  "-GPSLatitude#",
  "-GPSLongitude#",
  "-GPSAltitude#",
  "-GPSImgDirection#",
  "-GPSSpeed#",
  "-ISO",
  "-FNumber#",
  "-FocalLength#",
  "-FocalLengthIn35mmFormat#",
  "-ExposureTime#",
  "-ExposureProgram",
  "-Flash",
  "-WhiteBalance",
  "-SceneCaptureType",
  "-LensModel",
  "-ImageWidth",
  "-ImageHeight",
  "-Orientation#",
  "-ColorSpace",
  "-Make",
  "-Model",
  "-BurstUUID",
  "-CanonShotInfo:ShotNumber",
  "-ShootingMode",
  "-BurstMode",
  "-SequenceNumber",
  "-FileSize#",
  "-FileName",
  "-SourceFile",
];

function checkExiftool() {
  try {
    execSync("exiftool -ver", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function extractAllMetadata(filePaths) {
  if (!checkExiftool()) {
    throw new Error(
      "exiftool not found.\n" +
      "  macOS:   brew install exiftool\n" +
      "  Ubuntu:  sudo apt install libimage-exiftool-perl\n" +
      "  Windows: https://exiftool.org"
    );
  }

  const args = ["exiftool", "-j", "-n", "-q", "--printConv", ...EXIFTOOL_TAGS, ...filePaths]
    .map(a => `"${a}"`)
    .join(" ");

  let stdout;
  try {
    stdout = execSync(args, { maxBuffer: 200 * 1024 * 1024 }).toString();
  } catch (err) {
    // exiftool exits 1 on minor warnings — still usable
    stdout = err.stdout ? err.stdout.toString() : "[]";
    if (!stdout.trim().startsWith("[")) throw err;
  }

  const list = JSON.parse(stdout || "[]");
  const map  = {};
  for (const item of list) {
    map[path.basename(item.SourceFile)] = item;
  }
  return map;
}

// ──────────────────────────────────────────────────────────────────────────────
// Step 2 — parse fields
// ──────────────────────────────────────────────────────────────────────────────

function parseTimestamp(meta) {
  const raw = meta.DateTimeOriginal;
  if (!raw) return null;

  const base = String(raw).slice(0, 19).replace(/:/g, (m, o) => o < 8 ? "-" : ":");
  let dt = new Date(base);
  if (isNaN(dt.getTime())) return null;

  // Sub-second precision
  const subsec = meta.SubSecTimeOriginal;
  if (subsec != null) {
    const ms = Math.floor(parseInt(String(subsec).padEnd(3, "0").slice(0, 3)));
    if (!isNaN(ms)) dt = new Date(dt.getTime() + ms);
  }

  // Timezone offset
  const offsetStr = meta.OffsetTimeOriginal;
  if (offsetStr) {
    const sign   = String(offsetStr).includes("+") ? 1 : -1;
    const parts  = String(offsetStr).replace(/[+-]/, "").split(":");
    const offMin = sign * (parseInt(parts[0]) * 60 + parseInt(parts[1] || "0"));
    dt = new Date(dt.getTime() - offMin * 60_000);
  }

  return dt;
}

function parseGps(meta) {
  if (meta.GPSLatitude == null || meta.GPSLongitude == null) return null;
  return {
    lat:      parseFloat(meta.GPSLatitude),
    lon:      parseFloat(meta.GPSLongitude),
    altitude: meta.GPSAltitude  != null ? parseFloat(meta.GPSAltitude)  : null,
    heading:  meta.GPSImgDirection != null ? parseFloat(meta.GPSImgDirection) : null,
    speedKmh: meta.GPSSpeed     != null ? parseFloat(meta.GPSSpeed)     : null,
  };
}

function parseCameraSettings(meta) {
  const focalRaw  = meta.FocalLength;
  const focal35mm = meta.FocalLengthIn35mmFormat;
  const focalFinal = focal35mm ?? focalRaw;

  let shutter = null;
  if (meta.ExposureTime != null) {
    const t = parseFloat(meta.ExposureTime);
    shutter = t > 0 && t < 1 ? `1/${Math.round(1 / t)}` : `${t.toFixed(1)}s`;
  }

  return {
    iso:             meta.ISO            != null ? parseInt(meta.ISO)                    : null,
    aperture:        meta.FNumber        != null ? Math.round(parseFloat(meta.FNumber) * 10) / 10 : null,
    focalLength:     focalFinal          != null ? Math.round(parseFloat(focalFinal))   : null,
    focalRawMm:      focalRaw            != null ? Math.round(parseFloat(focalRaw))     : null,
    shutter,
    exposureProgram: meta.ExposureProgram  ?? null,
    flashFired:      ((parseInt(meta.Flash || "0") & 0x1) === 1),
    whiteBalance:    meta.WhiteBalance     ?? null,
    sceneCapture:    meta.SceneCaptureType ?? null,
    lensModel:       (meta.LensModel  || "").trim() || null,
    make:            (meta.Make       || "").trim(),
    model:           (meta.Model      || "").trim(),
  };
}

function parseImageProperties(meta) {
  const w = meta.ImageWidth  != null ? parseInt(meta.ImageWidth)  : null;
  const h = meta.ImageHeight != null ? parseInt(meta.ImageHeight) : null;
  return {
    width:       w,
    height:      h,
    orientation: meta.Orientation != null ? parseInt(meta.Orientation) : 1,
    colorSpace:  meta.ColorSpace ?? null,
    fileSize:    meta.FileSize   != null ? parseInt(meta.FileSize) : null,
    aspectRatio: (w && h && h > 0) ? Math.round((w / h) * 1000) / 1000 : null,
  };
}

function parseBurstInfo(meta) {
  return {
    burstUuid:     meta.BurstUUID                  ?? null,
    canonShotNum:  meta["CanonShotInfo:ShotNumber"] ?? null,
    nikonBurst:    meta.BurstMode                  ?? null,
    sequenceNumber:meta.SequenceNumber             ?? null,
    shootingMode:  meta.ShootingMode               ?? null,
  };
}

function buildPhotoMeta(filePaths) {
  console.log(`  Running exiftool on ${filePaths.length} files (single pass)...`);
  const rawMeta = extractAllMetadata(filePaths);

  const result = filePaths.map(fp => {
    const name = path.basename(fp);
    const meta = rawMeta[name] || {};
    return {
      name,
      filePath: fp,
      timestamp:      parseTimestamp(meta),
      gps:            parseGps(meta),
      cameraSettings: parseCameraSettings(meta),
      imageProps:     parseImageProperties(meta),
      burstInfo:      parseBurstInfo(meta),
    };
  });

  const extracted = result.filter(m => m.timestamp || m.gps).length;
  console.log(`  Metadata extracted: ${extracted}/${filePaths.length} files had usable EXIF`);
  return result;
}

// ──────────────────────────────────────────────────────────────────────────────
// Step 3 — grouping methods
// ──────────────────────────────────────────────────────────────────────────────

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R    = 6_371_000;
  const phi1 = lat1 * Math.PI / 180;
  const phi2 = lat2 * Math.PI / 180;
  const dphi = (lat2 - lat1) * Math.PI / 180;
  const dlam = (lon2 - lon1) * Math.PI / 180;
  const a    = Math.sin(dphi/2)**2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dlam/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function headingDiff(h1, h2) {
  const diff = Math.abs(h1 - h2) % 360;
  return Math.min(diff, 360 - diff);
}

function groupByBurstUuid(photoMeta) {
  const groups   = {};
  const noBurst  = [];

  for (const m of photoMeta) {
    const b  = m.burstInfo;
    const ts = m.timestamp;
    const tsKey = ts ? ts.toISOString().replace(/[-:T.Z]/g, "").slice(0, 14) : "unknown";

    if (b.burstUuid) {
      const key = `iburst_${b.burstUuid.slice(0, 8)}`;
      (groups[key] = groups[key] || []).push(m.name);
    } else if (b.canonShotNum && parseInt(b.canonShotNum) > 1) {
      const minuteKey = ts ? ts.toISOString().slice(0, 16).replace(/[-:T]/g, "") : "unknown";
      const key = `canon_burst_${minuteKey}`;
      (groups[key] = groups[key] || []).push(m.name);
    } else if (b.sequenceNumber && parseInt(b.sequenceNumber) > 0) {
      const key = `seq_burst_${tsKey}`;
      (groups[key] = groups[key] || []).push(m.name);
    } else {
      noBurst.push(m.name);
    }
  }

  if (Object.keys(groups).length === 0) return null;
  if (noBurst.length) groups["no_burst_id"] = noBurst;
  return groups;
}

function groupBySession(photoMeta) {
  const withTs    = photoMeta.filter(m => m.timestamp).sort((a, b) => a.timestamp - b.timestamp);
  const withoutTs = photoMeta.filter(m => !m.timestamp);

  const groups = {};
  let sessionId = 1;
  let burstId   = 1;
  let prevTs    = null;

  for (const m of withTs) {
    if (prevTs !== null) {
      const gapMs = m.timestamp - prevTs;
      if (gapMs > SESSION_GAP_MIN * 60_000) {
        sessionId++;
        burstId = 1;
      } else if (gapMs > BURST_THRESHOLD_SEC * 1_000) {
        burstId++;
      }
    }
    const key = `session_${String(sessionId).padStart(2, "0")}_burst_${String(burstId).padStart(2, "0")}`;
    (groups[key] = groups[key] || []).push(m.name);
    prevTs = m.timestamp;
  }

  if (withoutTs.length) {
    groups["no_timestamp"] = withoutTs.map(m => m.name);
  }

  return groups;
}

function groupByGps(photoMeta) {
  const withGps    = photoMeta.filter(m => m.gps);
  const withoutGps = photoMeta.filter(m => !m.gps);
  const clusters   = [];

  for (const m of withGps) {
    const g = m.gps;
    let matched = false;

    for (const cluster of clusters) {
      const c = cluster.centroid;
      if (haversineMeters(g.lat, g.lon, c.lat, c.lon) > GPS_CLUSTER_METERS) continue;
      if (g.altitude != null && c.altitude != null && Math.abs(g.altitude - c.altitude) > 20) continue;
      if (g.heading  != null && c.heading  != null && headingDiff(g.heading, c.heading) > GPS_HEADING_DEGREES) continue;

      cluster.members.push(m.name);
      const n = cluster.members.length;
      cluster.centroid = {
        lat:      (c.lat * (n - 1) + g.lat) / n,
        lon:      (c.lon * (n - 1) + g.lon) / n,
        altitude: c.altitude,
        heading:  c.heading,
      };
      matched = true;
      break;
    }

    if (!matched) {
      clusters.push({ centroid: { ...g }, members: [m.name] });
    }
  }

  const groups = {};
  clusters.forEach((cluster, i) => {
    const c   = cluster.centroid;
    const key = `location_${String(i + 1).padStart(2, "0")}_(${c.lat.toFixed(4)},${c.lon.toFixed(4)})`;
    groups[key] = cluster.members;
  });

  if (withoutGps.length) groups["no_gps"] = withoutGps.map(m => m.name);
  return groups;
}

function groupByCameraSettings(photoMeta) {
  const EXPOSURE_PROGRAM = {
    0: "manual", 1: "manual",     2: "auto",
    3: "aperture_priority",        4: "shutter_priority",
    5: "creative", 6: "portrait", 7: "landscape",
    9: "bulb",    10: "action",
  };
  const SCENE_CAPTURE = {
    0: "standard", 1: "landscape", 2: "portrait", 3: "night",
  };

  const groups = {};

  for (const m of photoMeta) {
    const s  = m.cameraSettings;
    const ip = m.imageProps;

    let mode;
    if (s.exposureProgram != null) {
      mode = EXPOSURE_PROGRAM[parseInt(s.exposureProgram)] ?? `program_${s.exposureProgram}`;
    } else if (s.sceneCapture != null) {
      mode = SCENE_CAPTURE[parseInt(s.sceneCapture)] ?? `scene_${s.sceneCapture}`;
    } else {
      const { iso, aperture, focalLength: focal, flashFired: flash } = s;
      if (iso && iso > 3200)          mode = "night_or_action";
      else if (aperture && aperture <= 2.0) mode = "portrait_bokeh";
      else if (focal && focal >= 200) mode = "telephoto";
      else if (focal && focal <= 24)  mode = "wide_landscape";
      else if (flash)                 mode = "flash_indoor_event";
      else                            mode = "general";
    }

    const suffix = [];
    if (s.flashFired)                                      suffix.push("flash");
    if (ip.aspectRatio && ip.aspectRatio > 2.5)            suffix.push("panorama");
    if (ip.fileSize && ip.fileSize > 20_000_000)           suffix.push("raw");

    const label = mode + (suffix.length ? `__${suffix.join("_")}` : "");
    (groups[label] = groups[label] || []).push(m.name);
  }

  return groups;
}

function groupByFilenameSequence(filePaths) {
  const numbered = filePaths
    .map(fp => {
      const stem  = path.basename(fp, path.extname(fp));
      const match = stem.match(/(\d+)/);
      return match ? { num: parseInt(match[1]), name: path.basename(fp) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.num - b.num);

  const groups = {};
  let seqId = 1;

  numbered.forEach((item, i) => {
    if (i > 0 && item.num - numbered[i - 1].num > 3) seqId++;
    const key = `seq_${String(seqId).padStart(3, "0")}`;
    (groups[key] = groups[key] || []).push(item.name);
  });

  return groups;
}

function areLikelySimilarShots(a, b) {
  const aBurst = a?.burstInfo || {};
  const bBurst = b?.burstInfo || {};
  if (aBurst.burstUuid && bBurst.burstUuid && String(aBurst.burstUuid) === String(bBurst.burstUuid)) {
    return true;
  }
  if (aBurst.sequenceNumber != null && bBurst.sequenceNumber != null && String(aBurst.sequenceNumber) === String(bBurst.sequenceNumber)) {
    return true;
  }

  const ta = a?.timestamp instanceof Date ? a.timestamp.getTime() : null;
  const tb = b?.timestamp instanceof Date ? b.timestamp.getTime() : null;
  if (ta == null || tb == null) {
    return false;
  }

  const deltaMs = Math.abs(ta - tb);
  if (deltaMs > 9_000) {
    return false;
  }

  const ia = a?.imageProps || {};
  const ib = b?.imageProps || {};
  const sa = a?.cameraSettings || {};
  const sb = b?.cameraSettings || {};

  if (ia.orientation && ib.orientation && ia.orientation !== ib.orientation) {
    return false;
  }

  const iaMp = Number((ia.width || 0) * (ia.height || 0));
  const ibMp = Number((ib.width || 0) * (ib.height || 0));
  if (iaMp > 0 && ibMp > 0) {
    const ratio = Math.max(iaMp, ibMp) / Math.max(1, Math.min(iaMp, ibMp));
    if (ratio > 1.6) {
      return false;
    }
  }

  if (sa.focalLength != null && sb.focalLength != null) {
    if (Math.abs(Number(sa.focalLength) - Number(sb.focalLength)) > 6) {
      return false;
    }
  }

  if (sa.aperture != null && sb.aperture != null) {
    if (Math.abs(Number(sa.aperture) - Number(sb.aperture)) > 0.9) {
      return false;
    }
  }

  if (sa.iso != null && sb.iso != null) {
    const hi = Math.max(Number(sa.iso), Number(sb.iso));
    const lo = Math.max(1, Math.min(Number(sa.iso), Number(sb.iso)));
    if (hi / lo > 3.0) {
      return false;
    }
  }

  return true;
}

function groupBySimilar(photoMeta) {
  const ordered = [...photoMeta].sort((a, b) => {
    const ta = a?.timestamp instanceof Date ? a.timestamp.getTime() : Number.POSITIVE_INFINITY;
    const tb = b?.timestamp instanceof Date ? b.timestamp.getTime() : Number.POSITIVE_INFINITY;
    if (ta !== tb) return ta - tb;
    return String(a?.name || "").localeCompare(String(b?.name || ""));
  });

  const groups = [];
  for (const item of ordered) {
    let placed = false;
    for (let i = groups.length - 1; i >= 0; i--) {
      const group = groups[i];
      const anchor = group[group.length - 1];
      if (areLikelySimilarShots(item, anchor)) {
        group.push(item);
        placed = true;
        break;
      }
      const anchorTs = anchor?.timestamp instanceof Date ? anchor.timestamp.getTime() : null;
      const itemTs = item?.timestamp instanceof Date ? item.timestamp.getTime() : null;
      if (anchorTs != null && itemTs != null && Math.abs(itemTs - anchorTs) > 30_000) {
        break;
      }
    }
    if (!placed) {
      groups.push([item]);
    }
  }

  const output = {};
  groups.forEach((group, idx) => {
    const key = `similar_${String(idx + 1).padStart(3, "0")}`;
    output[key] = group.map(x => x.name);
  });
  return output;
}

function chooseGroupRepresentatives(groups, photoMeta) {
  const byName = new Map(photoMeta.map(item => [item.name, item]));
  const representatives = {};

  for (const [label, names] of Object.entries(groups || {})) {
    let best = names[0] || null;
    let bestScore = -1;
    for (const name of names) {
      const row = byName.get(name);
      const w = Number(row?.imageProps?.width || 0);
      const h = Number(row?.imageProps?.height || 0);
      const pixels = w > 0 && h > 0 ? w * h : 0;
      if (pixels > bestScore) {
        bestScore = pixels;
        best = name;
      }
    }
    if (best) {
      representatives[label] = best;
    }
  }

  return representatives;
}

function popCount4(nibble) {
  const v = Number(nibble) & 0xf;
  return (v & 1) + ((v >> 1) & 1) + ((v >> 2) & 1) + ((v >> 3) & 1);
}

function hexHammingDistance(a, b) {
  const left = String(a || "").toLowerCase();
  const right = String(b || "").toLowerCase();
  if (!left || !right || left.length !== right.length) {
    return Number.POSITIVE_INFINITY;
  }

  let distance = 0;
  for (let i = 0; i < left.length; i += 1) {
    const lv = Number.parseInt(left[i], 16);
    const rv = Number.parseInt(right[i], 16);
    if (!Number.isFinite(lv) || !Number.isFinite(rv)) {
      return Number.POSITIVE_INFINITY;
    }
    distance += popCount4(lv ^ rv);
  }
  return distance;
}

function selectRepresentativePath(paths, localRowByPath) {
  const sorted = [...paths].sort((a, b) => String(a || "").localeCompare(String(b || "")));
  let bestPath = sorted[0] || "";
  let bestScore = -1;

  for (const imagePath of sorted) {
    const row = localRowByPath.get(imagePath);
    const width = Number(row?.local_metadata?.image_info?.width || 0);
    const height = Number(row?.local_metadata?.image_info?.height || 0);
    const pixels = width > 0 && height > 0 ? width * height : 0;
    const megapixels = Number(row?.local_metadata?.image_info?.megapixels || 0);
    const score = megapixels > 0 ? megapixels * 1_000_000 : pixels;
    if (score > bestScore) {
      bestScore = score;
      bestPath = imagePath;
    }
  }

  return bestPath;
}

function parseDateValue(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseNumericSuffix(filePath) {
  const base = path.basename(String(filePath || ""), path.extname(String(filePath || "")));
  const match = base.match(/^(.*?)(\d{2,})$/);
  if (!match) {
    return null;
  }

  return {
    prefix: String(match[1] || "").toLowerCase(),
    number: Number.parseInt(match[2], 10),
  };
}

function resolveBestTimestampMs(imagePath, row, fsTimestampCache) {
  const takenRaw = row?.local_metadata?.exif?.dates?.taken || null;
  const takenDate = parseDateValue(takenRaw);
  if (takenDate) {
    return takenDate.getTime();
  }

  if (fsTimestampCache.has(imagePath)) {
    return fsTimestampCache.get(imagePath);
  }

  let mtimeMs = null;
  try {
    const stats = fs.statSync(imagePath);
    if (Number.isFinite(stats?.mtimeMs)) {
      mtimeMs = Number(stats.mtimeMs);
    }
  } catch {
    mtimeMs = null;
  }

  fsTimestampCache.set(imagePath, mtimeMs);
  return mtimeMs;
}

function buildBurstTimestampKeysFromRow(row) {
  const takenRaw = row?.local_metadata?.exif?.dates?.taken || null;
  const takenDate = parseDateValue(takenRaw);
  if (!takenDate) {
    return {
      secondKey: "unknown",
      minuteKey: "unknown",
    };
  }

  const iso = takenDate.toISOString();
  const minuteBase = iso.slice(0, 16).replace(/[-:T]/g, "");
  const secondBucket = takenDate.getUTCSeconds() < 30 ? "00" : "30";
  return {
    secondKey: iso.replace(/[-:T.Z]/g, "").slice(0, 14),
    minuteKey: `${minuteBase}${secondBucket}`,
  };
}

function getBurstKeyFromLocalRow(row) {
  const burst = row?.local_metadata?.exif?.burst || {};
  const burstUuid = String(burst?.burst_uuid || "").trim();
  const sequenceNumber = Number.parseInt(String(burst?.sequence_number || ""), 10);
  const canonShotNumber = Number.parseInt(String(burst?.canon_shot_number || ""), 10);
  const { secondKey, minuteKey } = buildBurstTimestampKeysFromRow(row);

  if (burstUuid) {
    return `iburst_${burstUuid.slice(0, 8)}`;
  }

  if (Number.isFinite(canonShotNumber) && canonShotNumber > 1) {
    return `canon_burst_${minuteKey}`;
  }

  if (Number.isFinite(sequenceNumber) && sequenceNumber > 0) {
    return `seq_burst_${secondKey}`;
  }

  return "";
}

function buildTimestampBurstGroups(items, localRowByPath) {
  const fsTimestampCache = new Map();
  const candidates = (items || [])
    .map((item) => {
      const row = localRowByPath.get(item.imagePath);
      const takenMs = resolveBestTimestampMs(item.imagePath, row, fsTimestampCache);
      if (!Number.isFinite(takenMs)) {
        return null;
      }
      return {
        imagePath: item.imagePath,
        takenMs,
        directory: path.dirname(item.imagePath).toLowerCase(),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.takenMs - b.takenMs || a.imagePath.localeCompare(b.imagePath));

  const byDirectory = new Map();
  for (const row of candidates) {
    if (!byDirectory.has(row.directory)) {
      byDirectory.set(row.directory, []);
    }
    byDirectory.get(row.directory).push(row);
  }

  const groups = [];
  for (const rows of byDirectory.values()) {
    let current = [];

    for (const row of rows) {
      if (current.length === 0) {
        current.push(row);
        continue;
      }

      const prev = current[current.length - 1];
      if (row.takenMs - prev.takenMs <= LOCAL_GROUP_BURST_TIME_FALLBACK_MS) {
        current.push(row);
      } else {
        if (current.length >= 2) {
          groups.push(current.map((entry) => entry.imagePath));
        }
        current = [row];
      }
    }

    if (current.length >= 2) {
      groups.push(current.map((entry) => entry.imagePath));
    }
  }

  return groups;
}

function buildSimilarityGroupsFromLocalTargets(targetPaths, localRows) {
  const normalizedTargets = Array.from(new Set((targetPaths || []).map((p) => String(p || "").trim()).filter(Boolean)));
  const localRowByPath = new Map();
  for (const row of localRows || []) {
    const rowPath = String(row?.path || row?.image_path || "").trim();
    if (!rowPath || String(row?.status || "") !== "ok") {
      continue;
    }
    localRowByPath.set(rowPath, row);
  }

  const items = normalizedTargets.map((imagePath) => {
    const row = localRowByPath.get(imagePath);
    const pHash = String(row?.local_metadata?.hash?.perceptual_hash || "").trim().toLowerCase();
    const mediaType = String(row?.media_type || row?.metadata?.media_type || row?.local_metadata?.media_type || "image")
      .trim()
      .toLowerCase();
    return {
      imagePath,
      pHash: /^[0-9a-f]+$/i.test(pHash) ? pHash : "",
      mediaType,
    };
  });

  const videoItems = items.filter((item) => item.mediaType === "video");
  const imageItems = items.filter((item) => item.mediaType !== "video");

  const withHash = imageItems.filter((item) => item.pHash);
  const withoutHash = imageItems.filter((item) => !item.pHash);

  const burstGroups = new Map();
  for (const item of imageItems) {
    const row = localRowByPath.get(item.imagePath);
    const burstKey = getBurstKeyFromLocalRow(row);
    if (!burstKey) {
      continue;
    }
    if (!burstGroups.has(burstKey)) {
      burstGroups.set(burstKey, []);
    }
    burstGroups.get(burstKey).push(item.imagePath);
  }

  const burstAssignedPaths = new Set();
  const groups = [];
  for (const memberPaths of burstGroups.values()) {
    const uniqueMembers = Array.from(new Set(memberPaths)).sort((a, b) => String(a || "").localeCompare(String(b || "")));
    const representative = selectRepresentativePath(uniqueMembers, localRowByPath);
    groups.push({ representative, members: uniqueMembers });
    for (const memberPath of uniqueMembers) {
      burstAssignedPaths.add(memberPath);
    }
  }

  const unassignedAfterVendorBurst = imageItems
    .map((item) => item.imagePath)
    .filter((imagePath) => !burstAssignedPaths.has(imagePath));
  const timestampBurstGroups = buildTimestampBurstGroups(
    unassignedAfterVendorBurst.map((imagePath) => ({ imagePath })),
    localRowByPath,
  );
  for (const memberPaths of timestampBurstGroups) {
    const uniqueMembers = Array.from(new Set(memberPaths)).sort((a, b) => String(a || "").localeCompare(String(b || "")));
    const representative = selectRepresentativePath(uniqueMembers, localRowByPath);
    groups.push({ representative, members: uniqueMembers });
    for (const memberPath of uniqueMembers) {
      burstAssignedPaths.add(memberPath);
    }
  }

  const hashCandidates = withHash.filter((item) => !burstAssignedPaths.has(item.imagePath));
  const nonHashCandidates = withoutHash.filter((item) => !burstAssignedPaths.has(item.imagePath));
  const parent = new Map(hashCandidates.map((item) => [item.imagePath, item.imagePath]));

  const find = (x) => {
    let current = x;
    while (parent.get(current) !== current) {
      current = parent.get(current);
    }
    const root = current;
    current = x;
    while (parent.get(current) !== current) {
      const next = parent.get(current);
      parent.set(current, root);
      current = next;
    }
    return root;
  };

  const union = (a, b) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) {
      parent.set(rootB, rootA);
    }
  };

  const threshold = 10;
  if (hashCandidates.length <= 1600) {
    for (let i = 0; i < hashCandidates.length; i += 1) {
      for (let j = i + 1; j < hashCandidates.length; j += 1) {
        const distance = hexHammingDistance(hashCandidates[i].pHash, hashCandidates[j].pHash);
        if (distance <= threshold) {
          union(hashCandidates[i].imagePath, hashCandidates[j].imagePath);
        }
      }
    }
  } else {
    const buckets = new Map();
    for (const item of hashCandidates) {
      const key = item.pHash.slice(0, 8);
      if (!buckets.has(key)) {
        buckets.set(key, []);
      }
      buckets.get(key).push(item);
    }
    for (const bucket of buckets.values()) {
      for (let i = 0; i < bucket.length; i += 1) {
        for (let j = i + 1; j < bucket.length; j += 1) {
          const distance = hexHammingDistance(bucket[i].pHash, bucket[j].pHash);
          if (distance <= threshold) {
            union(bucket[i].imagePath, bucket[j].imagePath);
          }
        }
      }
    }
  }

  const grouped = new Map();
  for (const item of hashCandidates) {
    const root = find(item.imagePath);
    if (!grouped.has(root)) {
      grouped.set(root, []);
    }
    grouped.get(root).push(item.imagePath);
  }

  for (const members of grouped.values()) {
    const uniqueMembers = Array.from(new Set(members)).sort((a, b) => String(a || "").localeCompare(String(b || "")));
    const representative = selectRepresentativePath(uniqueMembers, localRowByPath);
    groups.push({ representative, members: uniqueMembers });
  }

  for (const item of nonHashCandidates) {
    groups.push({
      representative: item.imagePath,
      members: [item.imagePath],
    });
  }

  for (const item of videoItems) {
    groups.push({
      representative: item.imagePath,
      members: [item.imagePath],
    });
  }

  groups.sort((a, b) => String(a.representative || "").localeCompare(String(b.representative || "")));

  const groupsWithIds = groups.map((group, index) => ({
    group_id: index + 1,
    representative: group.representative,
    members: [...group.members],
  }));

  const representativeTargets = groupsWithIds
    .map((group) => group.representative)
    .filter(Boolean);

  const byPath = new Map();
  for (const group of groupsWithIds) {
    for (const memberPath of group.members) {
      byPath.set(memberPath, group);
    }
  }

  return {
    representativeTargets,
    groups: groupsWithIds,
    byPath,
  };
}

function buildCloudGroupsFromLocalTargets(targetPaths, localRows) {
  return buildSimilarityGroupsFromLocalTargets(targetPaths, localRows);
}

// ──────────────────────────────────────────────────────────────────────────────
// Step 4 — copy images into organised output folders
// ──────────────────────────────────────────────────────────────────────────────

function sanitiseFolderName(name) {
  return name
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/[\x00-\x1f]/g, "")
    .replace(/^[. ]+|[. ]+$/g, "")
    || "unnamed";
}

function copyToFolders(albumPath, groupedOutput, outputRoot) {
  console.log(`\n  Copying images to: ${outputRoot}`);
  fs.mkdirSync(outputRoot, { recursive: true });

  // Build name → full path lookup
  const sourceMap = {};
  for (const entry of fs.readdirSync(albumPath)) {
    if (IMAGE_EXTENSIONS.has(path.extname(entry).toLowerCase())) {
      sourceMap[entry] = path.join(albumPath, entry);
    }
  }

  let totalCopied  = 0;
  let totalMissing = 0;

  for (const [methodName, groups] of Object.entries(groupedOutput)) {
    const methodDir = path.join(outputRoot, sanitiseFolderName(methodName));
    fs.mkdirSync(methodDir, { recursive: true });

    for (const [groupLabel, filenames] of Object.entries(groups)) {
      const groupDir = path.join(methodDir, sanitiseFolderName(groupLabel));
      fs.mkdirSync(groupDir, { recursive: true });

      for (const fname of filenames) {
        const src = sourceMap[fname];
        if (!src) {
          console.warn(`    [warn] source not found: ${fname}`);
          totalMissing++;
          continue;
        }
        const dst = path.join(groupDir, fname);
        if (!fs.existsSync(dst)) {
          fs.copyFileSync(src, dst);   // preserves timestamps on most platforms
        }
        totalCopied++;
      }
    }
  }

  console.log(
    `  Done — ${totalCopied} file copies written` +
    (totalMissing ? `, ${totalMissing} missing` : "")
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────────────

function groupAlbum({
  albumDir,
  outputJson    = "grouped_photos.json",
  outputFolders = "grouped_photos",
  methods       = ["similar", "session", "settings"],
  copyFiles     = true,
} = {}) {
  const albumPath = path.resolve(albumDir);
  const filePaths = fs.readdirSync(albumPath)
    .filter(f => !f.startsWith("._"))
    .filter(f => IMAGE_EXTENSIONS.has(path.extname(f).toLowerCase()))
    .sort()
    .map(f => path.join(albumPath, f));

  if (filePaths.length === 0) {
    console.log("No images found.");
    return;
  }

  console.log(`\nFound ${filePaths.length} images in '${albumDir}'`);
  console.log("─".repeat(55));

  const photoMeta = buildPhotoMeta(filePaths);
  const output    = {};
  let   step      = 1;

  if (methods.includes("similar")) {
    console.log(`\n[${step}] Grouping similar/near-duplicate shots...`);
    output.similar_groups = groupBySimilar(photoMeta);
    output.similar_representatives = chooseGroupRepresentatives(output.similar_groups, photoMeta);
    console.log(`  -> ${Object.keys(output.similar_groups).length} similar groups`);
    step++;
  }

  if (methods.includes("session")) {
    console.log(`\n[${step}] Grouping by shooting session + burst...`);
    output.session_groups = groupBySession(photoMeta);
    console.log(`  -> ${Object.keys(output.session_groups).length} groups`);
    step++;
  }

  if (methods.includes("burst")) {
    console.log(`\n[${step}] Grouping by vendor burst ID (iPhone/Canon/Sony)...`);
    const result = groupByBurstUuid(photoMeta);
    if (result) {
      output.burst_groups = result;
      const real = Object.keys(result).filter(k => !k.startsWith("no_burst"));
      console.log(`  -> ${real.length} burst groups found`);
    } else {
      console.log("  -> No vendor burst metadata in this album (skipped)");
    }
    step++;
  }

  if (methods.includes("gps")) {
    console.log(`\n[${step}] Grouping by GPS location...`);
    output.gps_groups = groupByGps(photoMeta);
    console.log(`  -> ${Object.keys(output.gps_groups).length} location clusters`);
    step++;
  }

  if (methods.includes("settings")) {
    console.log(`\n[${step}] Grouping by camera settings / shot type...`);
    output.settings_groups = groupByCameraSettings(photoMeta);
    console.log(`  -> ${Object.keys(output.settings_groups).length} shot-type profiles`);
    step++;
  }

  if (methods.includes("filename")) {
    console.log(`\n[${step}] Grouping by filename sequence...`);
    output.filename_groups = groupByFilenameSequence(filePaths);
    console.log(`  -> ${Object.keys(output.filename_groups).length} sequences`);
  }

  // Save JSON
  fs.writeFileSync(outputJson, JSON.stringify(output, null, 2));
  console.log(`\nResults saved to: ${outputJson}`);

  // Copy into folder tree
  if (copyFiles) {
    copyToFolders(albumPath, output, path.resolve(outputFolders));
    console.log(`  Folder tree: ${path.resolve(outputFolders)}`);
  }

  printSummary(output);
  return output;
}

function printSummary(output) {
  for (const [groupType, groups] of Object.entries(output)) {
    const multi = Object.entries(groups).filter(([, v]) => v.length > 1);
    console.log("\n" + "─".repeat(55));
    console.log(`  ${groupType.toUpperCase()}  -  ${Object.keys(groups).length} groups (${multi.length} with 2+ photos)`);
    console.log("─".repeat(55));
    multi
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 8)
      .forEach(([label, files]) => {
        console.log(`  [${label}]  (${files.length} photos)`);
        files.slice(0, 4).forEach(f => console.log(`    - ${f}`));
        if (files.length > 4) console.log(`    ... +${files.length - 4} more`);
      });
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// CLI
// ──────────────────────────────────────────────────────────────────────────────

const isDirectRun = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isDirectRun) {
  const args    = process.argv.slice(2);
  const albumDir = args.find(a => !a.startsWith("--"));

  if (!albumDir) {
    console.error("Usage: node group_photos_local.js <album_dir> [--methods similar session burst gps settings filename] [--output file.json] [--output-folders dir] [--no-copy]");
    process.exit(1);
  }

  // Parse --methods (all tokens after --methods that don't start with --)
  let methods = ["similar", "session", "settings"];
  const mi = args.indexOf("--methods");
  if (mi !== -1) {
    methods = [];
    for (let i = mi + 1; i < args.length; i++) {
      if (args[i].startsWith("--")) break;
      methods.push(args[i]);
    }
  }

  const outputIdx   = args.indexOf("--output");
  const foldersIdx  = args.indexOf("--output-folders");

  groupAlbum({
    albumDir,
    outputJson:    outputIdx  !== -1 ? args[outputIdx  + 1] : "grouped_photos.json",
    outputFolders: foldersIdx !== -1 ? args[foldersIdx + 1] : "grouped_photos",
    methods,
    copyFiles: !args.includes("--no-copy"),
  });
}

export {
  groupAlbum,
  buildSimilarityGroupsFromLocalTargets,
  buildCloudGroupsFromLocalTargets,
};