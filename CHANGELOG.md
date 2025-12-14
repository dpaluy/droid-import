# Changelog

All notable changes to this project will be documented in this file.

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
