// Design Audit Script - Connects to EasyRip via debugging port
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const SCREENSHOTS_DIR = 'C:/Users/Chris/Documents/Coding/EasyRip/tests/audit-screenshots';

async function runAudit() {
  // Clean and recreate screenshots directory
  if (fs.existsSync(SCREENSHOTS_DIR)) {
    fs.rmSync(SCREENSHOTS_DIR, { recursive: true });
  }
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

  console.log('Connecting to EasyRip via CDP on port 9222...');

  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const contexts = browser.contexts();
  const context = contexts[0];
  const pages = context.pages();

  // Find the EasyRip page (not DevTools)
  const page = pages.find(p => p.url().includes('localhost:5173'));

  if (!page) {
    console.error('Could not find EasyRip page!');
    console.log('Available pages:', pages.map(p => p.url()));
    process.exit(1);
  }

  console.log('Connected to:', page.url());

  // Set a proper viewport
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(500);

  // Helper to take screenshots
  async function screenshot(name) {
    const filename = path.join(SCREENSHOTS_DIR, `${name}.png`);
    await page.screenshot({ path: filename, fullPage: true });
    console.log(`Screenshot: ${name}.png`);
    return filename;
  }

  try {
    // ==== HOME PAGE (DRIVES) ====
    console.log('\n=== HOME PAGE (DRIVES) ===');
    // Click sidebar nav to ensure we're on drives page
    const drivesNav = await page.$('.sidebar-nav-item:has-text("Drives")');
    if (drivesNav) {
      await drivesNav.click();
      await page.waitForTimeout(1000);
    }
    await screenshot('01-drives');

    // ==== METADATA PAGE ====
    console.log('\n=== METADATA PAGE ===');
    const metadataNav = await page.$('.sidebar-nav-item:has-text("Metadata")');
    if (metadataNav) {
      await metadataNav.click();
      await page.waitForTimeout(1000);
      await screenshot('02-metadata');
    }

    // ==== EXPORT PAGE ====
    console.log('\n=== EXPORT PAGE ===');
    const exportNav = await page.$('.sidebar-nav-item:has-text("Export")');
    if (exportNav) {
      await exportNav.click();
      await page.waitForTimeout(1000);
      await screenshot('03-export');
    }

    // ==== LOGS PAGE ====
    console.log('\n=== LOGS PAGE ===');
    const logsNav = await page.$('.sidebar-nav-item:has-text("Logs")');
    if (logsNav) {
      await logsNav.click();
      await page.waitForTimeout(1000);
      await screenshot('04-logs');
    }

    // ==== SETTINGS PAGE - ALL TABS ====
    console.log('\n=== SETTINGS PAGE ===');
    const settingsNav = await page.$('.sidebar-nav-item:has-text("Settings")');
    if (settingsNav) {
      await settingsNav.click();
      await page.waitForTimeout(1000);
      await screenshot('05-settings-general');

      // Navigate through all settings tabs
      const settingsTabs = ['Paths', 'LLM', 'Export', 'Dependencies', 'Updates', 'About'];
      for (const tabName of settingsTabs) {
        const tab = await page.$(`.settings-nav-item:has-text("${tabName}")`);
        if (tab) {
          await tab.click();
          await page.waitForTimeout(500);
          await screenshot(`05-settings-${tabName.toLowerCase()}`);
        }
      }
    }

    // ==== DARK MODE ====
    console.log('\n=== DARK MODE ===');
    // Go to General settings tab first
    const generalTab = await page.$('.settings-nav-item:has-text("General")');
    if (generalTab) {
      await generalTab.click();
      await page.waitForTimeout(500);
    }
    // Find and click dark theme option
    const darkTheme = await page.$('.theme-option[data-theme="dark"], [data-theme="dark"]');
    if (darkTheme) {
      await darkTheme.click();
      await page.waitForTimeout(500);
      await screenshot('06-dark-settings');

      // Go back to drives page in dark mode
      const drivesNavDark = await page.$('.sidebar-nav-item:has-text("Drives")');
      if (drivesNavDark) {
        await drivesNavDark.click();
        await page.waitForTimeout(1000);
        await screenshot('06-dark-drives');
      }

      // Switch back to light mode
      const settingsNavAgain = await page.$('.sidebar-nav-item:has-text("Settings")');
      if (settingsNavAgain) {
        await settingsNavAgain.click();
        await page.waitForTimeout(500);
        const generalTabAgain = await page.$('.settings-nav-item:has-text("General")');
        if (generalTabAgain) await generalTabAgain.click();
        await page.waitForTimeout(500);
        const lightTheme = await page.$('.theme-option[data-theme="light"], [data-theme="light"]');
        if (lightTheme) await lightTheme.click();
      }
    }

    // ==== RESPONSIVE - NARROW WIDTH ====
    console.log('\n=== RESPONSIVE TEST ===');
    const drivesNavFinal = await page.$('.sidebar-nav-item:has-text("Drives")');
    if (drivesNavFinal) await drivesNavFinal.click();
    await page.waitForTimeout(500);

    await page.setViewportSize({ width: 900, height: 700 });
    await page.waitForTimeout(500);
    await screenshot('07-responsive-900');

    await page.setViewportSize({ width: 1600, height: 900 });
    await page.waitForTimeout(500);
    await screenshot('07-responsive-1600');

    console.log('\n=== AUDIT COMPLETE ===');
    console.log(`Screenshots saved to: ${SCREENSHOTS_DIR}`);

  } catch (error) {
    console.error('Audit error:', error);
    await screenshot('error-state');
  }
}

runAudit().catch(console.error);
