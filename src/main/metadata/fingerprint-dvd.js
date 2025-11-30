/**
 * DVD Fingerprinting
 * Generates CRC64 fingerprint from mounted DVD disc
 * Port of pydvdid algorithm to JavaScript
 *
 * IMPORTANT: Must be run on mounted disc BEFORE MakeMKV extraction
 * File timestamps are modified during extraction and would alter the fingerprint
 */

import { promises as fs } from 'fs';
import { statSync, existsSync, readdirSync, readFileSync } from 'fs';
import path from 'path';
import { createCRC64, dateToFiletime, filetimeToBuffer, uint32ToBuffer } from './crc64.js';
import logger from '../logger.js';

const log = {
  info: (msg, data) => logger.info('fingerprint-dvd', msg, data),
  warn: (msg, data) => logger.warn('fingerprint-dvd', msg, data),
  error: (msg, data) => logger.error('fingerprint-dvd', msg, data),
  debug: (msg, data) => logger.debug('fingerprint-dvd', msg, data),
};

// File extensions to include in fingerprint
const DVD_FILE_EXTENSIONS = ['.ifo', '.bup', '.vob'];

// Bytes to read from key IFO files
const IFO_READ_SIZE = 65536; // 64KB

/**
 * Generate DVD fingerprint from mounted disc
 * @param {string} drivePath - Path to mounted DVD (e.g., "D:" or "D:/")
 * @returns {Promise<Object>} Fingerprint result
 */
export async function generateDVDFingerprint(drivePath) {
  const result = {
    type: 'dvd',
    crc64: null,
    volumeLabel: null,
    fileCount: 0,
    capturedAt: new Date().toISOString(),
    error: null
  };

  try {
    // Normalize drive path
    const normalizedPath = drivePath.replace(/[/\\]$/, '');
    const videoTsPath = path.join(normalizedPath, 'VIDEO_TS');

    // Check if VIDEO_TS exists
    if (!existsSync(videoTsPath)) {
      result.error = 'VIDEO_TS folder not found';
      log.warn(`VIDEO_TS not found at ${videoTsPath}`);
      return result;
    }

    log.info(`Generating DVD fingerprint from ${videoTsPath}`);

    // Get all DVD files
    const files = getDVDFiles(videoTsPath);
    result.fileCount = files.length;

    if (files.length === 0) {
      result.error = 'No DVD files found in VIDEO_TS';
      log.warn('No IFO/BUP/VOB files found');
      return result;
    }

    log.debug(`Found ${files.length} DVD files to fingerprint`);

    // Calculate CRC64
    const crc = createCRC64();

    // Process each file in sorted order (alphabetical, case-insensitive)
    for (const file of files) {
      const filePath = path.join(videoTsPath, file);
      try {
        await addFileToFingerprint(crc, filePath, file);
      } catch (err) {
        log.warn(`Failed to process ${file}: ${err.message}`);
        // Continue with other files
      }
    }

    // Add first 64KB of VIDEO_TS.IFO if it exists
    const videoTsIfoPath = path.join(videoTsPath, 'VIDEO_TS.IFO');
    if (existsSync(videoTsIfoPath)) {
      try {
        await addIfoContent(crc, videoTsIfoPath, 'VIDEO_TS.IFO');
      } catch (err) {
        log.warn(`Failed to read VIDEO_TS.IFO content: ${err.message}`);
      }
    }

    // Add first 64KB of VTS_01_0.IFO if it exists
    const vts01IfoPath = path.join(videoTsPath, 'VTS_01_0.IFO');
    if (existsSync(vts01IfoPath)) {
      try {
        await addIfoContent(crc, vts01IfoPath, 'VTS_01_0.IFO');
      } catch (err) {
        log.warn(`Failed to read VTS_01_0.IFO content: ${err.message}`);
      }
    }

    // Get final fingerprint
    result.crc64 = crc.getHex();
    log.info(`DVD fingerprint generated: ${result.crc64}`);

    return result;

  } catch (error) {
    result.error = error.message;
    log.error(`Fingerprint generation failed: ${error.message}`);
    return result;
  }
}

/**
 * Get list of DVD files sorted alphabetically
 * @param {string} videoTsPath - Path to VIDEO_TS folder
 * @returns {string[]} Sorted list of filenames
 */
function getDVDFiles(videoTsPath) {
  try {
    const files = readdirSync(videoTsPath);

    // Filter to DVD files only
    const dvdFiles = files.filter(file => {
      const ext = path.extname(file).toLowerCase();
      return DVD_FILE_EXTENSIONS.includes(ext);
    });

    // Sort alphabetically (case-insensitive)
    dvdFiles.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

    return dvdFiles;
  } catch (error) {
    log.error(`Failed to read VIDEO_TS directory: ${error.message}`);
    return [];
  }
}

/**
 * Add file metadata to fingerprint calculation
 * pydvdid uses: creation time (FILETIME) + file size (uint32) + filename (null-terminated)
 * @param {CRC64Calculator} crc - CRC calculator instance
 * @param {string} filePath - Full path to file
 * @param {string} filename - Filename only
 */
async function addFileToFingerprint(crc, filePath, filename) {
  // Get file stats
  const stats = statSync(filePath);

  // Use birthtime (creation time) - this is what pydvdid uses
  // On some systems birthtime may not be available, fall back to mtime
  const creationTime = stats.birthtime || stats.mtime;
  const filetime = dateToFiletime(creationTime);

  // Add creation time as 8-byte FILETIME (little-endian)
  const timeBuffer = filetimeToBuffer(filetime);
  crc.update(timeBuffer);

  // Add file size as 4-byte uint32 (little-endian)
  // Note: DVD files shouldn't exceed 4GB per file (UDF limit)
  const sizeBuffer = uint32ToBuffer(stats.size);
  crc.update(sizeBuffer);

  // Add filename with null terminator
  const filenameBuffer = Buffer.from(filename + '\0', 'utf8');
  crc.update(filenameBuffer);

  log.debug(`Added ${filename}: size=${stats.size}, time=${creationTime.toISOString()}`);
}

/**
 * Add first 64KB of IFO file content to fingerprint
 * @param {CRC64Calculator} crc - CRC calculator instance
 * @param {string} ifoPath - Path to IFO file
 * @param {string} filename - Filename for logging
 */
async function addIfoContent(crc, ifoPath, filename) {
  try {
    // Read first 64KB of file
    const stats = statSync(ifoPath);
    const bytesToRead = Math.min(stats.size, IFO_READ_SIZE);

    const buffer = Buffer.alloc(bytesToRead);
    const fd = await fs.open(ifoPath, 'r');
    try {
      await fd.read(buffer, 0, bytesToRead, 0);
    } finally {
      await fd.close();
    }

    crc.update(buffer);
    log.debug(`Added ${filename} content: ${bytesToRead} bytes`);
  } catch (error) {
    throw new Error(`Failed to read ${filename}: ${error.message}`);
  }
}

/**
 * Validate that a path is a valid DVD structure
 * @param {string} drivePath - Path to check
 * @returns {boolean} True if valid DVD structure
 */
export function isValidDVDStructure(drivePath) {
  try {
    const normalizedPath = drivePath.replace(/[/\\]$/, '');
    const videoTsPath = path.join(normalizedPath, 'VIDEO_TS');

    if (!existsSync(videoTsPath)) {
      return false;
    }

    // Check for at least one IFO file
    const files = readdirSync(videoTsPath);
    return files.some(f => f.toLowerCase().endsWith('.ifo'));
  } catch {
    return false;
  }
}

export default {
  generateDVDFingerprint,
  isValidDVDStructure
};
