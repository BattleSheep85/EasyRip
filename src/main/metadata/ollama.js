/**
 * Ollama Lifecycle Management
 * Handles installation, startup, shutdown, and LLM queries
 */

import { spawn, execFile } from 'child_process';
import { existsSync, createWriteStream, unlinkSync } from 'fs';
import { mkdir } from 'fs/promises';
import path from 'path';
import https from 'https';
import http from 'http';
import logger from '../logger.js';

// Create a simple log wrapper with category
const log = {
  info: (msg, data) => logger.info('ollama', msg, data),
  warn: (msg, data) => logger.warn('ollama', msg, data),
  error: (msg, data) => logger.error('ollama', msg, data),
  debug: (msg, data) => logger.debug('ollama', msg, data),
};

// Ollama configuration
const OLLAMA_DOWNLOAD_URL = 'https://github.com/ollama/ollama/releases/latest/download/OllamaSetup.exe';
const OLLAMA_API_URL = 'http://127.0.0.1:11434';
const DEFAULT_MODEL = 'llama3.2';
const HEALTH_CHECK_TIMEOUT = 5000;
const STARTUP_TIMEOUT = 30000;
const QUERY_TIMEOUT = 120000; // 2 minutes for LLM response

/**
 * Get expected Ollama installation paths
 */
function getOllamaPaths() {
  const localAppData = process.env.LOCALAPPDATA || '';
  return {
    exe: path.join(localAppData, 'Programs', 'Ollama', 'ollama.exe'),
    appExe: path.join(localAppData, 'Programs', 'Ollama', 'ollama app.exe'),
    installer: path.join(localAppData, 'Temp', 'OllamaSetup.exe')
  };
}

/**
 * OllamaManager class
 * Singleton manager for Ollama lifecycle
 */
export class OllamaManager {
  constructor() {
    this.process = null;
    this.model = DEFAULT_MODEL;
    this.isInstalling = false;
    this.isPulling = false;
    this.onProgress = null; // Callback for progress updates
  }

  /**
   * Set progress callback
   * @param {Function} callback - (stage, percent, message) => void
   */
  setProgressCallback(callback) {
    this.onProgress = callback;
  }

  /**
   * Emit progress update
   */
  _emitProgress(stage, percent, message) {
    log.info(`[${stage}] ${percent}% - ${message}`);
    if (this.onProgress) {
      this.onProgress(stage, percent, message);
    }
  }

  /**
   * Check if Ollama is installed
   * @returns {boolean}
   */
  isInstalled() {
    const paths = getOllamaPaths();
    const installed = existsSync(paths.exe);
    log.info(`Ollama installed: ${installed} (checked ${paths.exe})`);
    return installed;
  }

  /**
   * Get Ollama executable path
   * @returns {string|null}
   */
  getExePath() {
    const paths = getOllamaPaths();
    if (existsSync(paths.exe)) return paths.exe;
    return null;
  }

  /**
   * Check if Ollama server is running
   * Uses native http module for reliability in Electron main process
   * @returns {Promise<boolean>}
   */
  async isRunning() {
    return new Promise((resolve) => {
      const req = http.get(`${OLLAMA_API_URL}/api/tags`, { timeout: HEALTH_CHECK_TIMEOUT }, (res) => {
        resolve(res.statusCode === 200);
      });

      req.on('error', (err) => {
        log.debug(`Health check failed: ${err.message}`);
        resolve(false);
      });

      req.on('timeout', () => {
        log.debug('Health check timed out');
        req.destroy();
        resolve(false);
      });
    });
  }

  /**
   * Download Ollama installer
   * @returns {Promise<string>} Path to downloaded installer
   */
  async downloadInstaller() {
    const paths = getOllamaPaths();
    const installerPath = paths.installer;

    // Ensure temp directory exists
    await mkdir(path.dirname(installerPath), { recursive: true });

    // Remove existing installer if present
    if (existsSync(installerPath)) {
      unlinkSync(installerPath);
    }

    this._emitProgress('download', 0, 'Starting Ollama download...');

    return new Promise((resolve, reject) => {
      const file = createWriteStream(installerPath);
      let totalSize = 0;
      let downloadedSize = 0;

      const handleResponse = (response) => {
        // Handle redirects
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          log.info(`Redirect to: ${response.headers.location}`);
          https.get(response.headers.location, handleResponse).on('error', reject);
          return;
        }

        if (response.statusCode !== 200) {
          reject(new Error(`Download failed: HTTP ${response.statusCode}`));
          return;
        }

        totalSize = parseInt(response.headers['content-length'] || '0', 10);

        response.on('data', (chunk) => {
          downloadedSize += chunk.length;
          if (totalSize > 0) {
            const percent = Math.round((downloadedSize / totalSize) * 100);
            this._emitProgress('download', percent, `Downloading Ollama (${Math.round(downloadedSize / 1024 / 1024)}MB)`);
          }
        });

        response.pipe(file);

        file.on('finish', () => {
          file.close();
          log.info(`Ollama installer downloaded to ${installerPath}`);
          this._emitProgress('download', 100, 'Download complete');
          resolve(installerPath);
        });
      };

      https.get(OLLAMA_DOWNLOAD_URL, handleResponse).on('error', (err) => {
        file.close();
        if (existsSync(installerPath)) unlinkSync(installerPath);
        reject(err);
      });
    });
  }

  /**
   * Run Ollama installer silently
   * @returns {Promise<boolean>}
   */
  async install() {
    if (this.isInstalling) {
      log.warn('Installation already in progress');
      return false;
    }

    this.isInstalling = true;
    this._emitProgress('install', 0, 'Starting installation...');

    try {
      const installerPath = await this.downloadInstaller();

      this._emitProgress('install', 50, 'Running installer...');

      return new Promise((resolve, reject) => {
        // Run silent installation using execFile for security (no shell interpolation)
        const { execFile } = require('child_process');
        const installer = execFile(installerPath, ['/SILENT', '/NORESTART'], {
          windowsHide: true
        }, (error, stdout, stderr) => {
          this.isInstalling = false;

          if (error) {
            log.error('Installation failed:', error);
            this._emitProgress('install', 0, `Installation failed: ${error.message}`);
            reject(error);
            return;
          }

          // Verify installation
          if (this.isInstalled()) {
            log.info('Ollama installed successfully');
            this._emitProgress('install', 100, 'Installation complete');
            resolve(true);
          } else {
            log.error('Installation completed but Ollama not found');
            this._emitProgress('install', 0, 'Installation verification failed');
            reject(new Error('Installation verification failed'));
          }
        });

        installer.on('error', (err) => {
          this.isInstalling = false;
          reject(err);
        });
      });
    } catch (error) {
      this.isInstalling = false;
      throw error;
    }
  }

  /**
   * Ensure Ollama is installed, downloading if necessary
   * @returns {Promise<boolean>}
   */
  async ensureInstalled() {
    if (this.isInstalled()) {
      log.info('Ollama already installed');
      return true;
    }

    log.info('Ollama not found, installing...');
    return this.install();
  }

  /**
   * Start Ollama server
   * @returns {Promise<boolean>}
   */
  async start() {
    // Check if already running
    if (await this.isRunning()) {
      log.info('Ollama server already running');
      return true;
    }

    const exePath = this.getExePath();
    if (!exePath) {
      log.error('Cannot start Ollama: not installed');
      return false;
    }

    this._emitProgress('start', 0, 'Starting Ollama server...');

    return new Promise((resolve) => {
      // Start Ollama serve command
      this.process = spawn(exePath, ['serve'], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      });

      this.process.unref();

      // Store PID for later cleanup
      if (this.process.pid) {
        log.info(`Ollama server started with PID ${this.process.pid}`);
      }

      // Wait for server to be ready
      const startTime = Date.now();
      const checkReady = async () => {
        if (await this.isRunning()) {
          this._emitProgress('start', 100, 'Ollama server ready');
          resolve(true);
          return;
        }

        if (Date.now() - startTime > STARTUP_TIMEOUT) {
          log.error('Ollama server startup timeout');
          this._emitProgress('start', 0, 'Startup timeout');
          resolve(false);
          return;
        }

        setTimeout(checkReady, 500);
      };

      setTimeout(checkReady, 1000);
    });
  }

  /**
   * Stop Ollama server
   * @returns {Promise<void>}
   */
  async stop() {
    log.info('Stopping Ollama server...');

    // Try graceful shutdown via API first
    try {
      // Ollama doesn't have a shutdown endpoint, so we use taskkill
      await new Promise((resolve, reject) => {
        execFile('taskkill', ['/F', '/IM', 'ollama.exe'], { windowsHide: true }, (error) => {
          // Ignore errors - process might not be running
          resolve();
        });
      });

      // Also kill any ollama_llama_server processes
      await new Promise((resolve) => {
        execFile('taskkill', ['/F', '/IM', 'ollama_llama_server.exe'], { windowsHide: true }, () => resolve());
      });

    } catch (error) {
      log.warn('Error stopping Ollama:', error.message);
    }

    this.process = null;
    log.info('Ollama server stopped');
  }

  /**
   * Check if a model is available locally
   * Uses native http module for reliability in Electron main process
   * @param {string} modelName - Model name to check
   * @returns {Promise<boolean>}
   */
  async hasModel(modelName = this.model) {
    return new Promise((resolve) => {
      const req = http.get(`${OLLAMA_API_URL}/api/tags`, { timeout: HEALTH_CHECK_TIMEOUT }, (res) => {
        if (res.statusCode !== 200) {
          resolve(false);
          return;
        }

        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            const models = parsed.models || [];
            const found = models.some(m => m.name === modelName || m.name.startsWith(`${modelName}:`));
            log.debug(`Model check for ${modelName}: ${found ? 'found' : 'not found'} (available: ${models.map(m => m.name).join(', ')})`);
            resolve(found);
          } catch {
            resolve(false);
          }
        });
      });

      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
    });
  }

  /**
   * Pull a model if not present
   * @param {string} modelName - Model name to pull
   * @returns {Promise<boolean>}
   */
  async ensureModel(modelName = this.model) {
    if (await this.hasModel(modelName)) {
      log.info(`Model ${modelName} already available`);
      return true;
    }

    if (this.isPulling) {
      log.warn('Model pull already in progress');
      return false;
    }

    this.isPulling = true;
    this._emitProgress('pull', 0, `Downloading ${modelName} model...`);

    try {
      const response = await fetch(`${OLLAMA_API_URL}/api/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: modelName, stream: true })
      });

      if (!response.ok) {
        throw new Error(`Pull failed: ${response.status}`);
      }

      // Handle streaming response
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let lastPercent = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value);
        const lines = text.split('\n').filter(l => l.trim());

        for (const line of lines) {
          try {
            const data = JSON.parse(line);
            if (data.total && data.completed) {
              const percent = Math.round((data.completed / data.total) * 100);
              if (percent !== lastPercent) {
                lastPercent = percent;
                this._emitProgress('pull', percent, `Downloading ${modelName} (${percent}%)`);
              }
            }
            if (data.status === 'success') {
              this._emitProgress('pull', 100, `Model ${modelName} ready`);
            }
          } catch {
            // Ignore parse errors for incomplete JSON
          }
        }
      }

      this.isPulling = false;
      return true;

    } catch (error) {
      this.isPulling = false;
      log.error('Model pull failed:', error);
      this._emitProgress('pull', 0, `Failed to download model: ${error.message}`);
      return false;
    }
  }

  /**
   * Send a query to Ollama for disc identification
   * @param {Object} extractedData - Parsed disc data
   * @returns {Promise<Object>} LLM response with structured output
   */
  async identifyDisc(extractedData) {
    if (!await this.isRunning()) {
      throw new Error('Ollama server not running');
    }

    if (!await this.hasModel(this.model)) {
      throw new Error(`Model ${this.model} not available`);
    }

    const prompt = this._buildIdentificationPrompt(extractedData);

    log.info('Sending identification request to Ollama...');
    log.debug('Prompt:', prompt);

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), QUERY_TIMEOUT);

      const response = await fetch(`${OLLAMA_API_URL}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt: prompt,
          stream: false,
          format: 'json',
          options: {
            temperature: 0.3, // Lower for more deterministic output
            num_predict: 500  // Limit response length
          }
        }),
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status}`);
      }

      const data = await response.json();
      log.debug('Raw LLM response:', data.response);

      // Parse the JSON response
      const result = this._parseIdentificationResponse(data.response);
      log.info('Identification result:', result);

      return result;

    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error('LLM query timeout');
      }
      throw error;
    }
  }

  /**
   * Build the prompt for disc identification
   * @param {Object} data - Extracted disc data
   * @returns {string} Prompt string
   */
  _buildIdentificationPrompt(data) {
    const { disc, extracted } = data;

    // Find main feature (longest title)
    const mainFeature = extracted.titles?.reduce((longest, current) =>
      (current.duration > (longest?.duration || 0)) ? current : longest, null);

    const mainDuration = mainFeature ? Math.round(mainFeature.duration / 60) : 'unknown';

    // Build context about the disc
    let context = `Disc Type: ${disc.type?.toUpperCase() || 'Unknown'}\n`;
    context += `Volume Label: ${disc.volumeLabel || 'Unknown'}\n`;
    context += `Main Feature Duration: ${mainDuration} minutes\n`;
    context += `Total Titles: ${extracted.titles?.length || 0}\n`;

    if (mainFeature?.audioTracks?.length > 0) {
      context += `Audio Tracks: ${mainFeature.audioTracks.join(', ')}\n`;
    }

    if (mainFeature?.subtitles?.length > 0) {
      context += `Subtitles: ${mainFeature.subtitles.join(', ')}\n`;
    }

    if (extracted.dvdInfo) {
      if (extracted.dvdInfo.regionCode) {
        context += `DVD Region: ${extracted.dvdInfo.regionCode}\n`;
      }
    }

    return `You are a movie and TV show identification expert. Based on the following disc metadata, identify what movie or TV show this disc contains.

${context}

Analyze the disc label, duration, and other metadata to make your best guess. Consider:
- Standard movie runtimes (90-180 minutes for films)
- TV show discs often have multiple episodes (30-60 minute titles)
- The volume label often contains hints about the title

CRITICAL CONFIDENCE SCORING RULES - You MUST follow these strictly:

1. HIGH confidence (0.85-0.95): Only when the disc label clearly identifies a unique title with year or distinguishing info, OR the title is so unique it can only be one thing.

2. MEDIUM confidence (0.50-0.70): When you can identify the title but:
   - Multiple versions/remakes exist (e.g., "How to Train Your Dragon" has 2010 and 2019 versions)
   - No year is determinable from the metadata
   - The title is a franchise with multiple entries (sequels, series)

3. LOW confidence (0.20-0.40): When:
   - The disc label is very short/vague (under 10 characters)
   - The label could match multiple unrelated titles
   - Limited metadata makes identification speculative
   - The title is obscure or could be a subtitle/alternate name

4. VERY LOW confidence (0.05-0.15): When:
   - The label is generic (e.g., "DISC1", "MOVIE", "VIDEO")
   - No meaningful identification clues exist
   - Pure guesswork based on duration alone

If "year" cannot be determined with certainty, set it to null. Do NOT guess a year.
If multiple versions exist and you cannot distinguish which one, your confidence MUST be 0.50 or lower.

Respond with ONLY valid JSON in this exact format:
{
  "title": "The Movie or Show Title",
  "year": 2023,
  "type": "movie",
  "confidence": 0.85,
  "reasoning": "Brief explanation including any ambiguity factors",
  "hasMultipleVersions": false
}

Set "hasMultipleVersions" to true if you know multiple versions/remakes of this title exist.
Set "year" to null if you cannot determine it from the disc metadata.

For type, use "movie" or "tv". For TV shows, also include:
{
  "title": "Show Name",
  "year": null,
  "type": "tv",
  "confidence": 0.60,
  "reasoning": "Identified as TV show but cannot determine specific season/version",
  "hasMultipleVersions": true,
  "tvInfo": {
    "season": 1,
    "episodes": [1, 2, 3]
  }
}

Important: Respond with ONLY the JSON object, no other text.`;
  }

  /**
   * Parse the LLM identification response
   * @param {string} response - Raw response string
   * @returns {Object} Parsed identification result
   */
  _parseIdentificationResponse(response) {
    try {
      // Try to parse as JSON directly
      const parsed = JSON.parse(response);
      return {
        title: parsed.title || null,
        year: parsed.year || null,
        type: parsed.type || 'movie',
        confidence: Math.min(1, Math.max(0, parsed.confidence || 0.5)),
        reasoning: parsed.reasoning || '',
        tvInfo: parsed.tvInfo || null,
        hasMultipleVersions: parsed.hasMultipleVersions || false
      };
    } catch {
      // Try to extract JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          return {
            title: parsed.title || null,
            year: parsed.year || null,
            type: parsed.type || 'movie',
            confidence: Math.min(1, Math.max(0, parsed.confidence || 0.5)),
            reasoning: parsed.reasoning || '',
            tvInfo: parsed.tvInfo || null,
            hasMultipleVersions: parsed.hasMultipleVersions || false
          };
        } catch {
          log.warn('Failed to parse extracted JSON');
        }
      }

      // Return a default failed result
      return {
        title: null,
        year: null,
        type: 'movie',
        confidence: 0,
        reasoning: 'Failed to parse LLM response',
        tvInfo: null,
        hasMultipleVersions: false
      };
    }
  }

  /**
   * Get current status
   * @returns {Promise<Object>}
   */
  async getStatus() {
    const installed = this.isInstalled();
    const running = installed ? await this.isRunning() : false;
    const hasModel = running ? await this.hasModel(this.model) : false;

    return {
      installed,
      running,
      model: this.model,
      hasModel,
      isInstalling: this.isInstalling,
      isPulling: this.isPulling
    };
  }
}

// Export singleton instance
let instance = null;

export function getOllamaManager() {
  if (!instance) {
    instance = new OllamaManager();
  }
  return instance;
}

export default {
  OllamaManager,
  getOllamaManager
};
