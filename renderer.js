import { createImagePreviewPanel } from "./imagePreviewPanel.js";
import { normalizeMediaType } from "./previewVideo.js";

const pickFileBtn = document.getElementById("pickFileBtn");
const validateBtn = document.getElementById("validateBtn");
const searchBtn = document.getElementById("searchBtn");

const filePathInput = document.getElementById("filePath");
const queryInput = document.getElementById("query");
const toggleFiltersBtn = document.getElementById("toggleFiltersBtn");
const filtersShell = document.getElementById("filters-shell");
const clearAllFiltersBtn = document.getElementById("clearAllFiltersBtn");
const topKInput = document.getElementById("topK");
const containsPeopleSelect = document.getElementById("containsPeople");
const containsTextSelect = document.getElementById("containsText");
const ocrTextQueryInput = document.getElementById("ocrTextQuery");
const mediaTypeSelect = document.getElementById("mediaType");
const dynamicFiltersEl = document.getElementById("dynamicFilters");
const userFilterPickerEl = document.getElementById("userFilterPicker");
const saveUserSettingsBtn = document.getElementById("saveUserSettingsBtn");
const backupAppDataBtn = document.getElementById("backupAppDataBtn");
const reloadUserSettingsBtn = document.getElementById("reloadUserSettingsBtn");
const settingsUserNameInput = document.getElementById("settingsUserName");
const settingsUserPasswordInput = document.getElementById("settingsUserPassword");
const settingsAwsRegionInput = document.getElementById("settingsAwsRegion");
const settingsAwsKeyInput = document.getElementById("settingsAwsKey");
const settingsAwsSecretInput = document.getElementById("settingsAwsSecret");
const settingsBedrockModelInput = document.getElementById("settingsBedrockModel");
const settingsTwelveLabsApiKeyInput = document.getElementById("settingsTwelveLabsApiKey");
const settingsMinMatchScoreInput = document.getElementById("settingsMinMatchScore");
const settingsUiThemeSelect = document.getElementById("settingsUiTheme");
const settingsResultsDensitySelect = document.getElementById("settingsResultsDensity");
const settingsAutoExpandFiltersInput = document.getElementById("settingsAutoExpandFilters");
const settingsAutoCloseSidebarOnSettingsNavInput = document.getElementById("settingsAutoCloseSidebarOnSettingsNav");
const settingsGalleryVideoAutoplayInput = document.getElementById("settingsGalleryVideoAutoplay");
const settingsCacheTranscodedMovPreviewInput = document.getElementById("settingsCacheTranscodedMovPreview");
const settingsCacheTranscodedHeicPreviewInput = document.getElementById("settingsCacheTranscodedHeicPreview");
const settingsCacheTranscodedHeifPreviewInput = document.getElementById("settingsCacheTranscodedHeifPreview");
const settingsVideoSearchResultModeSelect = document.getElementById("settingsVideoSearchResultMode");
const settingsEnableFaceIndexingInput = document.getElementById("settingsEnableFaceIndexing");
const settingsFaceModelVersionInput = document.getElementById("settingsFaceModelVersion");
const settingsFaceMinConfidenceInput = document.getElementById("settingsFaceMinConfidence");
const settingsFaceMinQualityInput = document.getElementById("settingsFaceMinQuality");
const settingsFaceClusterDistanceThresholdInput = document.getElementById("settingsFaceClusterDistanceThreshold");
const settingsFaceClusterSelect = document.getElementById("settingsFaceClusterSelect");
const settingsFaceClusterLabelInput = document.getElementById("settingsFaceClusterLabel");
const settingsSaveFaceClusterLabelBtn = document.getElementById("settingsSaveFaceClusterLabelBtn");
const settingsRebuildFaceClustersBtn = document.getElementById("settingsRebuildFaceClustersBtn");
const settingsFaceClusterStatus = document.getElementById("settingsFaceClusterStatus");
const albumFilterSelect = document.getElementById("albumFilter");
const albumsListEl = document.getElementById("albumsList");
const newAlbumBtn = document.getElementById("newAlbumBtn");
const scanAlbumsSelect = document.getElementById("scanAlbumsSelect");
const scanCreateAlbumInput = document.getElementById("scanCreateAlbumInput");
const addSelectedToAlbumBtn = document.getElementById("addSelectedToAlbumBtn");
const removeSelectedFromAlbumBtn = document.getElementById("removeSelectedFromAlbumBtn");
const albumViewMeta = document.getElementById("albumViewMeta");
const activeAlbumName = document.getElementById("activeAlbumName");
const activeAlbumCount = document.getElementById("activeAlbumCount");
const renameAlbumBtn = document.getElementById("renameAlbumBtn");
const deleteAlbumBtn = document.getElementById("deleteAlbumBtn");

const statusEl = document.getElementById("status");
const countsEl = document.getElementById("counts");
const downloadTopResultsBtn = document.getElementById("downloadTopResultsBtn");
const toastRoot = document.getElementById("toastRoot");
const resultsEl = document.getElementById("results");
const cardTemplate = document.getElementById("resultCardTemplate");
const searchAligner = document.getElementById("search-bar-aligner");
const settingsSidebar = document.getElementById("settings-sidebar");
const sidebarHomeBtn = document.getElementById("sidebarHomeBtn");
const openSidebarBtn = document.getElementById("openSidebarBtn");
const closeSidebarBtn = document.getElementById("closeSidebarBtn");
const sidebarMidToggleBtn = document.getElementById("sidebarMidToggleBtn");
const openAppSettingsLink = document.getElementById("openAppSettingsLink");
const openWizardWorkspaceBtn = document.getElementById("openWizardWorkspaceBtn");
const openFacesWorkspaceBtn = document.getElementById("openFacesWorkspaceBtn");
const openReelAnalyzerBtn = document.getElementById("openReelAnalyzerBtn");
const backToHomeBtn = document.getElementById("backToHomeBtn");
const homeScreen = document.getElementById("home-screen");
const settingsScreen = document.getElementById("settings-screen");
const facesScreen = document.getElementById("faces-screen");
const wizardScreen = document.getElementById("wizard-screen");
const wizardSearchFrame = document.getElementById("wizardSearchFrame");
const reelAnalyzerScreen = document.getElementById("reel-analyzer-screen");
const reelAnalyzerFrame = document.getElementById("reelAnalyzerFrame");
const facesRefreshBtn = document.getElementById("facesRefreshBtn");
const facesRebuildBtn = document.getElementById("facesRebuildBtn");
const facesStatusEl = document.getElementById("facesStatus");
const facesClustersGridEl = document.getElementById("facesClustersGrid");

const scanModeSelect = document.getElementById("scanMode");
const pickFoldersBtn = document.getElementById("pickFoldersBtn");
const customFoldersGroup = document.getElementById("customFoldersGroup");
const customFoldersSummary = document.getElementById("customFoldersSummary");
const includeMountedDrivesInput = document.getElementById("includeMountedDrives");
const includeMoreFormatsInput = document.getElementById("includeMoreFormats");
const autoIndexAfterScanInput = document.getElementById("autoIndexAfterScan");

const startFullScanBtn = document.getElementById("startFullScanBtn");
const pauseScanBtn = document.getElementById("pauseScanBtn");
const resumeScanBtn = document.getElementById("resumeScanBtn");
const cancelScanBtn = document.getElementById("cancelScanBtn");

const scanProgressBar = document.getElementById("scanProgressBar");
const scanPercent = document.getElementById("scanPercent");
const scanCounts = document.getElementById("scanCounts");
const scanCurrentFile = document.getElementById("scanCurrentFile");
const scanLogs = document.getElementById("scanLogs");

const startLocalIndexingBtn = document.getElementById("startLocalIndexingBtn");
const startCloudIndexingBtn = document.getElementById("startCloudIndexingBtn");
const pauseIndexingBtn = document.getElementById("pauseIndexingBtn");
const resumeIndexingBtn = document.getElementById("resumeIndexingBtn");
const cancelIndexingBtn = document.getElementById("cancelIndexingBtn");
const retryFailedBtn = document.getElementById("retryFailedBtn");

const indexProgressBar = document.getElementById("indexProgressBar");
const indexPercent = document.getElementById("indexPercent");
const indexCounts = document.getElementById("indexCounts");
const indexCurrentFile = document.getElementById("indexCurrentFile");
const indexSuccessFail = document.getElementById("indexSuccessFail");
const indexLogs = document.getElementById("indexLogs");

const validationState = {
  filePath: "",
  result: null,
  pending: null,
};

const scanUiState = {
  customFolders: [],
  files: [],
  hasSearchRun: false,
};

let latestSearchRunId = 0;

const WELCOME_GALLERY_PAGE_SIZE = 120;
const MAX_BULK_DOWNLOAD_RESULTS = 30;
const TOAST_DEFAULT_DURATION_MS = 3400;

const welcomeGalleryState = {
  offset: 0,
  total: 0,
  hasMore: true,
  loading: false,
  active: false,
  randomSeed: 0,
};

const welcomeGalleryCache = {
  rows: [],
  total: 0,
  hasMore: true,
  generatedAt: "",
  ready: false,
  randomSeed: 0,
};

const FILTER_DEFINITIONS = [
  { key: "containsPeople", label: "People", kind: "boolean" },
  { key: "containsText", label: "Text", kind: "boolean" },
  { key: "ocrTextQuery", label: "OCR Text Contains", kind: "text" },
  { key: "mediaType", label: "Media Type", kind: "enum" },
  { key: "resolutionMegapixels", label: "Resolution / Megapixels", kind: "enum" },
  { key: "aspectRatio", label: "Aspect Ratio", kind: "enum" },
  { key: "fileType", label: "File Type", kind: "enum" },
  { key: "durationBucket", label: "Duration", kind: "enum" },
  { key: "fpsLabel", label: "FPS", kind: "enum" },
  { key: "hasAudio", label: "Has Audio", kind: "enum" },
  { key: "audioType", label: "Audio Type", kind: "enum" },
  { key: "hasCaptions", label: "Has Captions", kind: "enum" },
  { key: "motionLevel", label: "Motion Level", kind: "enum" },
  { key: "style", label: "Style", kind: "enum" },
  { key: "orientation", label: "Orientation", kind: "enum" },
  { key: "brightnessCategory", label: "Brightness", kind: "enum" },
  { key: "sceneTag", label: "Scene Tag", kind: "enum" },
  { key: "objectTag", label: "Object Tag", kind: "enum" },
  { key: "activityTag", label: "Activity Tag", kind: "enum" },
  { key: "socialMediaBand", label: "Social Score", kind: "enum" },
  { key: "instagramBand", label: "Instagram Score", kind: "enum" },
  { key: "aspectRatioSuitability", label: "Aspect Ratio Suitability", kind: "enum" },
  { key: "aestheticStyle", label: "Aesthetic Style", kind: "enum" },
  { key: "editingLevel", label: "Editing Level", kind: "enum" },
  { key: "visualComplexity", label: "Visual Complexity", kind: "enum" },
  { key: "heroElement", label: "Hero Element", kind: "enum" },
  { key: "depthOfField", label: "Depth Of Field", kind: "enum" },
  { key: "personLabel", label: "Person Label", kind: "enum" },
  { key: "faceClusterId", label: "Person Group", kind: "enum" },
];

const DEFAULT_ENABLED_FILTERS = [
  "style",
  "orientation",
  "mediaType",
  "resolutionMegapixels",
  "durationBucket",
  "fpsLabel",
  "aspectRatio",
  "fileType",
];

const MULTI_VALUE_FILTER_KEYS = new Set(["sceneTag", "objectTag", "activityTag"]);

const userSettingsState = {
  enabledFilters: [...DEFAULT_ENABLED_FILTERS],
  minMatchScore: 0.03,
  uiTheme: "aurora",
  resultsDensity: "comfortable",
  autoExpandFilters: false,
  autoCloseSidebarOnSettingsNav: true,
  galleryVideoAutoplay: false,
  cacheTranscodedMovPreview: false,
  cacheTranscodedHeicPreview: false,
  cacheTranscodedHeifPreview: false,
  videoSearchResultMode: "full_video",
  enableFaceIndexing: true,
  faceModelVersion: "face-api-ssd-v1",
  faceMinDetectionConfidence: 0.3,
  faceMinQualityScore: 0.3,
  faceClusterDistanceThreshold: 0.16,
};

const faceClusterUiState = {
  clusters: [],
};

const facesWorkspaceState = {
  showAllByClusterId: new Set(),
};

const albumsState = {
  albums: [],
  activeAlbumId: null,
};

const selectedImagePaths = new Set();
const CONVERTIBLE_PREVIEW_EXTENSIONS = new Set([".heic", ".heif", ".avif", ".tif", ".tiff"]);
const CARD_MEDIA_ROOT_MARGIN = "1400px 0px 1400px 0px";
const CARD_MEDIA_SWEEP_DEBOUNCE_MS = 120;
let previewRows = [];
let activePreviewPath = "";
let pendingSingleCloudIndexPath = "";
let bulkDownloadInProgress = false;
const cardMediaState = new WeakMap();
let cardMediaObserver = null;
let cardMediaSweepTimer = null;

function isValidAlbumId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0;
}

let localFilterOptions = {
  resolutionMegapixels: [],
  aspectRatio: [],
  fileType: [],
  durationBucket: [],
  fpsLabel: [],
  hasAudio: [],
  audioType: [],
  hasCaptions: [],
  motionLevel: [],
  style: [],
  orientation: [],
  brightnessCategory: [],
  sceneTag: [],
  objectTag: [],
  activityTag: [],
  socialMediaBand: [],
  instagramBand: [],
  aspectRatioSuitability: [],
  aestheticStyle: [],
  editingLevel: [],
  visualComplexity: [],
  heroElement: [],
  depthOfField: [],
  personLabel: [],
  faceClusterId: [],
};

filePathInput.value = "";

function openSidebar() {
  settingsSidebar.classList.remove("collapsed");
}

function closeSidebar() {
  settingsSidebar.classList.add("collapsed");
}

function toggleSidebar() {
  settingsSidebar.classList.toggle("collapsed");
}

function showSettingsScreen() {
  if (homeScreen) {
    homeScreen.classList.add("hidden");
  }
  if (facesScreen) {
    facesScreen.classList.add("hidden");
  }
  if (wizardScreen) {
    wizardScreen.classList.add("hidden");
  }
  if (reelAnalyzerScreen) {
    reelAnalyzerScreen.classList.add("hidden");
  }
  if (settingsScreen) {
    settingsScreen.classList.remove("hidden");
  }
  if (backToHomeBtn) {
    backToHomeBtn.classList.remove("hidden");
  }
}

function showFacesScreen() {
  if (homeScreen) {
    homeScreen.classList.add("hidden");
  }
  if (settingsScreen) {
    settingsScreen.classList.add("hidden");
  }
  if (wizardScreen) {
    wizardScreen.classList.add("hidden");
  }
  if (reelAnalyzerScreen) {
    reelAnalyzerScreen.classList.add("hidden");
  }
  if (facesScreen) {
    facesScreen.classList.remove("hidden");
  }
  if (backToHomeBtn) {
    backToHomeBtn.classList.remove("hidden");
  }
}

function showHomeScreen() {
  if (settingsScreen) {
    settingsScreen.classList.add("hidden");
  }
  if (facesScreen) {
    facesScreen.classList.add("hidden");
  }
  if (wizardScreen) {
    wizardScreen.classList.add("hidden");
  }
  if (reelAnalyzerScreen) {
    reelAnalyzerScreen.classList.add("hidden");
  }
  if (homeScreen) {
    homeScreen.classList.remove("hidden");
  }
  if (backToHomeBtn) {
    backToHomeBtn.classList.add("hidden");
  }
}

function showWizardScreen() {
  if (homeScreen) {
    homeScreen.classList.add("hidden");
  }
  if (settingsScreen) {
    settingsScreen.classList.add("hidden");
  }
  if (facesScreen) {
    facesScreen.classList.add("hidden");
  }
  if (reelAnalyzerScreen) {
    reelAnalyzerScreen.classList.add("hidden");
  }
  if (wizardScreen) {
    wizardScreen.classList.remove("hidden");
  }
  if (backToHomeBtn) {
    backToHomeBtn.classList.remove("hidden");
  }
  if (wizardSearchFrame && !wizardSearchFrame.getAttribute("src")) {
    wizardSearchFrame.setAttribute("src", "./wizard-search.html");
  }
}

function showReelAnalyzerScreen() {
  if (homeScreen) {
    homeScreen.classList.add("hidden");
  }
  if (settingsScreen) {
    settingsScreen.classList.add("hidden");
  }
  if (facesScreen) {
    facesScreen.classList.add("hidden");
  }
  if (wizardScreen) {
    wizardScreen.classList.add("hidden");
  }
  if (reelAnalyzerScreen) {
    reelAnalyzerScreen.classList.remove("hidden");
  }
  if (backToHomeBtn) {
    backToHomeBtn.classList.remove("hidden");
  }
  if (reelAnalyzerFrame && !reelAnalyzerFrame.getAttribute("src")) {
    reelAnalyzerFrame.setAttribute("src", "./instagram-reel-analyzer.html");
  }
}

function resetSearchControlsToDefaults() {
  if (queryInput) {
    queryInput.value = "";
  }
  if (topKInput) {
    topKInput.value = "20";
  }
  if (containsPeopleSelect) {
    containsPeopleSelect.value = "any";
  }
  if (containsTextSelect) {
    containsTextSelect.value = "any";
  }
  if (ocrTextQueryInput) {
    ocrTextQueryInput.value = "";
  }
  if (mediaTypeSelect) {
    mediaTypeSelect.value = "any";
  }
  if (albumFilterSelect) {
    albumFilterSelect.value = "any";
  }

  if (dynamicFiltersEl) {
    const inputs = dynamicFiltersEl.querySelectorAll("select[data-filter-key]");
    for (const input of inputs) {
      input.value = "any";
    }
    const checkboxes = dynamicFiltersEl.querySelectorAll("input[type=\"checkbox\"][data-filter-key][data-filter-value]");
    for (const checkbox of checkboxes) {
      checkbox.checked = false;
    }
  }

  setFiltersExpanded(Boolean(userSettingsState.autoExpandFilters));
}

function normalizeUiTheme(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return ["aurora", "ocean", "ember"].includes(normalized) ? normalized : "aurora";
}

function normalizeResultsDensity(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return ["compact", "comfortable", "cinematic"].includes(normalized)
    ? normalized
    : "comfortable";
}

function applyUiPreferences() {
  const theme = normalizeUiTheme(userSettingsState.uiTheme);
  const density = normalizeResultsDensity(userSettingsState.resultsDensity);

  userSettingsState.uiTheme = theme;
  userSettingsState.resultsDensity = density;

  document.body.classList.remove("ui-theme-aurora", "ui-theme-ocean", "ui-theme-ember");
  document.body.classList.add(`ui-theme-${theme}`);

  document.body.classList.remove(
    "results-density-compact",
    "results-density-comfortable",
    "results-density-cinematic",
  );
  document.body.classList.add(`results-density-${density}`);
}

function jumpToSidebarSection(sectionId) {
  const targetId = String(sectionId || "").trim();
  if (!targetId) {
    return;
  }

  const sectionEl = document.getElementById(targetId);
  if (!sectionEl) {
    return;
  }

  const headerEl = sectionEl.querySelector(":scope > .settings-section-header");
  if (headerEl) {
    headerEl.click();
  }

  sectionEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function restoreLaunchHomeState() {
  showHomeScreen();
  albumsState.activeAlbumId = null;
  selectedImagePaths.clear();
  updateAlbumActionButtons();
  updateAlbumViewMeta(null);
  resetSearchControlsToDefaults();
  scanUiState.hasSearchRun = false;
  await loadWelcomeGalleryFromMasterDirectory({ preferCached: true });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function getAlbumById(albumId) {
  return albumsState.albums.find((album) => Number(album?.id) === Number(albumId)) || null;
}

function updateAlbumViewMeta(album) {
  if (!albumViewMeta || !activeAlbumName || !activeAlbumCount) {
    return;
  }

  if (!album) {
    albumViewMeta.classList.add("hidden");
    activeAlbumName.textContent = "Album";
    activeAlbumCount.textContent = "0 images";
    return;
  }

  albumViewMeta.classList.remove("hidden");
  activeAlbumName.textContent = String(album.name || "Album");
  activeAlbumCount.textContent = `${Number(album.image_count || 0)} image(s)`;
}

function refreshAlbumFilterSelect() {
  if (!albumFilterSelect) {
    return;
  }

  const selectedValue = String(albumFilterSelect.value || "any");
  albumFilterSelect.innerHTML = "";

  const anyOption = document.createElement("option");
  anyOption.value = "any";
  anyOption.textContent = "Any";
  albumFilterSelect.appendChild(anyOption);

  for (const album of albumsState.albums) {
    const option = document.createElement("option");
    option.value = String(album.id);
    option.textContent = `${album.name} (${Number(album.image_count || 0)})`;
    albumFilterSelect.appendChild(option);
  }

  if (selectedValue === "any") {
    albumFilterSelect.value = "any";
    return;
  }

  const exists = albumsState.albums.some((album) => String(album.id) === selectedValue);
  albumFilterSelect.value = exists ? selectedValue : "any";
}

function updateAlbumActionButtons() {
  const hasSelections = selectedImagePaths.size > 0;
  if (addSelectedToAlbumBtn) {
    addSelectedToAlbumBtn.classList.toggle("hidden", !hasSelections);
  }
  if (removeSelectedFromAlbumBtn) {
    const showRemove = hasSelections && isValidAlbumId(albumsState.activeAlbumId);
    removeSelectedFromAlbumBtn.classList.toggle("hidden", !showRemove);
  }
}

async function loadAlbums() {
  if (!window.desktopAPI?.getAlbums) {
    setStatus("Albums API unavailable. Restart the app to reload preload bridge.");
    return;
  }

  const result = await window.desktopAPI.getAlbums();
  if (!result?.ok) {
    setStatus(`Could not load albums: ${String(result?.message || "Unknown error")}`);
    return;
  }

  albumsState.albums = Array.isArray(result.albums) ? result.albums : [];
  renderAlbumsSidebar();
  refreshAlbumFilterSelect();
  refreshScanAlbumOptions();

  if (isValidAlbumId(albumsState.activeAlbumId)) {
    const active = getAlbumById(albumsState.activeAlbumId);
    if (!active) {
      albumsState.activeAlbumId = null;
      updateAlbumViewMeta(null);
    } else {
      updateAlbumViewMeta(active);
    }
  }
}

function refreshScanAlbumOptions() {
  if (!scanAlbumsSelect) {
    return;
  }

  const selectedBefore = new Set(Array.from(scanAlbumsSelect.selectedOptions).map((opt) => String(opt.value)));
  scanAlbumsSelect.innerHTML = "";

  for (const album of albumsState.albums) {
    const option = document.createElement("option");
    option.value = String(album.id);
    option.textContent = album.name;
    option.selected = selectedBefore.has(option.value);
    scanAlbumsSelect.appendChild(option);
  }
}

function renderAlbumsSidebar() {
  if (!albumsListEl) {
    return;
  }

  albumsListEl.innerHTML = "";
  if (albumsState.albums.length === 0) {
    const empty = document.createElement("p");
    empty.className = "control-help";
    empty.textContent = "No albums yet.";
    albumsListEl.appendChild(empty);
    return;
  }

  for (const album of albumsState.albums) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "album-item";
    row.draggable = true;
    row.dataset.albumId = String(album.id);
    row.textContent = `${album.name} (${Number(album.image_count || 0)})`;
    if (Number(albumsState.activeAlbumId) === Number(album.id)) {
      row.classList.add("active");
    }

    row.addEventListener("click", async () => {
      await loadAlbumView(album.id);
    });

    row.addEventListener("dragover", (event) => {
      event.preventDefault();
      row.classList.add("drag-target");
    });
    row.addEventListener("dragleave", () => {
      row.classList.remove("drag-target");
    });
    row.addEventListener("drop", async (event) => {
      event.preventDefault();
      row.classList.remove("drag-target");
      const droppedPath = String(event.dataTransfer?.getData("text/plain") || "").trim();
      if (!droppedPath) {
        return;
      }
      const assignResult = await window.desktopAPI.assignImagesToAlbums({
        imagePaths: [droppedPath],
        albumIds: [album.id],
      });
      if (!assignResult?.ok) {
        setStatus(`Could not add image to album: ${String(assignResult?.message || "Unknown error")}`);
        return;
      }
      setStatus("Image added to album.");
      await loadAlbums();
      if (Number(albumsState.activeAlbumId) === Number(album.id)) {
        await loadAlbumView(album.id);
      }
    });

    albumsListEl.appendChild(row);
  }
}

async function loadAlbumView(albumId) {
  if (!window.desktopAPI?.getAlbumImages) {
    return;
  }

  const numericAlbumId = Number(albumId);
  if (!Number.isFinite(numericAlbumId)) {
    return;
  }

  const result = await window.desktopAPI.getAlbumImages({
    albumId: numericAlbumId,
    offset: 0,
    limit: WELCOME_GALLERY_PAGE_SIZE,
    filters: buildFiltersPayload(),
  });

  if (!result?.ok) {
    setStatus(`Could not load album: ${String(result?.message || "Unknown error")}`);
    return;
  }

  albumsState.activeAlbumId = numericAlbumId;
  scanUiState.hasSearchRun = false;
  welcomeGalleryState.active = false;
  showHomeScreen();
  selectedImagePaths.clear();
  updateAlbumActionButtons();

  const album = result.album || getAlbumById(numericAlbumId);
  updateAlbumViewMeta(album);
  renderAlbumsSidebar();

  const rows = (Array.isArray(result.items) ? result.items : []).map((item) => ({
    score: 0,
    path: item.path,
    media_type: item.media_type || "image",
    preview_src: item.preview_src || "",
    indexing_stage: item.indexing_stage || "none",
    metadata: item.metadata || {
      title: item.name || "Untitled media",
      description: item.directory || "",
      tags: [],
      objects: [],
      media_type: item.media_type || "image",
    },
  }));

  renderResults(rows, { isWelcome: true, append: false });
  setStatus(`Album loaded: ${String(album?.name || "Album")}`);
  countsEl.textContent = `album=${String(album?.name || "")}`;
}

function extractAlbumIdsFromQuery(rawQuery) {
  const matches = [];
  const cleaned = String(rawQuery || "").replace(/album:(("[^"]+")|([^\s]+))/gi, (_full, value) => {
    const normalized = String(value || "").replace(/^"|"$/g, "").trim();
    if (normalized) {
      matches.push(normalized);
    }
    return "";
  });

  const ids = [];
  for (const token of matches) {
    const found = albumsState.albums.find((album) => String(album.name || "").toLowerCase() === token.toLowerCase());
    if (found) {
      ids.push(Number(found.id));
    }
  }

  return {
    cleanedQuery: cleaned.replace(/\s{2,}/g, " ").trim(),
    albumIds: Array.from(new Set(ids.filter((id) => Number.isFinite(id)))),
  };
}

function pushLog(container, message) {
  if (!container) {
    return;
  }
  const item = document.createElement("div");
  item.className = "log-item";
  item.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  container.prepend(item);

  while (container.children.length > 60) {
    container.removeChild(container.lastChild);
  }
}

function updateCustomFoldersSummary() {
  if (!customFoldersSummary) {
    return;
  }

  if (scanUiState.customFolders.length === 0) {
    customFoldersSummary.textContent = "No custom folders selected.";
    updateScanSectionOptionBadges();
    return;
  }

  customFoldersSummary.textContent = `${scanUiState.customFolders.length} folder(s) selected.`;
  updateScanSectionOptionBadges();
}

function updateScanModeVisibility() {
  const isCustom = scanModeSelect.value === "custom";
  customFoldersGroup.style.display = isCustom ? "flex" : "none";
  updateScanSectionOptionBadges();
}

function updateScanSectionOptionBadges() {
  const isCustom = scanModeSelect?.value === "custom";
  const drivesOn = Boolean(includeMountedDrivesInput?.checked);
  const legacyOn = Boolean(includeMoreFormatsInput?.checked);
  const autoOn = Boolean(autoIndexAfterScanInput?.checked);
  const folderCount = Number(scanUiState?.customFolders?.length || 0);

  const chips = [
    { label: isCustom ? `Mode:Custom${folderCount > 0 ? `(${folderCount})` : ""}` : "Mode:Full", on: true },
    { label: `Drives:${drivesOn ? "On" : "Off"}`, on: drivesOn },
    { label: `Legacy:${legacyOn ? "On" : "Off"}`, on: legacyOn },
    { label: `Auto:${autoOn ? "On" : "Off"}`, on: autoOn },
  ];

  const scanDockBtn = document.querySelector("#sidebar-icon-dock .sidebar-icon-dock-btn.section-scan");
  if (scanDockBtn) {
    const tooltip = chips.map((chip) => chip.label).join(" | ");
    scanDockBtn.setAttribute("title", `Scan (${tooltip})`);
    scanDockBtn.setAttribute("aria-label", `Scan section (${tooltip})`);
  }
}

function applyScanProgress(payload) {
  const percent = Number(payload?.percent || 0);
  const scanned = Number(payload?.scanned || 0);
  const total = Number(payload?.total || 0);
  scanProgressBar.value = percent;
  scanPercent.textContent = `${percent}%`;
  scanCounts.textContent = `${scanned} / ${total} files`;
  scanCurrentFile.textContent = payload?.current ? `Current: ${payload.current}` : "";
}

function applyIndexProgress(payload) {
  const percent = Number(payload?.percent || 0);
  const processed = Number(payload?.processed || 0);
  const total = Number(payload?.total || 0);
  const success = Number(payload?.success || 0);
  const failed = Number(payload?.failed || 0);

  indexProgressBar.value = percent;
  indexPercent.textContent = `${percent}%`;
  indexCounts.textContent = `${processed} / ${total} indexed`;
  indexCurrentFile.textContent = payload?.current ? `Current: ${payload.current}` : "";
  indexSuccessFail.textContent = `Success: ${success} | Failed: ${failed}`;
}

function bindScanAndIndexEvents() {
  window.desktopAPI.onScanProgress((payload) => {
    applyScanProgress(payload);
  });

  window.desktopAPI.onScanLog((payload) => {
    pushLog(scanLogs, String(payload?.message || ""));
  });

  window.desktopAPI.onScanComplete((payload) => {
    if (payload?.ok) {
      scanUiState.files = Array.isArray(payload.files) ? payload.files : [];
      setStatus(`Scan complete. ${payload.scanned}/${payload.total} media files scanned.`);
      pushLog(scanLogs, `Scan complete. ${scanUiState.files.length} files ready for indexing.`);
      scanUiState.hasSearchRun = false;
      void loadAlbums();
      clearWelcomeGalleryCache();
      loadWelcomeGalleryFromMasterDirectory();
      return;
    }

    if (payload?.cancelled) {
      setStatus("Scan cancelled.");
      pushLog(scanLogs, "Scan cancelled.");
      return;
    }

    setStatus(`Scan failed: ${String(payload?.message || "Unknown error")}`);
    pushLog(scanLogs, `Scan failed: ${String(payload?.message || "Unknown error")}`);
  });

  window.desktopAPI.onIndexProgress((payload) => {
    applyIndexProgress(payload);
  });

  window.desktopAPI.onIndexLog((payload) => {
    pushLog(indexLogs, String(payload?.message || ""));
  });

  window.desktopAPI.onIndexComplete(async (payload) => {
    const indexedPath = pendingSingleCloudIndexPath;

    if (payload?.ok) {
      pendingSingleCloudIndexPath = "";
      setStatus(indexedPath ? "Cloud indexing complete." : "Indexing complete.");
      pushLog(indexLogs, `Indexed ${payload.success}/${payload.total} files.`);
      if (payload.outputPath) {
        filePathInput.value = payload.outputPath;
        resetValidationState();
      }
      if (indexedPath) {
        await refreshResultsForCurrentControls();
        if (activePreviewPath && activePreviewPath === indexedPath) {
          const updatedRow = previewRows.find((row) => String(row?.path || row?.image_path || "").trim() === indexedPath);
          if (updatedRow) {
            void imagePreviewPanel.openForRow(updatedRow, previewRows.length);
          }
        }
      } else if (!scanUiState.hasSearchRun) {
        clearWelcomeGalleryCache();
        void loadWelcomeGalleryFromMasterDirectory();
      }
      void loadFaceClustersForSettings();
      void loadLocalFilterOptionsFromBackend();
      return;
    }

    if (payload?.cancelled) {
      pendingSingleCloudIndexPath = "";
      setStatus(indexedPath ? "Cloud indexing cancelled." : "Indexing cancelled.");
      pushLog(indexLogs, "Indexing cancelled.");
      return;
    }

    pendingSingleCloudIndexPath = "";
    setStatus(
      indexedPath
        ? `Cloud indexing failed: ${String(payload?.message || "Unknown error")}`
        : `Indexing failed: ${String(payload?.message || "Unknown error")}`,
    );
    pushLog(indexLogs, `Indexing failed: ${String(payload?.message || "Unknown error")}`);
  });
}

function shouldToastStatusMessage(message) {
  const text = String(message || "").trim();
  if (!text) {
    return false;
  }

  const lower = text.toLowerCase();
  if (
    lower.startsWith("searching")
    || lower.startsWith("loading")
    || lower.startsWith("validating")
    || /^downloading\s+\d+\s*\/\s*\d+/i.test(lower)
    || /^scanned\s+\d+\s*\/\s*\d+/i.test(lower)
  ) {
    return false;
  }

  return (
    lower.includes("failed")
    || lower.includes("could not")
    || lower.includes("error")
    || lower.includes("unavailable")
    || lower.includes("cancelled")
    || lower.includes("complete")
    || lower.includes("saved")
    || lower.includes("reloaded")
    || lower.includes("deleted")
    || lower.includes("added")
    || lower.includes("created")
    || lower.includes("renamed")
    || lower.includes("loaded")
    || lower.includes("downloaded")
    || lower.includes("started")
    || lower.includes("rebuilt")
    || lower.includes("removed")
  );
}

function inferToastType(message) {
  const lower = String(message || "").toLowerCase();
  if (
    lower.includes("failed")
    || lower.includes("could not")
    || lower.includes("error")
    || lower.includes("unavailable")
  ) {
    return "error";
  }
  if (lower.includes("cancelled")) {
    return "warning";
  }
  if (
    lower.includes("complete")
    || lower.includes("saved")
    || lower.includes("created")
    || lower.includes("renamed")
    || lower.includes("deleted")
    || lower.includes("added")
    || lower.includes("downloaded")
    || lower.includes("loaded")
    || lower.includes("rebuilt")
    || lower.includes("removed")
  ) {
    return "success";
  }
  return "info";
}

function showToast(message, options = {}) {
  if (!toastRoot) {
    return;
  }

  const text = String(message || "").trim();
  if (!text) {
    return;
  }

  const type = ["success", "error", "warning", "info"].includes(String(options.type || ""))
    ? String(options.type)
    : "info";
  const durationMs = Number.isFinite(Number(options.durationMs))
    ? Math.max(1200, Number(options.durationMs))
    : TOAST_DEFAULT_DURATION_MS;

  const toast = document.createElement("div");
  toast.className = `toast toast--${type}`;

  const icon = document.createElement("span");
  icon.className = "toast__icon";
  icon.textContent = type === "success"
    ? "OK"
    : type === "error"
      ? "!"
      : type === "warning"
        ? "!"
        : "i";

  const messageEl = document.createElement("div");
  messageEl.className = "toast__message";
  messageEl.textContent = text;

  toast.appendChild(icon);
  toast.appendChild(messageEl);
  toastRoot.prepend(toast);

  while (toastRoot.children.length > 5) {
    toastRoot.removeChild(toastRoot.lastChild);
  }

  requestAnimationFrame(() => {
    toast.classList.add("visible");
  });

  const closeToast = () => {
    toast.classList.remove("visible");
    toast.classList.add("exiting");
    setTimeout(() => {
      toast.remove();
    }, 180);
  };

  const timer = setTimeout(closeToast, durationMs);
  toast.addEventListener("click", () => {
    clearTimeout(timer);
    closeToast();
  });
}

function setStatus(message) {
  const text = String(message || "");
  statusEl.textContent = text;
  if (shouldToastStatusMessage(text)) {
    showToast(text, { type: inferToastType(text) });
  }
}

function setFiltersExpanded(expanded) {
  if (!toggleFiltersBtn || !filtersShell) {
    return;
  }

  filtersShell.classList.toggle("collapsed", !expanded);
  filtersShell.setAttribute("aria-hidden", expanded ? "false" : "true");
  toggleFiltersBtn.setAttribute("aria-expanded", expanded ? "true" : "false");
  toggleFiltersBtn.textContent = expanded ? "Hide all filters" : "Show all filters";
}

function clearResults() {
  releaseAllResultCardMedia();
  resultsEl.innerHTML = "";
  selectedImagePaths.clear();
  updateAlbumActionButtons();
  searchAligner.classList.remove("searching");
  updateDownloadTopResultsButtonState();
}

function getSearchDownloadRows() {
  if (!scanUiState.hasSearchRun) {
    return [];
  }
  return previewRows.filter((row) => String(row?.path || row?.image_path || "").trim());
}

function updateDownloadTopResultsButtonState() {
  if (!downloadTopResultsBtn) {
    return;
  }

  const downloadableRows = getSearchDownloadRows();
  const visible = downloadableRows.length > 0;
  downloadTopResultsBtn.classList.toggle("hidden", !visible);

  const cappedCount = Math.min(MAX_BULK_DOWNLOAD_RESULTS, downloadableRows.length);
  downloadTopResultsBtn.disabled = bulkDownloadInProgress || cappedCount === 0;
  downloadTopResultsBtn.textContent = bulkDownloadInProgress
    ? "Downloading..."
    : `Download Top ${cappedCount}`;
}

function ensureCardMediaObserver() {
  if (cardMediaObserver || typeof IntersectionObserver !== "function") {
    return;
  }

  cardMediaObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const card = entry.target;
      if (!(card instanceof HTMLElement)) {
        continue;
      }

      if (entry.isIntersecting) {
        void ensureResultCardMediaLoaded(card);
      } else {
        releaseResultCardMedia(card);
      }
    }
  }, {
    root: null,
    rootMargin: CARD_MEDIA_ROOT_MARGIN,
    threshold: 0.01,
  });
}

function trackResultCardMedia(card, img, imagePath, preferredPreviewSrc) {
  if (!card || !img || !imagePath) {
    return;
  }

  ensureCardMediaObserver();
  cardMediaState.set(card, {
    img,
    imagePath,
    preferredPreviewSrc: String(preferredPreviewSrc || "").trim(),
    loaded: false,
    loading: false,
  });

  card.classList.add("loading");

  cardMediaObserver?.observe(card);
  if (!cardMediaObserver) {
    scheduleCardMediaSweep();
  }
}

function setCardLoadingState(card, isLoading) {
  if (!(card instanceof HTMLElement)) {
    return;
  }
  card.classList.toggle("loading", Boolean(isLoading));
}

function scheduleCardMediaSweep() {
  if (cardMediaObserver) {
    return;
  }

  if (cardMediaSweepTimer) {
    clearTimeout(cardMediaSweepTimer);
  }

  cardMediaSweepTimer = setTimeout(() => {
    cardMediaSweepTimer = null;
    void sweepResultCardMedia();
  }, CARD_MEDIA_SWEEP_DEBOUNCE_MS);
}

async function sweepResultCardMedia() {
  const cards = Array.from(resultsEl.querySelectorAll(".search-result"));
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;

  for (const card of cards) {
    const state = cardMediaState.get(card);
    if (!state) {
      continue;
    }

    const rect = card.getBoundingClientRect();
    const nearViewport = rect.bottom >= -1400 && rect.top <= viewportHeight + 1400;
    if (nearViewport) {
      await ensureResultCardMediaLoaded(card);
    } else {
      releaseResultCardMedia(card);
    }
  }
}

async function ensureResultCardMediaLoaded(card) {
  const state = cardMediaState.get(card);
  if (!state || state.loaded || state.loading) {
    return;
  }

  setCardLoadingState(card, true);
  state.loading = true;
  try {
    await setCardImageSource(state.img, card, state.imagePath, state.preferredPreviewSrc);
    state.loaded = true;
  } catch {
    state.loaded = false;
    setCardLoadingState(card, false);
  } finally {
    state.loading = false;
  }
}

function releaseResultCardMedia(card) {
  const state = cardMediaState.get(card);
  if (!state || !state.loaded) {
    return;
  }

  const img = state.img;
  if (img instanceof HTMLImageElement) {
    img.classList.add("hidden");
    img.removeAttribute("src");
    img.removeAttribute("data-preview-fallback-tried");
  }

  const video = card.querySelector(".search-result-video");
  if (video instanceof HTMLVideoElement) {
    video.pause();
    video.removeAttribute("src");
    video.classList.add("hidden");
    video.load();
  }

  card.classList.remove("no-image");
  setCardLoadingState(card, true);
  state.loaded = false;
}

function releaseAllResultCardMedia() {
  const cards = Array.from(resultsEl.querySelectorAll(".search-result"));
  for (const card of cards) {
    releaseResultCardMedia(card);
    cardMediaObserver?.unobserve(card);
  }
}

function updateWelcomeCounts() {
  const shown = Math.min(welcomeGalleryState.offset, welcomeGalleryState.total);
  countsEl.textContent = `library=${welcomeGalleryState.total} | showing=${shown}`;
}

function clearWelcomeGalleryCache() {
  welcomeGalleryCache.rows = [];
  welcomeGalleryCache.total = 0;
  welcomeGalleryCache.hasMore = true;
  welcomeGalleryCache.generatedAt = "";
  welcomeGalleryCache.ready = false;
  welcomeGalleryCache.randomSeed = 0;
}

function hasActiveGalleryFilters(filters) {
  const payload = filters && typeof filters === "object" ? filters : {};
  const albumIds = Array.isArray(payload.albumIds) ? payload.albumIds : [];
  if (albumIds.length > 0) {
    return true;
  }

  const keys = [
    "containsPeople",
    "containsText",
    "mediaType",
    "resolutionMegapixels",
    "aspectRatio",
    "fileType",
    "durationBucket",
    "fpsLabel",
    "hasAudio",
    "audioType",
    "hasCaptions",
    "motionLevel",
    "style",
    "orientation",
    "brightnessCategory",
    "sceneTag",
    "objectTag",
    "activityTag",
    "socialMediaBand",
    "instagramBand",
    "aspectRatioSuitability",
    "aestheticStyle",
    "editingLevel",
    "visualComplexity",
    "heroElement",
    "depthOfField",
  ];
  for (const key of keys) {
    const value = String(payload[key] || "any").toLowerCase();
    if (value && value !== "any") {
      return true;
    }
  }

  if (String(payload.ocrTextQuery || "").trim()) {
    return true;
  }
  return false;
}

function initializeSidebarSectionToggles() {
  const sections = Array.from(document.querySelectorAll("#sidebar-content .settings-section"));

  function setSectionExpanded(section, expanded) {
    section.classList.toggle("collapsed", !expanded);
    const header = section.querySelector(":scope > .settings-section-header");
    if (header) {
      header.setAttribute("aria-expanded", expanded ? "true" : "false");
    }
  }

  function expandOnly(targetSection) {
    for (const candidate of sections) {
      setSectionExpanded(candidate, candidate === targetSection);
    }
  }

  for (const section of sections) {
    if (section.querySelector(":scope > .settings-section-header")) {
      continue;
    }

    const heading = section.querySelector(":scope > h3");
    if (!heading) {
      continue;
    }

    const header = document.createElement("div");
    header.className = "settings-section-header";
    header.setAttribute("role", "button");
    header.setAttribute("tabindex", "0");
    header.setAttribute("aria-expanded", "true");

    const toggleBtn = document.createElement("button");
    toggleBtn.className = "section-toggle-btn";
    toggleBtn.type = "button";
    toggleBtn.textContent = "▾";
    toggleBtn.setAttribute("aria-label", `Toggle ${heading.textContent || "section"}`);

    const body = document.createElement("div");
    body.className = "settings-section-body";

    header.appendChild(heading);
    header.appendChild(toggleBtn);
    section.insertBefore(header, section.firstChild);

    const remainingChildren = Array.from(section.children).filter(
      (child) => child !== header && child !== body,
    );
    for (const child of remainingChildren) {
      body.appendChild(child);
    }

    section.appendChild(body);

    function toggleSection() {
      const isCollapsed = section.classList.contains("collapsed");
      if (isCollapsed) {
        expandOnly(section);
        return;
      }

      // Allow all sections to be collapsed.
      setSectionExpanded(section, false);
    }

    toggleBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleSection();
    });

    header.addEventListener("click", () => {
      toggleSection();
    });

    header.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggleSection();
      }
    });
  }

  // Initialize ARIA states from current collapsed classes.
  for (const section of sections) {
    const header = section.querySelector(":scope > .settings-section-header");
    if (header) {
      header.setAttribute("aria-expanded", section.classList.contains("collapsed") ? "false" : "true");
    }
  }
}

function getEnabledFilterSet() {
  return new Set(userSettingsState.enabledFilters);
}

function setFaceClusterStatus(message) {
  if (!settingsFaceClusterStatus) {
    return;
  }
  const text = String(message || "");
  settingsFaceClusterStatus.textContent = text;
  if (shouldToastStatusMessage(text)) {
    showToast(text, { type: inferToastType(text) });
  }
}

function setFacesWorkspaceStatus(message) {
  if (!facesStatusEl) {
    return;
  }
  const text = String(message || "");
  facesStatusEl.textContent = text;
  if (shouldToastStatusMessage(text)) {
    showToast(text, { type: inferToastType(text) });
  }
}

function getFaceClusterOptionLabel(cluster) {
  const clusterId = String(cluster?.cluster_id || "").trim();
  const personLabel = String(cluster?.person_label || "").trim();
  const faceCount = Number(cluster?.face_count || 0);
  if (personLabel) {
    return `${personLabel} (Group ${clusterId}, ${faceCount} faces)`;
  }
  return `Group ${clusterId} (${faceCount} faces)`;
}

function updateFaceClusterLabelInputFromSelection() {
  if (!settingsFaceClusterSelect || !settingsFaceClusterLabelInput) {
    return;
  }
  const selectedClusterId = String(settingsFaceClusterSelect.value || "").trim();
  const selectedCluster = faceClusterUiState.clusters.find(
    (cluster) => String(cluster?.cluster_id || "") === selectedClusterId,
  );
  settingsFaceClusterLabelInput.value = String(selectedCluster?.person_label || "");
}

function renderFaceClustersForSettings() {
  if (!settingsFaceClusterSelect) {
    return;
  }

  const currentValue = String(settingsFaceClusterSelect.value || "").trim();
  settingsFaceClusterSelect.innerHTML = "";

  if (faceClusterUiState.clusters.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No people groups yet";
    settingsFaceClusterSelect.appendChild(option);
    updateFaceClusterLabelInputFromSelection();
    return;
  }

  const sortedClusters = [...faceClusterUiState.clusters].sort((a, b) => Number(b?.face_count || 0) - Number(a?.face_count || 0));
  for (const cluster of sortedClusters) {
    const option = document.createElement("option");
    option.value = String(cluster?.cluster_id || "");
    option.textContent = getFaceClusterOptionLabel(cluster);
    settingsFaceClusterSelect.appendChild(option);
  }

  const stillExists = sortedClusters.some((cluster) => String(cluster?.cluster_id || "") === currentValue);
  settingsFaceClusterSelect.value = stillExists ? currentValue : String(sortedClusters[0]?.cluster_id || "");
  updateFaceClusterLabelInputFromSelection();
}

async function loadLocalFilterOptionsFromBackend() {
  if (!window.desktopAPI?.getLocalFilterOptions) {
    return;
  }
  const filterOptionsResult = await window.desktopAPI.getLocalFilterOptions();
  if (filterOptionsResult?.ok && filterOptionsResult.options) {
    localFilterOptions = {
      ...localFilterOptions,
      ...filterOptionsResult.options,
    };
    renderDynamicFilters();
  }
}

async function loadFaceClustersForSettings() {
  if (!window.desktopAPI?.getFaceClusters) {
    return;
  }

  const result = await window.desktopAPI.getFaceClusters();
  if (!result?.ok) {
    faceClusterUiState.clusters = [];
    renderFaceClustersForSettings();
    setFaceClusterStatus(`Could not load people groups: ${String(result?.message || "Unknown error")}`);
    return;
  }

  faceClusterUiState.clusters = Array.isArray(result.clusters) ? result.clusters : [];
  renderFaceClustersForSettings();
  renderFacesWorkspaceClusters();
  if (faceClusterUiState.clusters.length > 0) {
    setFaceClusterStatus(`Loaded ${faceClusterUiState.clusters.length} people group(s).`);
    setFacesWorkspaceStatus(`Loaded ${faceClusterUiState.clusters.length} people group(s).`);
  } else {
    setFaceClusterStatus("No people groups yet. Run local indexing or rebuild people groups.");
    setFacesWorkspaceStatus("No people groups yet. Run indexing first.");
  }
}

function getClusterPreviewPaths(cluster, showAll = false) {
  const memberPaths = Array.isArray(cluster?.members)
    ? cluster.members.map((entry) => String(entry?.path || "").trim()).filter(Boolean)
    : [];
  const samplePaths = Array.isArray(cluster?.sample_paths)
    ? cluster.sample_paths.map((entry) => String(entry || "").trim()).filter(Boolean)
    : [];
  const allPaths = Array.from(new Set([...samplePaths, ...memberPaths]));
  if (showAll) {
    return allPaths;
  }
  return allPaths.slice(0, 8);
}

async function buildClusterPreviewImage(imagePath) {
  const img = document.createElement("img");
  img.className = "faces-preview-thumb";
  img.alt = imagePath;
  img.loading = "lazy";
  img.title = imagePath;

  let previewSrc = normalizeImageSrc(imagePath);
  if (window.desktopAPI?.getImagePreviewSrc) {
    try {
      const result = await window.desktopAPI.getImagePreviewSrc({ imagePath });
      if (result?.ok && result?.previewSrc) {
        previewSrc = String(result.previewSrc);
      }
    } catch {
      // Keep direct file fallback.
    }
  }

  img.src = previewSrc;
  img.addEventListener("error", () => {
    img.classList.add("faces-preview-thumb--error");
  });
  return img;
}

function renderFacesWorkspaceClusters() {
  if (!facesClustersGridEl) {
    return;
  }

  facesClustersGridEl.innerHTML = "";
  const clusters = Array.isArray(faceClusterUiState.clusters) ? faceClusterUiState.clusters : [];
  if (clusters.length === 0) {
    const empty = document.createElement("p");
    empty.className = "faces-empty-state";
    empty.textContent = "No people groups available yet.";
    facesClustersGridEl.appendChild(empty);
    return;
  }

  const sortedClusters = [...clusters].sort((a, b) => Number(b?.face_count || 0) - Number(a?.face_count || 0));
  for (const cluster of sortedClusters) {
    const clusterId = String(cluster?.cluster_id || "").trim();
    const personLabel = String(cluster?.person_label || "").trim();
    const showAll = facesWorkspaceState.showAllByClusterId.has(clusterId);
    const previewPaths = getClusterPreviewPaths(cluster, showAll);
    const totalUniquePaths = getClusterPreviewPaths(cluster, true).length;

    const card = document.createElement("article");
    card.className = "faces-cluster-card";

    const header = document.createElement("div");
    header.className = "faces-cluster-header";
    header.innerHTML = `
      <div>
        <h3>${personLabel || `Person group ${clusterId}`}</h3>
        <p>${Number(cluster?.face_count || 0)} faces in ${Number(cluster?.image_count || 0)} photos</p>
      </div>
    `;

    const labelRow = document.createElement("div");
    labelRow.className = "faces-cluster-label-row";
    const labelInput = document.createElement("input");
    labelInput.type = "text";
    labelInput.className = "faces-label-input";
    labelInput.placeholder = "Enter person name";
    labelInput.value = String(cluster?.person_label || "");
    const saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.className = "settings-btn faces-btn faces-btn-save";
    saveButton.textContent = "Save Name";
    saveButton.addEventListener("click", async () => {
      if (!window.desktopAPI?.setFaceClusterLabel) {
        setFacesWorkspaceStatus("Face labeling API is unavailable.");
        return;
      }
      saveButton.disabled = true;
      try {
        const result = await window.desktopAPI.setFaceClusterLabel({
          clusterId,
          personLabel: String(labelInput.value || "").trim(),
        });
        if (!result?.ok) {
          setFacesWorkspaceStatus(`Could not save name for group ${clusterId}: ${String(result?.message || "Unknown error")}`);
          return;
        }
        setFacesWorkspaceStatus(`Saved name for group ${clusterId}.`);
        await loadFaceClustersForSettings();
        await loadLocalFilterOptionsFromBackend();
      } finally {
        saveButton.disabled = false;
      }
    });
    labelRow.appendChild(labelInput);
    labelRow.appendChild(saveButton);

    const previews = document.createElement("div");
    previews.className = "faces-previews-grid";
    for (const previewPath of previewPaths) {
      const cell = document.createElement("div");
      cell.className = "faces-preview-cell";
      const imgPromise = buildClusterPreviewImage(previewPath);
      imgPromise.then((img) => {
        cell.appendChild(img);
      });
      const caption = document.createElement("p");
      caption.className = "faces-preview-caption";
      caption.textContent = previewPath.split(/[/\\]/).pop() || previewPath;
      caption.title = previewPath;
      cell.appendChild(caption);
      previews.appendChild(cell);
    }

    const footer = document.createElement("div");
    footer.className = "faces-cluster-footer";
    if (totalUniquePaths > 8) {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "settings-btn faces-btn faces-btn-toggle";
      toggle.textContent = showAll ? "Show fewer previews" : `Show all previews (${totalUniquePaths})`;
      toggle.addEventListener("click", () => {
        if (showAll) {
          facesWorkspaceState.showAllByClusterId.delete(clusterId);
        } else {
          facesWorkspaceState.showAllByClusterId.add(clusterId);
        }
        renderFacesWorkspaceClusters();
      });
      footer.appendChild(toggle);
    }

    card.appendChild(header);
    card.appendChild(labelRow);
    card.appendChild(previews);
    card.appendChild(footer);
    facesClustersGridEl.appendChild(card);
  }
}

function updateBuiltInFilterVisibility() {
  const enabled = getEnabledFilterSet();
  const peopleGroup = containsPeopleSelect?.closest(".filter-group");
  const textGroup = containsTextSelect?.closest(".filter-group");
  const ocrTextGroup = ocrTextQueryInput?.closest(".filter-group");
  const mediaGroup = mediaTypeSelect?.closest(".filter-group");
  if (peopleGroup) {
    peopleGroup.style.display = enabled.has("containsPeople") ? "flex" : "none";
  }
  if (textGroup) {
    textGroup.style.display = enabled.has("containsText") ? "flex" : "none";
  }
  if (ocrTextGroup) {
    ocrTextGroup.style.display = enabled.has("ocrTextQuery") ? "flex" : "none";
  }
  if (mediaGroup) {
    mediaGroup.style.display = enabled.has("mediaType") ? "flex" : "none";
  }
}

function buildFiltersPayload() {
  const enabled = getEnabledFilterSet();
  const selectedAlbumFromFilter = Number(albumFilterSelect?.value);
  const albumIds = [];
  if (Number.isFinite(selectedAlbumFromFilter) && selectedAlbumFromFilter > 0) {
    albumIds.push(selectedAlbumFromFilter);
  }
  if (isValidAlbumId(albumsState.activeAlbumId)) {
    albumIds.push(Number(albumsState.activeAlbumId));
  }

  const payload = {
    containsPeople: enabled.has("containsPeople") ? containsPeopleSelect.value : "any",
    containsText: enabled.has("containsText") ? containsTextSelect.value : "any",
    ocrTextQuery: enabled.has("ocrTextQuery") ? String(ocrTextQueryInput?.value || "").trim() : "",
    mediaType: enabled.has("mediaType") ? String(mediaTypeSelect?.value || "any") : "any",
    albumIds: Array.from(new Set(albumIds)),
  };

  if (dynamicFiltersEl) {
    const inputs = dynamicFiltersEl.querySelectorAll("select[data-filter-key]");
    for (const input of inputs) {
      const key = String(input.getAttribute("data-filter-key") || "");
      if (!key || !enabled.has(key)) {
        continue;
      }
      // Built-in filters are handled above; ignore any accidental duplicate dynamic control.
      if (Object.prototype.hasOwnProperty.call(payload, key)) {
        continue;
      }
      payload[key] = String(input.value || "any");
    }

    const selectedMultiValues = new Map();
    const checkedBoxes = dynamicFiltersEl.querySelectorAll("input[type=\"checkbox\"][data-filter-key][data-filter-value]:checked");
    for (const checkbox of checkedBoxes) {
      const key = String(checkbox.getAttribute("data-filter-key") || "");
      if (!key || !enabled.has(key) || !MULTI_VALUE_FILTER_KEYS.has(key)) {
        continue;
      }
      const value = String(checkbox.getAttribute("data-filter-value") || "").trim();
      if (!value) {
        continue;
      }
      if (!selectedMultiValues.has(key)) {
        selectedMultiValues.set(key, []);
      }
      selectedMultiValues.get(key).push(value);
    }

    for (const [key, values] of selectedMultiValues.entries()) {
      const uniqueValues = Array.from(new Set(values));
      if (uniqueValues.length > 0) {
        payload[key] = uniqueValues;
      }
    }
  }

  return payload;
}

function getCurrentDynamicFilterSelections() {
  const selections = {};
  if (!dynamicFiltersEl) {
    return selections;
  }

  const selects = dynamicFiltersEl.querySelectorAll("select[data-filter-key]");
  for (const input of selects) {
    const key = String(input.getAttribute("data-filter-key") || "");
    if (!key) {
      continue;
    }
    selections[key] = String(input.value || "any");
  }

  const checkedBoxes = dynamicFiltersEl.querySelectorAll("input[type=\"checkbox\"][data-filter-key][data-filter-value]:checked");
  for (const checkbox of checkedBoxes) {
    const key = String(checkbox.getAttribute("data-filter-key") || "");
    if (!key) {
      continue;
    }
    if (!Array.isArray(selections[key])) {
      selections[key] = [];
    }
    selections[key].push(String(checkbox.getAttribute("data-filter-value") || ""));
  }

  return selections;
}

function renderDynamicFilters() {
  if (!dynamicFiltersEl) {
    return;
  }

  const currentSelections = getCurrentDynamicFilterSelections();
  dynamicFiltersEl.innerHTML = "";
  const enabled = getEnabledFilterSet();

  for (const def of FILTER_DEFINITIONS) {
    if (!enabled.has(def.key)) {
      continue;
    }
    if (
      def.key === "containsPeople"
      || def.key === "containsText"
      || def.key === "mediaType"
      || def.key === "ocrTextQuery"
    ) {
      continue;
    }

    const values = Array.isArray(localFilterOptions[def.key]) ? localFilterOptions[def.key] : [];

    const group = document.createElement("div");
    group.className = "filter-group";

    const label = document.createElement("label");
    label.textContent = def.label;

    if (MULTI_VALUE_FILTER_KEYS.has(def.key)) {
      if (values.length === 0) {
        const empty = document.createElement("p");
        empty.className = "filter-empty-state";
        empty.textContent = "No options yet";
        group.appendChild(label);
        group.appendChild(empty);
        dynamicFiltersEl.appendChild(group);
        continue;
      }

      const selectedValues = new Set(
        Array.isArray(currentSelections[def.key]) ? currentSelections[def.key].map((value) => String(value)) : [],
      );

      const searchInput = document.createElement("input");
      searchInput.type = "text";
      searchInput.className = "filter-multi-search";
      searchInput.placeholder = `Search ${def.label.toLowerCase()}...`;
      searchInput.setAttribute("aria-label", `Search ${def.label}`);

      const list = document.createElement("div");
      list.className = "filter-multi-list";

      const optionRows = [];

      for (const [index, value] of values.entries()) {
        const optionId = `dynamic-filter-${def.key}-${index}`;
        const optionRow = document.createElement("label");
        optionRow.className = "filter-multi-option";
        optionRow.setAttribute("for", optionId);

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.id = optionId;
        checkbox.setAttribute("data-filter-key", def.key);
        checkbox.setAttribute("data-filter-value", value);
        checkbox.checked = selectedValues.has(String(value));
        checkbox.addEventListener("change", () => {
          void refreshResultsForCurrentControls();
        });

        const text = document.createElement("span");
        text.textContent = value;

        optionRow.appendChild(checkbox);
        optionRow.appendChild(text);
        list.appendChild(optionRow);
        optionRows.push(optionRow);
      }

      const applySearch = () => {
        const query = String(searchInput.value || "").trim().toLowerCase();
        for (const row of optionRows) {
          const rowText = String(row.textContent || "").trim().toLowerCase();
          row.style.display = !query || rowText.includes(query) ? "" : "none";
        }
      };

      searchInput.addEventListener("input", applySearch);

      group.appendChild(label);
      group.appendChild(searchInput);
      group.appendChild(list);
      dynamicFiltersEl.appendChild(group);
      continue;
    }

    label.setAttribute("for", `dynamic-filter-${def.key}`);

    const select = document.createElement("select");
    select.id = `dynamic-filter-${def.key}`;
    select.setAttribute("data-filter-key", def.key);
    const hasValues = values.length > 0;
    if (!hasValues) {
      select.disabled = true;
    }

    const anyOption = document.createElement("option");
    anyOption.value = "any";
    anyOption.textContent = hasValues ? "Any" : "No options yet";
    select.appendChild(anyOption);

    if (hasValues) {
      for (const value of values) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value;
        select.appendChild(option);
      }
    }

    const previousValue = String(currentSelections[def.key] || "any");
    if (hasValues) {
      const hasOption = values.some((value) => String(value) === previousValue);
      select.value = hasOption ? previousValue : "any";

      select.addEventListener("change", () => {
        void refreshResultsForCurrentControls();
      });
    }

    group.appendChild(label);
    group.appendChild(select);
    dynamicFiltersEl.appendChild(group);
  }

  updateBuiltInFilterVisibility();
}

function renderUserFilterPicker() {
  if (!userFilterPickerEl) {
    return;
  }

  const enabled = getEnabledFilterSet();
  userFilterPickerEl.innerHTML = "";

  for (const def of FILTER_DEFINITIONS) {
    const row = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = def.key;
    checkbox.checked = enabled.has(def.key);
    checkbox.addEventListener("change", () => {
      const nextSet = getEnabledFilterSet();
      if (checkbox.checked) {
        nextSet.add(def.key);
      } else {
        nextSet.delete(def.key);
      }
      userSettingsState.enabledFilters = Array.from(nextSet);
      renderDynamicFilters();
    });

    row.appendChild(checkbox);
    row.appendChild(document.createTextNode(def.label));
    userFilterPickerEl.appendChild(row);
  }
}

async function loadSettingsUiState() {
  let loadedEnabledFiltersFromSettings = false;

  await loadLocalFilterOptionsFromBackend();

  if (window.desktopAPI?.getUserSettings) {
    const settingsResult = await window.desktopAPI.getUserSettings();
    if (settingsResult?.ok && settingsResult.settings) {
      const settings = settingsResult.settings;
      userSettingsState.enabledFilters = Array.isArray(settings.enabledFilters)
        ? settings.enabledFilters
        : [];
      loadedEnabledFiltersFromSettings = Array.isArray(settings.enabledFilters);

      if (settingsUserNameInput) {
        settingsUserNameInput.value = String(settings.user_name || "");
      }
      if (settingsUserPasswordInput) {
        settingsUserPasswordInput.value = String(settings.user_password || "");
      }
      if (settingsAwsRegionInput) {
        settingsAwsRegionInput.value = String(settings.aws_region || "us-east-1");
      }
      if (settingsAwsKeyInput) {
        settingsAwsKeyInput.value = String(settings.aws_key || "");
      }
      if (settingsAwsSecretInput) {
        settingsAwsSecretInput.value = String(settings.secret_key || "");
      }
      if (settingsBedrockModelInput) {
        settingsBedrockModelInput.value = String(settings.model || "qwen.qwen3-vl-235b-a22b");
      }
      if (settingsTwelveLabsApiKeyInput) {
        settingsTwelveLabsApiKeyInput.value = String(settings.twelvelabs_api_key || "");
      }
      const minMatchScoreValue = Number(settingsMinMatchScoreInput?.value);
      userSettingsState.minMatchScore = Number.isFinite(minMatchScoreValue)
        ? Math.max(0, minMatchScoreValue)
        : 0.001;
      userSettingsState.uiTheme = normalizeUiTheme(settings.ui_theme);
      userSettingsState.resultsDensity = normalizeResultsDensity(settings.results_density);
      userSettingsState.autoExpandFilters = Boolean(settings.auto_expand_filters);
      userSettingsState.autoCloseSidebarOnSettingsNav =
        settings.auto_close_sidebar_on_settings_nav === undefined
          ? true
          : Boolean(settings.auto_close_sidebar_on_settings_nav);
      userSettingsState.galleryVideoAutoplay =
        settings.gallery_video_autoplay === undefined
          ? false
          : Boolean(settings.gallery_video_autoplay);
      userSettingsState.cacheTranscodedMovPreview = Boolean(settings.cache_transcoded_mov_preview);
      userSettingsState.cacheTranscodedHeicPreview = Boolean(settings.cache_transcoded_heic_preview);
      userSettingsState.cacheTranscodedHeifPreview = Boolean(settings.cache_transcoded_heif_preview);
      userSettingsState.videoSearchResultMode = normalizeVideoSearchResultMode(
        settings.video_search_result_mode,
      );
      userSettingsState.enableFaceIndexing = Boolean(settings.enable_face_indexing);
      userSettingsState.faceModelVersion = String(settings.face_model_version || "face-api-ssd-v1").trim() || "face-api-ssd-v1";
      const faceMinConfidenceInputValue = Number(settingsFaceMinConfidenceInput?.value);
      userSettingsState.faceMinDetectionConfidence = Number.isFinite(faceMinConfidenceInputValue)
        ? Math.max(0, Math.min(1, faceMinConfidenceInputValue))
        : 0.6;
      const faceMinQualityInputValue = Number(settingsFaceMinQualityInput?.value);
      userSettingsState.faceMinQualityScore = Number.isFinite(faceMinQualityInputValue)
        ? Math.max(0, Math.min(1, faceMinQualityInputValue))
        : 0.45;
      const faceClusterThresholdInputValue = Number(settingsFaceClusterDistanceThresholdInput?.value);
      userSettingsState.faceClusterDistanceThreshold = Number.isFinite(faceClusterThresholdInputValue)
        ? Math.max(0.05, Math.min(1, faceClusterThresholdInputValue))
        : 0.35;
      if (settingsMinMatchScoreInput) {
        settingsMinMatchScoreInput.value = String(userSettingsState.minMatchScore);
      }
      if (settingsUiThemeSelect) {
        settingsUiThemeSelect.value = userSettingsState.uiTheme;
      }
      if (settingsResultsDensitySelect) {
        settingsResultsDensitySelect.value = userSettingsState.resultsDensity;
      }
      if (settingsAutoExpandFiltersInput) {
        settingsAutoExpandFiltersInput.checked = userSettingsState.autoExpandFilters;
      }
      if (settingsAutoCloseSidebarOnSettingsNavInput) {
        settingsAutoCloseSidebarOnSettingsNavInput.checked = userSettingsState.autoCloseSidebarOnSettingsNav;
      }
      if (settingsGalleryVideoAutoplayInput) {
        settingsGalleryVideoAutoplayInput.checked = userSettingsState.galleryVideoAutoplay;
      }
      if (settingsCacheTranscodedMovPreviewInput) {
        settingsCacheTranscodedMovPreviewInput.checked = userSettingsState.cacheTranscodedMovPreview;
      }
      if (settingsCacheTranscodedHeicPreviewInput) {
        settingsCacheTranscodedHeicPreviewInput.checked = userSettingsState.cacheTranscodedHeicPreview;
      }
      if (settingsCacheTranscodedHeifPreviewInput) {
        settingsCacheTranscodedHeifPreviewInput.checked = userSettingsState.cacheTranscodedHeifPreview;
      }
      if (settingsVideoSearchResultModeSelect) {
        settingsVideoSearchResultModeSelect.value = userSettingsState.videoSearchResultMode;
      }
      if (settingsEnableFaceIndexingInput) {
        settingsEnableFaceIndexingInput.checked = userSettingsState.enableFaceIndexing;
      }
      if (settingsFaceModelVersionInput) {
        settingsFaceModelVersionInput.value = userSettingsState.faceModelVersion;
      }
      if (settingsFaceMinConfidenceInput) {
        settingsFaceMinConfidenceInput.value = String(userSettingsState.faceMinDetectionConfidence);
      }
      if (settingsFaceMinQualityInput) {
        settingsFaceMinQualityInput.value = String(userSettingsState.faceMinQualityScore);
      }
      if (settingsFaceClusterDistanceThresholdInput) {
        settingsFaceClusterDistanceThresholdInput.value = String(userSettingsState.faceClusterDistanceThreshold);
      }
    }
  }

  const validFilterKeys = new Set(FILTER_DEFINITIONS.map((def) => def.key));
  userSettingsState.enabledFilters = Array.from(new Set(
    (Array.isArray(userSettingsState.enabledFilters) ? userSettingsState.enabledFilters : [])
      .map((value) => String(value || ""))
      .filter((value) => validFilterKeys.has(value)),
  ));

  if (!loadedEnabledFiltersFromSettings && userSettingsState.enabledFilters.length === 0) {
    userSettingsState.enabledFilters = [...DEFAULT_ENABLED_FILTERS];
  }

  renderUserFilterPicker();
  renderDynamicFilters();
  await loadFaceClustersForSettings();
  applyUiPreferences();
  if (homeScreen && !homeScreen.classList.contains("hidden")) {
    setFiltersExpanded(Boolean(userSettingsState.autoExpandFilters));
  }
}

async function syncHomepageFiltersFromSavedSettings() {
  await loadSettingsUiState();
  if (homeScreen && !homeScreen.classList.contains("hidden")) {
    await refreshResultsForCurrentControls();
  }
}

function resetValidationState() {
  validationState.filePath = "";
  validationState.result = null;
  validationState.pending = null;
}

function normalizeImageSrc(filePath) {
  if (!filePath) {
    return "";
  }
  return `file:///${filePath.replaceAll("\\", "/")}`;
}

function getFileExtension(filePath) {
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

function normalizeVideoSearchResultMode(value) {
  return String(value || "").trim().toLowerCase() === "matching_timeframes"
    ? "matching_timeframes"
    : "full_video";
}

function formatSecondsLabel(value) {
  const total = Math.max(0, Number(value) || 0);
  const mins = Math.floor(total / 60);
  const secs = Math.floor(total % 60);
  const ms = Math.round((total - Math.floor(total)) * 1000);
  if (ms > 0) {
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
  }
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

async function setCardImageSource(img, card, imagePath, preferredPreviewSrc) {
  setCardLoadingState(card, true);
  const mediaType = normalizeMediaType(card?.dataset?.mediaType, imagePath);
  const video = card?.querySelector?.(".search-result-video");

  if (mediaType === "video") {
    if (img) {
      img.classList.add("hidden");
      img.src = "";
    }

    const preferredVideoSrc = String(preferredPreviewSrc || "").trim();
    const clipStart = Number(card?.dataset?.clipStartSeconds || "");
    const clipEnd = Number(card?.dataset?.clipEndSeconds || "");
    let directVideoSrc = preferredVideoSrc || normalizeImageSrc(imagePath);
    const sourceExt = getFileExtension(imagePath);
    const previewExt = getFileExtension(preferredVideoSrc);
    const shouldResolveVideoPreview = !preferredVideoSrc || sourceExt === ".mov" || previewExt === ".mov";
    let resolvedClipStart = clipStart;
    let resolvedClipEnd = clipEnd;

    if (shouldResolveVideoPreview) {
      const previewApi = window.desktopAPI?.getMediaPreviewSrc || window.desktopAPI?.getImagePreviewSrc;
      if (previewApi) {
        try {
          const previewResult = await previewApi({
            imagePath,
            mediaType,
            clipStartSeconds: Number.isFinite(clipStart) ? clipStart : undefined,
            clipEndSeconds: Number.isFinite(clipEnd) ? clipEnd : undefined
            // Do NOT set forceTranscode here; fallback is handled in onerror below
          });
          const previewSrc = String(previewResult?.previewSrc || "").trim();
          if (previewResult?.ok && previewSrc) {
            directVideoSrc = previewSrc;
            if (previewResult?.clipStartSeconds != null) resolvedClipStart = Number(previewResult.clipStartSeconds);
            if (previewResult?.clipEndSeconds != null) resolvedClipEnd = Number(previewResult.clipEndSeconds);
          }
        } catch {
          // Keep direct source.
        }
      }
    }

    if (!video || !directVideoSrc) {
      card.classList.add("no-image");
      setCardLoadingState(card, false);
      return;
    }

    let loadingSettled = false;
    const settleVideoLoading = () => {
      if (loadingSettled) {
        return;
      }
      loadingSettled = true;
      setCardLoadingState(card, false);
    };
    const attachVideoReadyHandlers = () => {
      video.addEventListener("loadeddata", settleVideoLoading, { once: true });
      video.addEventListener("loadedmetadata", settleVideoLoading, { once: true });
      video.addEventListener("canplay", settleVideoLoading, { once: true });
    };

    video.classList.remove("hidden");
    card.classList.remove("no-image");
    attachVideoReadyHandlers();
    video.src = directVideoSrc;
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    // Seek and lock playback to timeframe if specified
    if (Number.isFinite(resolvedClipStart) && Number.isFinite(resolvedClipEnd) && resolvedClipEnd > resolvedClipStart) {
      const onLoaded = () => {
        video.currentTime = resolvedClipStart;
        if (userSettingsState.galleryVideoAutoplay) {
          void video.play().catch(() => {});
        }
      };
      if (video.readyState >= 1) {
        onLoaded();
      } else {
        video.addEventListener("loadedmetadata", onLoaded, { once: true });
      }
      // Stop playback at end time
      const onTimeUpdate = () => {
        if (video.currentTime >= resolvedClipEnd) {
          video.pause();
          video.currentTime = resolvedClipStart;
        }
      };
      video.addEventListener("timeupdate", onTimeUpdate);
      video.addEventListener("emptied", () => {
        video.removeEventListener("timeupdate", onTimeUpdate);
      }, { once: true });
    } else {
      if (userSettingsState.galleryVideoAutoplay) {
        void video.play().catch(() => {});
      } else {
        video.pause();
        video.currentTime = 0;
      }
    }
    let fallbackAttempted = false;
    video.onerror = async () => {
      if (fallbackAttempted) {
        video.classList.add("hidden");
        card.classList.add("no-image");
        settleVideoLoading();
        return;
      }
      fallbackAttempted = true;
      // Fallback: force transcoding to MP4
      const previewApi = window.desktopAPI?.getMediaPreviewSrc || window.desktopAPI?.getImagePreviewSrc;
      if (previewApi) {
        try {
          const previewResult = await previewApi({
            imagePath,
            mediaType,
            clipStartSeconds: Number.isFinite(resolvedClipStart) ? resolvedClipStart : undefined,
            clipEndSeconds: Number.isFinite(resolvedClipEnd) ? resolvedClipEnd : undefined,
            forceTranscode: true
          });
          const previewSrc = String(previewResult?.previewSrc || "").trim();
          if (previewResult?.ok && previewSrc && previewSrc !== video.src) {
            loadingSettled = false;
            setCardLoadingState(card, true);
            attachVideoReadyHandlers();
            video.src = previewSrc;
            if (Number.isFinite(resolvedClipStart)) video.currentTime = resolvedClipStart;
            if (userSettingsState.galleryVideoAutoplay) {
              void video.play().catch(() => {});
            }
            return;
          }
        } catch { /* ignore */ }
      }
      video.classList.add("hidden");
      card.classList.add("no-image");
      settleVideoLoading();
    };
    return;
  }

  if (video) {
    video.pause();
    video.src = "";
    video.classList.add("hidden");
  }

  const preferredSrc = String(preferredPreviewSrc || "").trim();
  const directSrc = preferredSrc || normalizeImageSrc(imagePath);
  if (!directSrc) {
    img.classList.add("hidden");
    card.classList.add("no-image");
    setCardLoadingState(card, false);
    return;
  }

  let imageSettled = false;
  const settleImageLoading = () => {
    if (imageSettled) {
      return;
    }
    imageSettled = true;
    setCardLoadingState(card, false);
  };

  img.classList.add("hidden");
  img.onload = () => {
    img.classList.remove("hidden");
    card.classList.remove("no-image");
    settleImageLoading();
  };

  const ext = getFileExtension(imagePath);
  const shouldPreResolve = !preferredSrc && CONVERTIBLE_PREVIEW_EXTENSIONS.has(ext);

  if (shouldPreResolve && window.desktopAPI?.getImagePreviewSrc) {
    try {
      const previewResult = await window.desktopAPI.getImagePreviewSrc({ imagePath });
      const previewSrc = String(previewResult?.previewSrc || "").trim();
      if (previewResult?.ok && previewSrc) {
        imageSettled = false;
        img.src = previewSrc;
        img.onerror = () => {
          img.classList.add("hidden");
          card.classList.add("no-image");
          settleImageLoading();
        };
        return;
      }
    } catch {
      // Fall back to direct source path.
    }
  }

  img.src = directSrc;
  img.onerror = async () => {
    const alreadyTriedFallback = img.getAttribute("data-preview-fallback-tried") === "1";
    if (!alreadyTriedFallback && imagePath && window.desktopAPI?.getImagePreviewSrc) {
      img.setAttribute("data-preview-fallback-tried", "1");
      try {
        const previewResult = await window.desktopAPI.getImagePreviewSrc({ imagePath });
        const previewSrc = String(previewResult?.previewSrc || "").trim();
        const isConverted = Boolean(previewResult?.converted);
        if (previewResult?.ok && previewSrc && (isConverted || previewSrc !== img.src)) {
          imageSettled = false;
          setCardLoadingState(card, true);
          card.classList.remove("no-image");
          img.src = previewSrc;
          return;
        }
      } catch {
        // Fall through to no-image presentation.
      }
    }

    img.classList.add("hidden");
    card.classList.add("no-image");
    settleImageLoading();
  };
}

async function resolveImageDetails(row) {
  const imagePath = String(row?.path || row?.image_path || "").trim();
  const mediaType = normalizeMediaType(row?.media_type || row?.metadata?.media_type, imagePath);
  const metadataFilePath = String(filePathInput.value || "").trim();

  const fallback = {
    id: row?.id || null,
    path: imagePath,
    media_type: mediaType,
    status: row?.status || "ok",
    metadata: row?.metadata || {},
    local_metadata: row?.local_metadata || null,
    cloud_metadata: row?.cloud_metadata || null,
    error: row?.error || "",
  };

  if (!imagePath || !metadataFilePath || !window.desktopAPI?.getImageMetadataByPath) {
    return fallback;
  }

  const resolved = await window.desktopAPI.getImageMetadataByPath({
    filePath: metadataFilePath,
    imagePath,
  });

  if (!resolved?.ok || !resolved.result) {
    return fallback;
  }

  return {
    id: resolved.result.id ?? fallback.id,
    path: resolved.result.path || resolved.result.image_path || fallback.path,
    media_type: normalizeMediaType(resolved.result.media_type || resolved.result?.metadata?.media_type, fallback.path),
    status: resolved.result.status || fallback.status,
    metadata: resolved.result.metadata || fallback.metadata,
    local_metadata: resolved.result.local_metadata || fallback.local_metadata,
    cloud_metadata: resolved.result.cloud_metadata || fallback.cloud_metadata,
    image_path: resolved.result.image_path || fallback.path,
    model_id: resolved.result.model_id || null,
    analyzed_at: resolved.result.analyzed_at || null,
    description: resolved.result.description || null,
    ocr: resolved.result.ocr || null,
    error: resolved.result.error || fallback.error,
  };
}

async function downloadMediaToDesktop(details) {
  const imagePath = String(details?.path || details?.image_path || "").trim();
  if (!imagePath) {
    return { ok: false, message: "No file selected." };
  }
  if (!window.desktopAPI?.exportMediaFile) {
    return { ok: false, message: "Desktop API unavailable." };
  }

  const result = await window.desktopAPI.exportMediaFile({ imagePath });
  if (result?.ok) {
    const savedPath = String(result?.path || "").trim();
    setStatus(savedPath ? `Downloaded to ${savedPath}` : "Downloaded to Desktop/Snoolink Lens.");
    return result;
  }

  const message = String(result?.message || "Download failed.");
  setStatus(`Download failed: ${message}`);
  return result;
}

async function downloadMediaFromSearchResult(row) {
  const imagePath = String(row?.path || row?.image_path || "").trim();
  if (!imagePath) {
    return { ok: false, message: "No file selected." };
  }

  const isTrimmedVideo = String(row?.clip_mode || "") === "matching_timeframe";
  if (!isTrimmedVideo) {
    return downloadMediaToDesktop(row);
  }

  const clipStartSeconds = Number(row?.clip_start_seconds);
  const clipEndSeconds = Number(row?.clip_end_seconds);
  if (!Number.isFinite(clipStartSeconds) || !Number.isFinite(clipEndSeconds) || clipEndSeconds <= clipStartSeconds) {
    return downloadMediaToDesktop(row);
  }

  if (!window.desktopAPI?.exportMediaFile) {
    return { ok: false, message: "Desktop API unavailable." };
  }

  const result = await window.desktopAPI.exportMediaFile({
    imagePath,
    clipStartSeconds,
    clipEndSeconds,
  });
  if (result?.ok) {
    const savedPath = String(result?.path || "").trim();
    setStatus(savedPath ? `Downloaded trimmed clip to ${savedPath}` : "Downloaded trimmed clip.");
    return result;
  }

  const message = String(result?.message || "Download failed.");
  setStatus(`Download failed: ${message}`);
  return result;
}

async function startSingleItemCloudIndex(rowLike) {
  const imagePath = String(rowLike?.path || rowLike?.image_path || "").trim();
  if (!imagePath) {
    return { ok: false, message: "No file selected." };
  }
  if (!window.desktopAPI?.startIndexing) {
    return { ok: false, message: "Indexing APIs unavailable." };
  }

  pendingSingleCloudIndexPath = imagePath;
  const result = window.desktopAPI?.cloudIndexSingleMedia
    ? await window.desktopAPI.cloudIndexSingleMedia(imagePath)
    : await window.desktopAPI.startIndexing({
      files: [imagePath],
      mode: "cloud",
    });

  if (!result?.ok) {
    pendingSingleCloudIndexPath = "";
    return {
      ok: false,
      message: String(result?.message || "Could not start cloud indexing."),
    };
  }

  const name = imagePath.split(/[/\\]/).pop() || imagePath;
  const message = `Cloud indexing started for ${name}.`;
  setStatus(message);
  pushLog(indexLogs, message);
  return { ok: true, message };
}

const imagePreviewPanel = createImagePreviewPanel({
  normalizeImageSrc,
  resolvePreviewSrc: async (imagePath, mediaType = "image", details = null) => {
    const previewApi = window.desktopAPI?.getMediaPreviewSrc || window.desktopAPI?.getImagePreviewSrc;
    if (!previewApi) {
      return {
        ok: true,
        previewSrc: normalizeImageSrc(imagePath),
        converted: false,
      };
    }

    const clipStartSeconds = Number(details?.clip_start_seconds);
    const clipEndSeconds = Number(details?.clip_end_seconds);
    return previewApi({
      imagePath,
      mediaType,
      clipStartSeconds: Number.isFinite(clipStartSeconds) ? clipStartSeconds : undefined,
      clipEndSeconds: Number.isFinite(clipEndSeconds) ? clipEndSeconds : undefined,
    });
  },
  resolveDetails: resolveImageDetails,
  onOpenSourceFolder: async (imagePath) => {
    if (!window.desktopAPI?.openOriginalSourceFolder) {
      return { ok: false, message: "Desktop API unavailable." };
    }
    return window.desktopAPI.openOriginalSourceFolder(imagePath);
  },
  onCopyText: async (text) => {
    if (window.desktopAPI?.copyText) {
      return window.desktopAPI.copyText(text);
    }

    try {
      await navigator.clipboard.writeText(text);
      return { ok: true };
    } catch (error) {
      return { ok: false, message: String(error?.message || error) };
    }
  },
  onExport: async (details) => {
    return downloadMediaFromSearchResult(details);
  },
  onCloudIndex: async (details) => {
    return startSingleItemCloudIndex(details);
  },
  onDelete: async (details) => {
    const imagePath = String(details?.path || details?.image_path || "").trim();
    if (!imagePath) {
      return { ok: false, message: "No file selected." };
    }

    const confirmed = window.confirm("Move this file to recycle bin?");
    if (!confirmed) {
      return { ok: false, message: "Cancelled." };
    }

    if (!window.desktopAPI?.deleteMediaFile) {
      return { ok: false, message: "Desktop API unavailable." };
    }

    const result = await window.desktopAPI.deleteMediaFile({ imagePath });
    if (result?.ok) {
      previewRows = previewRows.filter((row) => String(row?.path || row?.image_path || "") !== imagePath);
      activePreviewPath = "";
      await refreshResultsForCurrentControls();
    }
    return result;
  },
  onAddToAlbum: async (details) => {
    try {
      const imagePath = String(details?.path || details?.image_path || "").trim();
      if (!imagePath) {
        return { ok: false, message: "No file selected." };
      }
      if (!window.desktopAPI?.assignImagesToAlbums) {
        return { ok: false, message: "Album APIs unavailable." };
      }

      const promptFn = typeof window.prompt === "function" ? window.prompt.bind(window) : null;
      if (!promptFn) {
        return { ok: false, message: "Prompt is unavailable in this window." };
      }

      const albums = Array.isArray(albumsState.albums) ? albumsState.albums : [];
      const options = albums.map((album) => `${album.id}: ${album.name}`).join("\n");
      const promptText = albums.length > 0
        ? `Add this item to album(s).\nEnter album id(s), comma-separated.\nOptional: append |New Album Name\n\nExamples:\n1\n1,2\n1|Vacation Clips\n\nAvailable albums:\n${options}`
        : "No albums found. Enter a new album name:";
      const selected = String(promptFn(promptText, "") || "").trim();
      if (!selected) {
        return { ok: false, message: "Cancelled." };
      }

      const [idsPart, createPart] = selected.split("|");
      const albumIds = String(idsPart || "")
        .split(",")
        .map((value) => {
          const match = String(value || "").trim().match(/^(\d+)/);
          return match ? Number(match[1]) : Number.NaN;
        })
        .filter((value) => Number.isFinite(value));
      const createAlbumName = String(createPart || "").trim();

      if (albumIds.length === 0 && !createAlbumName) {
        if (albums.length === 0 && selected) {
          const createOnly = await window.desktopAPI.assignImagesToAlbums({
            imagePaths: [imagePath],
            albumIds: [],
            createAlbumName: selected,
          });
          if (createOnly?.ok) {
            await loadAlbums();
          }
          return createOnly;
        }
        return { ok: false, message: "Please enter at least one album id or a new album name." };
      }

      const assign = await window.desktopAPI.assignImagesToAlbums({
        imagePaths: [imagePath],
        albumIds,
        createAlbumName,
      });
      if (assign?.ok) {
        await loadAlbums();
        return {
          ...assign,
          message: `Added to ${assign?.albumIds?.length || albumIds.length || 1} album(s).`,
        };
      }
      return assign;
    } catch (error) {
      return { ok: false, message: String(error?.message || error) };
    }
  },
  onShareLink: async (details) => {
    const imagePath = String(details?.path || details?.image_path || "").trim();
    if (!imagePath) {
      return { ok: false, message: "No file selected." };
    }
    if (window.desktopAPI?.copyText) {
      return window.desktopAPI.copyText(imagePath);
    }
    try {
      await navigator.clipboard.writeText(imagePath);
      return { ok: true };
    } catch (error) {
      return { ok: false, message: String(error?.message || error) };
    }
  },
  onNavigate: (direction) => {
    if (!Array.isArray(previewRows) || previewRows.length === 0) {
      return;
    }

    const currentIndex = previewRows.findIndex((row) => String(row?.path || row?.image_path || "") === activePreviewPath);
    const fallbackIndex = currentIndex >= 0 ? currentIndex : 0;
    const delta = direction === "prev" ? -1 : 1;
    const nextIndex = Math.max(0, Math.min(previewRows.length - 1, fallbackIndex + delta));
    const nextRow = previewRows[nextIndex];
    if (!nextRow) {
      return;
    }
    activePreviewPath = String(nextRow?.path || nextRow?.image_path || "");
    void imagePreviewPanel.openForRow(nextRow, previewRows.length);
  },
  setStatus,
});

function renderResults(results, options = {}) {
  const isWelcome = Boolean(options.isWelcome);
  const append = Boolean(options.append);

  if (!append) {
    clearResults();
  }

  if (results.length > 0 || append) {
    searchAligner.classList.add("searching");
  }

  const existingCards = append ? resultsEl.querySelectorAll(".search-result").length : 0;

  if (!append) {
    previewRows = [];
  }

  for (let i = 0; i < results.length; i++) {
    const row = {
      ...results[i],
      _index: existingCards + i + 1,
    };
    const imagePath = String(row.path || row.image_path || "").trim();
    const mediaType = normalizeMediaType(row?.media_type || row?.metadata?.media_type, imagePath);
    const node = cardTemplate.content.cloneNode(true);
    const title = row.metadata?.title || `Untitled ${mediaType}`;
    const desc = row.metadata?.description || "No description";
    const tags = Array.isArray(row.metadata?.tags) ? row.metadata.tags.join(", ") : "";
    const objects = Array.isArray(row.metadata?.objects) ? row.metadata.objects.join(", ") : "";
    const isTimeframeClip = String(row?.clip_mode || "") === "matching_timeframe";
    const clipStartSeconds = Number(row?.clip_start_seconds);
    const clipEndSeconds = Number(row?.clip_end_seconds);

    node.querySelector(".title").textContent = title;
    node.querySelector(".score").textContent = isWelcome ? "Library" : `Score: ${Number(row.score || 0).toFixed(3)}`;
    node.querySelector(".desc").textContent = desc;
    node.querySelector(".tags").textContent = tags ? `Tags: ${tags}` : "";
    node.querySelector(".objects").textContent = objects ? `Objects: ${objects}` : "";
    node.querySelector(".path").textContent = row.path || row.image_path || "";

    const img = node.querySelector(".search-result-background");
    const card = node.querySelector(".search-result");
    card.dataset.mediaType = mediaType;
    if (isTimeframeClip && Number.isFinite(clipStartSeconds) && Number.isFinite(clipEndSeconds)) {
      card.dataset.clipStartSeconds = String(clipStartSeconds);
      card.dataset.clipEndSeconds = String(clipEndSeconds);

      const clipPill = document.createElement("span");
      clipPill.className = "result-timeframe-pill";
      clipPill.textContent = `Clip ${formatSecondsLabel(clipStartSeconds)} - ${formatSecondsLabel(clipEndSeconds)}`;
      const infoEl = node.querySelector(".search-result-info");
      if (infoEl) {
        infoEl.insertBefore(clipPill, infoEl.querySelector(".desc") || null);
      }
    }

    if (isWelcome) {
      const stage = String(row.indexing_stage || "none");
      const badge = document.createElement("span");
      badge.className = `indexing-stage-badge stage-${stage}`;

      if (stage === "full") {
        badge.textContent = "✅ Full";
        badge.title = "Full indexing complete (local + cloud).";
      } else if (stage === "local") {
        badge.textContent = "🧠 Local";
        badge.title = "Local indexing complete only.";
      } else {
        badge.textContent = "⏳ None";
        badge.title = "No indexing yet.";
      }

      card.appendChild(badge);
    }

    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `Open ${mediaType} preview for ${title}`);
    card.draggable = Boolean(imagePath);
    if (imagePath) {
      card.dataset.imagePath = imagePath;
    }

    const selectCheckbox = document.createElement("input");
    selectCheckbox.type = "checkbox";
    selectCheckbox.className = "result-select-checkbox";
    selectCheckbox.title = "Select item";
    selectCheckbox.checked = imagePath ? selectedImagePaths.has(imagePath) : false;
    selectCheckbox.addEventListener("click", (event) => {
      event.stopPropagation();
    });
    selectCheckbox.addEventListener("change", () => {
      if (!imagePath) {
        return;
      }
      if (selectCheckbox.checked) {
        selectedImagePaths.add(imagePath);
        card.classList.add("selected");
      } else {
        selectedImagePaths.delete(imagePath);
        card.classList.remove("selected");
      }
      updateAlbumActionButtons();
    });
    card.appendChild(selectCheckbox);

    if (selectCheckbox.checked) {
      card.classList.add("selected");
    }

    const downloadBtn = document.createElement("button");
    downloadBtn.type = "button";
    downloadBtn.className = "result-download-btn";
    downloadBtn.title = "Download original file";
    downloadBtn.setAttribute("aria-label", `Download ${title}`);
    downloadBtn.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M12 3v10" />
        <path d="m7 10 5 5 5-5" />
        <path d="M5 20h14" />
      </svg>
    `;
    downloadBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void downloadMediaFromSearchResult(row);
    });
    downloadBtn.addEventListener("keydown", (event) => {
      event.stopPropagation();
    });
    card.appendChild(downloadBtn);

    const cloudIndexBtn = document.createElement("button");
    cloudIndexBtn.type = "button";
    cloudIndexBtn.className = "result-cloud-index-btn";
    cloudIndexBtn.title = "Cloud index this item";
    cloudIndexBtn.setAttribute("aria-label", `Cloud index ${title}`);
    cloudIndexBtn.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M7 18h9a4 4 0 0 0 0-8 5 5 0 0 0-9.5-1.5A3.5 3.5 0 0 0 7 18z" />
        <path d="M12 10v7" />
        <path d="m9.5 14 2.5 3 2.5-3" />
      </svg>
    `;
    cloudIndexBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void startSingleItemCloudIndex(row);
    });
    cloudIndexBtn.addEventListener("keydown", (event) => {
      event.stopPropagation();
    });
    card.appendChild(cloudIndexBtn);

    card.addEventListener("click", () => {
      activePreviewPath = imagePath;
      void imagePreviewPanel.openForRow(row, previewRows.length);
    });
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        activePreviewPath = imagePath;
        void imagePreviewPanel.openForRow(row, previewRows.length);
      }
    });

    card.addEventListener("dragstart", (event) => {
      if (!imagePath) {
        return;
      }
      event.dataTransfer?.setData("text/plain", imagePath);
      event.dataTransfer?.setData("application/x-snoolink-image-path", imagePath);
      event.dataTransfer.effectAllowed = "copy";
    });

    trackResultCardMedia(card, img, imagePath, row.preview_src);

    // Staggered reveal animation
    const delay = (existingCards + i) * 24 + Math.floor(Math.random() * 30);
    setTimeout(() => {
      card.classList.add("visible");
    }, delay);

    previewRows.push(row);
    resultsEl.appendChild(node);
  }

  updateDownloadTopResultsButtonState();
}

async function loadMoreWelcomeGallery() {
  if (!window.desktopAPI?.getMasterDirectory) {
    return;
  }

  if (!welcomeGalleryState.active || welcomeGalleryState.loading || !welcomeGalleryState.hasMore) {
    return;
  }

  welcomeGalleryState.loading = true;

  try {
    const filtersPayload = buildFiltersPayload();
    const result = await window.desktopAPI.getMasterDirectory({
      offset: welcomeGalleryState.offset,
      limit: WELCOME_GALLERY_PAGE_SIZE,
      filters: filtersPayload,
      deferPreviewResolution: true,
      randomize: true,
      randomSeed: welcomeGalleryState.randomSeed,
    });

    if (!result?.ok) {
      setStatus("Ready - choose a metadata file or run a search.");
      countsEl.textContent = "";
      clearResults();
      welcomeGalleryState.active = false;
      welcomeGalleryState.hasMore = false;
      return;
    }

    let masterItems = Array.isArray(result.items) ? result.items : [];
    let total = Number(result.total || 0);

    welcomeGalleryState.total = total;

    if (masterItems.length === 0 && welcomeGalleryState.offset === 0) {
      if (hasActiveGalleryFilters(filtersPayload)) {
        setStatus("No gallery results match the current filters.");
      } else {
        setStatus("Welcome - no scanned images yet. Run a scan to build your gallery.");
      }
      countsEl.textContent = "";
      clearResults();
      welcomeGalleryState.hasMore = false;
      return;
    }

    const galleryRows = masterItems.map((item) => ({
      score: 0,
      path: item.path,
      media_type: item.media_type || "image",
      preview_src: item.preview_src || "",
      indexing_stage: item.indexing_stage || "none",
      metadata: item.metadata || {
        title: item.name || "Untitled media",
        description: item.directory || "",
        tags: [],
        objects: [],
        media_type: item.media_type || "image",
      },
    }));

    renderResults(galleryRows, { isWelcome: true, append: welcomeGalleryState.offset > 0 });
    welcomeGalleryCache.rows = welcomeGalleryState.offset > 0
      ? [...welcomeGalleryCache.rows, ...galleryRows]
      : [...galleryRows];
    welcomeGalleryState.offset += masterItems.length;
    welcomeGalleryState.hasMore = Boolean(result.hasMore);
    welcomeGalleryCache.total = total;
    welcomeGalleryCache.hasMore = welcomeGalleryState.hasMore;
    welcomeGalleryCache.generatedAt = String(result?.generatedAt || "");
    welcomeGalleryCache.ready = true;
    welcomeGalleryCache.randomSeed = welcomeGalleryState.randomSeed;

    setStatus(
      welcomeGalleryState.hasMore
        ? "Welcome - scroll to load more of your scanned gallery."
        : "Welcome - gallery fully loaded.",
    );
    updateWelcomeCounts();
  } finally {
    welcomeGalleryState.loading = false;
  }
}

function maybeLoadMoreWelcomeGallery() {
  if (!welcomeGalleryState.active || scanUiState.hasSearchRun) {
    return;
  }

  if (welcomeGalleryState.loading || !welcomeGalleryState.hasMore) {
    return;
  }

  const nearBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 700;
  if (nearBottom) {
    void loadMoreWelcomeGallery();
  }
}

async function loadWelcomeGalleryFromMasterDirectory(options = {}) {
  if (!window.desktopAPI?.getMasterDirectory) {
    return;
  }

  if (options?.preferCached === true && welcomeGalleryCache.ready && welcomeGalleryCache.rows.length > 0) {
    welcomeGalleryState.offset = welcomeGalleryCache.rows.length;
    welcomeGalleryState.total = welcomeGalleryCache.total;
    welcomeGalleryState.hasMore = welcomeGalleryCache.hasMore;
    welcomeGalleryState.loading = false;
    welcomeGalleryState.active = true;
    welcomeGalleryState.randomSeed = Number(welcomeGalleryCache.randomSeed || 0);

    clearResults();
    renderResults(welcomeGalleryCache.rows, { isWelcome: true, append: false });
    setStatus(
      welcomeGalleryState.hasMore
        ? "Welcome - scroll to load more of your scanned gallery."
        : "Welcome - gallery fully loaded.",
    );
    updateWelcomeCounts();
    return;
  }

  welcomeGalleryState.offset = 0;
  welcomeGalleryState.total = 0;
  welcomeGalleryState.hasMore = true;
  welcomeGalleryState.loading = false;
  welcomeGalleryState.active = true;
  welcomeGalleryState.randomSeed = Math.floor(Math.random() * 0x7fffffff) + 1;
  clearWelcomeGalleryCache();

  clearResults();
  setStatus("Loading gallery...");
  countsEl.textContent = "";
  await loadMoreWelcomeGallery();
}

async function validateFile() {
  const filePath = filePathInput.value.trim();
  if (!filePath) {
    resetValidationState();
    setStatus("Choose metadata JSON first.");
    return false;
  }

  if (validationState.filePath !== filePath) {
    resetValidationState();
    validationState.filePath = filePath;
  }

  if (validationState.result) {
    const result = validationState.result;
    if (!result.ok) {
      setStatus(`Validation failed: ${result.message}`);
      countsEl.textContent = "";
      return false;
    }

    setStatus("Metadata loaded (cached).");
    countsEl.textContent = `total=${result.total} | searchable=${result.okCount} | model=${result.model}`;
    return true;
  }

  if (!validationState.pending) {
    setStatus("Validating metadata file...");
    validationState.pending = window.desktopAPI.validateMetadataFile(filePath);
  } else {
    setStatus("Validation already in progress...");
  }

  const result = await validationState.pending;
  validationState.pending = null;
  validationState.result = result;

  if (!result.ok) {
    setStatus(`Validation failed: ${result.message}`);
    countsEl.textContent = "";
    return false;
  }

  if (result.filePath) {
    filePathInput.value = result.filePath;
  }

  setStatus("Metadata loaded.");
  countsEl.textContent = `total=${result.total} | searchable=${result.okCount} | model=${result.model}`;
  return true;
}

async function initializeDefaultMetadataFile() {
  if (!window.desktopAPI?.getDefaultMetadataFile) {
    return;
  }

  const result = await window.desktopAPI.getDefaultMetadataFile();
  if (!result?.ok || !result.filePath) {
    return;
  }

  filePathInput.value = result.filePath;
  resetValidationState();
  await validateFile();
}

async function doSearch() {
  const searchRunId = ++latestSearchRunId;
  const ready = await validateFile();
  if (!ready) {
    return;
  }

  welcomeGalleryState.active = false;
  scanUiState.hasSearchRun = true;

  const albumFromQuery = extractAlbumIdsFromQuery(queryInput.value.trim());
  if (!albumFromQuery.cleanedQuery) {
    scanUiState.hasSearchRun = false;
    await refreshResultsForCurrentControls();
    return;
  }

  const filtersPayload = buildFiltersPayload();
  const mergedAlbumIds = Array.from(
    new Set([
      ...(Array.isArray(filtersPayload.albumIds) ? filtersPayload.albumIds : []),
      ...albumFromQuery.albumIds,
    ]),
  );

  const payload = {
    filePath: filePathInput.value.trim(),
    query: albumFromQuery.cleanedQuery,
    topK: Number(topKInput.value || 20),
    minScore: Number(userSettingsState.minMatchScore || 0.001),
    videoResultMode: normalizeVideoSearchResultMode(userSettingsState.videoSearchResultMode),
    filters: {
      ...filtersPayload,
      albumIds: mergedAlbumIds,
    },
  };

  setStatus("Searching...");
  scanUiState.hasSearchRun = true;
  const result = await window.desktopAPI.semanticSearch(payload);

  if (searchRunId !== latestSearchRunId) {
    return;
  }

  if (!result.ok) {
    setStatus(`Search failed: ${result.message}`);
    return;
  }

  setStatus("Search complete.");
  countsEl.textContent = `filtered=${result.filteredCount} | shown=${result.results.length}`;
  renderResults(result.results);
}

if (downloadTopResultsBtn) {
  downloadTopResultsBtn.addEventListener("click", async () => {
    if (bulkDownloadInProgress) {
      return;
    }

    const rows = getSearchDownloadRows();
    if (rows.length === 0) {
      setStatus("No search results available to download.");
      updateDownloadTopResultsButtonState();
      return;
    }

    const cappedRows = rows.slice(0, MAX_BULK_DOWNLOAD_RESULTS);
    bulkDownloadInProgress = true;
    updateDownloadTopResultsButtonState();

    let successCount = 0;
    let failedCount = 0;

    try {
      for (let i = 0; i < cappedRows.length; i += 1) {
        setStatus(`Downloading ${i + 1}/${cappedRows.length}...`);
        const result = await downloadMediaFromSearchResult(cappedRows[i]);
        if (result?.ok) {
          successCount += 1;
        } else {
          failedCount += 1;
        }
      }

      if (failedCount > 0) {
        setStatus(`Bulk download complete. Success: ${successCount}, Failed: ${failedCount}.`);
      } else {
        setStatus(`Bulk download complete. Downloaded ${successCount} item(s).`);
      }
    } finally {
      bulkDownloadInProgress = false;
      updateDownloadTopResultsButtonState();
    }
  });
}

async function refreshResultsForCurrentControls() {
  const filtersPayload = buildFiltersPayload();
  const albumFromQuery = extractAlbumIdsFromQuery(queryInput.value.trim());
  const hasQuery = Boolean(albumFromQuery.cleanedQuery);
  const shouldRunSearch = scanUiState.hasSearchRun || hasQuery;

  if (shouldRunSearch) {
    await doSearch();
    return;
  }

  if (isValidAlbumId(albumsState.activeAlbumId)) {
    await loadAlbumView(albumsState.activeAlbumId);
    return;
  }

  await loadWelcomeGalleryFromMasterDirectory();
}

pickFileBtn.addEventListener("click", async () => {
  try {
    if (!window.desktopAPI?.pickMetadataFile) {
      setStatus("Desktop API unavailable. Launch the app with Electron (npm start).");
      return;
    }

    const result = await window.desktopAPI.pickMetadataFile();
    if (result.ok && result.filePath) {
      filePathInput.value = result.filePath;
      resetValidationState();
      setStatus("File selected.");
      return;
    }

    if (result?.message) {
      setStatus(result.message);
    }
  } catch (error) {
    setStatus(`Could not open file chooser: ${String(error?.message || error)}`);
  }
});

validateBtn.addEventListener("click", async () => {
  await validateFile();
});

searchBtn.addEventListener("click", async () => {
  await doSearch();
});

filePathInput.addEventListener("input", () => {
  resetValidationState();
});

queryInput.addEventListener("keydown", async (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    await doSearch();
  }
});

if (toggleFiltersBtn && filtersShell) {
  toggleFiltersBtn.addEventListener("click", () => {
    const expanded = toggleFiltersBtn.getAttribute("aria-expanded") === "true";
    setFiltersExpanded(!expanded);
  });

  setFiltersExpanded(Boolean(userSettingsState.autoExpandFilters));
}

if (clearAllFiltersBtn) {
  clearAllFiltersBtn.addEventListener("click", async () => {
    resetSearchControlsToDefaults();
    await refreshResultsForCurrentControls();
  });
}

if (saveUserSettingsBtn) {
  saveUserSettingsBtn.addEventListener("click", async () => {
    try {
      if (!window.desktopAPI?.saveUserSettings) {
        setStatus("Settings API unavailable. Restart the app.");
        return;
      }

      const minMatchScoreInputValue = Number(settingsMinMatchScoreInput?.value);
      userSettingsState.minMatchScore = Number.isFinite(minMatchScoreInputValue)
        ? Math.max(0, minMatchScoreInputValue)
        : 0.001;
      userSettingsState.uiTheme = normalizeUiTheme(settingsUiThemeSelect?.value);
      userSettingsState.resultsDensity = normalizeResultsDensity(settingsResultsDensitySelect?.value);
      userSettingsState.autoExpandFilters = Boolean(settingsAutoExpandFiltersInput?.checked);
      userSettingsState.autoCloseSidebarOnSettingsNav = Boolean(
        settingsAutoCloseSidebarOnSettingsNavInput?.checked,
      );
      userSettingsState.galleryVideoAutoplay = Boolean(settingsGalleryVideoAutoplayInput?.checked);
      userSettingsState.cacheTranscodedMovPreview = Boolean(settingsCacheTranscodedMovPreviewInput?.checked);
      userSettingsState.cacheTranscodedHeicPreview = Boolean(settingsCacheTranscodedHeicPreviewInput?.checked);
      userSettingsState.cacheTranscodedHeifPreview = Boolean(settingsCacheTranscodedHeifPreviewInput?.checked);
      userSettingsState.videoSearchResultMode = normalizeVideoSearchResultMode(
        settingsVideoSearchResultModeSelect?.value,
      );
      userSettingsState.enableFaceIndexing = Boolean(settingsEnableFaceIndexingInput?.checked);
      userSettingsState.faceModelVersion = String(settingsFaceModelVersionInput?.value || "face-api-ssd-v1").trim() || "face-api-ssd-v1";
      const faceMinConfidenceInputValue = Number(settingsFaceMinConfidenceInput?.value);
      userSettingsState.faceMinDetectionConfidence = Number.isFinite(faceMinConfidenceInputValue)
        ? Math.max(0, Math.min(1, faceMinConfidenceInputValue))
        : 0.6;
      const faceMinQualityInputValue = Number(settingsFaceMinQualityInput?.value);
      userSettingsState.faceMinQualityScore = Number.isFinite(faceMinQualityInputValue)
        ? Math.max(0, Math.min(1, faceMinQualityInputValue))
        : 0.45;
      const faceClusterThresholdInputValue = Number(settingsFaceClusterDistanceThresholdInput?.value);
      userSettingsState.faceClusterDistanceThreshold = Number.isFinite(faceClusterThresholdInputValue)
        ? Math.max(0.05, Math.min(1, faceClusterThresholdInputValue))
        : 0.35;

      const result = await window.desktopAPI.saveUserSettings({
        enabledFilters: userSettingsState.enabledFilters,
        user_name: settingsUserNameInput?.value || "",
        user_password: settingsUserPasswordInput?.value || "",
        aws_region: settingsAwsRegionInput?.value || "us-east-1",
        aws_key: settingsAwsKeyInput?.value || "",
        secret_key: settingsAwsSecretInput?.value || "",
        model: settingsBedrockModelInput?.value || "qwen.qwen3-vl-235b-a22b",
        twelvelabs_api_key: settingsTwelveLabsApiKeyInput?.value || "",
        min_match_score: userSettingsState.minMatchScore,
        ui_theme: userSettingsState.uiTheme,
        results_density: userSettingsState.resultsDensity,
        auto_expand_filters: userSettingsState.autoExpandFilters,
        auto_close_sidebar_on_settings_nav: userSettingsState.autoCloseSidebarOnSettingsNav,
        gallery_video_autoplay: userSettingsState.galleryVideoAutoplay,
        cache_transcoded_mov_preview: userSettingsState.cacheTranscodedMovPreview,
        cache_transcoded_heic_preview: userSettingsState.cacheTranscodedHeicPreview,
        cache_transcoded_heif_preview: userSettingsState.cacheTranscodedHeifPreview,
        video_search_result_mode: userSettingsState.videoSearchResultMode,
        enable_face_indexing: userSettingsState.enableFaceIndexing,
        face_model_version: userSettingsState.faceModelVersion,
        face_min_detection_confidence: userSettingsState.faceMinDetectionConfidence,
        face_min_quality_score: userSettingsState.faceMinQualityScore,
        face_cluster_distance_threshold: userSettingsState.faceClusterDistanceThreshold,
      });
      if (!result?.ok) {
        setStatus(`Could not save settings: ${String(result?.message || "Unknown error")}`);
        return;
      }
      await syncHomepageFiltersFromSavedSettings();
      setStatus("Settings saved.");
    } catch (error) {
      setStatus(`Could not save settings: ${String(error?.message || error)}`);
    }
  });
}

if (reloadUserSettingsBtn) {
  reloadUserSettingsBtn.addEventListener("click", async () => {
    await syncHomepageFiltersFromSavedSettings();
    setStatus("Settings reloaded.");
  });
}

if (backupAppDataBtn) {
  backupAppDataBtn.addEventListener("click", async () => {
    try {
      if (!window.desktopAPI?.backupAppData) {
        setStatus("Backup API unavailable. Restart the app.");
        return;
      }

      setStatus("Preparing manual backup...");
      const result = await window.desktopAPI.backupAppData();
      if (result?.cancelled) {
        setStatus("Backup cancelled.");
        return;
      }

      if (!result?.ok) {
        setStatus(`Backup failed: ${String(result?.message || "Unknown error")}`);
        return;
      }

      const backupDir = String(result?.backupDir || "").trim();
      const requiredMissing = Number(result?.requiredFilesMissing?.length || 0);
      if (requiredMissing > 0) {
        setStatus(`Backup completed with missing metadata files. Folder: ${backupDir}`);
      } else {
        setStatus(`Backup completed. Folder: ${backupDir}`);
      }
    } catch (error) {
      setStatus(`Backup failed: ${String(error?.message || error)}`);
    }
  });
}

if (settingsFaceClusterSelect) {
  settingsFaceClusterSelect.addEventListener("change", () => {
    updateFaceClusterLabelInputFromSelection();
  });
}

if (settingsSaveFaceClusterLabelBtn) {
  settingsSaveFaceClusterLabelBtn.addEventListener("click", async () => {
    try {
      if (!window.desktopAPI?.setFaceClusterLabel) {
        setFaceClusterStatus("People group naming is unavailable right now.");
        return;
      }
      const clusterId = String(settingsFaceClusterSelect?.value || "").trim();
      if (!clusterId) {
        setFaceClusterStatus("Select a people group first.");
        return;
      }

      const personLabel = String(settingsFaceClusterLabelInput?.value || "").trim();
      const result = await window.desktopAPI.setFaceClusterLabel({ clusterId, personLabel });
      if (!result?.ok) {
        setFaceClusterStatus(`Could not save person name: ${String(result?.message || "Unknown error")}`);
        return;
      }

      await loadFaceClustersForSettings();
      await loadLocalFilterOptionsFromBackend();
      setFaceClusterStatus(`Saved name for group ${clusterId}. Updated ${Number(result.updatedFaceCount || 0)} face(s).`);
      if (scanUiState.hasSearchRun) {
        await refreshResultsForCurrentControls();
      }
    } catch (error) {
      setFaceClusterStatus(`Could not save person name: ${String(error?.message || error)}`);
    }
  });
}

if (settingsRebuildFaceClustersBtn) {
  settingsRebuildFaceClustersBtn.addEventListener("click", async () => {
    try {
      if (!window.desktopAPI?.rebuildFaceClusters) {
        setFaceClusterStatus("Rebuild is unavailable right now.");
        return;
      }

      setFaceClusterStatus("Rebuilding people groups...");
      const result = await window.desktopAPI.rebuildFaceClusters();
      if (!result?.ok) {
        setFaceClusterStatus(`Could not rebuild people groups: ${String(result?.message || "Unknown error")}`);
        return;
      }

      await loadFaceClustersForSettings();
      await loadLocalFilterOptionsFromBackend();
      setFaceClusterStatus(`Rebuilt ${Number(result.clusterCount || 0)} people group(s) across ${Number(result.totalFaces || 0)} faces.`);
      if (scanUiState.hasSearchRun) {
        await refreshResultsForCurrentControls();
      }
    } catch (error) {
      setFaceClusterStatus(`Could not rebuild people groups: ${String(error?.message || error)}`);
    }
  });
}

if (openAppSettingsLink) {
  openAppSettingsLink.addEventListener("click", (event) => {
    event.preventDefault();
    showSettingsScreen();
    if (userSettingsState.autoCloseSidebarOnSettingsNav) {
      closeSidebar();
    }
  });
}

if (openFacesWorkspaceBtn) {
  openFacesWorkspaceBtn.addEventListener("click", async () => {
    showFacesScreen();
    await loadFaceClustersForSettings();
    if (userSettingsState.autoCloseSidebarOnSettingsNav) {
      closeSidebar();
    }
  });
}

if (openWizardWorkspaceBtn) {
  openWizardWorkspaceBtn.addEventListener("click", () => {
    showWizardScreen();
    if (userSettingsState.autoCloseSidebarOnSettingsNav) {
      closeSidebar();
    }
  });
}

window.addEventListener("message", (event) => {
  try {
    const fromWizardFrame = Boolean(wizardSearchFrame?.contentWindow)
      && event.source === wizardSearchFrame.contentWindow;
    if (!fromWizardFrame) {
      return;
    }

    const payload = event?.data && typeof event.data === "object" ? event.data : null;
    if (!payload || payload.type !== "wizard-search-clip") {
      return;
    }

    const query = String(payload.query || "").trim();
    const clipLabel = String(payload.clipLabel || "").trim();

    if (!query) {
      setStatus("Wizard search request was empty.");
      return;
    }

    showHomeScreen();
    if (queryInput) {
      queryInput.value = query;
    }
    if (mediaTypeSelect) {
      mediaTypeSelect.value = "video";
    }
    userSettingsState.videoSearchResultMode = "matching_timeframes";
    if (settingsVideoSearchResultModeSelect) {
      settingsVideoSearchResultModeSelect.value = "matching_timeframes";
    }
    if (topKInput) {
      topKInput.value = "30";
    }

    setStatus(`Searching ${clipLabel || "selected clip"} for best matching video frames...`);
    void doSearch();
  } catch (error) {
    setStatus(`Could not run Wizard search: ${String(error?.message || error)}`);
  }
});

if (openReelAnalyzerBtn) {
  openReelAnalyzerBtn.addEventListener("click", () => {
    showReelAnalyzerScreen();
    if (userSettingsState.autoCloseSidebarOnSettingsNav) {
      closeSidebar();
    }
  });
}

if (facesRefreshBtn) {
  facesRefreshBtn.addEventListener("click", async () => {
    setFacesWorkspaceStatus("Refreshing people groups...");
    await loadFaceClustersForSettings();
  });
}

if (facesRebuildBtn) {
  facesRebuildBtn.addEventListener("click", async () => {
    if (!window.desktopAPI?.rebuildFaceClusters) {
      setFacesWorkspaceStatus("Rebuild is unavailable right now.");
      return;
    }
    setFacesWorkspaceStatus("Rebuilding people groups...");
    const result = await window.desktopAPI.rebuildFaceClusters();
    if (!result?.ok) {
      setFacesWorkspaceStatus(`Could not rebuild people groups: ${String(result?.message || "Unknown error")}`);
      return;
    }
    await loadFaceClustersForSettings();
    await loadLocalFilterOptionsFromBackend();
    setFacesWorkspaceStatus(`Rebuilt ${Number(result.clusterCount || 0)} people group(s) across ${Number(result.totalFaces || 0)} faces.`);
  });
}

if (backToHomeBtn) {
  backToHomeBtn.addEventListener("click", async () => {
    await restoreLaunchHomeState();
  });
}

if (sidebarHomeBtn) {
  sidebarHomeBtn.addEventListener("click", async () => {
    await restoreLaunchHomeState();
  });
}

if (newAlbumBtn) {
  newAlbumBtn.addEventListener("click", async () => {
    if (!window.desktopAPI?.createAlbum || !window.desktopAPI?.assignImagesToAlbums) {
      setStatus("Albums API unavailable. Restart the app to reload preload bridge.");
      return;
    }

    const name = window.prompt("Album name");
    if (!name || !name.trim()) {
      return;
    }
    const trimmedName = name.trim();
    const selectedPaths = Array.from(selectedImagePaths);

    const createResult = await window.desktopAPI.createAlbum({ name: trimmedName });
    if (!createResult?.ok) {
      setStatus(`Could not create album: ${String(createResult?.message || "Unknown error")}`);
      return;
    }

    const createdAlbumId = Number(createResult?.album?.id);
    if (!Number.isFinite(createdAlbumId)) {
      setStatus("Album created but could not resolve album id.");
      await loadAlbums();
      return;
    }

    let assignmentMessage = "";
    if (selectedPaths.length > 0) {
      const assignResult = await window.desktopAPI.assignImagesToAlbums({
        imagePaths: selectedPaths,
        albumIds: [createdAlbumId],
      });
      if (!assignResult?.ok) {
        setStatus(`Album created, but image assignment failed: ${String(assignResult?.message || "Unknown error")}`);
        await loadAlbums();
        return;
      }
      assignmentMessage = ` and added ${assignResult.assignedCount} selected image(s)`;
      selectedImagePaths.clear();
      updateAlbumActionButtons();
    } else {
      assignmentMessage = " (no selected images to add)";
    }

    const createdLabel = createResult?.alreadyExists ? "Album already exists" : "Album created";
    setStatus(`${createdLabel}${assignmentMessage}.`);
    await loadAlbums();
    await loadAlbumView(createdAlbumId);
  });
}

if (albumFilterSelect) {
  albumFilterSelect.addEventListener("change", async () => {
    await refreshResultsForCurrentControls();
  });
}

if (mediaTypeSelect) {
  mediaTypeSelect.addEventListener("change", async () => {
    await refreshResultsForCurrentControls();
  });
}

if (containsPeopleSelect) {
  containsPeopleSelect.addEventListener("change", async () => {
    await refreshResultsForCurrentControls();
  });
}

if (containsTextSelect) {
  containsTextSelect.addEventListener("change", async () => {
    await refreshResultsForCurrentControls();
  });
}

if (ocrTextQueryInput) {
  ocrTextQueryInput.addEventListener("change", async () => {
    await refreshResultsForCurrentControls();
  });
  ocrTextQueryInput.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    await refreshResultsForCurrentControls();
  });
}

if (topKInput) {
  topKInput.addEventListener("change", async () => {
    if (!scanUiState.hasSearchRun) {
      return;
    }
    await doSearch();
  });
}

if (addSelectedToAlbumBtn) {
  addSelectedToAlbumBtn.addEventListener("click", async () => {
    if (selectedImagePaths.size === 0) {
      return;
    }

    if (!window.desktopAPI?.assignImagesToAlbums) {
      setStatus("Albums API unavailable. Restart the app to reload preload bridge.");
      return;
    }

    const options = albumsState.albums.map((album) => `${album.id}: ${album.name}`).join("\n");
    const selected = window.prompt(
      albumsState.albums.length > 0
        ? `Enter album id(s) comma-separated to add ${selectedImagePaths.size} image(s):\n${options}\n\nOptionally append |New Album Name\nExamples:\n1\n1,2\n1|Vacation`
        : `No albums found. Enter a new album name to add ${selectedImagePaths.size} image(s):`,
    );
    if (!selected) {
      return;
    }

    const [idsPart, createPart] = selected.split("|");
    const albumIds = String(idsPart || "")
      .split(",")
      .map((value) => {
        const match = String(value || "").trim().match(/^(\d+)/);
        return match ? Number(match[1]) : Number.NaN;
      })
      .filter((value) => Number.isFinite(value));
    const createAlbumName = String(createPart || "").trim();

    if (albumIds.length === 0 && !createAlbumName) {
      if (albumsState.albums.length === 0) {
        const createOnly = String(selected || "").trim();
        if (!createOnly) {
          setStatus("Please provide a new album name.");
          return;
        }
        const createOnlyResult = await window.desktopAPI.assignImagesToAlbums({
          imagePaths: Array.from(selectedImagePaths),
          albumIds: [],
          createAlbumName: createOnly,
        });
        if (!createOnlyResult?.ok) {
          setStatus(`Could not add to album: ${String(createOnlyResult?.message || "Unknown error")}`);
          return;
        }
        setStatus(`Added ${createOnlyResult.assignedCount} image(s) to album(s).`);
        selectedImagePaths.clear();
        updateAlbumActionButtons();
        await loadAlbums();
        if (isValidAlbumId(albumsState.activeAlbumId)) {
          await loadAlbumView(albumsState.activeAlbumId);
        }
        return;
      }

      setStatus("Please enter at least one album id or append |New Album Name.");
      return;
    }

    const result = await window.desktopAPI.assignImagesToAlbums({
      imagePaths: Array.from(selectedImagePaths),
      albumIds,
      createAlbumName,
    });

    if (!result?.ok) {
      setStatus(`Could not add to album: ${String(result?.message || "Unknown error")}`);
      return;
    }

    setStatus(`Added ${result.assignedCount} image(s) to album(s).`);
    selectedImagePaths.clear();
    updateAlbumActionButtons();
    await loadAlbums();
    if (isValidAlbumId(albumsState.activeAlbumId)) {
      await loadAlbumView(albumsState.activeAlbumId);
    }
  });
}

if (removeSelectedFromAlbumBtn) {
  removeSelectedFromAlbumBtn.addEventListener("click", async () => {
    if (!isValidAlbumId(albumsState.activeAlbumId) || selectedImagePaths.size === 0) {
      return;
    }

    const result = await window.desktopAPI.removeImagesFromAlbum({
      albumId: Number(albumsState.activeAlbumId),
      imagePaths: Array.from(selectedImagePaths),
    });

    if (!result?.ok) {
      setStatus(`Could not remove images: ${String(result?.message || "Unknown error")}`);
      return;
    }

    setStatus(`Removed ${result.removedCount} image(s) from album.`);
    selectedImagePaths.clear();
    updateAlbumActionButtons();
    await loadAlbums();
    await loadAlbumView(albumsState.activeAlbumId);
  });
}

if (renameAlbumBtn) {
  renameAlbumBtn.addEventListener("click", async () => {
    const active = getAlbumById(albumsState.activeAlbumId);
    if (!active) {
      return;
    }
    const nextName = window.prompt("Rename album", String(active.name || ""));
    if (!nextName || !nextName.trim()) {
      return;
    }
    const result = await window.desktopAPI.renameAlbum({
      albumId: active.id,
      name: nextName.trim(),
    });
    if (!result?.ok) {
      setStatus(`Could not rename album: ${String(result?.message || "Unknown error")}`);
      return;
    }
    setStatus("Album renamed.");
    await loadAlbums();
    await loadAlbumView(active.id);
  });
}

if (deleteAlbumBtn) {
  deleteAlbumBtn.addEventListener("click", async () => {
    const active = getAlbumById(albumsState.activeAlbumId);
    if (!active) {
      return;
    }
    const confirmed = window.confirm(`Delete album \"${active.name}\"? Images will not be deleted.`);
    if (!confirmed) {
      return;
    }
    const result = await window.desktopAPI.deleteAlbum({ albumId: active.id });
    if (!result?.ok) {
      setStatus(`Could not delete album: ${String(result?.message || "Unknown error")}`);
      return;
    }
    albumsState.activeAlbumId = null;
    selectedImagePaths.clear();
    updateAlbumActionButtons();
    updateAlbumViewMeta(null);
    await loadAlbums();
    await loadWelcomeGalleryFromMasterDirectory();
    setStatus("Album deleted.");
  });
}

window.addEventListener("scroll", maybeLoadMoreWelcomeGallery, { passive: true });
window.addEventListener("resize", maybeLoadMoreWelcomeGallery);

if (openSidebarBtn) {
  openSidebarBtn.addEventListener("click", () => {
    toggleSidebar();
  });
}

if (closeSidebarBtn) {
  closeSidebarBtn.addEventListener("click", () => {
    toggleSidebar();
  });
}

if (sidebarMidToggleBtn) {
  sidebarMidToggleBtn.addEventListener("click", () => {
    toggleSidebar();
  });
}

document.addEventListener("click", (event) => {
  if (!settingsSidebar || settingsSidebar.classList.contains("collapsed")) {
    return;
  }

  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }

  if (settingsSidebar.contains(target)) {
    return;
  }

  if (
    (sidebarMidToggleBtn && sidebarMidToggleBtn.contains(target))
    || (openSidebarBtn && openSidebarBtn.contains(target))
  ) {
    return;
  }

  closeSidebar();
});

const sidebarIconDockButtons = Array.from(document.querySelectorAll("#sidebar-icon-dock [data-section-target]"));
for (const dockButton of sidebarIconDockButtons) {
  dockButton.addEventListener("click", (event) => {
    const sectionTarget = String(event.currentTarget?.getAttribute("data-section-target") || "").trim();
    if (!sectionTarget) {
      return;
    }

    openSidebar();
    if (sectionTarget === "settings-nav-section") {
      showSettingsScreen();
      return;
    }

    if (sectionTarget === "wizard-nav-section") {
      showWizardScreen();
      return;
    }

    if (sectionTarget === "faces-nav-section") {
      showFacesScreen();
      void loadFaceClustersForSettings();
      return;
    }

    jumpToSidebarSection(sectionTarget);
  });
}

scanModeSelect.addEventListener("change", () => {
  updateScanModeVisibility();
});

includeMountedDrivesInput.addEventListener("change", () => {
  updateScanSectionOptionBadges();
});

includeMoreFormatsInput.addEventListener("change", () => {
  updateScanSectionOptionBadges();
});

autoIndexAfterScanInput.addEventListener("change", () => {
  updateScanSectionOptionBadges();
});

pickFoldersBtn.addEventListener("click", async () => {
  const result = await window.desktopAPI.pickCustomFolders();
  if (!result?.ok) {
    setStatus(String(result?.message || "Could not select folders."));
    return;
  }

  scanUiState.customFolders = Array.isArray(result.paths) ? result.paths : [];
  updateCustomFoldersSummary();
  pushLog(scanLogs, `Selected ${scanUiState.customFolders.length} custom folders.`);
});

startFullScanBtn.addEventListener("click", async () => {
  const isCustom = scanModeSelect.value === "custom";
  if (isCustom && scanUiState.customFolders.length === 0) {
    setStatus("Choose at least one custom folder before scanning.");
    return;
  }

  scanUiState.files = [];
  applyScanProgress({ percent: 0, scanned: 0, total: 0, current: "" });
  const selectedScanAlbumIds = scanAlbumsSelect
    ? Array.from(scanAlbumsSelect.selectedOptions)
        .map((option) => Number(option.value))
        .filter((id) => Number.isFinite(id))
    : [];

  const payload = {
    scanMode: scanModeSelect.value,
    customFolders: scanUiState.customFolders,
    includeMountedDrives: includeMountedDrivesInput.checked,
    includeMoreFormats: includeMoreFormatsInput.checked,
    autoIndexAfterScan: autoIndexAfterScanInput.checked,
    scanAlbumIds: selectedScanAlbumIds,
    scanCreateAlbumName: scanCreateAlbumInput?.value || "",
  };

  const result = await window.desktopAPI.startFullScan(payload);
  if (!result?.ok) {
    setStatus(`Could not start scan: ${String(result?.message || "Unknown error")}`);
    return;
  }

  setStatus("Scan started.");
  pushLog(scanLogs, "Scan started.");
});

pauseScanBtn.addEventListener("click", async () => {
  const result = await window.desktopAPI.pauseScan();
  if (!result?.ok) {
    setStatus(String(result?.message || "Could not pause scan."));
    return;
  }
  setStatus("Scan paused.");
  pushLog(scanLogs, "Scan paused.");
});

resumeScanBtn.addEventListener("click", async () => {
  const result = await window.desktopAPI.resumeScan();
  if (!result?.ok) {
    setStatus(String(result?.message || "Could not resume scan."));
    return;
  }
  setStatus("Scan resumed.");
  pushLog(scanLogs, "Scan resumed.");
});

cancelScanBtn.addEventListener("click", async () => {
  const result = await window.desktopAPI.cancelScan();
  if (!result?.ok) {
    setStatus(String(result?.message || "Could not cancel scan."));
    return;
  }
  setStatus("Cancelling scan...");
  pushLog(scanLogs, "Cancellation requested.");
});

async function startIndexingWithMode(mode) {
  const result = await window.desktopAPI.startIndexing({ auto: false, mode });
  if (!result?.ok) {
    setStatus(`Could not start indexing: ${String(result?.message || "Unknown error")}`);
    return;
  }

  const label = mode === "cloud" ? "Cloud" : "Local";
  setStatus(`${label} indexing started.`);
  pushLog(indexLogs, `${label} indexing started.`);
}

if (startLocalIndexingBtn) {
  startLocalIndexingBtn.addEventListener("click", async () => {
    await startIndexingWithMode("local");
  });
}

if (startCloudIndexingBtn) {
  startCloudIndexingBtn.addEventListener("click", async () => {
    await startIndexingWithMode("cloud");
  });
}

pauseIndexingBtn.addEventListener("click", async () => {
  const result = await window.desktopAPI.pauseIndexing();
  if (!result?.ok) {
    setStatus(String(result?.message || "Could not pause indexing."));
    return;
  }
  setStatus("Indexing paused.");
  pushLog(indexLogs, "Indexing paused.");
});

resumeIndexingBtn.addEventListener("click", async () => {
  const result = await window.desktopAPI.resumeIndexing();
  if (!result?.ok) {
    setStatus(String(result?.message || "Could not resume indexing."));
    return;
  }
  setStatus("Indexing resumed.");
  pushLog(indexLogs, "Indexing resumed.");
});

cancelIndexingBtn.addEventListener("click", async () => {
  const result = await window.desktopAPI.cancelIndexing();
  if (!result?.ok) {
    setStatus(String(result?.message || "Could not cancel indexing."));
    return;
  }
  setStatus("Cancelling indexing...");
  pushLog(indexLogs, "Cancellation requested.");
});

retryFailedBtn.addEventListener("click", async () => {
  const result = await window.desktopAPI.retryFailedIndexing();
  if (!result?.ok) {
    setStatus(String(result?.message || "Retry failed."));
    return;
  }

  setStatus(result.message);
  pushLog(indexLogs, result.message);
});

updateScanModeVisibility();
updateCustomFoldersSummary();
bindScanAndIndexEvents();
initializeSidebarSectionToggles();
updateScanSectionOptionBadges();

(async () => {
  showHomeScreen();
  await loadAlbums();
  await syncHomepageFiltersFromSavedSettings();
  await initializeDefaultMetadataFile();
})();
