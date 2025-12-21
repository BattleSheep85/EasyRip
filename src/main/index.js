// Electron Main Process
// This runs in Node.js and manages the application window and system interactions

import { app, BrowserWindow, dialog } from 'electron';
import logger from './logger.js';
import { getSharedMakeMKV } from './utils.js';
import { createWindow, setMainWindow, getMainWindow } from './window-manager.js';
import { initBackupManager, getDriveDetector, cancelAllBackups } from './backup-manager.js';
import { initializeMetadataSystem, cleanupMetadataSystem, getIdentifier } from './metadata-system.js';
import { setupIPC } from './ipc-handlers.js';
import { initAutoUpdater } from './updater.js';

// SINGLE INSTANCE LOCK
// Prevents multiple instances of EasyRip from running simultaneously
// This is critical because MakeMKV can only be controlled by one process at a time
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // Another instance is already running - quit immediately
  console.log('Another instance of EasyRip is already running. Exiting.');
  app.quit();
} else {
  // We got the lock - handle when another instance tries to start
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // Someone tried to run a second instance - focus our window instead
    const mainWindow = getMainWindow();
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }
  });
}

// App lifecycle events
app.whenReady().then(async () => {
  // Initialize logger first
  await logger.init();
  logger.info('app', 'EasyRip starting up');

  // Initialize shared MakeMKV instance BEFORE creating window
  const makemkv = await getSharedMakeMKV();

  // Initialize metadata system first (creates discIdentifier)
  await initializeMetadataSystem(makemkv);

  // Initialize backup manager (needs discIdentifier from metadata system)
  const discIdentifier = getIdentifier();
  initBackupManager(discIdentifier);

  // Set up IPC handlers BEFORE creating window
  // This prevents race condition where renderer calls IPC before handlers exist
  setupIPC();

  // NOW create the window - IPC handlers are ready
  const mainWindow = createWindow();
  setMainWindow(mainWindow);

  // Initialize auto-updater (checks for updates on startup)
  initAutoUpdater(mainWindow);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const newWindow = createWindow();
      setMainWindow(newWindow);
    }
  });
});

app.on('window-all-closed', () => {
  // Always quit when all windows are closed (including on macOS)
  // EasyRip is not a "stay in dock" type app
  app.quit();
});

// Cleanup on quit
app.on('before-quit', async () => {
  logger.info('app', 'Shutting down...');

  // Kill any running MakeMKV backup processes
  cancelAllBackups();

  // Stop metadata watcher and Ollama
  await cleanupMetadataSystem();

  logger.info('app', 'Cleanup complete');
});
