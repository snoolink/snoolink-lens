import { FFmpeg } from "./node_modules/@ffmpeg/ffmpeg/dist/esm/index.js";
import { fetchFile } from "./node_modules/@ffmpeg/util/dist/esm/index.js";
import { toBlobURL } from "./node_modules/@ffmpeg/util/dist/esm/index.js";
import { installTooltipSystem } from "./tooltipSystem.js";

const goHomeBtn = document.getElementById("goHomeBtn");
const refreshSelectionBtn = document.getElementById("refreshSelectionBtn");
const secondsPerVideoRange = document.getElementById("secondsPerVideoRange");
const secondsPerVideoInput = document.getElementById("secondsPerVideoInput");
const resolutionSelect = document.getElementById("resolutionSelect");
const muteAllClipsInput = document.getElementById("muteAllClipsInput");
const selectedCountValue = document.getElementById("selectedCountValue");
const usedCountValue = document.getElementById("usedCountValue");
const durationValue = document.getElementById("durationValue");
const generateStitchBtn = document.getElementById("generateStitchBtn");
const downloadStitchBtn = document.getElementById("downloadStitchBtn");
const reconfigureBtn = document.getElementById("reconfigureBtn");
const progressStatusText = document.getElementById("progressStatusText");
const progressPercentText = document.getElementById("progressPercentText");
const stitchProgressBar = document.getElementById("stitchProgressBar");
const stitchProgressFill = document.getElementById("stitchProgressFill");
const outputPathLabel = document.getElementById("outputPathLabel");
const selectedVideosList = document.getElementById("selectedVideosList");
const secondsValue = document.getElementById("secondsValue");
const ffmpegErrorPanel = document.getElementById("ffmpegErrorPanel");
const ffmpegErrorText = document.getElementById("ffmpegErrorText");
const generatedPreviewBlock = document.getElementById("generatedPreviewBlock");
const generatedPreviewVideo = document.getElementById("generatedPreviewVideo");
const shareToMobileBtn = document.getElementById("shareToMobileBtn");
const qrShareModal = document.getElementById("qrShareModal");
const qrModalCloseBtn = document.getElementById("qrModalCloseBtn");
const qrImage = document.getElementById("qrImage");
const qrUrlLabel = document.getElementById("qrUrlLabel");
const qrStatusLabel = document.getElementById("qrStatusLabel");
const qrCountdown = document.getElementById("qrCountdown");
const qrCopyUrlBtn = document.getElementById("qrCopyUrlBtn");

const state = {
  selectedItems: [],
  generating: false,
  dragIndex: -1,
  listDnDBound: false,
  outputBlobUrl: "",
  outputFileName: "",
  nativeOutputPath: "",
  clipWarnings: new Map(),
};

const ffmpegState = {
  instance: null,
  loadingPromise: null,
  loaded: false,
  commandsTotal: 1,
  commandIndex: 0,
  currentClipLabel: "",
  stderrLines: [],
  lastFrameHint: "",
};

const mediaDurationCache = new Map();
const pendingFileReadRequests = new Map();
const pendingActionRequests = new Map();
const STITCH_SELECTION_SNAPSHOT_KEY = "snoolink.stitch.selection.v1";
const TOOLTIP_SETTINGS_KEY = "snoolink.tooltips.enabled.v1";
const MIN_SECONDS_PER_VIDEO = 0.1;
const MAX_SECONDS_PER_VIDEO = 60;
const SECONDS_PRECISION = 1;
let tooltipSystemController = null;

const STITCH_TOOLTIP_TEXT = {
  goHomeBtn: "Does: Returns to Search screen. Why: Lets you adjust clip selection without losing app context. Tip: Re-open Stitch when your queue is ready.",
  refreshSelectionBtn: "Does: Re-reads selected videos from parent workspace. Why: Sync fixes stale queue state. Tip: Use after changing selections on home screen.",
  secondsPerVideoRange: "Does: Sets per-clip duration by slider. Why: Balances rhythm and storytelling. Tip: Use 2-4 seconds for short-form reels.",
  secondsPerVideoInput: "Does: Sets per-clip duration numerically. Why: Gives precise timing control. Tip: Match this to beat or narration tempo.",
  resolutionSelect: "Does: Chooses output frame size and aspect ratio. Why: Platform fit affects visual quality and crop behavior. Tip: Use 9:16 for mobile-first content.",
  muteAllClipsInput: "Does: Toggles source audio inclusion. Why: Prevents messy overlapping audio when stitching many clips. Tip: Keep muted unless you need original sound.",
  generateStitchBtn: "Does: Generates stitched video from current queue and settings. Why: This executes the full compile pipeline. Tip: Review queue order before running.",
  downloadStitchBtn: "Does: Downloads or exports the generated stitched file. Why: Final delivery step for sharing or publishing. Tip: Preview once before download.",
  reconfigureBtn: "Does: Clears current output and returns to editable state. Why: Needed when changing queue/parameters after generation. Tip: Reconfigure before major setting changes.",
  stitchProgressBar: "Does: Shows generation progress. Why: Helps track long runs and detect stalls early. Tip: Wait for completion before navigating away.",
  outputPathLabel: "Does: Shows output filename/path status. Why: Confirms where generated result is available. Tip: Verify name before final export.",
  generatedPreviewVideo: "Does: Plays generated output preview. Why: Quality check before download/share. Tip: Inspect transitions, crop, and audio sync here.",
};

function randomRequestId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.round(numeric)));
}

function clampDecimal(value, min, max, fallback, precision = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  const clamped = Math.max(min, Math.min(max, numeric));
  const factor = 10 ** precision;
  return Math.round(clamped * factor) / factor;
}

function formatSeconds(seconds) {
  const numeric = Number(seconds);
  const safe = Number.isFinite(numeric) ? numeric : 0;
  const normalized = Math.round(Math.max(0, safe) * (10 ** SECONDS_PRECISION)) / (10 ** SECONDS_PRECISION);
  return normalized.toFixed(SECONDS_PRECISION).replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
}

function getSecondsPerVideo() {
  return clampDecimal(
    secondsPerVideoInput?.value,
    MIN_SECONDS_PER_VIDEO,
    MAX_SECONDS_PER_VIDEO,
    2,
    SECONDS_PRECISION,
  );
}

function buildStitchFileName() {
  return `snoolink-stich-${Date.now()}-${Math.random().toString(16).slice(2, 8)}.mp4`;
}

function getUsedCount() {
  return state.selectedItems.length;
}

function parseResolution(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{2,5})x(\d{2,5})$/i);
  if (!match) {
    return { width: 1080, height: 1920 };
  }
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 128 || height < 128) {
    return { width: 1080, height: 1920 };
  }
  return { width, height };
}

function formatDuration(seconds) {
  const total = Math.max(0, Number(seconds) || 0);
  if (total < 60) {
    return `${formatSeconds(total)}s`;
  }
  const mins = Math.floor(total / 60);
  const rem = Math.round((total - mins * 60) * 100) / 100;
  return rem === 0 ? `${mins}m` : `${mins}m ${formatSeconds(rem)}s`;
}

function setProgress(percent, message, status = "idle") {
  const safePercent = clampNumber(percent, 0, 100, 0);
  if (stitchProgressBar) {
    stitchProgressBar.setAttribute("aria-valuenow", String(safePercent));
    stitchProgressBar.classList.remove("processing", "complete", "error");
    if (["processing", "complete", "error"].includes(status)) {
      stitchProgressBar.classList.add(status);
    }
  }
  if (stitchProgressFill) {
    stitchProgressFill.style.width = `${safePercent}%`;
  }
  progressPercentText.textContent = `${safePercent}%`;
  progressStatusText.textContent = String(message || "Idle");
}

function clearFfmpegError() {
  if (ffmpegErrorPanel) {
    ffmpegErrorPanel.classList.add("hidden");
  }
  if (ffmpegErrorText) {
    ffmpegErrorText.textContent = "";
  }
}

function clearGeneratedPreview() {
  if (!generatedPreviewVideo) {
    return;
  }
  generatedPreviewVideo.pause();
  generatedPreviewVideo.removeAttribute("src");
  generatedPreviewVideo.load();
  if (generatedPreviewBlock) {
    generatedPreviewBlock.classList.add("hidden");
  }
}

function showGeneratedPreview(sourceUrl) {
  if (!generatedPreviewVideo || !sourceUrl) {
    clearGeneratedPreview();
    return;
  }
  generatedPreviewVideo.src = sourceUrl;
  generatedPreviewVideo.currentTime = 0;
  generatedPreviewVideo.load();
  if (generatedPreviewBlock) {
    generatedPreviewBlock.classList.remove("hidden");
  }
}

function isImagePreviewSource(value) {
  const source = String(value || "").trim().toLowerCase();
  if (!source) {
    return false;
  }
  if (source.startsWith("data:image/")) {
    return true;
  }
  return /\.(png|jpe?g|webp|gif|bmp)(\?|#|$)/i.test(source);
}

function showFfmpegError(message, stderrLines = []) {
  if (!ffmpegErrorPanel || !ffmpegErrorText) {
    return;
  }
  const details = stderrLines.length > 0 ? `\n\n${stderrLines.join("\n")}` : "";
  ffmpegErrorText.textContent = `${String(message || "Unknown FFmpeg error")}${details}`;
  ffmpegErrorPanel.classList.remove("hidden");
}

function makePreviewSrc(item) {
  const raw = String(item?.preview_src || "").trim();
  if (raw) {
    return raw;
  }
  const itemPath = String(item?.path || "").trim();
  if (!itemPath) {
    return "";
  }
  if (/^[a-z]+:\/\//i.test(itemPath)) {
    return itemPath;
  }
  if (/^[a-zA-Z]:\\/.test(itemPath)) {
    return `file:///${itemPath.replace(/\\/g, "/")}`;
  }
  return "";
}

function toReadableLocalUrl(itemPath) {
  const sourcePath = String(itemPath || "").trim();
  if (!sourcePath) {
    return "";
  }
  if (/^[a-z]+:\/\//i.test(sourcePath)) {
    return sourcePath;
  }
  if (/^[a-zA-Z]:\\/.test(sourcePath)) {
    return `file:///${sourcePath.replace(/\\/g, "/")}`;
  }
  return sourcePath;
}

function fileUrlToLocalPath(urlValue) {
  const raw = String(urlValue || "").trim();
  if (!raw) {
    return "";
  }
  if (!raw.toLowerCase().startsWith("file://")) {
    return raw;
  }

  const parsed = new URL(raw);
  let pathname = decodeURIComponent(parsed.pathname || "");
  if (/^\/[a-zA-Z]:\//.test(pathname)) {
    pathname = pathname.slice(1);
  }
  return pathname.replace(/\//g, "\\");
}

async function loadBlobUrlWithFileReadFallback(fileUrl, mimeType) {
  try {
    return await toBlobURL(fileUrl, mimeType);
  } catch {
    const localPath = fileUrlToLocalPath(fileUrl);
    const parentRead = await requestFileBytesFromParent(localPath, 15000);
    if (!parentRead?.ok || !parentRead.bytes) {
      throw new Error(String(parentRead?.message || `Could not load ${fileUrl}`));
    }
    const bytes = new Uint8Array(parentRead.bytes);
    const blob = new Blob([bytes], { type: mimeType });
    return URL.createObjectURL(blob);
  }
}

function clearDragDecorations() {
  const rows = selectedVideosList.querySelectorAll(".selection-row");
  for (const row of rows) {
    row.classList.remove("drag-over");
  }
}

function removeQueueItemAt(index) {
  const numericIndex = Number(index);
  if (!Number.isInteger(numericIndex) || numericIndex < 0 || numericIndex >= state.selectedItems.length) {
    return;
  }
  const removed = state.selectedItems[numericIndex];
  const removedPath = String(removed?.path || "");
  state.selectedItems.splice(numericIndex, 1);
  state.clipWarnings.delete(removedPath);

  if (state.outputBlobUrl || state.nativeOutputPath) {
    if (state.outputBlobUrl) {
      URL.revokeObjectURL(state.outputBlobUrl);
    }
    state.outputBlobUrl = "";
    state.outputFileName = "";
    state.nativeOutputPath = "";
    outputPathLabel.textContent = "";
    clearGeneratedPreview();
    setProgress(0, "Queue changed. Generate again to update output.", "idle");
  }

  renderSelectedList();
  updateSummaryAndActions();
}

function reorderQueue(fromIndex, toIndex) {
  const from = Number(fromIndex);
  const to = Number(toIndex);
  if (!Number.isInteger(from) || !Number.isInteger(to)) {
    return;
  }
  if (from < 0 || to < 0 || from >= state.selectedItems.length || to >= state.selectedItems.length || from === to) {
    return;
  }

  const [moved] = state.selectedItems.splice(from, 1);
  state.selectedItems.splice(to, 0, moved);

  if (state.outputBlobUrl || state.nativeOutputPath) {
    if (state.outputBlobUrl) {
      URL.revokeObjectURL(state.outputBlobUrl);
    }
    state.outputBlobUrl = "";
    state.outputFileName = "";
    state.nativeOutputPath = "";
    outputPathLabel.textContent = "";
    clearGeneratedPreview();
    setProgress(0, "Queue order changed. Generate again to apply sequence.", "idle");
  }

  renderSelectedList();
  updateSummaryAndActions();
}

function renderQueueItemDuration(item, el) {
  if (!el) {
    return;
  }
  const itemPath = String(item?.path || "").trim();
  const cached = mediaDurationCache.get(itemPath);
  if (Number.isFinite(cached) && cached > 0) {
    el.textContent = `Source: ${formatDuration(Math.round(cached))}`;
    return;
  }

  const parsed = Number(item?.duration_seconds);
  if (Number.isFinite(parsed) && parsed > 0) {
    mediaDurationCache.set(itemPath, parsed);
    el.textContent = `Source: ${formatDuration(Math.round(parsed))}`;
    return;
  }

  el.textContent = "Source: loading...";
  const previewSrc = makePreviewSrc(item);
  if (!previewSrc) {
    el.textContent = "Source: unknown";
    return;
  }

  const probe = document.createElement("video");
  probe.preload = "metadata";
  probe.src = previewSrc;
  const finalize = () => {
    probe.removeAttribute("src");
    probe.load();
  };

  probe.addEventListener("loadedmetadata", () => {
    const seconds = Number(probe.duration);
    if (Number.isFinite(seconds) && seconds > 0) {
      mediaDurationCache.set(itemPath, seconds);
      el.textContent = `Source: ${formatDuration(Math.round(seconds))}`;
    } else {
      el.textContent = "Source: unknown";
    }
    finalize();
  }, { once: true });

  probe.addEventListener("error", () => {
    el.textContent = "Source: unknown";
    finalize();
  }, { once: true });
}

function renderSelectedList() {
  selectedVideosList.innerHTML = "";

  if (state.selectedItems.length === 0) {
    const empty = document.createElement("div");
    empty.className = "selection-empty";
    empty.textContent = "No videos selected yet. Turn on Stitch Mode in Search/Gallery and pick video cards.";
    selectedVideosList.appendChild(empty);
    return;
  }

  state.selectedItems.forEach((item, index) => {
    const row = document.createElement("article");
    row.className = "selection-row";
    row.draggable = true;
    row.dataset.index = String(index);

    row.addEventListener("dragstart", (event) => {
      state.dragIndex = index;
      row.classList.add("dragging");
      event.dataTransfer?.setData("text/plain", String(index));
      event.dataTransfer.effectAllowed = "move";
    });

    row.addEventListener("dragend", () => {
      row.classList.remove("dragging");
      clearDragDecorations();
      state.dragIndex = -1;
    });

    row.addEventListener("dragover", (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      clearDragDecorations();
      row.classList.add("drag-over");
    });

    row.addEventListener("dragleave", () => {
      row.classList.remove("drag-over");
    });

    row.addEventListener("drop", (event) => {
      event.preventDefault();
      const fromValue = event.dataTransfer?.getData("text/plain");
      const from = Number.isFinite(Number(fromValue)) ? Number(fromValue) : state.dragIndex;
      reorderQueue(from, index);
    });

    const handle = document.createElement("button");
    handle.type = "button";
    handle.className = "drag-handle";
    handle.title = "Drag to reorder";
    handle.setAttribute("aria-label", "Drag to reorder");
    handle.textContent = "⠿";

    const thumbWrap = document.createElement("div");
    thumbWrap.className = "queue-thumb-wrap";

    const previewSrc = makePreviewSrc(item);
    if (previewSrc && isImagePreviewSource(previewSrc)) {
      const thumb = document.createElement("img");
      thumb.className = "queue-thumb";
      thumb.alt = "video thumbnail";
      thumb.src = previewSrc;
      thumb.addEventListener("error", () => {
        thumb.removeAttribute("src");
      }, { once: true });
      thumbWrap.appendChild(thumb);
    } else if (previewSrc) {
      const thumbVideo = document.createElement("video");
      thumbVideo.className = "queue-thumb queue-thumb-video";
      thumbVideo.muted = true;
      thumbVideo.playsInline = true;
      thumbVideo.preload = "metadata";
      thumbVideo.src = previewSrc;
      thumbVideo.addEventListener("loadedmetadata", () => {
        try {
          thumbVideo.currentTime = Math.min(0.2, Math.max(0, Number(thumbVideo.duration) || 0));
        } catch {
          // Ignore frame seek errors.
        }
      }, { once: true });
      thumbVideo.addEventListener("error", () => {
        thumbVideo.removeAttribute("src");
        thumbVideo.load();
      }, { once: true });
      thumbWrap.appendChild(thumbVideo);
    } else {
      const placeholder = document.createElement("div");
      placeholder.className = "queue-thumb queue-thumb-placeholder";
      placeholder.textContent = "No thumb";
      thumbWrap.appendChild(placeholder);
    }

    const warningMessage = state.clipWarnings.get(String(item?.path || "").trim());
    if (warningMessage) {
      const badge = document.createElement("span");
      badge.className = "queue-warning-badge";
      badge.title = warningMessage;
      badge.textContent = "!";
      thumbWrap.appendChild(badge);
    }

    const meta = document.createElement("div");
    meta.className = "queue-meta";

    const title = document.createElement("p");
    title.className = "queue-title";
    title.title = String(item?.path || "");
    title.textContent = String(item?.title || "Untitled video");

    const duration = document.createElement("p");
    duration.className = "queue-duration";
    renderQueueItemDuration(item, duration);

    meta.appendChild(title);
    meta.appendChild(duration);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "queue-remove-btn";
    removeBtn.textContent = "Remove";
    removeBtn.title = "Remove from queue";
    removeBtn.addEventListener("click", () => {
      removeQueueItemAt(index);
    });

    row.appendChild(handle);
    row.appendChild(thumbWrap);
    row.appendChild(meta);
    row.appendChild(removeBtn);
    selectedVideosList.appendChild(row);
  });

  if (!state.listDnDBound) {
    state.listDnDBound = true;
    selectedVideosList.addEventListener("dragover", (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    });

    selectedVideosList.addEventListener("drop", (event) => {
      event.preventDefault();
      const rows = Array.from(selectedVideosList.querySelectorAll(".selection-row"));
      if (rows.length === 0) {
        return;
      }
      const fromValue = event.dataTransfer?.getData("text/plain");
      const from = Number.isFinite(Number(fromValue)) ? Number(fromValue) : state.dragIndex;
      reorderQueue(from, rows.length - 1);
    });
  }
}

function updateSummaryAndActions() {
  const selectedCount = state.selectedItems.length;
  const usedCount = getUsedCount();
  const secondsPerClip = getSecondsPerVideo();
  const estimatedDuration = usedCount * secondsPerClip;

  selectedCountValue.textContent = String(selectedCount);
  usedCountValue.textContent = String(usedCount);
  durationValue.textContent = formatDuration(estimatedDuration);
  if (secondsValue) {
    secondsValue.textContent = `${formatSeconds(secondsPerClip)}s`;
  }

  generateStitchBtn.disabled = state.generating || selectedCount < 2;
  downloadStitchBtn.disabled = state.generating || (!state.outputBlobUrl && !state.nativeOutputPath);
  if (shareToMobileBtn) {
    shareToMobileBtn.disabled = state.generating || (!state.outputBlobUrl && !state.nativeOutputPath);
  }
  const inlineShareBtn = document.getElementById("inlineShareToMobileBtn");
  if (inlineShareBtn) {
    inlineShareBtn.disabled = state.generating || (!state.outputBlobUrl && !state.nativeOutputPath);
  }
  reconfigureBtn.disabled = state.generating || (!state.outputBlobUrl && !state.nativeOutputPath && state.clipWarnings.size === 0);
  refreshSelectionBtn.disabled = state.generating;
  secondsPerVideoRange.disabled = state.generating;
  secondsPerVideoInput.disabled = state.generating;
  resolutionSelect.disabled = state.generating;
  if (muteAllClipsInput) {
    muteAllClipsInput.disabled = state.generating;
  }
}

function syncNumericControls() {
  const safeSeconds = getSecondsPerVideo();
  secondsPerVideoInput.value = formatSeconds(safeSeconds);
  secondsPerVideoRange.value = formatSeconds(safeSeconds);
  updateSummaryAndActions();
}

function normalizeItems(items) {
  const list = Array.isArray(items) ? items : [];
  const byPath = new Map();
  for (const item of list) {
    const path = String(item?.path || item?.image_path || "").trim();
    if (!path) {
      continue;
    }
    byPath.set(path, {
      path,
      title: String(item?.title || "Untitled video"),
      media_type: "video",
      preview_src: String(item?.preview_src || ""),
      duration_seconds: Number(item?.duration_seconds || item?.duration || 0) || 0,
    });
  }
  return Array.from(byPath.values());
}

function readSelectionSnapshotFromStorage() {
  try {
    const raw = window.localStorage.getItem(STITCH_SELECTION_SNAPSHOT_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    return normalizeItems(parsed?.items);
  } catch {
    return [];
  }
}

function readTooltipEnabledSetting() {
  try {
    const raw = String(window.localStorage.getItem(TOOLTIP_SETTINGS_KEY) || "").trim();
    if (!raw) {
      return true;
    }
    return raw !== "0";
  } catch {
    return true;
  }
}

function readSelectionSnapshotFromParent() {
  try {
    if (!window.parent || window.parent === window) {
      return [];
    }
    const shared = window.parent.__SNOOLINK_STITCH_SELECTION__;
    return normalizeItems(shared?.items);
  } catch {
    return [];
  }
}

async function requestSelectionFromParent(timeoutMs = 4000) {
  return await new Promise((resolve) => {
    const requestId = randomRequestId();
    let settled = false;

    const finish = (items) => {
      if (settled) {
        return;
      }
      settled = true;
      window.removeEventListener("message", onMessage);
      clearTimeout(timer);
      resolve(normalizeItems(items));
    };

    const onMessage = (event) => {
      const payload = event?.data && typeof event.data === "object" ? event.data : null;
      if (!payload || payload.type !== "stitch-selection-data") {
        return;
      }
      if (String(payload.requestId || "") !== requestId) {
        return;
      }
      finish(payload.items);
    };

    const timer = setTimeout(() => {
      finish([]);
    }, Math.max(250, Number(timeoutMs) || 1200));

    window.addEventListener("message", onMessage);
    window.parent?.postMessage({
      type: "stitch-request-selection-data",
      requestId,
    }, "*");
  });
}

async function requestActionFromParent(type, payload, timeoutMs = 15 * 60 * 1000) {
  return await new Promise((resolve) => {
    const requestId = randomRequestId();
    let settled = false;

    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      pendingActionRequests.delete(requestId);
      resolve(result || { ok: false, message: "No response." });
    };

    const timer = setTimeout(() => {
      finish({ ok: false, message: "Timed out waiting for action response." });
    }, Math.max(1200, Number(timeoutMs) || 15 * 60 * 1000));

    pendingActionRequests.set(requestId, finish);
    window.parent?.postMessage({
      type,
      requestId,
      payload,
    }, "*");
  });
}

async function requestFileBytesFromParent(sourcePath, timeoutMs = 8000) {
  return await new Promise((resolve) => {
    const requestId = randomRequestId();
    let settled = false;

    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      pendingFileReadRequests.delete(requestId);
      resolve(result || { ok: false, message: "No file read response." });
    };

    const timer = setTimeout(() => {
      finish({ ok: false, message: "Timed out reading source file." });
    }, Math.max(1000, Number(timeoutMs) || 8000));

    pendingFileReadRequests.set(requestId, finish);
    window.parent?.postMessage({
      type: "stitch-read-file-request",
      requestId,
      path: sourcePath,
    }, "*");
  });
}

async function loadSelection() {
  let items = await requestSelectionFromParent();
  if (items.length === 0) {
    items = readSelectionSnapshotFromParent();
  }
  if (items.length === 0) {
    items = readSelectionSnapshotFromStorage();
  }

  state.selectedItems = items;
  state.nativeOutputPath = "";

  renderSelectedList();
  updateSummaryAndActions();

  if (items.length === 0) {
    setProgress(0, "No videos selected yet.", "idle");
    return;
  }

  setProgress(Number.parseInt(stitchProgressFill?.style.width || "0", 10), `Ready with ${items.length} selected video(s).`, "idle");
}

function sanitizeFsName(prefix, index, extension) {
  const ext = String(extension || "").replace(/[^a-z0-9.]/gi, "");
  return `${prefix}_${String(index + 1).padStart(3, "0")}${ext || ""}`;
}

async function ensureFfmpegLoaded() {
  if (ffmpegState.loaded && ffmpegState.instance) {
    return ffmpegState.instance;
  }

  if (ffmpegState.loadingPromise) {
    return await ffmpegState.loadingPromise;
  }

  ffmpegState.loadingPromise = (async () => {
    const ffmpeg = new FFmpeg();
    ffmpegState.stderrLines = [];

    ffmpeg.on("log", ({ type, message }) => {
      const text = String(message || "").trim();
      if (!text) {
        return;
      }

      if (type === "stderr") {
        ffmpegState.stderrLines.push(text);
        if (ffmpegState.stderrLines.length > 260) {
          ffmpegState.stderrLines.shift();
        }
      }

      const frameMatch = text.match(/frame=\s*([0-9]+)/i);
      if (frameMatch) {
        ffmpegState.lastFrameHint = frameMatch[1];
      }
    });

    ffmpeg.on("progress", ({ progress }) => {
      const localProgress = Math.max(0, Math.min(1, Number(progress) || 0));
      const commandBase = ffmpegState.commandIndex / Math.max(1, ffmpegState.commandsTotal);
      const commandShare = 1 / Math.max(1, ffmpegState.commandsTotal);
      const overall = Math.round((commandBase + localProgress * commandShare) * 100);
      const clipHint = ffmpegState.currentClipLabel ? ` ${ffmpegState.currentClipLabel}` : "";
      const frameHint = ffmpegState.lastFrameHint ? ` (frame ${ffmpegState.lastFrameHint})` : "";
      setProgress(overall, `Processing${clipHint}${frameHint}`, "processing");
    });

    const baseCandidates = [
      new URL("./assets/ffmpeg/", window.location.href),
      new URL("./node_modules/@ffmpeg/core/dist/esm/", window.location.href),
      new URL("./node_modules/@ffmpeg/core/dist/umd/", window.location.href),
    ];

    setProgress(2, "Loading FFmpeg core assets...", "processing");

    let loaded = false;
    const loadErrors = [];
    for (const baseUrl of baseCandidates) {
      const coreJsUrl = new URL("ffmpeg-core.js", baseUrl).href;
      const coreWasmUrl = new URL("ffmpeg-core.wasm", baseUrl).href;
      try {
        const coreURL = await loadBlobUrlWithFileReadFallback(coreJsUrl, "text/javascript");
        const wasmURL = await loadBlobUrlWithFileReadFallback(coreWasmUrl, "application/wasm");
        await ffmpeg.load({ coreURL, wasmURL });
        loaded = true;
        break;
      } catch (error) {
        loadErrors.push(`${coreJsUrl} -> ${String(error?.message || error)}`);
      }
    }

    if (!loaded) {
      throw new Error(`Could not load ffmpeg core assets. Attempts:\n${loadErrors.join("\n")}`);
    }

    ffmpegState.instance = ffmpeg;
    ffmpegState.loaded = true;
    return ffmpeg;
  })();

  try {
    const loaded = await ffmpegState.loadingPromise;
    return loaded;
  } finally {
    ffmpegState.loadingPromise = null;
  }
}

async function runFfmpegCommand(ffmpeg, args, contextLabel) {
  ffmpegState.currentClipLabel = contextLabel;
  ffmpegState.lastFrameHint = "";
  try {
    await ffmpeg.exec(args);
  } finally {
    ffmpegState.commandIndex += 1;
  }
}

async function loadItemBytes(item) {
  const sourcePath = String(item?.path || "").trim();
  const fileUrl = toReadableLocalUrl(sourcePath);
  if (!fileUrl) {
    throw new Error("Missing local path");
  }

  try {
    const bytes = await fetchFile(fileUrl);
    if (!bytes || bytes.length === 0) {
      throw new Error("File was empty or unreadable");
    }
    return bytes;
  } catch {
    const parentRead = await requestFileBytesFromParent(sourcePath);
    if (parentRead?.ok && parentRead.bytes) {
      try {
        return new Uint8Array(parentRead.bytes);
      } catch {
        throw new Error("Parent read returned invalid bytes");
      }
    }
    throw new Error(String(parentRead?.message || "Could not read file"));
  }
}

function markClipWarning(item, message) {
  const itemPath = String(item?.path || "").trim();
  if (!itemPath) {
    return;
  }
  state.clipWarnings.set(itemPath, String(message || "Unreadable clip"));
}

async function generateStitch() {
  const queuedItems = state.selectedItems.slice();
  if (queuedItems.length < 2) {
    setProgress(0, "Select at least 2 videos before generating.", "error");
    return;
  }

  clearFfmpegError();
  state.clipWarnings.clear();
  renderSelectedList();

  if (state.outputBlobUrl) {
    URL.revokeObjectURL(state.outputBlobUrl);
    state.outputBlobUrl = "";
    state.outputFileName = "";
  }
  state.nativeOutputPath = "";
  outputPathLabel.textContent = "";
  clearGeneratedPreview();

  const seconds = getSecondsPerVideo();
  const muteAll = Boolean(muteAllClipsInput?.checked ?? true);
  const { width, height } = parseResolution(resolutionSelect.value);
  const stitchFps = 24;
  const stitchGop = stitchFps * 2;
  const normalizedVideoFilter = [
    `scale=${width}:${height}:force_original_aspect_ratio=increase:flags=bicubic`,
    `crop=${width}:${height}`,
    `fps=${stitchFps}`,
    "format=yuv420p",
    "setsar=1",
  ].join(",");
  const fallbackPayload = {
    items: queuedItems,
    secondsPerVideo: seconds,
    resolution: `${width}x${height}`,
    muteAll,
  };

  state.generating = true;
  updateSummaryAndActions();

  setProgress(1, "Using native FFmpeg for faster generation...", "processing");
  const nativeFirstResult = await requestActionFromParent("stitch-generate-request", fallbackPayload);
  if (nativeFirstResult?.ok && nativeFirstResult.path) {
    state.nativeOutputPath = String(nativeFirstResult.path);
    state.outputFileName = String(nativeFirstResult.fileName || buildStitchFileName());
    outputPathLabel.textContent = `Ready (native): ${state.outputFileName}`;
    showGeneratedPreview(toReadableLocalUrl(state.nativeOutputPath));
    setProgress(100, "Generated via native FFmpeg.", "complete");
    state.generating = false;
    updateSummaryAndActions();
    return;
  }

  setProgress(1, "Loading FFmpeg.wasm...", "processing");

  let ffmpeg = null;
  try {
    ffmpeg = await ensureFfmpegLoaded();
  } catch (error) {
    const message = `Could not load FFmpeg.wasm: ${String(error?.message || error)}`;
    setProgress(4, `${message} Falling back to native FFmpeg...`, "processing");
    const nativeResult = await requestActionFromParent("stitch-generate-request", fallbackPayload);
    if (nativeResult?.ok && nativeResult.path) {
      state.nativeOutputPath = String(nativeResult.path);
      state.outputFileName = String(nativeResult.fileName || buildStitchFileName());
      outputPathLabel.textContent = `Ready (native fallback): ${state.outputFileName}`;
      showGeneratedPreview(toReadableLocalUrl(state.nativeOutputPath));
      setProgress(100, "Generated via native fallback.", "complete");
      state.generating = false;
      updateSummaryAndActions();
      return;
    }

    setProgress(0, message, "error");
    showFfmpegError(
      `${message}\nNative fallback failed: ${String(nativeResult?.message || "Unknown error")}`,
      ffmpegState.stderrLines.slice(-40),
    );
    state.generating = false;
    updateSummaryAndActions();
    return;
  }

  const successful = [];

  const estimatedCommands = Math.max(1, queuedItems.length + 1);
  ffmpegState.commandsTotal = estimatedCommands;
  ffmpegState.commandIndex = 0;
  ffmpegState.stderrLines = [];

  try {
    for (let i = 0; i < queuedItems.length; i += 1) {
      const item = queuedItems[i];
      const label = `clip ${i + 1}/${queuedItems.length}`;

      let bytes;
      try {
        bytes = await loadItemBytes(item);
      } catch (error) {
        markClipWarning(item, `Skipped: ${String(error?.message || error)}`);
        renderSelectedList();
        setProgress(
          Math.round((ffmpegState.commandIndex / Math.max(1, ffmpegState.commandsTotal)) * 100),
          `Skipped unreadable ${label}`,
          "processing",
        );
        continue;
      }

      const inputName = sanitizeFsName("input", i, ".mp4");
      const outputName = sanitizeFsName("output", i, ".mp4");

      await ffmpeg.writeFile(inputName, bytes);

      const clipArgs = [
        "-i", inputName,
        "-ss", "0",
        "-t", String(seconds),
        "-vf", normalizedVideoFilter,
        "-r", String(stitchFps),
        "-vsync", "cfr",
        "-c:v", "libx264",
        "-preset", "superfast",
        "-g", String(stitchGop),
        "-keyint_min", String(stitchGop),
        "-sc_threshold", "0",
        "-crf", "24",
        "-pix_fmt", "yuv420p",
      ];

      if (muteAll) {
        clipArgs.push("-an");
      } else {
        clipArgs.push("-af", "aresample=async=1:first_pts=0", "-c:a", "aac", "-b:a", "128k");
      }

      clipArgs.push("-movflags", "+faststart");
      clipArgs.push(outputName);
      await runFfmpegCommand(ffmpeg, clipArgs, label);

      successful.push({ item, outputName });

      try {
        await ffmpeg.deleteFile(inputName);
      } catch {
        // Ignore cleanup errors.
      }
    }

    if (successful.length < 2) {
      throw new Error("Less than 2 readable clips remained after skipping unreadable files.");
    }

    const listLines = successful.map((entry) => `file '${entry.outputName}'`).join("\n");
    await ffmpeg.writeFile("list.txt", new TextEncoder().encode(`${listLines}\n`));

    await runFfmpegCommand(ffmpeg, [
      "-f", "concat",
      "-safe", "0",
      "-i", "list.txt",
      "-r", String(stitchFps),
      "-vsync", "cfr",
      "-c:v", "libx264",
      "-preset", "superfast",
      "-g", String(stitchGop),
      "-keyint_min", String(stitchGop),
      "-sc_threshold", "0",
      "-crf", "24",
      "-pix_fmt", "yuv420p",
      ...(muteAll ? ["-an"] : ["-c:a", "aac", "-b:a", "128k"]),
      "-movflags", "+faststart",
      "final.mp4",
    ], "concat final");

    const finalData = await ffmpeg.readFile("final.mp4");
    const blob = new Blob([finalData.buffer], { type: "video/mp4" });
    const blobUrl = URL.createObjectURL(blob);
    const outputFileName = buildStitchFileName();

    state.outputBlobUrl = blobUrl;
    state.outputFileName = outputFileName;
    outputPathLabel.textContent = `Ready: ${outputFileName}`;
    showGeneratedPreview(blobUrl);

    setProgress(100, `Stitch complete. ${successful.length} clip(s) used.`, "complete");

    if (state.clipWarnings.size > 0) {
      renderSelectedList();
      setProgress(100, `Completed with ${state.clipWarnings.size} warning(s).`, "complete");
    }
  } catch (error) {
    const message = String(error?.message || error || "Unknown FFmpeg failure");
    setProgress(8, `FFmpeg failed: ${message}. Falling back to native FFmpeg...`, "processing");
    const nativeResult = await requestActionFromParent("stitch-generate-request", fallbackPayload);
    if (nativeResult?.ok && nativeResult.path) {
      state.nativeOutputPath = String(nativeResult.path);
      state.outputFileName = String(nativeResult.fileName || buildStitchFileName());
      outputPathLabel.textContent = `Ready (native fallback): ${state.outputFileName}`;
      showGeneratedPreview(toReadableLocalUrl(state.nativeOutputPath));
      setProgress(100, "Generated via native fallback.", "complete");
    } else {
      setProgress(0, `FFmpeg failed: ${message}`, "error");
      showFfmpegError(
        `FFmpeg failed: ${message}\nNative fallback failed: ${String(nativeResult?.message || "Unknown error")}`,
        ffmpegState.stderrLines.slice(-120),
      );
    }
  } finally {
    state.generating = false;
    updateSummaryAndActions();
  }
}

async function downloadStitch() {
  if (!state.outputBlobUrl && !state.nativeOutputPath) {
    setProgress(0, "No generated stitch video to download.", "error");
    return;
  }

  if (!state.outputBlobUrl && state.nativeOutputPath) {
    const result = await requestActionFromParent("stitch-download-request", { sourcePath: state.nativeOutputPath });
    if (!result?.ok) {
      setProgress(0, `Native download failed: ${String(result?.message || "Unknown error")}`, "error");
      return;
    }

    setProgress(
      100,
      `Download started: ${String(result?.path || result?.directory || state.outputFileName || "stitch.mp4")}`,
      "complete",
    );
    return;
  }

  const anchor = document.createElement("a");
  anchor.href = state.outputBlobUrl;
  anchor.download = state.outputFileName || buildStitchFileName();
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  setProgress(
    Number.parseInt(stitchProgressFill?.style.width || "0", 10),
    `Download started: ${anchor.download}`,
    "complete",
  );
}

function resetGenerationState() {
  if (state.outputBlobUrl) {
    URL.revokeObjectURL(state.outputBlobUrl);
    state.outputBlobUrl = "";
  }
  state.outputFileName = "";
  state.nativeOutputPath = "";
  state.clipWarnings.clear();
  outputPathLabel.textContent = "";
  clearGeneratedPreview();
  clearFfmpegError();
  renderSelectedList();
  setProgress(0, "Configuration reset.", "idle");
  updateSummaryAndActions();
}

// ─── QR Share Modal ────────────────────────────────────────────

const qrModalState = {
  countdownTimer: null,
  secondsLeft: 0,
  activeUrl: "",
};

function closeQrModal() {
  if (qrShareModal) {
    qrShareModal.classList.add("hidden");
  }
  if (qrModalState.countdownTimer) {
    clearInterval(qrModalState.countdownTimer);
    qrModalState.countdownTimer = null;
  }
  qrModalState.activeUrl = "";
  void requestActionFromParent("stitch-stop-share-server-request", {});
}

function startQrCountdown(seconds) {
  if (qrModalState.countdownTimer) {
    clearInterval(qrModalState.countdownTimer);
  }
  qrModalState.secondsLeft = seconds;

  function tick() {
    const m = Math.floor(qrModalState.secondsLeft / 60);
    const s = qrModalState.secondsLeft % 60;
    const countdownEl = document.getElementById("qrCountdown");
    if (countdownEl) {
      countdownEl.textContent = `${m}:${String(s).padStart(2, "0")}`;
    }
    if (qrModalState.secondsLeft <= 0) {
      clearInterval(qrModalState.countdownTimer);
      qrModalState.countdownTimer = null;
      if (qrStatusLabel) {
        qrStatusLabel.textContent = "Expired — close and try again.";
        qrStatusLabel.classList.add("expired");
      }
    } else {
      qrModalState.secondsLeft -= 1;
    }
  }

  tick();
  qrModalState.countdownTimer = setInterval(tick, 1000);
}

function setShareBtnBusy(busy) {
  const label = busy ? "Starting server…" : "Share to Mobile via QR";
  const disabled = busy || (!state.outputBlobUrl && !state.nativeOutputPath);
  [shareToMobileBtn, document.getElementById("inlineShareToMobileBtn")].forEach((btn) => {
    if (!btn) return;
    btn.textContent = label;
    btn.disabled = disabled;
  });
}

async function openQrShareModal() {
  if (!state.outputBlobUrl && !state.nativeOutputPath) {
    setProgress(0, "No generated video to share. Generate first.", "error");
    return;
  }

  setShareBtnBusy(true);

  const filePath = state.nativeOutputPath;
  let sharePayload;

  if (filePath) {
    // Native path — pass file path directly
    sharePayload = { filePath };
  } else if (state.outputBlobUrl) {
    // WASM blob — read bytes and send them in one call (main process saves temp file + starts server)
    try {
      const response = await fetch(state.outputBlobUrl);
      const buffer = await response.arrayBuffer();
      sharePayload = {
        bytes: new Uint8Array(buffer),
        fileName: state.outputFileName || `snoolink-share-${Date.now()}.mp4`,
      };
    } catch (error) {
      setShareBtnBusy(false);
      setProgress(0, `Share setup failed: ${String(error?.message || error)}`, "error");
      return;
    }
  } else {
    setShareBtnBusy(false);
    setProgress(0, "No generated video to share.", "error");
    return;
  }

  const result = await requestActionFromParent("stitch-share-server-request", sharePayload);

  setShareBtnBusy(false);

  if (!result?.ok) {
    setProgress(0, `Share failed: ${result?.message || "Unknown error"}`, "error");
    return;
  }

  qrModalState.activeUrl = result.url;

  if (qrImage) {
    qrImage.src = result.qrDataUrl || "";
    qrImage.alt = "QR code for " + result.url;
  }
  if (qrUrlLabel) {
    qrUrlLabel.textContent = result.url;
  }
  if (qrStatusLabel) {
    qrStatusLabel.classList.remove("expired");
  }

  if (qrShareModal) {
    qrShareModal.classList.remove("hidden");
  }

  startQrCountdown(5 * 60);
}

if (qrModalCloseBtn) {
  qrModalCloseBtn.addEventListener("click", closeQrModal);
}

if (qrShareModal) {
  const backdrop = qrShareModal.querySelector(".qr-modal-backdrop");
  if (backdrop) {
    backdrop.addEventListener("click", closeQrModal);
  }
}

if (qrCopyUrlBtn) {
  qrCopyUrlBtn.addEventListener("click", async () => {
    const url = qrModalState.activeUrl;
    if (!url) {
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      qrCopyUrlBtn.textContent = "Copied!";
      setTimeout(() => {
        qrCopyUrlBtn.textContent = "Copy URL";
      }, 2000);
    } catch {
      // Fallback to desktop API
      window.desktopAPI?.copyText?.(url);
    }
  });
}

if (shareToMobileBtn) {
  shareToMobileBtn.addEventListener("click", () => {
    void openQrShareModal();
  });
}

const inlineShareToMobileBtn = document.getElementById("inlineShareToMobileBtn");
if (inlineShareToMobileBtn) {
  inlineShareToMobileBtn.addEventListener("click", () => {
    void openQrShareModal();
  });
}

// ───────────────────────────────────────────────────────────────

if (goHomeBtn) {
  goHomeBtn.addEventListener("click", () => {
    window.parent?.postMessage({ type: "stitch-open-home" }, "*");
  });
}

if (refreshSelectionBtn) {
  refreshSelectionBtn.addEventListener("click", () => {
    setProgress(Number.parseInt(stitchProgressFill?.style.width || "0", 10), "Refreshing selection...", "idle");
    void loadSelection();
  });
}

if (secondsPerVideoRange) {
  secondsPerVideoRange.addEventListener("input", () => {
    secondsPerVideoInput.value = formatSeconds(
      clampDecimal(
        secondsPerVideoRange.value,
        MIN_SECONDS_PER_VIDEO,
        MAX_SECONDS_PER_VIDEO,
        2,
        SECONDS_PRECISION,
      ),
    );
    syncNumericControls();
  });
}

if (secondsPerVideoInput) {
  secondsPerVideoInput.addEventListener("input", () => {
    secondsPerVideoRange.value = formatSeconds(
      clampDecimal(
        secondsPerVideoInput.value,
        MIN_SECONDS_PER_VIDEO,
        MAX_SECONDS_PER_VIDEO,
        2,
        SECONDS_PRECISION,
      ),
    );
    syncNumericControls();
  });
}

if (resolutionSelect) {
  resolutionSelect.addEventListener("change", syncNumericControls);
}

if (muteAllClipsInput) {
  muteAllClipsInput.addEventListener("change", syncNumericControls);
}

if (generateStitchBtn) {
  generateStitchBtn.addEventListener("click", () => {
    void generateStitch();
  });
}

if (downloadStitchBtn) {
  downloadStitchBtn.addEventListener("click", () => {
    void downloadStitch();
  });
}

if (reconfigureBtn) {
  reconfigureBtn.addEventListener("click", resetGenerationState);
}

window.addEventListener("message", (event) => {
  const payload = event?.data && typeof event.data === "object" ? event.data : null;
  if (!payload) {
    return;
  }

  if (payload.type === "stitch-read-file-response") {
    const requestId = String(payload.requestId || "");
    const resolveRequest = pendingFileReadRequests.get(requestId);
    if (resolveRequest) {
      resolveRequest(payload);
    }
    return;
  }

  if (payload.type === "stitch-action-response") {
    const requestId = String(payload.requestId || "");
    const resolveRequest = pendingActionRequests.get(requestId);
    if (resolveRequest) {
      resolveRequest(payload);
    }
    return;
  }

  if (payload.type === "stitch-selection-updated") {
    if (Array.isArray(payload.items)) {
      state.selectedItems = normalizeItems(payload.items);
      state.clipWarnings.clear();
      renderSelectedList();
      updateSummaryAndActions();
      setProgress(
        Number.parseInt(stitchProgressFill?.style.width || "0", 10),
        `Ready with ${state.selectedItems.length} selected video(s).`,
        "idle",
      );
      return;
    }
    void loadSelection();
  }

  if (payload.type === "stitch-tooltip-settings-updated") {
    tooltipSystemController?.setEnabled(Boolean(payload.enabled));
  }
});

syncNumericControls();
setProgress(0, "Idle", "idle");
tooltipSystemController = installTooltipSystem({
  customTextById: STITCH_TOOLTIP_TEXT,
  buttonHoverDelayMs: 1500,
  enabled: readTooltipEnabledSetting(),
});
void loadSelection();
window.parent?.postMessage({ type: "stitch-request-selection-sync" }, "*");
window.setTimeout(() => {
  if (state.selectedItems.length === 0 && !state.generating) {
    void loadSelection();
  }
}, 800);
