/**
 * OpenRouter LLM Provider
 * Cloud-based access to multiple LLM providers via OpenRouter.ai
 */

import { BaseLLMProvider } from './base-provider.js';
import logger from '../../logger.js';

const log = {
  info: (msg, data) => logger.info('openrouter-provider', msg, data),
  warn: (msg, data) => logger.warn('openrouter-provider', msg, data),
  error: (msg, data) => logger.error('openrouter-provider', msg, data),
  debug: (msg, data) => logger.debug('openrouter-provider', msg, data),
};

const API_BASE_URL = 'https://openrouter.ai/api/v1';
const QUERY_TIMEOUT = 60000; // 60 seconds

/**
 * Curated list of models good for JSON output
 * Sources: https://openrouter.ai/models
 */
const OPENROUTER_MODELS = [
  {
    id: 'anthropic/claude-3.5-haiku',
    name: 'Claude 3.5 Haiku',
    description: 'Fast, affordable ($0.25/$1.25 per M)',
    recommended: true
  },
  {
    id: 'anthropic/claude-3.5-sonnet',
    name: 'Claude 3.5 Sonnet',
    description: 'Best balance ($3/$15 per M)'
  },
  {
    id: 'anthropic/claude-3-opus',
    name: 'Claude 3 Opus',
    description: 'Most capable ($15/$75 per M)'
  },
  {
    id: 'openai/gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: 'Fast & cheap ($0.15/$0.60 per M)'
  },
  {
    id: 'openai/gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI flagship ($2.50/$10 per M)'
  },
  {
    id: 'google/gemini-pro-1.5',
    name: 'Gemini Pro 1.5',
    description: 'Google latest ($1.25/$5 per M)'
  },
  {
    id: 'google/gemini-flash-1.5',
    name: 'Gemini Flash 1.5',
    description: 'Google fast ($0.075/$0.30 per M)'
  },
  {
    id: 'meta-llama/llama-3.1-70b-instruct',
    name: 'Llama 3.1 70B',
    description: 'Open source, capable ($0.52/$0.75 per M)'
  },
  {
    id: 'mistralai/mistral-large',
    name: 'Mistral Large',
    description: 'Strong reasoning ($2/$6 per M)'
  },
  {
    id: 'qwen/qwen-2.5-72b-instruct',
    name: 'Qwen 2.5 72B',
    description: 'Alibaba flagship ($0.35/$0.40 per M)'
  }
];

export class OpenRouterProvider extends BaseLLMProvider {
  constructor(config = {}) {
    super('openrouter', {
      model: config.model || 'anthropic/claude-3.5-haiku',
      ...config
    });
    this.apiKey = config.apiKey || null;
  }

  /**
   * Set API key
   */
  setApiKey(apiKey) {
    this.apiKey = apiKey;
  }

  /**
   * Get list of available models
   */
  getModels() {
    return OPENROUTER_MODELS;
  }

  /**
   * Check if provider is configured
   */
  async isAvailable() {
    return !!this.apiKey;
  }

  /**
   * Test connection with the API
   */
  async testConnection() {
    if (!this.apiKey) {
      return {
        success: false,
        message: 'API key not configured'
      };
    }

    const startTime = Date.now();

    try {
      // Test with a minimal query
      const response = await this.query('Respond with just the word "ok"', {
        max_tokens: 10,
        timeout: 30000
      });

      const latency = Date.now() - startTime;

      return {
        success: true,
        message: `Connected to OpenRouter with model ${this.config.model}`,
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
   * Query OpenRouter
   */
  async query(prompt, options = {}) {
    if (!this.apiKey) {
      throw new Error('OpenRouter API key not configured');
    }

    const model = options.model || this.config.model;
    const timeout = options.timeout || QUERY_TIMEOUT;

    log.debug(`Querying OpenRouter with model ${model}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(`${API_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
          'HTTP-Referer': 'https://easyrip.app',
          'X-Title': 'EasyRip Disc Backup'
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'system',
              content: 'You are a disc identification assistant. Always respond with valid JSON only, no other text.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: options.temperature || 0.3,
          max_tokens: options.max_tokens || 1000,
          response_format: { type: 'json_object' }
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error?.message || `OpenRouter error: ${response.status}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;

      if (!content) {
        throw new Error('No response content from OpenRouter');
      }

      log.debug('OpenRouter response received', { length: content.length });
      return content;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error.name === 'AbortError') {
        throw new Error('OpenRouter query timeout');
      }
      throw error;
    }
  }

  /**
   * Get provider info
   */
  getInfo() {
    return {
      name: 'OpenRouter',
      model: this.config.model,
      hasApiKey: !!this.apiKey,
      type: 'cloud'
    };
  }
}

export default OpenRouterProvider;
