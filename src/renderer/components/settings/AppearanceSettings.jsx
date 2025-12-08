/**
 * AppearanceSettings - Theme and accent color customization
 */

import React from 'react';
import { useTheme, ACCENT_COLORS } from '../../context/ThemeContext.jsx';

function AppearanceSettings() {
  const { theme, setTheme, accentColor, setAccentColor, resolvedTheme, accentColors } = useTheme();

  const themeOptions = [
    { id: 'light', label: 'Light', icon: '\u2600', description: 'Light background with dark text' },
    { id: 'dark', label: 'Dark', icon: '\uD83C\uDF19', description: 'Dark background with light text' },
    { id: 'system', label: 'System', icon: '\uD83D\uDCBB', description: 'Follow your system preference' },
  ];

  const colorOptions = [
    { id: 'blue', label: 'Blue', color: '#0a6ed1' },
    { id: 'purple', label: 'Purple', color: '#7c3aed' },
    { id: 'teal', label: 'Teal', color: '#0d9488' },
    { id: 'green', label: 'Green', color: '#16a34a' },
    { id: 'orange', label: 'Orange', color: '#ea580c' },
    { id: 'pink', label: 'Pink', color: '#db2777' },
  ];

  return (
    <div className="settings-tab">
      <h2>Appearance</h2>

      <section className="settings-section">
        <h3>Theme</h3>
        <p className="settings-description">
          Choose how EasyRip looks. Currently using: <strong>{resolvedTheme}</strong> mode
        </p>

        <div className="theme-selector">
          {themeOptions.map(option => (
            <label
              key={option.id}
              className={`theme-option ${theme === option.id ? 'active' : ''}`}
            >
              <input
                type="radio"
                name="theme"
                value={option.id}
                checked={theme === option.id}
                onChange={() => setTheme(option.id)}
              />
              <span className="theme-icon">{option.icon}</span>
              <span className="theme-text">
                <strong>{option.label}</strong>
                <small>{option.description}</small>
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className="settings-section">
        <h3>Accent Color</h3>
        <p className="settings-description">
          Choose the primary accent color used throughout the app. For users with color vision deficiency:
        </p>

        <div className="accent-picker">
          {colorOptions.map(option => (
            <button
              key={option.id}
              className={`accent-swatch ${accentColor === option.id ? 'active' : ''}`}
              style={{ '--swatch-color': option.color }}
              onClick={() => setAccentColor(option.id)}
              title={option.label}
              aria-label={`${option.label} accent color${accentColor === option.id ? ' (currently selected)' : ''}`}
              aria-pressed={accentColor === option.id}
            >
              <span className="swatch-fill"></span>
              <span className="swatch-label">{option.label}</span>
              {accentColor === option.id && <span className="swatch-check" aria-hidden="true">✓</span>}
            </button>
          ))}
        </div>
      </section>

      <section className="settings-section">
        <h3>Preview</h3>
        <div className="theme-preview">
          <div className="preview-card">
            <div className="preview-header">Preview Header</div>
            <div className="preview-body">
              <p className="preview-text-primary">Primary text color</p>
              <p className="preview-text-secondary">Secondary text color</p>
              <div className="preview-buttons">
                <button className="btn btn-primary">Primary</button>
                <button className="btn">Default</button>
                <button className="btn btn-success">Success</button>
              </div>
              <div className="preview-badges">
                <span className="status-badge status-complete">Complete</span>
                <span className="status-badge status-running">Running</span>
                <span className="status-badge status-error">Error</span>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

export default AppearanceSettings;
