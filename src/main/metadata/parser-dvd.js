/**
 * DVD IFO File Parser
 * Parses VIDEO_TS structure to extract disc metadata
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import path from 'path';
import logger from '../logger.js';
import { createTitleEntry, DiscType } from './schemas.js';

// Create a simple log wrapper with category
const log = {
  info: (msg, data) => logger.info('parser-dvd', msg, data),
  warn: (msg, data) => logger.warn('parser-dvd', msg, data),
  error: (msg, data) => logger.error('parser-dvd', msg, data),
  debug: (msg, data) => logger.debug('parser-dvd', msg, data),
};

// IFO file identifiers
const VMG_IDENTIFIER = 'DVDVIDEO-VMG';
const VTS_IDENTIFIER = 'DVDVIDEO-VTS';

// Frame rates for duration calculation
const FRAME_RATES = {
  0: 30,     // NTSC
  1: 25,     // PAL
  3: 30      // NTSC drop frame
};

/**
 * Parse a DVD VIDEO_TS structure
 * @param {string} backupPath - Path to backup folder containing VIDEO_TS
 * @returns {Promise<Object>} Extracted disc data
 */
export async function parseDVDStructure(backupPath) {
  const videoTsPath = path.join(backupPath, 'VIDEO_TS');

  if (!existsSync(videoTsPath)) {
    log.warn(`VIDEO_TS not found at ${backupPath}`);
    return null;
  }

  log.info(`Parsing DVD structure at ${videoTsPath}`);

  const result = {
    type: DiscType.DVD,
    titles: [],
    dvdInfo: {
      regionCode: null,
      aspectRatio: null,
      videoFormat: null,
      numberOfTitleSets: 0,
      providerId: null,
      vmgCategory: null,
      discTitle: null
    }
  };

  // Track video attributes from all VTS files to aggregate
  const videoFormats = new Set();
  const aspectRatios = new Set();

  try {
    // Parse VIDEO_TS.IFO (main menu/disc info)
    const vmgIfoPath = path.join(videoTsPath, 'VIDEO_TS.IFO');
    if (existsSync(vmgIfoPath)) {
      const vmgInfo = parseVMGIfo(vmgIfoPath);
      if (vmgInfo) {
        result.dvdInfo = { ...result.dvdInfo, ...vmgInfo };
      }
    }

    // Find and parse all VTS IFO files
    const files = readdirSync(videoTsPath);
    const vtsIfoFiles = files.filter(f => /^VTS_\d+_0\.IFO$/i.test(f));

    log.info(`Found ${vtsIfoFiles.length} title sets`);

    for (const ifoFile of vtsIfoFiles) {
      const ifoPath = path.join(videoTsPath, ifoFile);
      const { titles, vtsAttr } = parseVTSIfo(ifoPath);
      if (titles) {
        result.titles.push(...titles);
      }
      // Collect video attributes from each VTS
      if (vtsAttr?.videoFormat) videoFormats.add(vtsAttr.videoFormat);
      if (vtsAttr?.aspectRatio) aspectRatios.add(vtsAttr.aspectRatio);
    }

    // Aggregate video attributes (use most common or first)
    if (videoFormats.size > 0) {
      result.dvdInfo.videoFormat = [...videoFormats][0];
      if (videoFormats.size > 1) {
        result.dvdInfo.videoFormatMixed = [...videoFormats];
      }
    }
    if (aspectRatios.size > 0) {
      result.dvdInfo.aspectRatio = [...aspectRatios][0];
      if (aspectRatios.size > 1) {
        result.dvdInfo.aspectRatioMixed = [...aspectRatios];
      }
    }

    // Sort titles by duration (longest first)
    result.titles.sort((a, b) => b.duration - a.duration);

    // Mark main feature (longest title over 60 minutes)
    const mainFeatureIndex = result.titles.findIndex(t => t.duration >= 3600);
    if (mainFeatureIndex >= 0) {
      result.titles[mainFeatureIndex].isMainFeature = true;
    } else if (result.titles.length > 0) {
      result.titles[0].isMainFeature = true;
    }

    log.info(`Parsed ${result.titles.length} titles from DVD`, {
      videoFormat: result.dvdInfo.videoFormat,
      aspectRatio: result.dvdInfo.aspectRatio,
      providerId: result.dvdInfo.providerId
    });
    return result;

  } catch (error) {
    log.error('Error parsing DVD structure:', error);
    return result;
  }
}

/**
 * Parse VIDEO_TS.IFO (Video Manager Information)
 * @param {string} ifoPath - Path to VIDEO_TS.IFO
 * @returns {Object|null} VMG information
 */
function parseVMGIfo(ifoPath) {
  try {
    const buffer = readFileSync(ifoPath);

    // Verify header
    const header = buffer.slice(0, 12).toString('ascii');
    if (header !== VMG_IDENTIFIER) {
      log.warn(`Invalid VMG header: ${header}`);
      return null;
    }

    const info = {
      numberOfTitleSets: 0,
      regionCode: null,
      videoFormat: null,
      providerId: null,
      vmgCategory: null,
      discTitle: null
    };

    // Number of title sets at offset 0x3E (2 bytes, big-endian)
    if (buffer.length > 0x40) {
      info.numberOfTitleSets = buffer.readUInt16BE(0x3E);
    }

    // Region code at offset 0x23 (1 byte)
    if (buffer.length > 0x23) {
      const regionMask = buffer.readUInt8(0x23);
      info.regionCode = parseRegionCode(regionMask);
    }

    // VMG Category at offset 0x20 (4 bytes)
    // Indicates disc type: 0=unspecified, 1=movie, 2=special interest, etc.
    if (buffer.length > 0x24) {
      const category = buffer.readUInt32BE(0x20);
      info.vmgCategory = parseVMGCategory(category);
    }

    // Provider ID at offset 0x28 (8 bytes ASCII, null-padded)
    if (buffer.length > 0x30) {
      const providerBytes = buffer.slice(0x28, 0x30);
      const providerId = providerBytes.toString('ascii').replace(/\0/g, '').trim();
      if (providerId && providerId.length > 0 && /^[\x20-\x7E]+$/.test(providerId)) {
        info.providerId = providerId;
      }
    }

    // Try to extract disc title from VMGM_PGCI_UT or TT_SRPT if available
    // Title search pointer table at offset 0xC4 (4 bytes, sector number)
    if (buffer.length > 0xC8) {
      const ttSrptSector = buffer.readUInt32BE(0xC4);
      if (ttSrptSector > 0) {
        const ttSrptOffset = ttSrptSector * 2048;
        if (ttSrptOffset + 8 < buffer.length) {
          // TT_SRPT contains number of titles at offset 0
          const numTitles = buffer.readUInt16BE(ttSrptOffset);
          info.titleCount = numTitles;
        }
      }
    }

    log.debug(`VMG Info: ${info.numberOfTitleSets} title sets, region ${info.regionCode}, provider "${info.providerId}", category "${info.vmgCategory}"`);
    return info;

  } catch (error) {
    log.error(`Error parsing VMG IFO ${ifoPath}:`, error.message);
    return null;
  }
}

/**
 * Parse VMG category code to human-readable string
 * @param {number} category - VMG category value
 * @returns {string|null} Category description
 */
function parseVMGCategory(category) {
  // Category is in upper 4 bits of first byte
  const catType = (category >> 28) & 0x0F;

  const categories = {
    0: null, // Unspecified
    1: 'movie',
    2: 'special_interest',
    3: 'karaoke',
    4: 'music_video'
  };

  return categories[catType] || null;
}

/**
 * Parse VTS_XX_0.IFO (Video Title Set Information)
 * @param {string} ifoPath - Path to VTS IFO file
 * @returns {Object} { titles: Array<Object>, vtsAttr: Object }
 */
function parseVTSIfo(ifoPath) {
  try {
    const buffer = readFileSync(ifoPath);

    // Verify header
    const header = buffer.slice(0, 12).toString('ascii');
    if (header !== VTS_IDENTIFIER) {
      log.warn(`Invalid VTS header: ${header}`);
      return { titles: [], vtsAttr: null };
    }

    const titles = [];

    // Extract title set number from filename
    const match = path.basename(ifoPath).match(/VTS_(\d+)_0\.IFO/i);
    const titleSetNumber = match ? parseInt(match[1], 10) : 0;

    // Parse VTS attributes
    const vtsAttr = parseVTSAttributes(buffer);

    // Parse Program Chain Information Table (PGCI_UT)
    // VTS_PGCITI offset at 0xCC (4 bytes, big-endian, sector number)
    if (buffer.length > 0xD0) {
      const pgcitiSector = buffer.readUInt32BE(0xCC);
      if (pgcitiSector > 0) {
        const pgcitiOffset = pgcitiSector * 2048; // Convert sector to bytes

        if (pgcitiOffset < buffer.length) {
          const pgcTitles = parsePGCITable(buffer, pgcitiOffset, titleSetNumber, vtsAttr);
          titles.push(...pgcTitles);
        }
      }
    }

    return { titles, vtsAttr };

  } catch (error) {
    log.error(`Error parsing VTS IFO ${ifoPath}:`, error.message);
    return { titles: [], vtsAttr: null };
  }
}

/**
 * Parse VTS attributes (audio, subtitle, video)
 * @param {Buffer} buffer - IFO file buffer
 * @returns {Object} VTS attributes
 */
function parseVTSAttributes(buffer) {
  const attr = {
    audioTracks: [],
    subtitles: [],
    videoFormat: null,
    aspectRatio: null
  };

  try {
    // Video attributes at offset 0x200
    if (buffer.length > 0x202) {
      const videoAttr = buffer.readUInt16BE(0x200);
      attr.videoFormat = (videoAttr & 0x3000) >> 12 === 0 ? 'NTSC' : 'PAL';
      const aspectCode = (videoAttr & 0x0C00) >> 10;
      attr.aspectRatio = aspectCode === 3 ? '16:9' : '4:3';
    }

    // Number of audio streams at offset 0x202
    if (buffer.length > 0x203) {
      const numAudio = buffer.readUInt16BE(0x202);

      // Audio attributes start at 0x204, each 8 bytes
      for (let i = 0; i < Math.min(numAudio, 8); i++) {
        const audioOffset = 0x204 + (i * 8);
        if (audioOffset + 8 <= buffer.length) {
          const langCode = buffer.readUInt16BE(audioOffset + 2);
          const lang = parseLanguageCode(langCode);
          if (lang) {
            attr.audioTracks.push(lang);
          }
        }
      }
    }

    // Number of subtitle streams at offset 0x254
    if (buffer.length > 0x255) {
      const numSubs = buffer.readUInt16BE(0x254);

      // Subtitle attributes start at 0x256, each 6 bytes
      for (let i = 0; i < Math.min(numSubs, 32); i++) {
        const subOffset = 0x256 + (i * 6);
        if (subOffset + 6 <= buffer.length) {
          const langCode = buffer.readUInt16BE(subOffset);
          const lang = parseLanguageCode(langCode);
          if (lang) {
            attr.subtitles.push(lang);
          }
        }
      }
    }

  } catch (error) {
    log.debug('Error parsing VTS attributes:', error.message);
  }

  return attr;
}

/**
 * Parse Program Chain Information Table
 * @param {Buffer} buffer - IFO file buffer
 * @param {number} tableOffset - Offset to PGCI table
 * @param {number} titleSetNumber - Title set number
 * @param {Object} vtsAttr - VTS attributes
 * @returns {Array<Object>} Array of title entries
 */
function parsePGCITable(buffer, tableOffset, titleSetNumber, vtsAttr) {
  const titles = [];

  try {
    if (tableOffset >= buffer.length) return titles;

    // Number of PGCs in table (2 bytes at table start)
    const numPGCs = buffer.readUInt16BE(tableOffset);

    log.debug(`Title set ${titleSetNumber}: ${numPGCs} PGCs at offset ${tableOffset}`);

    // PGC pointers start at tableOffset + 8
    // Each entry is 8 bytes: 1 byte category, 3 bytes reserved, 4 bytes offset
    for (let i = 0; i < Math.min(numPGCs, 99); i++) {
      const entryOffset = tableOffset + 8 + (i * 8);
      if (entryOffset + 8 > buffer.length) break;

      const pgcOffset = buffer.readUInt32BE(entryOffset + 4);
      const absolutePgcOffset = tableOffset + pgcOffset;

      if (absolutePgcOffset < buffer.length) {
        const pgcInfo = parsePGC(buffer, absolutePgcOffset);

        if (pgcInfo && pgcInfo.duration > 0) {
          titles.push(createTitleEntry({
            index: titleSetNumber * 100 + i + 1,
            duration: pgcInfo.duration,
            chapters: pgcInfo.chapters,
            audioTracks: vtsAttr.audioTracks,
            subtitles: vtsAttr.subtitles
          }));
        }
      }
    }

  } catch (error) {
    log.debug('Error parsing PGCI table:', error.message);
  }

  return titles;
}

/**
 * Parse a single Program Chain
 * @param {Buffer} buffer - IFO file buffer
 * @param {number} offset - Offset to PGC
 * @returns {Object|null} PGC information
 */
function parsePGC(buffer, offset) {
  try {
    if (offset + 256 > buffer.length) return null;

    // Playback time at offset 4 (4 bytes BCD: HH:MM:SS:FF)
    const timeBytes = buffer.slice(offset + 4, offset + 8);
    const duration = parseBCDTime(timeBytes);

    // Number of programs/chapters at offset 2
    const chapters = buffer.readUInt8(offset + 2);

    return { duration, chapters };

  } catch (error) {
    return null;
  }
}

/**
 * Parse BCD-encoded playback time
 * @param {Buffer} bytes - 4 bytes of BCD time
 * @returns {number} Duration in seconds
 */
function parseBCDTime(bytes) {
  try {
    // Format: HH:MM:SS:FF where each is BCD
    const hours = bcdToDec(bytes[0]);
    const minutes = bcdToDec(bytes[1]);
    const seconds = bcdToDec(bytes[2]);

    // Frame rate in upper 2 bits of last byte
    const frameRateCode = (bytes[3] & 0xC0) >> 6;
    const frames = bcdToDec(bytes[3] & 0x3F);
    const fps = FRAME_RATES[frameRateCode] || 30;

    // Validate values
    if (hours > 23 || minutes > 59 || seconds > 59) {
      return 0;
    }

    // Convert to total seconds (including frame fraction)
    return hours * 3600 + minutes * 60 + seconds + (frames / fps);

  } catch {
    return 0;
  }
}

/**
 * Convert BCD byte to decimal
 * @param {number} bcd - BCD value
 * @returns {number} Decimal value
 */
function bcdToDec(bcd) {
  return ((bcd >> 4) * 10) + (bcd & 0x0F);
}

/**
 * Parse DVD region code mask
 * @param {number} mask - Region mask byte
 * @returns {string|null} Region description
 */
function parseRegionCode(mask) {
  // DVD region mask is inverted (0 = playable)
  const regions = [];

  for (let i = 0; i < 8; i++) {
    if (!(mask & (1 << i))) {
      regions.push(i + 1);
    }
  }

  if (regions.length === 0) return 'All';
  if (regions.length === 8) return 'All';
  return regions.join(', ');
}

/**
 * Parse ISO 639-1 language code from 2 bytes
 * @param {number} code - 2-byte language code
 * @returns {string|null} Language name
 */
function parseLanguageCode(code) {
  if (code === 0 || code === 0xFFFF) return null;

  // Convert to 2-character string
  const char1 = String.fromCharCode((code >> 8) & 0xFF);
  const char2 = String.fromCharCode(code & 0xFF);
  const langCode = char1 + char2;

  // Common language codes
  const languages = {
    'en': 'English',
    'es': 'Spanish',
    'fr': 'French',
    'de': 'German',
    'it': 'Italian',
    'pt': 'Portuguese',
    'ja': 'Japanese',
    'zh': 'Chinese',
    'ko': 'Korean',
    'ru': 'Russian',
    'nl': 'Dutch',
    'pl': 'Polish',
    'sv': 'Swedish',
    'da': 'Danish',
    'fi': 'Finnish',
    'no': 'Norwegian',
    'ar': 'Arabic',
    'he': 'Hebrew',
    'th': 'Thai',
    'hi': 'Hindi',
    'cs': 'Czech',
    'hu': 'Hungarian',
    'el': 'Greek',
    'tr': 'Turkish'
  };

  return languages[langCode.toLowerCase()] || langCode.toUpperCase();
}

/**
 * Get total DVD duration (sum of all titles or main feature)
 * @param {Object} dvdData - Parsed DVD data
 * @returns {number} Duration in seconds
 */
export function getMainFeatureDuration(dvdData) {
  if (!dvdData?.titles?.length) return 0;

  const mainFeature = dvdData.titles.find(t => t.isMainFeature);
  return mainFeature?.duration || dvdData.titles[0].duration || 0;
}

export default {
  parseDVDStructure,
  getMainFeatureDuration
};
