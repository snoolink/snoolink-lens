const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopAPI", {
  pickMetadataFile: () => ipcRenderer.invoke("pick-metadata-file"),
  validateMetadataFile: (filePath) => ipcRenderer.invoke("validate-metadata-file", filePath),
  getDefaultMetadataFile: () => ipcRenderer.invoke("get-default-metadata-file"),
  getUiPartial: (payload) => ipcRenderer.invoke("get-ui-partial", payload),
  semanticSearch: (payload) => ipcRenderer.invoke("semantic-search", payload),
  getImagePreviewSrc: (payload) => ipcRenderer.invoke("get-image-preview-src", payload),
  getMediaPreviewSrc: (payload) => ipcRenderer.invoke("get-image-preview-src", payload),
  getImageMetadataByPath: (payload) => ipcRenderer.invoke("get-image-metadata-by-path", payload),
  openOriginalSourceFolder: (imagePath) => ipcRenderer.invoke("open-original-source-folder", imagePath),
  exportMediaFile: (payload) => ipcRenderer.invoke("export-media-file", payload),
  deleteMediaFile: (payload) => ipcRenderer.invoke("delete-media-file", payload),
  copyText: (text) => ipcRenderer.invoke("copy-text", text),
  readBinaryFile: (payload) => ipcRenderer.invoke("read-binary-file", payload),
  wizardGeneratePlan: (payload) => ipcRenderer.invoke("wizard-generate-plan", payload),
  getMasterDirectory: (options) => ipcRenderer.invoke("get-master-directory", options),
  pickCustomFolders: () => ipcRenderer.invoke("pick-custom-folders"),
  getUserSettings: () => ipcRenderer.invoke("get-user-settings"),
  saveUserSettings: (settings) => ipcRenderer.invoke("save-user-settings", settings),
  backupAppData: () => ipcRenderer.invoke("backup-app-data"),
  openInstagramReelAnalyzerWindow: () => ipcRenderer.invoke("open-instagram-reel-analyzer-window"),
  pickInstagramReelVideo: () => ipcRenderer.invoke("pick-instagram-reel-video"),
  analyzeInstagramReel: (payload) => ipcRenderer.invoke("analyze-instagram-reel", payload),
  getLocalFilterOptions: () => ipcRenderer.invoke("get-local-filter-options"),
  getFaceClusters: () => ipcRenderer.invoke("get-face-clusters"),
  rebuildFaceClusters: () => ipcRenderer.invoke("rebuild-face-clusters"),
  setFaceClusterLabel: (payload) => ipcRenderer.invoke("set-face-cluster-label", payload),
  getAlbums: () => ipcRenderer.invoke("get-albums"),
  createAlbum: (payload) => ipcRenderer.invoke("create-album", payload),
  renameAlbum: (payload) => ipcRenderer.invoke("rename-album", payload),
  deleteAlbum: (payload) => ipcRenderer.invoke("delete-album", payload),
  assignImagesToAlbums: (payload) => ipcRenderer.invoke("assign-images-to-albums", payload),
  removeImagesFromAlbum: (payload) => ipcRenderer.invoke("remove-images-from-album", payload),
  getAlbumImages: (payload) => ipcRenderer.invoke("get-album-images", payload),
  setStitchSelection: (payload) => ipcRenderer.invoke("set-stitch-selection", payload),
  getStitchSelection: () => ipcRenderer.invoke("get-stitch-selection"),
  clearStitchSelection: () => ipcRenderer.invoke("clear-stitch-selection"),
  generateStitchVideo: (payload) => ipcRenderer.invoke("generate-stitch-video", payload),

  startFullScan: (options) => ipcRenderer.invoke("start-full-scan", options),
  pauseScan: () => ipcRenderer.invoke("pause-scan"),
  resumeScan: () => ipcRenderer.invoke("resume-scan"),
  cancelScan: () => ipcRenderer.invoke("cancel-scan"),

  startIndexing: (payload) => ipcRenderer.invoke("start-indexing", payload),
  cloudIndexSingleMedia: (imagePath) => ipcRenderer.invoke("start-indexing", {
    mode: "cloud",
    files: [String(imagePath || "").trim()],
  }),
  pauseIndexing: () => ipcRenderer.invoke("pause-indexing"),
  resumeIndexing: () => ipcRenderer.invoke("resume-indexing"),
  cancelIndexing: () => ipcRenderer.invoke("cancel-indexing"),
  retryFailedIndexing: () => ipcRenderer.invoke("retry-failed-indexing"),

  onScanProgress: (handler) => {
    const wrapped = (_event, payload) => handler(payload);
    ipcRenderer.on("scan-progress", wrapped);
    return () => ipcRenderer.removeListener("scan-progress", wrapped);
  },
  onScanLog: (handler) => {
    const wrapped = (_event, payload) => handler(payload);
    ipcRenderer.on("scan-log", wrapped);
    return () => ipcRenderer.removeListener("scan-log", wrapped);
  },
  onScanComplete: (handler) => {
    const wrapped = (_event, payload) => handler(payload);
    ipcRenderer.on("scan-complete", wrapped);
    return () => ipcRenderer.removeListener("scan-complete", wrapped);
  },
  onIndexProgress: (handler) => {
    const wrapped = (_event, payload) => handler(payload);
    ipcRenderer.on("index-progress", wrapped);
    return () => ipcRenderer.removeListener("index-progress", wrapped);
  },
  onIndexLog: (handler) => {
    const wrapped = (_event, payload) => handler(payload);
    ipcRenderer.on("index-log", wrapped);
    return () => ipcRenderer.removeListener("index-log", wrapped);
  },
  onIndexComplete: (handler) => {
    const wrapped = (_event, payload) => handler(payload);
    ipcRenderer.on("index-complete", wrapped);
    return () => ipcRenderer.removeListener("index-complete", wrapped);
  },
  onStitchProgress: (handler) => {
    const wrapped = (_event, payload) => handler(payload);
    ipcRenderer.on("stitch-progress", wrapped);
    return () => ipcRenderer.removeListener("stitch-progress", wrapped);
  },
  startShareServer: (payload) => ipcRenderer.invoke("start-share-server", payload),
  stopShareServer: () => ipcRenderer.invoke("stop-share-server"),
});
