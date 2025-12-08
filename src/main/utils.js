// Utility functions for the main process

import { Notification } from 'electron';
import path from 'path';
import logger from './logger.js';
import { MakeMKVAdapter } from './makemkv.js';

// Shared MakeMKV instance and initialization lock
let sharedMakeMKV = null;
let sharedMakeMKVPromise = null;

/**
 * Security: Validate backup/disc names to prevent path traversal attacks
 */
export function sanitizeBackupName(name) {
  if (!name || typeof name !== 'string') {
    throw new Error('Invalid backup name');
  }
  // Use path.basename to strip any directory components and prevent traversal
  const sanitized = path.basename(name);
  // Reject if the name contained traversal attempts or is empty after sanitization
  if (!sanitized || sanitized !== name || name.includes('..')) {
    throw new Error('Invalid backup name: path traversal detected');
  }
  return sanitized;
}

/**
 * Helper function to show desktop notifications
 */
export function showNotification(title, body, type = 'info') {
  if (!Notification.isSupported()) {
    logger.warn('notification', 'Notifications not supported on this system');
    return;
  }

  try {
    const notification = new Notification({
      title,
      body,
      silent: false,
    });
    notification.show();
    logger.debug('notification', `Showed notification: ${title}`);
  } catch (error) {
    logger.warn('notification', `Failed to show notification: ${error.message}`);
  }
}

/**
 * Get or create shared MakeMKV instance (for settings/status checks)
 * Uses a lock to prevent race conditions during initialization
 */
export async function getSharedMakeMKV() {
  if (sharedMakeMKV) {
    return sharedMakeMKV;
  }

  // If already initializing, wait for that to complete
  if (sharedMakeMKVPromise) {
    return sharedMakeMKVPromise;
  }

  // Start initialization
  sharedMakeMKVPromise = (async () => {
    const instance = new MakeMKVAdapter();
    await instance.loadSettings();
    sharedMakeMKV = instance;
    return instance;
  })();

  return sharedMakeMKVPromise;
}

/**
 * Reset shared MakeMKV instance (for cleanup)
 */
export function resetSharedMakeMKV() {
  sharedMakeMKV = null;
  sharedMakeMKVPromise = null;
}
