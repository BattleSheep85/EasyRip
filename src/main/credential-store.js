/**
 * Credential Store - Secure storage using Electron safeStorage
 * Encrypts sensitive data like SSH passwords and private key paths
 */

import { safeStorage } from 'electron';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import logger from './logger.js';

const log = {
  info: (msg, data) => logger.info('credential-store', msg, data),
  warn: (msg, data) => logger.warn('credential-store', msg, data),
  error: (msg, data) => logger.error('credential-store', msg, data),
};

const CREDENTIALS_FILE = path.join(os.homedir(), '.easyrip', 'credentials.json');

class CredentialStore {
  constructor() {
    this.cache = null;
    this.initialized = false;
  }

  /**
   * Check if encryption is available
   */
  isEncryptionAvailable() {
    try {
      return safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  }

  /**
   * Get the backend being used for encryption
   */
  getBackend() {
    try {
      return safeStorage.getSelectedStorageBackend?.() || 'unknown';
    } catch {
      return 'unknown';
    }
  }

  /**
   * Load credentials from file
   */
  async loadStore() {
    if (this.cache !== null) return this.cache;

    try {
      await fs.mkdir(path.dirname(CREDENTIALS_FILE), { recursive: true });
      const data = await fs.readFile(CREDENTIALS_FILE, 'utf8');
      this.cache = JSON.parse(data);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        log.warn('Failed to load credentials file', err.message);
      }
      this.cache = {};
    }
    return this.cache;
  }

  /**
   * Save credentials to file
   */
  async saveStore() {
    try {
      await fs.mkdir(path.dirname(CREDENTIALS_FILE), { recursive: true });
      await fs.writeFile(CREDENTIALS_FILE, JSON.stringify(this.cache, null, 2), 'utf8');
    } catch (err) {
      log.error('Failed to save credentials', err.message);
      throw err;
    }
  }

  /**
   * Store an encrypted credential
   * @param {string} key - Credential key (e.g., 'upscale-ssh-password')
   * @param {string} value - Plain text value to encrypt
   */
  async setCredential(key, value) {
    if (!this.isEncryptionAvailable()) {
      throw new Error('Secure storage not available on this system');
    }

    try {
      const encrypted = safeStorage.encryptString(value);
      await this.loadStore();
      this.cache[key] = encrypted.toString('base64');
      await this.saveStore();
      log.info(`Stored credential: ${key}`);
      return true;
    } catch (err) {
      log.error(`Failed to store credential: ${key}`, err.message);
      throw err;
    }
  }

  /**
   * Retrieve and decrypt a credential
   * @param {string} key - Credential key
   * @returns {string|null} Decrypted value or null if not found
   */
  async getCredential(key) {
    if (!this.isEncryptionAvailable()) {
      throw new Error('Secure storage not available on this system');
    }

    await this.loadStore();
    const encrypted = this.cache[key];

    if (!encrypted) {
      return null;
    }

    try {
      const buffer = Buffer.from(encrypted, 'base64');
      return safeStorage.decryptString(buffer);
    } catch (err) {
      log.error(`Failed to decrypt credential: ${key}`, err.message);
      return null;
    }
  }

  /**
   * Check if a credential exists
   * @param {string} key - Credential key
   */
  async hasCredential(key) {
    await this.loadStore();
    return !!this.cache[key];
  }

  /**
   * Delete a credential
   * @param {string} key - Credential key
   */
  async deleteCredential(key) {
    await this.loadStore();
    if (this.cache[key]) {
      delete this.cache[key];
      await this.saveStore();
      log.info(`Deleted credential: ${key}`);
    }
    return true;
  }

  /**
   * List all stored credential keys (not values)
   */
  async listCredentials() {
    await this.loadStore();
    return Object.keys(this.cache);
  }

  /**
   * Clear all stored credentials
   */
  async clearAll() {
    this.cache = {};
    await this.saveStore();
    log.info('Cleared all credentials');
    return true;
  }
}

// Singleton instance
let instance = null;

export function getCredentialStore() {
  if (!instance) {
    instance = new CredentialStore();
  }
  return instance;
}

export default {
  CredentialStore,
  getCredentialStore
};
