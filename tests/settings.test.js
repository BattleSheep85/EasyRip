// Unit Tests for Settings Persistence
// Run with: node --test tests/settings.test.js

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import path from 'path';
import os from 'os';
import { promises as fs } from 'fs';

// Mock settings manager for testing
class SettingsManager {
  constructor(settingsPath) {
    this.settingsPath = settingsPath;
    this._settingsLoaded = false;
    this.makemkvPath = 'C:\\Program Files (x86)\\MakeMKV\\makemkvcon64.exe';
    this.basePath = 'D:\\EasyRip';
    this.tmdbApiKey = '';
    this.makemkvKey = '';
    this.transfer = null;
    this.metadata = {};
    this.automation = {
      autoBackup: false,
      autoMeta: true,
      autoExport: false,
      liveDangerously: false,
      ejectAfterBackup: false
    };
  }

  async loadSettings() {
    if (this._settingsLoaded) return;
    try {
      const data = await fs.readFile(this.settingsPath, 'utf8');
      const settings = JSON.parse(data);
      this.applySettings(settings);
    } catch {
      // Settings file doesn't exist yet, use defaults
    }
    this._settingsLoaded = true;
  }

  applySettings(settings) {
    this.makemkvPath = settings.makemkvPath || this.makemkvPath;
    this.basePath = settings.basePath || this.basePath;
    this.tmdbApiKey = settings.tmdbApiKey || '';
    this.makemkvKey = settings.makemkvKey || '';
    this.transfer = settings.transfer || null;
    this.metadata = settings.metadata || {};
    this.automation = settings.automation || this.automation;
  }

  async getSettings() {
    return {
      makemkvPath: this.makemkvPath,
      basePath: this.basePath,
      tmdbApiKey: this.tmdbApiKey,
      makemkvKey: this.makemkvKey,
      transfer: this.transfer,
      metadata: this.metadata,
      automation: this.automation,
    };
  }

  async saveSettings(settings) {
    await fs.mkdir(path.dirname(this.settingsPath), { recursive: true });
    await fs.writeFile(
      this.settingsPath,
      JSON.stringify(settings, null, 2),
      'utf8'
    );
    this.applySettings(settings);
  }

  async clearSettings() {
    try {
      await fs.unlink(this.settingsPath);
    } catch {
      // File doesn't exist
    }
    this._settingsLoaded = false;
  }
}

describe('Settings Persistence', () => {
  let manager;
  let settingsPath;

  beforeEach(async () => {
    settingsPath = path.join(os.tmpdir(), `easyrip-settings-${Date.now()}.json`);
    manager = new SettingsManager(settingsPath);
  });

  afterEach(async () => {
    try {
      await fs.unlink(settingsPath);
    } catch (err) {
      // Ignore
    }
  });

  describe('loadSettings', () => {
    it('should use defaults when no file exists', async () => {
      await manager.loadSettings();
      assert.strictEqual(manager.basePath, 'D:\\EasyRip');
      assert.strictEqual(manager.tmdbApiKey, '');
      assert.strictEqual(manager.transfer, null);
    });

    it('should load settings from file', async () => {
      const testSettings = {
        makemkvPath: 'C:\\Custom\\makemkvcon64.exe',
        basePath: 'E:\\BackupData',
        tmdbApiKey: 'test-key-123',
        transfer: { protocol: 'sftp', host: 'backup.example.com' },
        automation: { autoBackup: true, autoMeta: false, autoExport: true, liveDangerously: false, ejectAfterBackup: false }
      };

      await fs.mkdir(path.dirname(settingsPath), { recursive: true });
      await fs.writeFile(settingsPath, JSON.stringify(testSettings, null, 2), 'utf8');

      const freshManager = new SettingsManager(settingsPath);
      await freshManager.loadSettings();

      assert.strictEqual(freshManager.basePath, 'E:\\BackupData');
      assert.strictEqual(freshManager.tmdbApiKey, 'test-key-123');
      assert.deepStrictEqual(freshManager.transfer, { protocol: 'sftp', host: 'backup.example.com' });
      assert.strictEqual(freshManager.automation.autoBackup, true);
    });

    it('should not load settings twice', async () => {
      await manager.loadSettings();
      const firstLoad = manager._settingsLoaded;
      await manager.loadSettings();
      assert.strictEqual(firstLoad, true);
      assert.strictEqual(manager._settingsLoaded, true);
    });

    it('should handle malformed JSON gracefully', async () => {
      await fs.mkdir(path.dirname(settingsPath), { recursive: true });
      await fs.writeFile(settingsPath, 'not valid json {', 'utf8');

      const freshManager = new SettingsManager(settingsPath);
      // Should not throw
      await assert.doesNotReject(async () => {
        await freshManager.loadSettings();
      });

      // Should use defaults
      assert.strictEqual(freshManager.basePath, 'D:\\EasyRip');
    });
  });

  describe('saveSettings', () => {
    it('should create parent directory if needed', async () => {
      const deepPath = path.join(os.tmpdir(), `deep-${Date.now()}`, 'config', 'settings.json');
      const deepManager = new SettingsManager(deepPath);

      const settings = {
        basePath: 'D:\\EasyRip',
        tmdbApiKey: 'test-key'
      };

      await deepManager.saveSettings(settings);
      const exists = await fs.access(deepPath).then(() => true).catch(() => false);
      assert.ok(exists);

      // Cleanup
      try {
        await fs.rm(path.dirname(deepPath), { recursive: true, force: true });
      } catch (err) {
        // Ignore
      }
    });

    it('should save settings to file', async () => {
      const settings = {
        basePath: 'E:\\Backups',
        tmdbApiKey: 'my-api-key',
        makemkvKey: 'T-test-key',
        transfer: { protocol: 'sftp', host: 'remote.example.com' }
      };

      await manager.saveSettings(settings);

      const content = await fs.readFile(settingsPath, 'utf8');
      const saved = JSON.parse(content);

      assert.strictEqual(saved.basePath, 'E:\\Backups');
      assert.strictEqual(saved.tmdbApiKey, 'my-api-key');
      assert.deepStrictEqual(saved.transfer.host, 'remote.example.com');
    });

    it('should update in-memory settings after save', async () => {
      const settings = {
        basePath: 'E:\\NewPath',
        tmdbApiKey: 'new-key'
      };

      await manager.saveSettings(settings);

      assert.strictEqual(manager.basePath, 'E:\\NewPath');
      assert.strictEqual(manager.tmdbApiKey, 'new-key');
    });

    it('should preserve formatting in saved file', async () => {
      const settings = {
        basePath: 'D:\\EasyRip',
        tmdbApiKey: 'test'
      };

      await manager.saveSettings(settings);

      const content = await fs.readFile(settingsPath, 'utf8');
      // Check for proper JSON formatting
      assert.ok(content.includes('  '));
      assert.ok(content.includes('\n'));
    });

    it('should handle empty settings', async () => {
      await manager.saveSettings({});
      const content = await fs.readFile(settingsPath, 'utf8');
      const saved = JSON.parse(content);
      assert.deepStrictEqual(saved, {});
    });
  });

  describe('getSettings', () => {
    it('should return current settings', async () => {
      await manager.loadSettings();
      const settings = await manager.getSettings();

      assert.ok('makemkvPath' in settings);
      assert.ok('basePath' in settings);
      assert.ok('tmdbApiKey' in settings);
      assert.ok('transfer' in settings);
      assert.ok('automation' in settings);
    });

    it('should reflect saved changes', async () => {
      const newSettings = {
        basePath: 'Z:\\NewLocation',
        tmdbApiKey: 'updated-key'
      };

      await manager.saveSettings(newSettings);
      const settings = await manager.getSettings();

      assert.strictEqual(settings.basePath, 'Z:\\NewLocation');
      assert.strictEqual(settings.tmdbApiKey, 'updated-key');
    });
  });

  describe('automation settings', () => {
    it('should save and load automation toggles', async () => {
      const settings = {
        automation: {
          autoBackup: true,
          autoMeta: false,
          autoExport: true,
          liveDangerously: true,
          ejectAfterBackup: false
        }
      };

      await manager.saveSettings(settings);
      const loaded = await manager.getSettings();

      assert.strictEqual(loaded.automation.autoBackup, true);
      assert.strictEqual(loaded.automation.autoMeta, false);
      assert.strictEqual(loaded.automation.autoExport, true);
      assert.strictEqual(loaded.automation.liveDangerously, true);
      assert.strictEqual(loaded.automation.ejectAfterBackup, false);
    });

    it('should default automation to safe settings', async () => {
      await manager.loadSettings();
      assert.strictEqual(manager.automation.autoBackup, false);
      assert.strictEqual(manager.automation.liveDangerously, false);
    });
  });

  describe('transfer settings', () => {
    it('should save and load transfer configuration', async () => {
      const transferConfig = {
        protocol: 'sftp',
        host: 'backup.example.com',
        port: 22,
        username: 'user',
        moviePath: '/media/movies',
        tvPath: '/media/tv'
      };

      const settings = { transfer: transferConfig };
      await manager.saveSettings(settings);
      const loaded = await manager.getSettings();

      assert.deepStrictEqual(loaded.transfer, transferConfig);
    });

    it('should handle null transfer settings', async () => {
      const settings = { transfer: null };
      await manager.saveSettings(settings);
      const loaded = await manager.getSettings();

      assert.strictEqual(loaded.transfer, null);
    });
  });

  describe('metadata settings', () => {
    it('should save and load metadata configuration', async () => {
      const metadataConfig = {
        enabled: true,
        ollamaModel: 'llama2',
        tmdbApiKey: 'test-key',
        watcherIntervalMs: 30000
      };

      const settings = { metadata: metadataConfig };
      await manager.saveSettings(settings);
      const loaded = await manager.getSettings();

      assert.deepStrictEqual(loaded.metadata, metadataConfig);
    });
  });

  describe('integration', () => {
    it('should handle complete settings cycle', async () => {
      const initialSettings = {
        basePath: 'D:\\Backups',
        tmdbApiKey: 'initial-key',
        transfer: { protocol: 'sftp', host: 'test.com' },
        automation: { autoBackup: false, autoMeta: true, autoExport: false, liveDangerously: false, ejectAfterBackup: false }
      };

      // Save
      await manager.saveSettings(initialSettings);

      // Load in new instance
      const newManager = new SettingsManager(settingsPath);
      await newManager.loadSettings();
      const loaded = await newManager.getSettings();

      // Verify
      assert.strictEqual(loaded.basePath, 'D:\\Backups');
      assert.strictEqual(loaded.tmdbApiKey, 'initial-key');
      assert.deepStrictEqual(loaded.transfer.host, 'test.com');
      assert.strictEqual(loaded.automation.autoMeta, true);
    });

    it('should support incremental updates', async () => {
      const settings1 = { basePath: 'D:\\Path1' };
      await manager.saveSettings(settings1);

      const loaded1 = await manager.getSettings();
      const settings2 = { ...loaded1, tmdbApiKey: 'new-key' };
      await manager.saveSettings(settings2);

      const loaded2 = await manager.getSettings();
      assert.strictEqual(loaded2.basePath, 'D:\\Path1');
      assert.strictEqual(loaded2.tmdbApiKey, 'new-key');
    });
  });
});
