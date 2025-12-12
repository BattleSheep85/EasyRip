/**
 * PerformanceSettings - MakeMKV Performance Configuration
 * Configure cache, buffer sizes, timeouts, and presets for optimal backup performance
 */

import React, { useState, useEffect } from 'react';
import { useToast } from '../common/Toast.jsx';

function PerformanceSettings() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [presets, setPresets] = useState({});
  const [performance, setPerformance] = useState(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [originalPerformance, setOriginalPerformance] = useState(null);

  // Load performance settings and presets on mount
  useEffect(() => {
    loadSettings();
  }, []);

  // Track changes
  useEffect(() => {
    if (originalPerformance && performance) {
      setHasChanges(JSON.stringify(originalPerformance) !== JSON.stringify(performance));
    }
  }, [performance, originalPerformance]);

  const loadSettings = async () => {
    if (!window.electronAPI) return;
    setLoading(true);
    try {
      // Load presets
      const presetsResult = await window.electronAPI.getPerformancePresets();
      if (presetsResult.success) {
        setPresets(presetsResult.presets);
      }

      // Load current performance settings
      const perfResult = await window.electronAPI.getMakeMKVPerformance();
      if (perfResult.success) {
        setPerformance(perfResult.performance);
        setOriginalPerformance(JSON.parse(JSON.stringify(perfResult.performance)));
      }
    } catch (error) {
      toast.error('Failed to load performance settings: ' + error.message);
    }
    setLoading(false);
  };

  const handlePresetChange = (presetKey) => {
    if (!presets[presetKey]) return;

    const preset = presets[presetKey];

    setPerformance({
      ...performance,
      preset: presetKey,
      customSettings: {
        cache: preset.cache,
        minbuf: preset.minbuf,
        maxbuf: preset.maxbuf,
        timeout: preset.timeout,
        splitSize: preset.splitSize || 0,
        retryOnError: preset.retryOnError !== false,
        maxRetries: preset.maxRetries || 3
      }
    });
  };

  const handleCustomSettingChange = (key, value) => {
    // Parse numeric values
    const numValue = ['cache', 'minbuf', 'maxbuf', 'timeout', 'splitSize', 'maxRetries'].includes(key)
      ? parseInt(value) || 0
      : value;

    setPerformance({
      ...performance,
      preset: 'custom',
      customSettings: {
        ...performance.customSettings,
        [key]: numValue
      }
    });
  };

  const handleDiscTypeProfileChange = (discType, presetKey) => {
    setPerformance({
      ...performance,
      discTypeProfiles: {
        ...performance.discTypeProfiles,
        [discType]: presetKey
      }
    });
  };

  const handleSave = async () => {
    if (!window.electronAPI) return;
    setSaving(true);
    try {
      const result = await window.electronAPI.saveMakeMKVPerformance(performance);
      if (result.success) {
        toast.success('Performance settings saved successfully');
        setOriginalPerformance(JSON.parse(JSON.stringify(performance)));
        setHasChanges(false);
      } else {
        toast.error('Failed to save: ' + result.error);
      }
    } catch (error) {
      toast.error('Error saving settings: ' + error.message);
    }
    setSaving(false);
  };

  const handleReset = () => {
    setPerformance(JSON.parse(JSON.stringify(originalPerformance)));
    setHasChanges(false);
    toast.info('Changes discarded');
  };

  if (loading) {
    return (
      <div className="settings-tab">
        <h2>Performance Settings</h2>
        <p>Loading...</p>
      </div>
    );
  }

  if (!performance) {
    return (
      <div className="settings-tab">
        <h2>Performance Settings</h2>
        <p>Failed to load settings</p>
      </div>
    );
  }

  const currentPreset = presets[performance.preset];
  const isCustom = performance.preset === 'custom';
  const settings = performance.customSettings;

  // Calculate memory impact
  const totalMemory = (settings.cache || 0) + (settings.maxbuf || 0);
  const memoryWarning = totalMemory > 128;

  return (
    <div className="settings-tab">
      <h2>Performance Settings</h2>
      <p className="settings-description">
        Configure MakeMKV cache and buffer settings for optimal backup performance.
        Different presets are optimized for different disc types and use cases.
      </p>

      {/* Preset Selector */}
      <section className="settings-section">
        <h3>Performance Preset</h3>
        <div className="preset-selector">
          {Object.entries(presets).map(([key, preset]) => (
            <label key={key} className="preset-radio">
              <input
                type="radio"
                name="preset"
                value={key}
                checked={performance.preset === key && !isCustom}
                onChange={() => handlePresetChange(key)}
              />
              <div className="preset-card">
                <div className="preset-name">{preset.name}</div>
                <div className="preset-description">{preset.description}</div>
                <div className="preset-specs">
                  Cache: {preset.cache}MB | Timeout: {preset.timeout / 1000}s
                </div>
              </div>
            </label>
          ))}
          <label className="preset-radio">
            <input
              type="radio"
              name="preset"
              value="custom"
              checked={isCustom}
              onChange={() => setPerformance({ ...performance, preset: 'custom' })}
            />
            <div className="preset-card">
              <div className="preset-name">Custom</div>
              <div className="preset-description">
                Manually configure all performance parameters
              </div>
              <div className="preset-specs">User-defined values</div>
            </div>
          </label>
        </div>
      </section>

      {/* Custom Settings Form (always visible to show what's being used) */}
      <section className="settings-section">
        <h3>Performance Parameters</h3>
        {!isCustom && (
          <p className="info-text">
            These values are automatically set by the "{currentPreset?.name}" preset.
            Select "Custom" above to manually adjust them.
          </p>
        )}

        <div className="form-grid">
          {/* Cache Size */}
          <div className="form-group">
            <label>
              Cache Size (MB)
              <span className="field-help">1-256 MB</span>
            </label>
            <input
              type="number"
              min="1"
              max="256"
              value={settings.cache || 16}
              onChange={(e) => handleCustomSettingChange('cache', e.target.value)}
              disabled={!isCustom}
            />
            <small>
              Read buffer size. Higher values may improve performance but use more RAM.
              <br />
              Current: {settings.cache || 16} MB
            </small>
          </div>

          {/* Min Buffer */}
          <div className="form-group">
            <label>
              Minimum Buffer (MB)
              <span className="field-help">0-256 MB</span>
            </label>
            <input
              type="number"
              min="0"
              max="256"
              value={settings.minbuf || 1}
              onChange={(e) => handleCustomSettingChange('minbuf', e.target.value)}
              disabled={!isCustom}
            />
            <small>
              Minimum title length threshold (0 = no limit).
              <br />
              Current: {settings.minbuf || 1} MB
            </small>
          </div>

          {/* Max Buffer */}
          <div className="form-group">
            <label>
              Maximum Buffer (MB)
              <span className="field-help">1-256 MB</span>
            </label>
            <input
              type="number"
              min="1"
              max="256"
              value={settings.maxbuf || 16}
              onChange={(e) => handleCustomSettingChange('maxbuf', e.target.value)}
              disabled={!isCustom}
            />
            <small>
              Maximum buffer size for write operations.
              <br />
              Current: {settings.maxbuf || 16} MB
            </small>
          </div>

          {/* Timeout */}
          <div className="form-group">
            <label>
              Timeout (seconds)
              <span className="field-help">1-60 sec</span>
            </label>
            <input
              type="number"
              min="1"
              max="60"
              value={(settings.timeout || 10000) / 1000}
              onChange={(e) => handleCustomSettingChange('timeout', e.target.value * 1000)}
              disabled={!isCustom}
            />
            <small>
              Operation timeout before retry. Longer timeouts help with damaged discs.
              <br />
              Current: {(settings.timeout || 10000) / 1000} seconds
            </small>
          </div>

          {/* Max Retries */}
          <div className="form-group">
            <label>
              Max Retries
              <span className="field-help">0-10</span>
            </label>
            <input
              type="number"
              min="0"
              max="10"
              value={settings.maxRetries || 3}
              onChange={(e) => handleCustomSettingChange('maxRetries', e.target.value)}
              disabled={!isCustom}
            />
            <small>
              Number of retry attempts on read errors.
              <br />
              Current: {settings.maxRetries || 3} retries
            </small>
          </div>

          {/* Retry on Error */}
          <div className="form-group">
            <label>
              <input
                type="checkbox"
                checked={settings.retryOnError !== false}
                onChange={(e) => handleCustomSettingChange('retryOnError', e.target.checked)}
                disabled={!isCustom}
              />
              <span>Enable automatic retry on errors</span>
            </label>
            <small>
              Automatically retry failed operations. Disable only for testing.
            </small>
          </div>
        </div>

        {/* Memory Impact Warning */}
        {memoryWarning && (
          <div className="warning-box">
            <strong>Memory Impact:</strong> Total memory usage: {totalMemory} MB
            <br />
            High memory settings may cause issues on systems with limited RAM.
          </div>
        )}
      </section>

      {/* Disc Type Profiles */}
      <section className="settings-section">
        <h3>Disc Type Profiles</h3>
        <p className="info-text">
          Apply different presets automatically based on disc type.
          These override the global preset when the disc type is detected.
        </p>

        <div className="form-group">
          <label>DVD Discs</label>
          <select
            value={performance.discTypeProfiles?.dvd || 'balanced'}
            onChange={(e) => handleDiscTypeProfileChange('dvd', e.target.value)}
          >
            {Object.entries(presets).map(([key, preset]) => (
              <option key={key} value={key}>
                {preset.name} - {preset.description}
              </option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label>Blu-ray Discs</label>
          <select
            value={performance.discTypeProfiles?.bluray || 'balanced'}
            onChange={(e) => handleDiscTypeProfileChange('bluray', e.target.value)}
          >
            {Object.entries(presets).map(([key, preset]) => (
              <option key={key} value={key}>
                {preset.name} - {preset.description}
              </option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label>4K UHD Blu-ray Discs</label>
          <select
            value={performance.discTypeProfiles?.['4k-bluray'] || '4k-bluray'}
            onChange={(e) => handleDiscTypeProfileChange('4k-bluray', e.target.value)}
          >
            {Object.entries(presets).map(([key, preset]) => (
              <option key={key} value={key}>
                {preset.name} - {preset.description}
              </option>
            ))}
          </select>
        </div>
      </section>

      {/* Save/Reset Buttons */}
      {hasChanges && (
        <div className="settings-actions">
          <button className="btn btn-secondary" onClick={handleReset} disabled={saving}>
            Discard Changes
          </button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Performance Settings'}
          </button>
        </div>
      )}

      {/* Help Section */}
      <section className="settings-section">
        <h3>Performance Tips</h3>
        <ul className="help-list">
          <li>
            <strong>Fast:</strong> Best for DVDs and quick backups. Low memory usage.
          </li>
          <li>
            <strong>Balanced:</strong> Default preset. Good for most use cases.
          </li>
          <li>
            <strong>Compatibility:</strong> Use for damaged/scratched discs. Higher retry count.
          </li>
          <li>
            <strong>4K Blu-ray:</strong> Optimized for high-bitrate UHD content. Large cache.
          </li>
          <li>
            <strong>Custom:</strong> Fine-tune all parameters for specific needs.
          </li>
        </ul>
      </section>
    </div>
  );
}

export default PerformanceSettings;
