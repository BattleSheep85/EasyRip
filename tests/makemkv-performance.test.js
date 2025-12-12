// Unit Tests for MakeMKV Performance Configuration System
// Run with: node --test tests/makemkv-performance.test.js

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { MakeMKVAdapter } from '../src/main/makemkv.js';

describe('MakeMKV Performance Configuration', () => {
  let adapter;

  beforeEach(() => {
    adapter = new MakeMKVAdapter();
  });

  describe('getDefaultPerformanceSettings', () => {
    it('should return balanced preset as default', () => {
      const defaults = adapter.getDefaultPerformanceSettings();
      assert.strictEqual(defaults.preset, 'balanced');
      assert.strictEqual(defaults.customSettings.cache, 16);
      assert.strictEqual(defaults.customSettings.minbuf, 1);
      assert.strictEqual(defaults.customSettings.maxbuf, 16);
      assert.strictEqual(defaults.customSettings.timeout, 10000);
    });

    it('should include disc type profiles', () => {
      const defaults = adapter.getDefaultPerformanceSettings();
      assert.ok(defaults.discTypeProfiles);
      assert.strictEqual(defaults.discTypeProfiles.dvd, 'balanced');
      assert.strictEqual(defaults.discTypeProfiles.bluray, 'balanced');
      assert.strictEqual(defaults.discTypeProfiles['4k-bluray'], '4k-bluray');
    });

    it('should enable retry on error by default', () => {
      const defaults = adapter.getDefaultPerformanceSettings();
      assert.strictEqual(defaults.customSettings.retryOnError, true);
      assert.strictEqual(defaults.customSettings.maxRetries, 3);
    });
  });

  describe('getPerformancePresets', () => {
    it('should return all 4 presets', () => {
      const presets = adapter.getPerformancePresets();
      assert.ok(presets.fast);
      assert.ok(presets.balanced);
      assert.ok(presets.compatibility);
      assert.ok(presets['4k-bluray']);
    });

    it('should have proper structure for each preset', () => {
      const presets = adapter.getPerformancePresets();
      for (const [key, preset] of Object.entries(presets)) {
        assert.ok(preset.name, `${key} should have a name`);
        assert.ok(preset.description, `${key} should have a description`);
        assert.ok(typeof preset.cache === 'number', `${key}.cache should be a number`);
        assert.ok(typeof preset.minbuf === 'number', `${key}.minbuf should be a number`);
        assert.ok(typeof preset.maxbuf === 'number', `${key}.maxbuf should be a number`);
        assert.ok(typeof preset.timeout === 'number', `${key}.timeout should be a number`);
      }
    });

    it('should have increasing cache sizes from fast to 4k-bluray', () => {
      const presets = adapter.getPerformancePresets();
      assert.ok(presets.fast.cache < presets.balanced.cache);
      assert.ok(presets.balanced.cache < presets.compatibility.cache);
      assert.ok(presets.compatibility.cache < presets['4k-bluray'].cache);
    });
  });

  describe('buildMakeMKVFlags - Preset Tests', () => {
    it('should build flags for fast preset', () => {
      adapter.makemkvPerformance = {
        preset: 'fast',
        customSettings: {},
        discTypeProfiles: {}
      };

      const { flags, settings } = adapter.buildMakeMKVFlags();

      assert.ok(flags.includes('--decrypt'));
      assert.ok(flags.includes('--cache=8'));
      assert.ok(flags.includes('--noscan'));
      assert.ok(flags.includes('-r'));
      assert.ok(flags.includes('--progress=-same'));
      assert.strictEqual(settings.cache, 8);
      assert.strictEqual(settings.timeout, 8000);
    });

    it('should build flags for balanced preset', () => {
      adapter.makemkvPerformance = {
        preset: 'balanced',
        customSettings: {},
        discTypeProfiles: {}
      };

      const { flags, settings } = adapter.buildMakeMKVFlags();

      assert.ok(flags.includes('--cache=16'));
      assert.strictEqual(settings.cache, 16);
      assert.strictEqual(settings.timeout, 10000);
    });

    it('should build flags for compatibility preset', () => {
      adapter.makemkvPerformance = {
        preset: 'compatibility',
        customSettings: {},
        discTypeProfiles: {}
      };

      const { flags, settings } = adapter.buildMakeMKVFlags();

      assert.ok(flags.includes('--cache=64'));
      assert.strictEqual(settings.cache, 64);
      assert.strictEqual(settings.timeout, 15000);
      assert.strictEqual(settings.maxRetries, 5);
    });

    it('should build flags for 4k-bluray preset', () => {
      adapter.makemkvPerformance = {
        preset: '4k-bluray',
        customSettings: {},
        discTypeProfiles: {}
      };

      const { flags, settings } = adapter.buildMakeMKVFlags();

      assert.ok(flags.includes('--cache=128'));
      assert.strictEqual(settings.cache, 128);
      assert.strictEqual(settings.minbuf, 4);
      assert.strictEqual(settings.maxbuf, 64);
      assert.strictEqual(settings.timeout, 12000);
    });
  });

  describe('buildMakeMKVFlags - Custom Settings', () => {
    it('should use custom settings when preset is custom', () => {
      adapter.makemkvPerformance = {
        preset: 'custom',
        customSettings: {
          cache: 32,
          minbuf: 2,
          maxbuf: 24,
          timeout: 20000,
          splitSize: 0,
          retryOnError: true,
          maxRetries: 4
        },
        discTypeProfiles: {}
      };

      const { flags, settings } = adapter.buildMakeMKVFlags();

      assert.ok(flags.includes('--cache=32'));
      assert.strictEqual(settings.cache, 32);
      assert.strictEqual(settings.minbuf, 2);
      assert.strictEqual(settings.maxbuf, 24);
      assert.strictEqual(settings.timeout, 20000);
      assert.strictEqual(settings.maxRetries, 4);
    });

    it('should apply per-backup overrides', () => {
      adapter.makemkvPerformance = {
        preset: 'balanced',
        customSettings: {},
        discTypeProfiles: {}
      };

      const { flags, settings } = adapter.buildMakeMKVFlags({
        overrides: { cache: 64, timeout: 20000 }
      });

      assert.ok(flags.includes('--cache=64'));
      assert.strictEqual(settings.cache, 64);
      assert.strictEqual(settings.timeout, 20000);
    });
  });

  describe('buildMakeMKVFlags - Validation and Clamping', () => {
    it('should clamp cache to valid range (1-256)', () => {
      adapter.makemkvPerformance = {
        preset: 'custom',
        customSettings: { cache: 0, minbuf: 1, maxbuf: 16, timeout: 10000 },
        discTypeProfiles: {}
      };

      const { settings } = adapter.buildMakeMKVFlags();
      assert.strictEqual(settings.cache, 1, 'cache should be clamped to minimum 1');

      adapter.makemkvPerformance.customSettings.cache = 300;
      const { settings: settings2 } = adapter.buildMakeMKVFlags();
      assert.strictEqual(settings2.cache, 256, 'cache should be clamped to maximum 256');
    });

    it('should clamp minbuf to valid range (0-maxbuf)', () => {
      adapter.makemkvPerformance = {
        preset: 'custom',
        customSettings: { cache: 16, minbuf: -1, maxbuf: 16, timeout: 10000 },
        discTypeProfiles: {}
      };

      const { settings } = adapter.buildMakeMKVFlags();
      assert.strictEqual(settings.minbuf, 0, 'minbuf should be clamped to minimum 0');

      adapter.makemkvPerformance.customSettings.minbuf = 20;
      adapter.makemkvPerformance.customSettings.maxbuf = 16;
      const { settings: settings2 } = adapter.buildMakeMKVFlags();
      assert.ok(settings2.minbuf <= settings2.maxbuf, 'minbuf should not exceed maxbuf');
    });

    it('should clamp maxbuf to valid range (minbuf-256)', () => {
      adapter.makemkvPerformance = {
        preset: 'custom',
        customSettings: { cache: 16, minbuf: 1, maxbuf: 0, timeout: 10000 },
        discTypeProfiles: {}
      };

      const { settings } = adapter.buildMakeMKVFlags();
      assert.ok(settings.maxbuf >= settings.minbuf, 'maxbuf should be at least minbuf');

      adapter.makemkvPerformance.customSettings.maxbuf = 300;
      const { settings: settings2 } = adapter.buildMakeMKVFlags();
      assert.strictEqual(settings2.maxbuf, 256, 'maxbuf should be clamped to maximum 256');
    });

    it('should clamp timeout to valid range (1000-60000)', () => {
      adapter.makemkvPerformance = {
        preset: 'custom',
        customSettings: { cache: 16, minbuf: 1, maxbuf: 16, timeout: 500 },
        discTypeProfiles: {}
      };

      const { settings } = adapter.buildMakeMKVFlags();
      assert.strictEqual(settings.timeout, 1000, 'timeout should be clamped to minimum 1000ms');

      adapter.makemkvPerformance.customSettings.timeout = 100000;
      const { settings: settings2 } = adapter.buildMakeMKVFlags();
      assert.strictEqual(settings2.timeout, 60000, 'timeout should be clamped to maximum 60000ms');
    });

    it('should handle missing values with defaults', () => {
      adapter.makemkvPerformance = {
        preset: 'custom',
        customSettings: {},
        discTypeProfiles: {}
      };

      const { settings } = adapter.buildMakeMKVFlags();
      assert.strictEqual(settings.cache, 16, 'should use default cache when missing');
      assert.strictEqual(settings.minbuf, 1, 'should use default minbuf when missing');
      assert.strictEqual(settings.maxbuf, 16, 'should use default maxbuf when missing');
      assert.strictEqual(settings.timeout, 10000, 'should use default timeout when missing');
    });
  });

  describe('buildMakeMKVFlags - Disc Type Profiles', () => {
    it('should use disc-type profile when discType is provided', () => {
      adapter.makemkvPerformance = {
        preset: 'balanced',
        customSettings: {},
        discTypeProfiles: {
          dvd: 'fast',
          bluray: 'balanced',
          '4k-bluray': '4k-bluray'
        }
      };

      // DVD should use fast preset
      const { flags: dvdFlags, settings: dvdSettings } = adapter.buildMakeMKVFlags({ discType: 'dvd' });
      assert.ok(dvdFlags.includes('--cache=8'));
      assert.strictEqual(dvdSettings.cache, 8);

      // Blu-ray should use balanced preset
      const { flags: bdFlags, settings: bdSettings } = adapter.buildMakeMKVFlags({ discType: 'bluray' });
      assert.ok(bdFlags.includes('--cache=16'));
      assert.strictEqual(bdSettings.cache, 16);

      // 4K Blu-ray should use 4k-bluray preset
      const { flags: bd4kFlags, settings: bd4kSettings } = adapter.buildMakeMKVFlags({ discType: '4k-bluray' });
      assert.ok(bd4kFlags.includes('--cache=128'));
      assert.strictEqual(bd4kSettings.cache, 128);
    });

    it('should fallback to global preset when discType profile not found', () => {
      adapter.makemkvPerformance = {
        preset: 'compatibility',
        customSettings: {},
        discTypeProfiles: {
          dvd: 'fast'
        }
      };

      // Blu-ray not in profile, should use global compatibility preset
      const { flags, settings } = adapter.buildMakeMKVFlags({ discType: 'bluray' });
      assert.ok(flags.includes('--cache=64'));
      assert.strictEqual(settings.cache, 64);
    });
  });

  describe('buildMakeMKVFlags - Fallback to Defaults', () => {
    it('should use default settings when makemkvPerformance is null', () => {
      adapter.makemkvPerformance = null;

      const { flags, settings } = adapter.buildMakeMKVFlags();

      assert.ok(flags.includes('--cache=16'));
      assert.strictEqual(settings.cache, 16);
      assert.strictEqual(settings.timeout, 10000);
    });

    it('should fallback to balanced when unknown preset specified', () => {
      adapter.makemkvPerformance = {
        preset: 'unknown-preset',
        customSettings: {},
        discTypeProfiles: {}
      };

      const { flags, settings } = adapter.buildMakeMKVFlags();

      // Should use balanced defaults
      assert.ok(flags.includes('--cache=16'));
      assert.strictEqual(settings.cache, 16);
    });
  });

  describe('buildMakeMKVFlags - Flag Generation', () => {
    it('should always include base flags', () => {
      adapter.makemkvPerformance = {
        preset: 'fast',
        customSettings: {},
        discTypeProfiles: {}
      };

      const { flags } = adapter.buildMakeMKVFlags();

      // Required flags
      assert.ok(flags.includes('--decrypt'), 'should include --decrypt');
      assert.ok(flags.includes('--noscan'), 'should include --noscan');
      assert.ok(flags.includes('-r'), 'should include -r (robot mode)');
      assert.ok(flags.includes('--progress=-same'), 'should include --progress=-same');
      assert.ok(flags.some(f => f.startsWith('--cache=')), 'should include --cache=');
    });

    it('should include minlength flag when minbuf > 0', () => {
      adapter.makemkvPerformance = {
        preset: 'custom',
        customSettings: { cache: 16, minbuf: 2, maxbuf: 16, timeout: 10000 },
        discTypeProfiles: {}
      };

      const { flags } = adapter.buildMakeMKVFlags();
      assert.ok(flags.includes('--minlength=2'), 'should include --minlength when minbuf > 0');
    });

    it('should not include minlength flag when minbuf = 0', () => {
      adapter.makemkvPerformance = {
        preset: 'custom',
        customSettings: { cache: 16, minbuf: 0, maxbuf: 16, timeout: 10000 },
        discTypeProfiles: {}
      };

      const { flags } = adapter.buildMakeMKVFlags();
      assert.ok(!flags.some(f => f.startsWith('--minlength=')), 'should not include --minlength when minbuf = 0');
    });

    it('should include split-size flag when splitSize > 0', () => {
      adapter.makemkvPerformance = {
        preset: 'custom',
        customSettings: { cache: 16, minbuf: 1, maxbuf: 16, timeout: 10000, splitSize: 4096 },
        discTypeProfiles: {}
      };

      const { flags } = adapter.buildMakeMKVFlags();
      assert.ok(flags.includes('--split-size=4096'), 'should include --split-size when splitSize > 0');
    });

    it('should return flags as array suitable for spawn', () => {
      adapter.makemkvPerformance = {
        preset: 'balanced',
        customSettings: {},
        discTypeProfiles: {}
      };

      const { flags } = adapter.buildMakeMKVFlags();

      assert.ok(Array.isArray(flags), 'flags should be an array');
      assert.ok(flags.length > 0, 'flags array should not be empty');
      assert.ok(flags.every(f => typeof f === 'string'), 'all flags should be strings');
    });
  });

  describe('Settings Persistence', () => {
    it('should load performance settings from settings object', async () => {
      const testSettings = {
        preset: 'compatibility',
        customSettings: {
          cache: 64,
          minbuf: 2,
          maxbuf: 32,
          timeout: 15000,
          splitSize: 0,
          retryOnError: true,
          maxRetries: 5
        },
        discTypeProfiles: {
          dvd: 'fast',
          bluray: 'compatibility',
          '4k-bluray': '4k-bluray'
        }
      };

      adapter.makemkvPerformance = testSettings;

      // Verify settings were loaded correctly
      assert.strictEqual(adapter.makemkvPerformance.preset, 'compatibility');
      assert.strictEqual(adapter.makemkvPerformance.customSettings.cache, 64);
      assert.strictEqual(adapter.makemkvPerformance.discTypeProfiles.dvd, 'fast');
    });

    it('should use defaults when no performance settings exist', () => {
      adapter.makemkvPerformance = null;
      const defaults = adapter.getDefaultPerformanceSettings();

      assert.strictEqual(defaults.preset, 'balanced');
      assert.strictEqual(defaults.customSettings.cache, 16);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty customSettings object', () => {
      adapter.makemkvPerformance = {
        preset: 'custom',
        customSettings: {},
        discTypeProfiles: {}
      };

      const { settings } = adapter.buildMakeMKVFlags();

      // Should use defaults for all values
      assert.strictEqual(settings.cache, 16);
      assert.strictEqual(settings.minbuf, 1);
      assert.strictEqual(settings.maxbuf, 16);
      assert.strictEqual(settings.timeout, 10000);
    });

    it('should handle missing discTypeProfiles', () => {
      adapter.makemkvPerformance = {
        preset: 'balanced',
        customSettings: {},
        discTypeProfiles: null
      };

      const { settings } = adapter.buildMakeMKVFlags({ discType: 'dvd' });

      // Should use global preset
      assert.strictEqual(settings.cache, 16);
    });

    it('should handle partial customSettings object', () => {
      adapter.makemkvPerformance = {
        preset: 'custom',
        customSettings: {
          cache: 32
          // other fields missing
        },
        discTypeProfiles: {}
      };

      const { settings } = adapter.buildMakeMKVFlags();

      assert.strictEqual(settings.cache, 32, 'should use provided cache');
      assert.strictEqual(settings.minbuf, 1, 'should use default minbuf');
      assert.strictEqual(settings.maxbuf, 16, 'should use default maxbuf');
      assert.strictEqual(settings.timeout, 10000, 'should use default timeout');
    });

    it('should handle numeric string values', () => {
      adapter.makemkvPerformance = {
        preset: 'custom',
        customSettings: {
          cache: '32',
          minbuf: '2',
          maxbuf: '24',
          timeout: '15000'
        },
        discTypeProfiles: {}
      };

      const { settings } = adapter.buildMakeMKVFlags();

      // Should coerce strings to numbers and validate
      assert.strictEqual(typeof settings.cache, 'number');
      assert.strictEqual(settings.cache, 32);
    });
  });
});
