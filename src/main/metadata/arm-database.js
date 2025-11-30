/**
 * ARM Community Database Client
 * Manages local cache of DVD CRC64 fingerprints and future ARM database integration
 *
 * The ARM (Automatic Ripping Machine) project maintains a community database
 * of DVD CRC64 fingerprints at: https://github.com/automatic-ripping-machine/dvd-crc64-database
 */

import { promises as fs } from 'fs';
import { existsSync } from 'fs';
import path from 'path';
import os from 'os';
import https from 'https';
import logger from '../logger.js';

const log = {
  info: (msg, data) => logger.info('arm-db', msg, data),
  warn: (msg, data) => logger.warn('arm-db', msg, data),
  error: (msg, data) => logger.error('arm-db', msg, data),
  debug: (msg, data) => logger.debug('arm-db', msg, data),
};

// Cache file location
const CACHE_DIR = path.join(os.homedir(), '.easyrip', 'arm-cache');
const CACHE_FILE = path.join(CACHE_DIR, 'dvd-crc64.json');

// ARM GitHub raw URL for database
const ARM_DB_URL = 'https://raw.githubusercontent.com/automatic-ripping-machine/dvd-crc64-database/main/database.json';

// Singleton instance
let instance = null;

/**
 * ARM Database Client
 */
class ARMDatabaseClient {
  constructor() {
    this.cache = new Map();
    this.loaded = false;
    this.lastSync = null;
  }

  /**
   * Load cache from disk
   * @returns {Promise<void>}
   */
  async loadCache() {
    if (this.loaded) {
      return;
    }

    try {
      // Ensure cache directory exists
      await fs.mkdir(CACHE_DIR, { recursive: true });

      if (existsSync(CACHE_FILE)) {
        const data = await fs.readFile(CACHE_FILE, 'utf8');
        const parsed = JSON.parse(data);

        // Load entries into map
        if (parsed.entries && typeof parsed.entries === 'object') {
          for (const [crc64, info] of Object.entries(parsed.entries)) {
            this.cache.set(crc64.toLowerCase(), info);
          }
        }

        this.lastSync = parsed.lastSync || null;
        log.info(`Loaded ${this.cache.size} entries from cache`);
      } else {
        log.info('No cache file found, starting fresh');
      }

      this.loaded = true;
    } catch (error) {
      log.error(`Failed to load cache: ${error.message}`);
      this.loaded = true; // Mark as loaded to prevent retries
    }
  }

  /**
   * Save cache to disk
   * @returns {Promise<void>}
   */
  async saveCache() {
    try {
      await fs.mkdir(CACHE_DIR, { recursive: true });

      const data = {
        version: 1,
        lastSync: this.lastSync,
        savedAt: new Date().toISOString(),
        entries: Object.fromEntries(this.cache)
      };

      await fs.writeFile(CACHE_FILE, JSON.stringify(data, null, 2), 'utf8');
      log.debug(`Saved ${this.cache.size} entries to cache`);
    } catch (error) {
      log.error(`Failed to save cache: ${error.message}`);
    }
  }

  /**
   * Lookup a DVD by CRC64 fingerprint
   * @param {string} crc64 - 16-character hex string
   * @returns {Promise<Object|null>} Match result or null
   */
  async lookup(crc64) {
    await this.loadCache();

    const normalizedCrc = crc64.toLowerCase();
    const match = this.cache.get(normalizedCrc);

    if (match) {
      log.info(`Cache hit for ${crc64}: "${match.title}"`);
      return {
        crc64: crc64,
        title: match.title,
        year: match.year || null,
        type: match.type || 'movie',
        source: match.source || 'local',
        confidence: 0.99 // High confidence for exact CRC64 match
      };
    }

    log.debug(`Cache miss for ${crc64}`);
    return null;
  }

  /**
   * Add a confirmed identification to the cache
   * @param {string} crc64 - 16-character hex string
   * @param {Object} info - { title, year, type }
   * @returns {Promise<void>}
   */
  async addToCache(crc64, info) {
    await this.loadCache();

    const normalizedCrc = crc64.toLowerCase();

    this.cache.set(normalizedCrc, {
      title: info.title,
      year: info.year || null,
      type: info.type || 'movie',
      source: 'local',
      addedAt: new Date().toISOString()
    });

    await this.saveCache();
    log.info(`Added to cache: ${crc64} -> "${info.title}"`);
  }

  /**
   * Sync with ARM community database
   * Downloads the latest database from GitHub and merges with local cache
   * @returns {Promise<{ success: boolean, added: number, error?: string }>}
   */
  async syncWithARM() {
    await this.loadCache();

    log.info('Syncing with ARM community database...');

    try {
      const remoteData = await this.fetchARMDatabase();

      if (!remoteData || !remoteData.entries) {
        return { success: false, added: 0, error: 'Invalid database format' };
      }

      let added = 0;
      for (const [crc64, info] of Object.entries(remoteData.entries)) {
        const normalizedCrc = crc64.toLowerCase();

        // Only add if we don't have it locally
        if (!this.cache.has(normalizedCrc)) {
          this.cache.set(normalizedCrc, {
            ...info,
            source: 'arm'
          });
          added++;
        }
      }

      this.lastSync = new Date().toISOString();
      await this.saveCache();

      log.info(`ARM sync complete: added ${added} new entries`);
      return { success: true, added };

    } catch (error) {
      log.error(`ARM sync failed: ${error.message}`);
      return { success: false, added: 0, error: error.message };
    }
  }

  /**
   * Fetch ARM database from GitHub
   * @returns {Promise<Object>} Database object
   */
  fetchARMDatabase() {
    return new Promise((resolve, reject) => {
      https.get(ARM_DB_URL, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }

        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error('Invalid JSON response'));
          }
        });
      }).on('error', reject);
    });
  }

  /**
   * Submit a new entry to ARM community database
   * NOTE: This is a placeholder - actual submission would require ARM API
   * @param {string} crc64 - 16-character hex string
   * @param {Object} info - { title, year, type }
   * @returns {Promise<boolean>} Success status
   */
  async submitToARM(crc64, info) {
    // TODO: Implement actual ARM API submission when available
    // For now, just log the intended submission
    log.info(`Would submit to ARM: ${crc64} -> "${info.title}" (${info.year})`);
    return false;
  }

  /**
   * Get cache statistics
   * @returns {Object} { entries, cacheFile, lastSync }
   */
  async getStats() {
    await this.loadCache();

    return {
      entries: this.cache.size,
      cacheFile: CACHE_FILE,
      lastSync: this.lastSync
    };
  }

  /**
   * Clear local cache
   * @returns {Promise<void>}
   */
  async clearCache() {
    this.cache.clear();
    this.lastSync = null;

    try {
      if (existsSync(CACHE_FILE)) {
        await fs.unlink(CACHE_FILE);
      }
      log.info('Cache cleared');
    } catch (error) {
      log.error(`Failed to clear cache: ${error.message}`);
    }
  }
}

/**
 * Get singleton ARM database client instance
 * @returns {ARMDatabaseClient}
 */
export function getARMDatabase() {
  if (!instance) {
    instance = new ARMDatabaseClient();
  }
  return instance;
}

export default {
  getARMDatabase,
  ARMDatabaseClient
};
