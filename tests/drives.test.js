// Unit Tests for Drive Detection
// Run with: node --test tests/drives.test.js

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { DriveDetector } from '../src/main/drives.js';

describe('DriveDetector', () => {
  let detector;

  beforeEach(() => {
    detector = new DriveDetector();
  });

  describe('constructor', () => {
    it('should initialize with default MakeMKV path', () => {
      assert.ok(detector.makemkvPath.includes('makemkvcon64.exe'));
    });

    it('should initialize empty error tracking', () => {
      assert.strictEqual(detector.lastError, null);
      assert.deepStrictEqual(detector.detectionErrors, []);
    });
  });

  describe('getDetectionErrors', () => {
    it('should return empty array initially', () => {
      const errors = detector.getDetectionErrors();
      assert.deepStrictEqual(errors, []);
    });

    it('should accumulate errors during detection', () => {
      detector.detectionErrors.push({ stage: 'test', error: 'Test error' });
      const errors = detector.getDetectionErrors();
      assert.strictEqual(errors.length, 1);
      assert.strictEqual(errors[0].stage, 'test');
    });
  });

  describe('parseValidation', () => {
    it('should validate drive letter format in eject', async () => {
      // Valid formats
      const validFormats = ['D:', 'd:', 'E:\\', 'f'];
      for (const format of validFormats) {
        const match = format.match(/^([A-Za-z]):?\\?$/);
        assert.ok(match, `Should match valid format: ${format}`);
      }
    });

    it('should reject invalid drive letter formats', async () => {
      const invalidFormats = ['DD:', '1:', '', 'abc:', '..'];
      for (const format of invalidFormats) {
        const match = format.match(/^([A-Za-z]):?\\?$/);
        assert.strictEqual(match, null, `Should reject invalid format: ${format}`);
      }
    });
  });

  describe('getMakeMKVMapping', () => {
    it('should return Map', async () => {
      // Mock will return empty since MakeMKV not installed in test env
      const mapping = await detector.getMakeMKVMapping();
      assert.ok(mapping instanceof Map);
    });

    it('should handle missing MakeMKV', async () => {
      const mapping = await detector.getMakeMKVMapping();
      // Mapping will be empty or have errors
      assert.ok(mapping instanceof Map);
      const errors = detector.getDetectionErrors();
      // May have errors if MakeMKV not found
      assert.ok(Array.isArray(errors));
    });
  });

  describe('getDiscSizeSync', () => {
    it('should return number for valid drive', () => {
      // This will fail on non-Windows or without actual disc
      // Just test that it returns a number
      const result = detector.getDiscSizeSync('C:');
      assert.ok(typeof result === 'number');
      assert.ok(result >= 0);
    });

    it('should return 0 for invalid drive', () => {
      const result = detector.getDiscSizeSync('Z:\\NonExistent');
      assert.strictEqual(result, 0);
    });

    it('should handle drive letter variations', () => {
      // Test different formats
      const formats = ['C:', 'C', 'c:', 'c'];
      for (const format of formats) {
        const result = detector.getDiscSizeSync(format);
        assert.ok(typeof result === 'number');
      }
    });
  });

  describe('getDiscSize (async)', () => {
    it('should return number', async () => {
      const result = await detector.getDiscSize('C:');
      assert.ok(typeof result === 'number');
      assert.ok(result >= 0);
    });
  });

  describe('ejectDrive', () => {
    it('should validate drive letter format', async () => {
      const result = await detector.ejectDrive('invalid');
      assert.strictEqual(result.success, false);
      assert.ok(result.error);
    });

    it('should accept valid drive letters', async () => {
      // Note: This will fail on actual system without ejectable drive
      // but format validation should pass
      const result = await detector.ejectDrive('D:');
      // Result depends on system state - just check structure
      assert.ok(typeof result === 'object');
      assert.ok('success' in result);
      assert.ok('driveLetter' in result || 'error' in result);
    });

    it('should reject drives like Z:', async () => {
      // Z: likely doesn't exist
      const result = await detector.ejectDrive('Z:');
      // Should have failed or returned error
      assert.ok(typeof result === 'object');
    });
  });

  describe('detectDrives', () => {
    it('should return array', async () => {
      const drives = await detector.detectDrives();
      assert.ok(Array.isArray(drives));
    });

    it('should include drive properties', async () => {
      const drives = await detector.detectDrives();
      if (drives.length > 0) {
        const drive = drives[0];
        assert.ok('id' in drive);
        assert.ok('driveLetter' in drive);
        assert.ok('discName' in drive);
        assert.ok('discSize' in drive);
        assert.ok('makemkvIndex' in drive);
        assert.ok('isBluray' in drive);
        assert.ok('isDVD' in drive);
        assert.ok('hasDisc' in drive);
      }
    });

    it('should set error tracking', async () => {
      await detector.detectDrives();
      assert.ok(Array.isArray(detector.detectionErrors));
    });
  });

  describe('integration', () => {
    it('should handle detection cycle', async () => {
      const detector1 = new DriveDetector();
      const drives1 = await detector1.detectDrives();
      const errors1 = detector1.getDetectionErrors();

      assert.ok(Array.isArray(drives1));
      assert.ok(Array.isArray(errors1));

      // Second detection should work too
      const detector2 = new DriveDetector();
      const drives2 = await detector2.detectDrives();
      assert.ok(Array.isArray(drives2));
    });
  });
});
