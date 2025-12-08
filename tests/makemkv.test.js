// Unit Tests for MakeMKV Adapter
// Run with: node --test tests/makemkv.test.js

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import path from 'path';
import os from 'os';
import { promises as fs } from 'fs';
import { MakeMKVAdapter } from '../src/main/makemkv.js';

describe('MakeMKVAdapter', () => {
  let adapter;
  let tempDir;

  beforeEach(async () => {
    adapter = new MakeMKVAdapter();
    tempDir = path.join(os.tmpdir(), `easyrip-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (err) {
      // Ignore cleanup errors
    }
  });

  describe('constructor', () => {
    it('should initialize with default paths', () => {
      assert.ok(adapter.makemkvPath);
      assert.ok(adapter.makemkvPath.includes('makemkvcon64.exe'));
      assert.strictEqual(adapter._settingsLoaded, false);
    });

    it('should set default settings', () => {
      assert.strictEqual(adapter.tmdbApiKey, '');
      assert.strictEqual(adapter.makemkvKey, '');
      assert.strictEqual(adapter.transfer, null);
      assert.deepStrictEqual(adapter.automation, {
        autoBackup: false,
        autoMeta: true,
        autoExport: false,
        liveDangerously: false,
        ejectAfterBackup: false
      });
    });
  });

  describe('loadSettings', () => {
    it('should load settings from file if exists', async () => {
      const settingsPath = adapter.settingsPath;
      const testSettings = {
        makemkvPath: 'C:\\Program Files (x86)\\MakeMKV\\makemkvcon64.exe',
        basePath: 'D:\\Test',
        tmdbApiKey: 'test-key-123',
        makemkvKey: 'T-test-key',
        transfer: { protocol: 'sftp', host: 'test.com' },
        automation: { autoBackup: true, autoMeta: false, autoExport: true, liveDangerously: false, ejectAfterBackup: true }
      };

      try {
        await fs.mkdir(path.dirname(settingsPath), { recursive: true });
        await fs.writeFile(settingsPath, JSON.stringify(testSettings, null, 2), 'utf8');

        const freshAdapter = new MakeMKVAdapter();
        await freshAdapter.loadSettings();

        assert.strictEqual(freshAdapter.basePath, 'D:\\Test');
        assert.strictEqual(freshAdapter.tmdbApiKey, 'test-key-123');
        assert.strictEqual(freshAdapter.makemkvKey, 'T-test-key');
        assert.deepStrictEqual(freshAdapter.transfer, { protocol: 'sftp', host: 'test.com' });
        assert.strictEqual(freshAdapter.automation.autoBackup, true);
      } finally {
        try {
          await fs.unlink(settingsPath);
        } catch (err) {
          // Ignore if file doesn't exist
        }
      }
    });

    it('should use defaults if settings file does not exist', async () => {
      const freshAdapter = new MakeMKVAdapter();
      await freshAdapter.loadSettings();

      assert.strictEqual(freshAdapter.basePath, 'D:\\EasyRip');
      assert.strictEqual(freshAdapter.tmdbApiKey, '');
      assert.strictEqual(freshAdapter.makemkvKey, '');
      assert.strictEqual(freshAdapter.transfer, null);
    });

    it('should not load settings twice', async () => {
      await adapter.loadSettings();
      const firstLoad = adapter._settingsLoaded;
      await adapter.loadSettings();
      assert.strictEqual(firstLoad, true);
      assert.strictEqual(adapter._settingsLoaded, true);
    });
  });

  describe('formatSize', () => {
    it('should format bytes correctly', () => {
      assert.strictEqual(adapter.formatSize(0), '0 B');
      assert.strictEqual(adapter.formatSize(1024), '1 KB');
      assert.strictEqual(adapter.formatSize(1024 * 1024), '1 MB');
      assert.strictEqual(adapter.formatSize(1024 * 1024 * 1024), '1 GB');
    });

    it('should handle null/undefined', () => {
      assert.strictEqual(adapter.formatSize(null), '0 B');
      assert.strictEqual(adapter.formatSize(undefined), '0 B');
    });
  });

  describe('countFiles', () => {
    it('should count files in directory', async () => {
      // Create test files
      await fs.writeFile(path.join(tempDir, 'file1.txt'), 'content1');
      await fs.writeFile(path.join(tempDir, 'file2.txt'), 'content2');

      const count = await adapter.countFiles(tempDir);
      assert.strictEqual(count, 2);
    });

    it('should count files recursively', async () => {
      const subDir = path.join(tempDir, 'subdir');
      await fs.mkdir(subDir);
      await fs.writeFile(path.join(tempDir, 'file1.txt'), 'content1');
      await fs.writeFile(path.join(subDir, 'file2.txt'), 'content2');
      await fs.writeFile(path.join(subDir, 'file3.txt'), 'content3');

      const count = await adapter.countFiles(tempDir);
      assert.strictEqual(count, 3);
    });

    it('should return 0 for non-existent directory', async () => {
      const count = await adapter.countFiles(path.join(tempDir, 'nonexistent'));
      assert.strictEqual(count, 0);
    });
  });

  describe('getBackupSize', () => {
    it('should get size of single file', async () => {
      const testFile = path.join(tempDir, 'test.mkv');
      const content = Buffer.alloc(1024); // 1KB
      await fs.writeFile(testFile, content);

      const size = await adapter.getBackupSize(testFile);
      assert.strictEqual(size, 1024);
    });

    it('should get total size of folder', async () => {
      const subDir = path.join(tempDir, 'backup');
      await fs.mkdir(subDir);

      const content = Buffer.alloc(1024);
      await fs.writeFile(path.join(subDir, 'file1.mkv'), content);
      await fs.writeFile(path.join(subDir, 'file2.mkv'), content);

      const size = await adapter.getBackupSize(subDir);
      assert.strictEqual(size, 2048);
    });

    it('should handle nested folders', async () => {
      const subDir1 = path.join(tempDir, 'level1');
      const subDir2 = path.join(subDir1, 'level2');
      await fs.mkdir(subDir2, { recursive: true });

      const content = Buffer.alloc(1024);
      await fs.writeFile(path.join(tempDir, 'file1.mkv'), content);
      await fs.writeFile(path.join(subDir1, 'file2.mkv'), content);
      await fs.writeFile(path.join(subDir2, 'file3.mkv'), content);

      const size = await adapter.getBackupSize(tempDir);
      assert.strictEqual(size, 3072);
    });

    it('should return 0 for non-existent path', async () => {
      const size = await adapter.getBackupSize(path.join(tempDir, 'nonexistent'));
      assert.strictEqual(size, 0);
    });
  });

  describe('splitRobotLine', () => {
    it('should split simple comma-separated values', () => {
      const parts = adapter.splitRobotLine('1,2,3,4');
      assert.deepStrictEqual(parts, ['1', '2', '3', '4']);
    });

    it('should handle quoted values with commas', () => {
      const parts = adapter.splitRobotLine('1,"value, with comma",3');
      assert.deepStrictEqual(parts, ['1', '"value, with comma"', '3']);
    });

    it('should handle quoted values with quotes inside', () => {
      const parts = adapter.splitRobotLine('1,"quoted \\"value\\"",3');
      assert.strictEqual(parts.length, 3);
      assert.strictEqual(parts[0], '1');
      assert.strictEqual(parts[2], '3');
    });

    it('should handle empty values', () => {
      const parts = adapter.splitRobotLine('1,,3');
      assert.deepStrictEqual(parts, ['1', '', '3']);
    });
  });

  describe('unquote', () => {
    it('should remove quotes', () => {
      assert.strictEqual(adapter.unquote('"hello"'), 'hello');
      assert.strictEqual(adapter.unquote('"test value"'), 'test value');
    });

    it('should handle non-quoted strings', () => {
      assert.strictEqual(adapter.unquote('hello'), 'hello');
    });

    it('should handle null/undefined', () => {
      assert.strictEqual(adapter.unquote(null), '');
      assert.strictEqual(adapter.unquote(undefined), '');
    });

    it('should handle empty string', () => {
      assert.strictEqual(adapter.unquote(''), '');
    });

    it('should handle single quoted char', () => {
      assert.strictEqual(adapter.unquote('""'), '');
    });
  });

  describe('isDVDImage', () => {
    it('should return true for file', async () => {
      const filePath = path.join(tempDir, 'image.iso');
      await fs.writeFile(filePath, Buffer.alloc(1024));

      const isDVD = await adapter.isDVDImage(filePath);
      assert.strictEqual(isDVD, true);
    });

    it('should return false for directory', async () => {
      const dirPath = path.join(tempDir, 'bdmv');
      await fs.mkdir(dirPath);

      const isDVD = await adapter.isDVDImage(dirPath);
      assert.strictEqual(isDVD, false);
    });

    it('should return false for non-existent path', async () => {
      const isDVD = await adapter.isDVDImage(path.join(tempDir, 'nonexistent'));
      assert.strictEqual(isDVD, false);
    });
  });

  describe('getLastError', () => {
    it('should return null initially', () => {
      assert.strictEqual(adapter.getLastError(), null);
    });

    it('should return last set error', () => {
      adapter.lastError = 'Test error message';
      assert.strictEqual(adapter.getLastError(), 'Test error message');
    });
  });

  describe('cancelBackup', () => {
    it('should do nothing if no process running', () => {
      assert.doesNotThrow(() => {
        adapter.cancelBackup();
      });
    });

    it('should set currentProcess to null', () => {
      // Mock a process
      adapter.currentProcess = { kill: () => {} };
      adapter.cancelBackup();
      assert.strictEqual(adapter.currentProcess, null);
    });
  });

  describe('deleteBackup', () => {
    it('should delete file', async () => {
      const testFile = path.join(tempDir, 'backup.mkv');
      await fs.writeFile(testFile, 'content');
      assert.ok(await fs.access(testFile).then(() => true).catch(() => false));

      await adapter.deleteBackup(testFile);
      assert.ok(!(await fs.access(testFile).then(() => true).catch(() => false)));
    });

    it('should delete folder recursively', async () => {
      const subDir = path.join(tempDir, 'backup');
      await fs.mkdir(subDir);
      await fs.writeFile(path.join(subDir, 'file.mkv'), 'content');
      assert.ok(await fs.access(subDir).then(() => true).catch(() => false));

      await adapter.deleteBackup(subDir);
      assert.ok(!(await fs.access(subDir).then(() => true).catch(() => false)));
    });
  });
});
