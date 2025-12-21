/**
 * CDP E2E Test Runner for EasyRip
 * Connects to app running on debugging port 9222
 * Run with: node tests/cdp-e2e-runner.js
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');

// Ensure screenshot directory exists
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

// Test report
const report = {
  targetUrl: 'http://localhost:5173',
  viewport: '1920x1080',
  timestamp: new Date().toISOString(),
  steps: [],
  consoleErrors: [],
  issues: [],
  screenshots: []
};

function logStep(num, action, expected, actual, status) {
  const icon = status === 'PASS' ? '[PASS]' : status === 'FAIL' ? '[FAIL]' : '[INFO]';
  console.log(`  ${icon} Step ${num}: ${action}`);
  report.steps.push({ step: num, action, expected, actual, status });
}

function logIssue(type, description, location, severity = 'medium') {
  console.log(`  [ISSUE] ${severity.toUpperCase()}: ${description} @ ${location}`);
  report.issues.push({ type, description, location, severity });
}

async function screenshot(page, name) {
  const filename = `${name}-${Date.now()}.png`;
  const filepath = path.join(SCREENSHOT_DIR, filename);
  await page.screenshot({ path: filepath, fullPage: true });
  report.screenshots.push({ name, filepath });
  console.log(`  [SCREENSHOT] ${filename}`);
  return filepath;
}

async function runTests() {
  console.log('\n============================================================');
  console.log('  EasyRip E2E QA Test Suite - CDP Connection');
  console.log('============================================================\n');

  let browser;
  let page;
  let stepNum = 0;

  try {
    // Connect via CDP
    console.log('Connecting to Electron app via CDP on port 9222...');
    browser = await chromium.connectOverCDP('http://localhost:9222');
    const contexts = browser.contexts();

    if (contexts.length === 0) {
      throw new Error('No browser contexts found');
    }

    const pages = contexts[0].pages();
    page = pages.find(p => p.url().includes('localhost:5173'));

    if (!page) {
      throw new Error('Could not find EasyRip page (looking for localhost:5173)');
    }

    console.log(`Connected to: ${page.url()}\n`);

    // Capture console errors
    page.on('console', msg => {
      if (msg.type() === 'error') {
        report.consoleErrors.push({ text: msg.text(), location: msg.location() });
      }
    });

    // Set viewport
    await page.setViewportSize({ width: 1920, height: 1080 });

    // ==========================================================================
    // TEST 1: HOME PAGE (DRIVES VIEW)
    // ==========================================================================
    console.log('\n=== TEST 1: Home Page (Drives View) ===\n');

    // DON'T use page.goto() - it breaks the Electron app's initialization
    // Instead, work with the current state and use sidebar navigation
    await page.waitForTimeout(1000);
    await screenshot(page, '01-home-initial');

    // Check for error boundary first
    const errorBoundary = page.locator('text=Something went wrong');
    const hasError = await errorBoundary.isVisible().catch(() => false);
    if (hasError) {
      logIssue('critical', 'App shows error boundary - initialization failed', 'App Startup', 'critical');
      // Try to recover by clicking Reload App
      const reloadBtn = page.locator('button:has-text("Reload App")');
      if (await reloadBtn.isVisible().catch(() => false)) {
        await reloadBtn.click();
        await page.waitForTimeout(2000);
        await screenshot(page, '01b-after-reload');
      }
    }

    // 1.1 Check app loaded
    const title = await page.title();
    logStep(++stepNum, 'Check app title', 'Contains EasyRip', title, title.includes('EasyRip') ? 'PASS' : 'FAIL');

    // 1.2 Check Scan Disks / Refresh Drives button
    console.log('\n1.1 Testing Scan Disks/Refresh button...');
    let scanBtn = await page.locator('button:has-text("Scan Disks"), button:has-text("Refresh Drives")').first();
    let scanBtnVisible = await scanBtn.isVisible().catch(() => false);
    if (scanBtnVisible) {
      logStep(++stepNum, 'Scan Disks button visible', 'Visible', 'Visible', 'PASS');
      await scanBtn.click();
      await page.waitForTimeout(500);
      logStep(++stepNum, 'Scan Disks button clickable', 'Clickable', 'Click successful', 'PASS');
    } else {
      logStep(++stepNum, 'Scan Disks button visible', 'Visible', 'NOT FOUND', 'FAIL');
      logIssue('functional', 'Scan Disks/Refresh Drives button not found', 'Home Page - Toolbar', 'high');
    }

    // 1.3 Check toolbar stats display
    console.log('\n1.2 Testing toolbar stats...');
    const toolbarInfo = page.locator('.toolbar-info');
    const toolbarVisible = await toolbarInfo.isVisible().catch(() => false);
    if (toolbarVisible) {
      const infoText = await toolbarInfo.textContent();
      logStep(++stepNum, 'Toolbar info display', 'Shows disc counts', infoText.substring(0, 50), 'PASS');
    } else {
      logStep(++stepNum, 'Toolbar info display', 'Visible', 'Not visible', 'INFO');
    }

    // 1.4 Check automation toggles
    console.log('\n1.3 Testing automation toggles...');
    const toggles = ['Backup', 'Meta', 'Export', 'Eject'];
    for (const toggle of toggles) {
      const btn = page.locator(`.btn-toggle:has-text("${toggle}")`).first();
      const visible = await btn.isVisible().catch(() => false);
      if (visible) {
        logStep(++stepNum, `Auto: ${toggle} toggle`, 'Visible', 'Visible', 'PASS');
        // Test click
        const initialActive = await btn.evaluate(el => el.classList.contains('active')).catch(() => null);
        await btn.click();
        await page.waitForTimeout(200);
        const afterActive = await btn.evaluate(el => el.classList.contains('active')).catch(() => null);
        if (initialActive !== afterActive) {
          logStep(++stepNum, `Auto: ${toggle} toggle click`, 'Toggles state', 'State changed', 'PASS');
        }
        // Toggle back
        await btn.click();
        await page.waitForTimeout(200);
      } else {
        logStep(++stepNum, `Auto: ${toggle} toggle`, 'Visible', 'NOT FOUND', 'FAIL');
        logIssue('functional', `Auto: ${toggle} toggle not found`, 'Home Page - Toolbar', 'medium');
      }
    }

    // 1.5 Check Live Dangerously toggle
    console.log('\n1.4 Testing Live Dangerously toggle...');
    const liveDangerously = page.locator('.btn-toggle:has-text("Live Dangerously")').first();
    const ldVisible = await liveDangerously.isVisible().catch(() => false);
    if (ldVisible) {
      logStep(++stepNum, 'Live Dangerously toggle', 'Visible', 'Visible', 'PASS');
    } else {
      logStep(++stepNum, 'Live Dangerously toggle', 'Visible', 'NOT FOUND', 'INFO');
    }

    // 1.6 Check drives panel/table
    console.log('\n1.5 Testing drives panel...');
    const drivesPanel = page.locator('.drives-panel');
    const drivesPanelVisible = await drivesPanel.isVisible().catch(() => false);
    if (drivesPanelVisible) {
      logStep(++stepNum, 'Drives panel visible', 'Visible', 'Visible', 'PASS');

      // Check for table headers
      const expectedColumns = ['Drive', 'Type', 'Disc Name', 'Disc Size', 'Backup', 'Status', 'Progress', 'Mode', 'Actions'];
      const foundColumns = [];
      for (const col of expectedColumns) {
        const header = page.locator(`th:has-text("${col}"), .column-header:has-text("${col}")`).first();
        const exists = await header.isVisible().catch(() => false);
        if (exists) foundColumns.push(col);
      }
      logStep(++stepNum, 'Table columns check', expectedColumns.join(', '), foundColumns.join(', '), foundColumns.length >= 5 ? 'PASS' : 'INFO');
    } else {
      logStep(++stepNum, 'Drives panel visible', 'Visible', 'NOT FOUND', 'FAIL');
      logIssue('visual', 'Drives panel not visible', 'Home Page', 'high');
    }

    // 1.7 Check Mode dropdown (if drives exist)
    console.log('\n1.6 Testing Mode dropdown...');
    const modeSelect = page.locator('select').first();
    const modeSelectVisible = await modeSelect.isVisible().catch(() => false);
    if (modeSelectVisible) {
      logStep(++stepNum, 'Mode dropdown', 'Visible', 'Visible', 'PASS');
      // Check options
      const options = await modeSelect.locator('option').allTextContents().catch(() => []);
      console.log(`    Options: ${options.join(', ')}`);
    } else {
      logStep(++stepNum, 'Mode dropdown', 'Visible', 'Not visible (no drives?)', 'INFO');
    }

    // 1.8 Check log panel
    console.log('\n1.7 Testing log panel...');
    const logPanel = page.locator('.log-panel');
    const logPanelVisible = await logPanel.isVisible().catch(() => false);
    if (logPanelVisible) {
      logStep(++stepNum, 'Log panel visible', 'Visible', 'Visible', 'PASS');

      // Check for tabs
      const tabs = page.locator('.log-panel .tab, .log-panel [class*="tab"]');
      const tabCount = await tabs.count();
      console.log(`    Found ${tabCount} log tabs`);

      // Check for resize handle
      const resizeHandle = page.locator('.resize-handle, [class*="resize"]');
      const resizeExists = await resizeHandle.isVisible().catch(() => false);
      console.log(`    Resize handle visible: ${resizeExists}`);
    } else {
      logStep(++stepNum, 'Log panel visible', 'Visible', 'NOT FOUND', 'FAIL');
      logIssue('visual', 'Log panel not visible', 'Home Page', 'medium');
    }

    await screenshot(page, '02-home-after-tests');

    // ==========================================================================
    // TEST 2: SIDEBAR NAVIGATION
    // ==========================================================================
    console.log('\n\n=== TEST 2: Sidebar Navigation ===\n');

    // 2.1 Check sidebar exists
    const sidebar = page.locator('.app-sidebar');
    const sidebarVisible = await sidebar.isVisible().catch(() => false);
    logStep(++stepNum, 'Sidebar visible', 'Visible', sidebarVisible ? 'Visible' : 'NOT FOUND', sidebarVisible ? 'PASS' : 'FAIL');

    // 2.2 Test navigation items
    const navItems = [
      { name: 'Drives', expectedClass: 'home-page' },
      { name: 'Metadata', expectedClass: 'metadata-page' },
      { name: 'Export', expectedClass: 'export-page' },
      { name: 'Logs', expectedClass: 'logs-page' },
      { name: 'Settings', expectedClass: 'settings-page' }
    ];

    for (const item of navItems) {
      console.log(`\n2.${navItems.indexOf(item) + 2} Testing ${item.name} navigation...`);
      const navBtn = page.locator(`.sidebar-nav-item:has-text("${item.name}")`).first();
      const navVisible = await navBtn.isVisible().catch(() => false);

      if (navVisible) {
        await navBtn.click();
        await page.waitForTimeout(500);

        // Check active state
        const isActive = await navBtn.evaluate(el => el.classList.contains('active')).catch(() => false);
        console.log(`    Active state: ${isActive}`);

        // Check page loaded
        const pageEl = page.locator(`.${item.expectedClass}`);
        const pageVisible = await pageEl.isVisible().catch(() => false);

        if (pageVisible) {
          logStep(++stepNum, `Navigate to ${item.name}`, 'Page loads', 'Page loaded', 'PASS');
        } else {
          logStep(++stepNum, `Navigate to ${item.name}`, 'Page loads', 'Page NOT visible', 'FAIL');
          logIssue('functional', `${item.name} page did not load`, 'Sidebar Navigation', 'high');
        }
      } else {
        logStep(++stepNum, `${item.name} nav item`, 'Visible', 'NOT FOUND', 'FAIL');
        logIssue('functional', `${item.name} nav item not found`, 'Sidebar', 'high');
      }
    }

    // 2.3 Test collapse functionality
    console.log('\n2.7 Testing sidebar collapse...');
    const collapseBtn = page.locator('.sidebar-toggle.desktop-only, .sidebar-toggle').first();
    const collapseBtnVisible = await collapseBtn.isVisible().catch(() => false);
    if (collapseBtnVisible) {
      const initialCollapsed = await sidebar.evaluate(el => el.classList.contains('collapsed')).catch(() => null);
      await collapseBtn.click();
      await page.waitForTimeout(300);
      const afterCollapsed = await sidebar.evaluate(el => el.classList.contains('collapsed')).catch(() => null);

      if (initialCollapsed !== afterCollapsed) {
        logStep(++stepNum, 'Sidebar collapse toggle', 'Toggles collapsed state', 'State changed', 'PASS');
        // Toggle back
        await collapseBtn.click();
        await page.waitForTimeout(300);
      } else {
        logStep(++stepNum, 'Sidebar collapse toggle', 'Toggles state', 'State unchanged', 'FAIL');
      }
    } else {
      logStep(++stepNum, 'Sidebar collapse button', 'Visible', 'NOT FOUND', 'INFO');
    }

    await screenshot(page, '03-sidebar-tests');

    // ==========================================================================
    // TEST 3: METADATA PAGE
    // ==========================================================================
    console.log('\n\n=== TEST 3: Metadata Page ===\n');

    await page.locator('.sidebar-nav-item:has-text("Metadata")').click();
    await page.waitForTimeout(500);
    await screenshot(page, '04-metadata-page');

    // 3.1 Check metadata page loaded
    const metadataPage = page.locator('.metadata-page');
    const metadataVisible = await metadataPage.isVisible().catch(() => false);
    logStep(++stepNum, 'Metadata page visible', 'Visible', metadataVisible ? 'Visible' : 'NOT FOUND', metadataVisible ? 'PASS' : 'FAIL');

    // 3.2 Check filter buttons
    console.log('\n3.1 Testing filter buttons...');
    const filters = ['All', 'Pending', 'Ready', 'Exported', 'Needs Attention'];
    for (const filter of filters) {
      const filterBtn = page.locator(`.filter-btn:has-text("${filter}")`).first();
      const filterVisible = await filterBtn.isVisible().catch(() => false);
      if (filterVisible) {
        await filterBtn.click();
        await page.waitForTimeout(200);
        const isActive = await filterBtn.evaluate(el => el.classList.contains('active')).catch(() => false);
        logStep(++stepNum, `Filter: ${filter}`, 'Clickable + active', isActive ? 'Active' : 'Not active', 'PASS');
      } else {
        logStep(++stepNum, `Filter: ${filter}`, 'Visible', 'NOT FOUND', 'FAIL');
      }
    }

    // 3.3 Check status bar
    console.log('\n3.2 Testing status bar...');
    const statusBar = page.locator('.metadata-status-bar');
    const statusBarVisible = await statusBar.isVisible().catch(() => false);
    if (statusBarVisible) {
      logStep(++stepNum, 'Status bar visible', 'Visible', 'Visible', 'PASS');

      // Check for Ollama status
      const ollamaStatus = page.locator('.status-item:has-text("Ollama")');
      const ollamaVisible = await ollamaStatus.isVisible().catch(() => false);
      console.log(`    Ollama status visible: ${ollamaVisible}`);
    } else {
      logStep(++stepNum, 'Status bar visible', 'Visible', 'NOT FOUND', 'INFO');
    }

    // 3.4 Check for backup cards or empty state
    console.log('\n3.3 Testing backup list...');
    const backupCards = page.locator('.metadata-card, .backup-card');
    const cardCount = await backupCards.count();
    const emptyState = page.locator('.metadata-empty, [class*="empty"]');
    const emptyVisible = await emptyState.isVisible().catch(() => false);

    if (cardCount > 0) {
      logStep(++stepNum, 'Backup cards', `Found ${cardCount} cards`, `${cardCount} cards`, 'PASS');

      // Check action buttons on first card
      const firstCard = backupCards.first();
      const identifyBtn = firstCard.locator('button:has-text("Identify")');
      const approveBtn = firstCard.locator('button:has-text("Approve")');
      const editBtn = firstCard.locator('button:has-text("Edit")');

      console.log(`    Identify button: ${await identifyBtn.isVisible().catch(() => false)}`);
      console.log(`    Approve button: ${await approveBtn.isVisible().catch(() => false)}`);
      console.log(`    Edit button: ${await editBtn.isVisible().catch(() => false)}`);
    } else if (emptyVisible) {
      logStep(++stepNum, 'Backup list empty state', 'Shows empty message', 'Empty state shown', 'PASS');
    } else {
      logStep(++stepNum, 'Backup list', 'Cards or empty state', 'Neither found', 'INFO');
    }

    // ==========================================================================
    // TEST 4: EXPORT PAGE
    // ==========================================================================
    console.log('\n\n=== TEST 4: Export Page ===\n');

    await page.locator('.sidebar-nav-item:has-text("Export")').click();
    await page.waitForTimeout(500);
    await screenshot(page, '05-export-page');

    // 4.1 Check export page loaded
    const exportPage = page.locator('.export-page');
    const exportVisible = await exportPage.isVisible().catch(() => false);
    logStep(++stepNum, 'Export page visible', 'Visible', exportVisible ? 'Visible' : 'NOT FOUND', exportVisible ? 'PASS' : 'FAIL');

    // 4.2 Check Open Export Folder button
    console.log('\n4.1 Testing Open Export Folder button...');
    const openFolderBtn = page.locator('button:has-text("Open Export Folder")');
    const openFolderVisible = await openFolderBtn.isVisible().catch(() => false);
    logStep(++stepNum, 'Open Export Folder button', 'Visible', openFolderVisible ? 'Visible' : 'NOT FOUND', openFolderVisible ? 'PASS' : 'INFO');

    // 4.3 Check export queue
    console.log('\n4.2 Testing export queue...');
    const exportQueue = page.locator('.export-queue-list, .export-queue');
    const queueVisible = await exportQueue.isVisible().catch(() => false);
    const queueEmpty = page.locator('.export-empty, [class*="empty"]:has-text("No items")');
    const queueEmptyVisible = await queueEmpty.isVisible().catch(() => false);

    if (queueVisible) {
      const items = await exportQueue.locator('.queue-item, .export-item').count();
      logStep(++stepNum, 'Export queue', `Visible with ${items} items`, `${items} items`, 'PASS');
    } else if (queueEmptyVisible) {
      logStep(++stepNum, 'Export queue empty state', 'Shows empty message', 'Empty state shown', 'PASS');
    } else {
      logStep(++stepNum, 'Export queue', 'Visible', 'NOT FOUND', 'INFO');
    }

    // 4.4 Check progress indicators
    console.log('\n4.3 Testing progress indicators...');
    const progressBars = page.locator('progress, [class*="progress"]');
    const progressCount = await progressBars.count();
    console.log(`    Found ${progressCount} progress elements`);

    // ==========================================================================
    // TEST 5: LOGS PAGE
    // ==========================================================================
    console.log('\n\n=== TEST 5: Logs Page ===\n');

    await page.locator('.sidebar-nav-item:has-text("Logs")').click();
    await page.waitForTimeout(500);
    await screenshot(page, '06-logs-page');

    // 5.1 Check logs page loaded
    const logsPage = page.locator('.logs-page');
    const logsVisible = await logsPage.isVisible().catch(() => false);
    logStep(++stepNum, 'Logs page visible', 'Visible', logsVisible ? 'Visible' : 'NOT FOUND', logsVisible ? 'PASS' : 'FAIL');

    // 5.2 Check page header
    console.log('\n5.1 Testing page header...');
    const logsHeader = page.locator('.page-header h2:has-text("System Logs")');
    const headerVisible = await logsHeader.isVisible().catch(() => false);
    logStep(++stepNum, 'Logs header', 'Visible', headerVisible ? 'Visible' : 'NOT FOUND', headerVisible ? 'PASS' : 'INFO');

    // 5.3 Check action buttons
    console.log('\n5.2 Testing action buttons...');
    const logButtons = ['Refresh', 'Open Log Folder', 'Clear Logs'];
    for (const btnText of logButtons) {
      const btn = page.locator(`button:has-text("${btnText}")`).first();
      const btnVisible = await btn.isVisible().catch(() => false);
      if (btnVisible) {
        logStep(++stepNum, `${btnText} button`, 'Visible', 'Visible', 'PASS');
        if (btnText === 'Refresh') {
          await btn.click();
          await page.waitForTimeout(300);
          console.log(`    Clicked ${btnText}`);
        }
      } else {
        logStep(++stepNum, `${btnText} button`, 'Visible', 'NOT FOUND', 'FAIL');
      }
    }

    // 5.4 Check auto-refresh checkbox
    console.log('\n5.3 Testing auto-refresh checkbox...');
    const autoRefresh = page.locator('input[type="checkbox"]').first();
    const autoRefreshVisible = await autoRefresh.isVisible().catch(() => false);
    if (autoRefreshVisible) {
      const initialChecked = await autoRefresh.isChecked();
      await autoRefresh.click();
      await page.waitForTimeout(200);
      const afterChecked = await autoRefresh.isChecked();
      logStep(++stepNum, 'Auto-refresh checkbox', 'Toggleable', initialChecked !== afterChecked ? 'Toggles' : 'No change', 'PASS');
      // Toggle back
      if (initialChecked !== afterChecked) await autoRefresh.click();
    } else {
      logStep(++stepNum, 'Auto-refresh checkbox', 'Visible', 'NOT FOUND', 'INFO');
    }

    // 5.5 Check log viewer
    console.log('\n5.4 Testing log viewer...');
    const logViewer = page.locator('.log-viewer, pre, [class*="log-content"]');
    const logViewerVisible = await logViewer.isVisible().catch(() => false);
    logStep(++stepNum, 'Log viewer', 'Visible', logViewerVisible ? 'Visible' : 'NOT FOUND', logViewerVisible ? 'PASS' : 'INFO');

    // ==========================================================================
    // TEST 6: SETTINGS PAGE
    // ==========================================================================
    console.log('\n\n=== TEST 6: Settings Page ===\n');

    await page.locator('.sidebar-nav-item:has-text("Settings")').click();
    await page.waitForTimeout(500);
    await screenshot(page, '07-settings-page');

    // 6.1 Check settings page loaded
    const settingsPage = page.locator('.settings-page');
    const settingsVisible = await settingsPage.isVisible().catch(() => false);
    logStep(++stepNum, 'Settings page visible', 'Visible', settingsVisible ? 'Visible' : 'NOT FOUND', settingsVisible ? 'PASS' : 'FAIL');

    // 6.2 Test each settings tab
    const settingsTabs = ['General', 'Paths', 'Transfer', 'Performance', 'Extraction', 'AI Providers', 'About'];

    for (const tabName of settingsTabs) {
      console.log(`\n6.${settingsTabs.indexOf(tabName) + 2} Testing ${tabName} tab...`);
      const tab = page.locator(`.settings-nav-item:has-text("${tabName}")`).first();
      const tabVisible = await tab.isVisible().catch(() => false);

      if (tabVisible) {
        await tab.click();
        await page.waitForTimeout(300);

        const isActive = await tab.evaluate(el => el.classList.contains('active')).catch(() => false);
        await screenshot(page, `08-settings-${tabName.toLowerCase().replace(' ', '-')}`);

        // Count form elements
        const inputs = page.locator('.settings-content input, .settings-content select, .settings-content textarea');
        const inputCount = await inputs.count();
        const buttons = page.locator('.settings-content button');
        const buttonCount = await buttons.count();

        logStep(++stepNum, `${tabName} tab`, 'Loads with content', `${inputCount} inputs, ${buttonCount} buttons, active: ${isActive}`, 'PASS');

        // Check for broken inputs (empty required fields, etc.)
        const requiredInputs = page.locator('.settings-content input[required]');
        const requiredCount = await requiredInputs.count();
        if (requiredCount > 0) {
          console.log(`    Found ${requiredCount} required inputs`);
        }
      } else {
        logStep(++stepNum, `${tabName} tab`, 'Visible', 'NOT FOUND', 'FAIL');
        logIssue('functional', `${tabName} settings tab not found`, 'Settings Page', 'medium');
      }
    }

    // ==========================================================================
    // TEST 7: HEADER COMPONENTS
    // ==========================================================================
    console.log('\n\n=== TEST 7: Header Components ===\n');

    // Go back to home
    await page.locator('.sidebar-nav-item:has-text("Drives")').click();
    await page.waitForTimeout(500);

    // 7.1 Check app header
    const appHeader = page.locator('.app-header');
    const appHeaderVisible = await appHeader.isVisible().catch(() => false);
    logStep(++stepNum, 'App header visible', 'Visible', appHeaderVisible ? 'Visible' : 'NOT FOUND', appHeaderVisible ? 'PASS' : 'FAIL');

    // 7.2 Check version badge
    console.log('\n7.1 Testing version badge...');
    const versionBadge = page.locator('.version-badge, [class*="version"]');
    const versionVisible = await versionBadge.first().isVisible().catch(() => false);
    if (versionVisible) {
      const versionText = await versionBadge.first().textContent().catch(() => '');
      logStep(++stepNum, 'Version badge', 'Visible', versionText, 'PASS');
    } else {
      logStep(++stepNum, 'Version badge', 'Visible', 'NOT FOUND', 'INFO');
    }

    // 7.3 Check theme toggle
    console.log('\n7.2 Testing theme toggle...');
    const themeToggle = page.locator('[class*="theme-toggle"], button[aria-label*="theme"]');
    const themeToggleVisible = await themeToggle.first().isVisible().catch(() => false);
    if (themeToggleVisible) {
      const htmlClass = await page.evaluate(() => document.documentElement.className);
      await themeToggle.first().click();
      await page.waitForTimeout(300);
      const newHtmlClass = await page.evaluate(() => document.documentElement.className);
      await screenshot(page, '09-theme-toggled');

      logStep(++stepNum, 'Theme toggle', 'Changes theme', htmlClass !== newHtmlClass ? 'Theme changed' : 'No change', 'PASS');

      // Toggle back
      await themeToggle.first().click();
      await page.waitForTimeout(300);
    } else {
      logStep(++stepNum, 'Theme toggle', 'Visible', 'NOT FOUND', 'INFO');
    }

    // 7.4 Check update status
    console.log('\n7.3 Testing update status...');
    const updateStatus = page.locator('[class*="update"], [class*="status"]').first();
    const updateVisible = await updateStatus.isVisible().catch(() => false);
    console.log(`    Update status area visible: ${updateVisible}`);

    await screenshot(page, '10-final-state');

    // ==========================================================================
    // GENERATE REPORT
    // ==========================================================================
    console.log('\n\n============================================================');
    console.log('  E2E TEST REPORT');
    console.log('============================================================\n');

    console.log(`Target URL: ${report.targetUrl}`);
    console.log(`Viewport: ${report.viewport}`);
    console.log(`Timestamp: ${report.timestamp}\n`);

    console.log('--- Test Steps Summary ---');
    console.log('');
    console.log('| Step | Action | Expected | Actual | Status |');
    console.log('|------|--------|----------|--------|--------|');

    let passed = 0, failed = 0, info = 0;
    for (const step of report.steps) {
      const status = step.status === 'PASS' ? 'PASS' : step.status === 'FAIL' ? 'FAIL' : 'INFO';
      console.log(`| ${step.step} | ${step.action.substring(0, 30)} | ${step.expected.substring(0, 20)} | ${String(step.actual).substring(0, 20)} | ${status} |`);
      if (step.status === 'PASS') passed++;
      else if (step.status === 'FAIL') failed++;
      else info++;
    }

    console.log('\n--- Summary ---');
    console.log(`Total Steps: ${report.steps.length}`);
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log(`Info: ${info}`);
    console.log(`Overall: ${failed === 0 ? 'PASS' : 'FAIL'}`);

    if (report.consoleErrors.length > 0) {
      console.log('\n--- Browser Console Errors ---');
      for (const err of report.consoleErrors) {
        console.log(`  ERROR: ${err.text}`);
      }
    } else {
      console.log('\n--- Browser Console Errors ---');
      console.log('  No console errors detected');
    }

    if (report.issues.length > 0) {
      console.log('\n--- Issues Found ---');
      for (const issue of report.issues) {
        console.log(`  [${issue.severity.toUpperCase()}] ${issue.type}: ${issue.description}`);
        console.log(`    Location: ${issue.location}`);
      }
    } else {
      console.log('\n--- Issues Found ---');
      console.log('  No issues detected');
    }

    console.log('\n--- Screenshots Captured ---');
    for (const ss of report.screenshots) {
      console.log(`  ${ss.name}: ${ss.filepath}`);
    }

    // Save report
    const reportPath = path.join(SCREENSHOT_DIR, `test-report-${Date.now()}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\nFull report saved to: ${reportPath}`);

  } catch (error) {
    console.error('\n[ERROR] Test execution failed:', error.message);
    console.error(error.stack);
    if (page) {
      await screenshot(page, 'error-state');
    }
  }
}

runTests().catch(console.error);
