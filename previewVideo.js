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

export function getMediaTypeFromPath(filePath, fallbackType = "image") {
  const ext = getPathExtension(filePath);
  if (!ext) {
    return fallbackType;
  }
  return VIDEO_EXTENSIONS.has(ext) ? "video" : "image";
}

export function getPathExtension(filePath) {
  const value = String(filePath || "").trim().toLowerCase();
  const lastDot = value.lastIndexOf(".");
  if (lastDot < 0) {
    return "";
  }
  const lastSlash = Math.max(value.lastIndexOf("/"), value.lastIndexOf("\\"));
  if (lastSlash > lastDot) {
    return "";
  }
  return value.slice(lastDot);
}

export function isVideoPath(filePath) {
  return getMediaTypeFromPath(filePath, "image") === "video";
}

export function normalizeMediaType(value, filePath) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "video" || raw === "image") {
    return raw;
  }
  return getMediaTypeFromPath(filePath, "image");
}
