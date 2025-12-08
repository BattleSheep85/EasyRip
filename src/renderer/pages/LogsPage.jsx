/**
 * LogsPage - Full-page system logs viewer
 */

import React, { useState, useEffect, useRef } from 'react';

function LogsPage() {
  const [logs, setLogs] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const logEndRef = useRef(null);
  const intervalRef = useRef(null);

  async function loadLogs() {
    if (!window.electronAPI) {
      setLoading(false);
      return;
    }

    try {
      const result = await window.electronAPI.getLogs(500);
      if (result.success) {
        setLogs(result.content);
        setError(null);
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadLogs();
  }, []);

  // Auto-refresh
  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(loadLogs, 5000);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [autoRefresh]);

  // Scroll to bottom when logs update
  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  async function handleOpenLogDir() {
    if (!window.electronAPI) return;
    try {
      await window.electronAPI.openLogDirectory();
    } catch (err) {
      console.error('Failed to open log directory:', err);
    }
  }

  async function handleClearLogs() {
    if (!window.electronAPI) return;
    if (!confirm('Are you sure you want to clear all logs?')) return;

    try {
      await window.electronAPI.clearLogs();
      setLogs('');
    } catch (err) {
      console.error('Failed to clear logs:', err);
    }
  }

  return (
    <div className="page logs-page">
      <div className="page-header">
        <h2>System Logs</h2>
        <div className="page-header-actions">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={e => setAutoRefresh(e.target.checked)}
            />
            Auto-refresh
          </label>
          <button className="btn btn-sm" onClick={loadLogs}>
            Refresh
          </button>
          <button className="btn btn-sm" onClick={handleOpenLogDir}>
            Open Log Folder
          </button>
          <button
            className="btn btn-sm btn-warning"
            onClick={handleClearLogs}
            disabled={!logs || logs.trim() === ''}
            title={!logs || logs.trim() === '' ? 'No logs to clear' : 'Clear all logs'}
          >
            Clear Logs
          </button>
        </div>
      </div>

      <div className="page-content logs-content">
        {loading ? (
          <div className="loading-state">Loading logs...</div>
        ) : error ? (
          <div className="error-state">{error}</div>
        ) : !logs ? (
          <div className="empty-state">No logs available</div>
        ) : (
          <pre className="system-log-content">
            {logs}
            <div ref={logEndRef} />
          </pre>
        )}
      </div>
    </div>
  );
}

export default LogsPage;
