#!/usr/bin/env node
/**
 * Check if EasyRip app is running with debugging enabled
 * Used by Claude Code before running GUI tests
 */

async function checkApp() {
  const DEBUG_PORT = 9222;
  const VITE_PORT = 5173;

  const results = {
    vite: false,
    electron: false,
    ready: false
  };

  // Check Vite
  try {
    const response = await fetch(`http://localhost:${VITE_PORT}`);
    results.vite = response.ok || response.status === 200;
  } catch {
    results.vite = false;
  }

  // Check Electron debug port
  try {
    const response = await fetch(`http://localhost:${DEBUG_PORT}/json/version`);
    results.electron = response.ok;
  } catch {
    results.electron = false;
  }

  results.ready = results.vite && results.electron;

  // Output JSON for parsing
  console.log(JSON.stringify(results, null, 2));

  if (!results.ready) {
    console.error('\n[check-app] App not ready for GUI testing');
    if (!results.vite) {
      console.error('  - Vite dev server not running (port 5173)');
    }
    if (!results.electron) {
      console.error('  - Electron not running with debugging (port 9222)');
    }
    console.error('\nStart with: npm run test:gui:debug');
    process.exit(1);
  }

  console.log('\n[check-app] App is ready for GUI testing!');
  process.exit(0);
}

checkApp();
