// Unit Tests for IPC Handler Logic
// Tests the core logic of IPC handlers without Electron dependencies
// Run with: node --test tests/ipc-handlers.test.js

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import path from 'path';

// Mock implementation of backup name sanitization
function sanitizeBackupName(name) {
  if (!name || typeof name !== 'string') {
    throw new Error('Invalid backup name');
  }
  const sanitized = path.basename(name);
  if (!sanitized || sanitized !== name || name.includes('..')) {
    throw new Error('Invalid backup name: path traversal detected');
  }
  return sanitized;
}

// Mock IPC handler logic for drive scanning
function createDriveScanHandler(driveDetector) {
  return async () => {
    try {
      const drives = await driveDetector.detectDrives();
      return { success: true, drives };
    } catch (error) {
      return { success: false, error: error.message, errorDetails: error.stack };
    }
  };
}

// Mock IPC handler logic for backup status
function createBackupStatusHandler(makemkv) {
  return async (discName, discSize) => {
    try {
      const status = await makemkv.checkBackupStatus(discName, discSize, () => {});
      return { success: true, ...status };
    } catch (error) {
      return { success: false, error: error.message };
    }
  };
}

// Mock IPC handler logic for cancelling backup
function createCancelBackupHandler(runningBackups) {
  return async (driveId) => {
    try {
      const backup = runningBackups.get(driveId);
      if (backup) {
        backup.makemkv.cancelBackup();
        runningBackups.delete(driveId);
        return { success: true, cancelled: true };
      }
      return { success: true, wasNotFound: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  };
}

// Mock IPC handler logic for settings
function createSettingsHandlers(makemkv) {
  return {
    getSettings: async () => {
      try {
        const settings = await makemkv.getSettings();
        return { success: true, settings };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
    saveSettings: async (settings) => {
      try {
        await makemkv.saveSettings(settings);
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }
  };
}

describe('IPC Handler Logic', () => {
  describe('sanitizeBackupName', () => {
    it('should accept valid disc names', () => {
      assert.strictEqual(sanitizeBackupName('MOVIE_TITLE'), 'MOVIE_TITLE');
      assert.strictEqual(sanitizeBackupName('movie-title'), 'movie-title');
      assert.strictEqual(sanitizeBackupName('Movie123'), 'Movie123');
    });

    it('should reject path traversal attempts', () => {
      assert.throws(
        () => sanitizeBackupName('../../../etc/passwd'),
        { message: /path traversal/ }
      );
    });

    it('should reject double dots', () => {
      assert.throws(
        () => sanitizeBackupName('folder..name'),
        { message: /path traversal/ }
      );
    });

    it('should reject directory separators', () => {
      assert.throws(
        () => sanitizeBackupName('folder/filename'),
        { message: /Invalid backup name/ }
      );

      assert.throws(
        () => sanitizeBackupName('folder\\filename'),
        { message: /Invalid backup name/ }
      );
    });

    it('should reject null/undefined', () => {
      assert.throws(
        () => sanitizeBackupName(null),
        { message: /Invalid backup name/ }
      );

      assert.throws(
        () => sanitizeBackupName(undefined),
        { message: /Invalid backup name/ }
      );
    });

    it('should reject non-string values', () => {
      assert.throws(
        () => sanitizeBackupName(123),
        { message: /Invalid backup name/ }
      );

      assert.throws(
        () => sanitizeBackupName({}),
        { message: /Invalid backup name/ }
      );
    });

    it('should reject empty string', () => {
      assert.throws(
        () => sanitizeBackupName(''),
        { message: /Invalid backup name/ }
      );
    });
  });

  describe('Drive Scan Handler', () => {
    it('should return success with empty array for no drives', async () => {
      const mockDetector = {
        detectDrives: async () => []
      };

      const handler = createDriveScanHandler(mockDetector);
      const result = await handler();

      assert.strictEqual(result.success, true);
      assert.deepStrictEqual(result.drives, []);
    });

    it('should return drives with proper structure', async () => {
      const mockDrives = [
        {
          id: 0,
          driveLetter: 'D:',
          discName: 'DVD_TITLE',
          discSize: 4700000000,
          isBluray: false
        }
      ];

      const mockDetector = {
        detectDrives: async () => mockDrives
      };

      const handler = createDriveScanHandler(mockDetector);
      const result = await handler();

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.drives.length, 1);
      assert.deepStrictEqual(result.drives[0], mockDrives[0]);
    });

    it('should handle errors gracefully', async () => {
      const mockDetector = {
        detectDrives: async () => {
          throw new Error('Detection failed');
        }
      };

      const handler = createDriveScanHandler(mockDetector);
      const result = await handler();

      assert.strictEqual(result.success, false);
      assert.ok(result.error);
      assert.ok(result.errorDetails);
    });
  });

  describe('Backup Status Handler', () => {
    it('should return complete status', async () => {
      const mockMakeMKV = {
        checkBackupStatus: async (discName, discSize) => ({
          status: 'complete',
          discSize: 4700000000,
          backupSize: 4465000000,
          backupRatio: 95.0,
          path: '/path/to/backup'
        })
      };

      const handler = createBackupStatusHandler(mockMakeMKV);
      const result = await handler('TEST_DISC', 4700000000);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.status, 'complete');
      assert.ok(result.backupRatio >= 95);
    });

    it('should return incomplete status', async () => {
      const mockMakeMKV = {
        checkBackupStatus: async (discName, discSize) => ({
          status: 'incomplete_temp',
          discSize: 4700000000,
          tempSize: 2350000000,
          tempRatio: 50.0,
          path: '/path/to/temp'
        })
      };

      const handler = createBackupStatusHandler(mockMakeMKV);
      const result = await handler('TEST_DISC', 4700000000);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.status, 'incomplete_temp');
    });

    it('should handle errors', async () => {
      const mockMakeMKV = {
        checkBackupStatus: async () => {
          throw new Error('Status check failed');
        }
      };

      const handler = createBackupStatusHandler(mockMakeMKV);
      const result = await handler('TEST_DISC', 4700000000);

      assert.strictEqual(result.success, false);
      assert.ok(result.error);
    });
  });

  describe('Cancel Backup Handler', () => {
    it('should cancel running backup', async () => {
      const mockMakeMKV = {
        cancelBackup: () => {}
      };

      const runningBackups = new Map();
      runningBackups.set('drive1', { makemkv: mockMakeMKV, discName: 'TEST' });

      const handler = createCancelBackupHandler(runningBackups);
      const result = await handler('drive1');

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.cancelled, true);
      assert.strictEqual(runningBackups.has('drive1'), false);
    });

    it('should handle non-existent backup', async () => {
      const runningBackups = new Map();
      const handler = createCancelBackupHandler(runningBackups);
      const result = await handler('nonexistent');

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.wasNotFound, true);
    });

    it('should handle errors gracefully', async () => {
      const mockMakeMKV = {
        cancelBackup: () => {
          throw new Error('Cancel failed');
        }
      };

      const runningBackups = new Map();
      runningBackups.set('drive1', { makemkv: mockMakeMKV });

      const handler = createCancelBackupHandler(runningBackups);
      const result = await handler('drive1');

      assert.strictEqual(result.success, false);
      assert.ok(result.error);
    });
  });

  describe('Settings Handlers', () => {
    it('should get current settings', async () => {
      const mockSettings = {
        basePath: 'D:\\EasyRip',
        tmdbApiKey: 'test-key'
      };

      const mockMakeMKV = {
        getSettings: async () => mockSettings
      };

      const handlers = createSettingsHandlers(mockMakeMKV);
      const result = await handlers.getSettings();

      assert.strictEqual(result.success, true);
      assert.deepStrictEqual(result.settings, mockSettings);
    });

    it('should save settings', async () => {
      let savedSettings = null;

      const mockMakeMKV = {
        saveSettings: async (settings) => {
          savedSettings = settings;
        }
      };

      const handlers = createSettingsHandlers(mockMakeMKV);
      const newSettings = { basePath: 'E:\\Backups', tmdbApiKey: 'new-key' };
      const result = await handlers.saveSettings(newSettings);

      assert.strictEqual(result.success, true);
      assert.deepStrictEqual(savedSettings, newSettings);
    });

    it('should handle get errors', async () => {
      const mockMakeMKV = {
        getSettings: async () => {
          throw new Error('Settings unavailable');
        }
      };

      const handlers = createSettingsHandlers(mockMakeMKV);
      const result = await handlers.getSettings();

      assert.strictEqual(result.success, false);
      assert.ok(result.error);
    });

    it('should handle save errors', async () => {
      const mockMakeMKV = {
        saveSettings: async () => {
          throw new Error('Save failed');
        }
      };

      const handlers = createSettingsHandlers(mockMakeMKV);
      const result = await handlers.saveSettings({});

      assert.strictEqual(result.success, false);
      assert.ok(result.error);
    });
  });

  describe('Multiple Concurrent Operations', () => {
    it('should handle concurrent cancellations', async () => {
      const createMockMakeMKV = () => ({
        cancelBackup: () => {}
      });

      const runningBackups = new Map();
      runningBackups.set('drive1', { makemkv: createMockMakeMKV() });
      runningBackups.set('drive2', { makemkv: createMockMakeMKV() });
      runningBackups.set('drive3', { makemkv: createMockMakeMKV() });

      const handler = createCancelBackupHandler(runningBackups);

      const results = await Promise.all([
        handler('drive1'),
        handler('drive2'),
        handler('nonexistent'),
        handler('drive3')
      ]);

      assert.strictEqual(results[0].cancelled, true);
      assert.strictEqual(results[1].cancelled, true);
      assert.strictEqual(results[2].wasNotFound, true);
      assert.strictEqual(results[3].cancelled, true);
      assert.strictEqual(runningBackups.size, 0);
    });
  });

  describe('Response Structure', () => {
    it('should have consistent success/error structure', async () => {
      const mockDetector = {
        detectDrives: async () => []
      };

      const handler = createDriveScanHandler(mockDetector);
      const result = await handler();

      // All IPC responses should have success field
      assert.ok('success' in result);
      // Success responses should have data
      assert.ok('drives' in result);
    });

    it('should include error details in error responses', async () => {
      const mockDetector = {
        detectDrives: async () => {
          throw new Error('Test error');
        }
      };

      const handler = createDriveScanHandler(mockDetector);
      const result = await handler();

      assert.strictEqual(result.success, false);
      assert.ok('error' in result);
      assert.ok('errorDetails' in result);
    });
  });
});
