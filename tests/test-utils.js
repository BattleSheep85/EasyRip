// Shared Test Utilities and Helpers
// Common functions used across test suites

import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

/**
 * Create a temporary test directory
 * @returns {Promise<string>} Path to temporary directory
 */
export async function createTempDir() {
  const tempDir = path.join(os.tmpdir(), `easyrip-test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
  await fs.mkdir(tempDir, { recursive: true });
  return tempDir;
}

/**
 * Clean up a temporary directory
 * @param {string} dirPath - Directory to remove
 * @returns {Promise<void>}
 */
export async function cleanupTempDir(dirPath) {
  try {
    await fs.rm(dirPath, { recursive: true, force: true });
  } catch (err) {
    // Ignore errors
  }
}

/**
 * Create a test file with specified size
 * @param {string} filePath - Path to create file at
 * @param {number} sizeInBytes - Size in bytes
 * @returns {Promise<void>}
 */
export async function createTestFile(filePath, sizeInBytes) {
  const buffer = Buffer.alloc(sizeInBytes);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, buffer);
}

/**
 * Create a test folder structure
 * @param {string} baseDir - Base directory
 * @param {Object} structure - Folder structure object
 * @example
 * await createFolderStructure('/tmp/test', {
 *   'file1.txt': 1024,
 *   'subfolder/file2.txt': 2048,
 *   'subfolder/deep/file3.txt': 4096
 * });
 * @returns {Promise<void>}
 */
export async function createFolderStructure(baseDir, structure) {
  for (const [filePath, sizeInBytes] of Object.entries(structure)) {
    const fullPath = path.join(baseDir, filePath);
    await createTestFile(fullPath, sizeInBytes);
  }
}

/**
 * Get total size of a directory
 * @param {string} dirPath - Directory path
 * @returns {Promise<number>} Total size in bytes
 */
export async function getDirectorySize(dirPath) {
  let totalSize = 0;

  async function walkDir(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walkDir(fullPath);
      } else {
        const stat = await fs.stat(fullPath);
        totalSize += stat.size;
      }
    }
  }

  await walkDir(dirPath);
  return totalSize;
}

/**
 * Count files in a directory
 * @param {string} dirPath - Directory path
 * @returns {Promise<number>} Number of files
 */
export async function countFiles(dirPath) {
  let count = 0;

  async function walkDir(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walkDir(fullPath);
      } else {
        count++;
      }
    }
  }

  try {
    await walkDir(dirPath);
  } catch (err) {
    // Directory doesn't exist
  }

  return count;
}

/**
 * Create a mock logger for testing
 * @returns {Object} Mock logger with methods
 */
export function createMockLogger() {
  const logs = [];

  return {
    logs,
    info: (category, message, data) => {
      logs.push({ level: 'INFO', category, message, data });
    },
    warn: (category, message, data) => {
      logs.push({ level: 'WARN', category, message, data });
    },
    error: (category, message, data) => {
      logs.push({ level: 'ERROR', category, message, data });
    },
    debug: (category, message, data) => {
      logs.push({ level: 'DEBUG', category, message, data });
    },
    clear: () => {
      logs.length = 0;
    },
    getLogs: (category = null, level = null) => {
      return logs.filter(log => {
        if (category && log.category !== category) return false;
        if (level && log.level !== level) return false;
        return true;
      });
    }
  };
}

/**
 * Create a mock drive detector
 * @param {Array} drives - Array of drive objects to return
 * @returns {Object} Mock drive detector
 */
export function createMockDriveDetector(drives = []) {
  return {
    drives,
    detectionErrors: [],
    lastError: null,
    detectDrives: async () => drives,
    getDetectionErrors: () => [],
    getMakeMKVMapping: () => new Map(),
    getDiscSizeSync: () => 4700000000,
    ejectDrive: async () => ({ success: true })
  };
}

/**
 * Create a mock MakeMKV adapter
 * @param {Object} overrides - Properties to override
 * @returns {Object} Mock adapter
 */
export function createMockMakeMKV(overrides = {}) {
  return {
    makemkvPath: 'C:\\Program Files (x86)\\MakeMKV\\makemkvcon64.exe',
    basePath: 'D:\\EasyRip',
    currentProcess: null,
    lastError: null,
    loadSettings: async () => {},
    getSettings: async () => ({
      makemkvPath: 'C:\\Program Files (x86)\\MakeMKV\\makemkvcon64.exe',
      basePath: 'D:\\EasyRip',
      tmdbApiKey: '',
      transfer: null,
      automation: { autoBackup: false, autoMeta: true, autoExport: false, liveDangerously: false, ejectAfterBackup: false }
    }),
    saveSettings: async () => {},
    checkBackupStatus: async () => ({ status: 'none' }),
    startBackup: async () => ({ path: 'D:\\EasyRip\\backup\\test', size: 4700000000 }),
    cancelBackup: () => {},
    countFiles: async () => 0,
    getBackupSize: async () => 0,
    formatSize: (bytes) => `${bytes} B`,
    deleteBackup: async () => true,
    isDVDImage: async () => false,
    getLastError: () => null,
    ...overrides
  };
}

/**
 * Retry a test assertion until it passes
 * @param {Function} fn - Function that returns assertion or throws
 * @param {Object} options - Options
 * @param {number} options.maxRetries - Max retries (default 5)
 * @param {number} options.delayMs - Delay between retries (default 100ms)
 * @returns {Promise<void>}
 */
export async function retryAssertion(fn, options = {}) {
  const { maxRetries = 5, delayMs = 100 } = options;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      await fn();
      return; // Success
    } catch (err) {
      if (attempt === maxRetries) {
        throw err; // Final attempt failed
      }
      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
}

/**
 * Wait for a condition to be true
 * @param {Function} condition - Function that returns boolean
 * @param {Object} options - Options
 * @param {number} options.timeoutMs - Timeout in milliseconds (default 5000)
 * @param {number} options.intervalMs - Check interval (default 100ms)
 * @returns {Promise<boolean>}
 */
export async function waitUntil(condition, options = {}) {
  const { timeoutMs = 5000, intervalMs = 100 } = options;
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    if (await condition()) {
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  return false;
}

/**
 * Mock IPC event handler
 * @returns {Object} Mock ipcMain
 */
export function createMockIPC() {
  const handlers = new Map();

  return {
    handlers,
    handle: (channel, fn) => {
      handlers.set(channel, fn);
    },
    invoke: async (channel, ...args) => {
      const handler = handlers.get(channel);
      if (!handler) throw new Error(`No handler for ${channel}`);
      return handler(null, ...args);
    },
    getHandler: (channel) => handlers.get(channel),
    clear: () => handlers.clear()
  };
}

/**
 * Measure execution time
 * @param {Function} fn - Async function to measure
 * @returns {Promise<{time: number, result: any}>}
 */
export async function measureTime(fn) {
  const start = Date.now();
  const result = await fn();
  const time = Date.now() - start;
  return { time, result };
}

/**
 * Create a batch of test data
 * @param {number} count - Number of items
 * @param {Function} generator - Function to generate item
 * @returns {Array}
 */
export function createTestBatch(count, generator) {
  const items = [];
  for (let i = 0; i < count; i++) {
    items.push(generator(i));
  }
  return items;
}

/**
 * Verify file exists and has expected properties
 * @param {string} filePath - Path to file
 * @param {Object} options - Options
 * @param {number} options.minSize - Minimum size in bytes
 * @param {number} options.maxSize - Maximum size in bytes
 * @returns {Promise<boolean>}
 */
export async function verifyFile(filePath, options = {}) {
  try {
    const stat = await fs.stat(filePath);
    if (options.minSize && stat.size < options.minSize) return false;
    if (options.maxSize && stat.size > options.maxSize) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Create test configuration
 * @param {Object} overrides - Config overrides
 * @returns {Object} Test config
 */
export function createTestConfig(overrides = {}) {
  return {
    basePath: 'D:\\EasyRip',
    makemkvPath: 'C:\\Program Files (x86)\\MakeMKV\\makemkvcon64.exe',
    tmdbApiKey: 'test-key',
    makemkvKey: '',
    transfer: null,
    metadata: {},
    automation: {
      autoBackup: false,
      autoMeta: true,
      autoExport: false,
      liveDangerously: false,
      ejectAfterBackup: false
    },
    ...overrides
  };
}
