// Metadata Editor Component - Edit/approve individual backup metadata
import React, { useState, useEffect } from 'react';

// TMDB Image base URL
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';

function MetadataEditor({ backupName, onClose, onSave, onSearchTMDB }) {
  const [metadata, setMetadata] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [editedData, setEditedData] = useState({
    title: '',
    year: '',
  });

  // Load metadata on mount
  useEffect(() => {
    loadMetadata();
  }, [backupName]);

  async function loadMetadata() {
    if (!window.electronAPI) return;
    setLoading(true);
    setError(null);

    try {
      const result = await window.electronAPI.getBackupMetadata(backupName);
      if (result.success && result.metadata) {
        setMetadata(result.metadata);
        setEditedData({
          title: result.metadata.final?.title || result.metadata.llmGuess?.title || '',
          year: result.metadata.final?.year || result.metadata.llmGuess?.year || '',
        });
      } else {
        setMetadata(null);
        setEditedData({ title: '', year: '' });
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleApprove() {
    if (!window.electronAPI) return;
    setSaving(true);
    try {
      const result = await window.electronAPI.approveMetadata(backupName);
      if (result.success) {
        onSave?.();
        onClose();
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveManual() {
    if (!window.electronAPI) return;
    setSaving(true);
    try {
      const updates = {
        final: {
          title: editedData.title,
          year: parseInt(editedData.year, 10) || null,
        },
        status: 'manual',
      };
      const result = await window.electronAPI.updateMetadata(backupName, updates);
      if (result.success) {
        onSave?.();
        onClose();
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleSelectCandidate(candidate) {
    if (!window.electronAPI) return;
    setSaving(true);
    try {
      const result = await window.electronAPI.selectTMDBCandidate(
        backupName,
        candidate.id,
        candidate.mediaType
      );
      if (result.success) {
        // Reload metadata to show updated info
        loadMetadata();
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleReidentify() {
    if (!window.electronAPI) return;
    try {
      const result = await window.electronAPI.reidentifyBackup(backupName);
      if (result.success) {
        // Close and let the watcher handle it
        onClose();
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError(err.message);
    }
  }

  // Get poster URL
  function getPosterUrl(posterPath, size = 'w342') {
    if (!posterPath) return null;
    return `${TMDB_IMAGE_BASE}/${size}${posterPath}`;
  }

  // Format duration
  function formatDuration(seconds) {
    if (!seconds) return 'Unknown';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  }

  if (loading) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal modal-md" onClick={e => e.stopPropagation()}>
          <div className="modal-header">
            <h3>Loading...</h3>
            <button className="modal-close" onClick={onClose}>X</button>
          </div>
          <div className="modal-body">
            <div className="loading-indicator">Loading metadata for {backupName}...</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Edit Metadata: {backupName}</h3>
          <button className="modal-close" onClick={onClose}>X</button>
        </div>

        <div className="modal-body metadata-editor-body">
          {error && (
            <div className="error-banner">
              <span>{error}</span>
              <button onClick={() => setError(null)}>X</button>
            </div>
          )}

          <div className="editor-layout">
            {/* Left: Poster and current info */}
            <div className="editor-poster-section">
              {metadata?.tmdb?.posterPath ? (
                <img
                  src={getPosterUrl(metadata.tmdb.posterPath)}
                  alt={metadata.final?.title || backupName}
                  className="editor-poster"
                />
              ) : (
                <div className="editor-poster no-poster">
                  <span className="disc-icon-large">
                    {metadata?.disc?.type === 'bluray' ? 'BD' : 'DVD'}
                  </span>
                </div>
              )}

              {/* Disc Info */}
              <div className="disc-info">
                <div className="info-row">
                  <span className="label">Volume Label:</span>
                  <span className="value">{metadata?.disc?.volumeLabel || backupName}</span>
                </div>
                <div className="info-row">
                  <span className="label">Type:</span>
                  <span className="value">{metadata?.disc?.type?.toUpperCase() || 'Unknown'}</span>
                </div>
                <div className="info-row">
                  <span className="label">Main Feature:</span>
                  <span className="value">{formatDuration(metadata?.disc?.mainFeatureDuration)}</span>
                </div>
                <div className="info-row">
                  <span className="label">Titles:</span>
                  <span className="value">{metadata?.disc?.titleCount || 0}</span>
                </div>
              </div>
            </div>

            {/* Right: Edit form and candidates */}
            <div className="editor-form-section">
              {/* LLM Guess */}
              {metadata?.llmGuess && (
                <div className="llm-guess-section">
                  <h4>AI Identification</h4>
                  <div className="llm-guess">
                    <div className="guess-title">
                      {metadata.llmGuess.title || 'Unknown'}
                      {metadata.llmGuess.year && ` (${metadata.llmGuess.year})`}
                    </div>
                    <div className="guess-confidence">
                      Confidence: {Math.round((metadata.llmGuess.confidence || 0) * 100)}%
                    </div>
                    {metadata.llmGuess.reasoning && (
                      <div className="guess-reasoning">{metadata.llmGuess.reasoning}</div>
                    )}
                  </div>
                </div>
              )}

              {/* Manual Edit */}
              <div className="manual-edit-section">
                <h4>Title Information</h4>
                <div className="form-group">
                  <label>Title:</label>
                  <input
                    type="text"
                    value={editedData.title}
                    onChange={e => setEditedData({ ...editedData, title: e.target.value })}
                    placeholder="Movie or TV Show title"
                  />
                </div>
                <div className="form-group">
                  <label>Year:</label>
                  <input
                    type="number"
                    value={editedData.year}
                    onChange={e => setEditedData({ ...editedData, year: e.target.value })}
                    placeholder="Release year"
                    min="1900"
                    max="2099"
                  />
                </div>
                <div className="form-actions">
                  <button
                    className="btn btn-sm"
                    onClick={() => onSearchTMDB(editedData.title, editedData.year, handleSelectCandidate)}
                  >
                    Search TMDB
                  </button>
                </div>
              </div>

              {/* TMDB Match */}
              {metadata?.tmdb && (
                <div className="tmdb-match-section">
                  <h4>TMDB Match</h4>
                  <div className="tmdb-match">
                    <div className="match-title">
                      {metadata.tmdb.title}
                      {metadata.tmdb.year && ` (${metadata.tmdb.year})`}
                    </div>
                    <div className="match-type">
                      Type: {metadata.tmdb.mediaType === 'tv' ? 'TV Show' : 'Movie'}
                    </div>
                    {metadata.tmdb.overview && (
                      <div className="match-overview">{metadata.tmdb.overview}</div>
                    )}
                  </div>
                </div>
              )}

              {/* TMDB Candidates */}
              {metadata?.tmdbCandidates && metadata.tmdbCandidates.length > 1 && (
                <div className="candidates-section">
                  <h4>Other Matches</h4>
                  <div className="candidates-list">
                    {metadata.tmdbCandidates.slice(1, 5).map(candidate => (
                      <div key={candidate.id} className="candidate-item">
                        <div className="candidate-info">
                          <span className="candidate-title">{candidate.title}</span>
                          {candidate.year && <span className="candidate-year">({candidate.year})</span>}
                          <span className="candidate-type">{candidate.mediaType}</span>
                        </div>
                        <button
                          className="btn btn-xs"
                          onClick={() => handleSelectCandidate(candidate)}
                          disabled={saving}
                        >
                          Select
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <div className="footer-left">
            <button
              className="btn btn-sm"
              onClick={handleReidentify}
              title="Re-run AI identification"
            >
              Re-identify
            </button>
          </div>
          <div className="footer-right">
            <button className="btn" onClick={onClose}>Cancel</button>
            <button
              className="btn btn-warning"
              onClick={handleSaveManual}
              disabled={saving || !editedData.title}
            >
              Save Manual
            </button>
            {metadata?.status === 'pending' && (
              <button
                className="btn btn-success"
                onClick={handleApprove}
                disabled={saving}
              >
                Approve
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default MetadataEditor;
