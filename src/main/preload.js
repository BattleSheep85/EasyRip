// Preload Script - Security Bridge
// This script runs in a special context that has access to both Node.js and the browser
// It exposes a safe API to the renderer process
// NOTE: Preload scripts MUST use CommonJS (require), not ES modules (import)

const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use IPC
// without exposing the full IPC API (security best practice)
contextBridge.exposeInMainWorld('electronAPI', {
  // Fast drive detection (Windows-based)
  scanDrives: () => ipcRenderer.invoke('scan-drives'),

  // Clean up orphan temp folders
  cleanupOrphanTemps: () => ipcRenderer.invoke('cleanup-orphan-temps'),

  // Check if backup already exists for a disc (with size comparison)
  checkBackupStatus: (discName, discSize) => ipcRenderer.invoke('check-backup-status', discName, discSize),

  // Start backup for a specific drive (PARALLEL - each drive runs concurrently)
  // makemkvIndex is the MakeMKV disc:N index from drive detection
  // driveLetter is needed for fingerprinting before MakeMKV runs
  startBackup: (driveId, makemkvIndex, discName, discSize, driveLetter) =>
    ipcRenderer.invoke('start-backup', driveId, makemkvIndex, discName, discSize, driveLetter),

  // Delete existing backup and restart fresh (Re-Do functionality)
  deleteAndRestartBackup: (driveId, makemkvIndex, discName, discSize, driveLetter) =>
    ipcRenderer.invoke('delete-and-restart-backup', driveId, makemkvIndex, discName, discSize, driveLetter),

  // Delete a backup from the backup folder
  deleteBackup: (backupName) => ipcRenderer.invoke('delete-backup', backupName),

  // Cancel backup for a specific drive
  cancelBackup: (driveId) => ipcRenderer.invoke('cancel-backup', driveId),

  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),

  // Logging and troubleshooting
  getLogs: (lines = 200) => ipcRenderer.invoke('get-logs', lines),
  getLogFiles: () => ipcRenderer.invoke('get-log-files'),
  openLogDirectory: () => ipcRenderer.invoke('open-log-directory'),
  openBackupDirectory: () => ipcRenderer.invoke('open-backup-directory'),

  // Listen for progress updates (per-drive)
  onBackupProgress: (callback) => {
    ipcRenderer.on('backup-progress', (event, data) => callback(data));
  },

  // Listen for log updates (per-drive)
  onBackupLog: (callback) => {
    ipcRenderer.on('backup-log', (event, data) => callback(data));
  },

  // Listen for queue status updates (backup was queued, not started immediately)
  onBackupQueued: (callback) => {
    ipcRenderer.on('backup-queued', (event, data) => callback(data));
  },

  // Listen for backup started (was queued, now actually starting)
  onBackupStarted: (callback) => {
    ipcRenderer.on('backup-started', (event, data) => callback(data));
  },

  // Listen for backup completion (success or failure)
  onBackupComplete: (callback) => {
    ipcRenderer.on('backup-complete', (event, data) => callback(data));
  },

  // Remove listeners (cleanup)
  removeBackupListeners: () => {
    ipcRenderer.removeAllListeners('backup-progress');
    ipcRenderer.removeAllListeners('backup-log');
    ipcRenderer.removeAllListeners('backup-queued');
    ipcRenderer.removeAllListeners('backup-started');
    ipcRenderer.removeAllListeners('backup-complete');
  },

  // ============================================
  // METADATA SYSTEM APIs
  // ============================================

  // Get all backups with their metadata status
  getAllBackups: () => ipcRenderer.invoke('get-all-backups'),

  // Get metadata for a specific backup
  getBackupMetadata: (backupName) => ipcRenderer.invoke('get-backup-metadata', backupName),

  // Manually trigger identification for a backup
  identifyBackup: (backupName) => ipcRenderer.invoke('identify-backup', backupName),

  // Re-identify a backup (force refresh)
  reidentifyBackup: (backupName) => ipcRenderer.invoke('reidentify-backup', backupName),

  // Approve metadata (user confirms it's correct)
  approveMetadata: (backupName) => ipcRenderer.invoke('approve-metadata', backupName),

  // Update metadata manually
  updateMetadata: (backupName, updates) => ipcRenderer.invoke('update-metadata', backupName, updates),

  // Select a TMDB candidate for a backup
  selectTMDBCandidate: (backupName, tmdbId, mediaType) =>
    ipcRenderer.invoke('select-tmdb-candidate', backupName, tmdbId, mediaType),

  // Search TMDB
  searchTMDB: (query, year = null) => ipcRenderer.invoke('search-tmdb', query, year),

  // Get TMDB details
  getTMDBDetails: (tmdbId, mediaType) => ipcRenderer.invoke('get-tmdb-details', tmdbId, mediaType),

  // Get TV season details (episodes list)
  getTVSeasonDetails: (tvId, seasonNumber) => ipcRenderer.invoke('get-tv-season-details', tvId, seasonNumber),

  // Validate TMDB API key
  validateTMDBKey: (apiKey) => ipcRenderer.invoke('validate-tmdb-key', apiKey),

  // Get Ollama status
  getOllamaStatus: () => ipcRenderer.invoke('get-ollama-status'),

  // Install Ollama
  installOllama: () => ipcRenderer.invoke('install-ollama'),

  // Start Ollama server
  startOllama: () => ipcRenderer.invoke('start-ollama'),

  // Pull Ollama model
  pullOllamaModel: (modelName) => ipcRenderer.invoke('pull-ollama-model', modelName),

  // Get metadata queue status
  getMetadataQueue: () => ipcRenderer.invoke('get-metadata-queue'),

  // Force scan for new backups
  scanBackups: () => ipcRenderer.invoke('scan-backups'),

  // Listen for metadata pending (new backup identified)
  onMetadataPending: (callback) => {
    ipcRenderer.on('metadata-pending', (event, data) => callback(data));
  },

  // Listen for Ollama progress (install/pull progress)
  onOllamaProgress: (callback) => {
    ipcRenderer.on('ollama-progress', (event, data) => callback(data));
  },

  // Remove metadata listeners (cleanup)
  removeMetadataListeners: () => {
    ipcRenderer.removeAllListeners('metadata-pending');
    ipcRenderer.removeAllListeners('ollama-progress');
  },

  // ============================================
  // EMBY EXPORT SYSTEM APIs
  // ============================================

  // Scan backup for available titles (for selection before export)
  embyScanTitles: (backupName) => ipcRenderer.invoke('emby-scan-titles', backupName),

  // Export backup to Emby library
  // options: { backupName, titleIndex, mediaType: 'movie'|'tv', tvInfo?: { season, episode } }
  embyExport: (options) => ipcRenderer.invoke('emby-export', options),

  // Cancel current Emby export
  embyCancel: () => ipcRenderer.invoke('emby-cancel'),

  // Preview what path/name will be used for export
  // options: { backupName, mediaType: 'movie'|'tv', tvInfo?: { season, episode } }
  embyPreview: (options) => ipcRenderer.invoke('emby-preview', options),

  // Listen for Emby export progress
  onEmbyProgress: (callback) => {
    ipcRenderer.on('emby-progress', (event, data) => callback(data));
  },

  // Listen for Emby export log messages
  onEmbyLog: (callback) => {
    ipcRenderer.on('emby-log', (event, data) => callback(data));
  },

  // Remove Emby listeners (cleanup)
  removeEmbyListeners: () => {
    ipcRenderer.removeAllListeners('emby-progress');
    ipcRenderer.removeAllListeners('emby-log');
  },

  // ============================================
  // TRANSFER SYSTEM APIs
  // ============================================

  // Test transfer connection
  testTransferConnection: (config) => ipcRenderer.invoke('test-transfer-connection', config),

  // Queue a backup for export (manual trigger)
  queueExport: (backupName) => ipcRenderer.invoke('queue-export', backupName),

  // Get export queue status
  getExportQueueStatus: () => ipcRenderer.invoke('get-export-queue-status'),

  // Cancel current export
  cancelExport: () => ipcRenderer.invoke('cancel-export'),

  // Listen for export progress
  onExportProgress: (callback) => {
    ipcRenderer.on('export-progress', (event, data) => callback(data));
  },

  // Listen for export log messages
  onExportLog: (callback) => {
    ipcRenderer.on('export-log', (event, data) => callback(data));
  },

  // Listen for export completion
  onExportComplete: (callback) => {
    ipcRenderer.on('export-complete', (event, data) => callback(data));
  },

  // Listen for export errors
  onExportError: (callback) => {
    ipcRenderer.on('export-error', (event, data) => callback(data));
  },

  // Remove export listeners (cleanup)
  removeExportListeners: () => {
    ipcRenderer.removeAllListeners('export-progress');
    ipcRenderer.removeAllListeners('export-log');
    ipcRenderer.removeAllListeners('export-complete');
    ipcRenderer.removeAllListeners('export-error');
  },

  // ============================================
  // AUTOMATION SYSTEM APIs
  // ============================================

  // Get current automation settings
  getAutomation: () => ipcRenderer.invoke('get-automation'),

  // Toggle a specific automation setting (autoBackup, autoMeta, autoExport)
  toggleAutomation: (key) => ipcRenderer.invoke('toggle-automation', key),

  // Set all automation settings at once
  setAutomation: (automation) => ipcRenderer.invoke('set-automation', automation),
});
