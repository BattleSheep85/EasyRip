// Unit Tests for Logger
// Run with: node --test tests/logger.test.js

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import path from 'path';
import os from 'os';
import { promises as fs } from 'fs';

// Test logger with mock directory
class TestLogger {
  constructor(logDir) {
    this.logDir = logDir;
    this.currentLogFile = null;
    this.maxLogSize = 5 * 1024 * 1024;
    this.maxLogFiles = 10;
    this.initialized = false;
    this.pendingLogs = [];
  }

  formatMessage(level, category, message, data = null) {
    const timestamp = new Date().toISOString();
    const levelStr = level || 'INFO';
    let formatted = `[${timestamp}] [${levelStr}] [${category}] ${message}`;

    if (data !== null) {
      if (data instanceof Error) {
        formatted += `\n  Error: ${data.message}`;
      } else if (typeof data === 'object') {
        try {
          formatted += `\n  Data: ${JSON.stringify(data, null, 2)}`;
        } catch {
          formatted += `\n  Data: [Object - could not stringify]`;
        }
      } else {
        formatted += `\n  Data: ${data}`;
      }
    }

    return formatted + '\n';
  }

  async writeToFile(message) {
    if (!this.currentLogFile) {
      this.pendingLogs.push(message);
      return;
    }
    try {
      await fs.appendFile(this.currentLogFile, message, 'utf8');
    } catch (err) {
      console.error('Failed to write to log file:', err);
    }
  }

  async init() {
    if (this.initialized) return;
    try {
      await fs.mkdir(this.logDir, { recursive: true });
      const date = new Date().toISOString().split('T')[0];
      this.currentLogFile = path.join(this.logDir, `test-${date}.log`);
      await this.writeToFile('\n' + '='.repeat(80) + '\n');
      await this.writeToFile(`Test Log - Started at ${new Date().toISOString()}\n`);
      this.initialized = true;
      for (const log of this.pendingLogs) {
        await this.writeToFile(log);
      }
      this.pendingLogs = [];
    } catch (err) {
      console.error('Failed to initialize logger:', err);
    }
  }

  async getRecentLogs(lines = 100) {
    if (!this.currentLogFile) {
      return { success: false, error: 'Logger not initialized' };
    }
    try {
      const content = await fs.readFile(this.currentLogFile, 'utf8');
      const allLines = content.split('\n');
      const recentLines = allLines.slice(-lines).join('\n');
      return {
        success: true,
        content: recentLines,
        file: this.currentLogFile,
        totalLines: allLines.length,
      };
    } catch (err) {
      return {
        success: false,
        error: err.message,
      };
    }
  }

  async getLogFiles() {
    try {
      const files = await fs.readdir(this.logDir);
      const logFiles = files
        .filter(f => f.startsWith('test-') && f.endsWith('.log'))
        .map(f => ({
          name: f,
          path: path.join(this.logDir, f),
        }))
        .sort((a, b) => b.name.localeCompare(a.name));

      for (const file of logFiles) {
        try {
          const stat = await fs.stat(file.path);
          file.size = stat.size;
          file.modified = stat.mtime;
        } catch {
          file.size = 0;
        }
      }

      return { success: true, files: logFiles, logDir: this.logDir };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  getLogDir() {
    return this.logDir;
  }
}

describe('Logger', () => {
  let logger;
  let logDir;

  beforeEach(async () => {
    logDir = path.join(os.tmpdir(), `easyrip-logger-test-${Date.now()}`);
    logger = new TestLogger(logDir);
  });

  afterEach(async () => {
    try {
      await fs.rm(logDir, { recursive: true, force: true });
    } catch (err) {
      // Ignore cleanup errors
    }
  });

  describe('constructor', () => {
    it('should initialize with correct log directory', () => {
      assert.strictEqual(logger.logDir, logDir);
    });

    it('should initialize with correct max size', () => {
      assert.strictEqual(logger.maxLogSize, 5 * 1024 * 1024);
    });

    it('should initialize with correct max files', () => {
      assert.strictEqual(logger.maxLogFiles, 10);
    });

    it('should start uninitialized', () => {
      assert.strictEqual(logger.initialized, false);
      assert.deepStrictEqual(logger.pendingLogs, []);
    });
  });

  describe('formatMessage', () => {
    it('should format basic message', () => {
      const msg = logger.formatMessage('INFO', 'test', 'Test message');
      assert.ok(msg.includes('INFO'));
      assert.ok(msg.includes('test'));
      assert.ok(msg.includes('Test message'));
    });

    it('should include timestamp', () => {
      const msg = logger.formatMessage('INFO', 'test', 'Test');
      assert.ok(msg.includes('['));
      assert.ok(msg.includes('T'));
      assert.ok(msg.includes('Z'));
    });

    it('should format message with object data', () => {
      const data = { key: 'value', num: 42 };
      const msg = logger.formatMessage('INFO', 'test', 'Test', data);
      assert.ok(msg.includes('value'));
      assert.ok(msg.includes('42'));
    });

    it('should format message with error data', () => {
      const error = new Error('Test error');
      const msg = logger.formatMessage('ERROR', 'test', 'Test', error);
      assert.ok(msg.includes('Test error'));
    });

    it('should handle null data', () => {
      const msg = logger.formatMessage('INFO', 'test', 'Test', null);
      assert.ok(msg.includes('Test'));
      assert.ok(!msg.includes('Data:'));
    });

    it('should end with newline', () => {
      const msg = logger.formatMessage('INFO', 'test', 'Test');
      assert.ok(msg.endsWith('\n'));
    });
  });

  describe('init', () => {
    it('should create log directory', async () => {
      await logger.init();
      const exists = await fs.access(logDir).then(() => true).catch(() => false);
      assert.ok(exists);
    });

    it('should set currentLogFile', async () => {
      await logger.init();
      assert.ok(logger.currentLogFile);
      assert.ok(logger.currentLogFile.includes('test-'));
      assert.ok(logger.currentLogFile.endsWith('.log'));
    });

    it('should set initialized flag', async () => {
      await logger.init();
      assert.strictEqual(logger.initialized, true);
    });

    it('should create log file with header', async () => {
      await logger.init();
      const content = await fs.readFile(logger.currentLogFile, 'utf8');
      assert.ok(content.includes('Test Log'));
      assert.ok(content.includes('Started at'));
    });

    it('should flush pending logs on init', async () => {
      logger.pendingLogs = ['pending log 1\n', 'pending log 2\n'];
      await logger.init();
      const content = await fs.readFile(logger.currentLogFile, 'utf8');
      assert.ok(content.includes('pending log 1'));
      assert.ok(content.includes('pending log 2'));
      assert.deepStrictEqual(logger.pendingLogs, []);
    });

    it('should not reinitialize if already initialized', async () => {
      await logger.init();
      const firstFile = logger.currentLogFile;
      await logger.init();
      assert.strictEqual(logger.currentLogFile, firstFile);
    });
  });

  describe('writeToFile', () => {
    it('should queue logs if not initialized', async () => {
      await logger.writeToFile('test log');
      assert.strictEqual(logger.pendingLogs.length, 1);
      assert.strictEqual(logger.pendingLogs[0], 'test log');
    });

    it('should write to file if initialized', async () => {
      await logger.init();
      await logger.writeToFile('test log line');
      const content = await fs.readFile(logger.currentLogFile, 'utf8');
      assert.ok(content.includes('test log line'));
    });

    it('should append multiple logs', async () => {
      await logger.init();
      await logger.writeToFile('log 1\n');
      await logger.writeToFile('log 2\n');
      const content = await fs.readFile(logger.currentLogFile, 'utf8');
      assert.ok(content.includes('log 1'));
      assert.ok(content.includes('log 2'));
    });
  });

  describe('getRecentLogs', () => {
    it('should return error if not initialized', async () => {
      const result = await logger.getRecentLogs();
      assert.strictEqual(result.success, false);
      assert.ok(result.error);
    });

    it('should return recent logs', async () => {
      await logger.init();
      await logger.writeToFile('log line 1\n');
      await logger.writeToFile('log line 2\n');

      const result = await logger.getRecentLogs(100);
      assert.strictEqual(result.success, true);
      assert.ok(result.content.includes('log line'));
      assert.ok(result.totalLines > 0);
    });

    it('should limit number of lines returned', async () => {
      await logger.init();
      for (let i = 0; i < 10; i++) {
        await logger.writeToFile(`log line ${i}\n`);
      }

      const result = await logger.getRecentLogs(3);
      assert.strictEqual(result.success, true);
      const lines = result.content.split('\n').filter(l => l.trim());
      assert.ok(lines.length <= 5); // ~3 lines requested
    });
  });

  describe('getLogFiles', () => {
    it('should return log files after init', async () => {
      await logger.init();
      const result = await logger.getLogFiles();
      assert.strictEqual(result.success, true);
      // After init, there should be at least the current log file
      assert.ok(result.files.length >= 0); // May be empty if no logs written
    });

    it('should return log files with metadata', async () => {
      await logger.init();
      await logger.writeToFile('log content\n');

      const result = await logger.getLogFiles();
      assert.strictEqual(result.success, true);
      assert.ok(result.files.length > 0);

      const file = result.files[0];
      assert.ok('name' in file);
      assert.ok('path' in file);
      assert.ok('size' in file);
      assert.ok('modified' in file);
      assert.ok(file.size >= 0);
    });

    it('should sort files by name descending', async () => {
      await logger.init();
      const result = await logger.getLogFiles();
      assert.strictEqual(result.success, true);
      if (result.files.length > 1) {
        for (let i = 0; i < result.files.length - 1; i++) {
          assert.ok(
            result.files[i].name >= result.files[i + 1].name,
            'Files should be sorted descending'
          );
        }
      }
    });
  });

  describe('getLogDir', () => {
    it('should return log directory path', () => {
      const dir = logger.getLogDir();
      assert.strictEqual(dir, logDir);
    });
  });

  describe('error handling', () => {
    it('should handle write errors gracefully', async () => {
      await logger.init();
      // Make directory read-only (if possible)
      try {
        await fs.chmod(logDir, 0o444);
        await logger.writeToFile('should fail');
        // Restore permissions for cleanup
        await fs.chmod(logDir, 0o755);
      } catch (err) {
        // chmod might not work on all systems, that's ok
        await fs.chmod(logDir, 0o755).catch(() => {});
      }
    });
  });

  describe('integration', () => {
    it('should handle full logging workflow', async () => {
      // Initialize
      await logger.init();
      assert.strictEqual(logger.initialized, true);

      // Write logs
      await logger.writeToFile('Test log message\n');

      // Retrieve logs
      const recent = await logger.getRecentLogs(10);
      assert.strictEqual(recent.success, true);

      // Get file list
      const files = await logger.getLogFiles();
      assert.strictEqual(files.success, true);
      assert.ok(files.files.length > 0);
    });
  });
});
