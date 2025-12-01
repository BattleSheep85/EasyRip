/**
 * Export Watcher
 * Monitors for approved metadata and automatically triggers remux + transfer
 *
 * Workflow:
 * 1. User approves metadata in MetadataEditor
 * 2. ExportWatcher detects the approval
 * 3. Scans backup for titles, selects main feature
 * 4. Remuxes to MKV (lossless)
 * 5. Transfers to configured destination (SCP/SFTP/FTP/UNC/Local)
 * 6. Updates metadata status to 'exported'
 */

import path from 'path';
import { existsSync, readdirSync } from 'fs';
import { promises as fs } from 'fs';
import logger from './logger.js';
import { EmbyExporter } from './emby.js';
import { getTransferManager } from './transfer.js';
import { getDiscIdentifier } from './metadata/identifier.js';
import { MetadataStatus, MediaType } from './metadata/schemas.js';

const log = {
  info: (msg, data) => logger.info('export-watcher', msg, data),
  warn: (msg, data) => logger.warn('export-watcher', msg, data),
  error: (msg, data) => logger.error('export-watcher', msg, data),
  debug: (msg, data) => logger.debug('export-watcher', msg, data),
};

const SCAN_INTERVAL_MS = 60000; // Check every minute for approved backups

/**
 * ExportWatcher class
 * Background service that watches for approved backups and exports them
 */
export class ExportWatcher {
  constructor(options = {}) {
    this.backupPath = options.backupPath;
    this.makemkvPath = options.makemkvPath;
    this.getSettings = options.getSettings; // Function to get current settings

    this.embyExporter = null;
    this.transferManager = getTransferManager();
    this.identifier = getDiscIdentifier();

    this.intervalId = null;
    this.queue = [];
    this.processing = null;
    this.isScanning = false;

    // Callbacks for UI updates
    this.onProgress = options.onProgress || null;
    this.onLog = options.onLog || null;
    this.onComplete = options.onComplete || null;
    this.onError = options.onError || null;
  }

  /**
   * Initialize the EmbyExporter with MakeMKV path
   */
  async init() {
    if (!this.makemkvPath) {
      throw new Error('MakeMKV path not configured');
    }
    this.embyExporter = new EmbyExporter(this.makemkvPath);
    log.info('Export watcher initialized');
  }

  /**
   * Start watching for approved backups
   */
  start() {
    if (this.intervalId) {
      log.warn('Export watcher already running');
      return;
    }

    log.info(`Starting export watcher on ${this.backupPath}`);

    // Initial scan
    this.scanForApproved();

    // Set up interval
    this.intervalId = setInterval(() => {
      this.scanForApproved();
    }, SCAN_INTERVAL_MS);
  }

  /**
   * Stop watching
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      log.info('Export watcher stopped');
    }
  }

  /**
   * Scan for approved backups that need exporting
   * Only auto-queues if autoExport setting is enabled
   */
  async scanForApproved() {
    if (this.isScanning || !this.backupPath) return;
    if (!existsSync(this.backupPath)) return;

    // Check if autoExport is enabled
    if (this.getSettings) {
      try {
        const settings = await this.getSettings();
        if (!settings.automation?.autoExport) {
          // Auto-export disabled - skip scanning
          return;
        }
      } catch (err) {
        log.warn('Failed to check autoExport setting, skipping scan');
        return;
      }
    }

    this.isScanning = true;

    try {
      const entries = readdirSync(this.backupPath, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const backupDir = path.join(this.backupPath, entry.name);
        const metadata = await this.identifier.loadMetadata(backupDir);

        // Check if approved/manual and not yet exported
        // Both APPROVED and MANUAL indicate user-confirmed metadata
        const isReady = metadata?.status === MetadataStatus.APPROVED ||
                       metadata?.status === MetadataStatus.MANUAL;

        if (isReady) {
          // Check if not already in queue or processing
          const alreadyQueued = this.queue.find(q => q.name === entry.name);
          const alreadyProcessing = this.processing?.name === entry.name;

          if (!alreadyQueued && !alreadyProcessing) {
            log.info(`[Auto-Export] Found ready backup: ${entry.name} (status: ${metadata.status})`);
            this.queueExport(entry.name, backupDir, metadata);
          }
        }
      }
    } catch (error) {
      log.error('Scan error:', error.message);
    } finally {
      this.isScanning = false;
    }
  }

  /**
   * Queue a backup for export
   * Called directly when user approves metadata
   */
  queueExport(backupName, backupPath, metadata) {
    // Check if already queued
    if (this.queue.find(q => q.name === backupName)) {
      log.debug(`${backupName} already in queue`);
      return;
    }

    const exportJob = {
      name: backupName,
      path: backupPath,
      metadata,
      queuedAt: Date.now()
    };

    this.queue.push(exportJob);
    log.info(`Queued for export: ${backupName}`);

    // Start processing if not already
    if (!this.processing) {
      this.processQueue();
    }

    return { success: true, position: this.queue.length };
  }

  /**
   * Process the export queue
   */
  async processQueue() {
    if (this.processing || this.queue.length === 0) {
      return;
    }

    const job = this.queue.shift();
    this.processing = job;

    log.info(`Processing export: ${job.name}`);
    this.emitLog(job.name, `Starting export process for ${job.name}`);

    try {
      // Get current settings
      const settings = await this.getSettings();
      const transferConfig = settings.transfer || {};

      // Validate transfer settings
      if (!transferConfig.protocol) {
        throw new Error('Transfer protocol not configured. Please configure in Settings.');
      }
      if (!transferConfig.moviePath && !transferConfig.tvPath) {
        throw new Error('Library paths not configured. Please configure in Settings.');
      }

      // Determine media type from metadata
      const mediaType = job.metadata.tmdb?.mediaType ||
                       job.metadata.final?.mediaType ||
                       MediaType.MOVIE;

      // Get the appropriate library path
      const libraryPath = mediaType === MediaType.TV
        ? transferConfig.tvPath
        : transferConfig.moviePath;

      if (!libraryPath) {
        throw new Error(`${mediaType} library path not configured`);
      }

      // Step 1: Scan titles to find main feature
      this.emitProgress(job.name, 5, 'Scanning disc for titles...');
      this.emitLog(job.name, 'Scanning disc for available titles...');

      await this.init(); // Ensure embyExporter is initialized
      const scanResult = await this.embyExporter.scanTitles(job.path);

      if (!scanResult.titles || scanResult.titles.length === 0) {
        throw new Error('No titles found in backup');
      }

      // Find main feature (longest title with chapters)
      const mainFeature = scanResult.titles.find(t => t.isMainFeature) ||
                         scanResult.titles[0];

      this.emitLog(job.name, `Found ${scanResult.titles.length} titles. Main feature: Title ${mainFeature.index} (${mainFeature.durationDisplay})`);

      // Step 2: Generate output path and filename
      const tvInfo = job.metadata.tvInfo || null;
      const outputInfo = this.embyExporter.generateEmbyPath({
        title: job.metadata.final?.title || job.metadata.disc?.volumeLabel || job.name,
        year: job.metadata.final?.year || null,
        tmdbId: job.metadata.tmdb?.id || null,
        mediaType,
        tvInfo: tvInfo, // TV episode info from metadata
        embyLibraryPath: libraryPath
      });

      // Create temp output directory for remux
      const tempDir = path.join(path.dirname(job.path), '_export_temp');
      await fs.mkdir(tempDir, { recursive: true });
      const tempMkvPath = path.join(tempDir, outputInfo.fileName);

      // Step 3: Remux to MKV (lossless)
      this.emitProgress(job.name, 10, 'Remuxing to MKV...');
      this.emitLog(job.name, `Remuxing title ${mainFeature.index} to MKV (lossless)...`);

      const remuxResult = await this.embyExporter.convertToMkv(
        job.path,
        mainFeature.index,
        tempMkvPath,
        (progress) => {
          // Scale remux progress from 10% to 70%
          const scaledPercent = 10 + (progress.percent * 0.6);
          this.emitProgress(job.name, scaledPercent, 'Remuxing...');
        },
        (message) => {
          this.emitLog(job.name, message);
        }
      );

      this.emitLog(job.name, `Remux complete: ${remuxResult.path}`);

      // Step 4: Transfer to destination
      this.emitProgress(job.name, 70, 'Transferring to library...');
      this.emitLog(job.name, `Transferring via ${transferConfig.protocol.toUpperCase()}...`);

      const transferResult = await this.transferManager.transfer(
        tempMkvPath,
        {
          ...transferConfig,
          mediaType,
          // For local/UNC, moviePath/tvPath are the destinations
          // For remote protocols, they're remote paths
        },
        (percent) => {
          // Scale transfer progress from 70% to 95%
          const scaledPercent = 70 + (percent * 0.25);
          this.emitProgress(job.name, scaledPercent, 'Transferring...');
        },
        (message) => {
          this.emitLog(job.name, message);
        }
      );

      // Step 5: Clean up temp file
      this.emitProgress(job.name, 95, 'Cleaning up...');
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
        this.emitLog(job.name, 'Cleaned up temporary files');
      } catch (cleanupErr) {
        log.warn('Cleanup warning:', cleanupErr.message);
      }

      // Step 6: Update metadata status to exported
      this.emitProgress(job.name, 98, 'Updating metadata...');
      await this.identifier.update(job.path, {
        status: MetadataStatus.EXPORTED,
        exported: {
          at: new Date().toISOString(),
          path: transferResult.remotePath,
          protocol: transferConfig.protocol
        }
      });

      // Complete!
      this.emitProgress(job.name, 100, 'Export complete!');
      this.emitLog(job.name, `Export complete! File transferred to: ${transferResult.remotePath}`);

      log.info(`Export complete: ${job.name} -> ${transferResult.remotePath}`);

      if (this.onComplete) {
        this.onComplete({
          name: job.name,
          path: transferResult.remotePath,
          success: true
        });
      }

    } catch (error) {
      log.error(`Export failed for ${job.name}:`, error.message);
      this.emitLog(job.name, `ERROR: ${error.message}`);

      if (this.onError) {
        this.onError({
          name: job.name,
          error: error.message
        });
      }

      // Update metadata with error
      try {
        await this.identifier.update(job.path, {
          exportError: error.message,
          exportErrorAt: new Date().toISOString()
        });
      } catch (updateErr) {
        log.error('Failed to update metadata with error:', updateErr.message);
      }
    } finally {
      this.processing = null;

      // Process next in queue
      if (this.queue.length > 0) {
        setTimeout(() => this.processQueue(), 2000);
      }
    }
  }

  /**
   * Emit progress update
   */
  emitProgress(backupName, percent, stage) {
    if (this.onProgress) {
      this.onProgress({ backupName, percent, stage });
    }
  }

  /**
   * Emit log message
   */
  emitLog(backupName, message) {
    if (this.onLog) {
      this.onLog({ backupName, message });
    }
    log.debug(`[${backupName}] ${message}`);
  }

  /**
   * Get queue status
   */
  getQueueStatus() {
    return {
      queueLength: this.queue.length,
      processing: this.processing?.name || null,
      queue: this.queue.map(j => j.name)
    };
  }

  /**
   * Cancel current export
   */
  cancel() {
    if (this.embyExporter) {
      this.embyExporter.cancel();
    }
    // Note: Transfer cancellation would need to be added to TransferManager
  }
}

// Singleton instance
let exportWatcher = null;

export function getExportWatcher(options = {}) {
  if (!exportWatcher && options.backupPath) {
    exportWatcher = new ExportWatcher(options);
  }
  return exportWatcher;
}

export function resetExportWatcher() {
  if (exportWatcher) {
    exportWatcher.stop();
    exportWatcher = null;
  }
}

export default {
  ExportWatcher,
  getExportWatcher,
  resetExportWatcher
};
