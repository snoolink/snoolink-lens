import { normalizeMediaType } from "./previewVideo.js";

// ─── CSS ──────────────────────────────────────────────────────────────────────

const PANEL_CSS = `
.ipp-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.72);
  backdrop-filter: blur(8px);
  display: flex; align-items: stretch;
  z-index: 1000;
}
.ipp-overlay.hidden { display: none; }

.ipp-panel {
  display: grid;
  grid-template-columns: 1fr 380px;
  grid-template-rows: 48px 1fr auto 64px;
  grid-template-areas: "topbar topbar" "viewer sidebar" "vtoolbar sidebar" "filmstrip filmstrip";
  width: 100%; height: 100%;
  background: #141518;
  font-family: 'DM Sans', system-ui, sans-serif;
  color: #f0f0f2;
  overflow: hidden;
}

/* ── TOPBAR ── */
.ipp-topbar {
  grid-area: topbar;
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 16px;
  border-bottom: 1px solid rgba(255,255,255,0.07);
  background: #141518;
}
.ipp-breadcrumb {
  display: flex; align-items: center; gap: 6px;
  font-size: 12px; color: #54575f;
  font-family: 'IBM Plex Mono', monospace;
}
.ipp-breadcrumb .ipp-bc-sep { opacity: 0.4; }
.ipp-breadcrumb .ipp-bc-current { color: #8a8d96; }
.ipp-topbar-actions { display: flex; align-items: center; gap: 4px; }

.ipp-btn {
  height: 28px; padding: 0 10px;
  border: 1px solid rgba(255,255,255,0.12);
  background: #1a1c20; color: #8a8d96;
  font-family: inherit; font-size: 11.5px; font-weight: 500;
  border-radius: 5px; cursor: pointer;
  transition: background .15s, color .15s, border-color .15s;
  white-space: nowrap; display: inline-flex; align-items: center; gap: 5px;
}
.ipp-btn:hover { background: #202228; color: #f0f0f2; }
.ipp-btn.accent {
  background: rgba(91,127,255,0.15); color: #5b7fff;
  border-color: rgba(91,127,255,0.3);
}
.ipp-btn.accent:hover { background: rgba(91,127,255,0.25); }
.ipp-btn.danger:hover { color: #f04438; border-color: rgba(240,68,56,0.3); background: rgba(240,68,56,0.08); }

.ipp-close-btn {
  width: 28px; height: 28px; margin-left: 4px;
  border: 1px solid rgba(255,255,255,0.07);
  background: transparent; color: #54575f;
  border-radius: 5px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  font-size: 14px; transition: all .15s;
}
.ipp-close-btn:hover { background: #202228; color: #f0f0f2; }

/* ── VIEWER ── */
.ipp-viewer {
  grid-area: viewer;
  position: relative;
  background: #0a0b0d;
  display: flex; align-items: center; justify-content: center;
  overflow: hidden;
}
.ipp-viewer.is-panning { cursor: grabbing; }
.ipp-img { max-width: 100%; max-height: 100%; object-fit: contain; user-select: none; border-radius: 4px; }
.ipp-video { max-width: 100%; max-height: 100%; }
.ipp-img.hidden, .ipp-video.hidden { display: none; }

.ipp-nav {
  position: absolute; top: 50%; transform: translateY(-50%);
  width: 36px; height: 36px;
  background: rgba(0,0,0,0.55); border: 1px solid rgba(255,255,255,0.1);
  color: #f0f0f2; border-radius: 50%; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  font-size: 15px; transition: all .15s; z-index: 2;
  backdrop-filter: blur(6px);
}
.ipp-nav:hover { background: rgba(91,127,255,0.3); border-color: #5b7fff; }
.ipp-nav.prev { left: 14px; }
.ipp-nav.next { right: 14px; }

.ipp-zoom-badge {
  position: absolute; top: 12px; right: 12px;
  background: rgba(0,0,0,0.6); border: 1px solid rgba(255,255,255,0.07);
  color: #8a8d96; font-family: 'IBM Plex Mono', monospace; font-size: 11px;
  padding: 3px 8px; border-radius: 20px; backdrop-filter: blur(6px);
  pointer-events: none;
}

/* ── VIDEO TIMELINE HIGHLIGHT — overlaid on native <video> controls ── */
/*
  We overlay a thin progress track on top of the native video seekbar.
  The native seekbar sits ~12px from the bottom of the controls bar.
  We cannot truly inject into shadow DOM, so we position a pointer-events-none
  overlay that visually lines up with the native timeline track.
*/
.ipp-video-highlight-track {
  position: absolute;
  left: 0; right: 0;
  /* Chrome/Edge native controls bar is ~40px tall; seekbar thumb centre ≈ 28px from bottom of controls */
  bottom: 28px;
  height: 4px;
  pointer-events: none;
  z-index: 3;
  opacity: 0;
  transition: opacity .3s;
}
.ipp-video-highlight-track.visible { opacity: 1; }
.ipp-video-highlight-segment {
  position: absolute;
  top: 0; height: 100%;
  background: rgba(91,127,255,0.55);
  border-radius: 2px;
  transition: opacity .3s;
  box-shadow: 0 0 4px rgba(91,127,255,0.7);
}

/* ── VIEWER TOOLBAR (below viewer) ── */
.ipp-vtoolbar-row {
  grid-area: vtoolbar;
  display: flex; align-items: center; justify-content: center;
  gap: 2px;
  background: #141518;
  border-top: 1px solid rgba(255,255,255,0.07);
  border-bottom: 1px solid rgba(255,255,255,0.07);
  padding: 6px 16px;
}

.ipp-vt-btn {
  width: 30px; height: 30px; background: transparent; border: none;
  color: #8a8d96; cursor: pointer; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  transition: background .12s, color .12s;
}
.ipp-vt-btn:hover { background: #202228; color: #f0f0f2; }
.ipp-vt-sep { width: 1px; height: 16px; background: rgba(255,255,255,0.07); margin: 0 4px; }

/* ── SIDEBAR ── */
.ipp-sidebar {
  grid-area: sidebar;
  border-left: 1px solid rgba(255,255,255,0.07);
  overflow-y: auto; overflow-x: hidden;
  scrollbar-width: thin; scrollbar-color: #25282f transparent;
  display: flex; flex-direction: column;
}
.ipp-sidebar::-webkit-scrollbar { width: 4px; }
.ipp-sidebar::-webkit-scrollbar-thumb { background: #25282f; border-radius: 2px; }

/* Status strip */
.ipp-status-strip {
  display: flex; gap: 6px; flex-wrap: wrap;
  padding: 8px 14px;
  background: #1a1c20;
  border-bottom: 1px solid rgba(255,255,255,0.07);
  flex-shrink: 0;
}
.ipp-badge {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 10.5px; font-weight: 500; padding: 2px 8px 2px 6px;
  border-radius: 20px; border: 1px solid transparent;
  font-family: 'IBM Plex Mono', monospace;
}
.ipp-badge::before { content: ""; width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0; }
.ipp-badge.green  { color: #3ecf8e; background: rgba(62,207,142,.1);  border-color: rgba(62,207,142,.2);  }
.ipp-badge.green::before  { background: #3ecf8e; }
.ipp-badge.amber  { color: #f5a623; background: rgba(245,166,35,.1);  border-color: rgba(245,166,35,.2);  }
.ipp-badge.amber::before  { background: #f5a623; }
.ipp-badge.muted  { color: #54575f; background: #1a1c20; border-color: rgba(255,255,255,0.07); }
.ipp-badge.muted::before  { background: #54575f; }

/* Section */
.ipp-section { border-bottom: 1px solid rgba(255,255,255,0.07); }
.ipp-section-hdr {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 14px; cursor: pointer; user-select: none;
  transition: background .12s;
}
.ipp-section-hdr:hover { background: #202228; }
.ipp-section-title {
  font-size: 10px; font-weight: 500; letter-spacing: 0.1em;
  text-transform: uppercase; color: #54575f;
  font-family: 'IBM Plex Mono', monospace;
}
.ipp-section-chevron { color: #54575f; transition: transform .2s; display: flex; }
.ipp-section.collapsed .ipp-section-chevron { transform: rotate(-90deg); }
.ipp-section.collapsed .ipp-section-body { display: none; }
.ipp-section-body { padding: 0 14px 14px; }

/* Meta grid */
.ipp-meta-grid { display: grid; grid-template-columns: 88px 1fr; }
.ipp-meta-grid dt {
  color: #54575f; font-family: 'IBM Plex Mono', monospace;
  font-size: 10.5px; padding: 3.5px 0; align-self: start;
}
.ipp-meta-grid dd { color: #8a8d96; padding: 3.5px 0 3.5px 8px; font-size: 11.5px; word-break: break-all; }

/* Sub-label */
.ipp-sub-label {
  font-family: 'IBM Plex Mono', monospace; font-size: 9.5px;
  letter-spacing: 0.07em; text-transform: uppercase;
  color: #54575f; margin: 10px 0 6px;
}
.ipp-sub-label:first-child { margin-top: 0; }

.ipp-divider { height: 1px; background: rgba(255,255,255,0.07); margin: 10px 0; }

/* Rating */
.ipp-rating { display: flex; gap: 3px; }
.ipp-star {
  background: none; border: none; color: #54575f;
  font-size: 18px; cursor: pointer; padding: 0 1px;
  transition: color .12s, transform .1s; line-height: 1;
}
.ipp-star:hover, .ipp-star.active { color: #f5a623; }
.ipp-star:hover { transform: scale(1.2); }

/* Score bar */
.ipp-score-row { display: flex; align-items: center; gap: 8px; padding: 3px 0; }
.ipp-score-label {
  font-family: 'IBM Plex Mono', monospace; font-size: 10px;
  color: #54575f; width: 100px; flex-shrink: 0;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.ipp-score-bar { flex: 1; height: 3px; background: #25282f; border-radius: 2px; overflow: hidden; }
.ipp-score-fill { height: 100%; background: #5b7fff; border-radius: 2px; transition: width .4s ease; }
.ipp-score-val { font-family: 'IBM Plex Mono', monospace; font-size: 10px; color: #8a8d96; width: 26px; text-align: right; flex-shrink: 0; }

/* AI description */
.ipp-ai-text { font-size: 12px; line-height: 1.7; color: #8a8d96; }
.ipp-ai-card { font-size: 12px; line-height: 1.7; color: #8a8d96; }

/* Timeline */
.ipp-timeline { display: flex; flex-direction: column; gap: 5px; }
.ipp-tl-item {
  border: 1px solid rgba(255,255,255,0.07); border-radius: 8px; overflow: hidden;
  transition: border-color .15s;
}
.ipp-tl-item:hover { border-color: rgba(255,255,255,0.12); }
.ipp-tl-item.active-segment { border-color: rgba(91,127,255,0.4); background: rgba(91,127,255,0.04); }
.ipp-tl-hdr {
  display: flex; align-items: center; gap: 7px;
  padding: 7px 10px; cursor: pointer; background: #1a1c20;
}
.ipp-tl-item.active-segment .ipp-tl-hdr { background: rgba(91,127,255,0.08); }
.ipp-tl-badge {
  font-family: 'IBM Plex Mono', monospace; font-size: 10px; font-weight: 500;
  color: #5b7fff; background: rgba(91,127,255,.15);
  border: 1px solid rgba(91,127,255,.25); border-radius: 4px;
  padding: 2px 7px; cursor: pointer; transition: background .12s; white-space: nowrap;
}
.ipp-tl-badge:hover { background: rgba(91,127,255,.25); }
.ipp-tl-item.active-segment .ipp-tl-badge {
  background: rgba(91,127,255,.3); border-color: rgba(91,127,255,.5);
}
.ipp-tl-preview {
  font-size: 11.5px; color: #8a8d96; flex: 1;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin: 0;
}
.ipp-tl-chevron { margin-left: auto; color: #54575f; transition: transform .18s; flex-shrink: 0; display: flex; }
.ipp-tl-item.expanded .ipp-tl-chevron { transform: rotate(180deg); }
.ipp-tl-full {
  display: none; padding: 8px 10px; font-size: 11.5px; line-height: 1.65;
  color: #8a8d96; border-top: 1px solid rgba(255,255,255,0.07);
  background: #141518; margin: 0;
}
.ipp-tl-item.expanded .ipp-tl-full { display: block; }

/* OCR */
.ipp-ocr {
  background: #0a0b0d; border: 1px solid rgba(255,255,255,0.07);
  border-radius: 5px; padding: 8px 10px;
  font-family: 'IBM Plex Mono', monospace; font-size: 10.5px;
  color: #8a8d96; line-height: 1.7; white-space: pre-wrap;
  word-break: break-word; max-height: 120px; overflow-y: auto;
  scrollbar-width: thin;
}

/* Tag cloud */
.ipp-tag-cloud { display: flex; flex-wrap: wrap; gap: 5px; }
.ipp-tag {
  display: inline-flex; align-items: center; gap: 4px;
  background: #25282f; border: 1px solid rgba(255,255,255,0.07);
  color: #8a8d96; font-size: 10.5px; padding: 2px 8px; border-radius: 20px;
}
.ipp-tag-rm {
  background: none; border: none; color: #54575f;
  cursor: pointer; font-size: 13px; line-height: 1; padding: 0;
  transition: color .12s;
}
.ipp-tag-rm:hover { color: #f04438; }
.ipp-tag-input-row { display: flex; gap: 5px; margin-top: 8px; }
.ipp-tag-input {
  flex: 1; background: #0a0b0d; border: 1px solid rgba(255,255,255,0.07);
  border-radius: 5px; color: #f0f0f2; font-family: inherit;
  font-size: 11.5px; padding: 5px 9px; outline: none;
  transition: border-color .15s;
}
.ipp-tag-input:focus { border-color: #5b7fff; }
.ipp-tag-input::placeholder { color: #54575f; }

/* Notes */
.ipp-notes {
  width: 100%; background: #0a0b0d;
  border: 1px solid rgba(255,255,255,0.07); border-radius: 5px;
  color: #f0f0f2; font-family: inherit; font-size: 11.5px;
  line-height: 1.6; padding: 8px 10px; resize: vertical;
  min-height: 72px; outline: none; transition: border-color .15s;
}
.ipp-notes:focus { border-color: #5b7fff; }
.ipp-notes::placeholder { color: #54575f; }

/* Raw */
.ipp-raw-pre {
  background: #0a0b0d; border: 1px solid rgba(255,255,255,0.07);
  border-radius: 5px; padding: 8px 10px;
  font-family: 'IBM Plex Mono', monospace; font-size: 10px;
  color: #8a8d96; white-space: pre; overflow: auto;
  max-height: 180px; scrollbar-width: thin; line-height: 1.7;
}
.ipp-raw-actions { display: flex; gap: 5px; margin-top: 8px; }

/* ── FILMSTRIP ── */
.ipp-filmstrip-bar {
  grid-area: filmstrip;
  border-top: 1px solid rgba(255,255,255,0.07);
  background: #141518;
  display: flex; align-items: center; gap: 12px;
  padding: 0 16px; overflow: hidden;
}
.ipp-img-count {
  font-family: 'IBM Plex Mono', monospace; font-size: 10.5px;
  color: #54575f; white-space: nowrap; flex-shrink: 0;
}
.ipp-filmstrip {
  display: flex; gap: 5px; overflow-x: auto; flex: 1;
  scrollbar-width: none; padding: 8px 0;
}
.ipp-filmstrip::-webkit-scrollbar { display: none; }
.ipp-filmstrip-thumb {
  width: 42px; height: 42px; border-radius: 5px;
  border: 2px solid transparent; background: #1a1c20;
  overflow: hidden; cursor: pointer; flex-shrink: 0;
  transition: border-color .15s;
}
.ipp-filmstrip-thumb.active { border-color: #5b7fff; }
.ipp-filmstrip-thumb:hover:not(.active) { border-color: rgba(255,255,255,0.12); }
.ipp-filmstrip-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
`;

function injectStyles() {
  if (document.getElementById("ipp-styles")) return;
  const style = document.createElement("style");
  style.id = "ipp-styles";
  style.textContent = PANEL_CSS;
  document.head.appendChild(style);
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function toMetadataText(details) {
  const normalizedCloudMetadata = details?.cloud_metadata
    ? details.cloud_metadata
    : details?.model_id || details?.description || details?.ocr
      ? {
          id: details?.id || null,
          image_path: details?.image_path || details?.path || "",
          model_id: details?.model_id || null,
          analyzed_at: details?.analyzed_at || null,
          description: details?.description || "",
          ocr: details?.ocr || { all_text: "", entries: [] },
          status: details?.status || "unknown",
          error: details?.error || "",
        }
      : null;

  return JSON.stringify({
    path: details?.path || "",
    image_path: details?.image_path || details?.path || "",
    id: details?.id || null,
    status: details?.status || "unknown",
    metadata: details?.metadata || {},
    local_metadata: details?.local_metadata || null,
    cloud_metadata: normalizedCloudMetadata,
    error: details?.error || "",
  }, null, 2);
}

function parseTimestampToSeconds(ts) {
  const parts = String(ts || "").trim().split(":").map(Number);
  if (parts.some(isNaN)) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

function parseTimestampedDescription(description) {
  if (!description) return null;

  const SECOND_RE = /second\s+(\d+(?:\.\d+)?)\s*:/gi;
  const BRACKET_RE = /\[(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[-–]\s*\d{1,2}:\d{2}(?::\d{2})?)?)\]/g;

  let matches = [];
  let m;

  while ((m = SECOND_RE.exec(description)) !== null) {
    matches.push({ label: `${m[1]}s`, seekSeconds: parseFloat(m[1]), index: m.index, end: SECOND_RE.lastIndex });
  }

  if (matches.length === 0) {
    while ((m = BRACKET_RE.exec(description)) !== null) {
      const ts = m[1].trim();
      matches.push({ label: ts, seekSeconds: parseTimestampToSeconds(ts.split(/[-–]/)[0].trim()), index: m.index, end: BRACKET_RE.lastIndex });
    }
  }

  if (matches.length === 0) return null;

  const preamble = description.slice(0, matches[0].index).trim();
  const segments = matches.map((current, i) => ({
    label: current.label,
    seekSeconds: current.seekSeconds,
    text: description.slice(current.end, matches[i + 1]?.index ?? description.length).trim(),
  }));

  return { preamble, segments };
}

function splitPathSegments(value) {
  return String(value || "").replaceAll("\\", "/").split("/").filter(Boolean);
}

// ─── ICON SVGs ────────────────────────────────────────────────────────────────

const ICONS = {
  chevronDown: `<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3.5l3 3 3-3"/></svg>`,
  fit:         `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="1" width="14" height="14" rx="2"/><path d="M5 8h6M8 5v6"/></svg>`,
  zoomIn:      `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="7" cy="7" r="5"/><path d="M11 11l3 3M5 7h4M7 5v4"/></svg>`,
  zoomOut:     `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="7" cy="7" r="5"/><path d="M11 11l3 3M5 7h4"/></svg>`,
  rotateLeft:  `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3"/></svg>`,
  rotateRight: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-.49-3"/></svg>`,
  flipH:       `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 2v12M4 5l-3 3 3 3M12 5l3 3-3 3"/></svg>`,
  fullscreen:  `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M1 1h4M1 1v4M15 1h-4M15 1v4M1 15h4M1 15v-4M15 15h-4M15 15v-4"/></svg>`,
  share:       `<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="13" cy="3" r="2"/><circle cx="3" cy="8" r="2"/><circle cx="13" cy="13" r="2"/><path d="M5 7l6-3M5 9l6 3"/></svg>`,
};

// ─── SECTION BUILDER ──────────────────────────────────────────────────────────

function makeSection(id, title, bodyHTML, startCollapsed = false) {
  const sec = document.createElement("div");
  sec.className = "ipp-section" + (startCollapsed ? " collapsed" : "");
  sec.id = id;
  sec.innerHTML = `
    <div class="ipp-section-hdr">
      <span class="ipp-section-title">${title}</span>
      <span class="ipp-section-chevron">${ICONS.chevronDown}</span>
    </div>
    <div class="ipp-section-body">${bodyHTML}</div>
  `;
  sec.querySelector(".ipp-section-hdr").addEventListener("click", () => {
    sec.classList.toggle("collapsed");
  });
  return sec;
}

// ─── MAIN EXPORT ──────────────────────────────────────────────────────────────

export function createImagePreviewPanel(options = {}) {
  injectStyles();

  const normalizeImageSrc    = options.normalizeImageSrc    || ((v) => v);
  const resolvePreviewSrc    = options.resolvePreviewSrc    || (async (p) => ({ ok: true, previewSrc: normalizeImageSrc(p), converted: false }));
  const resolveDetails       = options.resolveDetails       || (async () => ({ metadata: {} }));
  const onOpenSourceFolder   = options.onOpenSourceFolder   || (async () => ({ ok: false, message: "Action unavailable." }));
  const onCopyText           = options.onCopyText           || (async () => ({ ok: false, message: "Action unavailable." }));
  const onDelete             = options.onDelete             || (async () => ({ ok: false, message: "Action unavailable." }));
  const onExport             = options.onExport             || (async () => ({ ok: false, message: "Action unavailable." }));
  const onCloudIndex         = options.onCloudIndex         || (async () => ({ ok: false, message: "Action unavailable." }));
  const onAddToAlbum         = options.onAddToAlbum         || (async () => ({ ok: false, message: "Action unavailable." }));
  const onShareLink          = options.onShareLink          || (async () => ({ ok: false, message: "Action unavailable." }));
  const onNavigate           = options.onNavigate           || (() => {});
  const setStatus            = options.setStatus            || (() => {});

  // ── BUILD DOM ────────────────────────────────────────────────────

  const overlay = document.createElement("div");
  overlay.className = "ipp-overlay hidden";
  overlay.setAttribute("aria-hidden", "true");

  // Topbar
  const topbar = document.createElement("div");
  topbar.className = "ipp-topbar";
  topbar.innerHTML = `
    <div class="ipp-breadcrumb">
      <span class="ipp-bc-root">Library</span>
      <span class="ipp-bc-sep">›</span>
      <span class="ipp-bc-folder">Folder</span>
      <span class="ipp-bc-sep">›</span>
      <span class="ipp-bc-current ipp-title">Details</span>
    </div>
    <div class="ipp-topbar-actions">
      <button class="ipp-btn ipp-show-meta-btn"      type="button">Show Metadata</button>
      <button class="ipp-btn accent ipp-album-btn"  type="button">Add to album</button>
      <button class="ipp-btn ipp-export-btn"         type="button">Download</button>
      <button class="ipp-btn ipp-cloud-index-btn"    type="button">Cloud index</button>
      <button class="ipp-btn danger ipp-delete-btn"  type="button">Delete</button>
      <button class="ipp-close-btn" type="button" aria-label="Close preview">✕</button>
    </div>
  `;

  // Viewer
  const viewer = document.createElement("section");
  viewer.className = "ipp-viewer";
  viewer.setAttribute("aria-label", "Image viewer");
  viewer.innerHTML = `
    <button class="ipp-nav prev" type="button" aria-label="Previous image">&#8592;</button>
    <img  class="ipp-img"   alt="Selected preview" />
    <video class="ipp-video hidden" controls preload="auto" playsinline webkit-playsinline="true"></video>
    <div class="ipp-video-highlight-track">
      <div class="ipp-video-highlight-segment"></div>
    </div>
    <button class="ipp-nav next" type="button" aria-label="Next image">&#8594;</button>
    <span class="ipp-zoom-badge">100%</span>
  `;

  // Viewer toolbar row — sits BELOW the viewer in the grid
  const vtoolbarRow = document.createElement("div");
  vtoolbarRow.className = "ipp-vtoolbar-row";
  vtoolbarRow.innerHTML = `
    <button class="ipp-vt-btn" data-action="fit"          title="Fit to screen">${ICONS.fit}</button>
    <button class="ipp-vt-btn" data-action="zoom-in"      title="Zoom in">${ICONS.zoomIn}</button>
    <button class="ipp-vt-btn" data-action="zoom-out"     title="Zoom out">${ICONS.zoomOut}</button>
    <div class="ipp-vt-sep"></div>
    <button class="ipp-vt-btn" data-action="rotate-left"  title="Rotate left">${ICONS.rotateLeft}</button>
    <button class="ipp-vt-btn" data-action="rotate-right" title="Rotate right">${ICONS.rotateRight}</button>
    <button class="ipp-vt-btn" data-action="flip-h"       title="Flip horizontal">${ICONS.flipH}</button>
    <div class="ipp-vt-sep"></div>
    <button class="ipp-vt-btn" data-action="fullscreen"   title="Fullscreen">${ICONS.fullscreen}</button>
  `;

  // Sidebar — built from discrete sections
  const sidebar = document.createElement("section");
  sidebar.className = "ipp-sidebar";
  sidebar.setAttribute("aria-label", "Image details");

  // Status strip (always visible, not collapsible)
  const statusStrip = document.createElement("div");
  statusStrip.className = "ipp-status-strip";
  sidebar.appendChild(statusStrip);

  // ── Section: AI Analysis — open by default ──
  const secAI = makeSection("ipp-sec-ai", "AI analysis", `
    <div class="ipp-sub-label" style="margin-top:0" id="ipp-ai-desc-label">Description</div>
    <div class="ipp-ai-description"></div>
    <div class="ipp-divider"></div>
    <div class="ipp-sub-label">Scores &amp; attributes</div>
    <div class="ipp-objects-list"></div>
    <div class="ipp-divider"></div>
    <div class="ipp-sub-label">OCR text</div>
    <pre class="ipp-ocr">No text detected.</pre>
  `, false /* open */);
  sidebar.appendChild(secAI);

  // ── Section: File & Camera — collapsed by default ──
  const secFile = makeSection("ipp-sec-file", "File details", `
    <dl class="ipp-meta-grid ipp-file-details"></dl>
    <div class="ipp-divider"></div>
    <div class="ipp-sub-label">Camera &amp; lens</div>
    <dl class="ipp-meta-grid ipp-exif-details"></dl>
    <div class="ipp-divider"></div>
    <div class="ipp-sub-label">Rating</div>
    <div class="ipp-rating">
      ${[1,2,3,4,5].map(i => `<button class="ipp-star" data-value="${i}" type="button" aria-label="${i} star">★</button>`).join("")}
    </div>
  `, true /* collapsed */);
  sidebar.appendChild(secFile);

  // ── Section: Tags & Notes — collapsed by default ──
  const secTags = makeSection("ipp-sec-tags", "Tags &amp; notes", `
    <div class="ipp-sub-label" style="margin-top:0">Tags</div>
    <div class="ipp-tag-cloud ipp-tag-row"></div>
    <div class="ipp-tag-input-row">
      <input type="text" class="ipp-tag-input" placeholder="Add tag…" aria-label="New tag" />
      <button class="ipp-btn ipp-tag-add-btn" type="button">Add</button>
    </div>
    <div class="ipp-divider"></div>
    <div class="ipp-sub-label">Notes</div>
    <textarea class="ipp-notes" placeholder="Add a note…" rows="4"></textarea>
  `, true /* collapsed */);
  sidebar.appendChild(secTags);

  // ── Section: Raw JSON — collapsed by default ──
  const secRaw = makeSection("ipp-sec-raw", "Raw metadata", `
    <pre class="ipp-raw-pre ipp-meta-raw"></pre>
    <div class="ipp-raw-actions">
      <button class="ipp-btn ipp-copy-btn"  type="button">Copy JSON</button>
      <button class="ipp-btn ipp-open-btn"  type="button">Open folder</button>
    </div>
  `, true /* collapsed */);
  sidebar.appendChild(secRaw);

  // Filmstrip bar
  const filmstripBar = document.createElement("div");
  filmstripBar.className = "ipp-filmstrip-bar";
  filmstripBar.innerHTML = `
    <span class="ipp-img-count"></span>
    <div class="ipp-filmstrip"></div>
    <button class="ipp-btn ipp-share-btn" type="button">${ICONS.share} Share</button>
  `;

  // Assemble panel
  const panel = document.createElement("div");
  panel.className = "ipp-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-label", "Image preview details");
  panel.appendChild(topbar);
  panel.appendChild(viewer);
  panel.appendChild(sidebar);
  panel.appendChild(vtoolbarRow);
  panel.appendChild(filmstripBar);

  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  // ── Element refs ──────────────────────────────────────────────────

  const imageEl             = overlay.querySelector(".ipp-img");
  const videoEl             = overlay.querySelector(".ipp-video");
  const videoHighlightTrack = overlay.querySelector(".ipp-video-highlight-track");
  const videoHighlightSeg   = overlay.querySelector(".ipp-video-highlight-segment");
  const titleEl             = overlay.querySelector(".ipp-title");
  const folderEl            = overlay.querySelector(".ipp-bc-folder");
  const zoomBadge           = overlay.querySelector(".ipp-zoom-badge");
  const prevBtn             = overlay.querySelector(".ipp-nav.prev");
  const nextBtn             = overlay.querySelector(".ipp-nav.next");
  const showMetaBtn         = overlay.querySelector(".ipp-show-meta-btn");
  const albumBtn            = overlay.querySelector(".ipp-album-btn");
  const exportBtn           = overlay.querySelector(".ipp-export-btn");
  const cloudIndexBtn       = overlay.querySelector(".ipp-cloud-index-btn");
  const deleteBtn           = overlay.querySelector(".ipp-delete-btn");
  const closeBtn            = overlay.querySelector(".ipp-close-btn");
  const copyBtn             = overlay.querySelector(".ipp-copy-btn");
  const openBtn             = overlay.querySelector(".ipp-open-btn");
  const shareBtn            = overlay.querySelector(".ipp-share-btn");
  const fileDetails         = overlay.querySelector(".ipp-file-details");
  const exifDetails         = overlay.querySelector(".ipp-exif-details");
  const metaRaw             = overlay.querySelector(".ipp-meta-raw");
  const aiDesc              = overlay.querySelector(".ipp-ai-description");
  const aiDescLabel         = overlay.querySelector("#ipp-ai-desc-label");
  const ocrText             = overlay.querySelector(".ipp-ocr");
  const objectsList         = overlay.querySelector(".ipp-objects-list");
  const tagRow              = overlay.querySelector(".ipp-tag-row");
  const tagInput            = overlay.querySelector(".ipp-tag-input");
  const tagAddBtn           = overlay.querySelector(".ipp-tag-add-btn");
  const imgCount            = overlay.querySelector(".ipp-img-count");
  const filmstrip           = overlay.querySelector(".ipp-filmstrip");
  const stars               = overlay.querySelectorAll(".ipp-star");

  let currentDetails = null;
  let currentRow = null;
  let metadataLoaded = false;
  let metadataRequestToken = 0;
  let metadataLoadInFlight = false;
  let currentRating  = 0;
  let albumActionInFlight = false;

  const transformState = { scale: 1, translateX: 0, translateY: 0, rotation: 0, flipX: 1 };
  const dragState = { active: false, lastX: 0, lastY: 0 };

  // ── VIDEO TIMELINE HIGHLIGHT ──────────────────────────────────────

  // Tracks the active highlight segment { startSecs, endSecs }
  let _activeHighlight = null;
  let _lockPlaybackToHighlight = false;
  // Tracks all timeline segment items for active-segment styling
  let _timelineItems = [];
  let _clipTimeUpdateHandler = null;
  let _clipEmptiedHandler = null;

  function clearVideoClipPlaybackHandlers() {
    if (_clipTimeUpdateHandler) {
      videoEl.removeEventListener("timeupdate", _clipTimeUpdateHandler);
      _clipTimeUpdateHandler = null;
    }
    if (_clipEmptiedHandler) {
      videoEl.removeEventListener("emptied", _clipEmptiedHandler);
      _clipEmptiedHandler = null;
    }
  }

  function applyVideoHighlight(startSecs, endSecs) {
    _activeHighlight = { startSecs, endSecs };
    const dur = videoEl.duration;
    if (!dur || !isFinite(dur)) return;

    const startPct = Math.max(0, Math.min(100, (startSecs / dur) * 100));
    const effectiveEnd = endSecs != null ? endSecs : Math.min(dur, startSecs + 5);
    const endPct = Math.max(0, Math.min(100, (effectiveEnd / dur) * 100));

    videoHighlightSeg.style.left  = `${startPct}%`;
    videoHighlightSeg.style.width = `${endPct - startPct}%`;
    videoHighlightSeg.style.opacity = "1";
    videoHighlightTrack.classList.add("visible");
  }

  function clearVideoHighlight() {
    _activeHighlight = null;
    _lockPlaybackToHighlight = false;
    videoHighlightTrack.classList.remove("visible");
    _timelineItems.forEach(item => item.el.classList.remove("active-segment"));
  }

  function updateActiveTimelineSegment(currentTime) {
    if (!_timelineItems.length) return;
    _timelineItems.forEach(({ el, startSecs, endSecs }) => {
      const after  = currentTime >= startSecs;
      const before = endSecs == null ? true : currentTime < endSecs;
      el.classList.toggle("active-segment", after && before);
    });
  }

  function updateProgressFill() {
    if (!videoEl.duration || !isFinite(videoEl.duration)) return;

    if (
      _lockPlaybackToHighlight
      && _activeHighlight?.endSecs != null
      && videoEl.currentTime >= _activeHighlight.endSecs
    ) {
      videoEl.currentTime = _activeHighlight.startSecs;
      if (videoEl.paused) {
        videoEl.play().catch(() => {});
      }
      return;
    }

    // Fade highlight when we've moved past the segment end
    if (_activeHighlight?.endSecs != null && videoEl.currentTime > _activeHighlight.endSecs + 1) {
      videoHighlightSeg.style.opacity = "0.3";
    } else if (_activeHighlight) {
      videoHighlightSeg.style.opacity = "1";
    }

    updateActiveTimelineSegment(videoEl.currentTime);
  }

  videoEl.addEventListener("timeupdate", updateProgressFill);

  videoEl.addEventListener("loadedmetadata", () => {
    updateProgressFill();
    // Re-apply pending highlight now that duration is known
    if (_activeHighlight) {
      applyVideoHighlight(_activeHighlight.startSecs, _activeHighlight.endSecs);
    }
  });

  videoEl.addEventListener("ended", () => {
    clearVideoHighlight();
  });

  // ── TRANSFORM ─────────────────────────────────────────────────────

  function renderTransform() {
    if (!videoEl.classList.contains("hidden")) {
      videoEl.style.transform = "none";
      return;
    }
    const { scale, flipX, rotation, translateX: tx, translateY: ty } = transformState;
    imageEl.style.transform = `translate(${tx}px,${ty}px) rotate(${rotation}deg) scale(${scale * flipX},${scale})`;
  }

  function syncZoomUi() {
    const pct = `${Math.round(transformState.scale * 100)}%`;
    zoomBadge.textContent = pct;
  }

  function setZoomPercent(percent) {
    if (!videoEl.classList.contains("hidden")) return;
    transformState.scale = Math.max(0.25, Math.min(3, (Number(percent) || 100) / 100));
    syncZoomUi();
    renderTransform();
  }

  function resetTransformState() {
    Object.assign(transformState, { scale: 1, translateX: 0, translateY: 0, rotation: 0, flipX: 1 });
    syncZoomUi();
    renderTransform();
  }

  function nudgePan(dx, dy) {
    if (!videoEl.classList.contains("hidden")) return;
    transformState.translateX += dx;
    transformState.translateY += dy;
    renderTransform();
  }

  // Viewer toolbar actions
  vtoolbarRow.querySelectorAll(".ipp-vt-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const action = btn.dataset.action;
      const pct = Math.round(transformState.scale * 100);
      if (action === "zoom-in")      setZoomPercent(pct + 25);
      if (action === "zoom-out")     setZoomPercent(pct - 25);
      if (action === "fit")          resetTransformState();
      if (action === "rotate-left")  { transformState.rotation -= 90; renderTransform(); }
      if (action === "rotate-right") { transformState.rotation += 90; renderTransform(); }
      if (action === "flip-h")       { transformState.flipX *= -1; renderTransform(); }
      if (action === "fullscreen") {
        const el = videoEl.classList.contains("hidden") ? imageEl : videoEl;
        if (el.requestFullscreen) el.requestFullscreen();
      }
    });
  });

  // Scroll-to-zoom
  viewer.addEventListener("wheel", (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const pct = Math.round(transformState.scale * 100);
    setZoomPercent(e.deltaY < 0 ? pct + 8 : pct - 8);
  }, { passive: false });

  // Drag-to-pan
  viewer.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    if (e.target?.closest(".ipp-nav") || e.target?.closest(".ipp-vt-btn")) return;
    dragState.active = true;
    dragState.lastX = e.clientX;
    dragState.lastY = e.clientY;
    viewer.classList.add("is-panning");
  });
  window.addEventListener("mousemove", (e) => {
    if (!dragState.active) return;
    nudgePan(e.clientX - dragState.lastX, e.clientY - dragState.lastY);
    dragState.lastX = e.clientX;
    dragState.lastY = e.clientY;
  });
  window.addEventListener("mouseup", () => {
    dragState.active = false;
    viewer.classList.remove("is-panning");
  });

  // ── MEDIA SOURCE ──────────────────────────────────────────────────

  function refreshVideoPlayback() {
    if (videoEl.classList.contains("hidden") || !videoEl.src) return;
    imageEl.classList.add("hidden");
    videoEl.classList.remove("hidden");
    if (videoEl.readyState < 2) videoEl.load();
    if (videoEl.paused) videoEl.play().catch(() => {});
  }

  async function applyPreviewImageSource(imagePath, preferredPreviewSrc, mediaType, previewContext = null) {
    const normalized = normalizeMediaType(mediaType, imagePath);
    clearVideoClipPlaybackHandlers();

    if (normalized === "video") {
      imageEl.classList.add("hidden");
      imageEl.src = "";
      videoEl.classList.remove("hidden");
      videoHighlightTrack.style.display = "";
      let src = String(preferredPreviewSrc || "").trim() || normalizeImageSrc(imagePath);
      let clipStartSeconds = Number(previewContext?.clip_start_seconds);
      let clipEndSeconds = Number(previewContext?.clip_end_seconds);
      try {
        if (!preferredPreviewSrc) {
          const res = await resolvePreviewSrc(imagePath, normalized, previewContext || currentDetails || {});
          const s = String(res?.previewSrc || "").trim();
          if (res?.ok && s) src = s;
          // Use returned clip times if present
          if (res?.clipStartSeconds != null) clipStartSeconds = Number(res.clipStartSeconds);
          if (res?.clipEndSeconds != null) clipEndSeconds = Number(res.clipEndSeconds);
        }
      } catch { /* keep normalized */ }

      let fallbackAttempted = false;
      videoEl.onerror = async () => {
        if (fallbackAttempted) { videoEl.src = ""; return; }
        fallbackAttempted = true;
        try {
          // Fallback: force transcoding to MP4
          const fb = await resolvePreviewSrc(imagePath, normalized, { ...(previewContext || currentDetails || {}), forceTranscode: true });
          const s = String(fb?.previewSrc || "").trim();
          if (fb?.ok && s && s !== videoEl.src) { videoEl.src = s; videoEl.play().catch(() => {}); return; }
        } catch { /* ignore */ }
        videoEl.src = "";
      };

      videoEl.src = src;
      videoEl.preload = "auto";
      videoEl.playsInline = true;
      videoEl.currentTime = 0;
      videoEl.play().catch(() => {});

      // If timeframe is specified, seek and lock playback to that window
      if (Number.isFinite(clipStartSeconds) && Number.isFinite(clipEndSeconds) && clipEndSeconds > clipStartSeconds) {
        _lockPlaybackToHighlight = true;
        _activeHighlight = { startSecs: clipStartSeconds, endSecs: clipEndSeconds };
        const applyClipWindow = () => {
          applyVideoHighlight(clipStartSeconds, clipEndSeconds);
          videoEl.currentTime = clipStartSeconds;
          videoEl.play().catch(() => {});
        };
        if (videoEl.duration && isFinite(videoEl.duration)) {
          applyClipWindow();
        } else {
          videoEl.addEventListener("loadedmetadata", applyClipWindow, { once: true });
        }
        // Stop playback at end time
        _clipTimeUpdateHandler = () => {
          if (videoEl.currentTime >= clipEndSeconds) {
            videoEl.pause();
            videoEl.currentTime = clipStartSeconds;
          }
        };
        videoEl.addEventListener("timeupdate", _clipTimeUpdateHandler);
        // Remove listener on source change
        _clipEmptiedHandler = () => {
          clearVideoClipPlaybackHandlers();
        };
        videoEl.addEventListener("emptied", _clipEmptiedHandler, { once: true });
      }
      return;
    }

    clearVideoClipPlaybackHandlers();
    videoEl.pause();
    videoEl.src = "";
    videoEl.load();
    videoEl.classList.add("hidden");
    videoHighlightTrack.style.display = "none";
    let src = String(preferredPreviewSrc || "").trim() || normalizeImageSrc(imagePath);
    try {
      if (!preferredPreviewSrc) {
        const res = await resolvePreviewSrc(imagePath, normalized);
        const s = String(res?.previewSrc || "").trim();
        if (res?.ok && s) src = s;
      }
    } catch { /* keep normalized */ }

    imageEl.classList.remove("hidden");
    let fallbackAttempted = false;
    imageEl.onerror = async () => {
      if (fallbackAttempted) { imageEl.src = ""; return; }
      fallbackAttempted = true;
      try {
        const fb = await resolvePreviewSrc(imagePath, normalized);
        const s = String(fb?.previewSrc || "").trim();
        if (fb?.ok && s && s !== imageEl.src) { imageEl.src = s; return; }
      } catch { /* ignore */ }
      imageEl.src = "";
    };
    imageEl.src = src;
  }

  // ── RATING ────────────────────────────────────────────────────────

  function setRating(value) {
    currentRating = value;
    stars.forEach(s => s.classList.toggle("active", Number(s.dataset.value) <= value));
  }
  stars.forEach(s => s.addEventListener("click", () => setRating(Number(s.dataset.value))));

  // ── TAGS ──────────────────────────────────────────────────────────

  function addTag(label) {
    if (!label) return;
    const span = document.createElement("span");
    span.className = "ipp-tag";
    const rm = document.createElement("button");
    rm.className = "ipp-tag-rm";
    rm.textContent = "×";
    rm.type = "button";
    rm.setAttribute("aria-label", `Remove tag ${label}`);
    rm.addEventListener("click", () => span.remove());
    span.append(document.createTextNode(label), rm);
    tagRow.appendChild(span);
  }

  tagAddBtn.addEventListener("click", () => { addTag(tagInput.value.trim()); tagInput.value = ""; });
  tagInput.addEventListener("keydown", e => { if (e.key === "Enter") { addTag(tagInput.value.trim()); tagInput.value = ""; } });

  // ── META GRID RENDER ──────────────────────────────────────────────

  function renderMetaGrid(el, pairs) {
    el.innerHTML = pairs
      .filter(([, v]) => v != null && v !== "")
      .map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`)
      .join("");
  }

  // ── STATUS STRIP ──────────────────────────────────────────────────

  function renderStatusStrip(details) {
    const cm = details?.cloud_metadata || {};
    const localStatus = details?.status || "ok";
    const cloudStatus = cm.status || "unknown";

    statusStrip.innerHTML = "";

    const localBadge = document.createElement("span");
    localBadge.className = `ipp-badge ${localStatus === "ok" || localStatus === "indexed" ? "green" : "amber"}`;
    localBadge.textContent = localStatus === "ok" ? "Indexed" : localStatus;
    statusStrip.appendChild(localBadge);

    const cloudBadge = document.createElement("span");
    cloudBadge.className = `ipp-badge ${cloudStatus === "ok" ? "green" : cloudStatus === "unknown" ? "muted" : "amber"}`;
    cloudBadge.textContent = `Cloud: ${cloudStatus}`;
    statusStrip.appendChild(cloudBadge);
  }

  // ── AI DESCRIPTION ────────────────────────────────────────────────

  function buildTimelineItem({ label, seekSeconds, endSeconds, text }, videoElement) {
    const item = document.createElement("div");
    item.className = "ipp-tl-item";

    const hdr = document.createElement("div");
    hdr.className = "ipp-tl-hdr";

    const badge = document.createElement("button");
    badge.className = "ipp-tl-badge";
    badge.type = "button";
    badge.textContent = label;
    badge.setAttribute("aria-label", `Jump to ${label}`);

    if (seekSeconds != null) {
      badge.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!videoElement.classList.contains("hidden")) {
          videoElement.currentTime = seekSeconds;
          videoElement.play().catch(() => {});

          // Apply highlight — defer if metadata not yet loaded
          const doHighlight = () => applyVideoHighlight(seekSeconds, endSeconds ?? null);
          if (videoElement.duration && isFinite(videoElement.duration)) {
            doHighlight();
          } else {
            videoElement.addEventListener("loadedmetadata", doHighlight, { once: true });
          }

          // Mark this item active immediately; timeupdate will refine
          _timelineItems.forEach(ti => ti.el.classList.remove("active-segment"));
          item.classList.add("active-segment");
          item.classList.add("expanded");
        }
      });
    } else {
      badge.disabled = true;
    }

    const preview = document.createElement("p");
    preview.className = "ipp-tl-preview";
    preview.textContent = text || "—";

    const chevron = document.createElement("span");
    chevron.className = "ipp-tl-chevron";
    chevron.innerHTML = ICONS.chevronDown;

    const full = document.createElement("p");
    full.className = "ipp-tl-full";
    full.textContent = text || "—";

    hdr.append(badge, preview, chevron);

    hdr.addEventListener("click", (e) => {
      if (badge.contains(e.target)) return;
      item.classList.toggle("expanded");
    });

    item.append(hdr, full);
    return item;
  }

  function renderAIDescription(description, isVideo) {
    aiDesc.innerHTML = "";
    _timelineItems = [];

    if (!description) {
      const card = document.createElement("div");
      card.className = "ipp-ai-card";
      card.textContent = "No description available.";
      aiDesc.appendChild(card);
      aiDescLabel.textContent = "Description";
      return;
    }

    const parsed = isVideo ? parseTimestampedDescription(description) : null;

    if (!parsed) {
      const card = document.createElement("div");
      card.className = "ipp-ai-text";
      card.textContent = description;
      aiDesc.appendChild(card);
      aiDescLabel.textContent = "Description";
      return;
    }

    aiDescLabel.textContent = "Timeline";

    if (parsed.preamble) {
      const pre = document.createElement("div");
      pre.className = "ipp-ai-text";
      pre.style.marginBottom = "8px";
      pre.textContent = parsed.preamble;
      aiDesc.appendChild(pre);
    }

    const timeline = document.createElement("div");
    timeline.className = "ipp-timeline";

    parsed.segments.forEach((seg, i) => {
      const endSeconds = parsed.segments[i + 1]?.seekSeconds ?? null;
      const item = buildTimelineItem({ ...seg, endSeconds }, videoEl);
      timeline.appendChild(item);

      // Register for active-segment tracking
      _timelineItems.push({
        el: item,
        startSecs: seg.seekSeconds ?? 0,
        endSecs: endSeconds,
      });
    });

    aiDesc.appendChild(timeline);
  }

  // ── SCORE / TAG SECTIONS ──────────────────────────────────────────

  function renderObjectsList(details) {
    objectsList.innerHTML = "";
    const cm = details?.cloud_metadata || {};

    const addTagRow = (label, values) => {
      const rows = Array.isArray(values) ? values.filter(Boolean) : [];
      if (!rows.length) return;
      const row = document.createElement("div");
      row.style.cssText = "display:flex;gap:6px;align-items:flex-start;padding:3px 0;";
      row.innerHTML = `<span style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:#54575f;width:96px;flex-shrink:0;padding-top:2px">${label}</span>
        <span style="font-size:11px;color:#8a8d96;line-height:1.6">${rows.join(", ")}</span>`;
      objectsList.appendChild(row);
    };

    const addScoreRow = (label, value) => {
      const score = Number(value);
      if (!Number.isFinite(score)) return;
      const pct = Math.max(0, Math.min(100, Math.round(score)));
      const row = document.createElement("div");
      row.className = "ipp-score-row";
      row.innerHTML = `
        <span class="ipp-score-label">${label}</span>
        <div class="ipp-score-bar"><div class="ipp-score-fill" style="width:${pct}%"></div></div>
        <span class="ipp-score-val">${pct}</span>`;
      objectsList.appendChild(row);
    };

    const addScalarRow = (label, value) => {
      const v = String(value || "").trim();
      if (!v) return;
      const row = document.createElement("div");
      row.style.cssText = "display:flex;gap:6px;padding:3px 0;";
      row.innerHTML = `<span style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:#54575f;width:96px;flex-shrink:0">${label}</span>
        <span style="font-size:11px;color:#8a8d96">${v}</span>`;
      objectsList.appendChild(row);
    };

    addScoreRow("Social media",  cm?.socialMediaScore);
    addScoreRow("Instagram",     cm?.instagramScore);
    addTagRow("Scene",           cm?.sceneTags);
    addTagRow("Objects",         cm?.objectTags);
    addTagRow("Activity",        cm?.activityTags);
    addTagRow("Aspect ratio",    cm?.aspectRatioSuitability);
    addScalarRow("Aesthetic",    cm?.aestheticStyle);
    addScalarRow("Editing",      cm?.editingLevel);
    addScalarRow("Complexity",   cm?.visualComplexity);
    addScalarRow("Hero element", cm?.heroElement);
    addScalarRow("Depth of field", cm?.depthOfField);
  }

  // ── POPULATE SECTIONS ─────────────────────────────────────────────

  function populateFileSection(details) {
    const lm = details?.local_metadata || {};
    const cm = details?.cloud_metadata || {};

    renderMetaGrid(fileDetails, [
      ["Filename",   details?.path?.split("/").pop() || ""],
      ["Size",       lm.size_bytes ? `${(lm.size_bytes / 1048576).toFixed(1)} MB` : ""],
      ["Dimensions", lm.width && lm.height ? `${lm.width} × ${lm.height} px` : ""],
      ["Format",     lm.format || ""],
      ["Analyzed",   cm.analyzed_at ? new Date(cm.analyzed_at).toLocaleDateString() : ""],
    ]);

    const meta = details?.metadata || {};
    renderMetaGrid(exifDetails, [
      ["Camera",    meta.camera        || ""],
      ["Lens",      meta.lens          || ""],
      ["Focal",     meta.focal_length  || ""],
      ["Aperture",  meta.aperture      || ""],
      ["Shutter",   meta.shutter       || ""],
      ["ISO",       meta.iso           || ""],
    ]);

    if (meta.rating) setRating(Number(meta.rating));
  }

  function populateAISection(details) {
    const cm = details?.cloud_metadata || {};
    const isVideo = details?.media_type === "video";
    renderAIDescription(cm.description || "", isVideo);
    renderObjectsList(details);
    ocrText.textContent = cm.ocr?.all_text?.trim() || "No text detected.";
  }

  function populateTagsSection(details) {
    tagRow.innerHTML = "";
    const cm = details?.cloud_metadata || {};
    const all = Array.from(new Set([
      ...(Array.isArray(details?.metadata?.tags) ? details.metadata.tags : []),
      ...(Array.isArray(cm?.sceneTags)   ? cm.sceneTags   : []),
      ...(Array.isArray(cm?.objectTags)  ? cm.objectTags  : []),
      ...(Array.isArray(cm?.activityTags)? cm.activityTags: []),
    ]));
    all.forEach(t => addTag(t));
  }

  function setMetadataDeferredUi() {
    aiDescLabel.textContent = "Metadata";
    aiDesc.innerHTML = `<div class="ipp-ai-card">Metadata is deferred. Click "Show Metadata" to load full analysis.</div>`;
    objectsList.innerHTML = "";
    ocrText.textContent = "Metadata not loaded.";
    metaRaw.textContent = "Metadata is deferred. Click \"Show Metadata\" to load it.";
  }

  async function loadMetadataForCurrentRow() {
    if (!currentRow || metadataLoaded || metadataLoadInFlight) {
      return;
    }

    metadataLoadInFlight = true;
    const requestToken = ++metadataRequestToken;
    showMetaBtn.disabled = true;
    showMetaBtn.textContent = "Loading…";
    setStatus("Loading metadata…");

    const imagePath = String(currentRow?.path || currentRow?.image_path || "");
    const mediaType = normalizeMediaType(currentRow?.media_type || currentRow?.metadata?.media_type, imagePath);

    try {
      const resolved = await resolveDetails(currentRow);
      if (requestToken !== metadataRequestToken) {
        return;
      }

      currentDetails = {
        path: imagePath,
        media_type: mediaType,
        ...resolved,
        clip_mode: currentRow?.clip_mode || null,
        clip_start_seconds: currentRow?.clip_start_seconds,
        clip_end_seconds: currentRow?.clip_end_seconds,
      };
      titleEl.textContent = currentDetails?.metadata?.title || titleEl.textContent;
      metaRaw.textContent = toMetadataText(currentDetails);
      renderStatusStrip(currentDetails);
      populateFileSection(currentDetails);
      populateAISection(currentDetails);
      populateTagsSection(currentDetails);
      metadataLoaded = true;
      showMetaBtn.textContent = "Metadata loaded";
      setStatus("Metadata loaded.");
    } catch (err) {
      if (requestToken !== metadataRequestToken) {
        return;
      }
      currentDetails = {
        path: imagePath,
        media_type: mediaType,
        status: "failed",
        metadata: currentRow?.metadata || {},
        error: String(err?.message || err),
      };
      metaRaw.textContent = toMetadataText(currentDetails);
      showMetaBtn.disabled = false;
      showMetaBtn.textContent = "Show Metadata";
      setStatus(`Could not load metadata: ${String(err?.message || err)}`);
    } finally {
      if (requestToken === metadataRequestToken) {
        metadataLoadInFlight = false;
        if (metadataLoaded) {
          showMetaBtn.disabled = true;
        }
      }
    }
  }

  // ── NAV ───────────────────────────────────────────────────────────

  prevBtn.addEventListener("click", () => onNavigate("prev"));
  nextBtn.addEventListener("click", () => onNavigate("next"));

  // ── TOP-BAR ACTIONS ───────────────────────────────────────────────

  exportBtn.addEventListener("click", async () => {
    if (!currentDetails?.path) { setStatus("No file selected."); return; }
    const r = await onExport(currentDetails);
    setStatus(r?.ok ? "Download complete." : `Download failed: ${r?.message || "Unknown error"}`);
  });

  cloudIndexBtn.addEventListener("click", async () => {
    if (!currentDetails?.path) { setStatus("No file selected."); return; }
    const r = await onCloudIndex(currentDetails);
    setStatus(r?.ok ? String(r?.message || "Cloud indexing started.") : `Cloud indexing failed: ${r?.message || "Unknown error"}`);
  });

  deleteBtn.addEventListener("click", async () => {
    if (!currentDetails?.path) { setStatus("No file selected."); return; }
    const r = await onDelete(currentDetails);
    if (r?.ok) { close(); setStatus("Image deleted."); }
    else setStatus(`Delete failed: ${r?.message || "Unknown error"}`);
  });

  async function handleAddToAlbum() {
    if (albumActionInFlight) return;
    albumActionInFlight = true;
    if (!currentDetails?.path) { setStatus("No file selected."); albumActionInFlight = false; return; }
    try {
      setStatus("Opening album picker…");
      const r = await onAddToAlbum(currentDetails);
      setStatus(r?.ok ? String(r?.message || "Added to album.") : `Could not add: ${r?.message || "Unknown error"}`);
    } catch (err) {
      setStatus(`Could not add: ${String(err?.message || err)}`);
    } finally {
      albumActionInFlight = false;
    }
  }

  for (const evtName of ["click", "pointerup"]) {
    albumBtn.addEventListener(evtName, (e) => { e.preventDefault(); e.stopPropagation(); handleAddToAlbum(); });
  }
  albumBtn.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault(); e.stopPropagation(); handleAddToAlbum();
  });

  shareBtn.addEventListener("click", async () => {
    if (!currentDetails?.path) { setStatus("No file selected."); return; }
    const r = await onShareLink(currentDetails);
    setStatus(r?.ok ? "Share link copied." : `Could not share: ${r?.message || "Unknown error"}`);
  });

  copyBtn.addEventListener("click", async () => {
    if (!currentDetails) return;
    const r = await onCopyText(toMetadataText(currentDetails));
    setStatus(r?.ok ? "Copied metadata JSON." : `Could not copy: ${r?.message || "Unknown error"}`);
  });

  openBtn.addEventListener("click", async () => {
    if (!currentDetails?.path) return;
    const r = await onOpenSourceFolder(currentDetails.path);
    setStatus(r?.ok ? "Opened source folder." : `Could not open: ${r?.message || "Unknown error"}`);
  });

  showMetaBtn.addEventListener("click", () => {
    void loadMetadataForCurrentRow();
  });

  // ── OPEN / CLOSE ──────────────────────────────────────────────────

  function close() {
    clearVideoClipPlaybackHandlers();
    videoEl.pause();
    videoEl.removeAttribute("src");
    videoEl.load();
    overlay.classList.add("hidden");
    overlay.setAttribute("aria-hidden", "true");
    document.body.classList.remove("preview-open");
    clearVideoHighlight();
  }

  function open() {
    overlay.classList.remove("hidden");
    overlay.setAttribute("aria-hidden", "false");
    document.body.classList.add("preview-open");
  }

  async function openForRow(row, siblingCount) {
    const imagePath  = String(row?.path || row?.image_path || "");
    const mediaType  = normalizeMediaType(row?.media_type || row?.metadata?.media_type, imagePath);
    const segments   = splitPathSegments(imagePath);

    titleEl.textContent = row?.metadata?.title || segments.at(-1) || `${mediaType === "video" ? "Video" : "Image"} details`;
    if (folderEl) folderEl.textContent = segments.at(-2) || "Folder";
    if (siblingCount) imgCount.textContent = `${mediaType === "video" ? "Item" : "Image"} ${row._index ?? "?"} of ${siblingCount}`;

    // Reset highlight state when opening a new item
    clearVideoHighlight();
    _timelineItems = [];

    await applyPreviewImageSource(imagePath, row?.preview_src, mediaType, row);
    resetTransformState();

    currentRow = row && typeof row === "object" ? { ...row } : null;
    metadataLoaded = false;
    metadataLoadInFlight = false;
    metadataRequestToken += 1;
    showMetaBtn.disabled = false;
    showMetaBtn.textContent = "Show Metadata";

    currentDetails = {
      path: imagePath, image_path: imagePath, media_type: mediaType,
      status: row?.status || "ok", metadata: row?.metadata || {},
      local_metadata: row?.local_metadata || null, cloud_metadata: row?.cloud_metadata || null,
      clip_mode: row?.clip_mode || null,
      clip_start_seconds: row?.clip_start_seconds,
      clip_end_seconds: row?.clip_end_seconds,
    };

    renderStatusStrip(currentDetails);
    populateFileSection(currentDetails);
    populateTagsSection(currentDetails);
    setMetadataDeferredUi();
    open();
  }

  // ── GLOBAL KEYBOARD ───────────────────────────────────────────────

  window.addEventListener("keydown", (e) => {
    if (overlay.classList.contains("hidden")) return;
    if (e.key === "Escape")    close();
    if (e.key === "ArrowUp")   nudgePan(0, -20);
    if (e.key === "ArrowDown") nudgePan(0, 20);
    if (e.key === "ArrowLeft"  && e.shiftKey) { nudgePan(-20, 0); return; }
    if (e.key === "ArrowRight" && e.shiftKey) { nudgePan( 20, 0); return; }
    if (e.key === "ArrowLeft")  onNavigate("prev");
    if (e.key === "ArrowRight") onNavigate("next");
  });

  closeBtn.addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (!panel.contains(e.target)) close(); });

  return { openForRow, close };
}