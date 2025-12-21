// IPC handlers for communication between main and renderer processes

import { ipcMain, shell } from 'electron';
import path from 'path';
import { promises as fs } from 'fs';
import logger from './logger.js';
import { getSharedMakeMKV, sanitizeBackupName } from './utils.js';
import { getMainWindow } from './window-manager.js';
import {
  getDriveDetector,
  startBackup as startBackupManager,
  cancelBackup as cancelBackupManager,
  isBackupRunning
} from './backup-manager.js';
import {
  getOllama,
  getTMDB,
  getIdentifier,
  getWatcher,
  getExportWatcherInstance
} from './metadata-system.js';
import { MetadataStatus } from './metadata/schemas.js';
import { EmbyExporter } from './emby.js';
import { LibraryFixer } from './libraryFixer.js';
import { getTransferManager } from './transfer.js';
import { generateFingerprint } from './metadata/fingerprint.js';
import { getARMDatabase } from './metadata/arm-database.js';

// Emby export globals
let embyExporter = null;
let currentEmbyExport = null;

/**
 * Set up all Inter-Process Communication (IPC) handlers
 */
export function setupIPC() {
  setupDiagnosticHandlers();
  setupDriveHandlers();
  setupBackupHandlers();
  setupSettingsHandlers();
  setupPerformanceHandlers();
  setupLogsHandlers();
  setupMetadataHandlers();
  setupEmbyHandlers();
  setupTransferHandlers();
  setupAutomationHandlers();
  setupLibraryFixerHandlers();
  setupCredentialHandlers();
  setupAIProviderHandlers();
}

/**
 * Diagnostic handlers for debugging React-Main communication
 */
function setupDiagnosticHandlers() {
  ipcMain.handle('react-diagnostic', (event, message) => {
    logger.info('react-diagnostic', message);
    return { success: true };
  });
}

/**
 * Drive detection handlers
 */
function setupDriveHandlers() {
  // Fast drive detection using Windows APIs
  ipcMain.handle('scan-drives', async () => {
    try {
      logger.info('scan-drives', 'Starting drive detection...');
      const driveDetector = getDriveDetector();

      // Guard against uninitialized driveDetector (race condition safety)
      if (!driveDetector) {
        logger.warn('scan-drives', 'DriveDetector not initialized yet - main process still starting up');
        return {
          success: false,
          error: 'System still initializing. Please wait a moment and try again.',
          notReady: true
        };
      }

      const drives = await driveDetector.detectDrives();
      logger.info('scan-drives', `Found ${drives.length} drives`, drives.map(d => ({ letter: d.driveLetter, name: d.discName, type: d.isBluray ? 'BD' : 'DVD' })));
      return { success: true, drives };
    } catch (error) {
      logger.error('scan-drives', 'Drive detection failed', error);
      return { success: false, error: error.message, errorDetails: error.stack };
    }
  });

  // Scan a single drive (per-drive refresh button)
  // This is independent and won't block during backups
  ipcMain.handle('scan-single-drive', async (event, driveLetter) => {
    try {
      logger.info('scan-single-drive', `Scanning single drive: ${driveLetter}`);
      const driveDetector = getDriveDetector();

      if (!driveDetector) {
        logger.warn('scan-single-drive', 'DriveDetector not initialized yet');
        return { success: false, error: 'System still initializing.', notReady: true };
      }

      const result = await driveDetector.scanSingleDrive(driveLetter);
      logger.info('scan-single-drive', `Single drive scan result`, result);
      return result;
    } catch (error) {
      logger.error('scan-single-drive', `Single drive scan failed for ${driveLetter}`, error);
      return { success: false, error: error.message };
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
}

/**
 * Backup operation handlers
 */
function setupBackupHandlers() {
  // Check backup status for a disc (before starting)
  ipcMain.handle('check-backup-status', async (event, discName, discSize) => {
    try {
      const makemkv = await getSharedMakeMKV();
      const logFn = (msg) => logger.debug('backup-status', `[${discName}] ${msg}`);
      const status = await makemkv.checkBackupStatus(discName, discSize, logFn);

      // Check for partial backup metadata
      if (status.status === 'complete') {
        const backupPath = path.join(makemkv.basePath, 'backup', discName);
        const metadataPath = path.join(backupPath, '.metadata.json');
        try {
          const metadataExists = await fs.access(metadataPath).then(() => true).catch(() => false);
          if (metadataExists) {
            const metadataContent = await fs.readFile(metadataPath, 'utf8');
            const metadata = JSON.parse(metadataContent);
            if (metadata.backup?.partialSuccess) {
              status.status = 'partial_success';
              status.errorsEncountered = metadata.backup.errorsEncountered || [];
              status.filesSuccessful = metadata.backup.filesSuccessful || 0;
              status.filesFailed = metadata.backup.filesFailed || 0;
              status.percentRecovered = metadata.backup.percentRecovered || 0;
            }
          }
        } catch (err) {
          // Ignore metadata read errors - treat as normal complete backup
          logger.debug('backup-status', `Could not read metadata for ${discName}`, err);
        }
      }

      logger.info('backup-status', `[${discName}] Status: ${status.status}`, { ratio: status.backupRatio, size: status.backupSize });
      return { success: true, ...status };
    } catch (error) {
      logger.error('backup-status', `[${discName}] Status check failed`, error);
      return { success: false, error: error.message, errorDetails: error.stack };
    }
  });

  // Batch check backup status for multiple discs (performance optimization)
  ipcMain.handle('batch-check-backup-status', async (event, discs) => {
    try {
      const makemkv = await getSharedMakeMKV();
      const results = await Promise.all(
        discs.map(async ({ discName, discSize }) => {
          try {
            const status = await makemkv.checkBackupStatus(discName, discSize);
            return { discName, success: true, ...status };
          } catch (error) {
            logger.error('batch-backup-status', `[${discName}] Status check failed`, error);
            return { discName, success: false, error: error.message };
          }
        })
      );
      return { success: true, results };
    } catch (error) {
      logger.error('batch-backup-status', 'Batch status check failed', error);
      return { success: false, error: error.message };
    }
  });

  // Start backup for a specific drive (PARALLEL)
  ipcMain.handle('start-backup', async (event, driveId, makemkvIndex, discName, discSize, driveLetter, extractionMode = 'full_backup') => {
    const exportWatcher = getExportWatcherInstance();
    return await startBackupManager(driveId, makemkvIndex, discName, discSize, driveLetter, exportWatcher, extractionMode);
  });

  // Cancel backup for a specific drive
  ipcMain.handle('cancel-backup', async (event, driveId) => {
    try {
      const cancelled = cancelBackupManager(driveId);
      if (cancelled) {
        logger.info('cancel-backup', `Cancelled backup for drive ${driveId}`);
        return { success: true, cancelled: true };
      }
      logger.warn('cancel-backup', `No backup running for drive ${driveId}`);
      return { success: true, wasNotFound: true };
    } catch (error) {
      logger.error('cancel-backup', `Failed to cancel backup for drive ${driveId}`, error);
      return { success: false, error: error.message };
    }
  });

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

      // Now start the backup normally
      if (isBackupRunning(driveId)) {
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

      const exportWatcher = getExportWatcherInstance();
      const result = await startBackupManager(driveId, makemkvIndex, discName, discSize, driveLetter, exportWatcher);

      if (result.success) {
        return { success: true, driveId, started: true, deleted: true, fingerprint };
      }
      return result;
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
}

/**
 * Settings handlers
 */
function setupSettingsHandlers() {
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
      const tmdbClient = getTMDB();
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
}

/**
 * MakeMKV Performance handlers
 */
function setupPerformanceHandlers() {
  // Get current MakeMKV performance settings
  ipcMain.handle('get-makemkv-performance', async () => {
    try {
      const makemkv = await getSharedMakeMKV();
      const settings = await makemkv.getSettings();
      const performance = settings.makemkvPerformance || makemkv.getDefaultPerformanceSettings();
      return { success: true, performance };
    } catch (error) {
      logger.error('performance', 'Failed to get performance settings', error);
      return { success: false, error: error.message };
    }
  });

  // Save MakeMKV performance settings
  ipcMain.handle('save-makemkv-performance', async (event, performance) => {
    try {
      const makemkv = await getSharedMakeMKV();
      const settings = await makemkv.getSettings();

      // Validate performance settings structure
      if (!performance || typeof performance !== 'object') {
        throw new Error('Invalid performance settings object');
      }

      // Validate preset
      const validPresets = ['fast', 'balanced', 'compatibility', '4k-bluray', 'custom'];
      if (performance.preset && !validPresets.includes(performance.preset)) {
        throw new Error(`Invalid preset: ${performance.preset}`);
      }

      // Validate custom settings if provided
      if (performance.customSettings) {
        const cs = performance.customSettings;
        // Validate cache (1-256 MB)
        if (cs.cache !== undefined && (cs.cache < 1 || cs.cache > 256)) {
          throw new Error(`Cache must be between 1 and 256 MB (got ${cs.cache})`);
        }
        // Validate buffers
        if (cs.minbuf !== undefined && (cs.minbuf < 0 || cs.minbuf > 256)) {
          throw new Error(`minbuf must be between 0 and 256 MB (got ${cs.minbuf})`);
        }
        if (cs.maxbuf !== undefined && (cs.maxbuf < 1 || cs.maxbuf > 256)) {
          throw new Error(`maxbuf must be between 1 and 256 MB (got ${cs.maxbuf})`);
        }
        // Validate timeout (1000-60000 ms)
        if (cs.timeout !== undefined && (cs.timeout < 1000 || cs.timeout > 60000)) {
          throw new Error(`Timeout must be between 1000 and 60000 ms (got ${cs.timeout})`);
        }
      }

      // Update and save
      await makemkv.saveSettings({
        ...settings,
        makemkvPerformance: performance
      });

      logger.info('performance', 'Performance settings saved', {
        preset: performance.preset,
        cache: performance.customSettings?.cache
      });

      return { success: true };
    } catch (error) {
      logger.error('performance', 'Failed to save performance settings', error);
      return { success: false, error: error.message };
    }
  });

  // Get list of available performance presets
  ipcMain.handle('get-performance-presets', async () => {
    try {
      const makemkv = await getSharedMakeMKV();
      const presets = makemkv.getPerformancePresets();
      return { success: true, presets };
    } catch (error) {
      logger.error('performance', 'Failed to get performance presets', error);
      return { success: false, error: error.message };
    }
  });

  // Save extraction settings
  ipcMain.handle('save-extraction-settings', async (event, extraction) => {
    try {
      const makemkv = await getSharedMakeMKV();
      const settings = await makemkv.getSettings();

      // Validate extraction settings structure
      if (!extraction || typeof extraction !== 'object') {
        throw new Error('Invalid extraction settings object');
      }

      // Validate defaultMode
      const validModes = ['full_backup', 'smart_extract'];
      if (extraction.defaultMode && !validModes.includes(extraction.defaultMode)) {
        throw new Error(`Invalid extraction mode: ${extraction.defaultMode}`);
      }

      // Validate minTitleLength (1-120 minutes)
      if (extraction.minTitleLength !== undefined) {
        const length = parseInt(extraction.minTitleLength);
        if (isNaN(length) || length < 1 || length > 120) {
          throw new Error(`minTitleLength must be between 1 and 120 minutes (got ${extraction.minTitleLength})`);
        }
        extraction.minTitleLength = length;
      }

      // Update and save
      await makemkv.saveSettings({
        ...settings,
        extraction
      });

      logger.info('extraction', 'Extraction settings saved', {
        defaultMode: extraction.defaultMode,
        minTitleLength: extraction.minTitleLength
      });

      return { success: true };
    } catch (error) {
      logger.error('extraction', 'Failed to save extraction settings', error);
      return { success: false, error: error.message };
    }
  });
}

/**
 * Logs handlers
 */
function setupLogsHandlers() {
  // Get recent logs for troubleshooting
  ipcMain.handle('get-logs', async (event, lines = 200) => {
    try {
      // Security: Bounds check to prevent excessive memory usage (min 1, max 10000)
      const safeLines = Math.min(Math.max(1, parseInt(lines) || 200), 10000);
      const result = await logger.getRecentLogs(safeLines);
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

  // Open URL in default OS browser
  ipcMain.handle('open-external', async (event, url) => {
    console.log('[IPC] open-external called with:', url);
    try {
      // Security: Only allow http/https URLs
      if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
        console.log('[IPC] open-external rejected: invalid URL');
        return { success: false, error: 'Invalid URL - only http/https allowed' };
      }
      console.log('[IPC] Calling shell.openExternal...');
      await shell.openExternal(url);
      console.log('[IPC] shell.openExternal succeeded');
      return { success: true };
    } catch (error) {
      console.error('[IPC] shell.openExternal failed:', error);
      return { success: false, error: error.message };
    }
  });
}

/**
 * Metadata system handlers
 */
function setupMetadataHandlers() {
  // Get all backups with metadata status
  ipcMain.handle('get-all-backups', async () => {
    try {
      const metadataWatcher = getWatcher();
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
      // Security: Validate backup name to prevent path traversal
      const safeName = sanitizeBackupName(backupName);
      const discIdentifier = getIdentifier();
      if (!discIdentifier) {
        return { success: false, error: 'Disc identifier not initialized' };
      }
      const makemkv = await getSharedMakeMKV();
      const backupPath = path.join(makemkv.basePath, 'backup', safeName);
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
      const metadataWatcher = getWatcher();
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
      const metadataWatcher = getWatcher();
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
  ipcMain.handle('approve-metadata', async (event, backupName) => {
    try {
      // Security: Validate backup name to prevent path traversal
      const safeName = sanitizeBackupName(backupName);
      const discIdentifier = getIdentifier();
      if (!discIdentifier) {
        return { success: false, error: 'Disc identifier not initialized' };
      }
      const makemkv = await getSharedMakeMKV();
      const backupPath = path.join(makemkv.basePath, 'backup', safeName);
      const result = await discIdentifier.approve(backupPath);

      // If approval succeeded and export watcher is active, queue for export
      const exportWatcher = getExportWatcherInstance();
      if (result.success && exportWatcher) {
        const metadata = await discIdentifier.loadMetadata(backupPath);
        exportWatcher.queueExport(safeName, backupPath, metadata);
        logger.info('export', `Queued ${safeName} for automatic export`);
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
      // Security: Validate backup name to prevent path traversal
      const safeName = sanitizeBackupName(backupName);
      const discIdentifier = getIdentifier();
      if (!discIdentifier) {
        return { success: false, error: 'Disc identifier not initialized' };
      }
      const makemkv = await getSharedMakeMKV();
      const backupPath = path.join(makemkv.basePath, 'backup', safeName);
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
      // Security: Validate backup name to prevent path traversal
      const safeName = sanitizeBackupName(backupName);
      const discIdentifier = getIdentifier();
      if (!discIdentifier) {
        return { success: false, error: 'Disc identifier not initialized' };
      }
      const makemkv = await getSharedMakeMKV();
      const backupPath = path.join(makemkv.basePath, 'backup', safeName);
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
      const tmdbClient = getTMDB();
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
      const tmdbClient = getTMDB();
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
      const tmdbClient = getTMDB();
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
      const ollamaManager = getOllama();
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
      const ollamaManager = getOllama();
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
      const ollamaManager = getOllama();
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

  // NOTE: 'pull-ollama-model' handler is now in setupAIProviderHandlers()
  // with better progress tracking support

  // Get metadata watcher queue status
  ipcMain.handle('get-metadata-queue', async () => {
    try {
      const metadataWatcher = getWatcher();
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
      const metadataWatcher = getWatcher();
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
      const tmdbClient = getTMDB();
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
}

/**
 * Emby export system handlers
 */
function setupEmbyHandlers() {
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
      // Security: Validate backup name to prevent path traversal
      const safeName = sanitizeBackupName(backupName);
      const makemkv = await getSharedMakeMKV();
      const backupPath = path.join(makemkv.basePath, 'backup', safeName);
      const exporter = await getEmbyExporter();

      logger.info('emby', `Scanning titles for: ${safeName}`);
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
      // Security: Validate backup name to prevent path traversal
      const safeName = sanitizeBackupName(backupName);
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

      const backupPath = path.join(makemkv.basePath, 'backup', safeName);

      // Load metadata for proper naming
      const discIdentifier = getIdentifier();
      let metadata = null;
      if (discIdentifier) {
        metadata = await discIdentifier.loadMetadata(backupPath);
      }
      if (!metadata) {
        metadata = { final: { title: safeName }, disc: { volumeLabel: safeName } };
      }

      const exporter = await getEmbyExporter();
      currentEmbyExport = exporter;

      logger.info('emby', `Starting export: ${safeName} -> ${libraryPath}`);

      const mainWindow = getMainWindow();
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
              backupName: safeName,
              ...progress
            });
          }
        },
        (message) => {
          if (mainWindow) {
            mainWindow.webContents.send('emby-log', {
              backupName: safeName,
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
      const discIdentifier = getIdentifier();
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
}

/**
 * Transfer system handlers
 */
function setupTransferHandlers() {
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
    const exportWatcher = getExportWatcherInstance();
    if (!exportWatcher) {
      return { success: true, status: { queueLength: 0, processing: null, queue: [] } };
    }
    return { success: true, status: exportWatcher.getQueueStatus() };
  });

  // Manual export - queue a specific backup for export
  ipcMain.handle('queue-export', async (event, backupName) => {
    try {
      const exportWatcher = getExportWatcherInstance();
      if (!exportWatcher) {
        return { success: false, error: 'Export watcher not initialized' };
      }

      // Get the backup path and metadata
      const makemkv = await getSharedMakeMKV();
      const settings = await makemkv.getSettings();
      const backupPath = path.join(settings.basePath, 'backup', backupName);
      const discIdentifier = getIdentifier();
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
    const exportWatcher = getExportWatcherInstance();
    if (!exportWatcher) {
      return { success: false, error: 'Export watcher not initialized' };
    }
    exportWatcher.cancel();
    return { success: true };
  });

  // Get TV series batch status (for parallel processing UI)
  ipcMain.handle('get-series-batch-status', async () => {
    const exportWatcher = getExportWatcherInstance();
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
    const exportWatcher = getExportWatcherInstance();
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
}

/**
 * Automation toggle handlers
 */
function setupAutomationHandlers() {
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
}

/**
 * Library fixer handlers
 */
function setupLibraryFixerHandlers() {
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

      const mainWindow = getMainWindow();

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

      const mainWindow = getMainWindow();

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

/**
 * Credential store handlers
 */
function setupCredentialHandlers() {
  // Security: Whitelist of allowed credential keys
  const ALLOWED_CREDENTIAL_KEYS = [
    'sftp-password', 'sftp-privatekey', 'ftp-password',
    'openrouter-api-key', 'claude-api-key', 'claude-oauth-token'
  ];

  // Validate credential key against whitelist
  function validateCredentialKey(key) {
    if (!ALLOWED_CREDENTIAL_KEYS.includes(key)) {
      throw new Error(`Invalid credential key: ${key}. Allowed keys: ${ALLOWED_CREDENTIAL_KEYS.join(', ')}`);
    }
  }

  // Store a credential securely
  ipcMain.handle('credential-set', async (event, key, value) => {
    try {
      // Security: Validate key against whitelist
      validateCredentialKey(key);
      const { getCredentialStore } = await import('./credential-store.js');
      const store = getCredentialStore();
      await store.setCredential(key, value);
      return { success: true };
    } catch (error) {
      logger.error('credential', 'Failed to store credential', error);
      return { success: false, error: error.message };
    }
  });

  // Check if a credential exists
  ipcMain.handle('credential-has', async (event, key) => {
    try {
      // Security: Validate key against whitelist
      validateCredentialKey(key);
      const { getCredentialStore } = await import('./credential-store.js');
      const store = getCredentialStore();
      const exists = await store.hasCredential(key);
      return { success: true, exists };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Delete a credential
  ipcMain.handle('credential-delete', async (event, key) => {
    try {
      // Security: Validate key against whitelist
      validateCredentialKey(key);
      const { getCredentialStore } = await import('./credential-store.js');
      const store = getCredentialStore();
      await store.deleteCredential(key);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Check if secure storage is available
  ipcMain.handle('credential-check-available', async () => {
    try {
      const { getCredentialStore } = await import('./credential-store.js');
      const store = getCredentialStore();
      return {
        success: true,
        available: store.isEncryptionAvailable(),
        backend: store.getBackend()
      };
    } catch (error) {
      return { success: false, available: false, error: error.message };
    }
  });
}

/**
 * AI Provider handlers
 */
function setupAIProviderHandlers() {
  // Get all provider info
  ipcMain.handle('get-ai-providers', async () => {
    try {
      const { getProviderManager } = await import('./metadata/providers/provider-manager.js');
      const manager = getProviderManager();
      return {
        success: true,
        providers: manager.getAllProviderInfo(),
        activeProvider: manager.getActiveProviderName()
      };
    } catch (error) {
      logger.error('ai-providers', 'Failed to get providers', error);
      return { success: false, error: error.message };
    }
  });

  // Get models for a specific provider
  ipcMain.handle('get-ai-provider-models', async (event, providerName) => {
    try {
      const { getProviderManager } = await import('./metadata/providers/provider-manager.js');
      const manager = getProviderManager();
      return {
        success: true,
        models: manager.getModels(providerName)
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Set active provider with configuration
  ipcMain.handle('set-ai-provider', async (event, providerName, config) => {
    try {
      const { getProviderManager } = await import('./metadata/providers/provider-manager.js');
      const manager = getProviderManager();
      manager.setActiveProvider(providerName, config);
      return { success: true };
    } catch (error) {
      logger.error('ai-providers', 'Failed to set provider', error);
      return { success: false, error: error.message };
    }
  });

  // Configure a provider (without setting it active)
  ipcMain.handle('configure-ai-provider', async (event, providerName, config) => {
    try {
      const { getProviderManager } = await import('./metadata/providers/provider-manager.js');
      const manager = getProviderManager();
      manager.configureProvider(providerName, config);
      return { success: true };
    } catch (error) {
      logger.error('ai-providers', 'Failed to configure provider', error);
      return { success: false, error: error.message };
    }
  });

  // Test a provider connection
  ipcMain.handle('test-ai-provider', async (event, providerName) => {
    try {
      const { getProviderManager } = await import('./metadata/providers/provider-manager.js');
      const manager = getProviderManager();
      const result = await manager.testProvider(providerName);
      return { success: true, ...result };
    } catch (error) {
      return { success: false, message: error.message };
    }
  });

  // Initialize provider from settings
  ipcMain.handle('init-ai-provider-from-settings', async () => {
    try {
      const { getProviderManager } = await import('./metadata/providers/provider-manager.js');
      const { getCredentialStore } = await import('./credential-store.js');
      const manager = getProviderManager();
      const credStore = getCredentialStore();

      // Load settings
      const settings = await makemkv.getSettings();
      const aiSettings = settings.aiProviders || {};

      // Configure each provider
      if (aiSettings.ollama) {
        manager.configureProvider('ollama', aiSettings.ollama);
      }

      if (aiSettings.openrouter) {
        const apiKey = await credStore.getCredential('openrouter-api-key');
        manager.configureProvider('openrouter', {
          ...aiSettings.openrouter,
          apiKey
        });
      }

      if (aiSettings.claude) {
        const apiKey = await credStore.getCredential('claude-api-key');
        const oauthToken = await credStore.getCredential('claude-oauth-token');
        manager.configureProvider('claude', {
          ...aiSettings.claude,
          apiKey,
          oauthToken
        });
      }

      // Set active provider
      if (aiSettings.activeProvider) {
        manager.setActiveProvider(aiSettings.activeProvider, aiSettings[aiSettings.activeProvider] || {});
      }

      logger.info('ai-providers', 'Initialized from settings', { active: aiSettings.activeProvider });
      return { success: true, activeProvider: manager.getActiveProviderName() };
    } catch (error) {
      logger.error('ai-providers', 'Failed to initialize from settings', error);
      return { success: false, error: error.message };
    }
  });

  // Get Ollama models with installation status
  ipcMain.handle('get-ollama-models-status', async () => {
    try {
      const { getProviderManager } = await import('./metadata/providers/provider-manager.js');
      const manager = getProviderManager();
      const ollamaProvider = manager.providers.get('ollama');

      if (!ollamaProvider) {
        return { success: false, error: 'Ollama provider not initialized' };
      }

      const models = await ollamaProvider.getModelsWithStatus();
      const ollamaAvailable = await ollamaProvider.isAvailable();

      return {
        success: true,
        ollamaAvailable,
        models
      };
    } catch (error) {
      logger.error('ai-providers', 'Failed to get Ollama models status', error);
      return { success: false, error: error.message };
    }
  });

  // Pull/download an Ollama model
  ipcMain.handle('pull-ollama-model', async (event, modelId) => {
    try {
      const { getProviderManager } = await import('./metadata/providers/provider-manager.js');
      const manager = getProviderManager();
      const ollamaProvider = manager.providers.get('ollama');

      if (!ollamaProvider) {
        return { success: false, error: 'Ollama provider not initialized' };
      }

      const mainWindow = getMainWindow();

      // Progress callback sends updates to renderer
      const onProgress = (percent, status) => {
        if (mainWindow) {
          mainWindow.webContents.send('ollama-model-pull-progress', {
            modelId,
            percent,
            status
          });
        }
      };

      logger.info('ai-providers', `Starting pull for model: ${modelId}`);
      const result = await ollamaProvider.pullModel(modelId, onProgress);

      return result;
    } catch (error) {
      logger.error('ai-providers', `Failed to pull model ${modelId}`, error);
      return { success: false, error: error.message };
    }
  });

  // Delete an Ollama model
  ipcMain.handle('delete-ollama-model', async (event, modelId) => {
    try {
      const { getProviderManager } = await import('./metadata/providers/provider-manager.js');
      const manager = getProviderManager();
      const ollamaProvider = manager.providers.get('ollama');

      if (!ollamaProvider) {
        return { success: false, error: 'Ollama provider not initialized' };
      }

      logger.info('ai-providers', `Deleting model: ${modelId}`);
      const result = await ollamaProvider.deleteModel(modelId);

      return result;
    } catch (error) {
      logger.error('ai-providers', `Failed to delete model ${modelId}`, error);
      return { success: false, error: error.message };
    }
  });
}
