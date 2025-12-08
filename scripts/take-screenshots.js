import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function takeScreenshots() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 }
  });
  const page = await context.newPage();

  try {
    // Navigate to the app
    await page.goto('http://localhost:5173');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000); // Wait for any animations

    const screenshotsDir = join(__dirname, '..', 'docs', 'screenshots');

    console.log('Taking screenshot 1: Main drives page (home)...');
    await page.screenshot({
      path: join(screenshotsDir, '01-home.png'),
      fullPage: false
    });

    console.log('Taking screenshot 2: Settings page (General tab)...');
    // Navigate to Settings using hash route
    await page.goto('http://localhost:5173/#/settings');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
    await page.screenshot({
      path: join(screenshotsDir, '02-settings-general.png'),
      fullPage: false
    });

    console.log('Taking screenshot 3: Metadata Manager page...');
    // Navigate to Metadata Manager
    await page.goto('http://localhost:5173/#/metadata');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
    await page.screenshot({
      path: join(screenshotsDir, '03-metadata-manager.png'),
      fullPage: false
    });

    console.log('Taking screenshot 4: Export Manager page...');
    // Navigate to Export Manager
    await page.goto('http://localhost:5173/#/export');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
    await page.screenshot({
      path: join(screenshotsDir, '04-export-manager.png'),
      fullPage: false
    });

    console.log('Taking screenshot 5: Logs page...');
    // Navigate to Logs page
    await page.goto('http://localhost:5173/#/logs');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
    await page.screenshot({
      path: join(screenshotsDir, '05-logs.png'),
      fullPage: false
    });

    console.log('Taking screenshot 6: Dark mode view...');
    // Go back to home
    await page.goto('http://localhost:5173');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    // Toggle dark mode using aria-label
    const themeToggle = page.locator('button[aria-label="Toggle theme"]');
    await themeToggle.click();
    await page.waitForTimeout(500);
    await page.screenshot({
      path: join(screenshotsDir, '06-dark-mode.png'),
      fullPage: false
    });

    console.log('All screenshots captured successfully!');
  } catch (error) {
    console.error('Error taking screenshots:', error);
    throw error;
  } finally {
    await browser.close();
  }
}

takeScreenshots().catch(console.error);
