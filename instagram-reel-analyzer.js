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

  if (rawAnalysisText) {
    rawAnalysisText.textContent = String(result?.analysisText || "").trim() || "No narrative output returned.";
  }
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
}

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

function initialize() {
  setPromptDefault();
  resetResultsUi();
  attachDropZoneHandlers();
  attachUiHandlers();
}

initialize();
