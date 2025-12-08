// Window management for the main Electron application

import { BrowserWindow, app } from 'electron';
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

  // In development, load from Vite dev server
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173').catch(err => {
      console.error('Failed to load dev server:', err);
      mainWindow.loadURL(`data:text/html,<h1>Error loading dev server</h1><p>Make sure Vite is running on port 5173</p><pre>${err}</pre>`);
    });
    mainWindow.webContents.openDevTools();
  } else {
    // In production, load the built renderer from dist-renderer
    // __dirname is app.asar/src/main, so go up twice to reach app.asar root
    mainWindow.loadFile(path.join(__dirname, '../../dist-renderer/index.html'));
  }

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
