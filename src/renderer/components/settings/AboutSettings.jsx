/**
 * AboutSettings - Version info and links
 */

import React, { useState, useEffect } from 'react';
import { useToast } from '../common/Toast.jsx';
import ExternalLink from '../common/ExternalLink.jsx';

function AboutSettings() {
  const toast = useToast();
  const [appVersion, setAppVersion] = useState('');
  const [updateStatus, setUpdateStatus] = useState(null);

  useEffect(() => {
    loadVersion();

    if (window.electronAPI) {
      window.electronAPI.onUpdateStatus((data) => {
        setUpdateStatus(data);
      });

      return () => {
        window.electronAPI.removeUpdateListeners();
      };
    }
  }, []);

  async function loadVersion() {
    if (!window.electronAPI) return;
    try {
      const version = await window.electronAPI.getVersion();
      setAppVersion(version);
    } catch (err) {
      console.error('Failed to load version:', err);
    }
  }

  async function handleCheckForUpdates() {
    if (!window.electronAPI) return;
    try {
      await window.electronAPI.checkForUpdates();
      toast.info('Checking for updates...');
    } catch (err) {
      toast.error('Failed to check for updates: ' + err.message);
    }
  }

  async function handleDownloadUpdate() {
    if (!window.electronAPI) return;
    try {
      await window.electronAPI.downloadUpdate();
    } catch (err) {
      toast.error('Failed to download update: ' + err.message);
    }
  }

  async function handleInstallUpdate() {
    if (!window.electronAPI) return;
    try {
      await window.electronAPI.installUpdate();
    } catch (err) {
      toast.error('Failed to install update: ' + err.message);
    }
  }

  async function handleOpenLogDir() {
    if (!window.electronAPI) return;
    try {
      await window.electronAPI.openLogDirectory();
    } catch (err) {
      toast.error('Failed to open log directory: ' + err.message);
    }
  }

  async function handleOpenBackupDir() {
    if (!window.electronAPI) return;
    try {
      await window.electronAPI.openBackupDirectory();
    } catch (err) {
      toast.error('Failed to open backup directory: ' + err.message);
    }
  }

  return (
    <div className="settings-tab">
      <h2>About EasyRip</h2>

      <section className="settings-section">
        <div className="about-header">
          <h1 className="about-title">EasyRip</h1>
          {appVersion && (
            <span className="about-version">Version {appVersion}</span>
          )}
        </div>

        <p className="about-description">
          Automated disc backup and media management tool using MakeMKV.
          Supports movies and TV series with TMDB metadata integration.
        </p>
      </section>

      <section className="settings-section">
        <h3>Updates</h3>

        <div className="update-status">
          {updateStatus?.status === 'checking' && (
            <span className="update-checking">Checking for updates...</span>
          )}
          {updateStatus?.status === 'available' && (
            <div className="update-available">
              <span>Update v{updateStatus.version} available!</span>
              <button className="btn btn-primary" onClick={handleDownloadUpdate}>
                Download Update
              </button>
            </div>
          )}
          {updateStatus?.status === 'downloading' && (
            <div className="update-downloading">
              <span>Downloading update: {updateStatus.percent?.toFixed(0)}%</span>
              <div className="update-progress-bar">
                <div
                  className="update-progress-fill"
                  style={{ width: `${updateStatus.percent || 0}%` }}
                />
              </div>
            </div>
          )}
          {updateStatus?.status === 'downloaded' && (
            <div className="update-ready">
              <span>Update ready to install!</span>
              <button className="btn btn-primary" onClick={handleInstallUpdate}>
                Install & Restart
              </button>
            </div>
          )}
          {updateStatus?.status === 'error' && (
            <span className="update-error">Update error: {updateStatus.error}</span>
          )}
          {(!updateStatus || updateStatus?.status === 'up-to-date') && (
            <button className="btn" onClick={handleCheckForUpdates}>
              Check for Updates
            </button>
          )}
        </div>
      </section>

      <section className="settings-section">
        <h3>Quick Access</h3>

        <div className="button-group">
          <button className="btn" onClick={handleOpenBackupDir}>
            Open Backup Folder
          </button>
          <button className="btn" onClick={handleOpenLogDir}>
            Open Log Folder
          </button>
        </div>
      </section>

      <section className="settings-section">
        <h3>Links</h3>

        <div className="about-links">
          <ExternalLink
            href="https://github.com/yourusername/easyrip"
            className="about-link"
          >
            GitHub Repository
          </ExternalLink>
          <ExternalLink
            href="https://www.themoviedb.org/"
            className="about-link"
          >
            TMDB (Metadata Source)
          </ExternalLink>
          <ExternalLink
            href="https://www.makemkv.com/"
            className="about-link"
          >
            MakeMKV
          </ExternalLink>
        </div>
      </section>

      <section className="settings-section">
        <h3>Credits</h3>

        <div className="about-credits">
          <p>Built with Electron, React, and MakeMKV</p>
          <p>Metadata provided by The Movie Database (TMDB)</p>
        </div>
      </section>
    </div>
  );
}

export default AboutSettings;
