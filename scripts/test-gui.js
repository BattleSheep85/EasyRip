#!/usr/bin/env node
/**
 * GUI Test Runner for EasyRip
 * Launches Electron with remote debugging enabled for Playwright automation
 */

import { spawn, execSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..');

// Configuration
const DEBUG_PORT = 9222;
const VITE_PORT = 5173;

async function waitForPort(port, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const response = await fetch(`http://localhost:${port}`);
      if (response.ok || response.status === 404) return true;
    } catch {
      // Port not ready yet
    }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`Timeout waiting for port ${port}`);
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'start';

  console.log('[test-gui] EasyRip GUI Test Runner');
  console.log(`[test-gui] Command: ${command}`);

  if (command === 'start') {
    // Start Vite dev server
    console.log('[test-gui] Starting Vite dev server...');
    const vite = spawn('npm', ['run', 'dev'], {
      cwd: projectRoot,
      shell: true,
      stdio: 'inherit'
    });

    // Wait for Vite to be ready
    console.log('[test-gui] Waiting for Vite...');
    await waitForPort(VITE_PORT);
    console.log('[test-gui] Vite is ready!');

    // Start Electron with remote debugging
    console.log(`[test-gui] Starting Electron with debugging on port ${DEBUG_PORT}...`);
    const electron = spawn('npx', [
      'electron',
      '.',
      `--remote-debugging-port=${DEBUG_PORT}`
    ], {
      cwd: projectRoot,
      shell: true,
      stdio: 'inherit',
      env: {
        ...process.env,
        NODE_ENV: 'development'
      }
    });

    console.log(`[test-gui] Electron started with remote debugging on port ${DEBUG_PORT}`);
    console.log('[test-gui] Connect Playwright to: http://localhost:9222');

    // Handle cleanup
    process.on('SIGINT', () => {
      console.log('\n[test-gui] Shutting down...');
      electron.kill();
      vite.kill();
      process.exit(0);
    });

    // Wait for processes
    await new Promise((resolve) => {
      electron.on('close', resolve);
    });

  } else if (command === 'connect-info') {
    // Just print connection info
    console.log(`
Playwright Connection Info:
===========================
Debug Port: ${DEBUG_PORT}
URL: http://localhost:${DEBUG_PORT}

To connect with Playwright MCP:
1. Start the app with: node scripts/test-gui.js start
2. Use browser_navigate to go to http://localhost:5173
3. Use browser_snapshot to see the page structure
4. Use browser_click, browser_type, etc. to interact
`);

  } else {
    console.log(`
Usage: node scripts/test-gui.js <command>

Commands:
  start         Start Vite + Electron with remote debugging
  connect-info  Show Playwright connection info
`);
  }
}

main().catch(err => {
  console.error('[test-gui] Error:', err);
  process.exit(1);
});
