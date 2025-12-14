# droid-import

Load config: @.agents.yml

CLI tool to import Claude Code marketplace plugins into FactoryAI.

## Architecture

**Stack:** TypeScript + Bun runtime, @clack/prompts for interactive CLI

```
src/
├── index.ts        # CLI entry point, argument parsing, interactive/non-interactive flows
├── types.ts        # All TypeScript interfaces and types
├── marketplace.ts  # Load marketplace.json from local/GitHub/URL
├── discovery.ts    # Discover plugins (agents, commands, skills) from marketplace
├── analyzer.ts     # Analyze compatibility with Factory AI
├── installer.ts    # Compute install plans, execute file operations
└── converters/
    ├── agent.ts    # Convert Claude agents → Factory droids (YAML frontmatter)
    ├── command.ts  # Convert commands (minimal changes)
    └── skill.ts    # Convert skills (copy directories, normalize frontmatter)
```

## Key Concepts

- **Marketplace**: JSON manifest listing plugins, loaded from local path, GitHub, or URL
- **Plugin**: Contains agents/, commands/, and skills/ directories
- **Droid**: Factory AI equivalent of Claude agent (different YAML frontmatter format)
- **Compatibility filtering**: Analyzes items and skips those incompatible with Factory AI

## Development

```bash
bun run start                    # Run CLI
bun run typecheck                # Check types
bunx droid-import --help         # Show CLI help
bunx droid-import --dry-run      # Preview without writing
```

## Conventions

- All source in `src/`, no build step needed (Bun runs TypeScript directly)
- Interfaces in `types.ts`, imported where needed
- Converters handle format transformation (Claude → Factory)
- Installer handles file I/O (compute plan, execute)
