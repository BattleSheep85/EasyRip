# Changelog

All notable changes to EasyRip will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.2] - 2025-12-20

### Fixed
- **No More Silent Fallback**: AI provider now throws clear error instead of silently falling back to Ollama when selected provider (Claude/OpenRouter) is unavailable

## [0.4.1] - 2025-12-20

### Added
- **AI Provider Diagnostics**: Added detailed logging for AI provider initialization to debug credential loading issues

## [0.4.0] - 2025-12-20

### Added
- **Scan Disks Button**: Added explicit "Scan Disks" button to the toolbar for manual disc detection
- **Drive Independence System**: Drives now operate independently - scanning no longer blocks UI during backups
- **Single Instance Lock**: App now prevents multiple instances - if you try to open a second instance, it focuses the existing window instead
- **Per-Drive Full Rescan**: The refresh button (↻) on each drive now performs a complete rescan of just that drive, detecting disc changes without affecting other drives
- **Color-Coded Logs**: System logs now display with color-coded log levels - DEBUG (gray), INFO (blue), WARN (orange), ERROR (red)
- **Responsive Drive Table**: Table columns now hide gracefully at narrow widths to prevent text cutoff
- **Backup Stall Detection**: Backups that make no progress for 3 minutes are now detected and marked as "STALLED" with pulsing red indicator - includes diagnostic info about last MakeMKV output to help identify the cause

### Changed
- **Refresh Button Visibility**: Per-drive refresh button now has blue accent styling to be more noticeable and discoverable
- **Instant Disc Scanning**: Disc scans are now instant - MakeMKV is no longer queried during scan. Instead, disc type is detected from filesystem (BDMV/VIDEO_TS folders) and MakeMKV is only queried when a backup actually starts. This eliminates the minutes-long delays when swapping discs.

### Fixed
- **Disc Scanning Race Condition**: Fixed startup issue where disc scanning could fail with "no handle" error - IPC handlers are now registered before the window loads
- **Duplicate IPC Handler**: Removed duplicate `pull-ollama-model` handler that was causing startup warnings
- **React Hook Ordering Bug**: Fixed critical crash on startup caused by `scanDrives` being referenced before initialization (Temporal Dead Zone error)
- **Scan Freezes During Backup**: Fixed critical bug where clicking "Scan Disks" during a backup would freeze the app for up to 60 seconds - now uses cached MakeMKV mapping during active backups

## [0.3.1] - 2025-12-18

### Added
- **Settings Migration System**: Versioned settings with automatic migration on upgrade - user settings are preserved and updated seamlessly between versions

## [0.3.0] - 2025-12-18

### Added
- **Engineering Standards**: Added comprehensive coding standards and review checklist to CLAUDE.md
- **Slash Commands**: Added `/review`, `/pre-commit`, `/explain`, and `/release` commands for engineering workflows
- **Changelog Tracking**: Automatic changelog updates after code changes

### Fixed
- **TV Show Export**: Removed NFO file generation for TV shows - NFO files were causing Emby to fail detecting episodes properly

## [0.2.0] - 2025-12

### Added
- Multi-provider LLM support for disc identification
- Smart Extract feature for intelligent title selection
- UI improvements across the application

### Fixed
- TMDB episode titles now correctly used for TV show exports
- Season tracker properly maintained across multi-disc TV series
- Media type detection now checks llmGuess.type as fallback
- Syntax error in exportWatcher pre-flight episode detection
- Minlength flag bug in Smart Extract

## [0.1.0] - Initial Release

### Added
- Automated disc backup using MakeMKV
- Parallel backup support for multiple drives
- Disc fingerprinting (DVD/Blu-ray) for identification
- ARM database lookup for disc matching
- Ollama LLM integration for title extraction
- TMDB API integration for metadata
- Auto-identification watcher for backup folder
- Export system for Emby/Jellyfin libraries
- Support for Local, UNC, SFTP, and FTP transfers
- Secure credential storage
- Auto-update manager
- Comprehensive logging system
