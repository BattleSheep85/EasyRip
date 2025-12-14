// Logger - Comprehensive logging system for EasyRip
// Provides file-based logging for troubleshooting with rotation and levels

import { promises as fs, createWriteStream } from 'fs';
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
    this.writeStream = null;
    this.streamBroken = false;
    this.isRecovering = false;
    this.writeQueue = [];
    this.processingQueue = false;
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

      // Initialize write stream
      await this.initializeWriteStream();

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

  // Initialize or reinitialize the write stream
  async initializeWriteStream() {
    // Clean up existing stream
    if (this.writeStream) {
      try {
        this.writeStream.removeAllListeners();
        this.writeStream.end();
      } catch {
        // Ignore cleanup errors
      }
      this.writeStream = null;
    }

    return new Promise((resolve, reject) => {
      try {
        this.writeStream = createWriteStream(this.currentLogFile, {
          flags: 'a',
          encoding: 'utf8',
          highWaterMark: 16384 // 16KB buffer
        });

        this.streamBroken = false;

        // Handle stream errors (EPIPE, ENOSPC, etc.)
        this.writeStream.on('error', (err) => {
          // Don't crash the app - just mark stream as broken
          console.error('[Logger] Write stream error (non-fatal):', err.code || err.message);
          this.streamBroken = true;

          // Attempt recovery after a delay
          if (!this.isRecovering) {
            this.scheduleStreamRecovery();
          }
        });

        // Handle stream close
        this.writeStream.on('close', () => {
          if (!this.streamBroken) {
            this.streamBroken = true;
          }
        });

        // Wait for stream to be ready
        this.writeStream.once('ready', () => {
          resolve();
        });

        this.writeStream.once('error', (err) => {
          reject(err);
        });

      } catch (err) {
        reject(err);
      }
    }).catch((err) => {
      console.error('[Logger] Failed to initialize write stream:', err);
      this.streamBroken = true;
      this.scheduleStreamRecovery();
    });
  }

  // Schedule automatic recovery from broken stream
  scheduleStreamRecovery() {
    if (this.isRecovering) return;

    this.isRecovering = true;

    // Wait 5 seconds before attempting recovery
    setTimeout(async () => {
      try {
        console.log('[Logger] Attempting to recover write stream...');
        await this.initializeWriteStream();
        console.log('[Logger] Write stream recovered successfully');

        // Process queued logs
        this.processWriteQueue();
      } catch (err) {
        console.error('[Logger] Stream recovery failed:', err);
        // Will try again on next write attempt
      } finally {
        this.isRecovering = false;
      }
    }, 5000);
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

  // Process queued writes
  async processWriteQueue() {
    if (this.processingQueue || this.writeQueue.length === 0) return;
    if (this.streamBroken || !this.writeStream || this.writeStream.destroyed) return;

    this.processingQueue = true;

    while (this.writeQueue.length > 0 && !this.streamBroken) {
      const message = this.writeQueue.shift();
      try {
        await this.writeToStreamSafe(message);
      } catch {
        // Re-queue failed message
        this.writeQueue.unshift(message);
        break;
      }
    }

    this.processingQueue = false;
  }

  // Safe write to stream with error handling
  async writeToStreamSafe(message) {
    return new Promise((resolve, reject) => {
      if (!this.writeStream || this.streamBroken || this.writeStream.destroyed) {
        reject(new Error('Stream not available'));
        return;
      }

      try {
        const canWrite = this.writeStream.write(message, 'utf8', (err) => {
          if (err) {
            // Don't crash - just mark as broken and reject
            console.error('[Logger] Write error (non-fatal):', err.code || err.message);
            this.streamBroken = true;
            reject(err);
          } else {
            resolve();
          }
        });

        // If buffer is full, wait for drain
        if (!canWrite) {
          this.writeStream.once('drain', () => {
            resolve();
          });
        }
      } catch (err) {
        // Synchronous errors (stream closed, etc.)
        console.error('[Logger] Write exception (non-fatal):', err.code || err.message);
        this.streamBroken = true;
        reject(err);
      }
    });
  }

  // Write to log file with graceful degradation
  async writeToFile(message) {
    if (!this.currentLogFile) {
      this.pendingLogs.push(message);
      return;
    }

    // If stream is broken, queue the message and attempt recovery
    if (this.streamBroken || !this.writeStream || this.writeStream.destroyed) {
      // Queue message (limit queue size to prevent memory bloat)
      if (this.writeQueue.length < 1000) {
        this.writeQueue.push(message);
      }

      // Trigger recovery if not already recovering
      if (!this.isRecovering) {
        this.scheduleStreamRecovery();
      }

      return;
    }

    try {
      await this.writeToStreamSafe(message);
    } catch (err) {
      // Stream failed - queue message for retry
      if (this.writeQueue.length < 1000) {
        this.writeQueue.push(message);
      }

      // Trigger recovery
      if (!this.isRecovering) {
        this.scheduleStreamRecovery();
      }
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

  // Core log method with error isolation
  async log(level, category, message, data = null) {
    if (level > this.logLevel) return;

    try {
      const formatted = this.formatMessage(level, category, message, data);

      // Always log to console (even if file write fails)
      const levelName = Object.keys(LOG_LEVELS).find(k => LOG_LEVELS[k] === level);
      if (level === LOG_LEVELS.ERROR) {
        console.error(`[${category}] ${message}`, data || '');
      } else if (level === LOG_LEVELS.WARN) {
        console.warn(`[${category}] ${message}`, data || '');
      } else {
        console.log(`[${category}] ${message}`, data || '');
      }

      // Write to file (non-blocking, won't throw)
      // Use setImmediate to prevent blocking caller
      setImmediate(() => {
        this.writeToFile(formatted).catch(() => {
          // Silently fail - error already handled in writeToFile
        });
      });
    } catch (err) {
      // Prevent logging errors from crashing the app
      console.error('[Logger] Log method error (non-fatal):', err.message);
    }
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

  // Cleanup method for graceful shutdown
  async cleanup() {
    try {
      // Process remaining queued logs
      if (this.writeQueue.length > 0) {
        console.log(`[Logger] Flushing ${this.writeQueue.length} queued logs...`);
        await this.processWriteQueue();
      }

      // Close the write stream
      if (this.writeStream && !this.writeStream.destroyed) {
        return new Promise((resolve) => {
          this.writeStream.end(() => {
            console.log('[Logger] Write stream closed gracefully');
            resolve();
          });

          // Force close after 5 seconds
          setTimeout(() => {
            if (!this.writeStream.destroyed) {
              this.writeStream.destroy();
            }
            resolve();
          }, 5000);
        });
      }
    } catch (err) {
      console.error('[Logger] Cleanup error (non-fatal):', err.message);
    }
  }
}

// Singleton instance
const logger = new Logger();

// Register cleanup on process exit
process.on('exit', () => {
  if (logger.writeStream && !logger.writeStream.destroyed) {
    try {
      logger.writeStream.end();
    } catch {
      // Ignore cleanup errors on exit
    }
  }
});

export default logger;
export { LOG_LEVELS };
