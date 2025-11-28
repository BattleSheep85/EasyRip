// Shared Utility Functions
// Used by both main process and renderer

/**
 * Format bytes to human-readable string
 * @param {number} bytes - Size in bytes
 * @returns {string} Formatted size string (e.g., "4.7 GB")
 */
export function formatSize(bytes) {
  if (!bytes || bytes === 0) return '-';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Sanitize disc name for use as folder name
 * @param {string} name - Raw disc name
 * @returns {string} Sanitized name safe for filesystem
 */
export function sanitizeDiscName(name) {
  return (name || 'Unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * Calculate completion percentage
 * @param {number} current - Current size/value
 * @param {number} total - Total size/value
 * @returns {number} Percentage (0-100)
 */
export function calculatePercentage(current, total) {
  if (!total || total === 0) return 0;
  return Math.min(100, (current / total) * 100);
}

/**
 * Check if backup is considered complete based on size ratio
 * @param {number} backupSize - Size of backup in bytes
 * @param {number} discSize - Size of disc in bytes
 * @param {number} threshold - Completion threshold percentage (default 95)
 * @returns {boolean} True if backup is considered complete
 */
export function isBackupComplete(backupSize, discSize, threshold = 95) {
  if (discSize === 0) {
    // No disc size info - consider complete if > 100MB
    return backupSize > 100 * 1024 * 1024;
  }
  const ratio = calculatePercentage(backupSize, discSize);
  return ratio >= threshold;
}

/**
 * Delay helper for retry logic
 * @param {number} ms - Milliseconds to wait
 * @returns {Promise<void>}
 */
export function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry an async function with exponential backoff
 * @param {Function} fn - Async function to retry
 * @param {Object} options - Retry options
 * @param {number} options.maxRetries - Maximum retry attempts (default 3)
 * @param {number} options.baseDelay - Base delay in ms (default 1000)
 * @param {number} options.maxDelay - Maximum delay in ms (default 10000)
 * @param {Function} options.onRetry - Callback on retry (attempt, error) => void
 * @returns {Promise<any>} Result of successful function call
 */
export async function retryWithBackoff(fn, options = {}) {
  const {
    maxRetries = 3,
    baseDelay = 1000,
    maxDelay = 10000,
    onRetry = null
  } = options;

  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt < maxRetries) {
        // Exponential backoff with jitter
        const delayTime = Math.min(
          baseDelay * Math.pow(2, attempt) + Math.random() * 1000,
          maxDelay
        );

        if (onRetry) {
          onRetry(attempt + 1, error);
        }

        await delay(delayTime);
      }
    }
  }

  throw lastError;
}
