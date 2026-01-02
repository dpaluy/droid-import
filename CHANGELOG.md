# Changelog

All notable changes to this project will be documented in this file.

## [0.9.0] - 2026-01-02

### Added

- `--normalize-installed` to rewrite an existing `.factory/` install in-place to remove legacy patterns
- `--install-fixer-droid` to install an `import-fixer` droid into the target droids directory
- Legacy runtime pattern detection (warnings + suggestions) during compatibility analysis

### Changed

- Imported droids/commands/skills now get best-effort normalization of legacy patterns during conversion

## [0.7.0] - 2024-12-14

### Added

- `--verify` flag to launch droid CLI after import for verification
- Verification prompt instructs droid to sample imported files and check for compatibility issues

## [0.6.0] - 2024-12-14

### Fixed

- Commands and skills now properly convert Claude Code tools to Factory AI equivalents
- Tool mapping applied in command and skill converters (was only in agent converter)

### Changed

- `Write` tool now maps to `Create` (was incorrectly mapping to `Edit`)
- `WebFetch` tool now maps to `FetchUrl`
- `Bash` and `Bash(pattern)` tools now map to `Execute`
- `AskUserQuestion` is now filtered out (no Factory equivalent)
- Added `Skill` to valid Factory tools

## [0.5.0] - 2024-12-14

### Fixed

- Recognize `Bash(pattern)` and `Execute(pattern)` tool restriction syntax used by Claude Code
- Commands using restricted shell patterns (e.g., `Bash(git *)`) are now correctly mapped to Factory's `Execute` tool
- Improved MCP tool pattern to handle `mcp__server` format without tool suffix

### Changed

- Commands compatibility improved from 31/41 to 40/41 for majestic-marketplace

## [0.4.0] - 2024-12-14

### Added

- Show version in `--help` output

### Changed

- Update @clack/prompts to 0.11.0

## [0.3.0] - 2024-12-14

### Added

- Support for MCP tools detection and reporting
- Show version at startup in interactive and non-interactive modes

## [0.2.0] - 2024-12-14

### Added

- Graceful migration for `AskUserQuestion` tool - agents using it are now imported with a migration note instead of being skipped
- Specific warnings and suggestions when `AskUserQuestion` is detected in agent tools

### Changed

- `AskUserQuestion` no longer causes agents to be marked as incompatible
- Updated tool mapping documentation to reflect conversation flow approach

## [0.1.0] - 2024-12-14

### Added

- Initial CLI tool for importing Claude Code marketplace plugins into FactoryAI
- Interactive mode with @clack/prompts for guided plugin selection
- Non-interactive mode with CLI flags for automation
- Agent to Droid conversion with YAML frontmatter transformation
- Full skill support (copies entire directories with resources, references, scripts)
- Command import with minimal changes
- GitHub integration to fetch marketplaces directly from repos
- Compatibility analysis and auto-filtering of incompatible items
- Dry-run mode to preview changes before writing
- `--analyze` flag to view compatibility report
- `--no-filter` flag to import all items without filtering
