/**
 * HomePage - Drives view (main backup functionality)
 * Extracted drive management from App.jsx
 */

import React, { useState, useEffect, useRef } from 'react';
import { formatSize, sanitizeDiscName } from '../../shared/utils.js';
import { useSettings } from '../context/SettingsContext.jsx';
import { useAutomation } from '../context/AutomationContext.jsx';
import { useToast } from '../components/common/Toast.jsx';

function HomePage() {
  const { settings } = useSettings();
  const { automation, toggleAutomation } = useAutomation();
  const toast = useToast();

  // Local UI state
  const [drives, setDrives] = useState([]);
  const [driveStates, setDriveStates] = useState({});
  const [driveLogs, setDriveLogs] = useState({});
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState(null);
  const [activeLogTab, setActiveLogTab] = useState(null);
  const logEndRef = useRef(null);
  const initRef = useRef(false);

  // Confirmation dialog state for Re-Do
  const [confirmRedo, setConfirmRedo] = useState(null);

  // Initialize and set up listeners
  useEffect(() => {
    if (!window.electronAPI) {
      console.warn('Not running in Electron - electronAPI not available');
      return;
    }

    window.electronAPI.removeBackupListeners();
    console.log('[HomePage] Setting up IPC listeners');

    const isFirstMount = !initRef.current;
    initRef.current = true;

    if (isFirstMount) {
      window.electronAPI.cleanupOrphanTemps().then(result => {
        if (result.success && result.cleaned > 0) {
          console.log(`Cleaned up ${result.cleaned} orphan temp folder(s)`);
        }
        handleScanDrives();
      }).catch(err => {
        console.error('Cleanup error:', err);
        handleScanDrives();
      });
    }

    // Listen for progress updates
    window.electronAPI.onBackupProgress((data) => {
      if (data.percent >= 95 || data.percent % 25 === 0) {
        console.log(`[HomePage] Progress: driveId=${data.driveId}, percent=${data.percent?.toFixed(1)}%`);
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

    // Listen for log updates (with ring buffer to prevent unbounded growth)
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

    // Listen for backup completion
    window.electronAPI.onBackupComplete((data) => {
      console.log('[HomePage] Received backup-complete event:', data);
      if (data.success) {
        setDriveStates(prev => ({
          ...prev,
          [data.driveId]: {
            status: data.alreadyExists ? 'exists' : 'complete',
            progress: 100,
            backupSize: data.size
          }
        }));
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

    return () => {
      if (window.electronAPI) {
        window.electronAPI.removeBackupListeners();
      }
    };
  }, []);

  // Auto-scroll logs
  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [driveLogs, activeLogTab]);

  // Scan for drives
  async function handleScanDrives() {
    if (!window.electronAPI) return;
    setIsScanning(true);
    setError(null);

    try {
      const result = await window.electronAPI.scanDrives();

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

  // Start backup
  async function handleStartBackup(drive) {
    if (!window.electronAPI) return;

    const discName = sanitizeDiscName(drive.discName);

    setDriveStates(prev => ({
      ...prev,
      [drive.id]: { status: 'running', progress: 0 }
    }));

    setDriveLogs(prev => ({
      ...prev,
      [drive.id]: [`Starting backup: ${drive.discName}`, `Disc size: ${formatSize(drive.discSize)}`]
    }));

    setActiveLogTab(drive.id);

    try {
      const result = await window.electronAPI.startBackup(drive.id, drive.makemkvIndex, discName, drive.discSize || 0, drive.driveLetter);

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
  }

  // Cancel backup
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

  // Re-do backup
  function handleRedoClick(drive) {
    if (automation.liveDangerously) {
      performRedo(drive);
    } else {
      setConfirmRedo({ drive });
    }
  }

  async function performRedo(drive) {
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
  }

  function handleConfirmRedo() {
    if (!confirmRedo) return;
    const drive = confirmRedo.drive;
    setConfirmRedo(null);
    performRedo(drive);
  }

  // Backup all
  async function handleBackupAll() {
    const eligibleDrives = drives.filter(d => {
      const state = driveStates[d.id];
      return !state || state.status === 'idle' || state.status === 'error' || state.status === 'incomplete';
    });

    eligibleDrives.forEach(drive => {
      handleStartBackup(drive);
    });
  }

  // Status helpers
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

  // Counts
  const runningCount = drives.filter(d => driveStates[d.id]?.status === 'running').length;
  const queuedCount = drives.filter(d => driveStates[d.id]?.status === 'queued').length;
  const completeCount = drives.filter(d => ['complete', 'exists'].includes(driveStates[d.id]?.status)).length;
  const readyCount = drives.filter(d => {
    const status = driveStates[d.id]?.status;
    return !status || status === 'idle' || status === 'error' || status === 'incomplete';
  }).length;

  return (
    <div className="page home-page">
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
          {isScanning ? (
            <>
              <span className="spinner spinner-sm spinner-white"></span>
              Scanning...
            </>
          ) : (
            'Refresh Drives'
          )}
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
            onClick={() => toggleAutomation('autoBackup')}
            title="Auto-backup when disc inserted"
          >
            Backup
          </button>
          <button
            className={`btn btn-xs btn-toggle ${automation.autoMeta ? 'active' : ''}`}
            onClick={() => toggleAutomation('autoMeta')}
            title="Auto-identify metadata for new backups"
          >
            Meta
          </button>
          <button
            className={`btn btn-xs btn-toggle ${automation.autoExport ? 'active' : ''}`}
            onClick={() => toggleAutomation('autoExport')}
            title="Auto-export approved backups"
          >
            Export
          </button>
          <button
            className={`btn btn-xs btn-toggle ${automation.ejectAfterBackup ? 'active' : ''}`}
            onClick={() => toggleAutomation('ejectAfterBackup')}
            title="Auto-eject disc after successful backup"
          >
            Eject
          </button>
          <span className="automation-separator"></span>
          <button
            className={`btn btn-xs btn-toggle btn-danger-toggle ${automation.liveDangerously ? 'active' : ''}`}
            onClick={() => toggleAutomation('liveDangerously')}
            title="Live Dangerously: Auto-approve ALL metadata regardless of confidence"
          >
            Live Dangerously
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

export default HomePage;
