# EasyRip GUI Test Scenarios

This document defines automated GUI test scenarios for EasyRip.
These are executed by Claude Code using the Playwright MCP.

## Prerequisites

1. Start app with debugging: `npm run test:gui:debug`
2. Ensure Playwright MCP is connected in Claude Code
3. Navigate to: http://localhost:5173

---

## Test Scenario 1: App Startup

**Objective**: Verify app loads correctly with all UI elements

**Steps**:
1. Navigate to http://localhost:5173
2. Take accessibility snapshot
3. Verify header shows "EasyRip"
4. Verify toolbar has "Refresh Drives" and "Backup All" buttons
5. Verify drives panel exists
6. Verify log panel exists
7. Verify footer shows base path

**Expected Results**:
- All UI elements present
- No console errors
- Status bar shows drive count

---

## Test Scenario 2: Drive Detection

**Objective**: Verify drive scanning works

**Steps**:
1. Click "Refresh Drives" button
2. Wait for scanning to complete (button text changes)
3. Check drives table for disc information
4. Verify each drive shows: Letter, Type, Name, Size, Status

**Expected Results**:
- Drives with discs appear in table
- Empty drives not shown
- Status shows "Ready" for unbackped discs

---

## Test Scenario 3: Settings Modal

**Objective**: Verify settings can be opened and saved

**Steps**:
1. Click "Settings" button in header
2. Verify modal appears
3. Check MakeMKV path field exists
4. Check Base path field exists
5. Click "Cancel" to close
6. Verify modal closes

**Expected Results**:
- Modal opens/closes correctly
- Fields show current settings
- Cancel doesn't save changes

---

## Test Scenario 4: Backup Already Exists

**Objective**: Verify "Done" status for existing backups

**Steps**:
1. Scan drives
2. Find a disc that's already backed up
3. Verify status shows "Done" (green)
4. Verify "Re-do" button is available
5. Click "Re-do" button
6. Verify confirmation or backup starts

**Expected Results**:
- Existing backups detected
- Re-backup option available

---

## Test Scenario 5: Start Single Backup

**Objective**: Verify single disc backup workflow

**Steps**:
1. Scan drives
2. Find disc with "Ready" status
3. Click "Backup" button for that drive
4. Verify status changes to "Running"
5. Verify progress bar animates
6. Monitor log panel for progress messages
7. Wait for completion (or cancel after 30s for test)

**Expected Results**:
- Status transitions: Ready → Running → Complete
- Progress updates in real-time
- Log shows backup stages

---

## Test Scenario 6: Cancel Backup

**Objective**: Verify backup cancellation works

**Steps**:
1. Start a backup
2. Wait for status to show "Running"
3. Click "Cancel" button
4. Verify status returns to "Ready" or "Idle"
5. Check log for cancellation message

**Expected Results**:
- Backup stops immediately
- Temp files cleaned up
- UI returns to ready state

---

## Test Scenario 7: System Logs Modal

**Objective**: Verify log viewer works

**Steps**:
1. Click "Logs" button in header
2. Verify modal opens with log content
3. Verify "Open Log Folder" button exists
4. Click "Close" to dismiss

**Expected Results**:
- Logs display correctly
- Recent entries visible
- Modal dismisses cleanly

---

## Test Scenario 8: Error Handling

**Objective**: Verify error states display correctly

**Steps**:
1. Trigger an error (e.g., invalid MakeMKV path)
2. Verify error banner appears
3. Verify error message is descriptive
4. Click X to dismiss error
5. Verify banner disappears

**Expected Results**:
- Errors clearly visible
- Dismissible
- Don't block UI

---

## Test Scenario 9: Backup All

**Objective**: Verify multi-disc backup

**Steps**:
1. Ensure multiple discs are ready
2. Click "Backup All" button
3. Verify all eligible drives start
4. Verify each shows "Running" status
5. Monitor parallel progress

**Expected Results**:
- All drives start simultaneously
- Individual progress tracking
- No conflicts between backups

---

## Test Scenario 10: UI Responsiveness

**Objective**: Verify UI remains responsive during backup

**Steps**:
1. Start a backup
2. While running, click "Refresh Drives"
3. Verify scan completes
4. Open Settings modal
5. Verify modal is responsive
6. Close modal

**Expected Results**:
- UI not blocked during backup
- All actions remain functional

---

## Execution Notes

To run these tests with Claude Code:

1. Start the app: `npm run test:gui:debug`
2. Use `/test-gui` slash command
3. Or manually:
   - `browser_navigate` to http://localhost:5173
   - `browser_snapshot` to see page structure
   - `browser_click` on elements by ref
   - `browser_type` for text input

## Bug Reporting Format

When a test fails, report:
- Scenario name
- Step that failed
- Expected vs actual behavior
- Screenshot (if applicable)
- Console errors
- Relevant log entries
