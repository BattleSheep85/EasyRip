/**
 * GeneralSettings - MakeMKV and TMDB configuration
 */

import React, { useState } from 'react';
import { useSettings } from '../../context/SettingsContext.jsx';
import { useToast } from '../common/Toast.jsx';

function GeneralSettings() {
  const { editedSettings, setEditedSettings } = useSettings();
  const toast = useToast();
  const [fetchingKey, setFetchingKey] = useState(false);

  const handleFetchKey = async () => {
    if (!window.electronAPI) return;
    setFetchingKey(true);
    try {
      const result = await window.electronAPI.fetchMakeMKVKey();
      if (result.success) {
        setEditedSettings({ ...editedSettings, makemkvKey: result.key });
        toast.success('Beta key fetched successfully!');
      } else {
        toast.error('Failed to fetch key: ' + result.error);
      }
    } catch (err) {
      toast.error('Error fetching key: ' + err.message);
    }
    setFetchingKey(false);
  };

  return (
    <div className="settings-tab">
      <h2>General Settings</h2>

      <section className="settings-section">
        <h3>MakeMKV Configuration</h3>

        <div className="form-group">
          <label>MakeMKV Path</label>
          <input
            type="text"
            value={editedSettings?.makemkvPath || ''}
            onChange={e => setEditedSettings({ ...editedSettings, makemkvPath: e.target.value })}
            placeholder="C:\Program Files (x86)\MakeMKV\makemkvcon64.exe"
          />
          <small>Path to the MakeMKV command-line executable</small>
        </div>

        <div className="form-group">
          <label>Beta Registration Key</label>
          <div className="input-with-button">
            <input
              type="text"
              value={editedSettings?.makemkvKey || ''}
              onChange={e => setEditedSettings({ ...editedSettings, makemkvKey: e.target.value })}
              placeholder="T-xxxxxx..."
            />
            <button
              className="btn btn-sm"
              onClick={handleFetchKey}
              disabled={fetchingKey}
            >
              {fetchingKey ? 'Fetching...' : 'Auto-Fetch'}
            </button>
          </div>
          <small>
            Applied to Windows registry on save.{' '}
            <a href="https://forum.makemkv.com/forum/viewtopic.php?t=1053" target="_blank" rel="noopener noreferrer">
              Get from forum
            </a>
          </small>
        </div>
      </section>

      <section className="settings-section">
        <h3>Metadata Configuration</h3>

        <div className="form-group">
          <label>TMDB API Key</label>
          <input
            type="password"
            value={editedSettings?.tmdbApiKey || ''}
            onChange={e => setEditedSettings({ ...editedSettings, tmdbApiKey: e.target.value })}
            placeholder="Enter your TMDB API key"
          />
          <small>
            Get a free API key at{' '}
            <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noopener noreferrer">
              themoviedb.org
            </a>
          </small>
        </div>
      </section>
    </div>
  );
}

export default GeneralSettings;
