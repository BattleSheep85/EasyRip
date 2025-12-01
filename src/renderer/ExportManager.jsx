// Export Manager Component - View and manage export queue
import React, { useState, useEffect } from 'react';

// TMDB Image base URL
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';

function ExportManager({ onClose }) {
  const [queue, setQueue] = useState([]);
  const [processing, setProcessing] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [exportProgress, setExportProgress] = useState(null);

  // Load queue status on mount
  useEffect(() => {
    loadQueueStatus();
    loadReadyBackups();

    // Listen for export progress
    if (window.electronAPI) {
      window.electronAPI.onExportProgress((data) => {
        setExportProgress(data);
        setProcessing(data.backupName);
      });

      window.electronAPI.onExportComplete((data) => {
        setExportProgress(null);
        loadQueueStatus();
        // Add to history
        setHistory(prev => [{
          name: data.name,
          success: data.success,
          error: data.error,
          timestamp: new Date().toLocaleString()
        }, ...prev.slice(0, 19)]);
      });

      window.electronAPI.onExportError((data) => {
        setExportProgress({
          backupName: data.name,
          percent: 0,
          stage: `Error: ${data.error}`,
          isError: true
        });
      });
    }

    // Periodic refresh
    const interval = setInterval(loadQueueStatus, 5000);
    return () => {
      clearInterval(interval);
      if (window.electronAPI) {
        window.electronAPI.removeExportListeners();
      }
    };
  }, []);

  async function loadQueueStatus() {
    if (!window.electronAPI) return;
    try {
      const result = await window.electronAPI.getExportQueueStatus();
      if (result.success) {
        setQueue(result.status.queue || []);
        setProcessing(result.status.processing);
      }
    } catch (err) {
      console.error('Failed to get export queue:', err);
    } finally {
      setLoading(false);
    }
  }

  // State for ready-to-export backups
  const [readyBackups, setReadyBackups] = useState([]);

  async function loadReadyBackups() {
    if (!window.electronAPI) return;
    try {
      const result = await window.electronAPI.getAllBackups();
      if (result.success) {
        // Filter for approved/manual status (ready to export)
        const ready = result.backups.filter(b =>
          b.status === 'approved' || b.status === 'manual'
        );
        setReadyBackups(ready);
      }
    } catch (err) {
      console.error('Failed to get backups:', err);
    }
  }

  async function handleQueueExport(backupName) {
    if (!window.electronAPI) return;
    try {
      const result = await window.electronAPI.queueExport(backupName);
      if (result.success) {
        loadQueueStatus();
        loadReadyBackups();
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleCancelExport(backupName) {
    if (!window.electronAPI) return;
    try {
      await window.electronAPI.cancelExport(backupName);
      loadQueueStatus();
    } catch (err) {
      setError(err.message);
    }
  }

  // Get poster URL
  function getPosterUrl(posterPath) {
    if (!posterPath) return null;
    return `${TMDB_IMAGE_BASE}/w92${posterPath}`;
  }

  // Check if backup is in queue or processing
  function isInQueue(backupName) {
    return processing === backupName || queue.includes(backupName);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Export Manager</h3>
          <div className="modal-header-actions">
            <button className="btn btn-sm" onClick={loadQueueStatus}>Refresh</button>
            <button className="modal-close" onClick={onClose}>X</button>
          </div>
        </div>

        <div className="modal-body export-manager-body">
          {error && (
            <div className="error-banner">
              <span>{error}</span>
              <button onClick={() => setError(null)}>X</button>
            </div>
          )}

          {/* Current Export Progress */}
          {exportProgress && (
            <div className={`export-current ${exportProgress.isError ? 'error' : ''}`}>
              <h4>Currently Exporting</h4>
              <div className="export-current-info">
                <span className="export-name">{exportProgress.backupName}</span>
                <span className="export-stage">{exportProgress.stage}</span>
              </div>
              <div className="export-progress-bar">
                <div
                  className={`export-progress-fill ${exportProgress.isError ? 'error' : ''}`}
                  style={{ width: `${exportProgress.percent || 0}%` }}
                ></div>
              </div>
              <span className="export-percent">{Math.round(exportProgress.percent || 0)}%</span>
            </div>
          )}

          {/* Export Queue */}
          <div className="export-section">
            <h4>Export Queue ({queue.length})</h4>
            {queue.length === 0 ? (
              <div className="export-empty">No items in queue</div>
            ) : (
              <div className="export-queue-list">
                {queue.map((name, idx) => (
                  <div key={name} className="export-queue-item">
                    <span className="queue-position">#{idx + 1}</span>
                    <span className="queue-name">{name}</span>
                    <button
                      className="btn btn-xs btn-danger"
                      onClick={() => handleCancelExport(name)}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Ready to Export */}
          <div className="export-section">
            <h4>Ready to Export ({readyBackups.length})</h4>
            {loading ? (
              <div className="export-empty">Loading...</div>
            ) : readyBackups.length === 0 ? (
              <div className="export-empty">No approved backups ready for export</div>
            ) : (
              <div className="export-ready-grid">
                {readyBackups.map(backup => (
                  <div key={backup.name} className="export-ready-item">
                    <div className="ready-poster">
                      {backup.posterPath ? (
                        <img
                          src={getPosterUrl(backup.posterPath)}
                          alt={backup.title || backup.name}
                        />
                      ) : (
                        <div className="no-poster-small">
                          {backup.type === 'bluray' ? 'BD' : 'DVD'}
                        </div>
                      )}
                    </div>
                    <div className="ready-info">
                      <div className="ready-title" title={backup.title || backup.name}>
                        {backup.title || backup.name}
                      </div>
                      {backup.year && <div className="ready-year">{backup.year}</div>}
                    </div>
                    <button
                      className="btn btn-xs btn-primary"
                      onClick={() => handleQueueExport(backup.name)}
                      disabled={isInQueue(backup.name)}
                    >
                      {isInQueue(backup.name) ? 'Queued' : 'Export'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Export History */}
          {history.length > 0 && (
            <div className="export-section">
              <h4>Recent Exports</h4>
              <div className="export-history-list">
                {history.map((item, idx) => (
                  <div
                    key={`${item.name}-${idx}`}
                    className={`export-history-item ${item.success ? 'success' : 'error'}`}
                  >
                    <span className="history-status">{item.success ? 'OK' : 'ERR'}</span>
                    <span className="history-name">{item.name}</span>
                    <span className="history-time">{item.timestamp}</span>
                    {item.error && <span className="history-error">{item.error}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <div className="footer-info">
            <small>
              {processing ? `Exporting: ${processing}` : 'Idle'} |
              {queue.length} queued | {readyBackups.length} ready
            </small>
          </div>
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

export default ExportManager;
