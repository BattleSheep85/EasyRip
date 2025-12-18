/**
 * Ollama LLM Provider
 * Connects to local Ollama instance for disc identification
 */

import { BaseLLMProvider } from './base-provider.js';
import logger from '../../logger.js';

const log = {
  info: (msg, data) => logger.info('ollama-provider', msg, data),
  warn: (msg, data) => logger.warn('ollama-provider', msg, data),
  error: (msg, data) => logger.error('ollama-provider', msg, data),
  debug: (msg, data) => logger.debug('ollama-provider', msg, data),
};

const DEFAULT_BASE_URL = 'http://127.0.0.1:11434';
const DEFAULT_MODEL = 'hermes3:8b'; // Best for JSON/structured output
const QUERY_TIMEOUT = 120000; // 2 minutes

/**
 * Curated models for disc identification (Updated December 2025)
 * Selected for: JSON output reliability, disc title extraction, metadata parsing
 */
const OLLAMA_MODELS = [
  {
    id: 'hermes3:8b',
    name: 'Hermes 3 8B',
    shortDesc: 'Best for JSON output',
    downloadSize: '4.7 GB',
    vramRequired: '8 GB',
    jsonAccuracy: 90,
    speed: 'fast',
    recommended: true,
    tooltip: {
      strengths: ['90% JSON accuracy out-of-box', 'Excellent structured output', 'Fast inference'],
      bestFor: 'Reliable disc identification with consistent JSON responses',
      notes: 'Default choice - optimized for function calling and structured data'
    }
  },
  {
    id: 'llama3.3:8b',
    name: 'Llama 3.3 8B',
    shortDesc: 'Balanced & accurate',
    downloadSize: '4.7 GB',
    vramRequired: '8 GB',
    jsonAccuracy: 85,
    speed: 'fast',
    tooltip: {
      strengths: ['Latest Meta architecture', 'Good reasoning', 'Multilingual titles'],
      bestFor: 'Foreign language disc titles and complex naming patterns',
      notes: 'Great fallback if Hermes struggles with specific discs'
    }
  },
  {
    id: 'qwen2.5:7b',
    name: 'Qwen 2.5 7B',
    shortDesc: 'Multi-language expert',
    downloadSize: '4.4 GB',
    vramRequired: '8 GB',
    jsonAccuracy: 82,
    speed: 'fast',
    tooltip: {
      strengths: ['Excellent CJK language support', 'Strong pattern matching', 'Coding-optimized'],
      bestFor: 'Asian language disc titles (Japanese anime, Chinese films)',
      notes: 'Best choice for anime and Asian media identification'
    }
  },
  {
    id: 'phi4:14b',
    name: 'Phi-4 14B',
    shortDesc: 'High accuracy',
    downloadSize: '9.1 GB',
    vramRequired: '14 GB',
    jsonAccuracy: 88,
    speed: 'medium',
    tooltip: {
      strengths: ['Microsoft research model', 'Strong reasoning', 'Handles ambiguous titles'],
      bestFor: 'Complex disc names with multiple possible matches',
      notes: 'Use when simpler models give low confidence results'
    }
  },
  {
    id: 'gemma2:9b',
    name: 'Gemma 2 9B',
    shortDesc: 'Google quality',
    downloadSize: '5.4 GB',
    vramRequired: '10 GB',
    jsonAccuracy: 80,
    speed: 'fast',
    tooltip: {
      strengths: ['Google Gemma architecture', 'Good general knowledge', 'Efficient'],
      bestFor: 'General disc identification with good accuracy',
      notes: 'Solid alternative with Google-level training data'
    }
  },
  {
    id: 'mistral:7b',
    name: 'Mistral 7B',
    shortDesc: 'Fast & light',
    downloadSize: '4.1 GB',
    vramRequired: '8 GB',
    jsonAccuracy: 78,
    speed: 'very-fast',
    tooltip: {
      strengths: ['Fastest inference', 'Lowest resource usage', 'Reliable JSON'],
      bestFor: 'Quick identification when speed matters more than accuracy',
      notes: 'Good for batch processing many discs quickly'
    }
  }
];

export class OllamaProvider extends BaseLLMProvider {
  constructor(config = {}) {
    super('ollama', {
      baseUrl: config.baseUrl || DEFAULT_BASE_URL,
      model: config.model || DEFAULT_MODEL,
      ...config
    });
  }

  /**
   * Get list of approved models
   */
  getModels() {
    return OLLAMA_MODELS;
  }

  /**
   * Check if Ollama is running
   * Uses /api/tags endpoint for consistency with OllamaManager
   */
  async isAvailable() {
    try {
      const response = await fetch(`${this.config.baseUrl}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000)
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Test connection and model availability
   */
  async testConnection() {
    const startTime = Date.now();

    try {
      // Check if Ollama is running
      const available = await this.isAvailable();
      if (!available) {
        return {
          success: false,
          message: 'Ollama is not running. Please start Ollama first.'
        };
      }

      // Check if model is available
      const modelAvailable = await this._isModelAvailable(this.config.model);
      if (!modelAvailable) {
        return {
          success: false,
          message: `Model "${this.config.model}" is not installed. Pull it with: ollama pull ${this.config.model}`
        };
      }

      // Quick query test
      const testResponse = await this.query('Respond with just the word "ok"', {
        max_tokens: 10,
        timeout: 30000
      });

      const latency = Date.now() - startTime;

      return {
        success: true,
        message: `Connected to Ollama with model ${this.config.model}`,
        latency
      };
    } catch (error) {
      return {
        success: false,
        message: `Connection failed: ${error.message}`
      };
    }
  }

  /**
   * Query Ollama with a prompt
   */
  async query(prompt, options = {}) {
    const model = options.model || this.config.model;
    const timeout = options.timeout || QUERY_TIMEOUT;

    log.debug(`Querying Ollama with model ${model}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(`${this.config.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          prompt,
          stream: false,
          format: 'json',
          options: {
            temperature: options.temperature || 0.3,
            num_predict: options.max_tokens || 1000
          }
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Ollama error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      log.debug('Ollama response received', { length: data.response?.length });

      return data.response;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error.name === 'AbortError') {
        throw new Error('Ollama query timeout');
      }
      throw error;
    }
  }

  /**
   * Check if a specific model is available
   */
  async _isModelAvailable(modelName) {
    try {
      const response = await fetch(`${this.config.baseUrl}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000)
      });

      if (!response.ok) return false;

      const data = await response.json();
      const models = data.models || [];

      return models.some(m =>
        m.name === modelName || m.name.startsWith(`${modelName}:`)
      );
    } catch {
      return false;
    }
  }

  /**
   * Get list of installed models from Ollama
   */
  async getInstalledModels() {
    try {
      const response = await fetch(`${this.config.baseUrl}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000)
      });

      if (!response.ok) return [];

      const data = await response.json();
      return (data.models || []).map(m => m.name);
    } catch {
      return [];
    }
  }

  /**
   * Get models with their installation status
   */
  async getModelsWithStatus() {
    const installed = await this.getInstalledModels();

    return OLLAMA_MODELS.map(model => ({
      ...model,
      installed: installed.some(name =>
        name === model.id || name.startsWith(`${model.id.split(':')[0]}:`)
      )
    }));
  }

  /**
   * Pull/download a model from Ollama registry
   * @param {string} modelId - Model ID to pull
   * @param {function} onProgress - Progress callback (percent, status)
   */
  async pullModel(modelId, onProgress = null) {
    log.info(`Starting pull for model: ${modelId}`);

    try {
      const response = await fetch(`${this.config.baseUrl}/api/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: modelId, stream: true })
      });

      if (!response.ok) {
        throw new Error(`Failed to start pull: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let lastPercent = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n').filter(l => l.trim());

        for (const line of lines) {
          try {
            const data = JSON.parse(line);

            if (data.error) {
              throw new Error(data.error);
            }

            // Calculate progress
            let percent = lastPercent;
            if (data.total && data.completed) {
              percent = Math.round((data.completed / data.total) * 100);
              lastPercent = percent;
            }

            if (onProgress) {
              onProgress(percent, data.status || 'downloading');
            }

            log.debug(`Pull progress: ${percent}% - ${data.status}`);
          } catch (e) {
            if (e.message && !e.message.includes('JSON')) {
              throw e;
            }
          }
        }
      }

      log.info(`Model ${modelId} pulled successfully`);
      return { success: true };
    } catch (error) {
      log.error(`Failed to pull model ${modelId}`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Delete a model from Ollama
   * @param {string} modelId - Model ID to delete
   */
  async deleteModel(modelId) {
    log.info(`Deleting model: ${modelId}`);

    try {
      const response = await fetch(`${this.config.baseUrl}/api/delete`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: modelId })
      });

      if (!response.ok) {
        throw new Error(`Failed to delete: ${response.status}`);
      }

      log.info(`Model ${modelId} deleted successfully`);
      return { success: true };
    } catch (error) {
      log.error(`Failed to delete model ${modelId}`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get provider info
   */
  getInfo() {
    return {
      name: 'Ollama',
      model: this.config.model,
      baseUrl: this.config.baseUrl,
      type: 'local'
    };
  }
}

export default OllamaProvider;
