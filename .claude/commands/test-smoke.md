# Quick Smoke Test

Run a quick smoke test to verify EasyRip is functioning.

## Instructions

Perform these quick checks using Playwright MCP:

1. **Navigate** to http://localhost:5173
2. **Snapshot** the page
3. **Verify** these elements exist:
   - Header with "EasyRip"
   - "Refresh Drives" button
   - "Backup All" button
   - "Settings" button
   - "Logs" button
   - Drives table
   - Log panel

4. **Click** "Refresh Drives" and wait for scan
5. **Click** "Settings", verify modal, click "Cancel"
6. **Click** "Logs", verify modal, close it

Report results as:
- PASS: All checks passed
- FAIL: List what failed

This should take under 30 seconds.
