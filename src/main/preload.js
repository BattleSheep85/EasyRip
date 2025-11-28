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

  // Start backup for a specific drive (QUEUED - only one runs at a time)
  // MakeMKV cannot run multiple instances concurrently, so backups are queued
  // makemkvIndex is the MakeMKV disc:N index from drive detection
  startBackup: (driveId, makemkvIndex, discName, discSize) =>
    ipcRenderer.invoke('start-backup', driveId, makemkvIndex, discName, discSize),

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
});
