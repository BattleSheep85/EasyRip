/**
 * PartialBackupWarning Component - Display warning for partial backups with recovery errors
 */

import React from 'react';
import { formatSize } from '../../../shared/utils.js';

export function PartialBackupWarning({ driveState, discName, discSize, onKeep, onDelete, onRetry }) {
  if (!driveState || driveState.status !== 'partial_success') {
    return null;
  }

  const {
    filesFailed = 0,
    filesSuccessful = 0,
    percentRecovered = 0,
    errorsEncountered = [],
    backupSize = 0
  } = driveState;

  const totalFiles = filesSuccessful + filesFailed;

  return (
    <div className="partial-backup-warning">
      <div className="partial-warning-header">
        <span className="warning-icon">⚠</span>
        <h3>Backup Completed with Errors</h3>
      </div>

      <div className="partial-warning-body">
        <p className="warning-summary">
          The disc had {filesFailed} file{filesFailed !== 1 ? 's' : ''} with read/hash errors.
          {filesSuccessful > 0 && ` Successfully recovered ${filesSuccessful} of ${totalFiles} files.`}
        </p>

        <div className="recovery-stats">
          <div className="stat-item">
            <span className="stat-label">Recovery Rate:</span>
            <span className="stat-value">{percentRecovered.toFixed(1)}%</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Backup Size:</span>
            <span className="stat-value">{formatSize(backupSize)}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Disc Size:</span>
            <span className="stat-value">{formatSize(discSize)}</span>
          </div>
        </div>

        {errorsEncountered.length > 0 && (
          <details className="error-details">
            <summary>Error Details ({errorsEncountered.length} error{errorsEncountered.length !== 1 ? 's' : ''})</summary>
            <ul className="error-list">
              {errorsEncountered.slice(0, 10).map((error, idx) => (
                <li key={idx}>
                  <span className="error-file">{error.file || 'Unknown file'}</span>
                  <span className="error-type"> - {error.error || 'Unknown error'}</span>
                </li>
              ))}
              {errorsEncountered.length > 10 && (
                <li className="error-more">
                  ...and {errorsEncountered.length - 10} more error{errorsEncountered.length - 10 !== 1 ? 's' : ''}
                </li>
              )}
            </ul>
          </details>
        )}

        <div className="warning-explanation">
          <p>
            <strong>What happened?</strong> The disc had bad sectors or scratches preventing some files from being read correctly.
            MakeMKV recovered as much as possible.
          </p>
          <p>
            <strong>What should I do?</strong>
          </p>
          <ul>
            <li><strong>Keep:</strong> Use the partial backup (may have playback issues in affected scenes)</li>
            <li><strong>Delete:</strong> Discard this backup and clean the disc before retrying</li>
            <li><strong>Retry with Compatibility Mode:</strong> Use slower, more aggressive error recovery settings</li>
          </ul>
        </div>
      </div>

      <div className="partial-warning-actions">
        <button
          className="btn btn-primary"
          onClick={onKeep}
          title="Keep the partial backup despite errors"
        >
          Keep Backup
        </button>
        <button
          className="btn btn-secondary"
          onClick={onRetry}
          title="Delete and retry with Compatibility Mode settings"
        >
          Retry with Compatibility Mode
        </button>
        <button
          className="btn btn-danger"
          onClick={onDelete}
          title="Delete the partial backup"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

export default PartialBackupWarning;
