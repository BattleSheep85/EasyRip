# GUI Test Runner

Run automated GUI tests on EasyRip using Playwright MCP.

## Instructions

You are running GUI tests on EasyRip. The app should be running with `npm run test:gui:debug`.

### Test Execution Steps:

1. First, use `browser_navigate` to go to http://localhost:5173
2. Use `browser_snapshot` to capture the current page state
3. Execute the test scenarios from `tests/gui-scenarios.md`
4. Report results in a structured format

### Available Playwright MCP Tools:

- `browser_navigate` - Go to a URL
- `browser_snapshot` - Get accessibility tree (preferred over screenshots)
- `browser_click` - Click an element by ref
- `browser_type` - Type text into an element
- `browser_press_key` - Press keyboard keys
- `browser_wait_for` - Wait for text to appear/disappear

### Test Flow:

1. **Navigate** to the app
2. **Snapshot** to see all elements
3. **Interact** with buttons, fields
4. **Verify** expected behavior
5. **Report** pass/fail with details

### Quick Test (Smoke Test):

Run these basic checks:
1. App loads with header "EasyRip"
2. "Refresh Drives" button exists and is clickable
3. Settings modal opens and closes
4. Logs modal opens and closes

### Full Test Suite:

Run all 10 scenarios from `tests/gui-scenarios.md`

## Output Format

For each test, report:
```
## Scenario X: [Name]
Status: PASS/FAIL
Steps completed: X/Y
Issues found: [list or "None"]
Notes: [any observations]
```

Start by navigating to http://localhost:5173 and taking a snapshot.
