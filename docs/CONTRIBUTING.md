# Contributing to EasyRip

Thank you for considering contributing to EasyRip! This document provides guidelines and instructions for contributing to the project.

## Table of Contents
- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Development Workflow](#development-workflow)
- [Coding Standards](#coding-standards)
- [Testing Requirements](#testing-requirements)
- [Commit Message Guidelines](#commit-message-guidelines)
- [Pull Request Process](#pull-request-process)
- [Project Structure](#project-structure)
- [Common Tasks](#common-tasks)
- [Debugging](#debugging)
- [Documentation](#documentation)
- [Getting Help](#getting-help)

## Code of Conduct

### Our Pledge

We are committed to providing a welcoming and inclusive environment for all contributors.

### Our Standards

**Positive behavior includes:**
- Being respectful and inclusive
- Accepting constructive criticism gracefully
- Focusing on what's best for the project
- Showing empathy towards others

**Unacceptable behavior includes:**
- Harassment, discriminatory language, or personal attacks
- Trolling, insulting comments, or off-topic discussions
- Publishing others' private information without permission

### Enforcement

Project maintainers have the right to remove, edit, or reject contributions that don't align with this Code of Conduct.

## Getting Started

### Prerequisites

- **Node.js**: v18+ (LTS recommended)
- **npm**: v9+ (comes with Node.js)
- **Git**: Latest version
- **Windows**: Windows 10/11 (primary platform)
- **MakeMKV**: Installed and configured (for testing backup features)

### Fork and Clone

1. **Fork the repository** on GitHub
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/EasyRip.git
   cd EasyRip
   ```
3. **Add upstream remote**:
   ```bash
   git remote add upstream https://github.com/BattleSheep85/EasyRip.git
   ```

## Development Setup

### Install Dependencies

```bash
npm install
```

### Verify Installation

```bash
# Run tests to verify setup
npm test

# Start development server
npm run electron:dev
```

### Configuration

1. **Settings File**: On first run, EasyRip creates `~/.easyrip-settings.json`
2. **MakeMKV Path**: Configure in Settings UI or manually edit settings file
3. **TMDB API Key**: Optional, get free key from https://www.themoviedb.org/settings/api

## Development Workflow

### 1. Create a Feature Branch

```bash
# Sync with upstream
git checkout main
git pull upstream main

# Create feature branch
git checkout -b feature/my-feature
# or
git checkout -b fix/bug-description
```

### 2. Make Your Changes

- Follow [Coding Standards](#coding-standards)
- Write tests for new functionality
- Update documentation as needed

### 3. Test Your Changes

```bash
# Run unit tests
npm run test:unit

# Run E2E tests
npm run test:e2e

# Run linter
npm run lint
```

### 4. Commit Your Changes

Follow [Commit Message Guidelines](#commit-message-guidelines):
```bash
git add .
git commit -m "feat: add parallel backup support"
```

### 5. Push and Create PR

```bash
git push origin feature/my-feature
```

Then create a Pull Request on GitHub.

## Coding Standards

### General Principles

1. **ES Modules**: Use `import`/`export` (not `require`)
2. **Async/Await**: Prefer async/await over callbacks
3. **Error Handling**: Always handle errors gracefully
4. **Logging**: Use logger module with appropriate levels
5. **Security**: Sanitize all user inputs

### JavaScript Style

```javascript
// ✅ Good
import path from 'path';
import logger from './logger.js';

export async function processBackup(discName) {
  try {
    const sanitized = sanitizeBackupName(discName);
    const result = await makemkv.startBackup(sanitized);
    logger.info('backup', `Backup completed: ${sanitized}`);
    return { success: true, result };
  } catch (error) {
    logger.error('backup', 'Backup failed', error);
    return { success: false, error: error.message };
  }
}

// ❌ Bad
const path = require('path'); // Use import instead

function processBackup(discName, callback) { // Use async/await
  makemkv.startBackup(discName, (err, result) => {
    if (err) callback(err);
    else callback(null, result);
  });
}
```

### File Organization

**NEVER save to root folder. Use these directories:**
- `/src` - Source code files
- `/tests` - Test files
- `/docs` - Documentation
- `/config` - Configuration files
- `/scripts` - Utility scripts

**Module Guidelines:**
- Keep files under 500 lines
- One responsibility per module
- Clear, descriptive file names

### Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Files | kebab-case | `backup-manager.js` |
| Functions | camelCase | `startBackup()` |
| Classes | PascalCase | `MakeMKVAdapter` |
| Constants | UPPER_SNAKE_CASE | `MAX_RETRIES` |
| Private functions | _camelCase | `_parseOutput()` |

### Code Comments

```javascript
// ✅ Good - Explains WHY
// MakeMKV cannot run multiple instances with scanning enabled
// Use --noscan to allow parallel backups
const args = ['mkv', '--noscan', ...];

// ❌ Bad - Explains WHAT (code is self-documenting)
// Create an array of arguments
const args = ['mkv', '--noscan', ...];

// ✅ Good - Documents function purpose
/**
 * Start a backup for a specific drive
 * @param {string} driveId - Drive identifier (e.g., "D:")
 * @param {number} makemkvIndex - MakeMKV disc index
 * @returns {Promise<{success: boolean, driveId: string}>}
 */
export async function startBackup(driveId, makemkvIndex) {
  // ...
}
```

## Testing Requirements

### Test Coverage Requirements

All contributions must include tests:
- **New Features**: Unit tests + integration tests
- **Bug Fixes**: Regression test demonstrating the fix
- **Refactoring**: Existing tests must still pass

### Running Tests

```bash
# All tests
npm test

# Specific test suite
npm run test:utils       # Utility functions
npm run test:makemkv     # MakeMKV adapter
npm run test:drives      # Drive detection
npm run test:logger      # Logging system
npm run test:settings    # Settings persistence
npm run test:ipc         # IPC handlers
npm run test:e2e         # GUI tests

# All unit tests (fast)
npm run test:unit
```

### Writing Tests

Use Node.js native test runner:

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { sanitizeBackupName } from '../src/main/utils.js';

describe('sanitizeBackupName', () => {
  it('should remove directory separators', () => {
    const result = sanitizeBackupName('My Disc');
    assert.strictEqual(result, 'My Disc');
  });

  it('should reject path traversal attempts', () => {
    assert.throws(() => {
      sanitizeBackupName('../../etc/passwd');
    }, /path traversal detected/);
  });
});
```

### Test Guidelines

1. **Descriptive Names**: Test names should explain expected behavior
2. **One Assertion**: Prefer one assertion per test case
3. **Isolate Dependencies**: Use mocks for external services
4. **Clean Up**: Remove temp files/directories after tests
5. **No Flaky Tests**: Tests must be deterministic

## Commit Message Guidelines

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification.

### Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types

| Type | Description | Example |
|------|-------------|---------|
| `feat` | New feature | `feat: add parallel backup support` |
| `fix` | Bug fix | `fix: resolve path traversal vulnerability` |
| `docs` | Documentation only | `docs: update architecture diagram` |
| `style` | Code style (formatting, semicolons) | `style: fix indentation in utils.js` |
| `refactor` | Code change (no bug fix or feature) | `refactor: extract backup logic to module` |
| `test` | Add/update tests | `test: add tests for drive detection` |
| `chore` | Build/tooling changes | `chore: update dependencies` |
| `perf` | Performance improvement | `perf: optimize fingerprint hashing` |

### Examples

**Feature:**
```
feat(metadata): add disc fingerprinting support

Implement CRC64-based fingerprinting for DVD and Blu-ray discs.
Fingerprints are captured before MakeMKV runs to preserve
original timestamps.

Closes #123
```

**Bug Fix:**
```
fix(backup): prevent concurrent backups on same drive

Add check to prevent starting multiple backups on the same
drive, which could corrupt backup data.

Fixes #456
```

**Documentation:**
```
docs: add security documentation

Create SECURITY.md with detailed security model, threat analysis,
and best practices for users and developers.
```

### Commit Message Rules

1. **Subject Line**:
   - Use imperative mood ("add" not "added")
   - Don't capitalize first letter
   - No period at the end
   - 50 characters max

2. **Body**:
   - Wrap at 72 characters
   - Explain WHAT and WHY, not HOW
   - Separate from subject with blank line

3. **Footer**:
   - Reference issues: `Fixes #123`, `Closes #456`
   - Breaking changes: `BREAKING CHANGE: describe change`

## Pull Request Process

### Before Submitting

1. **Ensure tests pass**: `npm run test:unit && npm run test:e2e`
2. **Run linter**: `npm run lint` (if configured)
3. **Update documentation**: README, CLAUDE.md, docs/, etc.
4. **Rebase on main**: `git rebase upstream/main`
5. **Squash commits**: Clean up commit history if needed

### PR Title

Use conventional commit format:
```
feat: add parallel backup support
fix: resolve path traversal vulnerability
docs: update architecture documentation
```

### PR Description Template

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix (non-breaking change)
- [ ] New feature (non-breaking change)
- [ ] Breaking change (fix or feature that breaks existing functionality)
- [ ] Documentation update

## Testing
- [ ] Unit tests added/updated
- [ ] E2E tests added/updated
- [ ] Manual testing performed

## Checklist
- [ ] Code follows project style guidelines
- [ ] Self-review completed
- [ ] Comments added for complex logic
- [ ] Documentation updated
- [ ] No new warnings generated
- [ ] Tests pass locally

## Related Issues
Fixes #123
Closes #456

## Screenshots (if applicable)
Add screenshots for UI changes
```

### Review Process

1. **Automated Checks**: CI/CD runs tests automatically
2. **Code Review**: Maintainer reviews code for quality, security
3. **Feedback**: Address review comments and push updates
4. **Approval**: Once approved, maintainer merges PR

### After Merge

1. **Delete Branch**: Delete your feature branch
2. **Sync Fork**: Update your fork's main branch
   ```bash
   git checkout main
   git pull upstream main
   git push origin main
   ```

## Project Structure

See [ARCHITECTURE.md](ARCHITECTURE.md) for detailed architecture documentation.

### Key Directories

```
EasyRip/
├── src/
│   ├── main/              # Electron main process (Node.js)
│   │   ├── *.js               # Core modules
│   │   └── metadata/          # Metadata system
│   ├── renderer/          # React UI
│   │   ├── pages/             # Page components
│   │   └── components/        # Reusable components
│   └── styles/            # CSS styles
├── tests/                 # Test files
│   └── *.test.js              # Unit & E2E tests
├── docs/                  # Documentation
│   ├── ARCHITECTURE.md        # System architecture
│   ├── SECURITY.md            # Security documentation
│   └── CONTRIBUTING.md        # This file
├── build/                 # Build resources (icons, installers)
├── dist/                  # Build output (gitignored)
└── package.json           # Dependencies & scripts
```

## Common Tasks

### Adding a New IPC Handler

1. **Define handler in `ipc-handlers.js`**:
   ```javascript
   ipcMain.handle('my-new-handler', async (event, data) => {
     try {
       // Validate input
       if (!data || typeof data !== 'object') {
         return { success: false, error: 'Invalid input' };
       }

       // Execute logic
       const result = await myLogic(data);

       return { success: true, result };
     } catch (error) {
       logger.error('my-new-handler', 'Error', error);
       return { success: false, error: error.message };
     }
   });
   ```

2. **Expose in preload script**:
   ```javascript
   // preload.js
   const validChannels = [
     'my-new-handler',
     // ... other channels
   ];
   ```

3. **Call from renderer**:
   ```javascript
   // React component
   const result = await window.api.invoke('my-new-handler', { foo: 'bar' });
   if (result.success) {
     console.log('Success:', result.result);
   }
   ```

4. **Add tests**:
   ```javascript
   // tests/ipc-handlers.test.js
   it('should handle my-new-handler correctly', async () => {
     const result = await handleMyNewHandler({ foo: 'bar' });
     assert.strictEqual(result.success, true);
   });
   ```

### Adding a New Settings Field

1. **Update settings schema** (if using validation)
2. **Add UI component** in `src/renderer/components/settings/`
3. **Update `getSettings` and `saveSettings` handlers** (if needed)
4. **Add tests** in `tests/settings.test.js`
5. **Document** in CLAUDE.md

### Adding a New Test Suite

1. **Create test file**: `tests/my-feature.test.js`
2. **Add npm script**:
   ```json
   "scripts": {
     "test:my-feature": "node --test tests/my-feature.test.js"
   }
   ```
3. **Update `test:unit` script** to include new test
4. **Document** in `tests/README.md`

## Debugging

### Debug Main Process

```bash
# Start Electron with Node.js inspector
npm run electron:dev -- --inspect=5858

# In Chrome, navigate to:
chrome://inspect
```

### Debug Renderer Process

```bash
# Start dev server (opens DevTools automatically)
npm run electron:dev

# Or manually:
# View > Toggle Developer Tools
```

### Debug Tests

```bash
# Run tests with verbose output
node --test --test-reporter=spec tests/my-test.test.js

# Debug specific test
node --inspect-brk --test tests/my-test.test.js
```

### Logging

Use the logger module:
```javascript
import logger from './logger.js';

logger.debug('category', 'Debug message');
logger.info('category', 'Info message');
logger.warn('category', 'Warning message');
logger.error('category', 'Error message', error);
```

View logs:
- **File**: `~/.easyrip/logs/easyrip-YYYY-MM-DD.log`
- **UI**: Click "View Logs" button in application

## Documentation

### What to Document

1. **Code Comments**: Complex logic, WHY not WHAT
2. **Function Docs**: JSDoc for public APIs
3. **README**: User-facing instructions
4. **CLAUDE.md**: Architecture, constraints, testing
5. **docs/**: Detailed technical documentation

### Documentation Style

- **Clear and Concise**: No jargon unless necessary
- **Examples**: Show usage examples
- **Up-to-Date**: Update docs when code changes
- **Markdown**: Use proper formatting (headers, lists, code blocks)

### Updating Documentation

When making changes, update:
- `README.md` - If user-facing features changed
- `CLAUDE.md` - If architecture/IPC/constraints changed
- `docs/ARCHITECTURE.md` - If system design changed
- `docs/SECURITY.md` - If security model changed
- `tests/README.md` - If tests added/changed
- Inline comments - If complex logic added

## Getting Help

### Questions

- **GitHub Discussions**: For general questions
- **GitHub Issues**: For bug reports or feature requests
- **Documentation**: Check README, CLAUDE.md, and docs/

### Reporting Issues

Use GitHub Issues with this template:

**Bug Report:**
```markdown
**Describe the bug**
A clear description of what the bug is.

**To Reproduce**
1. Go to '...'
2. Click on '...'
3. See error

**Expected behavior**
What you expected to happen.

**Screenshots**
If applicable, add screenshots.

**Environment:**
- OS: [e.g., Windows 11]
- EasyRip Version: [e.g., 0.1.2]
- MakeMKV Version: [e.g., 1.17.5]

**Additional context**
Any other context about the problem.
```

**Feature Request:**
```markdown
**Is your feature request related to a problem?**
A clear description of the problem.

**Describe the solution you'd like**
What you want to happen.

**Describe alternatives you've considered**
Any alternative solutions.

**Additional context**
Any other context or screenshots.
```

## Additional Resources

- [Electron Documentation](https://www.electronjs.org/docs)
- [React Documentation](https://react.dev/)
- [Node.js Documentation](https://nodejs.org/docs)
- [Conventional Commits](https://www.conventionalcommits.org/)
- [GitHub Flow](https://guides.github.com/introduction/flow/)

## Thank You!

Thank you for contributing to EasyRip! Your time and effort help make this project better for everyone.
