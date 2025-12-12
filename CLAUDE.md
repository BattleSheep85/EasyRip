# EasyRip - Claude Code Configuration

## Project Overview

EasyRip is an Electron application for automated disc backup using MakeMKV. It provides a simple GUI to detect optical drives, check backup status, and queue backups.

## Architecture

### Main Process (Electron/Node.js)

```
src/main/
├── index.js              # App lifecycle (61 lines)
├── utils.js              # Utility functions (sanitizeBackupName, notifications)
├── window-manager.js     # Window creation & management
├── backup-manager.js     # Parallel backup orchestration
├── metadata-system.js    # Ollama, TMDB, watchers initialization
├── ipc-handlers.js       # All IPC communication handlers
├── makemkv.js            # MakeMKV CLI adapter
├── drives.js             # Windows drive detection
├── logger.js             # File logging system
├── preload.js            # Secure IPC bridge
├── credential-store.js   # Secure credential storage (SFTP, FTP)
├── transfer.js           # File transfer (Local, UNC, SFTP, FTP)
├── updater.js            # Auto-update manager
├── emby.js               # Emby library exporter
├── exportWatcher.js      # Auto-export watcher
├── libraryFixer.js       # Library structure fixer
├── nfo.js                # NFO file generator
├── tvEpisodeDetector.js  # TV episode detection
└── metadata/             # Metadata identification system
    ├── identifier.js         # Main identification orchestrator
    ├── schemas.js            # Metadata schemas & validation
    ├── ollama.js             # Ollama LLM integration
    ├── tmdb.js               # TMDB API client
    ├── watcher.js            # Metadata watcher (auto-identify)
    ├── fingerprint.js        # Disc fingerprinting (DVD/Blu-ray)
    ├── fingerprint-dvd.js    # DVD-specific fingerprinting
    ├── fingerprint-bluray.js # Blu-ray fingerprinting
    ├── parser-dvd.js         # DVD IFO parser
    ├── parser-bluray.js      # Blu-ray BDMV parser
    ├── crc64.js              # CRC64 hashing
    └── arm-database.js       # ARM database lookup
```

### Renderer Process (React)

```
src/renderer/
├── main.jsx        # App entry point
├── Router.jsx      # Route configuration
├── pages/          # Page components (HomePage, SettingsPage, etc.)
├── components/     # Reusable components
│   ├── common/         # Shared UI components
│   ├── layout/         # Layout components
│   └── settings/       # Settings page components
└── context/        # React context providers
```

### Styles

```
src/styles/
└── app.css         # Application styles
```

## Key Technical Details

### MakeMKV Integration
- Uses `makemkvcon64.exe` CLI tool
- Robot mode flags: `--decrypt --cache=16 --noscan -r --progress=-same`
- **Parallel backups enabled**: With `--noscan`, multiple drives can backup simultaneously
- Each backup process targets a specific `disc:N` (no scanning conflicts)

### Metadata System
- **Disc Fingerprinting**: CRC64 hashing of VIDEO_TS/BDMV for identification
- **ARM Database**: Lookup disc fingerprints against ARM database
- **Ollama LLM**: Local AI for disc title extraction from filenames
- **TMDB API**: Fetch movie/TV metadata from TMDB
- **Auto-Identification**: Watcher monitors backup folder and auto-identifies discs
- **Export System**: Auto-export approved backups to Emby/Jellyfin library

### IPC Events

**Drive Operations**
- `scan-drives` - Detect optical drives
- `cleanup-orphan-temps` - Clean up orphan temp folders

**Backup Operations**
- `start-backup` - Start a backup (driveId, makemkvIndex, discName, discSize, driveLetter)
- `cancel-backup` - Cancel running backup
- `backup-started` - Backup started (includes fingerprint)
- `backup-progress` - Progress updates
- `backup-log` - MakeMKV log output
- `backup-complete` - Backup finished (success or failure)
- `get-backup-status` - Check backup status (none/complete/incomplete)

**Metadata Operations**
- `identify-disc` - Identify disc using LLM + TMDB
- `approve-metadata` - Approve LLM guess and finalize metadata
- `reject-metadata` - Reject LLM guess
- `edit-metadata` - Manually edit metadata
- `get-metadata` - Load metadata for backup
- `metadata-pending` - Watcher found pending backup
- `metadata-updated` - Metadata changed
- `ollama-progress` - Ollama installation/download progress
- `fingerprint-match` - ARM database match found

**Export Operations**
- `export-backup` - Export backup to library
- `export-progress` - Export progress
- `export-log` - Export log output
- `export-complete` - Export finished
- `export-error` - Export failed
- `export-waiting` - Export waiting for disc dependencies

**Settings Operations**
- `get-settings` - Get current settings
- `save-settings` - Save settings to disk
- `get-credentials` - Get stored credentials (SFTP, FTP)
- `save-credentials` - Save credentials securely

### File Paths
- Settings: `~/.easyrip-settings.json`
- Credentials: `~/.easyrip-credentials.json` (encrypted)
- Logs: `~/.easyrip/logs/`
- ARM Database Cache: `~/.easyrip/arm-cache.json`
- Temp backups: `D:\EasyRip\temp\{discName}`
- Final backups: `D:\EasyRip\backup\{discName}`
- Metadata: `D:\EasyRip\backup\{discName}\.metadata.json`

## NPM Commands

### Development
```bash
npm run electron:dev     # ⭐ MAIN COMMAND: Starts Vite + Electron app with hot reload
npm run dev              # Starts ONLY Vite web server (no app window - for React testing)
npm run test:gui:debug   # Start app with debugging port 9222 for interactive testing
```

### Building & Distribution
```bash
npm run build            # Build production bundles
npm run dist             # Build and create Windows installer
npm run dist:dir         # Build and create portable app
```

### Testing
```bash
npm run test:electron    # Run Playwright E2E tests (auto-starts app)
npm run test:electron:headed  # Run E2E tests with visible browser
npm run test:unit        # Run all unit tests
npm run test:utils       # Run utility-specific tests
```

### Other
```bash
npm run start            # Run compiled app (requires npm run build first)
npm run generate-icon    # Generate app icon
```

## Command Verification Process

**CRITICAL**: Before suggesting ANY npm command, follow this process:

1. **Read package.json** - Verify the command exists in the `scripts` section
2. **Understand what it does** - Know the actual behavior (does it pop up the app? just build? etc.)
3. **Verify against config files** - Check if dependent configs exist (playwright.electron.config.js, vite.config.js, etc.)
4. **Explain clearly** - State what the command does AND when to use it
5. **Never assume** - Don't rely on generic documentation if actual package.json differs

**Example verification**:
```
Command: npm run electron:dev
Verify: ✓ exists in package.json scripts
What it does: concurrently runs vite dev server + electron pointing to localhost:5173
When to use: Development with app window popup + hot reload
Alternative: npm run dev (web server only)
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
- **Capture fingerprints BEFORE MakeMKV runs** (extraction modifies timestamps)
- Store fingerprint data in metadata after successful backup
- Security: All user inputs sanitized via `sanitizeBackupName()`

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
