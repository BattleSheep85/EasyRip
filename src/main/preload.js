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
});
