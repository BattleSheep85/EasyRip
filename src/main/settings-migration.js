// Settings Migration System
// Handles versioned settings and automatic migration between versions
//
// HOW TO ADD A NEW MIGRATION:
// 1. Increment CURRENT_SETTINGS_VERSION
// 2. Add a migration function: migrations[NEW_VERSION] = (settings) => { ... return settings; }
// 3. The migration receives the previous version's settings and returns the new version's settings

import logger from './logger.js';

const log = {
  info: (msg, data) => logger.info('settings-migration', msg, data),
  warn: (msg, data) => logger.warn('settings-migration', msg, data),
};

// Current settings schema version - increment when making breaking changes
export const CURRENT_SETTINGS_VERSION = 1;

// Default settings for fresh installs
export const DEFAULT_SETTINGS = {
  settingsVersion: CURRENT_SETTINGS_VERSION,
  makemkvPath: 'C:\\Program Files (x86)\\MakeMKV\\makemkvcon64.exe',
  basePath: 'D:\\EasyRip',
  tmdbApiKey: '',
  makemkvKey: '',
  transfer: null,
  automation: {
    autoBackup: false,
    autoMeta: true,
    autoExport: false,
    liveDangerously: false,
    ejectAfterBackup: false,
    autoApproveAll: false,
    autoApproveThreshold: 0.70
  },
  makemkvPerformance: null, // Will use getDefaultPerformanceSettings()
  extraction: {
    defaultMode: 'full_backup',
    minTitleLength: 10
  },
  aiProviders: {
    activeProvider: 'ollama',
    ollama: { enabled: true, baseUrl: 'http://127.0.0.1:11434', model: 'hermes3:8b' },
    openrouter: { enabled: false, model: 'anthropic/claude-3.5-haiku' },
    claude: { enabled: false, model: 'claude-haiku-4-5-20251001' }
  }
};

/**
 * Migration functions - each transforms settings from version N-1 to N
 *
 * Format: migrations[targetVersion] = (settings) => migratedSettings
 *
 * Example future migration:
 * migrations[2] = (settings) => {
 *   // Rename 'basePath' to 'backupPath'
 *   settings.backupPath = settings.basePath;
 *   delete settings.basePath;
 *   return settings;
 * };
 */
const migrations = {
  // Migration from unversioned (v0) to v1
  // This handles existing settings files that don't have a version field
  1: (settings) => {
    log.info('Migrating settings from unversioned to v1');

    // Ensure automation has all expected fields
    if (settings.automation) {
      settings.automation = {
        autoBackup: false,
        autoMeta: true,
        autoExport: false,
        liveDangerously: false,
        ejectAfterBackup: false,
        autoApproveAll: false,
        autoApproveThreshold: 0.70,
        ...settings.automation // Preserve existing values
      };
    }

    // Ensure extraction has all expected fields
    if (settings.extraction) {
      settings.extraction = {
        defaultMode: 'full_backup',
        minTitleLength: 10,
        ...settings.extraction
      };
    }

    // Ensure aiProviders has all expected fields
    if (settings.aiProviders) {
      settings.aiProviders = {
        activeProvider: 'ollama',
        ollama: { enabled: true, baseUrl: 'http://127.0.0.1:11434', model: 'hermes3:8b' },
        openrouter: { enabled: false, model: 'anthropic/claude-3.5-haiku' },
        claude: { enabled: false, model: 'claude-haiku-4-5-20251001' },
        ...settings.aiProviders
      };
    }

    return settings;
  },

  // Future migrations go here:
  // 2: (settings) => { ... },
  // 3: (settings) => { ... },
};

/**
 * Migrate settings from any version to the current version
 * Applies each migration in sequence
 *
 * @param {object} settings - The loaded settings object
 * @returns {object} - The migrated settings object
 */
export function migrateSettings(settings) {
  // Determine current version (unversioned = 0)
  const fromVersion = settings.settingsVersion || 0;

  // Already at current version
  if (fromVersion === CURRENT_SETTINGS_VERSION) {
    return settings;
  }

  // Downgrade not supported (future version loaded in older app)
  if (fromVersion > CURRENT_SETTINGS_VERSION) {
    log.warn(`Settings version ${fromVersion} is newer than app version ${CURRENT_SETTINGS_VERSION}. Some settings may not work correctly.`);
    return settings;
  }

  log.info(`Migrating settings from v${fromVersion} to v${CURRENT_SETTINGS_VERSION}`);

  // Apply each migration in sequence
  let migratedSettings = { ...settings };
  for (let version = fromVersion + 1; version <= CURRENT_SETTINGS_VERSION; version++) {
    if (migrations[version]) {
      migratedSettings = migrations[version](migratedSettings);
      migratedSettings.settingsVersion = version;
      log.info(`Applied migration to v${version}`);
    }
  }

  return migratedSettings;
}

/**
 * Check if settings need migration
 *
 * @param {object} settings - The loaded settings object
 * @returns {boolean} - True if migration is needed
 */
export function needsMigration(settings) {
  const version = settings.settingsVersion || 0;
  return version < CURRENT_SETTINGS_VERSION;
}

export default {
  CURRENT_SETTINGS_VERSION,
  DEFAULT_SETTINGS,
  migrateSettings,
  needsMigration
};
