/**
 * PathSettings - Base path configuration
 */

import React from 'react';
import { useSettings } from '../../context/SettingsContext.jsx';

function PathSettings() {
  const { editedSettings, setEditedSettings } = useSettings();

  return (
    <div className="settings-tab">
      <h2>Path Settings</h2>

      <section className="settings-section">
        <h3>Output Paths</h3>

        <div className="form-group">
          <label>Base Output Path</label>
          <input
            type="text"
            value={editedSettings?.basePath || ''}
            onChange={e => setEditedSettings({ ...editedSettings, basePath: e.target.value })}
            placeholder="D:\EasyRip"
          />
          <small>Root folder for all EasyRip data</small>
        </div>

        <div className="path-preview">
          <div className="path-preview-item">
            <span className="path-label">Temp Folder:</span>
            <code>{editedSettings?.basePath || 'D:\\EasyRip'}\\temp</code>
          </div>
          <div className="path-preview-item">
            <span className="path-label">Backup Folder:</span>
            <code>{editedSettings?.basePath || 'D:\\EasyRip'}\\backup</code>
          </div>
          <div className="path-preview-item">
            <span className="path-label">Export Folder:</span>
            <code>{editedSettings?.basePath || 'D:\\EasyRip'}\\export</code>
          </div>
        </div>
      </section>
    </div>
  );
}

export default PathSettings;
