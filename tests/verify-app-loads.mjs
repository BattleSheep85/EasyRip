/**
 * Quick verification test to check if EasyRip app loads without errors
 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function verifyAppLoads() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 }
  });
  const page = await context.newPage();

  const results = {
    appLoads: false,
    noErrorBoundary: false,
    toolbarVisible: false,
    scanButtonVisible: false,
    sidebarVisible: false,
    screenshotPath: null,
    errors: [],
    consoleErrors: []
  };

  // Capture console errors
  page.on('console', msg => {
    if (msg.type() === 'error') {
      results.consoleErrors.push(msg.text());
    }
  });

  page.on('pageerror', error => {
    results.errors.push(error.message);
  });

  try {
    console.log('Navigating to http://localhost:5177...');
    await page.goto('http://localhost:5177', { waitUntil: 'networkidle', timeout: 30000 });
    results.appLoads = true;
    console.log('Page loaded successfully');

    // Wait a moment for React to hydrate
    await page.waitForTimeout(1000);

    // Check for error boundary ("Something went wrong")
    const errorBoundary = await page.locator('text="Something went wrong"').count();
    results.noErrorBoundary = errorBoundary === 0;
    if (errorBoundary > 0) {
      console.log('ERROR: Error boundary detected - app crashed!');
    } else {
      console.log('No error boundary - app loaded cleanly');
    }

    // Check for toolbar
    const toolbar = await page.locator('.toolbar, [class*="toolbar"]').count();
    results.toolbarVisible = toolbar > 0;
    console.log(`Toolbar visible: ${results.toolbarVisible}`);

    // Check for "Scan Disks" button (case insensitive)
    const scanButton = await page.locator('button:has-text("Scan")').count();
    results.scanButtonVisible = scanButton > 0;
    console.log(`Scan button visible: ${results.scanButtonVisible}`);

    // Check for sidebar
    const sidebar = await page.locator('.sidebar, nav, [class*="sidebar"]').count();
    results.sidebarVisible = sidebar > 0;
    console.log(`Sidebar visible: ${results.sidebarVisible}`);

    // Take screenshot
    const screenshotDir = join(__dirname, 'screenshots');
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }
    const screenshotPath = join(screenshotDir, `verify-app-${Date.now()}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    results.screenshotPath = screenshotPath;
    console.log(`Screenshot saved: ${screenshotPath}`);

    // Get page title
    const title = await page.title();
    console.log(`Page title: ${title}`);

    // Get visible text for debugging
    const bodyText = await page.locator('body').innerText();
    console.log('\n--- Page Content Preview ---');
    console.log(bodyText.substring(0, 500));
    console.log('----------------------------\n');

  } catch (error) {
    results.errors.push(error.message);
    console.error('Error during verification:', error.message);
  } finally {
    await browser.close();
  }

  // Summary
  console.log('\n=== VERIFICATION RESULTS ===');
  console.log(`App Loads: ${results.appLoads ? 'PASS' : 'FAIL'}`);
  console.log(`No Error Boundary: ${results.noErrorBoundary ? 'PASS' : 'FAIL'}`);
  console.log(`Toolbar Visible: ${results.toolbarVisible ? 'PASS' : 'FAIL'}`);
  console.log(`Scan Button Visible: ${results.scanButtonVisible ? 'PASS' : 'FAIL'}`);
  console.log(`Sidebar Visible: ${results.sidebarVisible ? 'PASS' : 'FAIL'}`);

  if (results.consoleErrors.length > 0) {
    console.log('\nConsole Errors:');
    results.consoleErrors.forEach(e => console.log(`  - ${e}`));
  }

  if (results.errors.length > 0) {
    console.log('\nPage Errors:');
    results.errors.forEach(e => console.log(`  - ${e}`));
  }

  const allPassed = results.appLoads && results.noErrorBoundary && results.toolbarVisible && results.scanButtonVisible;
  console.log(`\nOVERALL: ${allPassed ? 'PASS' : 'FAIL'}`);

  return results;
}

verifyAppLoads().catch(console.error);
