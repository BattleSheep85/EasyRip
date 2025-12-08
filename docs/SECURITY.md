# EasyRip Security

## Table of Contents
- [Security Model](#security-model)
- [Threat Model](#threat-model)
- [Security Features](#security-features)
- [Input Validation](#input-validation)
- [Path Traversal Protection](#path-traversal-protection)
- [Credential Storage](#credential-storage)
- [IPC Security](#ipc-security)
- [External Service Security](#external-service-security)
- [Known Security Considerations](#known-security-considerations)
- [Security Best Practices](#security-best-practices)
- [Reporting Security Issues](#reporting-security-issues)

## Security Model

EasyRip follows Electron security best practices to protect user systems and data.

### Core Principles
1. **Least Privilege**: Processes run with minimum required permissions
2. **Defense in Depth**: Multiple layers of security controls
3. **Secure by Default**: Safe configurations out-of-the-box
4. **Input Validation**: All user inputs are sanitized and validated
5. **Data Protection**: Sensitive data encrypted at rest

### Security Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Renderer Process                         │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  React UI (User Interface)                          │   │
│  │  - No Node.js access (nodeIntegration: false)       │   │
│  │  - No direct filesystem access                      │   │
│  │  - Can only use window.api (preload bridge)         │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                            ↕ IPC (context isolation)
┌─────────────────────────────────────────────────────────────┐
│                      Preload Script                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Secure IPC Bridge (window.api)                     │   │
│  │  - Whitelisted IPC channels only                    │   │
│  │  - No dynamic channel names                         │   │
│  │  - Input validation on all channels                 │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                            ↕ IPC
┌─────────────────────────────────────────────────────────────┐
│                       Main Process                           │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  IPC Handlers (ipc-handlers.js)                     │   │
│  │  - Path sanitization (sanitizeBackupName)           │   │
│  │  - Input validation on all handlers                 │   │
│  │  - Error handling with safe error messages          │   │
│  └─────────────────────────────────────────────────────┘   │
│                            ↓                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Business Logic Modules                             │   │
│  │  - Backup Manager, Metadata System, etc.            │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Threat Model

### In Scope
1. **Malicious User Input**
   - Path traversal attempts
   - Command injection via filenames
   - SQL injection (N/A - no SQL database)
   - XSS attacks (limited scope in Electron)

2. **File System Attacks**
   - Unauthorized file access
   - Overwriting system files
   - Reading sensitive files

3. **Network Attacks**
   - MITM on TMDB API calls (HTTPS enforced)
   - Credential interception during transfers
   - Malicious Ollama responses

4. **Privilege Escalation**
   - Breaking out of renderer process sandbox
   - Gaining Node.js access from renderer

### Out of Scope
1. **Physical Access**: Assumes attacker doesn't have physical machine access
2. **OS-Level Exploits**: Relies on OS security (Windows UAC, etc.)
3. **Supply Chain Attacks**: Assumes npm packages are trustworthy
4. **Social Engineering**: Assumes user is not tricked into running malicious commands

## Security Features

### 1. Context Isolation (Enabled)

**What it does:**
Prevents renderer process from accessing Node.js APIs and Electron internals.

**Implementation:**
```javascript
// window-manager.js
webPreferences: {
  nodeIntegration: false,        // No require() in renderer
  contextIsolation: true,        // Separate JavaScript contexts
  preload: path.join(__dirname, 'preload.js')
}
```

**Why it matters:**
Even if an attacker injects JavaScript into the renderer (XSS), they cannot access the filesystem or spawn processes.

### 2. Preload Script Whitelist

**What it does:**
Exposes only specific, safe IPC channels to the renderer.

**Implementation:**
```javascript
// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Only whitelisted channels
  invoke: (channel, data) => {
    const validChannels = [
      'scan-drives',
      'start-backup',
      // ... explicit whitelist
    ];
    if (validChannels.includes(channel)) {
      return ipcRenderer.invoke(channel, data);
    }
    throw new Error(`Invalid IPC channel: ${channel}`);
  }
});
```

**Why it matters:**
Prevents attackers from invoking arbitrary IPC channels even if they compromise the renderer.

### 3. Input Sanitization

**What it does:**
All user inputs are validated and sanitized before use.

**Implementation:**
```javascript
// utils.js
export function sanitizeBackupName(name) {
  if (!name || typeof name !== 'string') {
    throw new Error('Invalid backup name');
  }

  // Strip directory components
  const sanitized = path.basename(name);

  // Reject traversal attempts
  if (!sanitized || sanitized !== name || name.includes('..')) {
    throw new Error('Invalid backup name: path traversal detected');
  }

  return sanitized;
}
```

**Why it matters:**
Prevents path traversal attacks like `../../etc/passwd` or `C:\Windows\System32\config\SAM`.

### 4. Encrypted Credential Storage

**What it does:**
Stores SFTP/FTP credentials encrypted at rest.

**Implementation:**
```javascript
// credential-store.js
import crypto from 'crypto';

// Encrypt credentials with AES-256-CBC
function encrypt(text, key) {
  const cipher = crypto.createCipher('aes-256-cbc', key);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return encrypted;
}

// Store in ~/.easyrip-credentials.json
```

**Why it matters:**
Prevents credentials from being stored in plaintext. Even if an attacker gains filesystem access, they cannot easily extract credentials.

**Limitations:**
- Encryption key is derived from machine-specific data (not user password)
- Provides protection against casual snooping, not determined attackers with system access

### 5. HTTPS Enforcement

**What it does:**
All external API calls use HTTPS.

**Implementation:**
```javascript
// metadata/tmdb.js
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

// metadata/ollama.js
// Ollama runs on localhost (no network exposure)
```

**Why it matters:**
Prevents man-in-the-middle attacks when fetching metadata from TMDB.

## Input Validation

### Validation Points

| Input Source | Validation Method | Example |
|--------------|-------------------|---------|
| User-entered disc name | `sanitizeBackupName()` | Reject `../../etc/passwd` |
| Drive letters | Regex validation | Only allow `[A-Z]:` format |
| File paths | `path.basename()` + traversal check | Strip directory components |
| TMDB API key | Length + format check | Must be 32 alphanumeric chars |
| Ollama model name | Whitelist check | Only allow known models |
| Settings values | Type validation | Boolean for toggles, strings for paths |

### Example: Drive Letter Validation

```javascript
// drives.js
function isValidDriveLetter(letter) {
  // Must be single letter + colon
  return /^[A-Z]:$/.test(letter);
}
```

### Example: Settings Validation

```javascript
// ipc-handlers.js
ipcMain.handle('save-settings', async (event, settings) => {
  // Type validation
  if (typeof settings !== 'object' || settings === null) {
    return { success: false, error: 'Invalid settings object' };
  }

  // Validate automation settings
  if (settings.automation) {
    if (typeof settings.automation.ejectAfterBackup !== 'boolean') {
      return { success: false, error: 'Invalid automation settings' };
    }
  }

  // ... more validation
});
```

## Path Traversal Protection

### Attack Vectors

**Potential attacks:**
```javascript
// Malicious disc name
const discName = '../../etc/passwd';

// Without sanitization:
const backupPath = path.join(basePath, 'backup', discName);
// Result: /home/user/etc/passwd (traversed up!)

// With sanitization:
const sanitized = sanitizeBackupName(discName);
// Throws: "Invalid backup name: path traversal detected"
```

### Protection Layers

1. **Input Sanitization** (`sanitizeBackupName()`)
   - Strips directory separators
   - Rejects `..` sequences
   - Uses `path.basename()` to extract filename only

2. **Validation Checks**
   - Verify sanitized === original (no changes)
   - Reject empty strings after sanitization
   - Reject special characters (optional)

3. **Safe Path Construction**
   ```javascript
   // Always use path.join() with sanitized inputs
   const safePath = path.join(basePath, 'backup', sanitizedName);

   // Never use string concatenation
   const unsafePath = basePath + '/' + name; // DON'T DO THIS
   ```

### Testing

Path traversal protection is covered in `tests/ipc-handlers.test.js`:
```javascript
it('should reject path traversal in disc names', () => {
  assert.throws(() => {
    sanitizeBackupName('../../etc/passwd');
  }, /path traversal detected/);
});
```

## Credential Storage

### Storage Location
- **File**: `~/.easyrip-credentials.json`
- **Permissions**: 0600 (user read/write only)
- **Format**: JSON with encrypted fields

### Encryption Details

**Algorithm**: AES-256-CBC
**Key Derivation**: Machine-specific identifier (not user password)
**IV**: Random per-credential

**Stored Credentials:**
- SFTP: host, port, username, password, privateKeyPath
- FTP: host, port, username, password

**Example encrypted file:**
```json
{
  "sftp": {
    "host": "192.168.1.100",
    "port": 22,
    "username": "user",
    "password": "a8b7c6d5e4f3...", // encrypted
    "privateKeyPath": null
  }
}
```

### Security Limitations

**Not secure against:**
- Attackers with system access (can extract encryption key)
- Memory dumps (credentials decrypted in memory)
- Process injection (can read decrypted credentials)

**Secure against:**
- Casual snooping of filesystem
- Accidental credential leaks (e.g., in backups)
- Credential harvesting from stolen disk

**Recommendation:**
For high-security environments, use SSH key-based authentication instead of passwords.

## IPC Security

### Secure IPC Design

**Principles:**
1. **Explicit Channel Whitelist**: No dynamic channel names
2. **Input Validation**: Validate all incoming data
3. **Error Handling**: Never expose internal errors to renderer
4. **Rate Limiting**: Prevent IPC flooding (future enhancement)

### Example: Secure IPC Handler

```javascript
// ipc-handlers.js
ipcMain.handle('start-backup', async (event, { driveId, discName, ... }) => {
  try {
    // 1. Input validation
    if (!driveId || typeof driveId !== 'string') {
      return { success: false, error: 'Invalid drive ID' };
    }

    // 2. Sanitize inputs
    const sanitized = sanitizeBackupName(discName);

    // 3. Execute business logic
    const result = await startBackup(driveId, sanitized, ...);

    // 4. Return safe response
    return { success: true, data: result };

  } catch (error) {
    // 5. Log full error internally
    logger.error('start-backup', 'Backup failed', error);

    // 6. Return sanitized error to renderer
    return {
      success: false,
      error: error.message || 'Backup failed'
      // NO: error.stack (leaks internal paths)
    };
  }
});
```

### IPC Event Validation

All IPC events sent to renderer are validated:
```javascript
// Validate before sending
if (mainWindow && !mainWindow.isDestroyed()) {
  mainWindow.webContents.send('backup-progress', {
    driveId: String(driveId),           // Type coercion
    percent: Number(percent),
    currentMB: Number(currentMB),
    totalMB: Number(totalMB)
  });
}
```

## External Service Security

### MakeMKV

**Security Considerations:**
- MakeMKV is a third-party binary (trust required)
- Spawned as subprocess with restricted arguments
- No user input passed directly to command line (path injection prevention)

**Mitigation:**
```javascript
// makemkv.js
const args = [
  'mkv',
  `disc:${makemkvIndex}`,  // Validated integer
  'all',
  sanitizedPath            // Sanitized, never user input directly
];
const makemkvProcess = spawn(this.makemkvPath, args);
```

### Ollama

**Security Considerations:**
- Runs on localhost (no network exposure)
- Auto-installation downloads from ollama.com (HTTPS)
- Model downloads from ollama.com registry

**Mitigation:**
- Only allow whitelisted model names
- Verify Ollama binary signature (future enhancement)
- Run Ollama without elevated privileges

### TMDB API

**Security Considerations:**
- API key stored in plaintext settings
- HTTPS enforced for all requests
- Rate limiting applied

**Mitigation:**
```javascript
// metadata/tmdb.js
const response = await fetch(
  `https://api.themoviedb.org/3/search/movie?api_key=${apiKey}&query=${encodeURIComponent(title)}`,
  {
    headers: {
      'User-Agent': 'EasyRip/0.1.2'
    }
  }
);
```

### ARM Database

**Security Considerations:**
- External HTTP API (HTTPS recommended)
- Disc fingerprints sent to third-party
- Cache stored locally (potential info leak)

**Mitigation:**
- Cache stored in user home directory (not system-wide)
- Optional feature (can be disabled)
- No personally identifiable information sent

## Known Security Considerations

### 1. Credential Storage Encryption

**Issue**: Encryption key derived from machine ID, not user password.

**Impact**: Attacker with system access can decrypt credentials.

**Mitigation**: Use SSH keys instead of passwords for SFTP.

**Status**: Accepted risk for v1.0, may improve in future.

### 2. MakeMKV Binary Trust

**Issue**: EasyRip trusts MakeMKV binary without signature verification.

**Impact**: Compromised MakeMKV could execute arbitrary code.

**Mitigation**: User downloads MakeMKV from official source.

**Status**: Accepted risk (common for CLI wrappers).

### 3. Ollama Auto-Installation

**Issue**: Auto-downloads and executes Ollama installer from internet.

**Impact**: Compromised download could install malware.

**Mitigation**: Downloads over HTTPS, verify signatures (future).

**Status**: Accepted risk for v1.0.

### 4. Plaintext TMDB API Key

**Issue**: TMDB API key stored in plaintext settings file.

**Impact**: Low (free API key, rate-limited, read-only access).

**Mitigation**: User can regenerate key if compromised.

**Status**: Accepted risk (industry standard for free API keys).

### 5. No Code Signing

**Issue**: EasyRip installer not code-signed.

**Impact**: Windows SmartScreen warnings, harder to verify authenticity.

**Mitigation**: Users must download from official GitHub releases.

**Status**: Future improvement (requires certificate purchase).

## Security Best Practices

### For Users

1. **Download from Official Sources**
   - GitHub releases only
   - Verify release hashes (future)

2. **Use SSH Keys for SFTP**
   - Avoid storing passwords
   - Use key-based authentication

3. **Keep Software Updated**
   - Enable auto-updates
   - Review release notes for security fixes

4. **Protect Settings File**
   - Don't share `~/.easyrip-settings.json`
   - Don't commit to version control

5. **Review Metadata Before Export**
   - Don't auto-approve metadata blindly
   - Check for unexpected file paths

### For Developers

1. **Validate All Inputs**
   - Never trust renderer input
   - Use `sanitizeBackupName()` for paths
   - Type-check all IPC data

2. **Follow Electron Security Guidelines**
   - https://www.electronjs.org/docs/latest/tutorial/security
   - Enable context isolation
   - Disable Node integration

3. **Use Safe APIs**
   - Prefer `path.join()` over string concatenation
   - Use `spawn()` with argument arrays, not shell strings
   - Never use `eval()` or `Function()`

4. **Log Security Events**
   - Log failed validation attempts
   - Log suspicious IPC activity
   - Don't log sensitive data (credentials, API keys)

5. **Test Security**
   - Write tests for path traversal
   - Test input validation edge cases
   - Fuzz test IPC handlers (future)

## Reporting Security Issues

**Please DO NOT open public GitHub issues for security vulnerabilities.**

Instead, email security reports to: [Your Security Email]

Include:
- Description of vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

We will respond within 48 hours and work on a fix for critical issues.

### Disclosure Policy

- We will acknowledge your report within 48 hours
- We will provide an estimated timeline for a fix
- We will credit you in release notes (if desired)
- We ask for 90 days before public disclosure

## Security Checklist

### Pre-Release Security Review

- [ ] All user inputs validated
- [ ] Path traversal tests passing
- [ ] No hardcoded credentials
- [ ] HTTPS used for all external APIs
- [ ] Context isolation enabled
- [ ] Node integration disabled
- [ ] IPC channels whitelisted
- [ ] Error messages don't leak internal paths
- [ ] Credential storage encrypted
- [ ] Dependencies audited (`npm audit`)
- [ ] No high/critical vulnerabilities
- [ ] Security documentation updated

### Post-Release Monitoring

- [ ] Monitor GitHub issues for security reports
- [ ] Run `npm audit` weekly
- [ ] Update dependencies monthly
- [ ] Review Electron security advisories
- [ ] Test new attack vectors as discovered

## Resources

- [Electron Security Guidelines](https://www.electronjs.org/docs/latest/tutorial/security)
- [OWASP Electron Security](https://owasp.org/www-community/vulnerabilities/Electron_Security)
- [Node.js Security Best Practices](https://nodejs.org/en/docs/guides/security/)
- [Secure Coding Guidelines for JavaScript](https://cheatsheetseries.owasp.org/cheatsheets/Nodejs_Security_Cheat_Sheet.html)
