# Changelog

All notable changes to EasyRip will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
