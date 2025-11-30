/**
 * Blu-ray BDMV Structure Parser
 * Parses BDMV playlists and clip information
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import path from 'path';
import logger from '../logger.js';
import { createTitleEntry, DiscType } from './schemas.js';

// Create a simple log wrapper with category
const log = {
  info: (msg, data) => logger.info('parser-bluray', msg, data),
  warn: (msg, data) => logger.warn('parser-bluray', msg, data),
  error: (msg, data) => logger.error('parser-bluray', msg, data),
  debug: (msg, data) => logger.debug('parser-bluray', msg, data),
};

// Blu-ray timing: 45kHz ticks
const TICKS_PER_SECOND = 45000;

// Minimum duration for main feature (60 minutes)
const MIN_MAIN_FEATURE_SECONDS = 3600;

/**
 * Parse a Blu-ray BDMV structure
 * @param {string} backupPath - Path to backup folder containing BDMV
 * @returns {Promise<Object>} Extracted disc data
 */
export async function parseBlurayStructure(backupPath) {
  const bdmvPath = path.join(backupPath, 'BDMV');

  if (!existsSync(bdmvPath)) {
    log.warn(`BDMV not found at ${backupPath}`);
    return null;
  }

  log.info(`Parsing Blu-ray structure at ${bdmvPath}`);

  const result = {
    type: DiscType.BLURAY,
    titles: [],
    blurayInfo: {
      discType: null,
      is3D: false,
      isUHD: false
    }
  };

  try {
    // Parse index.bdmv for disc info
    const indexPath = path.join(bdmvPath, 'index.bdmv');
    if (existsSync(indexPath)) {
      const indexInfo = parseIndexBdmv(indexPath);
      if (indexInfo) {
        result.blurayInfo = { ...result.blurayInfo, ...indexInfo };
      }
    }

    // Parse all playlists
    const playlistPath = path.join(bdmvPath, 'PLAYLIST');
    if (existsSync(playlistPath)) {
      const playlists = readdirSync(playlistPath)
        .filter(f => f.toLowerCase().endsWith('.mpls'));

      log.info(`Found ${playlists.length} playlists`);

      for (const playlist of playlists) {
        const mplsPath = path.join(playlistPath, playlist);
        const playlistInfo = parsePlaylist(mplsPath);

        if (playlistInfo && playlistInfo.duration > 0) {
          result.titles.push(createTitleEntry({
            index: parseInt(playlist.replace(/\.mpls$/i, ''), 10) || 0,
            duration: playlistInfo.duration,
            chapters: playlistInfo.chapters,
            audioTracks: playlistInfo.audioTracks,
            subtitles: playlistInfo.subtitles
          }));
        }
      }
    }

    // Parse clip info for additional details
    const clipInfoPath = path.join(bdmvPath, 'CLIPINF');
    if (existsSync(clipInfoPath) && result.titles.length > 0) {
      const clipInfo = parseClipInfo(clipInfoPath);
      if (clipInfo.audioTracks.length > 0 || clipInfo.subtitles.length > 0) {
        // Add clip info to titles that don't have it
        result.titles.forEach(title => {
          if (title.audioTracks.length === 0) {
            title.audioTracks = clipInfo.audioTracks;
          }
          if (title.subtitles.length === 0) {
            title.subtitles = clipInfo.subtitles;
          }
        });
      }
    }

    // Sort titles by duration (longest first)
    result.titles.sort((a, b) => b.duration - a.duration);

    // Mark main feature
    const mainFeatureIndex = result.titles.findIndex(t => t.duration >= MIN_MAIN_FEATURE_SECONDS);
    if (mainFeatureIndex >= 0) {
      result.titles[mainFeatureIndex].isMainFeature = true;
    } else if (result.titles.length > 0) {
      result.titles[0].isMainFeature = true;
    }

    log.info(`Parsed ${result.titles.length} titles from Blu-ray`);
    return result;

  } catch (error) {
    log.error('Error parsing Blu-ray structure:', error);
    return result;
  }
}

/**
 * Parse index.bdmv for disc information
 * @param {string} indexPath - Path to index.bdmv
 * @returns {Object|null} Index information
 */
function parseIndexBdmv(indexPath) {
  try {
    const buffer = readFileSync(indexPath);

    // Check header - should be "INDX"
    const header = buffer.slice(0, 4).toString('ascii');
    if (header !== 'INDX') {
      log.warn(`Invalid index.bdmv header: ${header}`);
      return null;
    }

    const info = {
      discType: 'BD',
      is3D: false,
      isUHD: false
    };

    // Version at offset 4 (4 bytes ASCII)
    if (buffer.length > 8) {
      const version = buffer.slice(4, 8).toString('ascii');
      info.version = version;

      // UHD Blu-rays have version "0300"
      if (version === '0300') {
        info.isUHD = true;
        info.discType = 'UHD BD';
      }
    }

    log.debug(`Index info: ${info.discType}, version ${info.version}`);
    return info;

  } catch (error) {
    log.error(`Error parsing index.bdmv:`, error.message);
    return null;
  }
}

/**
 * Parse a playlist (.mpls) file
 * @param {string} mplsPath - Path to .mpls file
 * @returns {Object|null} Playlist information
 */
function parsePlaylist(mplsPath) {
  try {
    const buffer = readFileSync(mplsPath);

    // Check header - should be "MPLS"
    const header = buffer.slice(0, 4).toString('ascii');
    if (header !== 'MPLS') {
      log.debug(`Invalid MPLS header in ${path.basename(mplsPath)}: ${header}`);
      return null;
    }

    const info = {
      duration: 0,
      chapters: 0,
      audioTracks: [],
      subtitles: [],
      clips: []
    };

    // PlayList start address at offset 8 (4 bytes, big-endian)
    if (buffer.length < 12) return null;
    const playlistOffset = buffer.readUInt32BE(8);

    // PlayListMark start address at offset 12 (4 bytes, big-endian)
    const markOffset = buffer.readUInt32BE(12);

    // Parse PlayList section
    if (playlistOffset > 0 && playlistOffset < buffer.length) {
      const playlistData = parsePlayListSection(buffer, playlistOffset);
      info.duration = playlistData.duration;
      info.clips = playlistData.clips;
      info.audioTracks = playlistData.audioTracks;
      info.subtitles = playlistData.subtitles;
    }

    // Parse PlayListMark section for chapters
    if (markOffset > 0 && markOffset < buffer.length) {
      info.chapters = parsePlayListMarkSection(buffer, markOffset);
    }

    return info;

  } catch (error) {
    log.debug(`Error parsing playlist ${path.basename(mplsPath)}:`, error.message);
    return null;
  }
}

/**
 * Parse PlayList section of MPLS
 * @param {Buffer} buffer - MPLS file buffer
 * @param {number} offset - Start offset of PlayList section
 * @returns {Object} PlayList data
 */
function parsePlayListSection(buffer, offset) {
  const result = {
    duration: 0,
    clips: [],
    audioTracks: [],
    subtitles: []
  };

  try {
    // Length of PlayList (4 bytes)
    // Reserved (2 bytes)
    // Number of PlayItems at offset + 6 (2 bytes)
    if (offset + 10 > buffer.length) return result;

    const numPlayItems = buffer.readUInt16BE(offset + 6);
    // Number of SubPaths at offset + 8 (2 bytes)

    let playItemOffset = offset + 10;

    for (let i = 0; i < numPlayItems && playItemOffset < buffer.length - 20; i++) {
      // PlayItem length (2 bytes)
      const itemLength = buffer.readUInt16BE(playItemOffset);
      if (itemLength === 0) break;

      // Clip info at playItemOffset + 2
      // IN_time at playItemOffset + 14 (4 bytes, 45kHz ticks)
      // OUT_time at playItemOffset + 18 (4 bytes, 45kHz ticks)
      const inTime = buffer.readUInt32BE(playItemOffset + 14);
      const outTime = buffer.readUInt32BE(playItemOffset + 18);

      const clipDuration = (outTime - inTime) / TICKS_PER_SECOND;
      result.duration += clipDuration;

      // Try to get stream info for first clip
      if (i === 0 && itemLength > 22) {
        const streams = parseSTNTable(buffer, playItemOffset + 2 + itemLength - 10);
        result.audioTracks = streams.audioTracks;
        result.subtitles = streams.subtitles;
      }

      playItemOffset += 2 + itemLength;
    }

  } catch (error) {
    log.debug('Error parsing PlayList section:', error.message);
  }

  return result;
}

/**
 * Parse STN table for stream info (simplified)
 * @param {Buffer} buffer - MPLS file buffer
 * @param {number} offset - Approximate offset to STN table
 * @returns {Object} Stream information
 */
function parseSTNTable(buffer, offset) {
  // This is a simplified version - full STN parsing is complex
  // Just try to extract basic language codes from common patterns
  const result = {
    audioTracks: [],
    subtitles: []
  };

  try {
    // Scan for language codes in the relevant section
    const searchLength = Math.min(500, buffer.length - offset);
    const section = buffer.slice(offset, offset + searchLength);

    // Look for common 3-letter language codes
    const langPattern = /eng|spa|fra|deu|ita|por|jpn|zho|kor|rus/gi;
    const matches = section.toString('ascii').match(langPattern) || [];

    // Deduplicate and convert to readable names
    const seen = new Set();
    for (const match of matches) {
      const lang = iso639ToName(match.toLowerCase());
      if (lang && !seen.has(lang)) {
        seen.add(lang);
        // First few are typically audio
        if (result.audioTracks.length < 3) {
          result.audioTracks.push(lang);
        } else {
          result.subtitles.push(lang);
        }
      }
    }

  } catch (error) {
    // Ignore errors in stream parsing
  }

  return result;
}

/**
 * Parse PlayListMark section for chapter count
 * @param {Buffer} buffer - MPLS file buffer
 * @param {number} offset - Start offset of PlayListMark section
 * @returns {number} Number of chapters
 */
function parsePlayListMarkSection(buffer, offset) {
  try {
    if (offset + 4 > buffer.length) return 0;

    // Length (4 bytes)
    // Number of marks at offset + 4 (2 bytes)
    const numMarks = buffer.readUInt16BE(offset + 4);

    // Each mark is 14 bytes, count entry marks (type = 1)
    let chapters = 0;
    let markOffset = offset + 6;

    for (let i = 0; i < numMarks && markOffset + 14 <= buffer.length; i++) {
      const markType = buffer.readUInt8(markOffset + 1);
      if (markType === 1) { // Entry mark = chapter
        chapters++;
      }
      markOffset += 14;
    }

    return chapters;

  } catch (error) {
    return 0;
  }
}

/**
 * Parse clip info directory for audio/subtitle info
 * @param {string} clipInfoPath - Path to CLIPINF directory
 * @returns {Object} Aggregated clip information
 */
function parseClipInfo(clipInfoPath) {
  const result = {
    audioTracks: [],
    subtitles: []
  };

  try {
    const clpiFiles = readdirSync(clipInfoPath)
      .filter(f => f.toLowerCase().endsWith('.clpi'));

    if (clpiFiles.length === 0) return result;

    // Just parse the first CLPI for basic info
    const firstClpi = path.join(clipInfoPath, clpiFiles[0]);
    const buffer = readFileSync(firstClpi);

    // Check header
    const header = buffer.slice(0, 4).toString('ascii');
    if (header !== 'HDMV') return result;

    // The CLPI format is complex - just do basic language detection
    const section = buffer.slice(0, Math.min(2048, buffer.length));
    const langPattern = /eng|spa|fra|deu|ita|por|jpn|zho|kor|rus/gi;
    const matches = section.toString('ascii').match(langPattern) || [];

    const seen = new Set();
    for (const match of matches) {
      const lang = iso639ToName(match.toLowerCase());
      if (lang && !seen.has(lang)) {
        seen.add(lang);
        if (result.audioTracks.length < 3) {
          result.audioTracks.push(lang);
        }
      }
    }

  } catch (error) {
    log.debug('Error parsing clip info:', error.message);
  }

  return result;
}

/**
 * Convert ISO 639-2 code to language name
 * @param {string} code - 3-letter language code
 * @returns {string|null} Language name
 */
function iso639ToName(code) {
  const languages = {
    'eng': 'English',
    'spa': 'Spanish',
    'fra': 'French',
    'fre': 'French',
    'deu': 'German',
    'ger': 'German',
    'ita': 'Italian',
    'por': 'Portuguese',
    'jpn': 'Japanese',
    'zho': 'Chinese',
    'chi': 'Chinese',
    'kor': 'Korean',
    'rus': 'Russian',
    'nld': 'Dutch',
    'dut': 'Dutch',
    'pol': 'Polish',
    'swe': 'Swedish',
    'dan': 'Danish',
    'fin': 'Finnish',
    'nor': 'Norwegian',
    'ara': 'Arabic',
    'heb': 'Hebrew',
    'tha': 'Thai',
    'hin': 'Hindi',
    'ces': 'Czech',
    'cze': 'Czech',
    'hun': 'Hungarian',
    'ell': 'Greek',
    'gre': 'Greek',
    'tur': 'Turkish'
  };

  return languages[code] || null;
}

/**
 * Get main feature duration from parsed Blu-ray data
 * @param {Object} blurayData - Parsed Blu-ray data
 * @returns {number} Duration in seconds
 */
export function getMainFeatureDuration(blurayData) {
  if (!blurayData?.titles?.length) return 0;

  const mainFeature = blurayData.titles.find(t => t.isMainFeature);
  return mainFeature?.duration || blurayData.titles[0].duration || 0;
}

export default {
  parseBlurayStructure,
  getMainFeatureDuration
};
