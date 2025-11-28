/**
 * Quick script to click Backup All using Playwright Electron support
 * This connects to the running Electron app and clicks the button
 */

import { _electron as electron } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..');

async function main() {
  console.log('[script] Launching Electron with Playwright...');

  const electronApp = await electron.launch({
    args: [projectRoot],
    env: {
      ...process.env,
      NODE_ENV: 'development',
      VITE_DEV_SERVER_URL: 'http://localhost:5173'
    }
  });

  // Wait for windows and find main app
  console.log('[script] Waiting for app window...');
  await new Promise(r => setTimeout(r, 3000));

  const windows = electronApp.windows();
  let page = null;

  for (const win of windows) {
    const title = await win.title();
    if (title.includes('EasyRip')) {
      page = win;
      break;
    }
  }

  if (!page) {
    page = await electronApp.waitForEvent('window', {
      predicate: async (win) => {
        const title = await win.title();
        return title.includes('EasyRip');
      },
      timeout: 30000
    });
  }

  console.log('[script] Got main app window');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000);

  // Wait for drives to be loaded (button should say "Backup All (4)")
  console.log('[script] Waiting for drives to load...');
  await page.waitForFunction(() => {
    const btn = document.querySelector('button.btn-success');
    return btn && btn.textContent.includes('Backup All') && !btn.textContent.includes('(0)');
  }, { timeout: 60000 });

  // Get the backup all button text
  const backupAllBtn = page.locator('button.btn-success');
  const btnText = await backupAllBtn.textContent();
  console.log(`[script] Found button: "${btnText}"`);

  // Click Backup All
  console.log('[script] Clicking Backup All...');
  await backupAllBtn.click();

  // Monitor status for 30 seconds
  console.log('[script] Monitoring backup status...');
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(1000);

    const statusBadges = await page.locator('.status-badge').all();
    const statuses = [];
    for (const badge of statusBadges) {
      const text = await badge.textContent();
      statuses.push(text);
    }
    console.log(`[script] Status at ${i+1}s: ${statuses.join(', ')}`);

    // Check if all are running or complete
    const runningCount = statuses.filter(s => s === 'Running').length;
    const completeCount = statuses.filter(s => s === 'Done' || s === 'Complete').length;

    if (runningCount > 0) {
      console.log(`[script] ${runningCount} backup(s) running`);
    }
    if (completeCount === statuses.length && statuses.length > 0) {
      console.log('[script] All backups complete!');
      break;
    }
  }

  console.log('[script] Done monitoring. Backups will continue in background.');
  console.log('[script] Check the app window or logs for progress.');

  // Don't close the app - let it run
  // await electronApp.close();
}

main().catch(err => {
  console.error('[script] Error:', err);
  process.exit(1);
});
