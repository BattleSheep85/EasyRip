// Auto-Updater Module
// Handles checking for updates and installing them from GitHub releases

import electronUpdater from 'electron-updater';
const { autoUpdater } = electronUpdater;
import { app, ipcMain } from 'electron';
import logger from './logger.js';

// Create log wrapper
const log = {
  info: (msg, data) => logger.info('updater', msg, data),
  warn: (msg, data) => logger.warn('updater', msg, data),
  error: (msg, data) => logger.error('updater', msg, data),
  debug: (msg, data) => logger.debug('updater', msg, data),
};

let mainWindow = null;
let updateAvailable = null;
let updateDownloaded = false;
let downloadProgress = 0;

/**
 * Initialize the auto-updater
 * @param {BrowserWindow} window - The main browser window
 */
export function initAutoUpdater(window) {
  mainWindow = window;

  // Configure auto-updater
  autoUpdater.autoDownload = false; // Don't auto-download, let user decide
  autoUpdater.autoInstallOnAppQuit = true;

  // Configure logging
  autoUpdater.logger = {
    info: (msg) => log.info(msg),
    warn: (msg) => log.warn(msg),
    error: (msg) => log.error(msg),
    debug: (msg) => log.debug(msg),
  };

  // Event handlers
  autoUpdater.on('checking-for-update', () => {
    log.info('Checking for updates...');
    sendStatusToWindow('checking');
  });

  autoUpdater.on('update-available', (info) => {
    log.info(`Update available: v${info.version}`);
    updateAvailable = info;
    sendStatusToWindow('available', {
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: info.releaseNotes,
    });
  });

  autoUpdater.on('update-not-available', (info) => {
    log.info('No updates available');
    updateAvailable = null;
    sendStatusToWindow('not-available', {
      currentVersion: app.getVersion(),
    });
  });

  autoUpdater.on('error', (err) => {
    log.error(`Update error: ${err.message}`);
    sendStatusToWindow('error', { message: err.message });
  });

  autoUpdater.on('download-progress', (progress) => {
    downloadProgress = progress.percent;
    log.debug(`Download progress: ${progress.percent.toFixed(1)}%`);
    sendStatusToWindow('downloading', {
      percent: progress.percent,
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    log.info(`Update downloaded: v${info.version}`);
    updateDownloaded = true;
    sendStatusToWindow('downloaded', {
      version: info.version,
    });
  });

  // Set up IPC handlers
  setupIpcHandlers();

  // Check for updates on startup (with a small delay)
  setTimeout(() => {
    checkForUpdates();
  }, 5000);
}

/**
 * Send update status to renderer
 */
function sendStatusToWindow(status, data = {}) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-status', { status, ...data });
  }
}

/**
 * Check for updates
 */
export async function checkForUpdates() {
  // Skip in development mode
  if (process.env.NODE_ENV === 'development') {
    log.info('Skipping update check in development mode');
    sendStatusToWindow('dev-mode');
    return;
  }

  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    log.error(`Failed to check for updates: ${error.message}`);
    sendStatusToWindow('error', { message: error.message });
  }
}

/**
 * Download the available update
 */
export async function downloadUpdate() {
  if (!updateAvailable) {
    log.warn('No update available to download');
    return;
  }

  try {
    await autoUpdater.downloadUpdate();
  } catch (error) {
    log.error(`Failed to download update: ${error.message}`);
    sendStatusToWindow('error', { message: error.message });
  }
}

/**
 * Install the downloaded update and restart
 */
export function installUpdate() {
  if (!updateDownloaded) {
    log.warn('No update downloaded to install');
    return;
  }

  log.info('Installing update and restarting...');
  autoUpdater.quitAndInstall(false, true);
}

/**
 * Get current app version
 */
export function getVersion() {
  return app.getVersion();
}

/**
 * Set up IPC handlers for renderer communication
 */
function setupIpcHandlers() {
  ipcMain.handle('get-version', () => {
    return getVersion();
  });

  ipcMain.handle('check-for-updates', async () => {
    await checkForUpdates();
    return { checking: true };
  });

  ipcMain.handle('download-update', async () => {
    await downloadUpdate();
    return { downloading: true };
  });

  ipcMain.handle('install-update', () => {
    installUpdate();
    return { installing: true };
  });

  ipcMain.handle('get-update-status', () => {
    return {
      currentVersion: getVersion(),
      updateAvailable: updateAvailable ? {
        version: updateAvailable.version,
        releaseDate: updateAvailable.releaseDate,
      } : null,
      updateDownloaded,
      downloadProgress,
    };
  });
}

export default {
  initAutoUpdater,
  checkForUpdates,
  downloadUpdate,
  installUpdate,
  getVersion,
};
