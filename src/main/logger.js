// Logger - Comprehensive logging system for EasyRip
// Provides file-based logging for troubleshooting with rotation and levels

import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

// Log levels
const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3,
};

class Logger {
  constructor() {
    this.logDir = path.join(os.homedir(), '.easyrip', 'logs');
    this.currentLogFile = null;
    this.logLevel = LOG_LEVELS.DEBUG;
    this.maxLogSize = 5 * 1024 * 1024; // 5MB per file
    this.maxLogFiles = 10;
    this.initialized = false;
    this.pendingLogs = [];
  }

  // Initialize the logger (create directories, set up log file)
  async init() {
    if (this.initialized) return;

    try {
      // Create log directory if it doesn't exist
      await fs.mkdir(this.logDir, { recursive: true });

      // Set current log file name with date
      const date = new Date().toISOString().split('T')[0];
      this.currentLogFile = path.join(this.logDir, `easyrip-${date}.log`);

      // Rotate old logs
      await this.rotateLogsIfNeeded();

      // Write startup header
      await this.writeToFile('\n' + '='.repeat(80) + '\n');
      await this.writeToFile(`EasyRip Log - Started at ${new Date().toISOString()}\n`);
      await this.writeToFile(`Platform: ${os.platform()} ${os.release()}\n`);
      await this.writeToFile(`Node: ${process.version}\n`);
      await this.writeToFile('='.repeat(80) + '\n\n');

      this.initialized = true;

      // Flush pending logs
      for (const log of this.pendingLogs) {
        await this.writeToFile(log);
      }
      this.pendingLogs = [];

    } catch (err) {
      console.error('Failed to initialize logger:', err);
    }
  }

  // Format a log message
  formatMessage(level, category, message, data = null) {
    const timestamp = new Date().toISOString();
    const levelStr = Object.keys(LOG_LEVELS).find(k => LOG_LEVELS[k] === level) || 'INFO';
    let formatted = `[${timestamp}] [${levelStr}] [${category}] ${message}`;

    if (data !== null) {
      if (data instanceof Error) {
        formatted += `\n  Error: ${data.message}`;
        if (data.stack) {
          formatted += `\n  Stack: ${data.stack.split('\n').slice(1, 4).join('\n        ')}`;
        }
      } else if (typeof data === 'object') {
        try {
          formatted += `\n  Data: ${JSON.stringify(data, null, 2).split('\n').join('\n  ')}`;
        } catch {
          formatted += `\n  Data: [Object - could not stringify]`;
        }
      } else {
        formatted += `\n  Data: ${data}`;
      }
    }

    return formatted + '\n';
  }

  // Write to log file
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

  // Rotate logs if needed
  async rotateLogsIfNeeded() {
    try {
      const files = await fs.readdir(this.logDir);
      const logFiles = files
        .filter(f => f.startsWith('easyrip-') && f.endsWith('.log'))
        .sort()
        .reverse();

      // Delete old log files beyond maxLogFiles
      for (let i = this.maxLogFiles; i < logFiles.length; i++) {
        await fs.unlink(path.join(this.logDir, logFiles[i]));
      }

      // Check current log file size
      if (this.currentLogFile) {
        try {
          const stat = await fs.stat(this.currentLogFile);
          if (stat.size > this.maxLogSize) {
            // Rename current file with timestamp
            const newName = this.currentLogFile.replace('.log', `-${Date.now()}.log`);
            await fs.rename(this.currentLogFile, newName);
          }
        } catch {
          // File doesn't exist yet, that's fine
        }
      }
    } catch (err) {
      console.error('Log rotation error:', err);
    }
  }

  // Core log method
  async log(level, category, message, data = null) {
    if (level > this.logLevel) return;

    const formatted = this.formatMessage(level, category, message, data);

    // Always log to console
    const levelName = Object.keys(LOG_LEVELS).find(k => LOG_LEVELS[k] === level);
    if (level === LOG_LEVELS.ERROR) {
      console.error(`[${category}] ${message}`, data || '');
    } else if (level === LOG_LEVELS.WARN) {
      console.warn(`[${category}] ${message}`, data || '');
    } else {
      console.log(`[${category}] ${message}`, data || '');
    }

    // Write to file
    await this.writeToFile(formatted);
  }

  // Convenience methods
  error(category, message, data = null) {
    return this.log(LOG_LEVELS.ERROR, category, message, data);
  }

  warn(category, message, data = null) {
    return this.log(LOG_LEVELS.WARN, category, message, data);
  }

  info(category, message, data = null) {
    return this.log(LOG_LEVELS.INFO, category, message, data);
  }

  debug(category, message, data = null) {
    return this.log(LOG_LEVELS.DEBUG, category, message, data);
  }

  // Get recent logs (for UI display)
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

  // Get all log files
  async getLogFiles() {
    try {
      const files = await fs.readdir(this.logDir);
      const logFiles = files
        .filter(f => f.startsWith('easyrip-') && f.endsWith('.log'))
        .map(f => ({
          name: f,
          path: path.join(this.logDir, f),
        }))
        .sort((a, b) => b.name.localeCompare(a.name));

      // Get file sizes
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

  // Get log directory path
  getLogDir() {
    return this.logDir;
  }
}

// Singleton instance
const logger = new Logger();

export default logger;
export { LOG_LEVELS };
