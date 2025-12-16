// Windows Drive Detection - Fast alternative to MakeMKV scanning
// Uses fsutil + direct filesystem access for instant, reliable detection
// Then queries MakeMKV for disc index mapping

import { execSync, execFileSync } from 'child_process';
import { readdirSync, existsSync } from 'fs';
import logger from './logger.js';

export class DriveDetector {
  constructor() {
    this.makemkvPath = 'C:\\Program Files (x86)\\MakeMKV\\makemkvcon64.exe';
    this.lastError = null; // Track last error for debugging
    this.detectionErrors = []; // Collect errors during detection
  }

  // Get MakeMKV disc index mapping (drive letter -> disc:N index)
  getMakeMKVMapping() {
    const mapping = new Map();

    // Check if MakeMKV exists
    if (!existsSync(this.makemkvPath)) {
      const error = `MakeMKV not found at: ${this.makemkvPath}`;
      logger.error('drives', error);
      this.detectionErrors.push({ stage: 'makemkv-check', error });
      return mapping;
    }

    try {
      logger.debug('drives', 'Querying MakeMKV for disc mapping...');

      // Query MakeMKV for drive list - use disc:9999 which quickly returns DRV lines
      // Increased timeout to 60s for systems with multiple optical drives
      const output = execSync(`"${this.makemkvPath}" -r info disc:9999`, {
        encoding: 'utf8',
        timeout: 60000,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      });

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
              mapping.set(driveLetter, { discIndex, discType, flags });
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
    }

    return mapping;
  }

  // Detect optical drives with media (instant!)
  async detectDrives() {
    logger.info('drives', 'Starting fast drive detection...');
    this.detectionErrors = []; // Clear previous errors

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

      // Get MakeMKV disc index mapping
      const makemkvMapping = this.getMakeMKVMapping();

      // Build drive objects with disc sizes and MakeMKV indices
      const drives = [];
      for (let i = 0; i < drivesWithMedia.length; i++) {
        const drive = drivesWithMedia[i];
        const discSize = this.getDiscSizeSync(drive.driveLetter);
        const mkv = makemkvMapping.get(drive.driveLetter);

        // Track if MakeMKV mapping was found
        const hasMkvMapping = !!mkv;
        const mkvData = mkv || { discIndex: i, discType: 1 };

        // discType: 1=DVD, 12=Blu-ray
        const isBluray = mkvData.discType === 12;

        // Detect potential issues
        let warning = null;
        if (!hasMkvMapping) {
          warning = 'MakeMKV mapping not found - using fallback index';
          logger.warn('drives', `${drive.driveLetter}: ${warning}`);
          this.detectionErrors.push({
            stage: 'mapping',
            drive: drive.driveLetter,
            error: warning
          });
        }

        drives.push({
          id: i,
          driveLetter: drive.driveLetter,
          discName: drive.volumeName,
          description: `Optical Drive (${drive.driveLetter})`,
          hasDisc: true,
          isBluray: isBluray,
          isDVD: !isBluray,
          discType: mkvData.discType,
          discSize: discSize,
          makemkvIndex: mkvData.discIndex,  // MakeMKV disc:N index
          hasMkvMapping: hasMkvMapping,
          warning: warning,
        });

        logger.info('drives', `${drive.driveLetter} -> disc:${mkvData.discIndex}`, {
          size: discSize,
          type: isBluray ? 'Blu-ray' : 'DVD',
          hasMkvMapping
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

  // Eject a disc from the specified drive
  async ejectDrive(driveLetter) {
    // Security: Strict validation - only allow single letters A-Z
    const match = driveLetter.match(/^([A-Za-z]):?\\?$/);
    if (!match) {
      return { success: false, error: 'Invalid drive letter format', driveLetter };
    }
    const drive = match[1].toUpperCase();

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
