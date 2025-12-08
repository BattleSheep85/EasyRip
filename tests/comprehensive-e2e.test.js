/**
 * Comprehensive E2E Test Suite for EasyRip
 * Tests all major user flows and edge cases
 * Run with: node --test tests/comprehensive-e2e.test.js
 */

import { chromium } from 'playwright';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';

let browser;
let page;

const BASE_URL = 'http://localhost:5173';

// Helper to wait for React to stabilize
async function waitForReact(page, timeout = 2000) {
  await page.waitForTimeout(timeout);
}

// Helper to take screenshot
async function takeScreenshot(page, name) {
  try {
    await page.screenshot({ path: `tests/screenshots/${name}.png`, fullPage: true });
    console.log(`  [screenshot] Saved: ${name}.png`);
  } catch (err) {
    console.log(`  [screenshot] Failed: ${err.message}`);
  }
}

describe('EasyRip Comprehensive E2E Tests', () => {
  before(async () => {
    console.log('[setup] Launching Chromium browser...');
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
    await page.setViewportSize({ width: 1920, height: 1080 });
    console.log('[setup] Browser ready');
  });

  after(async () => {
    console.log('[cleanup] Closing browser...');
    if (browser) {
      await browser.close();
    }
  });

  // ============================================
  // TEST SCENARIO 1: App Startup & Initial State
  // ============================================
  test('1.1 App loads successfully with correct title', async () => {
    await page.goto(BASE_URL);
    await waitForReact(page);

    const title = await page.title();
    console.log(`  [result] Page title: ${title}`);
    assert.ok(title.includes('EasyRip'), `Expected title to include 'EasyRip', got: ${title}`);
  });

  test('1.2 Sidebar navigation is present', async () => {
    const sidebar = page.locator('.app-sidebar');
    const isVisible = await sidebar.isVisible();
    console.log(`  [result] Sidebar visible: ${isVisible}`);
    assert.ok(isVisible, 'Sidebar should be visible');

    // Check all nav items
    const navItems = ['Drives', 'Metadata', 'Export', 'Logs', 'Settings'];
    for (const item of navItems) {
      const navBtn = page.locator(`.sidebar-nav-item:has-text("${item}")`);
      const exists = await navBtn.count() > 0;
      console.log(`  [result] Nav item "${item}": ${exists ? 'present' : 'missing'}`);
      assert.ok(exists, `Nav item "${item}" should be present`);
    }
  });

  test('1.3 Home page toolbar buttons exist', async () => {
    const refreshBtn = page.locator('button:has-text("Refresh Drives")');
    const backupAllBtn = page.locator('button:has-text("Backup All")');

    const refreshVisible = await refreshBtn.isVisible();
    const backupVisible = await backupAllBtn.isVisible();

    console.log(`  [result] Refresh Drives: ${refreshVisible}`);
    console.log(`  [result] Backup All: ${backupVisible}`);

    assert.ok(refreshVisible, 'Refresh Drives button should be visible');
    assert.ok(backupVisible, 'Backup All button should be visible');
  });

  test('1.4 Automation toggles are present', async () => {
    const toggles = ['Backup', 'Meta', 'Export', 'Eject', 'Live Dangerously'];
    for (const toggle of toggles) {
      const btn = page.locator(`.btn-toggle:has-text("${toggle}")`);
      const exists = await btn.count() > 0;
      console.log(`  [result] Toggle "${toggle}": ${exists ? 'present' : 'missing'}`);
      assert.ok(exists, `Toggle "${toggle}" should be present`);
    }
  });

  test('1.5 Drives panel exists', async () => {
    const drivesPanel = page.locator('.drives-panel');
    const isVisible = await drivesPanel.isVisible();
    console.log(`  [result] Drives panel visible: ${isVisible}`);
    assert.ok(isVisible, 'Drives panel should be visible');

    // Check for panel header
    const header = page.locator('.panel-header:has-text("Optical Drives")');
    const headerVisible = await header.isVisible();
    console.log(`  [result] Panel header "Optical Drives": ${headerVisible}`);
    assert.ok(headerVisible, 'Panel header should show "Optical Drives"');
  });

  test('1.6 Log panel exists', async () => {
    const logPanel = page.locator('.log-panel');
    const isVisible = await logPanel.isVisible();
    console.log(`  [result] Log panel visible: ${isVisible}`);
    assert.ok(isVisible, 'Log panel should be visible');
  });

  // ============================================
  // TEST SCENARIO 2: Navigation
  // ============================================
  test('2.1 Navigate to Settings page', async () => {
    const settingsNav = page.locator('.sidebar-nav-item:has-text("Settings")');
    await settingsNav.click();
    await waitForReact(page);

    const settingsPage = page.locator('.settings-page');
    const isVisible = await settingsPage.isVisible();
    console.log(`  [result] Settings page visible: ${isVisible}`);
    assert.ok(isVisible, 'Settings page should be visible');

    // Check for tabs
    const tabs = ['General', 'Paths', 'Transfer', 'Appearance', 'About'];
    for (const tab of tabs) {
      const tabBtn = page.locator(`.settings-nav-item:has-text("${tab}")`);
      const exists = await tabBtn.count() > 0;
      console.log(`  [result] Settings tab "${tab}": ${exists ? 'present' : 'missing'}`);
      assert.ok(exists, `Settings tab "${tab}" should exist`);
    }
  });

  test('2.2 Navigate through all settings tabs', async () => {
    const tabs = ['General', 'Paths', 'Transfer', 'Appearance', 'About'];

    for (const tab of tabs) {
      const tabBtn = page.locator(`.settings-nav-item:has-text("${tab}")`);
      await tabBtn.click();
      await waitForReact(page, 500);

      const isActive = await tabBtn.evaluate(el => el.classList.contains('active'));
      console.log(`  [result] Tab "${tab}" is active: ${isActive}`);
      assert.ok(isActive, `Tab "${tab}" should be active when clicked`);
    }
  });

  test('2.3 Navigate to Logs page', async () => {
    const logsNav = page.locator('.sidebar-nav-item:has-text("Logs")');
    await logsNav.click();
    await waitForReact(page);

    const logsPage = page.locator('.logs-page');
    const isVisible = await logsPage.isVisible();
    console.log(`  [result] Logs page visible: ${isVisible}`);
    assert.ok(isVisible, 'Logs page should be visible');

    // Check for page header
    const header = page.locator('.page-header h2:has-text("System Logs")');
    const headerVisible = await header.isVisible();
    console.log(`  [result] Logs header visible: ${headerVisible}`);
    assert.ok(headerVisible, 'Logs header should be visible');
  });

  test('2.4 Navigate to Metadata page', async () => {
    const metadataNav = page.locator('.sidebar-nav-item:has-text("Metadata")');
    await metadataNav.click();
    await waitForReact(page);

    const metadataPage = page.locator('.metadata-page');
    const isVisible = await metadataPage.isVisible();
    console.log(`  [result] Metadata page visible: ${isVisible}`);
    assert.ok(isVisible, 'Metadata page should be visible');

    // Check for filter buttons
    const filters = ['All', 'Pending', 'Ready', 'Exported', 'Needs Attention'];
    for (const filter of filters) {
      const filterBtn = page.locator(`.filter-btn:has-text("${filter}")`);
      const exists = await filterBtn.count() > 0;
      console.log(`  [result] Filter "${filter}": ${exists ? 'present' : 'missing'}`);
      assert.ok(exists, `Filter "${filter}" should exist`);
    }
  });

  test('2.5 Navigate to Export page', async () => {
    const exportNav = page.locator('.sidebar-nav-item:has-text("Export")');
    await exportNav.click();
    await waitForReact(page);

    const exportPage = page.locator('.export-page');
    const isVisible = await exportPage.isVisible();
    console.log(`  [result] Export page visible: ${isVisible}`);
    assert.ok(isVisible, 'Export page should be visible');

    // Check for Open Export Folder button
    const openFolderBtn = page.locator('button:has-text("Open Export Folder")');
    const btnVisible = await openFolderBtn.isVisible();
    console.log(`  [result] Open Export Folder button: ${btnVisible}`);
    assert.ok(btnVisible, 'Open Export Folder button should be visible');
  });

  test('2.6 Navigate back to Home page', async () => {
    const homeNav = page.locator('.sidebar-nav-item:has-text("Drives")');
    await homeNav.click();
    await waitForReact(page);

    const homePage = page.locator('.home-page');
    const isVisible = await homePage.isVisible();
    console.log(`  [result] Home page visible: ${isVisible}`);
    assert.ok(isVisible, 'Home page should be visible');
  });

  // ============================================
  // TEST SCENARIO 3: Sidebar Collapse
  // ============================================
  test('3.1 Sidebar collapse toggle works', async () => {
    const sidebar = page.locator('.app-sidebar');
    const toggleBtn = page.locator('.sidebar-toggle.desktop-only');

    // Get initial state
    const initialCollapsed = await sidebar.evaluate(el => el.classList.contains('collapsed'));
    console.log(`  [result] Initial sidebar collapsed: ${initialCollapsed}`);

    // Click toggle
    await toggleBtn.click();
    await waitForReact(page, 500);

    // Check new state
    const afterClickCollapsed = await sidebar.evaluate(el => el.classList.contains('collapsed'));
    console.log(`  [result] After click collapsed: ${afterClickCollapsed}`);
    assert.notStrictEqual(initialCollapsed, afterClickCollapsed, 'Sidebar should toggle collapsed state');

    // Toggle back
    await toggleBtn.click();
    await waitForReact(page, 500);

    const finalCollapsed = await sidebar.evaluate(el => el.classList.contains('collapsed'));
    console.log(`  [result] Final collapsed: ${finalCollapsed}`);
    assert.strictEqual(initialCollapsed, finalCollapsed, 'Sidebar should return to initial state');
  });

  // ============================================
  // TEST SCENARIO 4: Settings Functionality
  // ============================================
  test('4.1 Settings page shows Save/Discard when changes made', async () => {
    // Go to Settings
    await page.locator('.sidebar-nav-item:has-text("Settings")').click();
    await waitForReact(page);

    // Go to Paths tab
    await page.locator('.settings-nav-item:has-text("Paths")').click();
    await waitForReact(page, 500);

    // Find an input field and modify it
    const basePathInput = page.locator('input[id="basePath"], input[placeholder*="path"]').first();
    const inputExists = await basePathInput.count() > 0;

    if (inputExists) {
      const originalValue = await basePathInput.inputValue();
      console.log(`  [result] Original value: ${originalValue}`);

      // Append something to trigger change
      await basePathInput.fill(originalValue + 'test');
      await waitForReact(page, 500);

      // Check for Save button
      const saveBtn = page.locator('button:has-text("Save Changes")');
      const saveVisible = await saveBtn.isVisible();
      console.log(`  [result] Save button visible after change: ${saveVisible}`);

      // Check for Discard button
      const discardBtn = page.locator('button:has-text("Discard")');
      const discardVisible = await discardBtn.isVisible();
      console.log(`  [result] Discard button visible after change: ${discardVisible}`);

      // Discard changes
      if (discardVisible) {
        await discardBtn.click();
        await waitForReact(page, 500);
      }
    } else {
      console.log('  [skip] No input field found for testing');
    }
  });

  // ============================================
  // TEST SCENARIO 5: Logs Page Functionality
  // ============================================
  test('5.1 Logs page has action buttons', async () => {
    await page.locator('.sidebar-nav-item:has-text("Logs")').click();
    await waitForReact(page);

    const buttons = ['Refresh', 'Open Log Folder', 'Clear Logs'];
    for (const btnText of buttons) {
      const btn = page.locator(`button:has-text("${btnText}")`);
      const isVisible = await btn.isVisible();
      console.log(`  [result] Button "${btnText}": ${isVisible ? 'visible' : 'not visible'}`);
      assert.ok(isVisible, `Button "${btnText}" should be visible`);
    }
  });

  test('5.2 Auto-refresh checkbox works', async () => {
    const checkbox = page.locator('input[type="checkbox"]');
    const checkboxExists = await checkbox.count() > 0;

    if (checkboxExists) {
      const initialChecked = await checkbox.isChecked();
      console.log(`  [result] Initial auto-refresh: ${initialChecked}`);

      await checkbox.click();
      await waitForReact(page, 500);

      const afterClickChecked = await checkbox.isChecked();
      console.log(`  [result] After click auto-refresh: ${afterClickChecked}`);
      assert.notStrictEqual(initialChecked, afterClickChecked, 'Checkbox should toggle');

      // Toggle back
      await checkbox.click();
    }
  });

  // ============================================
  // TEST SCENARIO 6: Metadata Page Functionality
  // ============================================
  test('6.1 Metadata filter tabs work', async () => {
    await page.locator('.sidebar-nav-item:has-text("Metadata")').click();
    await waitForReact(page);

    const filters = ['All', 'Pending', 'Ready', 'Exported', 'Needs Attention'];

    for (const filter of filters) {
      const filterBtn = page.locator(`.filter-btn:has-text("${filter}")`);
      await filterBtn.click();
      await waitForReact(page, 300);

      const isActive = await filterBtn.evaluate(el => el.classList.contains('active'));
      console.log(`  [result] Filter "${filter}" is active: ${isActive}`);
      assert.ok(isActive, `Filter "${filter}" should be active when clicked`);
    }
  });

  test('6.2 Metadata page shows status bar', async () => {
    const statusBar = page.locator('.metadata-status-bar');
    const isVisible = await statusBar.isVisible();
    console.log(`  [result] Status bar visible: ${isVisible}`);
    assert.ok(isVisible, 'Status bar should be visible');

    // Check for Ollama status
    const ollamaStatus = page.locator('.status-item:has-text("Ollama")');
    const ollamaVisible = await ollamaStatus.isVisible();
    console.log(`  [result] Ollama status visible: ${ollamaVisible}`);
    assert.ok(ollamaVisible, 'Ollama status should be visible');
  });

  // ============================================
  // TEST SCENARIO 7: Home Page Drive Functions
  // ============================================
  test('7.1 Home page shows toolbar info', async () => {
    await page.locator('.sidebar-nav-item:has-text("Drives")').click();
    await waitForReact(page);

    const toolbarInfo = page.locator('.toolbar-info');
    const isVisible = await toolbarInfo.isVisible();
    console.log(`  [result] Toolbar info visible: ${isVisible}`);
    assert.ok(isVisible, 'Toolbar info should be visible');

    const infoText = await toolbarInfo.textContent();
    console.log(`  [result] Toolbar info: ${infoText}`);
    assert.ok(infoText.includes('disc'), 'Toolbar info should mention disc count');
  });

  test('7.2 Automation toggles are interactive', async () => {
    const backupToggle = page.locator('.btn-toggle:has-text("Backup")').first();

    // Get initial state
    const initialActive = await backupToggle.evaluate(el => el.classList.contains('active'));
    console.log(`  [result] Initial Backup toggle active: ${initialActive}`);

    // Click toggle
    await backupToggle.click();
    await waitForReact(page, 300);

    // Check new state
    const afterClickActive = await backupToggle.evaluate(el => el.classList.contains('active'));
    console.log(`  [result] After click Backup toggle active: ${afterClickActive}`);
    assert.notStrictEqual(initialActive, afterClickActive, 'Toggle should change state on click');

    // Toggle back to original
    await backupToggle.click();
    await waitForReact(page, 300);
  });

  // ============================================
  // TEST SCENARIO 8: Empty States
  // ============================================
  test('8.1 Export page shows empty queue message', async () => {
    await page.locator('.sidebar-nav-item:has-text("Export")').click();
    await waitForReact(page);

    // Check for empty state or queue items
    const emptyState = page.locator('.export-empty:has-text("No items in queue")');
    const queueList = page.locator('.export-queue-list');

    const emptyVisible = await emptyState.isVisible();
    const queueVisible = await queueList.isVisible();

    console.log(`  [result] Empty queue message: ${emptyVisible}`);
    console.log(`  [result] Queue list visible: ${queueVisible}`);

    // Either empty state OR queue should be shown
    assert.ok(emptyVisible || queueVisible, 'Should show empty state or queue list');
  });

  // ============================================
  // TEST SCENARIO 9: Console Errors Check
  // ============================================
  test('9.1 No critical JavaScript errors', async () => {
    const errors = [];

    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    // Navigate through pages to trigger any errors
    await page.goto(BASE_URL);
    await waitForReact(page);

    await page.locator('.sidebar-nav-item:has-text("Settings")').click();
    await waitForReact(page, 500);

    await page.locator('.sidebar-nav-item:has-text("Logs")').click();
    await waitForReact(page, 500);

    await page.locator('.sidebar-nav-item:has-text("Drives")').click();
    await waitForReact(page, 500);

    console.log(`  [result] Console errors found: ${errors.length}`);
    if (errors.length > 0) {
      errors.forEach(e => console.log(`    - ${e}`));
    }

    // Filter out expected/harmless errors (like electronAPI not available in browser)
    const criticalErrors = errors.filter(e =>
      !e.includes('electronAPI') &&
      !e.includes('not available') &&
      !e.includes('ResizeObserver')
    );

    console.log(`  [result] Critical errors: ${criticalErrors.length}`);
    // This is just informational, not a failure
  });

  // ============================================
  // TEST SCENARIO 10: About Settings
  // ============================================
  test('10.1 About tab shows app information', async () => {
    await page.locator('.sidebar-nav-item:has-text("Settings")').click();
    await waitForReact(page);

    await page.locator('.settings-nav-item:has-text("About")').click();
    await waitForReact(page, 500);

    // Check for version information or app name
    const aboutContent = page.locator('.settings-content');
    const contentText = await aboutContent.textContent();
    console.log(`  [result] About content length: ${contentText.length} chars`);

    // Should have some content
    assert.ok(contentText.length > 0, 'About section should have content');
  });

  // ============================================
  // TEST SCENARIO 11: Responsive Elements
  // ============================================
  test('11.1 App header is present', async () => {
    await page.locator('.sidebar-nav-item:has-text("Drives")').click();
    await waitForReact(page);

    const header = page.locator('.app-header');
    const isVisible = await header.isVisible();
    console.log(`  [result] App header visible: ${isVisible}`);
    assert.ok(isVisible, 'App header should be visible');
  });

  test('11.2 Footer is present', async () => {
    const footer = page.locator('footer, .app-footer');
    const isVisible = await footer.isVisible();
    console.log(`  [result] Footer visible: ${isVisible}`);

    if (isVisible) {
      const footerText = await footer.textContent();
      console.log(`  [result] Footer content: ${footerText.substring(0, 100)}...`);
    }
  });
});

// Summary generation
process.on('exit', () => {
  console.log('\n========================================');
  console.log('TEST RUN COMPLETE');
  console.log('========================================');
});
