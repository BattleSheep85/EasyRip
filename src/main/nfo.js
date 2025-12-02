// NFO File Generator for Emby/Jellyfin Metadata
// Generates XML-based NFO files that Emby uses for media identification

import fs from 'fs';
import path from 'path';
import logger from './logger.js';

/**
 * Escape XML special characters
 */
function escapeXml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Format date to YYYY-MM-DD
 */
function formatDate(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;
  return date.toISOString().split('T')[0];
}

/**
 * Generate movie NFO content
 * @param {Object} metadata - Movie metadata from TMDB
 * @returns {string} XML NFO content
 */
export function generateMovieNfo(metadata) {
  const {
    title = 'Unknown',
    year = '',
    tmdbId = '',
    imdbId = '',
    overview = '',
    releaseDate = '',
    runtime = '',
    genres = [],
    cast = [],
    crew = [],
    rating = '',
    voteCount = '',
    tagline = '',
    originalTitle = '',
    originalLanguage = '',
    productionCompanies = [],
    certification = ''
  } = metadata;

  // Find director from crew
  const director = crew?.find(c => c.job === 'Director')?.name || '';

  // Build genres XML
  const genresXml = (genres || [])
    .map(g => `  <genre>${escapeXml(typeof g === 'string' ? g : g.name)}</genre>`)
    .join('\n');

  // Build cast XML (limit to top 20)
  const castXml = (cast || []).slice(0, 20)
    .map(actor => `  <actor>
    <name>${escapeXml(actor.name)}</name>
    <role>${escapeXml(actor.character || '')}</role>
    <order>${actor.order || 0}</order>
    <thumb>${escapeXml(actor.profile_path ? `https://image.tmdb.org/t/p/w185${actor.profile_path}` : '')}</thumb>
  </actor>`)
    .join('\n');

  // Build studio XML
  const studiosXml = (productionCompanies || [])
    .map(s => `  <studio>${escapeXml(typeof s === 'string' ? s : s.name)}</studio>`)
    .join('\n');

  const nfoContent = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<movie>
  <title>${escapeXml(title)}</title>
  <originaltitle>${escapeXml(originalTitle || title)}</originaltitle>
  <sorttitle>${escapeXml(title)}</sorttitle>
  <year>${escapeXml(String(year))}</year>
  <rating>${escapeXml(String(rating))}</rating>
  <votes>${escapeXml(String(voteCount))}</votes>
  <plot>${escapeXml(overview)}</plot>
  <tagline>${escapeXml(tagline)}</tagline>
  <runtime>${escapeXml(String(runtime))}</runtime>
  <mpaa>${escapeXml(certification)}</mpaa>
  <premiered>${escapeXml(formatDate(releaseDate))}</premiered>
  <releasedate>${escapeXml(formatDate(releaseDate))}</releasedate>
  <director>${escapeXml(director)}</director>
  <language>${escapeXml(originalLanguage)}</language>
  <uniqueid type="tmdb" default="true">${escapeXml(String(tmdbId))}</uniqueid>
  <uniqueid type="imdb">${escapeXml(imdbId || '')}</uniqueid>
  <tmdbid>${escapeXml(String(tmdbId))}</tmdbid>
  <imdbid>${escapeXml(imdbId || '')}</imdbid>
${genresXml}
${studiosXml}
${castXml}
</movie>`;

  return nfoContent;
}

/**
 * Generate TV show NFO content (for series root folder)
 * @param {Object} metadata - TV show metadata from TMDB
 * @returns {string} XML NFO content
 */
export function generateTvShowNfo(metadata) {
  const {
    title = 'Unknown',
    year = '',
    tmdbId = '',
    imdbId = '',
    overview = '',
    firstAirDate = '',
    genres = [],
    cast = [],
    rating = '',
    voteCount = '',
    status = '',
    originalTitle = '',
    originalLanguage = '',
    networks = [],
    productionCompanies = [],
    certification = ''
  } = metadata;

  // Build genres XML
  const genresXml = (genres || [])
    .map(g => `  <genre>${escapeXml(typeof g === 'string' ? g : g.name)}</genre>`)
    .join('\n');

  // Build cast XML (limit to top 20)
  const castXml = (cast || []).slice(0, 20)
    .map(actor => `  <actor>
    <name>${escapeXml(actor.name)}</name>
    <role>${escapeXml(actor.character || '')}</role>
    <order>${actor.order || 0}</order>
    <thumb>${escapeXml(actor.profile_path ? `https://image.tmdb.org/t/p/w185${actor.profile_path}` : '')}</thumb>
  </actor>`)
    .join('\n');

  // Build studio XML from networks
  const studiosXml = (networks || [])
    .map(n => `  <studio>${escapeXml(typeof n === 'string' ? n : n.name)}</studio>`)
    .join('\n');

  const nfoContent = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<tvshow>
  <title>${escapeXml(title)}</title>
  <originaltitle>${escapeXml(originalTitle || title)}</originaltitle>
  <sorttitle>${escapeXml(title)}</sorttitle>
  <year>${escapeXml(String(year))}</year>
  <rating>${escapeXml(String(rating))}</rating>
  <votes>${escapeXml(String(voteCount))}</votes>
  <plot>${escapeXml(overview)}</plot>
  <status>${escapeXml(status)}</status>
  <premiered>${escapeXml(formatDate(firstAirDate))}</premiered>
  <language>${escapeXml(originalLanguage)}</language>
  <mpaa>${escapeXml(certification)}</mpaa>
  <uniqueid type="tmdb" default="true">${escapeXml(String(tmdbId))}</uniqueid>
  <uniqueid type="imdb">${escapeXml(imdbId || '')}</uniqueid>
  <tmdbid>${escapeXml(String(tmdbId))}</tmdbid>
  <imdbid>${escapeXml(imdbId || '')}</imdbid>
${genresXml}
${studiosXml}
${castXml}
</tvshow>`;

  return nfoContent;
}

/**
 * Generate episode NFO content
 * @param {Object} metadata - Episode metadata
 * @returns {string} XML NFO content
 */
export function generateEpisodeNfo(metadata) {
  const {
    title = 'Unknown',
    showTitle = '',
    season = 1,
    episode = 1,
    overview = '',
    airDate = '',
    runtime = '',
    rating = '',
    voteCount = '',
    tmdbId = '',
    director = '',
    writer = ''
  } = metadata;

  const nfoContent = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<episodedetails>
  <title>${escapeXml(title)}</title>
  <showtitle>${escapeXml(showTitle)}</showtitle>
  <season>${season}</season>
  <episode>${episode}</episode>
  <plot>${escapeXml(overview)}</plot>
  <runtime>${escapeXml(String(runtime))}</runtime>
  <aired>${escapeXml(formatDate(airDate))}</aired>
  <rating>${escapeXml(String(rating))}</rating>
  <votes>${escapeXml(String(voteCount))}</votes>
  <uniqueid type="tmdb" default="true">${escapeXml(String(tmdbId))}</uniqueid>
  <director>${escapeXml(director)}</director>
  <credits>${escapeXml(writer)}</credits>
</episodedetails>`;

  return nfoContent;
}

/**
 * Write movie NFO file to the movie folder
 * @param {string} movieFolder - Path to the movie folder
 * @param {Object} metadata - Movie metadata
 * @returns {Promise<string>} Path to the created NFO file
 */
export async function writeMovieNfo(movieFolder, metadata) {
  const nfoContent = generateMovieNfo(metadata);

  // Emby expects movie.nfo in the movie folder
  const nfoPath = path.join(movieFolder, 'movie.nfo');

  await fs.promises.writeFile(nfoPath, nfoContent, 'utf8');
  logger.info(`Created movie NFO: ${nfoPath}`);

  return nfoPath;
}

/**
 * Write TV show NFO file to the series root folder
 * @param {string} seriesFolder - Path to the series root folder
 * @param {Object} metadata - TV show metadata
 * @returns {Promise<string>} Path to the created NFO file
 */
export async function writeTvShowNfo(seriesFolder, metadata) {
  const nfoContent = generateTvShowNfo(metadata);

  // Emby expects tvshow.nfo in the series root folder
  const nfoPath = path.join(seriesFolder, 'tvshow.nfo');

  await fs.promises.writeFile(nfoPath, nfoContent, 'utf8');
  logger.info(`Created TV show NFO: ${nfoPath}`);

  return nfoPath;
}

/**
 * Write episode NFO file alongside the episode video file
 * @param {string} episodePath - Path to the episode video file (without extension)
 * @param {Object} metadata - Episode metadata
 * @returns {Promise<string>} Path to the created NFO file
 */
export async function writeEpisodeNfo(episodePath, metadata) {
  const nfoContent = generateEpisodeNfo(metadata);

  // Episode NFO should have same name as video file but with .nfo extension
  const nfoPath = episodePath.replace(/\.[^.]+$/, '.nfo');

  await fs.promises.writeFile(nfoPath, nfoContent, 'utf8');
  logger.info(`Created episode NFO: ${nfoPath}`);

  return nfoPath;
}

/**
 * Generate Emby-compliant folder and file names for movies
 * Format: "Title (Year)/Title (Year).mkv"
 * @param {Object} metadata - Movie metadata
 * @returns {Object} { folderName, fileName }
 */
export function generateMovieNames(metadata) {
  const { title, year } = metadata;

  // Clean title for filesystem
  const cleanTitle = sanitizeFilename(title);

  // Emby format: "Title (Year)"
  const baseName = year ? `${cleanTitle} (${year})` : cleanTitle;

  return {
    folderName: baseName,
    fileName: `${baseName}.mkv`
  };
}

/**
 * Generate Emby-compliant folder and file names for TV episodes
 * Format: "Series (Year)/Season XX/Series - SXXEXX - Episode Title.mkv"
 * @param {Object} metadata - Episode metadata with series info
 * @returns {Object} { seriesFolderName, seasonFolderName, fileName }
 */
export function generateTvEpisodeNames(metadata) {
  const {
    showTitle,
    showYear,
    season,
    episode,
    episodeTitle
  } = metadata;

  // Clean names for filesystem
  const cleanShowTitle = sanitizeFilename(showTitle);
  const cleanEpisodeTitle = episodeTitle ? sanitizeFilename(episodeTitle) : '';

  // Series folder: "Series Name (Year)"
  const seriesFolderName = showYear
    ? `${cleanShowTitle} (${showYear})`
    : cleanShowTitle;

  // Season folder: "Season XX" (padded to 2 digits)
  const seasonNum = String(season).padStart(2, '0');
  const seasonFolderName = `Season ${seasonNum}`;

  // Episode file: "Series Name - SXXEXX - Episode Title.mkv"
  const episodeNum = String(episode).padStart(2, '0');
  const episodeCode = `S${seasonNum}E${episodeNum}`;

  let fileName;
  if (cleanEpisodeTitle) {
    fileName = `${cleanShowTitle} - ${episodeCode} - ${cleanEpisodeTitle}.mkv`;
  } else {
    fileName = `${cleanShowTitle} - ${episodeCode}.mkv`;
  }

  return {
    seriesFolderName,
    seasonFolderName,
    fileName
  };
}

/**
 * Sanitize a string for use as a filename
 * Removes or replaces characters that are invalid in Windows/Unix filenames
 * @param {string} str - String to sanitize
 * @returns {string} Sanitized string
 */
export function sanitizeFilename(str) {
  if (!str) return 'Unknown';

  return str
    // Replace colons with dash (common in titles like "Movie: Subtitle")
    .replace(/:/g, ' -')
    // Remove or replace invalid characters
    .replace(/[<>"/\\|?*]/g, '')
    // Replace multiple spaces with single space
    .replace(/\s+/g, ' ')
    // Trim whitespace
    .trim()
    // Remove trailing periods (Windows doesn't like them)
    .replace(/\.+$/, '')
    // Limit length (Windows has 255 char limit for filenames)
    .substring(0, 200);
}

export default {
  generateMovieNfo,
  generateTvShowNfo,
  generateEpisodeNfo,
  writeMovieNfo,
  writeTvShowNfo,
  writeEpisodeNfo,
  generateMovieNames,
  generateTvEpisodeNames,
  sanitizeFilename
};
