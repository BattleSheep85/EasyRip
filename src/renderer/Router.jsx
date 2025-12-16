/**
 * Router Configuration - Application routes with sidebar navigation
 * Uses HashRouter for Electron compatibility (file:// protocol)
 */

import React, { useState, useEffect } from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import { SettingsProvider } from './context/SettingsContext.jsx';
import { ThemeProvider } from './context/ThemeContext.jsx';
import { AutomationProvider } from './context/AutomationContext.jsx';
import { DriveProvider } from './context/DriveContext.jsx';
import { ToastProvider } from './components/common/Toast.jsx';
import ErrorBoundary from './components/common/ErrorBoundary.jsx';
import AppLayout from './components/layout/AppLayout.jsx';

// Pages
import HomePage from './pages/HomePage.jsx';
import MetadataPage from './pages/MetadataPage.jsx';
import ExportPage from './pages/ExportPage.jsx';
import LogsPage from './pages/LogsPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';

/**
 * AppShell - Wrapper that provides app-level state to AppLayout
 */
function AppShell({ children }) {
  const [appVersion, setAppVersion] = useState('');
  const [updateStatus, setUpdateStatus] = useState(null);
  const [exportStatus, setExportStatus] = useState(null);
  const [exportQueue, setExportQueue] = useState({ queueLength: 0 });

  useEffect(() => {
    if (!window.electronAPI) return;

    // Load version
    window.electronAPI.getVersion().then(version => {
      setAppVersion(version);
    }).catch(err => {
      console.error('Failed to load version:', err);
    });

    // Listen for update status
    window.electronAPI.onUpdateStatus((data) => {
      setUpdateStatus(data);
    });

    // Listen for export progress
    window.electronAPI.onExportProgress((data) => {
      setExportStatus({
        backupName: data.backupName,
        percent: data.percent,
        stage: data.stage
      });
    });

    // Listen for export completion
    window.electronAPI.onExportComplete(() => {
      setExportStatus(null);
      refreshExportQueue();
    });

    // Listen for export errors
    window.electronAPI.onExportError((data) => {
      setExportStatus({
        backupName: data.name,
        percent: 0,
        stage: `Error: ${data.error}`,
        isError: true
      });
      setTimeout(() => setExportStatus(null), 5000);
    });

    // Initial queue load
    refreshExportQueue();

    return () => {
      if (window.electronAPI) {
        window.electronAPI.removeExportListeners();
        window.electronAPI.removeUpdateListeners();
      }
    };
  }, []);

  async function refreshExportQueue() {
    if (!window.electronAPI) return;
    try {
      const result = await window.electronAPI.getExportQueueStatus();
      if (result.success) {
        setExportQueue(result.status);
      }
    } catch (err) {
      console.error('Failed to get export queue status:', err);
    }
  }

  async function handleDownloadUpdate() {
    if (!window.electronAPI) return;
    try {
      await window.electronAPI.downloadUpdate();
    } catch (err) {
      console.error('Failed to download update:', err);
    }
  }

  async function handleInstallUpdate() {
    if (!window.electronAPI) return;
    try {
      await window.electronAPI.installUpdate();
    } catch (err) {
      console.error('Failed to install update:', err);
    }
  }

  return (
    <AppLayout
      appVersion={appVersion}
      updateStatus={updateStatus}
      exportStatus={exportStatus}
      exportQueue={exportQueue}
      onDownloadUpdate={handleDownloadUpdate}
      onInstallUpdate={handleInstallUpdate}
    >
      {children}
    </AppLayout>
  );
}

function AppRouter() {
  return (
    <HashRouter>
      <ErrorBoundary>
        <SettingsProvider>
          <ThemeProvider>
            <AutomationProvider>
              <DriveProvider>
                <ToastProvider>
                  <AppShell>
                  <Routes>
                    {/* Main views */}
                    <Route path="/" element={<HomePage />} />
                    <Route path="/metadata" element={<MetadataPage />} />
                    <Route path="/export" element={<ExportPage />} />
                    <Route path="/logs" element={<LogsPage />} />

                    {/* Settings with optional tab parameter */}
                    <Route path="/settings" element={<SettingsPage />} />
                    <Route path="/settings/:tab" element={<SettingsPage />} />
                  </Routes>
                </AppShell>
                </ToastProvider>
              </DriveProvider>
            </AutomationProvider>
          </ThemeProvider>
        </SettingsProvider>
      </ErrorBoundary>
    </HashRouter>
  );
}

export default AppRouter;
