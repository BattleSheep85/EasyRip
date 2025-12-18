// Metadata system initialization and management

import path from 'path';
import logger from './logger.js';
import { getOllamaManager } from './metadata/ollama.js';
import { getProviderManager } from './metadata/providers/provider-manager.js';
import { getCredentialStore } from './credential-store.js';
import { getTMDBClient } from './metadata/tmdb.js';
import { getDiscIdentifier } from './metadata/identifier.js';
import { getMetadataWatcher, resetMetadataWatcher } from './metadata/watcher.js';
import { getExportWatcher, resetExportWatcher } from './exportWatcher.js';
import { getMainWindow } from './window-manager.js';
import { showNotification } from './utils.js';

// Metadata system globals
let ollamaManager = null;
let tmdbClient = null;
let discIdentifier = null;
let metadataWatcher = null;
let exportWatcher = null;

/**
 * Initialize metadata system (Ollama, TMDB, watcher)
 */
export async function initializeMetadataSystem(makemkv) {
  try {
    logger.info('metadata', 'Initializing metadata system...');

    const settings = await makemkv.getSettings();
    const metadataSettings = settings.metadata || {};

    // Initialize Ollama manager
    ollamaManager = getOllamaManager();
    ollamaManager.setProgressCallback((stage, percent, message) => {
      const mainWindow = getMainWindow();
      if (mainWindow) {
        mainWindow.webContents.send('ollama-progress', { stage, percent, message });
      }
    });

    // Check if Ollama is installed and start it
    if (ollamaManager.isInstalled()) {
      logger.info('metadata', 'Ollama found, starting server...');
      const started = await ollamaManager.start();
      if (started) {
        // Ensure model is available
        const hasModel = await ollamaManager.hasModel(metadataSettings.ollamaModel || 'llama3.2');
        if (!hasModel) {
          logger.info('metadata', 'Model not found, will pull on first use');
        }
      }
    } else {
      logger.info('metadata', 'Ollama not installed, will install on first use');
    }

    // Initialize AI provider manager with settings
    await initializeAIProviders(settings);

    // Initialize TMDB client
    tmdbClient = getTMDBClient();
    // Check for TMDB API key at top level (new) or nested in metadata (legacy)
    const tmdbApiKey = settings.tmdbApiKey || metadataSettings.tmdbApiKey;
    if (tmdbApiKey) {
      tmdbClient.setApiKey(tmdbApiKey);
      logger.info('metadata', 'TMDB API key configured');
    } else {
      logger.info('metadata', 'TMDB API key not configured');
    }

    // Initialize disc identifier
    discIdentifier = getDiscIdentifier();

    // Initialize metadata watcher (if enabled)
    if (metadataSettings.enabled !== false) {
      const backupPath = path.join(makemkv.basePath, 'backup');
      metadataWatcher = getMetadataWatcher(backupPath, {
        intervalMs: metadataSettings.watcherIntervalMs || 30000,
        onPending: async (backup) => {
          // Check if Live Dangerously mode is enabled - auto-approve EVERYTHING regardless of confidence
          const currentSettings = await makemkv.getSettings();
          if (currentSettings.automation?.liveDangerously) {
            try {
              const fullBackupPath = path.join(backupPath, backup.name);
              const metadata = await discIdentifier.loadMetadata(fullBackupPath);
              const confidence = metadata?.llmGuess?.confidence || 0;

              logger.info('metadata', `[LiveDangerously] Auto-approving ${backup.name} regardless of confidence (${(confidence * 100).toFixed(0)}%)`);
              const result = await discIdentifier.approve(fullBackupPath);
              if (result.success && exportWatcher) {
                exportWatcher.queueExport(backup.name, fullBackupPath, metadata);
                logger.info('export', `[LiveDangerously] Auto-queued ${backup.name} for export`);
              }
            } catch (err) {
              logger.error('metadata', `[LiveDangerously] Auto-approve failed for ${backup.name}`, err);
            }
          }
          // Always notify UI
          const mainWindow = getMainWindow();
          if (mainWindow) {
            mainWindow.webContents.send('metadata-pending', backup);
          }
        },
        onError: (error, backupName) => {
          logger.error('metadata', `Identification error for ${backupName}: ${error}`);
        }
      });

      metadataWatcher.setOnProgress((stage, percent, message) => {
        const mainWindow = getMainWindow();
        if (mainWindow) {
          mainWindow.webContents.send('ollama-progress', { stage, percent, message });
        }
      });

      metadataWatcher.start();
      logger.info('metadata', 'Metadata watcher started');

      // Initialize export watcher (auto-export on approval)
      exportWatcher = getExportWatcher({
        backupPath,
        makemkvPath: makemkv.makemkvPath,
        getSettings: async () => makemkv.getSettings(),
        onProgress: (data) => {
          const mainWindow = getMainWindow();
          if (mainWindow) {
            mainWindow.webContents.send('export-progress', data);
          }
        },
        onLog: (data) => {
          const mainWindow = getMainWindow();
          if (mainWindow) {
            mainWindow.webContents.send('export-log', data);
          }
        },
        onComplete: (data) => {
          const mainWindow = getMainWindow();
          if (mainWindow) {
            mainWindow.webContents.send('export-complete', data);
          }
          // Show desktop notification for successful export
          showNotification(
            'Export Complete',
            `${data.name} has been exported successfully.`,
            'success'
          );
        },
        onError: (data) => {
          const mainWindow = getMainWindow();
          if (mainWindow) {
            mainWindow.webContents.send('export-error', data);
          }
          // Show desktop notification for failed export
          showNotification(
            'Export Failed',
            `${data.name}: ${data.error}`,
            'error'
          );
        },
        onWaiting: (data) => {
          const mainWindow = getMainWindow();
          if (mainWindow) {
            mainWindow.webContents.send('export-waiting', data);
          }
          // Show notification about waiting disc
          showNotification(
            'Disc Waiting',
            `${data.name} is waiting for disc(s) ${data.missingDiscs?.join(', ') || 'unknown'} to be processed first.`,
            'info'
          );
        }
      });

      exportWatcher.start();
      logger.info('export', 'Export watcher started');
    }

    logger.info('metadata', 'Metadata system initialized');
  } catch (error) {
    logger.error('metadata', 'Failed to initialize metadata system', error);
  }
}

/**
 * Cleanup metadata system on shutdown
 */
export async function cleanupMetadataSystem() {
  // Stop metadata watcher
  if (metadataWatcher) {
    metadataWatcher.stop();
  }

  // Stop Ollama server (if we started it)
  if (ollamaManager) {
    try {
      await ollamaManager.stop();
    } catch (error) {
      logger.error('app', 'Error stopping Ollama', error);
    }
  }
}

/**
 * Get Ollama manager instance
 */
export function getOllama() {
  return ollamaManager;
}

/**
 * Get TMDB client instance
 */
export function getTMDB() {
  return tmdbClient;
}

/**
 * Get disc identifier instance
 */
export function getIdentifier() {
  return discIdentifier;
}

/**
 * Get metadata watcher instance
 */
export function getWatcher() {
  return metadataWatcher;
}

/**
 * Get export watcher instance
 */
export function getExportWatcherInstance() {
  return exportWatcher;
}

/**
 * Initialize AI provider manager from settings
 * @param {Object} settings - Application settings
 */
async function initializeAIProviders(settings) {
  try {
    const providerManager = getProviderManager();
    const aiSettings = settings.aiProviders || {};
    const credStore = getCredentialStore();

    logger.info('metadata', 'Initializing AI providers...', { active: aiSettings.activeProvider });

    // Configure Ollama provider
    if (aiSettings.ollama) {
      providerManager.configureProvider('ollama', aiSettings.ollama);
    }

    // Configure OpenRouter provider (needs API key from credential store)
    if (aiSettings.openrouter) {
      try {
        const apiKey = await credStore.getCredential('openrouter-api-key');
        providerManager.configureProvider('openrouter', {
          ...aiSettings.openrouter,
          apiKey
        });
      } catch (err) {
        logger.debug('metadata', 'OpenRouter API key not found');
      }
    }

    // Configure Claude provider (needs API key from credential store)
    if (aiSettings.claude) {
      try {
        const apiKey = await credStore.getCredential('claude-api-key');
        const oauthToken = await credStore.getCredential('claude-oauth-token');
        providerManager.configureProvider('claude', {
          ...aiSettings.claude,
          apiKey,
          oauthToken
        });
      } catch (err) {
        logger.debug('metadata', 'Claude credentials not found');
      }
    }

    // Set active provider
    const activeProvider = aiSettings.activeProvider || 'ollama';
    providerManager.setActiveProvider(activeProvider, aiSettings[activeProvider] || {});

    logger.info('metadata', `AI provider initialized: ${activeProvider}`);
  } catch (error) {
    logger.error('metadata', 'Failed to initialize AI providers', error);
    // Fall back to Ollama
    const providerManager = getProviderManager();
    providerManager.setActiveProvider('ollama', {});
  }
}
