/**
 * HomePage - Drives view (main backup functionality)
 * Uses DriveContext for persistent state across navigation
 */

import React, { useState, useEffect, useRef } from 'react';
import { formatSize } from '../../shared/utils.js';
import { useAutomation } from '../context/AutomationContext.jsx';
import { useDrives } from '../context/DriveContext.jsx';

function HomePage() {
  const { automation, toggleAutomation } = useAutomation();
  const {
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
    clearError,
  } = useDrives();

  const logEndRef = useRef(null);

  // Confirmation dialog state for Re-Do
  const [confirmRedo, setConfirmRedo] = useState(null);

  // Auto-scroll logs
  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [driveLogs, activeLogTab]);

  // Re-do click handler
  function handleRedoClick(drive) {
    if (automation.liveDangerously) {
      redoBackup(drive);
    } else {
      setConfirmRedo({ drive });
    }
  }

  function handleConfirmRedo() {
    if (!confirmRedo) return;
    const drive = confirmRedo.drive;
    setConfirmRedo(null);
    redoBackup(drive);
  }

  // Backup all eligible drives
  function handleBackupAll() {
    const eligibleDrives = drives.filter(d => {
      const state = driveStates[d.id];
      return !state || state.status === 'idle' || state.status === 'error' || state.status === 'incomplete';
    });

    eligibleDrives.forEach(drive => {
      startBackup(drive);
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
          <button onClick={clearError}>X</button>
        </div>
      )}

      {/* Toolbar */}
      <div className="toolbar">
        <button
          onClick={scanDrives}
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
                            onClick={() => cancelBackup(drive.id)}
                            className="btn btn-sm btn-danger"
                          >
                            Cancel
                          </button>
                        ) : state.status === 'queued' ? (
                          <button
                            onClick={() => cancelBackup(drive.id)}
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
                            onClick={() => startBackup(drive)}
                            className="btn btn-sm btn-warning"
                            title="Incomplete backup - will delete and restart"
                          >
                            Retry
                          </button>
                        ) : (
                          <button
                            onClick={() => startBackup(drive)}
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
