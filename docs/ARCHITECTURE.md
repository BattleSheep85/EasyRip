# EasyRip Architecture

## Table of Contents
- [Overview](#overview)
- [High-Level Architecture](#high-level-architecture)
- [Module Responsibilities](#module-responsibilities)
- [Data Flow](#data-flow)
- [IPC Communication](#ipc-communication)
- [External Services](#external-services)
- [Metadata System](#metadata-system)
- [Parallel Backup System](#parallel-backup-system)
- [Security Model](#security-model)

## Overview

EasyRip is an Electron application that automates optical disc backup using MakeMKV. It provides a modern React-based GUI for managing multiple drives, identifying disc content using AI, and automatically exporting to media library formats.

**Key Features:**
- Parallel backup support (multiple drives simultaneously)
- AI-powered disc identification (Ollama LLM + TMDB)
- Disc fingerprinting (CRC64, Content IDs)
- ARM database lookup for automatic identification
- Automated export to Emby/Jellyfin libraries
- Secure credential storage for remote transfers

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        EasyRip Application                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────┐              ┌──────────────────┐        │
│  │  Renderer Process │◄────IPC────►│   Main Process   │        │
│  │    (React UI)     │              │   (Node.js)      │        │
│  └──────────────────┘              └──────────────────┘        │
│         │                                   │                    │
│         │                          ┌────────┴────────┐          │
│         │                          │                 │          │
│         │                   ┌──────▼──────┐  ┌──────▼──────┐  │
│         │                   │   Backup    │  │  Metadata   │  │
│         │                   │   Manager   │  │   System    │  │
│         │                   └──────┬──────┘  └──────┬──────┘  │
│         │                          │                 │          │
│         └──────────────────────────┼─────────────────┘          │
│                                    │                            │
└────────────────────────────────────┼────────────────────────────┘
                                     │
          ┌──────────────────────────┼──────────────────────────┐
          │         External Services & Resources                │
          ├──────────────────────────┼──────────────────────────┤
          │                          │                           │
          │   ┌──────────┐   ┌───────▼───────┐   ┌──────────┐ │
          │   │  Ollama  │   │    MakeMKV    │   │   TMDB   │ │
          │   │   LLM    │   │  (CLI Tool)   │   │   API    │ │
          │   └──────────┘   └───────────────┘   └──────────┘ │
          │                                                      │
          │   ┌──────────┐   ┌───────────────┐   ┌──────────┐ │
          │   │   ARM    │   │  Optical      │   │  Remote  │ │
          │   │ Database │   │   Drives      │   │  Servers │ │
          │   └──────────┘   └───────────────┘   └──────────┘ │
          │                                                      │
          └──────────────────────────────────────────────────────┘
```

## Module Responsibilities

### Main Process Modules

#### Core System
| Module | Lines | Responsibility |
|--------|-------|----------------|
| `index.js` | 61 | App lifecycle, initialization orchestration |
| `window-manager.js` | ~60 | Window creation, lifecycle, dev/prod mode |
| `utils.js` | ~80 | Shared utilities, sanitization, notifications |
| `preload.js` | ~100 | Secure IPC bridge with context isolation |

#### Backup System
| Module | Responsibility |
|--------|----------------|
| `backup-manager.js` | Orchestrates parallel backups, fingerprinting, auto-identification |
| `makemkv.js` | MakeMKV CLI adapter, settings persistence, output parsing |
| `drives.js` | Windows drive detection via WMI, eject operations |

#### Metadata System
| Module | Responsibility |
|--------|----------------|
| `metadata-system.js` | Metadata system initialization, Ollama/TMDB setup, watchers |
| `metadata/identifier.js` | Main identification orchestrator (LLM + TMDB) |
| `metadata/schemas.js` | Metadata schemas, validation, status enums |
| `metadata/ollama.js` | Ollama installation, server management, model pulling |
| `metadata/tmdb.js` | TMDB API client, movie/TV search |
| `metadata/watcher.js` | Auto-identify watcher, interval-based scanning |
| `metadata/fingerprint.js` | Disc fingerprinting dispatcher (DVD/Blu-ray) |
| `metadata/fingerprint-dvd.js` | DVD-specific fingerprinting (VIDEO_TS parsing) |
| `metadata/fingerprint-bluray.js` | Blu-ray fingerprinting (BDMV parsing) |
| `metadata/parser-dvd.js` | IFO file parser (DVD structure) |
| `metadata/parser-bluray.js` | BDMV parser (Blu-ray structure) |
| `metadata/crc64.js` | CRC64 hashing implementation |
| `metadata/arm-database.js` | ARM database lookup, caching |

#### Export & Transfer
| Module | Responsibility |
|--------|----------------|
| `exportWatcher.js` | Auto-export on metadata approval |
| `emby.js` | Emby/Jellyfin library exporter |
| `transfer.js` | File transfer manager (Local, UNC, SFTP, FTP) |
| `nfo.js` | NFO file generator for Kodi/Emby |
| `tvEpisodeDetector.js` | TV episode detection from filenames |
| `libraryFixer.js` | Library structure fixer |

#### Infrastructure
| Module | Responsibility |
|--------|----------------|
| `ipc-handlers.js` | All IPC communication handlers |
| `logger.js` | File-based logging with rotation |
| `credential-store.js` | Encrypted credential storage |
| `updater.js` | Auto-update manager (electron-updater) |

### Renderer Process

```
src/renderer/
├── main.jsx                # React app entry point
├── Router.jsx              # React Router configuration
├── pages/                  # Page components
│   ├── HomePage.jsx            # Main drive dashboard
│   ├── SettingsPage.jsx        # Settings UI
│   ├── MetadataPage.jsx        # Metadata review
│   └── ...
├── components/
│   ├── common/             # Shared components (Button, Modal, etc.)
│   ├── layout/             # Layout components (Header, Footer)
│   └── settings/           # Settings-specific components
└── context/                # React context providers
    └── SettingsContext.jsx     # Global settings state
```

## Data Flow

### Backup Flow

```
1. User inserts disc
   ↓
2. Renderer: Click "Scan Drives"
   ↓
3. IPC: scan-drives → Main Process
   ↓
4. DriveDetector.detectDrives()
   ├─ WMI query for optical drives
   ├─ Check drive letters (D:, E:, F:, etc.)
   ├─ Detect disc type (DVD/Blu-ray)
   └─ Get disc volume label
   ↓
5. Return drive list to Renderer
   ↓
6. User clicks "Start Backup"
   ↓
7. IPC: start-backup → Main Process
   ↓
8. Backup Manager:
   ├─ Generate disc fingerprint (BEFORE MakeMKV)
   │  ├─ CRC64 hash of VIDEO_TS or BDMV
   │  ├─ Extract Content IDs
   │  └─ Check ARM database for matches
   ├─ Start MakeMKV backup (parallel)
   │  ├─ Progress updates via IPC
   │  └─ Log output via IPC
   └─ On completion:
      ├─ Store fingerprint in metadata
      ├─ Auto-identify disc (LLM + TMDB)
      └─ Auto-eject if enabled
   ↓
9. Renderer updates UI with results
```

### Metadata Identification Flow

```
1. Backup completes or watcher detects new backup
   ↓
2. Disc Identifier:
   ├─ Load existing metadata (if any)
   ├─ Check fingerprint for ARM match
   ├─ Extract disc info:
   │  ├─ Volume label
   │  ├─ MKV file names
   │  └─ File structure
   ├─ LLM extraction (Ollama):
   │  ├─ Install Ollama if needed
   │  ├─ Pull model if needed
   │  ├─ Extract title/year from context
   │  └─ Return confidence score
   └─ TMDB lookup:
      ├─ Search using LLM-extracted title
      ├─ Fetch metadata (poster, plot, cast)
      └─ Return final metadata
   ↓
3. Save metadata with status: PENDING
   ↓
4. Watcher notifies UI: metadata-pending
   ↓
5. User reviews and approves/rejects:
   ├─ Approve → Status: FINALIZED
   │  └─ Queue for export
   └─ Reject → Status: NEEDS_USER_INPUT
      └─ User can manually edit
   ↓
6. Export Watcher:
   ├─ Detect FINALIZED backups
   ├─ Check disc dependencies (for TV series)
   ├─ Run Emby export
   │  ├─ Create library structure
   │  ├─ Generate NFO files
   │  ├─ Copy/transfer files
   │  └─ Update Emby library
   └─ Mark as EXPORTED
```

### Settings Flow

```
1. Renderer: User edits settings
   ↓
2. IPC: save-settings → Main Process
   ↓
3. MakeMKV.saveSettings()
   ├─ Write to ~/.easyrip-settings.json
   └─ Trigger watcher restart if needed
   ↓
4. Return success to Renderer
```

## IPC Communication

EasyRip uses Electron's IPC (Inter-Process Communication) to communicate between the Renderer (React UI) and Main (Node.js) processes.

### Security Model
- **Context Isolation**: Enabled (renderer cannot access Node.js)
- **Node Integration**: Disabled (no require() in renderer)
- **Preload Script**: Exposes safe IPC methods via `window.api`

### IPC Channels

#### Request-Response (ipcMain.handle)
```javascript
// Renderer → Main (request)
const result = await window.api.invoke('scan-drives');

// Main → Renderer (response)
ipcMain.handle('scan-drives', async () => {
  // ... logic
  return { success: true, drives: [...] };
});
```

#### Push Notifications (webContents.send)
```javascript
// Main → Renderer (push)
mainWindow.webContents.send('backup-progress', {
  driveId: 'D:',
  percent: 45,
  currentMB: 2000,
  totalMB: 4500
});

// Renderer listens
window.api.on('backup-progress', (data) => {
  // Update UI
});
```

### Channel Categories

| Category | Channels | Pattern |
|----------|----------|---------|
| **Drive** | `scan-drives`, `cleanup-orphan-temps` | Request-Response |
| **Backup** | `start-backup`, `cancel-backup`, `get-backup-status` | Request-Response |
| **Backup Events** | `backup-started`, `backup-progress`, `backup-complete` | Push |
| **Metadata** | `identify-disc`, `approve-metadata`, `get-metadata` | Request-Response |
| **Metadata Events** | `metadata-pending`, `metadata-updated`, `ollama-progress` | Push |
| **Export** | `export-backup` | Request-Response |
| **Export Events** | `export-progress`, `export-complete`, `export-error` | Push |
| **Settings** | `get-settings`, `save-settings`, `get-credentials` | Request-Response |
| **Logs** | `get-logs`, `get-log-files` | Request-Response |

## External Services

### MakeMKV
- **Type**: CLI tool (`makemkvcon64.exe`)
- **Purpose**: Optical disc backup (DVD/Blu-ray → MKV)
- **Integration**: Subprocess spawning with robot mode
- **Flags**: `--decrypt --cache=16 --noscan -r --progress=-same`
- **Parallel Support**: YES (with `--noscan`)

### Ollama
- **Type**: Local LLM server
- **Purpose**: Extract disc titles from filenames/context
- **Models**: Llama 3.2 (default), configurable
- **Auto-Installation**: YES (downloads from ollama.com)
- **API**: HTTP REST API (localhost:11434)

### TMDB (The Movie Database)
- **Type**: External REST API
- **Purpose**: Fetch movie/TV metadata (plot, cast, posters)
- **Authentication**: API key required (user-provided)
- **Rate Limits**: Respected via request throttling

### ARM Database
- **Type**: Community disc database
- **Purpose**: Lookup disc fingerprints for automatic identification
- **Integration**: HTTP API + local cache
- **Cache**: `~/.easyrip/arm-cache.json`

### Emby/Jellyfin
- **Type**: Media server (optional)
- **Purpose**: Export destination for organized library
- **Integration**: Direct filesystem writes + API calls

## Metadata System

### Disc Fingerprinting

**Why Fingerprinting?**
- Enables automatic identification without user input
- Matches against ARM database for instant results
- Provides fallback when LLM fails

**Fingerprint Types:**

1. **DVD (VIDEO_TS):**
   - CRC64 hash of IFO files
   - VMG structure analysis
   - Title count and sizes

2. **Blu-ray (BDMV):**
   - CRC64 hash of index.bdmv
   - Content ID extraction
   - Organization ID extraction
   - Embedded title metadata

**Timing Critical:**
Fingerprints MUST be captured BEFORE MakeMKV runs because extraction modifies file timestamps and structure.

### LLM Identification

**Process:**
1. Collect context (volume label, file names, structure)
2. Send to Ollama with prompt engineering
3. Extract title, year, media type, confidence
4. Validate against TMDB

**Confidence Scoring:**
- High (0.8-1.0): Clear title match
- Medium (0.5-0.8): Likely match, needs review
- Low (0.0-0.5): Ambiguous, requires user input

### Metadata States

```
PENDING           → Identified, waiting for user approval
NEEDS_USER_INPUT  → LLM failed or rejected, manual edit required
FINALIZED         → Approved by user, ready for export
EXPORTED          → Successfully exported to library
```

## Parallel Backup System

EasyRip supports running multiple backups simultaneously using MakeMKV's `--noscan` flag.

### How It Works

**Traditional (Sequential):**
```
Scan all drives → Backup disc 0 → Backup disc 1 → Backup disc 2
      ↑__________________|______________|______________|
      Blocking - cannot run in parallel
```

**EasyRip (Parallel):**
```
Drive D: → Backup disc:0 (no scan)
Drive E: → Backup disc:1 (no scan)  ← Simultaneous
Drive F: → Backup disc:2 (no scan)
```

### Implementation

```javascript
// backup-manager.js
const runningBackups = new Map(); // driveId -> { makemkv, discName, ... }

export async function startBackup(driveId, makemkvIndex, ...) {
  // Check if already running
  if (runningBackups.has(driveId)) {
    return { success: false, error: 'Already running' };
  }

  // Create new MakeMKV instance for this drive
  const makemkv = new MakeMKVAdapter();

  // Track backup
  runningBackups.set(driveId, { makemkv, discName, ... });

  // Run in background (don't await)
  runBackup(driveId, makemkv, makemkvIndex, ...);

  return { success: true };
}
```

### Benefits
- 3x faster when backing up multiple discs
- Each drive operates independently
- No shared state conflicts
- Individual cancellation support

## Security Model

See [SECURITY.md](SECURITY.md) for detailed security documentation.

**Key Principles:**
- Context isolation enabled
- All user inputs sanitized
- Path traversal prevention
- Encrypted credential storage
- No `eval()` or dynamic code execution

## Performance Considerations

### Bottlenecks
1. **MakeMKV extraction**: I/O bound (optical drive speed)
2. **Ollama inference**: CPU/GPU bound (model size)
3. **TMDB API**: Network bound (rate limits)
4. **File transfers**: Network bound (SFTP/FTP)

### Optimizations
- Parallel backups reduce total time
- ARM database caching reduces API calls
- Ollama runs locally (no network latency)
- Fingerprint caching prevents re-identification
- Export watcher batches operations

## Future Architecture Considerations

### Scalability
- Support for networked optical drives
- Distributed MakeMKV workers
- Multi-machine coordination

### Extensibility
- Plugin system for custom exporters
- Custom metadata providers
- Alternative LLM backends (OpenAI, etc.)

### Reliability
- Backup verification (checksum validation)
- Automatic retry on failure
- Backup queue persistence across restarts
