// Windows Drive Detection - Fast alternative to MakeMKV scanning
// Uses fsutil + direct filesystem access for instant, reliable detection
// Then queries MakeMKV for disc index mapping (with caching to avoid blocking during backups)

import { execSync, execFileSync, exec } from 'child_process';
import { promisify } from 'util';
import { readdirSync, existsSync } from 'fs';
import logger from './logger.js';

const execAsync = promisify(exec);

export class DriveDetector {
  constructor() {
    this.makemkvPath = 'C:\\Program Files (x86)\\MakeMKV\\makemkvcon64.exe';
    this.lastError = null; // Track last error for debugging
    this.detectionErrors = []; // Collect errors during detection

    // DRIVE INDEPENDENCE: Cache MakeMKV mapping to avoid blocking during backups
    // Map: driveLetter -> { discIndex, discType, flags, cachedAt }
    this.mappingCache = new Map();
    this.cacheMaxAge = 5 * 60 * 1000; // 5 minutes cache validity

    // Callback to check if backups are running (injected by backup-manager)
    this.isBackupRunningCheck = null;
  }

  /**
   * Set the callback to check if backups are running
   * This allows DriveDetector to skip blocking MakeMKV calls during backups
   */
  setBackupRunningCheck(checkFn) {
    this.isBackupRunningCheck = checkFn;
  }

  /**
   * Seed the cache with known mapping (called when backup starts)
   * This ensures we have valid mapping data even during long backups
   */
  seedCache(driveLetter, discIndex, discType = 1) {
    this.mappingCache.set(driveLetter, {
      discIndex,
      discType,
      flags: 2, // 2 = disc present
      cachedAt: Date.now(),
      source: 'backup-start'
    });
    logger.info('drives', `Cache seeded for ${driveLetter} -> disc:${discIndex}`);
  }

  /**
   * Clear cache for a specific drive (called when backup completes or disc ejected)
   */
  clearCacheForDrive(driveLetter) {
    this.mappingCache.delete(driveLetter);
    logger.debug('drives', `Cache cleared for ${driveLetter}`);
  }

  /**
   * Check if we have a valid cached mapping for a drive
   */
  hasFreshCache(driveLetter) {
    const cached = this.mappingCache.get(driveLetter);
    if (!cached) return false;
    const age = Date.now() - cached.cachedAt;
    return age < this.cacheMaxAge;
  }

  /**
   * Check if any backups are currently running
   */
  hasActiveBackups() {
    if (this.isBackupRunningCheck) {
      return this.isBackupRunningCheck();
    }
    return false;
  }

  // Get MakeMKV disc index mapping (drive letter -> disc:N index)
  // Now ASYNC to prevent UI freezing + smart caching during backups
  async getMakeMKVMapping(forceRefresh = false) {
    const mapping = new Map();

    // DRIVE INDEPENDENCE: Skip MakeMKV call entirely if backups are running
    // This prevents the blocking call that freezes the UI
    if (!forceRefresh && this.hasActiveBackups()) {
      logger.info('drives', 'Backups running - using cached MakeMKV mapping (skipping MakeMKV call)');

      // Return cached mapping for all drives we know about
      for (const [driveLetter, cached] of this.mappingCache) {
        mapping.set(driveLetter, {
          discIndex: cached.discIndex,
          discType: cached.discType,
          flags: cached.flags,
          fromCache: true
        });
      }

      if (mapping.size === 0) {
        logger.warn('drives', 'No cached mapping available during backup - drives may show fallback indices');
      }

      return mapping;
    }

    // Check if MakeMKV exists
    if (!existsSync(this.makemkvPath)) {
      const error = `MakeMKV not found at: ${this.makemkvPath}`;
      logger.error('drives', error);
      this.detectionErrors.push({ stage: 'makemkv-check', error });
      return mapping;
    }

    try {
      const startTime = Date.now();
      logger.info('drives', 'Querying MakeMKV for disc mapping (async)...');

      // Query MakeMKV for drive list - use disc:9999 which quickly returns DRV lines
      // Using async exec to prevent blocking the main thread
      const { stdout: output } = await execAsync(`"${this.makemkvPath}" -r info disc:9999`, {
        encoding: 'utf8',
        timeout: 30000,
        windowsHide: true
      });

      const duration = Date.now() - startTime;
      logger.info('drives', `MakeMKV query completed in ${duration}ms`);

      // Parse DRV lines: DRV:index,flags,?,type,"description","discName","driveLetter"
      const lines = output.split('\n');
      let drvLinesFound = 0;

      for (const line of lines) {
        if (line.startsWith('DRV:')) {
          drvLinesFound++;
          const match = line.match(/^DRV:(\d+),(\d+),\d+,(\d+),"[^"]*","[^"]*","([A-Z]:)?"/);
          if (match) {
            const discIndex = parseInt(match[1], 10);
            const flags = parseInt(match[2], 10);
            const discType = parseInt(match[3], 10);
            const driveLetter = match[4] || '';

            // flags=2 means disc present, flags=256 means empty drive
            if (flags === 2 && driveLetter) {
              const mappingData = { discIndex, discType, flags };
              mapping.set(driveLetter, mappingData);

              // Update cache with fresh data
              this.mappingCache.set(driveLetter, {
                ...mappingData,
                cachedAt: Date.now(),
                source: 'makemkv-query'
              });

              logger.info('drives', `MakeMKV mapping: ${driveLetter} -> disc:${discIndex}`, { type: discType, flags });
            } else if (flags !== 256 && driveLetter) {
              // Log unexpected flag values for debugging
              logger.warn('drives', `Drive ${driveLetter} has unexpected flags: ${flags}`, { discIndex, discType });
            }
          } else {
            logger.debug('drives', `Could not parse DRV line: ${line}`);
          }
        } else if (line.startsWith('MSG:') && (line.includes('error') || line.includes('fail'))) {
          // Capture error messages from MakeMKV
          logger.warn('drives', `MakeMKV message: ${line}`);
        }
      }

      logger.info('drives', `MakeMKV returned ${drvLinesFound} DRV lines, ${mapping.size} with discs`);

    } catch (error) {
      const errorInfo = {
        stage: 'makemkv-mapping',
        error: error.message,
        code: error.code,
        signal: error.signal,
      };
      this.detectionErrors.push(errorInfo);
      logger.error('drives', 'MakeMKV mapping failed', error);

      // On error, return cached data if available
      if (this.mappingCache.size > 0) {
        logger.info('drives', 'Using cached mapping due to MakeMKV error');
        for (const [driveLetter, cached] of this.mappingCache) {
          mapping.set(driveLetter, {
            discIndex: cached.discIndex,
            discType: cached.discType,
            flags: cached.flags,
            fromCache: true
          });
        }
      }
    }

    return mapping;
  }

  // Detect optical drives with media (instant!)
  async detectDrives() {
    logger.info('drives', 'Starting fast drive detection...');
    this.detectionErrors = []; // Clear previous errors

    const backupsRunning = this.hasActiveBackups();
    if (backupsRunning) {
      logger.info('drives', 'Active backups detected - will use cached MakeMKV mapping');
    }

    try {
      // Get all drive letters using fsutil
      const drivesOutput = execFileSync('fsutil', ['fsinfo', 'drives'], {
        encoding: 'utf8',
        timeout: 5000,
        windowsHide: true
      });

      // Parse drive letters (format: "Drives: C:\ D:\ E:\")
      const driveLetters = drivesOutput
        .replace('Drives:', '')
        .trim()
        .split(/\s+/)
        .map(d => d.replace('\\', ''))
        .filter(d => d.match(/^[A-Z]:$/));

      logger.debug('drives', `System drive letters: ${driveLetters.join(', ')}`);

      // Check each drive for CD-ROM type
      const cdromDrives = [];
      for (const driveLetter of driveLetters) {
        try {
          const typeOutput = execFileSync('fsutil', ['fsinfo', 'drivetype', driveLetter], {
            encoding: 'utf8',
            timeout: 2000,
            windowsHide: true
          });

          if (typeOutput.includes('CD-ROM')) {
            cdromDrives.push(driveLetter);
          }
        } catch (err) {
          logger.debug('drives', `Could not check drive type for ${driveLetter}: ${err.message}`);
        }
      }

      logger.info('drives', `Found ${cdromDrives.length} CD-ROM drives: ${cdromDrives.join(', ')}`);

      // Check which CD-ROM drives have media using direct filesystem access
      const drivesWithMedia = [];
      for (const driveLetter of cdromDrives) {
        try {
          // Try to read the root directory - this works for optical discs!
          readdirSync(driveLetter + '/');

          // If we get here, the drive has readable media
          // Get volume label using vol command (fresh query each time)
          let volumeName = 'Unknown Disc';
          try {
            const volOutput = execFileSync('cmd', ['/c', 'vol', driveLetter], {
              encoding: 'utf8',
              timeout: 3000,
              windowsHide: true
            });
            const match = volOutput.match(/Volume in drive .+ is (.+)/);
            if (match?.[1]) {
              volumeName = match[1].trim();
            }
            logger.debug('drives', `Volume name for ${driveLetter}: "${volumeName}" (raw: ${volOutput.trim()})`);
          } catch (volErr) {
            logger.warn('drives', `Could not get volume label for ${driveLetter}: ${volErr.message}`);
          }

          drivesWithMedia.push({
            driveLetter,
            volumeName,
          });
          logger.info('drives', `${driveLetter} has media: "${volumeName}"`);
        } catch (err) {
          // readdirSync fails = no media or unreadable disc
          const reason = err.code === 'ENOENT' ? 'no disc' :
                         err.code === 'EBUSY' ? 'drive busy' :
                         err.code === 'EACCES' ? 'access denied' :
                         err.code || 'unknown error';
          logger.debug('drives', `${driveLetter} - ${reason}`);
        }
      }

      if (drivesWithMedia.length > 0) {
        logger.info('drives', `Drives with media: ${drivesWithMedia.map(d => `${d.driveLetter}(${d.volumeName})`).join(', ')}`);
      }

      // INSTANT SCAN: Skip MakeMKV query entirely - use cache or detect disc type from filesystem
      // MakeMKV query will happen in background or when backup starts
      // This makes scan return instantly instead of taking minutes

      // Build drive objects with disc sizes - use cache if available, otherwise detect type
      const drives = [];
      for (let i = 0; i < drivesWithMedia.length; i++) {
        const drive = drivesWithMedia[i];
        const discSize = this.getDiscSizeSync(drive.driveLetter);

        // Check cache first
        const cached = this.mappingCache.get(drive.driveLetter);
        const hasCachedMapping = cached && (Date.now() - cached.cachedAt < this.cacheMaxAge);

        let makemkvIndex = i;  // Fallback to position-based index
        let discType = 1;      // Default to DVD
        let hasMkvMapping = false;
        let fromCache = false;

        if (hasCachedMapping) {
          // Use cached MakeMKV mapping
          makemkvIndex = cached.discIndex;
          discType = cached.discType;
          hasMkvMapping = true;
          fromCache = true;
          logger.info('drives', `${drive.driveLetter}: Using cached mapping disc:${makemkvIndex}`);
        } else {
          // Detect disc type from filesystem (instant!)
          // Blu-ray discs have BDMV folder, DVDs have VIDEO_TS
          try {
            const hasBDMV = existsSync(`${drive.driveLetter}/BDMV`);
            const hasVideoTS = existsSync(`${drive.driveLetter}/VIDEO_TS`);
            if (hasBDMV) {
              discType = 12;  // Blu-ray
              logger.info('drives', `${drive.driveLetter}: Detected Blu-ray (BDMV folder)`);
            } else if (hasVideoTS) {
              discType = 1;   // DVD
              logger.info('drives', `${drive.driveLetter}: Detected DVD (VIDEO_TS folder)`);
            }
          } catch (e) {
            logger.debug('drives', `${drive.driveLetter}: Could not detect disc type: ${e.message}`);
          }
        }

        const isBluray = discType === 12;

        drives.push({
          id: i,
          driveLetter: drive.driveLetter,
          discName: drive.volumeName,
          description: `Optical Drive (${drive.driveLetter})`,
          hasDisc: true,
          isBluray: isBluray,
          isDVD: !isBluray,
          discType: discType,
          discSize: discSize,
          makemkvIndex: makemkvIndex,
          hasMkvMapping: hasMkvMapping,
          mappingFromCache: fromCache,
          needsMkvQuery: !hasMkvMapping,  // Flag: needs MakeMKV query before backup
          warning: hasMkvMapping ? null : 'Will query MakeMKV when backup starts',
        });

        logger.info('drives', `${drive.driveLetter} -> disc:${makemkvIndex}`, {
          size: discSize,
          type: isBluray ? 'Blu-ray' : 'DVD',
          hasMkvMapping,
          fromCache,
          needsMkvQuery: !hasMkvMapping
        });
      }

      logger.info('drives', `Detection complete: ${drives.length} drive(s) with media`);

      // Log any accumulated errors
      if (this.detectionErrors.length > 0) {
        logger.warn('drives', `Detection completed with ${this.detectionErrors.length} warnings/errors`, this.detectionErrors);
      }

      return drives;

    } catch (error) {
      logger.error('drives', 'Detection failed', error);
      this.lastError = error.message;
      this.detectionErrors.push({
        stage: 'detection',
        error: error.message,
        stack: error.stack
      });
      return [];
    }
  }

  // Get last detection errors (for troubleshooting)
  getDetectionErrors() {
    return this.detectionErrors;
  }

  // Get disc size synchronously using fsutil (for detection)
  getDiscSizeSync(driveLetter) {
    const drive = driveLetter.replace(/[:\\\/]+$/, '');

    try {
      const volInfo = execFileSync('fsutil', ['volume', 'diskfree', `${drive}:`], {
        encoding: 'utf8',
        timeout: 5000,
        windowsHide: true
      });

      // Parse "Total bytes" line (format: "Total bytes             : 7,964,262,400 (7.4 GB)")
      const match = volInfo.match(/Total bytes\s*:\s*([\d,]+)/);
      if (match) {
        return parseInt(match[1].replace(/,/g, ''), 10);
      }
      return 0;
    } catch (error) {
      console.error(`[drives] Failed to get size for ${driveLetter}:`, error.message);
      return 0;
    }
  }

  // Async version for external callers
  async getDiscSize(driveLetter) {
    return this.getDiscSizeSync(driveLetter);
  }

  // Scan a single drive independently (for per-drive refresh button)
  // This performs a full rescan of just one drive without blocking others
  async scanSingleDrive(driveLetter) {
    // Validate drive letter
    const match = driveLetter.match(/^([A-Za-z]):?\\?$/);
    if (!match) {
      return { success: false, error: 'Invalid drive letter format' };
    }
    const normalizedLetter = `${match[1].toUpperCase()}:`;
    logger.info('drives', `Scanning single drive: ${normalizedLetter}`);

    try {
      // Check if drive has readable media
      let hasMedia = false;
      let volumeName = 'Unknown Disc';

      try {
        readdirSync(normalizedLetter + '/');
        hasMedia = true;

        // Get volume label
        try {
          const volOutput = execFileSync('cmd', ['/c', 'vol', normalizedLetter], {
            encoding: 'utf8',
            timeout: 3000,
            windowsHide: true
          });
          const volMatch = volOutput.match(/Volume in drive .+ is (.+)/);
          if (volMatch?.[1]) {
            volumeName = volMatch[1].trim();
          }
        } catch (volErr) {
          logger.warn('drives', `Could not get volume label for ${normalizedLetter}: ${volErr.message}`);
        }
      } catch (readErr) {
        // No media or unreadable
        logger.info('drives', `${normalizedLetter} has no readable media`);
        return { success: true, hasDisc: false, driveLetter: normalizedLetter };
      }

      // Get disc size
      const discSize = this.getDiscSizeSync(normalizedLetter);

      // Get MakeMKV mapping - use cache if backup running, otherwise query fresh
      let makemkvIndex = 0;
      let discType = 1;
      let hasMkvMapping = false;
      let mappingFromCache = false;

      // Check cache first
      if (this.hasFreshCache(normalizedLetter)) {
        const cached = this.mappingCache.get(normalizedLetter);
        makemkvIndex = cached.discIndex;
        discType = cached.discType;
        hasMkvMapping = true;
        mappingFromCache = true;
        logger.info('drives', `Using cached mapping for ${normalizedLetter}: disc:${makemkvIndex}`);
      } else if (!this.hasActiveBackups()) {
        // No active backups - query MakeMKV for fresh mapping
        const mapping = await this.getMakeMKVMapping(true); // force refresh
        const mkvData = mapping.get(normalizedLetter);
        if (mkvData) {
          makemkvIndex = mkvData.discIndex;
          discType = mkvData.discType;
          hasMkvMapping = true;
        }
      } else {
        // Backups running and no cache - use fallback
        logger.warn('drives', `No cached mapping for ${normalizedLetter} during backup - using fallback`);
      }

      const isBluray = discType === 12;
      const driveInfo = {
        success: true,
        hasDisc: true,
        driveLetter: normalizedLetter,
        discName: volumeName,
        description: `Optical Drive (${normalizedLetter})`,
        isBluray,
        isDVD: !isBluray,
        discType,
        discSize,
        makemkvIndex,
        hasMkvMapping,
        mappingFromCache
      };

      logger.info('drives', `Single drive scan complete: ${normalizedLetter}`, driveInfo);
      return driveInfo;

    } catch (error) {
      logger.error('drives', `Single drive scan failed for ${normalizedLetter}`, error);
      return { success: false, error: error.message };
    }
  }

  // Eject a disc from the specified drive
  async ejectDrive(driveLetter) {
    // Security: Strict validation - only allow single letters A-Z
    const match = driveLetter.match(/^([A-Za-z]):?\\?$/);
    if (!match) {
      return { success: false, error: 'Invalid drive letter format', driveLetter };
    }
    const drive = match[1].toUpperCase();

    // Clear cache for this drive since disc is being ejected
    this.clearCacheForDrive(`${drive}:`);

    try {
      logger.info('drives', `Ejecting drive ${drive}:`);

      // Use PowerShell to eject the drive via Shell.Application COM object
      // Using execFileSync with -Command passed as argument array for safety
      const { execFileSync } = require('child_process');
      const psCommand = `(New-Object -comObject Shell.Application).NameSpace(17).ParseName("${drive}:").InvokeVerb("Eject")`;
      execFileSync('powershell', ['-Command', psCommand], {
        encoding: 'utf8',
        timeout: 10000,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      logger.info('drives', `Successfully ejected ${drive}:`);
      return { success: true, driveLetter: `${drive}:` };
    } catch (error) {
      logger.error('drives', `Failed to eject ${drive}:`, error);
      return { success: false, error: error.message, driveLetter: `${drive}:` };
    }
  }
}
