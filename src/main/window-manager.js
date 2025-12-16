// Window management for the main Electron application

import { BrowserWindow, app, shell } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow = null;

/**
 * Create the main application window
 */
export function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      // Security: Use preload script for safe IPC
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // In development or test mode, load from Vite dev server
  const isDev = (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') || !app.isPackaged;

  if (isDev) {
    // Use environment variable if set (for testing with dynamic ports), otherwise default to 5173
    const devServerUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
    mainWindow.loadURL(devServerUrl).catch(err => {
      console.error(`Failed to load dev server at ${devServerUrl}:`, err);
      mainWindow.loadURL(`data:text/html,<h1>Error loading dev server</h1><p>Tried to load: ${devServerUrl}</p><pre>${err}</pre>`);
    });
    // Don't open DevTools during tests (NODE_ENV is set to 'test' by test runner)
    if (process.env.NODE_ENV !== 'test') {
      mainWindow.webContents.openDevTools();
    }
  } else {
    // In production, load the built renderer from dist-renderer
    // __dirname is app.asar/src/main, so go up twice to reach app.asar root
    mainWindow.loadFile(path.join(__dirname, '../../dist-renderer/index.html'));
  }

  // Security: Intercept navigation to external URLs and open in OS browser
  // This prevents external links from loading inside Electron
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const parsedUrl = new URL(url);
    // Allow navigation to localhost (dev server) and file:// protocol (production)
    if (parsedUrl.protocol === 'file:' || parsedUrl.hostname === 'localhost') {
      return; // Allow internal navigation
    }
    // Block external navigation and open in OS browser instead
    event.preventDefault();
    shell.openExternal(url);
  });

  // Security: Handle window.open() calls - open external URLs in OS browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const parsedUrl = new URL(url);
    // Allow internal URLs to open in new Electron window (if needed)
    if (parsedUrl.protocol === 'file:' || parsedUrl.hostname === 'localhost') {
      return { action: 'allow' };
    }
    // External URLs: open in OS browser, deny new Electron window
    shell.openExternal(url);
    return { action: 'deny' };
  });

  return mainWindow;
}

/**
 * Get the main window instance
 */
export function getMainWindow() {
  return mainWindow;
}

/**
 * Set the main window instance (for initialization)
 */
export function setMainWindow(window) {
  mainWindow = window;
}
