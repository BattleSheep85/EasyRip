// Transfer Module - Multi-protocol file transfer for Emby exports
// Supports: SCP, SFTP, FTP, UNC/SMB, Local file copy
//
// NOTE: This module requires optional dependencies:
// - SCP/SFTP: npm install ssh2-sftp-client
// - FTP: npm install basic-ftp

import { promises as fs } from 'fs';
import path from 'path';
import logger from './logger.js';

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
   * @param {Function} onProgress - Progress callback (0-100)
   * @param {Function} onLog - Log callback
   * @returns {Promise<{success: boolean, remotePath: string}>}
   */
  async transfer(sourcePath, config, onProgress, onLog) {
    const { protocol } = config;

    logger.info('transfer', `Starting ${protocol} transfer: ${path.basename(sourcePath)}`);
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
    const { localPath, moviePath, tvPath, mediaType } = config;
    const destBase = mediaType === 'tv' ? tvPath : moviePath;

    if (!destBase) {
      throw new Error(`${mediaType} library path not configured`);
    }

    const fileName = path.basename(sourcePath);
    const destPath = path.join(destBase, fileName);

    if (onLog) onLog(`Copying to: ${destPath}`);

    // Ensure destination directory exists
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
    const { uncPath, moviePath, tvPath, mediaType, username, password } = config;
    const destBase = mediaType === 'tv' ? (tvPath || uncPath) : (moviePath || uncPath);

    if (!destBase) {
      throw new Error(`${mediaType} library path not configured`);
    }

    const fileName = path.basename(sourcePath);
    const destPath = path.join(destBase, fileName);

    // For UNC paths with credentials, we might need to establish connection first
    // On Windows, this is typically handled by the OS or net use command
    if (username && password) {
      if (onLog) onLog(`Connecting to network share...`);
      // Could use 'net use' command here if needed
    }

    if (onLog) onLog(`Copying to: ${destPath}`);

    // Ensure destination directory exists
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
    const { host, port = 22, username, password, privateKey, remotePath, moviePath, tvPath, mediaType } = config;
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
    const fileName = path.basename(sourcePath);
    const remoteDest = `${destBase}/${fileName}`.replace(/\\/g, '/');

    try {
      if (onLog) onLog(`Connecting to ${host}:${port}...`);

      const connectOptions = {
        host,
        port,
        username,
      };

      if (privateKey) {
        connectOptions.privateKey = await fs.readFile(privateKey, 'utf8');
      } else if (password) {
        connectOptions.password = password;
      }

      await sftp.connect(connectOptions);
      if (onLog) onLog(`Connected, uploading to: ${remoteDest}`);

      // Ensure remote directory exists
      const remoteDir = path.dirname(remoteDest).replace(/\\/g, '/');
      try {
        await sftp.mkdir(remoteDir, true);
      } catch {
        // Directory might already exist
      }

      // Upload with progress
      const stat = await fs.stat(sourcePath);
      const totalSize = stat.size;
      let uploaded = 0;

      await sftp.fastPut(sourcePath, remoteDest, {
        step: (transferred) => {
          uploaded = transferred;
          const percent = (transferred / totalSize) * 100;
          if (onProgress) onProgress(percent);
        }
      });

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
    const { host, port = 21, username, password, secure = false, moviePath, tvPath, mediaType } = config;
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
    const fileName = path.basename(sourcePath);
    const remoteDest = `${destBase}/${fileName}`.replace(/\\/g, '/');

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
            connectOptions.privateKey = await fs.readFile(config.privateKey, 'utf8');
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
