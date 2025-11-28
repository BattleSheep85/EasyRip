# EasyRip - Quick Start Guide

## Getting Started in 5 Minutes

### 1. First Time Setup

Make sure you have:
- ✅ **MakeMKV** installed from [makemkv.com](https://www.makemkv.com/)
- ✅ **Node.js 18+** installed (for development only)

### 2. Run in Development Mode

Open terminal in the EasyRip folder and run:

```bash
npm run electron:dev
```

This will:
- Start the Vite dev server (React hot reload)
- Launch the Electron app
- Open DevTools for debugging

### 3. Test with a Disc

1. Insert a DVD or Blu-ray disc
2. Click **"Scan Drives"** button
3. Select your drive from the list
4. Review disc information
5. Click **"Start Backup"**
6. Watch the progress bar!

### 4. Find Your Backup

Backups are saved to:
```
D:\Rips\DiscName\
```

## Development Commands

```bash
# Start development mode (hot reload)
npm run electron:dev

# Start Electron only (after build)
npm start

# Build for production
npm run electron:build

# Build React only
npm run build

# Start Vite dev server only
npm run dev
```

## Project Architecture

### Main Process (Node.js)
- `src/main/index.js` - App lifecycle, window creation
- `src/main/makemkv.js` - MakeMKV CLI wrapper
- `src/main/preload.js` - IPC security bridge

### Renderer Process (React)
- `src/renderer/App.jsx` - Main React component
- `src/renderer/components/` - UI components
- `src/styles/app.css` - Styling

### How It Works

```
User clicks button
    ↓
React sends IPC message
    ↓
Preload.js (secure bridge)
    ↓
Main process handles request
    ↓
MakeMKV adapter spawns process
    ↓
Progress updates sent back to React
    ↓
UI updates in real-time
```

## Common Development Tasks

### Changing MakeMKV Path
Edit `src/main/makemkv.js` line 12:
```javascript
this.makemkvPath = 'YOUR_CUSTOM_PATH\\makemkvcon64.exe';
```

### Changing Output Directory
Edit default in `src/main/makemkv.js` line 24:
```javascript
this.outputBasePath = 'E:\\MyBackups';
```

### Adding Debug Logging
In `src/main/makemkv.js`, add:
```javascript
console.log('Debug info:', someVariable);
```
View in DevTools console (Ctrl+Shift+I)

### Testing Without Disc
Temporarily modify `scanDrives()` to return mock data:
```javascript
async scanDrives() {
  // Mock data for testing
  return [{
    id: 0,
    hasDisc: true,
    discType: 12,
    isBluray: true,
    isDVD: false,
    description: 'Test Drive',
    discName: 'TEST_DISC',
    driveLetter: 'E:'
  }];
}
```

## Troubleshooting Development

### "Module not found" errors
```bash
rm -rf node_modules package-lock.json
npm install
```

### Vite port already in use
Change port in `vite.config.js`:
```javascript
server: {
  port: 5174,  // Use different port
}
```

### Electron won't start
Check that MakeMKV is installed:
```bash
"C:\Program Files (x86)\MakeMKV\makemkvcon64.exe" --version
```

### Hot reload not working
Restart the dev server:
```bash
# Stop with Ctrl+C
npm run electron:dev
```

## Next Steps

### Phase 2 Features (Future)
1. **Metadata Lookup** - Auto-name files using TMDB/TheTVDB
2. **Title Selection** - Choose specific titles instead of full disc
3. **Special Features** - Detect and organize extras
4. **Queue System** - Queue multiple discs
5. **Format Conversion** - Optional MKV conversion

### Contributing
See `docs/README.md` for full development guide

## Tips

- **Keep DevTools open** during development for debugging
- **Test with both DVD and Blu-ray** discs
- **Monitor D: drive space** - Blu-rays can be 40-50GB
- **Use Ctrl+R** to reload the app during development
- **Check console** for error messages

## Support

- 📝 Full docs: `docs/README.md`
- 🐛 Issues: GitHub Issues
- 💬 Questions: Check README FAQ section

---

**Happy ripping!** 🎬
