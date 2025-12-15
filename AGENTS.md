# droid-import

Load config: @.agents.yml

CLI tool to import Claude Code marketplace plugins into FactoryAI.

## Architecture

**Stack:** TypeScript + Bun runtime, @clack/prompts for interactive CLI

```
src/
├── index.ts        # CLI entry point, argument parsing
├── types.ts        # All TypeScript interfaces and types
├── marketplace.ts  # Load marketplace.json from local/GitHub/URL
├── discovery.ts    # Discover plugins (agents, commands, skills) from marketplace
├── analyzer.ts     # Analyze compatibility with Factory AI
├── installer.ts    # Compute install plans, execute file operations
├── verifier.ts     # Post-import verification via droid CLI
├── cli/
│   ├── interactive.ts     # Interactive flow with prompts
│   └── non-interactive.ts # Scripted/automation flow
└── converters/
    ├── agent.ts    # Convert Claude agents → Factory droids (YAML frontmatter)
    ├── command.ts  # Convert commands (tool mapping)
    └── skill.ts    # Convert skills (copy directories, tool mapping)
```

## Key Concepts

- **Marketplace**: JSON manifest listing plugins, loaded from local path, GitHub, or URL
- **Plugin**: Contains agents/, commands/, and skills/ directories
- **Droid**: Factory AI equivalent of Claude agent (different YAML frontmatter format)
- **Compatibility filtering**: Analyzes items and skips those incompatible with Factory AI

## Tool Mapping (Claude Code → Factory AI)

All converters must use `mapToolsForFactory()` from `analyzer.ts` to convert tools:

| Claude Code | Factory AI | Notes |
|-------------|------------|-------|
| `Bash` | `Execute` | Shell execution |
| `Bash(pattern)` | `Execute` | Restricted shell patterns |
| `Write` | `Create` | Creating new files |
| `Edit` | `Edit` | Modifying existing files |
| `WebFetch` | `FetchUrl` | HTTP requests |
| `AskUserQuestion` | *(removed)* | No equivalent - use conversation flow |
| `mcp__*` | `mcp__*` | MCP tools pass through unchanged |

**Important**: When adding new tool mappings, update `TOOL_MAPPING` in `analyzer.ts`.

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

## Code Quality

- **File size**: Keep source files under 200 lines. Extract to separate modules when larger.
- **Fix root cause**: When output is wrong, fix the generator/tool, not the output files.
- **Verify changes**: After modifying CLI tools, run them to verify fixes work.
