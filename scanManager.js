import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export function registerScanHandlers({
  ipcMain,
  sendToRenderer,
  waitWhilePaused,
  pathExists,
  updateMasterDirectoryFromScan,
  createAlbumByName,
  assignImagePathsToAlbums,
  startIndexingInternal,
  imageFileTypes,
  videoFileTypes,
  extendedFileTypes,
}) {
  const scanState = {
    running: false,
    paused: false,
    cancelled: false,
    files: [],
    options: null,
  };

  const imageTypes = Array.isArray(imageFileTypes) ? imageFileTypes : [];
  const videoTypes = Array.isArray(videoFileTypes) ? videoFileTypes : [];
  const extraTypes = Array.isArray(extendedFileTypes) ? extendedFileTypes : [];

  async function getMountedWindowsDrives() {
    const roots = [];
    for (let i = 65; i <= 90; i += 1) {
      const letter = String.fromCharCode(i);
      const root = `${letter}:\\`;
      if (await pathExists(root)) {
        roots.push(root);
      }
    }
    return roots;
  }

  function normalizeExtensions(options) {
    const useExtended = Boolean(options?.includeMoreFormats);
    const custom = Array.isArray(options?.fileTypes) ? options.fileTypes : [];
    const base = useExtended
      ? [...imageTypes, ...videoTypes, ...extraTypes]
      : [...imageTypes, ...videoTypes];
    const merged = [...base, ...custom]
      .map((ext) => String(ext || "").trim().toLowerCase())
      .filter(Boolean)
      .map((ext) => (ext.startsWith(".") ? ext : `.${ext}`));
    return new Set(merged);
  }

  function isSystemBrandingAsset(filePath) {
    const normalizedPath = String(filePath || "").toLowerCase().replaceAll("\\", "/");
    const fileName = path.basename(filePath, path.extname(filePath)).toLowerCase();
    const extension = path.extname(filePath).toLowerCase();

    if (extension === ".ico" || extension === ".icns") {
      return true;
    }

    const brandTerms = "windows|microsoft|apple|macos|mac\\s?os|osx";
    const iconLogoTerms = "icon|icons|logo|logos|symbol|branding";
    const brandedFilePattern = new RegExp(`(?:${brandTerms}).*(?:${iconLogoTerms})|(?:${iconLogoTerms}).*(?:${brandTerms})`, "i");
    if (brandedFilePattern.test(fileName)) {
      return true;
    }

    const systemAssetFolderPattern =
      /\/(windows\/(branding|web|resources)|program files|program files \(x86\)|programdata|system\/library\/coreservices|system\/library\/privateframeworks|library\/application support)\//i;
    if (systemAssetFolderPattern.test(normalizedPath) && /(icon|logo|branding)/i.test(fileName)) {
      return true;
    }

    return false;
  }

  function isTemporaryImageArtifact(fileName) {
    const name = String(fileName || "").trim();
    if (!name) {
      return false;
    }
    // macOS sidecar files copied to other filesystems often start with ._
    return name.startsWith("._");
  }

  function getSearchRoots(options, customFolders) {
    if (options?.scanMode === "custom" && Array.isArray(customFolders) && customFolders.length > 0) {
      return customFolders;
    }

    const homeDir = os.homedir();
    const systemDrive = process.env.SystemDrive || "C:";
    return [
      `${systemDrive}\\`,
      path.join(homeDir, "Pictures"),
      path.join(homeDir, "Desktop"),
      path.join(homeDir, "Downloads"),
    ];
  }

  async function collectImageFiles(roots, extSet, state) {
    const unique = new Set();
    const queue = [...roots];
    let visitedFolders = 0;
    let excludedBrandAssets = 0;

    while (queue.length > 0) {
      if (state?.cancelled) {
        return { cancelled: true, files: Array.from(unique) };
      }

      await waitWhilePaused(state || scanState);
      if (state?.cancelled) {
        return { cancelled: true, files: Array.from(unique) };
      }

      const current = queue.shift();
      visitedFolders += 1;
      if (visitedFolders % 50 === 0) {
        sendToRenderer("scan-log", { message: `Scanning folder ${current}...` });
      }

      let entries;
      try {
        entries = await fs.readdir(current, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (state?.cancelled) {
          return { cancelled: true, files: Array.from(unique) };
        }

        await waitWhilePaused(state || scanState);
        if (state?.cancelled) {
          return { cancelled: true, files: Array.from(unique) };
        }

        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          queue.push(fullPath);
          continue;
        }

        if (!entry.isFile()) {
          continue;
        }

        if (isTemporaryImageArtifact(entry.name)) {
          continue;
        }

        const ext = path.extname(entry.name).toLowerCase();
        if (!extSet.has(ext)) {
          continue;
        }

        if (isSystemBrandingAsset(fullPath)) {
          excludedBrandAssets += 1;
          if (excludedBrandAssets % 100 === 0) {
            sendToRenderer("scan-log", {
              message: `Skipped ${excludedBrandAssets} OS icon/logo assets so far...`,
            });
          }
          continue;
        }

        unique.add(fullPath);
        if (unique.size % 120 === 0) {
          sendToRenderer("scan-log", { message: `Found ${unique.size} media files so far...` });
        }
      }
    }

    return {
      cancelled: false,
      files: Array.from(unique),
      excludedBrandAssets,
    };
  }

  ipcMain.handle("start-full-scan", async (_event, options) => {
    if (scanState.running) {
      return { ok: false, message: "A scan is already running." };
    }

    scanState.running = true;
    scanState.paused = false;
    scanState.cancelled = false;
    scanState.files = [];
    scanState.options = options || {};

    (async () => {
      try {
        const extSet = normalizeExtensions(options || {});
        const customFolders = Array.isArray(options?.customFolders) ? options.customFolders : [];
        const roots = getSearchRoots(options || {}, customFolders);
        const allRoots = [...roots];

        if (options?.includeMountedDrives) {
          const mounted = await getMountedWindowsDrives();
          for (const drive of mounted) {
            if (!allRoots.includes(drive)) {
              allRoots.push(drive);
            }
          }
        }

        sendToRenderer("scan-log", { message: "Scan started. Discovering media files (images + videos)..." });
        const discovery = await collectImageFiles(allRoots, extSet, scanState);
        if (discovery.cancelled || scanState.cancelled) {
          const partialCount = Array.isArray(discovery.files) ? discovery.files.length : 0;
          sendToRenderer("scan-log", { message: "Scan cancelled by user during discovery." });
          sendToRenderer("scan-complete", {
            ok: false,
            cancelled: true,
            total: partialCount,
            scanned: partialCount,
            files: [],
          });
          return;
        }

        const found = discovery.files;
        scanState.files = found;

        if (Number(discovery.excludedBrandAssets || 0) > 0) {
          sendToRenderer("scan-log", {
            message: `Excluded ${discovery.excludedBrandAssets} Windows/macOS icon/logo assets from scan results.`,
          });
        }

        const total = found.length;
        sendToRenderer("scan-progress", { phase: "scan", percent: 0, scanned: 0, total });
        sendToRenderer("scan-log", { message: `Found ${total} media files. Beginning scan phase...` });

        let scanned = 0;
        for (const imagePath of found) {
          if (scanState.cancelled) {
            sendToRenderer("scan-log", { message: "Scan cancelled by user." });
            sendToRenderer("scan-complete", { ok: false, cancelled: true, total, scanned, files: [] });
            return;
          }

          await waitWhilePaused(scanState);
          if (scanState.cancelled) {
            sendToRenderer("scan-complete", { ok: false, cancelled: true, total, scanned, files: [] });
            return;
          }

          scanned += 1;
          if (scanned % 150 === 0 || scanned === total) {
            sendToRenderer("scan-log", { message: `Scanned ${scanned}/${total}` });
          }

          const percent = total === 0 ? 100 : Math.floor((scanned / total) * 100);
          sendToRenderer("scan-progress", { phase: "scan", percent, scanned, total, current: imagePath });
        }

        const directoryUpdate = await updateMasterDirectoryFromScan(found);

        const scanAlbumIds = Array.isArray(options?.scanAlbumIds)
          ? options.scanAlbumIds.map((id) => Number(id)).filter((id) => Number.isFinite(id))
          : [];
        const inlineAlbumName = String(options?.scanCreateAlbumName || "").trim();
        let targetAlbumIds = [...scanAlbumIds];

        if (inlineAlbumName) {
          const created = await createAlbumByName(inlineAlbumName);
          if (created?.ok && Number.isFinite(Number(created.album?.id))) {
            targetAlbumIds.push(Number(created.album.id));
          }
        }

        targetAlbumIds = Array.from(new Set(targetAlbumIds));
        if (targetAlbumIds.length > 0 && found.length > 0) {
          const assignResult = await assignImagePathsToAlbums(found, targetAlbumIds);
          if (assignResult?.ok) {
            sendToRenderer("scan-log", {
              message: `Assigned ${assignResult.assignedCount} scanned media files to selected album(s).`,
            });
          }
        }

        sendToRenderer("scan-log", {
          message: `Master directory updated: ${directoryUpdate.total} files (${directoryUpdate.newItems} new, ${directoryUpdate.refreshedItems} refreshed).`,
        });
        sendToRenderer("scan-complete", {
          ok: true,
          cancelled: false,
          total,
          scanned,
          files: found,
          masterDirectoryPath: directoryUpdate.path,
        });

        if (options?.autoIndexAfterScan) {
          await startIndexingInternal({ mode: "local" });
        }
      } catch (error) {
        sendToRenderer("scan-complete", { ok: false, cancelled: false, message: String(error?.message || error), files: [] });
      } finally {
        scanState.running = false;
        scanState.paused = false;
        scanState.cancelled = false;
      }
    })();

    return { ok: true, message: "Scan started." };
  });

  ipcMain.handle("pause-scan", async () => {
    if (!scanState.running) {
      return { ok: false, message: "No running scan." };
    }
    scanState.paused = true;
    sendToRenderer("scan-log", { message: "Scan paused." });
    return { ok: true };
  });

  ipcMain.handle("resume-scan", async () => {
    if (!scanState.running) {
      return { ok: false, message: "No running scan." };
    }
    scanState.paused = false;
    sendToRenderer("scan-log", { message: "Scan resumed." });
    return { ok: true };
  });

  ipcMain.handle("cancel-scan", async () => {
    if (!scanState.running) {
      return { ok: false, message: "No running scan." };
    }
    scanState.cancelled = true;
    return { ok: true };
  });
}
