// MakeMKV Adapter - Wrapper for MakeMKVcon command-line tool
// This module handles all interaction with MakeMKV

import { spawn, execSync } from 'child_process';
import { promises as fs, existsSync } from 'fs';
import path from 'path';
import os from 'os';
import { formatSize, isBackupComplete } from '../shared/utils.js';
import logger from './logger.js';
import https from 'https';
import { migrateSettings, needsMigration, CURRENT_SETTINGS_VERSION } from './settings-migration.js';

// MakeMKV Performance Presets
// These define cache sizes, buffer limits, and timeout values optimized for different disc types
const PERFORMANCE_PRESETS = {
  fast: {
    name: 'Fast',
    description: 'Minimal cache, faster startup, lower memory usage. Best for DVDs.',
    cache: 8,        // 8MB cache
    minbuf: 1,       // 1MB minimum buffer
    maxbuf: 8,       // 8MB maximum buffer
    timeout: 8000,   // 8 second timeout
    splitSize: 0,    // No file splitting
    retryOnError: true,
    maxRetries: 3
  },
  balanced: {
    name: 'Balanced',
    description: 'Default settings. Good balance of speed and reliability.',
    cache: 16,       // 16MB cache (original default was 4MB)
    minbuf: 1,       // 1MB minimum buffer
    maxbuf: 16,      // 16MB maximum buffer
    timeout: 10000,  // 10 second timeout
    splitSize: 0,    // No file splitting
    retryOnError: true,
    maxRetries: 3
  },
  compatibility: {
    name: 'Compatibility',
    description: 'Larger cache, more retries. Best for damaged/scratched discs.',
    cache: 64,       // 64MB cache
    minbuf: 2,       // 2MB minimum buffer
    maxbuf: 32,      // 32MB maximum buffer
    timeout: 15000,  // 15 second timeout
    splitSize: 0,    // No file splitting
    retryOnError: true,
    maxRetries: 5
  },
  '4k-bluray': {
    name: '4K Blu-ray',
    description: 'Large cache for high bitrate 4K content. Best for UHD Blu-rays.',
    cache: 128,      // 128MB cache
    minbuf: 4,       // 4MB minimum buffer
    maxbuf: 64,      // 64MB maximum buffer
    timeout: 12000,  // 12 second timeout
    splitSize: 0,    // No file splitting
    retryOnError: true,
    maxRetries: 3
  }
};

export class MakeMKVAdapter {
  constructor() {
    // Default MakeMKV installation path
    this.makemkvPath = 'C:\\Program Files (x86)\\MakeMKV\\makemkvcon64.exe';
    // 7-Zip path for extracting VIDEO_TS from DVD images
    this.sevenZipPath = 'C:\\Program Files\\VapourSynth\\vsrepo\\7z.exe';
    this.currentProcess = null;
    this.settingsPath = path.join(os.homedir(), '.easyrip-settings.json');
    this._settingsLoaded = false;
    this.lastError = null;
    this.tmdbApiKey = '';
    this.makemkvKey = ''; // MakeMKV beta registration key
    this.transfer = null; // Transfer settings (protocol, host, paths)
    this.automation = { autoBackup: false, autoMeta: true, autoExport: false, liveDangerously: false, ejectAfterBackup: false }; // Automation toggles
    this.makemkvPerformance = null; // Performance settings (presets + custom overrides)
    this.extraction = { defaultMode: 'full_backup', minTitleLength: 10 }; // Extraction mode settings
    // AI Provider settings
    this.aiProviders = {
      activeProvider: 'ollama',
      ollama: { enabled: true, baseUrl: 'http://127.0.0.1:11434', model: 'hermes3:8b' },
      openrouter: { enabled: false, model: 'anthropic/claude-3.5-haiku' },
      claude: { enabled: false, model: 'claude-haiku-4-5-20251001' }
    };
    // Settings cache for performance optimization
    this.settingsCache = null;
    this.settingsCacheTime = 0;
    this.settingsCacheTTL = 5000; // 5 second cache TTL
  }

  // Load saved settings from disk
  async loadSettings() {
    if (this._settingsLoaded) return; // Already loaded
    try {
      const data = await fs.readFile(this.settingsPath, 'utf8');
      let settings = JSON.parse(data);

      // Check if settings need migration
      if (needsMigration(settings)) {
        logger.info('makemkv', `Migrating settings from v${settings.settingsVersion || 0} to v${CURRENT_SETTINGS_VERSION}`);
        settings = migrateSettings(settings);
        // Save migrated settings back to disk
        await fs.writeFile(this.settingsPath, JSON.stringify(settings, null, 2), 'utf8');
        logger.info('makemkv', 'Settings migration complete');
      }

      this.settingsVersion = settings.settingsVersion || CURRENT_SETTINGS_VERSION;
      this.makemkvPath = settings.makemkvPath || this.makemkvPath;
      this.basePath = settings.basePath || 'D:\\EasyRip';
      this.tmdbApiKey = settings.tmdbApiKey || '';
      this.makemkvKey = settings.makemkvKey || '';
      this.transfer = settings.transfer || null;
      this.automation = settings.automation || { autoBackup: false, autoMeta: true, autoExport: false, liveDangerously: false, ejectAfterBackup: false };
      this.makemkvPerformance = settings.makemkvPerformance || this.getDefaultPerformanceSettings();
      this.extraction = settings.extraction || { defaultMode: 'full_backup', minTitleLength: 10 };
      this.aiProviders = settings.aiProviders || this.aiProviders;
    } catch {
      // Settings file doesn't exist yet, use defaults
      this.settingsVersion = CURRENT_SETTINGS_VERSION;
      this.basePath = 'D:\\EasyRip';
      this.tmdbApiKey = '';
      this.makemkvKey = '';
      this.transfer = null;
      this.automation = { autoBackup: false, autoMeta: true, autoExport: false, liveDangerously: false, ejectAfterBackup: false };
      this.makemkvPerformance = this.getDefaultPerformanceSettings();
      this.extraction = { defaultMode: 'full_backup', minTitleLength: 10 };
      // aiProviders keeps its default from constructor
    }
    this._settingsLoaded = true;
  }

  // Get current settings with caching (5s TTL for performance)
  async getSettings() {
    const now = Date.now();

    // Return cached settings if still valid
    if (this.settingsCache && (now - this.settingsCacheTime) < this.settingsCacheTTL) {
      return this.settingsCache;
    }

    // Re-read transfer/automation/performance settings from file to pick up changes without restart
    try {
      const data = await fs.readFile(this.settingsPath, 'utf8');
      const settings = JSON.parse(data);
      this.transfer = settings.transfer || null;
      this.automation = settings.automation || { autoBackup: false, autoMeta: true, autoExport: false, liveDangerously: false, ejectAfterBackup: false };
      this.makemkvPerformance = settings.makemkvPerformance || this.getDefaultPerformanceSettings();
      this.extraction = settings.extraction || { defaultMode: 'full_backup', minTitleLength: 10 };
      this.aiProviders = settings.aiProviders || this.aiProviders;
    } catch {
      // If file read fails, keep existing cached values
    }

    // Build and cache the settings object
    const settingsObject = {
      settingsVersion: this.settingsVersion || CURRENT_SETTINGS_VERSION,
      makemkvPath: this.makemkvPath,
      basePath: this.basePath,
      tmdbApiKey: this.tmdbApiKey,
      makemkvKey: this.makemkvKey,
      transfer: this.transfer,
      automation: this.automation,
      makemkvPerformance: this.makemkvPerformance,
      extraction: this.extraction,
      aiProviders: this.aiProviders,
    };

    this.settingsCache = settingsObject;
    this.settingsCacheTime = now;

    return settingsObject;
  }

  // Save settings to disk
  async saveSettings(settings) {
    this.settingsVersion = CURRENT_SETTINGS_VERSION; // Always save with current version
    this.makemkvPath = settings.makemkvPath || this.makemkvPath;
    this.basePath = settings.basePath || this.basePath;
    this.tmdbApiKey = settings.tmdbApiKey || '';
    this.makemkvKey = settings.makemkvKey || '';
    this.transfer = settings.transfer || null;
    this.automation = settings.automation || { autoBackup: false, autoMeta: true, autoExport: false, liveDangerously: false, ejectAfterBackup: false };
    this.makemkvPerformance = settings.makemkvPerformance || this.getDefaultPerformanceSettings();
    this.extraction = settings.extraction || { defaultMode: 'full_backup', minTitleLength: 10 };
    this.aiProviders = settings.aiProviders || this.aiProviders;

    // Build settings object with version
    const settingsToSave = {
      settingsVersion: CURRENT_SETTINGS_VERSION,
      ...settings
    };

    await fs.writeFile(
      this.settingsPath,
      JSON.stringify(settingsToSave, null, 2),
      'utf8'
    );

    // Invalidate settings cache after save
    this.settingsCache = {
      settingsVersion: CURRENT_SETTINGS_VERSION,
      makemkvPath: this.makemkvPath,
      basePath: this.basePath,
      tmdbApiKey: this.tmdbApiKey,
      makemkvKey: this.makemkvKey,
      transfer: this.transfer,
      automation: this.automation,
      makemkvPerformance: this.makemkvPerformance,
      extraction: this.extraction,
      aiProviders: this.aiProviders,
    };
    this.settingsCacheTime = Date.now();

    // If MakeMKV key is provided, apply it to Windows registry
    if (this.makemkvKey) {
      await this.applyMakeMKVKey(this.makemkvKey);
    }
  }

  // Count files recursively in a folder
  async countFiles(folderPath) {
    let count = 0;
    try {
      const entries = await fs.readdir(folderPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile()) {
          count++;
        } else if (entry.isDirectory()) {
          count += await this.countFiles(path.join(folderPath, entry.name));
        }
      }
    } catch {
      return 0;
    }
    return count;
  }

  // Get total size of a file or folder
  // Handles both: DVDs (single file) and Blu-rays (folder structure)
  async getBackupSize(backupPath) {
    try {
      const stat = await fs.stat(backupPath);

      if (stat.isFile()) {
        // DVD backup - single file
        return stat.size;
      }

      // Blu-ray backup - folder structure
      let size = 0;
      const entries = await fs.readdir(backupPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(backupPath, entry.name);
        if (entry.isFile()) {
          const entryStat = await fs.stat(fullPath);
          size += entryStat.size;
        } else if (entry.isDirectory()) {
          size += await this.getBackupSize(fullPath);
        }
      }
      return size;
    } catch {
      return 0;
    }
  }

  // Alias for backwards compatibility
  async getFolderSize(folderPath) {
    return this.getBackupSize(folderPath);
  }

  // Delete file or folder
  async deleteBackup(backupPath) {
    try {
      await fs.rm(backupPath, { recursive: true, force: true });
      logger.debug('makemkv', `Deleted: ${backupPath}`);
      return true;
    } catch (err) {
      logger.error('makemkv', `Failed to delete: ${backupPath}`, err);
      return false;
    }
  }

  // Alias for backwards compatibility
  async deleteFolder(folderPath) {
    return this.deleteBackup(folderPath);
  }

  // Copy file or folder to destination
  // Handles both: DVDs (single file backup) and Blu-rays (folder structure)
  async copyBackup(src, dest, onLog) {
    const srcStat = await fs.stat(src);

    if (srcStat.isFile()) {
      // DVD backup - single file (log to file only, not UI)
      logger.debug('makemkv-copy', `Copying file: ${path.basename(src)}`);
      await fs.copyFile(src, dest);
    } else {
      // Blu-ray backup - folder structure
      await this.copyFolder(src, dest, onLog);
    }
  }

  // Copy folder recursively (for Blu-ray BDMV structure)
  // Note: onLog is accepted but not used for individual files to avoid log spam
  async copyFolder(src, dest, onLog) {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        await this.copyFolder(srcPath, destPath, onLog);
      } else {
        // Only log to file logger, not UI - avoids flooding logs
        logger.debug('makemkv-copy', `Copying: ${entry.name}`);
        await fs.copyFile(srcPath, destPath);
      }
    }
  }

  // Format bytes to human readable (delegates to shared utility)
  formatSize(bytes) {
    const result = formatSize(bytes);
    return result === '-' ? '0 B' : result;
  }

  // Get default performance settings (balanced preset)
  getDefaultPerformanceSettings() {
    return {
      preset: 'balanced',
      customSettings: {
        cache: 16,
        minbuf: 1,
        maxbuf: 16,
        timeout: 10000,
        splitSize: 0,
        retryOnError: true,
        maxRetries: 3
      },
      discTypeProfiles: {
        dvd: 'balanced',
        bluray: 'balanced',
        '4k-bluray': '4k-bluray'
      }
    };
  }

  // Build MakeMKV command-line flags based on performance settings
  // options: { preset, customSettings, discType, overrides }
  buildMakeMKVFlags(options = {}) {
    // Load performance settings if not provided
    const perfSettings = this.makemkvPerformance || this.getDefaultPerformanceSettings();

    // Determine which preset to use
    let preset = perfSettings.preset || 'balanced';

    // Check for disc-type specific override
    if (options.discType && perfSettings.discTypeProfiles && perfSettings.discTypeProfiles[options.discType]) {
      preset = perfSettings.discTypeProfiles[options.discType];
      logger.debug('makemkv-perf', `Using disc-type profile: ${options.discType} -> ${preset}`);
    }

    // Get base settings from preset or custom
    let settings;
    if (preset === 'custom') {
      settings = { ...perfSettings.customSettings };
    } else if (PERFORMANCE_PRESETS[preset]) {
      settings = { ...PERFORMANCE_PRESETS[preset] };
    } else {
      // Fallback to balanced if preset not found
      logger.warn('makemkv-perf', `Unknown preset "${preset}", falling back to balanced`);
      settings = { ...PERFORMANCE_PRESETS.balanced };
    }

    // Apply per-backup overrides (from options)
    if (options.overrides) {
      settings = { ...settings, ...options.overrides };
    }

    // Apply defaults for missing values BEFORE validation
    if (settings.cache === undefined || settings.cache === null) settings.cache = 16;
    if (settings.minbuf === undefined || settings.minbuf === null) settings.minbuf = 1;
    if (settings.maxbuf === undefined || settings.maxbuf === null) settings.maxbuf = 16;
    if (settings.timeout === undefined || settings.timeout === null) settings.timeout = 10000;

    // Validate and clamp values to safe ranges
    settings.cache = Math.max(1, Math.min(256, settings.cache));
    settings.minbuf = Math.max(0, Math.min(settings.maxbuf, settings.minbuf));
    settings.maxbuf = Math.max(settings.minbuf, Math.min(256, settings.maxbuf));
    settings.timeout = Math.max(1000, Math.min(60000, settings.timeout));

    // Build spawn arguments array
    const flags = [
      '--decrypt',
      `--cache=${settings.cache}`,
      '--noscan',
      '-r',
      '--progress=-same'
    ];

    // Add optional flags if configured
    // NOTE: --minlength is only added in Smart Extract mode (see startBackup), not here
    // minbuf is a buffer setting, not related to --minlength (title length filter)
    if (settings.splitSize && settings.splitSize > 0) {
      flags.push(`--split-size=${settings.splitSize}`);
    }

    logger.info('makemkv-perf', `Performance flags built`, {
      preset,
      cache: settings.cache,
      minbuf: settings.minbuf,
      maxbuf: settings.maxbuf,
      timeout: settings.timeout
    });

    return { flags, settings };
  }

  // Get all available performance presets
  getPerformancePresets() {
    return { ...PERFORMANCE_PRESETS };
  }

  // Check backup status for a disc, comparing against disc size
  async checkBackupStatus(discName, discSize, onLog) {
    const tempPath = path.join(this.basePath, 'temp', discName);
    const backupPath = path.join(this.basePath, 'backup', discName);

    const result = {
      status: 'none',
      discSize: discSize || 0,
      backupSize: 0,
      tempSize: 0,
      backupRatio: 0,
      tempRatio: 0,
      path: null,
      files: 0,
      isDVD: false,
    };

    // Check if complete backup exists
    const backupExists = await fs.access(backupPath).then(() => true).catch(() => false);
    if (backupExists) {
      const backupStat = await fs.stat(backupPath);

      // Check if it's a file (old disc image format) or folder (new file-level format)
      if (backupStat.isFile()) {
        // Old disc image format - still works but not file-level
        const backupSize = backupStat.size;
        result.backupSize = backupSize;
        result.backupRatio = discSize > 0 ? (backupSize / discSize) * 100 : 0;

        if (onLog) {
          onLog(`Found disc image backup: ${this.formatSize(backupSize)} (${result.backupRatio.toFixed(1)}% of disc)`);
        }

        if (isBackupComplete(backupSize, discSize)) {
          result.status = 'complete';
          result.path = backupPath;
          result.files = 1;
          result.isDVD = true;
          return result;
        }
      } else {
        // Folder structure - check for VIDEO_TS (DVD) or BDMV (Blu-ray)
        const videoTsPath = path.join(backupPath, 'VIDEO_TS');
        const bdmvPath = path.join(backupPath, 'BDMV');
        const hasVideoTs = await fs.access(videoTsPath).then(() => true).catch(() => false);
        const hasBdmv = await fs.access(bdmvPath).then(() => true).catch(() => false);

        const backupFiles = await this.countFiles(backupPath);
        const backupSize = await this.getBackupSize(backupPath);
        result.backupSize = backupSize;
        result.backupRatio = discSize > 0 ? (backupSize / discSize) * 100 : 0;
        result.isDVD = hasVideoTs;

        if (onLog) {
          const type = hasVideoTs ? 'VIDEO_TS' : (hasBdmv ? 'BDMV' : 'folder');
          onLog(`Backup folder (${type}): ${this.formatSize(backupSize)} (${result.backupRatio.toFixed(1)}% of disc), ${backupFiles} files`);
        }

        // Use shared utility to determine completeness (95% threshold)
        if (isBackupComplete(backupSize, discSize)) {
          if (onLog) onLog(`Found complete backup: ${backupFiles} files, ${this.formatSize(backupSize)}`);
          result.status = 'complete';
          result.path = backupPath;
          result.files = backupFiles;
          return result;
        } else if (backupFiles > 0 && backupSize > 10 * 1024 * 1024) {
          // Incomplete backup in backup folder (has files and >10MB)
          if (onLog) onLog(`Found INCOMPLETE backup (${result.backupRatio.toFixed(1)}% of disc)`);
          result.status = 'incomplete_backup';
          result.path = backupPath;
          result.files = backupFiles;
          return result;
        } else {
          // Empty or nearly empty backup folder - treat as no backup (will be cleaned up)
          if (onLog) onLog(`Backup folder is empty/tiny (${backupFiles} files, ${this.formatSize(backupSize)}) - will be cleaned up`);
          // Don't return - fall through to check temp folder too
        }
      }
    }

    // Check if incomplete temp exists
    const tempExists = await fs.access(tempPath).then(() => true).catch(() => false);
    if (tempExists) {
      const tempFiles = await this.countFiles(tempPath);
      const tempSize = await this.getFolderSize(tempPath);
      result.tempSize = tempSize;
      result.tempRatio = discSize > 0 ? (tempSize / discSize) * 100 : 0;

      if (onLog) {
        onLog(`Temp folder: ${this.formatSize(tempSize)} (${result.tempRatio.toFixed(1)}% of disc)`);
      }

      if (tempFiles === 0 || tempSize < 10 * 1024 * 1024) {
        // Basically empty
        if (onLog) onLog(`Temp folder is empty/tiny, will be cleaned up`);
        result.status = 'none';
      } else {
        if (onLog) onLog(`Found incomplete temp: ${tempFiles} files, ${this.formatSize(tempSize)}`);
        result.status = 'incomplete_temp';
        result.path = tempPath;
        result.files = tempFiles;
      }
      return result;
    }

    return result;
  }

  // Start backup process with log streaming
  // Workflow: rip to temp folder, then copy to backup folder
  // makemkvIndex is the MakeMKV disc:N index from drive detection
  async startBackup(makemkvIndex, discName, discSize, onProgress, onLog, extractionMode = 'full_backup') {
    const tempPath = path.join(this.basePath, 'temp', discName);
    const backupPath = path.join(this.basePath, 'backup', discName);

    // Verify MakeMKV exists
    if (!existsSync(this.makemkvPath)) {
      const error = `MakeMKV executable not found at: ${this.makemkvPath}`;
      logger.error('makemkv', error);
      this.lastError = error;
      throw new Error(error);
    }

    // Use disc:N format with the MakeMKV index from drive detection
    const makemkvSource = `disc:${makemkvIndex}`;
    const modeLabel = extractionMode === 'smart_extract' ? 'Smart Extract' : 'Full Backup';
    logger.info('makemkv', `Starting backup for ${discName} [${modeLabel}]`, {
      source: makemkvSource,
      tempPath,
      backupPath,
      discSize,
      extractionMode
    });
    if (onLog) onLog(`Using MakeMKV source: ${makemkvSource}`);
    if (onLog) onLog(`Extraction mode: ${modeLabel}`);

    return new Promise(async (resolve, reject) => {
      // Check existing backup status
      const status = await this.checkBackupStatus(discName, discSize, onLog);

      if (status.status === 'complete') {
        // Already have a complete backup
        if (onLog) onLog(`Backup already exists at: ${backupPath}`);
        if (onProgress) onProgress({ percent: 100, current: 1, max: 1 });
        resolve({ alreadyExists: true, path: backupPath, size: status.backupSize });
        return;
      }

      // Clean up any incomplete or empty backup folders
      if (status.status === 'incomplete_backup') {
        if (onLog) onLog(`Deleting incomplete backup folder...`);
        await this.deleteFolder(backupPath);
      } else {
        // Also check for empty backup folder that needs cleanup
        const backupExists = await fs.access(backupPath).then(() => true).catch(() => false);
        if (backupExists) {
          const backupSize = await this.getFolderSize(backupPath);
          if (backupSize < 10 * 1024 * 1024) {
            if (onLog) onLog(`Deleting empty/tiny backup folder...`);
            await this.deleteFolder(backupPath);
          }
        }
      }

      // Clean up temp folder if it exists - ALWAYS delete before starting
      const tempExists = await fs.access(tempPath).then(() => true).catch(() => false);
      if (tempExists) {
        logger.info('makemkv', `Deleting existing temp folder: ${tempPath}`);
        if (onLog) onLog(`Cleaning up temp folder...`);
        const deleted = await this.deleteFolder(tempPath);
        if (!deleted) {
          logger.error('makemkv', `Failed to delete temp folder: ${tempPath}`);
        }
        // Verify deletion
        const stillExists = await fs.access(tempPath).then(() => true).catch(() => false);
        if (stillExists) {
          const error = `Cannot delete temp folder: ${tempPath} - folder still exists`;
          logger.error('makemkv', error);
          if (onLog) onLog(`ERROR: ${error}`);
          throw new Error(error);
        }
      }

      // IMPORTANT: Do NOT pre-create the temp folder!
      // MakeMKV requires the target folder to NOT exist - it creates it itself.
      // If the folder exists (even if empty), MakeMKV reports "folder already contains a backup"
      // Only ensure the PARENT folder exists.
      const tempParent = path.join(this.basePath, 'temp');
      await fs.mkdir(tempParent, { recursive: true });
      logger.debug('makemkv', `Ensured temp parent exists: ${tempParent} (MakeMKV will create: ${tempPath})`);

      if (onLog) {
        onLog(`Disc size: ${this.formatSize(discSize)}`);
        onLog(`Starting backup to temp: ${tempPath}`);
        onLog(`Final destination: ${backupPath}`);
      }

      // Build MakeMKV flags based on performance settings
      const { flags, settings: perfSettings } = this.buildMakeMKVFlags();

      // Smart Extract mode: Add --minlength flag to skip short titles
      if (extractionMode === 'smart_extract') {
        const minTitleLength = this.extraction?.minTitleLength || 10; // minutes
        const minSeconds = minTitleLength * 60; // convert to seconds
        flags.push(`--minlength=${minSeconds}`);
        logger.info('makemkv', `Smart Extract: skipping titles shorter than ${minTitleLength} minutes (${minSeconds} seconds)`);
        if (onLog) onLog(`Smart Extract: skipping titles < ${minTitleLength} minutes`);
      }

      // Run: makemkvcon backup with performance-optimized flags
      // Flags are dynamically built based on user settings (presets or custom)
      const spawnArgs = ['backup', ...flags, makemkvSource, tempPath];
      const flagsStr = flags.join(' ');

      logger.info('makemkv-perf', `Starting backup with performance settings`, {
        preset: this.makemkvPerformance?.preset || 'balanced',
        cache: perfSettings.cache,
        timeout: perfSettings.timeout,
        extractionMode
      });

      if (onLog) onLog(`Running: makemkvcon backup ${flagsStr} ${makemkvSource} "${tempPath}"`);
      this.currentProcess = spawn(this.makemkvPath, spawnArgs, { windowsHide: true });

      let lastProgress = { percent: 0, current: 0, total: 0, max: 0 };
      let smoothedPercent = 0;
      let errorMessages = [];
      let backupFailed = false;
      let firstPrgvLogged = false;
      let inCopyPhase = false;  // Track when actual copying starts
      let copyPhaseStartTime = null;
      let sizePollingInterval = null;  // For file-size based progress during copy
      let lastPolledSize = 0;
      // Error resilience tracking
      let errorsEncountered = [];
      let filesSuccessful = 0;
      let filesFailed = 0;
      let hasRecoverableErrors = false;

      // Send initial 0% progress immediately so UI doesn't show "Starting..." indefinitely
      const startTime = Date.now();
      logger.info('makemkv-progress', `Backup process spawned, disc size: ${this.formatSize(discSize)}`);
      if (onProgress) onProgress({ percent: 0, current: 0, total: discSize, max: discSize });

      // Safety fallback: Start polling after 5 seconds if it hasn't started via PRGT message
      // This ensures progress updates even if MakeMKV's output is different than expected
      const pollingFallbackTimeout = setTimeout(() => {
        if (discSize > 0 && !sizePollingInterval) {
          logger.warn('makemkv-progress', `Polling timeout - starting fallback polling for ${discName} after 5 seconds`);
          sizePollingInterval = setInterval(async () => {
            try {
              const currentSize = await this.getBackupSize(tempPath);
              lastPolledSize = currentSize;
              const sizePercent = Math.min((currentSize / discSize) * 95, 94);
              smoothedPercent = Math.max(smoothedPercent, sizePercent);
              lastProgress = { percent: smoothedPercent, current: currentSize, total: discSize, max: discSize };
              if (onProgress) onProgress(lastProgress);
              if (currentSize > 0 && smoothedPercent % 10 < 0.5) {
                logger.debug('makemkv-progress', `Fallback polling: ${this.formatSize(currentSize)}/${this.formatSize(discSize)} = ${smoothedPercent.toFixed(1)}%`);
              }
            } catch (err) {
              // Ignore errors
            }
          }, 500);
        }
      }, 5000);

      this.currentProcess.stdout.on('data', (data) => {
        const output = data.toString();
        const lines = output.split('\n');

        for (const line of lines) {
          if (!line.trim()) continue;

          if (line.startsWith('PRGV:')) {
            // Progress value: PRGV:<current>,<total>,<max>
            // current = current file progress (jumpy)
            // total = overall progress (what we want!)
            // max = 65536 typically
            const parts = line.substring(5).split(',');
            const current = parseInt(parts[0]) || 0;  // Per-file progress
            const total = parseInt(parts[1]) || 0;    // Overall progress (USE THIS!)
            const max = parseInt(parts[2]) || 65536;

            // Debug: Log first PRGV
            if (!firstPrgvLogged) {
              logger.info('makemkv-progress', `First PRGV: raw="${line}", current=${current}, total=${total}, max=${max}, inCopyPhase=${inCopyPhase}`);
              firstPrgvLogged = true;
            }

            // IMPORTANT: Ignore PRGV during scan phase - it completes instantly and is meaningless
            // Only process PRGV once we're in the copy phase (detected via PRGT message)
            // During copy phase, we use file-size polling instead since PRGV doesn't update
            if (!inCopyPhase) {
              // Scan phase - don't update progress, just log
              logger.debug('makemkv-progress', `Ignoring scan phase PRGV: ${total}/${max}`);
            }
          } else if (line.startsWith('PRGT:')) {
            // Progress title - log it and detect copy phase
            const parts = this.splitRobotLine(line.substring(5));
            const title = this.unquote(parts[2] || '');
            if (onLog && title) onLog(`Task: ${title}`);
            logger.info('makemkv-progress', `PRGT received: "${title}"`);

            // Detect when we enter the "Copying" phase
            // This is the REAL backup - the scan phase PRGV is meaningless
            if (title.toLowerCase().includes('copying') && !inCopyPhase) {
              inCopyPhase = true;
              copyPhaseStartTime = Date.now();
              smoothedPercent = 0;  // Reset progress - scan phase was fake
              lastPolledSize = 0;
              logger.info('makemkv-progress', `Entering copy phase - resetting progress. Disc size: ${discSize}`);
            }

            // Start polling if not already started (regardless of phase - acts as fallback)
            if (discSize > 0 && !sizePollingInterval) {
              clearTimeout(pollingFallbackTimeout);  // Cancel the timeout since we're starting polling now
              sizePollingInterval = setInterval(async () => {
                try {
                  const currentSize = await this.getBackupSize(tempPath);
                  // Always update progress to ensure UI gets updates
                  // This prevents the "Starting..." state from getting stuck
                  lastPolledSize = currentSize;
                  // Calculate progress: 0-95% for copy, 95-100% for post-processing
                  const sizePercent = Math.min((currentSize / discSize) * 95, 94);
                  smoothedPercent = Math.max(smoothedPercent, sizePercent);
                  lastProgress = { percent: smoothedPercent, current: currentSize, total: discSize, max: discSize };
                  if (onProgress) {
                    onProgress(lastProgress);
                    logger.debug('makemkv-progress', `SENT progress to UI: ${smoothedPercent.toFixed(1)}% (${this.formatSize(currentSize)}/${this.formatSize(discSize)})`);
                  }
                } catch (err) {
                  logger.warn('makemkv-progress', `Polling error: ${err.message}`);
                }
              }, 500);  // Poll every 500ms for more responsive updates
              logger.info('makemkv-progress', `Started size-based polling for ${discName} via PRGT message`);
            }
          } else if (line.startsWith('PRGC:')) {
            // Progress current item - only log to file, not UI (avoids spam)
            const parts = this.splitRobotLine(line.substring(5));
            const item = this.unquote(parts[2] || '');
            if (item) logger.debug('makemkv-prgc', `Processing: ${item}`);
          } else if (line.startsWith('MSG:')) {
            // Parse MSG format: MSG:code,flags,count,"message","param1",...
            // MakeMKV message codes - flags are NOT reliable error indicators!
            // Success codes: 5070/5081="Backup done", 5072="Backing up disc", 5085="hash table"
            const msgParts = line.match(/MSG:(\d+),(\d+),(\d+),"([^"]+)"/);
            const msgCode = msgParts ? parseInt(msgParts[1]) : 0;
            const message = msgParts ? msgParts[4] : line.substring(4);
            const lowerMessage = message.toLowerCase();

            // Known success/info message codes - NEVER treat as errors
            const successCodes = [5070, 5072, 5081, 5085, 5010, 5011];
            const isSuccessCode = successCodes.includes(msgCode);

            // Detect actual errors by text content, but NOT for success codes
            const hasErrorText = lowerMessage.includes('error') ||
                                lowerMessage.includes('failed') ||
                                lowerMessage.includes('cannot') ||
                                lowerMessage.includes('unable');

            // Only flag as error if it has error text AND is not a known success code
            const isError = hasErrorText && !isSuccessCode;
            const isWarning = lowerMessage.includes('warning') ||
                             lowerMessage.includes('skipped');

            // Log appropriately
            if (isError) {
              logger.error('makemkv-msg', `[${msgCode}] ${message}`, { raw: line });
            } else if (isWarning) {
              logger.warn('makemkv-msg', `[${msgCode}] ${message}`);
            } else if (isSuccessCode) {
              logger.info('makemkv-msg', `[${msgCode}] ${message}`);
            } else {
              logger.debug('makemkv-msg', `[${msgCode}] ${message}`);
            }

            // Send to UI log
            if (onLog) {
              const prefix = isError ? 'ERROR: ' : (isWarning ? 'WARNING: ' : '');
              onLog(`${prefix}${message}`);
            }

            // Track errors for final summary - only actual errors
            if (isError) {
              // Parse error details for resilience tracking
              const errorInfo = this.parseErrorMessage(message, line);

              // Determine if error is recoverable (read/hash errors vs fatal errors)
              const isRecoverableError = this.isRecoverableError(message);

              if (isRecoverableError) {
                hasRecoverableErrors = true;
                filesFailed++;
                errorsEncountered.push(errorInfo);
                logger.warn('makemkv-recovery', `Recoverable error encountered: ${errorInfo.file || 'unknown file'}`, errorInfo);
                if (onLog) onLog(`WARNING (recoverable): ${message}`);
              } else {
                backupFailed = true;
                errorMessages.push(message);
                logger.error('makemkv-fatal', `Fatal error encountered: ${message}`);
              }
            }
          }
        }
      });

      this.currentProcess.stderr.on('data', (data) => {
        const line = data.toString().trim();
        if (line) {
          logger.error('makemkv-stderr', line);
          if (onLog) onLog(`STDERR: ${line}`);
          errorMessages.push(`STDERR: ${line}`);
        }
      });

      this.currentProcess.on('close', async (code, signal) => {
        this.currentProcess = null;

        // Clean up size polling interval and fallback timeout
        if (sizePollingInterval) {
          clearInterval(sizePollingInterval);
          sizePollingInterval = null;
        }
        clearTimeout(pollingFallbackTimeout);

        // Check if process was killed (cancelled)
        if (signal) {
          logger.info('makemkv', `Backup cancelled for ${discName}`, { signal, code });
          if (onLog) onLog(`Backup cancelled (signal: ${signal})`);
          await this.deleteFolder(tempPath);
          reject(new Error(`Backup cancelled by user`));
          return;
        }

        if (code === 0 && !backupFailed) {
          // Rip complete (or partial), verify size
          const tempSize = await this.getBackupSize(tempPath);
          const sizeRatio = discSize > 0 ? (tempSize / discSize) * 100 : 100;

          // Calculate recovery statistics
          const totalFiles = filesSuccessful + filesFailed;
          const percentRecovered = totalFiles > 0 ? ((filesSuccessful / totalFiles) * 100) : 100;

          if (hasRecoverableErrors) {
            if (onLog) {
              onLog(`Backup completed with ${filesFailed} file error(s)`);
              onLog(`Recovery status: ${this.formatSize(tempSize)} (${sizeRatio.toFixed(1)}% of disc)`);
              onLog(`Files recovered: ${filesSuccessful} of ${totalFiles} (${percentRecovered.toFixed(1)}%)`);
            }
            logger.warn('makemkv-recovery', `Partial backup completed`, {
              tempSize,
              sizeRatio,
              filesSuccessful,
              filesFailed,
              percentRecovered,
              errorCount: errorsEncountered.length
            });
          } else {
            if (onLog) {
              onLog(`Rip complete! Size: ${this.formatSize(tempSize)} (${sizeRatio.toFixed(1)}% of disc)`);
            }
          }

          if (discSize > 0 && sizeRatio < 90 && !hasRecoverableErrors) {
            // Suspiciously small - might be incomplete (but no errors detected)
            if (onLog) onLog(`WARNING: Backup is only ${sizeRatio.toFixed(1)}% of disc size`);
          }

          // Check if this is a DVD disc image (file) that needs extraction
          const isDVD = await this.isDVDImage(tempPath);

          try {
            // Ensure backup parent folder exists
            await fs.mkdir(path.join(this.basePath, 'backup'), { recursive: true });

            if (isDVD) {
              // DVD: Extract all files from disc image for file-level backup
              if (onLog) onLog('DVD detected - extracting all files for file-level backup...');
              if (onProgress) onProgress({ percent: 96, current: lastProgress.max, max: lastProgress.max });

              // Extract to backup folder
              await this.extractDVDImage(tempPath, backupPath, onLog);

              if (onProgress) onProgress({ percent: 99, current: lastProgress.max, max: lastProgress.max });

              // Delete the original disc image
              if (onLog) onLog('Cleaning up disc image...');
              await this.deleteBackup(tempPath);
            } else {
              // Blu-ray: Copy the folder structure directly
              if (onLog) onLog('Moving to backup folder...');
              if (onProgress) onProgress({ percent: 96, current: lastProgress.max, max: lastProgress.max });

              await this.copyBackup(tempPath, backupPath, onLog);

              if (onProgress) onProgress({ percent: 99, current: lastProgress.max, max: lastProgress.max });

              // Delete temp folder
              if (onLog) onLog('Cleaning up temp folder...');
              await this.deleteFolder(tempPath);
            }

            // Get final backup size
            const finalSize = await this.getBackupSize(backupPath);

            if (onProgress) onProgress({ percent: 100, current: lastProgress.max, max: lastProgress.max });
            if (hasRecoverableErrors) {
              if (onLog) onLog(`Backup completed with recoverable errors - review metadata`);
            } else {
              if (onLog) onLog(`Backup completed successfully!`);
            }
            if (onLog) onLog(`Saved to: ${backupPath}`);
            if (onLog) onLog(`Final size: ${this.formatSize(finalSize)} (${isDVD ? 'VIDEO_TS folder' : 'BDMV folder'})`);

            // Include error metadata in result
            const result = {
              alreadyExists: false,
              path: backupPath,
              size: finalSize,
              isDVD,
              partialSuccess: hasRecoverableErrors,
              errorsEncountered: hasRecoverableErrors ? errorsEncountered : [],
              filesSuccessful,
              filesFailed,
              percentRecovered: totalFiles > 0 ? ((filesSuccessful / totalFiles) * 100) : 100
            };

            resolve(result);
          } catch (copyError) {
            if (onLog) onLog(`ERROR: Failed to process backup: ${copyError.message}`);
            reject(new Error(`Backup processing failed: ${copyError.message}`));
          }
        } else {
          // Backup failed - clean up temp
          logger.error('makemkv', `Backup failed for ${discName}`, { code, backupFailed, errorMessages });
          if (onLog) onLog('Backup failed, cleaning up temp folder...');
          await this.deleteFolder(tempPath);

          const errorMsg = errorMessages.length > 0
            ? errorMessages.join('. ')
            : `Backup failed with exit code ${code}. Check system logs for details.`;
          this.lastError = errorMsg;
          if (onLog) onLog(`ERROR: ${errorMsg}`);
          reject(new Error(errorMsg));
        }
      });

      this.currentProcess.on('error', async (error) => {
        this.currentProcess = null;
        // Clean up size polling interval and fallback timeout
        if (sizePollingInterval) {
          clearInterval(sizePollingInterval);
          sizePollingInterval = null;
        }
        clearTimeout(pollingFallbackTimeout);
        logger.error('makemkv', `Process error during backup of ${discName}`, error);
        this.lastError = error.message;
        // Clean up temp on error
        await this.deleteFolder(tempPath);
        if (onLog) onLog(`ERROR: ${error.message}`);
        reject(error);
      });
    });
  }

  // Get last error for troubleshooting
  getLastError() {
    return this.lastError;
  }

  // Cancel the current backup
  cancelBackup() {
    if (this.currentProcess) {
      logger.info('makemkv', 'Cancelling backup - killing MakeMKV process');
      this.currentProcess.kill('SIGTERM');
      this.currentProcess = null;
    }
  }

  // Helper: Split robot output line by commas, respecting quoted strings
  splitRobotLine(line) {
    const parts = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (char === '"') {
        inQuotes = !inQuotes;
        current += char;
      } else if (char === ',' && !inQuotes) {
        parts.push(current);
        current = '';
      } else {
        current += char;
      }
    }

    if (current) {
      parts.push(current);
    }

    return parts;
  }

  // Helper: Remove quotes from string
  unquote(str) {
    if (!str) return '';
    if (str.startsWith('"') && str.endsWith('"')) {
      return str.substring(1, str.length - 1);
    }
    return str;
  }

  // Extract ALL files from DVD disc image using 7-Zip
  // For file-level backups instead of disc images
  async extractDVDImage(imagePath, destFolder, onLog) {
    // Check if 7-Zip exists
    if (!existsSync(this.sevenZipPath)) {
      // Try alternate locations
      const altPaths = [
        'C:\\Program Files\\7-Zip\\7z.exe',
        'C:\\Program Files (x86)\\7-Zip\\7z.exe'
      ];
      for (const altPath of altPaths) {
        if (existsSync(altPath)) {
          this.sevenZipPath = altPath;
          break;
        }
      }
      if (!existsSync(this.sevenZipPath)) {
        throw new Error('7-Zip not found - cannot extract DVD files');
      }
    }

    logger.info('makemkv', `Extracting ALL files from: ${imagePath}`);
    if (onLog) onLog(`Extracting all files from disc image...`);

    return new Promise((resolve, reject) => {
      // Extract ALL files from the ISO image (not just VIDEO_TS)
      // 7z x "image" -o"dest" -y
      const args = [
        'x',           // Extract with full paths
        imagePath,     // Source ISO/UDF image
        `-o${destFolder}`,  // Output directory
        '-y'           // Yes to all prompts
      ];

      if (onLog) onLog(`Running: 7z ${args.join(' ')}`);

      const process = spawn(this.sevenZipPath, args, { windowsHide: true });
      let output = '';

      process.stdout.on('data', (data) => {
        output += data.toString();
        const lines = data.toString().split('\n');
        for (const line of lines) {
          if (line.trim() && (line.includes('Extracting') || line.includes('%'))) {
            logger.debug('7zip', line.trim());
          }
        }
      });

      process.stderr.on('data', (data) => {
        logger.error('7zip-stderr', data.toString());
      });

      process.on('close', async (code) => {
        if (code === 0) {
          // Verify extraction succeeded by checking destFolder exists and has content
          const exists = await fs.access(destFolder).then(() => true).catch(() => false);
          if (exists) {
            const files = await this.countFiles(destFolder);
            if (onLog) onLog(`Extracted ${files} files successfully`);
            resolve(destFolder);
          } else {
            reject(new Error('7-Zip completed but destination folder not found'));
          }
        } else {
          reject(new Error(`7-Zip extraction failed with code ${code}`));
        }
      });

      process.on('error', (err) => {
        reject(new Error(`7-Zip process error: ${err.message}`));
      });
    });
  }

  // Check if a backup is a DVD disc image (file) vs Blu-ray folder structure
  async isDVDImage(backupPath) {
    try {
      const stat = await fs.stat(backupPath);
      return stat.isFile();  // DVDs are single files, Blu-rays are folders
    } catch {
      return false;
    }
  }

  // Apply MakeMKV registration key to Windows registry
  // Registry path: HKEY_CURRENT_USER\Software\MakeMKV\app_Key
  async applyMakeMKVKey(key) {
    if (!key || process.platform !== 'win32') {
      return { success: false, error: 'Invalid key or not on Windows' };
    }

    // Security: Validate key format to prevent command injection
    // MakeMKV keys are T-[alphanumeric@_] format, typically 50-70 chars
    if (!/^T-[A-Za-z0-9@_]+$/.test(key) || key.length < 40 || key.length > 100) {
      return { success: false, error: 'Invalid key format' };
    }

    try {
      // Use execFileSync with argument array to prevent command injection
      const { execFileSync } = require('child_process');
      execFileSync('reg', [
        'add', 'HKCU\\Software\\MakeMKV',
        '/v', 'app_Key',
        '/t', 'REG_SZ',
        '/d', key,
        '/f'
      ], { windowsHide: true });
      logger.info('makemkv', `Applied MakeMKV registration key to registry`);
      return { success: true };
    } catch (err) {
      logger.error('makemkv', `Failed to apply MakeMKV key to registry: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  // Get current MakeMKV key from Windows registry
  async getMakeMKVKeyFromRegistry() {
    if (process.platform !== 'win32') {
      return { success: false, error: 'Not on Windows' };
    }

    try {
      const regPath = 'HKCU\\Software\\MakeMKV';
      const output = execSync(`reg query "${regPath}" /v app_Key`, {
        windowsHide: true,
        encoding: 'utf8'
      });

      // Parse the output to extract the key value
      // Format: "    app_Key    REG_SZ    T-xxxxx..."
      const match = output.match(/app_Key\s+REG_SZ\s+(.+)/);
      if (match && match[1]) {
        return { success: true, key: match[1].trim() };
      }
      return { success: false, error: 'Key not found in registry' };
    } catch (err) {
      return { success: false, error: 'Key not found in registry' };
    }
  }

  // Fetch the latest MakeMKV beta key from the forum
  // Forum page: https://forum.makemkv.com/forum/viewtopic.php?t=1053
  async fetchLatestKey() {
    return new Promise((resolve, reject) => {
      const url = 'https://forum.makemkv.com/forum/viewtopic.php?t=1053';

      https.get(url, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            // The key is in a format like: T-xxxxxxxxxx...
            // It's typically posted in a code block in the first post
            // Look for the key pattern
            const keyPattern = /T-[A-Za-z0-9@_]+/g;
            const matches = data.match(keyPattern);

            if (matches && matches.length > 0) {
              // The key is usually the longest match that looks valid
              // MakeMKV keys are typically 50-70 characters
              const validKeys = matches.filter(k => k.length >= 40 && k.length <= 100);

              if (validKeys.length > 0) {
                // Take the first valid-looking key
                const key = validKeys[0];
                logger.info('makemkv', `Fetched MakeMKV key from forum: ${key.substring(0, 20)}...`);
                resolve({ success: true, key });
              } else {
                resolve({ success: false, error: 'No valid key found on forum page' });
              }
            } else {
              resolve({ success: false, error: 'No key pattern found on forum page' });
            }
          } catch (err) {
            resolve({ success: false, error: `Failed to parse forum page: ${err.message}` });
          }
        });
      }).on('error', (err) => {
        logger.error('makemkv', `Failed to fetch key from forum: ${err.message}`);
        resolve({ success: false, error: `Network error: ${err.message}` });
      });
    });
  }

  // Parse error message to extract file name and error details
  parseErrorMessage(message, rawLine) {
    const errorInfo = {
      message: message || null,
      file: null,
      error: null,
      offset: null,
      timestamp: new Date().toISOString()
    };

    // Handle null/undefined input
    if (!message || typeof message !== 'string') {
      return errorInfo;
    }

    try {
      // Extract filename patterns:
      // "Hash check failed for file 00800.m2ts"
      // "Error reading file 00800.m2ts"
      // "Failed to save title 00800.m2ts"
      const fileMatch = message.match(/(?:file|title)\s+(\d+\.m2ts|\w+\.\w+)/i);
      if (fileMatch) {
        errorInfo.file = fileMatch[1];
      }

      // Extract error type
      const lowerMessage = message.toLowerCase();
      if (lowerMessage.includes('hash check failed')) {
        errorInfo.error = 'Hash check failed';
      } else if (lowerMessage.includes('read error') || lowerMessage.includes('error reading')) {
        errorInfo.error = 'Read error';
      } else if (lowerMessage.includes('failed to save')) {
        errorInfo.error = 'Failed to save';
      } else {
        errorInfo.error = 'Unknown error';
      }

      // Extract offset if present (byte position)
      const offsetMatch = message.match(/offset[:\s]+(\d+)/i) || message.match(/at\s+(\d+)\s+bytes/i);
      if (offsetMatch) {
        errorInfo.offset = offsetMatch[1];
      }
    } catch (err) {
      logger.warn('makemkv-parse', `Failed to parse error message: ${err.message}`, { message });
    }

    return errorInfo;
  }

  // Determine if an error is recoverable (continue backup) or fatal (stop backup)
  isRecoverableError(message) {
    const lowerMessage = message.toLowerCase();

    // Recoverable errors - continue backup despite these
    const recoverablePatterns = [
      'hash check failed',
      'read error',
      'error reading',
      'scsi error',
      'operation was cancelled',
      'bad sector'
    ];

    // Fatal errors - stop backup on these
    const fatalPatterns = [
      'out of memory',
      'disk full',
      'cannot create',
      'permission denied',
      'access denied',
      'destination folder',
      'invalid',
      'fatal'
    ];

    // Check for fatal errors first
    for (const pattern of fatalPatterns) {
      if (lowerMessage.includes(pattern)) {
        return false; // Fatal, not recoverable
      }
    }

    // Check for recoverable errors
    for (const pattern of recoverablePatterns) {
      if (lowerMessage.includes(pattern)) {
        return true; // Recoverable
      }
    }

    // Default: treat unknown errors as fatal to be safe
    return false;
  }
}
