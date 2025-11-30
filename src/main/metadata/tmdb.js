/**
 * TMDB API Client
 * The Movie Database API integration for metadata lookup
 */

import logger from '../logger.js';
import { createTMDBResult, createTMDBCandidate, MediaType } from './schemas.js';

// Create a simple log wrapper with category
const log = {
  info: (msg, data) => logger.info('tmdb', msg, data),
  warn: (msg, data) => logger.warn('tmdb', msg, data),
  error: (msg, data) => logger.error('tmdb', msg, data),
  debug: (msg, data) => logger.debug('tmdb', msg, data),
};

const TMDB_API_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';
const REQUEST_TIMEOUT = 10000;
const RATE_LIMIT_DELAY = 250; // ms between requests

/**
 * TMDBClient class
 * Handles all TMDB API interactions
 */
export class TMDBClient {
  constructor(apiKey = null) {
    this.apiKey = apiKey;
    this.lastRequestTime = 0;
  }

  /**
   * Set API key
   * @param {string} apiKey - TMDB API key
   */
  setApiKey(apiKey) {
    this.apiKey = apiKey;
  }

  /**
   * Check if API key is configured
   * @returns {boolean}
   */
  hasApiKey() {
    return Boolean(this.apiKey);
  }

  /**
   * Rate-limited fetch wrapper
   * @param {string} url - URL to fetch
   * @returns {Promise<Response>}
   */
  async _fetch(url) {
    if (!this.apiKey) {
      throw new Error('TMDB API key not configured');
    }

    // Rate limiting
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    if (timeSinceLastRequest < RATE_LIMIT_DELAY) {
      await new Promise(resolve =>
        setTimeout(resolve, RATE_LIMIT_DELAY - timeSinceLastRequest)
      );
    }
    this.lastRequestTime = Date.now();

    // Add API key to URL
    const separator = url.includes('?') ? '&' : '?';
    const fullUrl = `${url}${separator}api_key=${this.apiKey}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    try {
      const response = await fetch(fullUrl, {
        signal: controller.signal,
        headers: {
          'Accept': 'application/json'
        }
      });

      clearTimeout(timeout);

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Invalid TMDB API key');
        }
        if (response.status === 429) {
          throw new Error('TMDB rate limit exceeded');
        }
        throw new Error(`TMDB API error: ${response.status}`);
      }

      return response;

    } catch (error) {
      clearTimeout(timeout);
      if (error.name === 'AbortError') {
        throw new Error('TMDB request timeout');
      }
      throw error;
    }
  }

  /**
   * Search for movies and TV shows
   * @param {string} query - Search query
   * @param {number} year - Optional release year
   * @returns {Promise<Array>} Search results as candidates
   */
  async searchMulti(query, year = null) {
    if (!query) return [];

    let url = `${TMDB_API_BASE}/search/multi?query=${encodeURIComponent(query)}`;
    if (year) {
      url += `&year=${year}`;
    }

    log.info(`Searching TMDB: "${query}" (year: ${year || 'any'})`);

    try {
      const response = await this._fetch(url);
      const data = await response.json();

      const results = (data.results || [])
        .filter(r => r.media_type === 'movie' || r.media_type === 'tv')
        .slice(0, 10)
        .map(r => createTMDBCandidate(r));

      log.info(`Found ${results.length} results`);
      return results;

    } catch (error) {
      log.error('Search failed:', error.message);
      throw error;
    }
  }

  /**
   * Search for movies only
   * @param {string} query - Search query
   * @param {number} year - Optional release year
   * @returns {Promise<Array>} Search results
   */
  async searchMovie(query, year = null) {
    if (!query) return [];

    let url = `${TMDB_API_BASE}/search/movie?query=${encodeURIComponent(query)}`;
    if (year) {
      url += `&year=${year}`;
    }

    try {
      const response = await this._fetch(url);
      const data = await response.json();

      return (data.results || [])
        .slice(0, 10)
        .map(r => createTMDBCandidate({ ...r, media_type: 'movie' }));

    } catch (error) {
      log.error('Movie search failed:', error.message);
      throw error;
    }
  }

  /**
   * Search for TV shows only
   * @param {string} query - Search query
   * @param {number} year - Optional first air year
   * @returns {Promise<Array>} Search results
   */
  async searchTV(query, year = null) {
    if (!query) return [];

    let url = `${TMDB_API_BASE}/search/tv?query=${encodeURIComponent(query)}`;
    if (year) {
      url += `&first_air_date_year=${year}`;
    }

    try {
      const response = await this._fetch(url);
      const data = await response.json();

      return (data.results || [])
        .slice(0, 10)
        .map(r => createTMDBCandidate({ ...r, media_type: 'tv' }));

    } catch (error) {
      log.error('TV search failed:', error.message);
      throw error;
    }
  }

  /**
   * Get full movie details
   * @param {number} movieId - TMDB movie ID
   * @returns {Promise<Object>} Movie details
   */
  async getMovieDetails(movieId) {
    if (!movieId) return null;

    log.info(`Getting movie details for ID ${movieId}`);

    try {
      const response = await this._fetch(
        `${TMDB_API_BASE}/movie/${movieId}`
      );
      const data = await response.json();

      return createTMDBResult({ ...data, media_type: 'movie' });

    } catch (error) {
      log.error('Get movie details failed:', error.message);
      throw error;
    }
  }

  /**
   * Get full TV show details
   * @param {number} tvId - TMDB TV show ID
   * @returns {Promise<Object>} TV show details
   */
  async getTVDetails(tvId) {
    if (!tvId) return null;

    log.info(`Getting TV details for ID ${tvId}`);

    try {
      const response = await this._fetch(
        `${TMDB_API_BASE}/tv/${tvId}`
      );
      const data = await response.json();

      const result = createTMDBResult({ ...data, media_type: 'tv' });
      result.tvInfo = {
        numberOfSeasons: data.number_of_seasons || 0,
        numberOfEpisodes: data.number_of_episodes || 0,
        inProduction: data.in_production || false
      };

      return result;

    } catch (error) {
      log.error('Get TV details failed:', error.message);
      throw error;
    }
  }

  /**
   * Get TV season details
   * @param {number} tvId - TMDB TV show ID
   * @param {number} seasonNumber - Season number
   * @returns {Promise<Object>} Season details with episodes
   */
  async getTVSeasonDetails(tvId, seasonNumber) {
    if (!tvId || seasonNumber === undefined) return null;

    log.info(`Getting season ${seasonNumber} for TV ID ${tvId}`);

    try {
      const response = await this._fetch(
        `${TMDB_API_BASE}/tv/${tvId}/season/${seasonNumber}`
      );
      const data = await response.json();

      return {
        id: data.id,
        seasonNumber: data.season_number,
        name: data.name,
        overview: data.overview,
        posterPath: data.poster_path,
        airDate: data.air_date,
        episodes: (data.episodes || []).map(ep => ({
          episodeNumber: ep.episode_number,
          name: ep.name,
          overview: ep.overview,
          airDate: ep.air_date,
          runtime: ep.runtime,
          stillPath: ep.still_path
        }))
      };

    } catch (error) {
      log.error('Get season details failed:', error.message);
      throw error;
    }
  }

  /**
   * Get details by ID and type
   * @param {number} id - TMDB ID
   * @param {string} mediaType - 'movie' or 'tv'
   * @returns {Promise<Object>} Details
   */
  async getDetails(id, mediaType) {
    if (mediaType === MediaType.TV || mediaType === 'tv') {
      return this.getTVDetails(id);
    }
    return this.getMovieDetails(id);
  }

  /**
   * Build full poster URL
   * @param {string} posterPath - TMDB poster path
   * @param {string} size - Image size (w92, w154, w185, w342, w500, w780, original)
   * @returns {string|null} Full poster URL
   */
  getPosterUrl(posterPath, size = 'w500') {
    if (!posterPath) return null;
    return `${TMDB_IMAGE_BASE}/${size}${posterPath}`;
  }

  /**
   * Build full backdrop URL
   * @param {string} backdropPath - TMDB backdrop path
   * @param {string} size - Image size (w300, w780, w1280, original)
   * @returns {string|null} Full backdrop URL
   */
  getBackdropUrl(backdropPath, size = 'w780') {
    if (!backdropPath) return null;
    return `${TMDB_IMAGE_BASE}/${size}${backdropPath}`;
  }

  /**
   * Validate API key by making a test request
   * @returns {Promise<boolean>}
   */
  async validateApiKey() {
    try {
      await this._fetch(`${TMDB_API_BASE}/configuration`);
      return true;
    } catch (error) {
      if (error.message.includes('Invalid TMDB API key')) {
        return false;
      }
      throw error;
    }
  }
}

// Export singleton instance
let instance = null;

export function getTMDBClient() {
  if (!instance) {
    instance = new TMDBClient();
  }
  return instance;
}

export default {
  TMDBClient,
  getTMDBClient
};
