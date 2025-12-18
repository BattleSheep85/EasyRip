/**
 * LLM Provider Manager
 * Manages multiple LLM providers and delegates queries to the active one
 */

import { OllamaProvider } from './ollama-provider.js';
import { OpenRouterProvider } from './openrouter-provider.js';
import { ClaudeProvider } from './claude-provider.js';
import { extractJSON, normalizeIdentificationResult } from './json-parser.js';
import logger from '../../logger.js';

const log = {
  info: (msg, data) => logger.info('provider-manager', msg, data),
  warn: (msg, data) => logger.warn('provider-manager', msg, data),
  error: (msg, data) => logger.error('provider-manager', msg, data),
  debug: (msg, data) => logger.debug('provider-manager', msg, data),
};

/**
 * Registry of available provider types
 */
const PROVIDER_TYPES = {
  ollama: OllamaProvider,
  openrouter: OpenRouterProvider,
  claude: ClaudeProvider
};

export class ProviderManager {
  constructor() {
    this.providers = {};
    this.activeProviderName = null;
    this._initializeProviders();
  }

  /**
   * Initialize all provider instances
   */
  _initializeProviders() {
    this.providers.ollama = new OllamaProvider();
    this.providers.openrouter = new OpenRouterProvider();
    this.providers.claude = new ClaudeProvider();

    // Default to Ollama
    this.activeProviderName = 'ollama';
    log.info('Provider manager initialized', {
      providers: Object.keys(this.providers)
    });
  }

  /**
   * Get the active provider
   * @returns {BaseLLMProvider}
   */
  getActiveProvider() {
    return this.providers[this.activeProviderName];
  }

  /**
   * Set the active provider
   * @param {string} name - Provider name (ollama, openrouter, claude)
   * @param {Object} config - Provider configuration
   */
  setActiveProvider(name, config = {}) {
    if (!this.providers[name]) {
      throw new Error(`Unknown provider: ${name}`);
    }

    this.activeProviderName = name;
    this.providers[name].updateConfig(config);

    log.info(`Active provider set to: ${name}`, { config: { ...config, apiKey: config.apiKey ? '***' : undefined } });
  }

  /**
   * Configure a specific provider
   * @param {string} name - Provider name
   * @param {Object} config - Configuration object
   */
  configureProvider(name, config) {
    const provider = this.providers[name];
    if (!provider) {
      throw new Error(`Unknown provider: ${name}`);
    }

    provider.updateConfig(config);

    // Handle credentials
    if (config.apiKey) {
      if (name === 'openrouter') {
        provider.setApiKey(config.apiKey);
      } else if (name === 'claude') {
        provider.setApiKey(config.apiKey);
      }
    }

    if (config.oauthToken && name === 'claude') {
      provider.setOAuthToken(config.oauthToken);
    }

    log.debug(`Provider ${name} configured`);
  }

  /**
   * Query the active provider
   * @param {string} prompt - Query prompt
   * @param {Object} options - Query options
   * @returns {Promise<string>} Raw response
   */
  async query(prompt, options = {}) {
    const provider = this.getActiveProvider();

    if (!provider) {
      throw new Error('No active provider configured');
    }

    const available = await provider.isAvailable();
    if (!available) {
      throw new Error(`Provider "${this.activeProviderName}" is not available`);
    }

    log.debug(`Querying ${this.activeProviderName}`);
    return provider.query(prompt, options);
  }

  /**
   * Query and parse as identification result
   * @param {string} prompt - Query prompt
   * @param {Object} options - Query options
   * @returns {Promise<Object>} Parsed identification result
   */
  async identifyDisc(prompt, options = {}) {
    const response = await this.query(prompt, options);

    // Parse the response
    const parsed = extractJSON(response);
    return normalizeIdentificationResult(parsed);
  }

  /**
   * Test connection for a specific provider
   * @param {string} name - Provider name
   * @returns {Promise<{success: boolean, message: string, latency?: number}>}
   */
  async testProvider(name) {
    const provider = this.providers[name];
    if (!provider) {
      return { success: false, message: `Unknown provider: ${name}` };
    }

    return provider.testConnection();
  }

  /**
   * Get all provider info
   * @returns {Object} Map of provider name to info
   */
  getAllProviderInfo() {
    const info = {};
    for (const [name, provider] of Object.entries(this.providers)) {
      info[name] = {
        ...provider.getInfo(),
        isActive: name === this.activeProviderName
      };
    }
    return info;
  }

  /**
   * Get models for a specific provider
   * @param {string} name - Provider name
   * @returns {Array} List of models
   */
  getModels(name) {
    const provider = this.providers[name];
    if (!provider) {
      return [];
    }
    return provider.getModels();
  }

  /**
   * Get the active provider name
   * @returns {string}
   */
  getActiveProviderName() {
    return this.activeProviderName;
  }

  /**
   * Check if any provider is available
   * @returns {Promise<boolean>}
   */
  async isAnyProviderAvailable() {
    for (const provider of Object.values(this.providers)) {
      if (await provider.isAvailable()) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get the first available provider
   * @returns {Promise<string|null>} Provider name or null
   */
  async getFirstAvailableProvider() {
    // Priority order: ollama (local), then cloud providers
    const priority = ['ollama', 'openrouter', 'claude'];

    for (const name of priority) {
      const provider = this.providers[name];
      if (provider && await provider.isAvailable()) {
        return name;
      }
    }
    return null;
  }
}

// Singleton instance
let instance = null;

/**
 * Get the provider manager singleton
 * @returns {ProviderManager}
 */
export function getProviderManager() {
  if (!instance) {
    instance = new ProviderManager();
  }
  return instance;
}

export default { ProviderManager, getProviderManager };
