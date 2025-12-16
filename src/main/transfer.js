// Transfer Module - Multi-protocol file transfer for Emby exports
// Supports: SCP, SFTP, FTP, UNC/SMB, Local file copy
//
// NOTE: This module requires optional dependencies:
// - SCP/SFTP: npm install ssh2-sftp-client
// - FTP: npm install basic-ftp

import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import logger from './logger.js';

// Security: Validate private key path to prevent arbitrary file reading
function validatePrivateKeyPath(keyPath) {
  if (!keyPath || typeof keyPath !== 'string') {
    throw new Error('Invalid private key path');
  }
  const resolvedPath = path.resolve(keyPath);
  const homeDir = os.homedir();
  const sshDir = path.join(homeDir, '.ssh');

  // Only allow private keys within user's home directory
  if (!resolvedPath.startsWith(homeDir)) {
    throw new Error('Private key must be in user home directory');
  }

  // Warn if not in .ssh folder (but still allow for flexibility)
  if (!resolvedPath.startsWith(sshDir)) {
    logger.warn('transfer', `Private key not in .ssh directory: ${resolvedPath}`);
  }

  return resolvedPath;
}

// Transfer protocol types
export const TransferProtocol = {
  LOCAL: 'local',     // Local file system copy
  UNC: 'unc',         // Windows UNC paths (\\server\share)
  SCP: 'scp',         // SSH Copy Protocol
  SFTP: 'sftp',       // SSH File Transfer Protocol
  FTP: 'ftp',         // FTP (with optional TLS/FTPS)
};

/**
 * Transfer Manager - handles file transfers to various destinations
 */
export class TransferManager {
  constructor() {
    this.sftpClient = null;
    this.ftpClient = null;
  }

  /**
   * Transfer a file using configured protocol
   * @param {string} sourcePath - Local source file path
   * @param {Object} config - Transfer configuration
   * @param {Object} config.relativePath - Relative path including folder structure (e.g., "Title (Year)/Title (Year).mkv")
   * @param {Function} onProgress - Progress callback (0-100)
   * @param {Function} onLog - Log callback
   * @returns {Promise<{success: boolean, remotePath: string}>}
   */
  async transfer(sourcePath, config, onProgress, onLog) {
    const { protocol } = config;

    logger.info('transfer', `Starting ${protocol} transfer: ${config.relativePath || path.basename(sourcePath)}`);
    if (onLog) onLog(`Starting ${protocol.toUpperCase()} transfer...`);

    try {
      switch (protocol) {
        case TransferProtocol.LOCAL:
          return await this.transferLocal(sourcePath, config, onProgress, onLog);
        case TransferProtocol.UNC:
          return await this.transferUNC(sourcePath, config, onProgress, onLog);
        case TransferProtocol.SCP:
        case TransferProtocol.SFTP:
          return await this.transferSFTP(sourcePath, config, onProgress, onLog);
        case TransferProtocol.FTP:
          return await this.transferFTP(sourcePath, config, onProgress, onLog);
        default:
          throw new Error(`Unsupported transfer protocol: ${protocol}`);
      }
    } catch (error) {
      logger.error('transfer', `Transfer failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Local file system copy
   */
  async transferLocal(sourcePath, config, onProgress, onLog) {
    const { moviePath, tvPath, mediaType, relativePath } = config;
    const destBase = mediaType === 'tv' ? tvPath : moviePath;

    if (!destBase) {
      throw new Error(`${mediaType} library path not configured`);
    }

    // Use relativePath for folder structure, fallback to just filename
    const destRelative = relativePath || path.basename(sourcePath);
    const destPath = path.join(destBase, destRelative);

    if (onLog) onLog(`Copying to: ${destPath}`);

    // Ensure destination directory exists (including movie/tv subfolder)
    await fs.mkdir(path.dirname(destPath), { recursive: true });

    // Get source size for progress
    const stat = await fs.stat(sourcePath);
    const totalSize = stat.size;

    // Copy with progress (using streams for large files)
    await this.copyWithProgress(sourcePath, destPath, totalSize, onProgress);

    if (onLog) onLog(`Transfer complete: ${destPath}`);
    return { success: true, remotePath: destPath };
  }

  /**
   * UNC/SMB network path copy (Windows)
   */
  async transferUNC(sourcePath, config, onProgress, onLog) {
    const { uncPath, moviePath, tvPath, mediaType, username, password, relativePath } = config;
    const destBase = mediaType === 'tv' ? (tvPath || uncPath) : (moviePath || uncPath);

    if (!destBase) {
      throw new Error(`${mediaType} library path not configured`);
    }

    // Use relativePath for folder structure, fallback to just filename
    const destRelative = relativePath || path.basename(sourcePath);
    const destPath = path.join(destBase, destRelative);

    // For UNC paths with credentials, we might need to establish connection first
    // On Windows, this is typically handled by the OS or net use command
    if (username && password) {
      if (onLog) onLog(`Connecting to network share...`);
      // Could use 'net use' command here if needed
    }

    if (onLog) onLog(`Copying to: ${destPath}`);

    // Ensure destination directory exists (including movie/tv subfolder)
    await fs.mkdir(path.dirname(destPath), { recursive: true });

    const stat = await fs.stat(sourcePath);
    await this.copyWithProgress(sourcePath, destPath, stat.size, onProgress);

    if (onLog) onLog(`Transfer complete: ${destPath}`);
    return { success: true, remotePath: destPath };
  }

  /**
   * SFTP/SCP transfer (uses ssh2-sftp-client)
   */
  async transferSFTP(sourcePath, config, onProgress, onLog) {
    const { host, port = 22, username, password, privateKey, moviePath, tvPath, mediaType, relativePath } = config;
    const destBase = mediaType === 'tv' ? tvPath : moviePath;

    if (!destBase) {
      throw new Error(`${mediaType} remote path not configured`);
    }

    // Lazy load ssh2-sftp-client
    let SftpClient;
    try {
      const module = await import('ssh2-sftp-client');
      SftpClient = module.default;
    } catch {
      throw new Error('ssh2-sftp-client not installed. Run: npm install ssh2-sftp-client');
    }

    const sftp = new SftpClient();
    // Use relativePath for folder structure, fallback to just filename
    const destRelative = relativePath || path.basename(sourcePath);
    const remoteDest = `${destBase}/${destRelative}`.replace(/\\/g, '/');

    try {
      if (onLog) onLog(`Connecting to ${host}:${port}...`);

      const connectOptions = {
        host,
        port,
        username,
      };

      if (privateKey) {
        const validatedKeyPath = validatePrivateKeyPath(privateKey);
        connectOptions.privateKey = await fs.readFile(validatedKeyPath, 'utf8');
      } else if (password) {
        connectOptions.password = password;
      }

      await sftp.connect(connectOptions);
      if (onLog) onLog(`Connected, uploading to: ${remoteDest}`);

      // Ensure remote directory exists by creating each level from base path
      // Note: Don't use recursive mkdir (true) as it fails on mount points
      // We create directories one level at a time, starting from destBase
      const remoteDir = path.dirname(remoteDest).replace(/\\/g, '/');
      const normalizedBase = destBase.replace(/\\/g, '/');

      // Calculate the relative path from base to target directory
      // e.g., if destBase is /mnt/raid_hdd_media/tv and remoteDir is /mnt/raid_hdd_media/tv/Show (2003)/Season 01
      // then relativeDirs would be ['Show (2003)', 'Season 01']
      let relativePath = remoteDir;
      if (remoteDir.startsWith(normalizedBase)) {
        relativePath = remoteDir.slice(normalizedBase.length);
        if (relativePath.startsWith('/')) relativePath = relativePath.slice(1);
      }

      const dirsToCreate = relativePath ? relativePath.split('/').filter(d => d) : [];
      logger.debug('transfer', `Base path: ${normalizedBase}`);
      logger.debug('transfer', `Target dir: ${remoteDir}`);
      logger.debug('transfer', `Dirs to create: ${JSON.stringify(dirsToCreate)}`);

      // Create each directory level one at a time
      let currentPath = normalizedBase;
      for (const dir of dirsToCreate) {
        currentPath = `${currentPath}/${dir}`;
        try {
          const dirExists = await sftp.exists(currentPath);
          if (!dirExists) {
            logger.debug('transfer', `Creating directory: ${currentPath}`);
            await sftp.mkdir(currentPath);
            logger.info('transfer', `Created remote directory: ${currentPath}`);
          } else {
            logger.debug('transfer', `Directory already exists: ${currentPath}`);
          }
        } catch (mkdirErr) {
          // Check if error is "already exists" - these are safe to ignore
          const errMsg = mkdirErr.message?.toLowerCase() || '';
          if (errMsg.includes('exist') || errMsg.includes('file already exists')) {
            logger.debug('transfer', `Directory already exists: ${currentPath}`);
          } else {
            // For other errors, try to continue but log the issue
            logger.warn('transfer', `mkdir warning for ${currentPath}: ${mkdirErr.message}`);
            // Try to verify if directory exists despite the error
            try {
              const verifyExists = await sftp.exists(currentPath);
              if (verifyExists) {
                logger.debug('transfer', `Directory verified exists: ${currentPath}`);
              } else {
                logger.error('transfer', `Failed to create directory ${currentPath}: ${mkdirErr.message}`);
                throw new Error(`Cannot create remote directory ${currentPath}: ${mkdirErr.message}`);
              }
            } catch (verifyErr) {
              logger.error('transfer', `Cannot verify directory ${currentPath}: ${verifyErr.message}`);
              throw new Error(`Cannot create remote directory ${currentPath}: ${mkdirErr.message}`);
            }
          }
        }
      }

      // Upload with progress - verify file exists first
      let stat;
      try {
        stat = await fs.stat(sourcePath);
        logger.debug('transfer', `Source file verified: ${sourcePath} (${stat.size} bytes)`);
      } catch (statErr) {
        throw new Error(`Source file not found: ${sourcePath} - ${statErr.message}`);
      }
      const totalSize = stat.size;
      let uploaded = 0;

      // Normalize source path for SFTP on Windows
      const normalizedSource = sourcePath.replace(/\\/g, '/');
      logger.debug('transfer', `Uploading: "${normalizedSource}" -> "${remoteDest}"`);

      try {
        await sftp.fastPut(normalizedSource, remoteDest, {
          step: (transferred) => {
            uploaded = transferred;
            const percent = (transferred / totalSize) * 100;
            if (onProgress) onProgress(percent);
          }
        });
      } catch (uploadErr) {
        // Re-throw with more context
        throw new Error(`fastPut: ${uploadErr.message} Local: ${sourcePath} Remote: ${remoteDest}`);
      }

      if (onLog) onLog(`Transfer complete: ${remoteDest}`);
      return { success: true, remotePath: remoteDest };
    } finally {
      await sftp.end();
    }
  }

  /**
   * FTP transfer (uses basic-ftp)
   */
  async transferFTP(sourcePath, config, onProgress, onLog) {
    const { host, port = 21, username, password, secure = false, moviePath, tvPath, mediaType, relativePath } = config;
    const destBase = mediaType === 'tv' ? tvPath : moviePath;

    if (!destBase) {
      throw new Error(`${mediaType} remote path not configured`);
    }

    // Lazy load basic-ftp
    let ftp;
    try {
      const module = await import('basic-ftp');
      ftp = module;
    } catch {
      throw new Error('basic-ftp not installed. Run: npm install basic-ftp');
    }

    const client = new ftp.Client();
    // Use relativePath for folder structure, fallback to just filename
    const destRelative = relativePath || path.basename(sourcePath);
    const remoteDest = `${destBase}/${destRelative}`.replace(/\\/g, '/');

    try {
      if (onLog) onLog(`Connecting to ${host}:${port}${secure ? ' (TLS)' : ''}...`);

      await client.access({
        host,
        port,
        user: username,
        password,
        secure,
      });

      if (onLog) onLog(`Connected, uploading to: ${remoteDest}`);

      // Ensure remote directory exists
      const remoteDir = path.dirname(remoteDest).replace(/\\/g, '/');
      await client.ensureDir(remoteDir);

      // Track progress
      const stat = await fs.stat(sourcePath);
      const totalSize = stat.size;

      client.trackProgress(info => {
        const percent = (info.bytesOverall / totalSize) * 100;
        if (onProgress) onProgress(percent);
      });

      await client.uploadFrom(sourcePath, remoteDest);
      client.trackProgress(); // Stop tracking

      if (onLog) onLog(`Transfer complete: ${remoteDest}`);
      return { success: true, remotePath: remoteDest };
    } finally {
      client.close();
    }
  }

  /**
   * Copy file with progress callback
   */
  async copyWithProgress(src, dest, totalSize, onProgress) {
    const { createReadStream, createWriteStream } = await import('fs');

    return new Promise((resolve, reject) => {
      const readStream = createReadStream(src);
      const writeStream = createWriteStream(dest);
      let copied = 0;

      readStream.on('data', (chunk) => {
        copied += chunk.length;
        const percent = (copied / totalSize) * 100;
        if (onProgress) onProgress(percent);
      });

      readStream.on('error', reject);
      writeStream.on('error', reject);
      writeStream.on('finish', resolve);

      readStream.pipe(writeStream);
    });
  }

  /**
   * Test connection for a given protocol
   */
  async testConnection(config) {
    const { protocol } = config;

    try {
      switch (protocol) {
        case TransferProtocol.LOCAL:
          // Check if path exists
          await fs.access(config.moviePath || config.localPath);
          return { success: true, message: 'Path accessible' };

        case TransferProtocol.UNC:
          await fs.access(config.uncPath || config.moviePath);
          return { success: true, message: 'Network path accessible' };

        case TransferProtocol.SCP:
        case TransferProtocol.SFTP: {
          let SftpClient;
          try {
            const module = await import('ssh2-sftp-client');
            SftpClient = module.default;
          } catch {
            return { success: false, message: 'ssh2-sftp-client not installed' };
          }

          const sftp = new SftpClient();
          const connectOptions = {
            host: config.host,
            port: config.port || 22,
            username: config.username,
          };

          if (config.privateKey) {
            const validatedKeyPath = validatePrivateKeyPath(config.privateKey);
            connectOptions.privateKey = await fs.readFile(validatedKeyPath, 'utf8');
          } else if (config.password) {
            connectOptions.password = config.password;
          }

          await sftp.connect(connectOptions);
          await sftp.end();
          return { success: true, message: `Connected to ${config.host}` };
        }

        case TransferProtocol.FTP: {
          let ftp;
          try {
            const module = await import('basic-ftp');
            ftp = module;
          } catch {
            return { success: false, message: 'basic-ftp not installed' };
          }

          const client = new ftp.Client();
          await client.access({
            host: config.host,
            port: config.port || 21,
            user: config.username,
            password: config.password,
            secure: config.secure,
          });
          client.close();
          return { success: true, message: `Connected to ${config.host}` };
        }

        default:
          return { success: false, message: `Unknown protocol: ${protocol}` };
      }
    } catch (error) {
      return { success: false, message: error.message };
    }
  }
}

// Singleton instance
let transferManager = null;

export function getTransferManager() {
  if (!transferManager) {
    transferManager = new TransferManager();
  }
  return transferManager;
}

export default {
  TransferProtocol,
  TransferManager,
  getTransferManager
};
