// Electron Main Process
// This runs in Node.js and manages the application window and system interactions

import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { promises as fs } from 'fs';
import { MakeMKVAdapter } from './makemkv.js';
import { DriveDetector } from './drives.js';
import logger from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow = null;
let driveDetector = null;
let sharedMakeMKV = null; // Shared instance for non-backup operations

// PARALLEL BACKUP SYSTEM
// With --noscan flag, MakeMKV processes can run in parallel because:
// 1. Each process targets a specific disc:N directly (no scanning)
// 2. Each writes to its own folder
// 3. No drive scanning conflicts
//
// We track running backups in a Map for cancellation support.
const runningBackups = new Map(); // driveId -> { makemkv, discName }

// Get or create shared MakeMKV instance (for settings/status checks)
// Note: Uses a lock to prevent race conditions during initialization
let sharedMakeMKVPromise = null;

async function getSharedMakeMKV() {
  if (sharedMakeMKV) {
    return sharedMakeMKV;
  }

  // If already initializing, wait for that to complete
  if (sharedMakeMKVPromise) {
    return sharedMakeMKVPromise;
  }

  // Start initialization
  sharedMakeMKVPromise = (async () => {
    const instance = new MakeMKVAdapter();
    await instance.loadSettings();
    sharedMakeMKV = instance;
    return instance;
  })();

  return sharedMakeMKVPromise;
}

// Create the main application window
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      // Security: Use preload script for safe IPC
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // In development, load from Vite dev server
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173').catch(err => {
      console.error('Failed to load dev server:', err);
      mainWindow.loadURL(`data:text/html,<h1>Error loading dev server</h1><p>Make sure Vite is running on port 5173</p><pre>${err}</pre>`);
    });
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  // Initialize drive detector (fast Windows-based detection)
  driveDetector = new DriveDetector();
}

// App lifecycle events
app.whenReady().then(async () => {
  // Initialize logger first
  await logger.init();
  logger.info('app', 'EasyRip starting up');

  createWindow();
  setupIPC();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Set up Inter-Process Communication (IPC) handlers
function setupIPC() {
  // Fast drive detection using Windows APIs
  ipcMain.handle('scan-drives', async () => {
    try {
      logger.info('scan-drives', 'Starting drive detection...');
      const drives = await driveDetector.detectDrives();
      logger.info('scan-drives', `Found ${drives.length} drives`, drives.map(d => ({ letter: d.driveLetter, name: d.discName, type: d.isBluray ? 'BD' : 'DVD' })));
      return { success: true, drives };
    } catch (error) {
      logger.error('scan-drives', 'Drive detection failed', error);
      return { success: false, error: error.message, errorDetails: error.stack };
    }
  });

  // Clean up orphan temp folders (folders that don't match any current disc)
  ipcMain.handle('cleanup-orphan-temps', async () => {
    try {
      const makemkv = await getSharedMakeMKV();
      const tempDir = path.join(makemkv.basePath, 'temp');

      // Check if temp directory exists
      const tempExists = await fs.access(tempDir).then(() => true).catch(() => false);
      if (!tempExists) {
        return { success: true, cleaned: 0 };
      }

      const entries = await fs.readdir(tempDir, { withFileTypes: true });
      let cleaned = 0;

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const folderPath = path.join(tempDir, entry.name);
          console.log(`[cleanup] Removing orphan temp folder: ${entry.name}`);
          await fs.rm(folderPath, { recursive: true, force: true });
          cleaned++;
        }
      }

      console.log(`[cleanup] Cleaned ${cleaned} orphan temp folders`);
      return { success: true, cleaned };
    } catch (error) {
      console.error('[cleanup] Error:', error);
      return { success: false, error: error.message };
    }
  });

  // Check backup status for a disc (before starting)
  ipcMain.handle('check-backup-status', async (event, discName, discSize) => {
    try {
      const makemkv = await getSharedMakeMKV();
      // Log to file for debugging
      const logFn = (msg) => logger.debug('backup-status', `[${discName}] ${msg}`);
      const status = await makemkv.checkBackupStatus(discName, discSize, logFn);
      logger.info('backup-status', `[${discName}] Status: ${status.status}`, { ratio: status.backupRatio, size: status.backupSize });
      return { success: true, ...status };
    } catch (error) {
      logger.error('backup-status', `[${discName}] Status check failed`, error);
      return { success: false, error: error.message, errorDetails: error.stack };
    }
  });

  // Start backup for a specific drive (PARALLEL - all drives run simultaneously!)
  // With --noscan flag, each MakeMKV process targets its disc:N directly without conflicts.
  ipcMain.handle('start-backup', async (event, driveId, makemkvIndex, discName, discSize) => {
    // Check if already running for this drive
    if (runningBackups.has(driveId)) {
      logger.warn('start-backup', `Backup already running for drive ${driveId}`);
      return { success: false, error: 'Backup already running for this drive' };
    }

    logger.info('start-backup', `Starting parallel backup for ${discName} (disc:${makemkvIndex})`, {
      driveId,
      makemkvIndex,
      discSize,
      totalRunning: runningBackups.size
    });

    // Notify UI that backup is starting
    mainWindow.webContents.send('backup-started', { driveId });

    // Create new MakeMKV adapter for this backup
    const makemkv = new MakeMKVAdapter();
    await makemkv.loadSettings();

    // Track this backup
    runningBackups.set(driveId, { makemkv, discName });

    // Run backup in background (don't await - let it run parallel)
    runBackup(driveId, makemkv, makemkvIndex, discName, discSize);

    // Return immediately - progress comes via IPC events
    return { success: true, driveId, started: true };
  });

  // Run a single backup (called in parallel for each drive)
  async function runBackup(driveId, makemkv, makemkvIndex, discName, discSize) {
    try {
      const result = await makemkv.startBackup(makemkvIndex, discName, discSize,
        // Progress callback
        (progress) => {
          mainWindow.webContents.send('backup-progress', { driveId, ...progress });
        },
        // Log callback
        (logLine) => {
          logger.debug('backup', `[${discName}] ${logLine}`);
          mainWindow.webContents.send('backup-log', { driveId, line: logLine });
        }
      );

      logger.info('start-backup', `Backup completed for ${discName}`, {
        size: result.size,
        path: result.path
      });

      // Send completion event
      console.log(`[IPC] Sending backup-complete for driveId=${driveId}, success=true`);
      logger.info('start-backup', `Sending backup-complete IPC event`, { driveId, success: true });
      mainWindow.webContents.send('backup-complete', {
        driveId,
        success: true,
        ...result
      });

    } catch (error) {
      logger.error('start-backup', `Backup failed for ${discName}`, error);

      // Send failure event
      console.log(`[IPC] Sending backup-complete for driveId=${driveId}, success=false, error=${error.message}`);
      logger.info('start-backup', `Sending backup-complete IPC event (failure)`, { driveId, success: false, error: error.message });
      mainWindow.webContents.send('backup-complete', {
        driveId,
        success: false,
        error: error.message
      });

    } finally {
      // Remove from running backups
      runningBackups.delete(driveId);
    }
  }

  // Cancel backup for a specific drive
  ipcMain.handle('cancel-backup', async (event, driveId) => {
    try {
      const backup = runningBackups.get(driveId);
      if (backup) {
        logger.info('cancel-backup', `Cancelling backup for drive ${driveId} (${backup.discName})`);
        backup.makemkv.cancelBackup();
        runningBackups.delete(driveId);
        return { success: true, cancelled: true };
      }

      logger.warn('cancel-backup', `No backup running for drive ${driveId}`);
      return { success: true, wasNotFound: true };
    } catch (error) {
      logger.error('cancel-backup', `Failed to cancel backup for drive ${driveId}`, error);
      return { success: false, error: error.message };
    }
  });

  // Get current settings
  ipcMain.handle('get-settings', async () => {
    try {
      const makemkv = await getSharedMakeMKV();
      const settings = await makemkv.getSettings();
      return { success: true, settings };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Save settings
  ipcMain.handle('save-settings', async (event, settings) => {
    try {
      const makemkv = await getSharedMakeMKV();
      await makemkv.saveSettings(settings);
      logger.info('settings', 'Settings saved', settings);
      return { success: true };
    } catch (error) {
      logger.error('settings', 'Failed to save settings', error);
      return { success: false, error: error.message };
    }
  });

  // Get recent logs for troubleshooting
  ipcMain.handle('get-logs', async (event, lines = 200) => {
    try {
      const result = await logger.getRecentLogs(lines);
      return result;
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Get list of log files
  ipcMain.handle('get-log-files', async () => {
    try {
      const result = await logger.getLogFiles();
      return result;
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Open log directory in explorer
  ipcMain.handle('open-log-directory', async () => {
    try {
      const logDir = logger.getLogDir();
      await shell.openPath(logDir);
      return { success: true, path: logDir };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Open backup directory in explorer
  ipcMain.handle('open-backup-directory', async () => {
    try {
      const makemkv = await getSharedMakeMKV();
      const backupDir = path.join(makemkv.basePath, 'backup');
      await fs.mkdir(backupDir, { recursive: true });
      await shell.openPath(backupDir);
      return { success: true, path: backupDir };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}
