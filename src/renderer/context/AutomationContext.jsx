/**
 * Automation Context - Global automation state management
 * Handles auto-backup, auto-meta, auto-export toggles
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

const AutomationContext = createContext(null);

const DEFAULT_AUTOMATION = {
  autoBackup: false,
  autoMeta: true,
  autoExport: false,
  liveDangerously: false,
  ejectAfterBackup: false,
};

export function AutomationProvider({ children }) {
  const [automation, setAutomation] = useState(DEFAULT_AUTOMATION);
  const [isLoading, setIsLoading] = useState(true);

  // Load automation settings on mount
  useEffect(() => {
    loadAutomation();
  }, []);

  const loadAutomation = useCallback(async () => {
    if (!window.electronAPI) {
      setIsLoading(false);
      return;
    }

    try {
      const result = await window.electronAPI.getAutomation();
      if (result.success) {
        setAutomation(result.automation);
      }
    } catch (err) {
      console.error('Failed to load automation settings:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const toggleAutomation = useCallback(async (key) => {
    if (!window.electronAPI) return;

    try {
      const result = await window.electronAPI.toggleAutomation(key);
      if (result.success) {
        setAutomation(result.automation);
      }
    } catch (err) {
      console.error('Failed to toggle automation:', err);
    }
  }, []);

  const setAutomationSettings = useCallback(async (newAutomation) => {
    if (!window.electronAPI) return;

    try {
      const result = await window.electronAPI.setAutomation(newAutomation);
      if (result.success) {
        setAutomation(result.automation);
      }
    } catch (err) {
      console.error('Failed to set automation:', err);
    }
  }, []);

  const value = {
    automation,
    isLoading,
    toggleAutomation,
    setAutomation: setAutomationSettings,
    loadAutomation,
  };

  return (
    <AutomationContext.Provider value={value}>
      {children}
    </AutomationContext.Provider>
  );
}

export function useAutomation() {
  const context = useContext(AutomationContext);
  if (!context) {
    throw new Error('useAutomation must be used within an AutomationProvider');
  }
  return context;
}

export default AutomationContext;
