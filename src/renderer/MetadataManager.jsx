// Metadata Manager Component - Grid view of backups with metadata
import React, { useState, useEffect, useCallback } from 'react';

// TMDB Image base URL
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';

function MetadataManager({ onClose, onEdit, refreshKey = 0 }) {
  const [backups, setBackups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [ollamaStatus, setOllamaStatus] = useState(null);
  const [queueStatus, setQueueStatus] = useState(null);
  const [exportQueueStatus, setExportQueueStatus] = useState(null);
  const [progressInfo, setProgressInfo] = useState(null);
  const [filter, setFilter] = useState('all'); // all, pending, approved, exported, error
  const [confirmDelete, setConfirmDelete] = useState(null); // backup name to confirm deletion

  // Load backups on mount and when refreshKey changes
  useEffect(() => {
    loadBackups();
    loadOllamaStatus();
    loadQueueStatus();
    loadExportQueueStatus();

    // Listen for metadata updates
    if (window.electronAPI) {
      window.electronAPI.onMetadataPending((data) => {
        // Reload when new metadata is available
        loadBackups();
      });

      window.electronAPI.onOllamaProgress((data) => {
        setProgressInfo(data);
      });

      // Listen for export completion to refresh
      window.electronAPI.onExportComplete((data) => {
        loadBackups();
        loadExportQueueStatus();
      });
    }

    return () => {
      if (window.electronAPI) {
        window.electronAPI.removeMetadataListeners();
        window.electronAPI.removeExportListeners();
      }
    };
  }, [refreshKey]);

  // Periodic queue status refresh
  useEffect(() => {
    const interval = setInterval(() => {
      loadQueueStatus();
      loadExportQueueStatus();
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  async function loadBackups() {
    if (!window.electronAPI) return;
    setLoading(true);
    try {
      const result = await window.electronAPI.getAllBackups();
      if (result.success) {
        setBackups(result.backups);
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadOllamaStatus() {
    if (!window.electronAPI) return;
    try {
      const result = await window.electronAPI.getOllamaStatus();
      if (result.success) {
        setOllamaStatus(result.status);
      }
    } catch (err) {
      console.error('Failed to get Ollama status:', err);
    }
  }

  async function loadQueueStatus() {
    if (!window.electronAPI) return;
    try {
      const result = await window.electronAPI.getMetadataQueue();
      if (result.success) {
        setQueueStatus(result.queue);
      }
    } catch (err) {
      console.error('Failed to get queue status:', err);
    }
  }

  async function loadExportQueueStatus() {
    if (!window.electronAPI) return;
    try {
      const result = await window.electronAPI.getExportQueueStatus();
      if (result.success) {
        setExportQueueStatus(result.status);
      }
    } catch (err) {
      console.error('Failed to get export queue status:', err);
    }
  }

  async function handleScanBackups() {
    if (!window.electronAPI) return;
    try {
      const result = await window.electronAPI.scanBackups();
      if (result.success) {
        loadBackups();
        loadQueueStatus();
      }
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleReidentify(backupName) {
    if (!window.electronAPI) return;
    try {
      const result = await window.electronAPI.reidentifyBackup(backupName);
      if (result.success) {
        loadQueueStatus();
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleApprove(backupName) {
    if (!window.electronAPI) return;
    try {
      const result = await window.electronAPI.approveMetadata(backupName);
      if (result.success) {
        loadBackups();
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleExport(backupName) {
    if (!window.electronAPI) return;
    try {
      const result = await window.electronAPI.queueExport(backupName);
      if (result.success) {
        loadExportQueueStatus();
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDelete(backupName) {
    if (!window.electronAPI) return;
    try {
      const result = await window.electronAPI.deleteBackup(backupName);
      if (result.success) {
        setConfirmDelete(null);
        loadBackups();
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleInstallOllama() {
    if (!window.electronAPI) return;
    try {
      setProgressInfo({ stage: 'Installing', percent: 0, message: 'Starting Ollama installation...' });
      const result = await window.electronAPI.installOllama();
      if (result.success) {
        loadOllamaStatus();
      } else {
        setError('Failed to install Ollama');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setProgressInfo(null);
    }
  }

  async function handleStartOllama() {
    if (!window.electronAPI) return;
    try {
      const result = await window.electronAPI.startOllama();
      if (result.success) {
        loadOllamaStatus();
      } else {
        setError('Failed to start Ollama');
      }
    } catch (err) {
      setError(err.message);
    }
  }

  // Get poster URL from TMDB path
  function getPosterUrl(posterPath) {
    if (!posterPath) return null;
    return `${TMDB_IMAGE_BASE}/w185${posterPath}`;
  }

  // Get status badge style
  function getStatusClass(status) {
    switch (status) {
      case 'approved': return 'metadata-status approved';
      case 'pending': return 'metadata-status pending';
      case 'manual': return 'metadata-status manual';
      case 'exported': return 'metadata-status exported';
      case 'error': return 'metadata-status error';
      default: return 'metadata-status unknown';
    }
  }

  // Get status display text
  function getStatusText(status) {
    switch (status) {
      case 'approved': return 'Approved';
      case 'pending': return 'Pending';
      case 'manual': return 'Manual';
      case 'exported': return 'Exported';
      case 'error': return 'Error';
      default: return 'No Metadata';
    }
  }

  // Check if backup is in export queue
  function isInExportQueue(backupName) {
    if (!exportQueueStatus) return false;
    return exportQueueStatus.processing === backupName ||
           exportQueueStatus.queue?.includes(backupName);
  }

  // Filter backups
  const filteredBackups = backups.filter(backup => {
    if (filter === 'all') return true;
    if (filter === 'none') return !backup.hasMetadata;
    if (filter === 'approved') return backup.status === 'approved' || backup.status === 'manual';
    return backup.status === filter;
  });

  // Count by status
  const counts = {
    all: backups.length,
    pending: backups.filter(b => b.status === 'pending').length,
    approved: backups.filter(b => b.status === 'approved' || b.status === 'manual').length,
    exported: backups.filter(b => b.status === 'exported').length,
    error: backups.filter(b => b.status === 'error' || !b.hasMetadata).length,
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-xl" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Metadata Manager</h3>
          <div className="modal-header-actions">
            <button className="btn btn-sm" onClick={handleScanBackups} title="Scan for new backups">
              Scan
            </button>
            <button className="btn btn-sm" onClick={loadBackups} title="Refresh list">
              Refresh
            </button>
            <button className="modal-close" onClick={onClose}>X</button>
          </div>
        </div>

        <div className="modal-body metadata-manager-body">
          {/* Status Bar */}
          <div className="metadata-status-bar">
            <div className="status-info">
              <span className="status-item">
                <strong>Ollama:</strong>{' '}
                {ollamaStatus ? (
                  ollamaStatus.running ? (
                    <span className="status-ok">Running</span>
                  ) : ollamaStatus.installed ? (
                    <span className="status-warn">
                      Stopped{' '}
                      <button className="btn btn-xs" onClick={handleStartOllama}>Start</button>
                    </span>
                  ) : (
                    <span className="status-error">
                      Not Installed{' '}
                      <button className="btn btn-xs" onClick={handleInstallOllama}>Install</button>
                    </span>
                  )
                ) : (
                  <span className="status-unknown">Checking...</span>
                )}
              </span>
              {queueStatus && queueStatus.queueLength > 0 && (
                <span className="status-item">
                  <strong>ID Queue:</strong> {queueStatus.queueLength} pending
                  {queueStatus.processing && (
                    <span className="processing-name"> (processing: {queueStatus.processing})</span>
                  )}
                </span>
              )}
              {exportQueueStatus && (exportQueueStatus.queueLength > 0 || exportQueueStatus.processing) && (
                <span className="status-item export-queue">
                  <strong>Export:</strong>{' '}
                  {exportQueueStatus.processing ? (
                    <span className="status-exporting">Exporting: {exportQueueStatus.processing}</span>
                  ) : (
                    <span>{exportQueueStatus.queueLength} queued</span>
                  )}
                </span>
              )}
            </div>

            {/* Progress indicator */}
            {progressInfo && (
              <div className="progress-indicator">
                <span className="progress-stage">{progressInfo.stage}:</span>
                <div className="progress-bar-mini">
                  <div
                    className="progress-fill-mini"
                    style={{ width: `${progressInfo.percent}%` }}
                  ></div>
                </div>
                <span className="progress-message">{progressInfo.message}</span>
              </div>
            )}
          </div>

          {/* Error Banner */}
          {error && (
            <div className="error-banner">
              <span>{error}</span>
              <button onClick={() => setError(null)}>X</button>
            </div>
          )}

          {/* Filter Tabs */}
          <div className="metadata-filters">
            <button
              className={`filter-btn ${filter === 'all' ? 'active' : ''}`}
              onClick={() => setFilter('all')}
            >
              All ({counts.all})
            </button>
            <button
              className={`filter-btn ${filter === 'pending' ? 'active' : ''}`}
              onClick={() => setFilter('pending')}
            >
              Pending ({counts.pending})
            </button>
            <button
              className={`filter-btn ${filter === 'approved' ? 'active' : ''}`}
              onClick={() => setFilter('approved')}
            >
              Ready ({counts.approved})
            </button>
            <button
              className={`filter-btn ${filter === 'exported' ? 'active' : ''}`}
              onClick={() => setFilter('exported')}
            >
              Exported ({counts.exported})
            </button>
            <button
              className={`filter-btn ${filter === 'error' ? 'active' : ''}`}
              onClick={() => setFilter('error')}
            >
              Needs Attention ({counts.error})
            </button>
          </div>

          {/* Backups Grid */}
          {loading ? (
            <div className="loading-indicator">Loading backups...</div>
          ) : filteredBackups.length === 0 ? (
            <div className="no-backups">
              {filter === 'all'
                ? 'No backups found. Complete some disc backups first.'
                : `No backups with status "${filter}".`}
            </div>
          ) : (
            <div className="metadata-grid">
              {filteredBackups.map(backup => (
                <div key={backup.name} className="metadata-card">
                  {/* Poster */}
                  <div className="card-poster">
                    {backup.posterPath ? (
                      <img
                        src={getPosterUrl(backup.posterPath)}
                        alt={backup.title || backup.name}
                        onError={(e) => { e.target.style.display = 'none'; }}
                      />
                    ) : (
                      <div className="no-poster">
                        <span className="disc-icon">{backup.type === 'bluray' ? 'BD' : 'DVD'}</span>
                      </div>
                    )}
                    <span className={getStatusClass(backup.status)}>
                      {getStatusText(backup.status)}
                    </span>
                  </div>

                  {/* Info */}
                  <div className="card-info">
                    <div className="card-title" title={backup.title || backup.name}>
                      {backup.title || backup.name}
                    </div>
                    {backup.year && (
                      <div className="card-year">{backup.year}</div>
                    )}
                    <div className="card-folder" title={backup.name}>
                      {backup.name}
                    </div>
                    {backup.confidence && (
                      <div className="card-confidence">
                        Confidence: {Math.round(backup.confidence * 100)}%
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="card-actions">
                    {backup.status === 'pending' && (
                      <button
                        className="btn btn-xs btn-success"
                        onClick={() => handleApprove(backup.name)}
                        title="Approve this identification"
                      >
                        Approve
                      </button>
                    )}
                    {(backup.status === 'approved' || backup.status === 'manual') && (
                      <button
                        className="btn btn-xs btn-primary"
                        onClick={() => handleExport(backup.name)}
                        disabled={isInExportQueue(backup.name)}
                        title={isInExportQueue(backup.name) ? 'Already in export queue' : 'Export to library'}
                      >
                        {isInExportQueue(backup.name) ? 'Queued' : 'Export'}
                      </button>
                    )}
                    {backup.status === 'exported' && (
                      <button
                        className="btn btn-xs btn-warning"
                        onClick={() => handleExport(backup.name)}
                        disabled={isInExportQueue(backup.name)}
                        title={isInExportQueue(backup.name) ? 'Already in export queue' : 'Re-export to library'}
                      >
                        {isInExportQueue(backup.name) ? 'Queued' : 'Re-Export'}
                      </button>
                    )}
                    <button
                      className="btn btn-xs"
                      onClick={() => onEdit(backup.name)}
                      title="Edit metadata"
                    >
                      Edit
                    </button>
                    <button
                      className="btn btn-xs"
                      onClick={() => handleReidentify(backup.name)}
                      title="Re-run identification"
                    >
                      Re-ID
                    </button>
                    <button
                      className="btn btn-xs btn-danger"
                      onClick={() => setConfirmDelete(backup.name)}
                      title="Delete backup"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <div className="footer-info">
            <small>
              {backups.length} backup(s) | {counts.pending} pending review | {counts.approved} approved
            </small>
          </div>
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      {confirmDelete && (
        <div className="modal-overlay confirm-overlay" onClick={() => setConfirmDelete(null)}>
          <div className="modal modal-sm confirm-dialog" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Confirm Delete</h3>
              <button className="modal-close" onClick={() => setConfirmDelete(null)}>X</button>
            </div>
            <div className="modal-body">
              <p>Are you sure you want to delete this backup?</p>
              <p className="confirm-name">{confirmDelete}</p>
              <p className="confirm-warning">This will permanently delete all backup files and cannot be undone.</p>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={() => handleDelete(confirmDelete)}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default MetadataManager;
