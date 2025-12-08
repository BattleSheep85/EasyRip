/**
 * AppHeader - Simplified header for use with sidebar navigation
 * Contains: hamburger menu (mobile), branding, version, theme toggle, update status
 */

import React from 'react';
import { useTheme } from '../../context/ThemeContext.jsx';

function AppHeader({ appVersion, updateStatus, onDownloadUpdate, onInstallUpdate, onMobileMenuToggle, mobileMenuOpen }) {
  const { resolvedTheme, toggleTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  return (
    <header className="app-header">
      {/* Mobile hamburger menu */}
      <button
        className="hamburger-btn mobile-only"
        onClick={onMobileMenuToggle}
        aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
      >
        {mobileMenuOpen ? '\u2715' : '\u2630'}
      </button>

      <div className="header-left">
        <h1>EasyRip</h1>
        {appVersion && <span className="version-badge">v{appVersion}</span>}
      </div>

      <div className="header-actions">
        {/* Update indicators */}
        {updateStatus?.status === 'available' && (
          <button
            className="btn btn-sm btn-update"
            onClick={onDownloadUpdate}
            title={`Update v${updateStatus.version} available - click to download`}
          >
            Update
          </button>
        )}
        {updateStatus?.status === 'downloading' && (
          <span
            className="update-progress"
            title={`Downloading update: ${updateStatus.percent?.toFixed(0)}%`}
          >
            Updating {updateStatus.percent?.toFixed(0)}%
          </span>
        )}
        {updateStatus?.status === 'downloaded' && (
          <button
            className="btn btn-sm btn-update-ready"
            onClick={onInstallUpdate}
            title="Update downloaded - click to install and restart"
          >
            Restart
          </button>
        )}

        {/* Theme toggle */}
        <button
          className="btn btn-sm btn-theme-toggle"
          onClick={toggleTheme}
          title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          aria-label="Toggle theme"
        >
          {isDark ? '\u2600' : '\uD83C\uDF19'}
        </button>
      </div>
    </header>
  );
}

export default AppHeader;
