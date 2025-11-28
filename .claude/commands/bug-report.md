# Bug Report Generator

Generate a bug report for an issue found in EasyRip.

## Instructions

When a bug is discovered, create a structured report:

1. **Capture current state** using `browser_snapshot`
2. **Take screenshot** if visual issue using `browser_take_screenshot`
3. **Check console** for errors using `browser_console_messages`
4. **Read system logs** from the app

## Bug Report Template

Create an issue in Plane using this format:

```
## Bug Description
[Clear description of the issue]

## Steps to Reproduce
1. [Step 1]
2. [Step 2]
3. [Step 3]

## Expected Behavior
[What should happen]

## Actual Behavior
[What actually happens]

## Environment
- App Version: 0.1.0
- Platform: Windows
- Node Version: [from package.json engines or system]

## Screenshots/Logs
[Attach relevant screenshots]

## Console Errors
[Any JavaScript errors from DevTools]

## System Log Excerpt
[Relevant entries from ~/.easyrip/logs/]

## Severity
- [ ] Critical - App crashes or data loss
- [ ] High - Feature broken, no workaround
- [ ] Medium - Feature broken, has workaround
- [ ] Low - Minor issue, cosmetic
```

After gathering info, use the Plane MCP to create the issue:
- Project: EasyRip
- Labels: bug
- Priority: based on severity
