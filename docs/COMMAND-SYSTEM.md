# Command Verification System Implementation

This document explains the system put in place to ensure accurate npm commands are suggested.

## Overview

Three-layer system to prevent command errors:

1. **CLAUDE.md** - Developer instructions with verification process
2. **docs/COMMANDS.md** - Source of truth reference table
3. **Pre-flight Check** - Process to verify before suggesting commands

---

## Layer 1: Project Instructions (CLAUDE.md)

The project's `CLAUDE.md` now includes:

```markdown
## Command Verification Process

CRITICAL: Before suggesting ANY npm command, follow this process:

1. Read package.json - Verify the command exists in the scripts section
2. Understand what it does - Know the actual behavior (does it pop up the app? just build? etc.)
3. Verify against config files - Check if dependent configs exist
4. Explain clearly - State what the command does AND when to use it
5. Never assume - Don't rely on generic documentation if actual package.json differs
```

**When Claude sees this in the project:** It will read package.json first before suggesting commands.

---

## Layer 2: Commands Reference (docs/COMMANDS.md)

Comprehensive reference with:
- Command table showing purpose, output, when to use
- Detailed explanation for each major command
- Quick scenario guide ("I want to X, so run Y")
- Verification checklist

**When Claude suggests a command:** It can reference this file for accuracy.

---

## Layer 3: Pre-flight Check Process

When you ask for any npm command, Claude should now:

```
User Request: "How do I start the app?"
           ↓
Claude: "Let me verify the correct command by checking package.json"
           ↓
[Read: C:\Users\Chris\Documents\Coding\EasyRip\package.json]
[Search: scripts section for start/dev/electron commands]
           ↓
Claude: "The correct command is npm run electron:dev"
[Explains what it does]
[Explains when to use it vs alternatives]
           ↓
User: Gets accurate command with explanation
```

---

## How This Fixes The Previous Issue

**Before:**
- Asked user for startup command
- Checked CLAUDE.md documentation (generic)
- Suggested `npm run dev` without verifying package.json
- User ran it, no app appeared
- User confused

**After:**
- User asks for startup command
- Claude reads package.json scripts section
- Claude finds `npm run electron:dev` is the correct command
- Claude explains: "Starts Vite + Electron app with hot reload"
- User runs correct command, app pops up immediately

---

## Key Files

| File | Purpose | Audience |
|------|---------|----------|
| `CLAUDE.md` | Developer instructions (project-level) | Claude (on every task in this project) |
| `docs/COMMANDS.md` | Reference documentation (comprehensive) | Claude + future developers |
| `package.json` | Source of truth (actual scripts) | Claude (verified before every command suggestion) |

---

## System In Action

### Example 1: User asks for startup command

```
USER: "How do I start the app?"

CLAUDE:
1. Reads package.json → sees "electron:dev" script
2. Checks CLAUDE.md → verifies process
3. Reads docs/COMMANDS.md → gets description
4. Responds with:
   - Complete command with path
   - What it does (launches app with hot reload)
   - Expected output (Electron window appears)
   - Alternative commands if needed
```

### Example 2: User asks to run tests

```
USER: "How do I run the E2E tests?"

CLAUDE:
1. Reads package.json → finds "test:electron" and "test:electron:headed"
2. Checks docs/COMMANDS.md → explains difference
3. Asks clarifying question if needed (headed or headless?)
4. Suggests appropriate command with explanation
```

---

## For Future Sessions

When starting work on this project, Claude will:

1. See the `CLAUDE.md` file with command verification instructions
2. Have `docs/COMMANDS.md` available as reference
3. Always verify against `package.json` before suggesting npm commands
4. Provide complete explanations, not just command names

---

## Testing The System

The system is self-verifying. If Claude ever suggests a wrong command:

1. File an issue pointing to the broken command
2. Check if:
   - Command in package.json exists
   - CLAUDE.md process was followed
   - docs/COMMANDS.md has conflicting info
3. Update the relevant file
4. Future suggestions will be correct

---

