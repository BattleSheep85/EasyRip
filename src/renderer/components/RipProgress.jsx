// RipProgress Component - Shows backup progress with progress bar
import React from 'react';

function RipProgress({ progress, onCancel }) {
  const percent = progress.percent || 0;

  return (
    <section className="section progress-section">
      <h2>⏳ Backup in Progress</h2>

      <div className="progress-container">
        <div className="progress-bar">
          <div
            className="progress-fill"
            style={{ width: `${percent}%` }}
          />
        </div>
        <div className="progress-text">
          {percent.toFixed(1)}%
        </div>
      </div>

      <div className="progress-details">
        {progress.current && progress.max && (
          <p>
            {formatBytes(progress.current)} / {formatBytes(progress.max)}
          </p>
        )}
      </div>

      <button onClick={onCancel} className="btn btn-danger">
        ❌ Cancel Backup
      </button>

      <div className="progress-warning">
        <p>⚠️ Do not eject the disc or close the application while backup is in progress</p>
      </div>
    </section>
  );
}

// Helper function to format bytes into human-readable format
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export default RipProgress;
