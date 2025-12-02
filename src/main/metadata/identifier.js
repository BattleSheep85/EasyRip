/**
 * Disc Identifier
 * Orchestrates the full identification pipeline:
 * Parse disc → LLM identification → TMDB lookup → Store metadata
 */

import { existsSync } from 'fs';
import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import logger from '../logger.js';
import {
  createEmptyMetadata,
  createLLMGuess,
  MetadataStatus,
  DiscType,
  generateFolderName,
  generateSortTitle,
  touchMetadata
} from './schemas.js';
import { parseDVDStructure, getMainFeatureDuration as getDVDDuration } from './parser-dvd.js';
import { parseBlurayStructure, getMainFeatureDuration as getBlurayDuration } from './parser-bluray.js';
import { getOllamaManager } from './ollama.js';
import { getTMDBClient } from './tmdb.js';

// Create a simple log wrapper with category
const log = {
  info: (msg, data) => logger.info('identifier', msg, data),
  warn: (msg, data) => logger.warn('identifier', msg, data),
  error: (msg, data) => logger.error('identifier', msg, data),
  debug: (msg, data) => logger.debug('identifier', msg, data),
};

const METADATA_FILENAME = 'metadata.json';

/**
 * Analyze volume label for TV show patterns
 * Detects season markers (S1, S01, SEASON1, SEASON_1, etc.) and disc markers (D1, D01, DISC1, etc.)
 * @param {string} volumeLabel - The disc volume label
 * @returns {Object} { hasSeasonMarker, hasDicsMarker, season, disc, regionCode }
 */
function analyzeTVShowPatterns(volumeLabel) {
  const label = (volumeLabel || '').toUpperCase();

  const result = {
    hasSeasonMarker: false,
    hasDiscMarker: false,
    hasRegionCode: false,
    season: null,
    disc: null,
    regionCode: null
  };

  // Season patterns: S1, S01, S001, SEASON1, SEASON_1, SEASON 1, _S1_, S1D1, etc.
  const seasonPatterns = [
    /[_\s]S(\d{1,2})(?:[_\s]|$|D)/,       // _S1_ or S1_ or S1D (before disc)
    /SEASON[_\s]?(\d{1,2})/,              // SEASON1, SEASON_1, SEASON 1
    /^S(\d{1,2})(?:[_\s]|D)/,             // S1_ at start or S1D
    /[_\s]S(\d{1,2})$/                    // _S1 at end
  ];

  for (const pattern of seasonPatterns) {
    const match = label.match(pattern);
    if (match) {
      result.hasSeasonMarker = true;
      result.season = parseInt(match[1], 10);
      break;
    }
  }

  // Disc patterns: D1, D01, DISC1, DISC_1, DISC 1, _D1_, S1D1, etc.
  const discPatterns = [
    /[_\s]D(\d{1,2})(?:[_\s]|$)/,         // _D1_ or D1_
    /S\d{1,2}D(\d{1,2})(?:[_\s]|$)/,      // S1D1 (disc after season, no separator)
    /DISC[_\s]?(\d{1,2})/,                // DISC1, DISC_1, DISC 1
    /^D(\d{1,2})[_\s]/,                   // D1_ at start
    /[_\s]D(\d{1,2})$/                    // _D1 at end
  ];

  for (const pattern of discPatterns) {
    const match = label.match(pattern);
    if (match) {
      result.hasDiscMarker = true;
      result.disc = parseInt(match[1], 10);
      break;
    }
  }

  // Region codes: NA (North America), EU, UK, US, R1, R2, etc.
  const regionPatterns = [
    /[_\s](NA|EU|UK|US|AU|JP)(?:[_\s]|$)/,  // NA, EU, UK, US, AU, JP
    /[_\s]R(\d)(?:[_\s]|$)/                  // R1, R2, etc.
  ];

  for (const pattern of regionPatterns) {
    const match = label.match(pattern);
    if (match) {
      result.hasRegionCode = true;
      result.regionCode = match[1];
      break;
    }
  }

  return result;
}

/**
 * DiscIdentifier class
 * Orchestrates disc identification workflow
 */
export class DiscIdentifier {
  constructor() {
    this.ollama = getOllamaManager();
    this.tmdb = getTMDBClient();
    this.isProcessing = false;
  }

  /**
   * Set progress callback (forwarded to Ollama)
   * @param {Function} callback - Progress callback
   */
  setProgressCallback(callback) {
    this.ollama.setProgressCallback(callback);
  }

  /**
   * Validate and adjust confidence based on TMDB results and input quality
   * This provides a reality check on the LLM's confidence score
   * @param {Object} llmGuess - The LLM's identification guess
   * @param {Array} tmdbCandidates - TMDB search results
   * @param {string} volumeLabel - Original disc volume label
   * @returns {Object} Updated llmGuess with validated confidence and reasons
   */
  validateConfidence(llmGuess, tmdbCandidates, volumeLabel) {
    if (!llmGuess || !llmGuess.title) {
      return llmGuess;
    }

    let confidence = llmGuess.confidence || 0;
    const adjustments = [];
    const originalConfidence = confidence;

    // 0. TV Show pattern detection in volume label
    const tvShowPatterns = analyzeTVShowPatterns(volumeLabel);

    // 1. Input quality checks
    const labelLength = (volumeLabel || '').trim().length;
    const isGenericLabel = /^(disc|dvd|cd|video|movie|film|\d+)$/i.test((volumeLabel || '').trim());

    // If we have strong TV patterns, be more lenient with short labels
    const hasStrongTVPattern = tvShowPatterns.hasSeasonMarker && tvShowPatterns.hasDiscMarker;

    if (labelLength < 5 && !hasStrongTVPattern) {
      // Very short labels provide minimal identification info
      const maxAllowed = 0.30;
      if (confidence > maxAllowed) {
        confidence = maxAllowed;
        adjustments.push(`Short label (<5 chars) caps confidence at ${maxAllowed * 100}%`);
      }
    } else if (labelLength < 10 && !hasStrongTVPattern) {
      // Short labels are still limited
      const maxAllowed = 0.50;
      if (confidence > maxAllowed) {
        confidence = maxAllowed;
        adjustments.push(`Short label (<10 chars) caps confidence at ${maxAllowed * 100}%`);
      }
    }

    if (isGenericLabel) {
      // Generic labels like "DISC1" or "MOVIE" provide no identification
      const maxAllowed = 0.15;
      if (confidence > maxAllowed) {
        confidence = maxAllowed;
        adjustments.push(`Generic label caps confidence at ${maxAllowed * 100}%`);
      }
    }

    // 2. Missing year check
    if (!llmGuess.year) {
      // No year means we can't distinguish between versions/remakes
      const maxAllowed = 0.60;
      if (confidence > maxAllowed) {
        confidence = maxAllowed;
        adjustments.push(`Missing year caps confidence at ${maxAllowed * 100}%`);
      }
    }

    // 3. Multiple versions flag from LLM
    // Skip penalty if TV show patterns strongly indicate this is a TV series disc
    const skipMultipleVersionsPenalty = hasStrongTVPattern && llmGuess.type === 'tv';
    if (llmGuess.hasMultipleVersions && !llmGuess.year && !skipMultipleVersionsPenalty) {
      // LLM knows multiple versions exist but can't determine which
      const maxAllowed = 0.45;
      if (confidence > maxAllowed) {
        confidence = maxAllowed;
        adjustments.push(`Multiple versions exist without year data caps at ${maxAllowed * 100}%`);
      }
    }

    // 4. TMDB candidate analysis
    if (tmdbCandidates && tmdbCandidates.length > 0) {
      // Normalize the guessed title for comparison
      const normalizeTitle = (t) => (t || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const guessedTitle = normalizeTitle(llmGuess.title);

      // Find candidates with matching titles
      let matchingCandidates = tmdbCandidates.filter(c => {
        const candidateTitle = normalizeTitle(c.title);
        return candidateTitle === guessedTitle ||
               candidateTitle.includes(guessedTitle) ||
               guessedTitle.includes(candidateTitle);
      });

      // If we have TV patterns, filter to prefer TV shows over movies/documentaries
      if (hasStrongTVPattern && llmGuess.type === 'tv' && matchingCandidates.length > 1) {
        const tvCandidates = matchingCandidates.filter(c => c.mediaType === 'tv');
        if (tvCandidates.length > 0) {
          // Filter out non-TV matches (documentaries, specials, etc.)
          const nonTvFiltered = matchingCandidates.filter(c => c.mediaType !== 'tv');
          if (nonTvFiltered.length > 0 && tvCandidates.length === 1) {
            // We have exactly one TV show and some other stuff - prefer the TV show
            adjustments.push(`TV pattern detected, filtering ${nonTvFiltered.length} non-TV matches`);
            matchingCandidates = tvCandidates;
          }
        }
      }

      if (matchingCandidates.length > 1) {
        // Multiple TMDB entries match the same title (remakes, versions, etc.)
        const years = [...new Set(matchingCandidates.map(c => c.year).filter(Boolean))];

        if (years.length > 1 && !llmGuess.year) {
          // Multiple years for same title and we don't know which one
          const yearSpread = Math.max(...years) - Math.min(...years);

          // For TV shows with strong patterns, be less aggressive with year spread penalty
          if (yearSpread > 5 && !hasStrongTVPattern) {
            // Wide year spread (likely different versions/remakes)
            const penalty = Math.min(0.30, yearSpread * 0.01);
            const maxAllowed = 0.50 - penalty;
            if (confidence > maxAllowed) {
              confidence = Math.max(0.20, maxAllowed);
              adjustments.push(`${matchingCandidates.length} TMDB matches spanning ${yearSpread} years reduces confidence`);
            }
          } else if (yearSpread > 5 && hasStrongTVPattern) {
            // TV pattern present - apply lighter penalty and note it
            const maxAllowed = 0.70;
            if (confidence > maxAllowed) {
              confidence = maxAllowed;
              adjustments.push(`TV pattern present; ${matchingCandidates.length} TMDB matches but likely main series`);
            }
          }
        }
      }

      // Check if no candidates match at all
      if (matchingCandidates.length === 0 && tmdbCandidates.length > 0) {
        // LLM guess doesn't match any TMDB results
        const maxAllowed = 0.40;
        if (confidence > maxAllowed) {
          confidence = maxAllowed;
          adjustments.push(`No TMDB matches for guessed title caps at ${maxAllowed * 100}%`);
        }
      }
    } else if (!tmdbCandidates || tmdbCandidates.length === 0) {
      // No TMDB results at all - highly uncertain
      const maxAllowed = 0.35;
      if (confidence > maxAllowed) {
        confidence = maxAllowed;
        adjustments.push(`No TMDB results found caps at ${maxAllowed * 100}%`);
      }
    }

    // 5. TV Show pattern confidence boost
    if (hasStrongTVPattern && llmGuess.type === 'tv') {
      // Boost confidence for TV shows with clear season/disc markers
      const boost = 0.15;
      confidence = Math.min(0.85, confidence + boost);
      adjustments.push(`TV pattern (S${tvShowPatterns.season || '?'} D${tvShowPatterns.disc || '?'}) boosts confidence +${(boost * 100).toFixed(0)}%`);
    }

    // Build updated reasoning
    let reasoning = llmGuess.reasoning || '';
    if (adjustments.length > 0) {
      reasoning += ` [Confidence adjusted: ${adjustments.join('; ')}]`;
      log.info(`Confidence adjusted from ${(originalConfidence * 100).toFixed(0)}% to ${(confidence * 100).toFixed(0)}%: ${adjustments.join('; ')}`);
    }

    return {
      ...llmGuess,
      confidence: Math.max(0, Math.min(1, confidence)),
      reasoning,
      confidenceAdjusted: adjustments.length > 0,
      originalConfidence: adjustments.length > 0 ? originalConfidence : undefined
    };
  }

  /**
   * Detect disc type from backup folder
   * @param {string} backupPath - Path to backup folder
   * @returns {string} Disc type: 'dvd', 'bluray', or 'unknown'
   */
  detectDiscType(backupPath) {
    const videoTsPath = path.join(backupPath, 'VIDEO_TS');
    const bdmvPath = path.join(backupPath, 'BDMV');

    if (existsSync(bdmvPath)) {
      return DiscType.BLURAY;
    }
    if (existsSync(videoTsPath)) {
      return DiscType.DVD;
    }
    return DiscType.UNKNOWN;
  }

  /**
   * Get metadata file path for a backup
   * @param {string} backupPath - Path to backup folder
   * @returns {string} Path to metadata.json
   */
  getMetadataPath(backupPath) {
    return path.join(backupPath, METADATA_FILENAME);
  }

  /**
   * Check if metadata exists for a backup
   * @param {string} backupPath - Path to backup folder
   * @returns {boolean}
   */
  hasMetadata(backupPath) {
    return existsSync(this.getMetadataPath(backupPath));
  }

  /**
   * Load existing metadata from backup folder
   * @param {string} backupPath - Path to backup folder
   * @returns {Promise<Object|null>} Metadata object or null
   */
  async loadMetadata(backupPath) {
    const metadataPath = this.getMetadataPath(backupPath);

    if (!existsSync(metadataPath)) {
      return null;
    }

    try {
      const content = await readFile(metadataPath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      log.error(`Failed to load metadata from ${metadataPath}:`, error.message);
      return null;
    }
  }

  /**
   * Save metadata to backup folder
   * @param {string} backupPath - Path to backup folder
   * @param {Object} metadata - Metadata object
   * @returns {Promise<boolean>}
   */
  async saveMetadata(backupPath, metadata) {
    const metadataPath = this.getMetadataPath(backupPath);

    try {
      const content = JSON.stringify(metadata, null, 2);
      await writeFile(metadataPath, content, 'utf-8');
      log.info(`Saved metadata to ${metadataPath}`);
      return true;
    } catch (error) {
      log.error(`Failed to save metadata to ${metadataPath}:`, error.message);
      return false;
    }
  }

  /**
   * Parse disc structure based on type
   * @param {string} backupPath - Path to backup folder
   * @param {string} discType - 'dvd' or 'bluray'
   * @returns {Promise<Object|null>} Parsed disc data
   */
  async parseDisc(backupPath, discType) {
    if (discType === DiscType.DVD) {
      return parseDVDStructure(backupPath);
    }
    if (discType === DiscType.BLURAY) {
      return parseBlurayStructure(backupPath);
    }
    return null;
  }

  /**
   * Run full identification pipeline
   * @param {string} backupPath - Path to backup folder
   * @param {string} volumeLabel - Original volume label from disc
   * @returns {Promise<Object>} Result with success status and metadata
   */
  async identify(backupPath, volumeLabel = 'Unknown') {
    if (this.isProcessing) {
      log.warn('Identification already in progress');
      return { success: false, error: 'Already processing' };
    }

    this.isProcessing = true;
    log.info(`Starting identification for ${backupPath}`);

    try {
      // Step 0: Check for pre-captured fingerprint
      const existingMetadata = await this.loadMetadata(backupPath);
      const fingerprint = existingMetadata?.fingerprint || null;
      let searchHint = volumeLabel;
      let skipLLM = false;
      let armMatch = null;

      if (fingerprint) {
        log.info('Found pre-captured fingerprint', {
          type: fingerprint.type,
          hasCrc64: !!fingerprint.crc64,
          hasEmbeddedTitle: !!fingerprint.embeddedTitle,
          hasArmMatch: !!fingerprint.armMatch
        });

        // Use embedded title from Blu-ray as primary search hint
        if (fingerprint.embeddedTitle) {
          searchHint = fingerprint.embeddedTitle;
          log.info(`Using embedded title as search hint: "${searchHint}"`);
        }

        // If we have ARM match, we can skip LLM and use confirmed title
        if (fingerprint.armMatch) {
          armMatch = fingerprint.armMatch;
          log.info(`ARM database match: "${armMatch.title}" (${armMatch.year})`);
          skipLLM = true;
        }
      }

      // Step 1: Detect disc type
      const discType = this.detectDiscType(backupPath);
      if (discType === DiscType.UNKNOWN) {
        throw new Error('Unable to detect disc type (no VIDEO_TS or BDMV found)');
      }
      log.info(`Detected disc type: ${discType}`);

      // Step 2: Parse disc structure
      const parsed = await this.parseDisc(backupPath, discType);
      if (!parsed) {
        throw new Error('Failed to parse disc structure');
      }

      // Step 3: Get main feature duration
      const mainDuration = discType === DiscType.DVD
        ? getDVDDuration(parsed)
        : getBlurayDuration(parsed);

      // Step 4: Create initial metadata (preserve fingerprint if exists)
      const metadata = createEmptyMetadata({
        volumeLabel,
        type: discType,
        totalSize: 0 // Could be calculated if needed
      });

      // Preserve fingerprint from existing metadata
      if (fingerprint) {
        metadata.fingerprint = fingerprint;
      }

      metadata.extracted = {
        titles: parsed.titles || [],
        dvdInfo: parsed.dvdInfo || null,
        blurayInfo: parsed.blurayInfo || null
      };

      metadata.disc.mainFeatureDuration = mainDuration;
      metadata.disc.titleCount = parsed.titles?.length || 0;

      // Step 5: Try LLM identification (if Ollama available and no ARM match)
      let llmGuess = null;
      if (skipLLM && armMatch) {
        // Use ARM match as LLM guess (high confidence)
        llmGuess = {
          title: armMatch.title,
          year: armMatch.year,
          type: armMatch.type || 'movie',
          confidence: 0.99
        };
        metadata.llmGuess = createLLMGuess({
          ...llmGuess,
          reasoning: 'Matched from ARM community database (CRC64 fingerprint)'
        });
        log.info(`Using ARM match as identification: ${armMatch.title}`);
      } else {
        try {
          const ollamaStatus = await this.ollama.getStatus();
          if (ollamaStatus.running && ollamaStatus.hasModel) {
            // Pass enhanced disc info including embedded title hint
            const discInfo = {
              disc: {
                ...metadata.disc,
                volumeLabel: searchHint // Use enhanced search hint
              },
              extracted: metadata.extracted
            };
            llmGuess = await this.ollama.identifyDisc(discInfo);
            metadata.llmGuess = createLLMGuess(llmGuess);
            log.info(`LLM guess: ${llmGuess.title} (${llmGuess.confidence * 100}% confidence)`);
          } else {
            log.warn('Ollama not available, skipping LLM identification');
          }
        } catch (error) {
          log.error('LLM identification failed:', error.message);
          metadata.llmGuess = createLLMGuess({
            confidence: 0,
            reasoning: `LLM error: ${error.message}`
          });
        }
      }

      // Step 6: Search TMDB (if we have a guess and API key)
      if (this.tmdb.hasApiKey() && llmGuess?.title) {
        try {
          // Search based on type
          const searchType = llmGuess.type === 'tv' ? 'tv' : 'movie';
          const candidates = await this.tmdb.searchMulti(
            llmGuess.title,
            llmGuess.year
          );

          metadata.tmdbCandidates = candidates;

          // Get details for best match
          if (candidates.length > 0) {
            const bestMatch = candidates[0];
            const details = await this.tmdb.getDetails(
              bestMatch.id,
              bestMatch.mediaType
            );
            metadata.tmdb = details;
            log.info(`TMDB match: ${details.title} (${details.year})`);
          }
        } catch (error) {
          log.error('TMDB lookup failed:', error.message);
        }
      } else if (!this.tmdb.hasApiKey()) {
        log.warn('TMDB API key not configured');
      }

      // Step 6.5: Validate and adjust confidence based on TMDB results
      if (llmGuess && !skipLLM) {
        const validatedGuess = this.validateConfidence(
          llmGuess,
          metadata.tmdbCandidates,
          volumeLabel
        );
        llmGuess = validatedGuess;
        metadata.llmGuess = createLLMGuess(validatedGuess);
        if (validatedGuess.confidenceAdjusted) {
          log.info(`Validated confidence: ${(validatedGuess.confidence * 100).toFixed(0)}% (was ${(validatedGuess.originalConfidence * 100).toFixed(0)}%)`);
        }
      }

      // Step 7: Generate final suggested name
      if (metadata.tmdb?.title) {
        metadata.final = {
          title: metadata.tmdb.title,
          year: metadata.tmdb.year,
          sortTitle: generateSortTitle(metadata.tmdb.title),
          suggestedFolderName: generateFolderName({
            final: {
              title: metadata.tmdb.title,
              year: metadata.tmdb.year
            }
          })
        };
      } else if (llmGuess?.title) {
        metadata.final = {
          title: llmGuess.title,
          year: llmGuess.year,
          sortTitle: generateSortTitle(llmGuess.title),
          suggestedFolderName: generateFolderName({
            final: {
              title: llmGuess.title,
              year: llmGuess.year
            }
          })
        };
      }

      // Step 8: Save metadata
      metadata.status = MetadataStatus.PENDING;
      await this.saveMetadata(backupPath, touchMetadata(metadata));

      this.isProcessing = false;
      return { success: true, metadata };

    } catch (error) {
      this.isProcessing = false;
      log.error('Identification failed:', error);

      // Save error state
      const errorMetadata = createEmptyMetadata({ volumeLabel });
      errorMetadata.status = MetadataStatus.ERROR;
      errorMetadata.llmGuess = createLLMGuess({
        confidence: 0,
        reasoning: `Identification error: ${error.message}`
      });
      await this.saveMetadata(backupPath, touchMetadata(errorMetadata));

      return { success: false, error: error.message, metadata: errorMetadata };
    }
  }

  /**
   * Approve metadata (mark as confirmed by user)
   * @param {string} backupPath - Path to backup folder
   * @returns {Promise<Object>} Result
   */
  async approve(backupPath) {
    const metadata = await this.loadMetadata(backupPath);
    if (!metadata) {
      return { success: false, error: 'No metadata found' };
    }

    metadata.status = MetadataStatus.APPROVED;
    const saved = await this.saveMetadata(backupPath, touchMetadata(metadata));

    return { success: saved, metadata };
  }

  /**
   * Update metadata with user selection
   * @param {string} backupPath - Path to backup folder
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object>} Result
   */
  async update(backupPath, updates) {
    let metadata = await this.loadMetadata(backupPath);
    if (!metadata) {
      metadata = createEmptyMetadata();
    }

    // Apply updates
    if (updates.tmdb) {
      metadata.tmdb = updates.tmdb;
    }

    if (updates.final) {
      metadata.final = {
        ...metadata.final,
        ...updates.final,
        sortTitle: generateSortTitle(updates.final.title || metadata.final?.title),
        suggestedFolderName: generateFolderName({ final: updates.final })
      };
    }

    // Cache title scan results for re-exports
    if (updates.titleScan) {
      metadata.titleScan = updates.titleScan;
    }

    // Export tracking
    if (updates.exported) {
      metadata.exported = updates.exported;
    }
    if (updates.exportError !== undefined) {
      metadata.exportError = updates.exportError;
    }
    if (updates.exportErrorAt !== undefined) {
      metadata.exportErrorAt = updates.exportErrorAt;
    }

    if (updates.status) {
      metadata.status = updates.status;
    } else if (!updates.titleScan && !updates.exported && !updates.exportError) {
      // Only set to MANUAL if this isn't just a cache/export update
      metadata.status = MetadataStatus.MANUAL;
    }

    const saved = await this.saveMetadata(backupPath, touchMetadata(metadata));
    return { success: saved, metadata };
  }

  /**
   * Select a TMDB candidate and fetch its details
   * @param {string} backupPath - Path to backup folder
   * @param {number} tmdbId - TMDB ID to select
   * @param {string} mediaType - 'movie' or 'tv'
   * @returns {Promise<Object>} Result
   */
  async selectCandidate(backupPath, tmdbId, mediaType) {
    const metadata = await this.loadMetadata(backupPath);
    if (!metadata) {
      return { success: false, error: 'No metadata found' };
    }

    try {
      const details = await this.tmdb.getDetails(tmdbId, mediaType);

      metadata.tmdb = details;
      metadata.final = {
        title: details.title,
        year: details.year,
        sortTitle: generateSortTitle(details.title),
        suggestedFolderName: generateFolderName({
          final: { title: details.title, year: details.year }
        })
      };
      metadata.status = MetadataStatus.PENDING;

      await this.saveMetadata(backupPath, touchMetadata(metadata));
      return { success: true, metadata };

    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

// Export singleton instance
let instance = null;

export function getDiscIdentifier() {
  if (!instance) {
    instance = new DiscIdentifier();
  }
  return instance;
}

export default {
  DiscIdentifier,
  getDiscIdentifier
};
