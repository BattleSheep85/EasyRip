/**
 * TV Episode Detector
 * Analyzes disc title scans to identify individual episodes for TV show discs
 *
 * Problem: TV discs have multiple titles:
 * - "Play All" title (all episodes concatenated) - longest, should be excluded
 * - Individual episode titles (20-60 minutes each)
 * - Bonus content (very short, should be excluded)
 *
 * Multi-disc season handling:
 * - Uses a season tracker file to track which episodes have been exported
 * - Each disc reads the tracker and continues from the last episode
 * - TMDB provides episode names and total count for validation
 *
 * This module identifies episode titles and matches them to TMDB episode data.
 */

import { promises as fs } from 'fs';
import path from 'path';
import logger from './logger.js';
import { getTMDBClient } from './metadata/tmdb.js';
import { getOllamaManager } from './metadata/ollama.js';

const log = {
  info: (msg, data) => logger.info('tv-detector', msg, data),
  warn: (msg, data) => logger.warn('tv-detector', msg, data),
  error: (msg, data) => logger.error('tv-detector', msg, data),
  debug: (msg, data) => logger.debug('tv-detector', msg, data),
};

// Duration thresholds in seconds
const DURATION_THRESHOLDS = {
  // Half-hour shows (sitcoms, etc.)
  HALF_HOUR_MIN: 18 * 60,   // 18 minutes
  HALF_HOUR_MAX: 35 * 60,   // 35 minutes

  // Hour-long shows (dramas, etc.)
  HOUR_MIN: 35 * 60,        // 35 minutes
  HOUR_MAX: 65 * 60,        // 65 minutes

  // Minimum to be considered content (not menu/promo)
  MIN_CONTENT: 2 * 60,      // 2 minutes

  // Maximum for bonus features
  BONUS_MAX: 15 * 60,       // 15 minutes
};

/**
 * Detect if a disc is a TV episode disc (vs movie)
 * @param {Array} titles - Scanned titles from MakeMKV
 * @returns {{ isTV: boolean, episodeFormat: 'half_hour'|'hour'|null, episodeCount: number }}
 */
export function detectTVDisc(titles) {
  if (!titles || titles.length < 2) {
    return { isTV: false, episodeFormat: null, episodeCount: 0 };
  }

  // Sort by duration descending
  const sorted = [...titles].sort((a, b) => b.duration - a.duration);

  // The longest title might be "play all"
  const longestDuration = sorted[0].duration;

  // Count titles in episode duration ranges
  let halfHourCount = 0;
  let hourCount = 0;

  for (const title of titles) {
    const dur = title.duration;
    if (dur >= DURATION_THRESHOLDS.HALF_HOUR_MIN && dur <= DURATION_THRESHOLDS.HALF_HOUR_MAX) {
      halfHourCount++;
    } else if (dur >= DURATION_THRESHOLDS.HOUR_MIN && dur <= DURATION_THRESHOLDS.HOUR_MAX) {
      hourCount++;
    }
  }

  // If we have 2+ titles in episode range, likely TV
  const totalEpisodes = halfHourCount + hourCount;

  if (totalEpisodes >= 2) {
    // Determine format based on which count is higher
    const format = hourCount >= halfHourCount ? 'hour' : 'half_hour';

    log.info(`Detected TV disc: ${totalEpisodes} episodes (${format} format)`);
    return {
      isTV: true,
      episodeFormat: format,
      episodeCount: totalEpisodes
    };
  }

  return { isTV: false, episodeFormat: null, episodeCount: 0 };
}

/**
 * Filter titles to get only episode titles (excluding "play all" and bonus content)
 * @param {Array} titles - Scanned titles from MakeMKV
 * @param {string} episodeFormat - 'half_hour' or 'hour'
 * @returns {Array} Filtered episode titles
 */
export function filterEpisodeTitles(titles, episodeFormat = 'hour') {
  if (!titles || titles.length === 0) return [];

  // Get duration range based on format
  const minDuration = episodeFormat === 'half_hour'
    ? DURATION_THRESHOLDS.HALF_HOUR_MIN
    : DURATION_THRESHOLDS.HOUR_MIN;
  const maxDuration = episodeFormat === 'half_hour'
    ? DURATION_THRESHOLDS.HALF_HOUR_MAX
    : DURATION_THRESHOLDS.HOUR_MAX;

  // Sort titles by duration descending
  const sorted = [...titles].sort((a, b) => b.duration - a.duration);

  // Calculate expected episode duration range
  // The longest title might be "play all" - detect it
  const longestTitle = sorted[0];
  const secondLongest = sorted[1];

  // If longest is 2x+ the second longest, it's probably "play all"
  const isPlayAll = secondLongest && (longestTitle.duration > secondLongest.duration * 1.8);

  // Filter episodes
  const episodes = titles.filter(title => {
    // Skip "play all" title
    if (isPlayAll && title.index === longestTitle.index) {
      log.debug(`Excluding "Play All" title ${title.index} (${title.durationDisplay})`);
      return false;
    }

    // Skip bonus content (too short)
    if (title.duration < minDuration) {
      log.debug(`Excluding bonus/short title ${title.index} (${title.durationDisplay})`);
      return false;
    }

    // Skip if too long (unless it's the only one in range)
    if (title.duration > maxDuration) {
      log.debug(`Excluding long title ${title.index} (${title.durationDisplay})`);
      return false;
    }

    return true;
  });

  // Sort by title index to maintain disc order
  episodes.sort((a, b) => a.index - b.index);

  log.info(`Filtered to ${episodes.length} episode titles from ${titles.length} total`);
  return episodes;
}

/**
 * Season tracker file path
 * Stored at: {libraryPath}/{SeriesFolder}/.season_tracker.json
 */
const TRACKER_FILENAME = '.season_tracker.json';

/**
 * Read season tracker for a series
 * @param {string} seriesFolderPath - Path to series folder on destination
 * @returns {Promise<Object>} Tracker data or empty object
 */
export async function readSeasonTracker(seriesFolderPath) {
  const trackerPath = path.join(seriesFolderPath, TRACKER_FILENAME);
  try {
    const data = await fs.readFile(trackerPath, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    // No tracker yet - that's fine
    return {};
  }
}

/**
 * Write season tracker for a series
 * @param {string} seriesFolderPath - Path to series folder on destination
 * @param {Object} tracker - Tracker data to write
 */
export async function writeSeasonTracker(seriesFolderPath, tracker) {
  const trackerPath = path.join(seriesFolderPath, TRACKER_FILENAME);
  try {
    await fs.mkdir(seriesFolderPath, { recursive: true });
    await fs.writeFile(trackerPath, JSON.stringify(tracker, null, 2));
    log.info(`Updated season tracker at ${trackerPath}`);
  } catch (err) {
    log.warn(`Could not write season tracker: ${err.message}`);
  }
}

/**
 * Enhanced tracker schema:
 * {
 *   season1: {
 *     lastEpisode: 8,
 *     processedDiscs: [1, 2],   // Disc numbers already exported
 *     episodesPerDisc: { 1: 4, 2: 4 },  // How many episodes on each disc
 *     lastExportedAt: "2025-..."
 *   }
 * }
 */

/**
 * Analyze a batch of TV discs to determine which can be processed
 * Returns discs in order, with gaps identified
 * @param {Array} discs - Array of { name, path, metadata, discNum, season }
 * @param {Object} tracker - Season tracker data
 * @returns {Object} { processable: [], waiting: [], gaps: [] }
 */
export function analyzeDiscBatch(discs, tracker = {}) {
  const result = {
    processable: [],  // Discs ready to export (consecutive from tracker)
    waiting: [],      // Discs that need to wait for gaps
    gaps: []          // Missing disc numbers
  };

  if (!discs || discs.length === 0) return result;

  // Group by season
  const bySeason = {};
  for (const disc of discs) {
    const season = disc.season || 1;
    if (!bySeason[season]) bySeason[season] = [];
    bySeason[season].push(disc);
  }

  // Process each season
  for (const [seasonStr, seasonDiscs] of Object.entries(bySeason)) {
    const season = parseInt(seasonStr);
    const seasonKey = `season${season}`;
    const seasonData = tracker[seasonKey] || { processedDiscs: [], lastEpisode: 0 };
    const processedDiscs = new Set(seasonData.processedDiscs || []);

    // Sort discs by disc number
    seasonDiscs.sort((a, b) => (a.discNum || 999) - (b.discNum || 999));

    // Find the next expected disc number
    let nextExpected = 1;
    if (processedDiscs.size > 0) {
      nextExpected = Math.max(...processedDiscs) + 1;
    }

    // Check each disc
    for (const disc of seasonDiscs) {
      if (!disc.discNum) {
        // No disc number detected - can process if it's the only one
        if (seasonDiscs.length === 1) {
          result.processable.push(disc);
        } else {
          result.waiting.push({ ...disc, reason: 'Cannot determine disc number' });
        }
        continue;
      }

      if (processedDiscs.has(disc.discNum)) {
        // Already processed
        continue;
      }

      if (disc.discNum === nextExpected) {
        // This is the next consecutive disc
        result.processable.push(disc);
        nextExpected++;
      } else if (disc.discNum > nextExpected) {
        // Gap detected - disc needs to wait
        const missingDiscs = [];
        for (let d = nextExpected; d < disc.discNum; d++) {
          if (!processedDiscs.has(d)) {
            missingDiscs.push(d);
          }
        }
        result.gaps.push(...missingDiscs.filter(d => !result.gaps.includes(d)));
        result.waiting.push({
          ...disc,
          reason: `Waiting for disc ${missingDiscs.join(', ')}`,
          missingDiscs
        });
      }
    }
  }

  return result;
}

/**
 * Pre-calculate episode assignments for a batch of consecutive discs
 * This allows parallel processing while maintaining correct episode numbers
 * @param {Array} discs - Array of disc objects sorted by disc number
 * @param {Object} tracker - Season tracker
 * @param {Object} tmdbData - TMDB show data
 * @returns {Promise<Map>} Map of discName -> { startEpisode, episodes[] }
 */
export async function preCalculateEpisodeAssignments(discs, tracker = {}, tmdbData = null) {
  const assignments = new Map();
  const tmdbClient = getTMDBClient();

  // Group by season
  const bySeason = {};
  for (const disc of discs) {
    const season = disc.season || 1;
    if (!bySeason[season]) bySeason[season] = [];
    bySeason[season].push(disc);
  }

  for (const [seasonStr, seasonDiscs] of Object.entries(bySeason)) {
    const season = parseInt(seasonStr);
    const seasonKey = `season${season}`;
    const seasonData = tracker[seasonKey] || {};

    // Get TMDB season data for episode names
    let tmdbSeasonData = null;
    if (tmdbData?.id) {
      try {
        tmdbSeasonData = await tmdbClient.getTVSeasonDetails(tmdbData.id, season);
      } catch (err) {
        log.warn(`Could not fetch TMDB season ${season} data: ${err.message}`);
      }
    }

    // Sort by disc number
    seasonDiscs.sort((a, b) => (a.discNum || 999) - (b.discNum || 999));

    // Calculate starting episode from tracker
    let currentEpisode = (seasonData.lastEpisode || 0) + 1;

    for (const disc of seasonDiscs) {
      const episodeCount = disc.episodeCount || 4; // Default 4 episodes per disc
      const startEpisode = currentEpisode;

      // Get episode details from TMDB
      const episodes = [];
      for (let i = 0; i < episodeCount; i++) {
        const epNum = startEpisode + i;
        const tmdbEpisode = tmdbSeasonData?.episodes?.find(e => e.episodeNumber === epNum);
        episodes.push({
          episode: epNum,
          season: season,
          episodeTitle: tmdbEpisode?.name || `Episode ${epNum}`,
          overview: tmdbEpisode?.overview || '',
          airDate: tmdbEpisode?.airDate || '',
          runtime: tmdbEpisode?.runtime || null
        });
      }

      assignments.set(disc.name, {
        season,
        discNum: disc.discNum,
        startEpisode,
        endEpisode: startEpisode + episodeCount - 1,
        episodes,
        tmdbSeasonData
      });

      currentEpisode += episodeCount;
    }
  }

  return assignments;
}

/**
 * Calculate starting episode number for a disc
 * Uses season tracker if available, falls back to disc number estimation
 * @param {Object} options - Options
 * @param {number} options.season - Season number
 * @param {string} options.discLabel - Disc volume label
 * @param {Object} options.tracker - Season tracker data
 * @param {number} options.episodeCount - Number of episodes on this disc
 * @returns {number} Starting episode number
 */
export function calculateStartEpisode({ season, discLabel, tracker, episodeCount }) {
  const seasonKey = `season${season}`;

  // Check tracker for last exported episode
  if (tracker && tracker[seasonKey]?.lastEpisode) {
    const startEp = tracker[seasonKey].lastEpisode + 1;
    log.info(`Season tracker: continuing from episode ${startEp}`);
    return startEp;
  }

  // Fall back to disc number estimation
  const discNum = extractDiscNumberFromLabel(discLabel);
  if (discNum > 0) {
    // Estimate based on disc number
    // Use a more realistic estimate of 5-6 episodes per disc for hour-long shows
    const estimatedEpsPerDisc = 5;
    const startEp = (discNum - 1) * estimatedEpsPerDisc + 1;
    log.info(`Disc ${discNum}: estimated start episode ${startEp} (no tracker found)`);
    return startEp;
  }

  return 1;
}

/**
 * Extract disc number from volume label
 * @param {string} label - Disc volume label
 * @returns {number} Disc number or 0 if not found
 */
export function extractDiscNumberFromLabel(label) {
  if (!label) return 0;

  const patterns = [
    /[_\s]D(\d{1,2})[_\s]?/i,         // _D1_ or D1
    /DISC[_\s]?(\d{1,2})/i,           // DISC1 or DISC_1
    /[_\s]D(\d{1,2})$/i,              // _D1 at end
  ];

  for (const pattern of patterns) {
    const match = label.match(pattern);
    if (match) {
      return parseInt(match[1], 10);
    }
  }

  return 0;
}

/**
 * Match disc titles to TMDB episode data
 * @param {Array} episodeTitles - Filtered episode titles from disc
 * @param {Object} tmdbData - TMDB TV show data
 * @param {number} season - Season number to match
 * @param {number} startEpisode - Starting episode number on this disc
 * @param {Object} metadata - Disc metadata (optional, for intelligent detection)
 * @returns {Promise<Array>} Matched episodes with TMDB data
 */
export async function matchEpisodesToTMDB(episodeTitles, tmdbData, season, startEpisode = 1, metadata = null) {
  if (!episodeTitles || episodeTitles.length === 0) {
    return [];
  }

  // **NEW**: Check if intelligent episode detection is available
  let actualSeason = season;
  let actualStartEpisode = startEpisode;
  let usingIntelligentDetection = false;

  if (metadata?.episodes && metadata.episodes.season && metadata.episodes.startEpisode) {
    // Use intelligent correlation results from episode detector
    actualSeason = metadata.episodes.season;
    actualStartEpisode = metadata.episodes.startEpisode;
    usingIntelligentDetection = true;
    log.info(`Using intelligent episode detection: Season ${actualSeason}, starting at episode ${actualStartEpisode} (confidence: ${metadata.episodes.confidence}, ${metadata.episodes.heuristicUsed})`);
  } else {
    log.info(`Using sequential episode numbering (fallback): Season ${actualSeason}, starting at episode ${actualStartEpisode}`);
  }

  const tmdbClient = getTMDBClient();
  let seasonData = null;

  // Try to get TMDB season data
  if (tmdbData?.id) {
    try {
      seasonData = await tmdbClient.getTVSeasonDetails(tmdbData.id, actualSeason);
      log.info(`Got TMDB season ${actualSeason} data: ${seasonData?.episodes?.length || 0} episodes`);
    } catch (err) {
      log.warn(`Could not fetch TMDB season data: ${err.message}`);
    }
  }

  // Match episodes by position (simple sequential matching)
  // This works for most TV discs where episodes are in order
  const matchedEpisodes = episodeTitles.map((title, idx) => {
    const episodeNum = actualStartEpisode + idx;
    const tmdbEpisode = seasonData?.episodes?.find(ep => ep.episodeNumber === episodeNum);

    return {
      // Disc title info
      titleIndex: title.index,
      duration: title.duration,
      durationDisplay: title.durationDisplay,
      size: title.size,
      sizeDisplay: title.sizeDisplay,
      chapters: title.chapters,

      // Episode info (from TMDB or inferred)
      season: actualSeason,
      episode: episodeNum,
      episodeTitle: tmdbEpisode?.name || `Episode ${episodeNum}`,
      overview: tmdbEpisode?.overview || '',
      airDate: tmdbEpisode?.airDate || '',
      runtime: tmdbEpisode?.runtime || Math.round(title.duration / 60),

      // Match confidence
      matchSource: tmdbEpisode ? 'tmdb' : (usingIntelligentDetection ? 'intelligent' : 'sequential'),
      matchConfidence: tmdbEpisode ? 0.9 : (usingIntelligentDetection ? 0.85 : 0.7)
    };
  });

  log.info(`Matched ${matchedEpisodes.length} episodes to season ${actualSeason}, starting at ep ${actualStartEpisode} (method: ${usingIntelligentDetection ? 'intelligent detection' : 'sequential fallback'})`);
  return matchedEpisodes;
}

/**
 * Analyze disc titles and determine episode mapping
 * @param {Array} titles - Scanned titles from MakeMKV
 * @param {Object} metadata - Disc metadata with TMDB info
 * @returns {Promise<Object>} Episode analysis result
 */
export async function analyzeDiscForEpisodes(titles, metadata) {
  const result = {
    isTV: false,
    episodeFormat: null,
    episodes: [],
    playAllTitle: null,
    bonusTitles: [],
    error: null
  };

  try {
    // Detect if this is a TV disc
    const detection = detectTVDisc(titles);
    result.isTV = detection.isTV;
    result.episodeFormat = detection.episodeFormat;

    if (!detection.isTV) {
      log.info('Disc does not appear to be a TV episode disc');
      return result;
    }

    // Filter to episode titles
    const episodeTitles = filterEpisodeTitles(titles, detection.episodeFormat);

    // Identify "play all" and bonus content
    const sorted = [...titles].sort((a, b) => b.duration - a.duration);
    if (sorted[0] && sorted[1] && sorted[0].duration > sorted[1].duration * 1.8) {
      result.playAllTitle = sorted[0];
    }

    result.bonusTitles = titles.filter(t =>
      t.duration < DURATION_THRESHOLDS.BONUS_MAX &&
      t.duration > DURATION_THRESHOLDS.MIN_CONTENT &&
      !episodeTitles.includes(t)
    );

    // Get season/episode info from metadata
    const season = metadata?.tvInfo?.season ||
                   metadata?.llmGuess?.tvInfo?.season ||
                   extractSeasonFromLabel(metadata?.disc?.volumeLabel) ||
                   1;

    const startEpisode = metadata?.tvInfo?.startEpisode ||
                         extractStartEpisodeFromLabel(metadata?.disc?.volumeLabel) ||
                         1;

    // **NEW**: Check if intelligent episode detection is available
    // If metadata.episodes exists, it should override the extracted season/startEpisode
    let finalSeason = season;
    let finalStartEpisode = startEpisode;

    if (metadata?.episodes && metadata.episodes.season && metadata.episodes.startEpisode) {
      finalSeason = metadata.episodes.season;
      finalStartEpisode = metadata.episodes.startEpisode;
      log.info(`Using intelligent episode detection: Season ${finalSeason}, starting at episode ${finalStartEpisode} (confidence: ${metadata.episodes.confidence})`);
    } else {
      log.info(`Using extracted season/episode: Season ${finalSeason}, starting at episode ${finalStartEpisode} (no intelligent detection available)`);
    }

    // Match to TMDB (pass metadata so matchEpisodesToTMDB can also check for intelligent detection)
    const matched = await matchEpisodesToTMDB(
      episodeTitles,
      metadata?.tmdb,
      finalSeason,
      finalStartEpisode,
      metadata
    );

    result.episodes = matched;

    log.info(`Episode analysis complete: ${matched.length} episodes, season ${season}`);
    return result;

  } catch (err) {
    log.error(`Episode analysis failed: ${err.message}`);
    result.error = err.message;
    return result;
  }
}

/**
 * Extract season number from disc volume label
 * @param {string} label - Disc volume label (e.g., "ONE_TREE_HILL_S1_NA_D1")
 * @returns {number|null} Season number or null
 */
export function extractSeasonFromLabel(label) {
  if (!label) return null;

  // Match patterns like "S1", "SEASON1", "SEASON_1", "S01"
  const patterns = [
    /[_\s]S(\d{1,2})[_\s]/i,          // _S1_ or S01
    /SEASON[_\s]?(\d{1,2})/i,         // SEASON1 or SEASON_1
    /[_\s]S(\d{1,2})$/i,              // _S1 at end
  ];

  for (const pattern of patterns) {
    const match = label.match(pattern);
    if (match) {
      return parseInt(match[1], 10);
    }
  }

  return null;
}

/**
 * Extract disc number from volume label (to calculate start episode)
 * @param {string} label - Disc volume label (e.g., "ONE_TREE_HILL_S1_NA_D1")
 * @returns {number} Starting episode number
 */
export function extractStartEpisodeFromLabel(label) {
  if (!label) return 1;

  // Match patterns like "D1", "DISC1", "DISC_1", "D01"
  const patterns = [
    /[_\s]D(\d{1,2})[_\s]?/i,         // _D1_ or D1
    /DISC[_\s]?(\d{1,2})/i,           // DISC1 or DISC_1
    /[_\s]D(\d{1,2})$/i,              // _D1 at end
  ];

  for (const pattern of patterns) {
    const match = label.match(pattern);
    if (match) {
      const discNum = parseInt(match[1], 10);
      // Assume ~4-6 episodes per disc for hour-long shows
      // This is a rough estimate - TMDB data will be more accurate
      // For disc 1: episode 1, disc 2: episode 5, etc.
      return (discNum - 1) * 4 + 1;
    }
  }

  return 1;
}

/**
 * Use LLM to help identify episode mapping for complex cases
 * @param {Array} episodeTitles - Disc episode titles
 * @param {Object} tmdbData - TMDB show data with season episodes
 * @param {Object} discInfo - Disc metadata
 * @returns {Promise<Array>} LLM-assisted episode mapping
 */
export async function llmAssistedEpisodeMatch(episodeTitles, tmdbData, discInfo) {
  const ollama = getOllamaManager();

  if (!await ollama.isRunning()) {
    log.warn('Ollama not running, falling back to sequential matching');
    return null;
  }

  // Build prompt with episode info
  const prompt = buildEpisodeMatchPrompt(episodeTitles, tmdbData, discInfo);

  try {
    // TODO: Implement LLM query for complex episode matching
    // For now, return null to fall back to sequential matching
    log.info('LLM episode matching not yet implemented');
    return null;
  } catch (err) {
    log.warn(`LLM episode match failed: ${err.message}`);
    return null;
  }
}

function buildEpisodeMatchPrompt(episodeTitles, tmdbData, discInfo) {
  // This would be used for complex cases where sequential matching isn't reliable
  // For now, just return a placeholder
  return '';
}

export default {
  detectTVDisc,
  filterEpisodeTitles,
  matchEpisodesToTMDB,
  analyzeDiscForEpisodes,
  extractSeasonFromLabel,
  extractStartEpisodeFromLabel,
  extractDiscNumberFromLabel,
  llmAssistedEpisodeMatch,
  readSeasonTracker,
  writeSeasonTracker,
  calculateStartEpisode,
  analyzeDiscBatch,
  preCalculateEpisodeAssignments
};
