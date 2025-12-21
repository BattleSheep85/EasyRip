# EasyRip

<div align="center">

![EasyRip Logo](build/icon.png)

**Automated DVD & Blu-ray Backup Made Simple**

A modern Electron application for streamlined disc backup using MakeMKV, with parallel drive support, AI-powered metadata management, and flexible export options.

[![Version](https://img.shields.io/badge/version-0.4.0-blue.svg)](https://github.com/BattleSheep85/EasyRip/releases)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows-lightgrey.svg)](https://github.com/BattleSheep85/EasyRip)
[![Electron](https://img.shields.io/badge/Electron-28.1.0-47848f.svg)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-18.2.0-61dafb.svg)](https://reactjs.org/)

[Download](https://github.com/BattleSheep85/EasyRip/releases) • [Documentation](#documentation) • [Report Bug](https://github.com/BattleSheep85/EasyRip/issues) • [Request Feature](https://github.com/BattleSheep85/EasyRip/issues)

</div>

---

## Why EasyRip?

| Feature | Traditional Approach | EasyRip |
|---------|---------------------|---------|
| **Multi-Drive Backups** | Run MakeMKV multiple times manually | Parallel backup across all drives simultaneously |
| **Disc Swapping** | Wait minutes for each scan | Instant detection - swap and go |
| **Disc Identification** | Manual lookup on IMDB/TMDB | AI-powered auto-identification with fingerprinting |
| **Stuck Backups** | Stare at frozen progress bar wondering | Stall detection with diagnostic info |
| **Library Export** | Manual file copying and renaming | Auto-export to Emby/Jellyfin with proper naming |

---

## Key Features

### Parallel Backup Engine
Backup multiple discs simultaneously across all your optical drives. Each drive operates independently - no blocking, no waiting.

### Instant Disc Detection
Swap discs without the wait. EasyRip detects disc type instantly from the filesystem, deferring the slower MakeMKV query until backup actually starts.

### Stall Detection & Recovery
Backups that stop making progress for 3 minutes are automatically detected and flagged as "STALLED" with diagnostic info to help identify the cause.

### AI-Powered Identification
- **Disc Fingerprinting** - CRC64 hashing of DVD/Blu-ray structures
- **ARM Database** - Automatic lookup against the ARM disc database
- **Multi-Provider LLM** - Works with Ollama, OpenAI, Anthropic, Google, or OpenRouter
- **TMDB Integration** - Rich metadata for movies and TV shows

### Smart Extract
Intelligently select only the main feature based on disc analysis, skipping menus, extras, and trailers.

### Flexible Export System
- **Local paths** - Copy to any drive or folder
- **Network shares** - UNC/SMB paths (e.g., `\\NAS\Media`)
- **SFTP** - Secure transfer to Linux/Unix servers
- **FTP** - Standard FTP to any server
- **Emby/Jellyfin** - Proper folder structure with metadata

---

## Screenshots

### Home Page - Drive Detection & Parallel Backup
![Home Page](docs/screenshots/01-home.png)

### Settings - Configuration
![Settings](docs/screenshots/02-settings-general.png)

### Metadata Manager - AI-Powered Disc Identification
![Metadata Manager](docs/screenshots/03-metadata-manager.png)

### Export Manager - Transfer Options
![Export Manager](docs/screenshots/04-export-manager.png)

### Logs - Color-Coded Activity Tracking
![Logs](docs/screenshots/05-logs.png)

---

## Installation

### Requirements

- **Operating System**: Windows 10/11 (64-bit)
- **MakeMKV**: [Download and install MakeMKV](https://www.makemkv.com/download/) (required for disc ripping)
- **Disk Space**: Sufficient storage for backups (Blu-ray discs can be 25-50GB+)

### Download & Install

1. Download the latest installer from the [Releases](https://github.com/BattleSheep85/EasyRip/releases) page
2. Run `EasyRip-Setup-0.4.0.exe`
3. Follow the installation wizard
4. Launch EasyRip from the Start Menu or Desktop shortcut

**Note**: The installer will prompt to install MakeMKV if not detected.

---

## Quick Start

### First-Time Setup (2 minutes)

1. **Open Settings** (gear icon in toolbar)
2. **Set MakeMKV Path** → Paths tab → Browse to `makemkvcon64.exe`
   - Default: `C:\Program Files (x86)\MakeMKV\makemkvcon64.exe`
3. **Set Backup Location** → Paths tab → Choose your backup folder
   - Example: `D:\EasyRip\backup`
4. **Click Save**

### Backing Up a Disc

1. **Insert disc** into any optical drive
2. **Click "Scan Disks"** or wait for auto-detection
3. **Click "Backup"** on the detected disc
4. **Watch progress** - EasyRip handles the rest

### Multi-Drive Workflow

Insert discs into multiple drives and click Backup on each - they all run in parallel! The UI shows individual progress for each drive without blocking.

---

## Configuration

### General Settings

| Setting | Description | Default |
|---------|-------------|---------|
| **Auto-Scan** | Scan drives on app startup | Enabled |
| **Auto-Backup** | Start backup when disc detected | Disabled |
| **Eject After Backup** | Automatically eject disc when done | Disabled |
| **Notifications** | Desktop notifications for events | Enabled |

### Path Settings

| Path | Purpose | Example |
|------|---------|---------|
| **MakeMKV Executable** | Path to `makemkvcon64.exe` | `C:\Program Files (x86)\MakeMKV\makemkvcon64.exe` |
| **Backup Output Path** | Where completed backups go | `D:\EasyRip\backup` |
| **Temp Path** | Working directory during backup | `D:\EasyRip\temp` |

### LLM Settings (For Disc Identification)

EasyRip supports multiple AI providers for disc identification:

| Provider | Configuration |
|----------|---------------|
| **Ollama** (Local) | Install Ollama, select model (e.g., `llama3.2`) |
| **OpenAI** | API key required |
| **Anthropic** | API key required |
| **Google AI** | API key required |
| **OpenRouter** | API key + model selection |

### Transfer Settings

Configure where to export completed backups:

- **Local Path** - `E:\Media\Movies`
- **UNC/SMB** - `\\192.168.1.100\Media`
- **SFTP** - Host, port, username, password/key
- **FTP** - Host, port, credentials

---

## Automation Workflow

Enable hands-free operation with these toggles in Settings:

| Step | Toggle | What Happens |
|------|--------|--------------|
| 1 | **Auto-Scan** | Drives scanned on startup |
| 2 | **Auto-Backup** | Backup starts when disc inserted |
| 3 | **Eject After Backup** | Disc ejects when done |
| 4 | **Auto-Export** | Backup transfers to configured destination |

**Full Automation**: Enable all toggles, configure export destination, then just swap discs!

---

## Advanced Features

### Smart Extract Mode

Instead of backing up the entire disc, Smart Extract analyzes the content and extracts only the main feature:
- Skips menus, trailers, and special features
- Uses title duration and size heuristics
- Configurable minimum length threshold

Enable in the backup options when starting a backup.

### Disc Fingerprinting

EasyRip captures a unique fingerprint of each disc before backup:
- **DVD**: CRC64 of VIDEO_TS IFO files
- **Blu-ray**: Content ID, organization ID, disc ID from BDMV

These fingerprints enable:
- ARM database lookup for instant identification
- Matching future copies of the same disc
- Deduplication detection

### Per-Drive Operations

Each drive operates independently:
- **Refresh button (↻)** rescans only that drive
- Backup on one drive doesn't block scanning another
- Stall detection per-drive with individual diagnostics

### Color-Coded Logs

The logs page now shows entries with color-coded levels:
- <span style="color: gray">DEBUG</span> - Verbose diagnostic info
- <span style="color: #4fc3f7">INFO</span> - Normal operations
- <span style="color: orange">WARN</span> - Potential issues
- <span style="color: red">ERROR</span> - Failures requiring attention

---

## Troubleshooting

### Common Issues

#### Disc Not Detected
- Ensure disc is properly inserted
- Click **Scan Disks** button manually
- Check if MakeMKV can see the drive directly

#### Backup Shows "STALLED"
The backup hasn't made progress in 3 minutes. Check:
- Is the disc scratched or damaged?
- Is MakeMKV still running in Task Manager?
- Check logs for the last MakeMKV output

#### Backup Stuck at Early Percentage
- MakeMKV may be reading a difficult section
- Wait a few minutes - stall detection will flag real issues
- Check available disk space on temp drive

#### Export Fails
- Verify network connectivity for remote transfers
- Check credentials for SFTP/FTP
- Ensure destination has sufficient disk space
- Check logs for specific error messages

#### App Won't Start / Multiple Windows
EasyRip uses single-instance locking. If it seems stuck:
1. Check Task Manager for existing `EasyRip.exe` process
2. End the process if hung
3. Relaunch the app

### Log Files

- **Location**: `~/.easyrip/logs/`
- **Format**: `easyrip-YYYY-MM-DD.log`
- **Access**: Click **Logs** button in the app toolbar

---

## Development

### Building from Source

```bash
# Clone the repository
git clone https://github.com/BattleSheep85/EasyRip.git
cd EasyRip

# Install dependencies
npm install

# Run in development mode (with hot reload)
npm run electron:dev

# Build Windows installer
npm run dist
```

### Project Structure

```
EasyRip/
├── src/
│   ├── main/                  # Electron main process
│   │   ├── index.js           # App lifecycle, single-instance lock
│   │   ├── backup-manager.js  # Parallel backup orchestration
│   │   ├── makemkv.js         # MakeMKV CLI adapter, stall detection
│   │   ├── drives.js          # Drive detection, instant scanning
│   │   ├── ipc-handlers.js    # All IPC communication
│   │   └── metadata/          # Fingerprinting, LLM, TMDB
│   ├── renderer/              # React frontend
│   │   ├── pages/             # Page components
│   │   ├── components/        # Reusable UI components
│   │   └── context/           # React context providers
│   └── styles/
│       └── app.css            # Application styles
├── tests/                     # Unit and E2E tests
├── build/                     # Build resources
└── docs/                      # Documentation
```

### Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | React 18, React Router 7 |
| **Backend** | Electron 28, Node.js |
| **Build** | Vite 5 |
| **Testing** | Playwright, Node.js test runner |
| **Packaging** | electron-builder |

### Testing

```bash
# Run all unit tests
npm run test:unit

# Run specific test suites
npm run test:drives
npm run test:makemkv
npm run test:settings

# Run E2E tests
npm run test:electron

# Run E2E tests with visible browser
npm run test:electron:headed
```

---

## Version History

See [CHANGELOG.md](docs/CHANGELOG.md) for detailed release notes.

### Recent Highlights

**v0.4.0** - Parallel backup engine, instant disc scanning, stall detection, single instance lock

**v0.3.0** - Engineering standards, slash commands, changelog tracking

**v0.2.0** - Multi-provider LLM support, Smart Extract, TMDB episode titles

---

## Contributing

Contributions are welcome! Please:

1. **Fork** the repository
2. **Create** a feature branch: `git checkout -b feature/my-feature`
3. **Commit** changes: `git commit -m 'Add my feature'`
4. **Push** to branch: `git push origin feature/my-feature`
5. **Open** a Pull Request

### Guidelines

- Follow existing code style (ES modules, async/await)
- Write tests for new features
- Update `docs/CHANGELOG.md` for user-facing changes
- Keep commits focused and descriptive

---

## Credits

Built on these excellent projects:

- **[MakeMKV](https://www.makemkv.com/)** - DVD/Blu-ray decryption
- **[TMDB](https://www.themoviedb.org/)** - Movie & TV metadata
- **[Ollama](https://ollama.ai/)** - Local AI inference
- **[Electron](https://www.electronjs.org/)** - Desktop framework
- **[React](https://reactjs.org/)** - UI library
- **[Vite](https://vitejs.dev/)** - Build tool

---

## License

MIT License - see [LICENSE](LICENSE) for details.

---

## Support

- **Issues**: [GitHub Issues](https://github.com/BattleSheep85/EasyRip/issues)
- **Discussions**: [GitHub Discussions](https://github.com/BattleSheep85/EasyRip/discussions)

---

<div align="center">

**Made with care for the home media preservation community**

[Back to Top](#easyrip)

</div>
