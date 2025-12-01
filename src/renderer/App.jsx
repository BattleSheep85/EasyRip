// Main App Component - SAP-Style Compact UI
import React, { useState, useEffect, useRef } from 'react';
import { formatSize, sanitizeDiscName } from '../shared/utils.js';
import MetadataManager from './MetadataManager.jsx';
import MetadataEditor from './MetadataEditor.jsx';
import TMDBSearchModal from './TMDBSearchModal.jsx';
import ExportManager from './ExportManager.jsx';

function App() {
  const [drives, setDrives] = useState([]);
  const [driveStates, setDriveStates] = useState({}); // Per-drive state
  const [driveLogs, setDriveLogs] = useState({}); // Per-drive logs
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState(null);
  const [activeLogTab, setActiveLogTab] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showSystemLogs, setShowSystemLogs] = useState(false);
  const [systemLogs, setSystemLogs] = useState('');
  const [settings, setSettings] = useState({
    makemkvPath: '',
    basePath: 'D:\\EasyRip',
  });
  const [editedSettings, setEditedSettings] = useState(null);
  const logEndRef = useRef(null);
  const initRef = useRef(false); // Prevent double init in React StrictMode

  // Metadata modal state
  const [showMetadata, setShowMetadata] = useState(false);
  const [showExportManager, setShowExportManager] = useState(false);
  const [editingBackup, setEditingBackup] = useState(null);
  const [tmdbSearch, setTmdbSearch] = useState(null); // { query, year, onSelect }
  const [metadataRefreshKey, setMetadataRefreshKey] = useState(0); // Increment to trigger MetadataManager reload

  // Export state
  const [exportStatus, setExportStatus] = useState(null); // { backupName, percent, stage }
  const [exportQueue, setExportQueue] = useState({ queueLength: 0, processing: null, queue: [] });

  // Confirmation dialog state for Re-Do
  const [confirmRedo, setConfirmRedo] = useState(null); // { drive } or null

  // Automation toggles state
  const [automation, setAutomation] = useState({
    autoBackup: false,
    autoMeta: true,
    autoExport: false,
    liveDangerously: false,
    ejectAfterBackup: false
  });

  // Load settings and set up listeners on mount
  useEffect(() => {
    if (!window.electronAPI) {
      console.warn('Not running in Electron - electronAPI not available');
      return;
    }

    // Remove any existing listeners first (handles StrictMode re-mount)
    window.electronAPI.removeBackupListeners();
    console.log('[App] Setting up IPC listeners');

    // Only run cleanup/init once (prevent double-scanning in StrictMode)
    const isFirstMount = !initRef.current;
    initRef.current = true;

    if (isFirstMount) {
      loadSettings();
      loadAutomation();

      // Clean up any orphan temp folders on startup, THEN scan drives
      window.electronAPI.cleanupOrphanTemps().then(result => {
        if (result.success && result.cleaned > 0) {
          console.log(`Cleaned up ${result.cleaned} orphan temp folder(s)`);
        }
        // Only scan drives AFTER cleanup completes
        handleScanDrives();
      }).catch(err => {
        console.error('Cleanup error:', err);
        // Still scan drives even if cleanup fails
        handleScanDrives();
      });
    }

    // Listen for progress updates (per-drive)
    window.electronAPI.onBackupProgress((data) => {
      // Log significant progress milestones
      if (data.percent >= 95 || data.percent % 25 === 0) {
        console.log(`[App] Progress update: driveId=${data.driveId}, percent=${data.percent?.toFixed(1)}%`);
      }
      setDriveStates(prev => ({
        ...prev,
        [data.driveId]: {
          ...prev[data.driveId],
          progress: data.percent,
          status: data.percent >= 100 ? 'complete' : 'running',
        }
      }));
    });

    // Listen for log updates (per-drive)
    window.electronAPI.onBackupLog((data) => {
      setDriveLogs(prev => ({
        ...prev,
        [data.driveId]: [...(prev[data.driveId] || []), data.line]
      }));
    });

    // Listen for queue status (backup is waiting in queue)
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

    // Listen for backup actually starting (was queued, now running)
    window.electronAPI.onBackupStarted((data) => {
      setDriveStates(prev => ({
        ...prev,
        [data.driveId]: {
          ...prev[data.driveId],
          status: 'running',
          progress: 0,
          queuePosition: null
        }
      }));
      setDriveLogs(prev => ({
        ...prev,
        [data.driveId]: [...(prev[data.driveId] || []), 'Backup starting now...']
      }));
    });

    // Listen for backup completion (via queue system)
    window.electronAPI.onBackupComplete((data) => {
      console.log('[App] Received backup-complete event:', data);
      if (data.success) {
        console.log(`[App] Setting driveId=${data.driveId} status to ${data.alreadyExists ? 'exists' : 'complete'}`);
        setDriveStates(prev => ({
          ...prev,
          [data.driveId]: {
            status: data.alreadyExists ? 'exists' : 'complete',
            progress: 100,
            backupSize: data.size
          }
        }));
      } else {
        console.log(`[App] Setting driveId=${data.driveId} status to error: ${data.error}`);
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

    // Note: handleScanDrives() is now called inside cleanupOrphanTemps callback above

    // Listen for export progress
    window.electronAPI.onExportProgress((data) => {
      setExportStatus({
        backupName: data.backupName,
        percent: data.percent,
        stage: data.stage
      });
    });

    // Listen for export completion
    window.electronAPI.onExportComplete((data) => {
      setExportStatus(null);
      // Refresh queue status
      refreshExportQueue();
    });

    // Listen for export errors
    window.electronAPI.onExportError((data) => {
      setExportStatus({
        backupName: data.name,
        percent: 0,
        stage: `Error: ${data.error}`,
        isError: true
      });
      // Clear error status after 5 seconds
      setTimeout(() => setExportStatus(null), 5000);
    });

    // Initial queue status load
    refreshExportQueue();

    return () => {
      if (window.electronAPI) {
        window.electronAPI.removeBackupListeners();
        window.electronAPI.removeExportListeners();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-scroll logs
  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [driveLogs, activeLogTab]);

  async function loadSettings() {
    if (!window.electronAPI) return;
    try {
      const result = await window.electronAPI.getSettings();
      if (result.success) {
        setSettings(result.settings);
        setEditedSettings(result.settings);
      }
    } catch (err) {
      console.error('Failed to load settings:', err);
    }
  }

  async function loadAutomation() {
    if (!window.electronAPI) return;
    try {
      const result = await window.electronAPI.getAutomation();
      if (result.success) {
        setAutomation(result.automation);
      }
    } catch (err) {
      console.error('Failed to load automation settings:', err);
    }
  }

  async function handleToggleAutomation(key) {
    if (!window.electronAPI) return;
    try {
      const result = await window.electronAPI.toggleAutomation(key);
      if (result.success) {
        setAutomation(result.automation);
      }
    } catch (err) {
      console.error('Failed to toggle automation:', err);
    }
  }

  async function refreshExportQueue() {
    if (!window.electronAPI) return;
    try {
      const result = await window.electronAPI.getExportQueueStatus();
      if (result.success) {
        setExportQueue(result.status);
      }
    } catch (err) {
      console.error('Failed to get export queue status:', err);
    }
  }

  // Save settings
  async function handleSaveSettings() {
    if (!window.electronAPI || !editedSettings) return;
    try {
      const result = await window.electronAPI.saveSettings(editedSettings);
      if (result.success) {
        setSettings(editedSettings);
        setShowSettings(false);
      } else {
        setError('Failed to save settings: ' + result.error);
      }
    } catch (err) {
      setError('Failed to save settings: ' + err.message);
    }
  }

  // Load system logs for troubleshooting
  async function handleViewSystemLogs() {
    if (!window.electronAPI) return;
    try {
      const result = await window.electronAPI.getLogs(300);
      if (result.success) {
        setSystemLogs(result.content);
        setShowSystemLogs(true);
      } else {
        setError('Failed to load logs: ' + result.error);
      }
    } catch (err) {
      setError('Failed to load logs: ' + err.message);
    }
  }

  // Open log directory in explorer
  async function handleOpenLogDir() {
    if (!window.electronAPI) return;
    try {
      await window.electronAPI.openLogDirectory();
    } catch (err) {
      setError('Failed to open log directory: ' + err.message);
    }
  }

  // Open backup directory in explorer
  async function handleOpenBackupDir() {
    if (!window.electronAPI) return;
    try {
      await window.electronAPI.openBackupDirectory();
    } catch (err) {
      setError('Failed to open backup directory: ' + err.message);
    }
  }

  // Scan for drives using fast Windows detection
  async function handleScanDrives() {
    if (!window.electronAPI) return;
    setIsScanning(true);
    setError(null);

    try {
      const result = await window.electronAPI.scanDrives();

      if (result.success) {
        setDrives(result.drives);

        // Initialize drive states and check backup status for each
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
            } else if (statusResult.status === 'incomplete_backup' || statusResult.status === 'incomplete_temp') {
              states[drive.id] = {
                status: 'incomplete',
                progress: statusResult.backupRatio || statusResult.tempRatio || 0,
                backupSize: statusResult.backupSize || statusResult.tempSize,
                backupRatio: statusResult.backupRatio || statusResult.tempRatio,
              };
            } else {
              states[drive.id] = driveStates[drive.id] || { status: 'idle', progress: 0 };
            }
          } else {
            states[drive.id] = driveStates[drive.id] || { status: 'idle', progress: 0 };
          }
        }
        setDriveStates(states);

        // Set first drive as active log tab if none selected
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
  }

  // Start backup for a single drive
  async function handleStartBackup(drive) {
    if (!window.electronAPI) return;

    // Create sanitized disc name using shared utility
    const discName = sanitizeDiscName(drive.discName);

    // Update state to running
    setDriveStates(prev => ({
      ...prev,
      [drive.id]: { status: 'running', progress: 0 }
    }));

    // Clear previous logs
    setDriveLogs(prev => ({
      ...prev,
      [drive.id]: [`Starting backup: ${drive.discName}`, `Disc size: ${formatSize(drive.discSize)}`]
    }));

    // Switch to this drive's log tab
    setActiveLogTab(drive.id);

    try {
      const result = await window.electronAPI.startBackup(drive.id, drive.makemkvIndex, discName, drive.discSize || 0, drive.driveLetter);

      if (result.success) {
        // Backup started (parallel mode) or was queued - status updates come via IPC events
        // (onBackupStarted, onBackupProgress, onBackupComplete)
        // Don't update status here - the events will handle it
        if (result.alreadyExists) {
          // Backup already existed
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
  }

  // Cancel backup for a drive
  async function handleCancelBackup(driveId) {
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
  }

  // Re-Do backup - shows confirmation dialog (unless Live Dangerously mode)
  function handleRedoClick(drive) {
    if (automation.liveDangerously) {
      // Skip confirmation in YOLO mode - proceed directly
      performRedo(drive);
    } else {
      setConfirmRedo({ drive });
    }
  }

  // Actually perform the re-do (shared by confirmation and YOLO mode)
  async function performRedo(drive) {
    if (!window.electronAPI) return;

    const discName = sanitizeDiscName(drive.discName);

    // Update state to running
    setDriveStates(prev => ({
      ...prev,
      [drive.id]: { status: 'running', progress: 0 }
    }));

    // Clear previous logs
    setDriveLogs(prev => ({
      ...prev,
      [drive.id]: [`RE-DO: Deleting existing backup and starting fresh...`, `Disc: ${drive.discName}`, `Size: ${formatSize(drive.discSize)}`]
    }));

    // Switch to this drive's log tab
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
      // Success - progress updates come via IPC events
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
  }

  // Confirm Re-Do - deletes existing backup and starts fresh
  function handleConfirmRedo() {
    if (!confirmRedo) return;
    const drive = confirmRedo.drive;
    setConfirmRedo(null);
    performRedo(drive);
  }

  // Backup all drives concurrently
  async function handleBackupAll() {
    const eligibleDrives = drives.filter(d => {
      const state = driveStates[d.id];
      return !state || state.status === 'idle' || state.status === 'error' || state.status === 'incomplete';
    });

    // Start all backups concurrently (not sequentially!)
    eligibleDrives.forEach(drive => {
      handleStartBackup(drive);
    });
  }

  // Get status badge class
  function getStatusClass(status) {
    switch (status) {
      case 'running': return 'status-badge status-running';
      case 'queued': return 'status-badge status-queued';
      case 'complete': return 'status-badge status-complete';
      case 'exists': return 'status-badge status-exists';
      case 'incomplete': return 'status-badge status-incomplete';
      case 'error': return 'status-badge status-error';
      default: return 'status-badge status-idle';
    }
  }

  // Get status text
  function getStatusText(status, state) {
    switch (status) {
      case 'running': return 'Running';
      case 'queued': return `Queued (#${state?.queuePosition || '?'})`;
      case 'complete': return 'Complete';
      case 'exists': return 'Done';
      case 'incomplete': return `Incomplete (${state?.backupRatio?.toFixed(0) || 0}%)`;
      case 'error': return 'Error';
      default: return 'Ready';
    }
  }

  // Count drives by status
  const runningCount = drives.filter(d => driveStates[d.id]?.status === 'running').length;
  const queuedCount = drives.filter(d => driveStates[d.id]?.status === 'queued').length;
  const completeCount = drives.filter(d => ['complete', 'exists'].includes(driveStates[d.id]?.status)).length;
  const readyCount = drives.filter(d => {
    const status = driveStates[d.id]?.status;
    return !status || status === 'idle' || status === 'error' || status === 'incomplete';
  }).length;

  return (
    <div className="app">
      {/* Header */}
      <header className="app-header">
        <div className="header-left">
          <h1>EasyRip</h1>
        </div>
        <div className="header-actions">
          <button className="btn btn-sm" onClick={() => setShowMetadata(true)} title="Manage backup metadata">
            Metadata
          </button>
          <button className="btn btn-sm" onClick={() => setShowExportManager(true)} title="Export queue and remux status">
            Export
          </button>
          <button className="btn btn-sm" onClick={handleOpenBackupDir} title="Open backup folder">
            Backups
          </button>
          <button className="btn btn-sm" onClick={handleViewSystemLogs} title="View system logs for troubleshooting">
            Logs
          </button>
          <button className="btn btn-sm" onClick={() => { setEditedSettings(settings); setShowSettings(true); }}>
            Settings
          </button>
        </div>
      </header>

      <main className="app-main">
        {/* Error Banner */}
        {error && (
          <div className="error-banner">
            <span><strong>Error:</strong> {error}</span>
            <button onClick={() => setError(null)}>X</button>
          </div>
        )}

        {/* Toolbar */}
        <div className="toolbar">
          <button
            onClick={handleScanDrives}
            disabled={isScanning}
            className="btn btn-primary"
          >
            {isScanning ? 'Scanning...' : 'Refresh Drives'}
          </button>

          <button
            onClick={handleBackupAll}
            disabled={readyCount === 0 || runningCount > 0}
            className="btn btn-success"
          >
            Backup All ({readyCount})
          </button>

          <div className="toolbar-separator"></div>

          <span className="toolbar-info">
            {drives.length} disc(s) | {runningCount} running | {queuedCount > 0 ? `${queuedCount} queued | ` : ''}{completeCount} done | {readyCount} ready
          </span>

          <div className="toolbar-separator"></div>

          {/* Automation Toggles */}
          <div className="automation-toggles">
            <span className="automation-label">Auto:</span>
            <button
              className={`btn btn-xs btn-toggle ${automation.autoBackup ? 'active' : ''}`}
              onClick={() => handleToggleAutomation('autoBackup')}
              title="Auto-backup when disc inserted"
            >
              Backup
            </button>
            <button
              className={`btn btn-xs btn-toggle ${automation.autoMeta ? 'active' : ''}`}
              onClick={() => handleToggleAutomation('autoMeta')}
              title="Auto-identify metadata for new backups"
            >
              Meta
            </button>
            <button
              className={`btn btn-xs btn-toggle ${automation.autoExport ? 'active' : ''}`}
              onClick={() => handleToggleAutomation('autoExport')}
              title="Auto-export approved backups"
            >
              Export
            </button>
            <button
              className={`btn btn-xs btn-toggle ${automation.ejectAfterBackup ? 'active' : ''}`}
              onClick={() => handleToggleAutomation('ejectAfterBackup')}
              title="Auto-eject disc after successful backup"
            >
              Eject
            </button>
            <span className="automation-separator">|</span>
            <button
              className={`btn btn-xs btn-toggle btn-danger-toggle ${automation.liveDangerously ? 'active' : ''}`}
              onClick={() => handleToggleAutomation('liveDangerously')}
              title="Live Dangerously: Skip all confirmations and auto-approve everything"
            >
              YOLO
            </button>
          </div>
        </div>

        {/* Drives Table */}
        <div className="drives-panel">
          <div className="panel-header">
            <span>Optical Drives</span>
          </div>
          <div className="drive-table-container">
            {drives.length === 0 ? (
              <div className="no-drives">
                {isScanning ? 'Scanning for drives...' : 'No discs found. Insert a disc and click Refresh.'}
              </div>
            ) : (
              <table className="drive-table">
                <thead>
                  <tr>
                    <th>Drive</th>
                    <th>Type</th>
                    <th>Disc Name</th>
                    <th>Disc Size</th>
                    <th>Backup</th>
                    <th>Status</th>
                    <th>Progress</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {drives.map(drive => {
                    const state = driveStates[drive.id] || { status: 'idle', progress: 0 };

                    return (
                      <tr key={drive.id}>
                        <td>
                          <span className="drive-letter">{drive.driveLetter}</span>
                        </td>
                        <td>
                          <span className={`disc-type ${drive.isBluray ? 'disc-bluray' : 'disc-dvd'}`}>
                            {drive.isBluray ? 'BD' : 'DVD'}
                          </span>
                        </td>
                        <td>{drive.discName || 'Unknown Disc'}</td>
                        <td className="size-cell">{formatSize(drive.discSize)}</td>
                        <td className="size-cell">
                          {state.backupSize ? formatSize(state.backupSize) : '-'}
                          {state.backupRatio > 0 && state.backupRatio < 100 && (
                            <span className="size-ratio"> ({state.backupRatio.toFixed(0)}%)</span>
                          )}
                        </td>
                        <td>
                          <span
                            className={`${getStatusClass(state.status)} ${state.error ? 'has-tooltip' : ''}`}
                            title={state.error || (drive.warning ? `Warning: ${drive.warning}` : '')}
                          >
                            {getStatusText(state.status, state)}
                            {state.error && <span className="error-indicator">!</span>}
                            {drive.warning && !state.error && <span className="warning-indicator">?</span>}
                          </span>
                          {state.error && (
                            <div className="error-detail">
                              {state.error}
                            </div>
                          )}
                        </td>
                        <td className="progress-cell">
                          <div className="progress-bar">
                            <div
                              className={`progress-fill ${state.status === 'running' ? 'running' : ''} ${state.status === 'running' && (state.progress || 0) < 2 ? 'indeterminate' : ''} ${['complete', 'exists'].includes(state.status) ? 'complete' : ''} ${state.status === 'error' ? 'error' : ''} ${state.status === 'incomplete' ? 'incomplete' : ''}`}
                              style={{ width: `${state.progress || 0}%` }}
                            ></div>
                            <span className="progress-text">
                              {state.status === 'running' && (state.progress || 0) < 2
                                ? 'Starting...'
                                : state.progress
                                  ? `${Math.round(state.progress)}%`
                                  : '-'
                              }
                            </span>
                          </div>
                        </td>
                        <td className="action-cell">
                          {state.status === 'running' ? (
                            <button
                              onClick={() => handleCancelBackup(drive.id)}
                              className="btn btn-sm btn-danger"
                            >
                              Cancel
                            </button>
                          ) : state.status === 'queued' ? (
                            <button
                              onClick={() => handleCancelBackup(drive.id)}
                              className="btn btn-sm btn-warning"
                              title={`Queued at position #${state.queuePosition}`}
                            >
                              Dequeue
                            </button>
                          ) : state.status === 'exists' ? (
                            <button
                              onClick={() => handleRedoClick(drive)}
                              className="btn btn-sm btn-warning"
                              title="Delete existing backup and re-backup from disc"
                            >
                              Re-do
                            </button>
                          ) : state.status === 'incomplete' ? (
                            <button
                              onClick={() => handleStartBackup(drive)}
                              className="btn btn-sm btn-warning"
                              title="Incomplete backup - will delete and restart"
                            >
                              Retry
                            </button>
                          ) : (
                            <button
                              onClick={() => handleStartBackup(drive)}
                              disabled={state.status === 'running'}
                              className="btn btn-sm btn-primary"
                            >
                              Backup
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Log Panel */}
        <div className="log-panel">
          <div className="log-tabs">
            {drives.map(drive => {
              const state = driveStates[drive.id] || { status: 'idle' };
              return (
                <button
                  key={drive.id}
                  className={`log-tab ${activeLogTab === drive.id ? 'active' : ''}`}
                  onClick={() => setActiveLogTab(drive.id)}
                >
                  <span className={`tab-status ${state.status}`}></span>
                  {drive.driveLetter} - {drive.discName || 'Unknown'}
                </button>
              );
            })}
            {drives.length === 0 && (
              <span className="log-tab">No drives</span>
            )}
          </div>
          <div className="log-content">
            {activeLogTab !== null && driveLogs[activeLogTab] ? (
              driveLogs[activeLogTab].map((line, i) => (
                <div
                  key={i}
                  className={`log-line ${line.startsWith('ERROR') ? 'error' : ''} ${line.includes('successfully') || line.includes('complete') ? 'success' : ''} ${line.startsWith('Task:') || line.startsWith('Processing:') || line.startsWith('Copying:') ? 'info' : ''} ${line.startsWith('WARNING') ? 'warning' : ''}`}
                >
                  {line}
                </div>
              ))
            ) : (
              <div className="log-empty">Select a drive to view logs</div>
            )}
            <div ref={logEndRef}></div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="app-footer">
        <span>Base: {settings.basePath}</span>
        {/* Export Progress */}
        {exportStatus && (
          <div className={`footer-export ${exportStatus.isError ? 'error' : ''}`}>
            <span className="export-label">Export:</span>
            <span className="export-name">{exportStatus.backupName}</span>
            <div className="export-progress-bar">
              <div
                className={`export-progress-fill ${exportStatus.isError ? 'error' : ''}`}
                style={{ width: `${exportStatus.percent || 0}%` }}
              ></div>
            </div>
            <span className="export-percent">{Math.round(exportStatus.percent || 0)}%</span>
            <span className="export-stage">{exportStatus.stage}</span>
          </div>
        )}
        {/* Export Queue Status */}
        {!exportStatus && exportQueue.queueLength > 0 && (
          <div className="footer-export-queue">
            <span>Export Queue: {exportQueue.queueLength} pending</span>
          </div>
        )}
        <span>Temp: {settings.basePath}\temp | Backup: {settings.basePath}\backup</span>
      </footer>

      {/* Settings Modal */}
      {showSettings && (
        <div className="modal-overlay" onClick={() => setShowSettings(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Settings</h3>
              <button className="modal-close" onClick={() => setShowSettings(false)}>X</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>MakeMKV Path:</label>
                <input
                  type="text"
                  value={editedSettings?.makemkvPath || ''}
                  onChange={e => setEditedSettings({...editedSettings, makemkvPath: e.target.value})}
                  placeholder="C:\Program Files (x86)\MakeMKV\makemkvcon64.exe"
                />
              </div>
              <div className="form-group">
                <label>Base Output Path:</label>
                <input
                  type="text"
                  value={editedSettings?.basePath || ''}
                  onChange={e => setEditedSettings({...editedSettings, basePath: e.target.value})}
                  placeholder="D:\EasyRip"
                />
                <small>Backups stored in: {editedSettings?.basePath}\backup</small>
              </div>
              <div className="form-group">
                <label>MakeMKV Beta Key:</label>
                <div style={{display: 'flex', gap: '8px'}}>
                  <input
                    type="text"
                    value={editedSettings?.makemkvKey || ''}
                    onChange={e => setEditedSettings({...editedSettings, makemkvKey: e.target.value})}
                    placeholder="T-xxxxxx..."
                    style={{flex: 1}}
                  />
                  <button
                    className="btn btn-sm"
                    onClick={async () => {
                      if (!window.electronAPI) return;
                      try {
                        const result = await window.electronAPI.fetchMakeMKVKey();
                        if (result.success) {
                          setEditedSettings({...editedSettings, makemkvKey: result.key});
                          alert('Key fetched successfully!');
                        } else {
                          alert('Failed to fetch key: ' + result.error);
                        }
                      } catch (err) {
                        alert('Error fetching key: ' + err.message);
                      }
                    }}
                    title="Auto-fetch the latest beta key from MakeMKV forum"
                  >
                    Auto-Fetch
                  </button>
                </div>
                <small>Beta registration key (applied to Windows registry on save). <a href="https://forum.makemkv.com/forum/viewtopic.php?t=1053" target="_blank" rel="noopener noreferrer" style={{color: '#4da6ff'}}>Get from forum</a></small>
              </div>
              <hr style={{margin: '16px 0', borderColor: '#3d3d3d'}} />
              <div className="form-group">
                <label>TMDB API Key:</label>
                <input
                  type="password"
                  value={editedSettings?.tmdbApiKey || ''}
                  onChange={e => setEditedSettings({...editedSettings, tmdbApiKey: e.target.value})}
                  placeholder="Enter your TMDB API key"
                />
                <small>Get a free API key at <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noopener noreferrer" style={{color: '#4da6ff'}}>themoviedb.org</a></small>
              </div>
              <hr style={{margin: '16px 0', borderColor: '#3d3d3d'}} />
              <h4 style={{margin: '0 0 12px 0', color: '#888'}}>Transfer Settings</h4>

              {/* Protocol Selection */}
              <div className="form-group">
                <label>Transfer Protocol:</label>
                <div className="radio-group">
                  {[
                    { value: 'local', label: 'Local', desc: 'Copy to local folder' },
                    { value: 'unc', label: 'UNC/SMB', desc: 'Windows network share' },
                    { value: 'sftp', label: 'SFTP', desc: 'SSH File Transfer' },
                    { value: 'scp', label: 'SCP', desc: 'SSH Copy' },
                    { value: 'ftp', label: 'FTP', desc: 'File Transfer Protocol' },
                  ].map(proto => (
                    <label key={proto.value} className="radio-label">
                      <input
                        type="radio"
                        name="transferProtocol"
                        value={proto.value}
                        checked={(editedSettings?.transfer?.protocol || 'local') === proto.value}
                        onChange={e => setEditedSettings({
                          ...editedSettings,
                          transfer: { ...editedSettings?.transfer, protocol: e.target.value }
                        })}
                      />
                      <span className="radio-text">
                        <strong>{proto.label}</strong>
                        <small>{proto.desc}</small>
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {/* SSH/FTP Host Settings */}
              {['sftp', 'scp', 'ftp'].includes(editedSettings?.transfer?.protocol) && (
                <>
                  <div className="form-row">
                    <div className="form-group flex-grow">
                      <label>Host:</label>
                      <input
                        type="text"
                        value={editedSettings?.transfer?.host || ''}
                        onChange={e => setEditedSettings({
                          ...editedSettings,
                          transfer: { ...editedSettings?.transfer, host: e.target.value }
                        })}
                        placeholder="192.168.1.100 or server.local"
                      />
                    </div>
                    <div className="form-group" style={{width: '100px'}}>
                      <label>Port:</label>
                      <input
                        type="number"
                        value={editedSettings?.transfer?.port || (editedSettings?.transfer?.protocol === 'ftp' ? 21 : 22)}
                        onChange={e => setEditedSettings({
                          ...editedSettings,
                          transfer: { ...editedSettings?.transfer, port: parseInt(e.target.value) || 22 }
                        })}
                      />
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="form-group flex-grow">
                      <label>Username:</label>
                      <input
                        type="text"
                        value={editedSettings?.transfer?.username || ''}
                        onChange={e => setEditedSettings({
                          ...editedSettings,
                          transfer: { ...editedSettings?.transfer, username: e.target.value }
                        })}
                        placeholder="user"
                      />
                    </div>
                    <div className="form-group flex-grow">
                      <label>Password:</label>
                      <input
                        type="password"
                        value={editedSettings?.transfer?.password || ''}
                        onChange={e => setEditedSettings({
                          ...editedSettings,
                          transfer: { ...editedSettings?.transfer, password: e.target.value }
                        })}
                        placeholder="Password"
                      />
                    </div>
                  </div>
                  {['sftp', 'scp'].includes(editedSettings?.transfer?.protocol) && (
                    <div className="form-group">
                      <label>Private Key Path (optional):</label>
                      <input
                        type="text"
                        value={editedSettings?.transfer?.privateKey || ''}
                        onChange={e => setEditedSettings({
                          ...editedSettings,
                          transfer: { ...editedSettings?.transfer, privateKey: e.target.value }
                        })}
                        placeholder="C:\Users\you\.ssh\id_rsa"
                      />
                      <small>Use instead of password for key-based auth</small>
                    </div>
                  )}
                  {editedSettings?.transfer?.protocol === 'ftp' && (
                    <div className="form-group">
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={editedSettings?.transfer?.secure || false}
                          onChange={e => setEditedSettings({
                            ...editedSettings,
                            transfer: { ...editedSettings?.transfer, secure: e.target.checked }
                          })}
                        />
                        Use FTPS (TLS/SSL encryption)
                      </label>
                    </div>
                  )}
                </>
              )}

              {/* UNC Path Settings */}
              {editedSettings?.transfer?.protocol === 'unc' && (
                <>
                  <div className="form-group">
                    <label>UNC Base Path:</label>
                    <input
                      type="text"
                      value={editedSettings?.transfer?.uncPath || ''}
                      onChange={e => setEditedSettings({
                        ...editedSettings,
                        transfer: { ...editedSettings?.transfer, uncPath: e.target.value }
                      })}
                      placeholder="\\\\server\\share"
                    />
                    <small>Network share path (credentials optional)</small>
                  </div>
                  <div className="form-row">
                    <div className="form-group flex-grow">
                      <label>Username (optional):</label>
                      <input
                        type="text"
                        value={editedSettings?.transfer?.username || ''}
                        onChange={e => setEditedSettings({
                          ...editedSettings,
                          transfer: { ...editedSettings?.transfer, username: e.target.value }
                        })}
                        placeholder="DOMAIN\\user"
                      />
                    </div>
                    <div className="form-group flex-grow">
                      <label>Password (optional):</label>
                      <input
                        type="password"
                        value={editedSettings?.transfer?.password || ''}
                        onChange={e => setEditedSettings({
                          ...editedSettings,
                          transfer: { ...editedSettings?.transfer, password: e.target.value }
                        })}
                      />
                    </div>
                  </div>
                </>
              )}

              {/* Library Paths (all protocols) */}
              <div className="form-group">
                <label>Movie Library Path:</label>
                <input
                  type="text"
                  value={editedSettings?.transfer?.moviePath || ''}
                  onChange={e => setEditedSettings({
                    ...editedSettings,
                    transfer: { ...editedSettings?.transfer, moviePath: e.target.value }
                  })}
                  placeholder={
                    ['sftp', 'scp', 'ftp'].includes(editedSettings?.transfer?.protocol)
                      ? '/media/movies'
                      : editedSettings?.transfer?.protocol === 'unc'
                        ? '\\\\NAS\\Emby\\Movies'
                        : 'D:\\Media\\Movies'
                  }
                />
                <small>
                  {['sftp', 'scp', 'ftp'].includes(editedSettings?.transfer?.protocol)
                    ? 'Remote path on the server'
                    : 'Path to your movie library folder'}
                </small>
              </div>
              <div className="form-group">
                <label>TV Library Path:</label>
                <input
                  type="text"
                  value={editedSettings?.transfer?.tvPath || ''}
                  onChange={e => setEditedSettings({
                    ...editedSettings,
                    transfer: { ...editedSettings?.transfer, tvPath: e.target.value }
                  })}
                  placeholder={
                    ['sftp', 'scp', 'ftp'].includes(editedSettings?.transfer?.protocol)
                      ? '/media/tv'
                      : editedSettings?.transfer?.protocol === 'unc'
                        ? '\\\\NAS\\Emby\\TV Shows'
                        : 'D:\\Media\\TV Shows'
                  }
                />
                <small>
                  {['sftp', 'scp', 'ftp'].includes(editedSettings?.transfer?.protocol)
                    ? 'Remote path on the server'
                    : 'Path to your TV library folder'}
                </small>
              </div>

              {/* Test Connection Button */}
              <div className="form-group">
                <button
                  className="btn btn-sm"
                  onClick={async () => {
                    if (!window.electronAPI) return;
                    try {
                      const result = await window.electronAPI.testTransferConnection(editedSettings?.transfer || {});
                      if (result.success) {
                        alert('Connection successful: ' + result.message);
                      } else {
                        alert('Connection failed: ' + result.message);
                      }
                    } catch (err) {
                      alert('Connection test error: ' + err.message);
                    }
                  }}
                >
                  Test Connection
                </button>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setShowSettings(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSaveSettings}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* System Logs Modal */}
      {showSystemLogs && (
        <div className="modal-overlay" onClick={() => setShowSystemLogs(false)}>
          <div className="modal modal-large" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>System Logs (Troubleshooting)</h3>
              <div className="modal-header-actions">
                <button className="btn btn-sm" onClick={handleOpenLogDir}>Open Log Folder</button>
                <button className="modal-close" onClick={() => setShowSystemLogs(false)}>X</button>
              </div>
            </div>
            <div className="modal-body">
              <pre className="system-log-content">{systemLogs || 'No logs available'}</pre>
            </div>
            <div className="modal-footer">
              <small>Logs are stored in: ~/.easyrip/logs/</small>
              <button className="btn" onClick={() => setShowSystemLogs(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Metadata Manager Modal */}
      {showMetadata && (
        <MetadataManager
          onClose={() => setShowMetadata(false)}
          onEdit={(backupName) => {
            setEditingBackup(backupName);
          }}
          refreshKey={metadataRefreshKey}
        />
      )}

      {/* Metadata Editor Modal */}
      {editingBackup && (
        <MetadataEditor
          backupName={editingBackup}
          onClose={() => setEditingBackup(null)}
          onSave={() => {
            // Trigger MetadataManager refresh
            setMetadataRefreshKey(prev => prev + 1);
          }}
          onSearchTMDB={(query, year, onSelect) => {
            setTmdbSearch({ query, year, onSelect });
          }}
        />
      )}

      {/* TMDB Search Modal */}
      {tmdbSearch && (
        <TMDBSearchModal
          initialQuery={tmdbSearch.query}
          initialYear={tmdbSearch.year}
          onSelect={tmdbSearch.onSelect}
          onClose={() => setTmdbSearch(null)}
        />
      )}

      {/* Export Manager Modal */}
      {showExportManager && (
        <ExportManager onClose={() => setShowExportManager(false)} />
      )}

      {/* Re-Do Confirmation Dialog */}
      {confirmRedo && (
        <div className="modal-overlay" onClick={() => setConfirmRedo(null)}>
          <div className="modal modal-confirm" onClick={e => e.stopPropagation()}>
            <div className="modal-header modal-header-warning">
              <h3>Confirm Re-Do Backup</h3>
              <button className="modal-close" onClick={() => setConfirmRedo(null)}>X</button>
            </div>
            <div className="modal-body">
              <div className="confirm-warning">
                <strong>Warning: This action will permanently delete the existing backup!</strong>
              </div>
              <div className="confirm-details">
                <p><strong>Disc:</strong> {confirmRedo.drive.discName}</p>
                <p><strong>Drive:</strong> {confirmRedo.drive.driveLetter}</p>
                <p><strong>Size:</strong> {formatSize(confirmRedo.drive.discSize)}</p>
              </div>
              <div className="confirm-message">
                <p>The existing backup folder and all its contents will be deleted, then a fresh backup will be created from the disc.</p>
                <p>This cannot be undone.</p>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setConfirmRedo(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={handleConfirmRedo}>
                Delete & Re-Do Backup
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
