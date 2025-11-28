// TypeScript Type Definitions for EasyRip

/**
 * Drive information detected from the system
 */
export interface DriveInfo {
  /** Unique identifier (index in array) */
  id: number;
  /** Windows drive letter (e.g., "E:") */
  driveLetter: string;
  /** Volume name from disc */
  discName: string;
  /** Hardware description (e.g., "ASUS BW-16D1HT") */
  description: string;
  /** Whether media is loaded */
  hasDisc: boolean;
  /** Whether disc is Blu-ray */
  isBluray: boolean;
  /** Whether disc is DVD */
  isDVD: boolean;
  /** Disc type code (1=DVD, 12=Blu-ray) */
  discType: number;
  /** Disc size in bytes */
  discSize: number;
  /** MakeMKV disc:N index for backup command */
  makemkvIndex: number;
}

/**
 * Backup status for a disc
 */
export type BackupStatus =
  | 'none'           // No backup exists
  | 'complete'       // Backup complete (>=95% of disc)
  | 'incomplete_backup' // Partial backup in backup folder
  | 'incomplete_temp'   // Partial backup in temp folder
  ;

/**
 * Result of checking backup status
 */
export interface BackupStatusResult {
  status: BackupStatus;
  discSize: number;
  backupSize: number;
  tempSize: number;
  backupRatio: number;  // Percentage (0-100)
  tempRatio: number;    // Percentage (0-100)
  path: string | null;
  files: number;
}

/**
 * UI state for a drive
 */
export type DriveUIStatus =
  | 'idle'        // Ready to backup
  | 'running'     // Backup in progress
  | 'complete'    // Just completed
  | 'exists'      // Already backed up
  | 'incomplete'  // Partial backup exists
  | 'error'       // Backup failed
  ;

/**
 * Per-drive state in the UI
 */
export interface DriveState {
  status: DriveUIStatus;
  progress: number;       // 0-100
  backupSize?: number;
  backupRatio?: number;
  error?: string;
}

/**
 * Progress update from MakeMKV
 */
export interface ProgressUpdate {
  percent: number;
  current: number;
  max: number;
}

/**
 * Application settings
 */
export interface AppSettings {
  /** Path to makemkvcon64.exe */
  makemkvPath: string;
  /** Base path for temp and backup folders */
  basePath: string;
}

/**
 * IPC result wrapper
 */
export interface IPCResult<T = unknown> {
  success: boolean;
  error?: string;
  [key: string]: T | boolean | string | undefined;
}

/**
 * Scan drives result
 */
export interface ScanDrivesResult extends IPCResult {
  drives?: DriveInfo[];
}

/**
 * Start backup result
 */
export interface StartBackupResult extends IPCResult {
  driveId?: number;
  alreadyExists?: boolean;
  path?: string;
  size?: number;
}

/**
 * Electron API exposed via preload
 */
export interface ElectronAPI {
  scanDrives: () => Promise<ScanDrivesResult>;
  checkBackupStatus: (discName: string, discSize: number) => Promise<IPCResult & BackupStatusResult>;
  startBackup: (driveId: number, makemkvIndex: number, discName: string, discSize: number) => Promise<StartBackupResult>;
  cancelBackup: (driveId: number) => Promise<IPCResult>;
  getSettings: () => Promise<IPCResult & { settings?: AppSettings }>;
  saveSettings: (settings: AppSettings) => Promise<IPCResult>;
  onBackupProgress: (callback: (data: { driveId: number } & ProgressUpdate) => void) => void;
  onBackupLog: (callback: (data: { driveId: number; line: string }) => void) => void;
  removeBackupListeners: () => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
