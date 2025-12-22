# droid-import

[![npm version](https://img.shields.io/npm/v/droid-import.svg)](https://www.npmjs.com/package/droid-import)

Import Claude Code marketplace plugins into FactoryAI, including **skills** (which other tools lack).

## Features

- **Full skill support** - copies entire skill directories with resources, references, scripts
- **Agent → Droid conversion** - transforms Claude agents to Factory droids with proper YAML frontmatter
- **Interactive mode** - beautiful multi-select UI with [@clack/prompts](https://github.com/bombshell-dev/clack)
- **Non-interactive mode** - CLI flags for automation and CI/CD
- **Dry-run mode** - preview changes before writing
- **GitHub integration** - fetch marketplaces directly from GitHub repos

## Installation

```bash
# Run directly with bunx (recommended)
bunx droid-import

# Or install globally
bun install -g droid-import
```

## Usage

### Interactive Mode

```bash
bunx droid-import
```

This launches a guided flow:
1. Enter marketplace URL or GitHub shorthand
2. Select install location (project or personal)
3. Select plugins to import
4. Select components (agents, commands, skills)
5. Choose overwrite behavior

### Non-Interactive Mode

```bash
# Import from GitHub shorthand
bunx droid-import --marketplace majesticlabs-dev/majestic-marketplace

# Import specific plugins
bunx droid-import --marketplace majesticlabs-dev/majestic-marketplace \
  --plugins majestic-engineer,majestic-rails

# Dry run to preview
bunx droid-import --marketplace <url> --dry-run --verbose

# Import to personal directory
bunx droid-import --marketplace <url> --scope personal

# Skip specific components
bunx droid-import --marketplace <url> --no-skills --no-commands
```

## CLI Options

| Option | Description |
|--------|-------------|
| `--marketplace <url>` | Marketplace URL, GitHub shorthand (owner/repo), or local path |
| `--plugins <names>` | Comma-separated plugin names (default: all) |
| `--scope <scope>` | Install location: `personal` (~/.factory) or `project` (.factory, default) |
| `--path <dir>` | Project directory for 'project' scope (default: cwd) |
| `--force` | Overwrite existing files |
| `--dry-run` | Preview changes without writing files |
| `--analyze` | Show compatibility analysis report before import |
| `--no-filter` | Import all items without filtering incompatible ones |
| `--verbose` | Show detailed output |
| `--verify` | Run droid CLI verification after import (non-interactive only) |
| `--no-agents` | Skip agent/droid import |
| `--no-commands` | Skip command import |
| `--no-skills` | Skip skill import |
| `--help` | Show help message |

## Compatibility Analysis

droid-import automatically analyzes plugins for Factory AI compatibility before importing:

```bash
# Show detailed compatibility report
bunx droid-import --marketplace <url> --analyze
```

**What gets checked:**
- Tool compatibility (Claude tools → Factory tools mapping)
- Required frontmatter fields (`name`, `description`)
- Claude-specific patterns that won't work in Factory

**Tool Mapping:**
| Claude Code | Factory AI |
|-------------|-----------|
| `Write` | `Edit` |
| `Bash` | `Execute` |
| `NotebookEdit` | *(skipped - no equivalent)* |
| `BrowseURL` | *(skipped - use `WebSearch`/`FetchUrl`)* |
| `AskUserQuestion` | *(converted - uses conversation flow)* |

Incompatible items are automatically filtered out during import. Use `--no-filter` to import everything regardless of compatibility.

## Post-Import Verification

After importing, you can verify that all files are properly converted for Factory AI:

**Interactive mode:** You'll be prompted to run verification after successful import.

**Non-interactive mode:** Use the `--verify` flag:

```bash
bunx droid-import --marketplace <url> --verify
```

The verifier launches the `droid` CLI to:
1. Sample imported files from droids, commands, and skills
2. Check that tool names use Factory AI equivalents
3. Report any files that need manual fixes

## What Gets Converted

| Claude Code | Factory AI | Location |
|-------------|-----------|----------|
| `agents/*.md` | `droids/*.md` | `.factory/droids/` |
| `commands/*.md` | `commands/*.md` | `.factory/commands/` |
| `skills/<name>/` | `skills/<name>/` | `.factory/skills/` |

### Agent → Droid Conversion

```yaml
# Claude Code agent          # Factory droid
---                          ---
name: code-reviewer          name: code-reviewer
description: Reviews code    description: Reviews code
tools: Read,Edit             model: inherit
---                          tools:
                               - Read
                               - Edit
                             ---
```

### Skill Conversion

Skills are copied with their full directory structure:
- `SKILL.md` / `skill.mdx` - main skill file (frontmatter normalized)
- `resources/` - supporting documentation
- `references/` - reference materials
- `scripts/` - executable scripts
- `assets/` - templates and other files

## Marketplace Format

The tool expects marketplaces with a `.claude-plugin/marketplace.json` file:

```json
{
  "name": "my-marketplace",
  "plugins": [
    {
      "name": "my-plugin",
      "description": "Plugin description",
      "source": "./plugins/my-plugin"
    }
  ]
}
```

Each plugin directory should contain:
```
plugins/my-plugin/
├── agents/      # → .factory/droids/
├── commands/    # → .factory/commands/
└── skills/      # → .factory/skills/
    └── my-skill/
        ├── SKILL.md
        └── resources/
```

## Troubleshooting

### bunx shows old version

If `bunx droid-import` shows an outdated version, clear the cache:

```bash
rm -rf ~/.bun/install/cache
bunx droid-import
```

Or force the latest version:

```bash
bunx droid-import@latest
```

## Requirements

- [Bun](https://bun.sh/) runtime
- FactoryAI CLI with Custom Droids enabled (`/settings` → Experimental → Custom Droids)

## License

MIT
