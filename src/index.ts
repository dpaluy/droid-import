#!/usr/bin/env bun
import { parseArgs } from "util";
import { interactiveFlow } from "./cli/interactive";
import { nonInteractiveFlow } from "./cli/non-interactive";

const HELP_TEXT = `Import Claude Code marketplace plugins into FactoryAI

USAGE:
  droid-import [options]
  bunx droid-import [options]

OPTIONS:
  --marketplace <url>    Marketplace URL, GitHub shorthand (owner/repo), or local path
  --plugins <names>      Comma-separated plugin names to install (default: all)
  --scope <scope>        Install location: 'personal' (~/.factory) or 'project' (.factory)
  --path <dir>           Project directory for 'project' scope (default: cwd)
  --force                Overwrite existing files
  --dry-run              Preview changes without writing files
  --analyze              Analyze compatibility before import (show report)
  --no-filter            Import all items without filtering incompatible ones
  --verbose              Show detailed output
  --no-agents            Skip agent/droid import
  --no-commands          Skip command import
  --no-skills            Skip skill import
  --verify               Run droid CLI to verify imported files after install
  --help                 Show this help message

EXAMPLES:
  bunx droid-import
  bunx droid-import --marketplace majesticlabs-dev/majestic-marketplace
  bunx droid-import --marketplace <url> --analyze
  bunx droid-import --marketplace <url> --plugins majestic-engineer,majestic-rails
  bunx droid-import --marketplace <url> --dry-run
  bunx droid-import --marketplace <url> --verify
`;

function parseCliArgs() {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      marketplace: { type: "string" },
      plugins: { type: "string" },
      scope: { type: "string" },
      path: { type: "string" },
      force: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      analyze: { type: "boolean", default: false },
      "no-filter": { type: "boolean", default: false },
      verbose: { type: "boolean", default: false },
      "no-agents": { type: "boolean", default: false },
      "no-commands": { type: "boolean", default: false },
      "no-skills": { type: "boolean", default: false },
      verify: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: true,
  });

  return {
    marketplace: values.marketplace,
    plugins: values.plugins?.split(",").map((s) => s.trim()).filter(Boolean),
    scope: (values.scope as "personal" | "project") || "project",
    path: values.path,
    force: values.force ?? false,
    dryRun: values["dry-run"] ?? false,
    analyze: values.analyze ?? false,
    noFilter: values["no-filter"] ?? false,
    verbose: values.verbose ?? false,
    verify: values.verify ?? false,
    help: values.help ?? false,
    components: {
      agents: !values["no-agents"],
      commands: !values["no-commands"],
      skills: !values["no-skills"],
    },
  };
}

async function main(): Promise<void> {
  const args = parseCliArgs();

  if (args.help) {
    const pkg = await import("../package.json");
    console.log(`droid-import v${pkg.version} - ${HELP_TEXT}`);
    process.exit(0);
  }

  const isInteractive = process.stdin.isTTY && process.stdout.isTTY && !args.marketplace;

  if (isInteractive) {
    await interactiveFlow();
  } else {
    if (!args.marketplace) {
      console.error("Error: --marketplace is required in non-interactive mode");
      process.exit(1);
    }
    await nonInteractiveFlow({
      marketplace: args.marketplace,
      plugins: args.plugins,
      scope: args.scope,
      path: args.path,
      force: args.force,
      dryRun: args.dryRun,
      analyze: args.analyze,
      noFilter: args.noFilter,
      verbose: args.verbose,
      verify: args.verify,
      components: args.components,
    });
  }
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
