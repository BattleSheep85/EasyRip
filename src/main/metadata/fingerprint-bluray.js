/**
 * Blu-ray Fingerprinting
 * Extracts embedded metadata from mounted Blu-ray disc
 *
 * Sources:
 * - /BDMV/META/DL/bdmt_*.xml - Disc title in XML format
 * - /AACS/mcmf.xml - Content ID (ISAN number)
 * - /CERTIFICATE/id.bdmv - Organization ID and Disc ID
 */

import { promises as fs } from 'fs';
import { existsSync, readdirSync, readFileSync } from 'fs';
import path from 'path';
import logger from '../logger.js';

const log = {
  info: (msg, data) => logger.info('fingerprint-bluray', msg, data),
  warn: (msg, data) => logger.warn('fingerprint-bluray', msg, data),
  error: (msg, data) => logger.error('fingerprint-bluray', msg, data),
  debug: (msg, data) => logger.debug('fingerprint-bluray', msg, data),
};

/**
 * Generate Blu-ray fingerprint from mounted disc
 * @param {string} drivePath - Path to mounted Blu-ray (e.g., "D:" or "D:/")
 * @returns {Promise<Object>} Fingerprint result
 */
export async function generateBlurayFingerprint(drivePath) {
  const result = {
    type: 'bluray',
    contentId: null,
    discId: null,
    organizationId: null,
    embeddedTitle: null,
    volumeLabel: null,
    capturedAt: new Date().toISOString(),
    error: null
  };

  try {
    // Normalize drive path
    const normalizedPath = drivePath.replace(/[/\\]$/, '');
    const bdmvPath = path.join(normalizedPath, 'BDMV');

    // Check if BDMV exists
    if (!existsSync(bdmvPath)) {
      result.error = 'BDMV folder not found';
      log.warn(`BDMV not found at ${bdmvPath}`);
      return result;
    }

    log.info(`Generating Blu-ray fingerprint from ${normalizedPath}`);

    // Extract embedded title from META/DL/bdmt_*.xml
    result.embeddedTitle = await extractEmbeddedTitle(normalizedPath);

    // Extract content ID (ISAN) from AACS/mcmf.xml
    result.contentId = await extractContentId(normalizedPath);

    // Extract disc ID from CERTIFICATE/id.bdmv
    const discIds = await extractDiscIds(normalizedPath);
    if (discIds) {
      result.discId = discIds.discId;
      result.organizationId = discIds.organizationId;
    }

    // Log what we found
    const found = [];
    if (result.embeddedTitle) found.push(`title="${result.embeddedTitle}"`);
    if (result.contentId) found.push(`contentId=${result.contentId}`);
    if (result.discId) found.push(`discId=${result.discId}`);

    if (found.length > 0) {
      log.info(`Blu-ray fingerprint: ${found.join(', ')}`);
    } else {
      log.warn('No Blu-ray metadata found');
      result.error = 'No embedded metadata found';
    }

    return result;

  } catch (error) {
    result.error = error.message;
    log.error(`Fingerprint generation failed: ${error.message}`);
    return result;
  }
}

/**
 * Extract embedded title from bdmt_*.xml files
 * Tries English first, then falls back to other languages
 * @param {string} drivePath - Path to mounted disc
 * @returns {Promise<string|null>} Embedded title or null
 */
async function extractEmbeddedTitle(drivePath) {
  const metaPath = path.join(drivePath, 'BDMV', 'META', 'DL');

  if (!existsSync(metaPath)) {
    log.debug('META/DL folder not found');
    return null;
  }

  try {
    const files = readdirSync(metaPath);

    // Prioritize English, then try others
    const bdmtFiles = files.filter(f => f.toLowerCase().startsWith('bdmt_') && f.toLowerCase().endsWith('.xml'));

    // Sort to prioritize English
    bdmtFiles.sort((a, b) => {
      const aIsEng = a.toLowerCase().includes('eng');
      const bIsEng = b.toLowerCase().includes('eng');
      if (aIsEng && !bIsEng) return -1;
      if (!aIsEng && bIsEng) return 1;
      return 0;
    });

    for (const file of bdmtFiles) {
      const filePath = path.join(metaPath, file);
      const title = await parseDiscTitle(filePath);
      if (title) {
        log.debug(`Found title in ${file}: "${title}"`);
        return title;
      }
    }

    return null;
  } catch (error) {
    log.warn(`Failed to read META/DL: ${error.message}`);
    return null;
  }
}

/**
 * Parse disc title from bdmt_*.xml file
 * @param {string} filePath - Path to XML file
 * @returns {Promise<string|null>} Title or null
 */
async function parseDiscTitle(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf8');

    // Look for <di:name>...</di:name> pattern
    // The namespace prefix may vary, so we match any prefix or none
    const patterns = [
      /<(?:di:)?name>([^<]+)<\/(?:di:)?name>/i,
      /<name[^>]*>([^<]+)<\/name>/i,
      /<discinfo[^>]*>[\s\S]*?<title[^>]*>[\s\S]*?<name>([^<]+)<\/name>/i
    ];

    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (match && match[1]) {
        const title = match[1].trim();
        // Validate it's not empty or just whitespace
        if (title.length > 0) {
          return title;
        }
      }
    }

    return null;
  } catch (error) {
    log.debug(`Failed to parse ${path.basename(filePath)}: ${error.message}`);
    return null;
  }
}

/**
 * Extract content ID (ISAN) from AACS/mcmf.xml
 * @param {string} drivePath - Path to mounted disc
 * @returns {Promise<string|null>} Content ID or null
 */
async function extractContentId(drivePath) {
  const mcmfPath = path.join(drivePath, 'AACS', 'mcmf.xml');

  if (!existsSync(mcmfPath)) {
    log.debug('AACS/mcmf.xml not found');
    return null;
  }

  try {
    const content = await fs.readFile(mcmfPath, 'utf8');

    // Look for contentID attribute
    // Pattern: contentID="..." (32-character hex string)
    const match = content.match(/contentID\s*=\s*["']([A-Fa-f0-9]{32})["']/i);

    if (match && match[1]) {
      const contentId = match[1].toUpperCase();
      log.debug(`Found contentID: ${contentId}`);
      return contentId;
    }

    return null;
  } catch (error) {
    log.warn(`Failed to parse mcmf.xml: ${error.message}`);
    return null;
  }
}

/**
 * Extract disc IDs from CERTIFICATE/id.bdmv
 * Binary format:
 * - Offset 40-43: Organization ID (4 bytes)
 * - Offset 44-59: Disc ID (16 bytes)
 * @param {string} drivePath - Path to mounted disc
 * @returns {Promise<Object|null>} { organizationId, discId } or null
 */
async function extractDiscIds(drivePath) {
  const idBdmvPath = path.join(drivePath, 'CERTIFICATE', 'id.bdmv');

  if (!existsSync(idBdmvPath)) {
    log.debug('CERTIFICATE/id.bdmv not found');
    return null;
  }

  try {
    const buffer = readFileSync(idBdmvPath);

    // id.bdmv must be at least 60 bytes
    if (buffer.length < 60) {
      log.warn('id.bdmv file too small');
      return null;
    }

    // Organization ID: 4 bytes at offset 40
    const orgId = buffer.slice(40, 44).toString('hex').toUpperCase();

    // Disc ID: 16 bytes at offset 44
    const discId = buffer.slice(44, 60).toString('hex').toUpperCase();

    log.debug(`Found orgId=${orgId}, discId=${discId}`);

    return {
      organizationId: orgId,
      discId: discId
    };
  } catch (error) {
    log.warn(`Failed to parse id.bdmv: ${error.message}`);
    return null;
  }
}

/**
 * Validate that a path is a valid Blu-ray structure
 * @param {string} drivePath - Path to check
 * @returns {boolean} True if valid Blu-ray structure
 */
export function isValidBlurayStructure(drivePath) {
  try {
    const normalizedPath = drivePath.replace(/[/\\]$/, '');
    const bdmvPath = path.join(normalizedPath, 'BDMV');

    if (!existsSync(bdmvPath)) {
      return false;
    }

    // Check for PLAYLIST or STREAM folder (essential for Blu-ray)
    const playlistPath = path.join(bdmvPath, 'PLAYLIST');
    const streamPath = path.join(bdmvPath, 'STREAM');

    return existsSync(playlistPath) || existsSync(streamPath);
  } catch {
    return false;
  }
}

export default {
  generateBlurayFingerprint,
  isValidBlurayStructure
};
