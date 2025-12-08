/**
 * ExportPage - Full-page export queue management
 * Uses ExportManager functionality without modal wrapper
 */

import React, { useState, useEffect } from 'react';

// TMDB Image base URL
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';

function ExportPage() {
  const [queue, setQueue] = useState([]);
  const [processing, setProcessing] = useState(null);
  const [parallelProcessing, setParallelProcessing] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [exportProgress, setExportProgress] = useState(null);
  const [seriesBatches, setSeriesBatches] = useState(null);
  const [waitingDiscs, setWaitingDiscs] = useState([]);
  const [readyBackups, setReadyBackups] = useState([]);

  // Load queue status on mount
  useEffect(() => {
    loadQueueStatus();
    loadReadyBackups();
    loadSeriesBatches();

    // Listen for export progress
    if (window.electronAPI) {
      window.electronAPI.onExportProgress((data) => {
        setExportProgress(data);
        setProcessing(data.backupName);
      });

      window.electronAPI.onExportComplete((data) => {
        setExportProgress(null);
        loadQueueStatus();
        loadSeriesBatches();
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

      window.electronAPI.onExportWaiting((data) => {
        setWaitingDiscs(prev => {
          if (prev.find(d => d.name === data.name)) return prev;
          return [...prev, data];
        });
      });
    }

    // Periodic refresh
    const interval = setInterval(() => {
      loadQueueStatus();
      loadSeriesBatches();
    }, 5000);

    return () => {
      clearInterval(interval);
      if (window.electronAPI) {
        window.electronAPI.removeExportListeners();
      }
    };
  }, []);

  async function loadQueueStatus() {
    if (!window.electronAPI) {
      setLoading(false);
      return;
    }
    try {
      const result = await window.electronAPI.getExportQueueStatus();
      if (result.success) {
        setQueue(result.status.queue || []);
        setProcessing(result.status.processing);
        setParallelProcessing(result.status.parallelProcessing || []);
      }
    } catch (err) {
      console.error('Failed to get export queue:', err);
    } finally {
      setLoading(false);
    }
  }

  async function loadSeriesBatches() {
    if (!window.electronAPI?.getSeriesBatchStatus) return;
    try {
      const result = await window.electronAPI.getSeriesBatchStatus();
      if (result.success && result.status) {
        setSeriesBatches(result.status);
      }
    } catch (err) {
      console.error('Failed to get series batches:', err);
    }
  }

  async function loadReadyBackups() {
    if (!window.electronAPI) return;
    try {
      const result = await window.electronAPI.getAllBackups();
      if (result.success) {
        const ready = result.backups.filter(b =>
          b.status === 'approved' || b.status === 'manual'
        );
        setReadyBackups(ready);
      }
    } catch (err) {
      console.error('Failed to get backups:', err);
    }
  }

  async function handleParallelExport(seriesKey) {
    if (!window.electronAPI?.triggerParallelExport) return;
    try {
      const result = await window.electronAPI.triggerParallelExport(seriesKey);
      if (!result.success) {
        setError(result.error);
      } else {
        loadQueueStatus();
        loadSeriesBatches();
      }
    } catch (err) {
      setError(err.message);
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

  async function handleOpenExportFolder() {
    if (!window.electronAPI) return;
    try {
      await window.electronAPI.openExportDirectory();
    } catch (err) {
      console.error('Failed to open export folder:', err);
    }
  }

  function getPosterUrl(posterPath) {
    if (!posterPath) return null;
    return `${TMDB_IMAGE_BASE}/w92${posterPath}`;
  }

  function isInQueue(backupName) {
    return processing === backupName || queue.includes(backupName);
  }

  return (
    <div className="page export-page">
      <div className="page-header">
        <h2>Export Manager</h2>
        <div className="page-header-actions">
          <button className="btn btn-sm" onClick={handleOpenExportFolder}>
            Open Export Folder
          </button>
          <button className="btn btn-sm" onClick={loadQueueStatus}>
            Refresh
          </button>
        </div>
      </div>

      <div className="page-content export-manager-body">
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
          <h4>Export Queue ({queue.length}){parallelProcessing.length > 0 && ` + ${parallelProcessing.length} parallel`}</h4>
          {queue.length === 0 && parallelProcessing.length === 0 ? (
            <div className="export-empty">No items in queue</div>
          ) : (
            <div className="export-queue-list">
              {parallelProcessing.map((name) => (
                <div key={name} className="export-queue-item parallel">
                  <span className="queue-position">||</span>
                  <span className="queue-name">{name}</span>
                  <span className="queue-badge">Parallel</span>
                </div>
              ))}
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

        {/* TV Series Batches */}
        {seriesBatches && Object.keys(seriesBatches).length > 0 && (
          <div className="export-section">
            <h4>TV Series Batches</h4>
            <div className="series-batch-list">
              {Object.entries(seriesBatches).map(([seriesKey, data]) => (
                <div key={seriesKey} className="series-batch-item">
                  <div className="series-batch-header">
                    <div className="series-batch-title">
                      <strong>{data.showTitle}</strong>
                      {data.showYear && <span className="series-year"> ({data.showYear})</span>}
                    </div>
                    {data.processable.length > 1 && (
                      <button
                        className="btn btn-xs btn-primary"
                        onClick={() => handleParallelExport(seriesKey)}
                        disabled={parallelProcessing.length > 0}
                      >
                        Export {data.processable.length} Discs
                      </button>
                    )}
                  </div>
                  <div className="series-batch-discs">
                    {data.processable.map(disc => (
                      <div key={disc.name} className="series-disc ready">
                        <span className="disc-icon">D{disc.discNum}</span>
                        <span className="disc-name">{disc.name}</span>
                        <span className="disc-status">Ready</span>
                      </div>
                    ))}
                    {data.waiting.map(disc => (
                      <div key={disc.name} className="series-disc waiting">
                        <span className="disc-icon">D{disc.discNum}</span>
                        <span className="disc-name">{disc.name}</span>
                        <span className="disc-status" title={disc.reason}>
                          Waiting for D{disc.missingDiscs?.join(', D')}
                        </span>
                      </div>
                    ))}
                  </div>
                  {data.gaps.length > 0 && (
                    <div className="series-batch-gaps">
                      <span className="gap-label">Missing discs: </span>
                      <span className="gap-list">
                        {data.gaps.map(d => `D${d}`).join(', ')}
                      </span>
                    </div>
                  )}
                  {data.lastExported && (
                    <div className="series-batch-progress">
                      Last exported: S{data.lastExported.season} E{data.lastExported.episode}
                      {data.lastExported.disc && ` (Disc ${data.lastExported.disc})`}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

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

        {/* Footer Stats */}
        <div className="export-footer-stats">
          <small>
            {processing ? `Exporting: ${processing}` : 'Idle'} |
            {queue.length} queued | {readyBackups.length} ready
          </small>
        </div>
      </div>
    </div>
  );
}

export default ExportPage;
