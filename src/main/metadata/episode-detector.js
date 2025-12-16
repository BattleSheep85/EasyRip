/**
 * Episode Detection System
 *
 * Intelligently correlates disc structure to TV series episodes using:
 * - Disc parsing (episode count extraction)
 * - TMDB API (season/episode metadata)
 * - Multi-heuristic correlation algorithm
 * - Confidence scoring
 */

import { parseBlurayStructure } from './parser-bluray.js';
import { parseDVDStructure } from './parser-dvd.js';
import logger from '../logger.js';

export class EpisodeDetector {
  constructor(tmdbClient) {
    this.tmdbClient = tmdbClient;
  }

  /**
   * Detect episodes from disc structure
   * @param {string} discPath - Path to disc backup folder
   * @param {string} discType - 'bluray' or 'dvd'
   * @returns {Promise<{episodeCount: number, titles: Array, error?: string}>}
   */
  async detectDiscEpisodes(discPath, discType) {
    try {
      logger.info(`[EpisodeDetector] Detecting episodes from ${discType} disc at ${discPath}`);

      let structure;
      if (discType === 'bluray') {
        structure = await parseBlurayStructure(discPath);
      } else if (discType === 'dvd') {
        structure = await parseDVDStructure(discPath);
      } else {
        throw new Error(`Unsupported disc type: ${discType}`);
      }

      if (!structure || !structure.titles) {
        logger.warn('[EpisodeDetector] No titles found in disc structure');
        return { episodeCount: 0, titles: [], error: 'No titles found' };
      }

      // Filter for episode-like titles (20-60 minutes typical)
      const episodeTitles = structure.titles.filter(title => {
        const durationMinutes = title.duration / 60;
        return durationMinutes >= 15 && durationMinutes <= 90;
      });

      logger.info(`[EpisodeDetector] Found ${episodeTitles.length} episode-like titles (15-90 min)`);

      return {
        episodeCount: episodeTitles.length,
        titles: episodeTitles,
        allTitles: structure.titles
      };
    } catch (error) {
      logger.error(`[EpisodeDetector] Failed to detect episodes: ${error.message}`);
      return { episodeCount: 0, titles: [], error: error.message };
    }
  }

  /**
   * Fetch series episode information from TMDB
   * @param {number} tmdbId - TMDB series ID
   * @returns {Promise<{seasons: Array<{season: number, episodeCount: number}>, totalSeasons: number}>}
   */
  async fetchSeriesEpisodeInfo(tmdbId) {
    try {
      logger.info(`[EpisodeDetector] Fetching series info for TMDB ID ${tmdbId}`);

      const seriesDetails = await this.tmdbClient.getTVDetails(tmdbId);

      if (!seriesDetails || !seriesDetails.seasons) {
        logger.warn(`[EpisodeDetector] No season data found for TMDB ID ${tmdbId}`);
        return { seasons: [], totalSeasons: 0 };
      }

      // Filter out specials (season 0) and extract episode counts
      const seasons = seriesDetails.seasons
        .filter(s => s.season_number > 0)
        .map(s => ({
          season: s.season_number,
          episodeCount: s.episode_count,
          name: s.name,
          airDate: s.air_date
        }));

      logger.info(`[EpisodeDetector] Found ${seasons.length} seasons for "${seriesDetails.name}"`);
      seasons.forEach(s => {
        logger.info(`  Season ${s.season}: ${s.episodeCount} episodes`);
      });

      return {
        seasons,
        totalSeasons: seasons.length,
        seriesName: seriesDetails.name
      };
    } catch (error) {
      logger.error(`[EpisodeDetector] Failed to fetch series info: ${error.message}`);
      return { seasons: [], totalSeasons: 0, error: error.message };
    }
  }

  /**
   * Correlate disc to episodes using multi-heuristic approach
   * @param {Object} options
   * @param {number} options.discNumber - Disc number from label (e.g., 6 from "S1D6")
   * @param {number} options.extractedEpisodeCount - Episode count from disc parsing
   * @param {number} options.currentSeasonHint - Season hint from label (e.g., 1 from "S1D6")
   * @param {Object} options.seriesInfo - TMDB series information
   * @returns {Promise<{season: number, startEpisode: number, endEpisode: number, episodeCount: number, confidence: number, correlationReason: string, heuristicUsed: string}>}
   */
  async correlateDiscToEpisodes(options) {
    const { discNumber, extractedEpisodeCount, currentSeasonHint, seriesInfo } = options;

    logger.info('[EpisodeDetector] Starting correlation with:', {
      discNumber,
      extractedEpisodeCount,
      currentSeasonHint,
      totalSeasons: seriesInfo?.totalSeasons
    });

    if (!seriesInfo || !seriesInfo.seasons || seriesInfo.seasons.length === 0) {
      logger.warn('[EpisodeDetector] No TMDB season data available, using defaults');
      return this._buildFallbackResult(currentSeasonHint, extractedEpisodeCount, 'No TMDB data available');
    }

    // Try heuristics in order of reliability
    let result;

    // H1: Disc N = Season N (if episode count matches)
    result = this._applyHeuristic1(discNumber, extractedEpisodeCount, seriesInfo);
    if (result && result.confidence >= 0.85) {
      logger.info(`[EpisodeDetector] H1 succeeded with confidence ${result.confidence}`);
      return result;
    }

    // H2: Find season with exact episode count match
    result = this._applyHeuristic2(extractedEpisodeCount, currentSeasonHint, seriesInfo);
    if (result && result.confidence >= 0.75) {
      logger.info(`[EpisodeDetector] H2 succeeded with confidence ${result.confidence}`);
      return result;
    }

    // H3: Use season from label + fallback logic
    result = this._applyHeuristic3(currentSeasonHint, extractedEpisodeCount, discNumber, seriesInfo);
    logger.info(`[EpisodeDetector] H3 used with confidence ${result.confidence}`);
    return result;
  }

  /**
   * H1: Disc N = Season N (if episode count matches)
   * High confidence if disc number matches season AND episode count matches
   */
  _applyHeuristic1(discNumber, extractedEpisodeCount, seriesInfo) {
    if (!discNumber || discNumber <= 0) {
      return null;
    }

    const matchingSeason = seriesInfo.seasons.find(s => s.season === discNumber);

    if (!matchingSeason) {
      logger.info(`[EpisodeDetector] H1: No season ${discNumber} found`);
      return null;
    }

    const episodeCountMatch = extractedEpisodeCount === matchingSeason.episodeCount;

    if (episodeCountMatch) {
      logger.info(`[EpisodeDetector] H1: Perfect match - Disc ${discNumber} = Season ${discNumber} (${extractedEpisodeCount} episodes)`);
      return {
        season: discNumber,
        startEpisode: 1,
        endEpisode: extractedEpisodeCount,
        episodeCount: extractedEpisodeCount,
        confidence: 0.95,
        correlationReason: `Disc ${discNumber} matches Season ${discNumber} with ${extractedEpisodeCount} episodes (exact match)`,
        heuristicUsed: 'H1-DiscEqualsSeasonWithMatch'
      };
    }

    // Close match (within 2 episodes)
    const episodeDiff = Math.abs(extractedEpisodeCount - matchingSeason.episodeCount);
    if (episodeDiff <= 2) {
      logger.info(`[EpisodeDetector] H1: Close match - Disc ${discNumber} ≈ Season ${discNumber} (${extractedEpisodeCount} vs ${matchingSeason.episodeCount})`);
      return {
        season: discNumber,
        startEpisode: 1,
        endEpisode: extractedEpisodeCount,
        episodeCount: extractedEpisodeCount,
        confidence: 0.85,
        correlationReason: `Disc ${discNumber} likely Season ${discNumber} (${extractedEpisodeCount} episodes, expected ${matchingSeason.episodeCount})`,
        heuristicUsed: 'H1-DiscEqualsSeasonCloseMatch'
      };
    }

    logger.info(`[EpisodeDetector] H1: Episode count mismatch (${extractedEpisodeCount} vs ${matchingSeason.episodeCount})`);
    return null;
  }

  /**
   * H2: Find season with exact episode count match
   * Medium-high confidence if episode count exactly matches a season
   */
  _applyHeuristic2(extractedEpisodeCount, currentSeasonHint, seriesInfo) {
    if (!extractedEpisodeCount || extractedEpisodeCount === 0) {
      return null;
    }

    // Find all seasons with matching episode count
    const matchingSeasons = seriesInfo.seasons.filter(
      s => s.episodeCount === extractedEpisodeCount
    );

    if (matchingSeasons.length === 0) {
      logger.info(`[EpisodeDetector] H2: No seasons with ${extractedEpisodeCount} episodes`);
      return null;
    }

    if (matchingSeasons.length === 1) {
      const season = matchingSeasons[0];
      logger.info(`[EpisodeDetector] H2: Unique match - Season ${season.season} has ${extractedEpisodeCount} episodes`);
      return {
        season: season.season,
        startEpisode: 1,
        endEpisode: extractedEpisodeCount,
        episodeCount: extractedEpisodeCount,
        confidence: 0.90,
        correlationReason: `Season ${season.season} is the only season with ${extractedEpisodeCount} episodes (exact match)`,
        heuristicUsed: 'H2-UniqueEpisodeCountMatch'
      };
    }

    // Multiple seasons with same episode count - use season hint if available
    if (currentSeasonHint) {
      const hintedSeason = matchingSeasons.find(s => s.season === currentSeasonHint);
      if (hintedSeason) {
        logger.info(`[EpisodeDetector] H2: Multiple matches, using season hint ${currentSeasonHint}`);
        return {
          season: hintedSeason.season,
          startEpisode: 1,
          endEpisode: extractedEpisodeCount,
          episodeCount: extractedEpisodeCount,
          confidence: 0.85,
          correlationReason: `Season ${hintedSeason.season} matches ${extractedEpisodeCount} episodes (multiple seasons match, used label hint)`,
          heuristicUsed: 'H2-MultipleMatchesWithHint'
        };
      }
    }

    // Use first matching season (lowest season number)
    const season = matchingSeasons[0];
    logger.info(`[EpisodeDetector] H2: Multiple matches, defaulting to Season ${season.season}`);
    return {
      season: season.season,
      startEpisode: 1,
      endEpisode: extractedEpisodeCount,
      episodeCount: extractedEpisodeCount,
      confidence: 0.75,
      correlationReason: `Season ${season.season} matches ${extractedEpisodeCount} episodes (multiple seasons match, used earliest)`,
      heuristicUsed: 'H2-MultipleMatchesDefaultFirst'
    };
  }

  /**
   * H3: Use season from label + fallback logic
   * Medium confidence - last resort heuristic
   */
  _applyHeuristic3(currentSeasonHint, extractedEpisodeCount, discNumber, seriesInfo) {
    // Prefer season hint from label
    if (currentSeasonHint) {
      const hintedSeason = seriesInfo.seasons.find(s => s.season === currentSeasonHint);

      if (hintedSeason) {
        const episodeDiff = Math.abs(extractedEpisodeCount - hintedSeason.episodeCount);
        const confidence = episodeDiff === 0 ? 0.80 : Math.max(0.65, 0.80 - (episodeDiff * 0.05));

        logger.info(`[EpisodeDetector] H3: Using season hint ${currentSeasonHint} (${extractedEpisodeCount} episodes, expected ${hintedSeason.episodeCount})`);
        return {
          season: currentSeasonHint,
          startEpisode: 1,
          endEpisode: extractedEpisodeCount,
          episodeCount: extractedEpisodeCount,
          confidence,
          correlationReason: `Using season ${currentSeasonHint} from label (${extractedEpisodeCount} episodes, expected ${hintedSeason.episodeCount})`,
          heuristicUsed: 'H3-SeasonHintFromLabel'
        };
      }
    }

    // Fallback: Use disc number as season if valid
    if (discNumber && discNumber > 0 && discNumber <= seriesInfo.totalSeasons) {
      const season = seriesInfo.seasons.find(s => s.season === discNumber);
      if (season) {
        logger.info(`[EpisodeDetector] H3: Fallback to disc number ${discNumber} as season`);
        return {
          season: discNumber,
          startEpisode: 1,
          endEpisode: extractedEpisodeCount,
          episodeCount: extractedEpisodeCount,
          confidence: 0.70,
          correlationReason: `Using disc number ${discNumber} as season (fallback)`,
          heuristicUsed: 'H3-DiscNumberFallback'
        };
      }
    }

    // Last resort: Use Season 1
    logger.warn('[EpisodeDetector] H3: All heuristics failed, defaulting to Season 1');
    return {
      season: 1,
      startEpisode: 1,
      endEpisode: extractedEpisodeCount || 1,
      episodeCount: extractedEpisodeCount || 1,
      confidence: 0.65,
      correlationReason: 'Unable to determine season, defaulting to Season 1 (low confidence)',
      heuristicUsed: 'H3-DefaultToSeason1'
    };
  }

  /**
   * Build fallback result when TMDB data unavailable
   */
  _buildFallbackResult(seasonHint, episodeCount, reason) {
    const season = seasonHint || 1;
    const count = episodeCount || 1;

    logger.warn(`[EpisodeDetector] Using fallback: Season ${season}, ${count} episodes`);

    return {
      season,
      startEpisode: 1,
      endEpisode: count,
      episodeCount: count,
      confidence: 0.65,
      correlationReason: `${reason}, defaulting to Season ${season}`,
      heuristicUsed: 'Fallback'
    };
  }

  /**
   * Main orchestrator - detect episode numbers for a disc
   * @param {Object} params
   * @param {string} params.discPath - Path to disc backup
   * @param {string} params.discType - 'bluray' or 'dvd'
   * @param {string} params.volumeLabel - Disc volume label (e.g., "OTH_S1D6")
   * @param {number} params.tmdbId - TMDB series ID
   * @returns {Promise<Object>} Episode detection result
   */
  async detectEpisodeNumbers(params) {
    const { discPath, discType, volumeLabel, tmdbId } = params;

    logger.info('[EpisodeDetector] Starting episode detection:', {
      discPath,
      discType,
      volumeLabel,
      tmdbId
    });

    try {
      // Step 1: Extract disc/season markers from label
      const labelInfo = this._parseVolumeLabel(volumeLabel);
      logger.info('[EpisodeDetector] Parsed label:', labelInfo);

      // Step 2: Detect episodes from disc structure
      const discEpisodes = await this.detectDiscEpisodes(discPath, discType);
      logger.info('[EpisodeDetector] Disc episodes:', {
        count: discEpisodes.episodeCount,
        error: discEpisodes.error
      });

      // Step 3: Fetch series info from TMDB
      let seriesInfo = null;
      if (tmdbId) {
        seriesInfo = await this.fetchSeriesEpisodeInfo(tmdbId);
      } else {
        logger.warn('[EpisodeDetector] No TMDB ID provided, skipping series lookup');
      }

      // Step 4: Correlate disc to episodes
      const correlation = await this.correlateDiscToEpisodes({
        discNumber: labelInfo.discNumber,
        extractedEpisodeCount: discEpisodes.episodeCount,
        currentSeasonHint: labelInfo.seasonNumber,
        seriesInfo
      });

      logger.info('[EpisodeDetector] Correlation complete:', {
        season: correlation.season,
        episodes: `${correlation.startEpisode}-${correlation.endEpisode}`,
        confidence: correlation.confidence,
        heuristic: correlation.heuristicUsed
      });

      return {
        success: true,
        ...correlation,
        labelInfo,
        discStructure: {
          episodeCount: discEpisodes.episodeCount,
          titles: discEpisodes.titles
        }
      };
    } catch (error) {
      logger.error(`[EpisodeDetector] Detection failed: ${error.message}`);
      return {
        success: false,
        error: error.message,
        season: 1,
        startEpisode: 1,
        endEpisode: 1,
        episodeCount: 1,
        confidence: 0.65,
        correlationReason: `Error during detection: ${error.message}`,
        heuristicUsed: 'Error-Fallback'
      };
    }
  }

  /**
   * Parse volume label for season/disc markers
   * Examples: "OTH_S1D6" → {season: 1, disc: 6}
   *           "LOST_S02_DISC3" → {season: 2, disc: 3}
   *           "Breaking_Bad_Season_3_Disc_2" → {season: 3, disc: 2}
   */
  _parseVolumeLabel(volumeLabel) {
    if (!volumeLabel) {
      return { seasonNumber: null, discNumber: null };
    }

    const label = volumeLabel.toUpperCase();

    // Pattern 1: S1D6, S01D06, etc.
    let match = label.match(/S(\d+)D(\d+)/);
    if (match) {
      return {
        seasonNumber: parseInt(match[1], 10),
        discNumber: parseInt(match[2], 10)
      };
    }

    // Pattern 2: SEASON_1_DISC_6, SEASON1DISC6, etc.
    match = label.match(/SEASON[_\s]*(\d+)[_\s]*DISC[_\s]*(\d+)/);
    if (match) {
      return {
        seasonNumber: parseInt(match[1], 10),
        discNumber: parseInt(match[2], 10)
      };
    }

    // Pattern 3: S01, SEASON_1 (season only)
    match = label.match(/S(\d+)(?![D\d])|SEASON[_\s]*(\d+)/);
    if (match) {
      return {
        seasonNumber: parseInt(match[1] || match[2], 10),
        discNumber: null
      };
    }

    // Pattern 4: D06, DISC_6 (disc only)
    match = label.match(/D(\d+)|DISC[_\s]*(\d+)/);
    if (match) {
      return {
        seasonNumber: null,
        discNumber: parseInt(match[1] || match[2], 10)
      };
    }

    return { seasonNumber: null, discNumber: null };
  }
}

export default EpisodeDetector;
