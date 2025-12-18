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
import { getTMDBClient } from './metadata/tmdb.js';
import { writeMovieNfo } from './nfo.js';
import {
  analyzeDiscForEpisodes,
  extractSeasonFromLabel,
  readSeasonTracker,
  writeSeasonTracker,
  calculateStartEpisode,
  extractDiscNumberFromLabel,
  analyzeDiscBatch,
  preCalculateEpisodeAssignments
} from './tvEpisodeDetector.js';

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

    // Parallel processing for TV series
    this.parallelProcessing = new Map(); // discName -> { promise, job }
    this.episodeAssignments = new Map(); // discName -> pre-calculated episodes
    this.maxParallelExports = options.maxParallelExports || 3;

    // Callbacks for UI updates
    this.onProgress = options.onProgress || null;
    this.onLog = options.onLog || null;
    this.onComplete = options.onComplete || null;
    this.onError = options.onError || null;
    this.onWaiting = options.onWaiting || null; // New: for discs waiting on gaps
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
   * Uses batch processing for TV series to enable parallel exports
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
      // First, check for TV series batches that can be processed in parallel
      const tvBatches = await this.scanForTVBatches();

      if (tvBatches && Object.keys(tvBatches).length > 0) {
        for (const [seriesKey, seriesData] of Object.entries(tvBatches)) {
          const { analysis } = seriesData;

          // If multiple discs are processable, use parallel processing
          if (analysis.processable.length > 1) {
            log.info(`[Parallel Export] Processing ${analysis.processable.length} discs for ${seriesKey}`);
            await this.processParallelBatch(seriesData);
            // Remove processed discs from further consideration
            for (const disc of analysis.processable) {
              const idx = this.queue.findIndex(q => q.name === disc.name);
              if (idx >= 0) this.queue.splice(idx, 1);
            }
          } else if (analysis.processable.length === 1) {
            // Single disc - use regular queue
            const disc = analysis.processable[0];
            const alreadyQueued = this.queue.find(q => q.name === disc.name);
            const alreadyProcessing = this.processing?.name === disc.name;
            const alreadyParallel = this.parallelProcessing.has(disc.name);

            if (!alreadyQueued && !alreadyProcessing && !alreadyParallel) {
              log.info(`[Auto-Export] Queueing single TV disc: ${disc.name}`);
              this.queueExport(disc.name, disc.path, disc.metadata);
            }
          }

          // Mark waiting discs
          for (const disc of analysis.waiting) {
            await this.identifier.update(disc.path, {
              status: MetadataStatus.WAITING_FOR_DISC,
              waitingFor: disc.missingDiscs || []
            });

            if (this.onWaiting) {
              this.onWaiting({
                name: disc.name,
                reason: disc.reason,
                missingDiscs: disc.missingDiscs
              });
            }
          }
        }
      }

      // Then handle remaining backups (movies and single TV discs)
      const entries = readdirSync(this.backupPath, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const backupDir = path.join(this.backupPath, entry.name);
        const metadata = await this.identifier.loadMetadata(backupDir);

        // Check if approved/manual and not yet exported
        // Both APPROVED and MANUAL indicate user-confirmed metadata
        const isReady = metadata?.status === MetadataStatus.APPROVED ||
                       metadata?.status === MetadataStatus.MANUAL;

        // Skip if already handled as part of TV batch
        const isTV = metadata?.tmdb?.mediaType === MediaType.TV;
        if (isTV && tvBatches) continue; // Already handled above

        if (isReady) {
          // Check if not already in queue or processing
          const alreadyQueued = this.queue.find(q => q.name === entry.name);
          const alreadyProcessing = this.processing?.name === entry.name;
          const alreadyParallel = this.parallelProcessing.has(entry.name);

          if (!alreadyQueued && !alreadyProcessing && !alreadyParallel) {
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
   * Scan for TV series batches and determine which can be processed in parallel
   * Groups discs by series/season and identifies gaps
   */
  async scanForTVBatches() {
    if (!this.backupPath || !existsSync(this.backupPath)) return null;

    try {
      const entries = readdirSync(this.backupPath, { withFileTypes: true });
      const tvDiscs = [];

      // Collect all approved TV discs
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const backupDir = path.join(this.backupPath, entry.name);
        const metadata = await this.identifier.loadMetadata(backupDir);

        const isReady = metadata?.status === MetadataStatus.APPROVED ||
                       metadata?.status === MetadataStatus.MANUAL;
        const isTV = metadata?.tmdb?.mediaType === MediaType.TV;

        if (isReady && isTV) {
          const showTitle = metadata.final?.title || metadata.tmdb?.title;
          const showYear = metadata.final?.year || metadata.tmdb?.year;
          const seriesKey = `${showTitle} (${showYear || 'Unknown'})`;
          const discLabel = metadata.disc?.volumeLabel || '';
          const season = extractSeasonFromLabel(discLabel) || 1;
          const discNum = extractDiscNumberFromLabel(discLabel);

          tvDiscs.push({
            name: entry.name,
            path: backupDir,
            metadata,
            seriesKey,
            season,
            discNum,
            showTitle,
            showYear
          });
        }
      }

      if (tvDiscs.length === 0) return null;

      // Group by series
      const bySeries = {};
      for (const disc of tvDiscs) {
        if (!bySeries[disc.seriesKey]) {
          bySeries[disc.seriesKey] = {
            showTitle: disc.showTitle,
            showYear: disc.showYear,
            discs: [],
            tmdb: disc.metadata.tmdb
          };
        }
        bySeries[disc.seriesKey].discs.push(disc);
      }

      // Analyze each series batch
      const results = {};
      for (const [seriesKey, seriesData] of Object.entries(bySeries)) {
        // Read season tracker for this series
        const seriesFolderName = seriesData.showYear
          ? `${seriesData.showTitle} (${seriesData.showYear})`
          : seriesData.showTitle;
        const localTrackerPath = path.join(
          this.backupPath,
          `${seriesFolderName.replace(/[<>:"/\\|?*]/g, '')}_tracker`
        );
        const tracker = await readSeasonTracker(localTrackerPath);

        // Analyze batch for processable vs waiting
        const analysis = analyzeDiscBatch(seriesData.discs, tracker);

        results[seriesKey] = {
          ...seriesData,
          analysis,
          tracker,
          trackerPath: localTrackerPath
        };

        // Log findings
        if (analysis.processable.length > 0) {
          log.info(`[${seriesKey}] ${analysis.processable.length} disc(s) ready for parallel export`);
        }
        if (analysis.waiting.length > 0) {
          log.info(`[${seriesKey}] ${analysis.waiting.length} disc(s) waiting (gaps: ${analysis.gaps.join(', ')})`);
        }
      }

      return results;
    } catch (err) {
      log.error(`TV batch scan error: ${err.message}`);
      return null;
    }
  }

  /**
   * Process a batch of TV discs in parallel
   * Pre-calculates episode assignments, then exports concurrently
   */
  async processParallelBatch(seriesData) {
    const { showTitle, showYear, analysis, tracker, trackerPath, tmdb } = seriesData;
    const { processable, waiting, gaps } = analysis;

    if (processable.length === 0) {
      log.info(`No processable discs for ${showTitle}`);
      return;
    }

    log.info(`Starting parallel export of ${processable.length} discs for ${showTitle}`);

    // Mark waiting discs with WAITING_FOR_DISC status
    for (const disc of waiting) {
      await this.identifier.update(disc.path, {
        status: MetadataStatus.WAITING_FOR_DISC,
        waitingFor: disc.missingDiscs || []
      });
      this.emitLog(disc.name, `Waiting for disc(s): ${disc.missingDiscs?.join(', ') || 'unknown'}`);

      if (this.onWaiting) {
        this.onWaiting({
          name: disc.name,
          reason: disc.reason,
          missingDiscs: disc.missingDiscs
        });
      }
    }

    // Pre-calculate episode assignments for all processable discs
    // This ensures correct episode numbers even when processing in parallel
    try {
      // First, analyze each disc to get episode count
      await this.init();
      for (const disc of processable) {
        let scanResult;
        if (disc.metadata.titleScan?.titles?.length > 0) {
          scanResult = disc.metadata.titleScan;
        } else {
          scanResult = await this.embyExporter.scanTitles(disc.path);
          // Cache the scan
          const titleScan = {
            scannedAt: new Date().toISOString(),
            discType: scanResult.discType,
            mainFeatureIndex: scanResult.mainFeatureIndex,
            titles: scanResult.titles
          };
          await this.identifier.update(disc.path, { titleScan });
        }

        // Analyze to get episode count
        const episodeAnalysis = await analyzeDiscForEpisodes(scanResult.titles, disc.metadata);
        disc.episodeCount = episodeAnalysis.episodes?.length || 4;
        disc.scanResult = scanResult;
        disc.episodeAnalysis = episodeAnalysis;
      }

      // Pre-calculate episode assignments
      // **NEW**: Check if intelligent episode detection is available for ALL discs
      const allHaveIntelligentDetection = processable.every(disc =>
        disc.metadata.episodes &&
        disc.metadata.episodes.season &&
        disc.metadata.episodes.startEpisode
      );

      if (allHaveIntelligentDetection) {
        // Use intelligent correlation results directly
        log.info('[Parallel Export] Using intelligent episode detection for all discs');

        // **CRITICAL FIX**: Track cumulative episode offset to handle multiple discs correctly
        // Even with intelligent detection, if all discs say "E01-E04", we need to offset them
        let cumulativeOffset = 0;

        for (const disc of processable) {
          const season = disc.metadata.episodes.season;
          let startEpisode = disc.metadata.episodes.startEpisode;
          const episodeCount = disc.metadata.episodes.episodeCount || (disc.metadata.episodes.endEpisode - disc.metadata.episodes.startEpisode + 1);

          // Check season tracker for already-exported episodes
          const trackerKey = `season${season}`;
          if (tracker[trackerKey]?.lastEpisode) {
            const trackerNextEpisode = tracker[trackerKey].lastEpisode + 1;
            if (trackerNextEpisode > startEpisode + cumulativeOffset) {
              log.info(`[Parallel] Tracker override for ${disc.name}: tracker says start at E${trackerNextEpisode}`);
              cumulativeOffset = trackerNextEpisode - startEpisode;
            }
          }

          // Apply cumulative offset for this batch of discs
          const adjustedStart = startEpisode + cumulativeOffset;
          const adjustedEnd = adjustedStart + episodeCount - 1;

          const assignment = {
            season: season,
            startEpisode: adjustedStart,
            endEpisode: adjustedEnd,
            episodes: [] // Will be populated from TMDB if available
          };
          this.episodeAssignments.set(disc.name, assignment);
          log.info(`Pre-assigned ${disc.name}: S${season} E${adjustedStart}-E${adjustedEnd} (intelligent detection + tracker offset, confidence: ${disc.metadata.episodes.confidence})`);

          // Update cumulative offset for next disc in this batch
          cumulativeOffset += episodeCount;
        }
      } else {
        // Fallback to old calculation method
        log.info('[Parallel Export] Using fallback episode calculation (no intelligent detection)');
        const assignments = await preCalculateEpisodeAssignments(processable, tracker, tmdb);
        for (const [discName, assignment] of assignments) {
          this.episodeAssignments.set(discName, assignment);
          log.info(`Pre-assigned ${discName}: S${assignment.season} E${assignment.startEpisode}-E${assignment.endEpisode} (fallback method)`);
        }
      }
    } catch (err) {
      log.error(`Failed to pre-calculate episode assignments: ${err.message}`);
      // Fall back to sequential processing
      for (const disc of processable) {
        this.queueExport(disc.name, disc.path, disc.metadata);
      }
      return;
    }

    // Process discs in parallel (limited by maxParallelExports)
    const settings = await this.getSettings();
    const transferConfig = settings.transfer || {};
    const libraryPath = transferConfig.tvPath;

    if (!libraryPath) {
      log.error('TV library path not configured');
      return;
    }

    // Process in batches of maxParallelExports
    for (let i = 0; i < processable.length; i += this.maxParallelExports) {
      const batch = processable.slice(i, i + this.maxParallelExports);

      const promises = batch.map(disc => {
        const job = {
          name: disc.name,
          path: disc.path,
          metadata: disc.metadata,
          queuedAt: Date.now()
        };

        // Store the assignment for this disc
        job.preCalculatedEpisodes = this.episodeAssignments.get(disc.name);
        job.scanResult = disc.scanResult;
        job.episodeAnalysis = disc.episodeAnalysis;

        const promise = this.exportTVEpisodesParallel(job, transferConfig, libraryPath)
          .then(result => {
            this.parallelProcessing.delete(disc.name);
            if (this.onComplete) {
              this.onComplete({ name: disc.name, path: result?.remotePath, success: true });
            }
            return result;
          })
          .catch(err => {
            this.parallelProcessing.delete(disc.name);
            log.error(`Parallel export failed for ${disc.name}: ${err.message}`);
            if (this.onError) {
              this.onError({ name: disc.name, error: err.message });
            }
          });

        this.parallelProcessing.set(disc.name, { promise, job });
        return promise;
      });

      // Wait for this batch to complete before starting next
      await Promise.all(promises);
    }

    // Update tracker with all exported episodes
    let maxEpisode = tracker[`season${processable[0]?.season}`]?.lastEpisode || 0;
    let maxDisc = tracker[`season${processable[0]?.season}`]?.lastDisc || 0;

    for (const disc of processable) {
      const assignment = this.episodeAssignments.get(disc.name);
      if (assignment && assignment.endEpisode > maxEpisode) {
        maxEpisode = assignment.endEpisode;
      }
      if (disc.discNum > maxDisc) {
        maxDisc = disc.discNum;
      }
    }

    // Write updated tracker
    const season = processable[0]?.season || 1;
    const updatedTracker = { ...tracker };
    updatedTracker[`season${season}`] = {
      lastEpisode: maxEpisode,
      lastDisc: maxDisc,
      processedDiscs: [
        ...(tracker[`season${season}`]?.processedDiscs || []),
        ...processable.map(d => d.discNum).filter(Boolean)
      ],
      lastExportedAt: new Date().toISOString()
    };
    await writeSeasonTracker(trackerPath, updatedTracker);

    log.info(`Parallel batch complete for ${showTitle}: ${processable.length} discs exported`);

    // Check if any waiting discs can now be processed
    if (waiting.length > 0) {
      log.info('Re-checking waiting discs after batch completion...');
      setTimeout(() => this.scanForApproved(), 5000);
    }
  }

  /**
   * Export TV episodes with pre-calculated episode assignments (for parallel processing)
   */
  async exportTVEpisodesParallel(job, transferConfig, libraryPath) {
    const showTitle = job.metadata.final?.title || job.metadata.disc?.volumeLabel || job.name;
    const showYear = job.metadata.final?.year || null;
    const assignment = job.preCalculatedEpisodes;

    if (!assignment) {
      // Fall back to sequential method
      log.warn(`No pre-calculated assignment for ${job.name}, using sequential export`);
      return this.exportTVEpisodes(job, job.scanResult, transferConfig, libraryPath);
    }

    const season = assignment.season;
    const startEpisode = assignment.startEpisode;
    const seriesFolderName = showYear ? `${showTitle} (${showYear})` : showTitle;

    this.emitLog(job.name, `Parallel export: ${showTitle} S${String(season).padStart(2, '0')} E${String(startEpisode).padStart(2, '0')}-E${String(assignment.endEpisode).padStart(2, '0')}`);

    // Use existing episode analysis
    const episodeAnalysis = job.episodeAnalysis;

    if (!episodeAnalysis?.isTV || episodeAnalysis.episodes.length === 0) {
      this.emitLog(job.name, 'No TV episodes detected, falling back to main feature export');
      return this.exportSingleTVTitle(job, job.scanResult, transferConfig, libraryPath);
    }

    // **FIX**: Fetch TMDB season data to get correct episode titles for actual episode numbers
    let tmdbSeasonData = null;
    const tmdbId = job.metadata.tmdb?.id;
    if (tmdbId) {
      try {
        const tmdb = getTMDBClient();
        tmdbSeasonData = await tmdb.getTVSeasonDetails(tmdbId, season);
        this.emitLog(job.name, `Fetched TMDB season ${season} data: ${tmdbSeasonData?.episodes?.length || 0} episodes`);
      } catch (tmdbErr) {
        log.warn(`Failed to fetch TMDB season data: ${tmdbErr.message}`);
      }
    }

    // Re-number episodes based on pre-calculated assignment
    // **FIX**: Look up TMDB titles by ACTUAL episode number, not disc index
    const episodes = episodeAnalysis.episodes.map((ep, idx) => {
      const actualEpisodeNum = startEpisode + idx;
      const tmdbEpisode = tmdbSeasonData?.episodes?.find(e => e.episodeNumber === actualEpisodeNum);

      return {
        ...ep,
        season: season,
        episode: actualEpisodeNum,
        // Use TMDB data for the ACTUAL episode number
        episodeTitle: tmdbEpisode?.name || `Episode ${actualEpisodeNum}`,
        overview: tmdbEpisode?.overview || ep.overview || '',
        airDate: tmdbEpisode?.airDate || ep.airDate || ''
      };
    });

    this.emitLog(job.name, `Exporting ${episodes.length} episodes (pre-calculated assignment)`);

    // Create temp directory
    const tempDir = path.join(path.dirname(job.path), `_export_temp_${job.name}`);
    await fs.mkdir(tempDir, { recursive: true });

    const progressPerEpisode = 80 / episodes.length;
    let lastTransferResult = null;
    const exportedEpisodes = [];

    // Series relative path for folder structure
    const seriesRelativePath = seriesFolderName.replace(/[<>:"/\\|?*]/g, '');

    // NOTE: TV show NFO files disabled - they cause Emby to not detect episodes properly

    // Export each episode
    for (let i = 0; i < episodes.length; i++) {
      const ep = episodes[i];
      const episodeNum = ep.episode;
      const seasonNum = ep.season;

      const baseProgress = 10 + (i * progressPerEpisode);
      this.emitProgress(job.name, baseProgress, `Episode ${i + 1}/${episodes.length}...`);

      // Generate Emby path for this episode
      const outputInfo = this.embyExporter.generateEmbyPath({
        title: showTitle,
        year: showYear,
        mediaType: MediaType.TV,
        tvInfo: {
          season: seasonNum,
          episode: episodeNum,
          episodeTitle: ep.episodeTitle
        },
        embyLibraryPath: libraryPath
      });

      const folderRelative = path.relative(libraryPath, outputInfo.folderPath);
      const relativePath = path.join(folderRelative, outputInfo.fileName);
      const tempMkvPath = path.join(tempDir, outputInfo.fileName);

      // Remux this episode
      this.emitLog(job.name, `S${String(seasonNum).padStart(2, '0')}E${String(episodeNum).padStart(2, '0')}: ${ep.episodeTitle}`);

      await this.embyExporter.convertToMkv(
        job.path,
        ep.titleIndex,
        tempMkvPath,
        (progress) => {
          const scaledPercent = baseProgress + (progress.percent * progressPerEpisode * 0.4 / 100);
          this.emitProgress(job.name, scaledPercent, `Remuxing...`);
        },
        null
      );

      // Transfer MKV
      lastTransferResult = await this.transferManager.transfer(
        tempMkvPath,
        { ...transferConfig, mediaType: MediaType.TV, relativePath },
        (percent) => {
          const scaledPercent = baseProgress + progressPerEpisode * 0.5 + (percent * progressPerEpisode * 0.4 / 100);
          this.emitProgress(job.name, scaledPercent, `Transferring...`);
        },
        null
      );

      // Clean up temp files to save disk space
      await fs.unlink(tempMkvPath).catch(() => {});

      exportedEpisodes.push({
        season: seasonNum,
        episode: episodeNum,
        title: ep.episodeTitle,
        path: lastTransferResult.remotePath
      });
    }

    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});

    // Update metadata status
    await this.identifier.update(job.path, {
      status: MetadataStatus.EXPORTED,
      exported: {
        at: new Date().toISOString(),
        episodes: exportedEpisodes,
        protocol: transferConfig.protocol,
        startEpisode: startEpisode,
        lastEpisode: assignment.endEpisode
      }
    });

    this.emitProgress(job.name, 100, 'Export complete!');
    this.emitLog(job.name, `Complete! ${exportedEpisodes.length} episodes exported`);

    return lastTransferResult || { remotePath: libraryPath };
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

      // Determine media type from metadata (with fallback to LLM guess)
      const mediaType = job.metadata.tmdb?.mediaType ||
                       job.metadata.final?.mediaType ||
                       job.metadata.llmGuess?.type ||
                       MediaType.MOVIE;

      // Get the appropriate library path
      const libraryPath = mediaType === MediaType.TV
        ? transferConfig.tvPath
        : transferConfig.moviePath;

      if (!libraryPath) {
        throw new Error(`${mediaType} library path not configured`);
      }

      // Step 1: Scan titles to find main feature (or use cached scan)
      await this.init(); // Ensure embyExporter is initialized

      let scanResult;
      let usedCache = false;

      // Check for cached title scan from previous export
      if (job.metadata.titleScan?.titles?.length > 0) {
        this.emitProgress(job.name, 5, 'Using cached title scan...');
        this.emitLog(job.name, 'Using cached title scan from previous export (skipping MakeMKV scan)');
        scanResult = job.metadata.titleScan;
        usedCache = true;
      } else {
        this.emitProgress(job.name, 5, 'Scanning disc for titles...');
        this.emitLog(job.name, 'Scanning disc for available titles...');
        scanResult = await this.embyExporter.scanTitles(job.path);

        // Cache the scan result for future re-exports
        if (scanResult.titles?.length > 0) {
          const titleScan = {
            scannedAt: new Date().toISOString(),
            discType: scanResult.discType,
            mainFeatureIndex: scanResult.mainFeatureIndex,
            titles: scanResult.titles
          };
          await this.identifier.update(job.path, { titleScan });
          this.emitLog(job.name, 'Cached title scan for future re-exports');
        }
      }

      if (!scanResult.titles || scanResult.titles.length === 0) {
        throw new Error('No titles found in backup');
      }

      this.emitLog(job.name, `${usedCache ? 'Cached: ' : 'Found '}${scanResult.titles.length} titles`);

      // Branch: TV shows vs Movies
      let transferResult;

      if (mediaType === MediaType.TV) {
        // TV Show Export - analyze for multiple episodes
        transferResult = await this.exportTVEpisodes(job, scanResult, transferConfig, libraryPath);
      } else {
        // Movie Export - single main feature
        transferResult = await this.exportMovie(job, scanResult, transferConfig, libraryPath);
      }

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
   * Export a movie (single main feature)
   */
  async exportMovie(job, scanResult, transferConfig, libraryPath) {
    // Find main feature (longest title with chapters)
    const mainFeature = scanResult.titles.find(t => t.isMainFeature) ||
                       scanResult.titles[0];

    this.emitLog(job.name, `Main feature: Title ${mainFeature.index} (${mainFeature.durationDisplay})`);

    // Generate output path and filename
    const outputInfo = this.embyExporter.generateEmbyPath({
      title: job.metadata.final?.title || job.metadata.disc?.volumeLabel || job.name,
      year: job.metadata.final?.year || null,
      tmdbId: job.metadata.tmdb?.id || null,
      mediaType: MediaType.MOVIE,
      tvInfo: null,
      embyLibraryPath: libraryPath
    });

    // Calculate relative path for folder structure
    const folderRelative = path.relative(libraryPath, outputInfo.folderPath);
    const relativePath = path.join(folderRelative, outputInfo.fileName);

    // Create temp output directory for remux
    const tempDir = path.join(path.dirname(job.path), '_export_temp');
    await fs.mkdir(tempDir, { recursive: true });
    const tempMkvPath = path.join(tempDir, outputInfo.fileName);

    // Remux to MKV (lossless)
    this.emitProgress(job.name, 10, 'Remuxing to MKV...');
    this.emitLog(job.name, `Remuxing title ${mainFeature.index} to MKV (lossless)...`);

    await this.embyExporter.convertToMkv(
      job.path,
      mainFeature.index,
      tempMkvPath,
      (progress) => {
        const scaledPercent = 10 + (progress.percent * 0.55);
        this.emitProgress(job.name, scaledPercent, 'Remuxing...');
      },
      (message) => this.emitLog(job.name, message)
    );

    this.emitLog(job.name, `Remux complete: ${tempMkvPath}`);

    // Generate NFO file
    this.emitProgress(job.name, 65, 'Generating NFO metadata...');
    const tempNfoPath = path.join(tempDir, 'movie.nfo');
    const nfoRelativePath = path.join(folderRelative, 'movie.nfo');

    try {
      await writeMovieNfo(tempDir, {
        title: job.metadata.final?.title || job.metadata.disc?.volumeLabel || job.name,
        year: job.metadata.final?.year || '',
        tmdbId: job.metadata.tmdb?.id || '',
        imdbId: job.metadata.tmdb?.imdb_id || '',
        overview: job.metadata.tmdb?.overview || '',
        releaseDate: job.metadata.tmdb?.release_date || '',
        runtime: job.metadata.tmdb?.runtime || '',
        genres: job.metadata.tmdb?.genres || [],
        cast: job.metadata.tmdb?.credits?.cast || [],
        crew: job.metadata.tmdb?.credits?.crew || [],
        rating: job.metadata.tmdb?.vote_average || '',
        voteCount: job.metadata.tmdb?.vote_count || '',
        tagline: job.metadata.tmdb?.tagline || '',
        originalTitle: job.metadata.tmdb?.original_title || '',
        originalLanguage: job.metadata.tmdb?.original_language || '',
        productionCompanies: job.metadata.tmdb?.production_companies || []
      });
      this.emitLog(job.name, 'Generated movie NFO');
    } catch (nfoErr) {
      log.warn(`NFO generation warning: ${nfoErr.message}`);
    }

    // Transfer MKV to destination
    this.emitProgress(job.name, 70, 'Transferring to library...');
    this.emitLog(job.name, `Transferring via ${transferConfig.protocol.toUpperCase()}...`);

    const transferResult = await this.transferManager.transfer(
      tempMkvPath,
      { ...transferConfig, mediaType: MediaType.MOVIE, relativePath },
      (percent) => {
        const scaledPercent = 70 + (percent * 0.2);
        this.emitProgress(job.name, scaledPercent, 'Transferring...');
      },
      (message) => this.emitLog(job.name, message)
    );

    // Transfer NFO
    try {
      await this.transferManager.transfer(
        tempNfoPath,
        { ...transferConfig, mediaType: MediaType.MOVIE, relativePath: nfoRelativePath },
        null, null
      );
      this.emitLog(job.name, 'NFO transferred successfully');
    } catch (nfoErr) {
      log.warn(`NFO transfer warning: ${nfoErr.message}`);
    }

    // Clean up temp files
    this.emitProgress(job.name, 95, 'Cleaning up...');
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});

    // Update metadata status
    this.emitProgress(job.name, 98, 'Updating metadata...');
    await this.identifier.update(job.path, {
      status: MetadataStatus.EXPORTED,
      exported: {
        at: new Date().toISOString(),
        path: transferResult.remotePath,
        protocol: transferConfig.protocol
      }
    });

    this.emitProgress(job.name, 100, 'Export complete!');
    this.emitLog(job.name, `Export complete! File transferred to: ${transferResult.remotePath}`);

    return transferResult;
  }

  /**
   * Export TV episodes (multiple titles from disc)
   */
  async exportTVEpisodes(job, scanResult, transferConfig, libraryPath) {
    const showTitle = job.metadata.final?.title || job.metadata.disc?.volumeLabel || job.name;
    const showYear = job.metadata.final?.year || null;
    const discLabel = job.metadata.disc?.volumeLabel || '';

    // Build series folder path for season tracker
    const seriesFolderName = showYear ? `${showTitle} (${showYear})` : showTitle;
    const seriesPath = path.join(libraryPath, seriesFolderName.replace(/[<>:"/\\|?*]/g, ''));

    // Read season tracker to determine correct starting episode
    this.emitProgress(job.name, 6, 'Checking season tracker...');
    let seasonTracker = {};
    try {
      // For remote destinations, we'll use the local backup path for tracker
      // The tracker file lives in the series folder on the destination
      // For now, we track locally in the backup folder
      const localTrackerPath = path.join(job.path, '..', `${seriesFolderName.replace(/[<>:"/\\|?*]/g, '')}_tracker`);
      seasonTracker = await readSeasonTracker(localTrackerPath);
    } catch (err) {
      log.debug('No existing season tracker found');
    }

    // Analyze disc to detect episode titles
    this.emitProgress(job.name, 8, 'Analyzing TV disc for episodes...');
    const analysis = await analyzeDiscForEpisodes(scanResult.titles, job.metadata);

    if (!analysis.isTV || analysis.episodes.length === 0) {
      // Fall back to single main feature if no episodes detected
      this.emitLog(job.name, 'No TV episodes detected, falling back to main feature export');
      // Treat as movie-style single export but with TV metadata
      return this.exportSingleTVTitle(job, scanResult, transferConfig, libraryPath);
    }

    // **NEW**: Check if intelligent episode detection results are available
    let season, startEpisode;
    if (job.metadata.episodes && job.metadata.episodes.season && job.metadata.episodes.startEpisode) {
      // Use intelligent correlation results from episode detector
      season = job.metadata.episodes.season;
      startEpisode = job.metadata.episodes.startEpisode;
      this.emitLog(job.name, `Metadata episode detection: Season ${season}, Episodes ${startEpisode}-${job.metadata.episodes.endEpisode} (confidence: ${job.metadata.episodes.confidence}, ${job.metadata.episodes.heuristicUsed})`);
      this.emitLog(job.name, `Reason: ${job.metadata.episodes.correlationReason}`);

      // **CRITICAL FIX**: Check season tracker - if episodes already exported for this season,
      // the tracker's lastEpisode takes precedence over metadata's startEpisode
      // This prevents multiple discs from all exporting as E01-E04
      const trackerKey = `season${season}`;
      if (seasonTracker[trackerKey]?.lastEpisode) {
        const trackerNextEpisode = seasonTracker[trackerKey].lastEpisode + 1;
        if (trackerNextEpisode > startEpisode) {
          this.emitLog(job.name, `Season tracker override: Already exported up to E${seasonTracker[trackerKey].lastEpisode}, starting at E${trackerNextEpisode} instead of E${startEpisode}`);
          startEpisode = trackerNextEpisode;
        }
      }
    } else {
      // Pre-flight: Try episode detection if metadata.episodes not yet populated (async identification still running)
      this.emitLog(job.name, `No pre-calculated episode detection found, attempting pre-flight detection...`);
      try {
        const episodeDetector = new (await import('./metadata/episode-detector.js')).EpisodeDetector();
        const preFlightResult = await episodeDetector.detectEpisodeNumbers({
          discPath: job.path,
          discType: job.metadata.disc?.type === 'Blu-ray' ? 'bluray' : 'dvd',
          volumeLabel: discLabel,
          tmdbId: job.metadata.tmdb?.id || null,
          currentSeasonHint: extractSeasonFromLabel(discLabel)
        });

        if (preFlightResult && preFlightResult.season) {
          season = preFlightResult.season;
          startEpisode = preFlightResult.startEpisode;
          this.emitLog(job.name, `Pre-flight detection succeeded: Season ${season}, Episodes ${startEpisode}-${preFlightResult.endEpisode} (confidence: ${preFlightResult.confidence})`);
          // Update metadata for future exports
          job.metadata.episodes = preFlightResult;
        } else {
          throw new Error('Pre-flight detection returned no result');
        }
      } catch (preflightError) {
        this.emitLog(job.name, `Pre-flight detection failed: ${preflightError.message}, falling back to sequential numbering`);

        // Fallback to sequential numbering (old method)
        season = job.metadata.tvInfo?.season ||
                 job.metadata.llmGuess?.tvInfo?.season ||
                 extractSeasonFromLabel(discLabel) || 1;

        const discNum = extractDiscNumberFromLabel(discLabel);
        this.emitLog(job.name, `Disc ${discNum || '?'}, Season ${season} - using sequential episode numbering (fallback)`);

        startEpisode = calculateStartEpisode({
          season,
          discLabel,
          tracker: seasonTracker,
          episodeCount: analysis.episodes.length
        });
        this.emitLog(job.name, `Fallback method: Starting at episode ${startEpisode} (no intelligent detection available)`);
      }
    }

    // **FIX**: Fetch TMDB season data to get correct episode titles for actual episode numbers
    let tmdbSeasonData = null;
    const tmdbId = job.metadata.tmdb?.id;
    if (tmdbId) {
      try {
        const tmdb = getTMDBClient();
        tmdbSeasonData = await tmdb.getTVSeasonDetails(tmdbId, season);
        this.emitLog(job.name, `Fetched TMDB season ${season} data: ${tmdbSeasonData?.episodes?.length || 0} episodes`);
      } catch (tmdbErr) {
        log.warn(`Failed to fetch TMDB season data: ${tmdbErr.message}`);
      }
    }

    // Re-number episodes based on correct starting point
    // **FIX**: Look up TMDB titles by ACTUAL episode number, not disc index
    const episodes = analysis.episodes.map((ep, idx) => {
      const actualEpisodeNum = startEpisode + idx;
      const tmdbEpisode = tmdbSeasonData?.episodes?.find(e => e.episodeNumber === actualEpisodeNum);

      return {
        ...ep,
        season: season,
        episode: actualEpisodeNum,
        // Use TMDB data for the ACTUAL episode number
        episodeTitle: tmdbEpisode?.name || ep.episodeTitle || `Episode ${actualEpisodeNum}`,
        overview: tmdbEpisode?.overview || ep.overview || '',
        airDate: tmdbEpisode?.airDate || ep.airDate || ''
      };
    });

    this.emitLog(job.name, `Detected ${episodes.length} episodes for ${showTitle} Season ${season}`);
    if (analysis.playAllTitle) {
      this.emitLog(job.name, `Excluding "Play All" title ${analysis.playAllTitle.index} (${analysis.playAllTitle.durationDisplay})`);
    }

    // Create temp directory
    const tempDir = path.join(path.dirname(job.path), '_export_temp');
    await fs.mkdir(tempDir, { recursive: true });

    // Calculate progress increments per episode
    const progressPerEpisode = 80 / episodes.length; // 10-90% spread across episodes
    let lastTransferResult = null;
    const exportedEpisodes = [];

    // Series relative path for folder structure
    const seriesRelativePath = seriesFolderName.replace(/[<>:"/\\|?*]/g, '');

    // NOTE: TV show NFO files disabled - they cause Emby to not detect episodes properly

    // Export each episode
    for (let i = 0; i < episodes.length; i++) {
      const ep = episodes[i];
      const episodeNum = ep.episode;
      const seasonNum = ep.season;

      const baseProgress = 10 + (i * progressPerEpisode);
      this.emitProgress(job.name, baseProgress, `Episode ${i + 1}/${episodes.length}...`);
      this.emitLog(job.name, `--- Exporting S${String(seasonNum).padStart(2, '0')}E${String(episodeNum).padStart(2, '0')}: ${ep.episodeTitle} ---`);

      // Generate Emby path for this episode
      const outputInfo = this.embyExporter.generateEmbyPath({
        title: showTitle,
        year: showYear,
        mediaType: MediaType.TV,
        tvInfo: {
          season: seasonNum,
          episode: episodeNum,
          episodeTitle: ep.episodeTitle
        },
        embyLibraryPath: libraryPath
      });

      const folderRelative = path.relative(libraryPath, outputInfo.folderPath);
      const relativePath = path.join(folderRelative, outputInfo.fileName);
      const tempMkvPath = path.join(tempDir, outputInfo.fileName);

      // Remux this episode
      this.emitLog(job.name, `Remuxing title ${ep.titleIndex} (${ep.durationDisplay})...`);

      await this.embyExporter.convertToMkv(
        job.path,
        ep.titleIndex,
        tempMkvPath,
        (progress) => {
          const scaledPercent = baseProgress + (progress.percent * progressPerEpisode * 0.4 / 100);
          this.emitProgress(job.name, scaledPercent, `Remuxing S${String(seasonNum).padStart(2, '0')}E${String(episodeNum).padStart(2, '0')}...`);
        },
        (message) => this.emitLog(job.name, message)
      );

      // Transfer MKV
      this.emitLog(job.name, `Transferring episode to library...`);

      const transferMidProgress = baseProgress + (progressPerEpisode * 0.5);
      lastTransferResult = await this.transferManager.transfer(
        tempMkvPath,
        { ...transferConfig, mediaType: MediaType.TV, relativePath },
        (percent) => {
          const scaledPercent = transferMidProgress + (percent * progressPerEpisode * 0.4 / 100);
          this.emitProgress(job.name, scaledPercent, `Transferring S${String(seasonNum).padStart(2, '0')}E${String(episodeNum).padStart(2, '0')}...`);
        },
        null
      );

      // Clean up temp MKV to save disk space
      await fs.unlink(tempMkvPath).catch(() => {});

      exportedEpisodes.push({
        season: seasonNum,
        episode: episodeNum,
        title: ep.episodeTitle,
        path: lastTransferResult.remotePath
      });

      this.emitLog(job.name, `Episode ${i + 1}/${episodes.length} complete`);
    }

    // Clean up temp directory
    this.emitProgress(job.name, 95, 'Cleaning up...');
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});

    // Update season tracker for multi-disc handling
    this.emitProgress(job.name, 96, 'Updating season tracker...');
    const lastEpisode = startEpisode + episodes.length - 1;
    try {
      const localTrackerPath = path.join(job.path, '..', `${seriesFolderName.replace(/[<>:"/\\|?*]/g, '')}_tracker`);
      seasonTracker[`season${season}`] = {
        lastEpisode: lastEpisode,
        lastDisc: discNum || null,
        lastExportedAt: new Date().toISOString()
      };
      await writeSeasonTracker(localTrackerPath, seasonTracker);
      this.emitLog(job.name, `Season tracker updated: Season ${season} last episode = ${lastEpisode}`);
    } catch (trackerErr) {
      log.warn(`Season tracker update warning: ${trackerErr.message}`);
    }

    // Update metadata status
    this.emitProgress(job.name, 98, 'Updating metadata...');
    await this.identifier.update(job.path, {
      status: MetadataStatus.EXPORTED,
      exported: {
        at: new Date().toISOString(),
        episodes: exportedEpisodes,
        protocol: transferConfig.protocol,
        startEpisode: startEpisode,
        lastEpisode: lastEpisode
      }
    });

    this.emitProgress(job.name, 100, 'Export complete!');
    this.emitLog(job.name, `Export complete! ${exportedEpisodes.length} episodes (S${String(season).padStart(2, '0')}E${String(startEpisode).padStart(2, '0')}-E${String(lastEpisode).padStart(2, '0')}) transferred`);

    return lastTransferResult || { remotePath: libraryPath };
  }

  /**
   * Export a single TV title (fallback when episode detection fails)
   */
  async exportSingleTVTitle(job, scanResult, transferConfig, libraryPath) {
    const mainFeature = scanResult.titles.find(t => t.isMainFeature) || scanResult.titles[0];
    const tvInfo = job.metadata.tvInfo || { season: 1, episode: 1 };

    this.emitLog(job.name, `Single TV title export: Title ${mainFeature.index} (${mainFeature.durationDisplay})`);

    const outputInfo = this.embyExporter.generateEmbyPath({
      title: job.metadata.final?.title || job.metadata.disc?.volumeLabel || job.name,
      year: job.metadata.final?.year || null,
      mediaType: MediaType.TV,
      tvInfo,
      embyLibraryPath: libraryPath
    });

    const folderRelative = path.relative(libraryPath, outputInfo.folderPath);
    const relativePath = path.join(folderRelative, outputInfo.fileName);

    const tempDir = path.join(path.dirname(job.path), '_export_temp');
    await fs.mkdir(tempDir, { recursive: true });
    const tempMkvPath = path.join(tempDir, outputInfo.fileName);

    // Remux
    this.emitProgress(job.name, 10, 'Remuxing to MKV...');
    await this.embyExporter.convertToMkv(
      job.path, mainFeature.index, tempMkvPath,
      (p) => this.emitProgress(job.name, 10 + p.percent * 0.55, 'Remuxing...'),
      (m) => this.emitLog(job.name, m)
    );

    // Transfer
    this.emitProgress(job.name, 70, 'Transferring...');
    const transferResult = await this.transferManager.transfer(
      tempMkvPath,
      { ...transferConfig, mediaType: MediaType.TV, relativePath },
      (p) => this.emitProgress(job.name, 70 + p.percent * 0.2, 'Transferring...'),
      (m) => this.emitLog(job.name, m)
    );

    // Cleanup
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});

    // Update metadata
    await this.identifier.update(job.path, {
      status: MetadataStatus.EXPORTED,
      exported: { at: new Date().toISOString(), path: transferResult.remotePath, protocol: transferConfig.protocol }
    });

    this.emitProgress(job.name, 100, 'Export complete!');
    this.emitLog(job.name, `Export complete! Transferred to: ${transferResult.remotePath}`);

    return transferResult;
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
   * Get queue status including parallel processing
   */
  getQueueStatus() {
    return {
      queueLength: this.queue.length,
      processing: this.processing?.name || null,
      queue: this.queue.map(j => j.name),
      parallelProcessing: Array.from(this.parallelProcessing.keys()),
      parallelCount: this.parallelProcessing.size
    };
  }

  /**
   * Get series batch status for UI display
   * Returns info about each TV series being processed
   */
  async getSeriesBatchStatus() {
    const batches = await this.scanForTVBatches();
    if (!batches) return null;

    const status = {};
    for (const [seriesKey, seriesData] of Object.entries(batches)) {
      const { showTitle, showYear, analysis, tracker } = seriesData;

      status[seriesKey] = {
        showTitle,
        showYear,
        processable: analysis.processable.map(d => ({
          name: d.name,
          discNum: d.discNum,
          season: d.season
        })),
        waiting: analysis.waiting.map(d => ({
          name: d.name,
          discNum: d.discNum,
          season: d.season,
          reason: d.reason,
          missingDiscs: d.missingDiscs
        })),
        gaps: analysis.gaps,
        lastExported: tracker ? {
          season: Object.keys(tracker).find(k => k.startsWith('season'))?.replace('season', ''),
          episode: Object.values(tracker)[0]?.lastEpisode,
          disc: Object.values(tracker)[0]?.lastDisc
        } : null
      };
    }

    return status;
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
