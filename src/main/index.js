// Electron Main Process
// This runs in Node.js and manages the application window and system interactions

import { app, BrowserWindow } from 'electron';
import logger from './logger.js';
import { getSharedMakeMKV } from './utils.js';
import { createWindow, setMainWindow } from './window-manager.js';
import { initBackupManager, getDriveDetector } from './backup-manager.js';
import { initializeMetadataSystem, cleanupMetadataSystem, getIdentifier } from './metadata-system.js';
import { setupIPC } from './ipc-handlers.js';
import { initAutoUpdater } from './updater.js';

// App lifecycle events
app.whenReady().then(async () => {
  // Initialize logger first
  await logger.init();
  logger.info('app', 'EasyRip starting up');

  // Create main window
  const mainWindow = createWindow();
  setMainWindow(mainWindow);

  // Initialize shared MakeMKV instance
  const makemkv = await getSharedMakeMKV();

  // Initialize metadata system first (creates discIdentifier)
  await initializeMetadataSystem(makemkv);

  // Initialize backup manager (needs discIdentifier from metadata system)
  const discIdentifier = getIdentifier();
  initBackupManager(discIdentifier);

  // Set up IPC handlers
  setupIPC();

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
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Cleanup on quit
app.on('before-quit', async () => {
  logger.info('app', 'Shutting down...');

  // Stop metadata watcher and Ollama
  await cleanupMetadataSystem();

  logger.info('app', 'Cleanup complete');
});
