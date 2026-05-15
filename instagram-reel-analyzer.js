const INSTAGRAM_REEL_ANALYZER_INDEX_ID = "694237c9fa043d83a491de49";

const dropZone = document.getElementById("dropZone");
const browseVideoBtn = document.getElementById("browseVideoBtn");
const clearVideoBtn = document.getElementById("clearVideoBtn");
const videoFileInput = document.getElementById("videoFileInput");
const selectedVideoPathInput = document.getElementById("selectedVideoPath");
const videoUrlInput = document.getElementById("videoUrlInput");
const analysisPromptInput = document.getElementById("analysisPrompt");
const analyzeBtn = document.getElementById("analyzeBtn");
const statusText = document.getElementById("statusText");

const sourceMeta = document.getElementById("sourceMeta");
const idsMeta = document.getElementById("idsMeta");
const clipCountValue = document.getElementById("clipCountValue");
const mainQuoteValue = document.getElementById("mainQuoteValue");
const clipTypesList = document.getElementById("clipTypesList");
const textsTableBody = document.getElementById("textsTableBody");
const rawAnalysisText = document.getElementById("rawAnalysisText");

const videoPreviewContainer = document.getElementById("videoPreviewContainer");
const videoPreview = document.getElementById("videoPreview");

const galleryPreviewContainer = document.getElementById("galleryPreviewContainer");
const galleryPreview = document.getElementById("galleryPreview");

const state = {
  selectedVideoPath: "",
  running: false,
};

// ─────────────────────────────────────────────────────────
// Desktop API helpers
// ─────────────────────────────────────────────────────────

function getDesktopApi() {
  if (window.desktopAPI && typeof window.desktopAPI === "object") {
    return window.desktopAPI;
  }

  try {
    if (window.parent && window.parent !== window) {
      const parentApi = window.parent.desktopAPI;
      if (parentApi && typeof parentApi === "object") {
        return parentApi;
      }
    }
  } catch {
    // Ignore cross-context access errors and report unavailable API to UI callers.
  }

  return null;
}

// ─────────────────────────────────────────────────────────
// Status / running state
// ─────────────────────────────────────────────────────────

function setStatus(text, tone = "muted") {
  if (!statusText) {
    return;
  }

  statusText.textContent = String(text || "");
  statusText.classList.remove("running", "success", "error");
  if (tone === "running") {
    statusText.classList.add("running");
  }
  if (tone === "success") {
    statusText.classList.add("success");
  }
  if (tone === "error") {
    statusText.classList.add("error");
  }
}

function setRunning(nextRunning) {
  state.running = Boolean(nextRunning);
  if (analyzeBtn) {
    analyzeBtn.disabled = state.running;
    analyzeBtn.textContent = state.running ? "Analyzing..." : "Analyze Reel";
  }
  if (browseVideoBtn) {
    browseVideoBtn.disabled = state.running;
  }
  if (clearVideoBtn) {
    clearVideoBtn.disabled = state.running;
  }
}

function setSelectedVideoPath(filePath) {
  state.selectedVideoPath = String(filePath || "").trim();
  if (selectedVideoPathInput) {
    selectedVideoPathInput.value = state.selectedVideoPath;
  }
}

// ─────────────────────────────────────────────────────────
// Results UI helpers
// ─────────────────────────────────────────────────────────

function formatNumberOrDash(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? String(parsed) : "-";
}

function renderClipTypes(values) {
  if (!clipTypesList) {
    return;
  }
  clipTypesList.innerHTML = "";
  const rows = Array.isArray(values)
    ? values.map((value) => String(value || "").trim()).filter(Boolean)
    : [];

  if (rows.length === 0) {
    const li = document.createElement("li");
    li.textContent = "No clip types returned";
    clipTypesList.appendChild(li);
    return;
  }

  for (const row of rows) {
    const li = document.createElement("li");
    li.textContent = row;
    clipTypesList.appendChild(li);
  }
}

function renderTextsTable(texts) {
  if (!textsTableBody) {
    return;
  }

  textsTableBody.innerHTML = "";
  const rows = Array.isArray(texts)
    ? texts.filter((row) => row && typeof row === "object")
    : [];

  if (rows.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 4;
    td.className = "empty";
    td.textContent = "No text/timeframe entries returned.";
    tr.appendChild(td);
    textsTableBody.appendChild(tr);
    return;
  }

  for (const row of rows) {
    const tr = document.createElement("tr");

    const textTd = document.createElement("td");
    textTd.textContent = String(row.text || "").trim() || "-";

    const timeframeTd = document.createElement("td");
    timeframeTd.textContent = String(row.timeframe || "").trim() || "-";

    const startTd = document.createElement("td");
    const startValue = Number(row.start);
    startTd.textContent = Number.isFinite(startValue) ? startValue.toFixed(2) : "-";

    const endTd = document.createElement("td");
    const endValue = Number(row.end);
    endTd.textContent = Number.isFinite(endValue) ? endValue.toFixed(2) : "-";

    tr.appendChild(textTd);
    tr.appendChild(timeframeTd);
    tr.appendChild(startTd);
    tr.appendChild(endTd);
    textsTableBody.appendChild(tr);
  }
}

function applyResultToUi(result) {
  const structured = result?.structured && typeof result.structured === "object"
    ? result.structured
    : {};

  if (sourceMeta) {
    sourceMeta.textContent = `${String(result?.source || "unknown")} source`;
  }

  if (idsMeta) {
    const assetId = String(result?.assetId || "-");
    const indexedAssetId = String(result?.indexedAssetId || "-");
    idsMeta.textContent = `asset ${assetId} | indexed ${indexedAssetId}`;
  }

  if (clipCountValue) {
    clipCountValue.textContent = formatNumberOrDash(structured.clip_count);
  }

  if (mainQuoteValue) {
    const quote = String(structured.main_quote || "").trim();
    mainQuoteValue.textContent = quote || "-";
  }

  renderClipTypes(structured.clip_types);
  renderTextsTable(structured.texts);

  const narrative = String(result?.analysisText || "").trim() || "No narrative output returned.";

  if (rawAnalysisText) {
    rawAnalysisText.textContent = narrative;
  }

  // Populate the clip sequence breakdown table from the narrative
  populateClipSequence(narrative);
}

function resetResultsUi() {
  if (sourceMeta) {
    sourceMeta.textContent = "No run yet";
  }
  if (idsMeta) {
    idsMeta.textContent = "Asset IDs pending";
  }
  if (clipCountValue) {
    clipCountValue.textContent = "-";
  }
  if (mainQuoteValue) {
    mainQuoteValue.textContent = "-";
  }
  renderClipTypes([]);
  renderTextsTable([]);
  if (rawAnalysisText) {
    rawAnalysisText.textContent = "No analysis yet.";
  }

  // Hide clip sequence panel on reset
  const panel = document.getElementById("clipSequencePanel");
  if (panel) {
    panel.style.display = "none";
  }
}

// ─────────────────────────────────────────────────────────
// Prompt default
// ─────────────────────────────────────────────────────────

function setPromptDefault() {
  if (!analysisPromptInput || analysisPromptInput.value.trim()) {
    return;
  }
  analysisPromptInput.value = [
    "Break down this Instagram reel for recreation:",
    "1) estimate number of clips,",
    "2) identify clip types in sequence,",
    "3) extract the strongest quote,",
    "4) list on-screen text with rough timeframe.",
  ].join("\n");
}

// ─────────────────────────────────────────────────────────
// Video picker
// ─────────────────────────────────────────────────────────

async function openNativeVideoPicker() {
  const desktopApi = getDesktopApi();
  if (!desktopApi?.pickInstagramReelVideo) {
    if (videoFileInput) {
      videoFileInput.click();
      setStatus("Native picker unavailable here. Use local file picker fallback.");
      return;
    }
    setStatus("Video picker API unavailable. Restart the app.", "error");
    return;
  }

  const picked = await desktopApi.pickInstagramReelVideo();
  if (!picked?.ok) {
    if (picked?.message && picked.message !== "No video selected.") {
      setStatus(String(picked.message), "error");
    }
    return;
  }

  setSelectedVideoPath(picked.filePath);
  setStatus("Video selected.");
}

// ─────────────────────────────────────────────────────────
// Drop zone
// ─────────────────────────────────────────────────────────

function attachDropZoneHandlers() {
  if (!dropZone) {
    return;
  }

  dropZone.addEventListener("click", () => {
    void openNativeVideoPicker();
  });

  dropZone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      void openNativeVideoPicker();
    }
  });

  const activateDrag = (event) => {
    event.preventDefault();
    dropZone.classList.add("drag-over");
  };

  const deactivateDrag = (event) => {
    event.preventDefault();
    dropZone.classList.remove("drag-over");
  };

  dropZone.addEventListener("dragenter", activateDrag);
  dropZone.addEventListener("dragover", activateDrag);
  dropZone.addEventListener("dragleave", deactivateDrag);

  dropZone.addEventListener("drop", (event) => {
    event.preventDefault();
    dropZone.classList.remove("drag-over");
    const file = event.dataTransfer?.files?.[0];
    if (!file) {
      return;
    }
    setSelectedVideoPath(file.path || "");
    setStatus("Video selected from drag/drop.");
  });
}

// ─────────────────────────────────────────────────────────
// Analysis runner
// ─────────────────────────────────────────────────────────

async function runAnalysis() {
  if (state.running) {
    return;
  }
  const desktopApi = getDesktopApi();
  if (!desktopApi?.analyzeInstagramReel) {
    setStatus("Analyzer API unavailable. Restart the app.", "error");
    return;
  }

  const videoPath = String(state.selectedVideoPath || "").trim();
  const videoUrl = String(videoUrlInput?.value || "").trim();
  if (!videoPath && !videoUrl) {
    setStatus("Select a local video to analyze.", "error");
    return;
  }

  const prompt = String(analysisPromptInput?.value || "").trim();

  setRunning(true);
  setStatus("Uploading and processing with TwelveLabs...", "running");

  const result = await desktopApi.analyzeInstagramReel({
    indexId: INSTAGRAM_REEL_ANALYZER_INDEX_ID,
    videoPath,
    videoUrl,
    prompt,
  });

  setRunning(false);

  if (!result?.ok) {
    setStatus(`Analysis failed: ${String(result?.message || "Unknown error")}`, "error");
    return;
  }

  applyResultToUi(result);
  setStatus("Analysis complete.", "success");
}

// ─────────────────────────────────────────────────────────
// UI event handlers
// ─────────────────────────────────────────────────────────

function attachUiHandlers() {
  if (browseVideoBtn) {
    browseVideoBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      void openNativeVideoPicker();
    });
  }

  if (clearVideoBtn) {
    clearVideoBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      setSelectedVideoPath("");
      setStatus("Selection cleared.");
    });
  }

  if (videoFileInput) {
    videoFileInput.addEventListener("change", (event) => {
      const file = event.target.files[0];
      if (file) {
        const fileURL = URL.createObjectURL(file);
        galleryPreview.innerHTML = `<video src="${fileURL}" controls style="max-width: 100%;"></video>`;
        galleryPreviewContainer.style.display = "block";
        setSelectedVideoPath(file.path || "");
        if (file.path) {
          setStatus("Video selected.");
        } else {
          setStatus("Selected file path is unavailable in this context. Try Browse again.", "error");
        }
      } else {
        galleryPreview.innerHTML = "";
        galleryPreviewContainer.style.display = "none";
      }
    });
  }

  if (analyzeBtn) {
    analyzeBtn.addEventListener("click", () => {
      void runAnalysis();
    });
  }
}

// ─────────────────────────────────────────────────────────
// Clip Sequence Breakdown
// ─────────────────────────────────────────────────────────

/**
 * Converts a "MM:SS" timecode string to total seconds.
 * @param {string} tc
 * @returns {number}
 */
function tcToSec(tc) {
  const [m, s] = tc.split(":").map(Number);
  return +(m * 60 + s).toFixed(2);
}

/**
 * Escapes a string for safe insertion into HTML attributes / text nodes.
 * @param {string} str
 * @returns {string}
 */
function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Keyword → clip-type tag mapping */
const TAG_RULES = [
  [/wide\s*shot|establishing|panoramic/i,  { kind: "wide",      label: "Wide Shot"    }],
  [/close.up|closeup|macro/i,              { kind: "close",     label: "Close-Up"     }],
  [/interior|inside|indoor/i,              { kind: "interior",  label: "Interior"     }],
  [/night|nighttime|dark/i,               { kind: "night",     label: "Night Shot"   }],
  [/sign|marquee|banner/i,                { kind: "sign",      label: "Signage"      }],
  [/selfie|portrait|person|woman|man/i,   { kind: "selfie",    label: "Person"       }],
  [/perform|club|stage|entertain/i,       { kind: "performer", label: "Performance"  }],
];

/**
 * Infers a display tag from the clip description.
 * @param {string} desc
 * @returns {{ kind: string, label: string }}
 */
function inferTag(desc) {
  for (const [re, tag] of TAG_RULES) {
    if (re.test(desc)) return tag;
  }
  return { kind: "other", label: "General" };
}

/**
 * Parses clip-sequence bullet lines from a narrative string.
 * Handles both en-dash (–), em-dash (—), and hyphen (-) separators,
 * optional colons after the bracket, and bullet styles • or -.
 *
 * Expected format examples:
 *   - [00:00–00:01]: Wide shot of the city sign.
 *   • [00:01-00:02] Close-up of neon sign.
 *
 * @param {string} text
 * @returns {Array<{ startTC, endTC, startSec, endSec, dur, desc, tag }>}
 */
function parseClipSequence(text) {
  const lineRe = /[-•]\s*\[(\d{1,2}:\d{2})[–\-—](\d{1,2}:\d{2})\]:?\s*(.+)/g;
  const clips = [];
  let match;

  while ((match = lineRe.exec(text)) !== null) {
    const [, startTC, endTC, desc] = match;
    const startSec = tcToSec(startTC);
    const endSec   = tcToSec(endTC);
    const dur      = +(endSec - startSec).toFixed(2);

    clips.push({
      startTC,
      endTC,
      startSec,
      endSec,
      dur,
      desc: desc.trim(),
      tag: inferTag(desc),
    });
  }

  return clips;
}

/**
 * Renders the timeline scrubber bar beneath the clip table.
 * @param {Array} clips
 */
function buildTimeline(clips) {
  const track  = document.getElementById("csbTlTrack");
  const labels = document.getElementById("csbTlLabels");
  if (!track || !labels) return;

  const totalDur = clips.reduce((sum, c) => sum + c.dur, 0) || 1;

  const PALETTE = [
    "#63b3ed", "#f6ad55", "#9a75e9", "#42ddc6",
    "#fc8181", "#f6e55d", "#f687b3", "#68d391",
  ];

  track.innerHTML = clips.map((c, i) => {
    const pct = (c.dur / totalDur * 100).toFixed(3);
    const col = PALETTE[i % PALETTE.length];
    return `
      <div class="csb-tl-segment"
           style="flex:${pct};background:${col}22;border:1px solid ${col}55;"
           title="${escHtml(c.startTC)}–${escHtml(c.endTC)}: ${escHtml(c.desc.substring(0, 60))}">
        <div class="csb-tl-tip">${escHtml(c.startTC)}–${escHtml(c.endTC)}</div>
      </div>`;
  }).join("");

  labels.innerHTML = `
    <span>${clips[0]?.startTC ?? "0:00"}</span>
    <span>${clips[Math.floor(clips.length / 2)]?.startTC ?? ""}</span>
    <span>${clips.at(-1)?.endTC ?? ""}</span>`;
}

/**
 * Wires up column-header click sorting for the clip table.
 * @param {Array} clips  Original parsed clips array (used for index lookup).
 */
function initSorting(clips) {
  const headers = document.querySelectorAll(".csb-table th[data-sort]");
  let currentSort = { key: null, asc: true };

  headers.forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      currentSort.asc = currentSort.key === key ? !currentSort.asc : true;
      currentSort.key = key;

      headers.forEach((h) => h.classList.remove("sorted-asc", "sorted-desc"));
      th.classList.add(currentSort.asc ? "sorted-asc" : "sorted-desc");

      const sorted = [...clips].sort((a, b) => {
        let av = a[key];
        let bv = b[key];
        if (typeof av === "string") av = av.toLowerCase();
        if (typeof bv === "string") bv = bv.toLowerCase();
        if (av < bv) return currentSort.asc ? -1 : 1;
        if (av > bv) return currentSort.asc ?  1 : -1;
        return 0;
      });

      const tbody = document.getElementById("csbTableBody");
      sorted.forEach((c, newIdx) => {
        const originalIdx = clips.indexOf(c);
        const row = tbody.querySelector(`tr[data-idx="${originalIdx}"]`);
        if (row) {
          row.cells[0].textContent = newIdx + 1;
          tbody.appendChild(row);
        }
      });
    });
  });
}

/**
 * Wires up the description search/filter input.
 */
function initSearch() {
  const input = document.getElementById("csbSearch");
  if (!input) return;

  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    document.querySelectorAll("#csbTableBody tr[data-idx]").forEach((row) => {
      const desc = row.dataset.desc ?? "";
      row.classList.toggle("csb-hidden", q.length > 0 && !desc.includes(q));
    });
  });
}

/**
 * Wires up the CSV export button.
 * @param {Array} clips
 */
function initExport(clips) {
  const btn = document.getElementById("csbExportCsv");
  if (!btn) return;

  btn.addEventListener("click", () => {
    const header = ["#", "Timecode", "Start (s)", "End (s)", "Duration (s)", "Description", "Clip Type"];
    const rows   = clips.map((c, i) => [
      i + 1,
      `${c.startTC}-${c.endTC}`,
      c.startSec,
      c.endSec,
      c.dur,
      `"${c.desc.replace(/"/g, '""')}"`,
      c.tag.label,
    ]);

    const csv = [header, ...rows].map((r) => r.join(",")).join("\n");
    const a   = Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(new Blob([csv], { type: "text/csv" })),
      download: "clip-sequence.csv",
    });
    a.click();
  });
}

/**
 * Main entry point: parses the narrative and renders the
 * Clip Sequence Breakdown panel (table + timeline + controls).
 *
 * Called automatically by applyResultToUi() after each analysis.
 *
 * @param {string} rawText  Full narrative string from the AI response.
 */
function populateClipSequence(rawText) {
  if (!rawText) return;

  const clips = parseClipSequence(rawText);
  if (clips.length === 0) return;

  // Show panel
  const panel = document.getElementById("clipSequencePanel");
  if (panel) panel.style.display = "";

  // Update count chip
  const countChip = document.getElementById("clipSequenceCount");
  if (countChip) {
    countChip.textContent = `${clips.length} clip${clips.length !== 1 ? "s" : ""}`;
  }

  // Render table rows
  const tbody = document.getElementById("csbTableBody");
  if (!tbody) return;

  tbody.innerHTML = clips.map((c, i) => `
    <tr data-idx="${i}" data-desc="${escHtml(c.desc.toLowerCase())}">
      <td class="col-num">${i + 1}</td>
      <td class="col-tc">${escHtml(c.startTC)}–${escHtml(c.endTC)}</td>
      <td class="col-start">${c.startSec}</td>
      <td class="col-end">${c.endSec}</td>
      <td class="col-dur"><span class="dur-pill">${c.dur}s</span></td>
      <td class="col-desc">${escHtml(c.desc)}</td>
      <td class="col-tag"><span class="clip-tag" data-kind="${c.tag.kind}">${c.tag.label}</span></td>
    </tr>
  `).join("");

  buildTimeline(clips);
  initSorting(clips);
  initSearch();
  initExport(clips);
}

// ─────────────────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────────────────

function initialize() {
  setPromptDefault();
  resetResultsUi();
  attachDropZoneHandlers();
  attachUiHandlers();
}

initialize();