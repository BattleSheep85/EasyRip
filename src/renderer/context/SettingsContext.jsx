/**
 * Settings Context - Global settings state management
 * Provides settings and related functions throughout the app
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

const SettingsContext = createContext(null);

const DEFAULT_SETTINGS = {
  makemkvPath: '',
  basePath: 'D:\\EasyRip',
  makemkvKey: '',
  tmdbApiKey: '',
  transfer: {
    protocol: 'local',
    host: '',
    port: 22,
    username: '',
    password: '',
    privateKey: '',
    secure: false,
    uncPath: '',
    moviePath: '',
    tvPath: '',
  },
  appearance: {
    theme: 'system', // 'light', 'dark', 'system'
    accentColor: 'blue', // 'blue', 'purple', 'teal', 'green', 'orange', 'pink'
  },
};

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [editedSettings, setEditedSettings] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);

  // Load settings on mount
  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = useCallback(async () => {
    if (!window.electronAPI) {
      setIsLoading(false);
      return;
    }

    try {
      const result = await window.electronAPI.getSettings();
      if (result.success) {
        setSettings(result.settings);
        setEditedSettings(result.settings);
      }
    } catch (err) {
      console.error('Failed to load settings:', err);
      setError('Failed to load settings: ' + err.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const saveSettings = useCallback(async (newSettings = editedSettings) => {
    if (!window.electronAPI || !newSettings) return { success: false, error: 'No settings to save' };

    setIsSaving(true);
    setError(null);

    try {
      const result = await window.electronAPI.saveSettings(newSettings);
      if (result.success) {
        setSettings(newSettings);
        setEditedSettings(newSettings);
        return { success: true };
      } else {
        setError('Failed to save settings: ' + result.error);
        return { success: false, error: result.error };
      }
    } catch (err) {
      setError('Failed to save settings: ' + err.message);
      return { success: false, error: err.message };
    } finally {
      setIsSaving(false);
    }
  }, [editedSettings]);

  const updateEditedSettings = useCallback((updates) => {
    setEditedSettings(prev => ({
      ...prev,
      ...updates,
    }));
  }, []);

  const updateNestedSetting = useCallback((section, updates) => {
    setEditedSettings(prev => ({
      ...prev,
      [section]: {
        ...prev?.[section],
        ...updates,
      },
    }));
  }, []);

  const resetEditedSettings = useCallback(() => {
    setEditedSettings(settings);
  }, [settings]);

  const discardChanges = useCallback(() => {
    setEditedSettings(settings);
    setError(null);
  }, [settings]);

  const value = {
    // Current saved settings
    settings,
    // Settings being edited (for forms)
    editedSettings,
    // State
    isLoading,
    isSaving,
    error,
    // Actions
    loadSettings,
    saveSettings,
    updateEditedSettings,
    updateNestedSetting,
    resetEditedSettings,
    discardChanges,
    setError,
    // Direct setter for complex updates
    setEditedSettings,
  };

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
}

export default SettingsContext;
