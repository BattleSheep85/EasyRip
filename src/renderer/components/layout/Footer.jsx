/**
 * Footer Component - App footer with paths and export status
 */

import React from 'react';
import { useSettings } from '../../context/SettingsContext.jsx';

function Footer({ exportStatus, exportQueue }) {
  const { settings } = useSettings();

  return (
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
      {!exportStatus && exportQueue?.queueLength > 0 && (
        <div className="footer-export-queue">
          <span>Export Queue: {exportQueue.queueLength} pending</span>
        </div>
      )}

      <span>
        Temp: {settings.basePath}\temp{' '}
        <span className="footer-sep">•</span>{' '}
        Backup: {settings.basePath}\backup
      </span>
    </footer>
  );
}

export default Footer;
