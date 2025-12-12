# EasyRip NPM Commands Reference

This document is the source of truth for all npm commands. **Always reference this file when suggesting commands.**

## Quick Start

**To launch the app with hot reload:**
```bash
npm run electron:dev
```

---

## Command Reference Table

| Command | Purpose | Output | When to Use | Notes |
|---------|---------|--------|------------|-------|
| `npm run electron:dev` | Launch app with hot reload | Electron window pops up | Development/testing | ⭐ **PRIMARY DEV COMMAND** |
| `npm run dev` | Start Vite dev server only | Web server at localhost:5173 | Testing React UI in browser | No app window - debugging only |
| `npm run build` | Create production bundles | dist-renderer/ folder | Before packaging or dist | Minified, optimized build |
| `npm run dist` | Build + create installer | dist/ with .exe installer | Distribution/release | Full Windows installer with setup |
| `npm run dist:dir` | Build + create portable | dist/ with portable app | Distribution | Single executable, no installer |
| `npm run start` | Run pre-built app | Launches app | After `npm run build` | Requires build first |
| `npm run test:electron` | Run E2E tests headless | Playwright report | CI/testing/verification | Auto-starts dev server + runs tests |
| `npm run test:electron:headed` | Run E2E tests visible | Playwright report + browser | Debugging test failures | Shows app window during test |
| `npm run test:gui:debug` | Run app with debugger | App window + devtools port 9222 | Interactive debugging | For Playwright debugging |
| `npm run test:unit` | Run all unit tests | Test results | Verification | Coverage for utilities |
| `npm run test:utils` | Run utils-only tests | Test results | Quick validation | Fast, specific tests |
| `npm run generate-icon` | Generate app icon | build/icon.ico | After changing icon.png | One-time setup task |

---

## Command Details

### `npm run electron:dev` ⭐ PRIMARY COMMAND
**What it does:**
- Starts Vite dev server (`npm run dev`)
- Waits for server to be ready on http://localhost:5173
- Launches Electron app pointing to dev server
- Enables hot reload (changes auto-refresh app)

**Output:**
- Electron window appears with app
- Console shows both Vite and Electron logs
- File changes auto-reload instantly

**When to use:**
- Normal development
- Testing feature changes
- Debugging issues
- Running E2E tests

**Full command to run:**
```bash
cd C:\Users\Chris\Documents\Coding\EasyRip && npm run electron:dev
```

---

### `npm run dev` (Web Server Only)
**What it does:**
- Starts ONLY the Vite development server
- Serves React app on http://localhost:5173
- NO Electron app launches

**Output:**
- Terminal shows "Local: http://localhost:5173"
- App NOT visible (no window)

**When to use:**
- Debugging React UI in browser DevTools
- Testing UI without Electron features
- Static site development

**Note:** This does NOT pop up the app. For the app to appear, use `npm run electron:dev` instead.

---

### `npm run build`
**What it does:**
- Compiles React/Vite production bundle
- Creates minified optimized build in `dist-renderer/`
- Prepares files for packaging

**Output:**
- Build progress in terminal
- `dist-renderer/` folder with assets

**When to use:**
- Before creating installer (`npm run dist`)
- Before packaging for distribution
- Testing production build locally

**Note:** Does NOT launch the app.

---

### `npm run dist` & `npm run dist:dir`
**What they do:**
- `npm run dist` - Full installer with setup wizard
- `npm run dist:dir` - Portable executable (no installer)

**Output:**
- Windows installer (.exe) in `dist/`
- Signed and ready for distribution

**When to use:**
- Creating releases
- Distribution to users
- Building final packages

**Note:** Automatically runs `npm run build` first.

---

### `npm run test:electron`
**What it does:**
- Starts Vite dev server
- Waits for server ready
- Runs Playwright E2E tests against Electron app
- Generates HTML report

**Output:**
- Test results in terminal
- Detailed report in `playwright-report-electron/`
- Screenshots of failures

**When to use:**
- Verifying app functionality
- Testing complete workflows
- CI/automated testing

**Note:** Headless (no visible window). Use `--headed` for debugging.

---

### `npm run test:electron:headed`
**What it does:**
- Same as `npm run test:electron` but with visible window
- Shows app during test execution
- Easier debugging

**Output:**
- App window visible during tests
- Test results + report

**When to use:**
- Debugging test failures
- Understanding test flow
- Interactive troubleshooting

---

## Verification Checklist

Before suggesting a command, verify:

- [ ] Command exists in `package.json` scripts section
- [ ] I understand what it does (not just the name)
- [ ] I know if it launches the app or just builds/tests
- [ ] I can explain when to use it vs alternatives
- [ ] I've confirmed it in the actual package.json, not assumptions

---

## Common Scenarios

**"I want to test my changes"**
```bash
npm run electron:dev
```

**"I want to debug why something isn't working"**
```bash
npm run electron:dev
# Then use browser DevTools when needed
```

**"I want to create a release"**
```bash
npm run dist
```

**"I want to run automated tests"**
```bash
npm run test:electron
```

**"I want to see a test failure visually"**
```bash
npm run test:electron:headed
```

---

## File Reference

- **package.json** - Source of truth for all available commands
- **playwright.electron.config.js** - Config for E2E tests against Electron
- **.claude/settings.json** - Hooks that run tests automatically

