# EasyRip - Claude Code Configuration

## Project Overview

EasyRip is an Electron application for automated disc backup using MakeMKV. It provides a simple GUI to detect optical drives, check backup status, and queue backups.

## Architecture

```
src/
├── main/           # Electron main process (Node.js)
│   ├── index.js    # App entry, IPC handlers, backup queue
│   ├── makemkv.js  # MakeMKV CLI adapter
│   ├── drives.js   # Windows drive detection
│   ├── logger.js   # File logging system
│   └── preload.js  # Secure IPC bridge
├── renderer/       # React frontend
│   └── App.jsx     # Main UI component
├── shared/         # Shared utilities
│   └── utils.js    # Common functions
└── styles/
    └── app.css     # Application styles
```

## Key Technical Details

### MakeMKV Integration
- Uses `makemkvcon64.exe` CLI tool
- Robot mode flags: `--decrypt --cache=16 --noscan -r --progress=-same`
- **Critical**: MakeMKV cannot run multiple instances concurrently
- Backup queue system ensures sequential processing

### IPC Events
- `scan-drives` - Detect optical drives
- `start-backup` - Queue a backup (driveId, makemkvIndex, discName, discSize)
- `cancel-backup` - Cancel running or queued backup
- `backup-queued` - Notifies UI of queue position
- `backup-started` - Backup is now running
- `backup-progress` - Progress updates
- `backup-complete` - Backup finished (success or failure)

### File Paths
- Settings: `~/.easyrip-settings.json`
- Logs: `~/.easyrip/logs/`
- Temp backups: `D:\EasyRip\temp\{discName}`
- Final backups: `D:\EasyRip\backup\{discName}`

## Build Commands

```bash
npm run dev      # Start dev server + Electron
npm run build    # Build for production
npm run lint     # Run linter
```

## Code Style

- ES Modules (import/export)
- Async/await for all async operations
- Descriptive logging with context
- Error handling with user-friendly messages

## Important Constraints

- Never pre-create MakeMKV target folders (it creates them itself)
- Always clean up temp folders on error/cancel
- Parallel backups enabled (with --noscan flag)
- Use 95% threshold for "complete" backup detection

## Testing

### Unit Tests
```bash
npm test              # Run utility tests
npm run test:utils    # Run utility tests only
```

### E2E GUI Tests (Playwright)
```bash
npm run test:e2e      # Run full GUI test suite (auto-starts Vite + Electron)
```

Tests cover:
- App startup & title
- Header branding
- Toolbar buttons
- Settings modal open/close
- Logs modal open/close
- Drive detection (requires MakeMKV)
- Footer paths display

### Interactive Testing (Playwright MCP)
```bash
npm run test:gui:debug   # Start app with debugging port 9222
```

Then use Claude Code slash commands:
- `/test-gui` - Run full GUI test suite interactively
- `/test-smoke` - Quick smoke test
- `/bug-report` - Generate bug report for issues

### Test Scenarios
See `tests/gui-scenarios.md` for 10 test scenarios.

### Hooks
Unit tests run automatically after code changes via PostToolUse hook in `.claude/settings.json`.
