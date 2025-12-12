/**
 * SettingsPage - Full-page settings with sidebar navigation
 * Sonarr-style tabbed interface
 */

import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useSettings } from '../context/SettingsContext.jsx';
import { useToast } from '../components/common/Toast.jsx';
import GeneralSettings from '../components/settings/GeneralSettings.jsx';
import PathSettings from '../components/settings/PathSettings.jsx';
import TransferSettings from '../components/settings/TransferSettings.jsx';
import PerformanceSettings from '../components/settings/PerformanceSettings.jsx';
import AppearanceSettings from '../components/settings/AppearanceSettings.jsx';
import AboutSettings from '../components/settings/AboutSettings.jsx';

const TABS = [
  { id: 'general', label: 'General', icon: '\u2699' },
  { id: 'paths', label: 'Paths', icon: '\uD83D\uDCC1' },
  { id: 'transfer', label: 'Transfer', icon: '\uD83D\uDCE4' },
  { id: 'performance', label: 'Performance', icon: '\u26A1' },
  { id: 'appearance', label: 'Appearance', icon: '\uD83C\uDFA8' },
  { id: 'about', label: 'About', icon: '\u2139' },
];

function SettingsPage() {
  const navigate = useNavigate();
  const { tab } = useParams();
  const [activeTab, setActiveTab] = useState(tab || 'general');
  const { settings, editedSettings, setEditedSettings, saveSettings, loadSettings } = useSettings();
  const toast = useToast();
  const [hasChanges, setHasChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Load settings when page mounts
  useEffect(() => {
    loadSettings();
  }, []);

  // Sync activeTab with URL param
  useEffect(() => {
    if (tab && TABS.find(t => t.id === tab)) {
      setActiveTab(tab);
    }
  }, [tab]);

  // Track changes
  useEffect(() => {
    if (settings && editedSettings) {
      setHasChanges(JSON.stringify(settings) !== JSON.stringify(editedSettings));
    }
  }, [settings, editedSettings]);

  const handleTabChange = (tabId) => {
    setActiveTab(tabId);
    navigate(`/settings/${tabId}`, { replace: true });
  };

  const handleSave = async () => {
    setIsSaving(true);
    const result = await saveSettings();
    setIsSaving(false);

    if (result.success) {
      toast.success('Settings saved successfully');
    } else {
      toast.error('Failed to save settings: ' + result.error);
    }
  };

  const handleDiscard = () => {
    setEditedSettings({ ...settings });
    toast.info('Changes discarded');
  };

  const handleBack = () => {
    if (hasChanges) {
      if (confirm('You have unsaved changes. Discard them?')) {
        handleDiscard();
        navigate('/');
      }
    } else {
      navigate('/');
    }
  };

  const renderTabContent = () => {
    switch (activeTab) {
      case 'general':
        return <GeneralSettings />;
      case 'paths':
        return <PathSettings />;
      case 'transfer':
        return <TransferSettings />;
      case 'performance':
        return <PerformanceSettings />;
      case 'appearance':
        return <AppearanceSettings />;
      case 'about':
        return <AboutSettings />;
      default:
        return <GeneralSettings />;
    }
  };

  return (
    <div className="settings-page">
      {/* Page Header with save actions */}
      <div className="page-header">
        <h2>Settings</h2>
        <div className="page-header-actions">
          {hasChanges && (
            <>
              <button className="btn btn-sm" onClick={handleDiscard}>
                Discard
              </button>
              <button
                className="btn btn-sm btn-primary"
                onClick={handleSave}
                disabled={isSaving}
              >
                {isSaving ? 'Saving...' : 'Save Changes'}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="settings-layout">
        {/* Sidebar */}
        <nav className="settings-sidebar">
          {TABS.map(tabItem => (
            <button
              key={tabItem.id}
              className={`settings-nav-item ${activeTab === tabItem.id ? 'active' : ''}`}
              onClick={() => handleTabChange(tabItem.id)}
            >
              <span className="nav-icon">{tabItem.icon}</span>
              <span className="nav-label">{tabItem.label}</span>
            </button>
          ))}
        </nav>

        {/* Content */}
        <main className="settings-content">
          {renderTabContent()}
        </main>
      </div>
    </div>
  );
}

export default SettingsPage;
