/**
 * Theme Context - Global theme state management
 * Handles light/dark mode and accent color customization
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

const ThemeContext = createContext(null);

const ACCENT_COLORS = {
  blue: { primary: '#0a6ed1', hover: '#0854a0', light: '#e5f0fa' },
  purple: { primary: '#7c3aed', hover: '#6d28d9', light: '#ede9fe' },
  teal: { primary: '#0d9488', hover: '#0f766e', light: '#ccfbf1' },
  green: { primary: '#16a34a', hover: '#15803d', light: '#dcfce7' },
  orange: { primary: '#ea580c', hover: '#c2410c', light: '#ffedd5' },
  pink: { primary: '#db2777', hover: '#be185d', light: '#fce7f3' },
};

const DEFAULT_APPEARANCE = {
  theme: 'system', // 'light', 'dark', 'system'
  accentColor: 'blue',
};

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(DEFAULT_APPEARANCE.theme);
  const [accentColor, setAccentColor] = useState(DEFAULT_APPEARANCE.accentColor);
  const [resolvedTheme, setResolvedTheme] = useState('light');

  // Load appearance settings from storage
  useEffect(() => {
    loadAppearance();
  }, []);

  // Apply theme to document
  useEffect(() => {
    const resolved = resolveTheme(theme);
    setResolvedTheme(resolved);
    document.documentElement.setAttribute('data-theme', resolved);
  }, [theme]);

  // Apply accent color
  useEffect(() => {
    const accent = ACCENT_COLORS[accentColor] || ACCENT_COLORS.blue;
    document.documentElement.setAttribute('data-accent', accentColor);
    document.documentElement.style.setProperty('--accent-primary', accent.primary);
    document.documentElement.style.setProperty('--accent-primary-hover', accent.hover);
    document.documentElement.style.setProperty('--accent-primary-light', accent.light);
  }, [accentColor]);

  // Listen for system theme changes
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      if (theme === 'system') {
        const resolved = mediaQuery.matches ? 'dark' : 'light';
        setResolvedTheme(resolved);
        document.documentElement.setAttribute('data-theme', resolved);
      }
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [theme]);

  function resolveTheme(themeValue) {
    if (themeValue === 'system') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return themeValue;
  }

  async function loadAppearance() {
    if (!window.electronAPI) return;

    try {
      const result = await window.electronAPI.getSettings();
      if (result.success && result.settings?.appearance) {
        setTheme(result.settings.appearance.theme || DEFAULT_APPEARANCE.theme);
        setAccentColor(result.settings.appearance.accentColor || DEFAULT_APPEARANCE.accentColor);
      }
    } catch (err) {
      console.error('Failed to load appearance settings:', err);
    }
  }

  const saveAppearance = useCallback(async (newTheme, newAccent) => {
    if (!window.electronAPI) return;

    try {
      const result = await window.electronAPI.getSettings();
      if (result.success) {
        const updatedSettings = {
          ...result.settings,
          appearance: {
            theme: newTheme ?? theme,
            accentColor: newAccent ?? accentColor,
          },
        };
        await window.electronAPI.saveSettings(updatedSettings);
      }
    } catch (err) {
      console.error('Failed to save appearance settings:', err);
    }
  }, [theme, accentColor]);

  const updateTheme = useCallback((newTheme) => {
    setTheme(newTheme);
    saveAppearance(newTheme, accentColor);
  }, [accentColor, saveAppearance]);

  const updateAccentColor = useCallback((newAccent) => {
    setAccentColor(newAccent);
    saveAppearance(theme, newAccent);
  }, [theme, saveAppearance]);

  const toggleTheme = useCallback(() => {
    const newTheme = resolvedTheme === 'light' ? 'dark' : 'light';
    updateTheme(newTheme);
  }, [resolvedTheme, updateTheme]);

  const value = {
    // Current theme values
    theme,
    resolvedTheme,
    accentColor,
    // Available options
    accentColors: Object.keys(ACCENT_COLORS),
    // Actions
    setTheme: updateTheme,
    setAccentColor: updateAccentColor,
    toggleTheme,
    // Utilities
    isDark: resolvedTheme === 'dark',
    isLight: resolvedTheme === 'light',
  };

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

export { ACCENT_COLORS };
export default ThemeContext;
