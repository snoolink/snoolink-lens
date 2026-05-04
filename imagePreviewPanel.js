// function toMetadataText(details) {
//   const normalizedCloudMetadata = details?.cloud_metadata
//     ? details.cloud_metadata
//     : details?.model_id || details?.description || details?.ocr
//       ? {
//           id: details?.id || null,
//           image_path: details?.image_path || details?.path || "",
//           model_id: details?.model_id || null,
//           analyzed_at: details?.analyzed_at || null,
//           description: details?.description || "",
//           ocr: details?.ocr || { all_text: "", entries: [] },
//           status: details?.status || "unknown",
//           error: details?.error || "",
//         }
//       : null;

//   const metadata = details?.metadata || {};
//   const payload = {
//     path: details?.path || "",
//     image_path: details?.image_path || details?.path || "",
//     id: details?.id || null,
//     status: details?.status || "unknown",
//     metadata,
//     local_metadata: details?.local_metadata || null,
//     cloud_metadata: normalizedCloudMetadata,
//     error: details?.error || "",
//   };
//   return JSON.stringify(payload, null, 2);
// }

// export function createImagePreviewPanel(options = {}) {
//   const normalizeImageSrc = options.normalizeImageSrc || ((value) => value);
//   const resolveDetails = options.resolveDetails || (async (_row) => ({ metadata: {} }));
//   const onOpenSourceFolder = options.onOpenSourceFolder || (async () => ({ ok: false, message: "Action unavailable." }));
//   const onCopyText = options.onCopyText || (async () => ({ ok: false, message: "Action unavailable." }));
//   const setStatus = options.setStatus || (() => {});

//   const overlay = document.createElement("div");
//   overlay.className = "image-preview-overlay hidden";
//   overlay.setAttribute("aria-hidden", "true");

//   overlay.innerHTML = `
//     <div class="image-preview-panel" role="dialog" aria-modal="true" aria-label="Image preview details">
//       <button class="image-preview-close" type="button" aria-label="Close preview">x</button>
//       <button class="image-preview-toggle-meta-btn" type="button" aria-pressed="false">Hide metadata</button>
//       <section class="image-preview-left">
//         <img class="image-preview-img" alt="Selected image preview" />
//       </section>
//       <section class="image-preview-right">
//         <h3 class="image-preview-title">Image details</h3>
//         <div class="image-preview-actions">
//           <button class="image-preview-copy-btn" type="button">Copy</button>
//           <button class="image-preview-open-btn" type="button">Go to Original Source Folder</button>
//         </div>
//         <pre class="image-preview-meta"></pre>
//       </section>
//     </div>
//   `;

//   document.body.appendChild(overlay);

//   const panel = overlay.querySelector(".image-preview-panel");
//   const closeBtn = overlay.querySelector(".image-preview-close");
//   const imageEl = overlay.querySelector(".image-preview-img");
//   const titleEl = overlay.querySelector(".image-preview-title");
//   const metaEl = overlay.querySelector(".image-preview-meta");
//   const toggleMetaBtn = overlay.querySelector(".image-preview-toggle-meta-btn");
//   const copyBtn = overlay.querySelector(".image-preview-copy-btn");
//   const openBtn = overlay.querySelector(".image-preview-open-btn");

//   let currentDetails = null;

//   function close() {
//     overlay.classList.add("hidden");
//     overlay.setAttribute("aria-hidden", "true");
//     document.body.classList.remove("preview-open");
//   }

//   function open() {
//     overlay.classList.remove("hidden");
//     overlay.setAttribute("aria-hidden", "false");
//     document.body.classList.add("preview-open");
//   }

//   function setMetadataCollapsed(collapsed) {
//     panel.classList.toggle("metadata-hidden", collapsed);
//     if (!toggleMetaBtn) {
//       return;
//     }
//     toggleMetaBtn.textContent = collapsed ? "Show metadata" : "Hide metadata";
//     toggleMetaBtn.setAttribute("aria-pressed", collapsed ? "true" : "false");
//   }

//   async function openForRow(row) {
//     const imagePath = String(row?.path || row?.image_path || "");
//     titleEl.textContent = row?.metadata?.title || "Image details";
//     imageEl.src = normalizeImageSrc(imagePath);
//     setMetadataCollapsed(false);
//     metaEl.textContent = "Loading metadata...";
//     currentDetails = {
//       path: imagePath,
//       image_path: imagePath,
//       status: row?.status || "ok",
//       metadata: row?.metadata || {},
//       local_metadata: row?.local_metadata || null,
//       cloud_metadata: row?.cloud_metadata || null,
//     };
//     open();

//     try {
//       const resolved = await resolveDetails(row);
//       currentDetails = {
//         path: imagePath,
//         ...resolved,
//       };
//       titleEl.textContent = currentDetails?.metadata?.title || row?.metadata?.title || "Image details";
//       metaEl.textContent = toMetadataText(currentDetails);
//     } catch (error) {
//       currentDetails = {
//         path: imagePath,
//         status: "failed",
//         metadata: row?.metadata || {},
//         error: String(error?.message || error),
//       };
//       metaEl.textContent = toMetadataText(currentDetails);
//     }
//   }

//   closeBtn.addEventListener("click", () => {
//     close();
//   });

//   overlay.addEventListener("click", (event) => {
//     if (!panel.contains(event.target)) {
//       close();
//     }
//   });

//   window.addEventListener("keydown", (event) => {
//     if (event.key === "Escape" && !overlay.classList.contains("hidden")) {
//       close();
//     }
//   });

//   if (toggleMetaBtn) {
//     toggleMetaBtn.addEventListener("click", () => {
//       const collapsed = !panel.classList.contains("metadata-hidden");
//       setMetadataCollapsed(collapsed);
//     });
//   }

//   copyBtn.addEventListener("click", async () => {
//     if (!currentDetails) {
//       return;
//     }

//     const payloadText = toMetadataText(currentDetails);
//     const result = await onCopyText(payloadText);
//     if (result?.ok) {
//       setStatus("Copied image metadata.");
//       return;
//     }

//     setStatus(`Could not copy metadata: ${String(result?.message || "Unknown error")}`);
//   });

//   openBtn.addEventListener("click", async () => {
//     if (!currentDetails?.path) {
//       return;
//     }

//     const result = await onOpenSourceFolder(currentDetails.path);
//     if (result?.ok) {
//       setStatus("Opened source folder.");
//       return;
//     }

//     setStatus(`Could not open source folder: ${String(result?.message || "Unknown error")}`);
//   });

//   return {
//     openForRow,
//     close,
//   };
// }

import { normalizeMediaType } from "./previewVideo.js";

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

  const metadata = details?.metadata || {};
  const payload = {
    path: details?.path || "",
    image_path: details?.image_path || details?.path || "",
    id: details?.id || null,
    status: details?.status || "unknown",
    metadata,
    local_metadata: details?.local_metadata || null,
    cloud_metadata: normalizedCloudMetadata,
    error: details?.error || "",
  };
  return JSON.stringify(payload, null, 2);
}

export function createImagePreviewPanel(options = {}) {
  const normalizeImageSrc = options.normalizeImageSrc || ((value) => value);
  const resolvePreviewSrc =
    options.resolvePreviewSrc ||
    (async (imagePath) => ({
      ok: true,
      previewSrc: normalizeImageSrc(imagePath),
      converted: false,
    }));
  const resolveDetails = options.resolveDetails || (async (_row) => ({ metadata: {} }));
  const onOpenSourceFolder = options.onOpenSourceFolder || (async () => ({ ok: false, message: "Action unavailable." }));
  const onCopyText = options.onCopyText || (async () => ({ ok: false, message: "Action unavailable." }));
  const onDelete = options.onDelete || (async () => ({ ok: false, message: "Action unavailable." }));
  const onExport = options.onExport || (async () => ({ ok: false, message: "Action unavailable." }));
  const onAddToAlbum = options.onAddToAlbum || (async () => ({ ok: false, message: "Action unavailable." }));
  const onShareLink = options.onShareLink || (async () => ({ ok: false, message: "Action unavailable." }));
  const onNavigate = options.onNavigate || ((_direction) => {});
  const setStatus = options.setStatus || (() => {});

  const overlay = document.createElement("div");
  overlay.className = "image-preview-overlay hidden";
  overlay.setAttribute("aria-hidden", "true");

  overlay.innerHTML = `
    <div class="image-preview-panel" role="dialog" aria-modal="true" aria-label="Image preview details">

      <!-- Top bar -->
      <div class="image-preview-topbar">
        <div class="image-preview-breadcrumb">
          <span class="breadcrumb-root">Library</span>
          <span class="breadcrumb-sep">›</span>
          <span class="breadcrumb-folder">Folder</span>
          <span class="breadcrumb-sep">›</span>
          <span class="breadcrumb-filename image-preview-title">Image details</span>
        </div>
        <div class="image-preview-topbar-actions">
          <button class="image-preview-album-btn" type="button">Add to album</button>
          <button class="image-preview-export-btn" type="button">Export</button>
          <button class="image-preview-delete-btn" type="button">Delete</button>
          <button class="image-preview-close" type="button" aria-label="Close preview">✕</button>
        </div>
      </div>

      <!-- Body: viewer + sidebar -->
      <div class="image-preview-body">

        <!-- Left: viewer -->
        <section class="image-preview-left" aria-label="Image viewer">
          <div class="image-preview-img-area">
            <button class="image-preview-nav prev" type="button" aria-label="Previous image">&#8592;</button>
            <img class="image-preview-img" alt="Selected image preview" />
            <video class="image-preview-video hidden" controls preload="metadata"></video>
            <button class="image-preview-nav next" type="button" aria-label="Next image">&#8594;</button>
            <span class="image-preview-zoom-badge">100%</span>
          </div>

          <!-- Image toolbar -->
          <div class="image-preview-img-toolbar">
            <button class="image-preview-it-btn active" data-action="fit" title="Fit to screen" type="button">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="1" width="14" height="14" rx="2"/><path d="M5 8h6M8 5v6"/></svg>
            </button>
            <button class="image-preview-it-btn" data-action="zoom-in" title="Zoom in" type="button">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="7" cy="7" r="5"/><path d="M11 11l3 3M5 7h4M7 5v4"/></svg>
            </button>
            <button class="image-preview-it-btn" data-action="zoom-out" title="Zoom out" type="button">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="7" cy="7" r="5"/><path d="M11 11l3 3M5 7h4"/></svg>
            </button>
            <div class="image-preview-it-sep"></div>
            <div class="image-preview-pan-grid" role="group" aria-label="Pan controls">
              <button class="image-preview-it-btn image-preview-pan-btn" data-pan="up" title="Pan up" type="button">&#8593;</button>
              <button class="image-preview-it-btn image-preview-pan-btn" data-pan="left" title="Pan left" type="button">&#8592;</button>
              <button class="image-preview-it-btn image-preview-pan-btn" data-pan="right" title="Pan right" type="button">&#8594;</button>
              <button class="image-preview-it-btn image-preview-pan-btn" data-pan="down" title="Pan down" type="button">&#8595;</button>
            </div>
            <div class="image-preview-it-sep"></div>
            <button class="image-preview-it-btn" data-action="rotate-left" title="Rotate left" type="button">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
               <path d="M3.5 9a4.5 4.5 0 1 0 4.5-4.5"/>
               <polyline points="1.5 2 3.5 6.5 8 5"/>
              </svg>
            </button>
            <button class="image-preview-it-btn" data-action="rotate-left" title="Rotate left" type="button">
             <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
               <path d="M3.5 9a4.5 4.5 0 1 0 4.5-4.5"/>
               <polyline points="1.5 2 3.5 6.5 8 5"/>
              </svg>
            </button>
            <button class="image-preview-it-btn" data-action="flip-h" title="Flip horizontal" type="button">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 2v12M4 5l-3 3 3 3M12 5l3 3-3 3"/></svg>
            </button>
            <div class="image-preview-it-sep"></div>
            <button class="image-preview-it-btn" data-action="fullscreen" title="Fullscreen" type="button">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M1 1h4M1 1v4M15 1h-4M15 1v4M1 15h4M1 15v-4M15 15h-4M15 15v-4"/></svg>
            </button>
            <div class="image-preview-zoom-ctrl">
              <input type="range" min="25" max="300" value="100" step="1" class="image-preview-zoom-slider" aria-label="Zoom level">
              <span class="image-preview-zoom-val">100%</span>
            </div>
          </div>
        </section>

        <!-- Right: sidebar -->
        <section class="image-preview-right" aria-label="Image metadata">
          <div class="image-preview-tab-row" role="tablist">
            <button class="image-preview-tab active" data-tab="info" role="tab" aria-selected="true" type="button">Info</button>
            <button class="image-preview-tab" data-tab="ai" role="tab" aria-selected="false" type="button">AI</button>
            <button class="image-preview-tab" data-tab="tags" role="tab" aria-selected="false" type="button">Tags</button>
            <button class="image-preview-tab" data-tab="raw" role="tab" aria-selected="false" type="button">Raw</button>
          </div>

          <!-- Info tab -->
          <div class="image-preview-tab-body active" data-panel="info">
            <div class="image-preview-section">
              <div class="image-preview-section-label">Status</div>
              <div class="image-preview-status-row">
                <span class="image-preview-status-badge status-ok">Indexed</span>
                <span class="image-preview-status-badge status-cloud image-preview-cloud-status">Cloud: unknown</span>
              </div>
            </div>
            <div class="image-preview-section">
              <div class="image-preview-section-label">File details</div>
              <dl class="image-preview-meta-grid image-preview-file-details"></dl>
            </div>
            <div class="image-preview-section">
              <div class="image-preview-section-label">Camera &amp; lens</div>
              <dl class="image-preview-meta-grid image-preview-exif-details"></dl>
            </div>
            <div class="image-preview-section">
              <div class="image-preview-section-label">Rating</div>
              <div class="image-preview-rating" role="group" aria-label="Image rating">
                ${[1,2,3,4,5].map(i => `<button class="image-preview-star" data-value="${i}" type="button" aria-label="${i} star">★</button>`).join("")}
              </div>
            </div>
          </div>

          <!-- AI tab -->
          <div class="image-preview-tab-body" data-panel="ai">
            <div class="image-preview-section">
              <div class="image-preview-section-label">AI description</div>
              <div class="image-preview-ai-card image-preview-ai-description">Loading…</div>
            </div>
            <div class="image-preview-section">
              <div class="image-preview-section-label">Detected objects</div>
              <div class="image-preview-objects-list"></div>
            </div>
            <div class="image-preview-section">
              <div class="image-preview-section-label">OCR text</div>
              <pre class="image-preview-ocr-text">No text detected</pre>
            </div>
          </div>

          <!-- Tags tab -->
          <div class="image-preview-tab-body" data-panel="tags">
            <div class="image-preview-section">
              <div class="image-preview-section-label">Tags</div>
              <div class="image-preview-tag-row"></div>
              <div class="image-preview-tag-input-row">
                <input type="text" class="image-preview-tag-input" placeholder="Add tag…" aria-label="New tag">
                <button class="image-preview-tag-add-btn" type="button">Add</button>
              </div>
            </div>
            <div class="image-preview-section">
              <div class="image-preview-section-label">Notes</div>
              <textarea class="image-preview-notes" placeholder="Add a note…" rows="4"></textarea>
            </div>
          </div>

          <!-- Raw tab -->
          <div class="image-preview-tab-body" data-panel="raw">
            <div class="image-preview-section">
              <div class="image-preview-section-label">Raw metadata payload</div>
              <pre class="image-preview-meta"></pre>
            </div>
            <div class="image-preview-raw-actions">
              <button class="image-preview-copy-btn" type="button">Copy JSON</button>
              <button class="image-preview-open-btn" type="button">Open source folder</button>
            </div>
          </div>
        </section>
      </div>

      <!-- Bottom bar: filmstrip + nav counter -->
      <div class="image-preview-bottombar">
        <span class="image-preview-img-count"></span>
        <div class="image-preview-filmstrip"></div>
        <button class="image-preview-share-btn" type="button">Share link</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Element refs
  const panel          = overlay.querySelector(".image-preview-panel");
  const closeBtn       = overlay.querySelector(".image-preview-close");
  const exportBtn      = overlay.querySelector(".image-preview-export-btn");
  const deleteBtn      = overlay.querySelector(".image-preview-delete-btn");
  const albumBtn       = overlay.querySelector(".image-preview-album-btn");
  const imageAreaEl    = overlay.querySelector(".image-preview-img-area");
  const imageEl        = overlay.querySelector(".image-preview-img");
  const videoEl        = overlay.querySelector(".image-preview-video");
  const titleEl        = overlay.querySelector(".image-preview-title");
  const metaEl         = overlay.querySelector(".image-preview-meta");
  const copyBtn        = overlay.querySelector(".image-preview-copy-btn");
  const openBtn        = overlay.querySelector(".image-preview-open-btn");
  const zoomSlider     = overlay.querySelector(".image-preview-zoom-slider");
  const zoomVal        = overlay.querySelector(".image-preview-zoom-val");
  const zoomBadge      = overlay.querySelector(".image-preview-zoom-badge");
  const prevBtn        = overlay.querySelector(".image-preview-nav.prev");
  const nextBtn        = overlay.querySelector(".image-preview-nav.next");
  const tabs           = overlay.querySelectorAll(".image-preview-tab");
  const panels         = overlay.querySelectorAll(".image-preview-tab-body");
  const stars          = overlay.querySelectorAll(".image-preview-star");
  const tagRow         = overlay.querySelector(".image-preview-tag-row");
  const tagInput       = overlay.querySelector(".image-preview-tag-input");
  const tagAddBtn      = overlay.querySelector(".image-preview-tag-add-btn");
  const aiDesc         = overlay.querySelector(".image-preview-ai-description");
  const ocrText        = overlay.querySelector(".image-preview-ocr-text");
  const objectsList    = overlay.querySelector(".image-preview-objects-list");
  const fileDetails    = overlay.querySelector(".image-preview-file-details");
  const exifDetails    = overlay.querySelector(".image-preview-exif-details");
  const cloudStatus    = overlay.querySelector(".image-preview-cloud-status");
  const imgCount       = overlay.querySelector(".image-preview-img-count");
  const shareBtn       = overlay.querySelector(".image-preview-share-btn");
  const panButtons     = overlay.querySelectorAll(".image-preview-pan-btn");

  let currentDetails = null;
  let currentRating  = 0;
  const transformState = {
    scale: 1,
    translateX: 0,
    translateY: 0,
    rotation: 0,
    flipX: 1,
  };
  const dragState = {
    active: false,
    lastX: 0,
    lastY: 0,
  };
  const panHoldState = {
    timer: null,
  };
  let albumActionInFlight = false;

  function getActiveViewer() {
    return videoEl.classList.contains("hidden") ? imageEl : videoEl;
  }

  function renderTransform() {
    const activeViewer = getActiveViewer();
    const scale = Number(transformState.scale || 1);
    const flipX = Number(transformState.flipX || 1);
    const rotation = Number(transformState.rotation || 0);
    const tx = Number(transformState.translateX || 0);
    const ty = Number(transformState.translateY || 0);

    activeViewer.style.transform = `translate(${tx}px, ${ty}px) rotate(${rotation}deg) scale(${scale * flipX}, ${scale})`;
  }

  function syncZoomUi() {
    const zoomPercent = Math.round(transformState.scale * 100);
    zoomSlider.value = String(zoomPercent);
    const text = `${zoomPercent}%`;
    zoomVal.textContent = text;
    zoomBadge.textContent = text;
  }

  function setZoomPercent(percent) {
    const clamped = Math.max(25, Math.min(300, Number(percent) || 100));
    transformState.scale = clamped / 100;
    syncZoomUi();
    renderTransform();
  }

  function resetTransformState() {
    transformState.scale = 1;
    transformState.translateX = 0;
    transformState.translateY = 0;
    transformState.rotation = 0;
    transformState.flipX = 1;
    syncZoomUi();
    renderTransform();
  }

  function nudgePan(deltaX, deltaY) {
    transformState.translateX += Number(deltaX || 0);
    transformState.translateY += Number(deltaY || 0);
    renderTransform();
  }

  function splitPathSegments(value) {
    return String(value || "")
      .replaceAll("\\", "/")
      .split("/")
      .filter(Boolean);
  }

  async function applyPreviewImageSource(imagePath, preferredPreviewSrc, mediaType) {
    const normalizedMediaType = normalizeMediaType(mediaType, imagePath);
    if (normalizedMediaType === "video") {
      imageEl.classList.add("hidden");
      imageEl.src = "";
      videoEl.classList.remove("hidden");
      videoEl.src = String(preferredPreviewSrc || "").trim() || normalizeImageSrc(imagePath);
      videoEl.currentTime = 0;
      void videoEl.play().catch(() => {});
      return;
    }

    videoEl.pause();
    videoEl.src = "";
    videoEl.classList.add("hidden");
    let baseSrc = String(preferredPreviewSrc || "").trim() || normalizeImageSrc(imagePath);
    try {
      if (!preferredPreviewSrc) {
        const preferred = await resolvePreviewSrc(imagePath);
        const preferredSrc = String(preferred?.previewSrc || "").trim();
        if (preferred?.ok && preferredSrc) {
          baseSrc = preferredSrc;
        }
      }
    } catch {
      // Keep normalized source.
    }

    imageEl.classList.remove("hidden");

    let fallbackAttempted = false;
    imageEl.onerror = async () => {
      if (fallbackAttempted) {
        imageEl.src = "";
        return;
      }

      fallbackAttempted = true;
      try {
        const fallback = await resolvePreviewSrc(imagePath);
        const nextSrc = String(fallback?.previewSrc || "").trim();
        if (fallback?.ok && nextSrc && nextSrc !== imageEl.src) {
          imageEl.src = nextSrc;
          return;
        }
      } catch {
        // Ignore and fall through.
      }

      imageEl.src = "";
    };

    imageEl.src = baseSrc;
  }

  // ── Tabs ──────────────────────────────────────────────────────────────────

  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      tabs.forEach(t => { t.classList.remove("active"); t.setAttribute("aria-selected", "false"); });
      panels.forEach(p => p.classList.remove("active"));
      tab.classList.add("active");
      tab.setAttribute("aria-selected", "true");
      overlay.querySelector(`.image-preview-tab-body[data-panel="${tab.dataset.tab}"]`).classList.add("active");
    });
  });

  // ── Zoom ──────────────────────────────────────────────────────────────────

  zoomSlider.addEventListener("input", () => {
    setZoomPercent(Number(zoomSlider.value));
  });

  imageAreaEl.addEventListener("wheel", (event) => {
    if (!event.ctrlKey) {
      return;
    }
    event.preventDefault();
    const current = Math.round(transformState.scale * 100);
    const next = event.deltaY < 0 ? current + 8 : current - 8;
    setZoomPercent(next);
  }, { passive: false });

  imageAreaEl.addEventListener("mousedown", (event) => {
    if (event.button !== 0) {
      return;
    }
    if (event.target?.closest(".image-preview-nav") || event.target?.closest(".image-preview-it-btn")) {
      return;
    }
    dragState.active = true;
    dragState.lastX = event.clientX;
    dragState.lastY = event.clientY;
    imageAreaEl.classList.add("is-panning");
  });

  window.addEventListener("mousemove", (event) => {
    if (!dragState.active) {
      return;
    }
    const dx = event.clientX - dragState.lastX;
    const dy = event.clientY - dragState.lastY;
    dragState.lastX = event.clientX;
    dragState.lastY = event.clientY;
    nudgePan(dx, dy);
  });

  window.addEventListener("mouseup", () => {
    dragState.active = false;
    imageAreaEl.classList.remove("is-panning");
  });

  function stopPanHold() {
    if (!panHoldState.timer) {
      return;
    }
    clearInterval(panHoldState.timer);
    panHoldState.timer = null;
  }

  function startPanHold(dx, dy) {
    stopPanHold();
    nudgePan(dx, dy);
    panHoldState.timer = setInterval(() => {
      nudgePan(dx, dy);
    }, 45);
  }

  panButtons.forEach((button) => {
    const direction = String(button.dataset.pan || "");
    const step = 18;
    const byDirection = {
      up: [0, -step],
      down: [0, step],
      left: [-step, 0],
      right: [step, 0],
    };
    const tuple = byDirection[direction] || [0, 0];

    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      startPanHold(tuple[0], tuple[1]);
    });
    button.addEventListener("mouseup", stopPanHold);
    button.addEventListener("mouseleave", stopPanHold);
    button.addEventListener("click", () => {
      nudgePan(tuple[0], tuple[1]);
    });
  });

  window.addEventListener("mouseup", stopPanHold);

  overlay.querySelectorAll(".image-preview-it-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const action = btn.dataset.action;
      if (action === "zoom-in")  { setZoomPercent(Math.round(transformState.scale * 100) + 25); }
      if (action === "zoom-out") { setZoomPercent(Math.round(transformState.scale * 100) - 25); }
      if (action === "fit")      { resetTransformState(); }
      const activeViewer = videoEl.classList.contains("hidden") ? imageEl : videoEl;
      if (action === "rotate-left")  { transformState.rotation -= 90; renderTransform(); }
      if (action === "rotate-right") { transformState.rotation += 90; renderTransform(); }
      if (action === "flip-h")       { transformState.flipX = transformState.flipX * -1; renderTransform(); }
      if (action === "fullscreen" && activeViewer.requestFullscreen) { activeViewer.requestFullscreen(); }
    });
  });

  // ── Stars ─────────────────────────────────────────────────────────────────

  function setRating(value) {
    currentRating = value;
    stars.forEach(s => s.classList.toggle("active", Number(s.dataset.value) <= value));
  }

  stars.forEach(s => s.addEventListener("click", () => setRating(Number(s.dataset.value))));

  // ── Tags ──────────────────────────────────────────────────────────────────

  function addTag(label) {
    if (!label) return;
    const span = document.createElement("span");
    span.className = "image-preview-tag";
    span.textContent = label;
    const rm = document.createElement("button");
    rm.className = "image-preview-tag-rm";
    rm.textContent = "×";
    rm.type = "button";
    rm.setAttribute("aria-label", `Remove tag ${label}`);
    rm.addEventListener("click", () => span.remove());
    span.appendChild(rm);
    tagRow.appendChild(span);
  }

  tagAddBtn.addEventListener("click", () => { addTag(tagInput.value.trim()); tagInput.value = ""; });
  tagInput.addEventListener("keydown", e => { if (e.key === "Enter") { addTag(tagInput.value.trim()); tagInput.value = ""; } });

  // ── Nav ───────────────────────────────────────────────────────────────────

  prevBtn.addEventListener("click", () => onNavigate("prev"));
  nextBtn.addEventListener("click", () => onNavigate("next"));

  // ── Top-bar actions ───────────────────────────────────────────────────────

  exportBtn.addEventListener("click", async () => {
    if (!currentDetails?.path) {
      setStatus("No file selected to export.");
      return;
    }
    const result = await onExport(currentDetails);
    setStatus(result?.ok ? "Export started." : `Export failed: ${result?.message || "Unknown error"}`);
  });

  deleteBtn.addEventListener("click", async () => {
    if (!currentDetails?.path) {
      setStatus("No file selected to delete.");
      return;
    }
    const result = await onDelete(currentDetails);
    if (result?.ok) { close(); setStatus("Image deleted."); }
    else setStatus(`Delete failed: ${result?.message || "Unknown error"}`);
  });

  async function handleAddToAlbumAction() {
    if (albumActionInFlight) {
      return;
    }
    albumActionInFlight = true;
    if (!currentDetails?.path) {
      setStatus("No file selected to add to album.");
      albumActionInFlight = false;
      return;
    }
    try {
      setStatus("Opening album picker...");
      const result = await onAddToAlbum(currentDetails);
      setStatus(result?.ok ? String(result?.message || "Added to album.") : `Could not add: ${result?.message || "Unknown error"}`);
    } catch (error) {
      setStatus(`Could not add: ${String(error?.message || error)}`);
    } finally {
      albumActionInFlight = false;  
    }
  }

  albumBtn.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    await handleAddToAlbumAction();
  });

  albumBtn.addEventListener("pointerup", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    await handleAddToAlbumAction();
  });

  albumBtn.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    await handleAddToAlbumAction();
  });

  panel.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const clickedAlbumButton = target.closest(".image-preview-album-btn");
    if (!clickedAlbumButton) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    await handleAddToAlbumAction();
  });

  if (shareBtn) {
    shareBtn.addEventListener("click", async () => {
      if (!currentDetails?.path) {
        setStatus("No file selected to share.");
        return;
      }
      const result = await onShareLink(currentDetails);
      setStatus(result?.ok ? "Share link copied." : `Could not share: ${result?.message || "Unknown error"}`);
    });
  }

  copyBtn.addEventListener("click", async () => {
    if (!currentDetails) return;
    const result = await onCopyText(toMetadataText(currentDetails));
    setStatus(result?.ok ? "Copied media metadata." : `Could not copy: ${result?.message || "Unknown error"}`);
  });

  openBtn.addEventListener("click", async () => {
    if (!currentDetails?.path) return;
    const result = await onOpenSourceFolder(currentDetails.path);
    setStatus(result?.ok ? "Opened source folder." : `Could not open: ${result?.message || "Unknown error"}`);
  });

  // ── Helpers ───────────────────────────────────────────────────────────────

  function renderMetaGrid(el, pairs) {
    el.innerHTML = pairs
      .filter(([, v]) => v != null && v !== "")
      .map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`)
      .join("");
  }

  function populateInfoTab(details) {
    const lm = details?.local_metadata || {};
    const cm = details?.cloud_metadata || {};

    cloudStatus.textContent = `Cloud: ${cm.status || "unknown"}`;
    cloudStatus.className    = `image-preview-status-badge ${cm.status === "ok" ? "status-ok" : "status-cloud"}`;

    renderMetaGrid(fileDetails, [
      ["Filename", details?.path?.split("/").pop() || ""],
      ["Size",     lm.size_bytes ? (lm.size_bytes / 1048576).toFixed(1) + " MB" : ""],
      ["Dimensions", lm.width && lm.height ? `${lm.width} × ${lm.height} px` : ""],
      ["Format",   lm.format || ""],
      ["Analyzed", cm.analyzed_at ? new Date(cm.analyzed_at).toLocaleDateString() : ""],
    ]);

    const meta = details?.metadata || {};
    renderMetaGrid(exifDetails, [
      ["Camera",       meta.camera || ""],
      ["Lens",         meta.lens   || ""],
      ["Focal length", meta.focal_length || ""],
      ["Aperture",     meta.aperture    || ""],
      ["Shutter",      meta.shutter     || ""],
      ["ISO",          meta.iso         || ""],
    ]);

    if (meta.rating) setRating(Number(meta.rating));
  }

  function populateAITab(details) {
    const cm = details?.cloud_metadata || {};
    aiDesc.textContent  = cm.description || "No description available.";
    ocrText.textContent = cm.ocr?.all_text?.trim() || "No text detected.";

    objectsList.innerHTML = "";
    const sceneTags = Array.isArray(cm?.sceneTags) ? cm.sceneTags : [];
    const objectTags = Array.isArray(cm?.objectTags) ? cm.objectTags : [];
    const activityTags = Array.isArray(cm?.activityTags) ? cm.activityTags : [];
    const aspectRatioSuitability = Array.isArray(cm?.aspectRatioSuitability) ? cm.aspectRatioSuitability : [];

    const addTagSection = (label, values) => {
      const rows = Array.isArray(values) ? values.filter(Boolean) : [];
      if (rows.length === 0) {
        return;
      }
      const row = document.createElement("div");
      row.className = "image-preview-conf-row";
      row.innerHTML = `
        <span class="image-preview-conf-label">${label}</span>
        <span class="image-preview-conf-pct">${rows.join(", ")}</span>`;
      objectsList.appendChild(row);
    };

    const addScalarSection = (label, value) => {
      const normalized = String(value || "").trim();
      if (!normalized) {
        return;
      }
      const row = document.createElement("div");
      row.className = "image-preview-conf-row";
      row.innerHTML = `
        <span class="image-preview-conf-label">${label}</span>
        <span class="image-preview-conf-pct">${normalized}</span>`;
      objectsList.appendChild(row);
    };

    const addScoreSection = (label, value) => {
      const score = Number(value);
      if (!Number.isFinite(score)) {
        return;
      }
      const pct = Math.max(0, Math.min(100, Math.round(score)));
      const row = document.createElement("div");
      row.className = "image-preview-conf-row";
      row.innerHTML = `
        <span class="image-preview-conf-label">${label}</span>
        <div class="image-preview-conf-bar"><div class="image-preview-conf-fill" style="width:${pct}%"></div></div>
        <span class="image-preview-conf-pct">${pct}</span>`;
      objectsList.appendChild(row);
    };

    addTagSection("Scene Tags", sceneTags);
    addTagSection("Object Tags", objectTags);
    addTagSection("Activity Tags", activityTags);
    addScoreSection("Social Media Score", cm?.socialMediaScore);
    addScoreSection("Instagram Score", cm?.instagramScore);
    addTagSection("Aspect Ratio Suitability", aspectRatioSuitability);
    addScalarSection("Aesthetic Style", cm?.aestheticStyle);
    addScalarSection("Editing Level", cm?.editingLevel);
    addScalarSection("Visual Complexity", cm?.visualComplexity);
    addScalarSection("Hero Element", cm?.heroElement);
    addScalarSection("Depth of Field", cm?.depthOfField);

    const entries = Array.isArray(cm?.ocr?.entries) ? cm.ocr.entries : [];
    if (entries.length > 0) {
      const ocrRow = document.createElement("div");
      ocrRow.className = "image-preview-conf-row";
      ocrRow.innerHTML = `
        <span class="image-preview-conf-label">OCR Entries</span>
        <span class="image-preview-conf-pct">${entries.length}</span>`;
      objectsList.appendChild(ocrRow);
    }
  }

  function populateTags(details) {
    tagRow.innerHTML = "";
    const metadataTags = Array.isArray(details?.metadata?.tags) ? details.metadata.tags : [];
    const cm = details?.cloud_metadata || {};
    const sceneTags = Array.isArray(cm?.sceneTags) ? cm.sceneTags : [];
    const objectTags = Array.isArray(cm?.objectTags) ? cm.objectTags : [];
    const activityTags = Array.isArray(cm?.activityTags) ? cm.activityTags : [];
    const tags = Array.from(new Set([...metadataTags, ...sceneTags, ...objectTags, ...activityTags]));
    tags.forEach(t => addTag(t));
  }

  // ── Open / close ──────────────────────────────────────────────────────────

  function close() {
    overlay.classList.add("hidden");
    overlay.setAttribute("aria-hidden", "true");
    document.body.classList.remove("preview-open");
  }

  function open() {
    overlay.classList.remove("hidden");
    overlay.setAttribute("aria-hidden", "false");
    document.body.classList.add("preview-open");
  }

  async function openForRow(row, siblingCount) {
    const imagePath = String(row?.path || row?.image_path || "");
    const mediaType = normalizeMediaType(row?.media_type || row?.metadata?.media_type, imagePath);
    const pathSegments = splitPathSegments(imagePath);
    titleEl.textContent =
      row?.metadata?.title ||
      pathSegments[pathSegments.length - 1] ||
      `${mediaType === "video" ? "Video" : "Image"} details`;

    const folderEl = overlay.querySelector(".breadcrumb-folder");
    if (folderEl) folderEl.textContent = pathSegments[pathSegments.length - 2] || "Folder";

    if (siblingCount) {
      imgCount.textContent = `${mediaType === "video" ? "Item" : "Image"} ${row._index || "?"} of ${siblingCount}`;
    }

    await applyPreviewImageSource(imagePath, row?.preview_src, mediaType);
    resetTransformState();

    metaEl.textContent = "Loading…";
    aiDesc.textContent  = "Loading…";

    currentDetails = {
      path: imagePath,
      image_path: imagePath,
      media_type: mediaType,
      status: row?.status || "ok",
      metadata: row?.metadata || {},
      local_metadata: row?.local_metadata || null,
      cloud_metadata: row?.cloud_metadata || null,
    };

    populateInfoTab(currentDetails);
    populateTags(currentDetails);
    open();

    try {
      const resolved = await resolveDetails(row);
      currentDetails = { path: imagePath, ...resolved };
      titleEl.textContent = currentDetails?.metadata?.title || titleEl.textContent;
      metaEl.textContent  = toMetadataText(currentDetails);
      populateInfoTab(currentDetails);
      populateAITab(currentDetails);
      populateTags(currentDetails);
    } catch (error) {
      currentDetails = {
        path: imagePath,
        status: "failed",
        metadata: row?.metadata || {},
        error: String(error?.message || error),
      };
      metaEl.textContent = toMetadataText(currentDetails);
    }
  }

  // ── Global listeners ──────────────────────────────────────────────────────

  closeBtn.addEventListener("click", close);

  overlay.addEventListener("click", (event) => {
    if (!panel.contains(event.target)) close();
  });

  window.addEventListener("keydown", (event) => {
    if (overlay.classList.contains("hidden")) return;
    if (event.key === "Escape")     close();
    if (event.key === "ArrowUp")    nudgePan(0, -20);
    if (event.key === "ArrowDown")  nudgePan(0, 20);
    if (event.key === "ArrowLeft" && event.shiftKey) {
      nudgePan(-20, 0);
      return;
    }
    if (event.key === "ArrowRight" && event.shiftKey) {
      nudgePan(20, 0);
      return;
    }
    if (event.key === "ArrowLeft")  onNavigate("prev");
    if (event.key === "ArrowRight") onNavigate("next");
  });

  return { openForRow, close };
}