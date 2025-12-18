// Emby Export Module - Remux disc backups to MKV for Emby
// Handles title scanning, MKV remuxing, and Emby-compatible naming
//
// IMPORTANT: This is a LOSSLESS operation!
// - Original backup is NEVER modified (read-only)
// - MakeMKV remuxes streams into MKV container (no re-encoding)
// - Video/audio quality is identical to source

import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import logger from './logger.js';
import { MediaType } from './metadata/schemas.js';
import {
  writeMovieNfo,
  sanitizeFilename
} from './nfo.js';

// MakeMKV TINFO attribute codes (from apdefs.h)
const TINFO_CODES = {
  NAME: 2,
  CHAPTER_COUNT: 8,
  DURATION: 9,
  SIZE_DISPLAY: 10,
  SIZE_BYTES: 11,
  OUTPUT_FILENAME: 27
};

/**
 * Emby Export class for converting backups to MKV
 */
export class EmbyExporter {
  constructor(makemkvPath) {
    this.makemkvPath = makemkvPath;
    this.currentProcess = null;
  }

  /**
   * Scan a backup folder to get available titles
   * @param {string} backupPath - Path to backup folder (contains VIDEO_TS or BDMV)
   * @returns {Promise<{titles: Array, discType: string}>}
   */
  async scanTitles(backupPath) {
    // Determine if DVD or Blu-ray and get the correct scan path
    const scanPath = await this.getScanPath(backupPath);
    if (!scanPath) {
      throw new Error(`No VIDEO_TS or BDMV found in: ${backupPath}`);
    }

    logger.info('emby', `Scanning titles in: ${scanPath.path} (${scanPath.type})`);

    return new Promise((resolve, reject) => {
      const args = ['info', '-r', `file:${scanPath.path}`];
      logger.debug('emby', `Running: makemkvcon ${args.join(' ')}`);

      const process = spawn(this.makemkvPath, args, { windowsHide: true });
      const titles = new Map();
      let discName = '';

      process.stdout.on('data', (data) => {
        const lines = data.toString().split('\n');

        for (const line of lines) {
          if (!line.trim()) continue;

          if (line.startsWith('CINFO:')) {
            // Disc info - get disc name from code 2
            const match = line.match(/CINFO:(\d+),\d+,"([^"]*)"/);
            if (match && parseInt(match[1]) === TINFO_CODES.NAME) {
              discName = match[2];
            }
          } else if (line.startsWith('TINFO:')) {
            // Title info: TINFO:titleIndex,attrId,code,"value"
            const match = line.match(/TINFO:(\d+),(\d+),\d+,"([^"]*)"/);
            if (match) {
              const titleIndex = parseInt(match[1]);
              const attrId = parseInt(match[2]);
              const value = match[3];

              if (!titles.has(titleIndex)) {
                titles.set(titleIndex, {
                  index: titleIndex,
                  name: '',
                  duration: 0,
                  durationDisplay: '',
                  size: 0,
                  sizeDisplay: '',
                  chapters: 0,
                  outputFilename: ''
                });
              }

              const title = titles.get(titleIndex);
              switch (attrId) {
                case TINFO_CODES.NAME:
                  title.name = value;
                  break;
                case TINFO_CODES.DURATION:
                  title.durationDisplay = value;
                  title.duration = this.parseDuration(value);
                  break;
                case TINFO_CODES.SIZE_DISPLAY:
                  title.sizeDisplay = value;
                  break;
                case TINFO_CODES.SIZE_BYTES:
                  title.size = parseInt(value) || 0;
                  break;
                case TINFO_CODES.CHAPTER_COUNT:
                  title.chapters = parseInt(value) || 0;
                  break;
                case TINFO_CODES.OUTPUT_FILENAME:
                  title.outputFilename = value;
                  break;
              }
            }
          }
        }
      });

      process.stderr.on('data', (data) => {
        logger.debug('emby-stderr', data.toString());
      });

      process.on('close', (code) => {
        if (code === 0) {
          // Convert map to sorted array
          const titleArray = Array.from(titles.values())
            .sort((a, b) => a.index - b.index);

          // Identify main feature (longest title with chapters)
          let mainFeatureIndex = -1;
          let maxDuration = 0;
          for (const title of titleArray) {
            if (title.duration > maxDuration && title.chapters > 0) {
              maxDuration = title.duration;
              mainFeatureIndex = title.index;
            }
          }

          // Mark main feature
          for (const title of titleArray) {
            title.isMainFeature = title.index === mainFeatureIndex;
          }

          logger.info('emby', `Found ${titleArray.length} titles, main feature: ${mainFeatureIndex}`);
          resolve({
            titles: titleArray,
            discType: scanPath.type,
            discName,
            mainFeatureIndex
          });
        } else {
          reject(new Error(`MakeMKV scan failed with code ${code}`));
        }
      });

      process.on('error', (err) => {
        reject(new Error(`Failed to run MakeMKV: ${err.message}`));
      });
    });
  }

  /**
   * Get the correct path to scan (VIDEO_TS or parent of BDMV)
   */
  async getScanPath(backupPath) {
    const videoTsPath = path.join(backupPath, 'VIDEO_TS');
    const bdmvPath = path.join(backupPath, 'BDMV');

    const hasVideoTs = await fs.access(videoTsPath).then(() => true).catch(() => false);
    const hasBdmv = await fs.access(bdmvPath).then(() => true).catch(() => false);

    if (hasVideoTs) {
      return { path: videoTsPath, type: 'dvd' };
    } else if (hasBdmv) {
      // For Blu-ray, MakeMKV wants the parent folder (not BDMV itself)
      return { path: backupPath, type: 'bluray' };
    }
    return null;
  }

  /**
   * Remux a title to MKV (LOSSLESS - no re-encoding)
   *
   * This is a remux operation: streams are extracted and placed into
   * an MKV container without any transcoding. Quality is identical to source.
   * Original backup files are read-only and never modified.
   *
   * @param {string} backupPath - Path to backup folder (read-only)
   * @param {number} titleIndex - Title index to remux
   * @param {string} outputPath - Path for output MKV file
   * @param {Function} onProgress - Progress callback
   * @param {Function} onLog - Log callback
   */
  async convertToMkv(backupPath, titleIndex, outputPath, onProgress, onLog) {
    const scanPath = await this.getScanPath(backupPath);
    if (!scanPath) {
      throw new Error(`No VIDEO_TS or BDMV found in: ${backupPath}`);
    }

    // Ensure output directory exists
    const outputDir = path.dirname(outputPath);
    await fs.mkdir(outputDir, { recursive: true });

    // MakeMKV outputs to a folder, so we use outputDir and rename after
    const tempOutputDir = path.join(outputDir, '_temp_mkv');
    await fs.mkdir(tempOutputDir, { recursive: true });

    logger.info('emby', `Remuxing title ${titleIndex} from ${scanPath.path} to ${outputPath} (lossless)`);
    if (onLog) onLog(`Remuxing title ${titleIndex} to MKV (lossless, no re-encoding)...`);

    return new Promise((resolve, reject) => {
      // makemkvcon mkv file:"path" titleIndex "outputDir"
      const args = [
        'mkv',
        '-r',
        '--progress=-same',
        `file:${scanPath.path}`,
        String(titleIndex),
        tempOutputDir
      ];

      if (onLog) onLog(`Running: makemkvcon ${args.join(' ')}`);
      this.currentProcess = spawn(this.makemkvPath, args, { windowsHide: true });

      let lastProgress = 0;

      this.currentProcess.stdout.on('data', (data) => {
        const lines = data.toString().split('\n');

        for (const line of lines) {
          if (!line.trim()) continue;

          if (line.startsWith('PRGV:')) {
            // Progress: PRGV:current,total,max
            const parts = line.substring(5).split(',');
            const total = parseInt(parts[1]) || 0;
            const max = parseInt(parts[2]) || 65536;
            const percent = (total / max) * 100;

            if (percent > lastProgress + 1) {
              lastProgress = percent;
              if (onProgress) onProgress({ percent });
            }
          } else if (line.startsWith('MSG:')) {
            const match = line.match(/MSG:\d+,\d+,\d+,"([^"]+)"/);
            if (match) {
              const message = match[1];
              logger.debug('emby-msg', message);
              if (onLog && !message.includes('hash table')) {
                onLog(message);
              }
            }
          }
        }
      });

      this.currentProcess.stderr.on('data', (data) => {
        logger.error('emby-stderr', data.toString());
      });

      this.currentProcess.on('close', async (code) => {
        this.currentProcess = null;

        if (code === 0) {
          try {
            // Longer delay to let Windows release file handles (MakeMKV holds locks briefly)
            logger.debug('emby', 'MakeMKV finished, waiting for file handles to release...');
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Find the generated MKV file
            const files = await fs.readdir(tempOutputDir);
            const mkvFile = files.find(f => f.endsWith('.mkv'));

            if (!mkvFile) {
              throw new Error('No MKV file generated');
            }

            // Move to final destination with correct name (retry on EBUSY/EPERM)
            const tempMkvPath = path.join(tempOutputDir, mkvFile);
            let renameAttempts = 0;
            const maxAttempts = 5;
            while (renameAttempts < maxAttempts) {
              try {
                await fs.rename(tempMkvPath, outputPath);
                logger.debug('emby', `Renamed MKV successfully after ${renameAttempts} retries`);
                break;
              } catch (renameErr) {
                renameAttempts++;
                // Check for both EBUSY and EPERM (Windows can use either for locked files)
                const isLockError = renameErr.code === 'EBUSY' || renameErr.code === 'EPERM' ||
                                    renameErr.message?.includes('EBUSY') || renameErr.message?.includes('busy');
                logger.warn('emby', `Rename attempt ${renameAttempts}/${maxAttempts} failed: ${renameErr.code} - ${renameErr.message}`);
                if (isLockError && renameAttempts < maxAttempts) {
                  logger.info('emby', `File appears locked, waiting ${renameAttempts * 2}s before retry...`);
                  await new Promise(resolve => setTimeout(resolve, 2000 * renameAttempts));
                } else {
                  throw renameErr;
                }
              }
            }

            // Clean up temp dir (retry on EBUSY/EPERM)
            let rmAttempts = 0;
            while (rmAttempts < maxAttempts) {
              try {
                await fs.rm(tempOutputDir, { recursive: true, force: true });
                logger.debug('emby', 'Temp directory cleaned up successfully');
                break;
              } catch (rmErr) {
                rmAttempts++;
                const isLockError = rmErr.code === 'EBUSY' || rmErr.code === 'EPERM' ||
                                    rmErr.message?.includes('EBUSY') || rmErr.message?.includes('busy');
                if (isLockError && rmAttempts < maxAttempts) {
                  logger.warn('emby', `Cleanup attempt ${rmAttempts}/${maxAttempts} blocked, retrying in ${rmAttempts * 2}s...`);
                  await new Promise(resolve => setTimeout(resolve, 2000 * rmAttempts));
                } else {
                  // Log but don't fail on cleanup errors
                  logger.warn('emby', `Could not clean temp dir after ${rmAttempts} attempts: ${rmErr.message}`);
                  break;
                }
              }
            }

            const stat = await fs.stat(outputPath);
            if (onLog) onLog(`MKV created: ${outputPath} (${this.formatSize(stat.size)})`);
            if (onProgress) onProgress({ percent: 100 });

            resolve({ path: outputPath, size: stat.size });
          } catch (err) {
            // Clean up on error
            await fs.rm(tempOutputDir, { recursive: true, force: true }).catch(() => {});
            reject(new Error(`Failed to finalize MKV: ${err.message}`));
          }
        } else {
          // Clean up on failure
          await fs.rm(tempOutputDir, { recursive: true, force: true }).catch(() => {});
          reject(new Error(`MKV conversion failed with code ${code}`));
        }
      });

      this.currentProcess.on('error', async (err) => {
        this.currentProcess = null;
        await fs.rm(tempOutputDir, { recursive: true, force: true }).catch(() => {});
        reject(new Error(`Failed to run MakeMKV: ${err.message}`));
      });
    });
  }

  /**
   * Export a backup to Emby library with proper naming and NFO metadata
   * @param {Object} options - Export options
   * @param {string} options.backupPath - Path to backup folder
   * @param {number} options.titleIndex - Title index to export
   * @param {Object} options.metadata - Metadata with final title/year/tmdbId and TMDB details
   * @param {string} options.embyLibraryPath - Emby library base path
   * @param {string} options.mediaType - 'movie' or 'tv'
   * @param {Object} options.tvInfo - For TV: { season, episode, episodeTitle } numbers
   * @param {Function} onProgress - Progress callback
   * @param {Function} onLog - Log callback
   */
  async exportToEmby(options, onProgress, onLog) {
    const {
      backupPath,
      titleIndex,
      metadata,
      embyLibraryPath,
      mediaType = MediaType.MOVIE,
      tvInfo
    } = options;

    // Generate Emby-compatible path and filename
    const { folderPath, fileName, seriesFolderPath } = this.generateEmbyPath({
      title: metadata.final?.title || metadata.disc?.volumeLabel || 'Unknown',
      year: metadata.final?.year || null,
      mediaType,
      tvInfo,
      embyLibraryPath
    });

    const outputPath = path.join(folderPath, fileName);

    if (onLog) onLog(`Exporting to Emby: ${outputPath}`);

    // Convert to MKV
    const result = await this.convertToMkv(
      backupPath,
      titleIndex,
      outputPath,
      onProgress,
      onLog
    );

    // Generate NFO file for Emby identification (movies only - TV NFOs cause Emby detection issues)
    if (mediaType !== MediaType.TV) {
      try {
        if (onLog) onLog('Generating NFO metadata file...');

        // For movies: create movie.nfo in the movie folder
        await writeMovieNfo(folderPath, {
          title: metadata.final?.title || metadata.tmdb?.title || 'Unknown',
          year: metadata.final?.year || '',
          tmdbId: metadata.tmdb?.id || '',
          imdbId: metadata.tmdb?.imdb_id || metadata.tmdb?.external_ids?.imdb_id || '',
          overview: metadata.tmdb?.overview || '',
          releaseDate: metadata.tmdb?.release_date || '',
          runtime: metadata.tmdb?.runtime || '',
          genres: metadata.tmdb?.genres || [],
          cast: metadata.tmdb?.credits?.cast || [],
          crew: metadata.tmdb?.credits?.crew || [],
          rating: metadata.tmdb?.vote_average || '',
          voteCount: metadata.tmdb?.vote_count || '',
          tagline: metadata.tmdb?.tagline || '',
          originalTitle: metadata.tmdb?.original_title || '',
          originalLanguage: metadata.tmdb?.original_language || '',
          productionCompanies: metadata.tmdb?.production_companies || ''
        });
        if (onLog) onLog('Created movie.nfo');
      } catch (nfoErr) {
        logger.error('emby', `Failed to create NFO: ${nfoErr.message}`);
        if (onLog) onLog(`Warning: Could not create NFO file: ${nfoErr.message}`);
        // Don't fail the export if NFO creation fails
      }
    }

    logger.info('emby', `Export complete: ${outputPath}`);
    return {
      ...result,
      embyPath: outputPath,
      folderPath,
      fileName,
      seriesFolderPath
    };
  }

  /**
   * Generate Emby-compatible folder path and filename
   * Follows Emby naming best practices:
   * - Movies: "Title (Year)/Title (Year).mkv" with movie.nfo
   * - TV: "Series (Year)/Season XX/Series - SXXEXX - Episode Title.mkv" with tvshow.nfo
   */
  generateEmbyPath({ title, year, mediaType, tvInfo, embyLibraryPath }) {
    // Sanitize title for filesystem (handles colons, etc.)
    const safeTitle = sanitizeFilename(title);

    // Build folder name: "Title (Year)"
    let folderName = safeTitle;
    if (year) {
      folderName += ` (${year})`;
    }

    let fileName;
    let folderPath;
    let seriesFolderPath;

    if (mediaType === MediaType.TV && tvInfo) {
      // TV Show: Series (Year)/Season XX/Series - SXXEXX - Episode Title.mkv
      const seasonNum = String(tvInfo.season || 1).padStart(2, '0');
      const episodeNum = String(tvInfo.episode || 1).padStart(2, '0');
      const episodeCode = `S${seasonNum}E${episodeNum}`;

      seriesFolderPath = path.join(embyLibraryPath, folderName);
      folderPath = path.join(seriesFolderPath, `Season ${seasonNum}`);

      // Include episode title if available for better identification
      if (tvInfo.episodeTitle) {
        const safeEpisodeTitle = sanitizeFilename(tvInfo.episodeTitle);
        fileName = `${safeTitle} - ${episodeCode} - ${safeEpisodeTitle}.mkv`;
      } else {
        fileName = `${safeTitle} - ${episodeCode}.mkv`;
      }
    } else {
      // Movie: Title (Year)/Title (Year).mkv
      // NFO file handles TMDB identification, no need for [tmdbid=xxx] in folder name
      folderPath = path.join(embyLibraryPath, folderName);
      seriesFolderPath = folderPath; // For consistency
      fileName = `${folderName}.mkv`;
    }

    return { folderPath, fileName, seriesFolderPath };
  }

  /**
   * Cancel current export
   */
  cancel() {
    if (this.currentProcess) {
      logger.info('emby', 'Cancelling export');
      this.currentProcess.kill('SIGTERM');
      this.currentProcess = null;
    }
  }

  /**
   * Parse duration string (h:mm:ss) to seconds
   */
  parseDuration(durationStr) {
    if (!durationStr) return 0;

    const parts = durationStr.split(':').map(p => parseInt(p) || 0);
    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    } else if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    }
    return parseInt(durationStr) || 0;
  }


  /**
   * Format bytes to human readable
   */
  formatSize(bytes) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    while (bytes >= 1024 && i < units.length - 1) {
      bytes /= 1024;
      i++;
    }
    return `${bytes.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
  }
}

export default EmbyExporter;
