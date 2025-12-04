// Electron Main Process
// This runs in Node.js and manages the application window and system interactions

import { app, BrowserWindow, ipcMain, shell, Notification } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { promises as fs } from 'fs';
import { MakeMKVAdapter } from './makemkv.js';
import { DriveDetector } from './drives.js';
import logger from './logger.js';

// Metadata system imports
import { getOllamaManager } from './metadata/ollama.js';
import { getTMDBClient } from './metadata/tmdb.js';
import { getDiscIdentifier } from './metadata/identifier.js';
import { getMetadataWatcher, resetMetadataWatcher } from './metadata/watcher.js';
import { MetadataStatus, createEmptyMetadata } from './metadata/schemas.js';

// Fingerprinting system imports
import { generateFingerprint, hasUsefulFingerprint } from './metadata/fingerprint.js';
import { getARMDatabase } from './metadata/arm-database.js';

// Emby export system
import { EmbyExporter } from './emby.js';

// Library fixer (rename/fix existing Emby library items)
import { LibraryFixer } from './libraryFixer.js';

// Transfer system
import { getTransferManager } from './transfer.js';

// Export watcher (auto-export on approval)
import { getExportWatcher, resetExportWatcher } from './exportWatcher.js';

// Auto-updater
import { initAutoUpdater } from './updater.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Security: Validate backup/disc names to prevent path traversal attacks
function sanitizeBackupName(name) {
  if (!name || typeof name !== 'string') {
    throw new Error('Invalid backup name');
  }
  // Use path.basename to strip any directory components and prevent traversal
  const sanitized = path.basename(name);
  // Reject if the name contained traversal attempts or is empty after sanitization
  if (!sanitized || sanitized !== name || name.includes('..')) {
    throw new Error('Invalid backup name: path traversal detected');
  }
  return sanitized;
}

let mainWindow = null;
let driveDetector = null;
let sharedMakeMKV = null; // Shared instance for non-backup operations

// Metadata system globals
let ollamaManager = null;
let tmdbClient = null;
let discIdentifier = null;
let metadataWatcher = null;

// Emby export globals
let embyExporter = null;
let currentEmbyExport = null; // Track current export for cancellation

// Export watcher (auto-export on approval)
let exportWatcher = null;

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

// Helper function to show desktop notifications
function showNotification(title, body, type = 'info') {
  if (!Notification.isSupported()) {
    logger.warn('notification', 'Notifications not supported on this system');
    return;
  }

  try {
    const notification = new Notification({
      title,
      body,
      silent: false,
    });
    notification.show();
    logger.debug('notification', `Showed notification: ${title}`);
  } catch (error) {
    logger.warn('notification', `Failed to show notification: ${error.message}`);
  }
}

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
    // In production, load the built renderer from dist-renderer
    // __dirname is app.asar/src/main, so go up twice to reach app.asar root
    mainWindow.loadFile(path.join(__dirname, '../../dist-renderer/index.html'));
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

  // Initialize auto-updater (checks for updates on startup)
  initAutoUpdater(mainWindow);

  // Initialize metadata system
  await initializeMetadataSystem();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Initialize metadata system (Ollama, TMDB, watcher)
async function initializeMetadataSystem() {
  try {
    logger.info('metadata', 'Initializing metadata system...');

    // Get settings to check metadata configuration
    const makemkv = await getSharedMakeMKV();
    const settings = await makemkv.getSettings();
    const metadataSettings = settings.metadata || {};

    // Initialize Ollama manager
    ollamaManager = getOllamaManager();
    ollamaManager.setProgressCallback((stage, percent, message) => {
      if (mainWindow) {
        mainWindow.webContents.send('ollama-progress', { stage, percent, message });
      }
    });

    // Check if Ollama is installed and start it
    if (ollamaManager.isInstalled()) {
      logger.info('metadata', 'Ollama found, starting server...');
      const started = await ollamaManager.start();
      if (started) {
        // Ensure model is available
        const hasModel = await ollamaManager.hasModel(metadataSettings.ollamaModel || 'llama3.2');
        if (!hasModel) {
          logger.info('metadata', 'Model not found, will pull on first use');
        }
      }
    } else {
      logger.info('metadata', 'Ollama not installed, will install on first use');
    }

    // Initialize TMDB client
    tmdbClient = getTMDBClient();
    // Check for TMDB API key at top level (new) or nested in metadata (legacy)
    const tmdbApiKey = settings.tmdbApiKey || metadataSettings.tmdbApiKey;
    if (tmdbApiKey) {
      tmdbClient.setApiKey(tmdbApiKey);
      logger.info('metadata', 'TMDB API key configured');
    } else {
      logger.info('metadata', 'TMDB API key not configured');
    }

    // Initialize disc identifier
    discIdentifier = getDiscIdentifier();

    // Initialize metadata watcher (if enabled)
    if (metadataSettings.enabled !== false) {
      const backupPath = path.join(makemkv.basePath, 'backup');
      metadataWatcher = getMetadataWatcher(backupPath, {
        intervalMs: metadataSettings.watcherIntervalMs || 30000,
        onPending: async (backup) => {
          // Check if Live Dangerously mode is enabled - auto-approve EVERYTHING regardless of confidence
          const settings = await makemkv.getSettings();
          if (settings.automation?.liveDangerously) {
            try {
              const fullBackupPath = path.join(backupPath, backup.name);
              const metadata = await discIdentifier.loadMetadata(fullBackupPath);
              const confidence = metadata?.llmGuess?.confidence || 0;

              logger.info('metadata', `[LiveDangerously] Auto-approving ${backup.name} regardless of confidence (${(confidence * 100).toFixed(0)}%)`);
              const result = await discIdentifier.approve(fullBackupPath);
              if (result.success && exportWatcher) {
                exportWatcher.queueExport(backup.name, fullBackupPath, metadata);
                logger.info('export', `[LiveDangerously] Auto-queued ${backup.name} for export`);
              }
            } catch (err) {
              logger.error('metadata', `[LiveDangerously] Auto-approve failed for ${backup.name}`, err);
            }
          }
          // Always notify UI
          if (mainWindow) {
            mainWindow.webContents.send('metadata-pending', backup);
          }
        },
        onError: (error, backupName) => {
          logger.error('metadata', `Identification error for ${backupName}: ${error}`);
        }
      });
      metadataWatcher.setOnProgress((stage, percent, message) => {
        if (mainWindow) {
          mainWindow.webContents.send('ollama-progress', { stage, percent, message });
        }
      });
      metadataWatcher.start();
      logger.info('metadata', 'Metadata watcher started');

      // Initialize export watcher (auto-export on approval)
      exportWatcher = getExportWatcher({
        backupPath,
        makemkvPath: makemkv.makemkvPath,
        getSettings: async () => makemkv.getSettings(),
        onProgress: (data) => {
          if (mainWindow) {
            mainWindow.webContents.send('export-progress', data);
          }
        },
        onLog: (data) => {
          if (mainWindow) {
            mainWindow.webContents.send('export-log', data);
          }
        },
        onComplete: (data) => {
          if (mainWindow) {
            mainWindow.webContents.send('export-complete', data);
          }
          // Show desktop notification for successful export
          showNotification(
            'Export Complete',
            `${data.name} has been exported successfully.`,
            'success'
          );
        },
        onError: (data) => {
          if (mainWindow) {
            mainWindow.webContents.send('export-error', data);
          }
          // Show desktop notification for failed export
          showNotification(
            'Export Failed',
            `${data.name}: ${data.error}`,
            'error'
          );
        },
        onWaiting: (data) => {
          if (mainWindow) {
            mainWindow.webContents.send('export-waiting', data);
          }
          // Show notification about waiting disc
          showNotification(
            'Disc Waiting',
            `${data.name} is waiting for disc(s) ${data.missingDiscs?.join(', ') || 'unknown'} to be processed first.`,
            'info'
          );
        }
      });
      exportWatcher.start();
      logger.info('export', 'Export watcher started');
    }

    logger.info('metadata', 'Metadata system initialized');
  } catch (error) {
    logger.error('metadata', 'Failed to initialize metadata system', error);
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Cleanup on quit
app.on('before-quit', async () => {
  logger.info('app', 'Shutting down...');

  // Stop metadata watcher
  if (metadataWatcher) {
    metadataWatcher.stop();
  }

  // Stop Ollama server (if we started it)
  if (ollamaManager) {
    try {
      await ollamaManager.stop();
    } catch (error) {
      logger.error('app', 'Error stopping Ollama', error);
    }
  }

  logger.info('app', 'Cleanup complete');
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
  ipcMain.handle('start-backup', async (event, driveId, makemkvIndex, discName, discSize, driveLetter) => {
    // Check if already running for this drive
    if (runningBackups.has(driveId)) {
      logger.warn('start-backup', `Backup already running for drive ${driveId}`);
      return { success: false, error: 'Backup already running for this drive' };
    }

    logger.info('start-backup', `Starting parallel backup for ${discName} (disc:${makemkvIndex})`, {
      driveId,
      makemkvIndex,
      discSize,
      driveLetter,
      totalRunning: runningBackups.size
    });

    // FINGERPRINTING: Capture disc fingerprint BEFORE MakeMKV runs
    // This is critical because MakeMKV extraction modifies file timestamps
    let fingerprint = null;
    if (driveLetter) {
      try {
        logger.info('start-backup', `Capturing fingerprint from ${driveLetter}...`);
        fingerprint = await generateFingerprint(driveLetter, discName);

        // Check ARM database for matches
        if (fingerprint.crc64) {
          const armDb = getARMDatabase();
          const armMatch = await armDb.lookup(fingerprint.crc64);
          if (armMatch) {
            fingerprint.armMatch = armMatch;
            logger.info('start-backup', `ARM database match: "${armMatch.title}" (${armMatch.year})`);
            mainWindow.webContents.send('fingerprint-match', { driveId, match: armMatch });
          }
        }

        if (hasUsefulFingerprint(fingerprint)) {
          logger.info('start-backup', `Fingerprint captured: ${fingerprint.type}`, {
            crc64: fingerprint.crc64 || null,
            contentId: fingerprint.contentId || null,
            embeddedTitle: fingerprint.embeddedTitle || null
          });
        }
      } catch (error) {
        logger.warn('start-backup', `Fingerprint capture failed: ${error.message}`);
        fingerprint = { type: 'unknown', error: error.message, capturedAt: new Date().toISOString() };
      }
    } else {
      logger.warn('start-backup', 'No drive letter provided, skipping fingerprint capture');
    }

    // Notify UI that backup is starting (include fingerprint info)
    mainWindow.webContents.send('backup-started', { driveId, fingerprint });

    // Create new MakeMKV adapter for this backup
    const makemkv = new MakeMKVAdapter();
    await makemkv.loadSettings();

    // Track this backup (include fingerprint and driveLetter for eject)
    runningBackups.set(driveId, { makemkv, discName, fingerprint, driveLetter });

    // Run backup in background (don't await - let it run parallel)
    runBackup(driveId, makemkv, makemkvIndex, discName, discSize, fingerprint, driveLetter);

    // Return immediately - progress comes via IPC events
    return { success: true, driveId, started: true, fingerprint };
  });

  // Run a single backup (called in parallel for each drive)
  async function runBackup(driveId, makemkv, makemkvIndex, discName, discSize, fingerprint = null, driveLetter = null) {
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

      // Store fingerprint with metadata after successful backup
      if (fingerprint && !fingerprint.error && result.path && discIdentifier) {
        try {
          logger.info('start-backup', `Storing fingerprint with metadata for ${discName}`);

          // Load or create metadata
          let metadata = await discIdentifier.loadMetadata(result.path);
          if (!metadata) {
            metadata = createEmptyMetadata({ volumeLabel: discName });
          }

          // Store fingerprint data
          metadata.fingerprint = {
            type: fingerprint.type || null,
            capturedAt: fingerprint.capturedAt || new Date().toISOString(),
            crc64: fingerprint.crc64 || null,
            contentId: fingerprint.contentId || null,
            discId: fingerprint.discId || null,
            organizationId: fingerprint.organizationId || null,
            embeddedTitle: fingerprint.embeddedTitle || null,
            armMatch: fingerprint.armMatch || null
          };

          await discIdentifier.saveMetadata(result.path, metadata);
          logger.info('start-backup', `Fingerprint stored for ${discName}`);

          // If we have an ARM match, add to cache for future discs
          if (fingerprint.crc64 && fingerprint.armMatch) {
            const armDb = getARMDatabase();
            await armDb.addToCache(fingerprint.crc64, fingerprint.armMatch);
          }
        } catch (metaError) {
          logger.warn('start-backup', `Failed to store fingerprint: ${metaError.message}`);
        }
      }

      // Auto-identify the backup (runs in background, doesn't block completion)
      if (discIdentifier && result.path) {
        try {
          logger.info('start-backup', `Starting auto-identification for ${discName}`);
          // Run identification asynchronously - don't await to avoid blocking
          discIdentifier.identify(result.path, discName)
            .then(identifyResult => {
              if (identifyResult.success) {
                logger.info('start-backup', `Auto-identification completed for ${discName}`, {
                  title: identifyResult.metadata?.final?.title || identifyResult.metadata?.llmGuess?.title
                });
                // Notify renderer of metadata update
                if (mainWindow && !mainWindow.isDestroyed()) {
                  mainWindow.webContents.send('metadata-updated', { path: result.path });
                }
              } else {
                logger.warn('start-backup', `Auto-identification failed for ${discName}: ${identifyResult.error}`);
              }
            })
            .catch(err => {
              logger.error('start-backup', `Auto-identification error for ${discName}`, err);
            });
        } catch (identifyError) {
          logger.warn('start-backup', `Failed to start auto-identification: ${identifyError.message}`);
        }
      }

      // Send completion event
      console.log(`[IPC] Sending backup-complete for driveId=${driveId}, success=true`);
      logger.info('start-backup', `Sending backup-complete IPC event`, { driveId, success: true });
      mainWindow.webContents.send('backup-complete', {
        driveId,
        success: true,
        fingerprint,
        ...result
      });

      // Show desktop notification for successful backup
      showNotification(
        'Backup Complete',
        `${discName} has been successfully backed up.`,
        'success'
      );

      // Auto-eject disc if enabled
      if (driveLetter) {
        try {
          const settings = await makemkv.getSettings();
          if (settings.automation?.ejectAfterBackup) {
            logger.info('start-backup', `Auto-ejecting disc from ${driveLetter}`);
            const ejectResult = await driveDetector.ejectDrive(driveLetter);
            if (ejectResult.success) {
              showNotification('Disc Ejected', `${driveLetter} has been ejected.`);
            } else {
              logger.warn('start-backup', `Failed to eject ${driveLetter}: ${ejectResult.error}`);
            }
          }
        } catch (ejectError) {
          logger.warn('start-backup', `Eject error: ${ejectError.message}`);
        }
      }

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

      // Show desktop notification for failed backup
      showNotification(
        'Backup Failed',
        `${discName}: ${error.message}`,
        'error'
      );

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

      // Update TMDB client with new API key if provided
      if (tmdbClient && settings.tmdbApiKey !== undefined) {
        tmdbClient.setApiKey(settings.tmdbApiKey);
        logger.info('settings', 'TMDB API key updated');
      }

      return { success: true };
    } catch (error) {
      logger.error('settings', 'Failed to save settings', error);
      return { success: false, error: error.message };
    }
  });

  // Fetch latest MakeMKV beta key from forum
  ipcMain.handle('fetch-makemkv-key', async () => {
    try {
      const makemkv = await getSharedMakeMKV();
      const result = await makemkv.fetchLatestKey();
      return result;
    } catch (error) {
      logger.error('settings', 'Failed to fetch MakeMKV key', error);
      return { success: false, error: error.message };
    }
  });

  // Apply MakeMKV key to Windows registry
  ipcMain.handle('apply-makemkv-key', async (event, key) => {
    try {
      const makemkv = await getSharedMakeMKV();
      const result = await makemkv.applyMakeMKVKey(key);
      return result;
    } catch (error) {
      logger.error('settings', 'Failed to apply MakeMKV key', error);
      return { success: false, error: error.message };
    }
  });

  // Get current MakeMKV key from Windows registry
  ipcMain.handle('get-makemkv-registry-key', async () => {
    try {
      const makemkv = await getSharedMakeMKV();
      const result = await makemkv.getMakeMKVKeyFromRegistry();
      return result;
    } catch (error) {
      logger.error('settings', 'Failed to get MakeMKV registry key', error);
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

  // ============================================
  // METADATA SYSTEM IPC HANDLERS
  // ============================================

  // Get all backups with metadata status
  ipcMain.handle('get-all-backups', async () => {
    try {
      if (!metadataWatcher) {
        return { success: false, error: 'Metadata watcher not initialized' };
      }
      const backups = await metadataWatcher.getAllBackups();
      return { success: true, backups };
    } catch (error) {
      logger.error('metadata', 'Failed to get all backups', error);
      return { success: false, error: error.message };
    }
  });

  // Get metadata for a specific backup
  ipcMain.handle('get-backup-metadata', async (event, backupName) => {
    try {
      if (!discIdentifier) {
        return { success: false, error: 'Disc identifier not initialized' };
      }
      const makemkv = await getSharedMakeMKV();
      const backupPath = path.join(makemkv.basePath, 'backup', backupName);
      const metadata = await discIdentifier.loadMetadata(backupPath);
      return { success: true, metadata };
    } catch (error) {
      logger.error('metadata', `Failed to get metadata for ${backupName}`, error);
      return { success: false, error: error.message };
    }
  });

  // Manually trigger identification for a backup
  ipcMain.handle('identify-backup', async (event, backupName) => {
    try {
      if (!metadataWatcher) {
        return { success: false, error: 'Metadata watcher not initialized' };
      }
      const result = await metadataWatcher.identifyBackup(backupName);
      return result;
    } catch (error) {
      logger.error('metadata', `Failed to identify ${backupName}`, error);
      return { success: false, error: error.message };
    }
  });

  // Re-identify a backup (force refresh)
  ipcMain.handle('reidentify-backup', async (event, backupName) => {
    try {
      if (!metadataWatcher) {
        return { success: false, error: 'Metadata watcher not initialized' };
      }
      const result = await metadataWatcher.reidentify(backupName);
      return result;
    } catch (error) {
      logger.error('metadata', `Failed to reidentify ${backupName}`, error);
      return { success: false, error: error.message };
    }
  });

  // Approve metadata (user confirms it's correct)
  // This also triggers the automatic export workflow
  ipcMain.handle('approve-metadata', async (event, backupName) => {
    try {
      if (!discIdentifier) {
        return { success: false, error: 'Disc identifier not initialized' };
      }
      const makemkv = await getSharedMakeMKV();
      const backupPath = path.join(makemkv.basePath, 'backup', backupName);
      const result = await discIdentifier.approve(backupPath);

      // If approval succeeded and export watcher is active, queue for export
      if (result.success && exportWatcher) {
        const metadata = await discIdentifier.loadMetadata(backupPath);
        exportWatcher.queueExport(backupName, backupPath, metadata);
        logger.info('export', `Queued ${backupName} for automatic export`);
      }

      return result;
    } catch (error) {
      logger.error('metadata', `Failed to approve ${backupName}`, error);
      return { success: false, error: error.message };
    }
  });

  // Update metadata manually
  ipcMain.handle('update-metadata', async (event, backupName, updates) => {
    try {
      if (!discIdentifier) {
        return { success: false, error: 'Disc identifier not initialized' };
      }
      const makemkv = await getSharedMakeMKV();
      const backupPath = path.join(makemkv.basePath, 'backup', backupName);
      const result = await discIdentifier.update(backupPath, updates);
      return result;
    } catch (error) {
      logger.error('metadata', `Failed to update ${backupName}`, error);
      return { success: false, error: error.message };
    }
  });

  // Select a TMDB candidate
  ipcMain.handle('select-tmdb-candidate', async (event, backupName, tmdbId, mediaType) => {
    try {
      if (!discIdentifier) {
        return { success: false, error: 'Disc identifier not initialized' };
      }
      const makemkv = await getSharedMakeMKV();
      const backupPath = path.join(makemkv.basePath, 'backup', backupName);
      const result = await discIdentifier.selectCandidate(backupPath, tmdbId, mediaType);
      return result;
    } catch (error) {
      logger.error('metadata', `Failed to select candidate for ${backupName}`, error);
      return { success: false, error: error.message };
    }
  });

  // Search TMDB
  ipcMain.handle('search-tmdb', async (event, query, year = null) => {
    try {
      if (!tmdbClient) {
        return { success: false, error: 'TMDB client not initialized' };
      }
      if (!tmdbClient.hasApiKey()) {
        return { success: false, error: 'TMDB API key not configured' };
      }
      const results = await tmdbClient.searchMulti(query, year);
      return { success: true, results };
    } catch (error) {
      logger.error('metadata', `TMDB search failed for "${query}"`, error);
      return { success: false, error: error.message };
    }
  });

  // Get TMDB details
  ipcMain.handle('get-tmdb-details', async (event, tmdbId, mediaType) => {
    try {
      if (!tmdbClient) {
        return { success: false, error: 'TMDB client not initialized' };
      }
      if (!tmdbClient.hasApiKey()) {
        return { success: false, error: 'TMDB API key not configured' };
      }
      const details = await tmdbClient.getDetails(tmdbId, mediaType);
      return { success: true, details };
    } catch (error) {
      logger.error('metadata', `TMDB details failed for ${mediaType}/${tmdbId}`, error);
      return { success: false, error: error.message };
    }
  });

  // Get TV season details (episodes list)
  ipcMain.handle('get-tv-season-details', async (event, tvId, seasonNumber) => {
    try {
      if (!tmdbClient) {
        return { success: false, error: 'TMDB client not initialized' };
      }
      if (!tmdbClient.hasApiKey()) {
        return { success: false, error: 'TMDB API key not configured' };
      }
      const season = await tmdbClient.getTVSeasonDetails(tvId, seasonNumber);
      return { success: true, season };
    } catch (error) {
      logger.error('metadata', `TMDB season details failed for tv/${tvId}/season/${seasonNumber}`, error);
      return { success: false, error: error.message };
    }
  });

  // Get Ollama status
  ipcMain.handle('get-ollama-status', async () => {
    try {
      if (!ollamaManager) {
        return { success: true, status: { installed: false, running: false, hasModel: false } };
      }
      const status = await ollamaManager.getStatus();
      return { success: true, status };
    } catch (error) {
      logger.error('metadata', 'Failed to get Ollama status', error);
      return { success: false, error: error.message };
    }
  });

  // Install Ollama
  ipcMain.handle('install-ollama', async () => {
    try {
      if (!ollamaManager) {
        return { success: false, error: 'Ollama manager not initialized' };
      }
      const result = await ollamaManager.install();
      return { success: result };
    } catch (error) {
      logger.error('metadata', 'Failed to install Ollama', error);
      return { success: false, error: error.message };
    }
  });

  // Start Ollama
  ipcMain.handle('start-ollama', async () => {
    try {
      if (!ollamaManager) {
        return { success: false, error: 'Ollama manager not initialized' };
      }
      const result = await ollamaManager.start();
      return { success: result };
    } catch (error) {
      logger.error('metadata', 'Failed to start Ollama', error);
      return { success: false, error: error.message };
    }
  });

  // Pull Ollama model
  ipcMain.handle('pull-ollama-model', async (event, modelName) => {
    try {
      if (!ollamaManager) {
        return { success: false, error: 'Ollama manager not initialized' };
      }
      const result = await ollamaManager.ensureModel(modelName);
      return { success: result };
    } catch (error) {
      logger.error('metadata', `Failed to pull model ${modelName}`, error);
      return { success: false, error: error.message };
    }
  });

  // Get metadata watcher queue status
  ipcMain.handle('get-metadata-queue', async () => {
    try {
      if (!metadataWatcher) {
        return { success: true, queue: { queueLength: 0, processing: null, isScanning: false } };
      }
      const queue = metadataWatcher.getQueueStatus();
      return { success: true, queue };
    } catch (error) {
      logger.error('metadata', 'Failed to get queue status', error);
      return { success: false, error: error.message };
    }
  });

  // Force scan for new backups
  ipcMain.handle('scan-backups', async () => {
    try {
      if (!metadataWatcher) {
        return { success: false, error: 'Metadata watcher not initialized' };
      }
      const results = await metadataWatcher.scanOnce();
      return { success: true, found: results.length };
    } catch (error) {
      logger.error('metadata', 'Failed to scan backups', error);
      return { success: false, error: error.message };
    }
  });

  // Validate TMDB API key
  ipcMain.handle('validate-tmdb-key', async (event, apiKey) => {
    try {
      if (!tmdbClient) {
        return { success: false, error: 'TMDB client not initialized' };
      }
      // Temporarily set the key to test it
      const originalKey = tmdbClient.apiKey;
      tmdbClient.setApiKey(apiKey);
      const valid = await tmdbClient.validateApiKey();
      // Restore original if validation failed
      if (!valid) {
        tmdbClient.setApiKey(originalKey);
      }
      return { success: true, valid };
    } catch (error) {
      logger.error('metadata', 'TMDB key validation failed', error);
      return { success: false, error: error.message };
    }
  });

  // ============================================
  // EMBY EXPORT SYSTEM IPC HANDLERS
  // ============================================

  // Get or create EmbyExporter instance
  async function getEmbyExporter() {
    if (!embyExporter) {
      const makemkv = await getSharedMakeMKV();
      embyExporter = new EmbyExporter(makemkv.makemkvPath);
    }
    return embyExporter;
  }

  // Scan backup for available titles
  ipcMain.handle('emby-scan-titles', async (event, backupName) => {
    try {
      const makemkv = await getSharedMakeMKV();
      const backupPath = path.join(makemkv.basePath, 'backup', backupName);
      const exporter = await getEmbyExporter();

      logger.info('emby', `Scanning titles for: ${backupName}`);
      const result = await exporter.scanTitles(backupPath);
      return { success: true, ...result };
    } catch (error) {
      logger.error('emby', `Failed to scan titles for ${backupName}`, error);
      return { success: false, error: error.message };
    }
  });

  // Export backup to Emby library
  ipcMain.handle('emby-export', async (event, options) => {
    try {
      const { backupName, titleIndex, mediaType, tvInfo } = options;
      const makemkv = await getSharedMakeMKV();
      const settings = await makemkv.getSettings();

      // Validate Emby settings
      const embySettings = settings.emby || {};
      const libraryPath = mediaType === 'tv'
        ? embySettings.tvPath
        : embySettings.moviePath;

      if (!libraryPath) {
        return {
          success: false,
          error: `Emby ${mediaType} library path not configured. Please set it in Settings.`
        };
      }

      const backupPath = path.join(makemkv.basePath, 'backup', backupName);

      // Load metadata for proper naming
      let metadata = null;
      if (discIdentifier) {
        metadata = await discIdentifier.loadMetadata(backupPath);
      }
      if (!metadata) {
        metadata = { final: { title: backupName }, disc: { volumeLabel: backupName } };
      }

      const exporter = await getEmbyExporter();
      currentEmbyExport = exporter;

      logger.info('emby', `Starting export: ${backupName} -> ${libraryPath}`);

      const result = await exporter.exportToEmby(
        {
          backupPath,
          titleIndex,
          metadata,
          embyLibraryPath: libraryPath,
          mediaType,
          tvInfo
        },
        (progress) => {
          if (mainWindow) {
            mainWindow.webContents.send('emby-progress', {
              backupName,
              ...progress
            });
          }
        },
        (message) => {
          if (mainWindow) {
            mainWindow.webContents.send('emby-log', {
              backupName,
              message
            });
          }
          logger.debug('emby-export', message);
        }
      );

      currentEmbyExport = null;
      logger.info('emby', `Export complete: ${result.embyPath}`);

      return { success: true, ...result };
    } catch (error) {
      currentEmbyExport = null;
      logger.error('emby', 'Export failed', error);
      return { success: false, error: error.message };
    }
  });

  // Cancel current Emby export
  ipcMain.handle('emby-cancel', async () => {
    try {
      if (currentEmbyExport) {
        currentEmbyExport.cancel();
        currentEmbyExport = null;
        logger.info('emby', 'Export cancelled');
        return { success: true };
      }
      return { success: true, wasNotRunning: true };
    } catch (error) {
      logger.error('emby', 'Failed to cancel export', error);
      return { success: false, error: error.message };
    }
  });

  // Get Emby export preview (what path/name will be used)
  ipcMain.handle('emby-preview', async (event, options) => {
    try {
      const { backupName, mediaType, tvInfo } = options;
      const makemkv = await getSharedMakeMKV();
      const settings = await makemkv.getSettings();
      const embySettings = settings.emby || {};

      const libraryPath = mediaType === 'tv'
        ? embySettings.tvPath
        : embySettings.moviePath;

      if (!libraryPath) {
        return {
          success: false,
          error: `Emby ${mediaType} library path not configured`
        };
      }

      const backupPath = path.join(makemkv.basePath, 'backup', backupName);

      // Load metadata
      let metadata = null;
      if (discIdentifier) {
        metadata = await discIdentifier.loadMetadata(backupPath);
      }
      if (!metadata) {
        metadata = { final: { title: backupName }, disc: { volumeLabel: backupName } };
      }

      const exporter = await getEmbyExporter();
      const preview = exporter.generateEmbyPath({
        title: metadata.final?.title || metadata.disc?.volumeLabel || backupName,
        year: metadata.final?.year || null,
        tmdbId: metadata.tmdb?.id || null,
        mediaType,
        tvInfo,
        embyLibraryPath: libraryPath
      });

      return {
        success: true,
        ...preview,
        fullPath: path.join(preview.folderPath, preview.fileName)
      };
    } catch (error) {
      logger.error('emby', 'Preview failed', error);
      return { success: false, error: error.message };
    }
  });

  // ============================================
  // TRANSFER SYSTEM IPC HANDLERS
  // ============================================

  // Test transfer connection
  ipcMain.handle('test-transfer-connection', async (event, config) => {
    try {
      const transferManager = getTransferManager();
      const result = await transferManager.testConnection(config);
      logger.info('transfer', `Connection test: ${result.success ? 'success' : 'failed'} - ${result.message}`);
      return result;
    } catch (error) {
      logger.error('transfer', 'Connection test error', error);
      return { success: false, message: error.message };
    }
  });

  // Get export queue status
  ipcMain.handle('get-export-queue-status', async () => {
    if (!exportWatcher) {
      return { success: true, status: { queueLength: 0, processing: null, queue: [] } };
    }
    return { success: true, status: exportWatcher.getQueueStatus() };
  });

  // Manual export - queue a specific backup for export
  ipcMain.handle('queue-export', async (event, backupName) => {
    try {
      if (!exportWatcher) {
        return { success: false, error: 'Export watcher not initialized' };
      }

      // Get the backup path and metadata
      const makemkv = await getSharedMakeMKV();
      const settings = await makemkv.getSettings();
      const backupPath = path.join(settings.basePath, 'backup', backupName);
      const metadata = await discIdentifier.loadMetadata(backupPath);

      if (!metadata) {
        return { success: false, error: 'No metadata found for this backup' };
      }

      // Update status to approved if not already (for re-export)
      if (metadata.status === 'exported') {
        await discIdentifier.update(backupPath, {
          status: MetadataStatus.APPROVED
        });
        // Reload metadata
        const updatedMetadata = await discIdentifier.loadMetadata(backupPath);
        exportWatcher.queueExport(backupName, backupPath, updatedMetadata);
      } else if (metadata.status === 'approved' || metadata.status === 'manual') {
        exportWatcher.queueExport(backupName, backupPath, metadata);
      } else {
        return { success: false, error: `Cannot export backup with status: ${metadata.status}. Approve the metadata first.` };
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Cancel current export
  ipcMain.handle('cancel-export', async () => {
    if (!exportWatcher) {
      return { success: false, error: 'Export watcher not initialized' };
    }
    exportWatcher.cancel();
    return { success: true };
  });

  // Get TV series batch status (for parallel processing UI)
  ipcMain.handle('get-series-batch-status', async () => {
    if (!exportWatcher) {
      return { success: true, status: null };
    }
    try {
      const status = await exportWatcher.getSeriesBatchStatus();
      return { success: true, status };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Trigger parallel batch export for a specific series
  ipcMain.handle('trigger-parallel-export', async (event, seriesKey) => {
    if (!exportWatcher) {
      return { success: false, error: 'Export watcher not initialized' };
    }
    try {
      const batches = await exportWatcher.scanForTVBatches();
      if (!batches || !batches[seriesKey]) {
        return { success: false, error: `Series "${seriesKey}" not found` };
      }
      await exportWatcher.processParallelBatch(batches[seriesKey]);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ============================================
  // DELETE AND RESTART BACKUP IPC HANDLER
  // ============================================

  // Delete existing backup and restart fresh (Re-Do functionality)
  ipcMain.handle('delete-and-restart-backup', async (event, driveId, makemkvIndex, discName, discSize, driveLetter) => {
    try {
      // Security: Validate disc name to prevent path traversal
      const safeName = sanitizeBackupName(discName);
      logger.info('delete-restart', `Deleting existing backup for ${safeName} to restart fresh`);

      const makemkv = await getSharedMakeMKV();
      const backupPath = path.join(makemkv.basePath, 'backup', safeName);
      const tempPath = path.join(makemkv.basePath, 'temp', safeName);

      // Delete existing backup folder if exists
      const backupExists = await fs.access(backupPath).then(() => true).catch(() => false);
      if (backupExists) {
        logger.info('delete-restart', `Deleting backup: ${backupPath}`);
        await fs.rm(backupPath, { recursive: true, force: true });
      }

      // Delete temp folder if exists
      const tempExists = await fs.access(tempPath).then(() => true).catch(() => false);
      if (tempExists) {
        logger.info('delete-restart', `Deleting temp: ${tempPath}`);
        await fs.rm(tempPath, { recursive: true, force: true });
      }

      logger.info('delete-restart', `Existing backup deleted, starting fresh backup for ${discName}`);

      // Now start the backup normally (same logic as start-backup handler)
      if (runningBackups.has(driveId)) {
        return { success: false, error: 'Backup already running for this drive' };
      }

      // Fingerprinting before backup
      let fingerprint = null;
      if (driveLetter) {
        try {
          fingerprint = await generateFingerprint(driveLetter, discName);
          if (fingerprint.crc64) {
            const armDb = getARMDatabase();
            const armMatch = await armDb.lookup(fingerprint.crc64);
            if (armMatch) {
              fingerprint.armMatch = armMatch;
            }
          }
        } catch (error) {
          fingerprint = { type: 'unknown', error: error.message, capturedAt: new Date().toISOString() };
        }
      }

      // Notify UI
      mainWindow.webContents.send('backup-started', { driveId, fingerprint });

      // Create new adapter and start backup
      const backupMakemkv = new MakeMKVAdapter();
      await backupMakemkv.loadSettings();
      runningBackups.set(driveId, { makemkv: backupMakemkv, discName, fingerprint });

      // Run backup in background
      runBackup(driveId, backupMakemkv, makemkvIndex, discName, discSize, fingerprint);

      return { success: true, driveId, started: true, deleted: true };
    } catch (error) {
      logger.error('delete-restart', `Failed to delete and restart backup for ${discName}`, error);
      return { success: false, error: error.message };
    }
  });

  // Delete a backup (for manual cleanup from UI)
  ipcMain.handle('delete-backup', async (event, backupName) => {
    try {
      // Security: Validate backup name to prevent path traversal
      const safeName = sanitizeBackupName(backupName);
      logger.info('delete-backup', `Deleting backup: ${safeName}`);

      const makemkv = await getSharedMakeMKV();
      const backupPath = path.join(makemkv.basePath, 'backup', safeName);

      const exists = await fs.access(backupPath).then(() => true).catch(() => false);
      if (!exists) {
        return { success: false, error: 'Backup not found' };
      }

      await fs.rm(backupPath, { recursive: true, force: true });
      logger.info('delete-backup', `Deleted backup: ${backupPath}`);

      return { success: true };
    } catch (error) {
      logger.error('delete-backup', `Failed to delete backup ${backupName}`, error);
      return { success: false, error: error.message };
    }
  });

  // ============================================
  // AUTOMATION TOGGLE IPC HANDLERS
  // ============================================

  // Get automation settings
  ipcMain.handle('get-automation', async () => {
    try {
      const makemkv = await getSharedMakeMKV();
      const settings = await makemkv.getSettings();
      return {
        success: true,
        automation: settings.automation || { autoBackup: false, autoMeta: true, autoExport: false, liveDangerously: false, ejectAfterBackup: false }
      };
    } catch (error) {
      logger.error('automation', 'Failed to get automation settings', error);
      return { success: false, error: error.message };
    }
  });

  // Toggle a specific automation setting
  ipcMain.handle('toggle-automation', async (event, key) => {
    try {
      const makemkv = await getSharedMakeMKV();
      const settings = await makemkv.getSettings();
      const automation = settings.automation || { autoBackup: false, autoMeta: true, autoExport: false, autoApproveAll: false, ejectAfterBackup: false, autoApproveThreshold: 0.70 };

      // Toggle the specified key (only boolean keys can be toggled)
      if (key in automation && typeof automation[key] === 'boolean') {
        automation[key] = !automation[key];
        await makemkv.saveSettings({ ...settings, automation });
        logger.info('automation', `Toggled ${key} to ${automation[key]}`);
        return { success: true, automation };
      } else {
        return { success: false, error: `Unknown automation key: ${key}` };
      }
    } catch (error) {
      logger.error('automation', `Failed to toggle ${key}`, error);
      return { success: false, error: error.message };
    }
  });

  // Set all automation settings at once
  ipcMain.handle('set-automation', async (event, automation) => {
    try {
      const makemkv = await getSharedMakeMKV();
      const settings = await makemkv.getSettings();
      await makemkv.saveSettings({ ...settings, automation });
      logger.info('automation', 'Updated automation settings', automation);
      return { success: true, automation };
    } catch (error) {
      logger.error('automation', 'Failed to set automation settings', error);
      return { success: false, error: error.message };
    }
  });

  // ===========================================
  // Library Fixer IPC Handlers
  // ===========================================

  // Fix movie library naming and add NFO files
  ipcMain.handle('fix-movie-library', async (event, options = {}) => {
    try {
      const makemkv = await getSharedMakeMKV();
      const settings = await makemkv.getSettings();

      // Get library path from transfer settings
      const libraryPath = settings.transfer?.moviePath;
      if (!libraryPath) {
        throw new Error('No movie library path configured in Transfer Settings');
      }

      // Get TMDB API key for metadata lookup
      const tmdbApiKey = settings.tmdbApiKey;

      // Create library fixer with TMDB client
      const fixer = new LibraryFixer(tmdbApiKey);

      logger.info('library-fixer', `Starting movie library fix: ${libraryPath}`);

      // Send progress updates to renderer
      const onProgress = (progress) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('library-fix-progress', {
            type: 'movie',
            ...progress
          });
        }
      };

      const onLog = (message) => {
        logger.info('library-fixer', message);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('library-fix-log', message);
        }
      };

      const results = await fixer.fixMovieLibrary(libraryPath, {
        dryRun: options.dryRun || false,
        onProgress,
        onLog
      });

      return { success: true, results };
    } catch (error) {
      logger.error('library-fixer', `Failed to fix movie library: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  // Fix TV library naming and add NFO files
  ipcMain.handle('fix-tv-library', async (event, options = {}) => {
    try {
      const makemkv = await getSharedMakeMKV();
      const settings = await makemkv.getSettings();

      // Get TV library path from transfer settings
      const libraryPath = settings.transfer?.tvPath;
      if (!libraryPath) {
        throw new Error('No TV library path configured in Transfer Settings');
      }

      const tmdbApiKey = settings.tmdbApiKey;
      const fixer = new LibraryFixer(tmdbApiKey);

      logger.info('library-fixer', `Starting TV library fix: ${libraryPath}`);

      const onProgress = (progress) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('library-fix-progress', {
            type: 'tv',
            ...progress
          });
        }
      };

      const onLog = (message) => {
        logger.info('library-fixer', message);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('library-fix-log', message);
        }
      };

      const results = await fixer.fixTvLibrary(libraryPath, {
        dryRun: options.dryRun || false,
        onProgress,
        onLog
      });

      return { success: true, results };
    } catch (error) {
      logger.error('library-fixer', `Failed to fix TV library: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  // Preview library changes (dry run)
  ipcMain.handle('preview-library-fix', async (event, libraryType = 'movie') => {
    try {
      const makemkv = await getSharedMakeMKV();
      const settings = await makemkv.getSettings();

      let libraryPath;
      if (libraryType === 'tv') {
        libraryPath = settings.transfer?.tvPath;
      } else {
        libraryPath = settings.transfer?.moviePath;
      }

      if (!libraryPath) {
        throw new Error(`No ${libraryType} library path configured in Transfer Settings`);
      }

      const tmdbApiKey = settings.tmdbApiKey;
      const fixer = new LibraryFixer(tmdbApiKey);

      logger.info('library-fixer', `Previewing ${libraryType} library fix: ${libraryPath}`);

      const onLog = (message) => {
        logger.debug('library-fixer-preview', message);
      };

      let results;
      if (libraryType === 'tv') {
        results = await fixer.fixTvLibrary(libraryPath, { dryRun: true, onLog });
      } else {
        results = await fixer.fixMovieLibrary(libraryPath, { dryRun: true, onLog });
      }

      return { success: true, results, libraryPath };
    } catch (error) {
      logger.error('library-fixer', `Failed to preview library fix: ${error.message}`);
      return { success: false, error: error.message };
    }
  });
}
