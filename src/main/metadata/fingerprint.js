/**
 * Disc Fingerprinting Orchestrator
 * Detects disc type and generates appropriate fingerprint
 *
 * IMPORTANT: Must be called BEFORE MakeMKV backup starts
 * MakeMKV extraction modifies file timestamps which alters DVD fingerprints
 */

import { existsSync } from 'fs';
import path from 'path';
import { generateDVDFingerprint, isValidDVDStructure } from './fingerprint-dvd.js';
import { generateBlurayFingerprint, isValidBlurayStructure } from './fingerprint-bluray.js';
import logger from '../logger.js';

const log = {
  info: (msg, data) => logger.info('fingerprint', msg, data),
  warn: (msg, data) => logger.warn('fingerprint', msg, data),
  error: (msg, data) => logger.error('fingerprint', msg, data),
  debug: (msg, data) => logger.debug('fingerprint', msg, data),
};

/**
 * Disc types
 */
export const DiscType = {
  DVD: 'dvd',
  BLURAY: 'bluray',
  UNKNOWN: 'unknown'
};

/**
 * Detect disc type from mounted path
 * @param {string} drivePath - Path to mounted disc
 * @returns {string} DiscType value
 */
export function detectDiscType(drivePath) {
  const normalizedPath = drivePath.replace(/[/\\]$/, '');

  // Check for Blu-ray first (BDMV folder)
  if (isValidBlurayStructure(normalizedPath)) {
    return DiscType.BLURAY;
  }

  // Check for DVD (VIDEO_TS folder)
  if (isValidDVDStructure(normalizedPath)) {
    return DiscType.DVD;
  }

  return DiscType.UNKNOWN;
}

/**
 * Generate fingerprint from mounted disc
 * Automatically detects disc type and uses appropriate fingerprinter
 *
 * @param {string} drivePath - Path to mounted disc (e.g., "D:" or "D:/")
 * @param {string} volumeLabel - Volume label from drive detection
 * @returns {Promise<Object>} Fingerprint result
 */
export async function generateFingerprint(drivePath, volumeLabel = null) {
  const startTime = Date.now();

  log.info(`Starting fingerprint capture for ${drivePath}`);

  // Detect disc type
  const discType = detectDiscType(drivePath);

  let result;

  switch (discType) {
    case DiscType.DVD:
      log.info('Detected DVD, generating CRC64 fingerprint');
      result = await generateDVDFingerprint(drivePath);
      break;

    case DiscType.BLURAY:
      log.info('Detected Blu-ray, extracting embedded metadata');
      result = await generateBlurayFingerprint(drivePath);
      break;

    default:
      log.warn(`Unknown disc type at ${drivePath}`);
      result = {
        type: DiscType.UNKNOWN,
        error: 'Could not detect disc type (no VIDEO_TS or BDMV folder)',
        capturedAt: new Date().toISOString()
      };
  }

  // Add volume label if provided
  if (volumeLabel) {
    result.volumeLabel = volumeLabel;
  }

  // Log completion
  const elapsed = Date.now() - startTime;
  log.info(`Fingerprint capture completed in ${elapsed}ms`, {
    type: result.type,
    hasFingerprint: !!(result.crc64 || result.contentId || result.discId || result.embeddedTitle),
    error: result.error || null
  });

  return result;
}

/**
 * Check if fingerprint has useful identification data
 * @param {Object} fingerprint - Fingerprint result
 * @returns {boolean} True if fingerprint has useful data
 */
export function hasUsefulFingerprint(fingerprint) {
  if (!fingerprint || fingerprint.error) {
    return false;
  }

  // DVD: has CRC64
  if (fingerprint.type === DiscType.DVD && fingerprint.crc64) {
    return true;
  }

  // Blu-ray: has any of the IDs or embedded title
  if (fingerprint.type === DiscType.BLURAY) {
    return !!(fingerprint.contentId || fingerprint.discId || fingerprint.embeddedTitle);
  }

  return false;
}

/**
 * Get best identifier from fingerprint for lookups
 * @param {Object} fingerprint - Fingerprint result
 * @returns {Object} { type, value } or null
 */
export function getBestIdentifier(fingerprint) {
  if (!fingerprint) {
    return null;
  }

  // DVD: use CRC64
  if (fingerprint.type === DiscType.DVD && fingerprint.crc64) {
    return { type: 'dvd_crc64', value: fingerprint.crc64 };
  }

  // Blu-ray: prefer contentId (ISAN), then discId
  if (fingerprint.type === DiscType.BLURAY) {
    if (fingerprint.contentId) {
      return { type: 'bluray_isan', value: fingerprint.contentId };
    }
    if (fingerprint.discId) {
      return { type: 'bluray_discid', value: fingerprint.discId };
    }
  }

  return null;
}

/**
 * Get search hint from fingerprint (for TMDB searches)
 * @param {Object} fingerprint - Fingerprint result
 * @returns {string|null} Search hint or null
 */
export function getSearchHint(fingerprint) {
  if (!fingerprint) {
    return null;
  }

  // Blu-ray embedded title is the best hint
  if (fingerprint.embeddedTitle) {
    return fingerprint.embeddedTitle;
  }

  // Volume label as fallback
  if (fingerprint.volumeLabel) {
    return fingerprint.volumeLabel;
  }

  return null;
}

export default {
  DiscType,
  detectDiscType,
  generateFingerprint,
  hasUsefulFingerprint,
  getBestIdentifier,
  getSearchHint
};
