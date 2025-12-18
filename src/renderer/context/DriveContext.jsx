/**
 * DriveContext - Persistent drive state across navigation
 * Prevents drive rescanning when switching tabs, preserves backup status
 */

import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { formatSize, sanitizeDiscName } from '../../shared/utils.js';

const DriveContext = createContext(null);

export function DriveProvider({ children }) {
  // Drive state - persists across navigation
  const [drives, setDrives] = useState([]);
  const [driveStates, setDriveStates] = useState({});
  const [driveLogs, setDriveLogs] = useState({});
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState(null);
  const [activeLogTab, setActiveLogTab] = useState(null);

  // Track if we've done initial setup
  const initializedRef = useRef(false);
  const listenersSetupRef = useRef(false);

  // Setup IPC listeners once (persists across navigation)
  useEffect(() => {
    console.log('[DriveContext] useEffect triggered - checking conditions...');
    console.log(`[DriveContext] window.electronAPI exists: ${!!window.electronAPI}`);
    console.log(`[DriveContext] listenersSetupRef.current: ${listenersSetupRef.current}`);

    if (!window.electronAPI) {
      console.error('[DriveContext] FATAL: window.electronAPI is undefined!');
      return;
    }

    if (listenersSetupRef.current) {
      console.log('[DriveContext] Listeners already setup, skipping');
      return;
    }

    listenersSetupRef.current = true;
    console.log('[DriveContext] >>> SETTING UP PERSISTENT IPC LISTENERS <<<');

    // Send diagnostic to main process
    window.electronAPI.sendDiagnostic('[DriveContext] Setting up listeners - window.electronAPI available').catch(e => console.error('Diagnostic send failed:', e));

    try {
    // Listen for progress updates
    window.electronAPI.onBackupProgress((data) => {
      console.log(`[DriveContext] Progress received: driveId=${data.driveId}, percent=${data.percent?.toFixed(1)}%, current=${(data.current / 1024 / 1024 / 1024).toFixed(2)}GB, total=${(data.total / 1024 / 1024 / 1024).toFixed(2)}GB`);
      setDriveStates(prev => ({
        ...prev,
        [data.driveId]: {
          ...prev[data.driveId],
          progress: data.percent,
          status: data.percent >= 100 ? 'complete' : 'running',
        }
      }));
    });

    // Listen for log updates (with ring buffer)
    window.electronAPI.onBackupLog((data) => {
      const MAX_LOGS_PER_DRIVE = 1000;
      setDriveLogs(prev => {
        const currentLogs = prev[data.driveId] || [];
        const newLogs = [...currentLogs, data.line];
        return {
          ...prev,
          [data.driveId]: newLogs.length > MAX_LOGS_PER_DRIVE
            ? newLogs.slice(-MAX_LOGS_PER_DRIVE)
            : newLogs
        };
      });
    });

    // Listen for queue status
    window.electronAPI.onBackupQueued((data) => {
      setDriveStates(prev => ({
        ...prev,
        [data.driveId]: {
          ...prev[data.driveId],
          status: 'queued',
          queuePosition: data.position,
          queueTotal: data.total
        }
      }));
      setDriveLogs(prev => ({
        ...prev,
        [data.driveId]: [...(prev[data.driveId] || []), `Queued for backup (position ${data.position} of ${data.total})`]
      }));
    });

    // Listen for backup starting
    window.electronAPI.onBackupStarted((data) => {
      setDriveStates(prev => {
        const existingProgress = prev[data.driveId]?.progress;
        return {
          ...prev,
          [data.driveId]: {
            ...prev[data.driveId],
            status: 'running',
            // Preserve existing progress if it's meaningful (don't reset mid-backup)
            progress: existingProgress > 0 ? existingProgress : 0,
            queuePosition: null
          }
        };
      });
      setDriveLogs(prev => ({
        ...prev,
        [data.driveId]: [...(prev[data.driveId] || []), 'Backup starting now...']
      }));
    });

    // Listen for backup completion
    window.electronAPI.onBackupComplete((data) => {
      console.log('[DriveContext] Received backup-complete event:', data);
      if (data.success) {
        const status = data.alreadyExists ? 'exists' : (data.partialSuccess ? 'partial_success' : 'complete');
        setDriveStates(prev => ({
          ...prev,
          [data.driveId]: {
            status,
            progress: 100,
            backupSize: data.size,
            partialSuccess: data.partialSuccess || false,
            errorsEncountered: data.errorsEncountered || [],
            filesSuccessful: data.filesSuccessful || 0,
            filesFailed: data.filesFailed || 0,
            percentRecovered: data.percentRecovered || 100
          }
        }));
        // Log partial success warning
        if (data.partialSuccess) {
          setDriveLogs(prev => ({
            ...prev,
            [data.driveId]: [
              ...(prev[data.driveId] || []),
              `WARNING: Backup completed with ${data.filesFailed} file error(s)`,
              `Recovery: ${data.percentRecovered?.toFixed(1)}% of files recovered successfully`
            ]
          }));
        }
      } else {
        setDriveStates(prev => ({
          ...prev,
          [data.driveId]: {
            status: 'error',
            progress: 0,
            error: data.error
          }
        }));
      }
    });

    console.log('[DriveContext] >>> ALL LISTENERS SET UP SUCCESSFULLY <<<');
    window.electronAPI.sendDiagnostic('[DriveContext] All listeners registered successfully').catch(e => console.error('Diagnostic send failed:', e));
    } catch (err) {
      console.error('[DriveContext] ERROR setting up listeners:', err);
      window.electronAPI.sendDiagnostic(`[DriveContext] ERROR setting up listeners: ${err.message}`).catch(e => console.error('Diagnostic send failed:', e));
    }

    // Cleanup on unmount - must reset ref so listeners are re-registered on remount
    return () => {
      console.log('[DriveContext] Cleaning up listeners (component unmounting)');
      // CRITICAL: Reset the ref so listeners will be re-registered if component remounts
      // This handles React Strict Mode double-mounting and hot reload scenarios
      listenersSetupRef.current = false;
      if (window.electronAPI) {
        window.electronAPI.removeBackupListeners();
      }
    };
  }, []);

  // Initial scan on first load only
  useEffect(() => {
    if (!window.electronAPI || initializedRef.current) return;
    initializedRef.current = true;

    console.log('[DriveContext] Initial setup - cleaning orphans and scanning');

    window.electronAPI.cleanupOrphanTemps().then(result => {
      if (result.success && result.cleaned > 0) {
        console.log(`Cleaned up ${result.cleaned} orphan temp folder(s)`);
      }
      scanDrives();
    }).catch(err => {
      console.error('Cleanup error:', err);
      scanDrives();
    });
  }, []);

  // Scan drives function
  const scanDrives = useCallback(async () => {
    if (!window.electronAPI) return;

    // Don't scan if any backups are running (preserve state)
    const hasRunningBackups = Object.values(driveStates).some(
      s => s.status === 'running' || s.status === 'queued'
    );

    if (hasRunningBackups) {
      console.log('[DriveContext] Skipping scan - backups in progress');
      // Just refresh drive list without resetting states
      try {
        const result = await window.electronAPI.scanDrives();
        if (result.success) {
          setDrives(result.drives);
          console.log('[DriveContext] Detected drives during backup:', result.drives.map(d => `${d.driveLetter}: ${d.discName}`));
          // Don't update driveStates for running/queued backups
          for (const drive of result.drives) {
            const existingState = driveStates[drive.id];
            if (!existingState || (existingState.status !== 'running' && existingState.status !== 'queued')) {
              const discName = sanitizeDiscName(drive.discName);
              const statusResult = await window.electronAPI.checkBackupStatus(discName, drive.discSize || 0);
              if (statusResult.success) {
                updateDriveStatus(drive.id, statusResult);
              }
            }
          }
        }
      } catch (err) {
        console.error('[DriveContext] Scan error:', err);
      }
      return;
    }

    setIsScanning(true);
    setError(null);

    try {
      const result = await window.electronAPI.scanDrives();
      console.log('[DriveContext] Scan complete, drives detected:', result.success ? result.drives.map(d => `${d.driveLetter}: ${d.discName} (${d.discSize} bytes)`) : 'none');

      if (result.success) {
        setDrives(result.drives);

        const states = {};
        for (const drive of result.drives) {
          const discName = sanitizeDiscName(drive.discName);
          const statusResult = await window.electronAPI.checkBackupStatus(discName, drive.discSize || 0);

          if (statusResult.success) {
            if (statusResult.status === 'complete') {
              states[drive.id] = {
                status: 'exists',
                progress: 100,
                backupSize: statusResult.backupSize,
                backupRatio: statusResult.backupRatio,
              };
            } else if (statusResult.status === 'partial_success') {
              states[drive.id] = {
                status: 'partial_success',
                progress: 100,
                backupSize: statusResult.backupSize,
                backupRatio: statusResult.backupRatio,
                partialSuccess: true,
                errorsEncountered: statusResult.errorsEncountered || [],
                filesSuccessful: statusResult.filesSuccessful || 0,
                filesFailed: statusResult.filesFailed || 0,
                percentRecovered: statusResult.percentRecovered || 0
              };
            } else if (statusResult.status === 'incomplete_backup' || statusResult.status === 'incomplete_temp') {
              states[drive.id] = {
                status: 'incomplete',
                progress: statusResult.backupRatio || statusResult.tempRatio || 0,
                backupSize: statusResult.backupSize || statusResult.tempSize,
                backupRatio: statusResult.backupRatio || statusResult.tempRatio,
              };
            } else {
              states[drive.id] = { status: 'idle', progress: 0 };
            }
          } else {
            states[drive.id] = { status: 'idle', progress: 0 };
          }
        }
        setDriveStates(states);

        if (result.drives.length > 0 && activeLogTab === null) {
          setActiveLogTab(result.drives[0].id);
        }
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsScanning(false);
    }
  }, [driveStates, activeLogTab]);

  // Helper to update single drive status
  const updateDriveStatus = useCallback((driveId, statusResult) => {
    setDriveStates(prev => {
      // Don't update if backup is running
      if (prev[driveId]?.status === 'running' || prev[driveId]?.status === 'queued') {
        return prev;
      }

      if (statusResult.status === 'complete') {
        return {
          ...prev,
          [driveId]: {
            status: 'exists',
            progress: 100,
            backupSize: statusResult.backupSize,
            backupRatio: statusResult.backupRatio,
          }
        };
      } else if (statusResult.status === 'partial_success') {
        return {
          ...prev,
          [driveId]: {
            status: 'partial_success',
            progress: 100,
            backupSize: statusResult.backupSize,
            backupRatio: statusResult.backupRatio,
            partialSuccess: true,
            errorsEncountered: statusResult.errorsEncountered || [],
            filesSuccessful: statusResult.filesSuccessful || 0,
            filesFailed: statusResult.filesFailed || 0,
            percentRecovered: statusResult.percentRecovered || 0
          }
        };
      } else if (statusResult.status === 'incomplete_backup' || statusResult.status === 'incomplete_temp') {
        return {
          ...prev,
          [driveId]: {
            status: 'incomplete',
            progress: statusResult.backupRatio || statusResult.tempRatio || 0,
            backupSize: statusResult.backupSize || statusResult.tempSize,
            backupRatio: statusResult.backupRatio || statusResult.tempRatio,
          }
        };
      } else {
        return {
          ...prev,
          [driveId]: { status: 'idle', progress: 0 }
        };
      }
    });
  }, []);

  // Refresh single drive status
  const refreshDrive = useCallback(async (driveId) => {
    if (!window.electronAPI) return;

    // Find the drive
    const drive = drives.find(d => d.id === driveId);
    if (!drive) return;

    // Don't refresh if backup is running
    const currentState = driveStates[driveId];
    if (currentState?.status === 'running' || currentState?.status === 'queued') {
      return;
    }

    const discName = sanitizeDiscName(drive.discName);
    try {
      const statusResult = await window.electronAPI.checkBackupStatus(discName, drive.discSize || 0);
      if (statusResult.success) {
        updateDriveStatus(driveId, statusResult);
      }
    } catch (err) {
      console.error(`Failed to refresh drive ${driveId}:`, err);
    }
  }, [drives, driveStates, updateDriveStatus]);

  // Start backup
  const startBackup = useCallback(async (drive, extractionMode = 'full_backup') => {
    if (!window.electronAPI) return;

    const discName = sanitizeDiscName(drive.discName);
    const modeLabel = extractionMode === 'smart_extract' ? 'Smart Extract' : 'Full Backup';

    setDriveStates(prev => ({
      ...prev,
      [drive.id]: { status: 'running', progress: 0 }
    }));

    setDriveLogs(prev => ({
      ...prev,
      [drive.id]: [`Starting backup: ${drive.discName}`, `Disc size: ${formatSize(drive.discSize)}`, `Extraction mode: ${modeLabel}`]
    }));

    setActiveLogTab(drive.id);

    try {
      const result = await window.electronAPI.startBackup(drive.id, drive.makemkvIndex, discName, drive.discSize || 0, drive.driveLetter, extractionMode);

      if (result.success) {
        if (result.alreadyExists) {
          setDriveStates(prev => ({
            ...prev,
            [drive.id]: { status: 'exists', progress: 100, backupSize: result.size }
          }));
        }
      } else {
        setDriveStates(prev => ({
          ...prev,
          [drive.id]: { status: 'error', progress: 0, error: result.error }
        }));
      }
    } catch (err) {
      setDriveStates(prev => ({
        ...prev,
        [drive.id]: { status: 'error', progress: 0, error: err.message }
      }));
    }
  }, []);

  // Cancel backup
  const cancelBackup = useCallback(async (driveId) => {
    if (!window.electronAPI) return;

    try {
      await window.electronAPI.cancelBackup(driveId);
      setDriveStates(prev => ({
        ...prev,
        [driveId]: { status: 'idle', progress: 0 }
      }));
      setDriveLogs(prev => ({
        ...prev,
        [driveId]: [...(prev[driveId] || []), 'Backup cancelled by user']
      }));
    } catch (err) {
      setError(err.message);
    }
  }, []);

  // Redo backup (delete and restart)
  const redoBackup = useCallback(async (drive) => {
    if (!window.electronAPI) return;

    const discName = sanitizeDiscName(drive.discName);

    setDriveStates(prev => ({
      ...prev,
      [drive.id]: { status: 'running', progress: 0 }
    }));

    setDriveLogs(prev => ({
      ...prev,
      [drive.id]: [`RE-DO: Deleting existing backup and starting fresh...`, `Disc: ${drive.discName}`, `Size: ${formatSize(drive.discSize)}`]
    }));

    setActiveLogTab(drive.id);

    try {
      const result = await window.electronAPI.deleteAndRestartBackup(
        drive.id,
        drive.makemkvIndex,
        discName,
        drive.discSize || 0,
        drive.driveLetter
      );

      if (!result.success) {
        setDriveStates(prev => ({
          ...prev,
          [drive.id]: { status: 'error', progress: 0, error: result.error }
        }));
        setDriveLogs(prev => ({
          ...prev,
          [drive.id]: [...(prev[drive.id] || []), `ERROR: ${result.error}`]
        }));
      }
    } catch (err) {
      setDriveStates(prev => ({
        ...prev,
        [drive.id]: { status: 'error', progress: 0, error: err.message }
      }));
      setDriveLogs(prev => ({
        ...prev,
        [drive.id]: [...(prev[drive.id] || []), `ERROR: ${err.message}`]
      }));
    }
  }, []);

  // Clear error
  const clearError = useCallback(() => setError(null), []);

  const value = {
    drives,
    driveStates,
    driveLogs,
    isScanning,
    error,
    activeLogTab,
    setActiveLogTab,
    scanDrives,
    startBackup,
    cancelBackup,
    redoBackup,
    refreshDrive,
    clearError,
  };

  return (
    <DriveContext.Provider value={value}>
      {children}
    </DriveContext.Provider>
  );
}

export function useDrives() {
  const context = useContext(DriveContext);
  if (!context) {
    throw new Error('useDrives must be used within a DriveProvider');
  }
  return context;
}

export default DriveContext;
