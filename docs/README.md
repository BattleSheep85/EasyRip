# EasyRip - DVD/Bluray Backup Tool

A simple, user-friendly GUI application for creating unencrypted backups of DVD and Blu-ray discs using MakeMKV.

## Features

- 🔍 **Auto-detect optical drives** - Automatically scans for DVD/Blu-ray drives
- 💿 **Disc information** - Displays disc name, type, and available titles
- 💾 **Full disc backup** - Creates decrypted backups of entire discs
- 📊 **Real-time progress** - Live progress bar with percentage and data transferred
- ❌ **Cancel anytime** - Stop backup operations at any time
- ⚙️ **Configurable** - Set custom MakeMKV path and output directory

## Prerequisites

**Required:**
- Windows 10 or later
- [MakeMKV](https://www.makemkv.com/) installed (supports both free and paid versions)
- Optical drive (DVD or Blu-ray)

**Recommended:**
- At least 50GB free space on output drive (D: by default)
- Fast processor for quicker processing

## Installation

1. **Download EasyRip** installer from the releases page
2. **Run the installer** and follow the setup wizard
3. **Ensure MakeMKV is installed** at the default location:
   ```
   C:\Program Files (x86)\MakeMKV\makemkvcon64.exe
   ```
4. **Launch EasyRip** from Start Menu or Desktop shortcut

## Usage

### Basic Workflow

1. **Insert a disc** into your optical drive
2. **Launch EasyRip**
3. **Click "Scan Drives"** to detect available discs
4. **Select a drive** from the list
5. **Review disc information** (name, type, output path)
6. **Click "Start Backup"** to begin
7. **Wait for completion** - progress bar shows real-time status
8. **Find your backup** at `D:\Rips\DiscName\`

### Output Structure

Backups are saved to:
```
D:\Rips\
└── DiscName\
    ├── BDMV\         (Blu-ray structure)
    │   ├── STREAM\
    │   └── ...
    └── VIDEO_TS\     (DVD structure)
        └── ...
```

The disc name is automatically sanitized (special characters removed).

### Canceling a Backup

- Click the **"Cancel Backup"** button during ripping
- The process will stop immediately
- Partial files will remain in the output directory

## Configuration

### Settings File

Settings are stored in:
```
C:\Users\YourName\.easyrip-settings.json
```

**Available Settings:**
```json
{
  "makemkvPath": "C:\\Program Files (x86)\\MakeMKV\\makemkvcon64.exe",
  "outputBasePath": "D:\\Rips"
}
```

### Changing MakeMKV Location

If MakeMKV is installed in a different location:

1. Close EasyRip
2. Edit `.easyrip-settings.json` in your user folder
3. Update `makemkvPath` to the correct location
4. Restart EasyRip

### Changing Output Directory

To save backups to a different drive:

1. Edit `.easyrip-settings.json`
2. Change `outputBasePath` to your preferred location (e.g., `"E:\\Backups"`)
3. Restart EasyRip

## Troubleshooting

### "MakeMKV not found" Error

**Solution:**
- Ensure MakeMKV is installed
- Check the path in settings file
- Try reinstalling MakeMKV from [makemkv.com](https://www.makemkv.com/)

### "No discs found" Message

**Possible causes:**
- No disc inserted in drive
- Disc is dirty or damaged
- Drive not recognized by Windows

**Solutions:**
- Insert a disc and wait 10 seconds
- Clean the disc with a soft cloth
- Check Device Manager for drive issues

### Backup Failed

**Common causes:**
- Disc is scratched or damaged
- Disc has copy protection issues
- Insufficient disk space

**Solutions:**
- Try cleaning the disc
- Update MakeMKV to latest version
- Ensure at least 50GB free space

### Slow Backup Speed

**Normal speeds:**
- DVD: 5-15 minutes
- Blu-ray: 30-90 minutes

**To improve speed:**
- Close other applications
- Ensure drive is connected directly (not via USB hub)
- Update drive firmware if available

## Development

### Building from Source

**Prerequisites:**
- Node.js 18+ and npm
- Git

**Steps:**
```bash
# Clone repository
git clone https://github.com/yourusername/easyrip.git
cd easyrip

# Install dependencies
npm install

# Run in development mode
npm run electron:dev

# Build for production
npm run electron:build
```

### Project Structure

```
EasyRip/
├── src/
│   ├── main/              # Electron main process (Node.js)
│   │   ├── index.js       # App entry point
│   │   ├── makemkv.js     # MakeMKV wrapper
│   │   └── preload.js     # IPC bridge
│   ├── renderer/          # React frontend
│   │   ├── App.jsx        # Main component
│   │   ├── components/    # UI components
│   │   └── main.jsx       # React entry
│   └── styles/
│       └── app.css        # Styling
├── docs/
│   └── README.md          # Documentation
├── package.json           # Dependencies
└── vite.config.js         # Build config
```

## Technology Stack

- **Electron** - Desktop app framework
- **React** - UI framework
- **Vite** - Build tool
- **Node.js** - Backend runtime
- **MakeMKV** - Disc decryption engine

## Known Limitations

- **Windows only** - Currently only supports Windows OS
- **Full disc backups** - Cannot select individual titles (planned for future)
- **No metadata** - Doesn't fetch movie/TV information (planned for future)
- **No transcoding** - Creates exact disc backups only (by design)

## Future Enhancements

Phase 2 planned features:
- Metadata lookup and automatic naming
- Title selection (choose specific titles/extras)
- Special features detection and extraction
- Queue management for multiple discs
- Format conversion options

## License

MIT License - See LICENSE file for details

## Credits

- **MakeMKV** - [makemkv.com](https://www.makemkv.com/) for the amazing disc decryption tool
- **Electron** - For the cross-platform framework
- **React** - For the UI framework

## Support

- **Issues**: Report bugs on GitHub Issues
- **Questions**: See FAQ section above
- **Updates**: Check GitHub releases for new versions

---

**Note**: This tool is for personal backup purposes only. Ensure you comply with local laws regarding disc copying and copyright.
