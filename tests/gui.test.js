/**
 * EasyRip GUI Tests using Playwright + Electron
 * Run with: npm run test:e2e
 */

import { _electron as electron } from 'playwright';
import { spawn } from 'child_process';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..');

let electronApp;
let page;
let viteProcess;

// Wait for a port to be available
async function waitForPort(port, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const response = await fetch(`http://localhost:${port}`);
      if (response.ok || response.status === 404 || response.status === 200) {
        return true;
      }
    } catch {
      // Port not ready
    }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`Timeout waiting for port ${port}`);
}

// Start Vite dev server
async function startVite() {
  return new Promise((resolve, reject) => {
    console.log('[test] Starting Vite dev server...');

    viteProcess = spawn('npm', ['run', 'dev'], {
      cwd: projectRoot,
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let port = 5173;

    viteProcess.stdout.on('data', (data) => {
      const output = data.toString();
      // Extract port from Vite output
      const portMatch = output.match(/localhost:(\d+)/);
      if (portMatch) {
        port = parseInt(portMatch[1]);
      }
      if (output.includes('ready') || output.includes('Local:')) {
        console.log(`[test] Vite ready on port ${port}`);
        resolve(port);
      }
    });

    viteProcess.stderr.on('data', (data) => {
      console.error('[vite stderr]', data.toString());
    });

    viteProcess.on('error', reject);

    // Timeout after 30 seconds
    setTimeout(() => reject(new Error('Vite startup timeout')), 30000);
  });
}

describe('EasyRip GUI Tests', () => {
  before(async () => {
    // Start Vite first
    const vitePort = await startVite();
    console.log(`[test] Vite running on port ${vitePort}`);

    // Wait for Vite to be fully ready
    await waitForPort(vitePort);

    // Launch Electron app
    console.log('[test] Launching Electron...');
    electronApp = await electron.launch({
      args: [projectRoot],
      env: {
        ...process.env,
        NODE_ENV: 'development',
        VITE_DEV_SERVER_URL: `http://localhost:${vitePort}`
      }
    });

    // Wait for windows to open and find the main app window (not DevTools)
    console.log('[test] Waiting for app window...');
    await new Promise(r => setTimeout(r, 3000)); // Wait for windows to initialize

    // Get all windows and find the main app (not DevTools)
    const windows = electronApp.windows();
    console.log(`[test] Found ${windows.length} window(s)`);

    for (const win of windows) {
      const title = await win.title();
      console.log(`[test] Window title: ${title}`);
      if (title.includes('EasyRip')) {
        page = win;
        break;
      }
    }

    // If no EasyRip window found, wait for it
    if (!page) {
      console.log('[test] Waiting for EasyRip window...');
      page = await electronApp.waitForEvent('window', {
        predicate: async (win) => {
          const title = await win.title();
          return title.includes('EasyRip');
        },
        timeout: 30000
      });
    }

    console.log('[test] Got main app window');

    // Wait for app to be ready
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000); // Give React time to render
    console.log('[test] App ready');
  });

  after(async () => {
    console.log('[test] Cleaning up...');
    if (electronApp) {
      await electronApp.close();
    }
    if (viteProcess) {
      viteProcess.kill();
    }
  });

  test('App loads with correct title', async () => {
    const title = await page.title();
    console.log(`[test] Page title: ${title}`);
    assert.ok(title.includes('EasyRip'), `Expected title to include 'EasyRip', got: ${title}`);
  });

  test('Header shows EasyRip branding', async () => {
    const header = await page.locator('h1').first().textContent();
    console.log(`[test] Header text: ${header}`);
    assert.strictEqual(header, 'EasyRip');
  });

  test('Toolbar buttons exist', async () => {
    const refreshBtn = page.locator('button:has-text("Refresh Drives")');
    const backupAllBtn = page.locator('button:has-text("Backup All")');

    const refreshVisible = await refreshBtn.isVisible();
    const backupVisible = await backupAllBtn.isVisible();

    console.log(`[test] Refresh button visible: ${refreshVisible}`);
    console.log(`[test] Backup All button visible: ${backupVisible}`);

    assert.ok(refreshVisible, 'Refresh Drives button should be visible');
    assert.ok(backupVisible, 'Backup All button should be visible');
  });

  test('Settings modal opens and closes', async () => {
    // Click Settings button
    console.log('[test] Opening Settings modal...');
    await page.click('button:has-text("Settings")');

    // Wait for modal
    await page.waitForSelector('.modal', { state: 'visible', timeout: 5000 });

    // Verify modal content
    const modalTitle = await page.locator('.modal h3').textContent();
    console.log(`[test] Modal title: ${modalTitle}`);
    assert.strictEqual(modalTitle, 'Settings');

    // Close modal
    await page.click('button:has-text("Cancel")');

    // Verify modal closed
    await page.waitForSelector('.modal', { state: 'hidden', timeout: 5000 });
    console.log('[test] Settings modal closed');
  });

  test('Logs modal opens and closes', async () => {
    // Click Logs button
    console.log('[test] Opening Logs modal...');
    await page.click('button:has-text("Logs")');

    // Wait for modal
    await page.waitForSelector('.modal', { state: 'visible', timeout: 5000 });

    // Verify modal content
    const modalTitle = await page.locator('.modal h3').textContent();
    console.log(`[test] Modal title: ${modalTitle}`);
    assert.ok(modalTitle.includes('Logs'), `Expected Logs modal, got: ${modalTitle}`);

    // Close modal
    await page.click('button:has-text("Close")');

    // Verify modal closed
    await page.waitForSelector('.modal', { state: 'hidden', timeout: 5000 });
    console.log('[test] Logs modal closed');
  });

  test('Drive detection works', { timeout: 120000 }, async () => {
    console.log('[test] Testing drive detection...');

    // Click Refresh Drives
    await page.click('button:has-text("Refresh Drives")');

    // Wait for scan to complete - look for the button to not say "Scanning..."
    console.log('[test] Waiting for scan to complete (this may take up to 90s)...');
    await page.waitForFunction(() => {
      const btn = document.querySelector('button.btn-primary');
      return btn && btn.textContent === 'Refresh Drives';
    }, { timeout: 90000 }); // MakeMKV scan can take a while

    // Check toolbar info updates
    const toolbarInfo = await page.locator('.toolbar-info').textContent();
    console.log(`[test] Toolbar info: ${toolbarInfo}`);
    assert.ok(toolbarInfo.includes('disc'), `Toolbar should show disc info: ${toolbarInfo}`);
  });

  test('Footer shows paths', async () => {
    const footer = await page.locator('footer').textContent();
    console.log(`[test] Footer: ${footer}`);
    assert.ok(footer.includes('Base:'), 'Footer should show base path');
    assert.ok(footer.includes('Temp:'), 'Footer should show temp path');
    assert.ok(footer.includes('Backup:'), 'Footer should show backup path');
  });

  test('Backup starts and can be cancelled', { timeout: 60000 }, async () => {
    console.log('[test] Testing backup start/cancel...');

    // Find a "Backup" button in the TABLE (not toolbar) - use exact text match
    // The toolbar has "Backup All (N)" while individual drives have just "Backup"
    const backupBtn = page.locator('.drive-table button.btn-primary:has-text("Backup")').first();
    const isVisible = await backupBtn.isVisible();

    if (!isVisible) {
      console.log('[test] No backup button visible in table - skipping test');
      return; // Skip if no drives ready
    }

    // Debug: Log what we found
    const btnText = await backupBtn.textContent();
    console.log(`[test] Found backup button with text: "${btnText}"`);

    // Click Backup button
    console.log('[test] Starting backup...');
    await backupBtn.click();

    // Wait briefly for React state to update
    await page.waitForTimeout(500);

    // Debug: Check what statuses exist now
    const statusBadges = await page.locator('.status-badge').all();
    for (let i = 0; i < Math.min(statusBadges.length, 4); i++) {
      const classes = await statusBadges[i].getAttribute('class');
      const text = await statusBadges[i].textContent();
      console.log(`[test] Status badge ${i}: text="${text}", classes="${classes}"`);
    }

    // Wait for status to change to "Running"
    console.log('[test] Waiting for Running status...');
    await page.waitForSelector('.status-running', { timeout: 10000 });
    console.log('[test] Backup is running');

    // Wait a moment then cancel
    await page.waitForTimeout(3000);

    // Find and click Cancel button
    const cancelBtn = page.locator('button:has-text("Cancel")').first();
    if (await cancelBtn.isVisible()) {
      console.log('[test] Cancelling backup...');
      await cancelBtn.click();

      // Wait for status to return to Ready or idle
      await page.waitForFunction(() => {
        const running = document.querySelector('.status-running');
        return !running;
      }, { timeout: 30000 });
      console.log('[test] Backup cancelled successfully');
    } else {
      console.log('[test] Cancel button not found - backup may have completed');
    }
  });
});

// Run if executed directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log('[test] Running GUI tests...');
}
