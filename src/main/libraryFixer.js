// Emby Library Fixer - Rename and fix existing media to follow Emby best practices
// Scans library folders, renames incorrectly named items, and generates missing NFO files

import { promises as fs } from 'fs';
import path from 'path';
import logger from './logger.js';
import { writeMovieNfo, writeTvShowNfo, sanitizeFilename } from './nfo.js';
import { TMDBClient } from './metadata/tmdb.js';

/**
 * Emby Library Fixer class
 */
export class LibraryFixer {
  constructor(tmdbApiKey) {
    this.tmdbClient = tmdbApiKey ? new TMDBClient(tmdbApiKey) : null;
  }

  /**
   * Scan and fix a movie library folder
   * @param {string} libraryPath - Path to the movie library
   * @param {Object} options - Options
   * @param {boolean} options.dryRun - If true, only report what would be changed
   * @param {Function} options.onProgress - Progress callback
   * @param {Function} options.onLog - Log callback
   * @returns {Promise<Object>} Results summary
   */
  async fixMovieLibrary(libraryPath, options = {}) {
    const { dryRun = false, onProgress, onLog } = options;
    const results = {
      scanned: 0,
      renamed: 0,
      nfoCreated: 0,
      errors: [],
      changes: []
    };

    if (onLog) onLog(`Scanning movie library: ${libraryPath}`);

    try {
      const entries = await fs.readdir(libraryPath, { withFileTypes: true });
      const folders = entries.filter(e => e.isDirectory());
      const total = folders.length;

      for (let i = 0; i < folders.length; i++) {
        const folder = folders[i];
        results.scanned++;

        if (onProgress) {
          onProgress({ current: i + 1, total, percent: ((i + 1) / total) * 100 });
        }

        try {
          const folderPath = path.join(libraryPath, folder.name);
          const changesMade = await this.fixMovieFolder(folderPath, {
            dryRun,
            onLog
          });

          if (changesMade.renamed) {
            results.renamed++;
            results.changes.push({
              type: 'rename',
              from: folder.name,
              to: changesMade.newName
            });
          }

          if (changesMade.nfoCreated) {
            results.nfoCreated++;
            results.changes.push({
              type: 'nfo',
              folder: changesMade.newName || folder.name
            });
          }
        } catch (err) {
          results.errors.push({ folder: folder.name, error: err.message });
          if (onLog) onLog(`Error processing ${folder.name}: ${err.message}`);
        }
      }
    } catch (err) {
      logger.error('library-fixer', `Failed to scan library: ${err.message}`);
      throw err;
    }

    if (onLog) {
      onLog(`Library fix complete:`);
      onLog(`  - Scanned: ${results.scanned} folders`);
      onLog(`  - Renamed: ${results.renamed} folders`);
      onLog(`  - NFO files created: ${results.nfoCreated}`);
      onLog(`  - Errors: ${results.errors.length}`);
    }

    return results;
  }

  /**
   * Fix a single movie folder
   * @param {string} folderPath - Path to the movie folder
   * @param {Object} options - Options
   * @returns {Promise<Object>} Changes made
   */
  async fixMovieFolder(folderPath, options = {}) {
    const { dryRun = false, onLog } = options;
    const folderName = path.basename(folderPath);
    const changes = { renamed: false, nfoCreated: false, newName: null };

    // Check if folder needs renaming (has [tmdbid=xxx] or other issues)
    const needsRename = this.folderNeedsRename(folderName);

    if (needsRename) {
      const { cleanName, tmdbId, year } = this.parseOldFolderName(folderName);

      if (cleanName) {
        // Generate proper Emby folder name: "Title (Year)"
        const newFolderName = year ? `${cleanName} (${year})` : cleanName;
        const newFolderPath = path.join(path.dirname(folderPath), newFolderName);

        if (onLog) onLog(`Renaming: "${folderName}" -> "${newFolderName}"`);

        if (!dryRun) {
          // Check if target already exists
          const targetExists = await fs.access(newFolderPath).then(() => true).catch(() => false);
          if (targetExists) {
            throw new Error(`Target folder already exists: ${newFolderName}`);
          }

          await fs.rename(folderPath, newFolderPath);

          // Also rename the MKV file inside if it follows old naming
          await this.renameMovieFile(newFolderPath, newFolderName);
        }

        changes.renamed = true;
        changes.newName = newFolderName;
        changes.tmdbId = tmdbId;

        // Update folderPath for NFO generation
        folderPath = newFolderPath;
      }
    }

    // Check for missing NFO file
    const currentFolderName = changes.newName || folderName;
    const nfoPath = path.join(dryRun && changes.renamed ? path.join(path.dirname(folderPath), changes.newName) : folderPath, 'movie.nfo');
    const hasNfo = await fs.access(nfoPath).then(() => true).catch(() => false);

    if (!hasNfo) {
      const { cleanName, tmdbId, year } = this.parseOldFolderName(currentFolderName);

      if (onLog) onLog(`Creating NFO for: ${currentFolderName}`);

      if (!dryRun) {
        // Try to fetch metadata from TMDB if we have an ID or can search
        let metadata = {
          title: cleanName || currentFolderName,
          year: year || ''
        };

        if (this.tmdbClient) {
          try {
            if (tmdbId) {
              // Fetch by TMDB ID
              const tmdbData = await this.tmdbClient.getMovieDetails(tmdbId);
              if (tmdbData) {
                metadata = {
                  title: tmdbData.title,
                  year: tmdbData.release_date?.split('-')[0] || year,
                  tmdbId: tmdbData.id,
                  imdbId: tmdbData.imdb_id,
                  overview: tmdbData.overview,
                  releaseDate: tmdbData.release_date,
                  runtime: tmdbData.runtime,
                  genres: tmdbData.genres,
                  cast: tmdbData.credits?.cast,
                  crew: tmdbData.credits?.crew,
                  rating: tmdbData.vote_average,
                  voteCount: tmdbData.vote_count,
                  tagline: tmdbData.tagline,
                  originalTitle: tmdbData.original_title,
                  originalLanguage: tmdbData.original_language,
                  productionCompanies: tmdbData.production_companies
                };
              }
            } else {
              // Try to search by name
              const searchResults = await this.tmdbClient.searchMovie(cleanName || currentFolderName, year);
              if (searchResults?.results?.length > 0) {
                const firstResult = searchResults.results[0];
                const tmdbData = await this.tmdbClient.getMovieDetails(firstResult.id);
                if (tmdbData) {
                  metadata = {
                    title: tmdbData.title,
                    year: tmdbData.release_date?.split('-')[0] || year,
                    tmdbId: tmdbData.id,
                    imdbId: tmdbData.imdb_id,
                    overview: tmdbData.overview,
                    releaseDate: tmdbData.release_date,
                    runtime: tmdbData.runtime,
                    genres: tmdbData.genres,
                    cast: tmdbData.credits?.cast,
                    crew: tmdbData.credits?.crew,
                    rating: tmdbData.vote_average,
                    voteCount: tmdbData.vote_count,
                    tagline: tmdbData.tagline,
                    originalTitle: tmdbData.original_title,
                    originalLanguage: tmdbData.original_language,
                    productionCompanies: tmdbData.production_companies
                  };
                }
              }
            }
          } catch (tmdbErr) {
            logger.warn('library-fixer', `TMDB lookup failed for ${currentFolderName}: ${tmdbErr.message}`);
          }
        }

        const actualFolderPath = changes.renamed
          ? path.join(path.dirname(folderPath), changes.newName || folderName)
          : folderPath;

        await writeMovieNfo(actualFolderPath, metadata);
      }

      changes.nfoCreated = true;
    }

    return changes;
  }

  /**
   * Rename movie file inside folder to match Emby naming
   */
  async renameMovieFile(folderPath, expectedBaseName) {
    const files = await fs.readdir(folderPath);
    const mkvFiles = files.filter(f => f.endsWith('.mkv'));

    for (const mkvFile of mkvFiles) {
      // Check if file has old naming pattern
      if (mkvFile.includes('[tmdbid=')) {
        const newFileName = `${expectedBaseName}.mkv`;
        const oldPath = path.join(folderPath, mkvFile);
        const newPath = path.join(folderPath, newFileName);

        if (mkvFile !== newFileName) {
          logger.info('library-fixer', `Renaming file: ${mkvFile} -> ${newFileName}`);
          await fs.rename(oldPath, newPath);
        }
      }
    }
  }

  /**
   * Check if a folder name needs renaming
   */
  folderNeedsRename(folderName) {
    // Check for [tmdbid=xxx] pattern
    if (/\[tmdbid=\d+\]/.test(folderName)) {
      return true;
    }

    // Check for [imdbid=xxx] pattern
    if (/\[imdbid=\w+\]/.test(folderName)) {
      return true;
    }

    return false;
  }

  /**
   * Parse old folder naming to extract title, year, and IDs
   * Examples:
   * - "Big Al (2000) [tmdbid=12345]" -> { cleanName: "Big Al", year: "2000", tmdbId: "12345" }
   * - "Movie Name [tmdbid=67890]" -> { cleanName: "Movie Name", year: null, tmdbId: "67890" }
   */
  parseOldFolderName(folderName) {
    // Extract TMDB ID if present
    const tmdbMatch = folderName.match(/\[tmdbid=(\d+)\]/i);
    const tmdbId = tmdbMatch ? tmdbMatch[1] : null;

    // Extract IMDB ID if present
    const imdbMatch = folderName.match(/\[imdbid=(tt\d+)\]/i);
    const imdbId = imdbMatch ? imdbMatch[1] : null;

    // Remove all bracket tags
    let cleanName = folderName
      .replace(/\[tmdbid=\d+\]/gi, '')
      .replace(/\[imdbid=\w+\]/gi, '')
      .trim();

    // Extract year from end of name
    const yearMatch = cleanName.match(/\((\d{4})\)\s*$/);
    const year = yearMatch ? yearMatch[1] : null;

    // Remove year from name if present
    if (year) {
      cleanName = cleanName.replace(/\s*\(\d{4}\)\s*$/, '').trim();
    }

    // Sanitize the clean name
    cleanName = sanitizeFilename(cleanName);

    return { cleanName, year, tmdbId, imdbId };
  }

  /**
   * Scan and fix a TV library folder
   * @param {string} libraryPath - Path to the TV library
   * @param {Object} options - Options
   * @returns {Promise<Object>} Results summary
   */
  async fixTvLibrary(libraryPath, options = {}) {
    const { dryRun = false, onProgress, onLog } = options;
    const results = {
      scanned: 0,
      renamed: 0,
      nfoCreated: 0,
      errors: [],
      changes: []
    };

    if (onLog) onLog(`Scanning TV library: ${libraryPath}`);

    try {
      const entries = await fs.readdir(libraryPath, { withFileTypes: true });
      const folders = entries.filter(e => e.isDirectory());
      const total = folders.length;

      for (let i = 0; i < folders.length; i++) {
        const folder = folders[i];
        results.scanned++;

        if (onProgress) {
          onProgress({ current: i + 1, total, percent: ((i + 1) / total) * 100 });
        }

        try {
          const folderPath = path.join(libraryPath, folder.name);
          const changesMade = await this.fixTvShowFolder(folderPath, {
            dryRun,
            onLog
          });

          if (changesMade.renamed) {
            results.renamed++;
            results.changes.push({
              type: 'rename',
              from: folder.name,
              to: changesMade.newName
            });
          }

          if (changesMade.nfoCreated) {
            results.nfoCreated++;
            results.changes.push({
              type: 'nfo',
              folder: changesMade.newName || folder.name
            });
          }
        } catch (err) {
          results.errors.push({ folder: folder.name, error: err.message });
          if (onLog) onLog(`Error processing ${folder.name}: ${err.message}`);
        }
      }
    } catch (err) {
      logger.error('library-fixer', `Failed to scan library: ${err.message}`);
      throw err;
    }

    if (onLog) {
      onLog(`TV Library fix complete:`);
      onLog(`  - Scanned: ${results.scanned} series`);
      onLog(`  - Renamed: ${results.renamed} series`);
      onLog(`  - NFO files created: ${results.nfoCreated}`);
      onLog(`  - Errors: ${results.errors.length}`);
    }

    return results;
  }

  /**
   * Fix a single TV show folder
   */
  async fixTvShowFolder(folderPath, options = {}) {
    const { dryRun = false, onLog } = options;
    const folderName = path.basename(folderPath);
    const changes = { renamed: false, nfoCreated: false, newName: null };

    // Check if folder needs renaming
    const needsRename = this.folderNeedsRename(folderName);

    if (needsRename) {
      const { cleanName, tmdbId, year } = this.parseOldFolderName(folderName);

      if (cleanName) {
        const newFolderName = year ? `${cleanName} (${year})` : cleanName;
        const newFolderPath = path.join(path.dirname(folderPath), newFolderName);

        if (onLog) onLog(`Renaming: "${folderName}" -> "${newFolderName}"`);

        if (!dryRun) {
          const targetExists = await fs.access(newFolderPath).then(() => true).catch(() => false);
          if (targetExists) {
            throw new Error(`Target folder already exists: ${newFolderName}`);
          }

          await fs.rename(folderPath, newFolderPath);
        }

        changes.renamed = true;
        changes.newName = newFolderName;
        changes.tmdbId = tmdbId;
        folderPath = newFolderPath;
      }
    }

    // Check for missing tvshow.nfo
    const currentFolderName = changes.newName || folderName;
    const nfoPath = path.join(dryRun && changes.renamed ? path.join(path.dirname(folderPath), changes.newName) : folderPath, 'tvshow.nfo');
    const hasNfo = await fs.access(nfoPath).then(() => true).catch(() => false);

    if (!hasNfo) {
      const { cleanName, tmdbId, year } = this.parseOldFolderName(currentFolderName);

      if (onLog) onLog(`Creating NFO for: ${currentFolderName}`);

      if (!dryRun) {
        let metadata = {
          title: cleanName || currentFolderName,
          year: year || ''
        };

        if (this.tmdbClient && tmdbId) {
          try {
            const tmdbData = await this.tmdbClient.getTVDetails(tmdbId);
            if (tmdbData) {
              metadata = {
                title: tmdbData.name,
                year: tmdbData.first_air_date?.split('-')[0] || year,
                tmdbId: tmdbData.id,
                overview: tmdbData.overview,
                firstAirDate: tmdbData.first_air_date,
                genres: tmdbData.genres,
                cast: tmdbData.credits?.cast,
                rating: tmdbData.vote_average,
                voteCount: tmdbData.vote_count,
                status: tmdbData.status,
                originalTitle: tmdbData.original_name,
                originalLanguage: tmdbData.original_language,
                networks: tmdbData.networks,
                productionCompanies: tmdbData.production_companies
              };
            }
          } catch (tmdbErr) {
            logger.warn('library-fixer', `TMDB lookup failed for ${currentFolderName}: ${tmdbErr.message}`);
          }
        }

        const actualFolderPath = changes.renamed
          ? path.join(path.dirname(folderPath), changes.newName || folderName)
          : folderPath;

        await writeTvShowNfo(actualFolderPath, metadata);
      }

      changes.nfoCreated = true;
    }

    return changes;
  }
}

export default LibraryFixer;
