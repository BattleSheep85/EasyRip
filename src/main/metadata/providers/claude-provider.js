/**
 * Claude API Provider
 * Direct connection to Anthropic's Claude API
 * Supports both API key and OAuth (for Pro/Max subscribers)
 */

import { BaseLLMProvider } from './base-provider.js';
import logger from '../../logger.js';

const log = {
  info: (msg, data) => logger.info('claude-provider', msg, data),
  warn: (msg, data) => logger.warn('claude-provider', msg, data),
  error: (msg, data) => logger.error('claude-provider', msg, data),
  debug: (msg, data) => logger.debug('claude-provider', msg, data),
};

const API_BASE_URL = 'https://api.anthropic.com/v1';
const QUERY_TIMEOUT = 60000; // 60 seconds
const API_VERSION = '2023-06-01';

/**
 * Available Claude models (December 2025)
 * Sources: https://platform.claude.com/docs/en/about-claude/models/overview
 */
const CLAUDE_MODELS = [
  {
    id: 'claude-haiku-4-5-20251001',
    name: 'Claude Haiku 4.5',
    description: 'Fastest, near-frontier ($1/$5 per M)',
    recommended: true
  },
  {
    id: 'claude-sonnet-4-5-20250929',
    name: 'Claude Sonnet 4.5',
    description: 'Best for coding & agents ($3/$15 per M)'
  },
  {
    id: 'claude-opus-4-5-20251101',
    name: 'Claude Opus 4.5',
    description: 'Maximum intelligence ($5/$25 per M)'
  }
];

export class ClaudeProvider extends BaseLLMProvider {
  constructor(config = {}) {
    super('claude', {
      model: config.model || 'claude-3-5-haiku-20241022',
      ...config
    });
    this.apiKey = config.apiKey || null;
    this.oauthToken = config.oauthToken || null;
  }

  /**
   * Set API key (for API console users)
   */
  setApiKey(apiKey) {
    this.apiKey = apiKey;
    this.oauthToken = null; // Clear OAuth if using API key
  }

  /**
   * Set OAuth token (for Pro/Max subscribers)
   */
  setOAuthToken(token) {
    this.oauthToken = token;
    this.apiKey = null; // Clear API key if using OAuth
  }

  /**
   * Get the active auth header
   */
  _getAuthHeader() {
    if (this.apiKey) {
      return { 'x-api-key': this.apiKey };
    }
    if (this.oauthToken) {
      return { 'Authorization': `Bearer ${this.oauthToken}` };
    }
    return null;
  }

  /**
   * Get authentication type
   */
  getAuthType() {
    if (this.apiKey) return 'api_key';
    if (this.oauthToken) return 'oauth';
    return null;
  }

  /**
   * Get list of available models
   */
  getModels() {
    return CLAUDE_MODELS;
  }

  /**
   * Check if provider is configured
   */
  async isAvailable() {
    return !!(this.apiKey || this.oauthToken);
  }

  /**
   * Test connection with the API
   */
  async testConnection() {
    const authHeader = this._getAuthHeader();
    if (!authHeader) {
      return {
        success: false,
        message: 'API key or OAuth token not configured'
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
        message: `Connected to Claude API with model ${this.config.model}`,
        latency
      };
    } catch (error) {
      // Provide helpful error messages
      let message = error.message;
      if (message.includes('401')) {
        message = 'Invalid API key or token';
      } else if (message.includes('402')) {
        message = 'Insufficient credits or subscription expired';
      } else if (message.includes('429')) {
        message = 'Rate limit exceeded, try again later';
      }

      return {
        success: false,
        message: `Connection failed: ${message}`
      };
    }
  }

  /**
   * Query Claude API
   */
  async query(prompt, options = {}) {
    const authHeader = this._getAuthHeader();
    if (!authHeader) {
      throw new Error('Claude API key or OAuth token not configured');
    }

    const model = options.model || this.config.model;
    const timeout = options.timeout || QUERY_TIMEOUT;

    log.debug(`Querying Claude with model ${model}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(`${API_BASE_URL}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'anthropic-version': API_VERSION,
          ...authHeader
        },
        body: JSON.stringify({
          model,
          max_tokens: options.max_tokens || 1000,
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ],
          system: 'You are a disc identification assistant. Always respond with valid JSON only, no other text or explanation.',
          temperature: options.temperature || 0.3
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error?.message || `Claude API error: ${response.status}`);
      }

      const data = await response.json();
      const content = data.content?.[0]?.text;

      if (!content) {
        throw new Error('No response content from Claude');
      }

      log.debug('Claude response received', { length: content.length });
      return content;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error.name === 'AbortError') {
        throw new Error('Claude API query timeout');
      }
      throw error;
    }
  }

  /**
   * Get provider info
   */
  getInfo() {
    return {
      name: 'Claude API',
      model: this.config.model,
      authType: this.getAuthType(),
      hasAuth: !!(this.apiKey || this.oauthToken),
      type: 'cloud'
    };
  }
}

export default ClaudeProvider;
