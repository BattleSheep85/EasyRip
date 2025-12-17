/**
 * ExtractionSettings - Backup Extraction Mode Configuration
 * Configure Smart Extract mode to skip short titles and avoid hash errors on extras
 */

import React, { useState, useEffect } from 'react';
import { useSettings } from '../../context/SettingsContext.jsx';
import { useToast } from '../common/Toast.jsx';

function ExtractionSettings() {
  const toast = useToast();
  const { settings, loadSettings } = useSettings();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [extraction, setExtraction] = useState(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [originalExtraction, setOriginalExtraction] = useState(null);

  // Load extraction settings on mount
  useEffect(() => {
    loadExtractionSettings();
  }, []);

  // Track changes
  useEffect(() => {
    if (originalExtraction && extraction) {
      setHasChanges(JSON.stringify(originalExtraction) !== JSON.stringify(extraction));
    }
  }, [extraction, originalExtraction]);

  const loadExtractionSettings = async () => {
    setLoading(true);
    try {
      // Settings come from SettingsContext, which includes extraction
      await loadSettings();
      const extractionSettings = settings?.extraction || { defaultMode: 'full_backup', minTitleLength: 10 };
      setExtraction(extractionSettings);
      setOriginalExtraction(JSON.parse(JSON.stringify(extractionSettings)));
    } catch (error) {
      toast.error('Failed to load extraction settings: ' + error.message);
    }
    setLoading(false);
  };

  // Update when settings change from context
  useEffect(() => {
    if (settings?.extraction && !extraction) {
      const extractionSettings = settings.extraction;
      setExtraction(extractionSettings);
      setOriginalExtraction(JSON.parse(JSON.stringify(extractionSettings)));
      setLoading(false);
    }
  }, [settings]);

  const handleModeChange = (mode) => {
    setExtraction({
      ...extraction,
      defaultMode: mode
    });
  };

  const handleMinLengthChange = (value) => {
    const numValue = parseInt(value) || 10;
    // Clamp to valid range
    const clampedValue = Math.min(Math.max(numValue, 1), 120);
    setExtraction({
      ...extraction,
      minTitleLength: clampedValue
    });
  };

  const handleSave = async () => {
    if (!window.electronAPI) return;
    setSaving(true);
    try {
      const result = await window.electronAPI.saveExtractionSettings(extraction);
      if (result.success) {
        toast.success('Extraction settings saved successfully');
        setOriginalExtraction(JSON.parse(JSON.stringify(extraction)));
        setHasChanges(false);
        // Reload settings to sync context
        await loadSettings();
      } else {
        toast.error('Failed to save: ' + result.error);
      }
    } catch (error) {
      toast.error('Error saving settings: ' + error.message);
    }
    setSaving(false);
  };

  const handleReset = () => {
    setExtraction(JSON.parse(JSON.stringify(originalExtraction)));
    setHasChanges(false);
    toast.info('Changes discarded');
  };

  if (loading) {
    return (
      <div className="settings-tab">
        <h2>Extraction Settings</h2>
        <p>Loading...</p>
      </div>
    );
  }

  if (!extraction) {
    return (
      <div className="settings-tab">
        <h2>Extraction Settings</h2>
        <p>Failed to load settings</p>
      </div>
    );
  }

  const isSmartExtract = extraction.defaultMode === 'smart_extract';

  return (
    <div className="settings-tab">
      <h2>Extraction Settings</h2>
      <p className="settings-description">
        Configure how disc backups are extracted. Smart Extract mode skips short titles
        to avoid hash errors on problematic extras while preserving the main feature.
      </p>

      {/* Mode Selection */}
      <section className="settings-section">
        <h3>Default Extraction Mode</h3>
        <p className="info-text">
          This setting applies to all new backups. You can override it per-disc on the Home page.
        </p>

        <div className="preset-selector">
          <label className="preset-radio">
            <input
              type="radio"
              name="extractionMode"
              value="full_backup"
              checked={!isSmartExtract}
              onChange={() => handleModeChange('full_backup')}
            />
            <div className="preset-card">
              <div className="preset-name">Full Backup</div>
              <div className="preset-description">
                Copy the entire disc structure including all titles and extras.
                This is the default behavior.
              </div>
              <div className="preset-specs">All titles copied</div>
            </div>
          </label>

          <label className="preset-radio">
            <input
              type="radio"
              name="extractionMode"
              value="smart_extract"
              checked={isSmartExtract}
              onChange={() => handleModeChange('smart_extract')}
            />
            <div className="preset-card">
              <div className="preset-name">Smart Extract</div>
              <div className="preset-description">
                Skip titles shorter than the minimum length. Useful for discs with
                hash errors on short extras.
              </div>
              <div className="preset-specs">
                Skips titles &lt; {extraction.minTitleLength} min
              </div>
            </div>
          </label>
        </div>
      </section>

      {/* Minimum Title Length */}
      <section className="settings-section">
        <h3>Smart Extract Settings</h3>
        {!isSmartExtract && (
          <p className="info-text">
            These settings only apply when Smart Extract mode is active.
          </p>
        )}

        <div className="form-grid">
          <div className="form-group">
            <label>
              Minimum Title Length (minutes)
              <span className="field-help">1-120 min</span>
            </label>
            <input
              type="number"
              min="1"
              max="120"
              value={extraction.minTitleLength || 10}
              onChange={(e) => handleMinLengthChange(e.target.value)}
              disabled={!isSmartExtract}
            />
            <small>
              Titles shorter than this will be skipped during backup.
              <br />
              <strong>Recommended:</strong> 10 minutes (skips trailers and short extras)
              <br />
              Current: {extraction.minTitleLength || 10} minutes = {(extraction.minTitleLength || 10) * 60} seconds
            </small>
          </div>
        </div>

        {/* Length Examples */}
        <div className="help-box">
          <strong>Length Guide:</strong>
          <ul className="help-list">
            <li><strong>5 min:</strong> Skips trailers, previews, and very short clips</li>
            <li><strong>10 min:</strong> Skips most behind-the-scenes clips and short featurettes</li>
            <li><strong>15 min:</strong> Keeps only substantial specials and deleted scenes</li>
            <li><strong>30 min:</strong> Main features and TV episodes only</li>
          </ul>
        </div>
      </section>

      {/* Save/Reset Buttons */}
      {hasChanges && (
        <div className="settings-actions">
          <button className="btn btn-secondary" onClick={handleReset} disabled={saving}>
            Discard Changes
          </button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Extraction Settings'}
          </button>
        </div>
      )}

      {/* Help Section */}
      <section className="settings-section">
        <h3>When to Use Smart Extract</h3>
        <ul className="help-list">
          <li>
            <strong>Hash errors on extras:</strong> If a disc fails backup due to hash
            errors on short bonus content, Smart Extract skips those problematic files.
          </li>
          <li>
            <strong>Damaged discs:</strong> Old or scratched discs may have unreadable
            extras. Smart Extract lets you get the main content.
          </li>
          <li>
            <strong>Space savings:</strong> Skip unwanted trailers and previews to
            save storage space.
          </li>
        </ul>

        <div className="info-box">
          <strong>Note:</strong> Smart Extract uses MakeMKV's <code>--minlength</code> flag
          to filter titles by duration. The disc structure (VIDEO_TS/BDMV) is preserved.
        </div>
      </section>
    </div>
  );
}

export default ExtractionSettings;
