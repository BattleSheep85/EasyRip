// Unit Tests for Shared Utilities
// Run with: node --test tests/utils.test.js

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  formatSize,
  sanitizeDiscName,
  calculatePercentage,
  isBackupComplete,
  retryWithBackoff,
  delay
} from '../src/shared/utils.js';

describe('formatSize', () => {
  it('should return "-" for zero bytes', () => {
    assert.strictEqual(formatSize(0), '-');
  });

  it('should return "-" for null/undefined', () => {
    assert.strictEqual(formatSize(null), '-');
    assert.strictEqual(formatSize(undefined), '-');
  });

  it('should format bytes correctly', () => {
    assert.strictEqual(formatSize(500), '500 B');
  });

  it('should format kilobytes correctly', () => {
    assert.strictEqual(formatSize(1024), '1 KB');
    assert.strictEqual(formatSize(1536), '1.5 KB');
  });

  it('should format megabytes correctly', () => {
    assert.strictEqual(formatSize(1024 * 1024), '1 MB');
    assert.strictEqual(formatSize(5.5 * 1024 * 1024), '5.5 MB');
  });

  it('should format gigabytes correctly', () => {
    assert.strictEqual(formatSize(1024 * 1024 * 1024), '1 GB');
    assert.strictEqual(formatSize(4.7 * 1024 * 1024 * 1024), '4.7 GB');
  });

  it('should format terabytes correctly', () => {
    assert.strictEqual(formatSize(1024 * 1024 * 1024 * 1024), '1 TB');
  });

  it('should handle typical DVD size (~4.7GB)', () => {
    const dvdSize = 4700000000; // ~4.7GB
    const result = formatSize(dvdSize);
    assert.ok(result.includes('GB'));
    assert.ok(parseFloat(result) >= 4 && parseFloat(result) <= 5);
  });

  it('should handle typical Blu-ray size (~25GB)', () => {
    const bluraySize = 25000000000; // ~25GB
    const result = formatSize(bluraySize);
    assert.ok(result.includes('GB'));
    assert.ok(parseFloat(result) >= 23 && parseFloat(result) <= 26);
  });
});

describe('sanitizeDiscName', () => {
  it('should return "Unknown" for empty/null input', () => {
    assert.strictEqual(sanitizeDiscName(''), 'Unknown');
    assert.strictEqual(sanitizeDiscName(null), 'Unknown');
    assert.strictEqual(sanitizeDiscName(undefined), 'Unknown');
  });

  it('should keep alphanumeric characters', () => {
    assert.strictEqual(sanitizeDiscName('MovieTitle2024'), 'MovieTitle2024');
  });

  it('should keep hyphens and underscores', () => {
    assert.strictEqual(sanitizeDiscName('Movie-Title_2024'), 'Movie-Title_2024');
  });

  it('should replace spaces with underscores', () => {
    assert.strictEqual(sanitizeDiscName('Movie Title'), 'Movie_Title');
  });

  it('should replace special characters', () => {
    assert.strictEqual(sanitizeDiscName('Movie: The Sequel!'), 'Movie__The_Sequel_');
  });

  it('should handle typical disc names', () => {
    assert.strictEqual(sanitizeDiscName('AVENGERS_ENDGAME'), 'AVENGERS_ENDGAME');
    assert.strictEqual(sanitizeDiscName('STAR WARS'), 'STAR_WARS');
  });
});

describe('calculatePercentage', () => {
  it('should return 0 for zero total', () => {
    assert.strictEqual(calculatePercentage(50, 0), 0);
  });

  it('should return 0 for null/undefined total', () => {
    assert.strictEqual(calculatePercentage(50, null), 0);
    assert.strictEqual(calculatePercentage(50, undefined), 0);
  });

  it('should calculate correct percentage', () => {
    assert.strictEqual(calculatePercentage(50, 100), 50);
    assert.strictEqual(calculatePercentage(75, 100), 75);
    assert.strictEqual(calculatePercentage(100, 100), 100);
  });

  it('should cap at 100%', () => {
    assert.strictEqual(calculatePercentage(150, 100), 100);
  });

  it('should handle real backup scenarios', () => {
    const discSize = 4700000000; // 4.7GB disc
    const backupSize = 4465000000; // 95% complete
    const percentage = calculatePercentage(backupSize, discSize);
    assert.ok(percentage >= 94 && percentage <= 96);
  });
});

describe('isBackupComplete', () => {
  const GB = 1024 * 1024 * 1024;

  it('should consider backup complete at 95% threshold', () => {
    const discSize = 4.7 * GB;
    const backupSize = discSize * 0.95;
    assert.strictEqual(isBackupComplete(backupSize, discSize), true);
  });

  it('should consider backup incomplete below 95%', () => {
    const discSize = 4.7 * GB;
    const backupSize = discSize * 0.90;
    assert.strictEqual(isBackupComplete(backupSize, discSize), false);
  });

  it('should allow custom threshold', () => {
    const discSize = 4.7 * GB;
    const backupSize = discSize * 0.90;
    assert.strictEqual(isBackupComplete(backupSize, discSize, 90), true);
    assert.strictEqual(isBackupComplete(backupSize, discSize, 91), false);
  });

  it('should handle zero disc size with large backup', () => {
    // When disc size unknown, complete if > 100MB
    assert.strictEqual(isBackupComplete(200 * 1024 * 1024, 0), true);
  });

  it('should handle zero disc size with small backup', () => {
    assert.strictEqual(isBackupComplete(50 * 1024 * 1024, 0), false);
  });

  it('should handle typical DVD backup', () => {
    const dvdSize = 4700000000;
    // 4.5GB of 4.7GB = ~95.7%
    assert.strictEqual(isBackupComplete(4500000000, dvdSize), true);
    // 4.0GB of 4.7GB = ~85%
    assert.strictEqual(isBackupComplete(4000000000, dvdSize), false);
  });

  it('should handle typical Blu-ray backup', () => {
    const bluraySize = 25000000000;
    // 24GB of 25GB = 96%
    assert.strictEqual(isBackupComplete(24000000000, bluraySize), true);
    // 20GB of 25GB = 80%
    assert.strictEqual(isBackupComplete(20000000000, bluraySize), false);
  });
});

describe('delay', () => {
  it('should delay for specified time', async () => {
    const start = Date.now();
    await delay(100);
    const elapsed = Date.now() - start;
    assert.ok(elapsed >= 95 && elapsed < 150, `Expected ~100ms, got ${elapsed}ms`);
  });
});

describe('retryWithBackoff', () => {
  it('should succeed on first try', async () => {
    let attempts = 0;
    const result = await retryWithBackoff(async () => {
      attempts++;
      return 'success';
    });
    assert.strictEqual(result, 'success');
    assert.strictEqual(attempts, 1);
  });

  it('should retry on failure and succeed', async () => {
    let attempts = 0;
    const result = await retryWithBackoff(
      async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error('Temporary failure');
        }
        return 'success after retries';
      },
      { maxRetries: 3, baseDelay: 10 }
    );
    assert.strictEqual(result, 'success after retries');
    assert.strictEqual(attempts, 3);
  });

  it('should throw after max retries exhausted', async () => {
    let attempts = 0;
    await assert.rejects(
      async () => {
        await retryWithBackoff(
          async () => {
            attempts++;
            throw new Error('Persistent failure');
          },
          { maxRetries: 2, baseDelay: 10 }
        );
      },
      { message: 'Persistent failure' }
    );
    assert.strictEqual(attempts, 3); // Initial + 2 retries
  });

  it('should call onRetry callback', async () => {
    const retryLog = [];
    await assert.rejects(async () => {
      await retryWithBackoff(
        async () => { throw new Error('fail'); },
        {
          maxRetries: 2,
          baseDelay: 10,
          onRetry: (attempt, error) => {
            retryLog.push({ attempt, message: error.message });
          }
        }
      );
    });
    assert.strictEqual(retryLog.length, 2);
    assert.strictEqual(retryLog[0].attempt, 1);
    assert.strictEqual(retryLog[1].attempt, 2);
  });
});
