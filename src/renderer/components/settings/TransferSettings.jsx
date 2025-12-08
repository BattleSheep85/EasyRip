/**
 * TransferSettings - Transfer protocol and library paths
 */

import React, { useState } from 'react';
import { useSettings } from '../../context/SettingsContext.jsx';
import { useToast } from '../common/Toast.jsx';

const PROTOCOLS = [
  { value: 'local', label: 'Local', desc: 'Copy to local folder' },
  { value: 'unc', label: 'UNC/SMB', desc: 'Windows network share' },
  { value: 'sftp', label: 'SFTP', desc: 'SSH File Transfer' },
  { value: 'scp', label: 'SCP', desc: 'SSH Copy' },
  { value: 'ftp', label: 'FTP', desc: 'File Transfer Protocol' },
];

function TransferSettings() {
  const { editedSettings, setEditedSettings } = useSettings();
  const toast = useToast();
  const [testing, setTesting] = useState(false);

  const protocol = editedSettings?.transfer?.protocol || 'local';

  const updateTransfer = (updates) => {
    setEditedSettings({
      ...editedSettings,
      transfer: { ...editedSettings?.transfer, ...updates }
    });
  };

  const handleTestConnection = async () => {
    if (!window.electronAPI) return;
    setTesting(true);
    try {
      const result = await window.electronAPI.testTransferConnection(editedSettings?.transfer || {});
      if (result.success) {
        toast.success('Connection successful: ' + result.message);
      } else {
        toast.error('Connection failed: ' + result.message);
      }
    } catch (err) {
      toast.error('Connection test error: ' + err.message);
    }
    setTesting(false);
  };

  return (
    <div className="settings-tab">
      <h2>Transfer Settings</h2>

      <section className="settings-section">
        <h3>Transfer Protocol</h3>

        <div className="form-group">
          <div className="radio-group">
            {PROTOCOLS.map(proto => (
              <label key={proto.value} className="radio-label">
                <input
                  type="radio"
                  name="transferProtocol"
                  value={proto.value}
                  checked={protocol === proto.value}
                  onChange={e => updateTransfer({ protocol: e.target.value })}
                />
                <span className="radio-text">
                  <strong>{proto.label}</strong>
                  <small>{proto.desc}</small>
                </span>
              </label>
            ))}
          </div>
        </div>
      </section>

      {/* SSH/FTP Host Settings */}
      {['sftp', 'scp', 'ftp'].includes(protocol) && (
        <section className="settings-section">
          <h3>Connection Settings</h3>

          <div className="form-row">
            <div className="form-group flex-grow">
              <label>Host</label>
              <input
                type="text"
                value={editedSettings?.transfer?.host || ''}
                onChange={e => updateTransfer({ host: e.target.value })}
                placeholder="192.168.1.100 or server.local"
              />
            </div>
            <div className="form-group" style={{ width: '100px' }}>
              <label>Port</label>
              <input
                type="number"
                value={editedSettings?.transfer?.port || (protocol === 'ftp' ? 21 : 22)}
                onChange={e => updateTransfer({ port: parseInt(e.target.value) || 22 })}
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group flex-grow">
              <label>Username</label>
              <input
                type="text"
                value={editedSettings?.transfer?.username || ''}
                onChange={e => updateTransfer({ username: e.target.value })}
                placeholder="user"
              />
            </div>
            <div className="form-group flex-grow">
              <label>Password</label>
              <input
                type="password"
                value={editedSettings?.transfer?.password || ''}
                onChange={e => updateTransfer({ password: e.target.value })}
                placeholder="Password"
              />
            </div>
          </div>

          {['sftp', 'scp'].includes(protocol) && (
            <div className="form-group">
              <label>Private Key Path (optional)</label>
              <input
                type="text"
                value={editedSettings?.transfer?.privateKey || ''}
                onChange={e => updateTransfer({ privateKey: e.target.value })}
                placeholder="C:\Users\you\.ssh\id_rsa"
              />
              <small>Use instead of password for key-based auth</small>
            </div>
          )}

          {protocol === 'ftp' && (
            <div className="form-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={editedSettings?.transfer?.secure || false}
                  onChange={e => updateTransfer({ secure: e.target.checked })}
                />
                Use FTPS (TLS/SSL encryption)
              </label>
            </div>
          )}
        </section>
      )}

      {/* UNC Path Settings */}
      {protocol === 'unc' && (
        <section className="settings-section">
          <h3>Network Share Settings</h3>

          <div className="form-group">
            <label>UNC Base Path</label>
            <input
              type="text"
              value={editedSettings?.transfer?.uncPath || ''}
              onChange={e => updateTransfer({ uncPath: e.target.value })}
              placeholder="\\server\share"
            />
            <small>Network share path (credentials optional)</small>
          </div>

          <div className="form-row">
            <div className="form-group flex-grow">
              <label>Username (optional)</label>
              <input
                type="text"
                value={editedSettings?.transfer?.username || ''}
                onChange={e => updateTransfer({ username: e.target.value })}
                placeholder="DOMAIN\user"
              />
            </div>
            <div className="form-group flex-grow">
              <label>Password (optional)</label>
              <input
                type="password"
                value={editedSettings?.transfer?.password || ''}
                onChange={e => updateTransfer({ password: e.target.value })}
              />
            </div>
          </div>
        </section>
      )}

      {/* Library Paths */}
      <section className="settings-section">
        <h3>Library Paths</h3>

        <div className="form-group">
          <label>Movie Library Path</label>
          <input
            type="text"
            value={editedSettings?.transfer?.moviePath || ''}
            onChange={e => updateTransfer({ moviePath: e.target.value })}
            placeholder={
              ['sftp', 'scp', 'ftp'].includes(protocol)
                ? '/media/movies'
                : protocol === 'unc'
                  ? '\\\\NAS\\Emby\\Movies'
                  : 'D:\\Media\\Movies'
            }
          />
          <small>
            {['sftp', 'scp', 'ftp'].includes(protocol)
              ? 'Remote path on the server'
              : 'Path to your movie library folder'}
          </small>
        </div>

        <div className="form-group">
          <label>TV Library Path</label>
          <input
            type="text"
            value={editedSettings?.transfer?.tvPath || ''}
            onChange={e => updateTransfer({ tvPath: e.target.value })}
            placeholder={
              ['sftp', 'scp', 'ftp'].includes(protocol)
                ? '/media/tv'
                : protocol === 'unc'
                  ? '\\\\NAS\\Emby\\TV Shows'
                  : 'D:\\Media\\TV Shows'
            }
          />
          <small>
            {['sftp', 'scp', 'ftp'].includes(protocol)
              ? 'Remote path on the server'
              : 'Path to your TV library folder'}
          </small>
        </div>
      </section>

      {/* Test Connection */}
      <section className="settings-section">
        <h3>Connection Test</h3>
        <div className="form-group">
          <button
            className="btn"
            onClick={handleTestConnection}
            disabled={testing}
          >
            {testing ? 'Testing...' : 'Test Connection'}
          </button>
        </div>
      </section>

      {/* Library Maintenance */}
      <section className="settings-section">
        <h3>Library Maintenance</h3>

        <p className="settings-description">
          Fix incorrect naming and add missing NFO metadata files to your Emby library.
          This will rename folders with [tmdbid=xxx] tags to proper Emby naming format.
        </p>

        {protocol !== 'local' && (
          <p className="settings-warning">
            Note: For SCP transfers, the paths above must be locally accessible (e.g., mapped network drive).
          </p>
        )}

        <div className="button-group">
          <button
            className="btn"
            onClick={async () => {
              if (!window.electronAPI) return;
              if (!editedSettings?.transfer?.moviePath) {
                toast.error('Please set a Movie Library Path first');
                return;
              }
              if (!confirm('This will scan your movie library and:\n\n' +
                '1. Rename folders from "Title [tmdbid=xxx]" to "Title (Year)"\n' +
                '2. Create missing movie.nfo files with metadata\n\n' +
                'Continue?')) {
                return;
              }
              try {
                await window.electronAPI.saveSettings(editedSettings);
                const result = await window.electronAPI.fixMovieLibrary();
                if (result.success) {
                  toast.success(`Fixed ${result.results.renamed} folders, created ${result.results.nfoCreated} NFO files`);
                } else {
                  toast.error('Fix failed: ' + result.error);
                }
              } catch (err) {
                toast.error('Error: ' + err.message);
              }
            }}
          >
            Fix Movie Library
          </button>
          <button
            className="btn"
            onClick={async () => {
              if (!window.electronAPI) return;
              if (!editedSettings?.transfer?.tvPath) {
                toast.error('Please set a TV Library Path first');
                return;
              }
              if (!confirm('This will scan your TV library and:\n\n' +
                '1. Rename series folders from "Title [tmdbid=xxx]" to "Title (Year)"\n' +
                '2. Create missing tvshow.nfo files with metadata\n\n' +
                'Continue?')) {
                return;
              }
              try {
                await window.electronAPI.saveSettings(editedSettings);
                const result = await window.electronAPI.fixTvLibrary();
                if (result.success) {
                  toast.success(`Fixed ${result.results.renamed} series, created ${result.results.nfoCreated} NFO files`);
                } else {
                  toast.error('Fix failed: ' + result.error);
                }
              } catch (err) {
                toast.error('Error: ' + err.message);
              }
            }}
          >
            Fix TV Library
          </button>
        </div>
      </section>
    </div>
  );
}

export default TransferSettings;
