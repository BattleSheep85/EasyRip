// Backup manager for parallel MakeMKV backup operations

import path from 'path';
import logger from './logger.js';
import { MakeMKVAdapter } from './makemkv.js';
import { DriveDetector } from './drives.js';
import { showNotification } from './utils.js';
import { getMainWindow } from './window-manager.js';
import { createEmptyMetadata } from './metadata/schemas.js';
import { generateFingerprint, hasUsefulFingerprint } from './metadata/fingerprint.js';
import { getARMDatabase } from './metadata/arm-database.js';

// PARALLEL BACKUP SYSTEM
// With --noscan flag, MakeMKV processes can run in parallel because:
// 1. Each process targets a specific disc:N directly (no scanning)
// 2. Each writes to its own folder
// 3. No drive scanning conflicts
//
// We track running backups in a Map for cancellation support.
const runningBackups = new Map(); // driveId -> { makemkv, discName, fingerprint, driveLetter }

let driveDetector = null;
let discIdentifier = null;

/**
 * Initialize the backup manager
 */
export function initBackupManager(identifier) {
  driveDetector = new DriveDetector();
  discIdentifier = identifier;
}

/**
 * Get drive detector instance
 */
export function getDriveDetector() {
  return driveDetector;
}

/**
 * Check if a backup is running for a specific drive
 */
export function isBackupRunning(driveId) {
  return runningBackups.has(driveId);
}

/**
 * Get running backup info for a drive
 */
export function getRunningBackup(driveId) {
  return runningBackups.get(driveId);
}

/**
 * Cancel a running backup
 */
export function cancelBackup(driveId) {
  const backup = runningBackups.get(driveId);
  if (backup) {
    logger.info('cancel-backup', `Cancelling backup for drive ${driveId} (${backup.discName})`);
    backup.makemkv.cancelBackup();
    runningBackups.delete(driveId);
    return true;
  }
  return false;
}

/**
 * Start a backup for a specific drive
 * Returns { success, driveId, started, fingerprint } or { success: false, error }
 */
export async function startBackup(driveId, makemkvIndex, discName, discSize, driveLetter, exportWatcher) {
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
          const mainWindow = getMainWindow();
          if (mainWindow) {
            mainWindow.webContents.send('fingerprint-match', { driveId, match: armMatch });
          }
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
  const mainWindow = getMainWindow();
  if (mainWindow) {
    mainWindow.webContents.send('backup-started', { driveId, fingerprint });
  }

  // Create new MakeMKV adapter for this backup
  const makemkv = new MakeMKVAdapter();
  await makemkv.loadSettings();

  // Track this backup (include fingerprint and driveLetter for eject)
  runningBackups.set(driveId, { makemkv, discName, fingerprint, driveLetter });

  // Run backup in background (don't await - let it run parallel)
  runBackup(driveId, makemkv, makemkvIndex, discName, discSize, fingerprint, driveLetter, exportWatcher);

  // Return immediately - progress comes via IPC events
  return { success: true, driveId, started: true, fingerprint };
}

/**
 * Run a single backup (called in parallel for each drive)
 * Private function - manages the entire backup lifecycle
 */
async function runBackup(driveId, makemkv, makemkvIndex, discName, discSize, fingerprint, driveLetter, exportWatcher) {
  const mainWindow = getMainWindow();

  try {
    const result = await makemkv.startBackup(makemkvIndex, discName, discSize,
      // Progress callback
      (progress) => {
        if (mainWindow) {
          mainWindow.webContents.send('backup-progress', { driveId, ...progress });
        }
      },
      // Log callback
      (logLine) => {
        logger.debug('backup', `[${discName}] ${logLine}`);
        if (mainWindow) {
          mainWindow.webContents.send('backup-log', { driveId, line: logLine });
        }
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
    logger.info('start-backup', `Sending backup-complete IPC event`, { driveId, success: true });
    if (mainWindow) {
      mainWindow.webContents.send('backup-complete', {
        driveId,
        success: true,
        fingerprint,
        ...result
      });
    }

    // Show desktop notification for successful backup
    showNotification(
      'Backup Complete',
      `${discName} has been successfully backed up.`,
      'success'
    );

    // Auto-eject disc if enabled
    if (driveLetter && driveDetector) {
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
    logger.info('start-backup', `Sending backup-complete IPC event (failure)`, { driveId, success: false, error: error.message });
    if (mainWindow) {
      mainWindow.webContents.send('backup-complete', {
        driveId,
        success: false,
        error: error.message
      });
    }

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
