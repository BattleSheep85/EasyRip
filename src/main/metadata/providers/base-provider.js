/**
 * Base LLM Provider Class
 * All LLM providers must extend this class and implement these methods
 */

export class BaseLLMProvider {
  constructor(name, config = {}) {
    this.name = name;
    this.config = config;
  }

  /**
   * Query the LLM with a prompt
   * @param {string} prompt - The prompt to send
   * @param {Object} options - Query options (temperature, max_tokens, etc.)
   * @returns {Promise<string>} - Raw response text
   */
  async query(prompt, options = {}) {
    throw new Error(`${this.name}: query() not implemented`);
  }

  /**
   * Check if this provider is available/configured
   * @returns {Promise<boolean>}
   */
  async isAvailable() {
    throw new Error(`${this.name}: isAvailable() not implemented`);
  }

  /**
   * Test the connection to the provider
   * @returns {Promise<{success: boolean, message: string, latency?: number}>}
   */
  async testConnection() {
    throw new Error(`${this.name}: testConnection() not implemented`);
  }

  /**
   * Get list of available models for this provider
   * @returns {Array<{id: string, name: string, description?: string}>}
   */
  getModels() {
    return [];
  }

  /**
   * Get the current model ID
   * @returns {string}
   */
  getModel() {
    return this.config.model || null;
  }

  /**
   * Set the model to use
   * @param {string} modelId
   */
  setModel(modelId) {
    this.config.model = modelId;
  }

  /**
   * Update provider configuration
   * @param {Object} config
   */
  updateConfig(config) {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get provider info for display
   * @returns {Object}
   */
  getInfo() {
    return {
      name: this.name,
      model: this.getModel(),
      available: false
    };
  }
}

export default BaseLLMProvider;
