/**
 * MakeMKV Error Resilience Tests
 * Tests error parsing, recovery detection, and partial backup handling
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MakeMKVAdapter } from '../src/main/makemkv.js';

describe('MakeMKV Error Resilience', () => {
  let adapter;

  beforeEach(() => {
    adapter = new MakeMKVAdapter();
  });

  describe('parseErrorMessage', () => {
    it('should parse hash check failed error', () => {
      const message = 'Hash check failed for file 00800.m2ts at offset 13637904384';
      const result = adapter.parseErrorMessage(message);

      expect(result).toMatchObject({
        file: '00800.m2ts',
        error: 'Hash check failed',
        message: message
      });
      expect(result.timestamp).toBeDefined();
    });

    it('should parse read error', () => {
      const message = 'Error reading file 01234.m2ts';
      const result = adapter.parseErrorMessage(message);

      expect(result).toMatchObject({
        file: '01234.m2ts',
        error: 'Read error',
        message: message
      });
    });

    it('should parse failed to save error', () => {
      const message = 'Failed to save title 00042.m2ts';
      const result = adapter.parseErrorMessage(message);

      expect(result).toMatchObject({
        file: '00042.m2ts',
        error: 'Failed to save',
        message: message
      });
    });

    it('should extract offset when present', () => {
      const message = 'Hash check failed at offset 13637904384';
      const result = adapter.parseErrorMessage(message);

      expect(result.offset).toBe('13637904384');
    });

    it('should handle errors without file names', () => {
      const message = 'SCSI error - MEDIUM ERROR:L-EC UNCORRECTABLE ERROR';
      const result = adapter.parseErrorMessage(message);

      expect(result.file).toBeNull();
      expect(result.message).toBe(message);
    });

    it('should handle malformed error messages gracefully', () => {
      const message = 'Random error with no structure';
      const result = adapter.parseErrorMessage(message);

      expect(result).toMatchObject({
        message: message,
        file: null
      });
      expect(result.timestamp).toBeDefined();
    });

    it('should parse error with alternate file pattern', () => {
      const message = 'Cannot read title VIDEO_TS.IFO';
      const result = adapter.parseErrorMessage(message);

      expect(result.file).toBe('VIDEO_TS.IFO');
    });
  });

  describe('isRecoverableError', () => {
    it('should identify hash check errors as recoverable', () => {
      const message = 'Hash check failed for file 00800.m2ts';
      expect(adapter.isRecoverableError(message)).toBe(true);
    });

    it('should identify read errors as recoverable', () => {
      const messages = [
        'Error reading file 00800.m2ts',
        'Read error at sector 12345',
        'SCSI error - read failed'
      ];

      messages.forEach(msg => {
        expect(adapter.isRecoverableError(msg)).toBe(true);
      });
    });

    it('should identify SCSI errors as recoverable', () => {
      const message = 'SCSI error - MEDIUM ERROR:L-EC UNCORRECTABLE ERROR';
      expect(adapter.isRecoverableError(message)).toBe(true);
    });

    it('should identify bad sector errors as recoverable', () => {
      const message = 'Bad sector encountered at position 1234567890';
      expect(adapter.isRecoverableError(message)).toBe(true);
    });

    it('should identify out of memory as fatal', () => {
      const message = 'Out of memory';
      expect(adapter.isRecoverableError(message)).toBe(false);
    });

    it('should identify disk full as fatal', () => {
      const message = 'Disk full - cannot write';
      expect(adapter.isRecoverableError(message)).toBe(false);
    });

    it('should identify permission errors as fatal', () => {
      const messages = [
        'Permission denied',
        'Access denied to file',
        'Cannot create destination folder'
      ];

      messages.forEach(msg => {
        expect(adapter.isRecoverableError(msg)).toBe(false);
      });
    });

    it('should identify invalid errors as fatal', () => {
      const message = 'Invalid disc format';
      expect(adapter.isRecoverableError(message)).toBe(false);
    });

    it('should treat unknown errors as fatal by default', () => {
      const message = 'Unknown mysterious error';
      expect(adapter.isRecoverableError(message)).toBe(false);
    });

    it('should be case insensitive', () => {
      expect(adapter.isRecoverableError('HASH CHECK FAILED')).toBe(true);
      expect(adapter.isRecoverableError('Read Error')).toBe(true);
      expect(adapter.isRecoverableError('OUT OF MEMORY')).toBe(false);
    });
  });

  describe('Error metadata structure', () => {
    it('should create proper error info structure', () => {
      const message = 'Hash check failed for file 00800.m2ts at offset 13637904384';
      const result = adapter.parseErrorMessage(message, 'MSG:1234,0,0,"Hash check failed for file 00800.m2ts at offset 13637904384"');

      expect(result).toHaveProperty('message');
      expect(result).toHaveProperty('file');
      expect(result).toHaveProperty('error');
      expect(result).toHaveProperty('offset');
      expect(result).toHaveProperty('timestamp');
      expect(typeof result.timestamp).toBe('string');
      expect(new Date(result.timestamp).toString()).not.toBe('Invalid Date');
    });

    it('should handle null/undefined inputs safely', () => {
      expect(() => adapter.parseErrorMessage(null)).not.toThrow();
      expect(() => adapter.parseErrorMessage(undefined)).not.toThrow();
      expect(() => adapter.parseErrorMessage('')).not.toThrow();
    });
  });

  describe('Recovery percentage calculation', () => {
    it('should calculate 100% when no errors', () => {
      const filesSuccessful = 100;
      const filesFailed = 0;
      const totalFiles = filesSuccessful + filesFailed;
      const percentRecovered = (filesSuccessful / totalFiles) * 100;

      expect(percentRecovered).toBe(100);
    });

    it('should calculate correct percentage with errors', () => {
      const filesSuccessful = 98;
      const filesFailed = 2;
      const totalFiles = filesSuccessful + filesFailed;
      const percentRecovered = (filesSuccessful / totalFiles) * 100;

      expect(percentRecovered).toBe(98);
    });

    it('should handle edge case of all failures', () => {
      const filesSuccessful = 0;
      const filesFailed = 10;
      const totalFiles = filesSuccessful + filesFailed;
      const percentRecovered = (filesSuccessful / totalFiles) * 100;

      expect(percentRecovered).toBe(0);
    });
  });

  describe('Error message variations', () => {
    const testCases = [
      {
        message: 'Hash check failed for file 00800.m2ts at offset:13637904384',
        expectedFile: '00800.m2ts',
        expectedError: 'Hash check failed',
        recoverable: true
      },
      {
        message: 'Failed to save title 00042.m2ts',
        expectedFile: '00042.m2ts',
        expectedError: 'Failed to save',
        recoverable: false // save failures could be disk space
      },
      {
        message: 'SCSI error - MEDIUM ERROR',
        expectedFile: null,
        expectedError: 'Unknown error',
        recoverable: true
      }
    ];

    testCases.forEach(({ message, expectedFile, expectedError, recoverable }) => {
      it(`should correctly parse: "${message}"`, () => {
        const result = adapter.parseErrorMessage(message);
        expect(result.file).toBe(expectedFile);
        expect(result.error).toBe(expectedError);
        expect(adapter.isRecoverableError(message)).toBe(recoverable);
      });
    });
  });
});
