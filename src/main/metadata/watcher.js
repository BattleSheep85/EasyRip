/**
 * Metadata Watcher
 * Background service that monitors backup folder for unidentified discs
 */

import { existsSync, readdirSync, statSync } from 'fs';
import path from 'path';
import logger from '../logger.js';
import { getDiscIdentifier } from './identifier.js';
import { MetadataStatus } from './schemas.js';

// Create a simple log wrapper with category
const log = {
  info: (msg, data) => logger.info('watcher', msg, data),
  warn: (msg, data) => logger.warn('watcher', msg, data),
  error: (msg, data) => logger.error('watcher', msg, data),
  debug: (msg, data) => logger.debug('watcher', msg, data),
};

const DEFAULT_INTERVAL_MS = 30000; // 30 seconds
const MIN_BACKUP_AGE_MS = 60000;   // Wait 1 minute after backup created

/**
 * MetadataWatcher class
 * Monitors backup folder and triggers identification for new backups
 */
export class MetadataWatcher {
  constructor(backupPath, options = {}) {
    this.backupPath = backupPath;
    this.intervalMs = options.intervalMs || DEFAULT_INTERVAL_MS;
    this.onPending = options.onPending || null;
    this.onError = options.onError || null;
    this.onProgress = options.onProgress || null;

    this.identifier = getDiscIdentifier();
    this.intervalId = null;
    this.isScanning = false;
    this.queue = [];
    this.processing = null;
  }

  /**
   * Set callback for when new pending metadata is created
   * @param {Function} callback - (backupInfo) => void
   */
  setOnPending(callback) {
    this.onPending = callback;
  }

  /**
   * Set callback for errors
   * @param {Function} callback - (error, backupName) => void
   */
  setOnError(callback) {
    this.onError = callback;
  }

  /**
   * Set progress callback
   * @param {Function} callback - (stage, percent, message) => void
   */
  setOnProgress(callback) {
    this.onProgress = callback;
    this.identifier.setProgressCallback(callback);
  }

  /**
   * Start watching for new backups
   */
  start() {
    if (this.intervalId) {
      log.warn('Watcher already running');
      return;
    }

    log.info(`Starting metadata watcher on ${this.backupPath}`);
    log.info(`Scan interval: ${this.intervalMs}ms`);

    // Initial scan
    this.scanOnce();

    // Set up interval
    this.intervalId = setInterval(() => {
      this.scanOnce();
    }, this.intervalMs);
  }

  /**
   * Stop watching
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      log.info('Metadata watcher stopped');
    }
  }

  /**
   * Check if watcher is running
   * @returns {boolean}
   */
  isRunning() {
    return this.intervalId !== null;
  }

  /**
   * Perform a single scan of the backup folder
   * @returns {Promise<Array>} List of backups needing identification
   */
  async scanOnce() {
    if (this.isScanning) {
      log.debug('Scan already in progress, skipping');
      return [];
    }

    if (!existsSync(this.backupPath)) {
      log.warn(`Backup path does not exist: ${this.backupPath}`);
      return [];
    }

    this.isScanning = true;
    const needsIdentification = [];

    try {
      const entries = readdirSync(this.backupPath, { withFileTypes: true });
      log.info(`Scanning ${entries.length} entries in backup folder`);

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const backupDir = path.join(this.backupPath, entry.name);
        const status = await this.checkBackupStatus(backupDir);

        log.debug(`${entry.name}: hasMetadata=${status.hasMetadata}, needsID=${status.needsIdentification}, validBackup=${status.hasVideoTs || status.hasBdmv}`);

        if (status.needsIdentification) {
          needsIdentification.push({
            path: backupDir,
            name: entry.name,
            ...status
          });
        }
      }

      // Queue backups for processing
      for (const backup of needsIdentification) {
        if (!this.queue.find(q => q.path === backup.path)) {
          this.queue.push(backup);
          log.info(`Queued for identification: ${backup.name}`);
        }
      }

      // Process queue
      this.processQueue();

    } catch (error) {
      log.error('Scan error:', error.message);
    } finally {
      this.isScanning = false;
    }

    return needsIdentification;
  }

  /**
   * Check status of a single backup
   * @param {string} backupDir - Path to backup directory
   * @returns {Promise<Object>} Status information
   */
  async checkBackupStatus(backupDir) {
    const status = {
      hasVideoTs: existsSync(path.join(backupDir, 'VIDEO_TS')),
      hasBdmv: existsSync(path.join(backupDir, 'BDMV')),
      hasMetadata: this.identifier.hasMetadata(backupDir),
      metadataStatus: null,
      needsIdentification: false,
      age: 0
    };

    // Check if it's a valid backup (has disc content)
    const isValidBackup = status.hasVideoTs || status.hasBdmv;
    if (!isValidBackup) {
      return status;
    }

    // Check backup age (don't process very new backups)
    try {
      const stats = statSync(backupDir);
      status.age = Date.now() - stats.mtimeMs;

      if (status.age < MIN_BACKUP_AGE_MS) {
        log.debug(`Backup ${path.basename(backupDir)} too new, waiting...`);
        return status;
      }
    } catch (error) {
      log.debug(`Could not stat ${backupDir}:`, error.message);
    }

    // Check metadata status
    if (status.hasMetadata) {
      const metadata = await this.identifier.loadMetadata(backupDir);
      status.metadataStatus = metadata?.status || null;

      // Only re-identify on error status
      if (metadata?.status === MetadataStatus.ERROR) {
        status.needsIdentification = true;
      }
    } else {
      // No metadata - needs identification
      status.needsIdentification = true;
    }

    return status;
  }

  /**
   * Process the identification queue
   */
  async processQueue() {
    if (this.processing || this.queue.length === 0) {
      return;
    }

    const backup = this.queue.shift();
    this.processing = backup;

    log.info(`Processing: ${backup.name}`);

    try {
      // Extract volume label from folder name (best guess)
      const volumeLabel = backup.name;

      const result = await this.identifier.identify(backup.path, volumeLabel);

      if (result.success) {
        log.info(`Identified ${backup.name}: ${result.metadata.final?.title || 'Unknown'}`);

        if (this.onPending) {
          this.onPending({
            path: backup.path,
            name: backup.name,
            title: result.metadata.final?.title,
            year: result.metadata.final?.year,
            status: result.metadata.status
          });
        }
      } else {
        log.error(`Failed to identify ${backup.name}: ${result.error}`);

        if (this.onError) {
          this.onError(result.error, backup.name);
        }
      }

    } catch (error) {
      log.error(`Error processing ${backup.name}:`, error.message);

      if (this.onError) {
        this.onError(error.message, backup.name);
      }
    } finally {
      this.processing = null;

      // Process next in queue
      if (this.queue.length > 0) {
        setTimeout(() => this.processQueue(), 1000);
      }
    }
  }

  /**
   * Manually trigger identification for a specific backup
   * @param {string} backupName - Name of backup folder
   * @returns {Promise<Object>} Identification result
   */
  async identifyBackup(backupName) {
    const backupPath = path.join(this.backupPath, backupName);

    if (!existsSync(backupPath)) {
      return { success: false, error: 'Backup not found' };
    }

    return this.identifier.identify(backupPath, backupName);
  }

  /**
   * Get all backups with their metadata status
   * @returns {Promise<Array>} List of backup info
   */
  async getAllBackups() {
    if (!existsSync(this.backupPath)) {
      return [];
    }

    const backups = [];
    const entries = readdirSync(this.backupPath, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const backupDir = path.join(this.backupPath, entry.name);
      const hasVideoTs = existsSync(path.join(backupDir, 'VIDEO_TS'));
      const hasBdmv = existsSync(path.join(backupDir, 'BDMV'));

      if (!hasVideoTs && !hasBdmv) continue;

      const metadata = await this.identifier.loadMetadata(backupDir);

      backups.push({
        name: entry.name,
        path: backupDir,
        type: hasBdmv ? 'bluray' : 'dvd',
        hasMetadata: !!metadata,
        status: metadata?.status || null,
        title: metadata?.final?.title || metadata?.llmGuess?.title || null,
        year: metadata?.final?.year || metadata?.llmGuess?.year || null,
        posterPath: metadata?.tmdb?.posterPath || null,
        confidence: metadata?.llmGuess?.confidence || null
      });
    }

    // Sort by name
    backups.sort((a, b) => a.name.localeCompare(b.name));

    return backups;
  }

  /**
   * Get current queue status
   * @returns {Object} Queue information
   */
  getQueueStatus() {
    return {
      queueLength: this.queue.length,
      processing: this.processing?.name || null,
      isScanning: this.isScanning
    };
  }

  /**
   * Force re-identification of a backup
   * @param {string} backupName - Name of backup folder
   * @returns {Promise<Object>} Result
   */
  async reidentify(backupName) {
    const backupPath = path.join(this.backupPath, backupName);

    if (!existsSync(backupPath)) {
      return { success: false, error: 'Backup not found' };
    }

    // Add to front of queue
    this.queue.unshift({
      path: backupPath,
      name: backupName,
      needsIdentification: true
    });

    // Start processing if not already
    if (!this.processing) {
      this.processQueue();
    }

    return { success: true, queued: true };
  }
}

// Export singleton factory
let instance = null;

export function getMetadataWatcher(backupPath, options = {}) {
  if (!instance && backupPath) {
    instance = new MetadataWatcher(backupPath, options);
  }
  return instance;
}

export function resetMetadataWatcher() {
  if (instance) {
    instance.stop();
    instance = null;
  }
}

export default {
  MetadataWatcher,
  getMetadataWatcher,
  resetMetadataWatcher
};
