/**
 * Metadata Schema Definitions
 * Data structures and validation for disc metadata
 */

export const SCHEMA_VERSION = 1;

// Metadata status states
export const MetadataStatus = {
  PENDING: 'pending',     // Identified but not reviewed
  APPROVED: 'approved',   // User confirmed identification
  MANUAL: 'manual',       // User manually set metadata
  ERROR: 'error',         // Identification failed
  EXPORTED: 'exported'    // Successfully exported to library
};

// Disc types
export const DiscType = {
  DVD: 'dvd',
  BLURAY: 'bluray',
  UNKNOWN: 'unknown'
};

// Media types from TMDB
export const MediaType = {
  MOVIE: 'movie',
  TV: 'tv'
};

/**
 * Create empty metadata object for a new backup
 * @param {Object} discInfo - Basic disc information
 * @returns {Object} Empty metadata structure
 */
export function createEmptyMetadata(discInfo = {}) {
  return {
    version: SCHEMA_VERSION,
    status: MetadataStatus.PENDING,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),

    disc: {
      volumeLabel: discInfo.volumeLabel || 'Unknown',
      type: discInfo.type || DiscType.UNKNOWN,
      totalSize: discInfo.totalSize || 0,
      mainFeatureDuration: null, // Seconds, filled by parser
      titleCount: 0
    },

    extracted: {
      titles: [],
      dvdInfo: null,
      blurayInfo: null
    },

    llmGuess: null,
    tmdb: null,
    tmdbCandidates: [],

    // Pre-backup fingerprint (captured before MakeMKV extraction)
    fingerprint: {
      type: null,           // 'dvd' or 'bluray'
      capturedAt: null,     // ISO timestamp when fingerprint was captured

      // DVD fingerprint
      crc64: null,          // 16-character hex string (pydvdid algorithm)

      // Blu-ray fingerprint
      contentId: null,      // ISAN from mcmf.xml (32-character hex)
      discId: null,         // From id.bdmv (32-character hex)
      organizationId: null, // From id.bdmv (8-character hex)
      embeddedTitle: null,  // From bdmt_*.xml

      // Database match results
      armMatch: null        // Match from ARM community database
    },

    final: {
      title: null,
      year: null,
      sortTitle: null,
      suggestedFolderName: null
    },

    // Cached title scan from MakeMKV (populated on first export, reused on re-export)
    titleScan: null
    // Structure when populated:
    // {
    //   scannedAt: ISO timestamp,
    //   discType: 'dvd' | 'bluray',
    //   mainFeatureIndex: number,
    //   titles: [{ index, name, duration, durationDisplay, size, sizeDisplay, chapters, isMainFeature }]
    // }
  };
}

/**
 * Create a title entry from parsed disc data
 * @param {Object} titleData - Parsed title information
 * @returns {Object} Standardized title structure
 */
export function createTitleEntry(titleData = {}) {
  return {
    index: titleData.index ?? 0,
    duration: titleData.duration ?? 0, // Seconds
    chapters: titleData.chapters ?? 0,
    audioTracks: titleData.audioTracks || [],
    subtitles: titleData.subtitles || [],
    isMainFeature: titleData.isMainFeature ?? false
  };
}

/**
 * Create LLM guess result structure
 * @param {Object} guessData - LLM response data
 * @returns {Object} Standardized LLM guess structure
 */
export function createLLMGuess(guessData = {}) {
  const result = {
    title: guessData.title || null,
    year: guessData.year || null,
    type: guessData.type || MediaType.MOVIE,
    confidence: guessData.confidence ?? 0,
    reasoning: guessData.reasoning || '',
    tvInfo: guessData.tvInfo || null, // { season, episodes }
    hasMultipleVersions: guessData.hasMultipleVersions || false
  };

  // Include confidence adjustment info if present
  if (guessData.confidenceAdjusted) {
    result.confidenceAdjusted = true;
    result.originalConfidence = guessData.originalConfidence;
  }

  return result;
}

/**
 * Create TMDB result structure
 * @param {Object} tmdbData - TMDB API response data
 * @returns {Object} Standardized TMDB structure
 */
export function createTMDBResult(tmdbData = {}) {
  return {
    id: tmdbData.id || null,
    title: tmdbData.title || tmdbData.name || null,
    originalTitle: tmdbData.original_title || tmdbData.original_name || null,
    year: tmdbData.release_date?.substring(0, 4) ||
          tmdbData.first_air_date?.substring(0, 4) || null,
    releaseDate: tmdbData.release_date || tmdbData.first_air_date || null,
    overview: tmdbData.overview || '',
    posterPath: tmdbData.poster_path || null,
    backdropPath: tmdbData.backdrop_path || null,
    genres: (tmdbData.genres || []).map(g => g.name || g),
    runtime: tmdbData.runtime || null,
    voteAverage: tmdbData.vote_average || 0,
    mediaType: tmdbData.media_type || (tmdbData.name ? MediaType.TV : MediaType.MOVIE),
    tvInfo: null
  };
}

/**
 * Create TMDB candidate entry (for search results)
 * @param {Object} result - TMDB search result
 * @returns {Object} Candidate structure for UI
 */
export function createTMDBCandidate(result = {}) {
  return {
    id: result.id,
    title: result.title || result.name,
    year: result.release_date?.substring(0, 4) ||
          result.first_air_date?.substring(0, 4) || null,
    posterPath: result.poster_path,
    mediaType: result.media_type || (result.name ? MediaType.TV : MediaType.MOVIE),
    overview: result.overview?.substring(0, 200) || ''
  };
}

/**
 * Generate suggested folder name from final metadata
 * @param {Object} metadata - Full metadata object
 * @returns {string} Suggested folder name
 */
export function generateFolderName(metadata) {
  const final = metadata.final;
  if (!final?.title) return null;

  let name = final.title;
  if (final.year) {
    name += ` (${final.year})`;
  }

  // Sanitize for filesystem
  return name
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Generate sort title (for alphabetical sorting)
 * @param {string} title - Original title
 * @returns {string} Sort title
 */
export function generateSortTitle(title) {
  if (!title) return null;

  // Remove leading articles
  const articles = ['The ', 'A ', 'An '];
  let sortTitle = title;

  for (const article of articles) {
    if (title.startsWith(article)) {
      sortTitle = title.substring(article.length) + ', ' + article.trim();
      break;
    }
  }

  return sortTitle;
}

/**
 * Update metadata timestamp
 * @param {Object} metadata - Metadata object to update
 * @returns {Object} Updated metadata
 */
export function touchMetadata(metadata) {
  return {
    ...metadata,
    updatedAt: new Date().toISOString()
  };
}

/**
 * Validate metadata object structure
 * @param {Object} data - Object to validate
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateMetadata(data) {
  const errors = [];

  if (!data) {
    return { valid: false, errors: ['Metadata is null or undefined'] };
  }

  // Check required top-level fields
  if (typeof data.version !== 'number') {
    errors.push('Missing or invalid version number');
  }

  if (!Object.values(MetadataStatus).includes(data.status)) {
    errors.push(`Invalid status: ${data.status}`);
  }

  if (!data.disc || typeof data.disc !== 'object') {
    errors.push('Missing disc information');
  }

  if (!data.extracted || typeof data.extracted !== 'object') {
    errors.push('Missing extracted information');
  }

  if (!data.final || typeof data.final !== 'object') {
    errors.push('Missing final information');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Migrate metadata from older schema versions
 * @param {Object} data - Old metadata object
 * @returns {Object} Migrated metadata
 */
export function migrateSchema(data) {
  if (!data || !data.version) {
    // No version = very old or corrupt, create fresh
    return createEmptyMetadata();
  }

  let migrated = { ...data };

  // Version 1 is current, no migrations needed yet
  // Future migrations would go here:
  // if (migrated.version < 2) { ... migrate to v2 ... migrated.version = 2; }

  migrated.version = SCHEMA_VERSION;
  return migrated;
}

export default {
  SCHEMA_VERSION,
  MetadataStatus,
  DiscType,
  MediaType,
  createEmptyMetadata,
  createTitleEntry,
  createLLMGuess,
  createTMDBResult,
  createTMDBCandidate,
  generateFolderName,
  generateSortTitle,
  touchMetadata,
  validateMetadata,
  migrateSchema
};
