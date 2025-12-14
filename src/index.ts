#!/usr/bin/env bun
import * as p from "@clack/prompts";
import { parseArgs } from "util";
import { loadMarketplace } from "./marketplace";
import { discoverPlugins } from "./discovery";
import {
  getBaseDir,
  computeFilteredInstallPlan,
  executeInstallPlan,
  readCustomDroidsSetting,
} from "./installer";
import {
  analyzePlugin,
  formatAnalysisReport,
  type PluginAnalysis,
} from "./analyzer";
import type { CLIArgs, DiscoveredPlugin } from "./types";

const HELP_TEXT = `
droid-import - Import Claude Code marketplace plugins into FactoryAI

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
  --help                 Show this help message

EXAMPLES:
  # Interactive mode
  bunx droid-import

  # Import from GitHub shorthand
  bunx droid-import --marketplace majesticlabs-dev/majestic-marketplace

  # Analyze compatibility first
  bunx droid-import --marketplace <url> --analyze

  # Import specific plugins
  bunx droid-import --marketplace <url> --plugins majestic-engineer,majestic-rails

  # Dry run to preview
  bunx droid-import --marketplace <url> --dry-run
`;

interface ExtendedCLIArgs extends CLIArgs {
  analyze: boolean;
  noFilter: boolean;
}

function parseCliArgs(): ExtendedCLIArgs {
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
    help: values.help ?? false,
    components: {
      agents: !values["no-agents"],
      commands: !values["no-commands"],
      skills: !values["no-skills"],
    },
  };
}

function formatPluginChoice(plugin: DiscoveredPlugin): string {
  const parts: string[] = [];
  if (plugin.agents.length) parts.push(`${plugin.agents.length} agents`);
  if (plugin.commands.length) parts.push(`${plugin.commands.length} commands`);
  if (plugin.skills.length) parts.push(`${plugin.skills.length} skills`);
  const counts = parts.length ? ` (${parts.join(", ")})` : "";
  return `${plugin.name}${counts}`;
}

async function interactiveFlow(): Promise<void> {
  p.intro("droid-import");

  // Step 1: Marketplace URL
  const marketplaceInput = await p.text({
    message: "Enter marketplace URL, GitHub shorthand (owner/repo), or local path",
    placeholder: "majesticlabs-dev/majestic-marketplace",
    validate: (value) => {
      if (!value.trim()) return "Please enter a marketplace location";
    },
  });

  if (p.isCancel(marketplaceInput)) {
    p.cancel("Operation cancelled");
    process.exit(0);
  }

  // Load marketplace
  const loadingSpinner = p.spinner();
  loadingSpinner.start("Loading marketplace...");

  let loaded;
  let discovered: DiscoveredPlugin[];
  try {
    loaded = await loadMarketplace(marketplaceInput);
    discovered = await discoverPlugins(loaded.json, loaded.context);
    loadingSpinner.stop("Marketplace loaded");
  } catch (e) {
    loadingSpinner.stop("Failed to load marketplace");
    p.log.error((e as Error).message);
    process.exit(1);
  }

  if (!discovered.length) {
    p.log.warn("No plugins found in marketplace");
    process.exit(0);
  }

  // Step 2: Install location
  const scope = await p.select({
    message: "Select install location",
    options: [
      { value: "project", label: "Project (.factory/)", hint: "Shared with teammates" },
      { value: "personal", label: "Personal (~/.factory/)", hint: "Private to you" },
    ],
  });

  if (p.isCancel(scope)) {
    p.cancel("Operation cancelled");
    process.exit(0);
  }

  // Step 3: Select plugins
  const pluginChoices = discovered.map((plugin) => ({
    value: plugin.name,
    label: formatPluginChoice(plugin),
    hint: plugin.description?.slice(0, 60) + (plugin.description && plugin.description.length > 60 ? "..." : ""),
  }));

  const selectedPlugins = await p.multiselect({
    message: "Select plugins to import",
    options: pluginChoices,
    initialValues: pluginChoices.map((c) => c.value),
    required: true,
  });

  if (p.isCancel(selectedPlugins)) {
    p.cancel("Operation cancelled");
    process.exit(0);
  }

  // Filter discovered to selected
  const selectedDiscovered = discovered.filter((p) =>
    (selectedPlugins as string[]).includes(p.name)
  );

  // Step 4: Select components
  const components = await p.multiselect({
    message: "Select components to import",
    options: [
      { value: "agents", label: "Agents → Droids" },
      { value: "commands", label: "Commands" },
      { value: "skills", label: "Skills" },
    ],
    initialValues: ["agents", "commands", "skills"],
    required: true,
  });

  if (p.isCancel(components)) {
    p.cancel("Operation cancelled");
    process.exit(0);
  }

  // Step 5: Overwrite behavior
  const overwrite = await p.select({
    message: "How to handle existing files?",
    options: [
      { value: "skip", label: "Skip existing", hint: "Keep current files" },
      { value: "overwrite", label: "Overwrite all", hint: "Replace existing files" },
    ],
  });

  if (p.isCancel(overwrite)) {
    p.cancel("Operation cancelled");
    process.exit(0);
  }

  // Analyze plugins for compatibility
  const analyzeSpinner = p.spinner();
  analyzeSpinner.start("Analyzing compatibility...");

  const analyses: PluginAnalysis[] = [];
  for (const plugin of selectedDiscovered) {
    const analysis = await analyzePlugin(plugin);
    analyses.push(analysis);
  }

  analyzeSpinner.stop("Analysis complete");

  // Show analysis summary
  const totalIncompat =
    analyses.reduce((sum, a) => sum + (a.summary.totalAgents - a.summary.compatibleAgents), 0) +
    analyses.reduce((sum, a) => sum + (a.summary.totalCommands - a.summary.compatibleCommands), 0) +
    analyses.reduce((sum, a) => sum + (a.summary.totalSkills - a.summary.compatibleSkills), 0);

  if (totalIncompat > 0) {
    p.log.warn(`${totalIncompat} items will be skipped (incompatible with Factory AI)`);
  }

  // Compute filtered install plan
  const baseDir = getBaseDir(scope as "personal" | "project");
  const { plan, skippedAgents, skippedCommands, skippedSkills } = computeFilteredInstallPlan(
    selectedDiscovered,
    analyses,
    baseDir,
    {
      includeAgents: (components as string[]).includes("agents"),
      includeCommands: (components as string[]).includes("commands"),
      includeSkills: (components as string[]).includes("skills"),
    }
  );

  const totalItems =
    plan.droids.length + plan.commands.length + plan.skills.length;

  if (totalItems === 0) {
    p.log.warn("Nothing to install (all items incompatible or filtered)");
    process.exit(0);
  }

  // Show preview
  p.log.info(`Will install: ${plan.droids.length} droids, ${plan.commands.length} commands, ${plan.skills.length} skills`);

  if (skippedAgents.length + skippedCommands.length + skippedSkills.length > 0) {
    p.log.warn(`Skipping incompatible: ${skippedAgents.length} agents, ${skippedCommands.length} commands, ${skippedSkills.length} skills`);
  }

  const installSpinner = p.spinner();
  installSpinner.start("Installing...");

  const result = await executeInstallPlan(plan, {
    force: overwrite === "overwrite",
    dryRun: false,
    verbose: false,
  });

  installSpinner.stop("Installation complete");

  // Summary
  const summaryParts: string[] = [];
  if (result.created) summaryParts.push(`${result.created} created`);
  if (result.overwritten) summaryParts.push(`${result.overwritten} overwritten`);
  if (result.skipped) summaryParts.push(`${result.skipped} skipped`);

  p.log.success(summaryParts.join(", "));

  if (result.errors.length) {
    p.log.warn("Errors:");
    for (const err of result.errors) {
      p.log.error(`  ${err}`);
    }
  }

  // Check custom droids setting
  const customDroids = readCustomDroidsSetting();
  if (!customDroids.enabled && plan.droids.length > 0) {
    p.log.warn(
      "Custom Droids are not enabled. Enable them in /settings → Experimental → Custom Droids"
    );
  }

  p.outro("Done!");
}

async function nonInteractiveFlow(args: ExtendedCLIArgs): Promise<void> {
  if (!args.marketplace) {
    console.error("Error: --marketplace is required in non-interactive mode");
    process.exit(1);
  }

  console.log("Loading marketplace...");

  let loaded;
  let discovered: DiscoveredPlugin[];
  try {
    loaded = await loadMarketplace(args.marketplace);
    discovered = await discoverPlugins(loaded.json, loaded.context);
  } catch (e) {
    console.error("Failed to load marketplace:", (e as Error).message);
    process.exit(1);
  }

  if (!discovered.length) {
    console.log("No plugins found in marketplace");
    process.exit(0);
  }

  // Filter plugins if specified
  let selectedDiscovered = discovered;
  if (args.plugins && args.plugins.length > 0) {
    selectedDiscovered = discovered.filter((p) =>
      args.plugins!.includes(p.name)
    );
    if (!selectedDiscovered.length) {
      console.error(
        `No matching plugins found. Available: ${discovered.map((p) => p.name).join(", ")}`
      );
      process.exit(1);
    }
  }

  // Analyze plugins
  console.log("Analyzing compatibility...");
  const analyses: PluginAnalysis[] = [];
  for (const plugin of selectedDiscovered) {
    if (args.verbose) {
      console.log(`  Analyzing ${plugin.name}...`);
    }
    const analysis = await analyzePlugin(plugin);
    analyses.push(analysis);
  }

  // Show analysis report if requested
  if (args.analyze) {
    console.log("\n" + formatAnalysisReport(analyses));
    
    // If only analyzing (no install), exit
    if (!args.force && !args.dryRun) {
      console.log("\nUse --dry-run to preview install or --force to proceed with import.");
      process.exit(0);
    }
  }

  const baseDir = getBaseDir(args.scope, args.path);
  
  // Use filtered plan unless --no-filter is specified
  let plan;
  let skippedAgents: string[] = [];
  let skippedCommands: string[] = [];
  let skippedSkills: string[] = [];

  if (args.noFilter) {
    // Import everything without filtering
    const { computeInstallPlan } = await import("./installer");
    plan = computeInstallPlan(selectedDiscovered, baseDir, {
      includeAgents: args.components.agents,
      includeCommands: args.components.commands,
      includeSkills: args.components.skills,
    });
  } else {
    // Filter out incompatible items
    const result = computeFilteredInstallPlan(
      selectedDiscovered,
      analyses,
      baseDir,
      {
        includeAgents: args.components.agents,
        includeCommands: args.components.commands,
        includeSkills: args.components.skills,
      }
    );
    plan = result.plan;
    skippedAgents = result.skippedAgents;
    skippedCommands = result.skippedCommands;
    skippedSkills = result.skippedSkills;
  }

  const totalItems =
    plan.droids.length + plan.commands.length + plan.skills.length;

  if (totalItems === 0) {
    console.log("Nothing to install (all items filtered as incompatible)");
    process.exit(0);
  }

  console.log(
    `\nInstalling: ${plan.droids.length} droids, ${plan.commands.length} commands, ${plan.skills.length} skills`
  );

  const totalSkipped = skippedAgents.length + skippedCommands.length + skippedSkills.length;
  if (totalSkipped > 0) {
    console.log(`Skipping:   ${skippedAgents.length} agents, ${skippedCommands.length} commands, ${skippedSkills.length} skills (incompatible)`);
  }

  if (args.dryRun) {
    console.log("\n[DRY RUN]");
  }

  const result = await executeInstallPlan(plan, {
    force: args.force,
    dryRun: args.dryRun,
    verbose: args.verbose,
    onProgress: args.verbose ? console.log : undefined,
  });

  console.log("\nSummary:");
  console.log(`  Created: ${result.created}`);
  console.log(`  Overwritten: ${result.overwritten}`);
  console.log(`  Skipped: ${result.skipped}`);
  if (totalSkipped > 0) {
    console.log(`  Filtered (incompatible): ${totalSkipped}`);
  }

  if (result.errors.length) {
    console.log("\nErrors:");
    for (const err of result.errors) {
      console.log(`  ${err}`);
    }
  }

  // Check custom droids setting
  const customDroids = readCustomDroidsSetting();
  if (!customDroids.enabled && plan.droids.length > 0) {
    console.log(
      "\nWarning: Custom Droids are not enabled. Enable them in /settings → Experimental → Custom Droids"
    );
  }
}

async function main(): Promise<void> {
  const args = parseCliArgs();

  if (args.help) {
    console.log(HELP_TEXT);
    process.exit(0);
  }

  const isInteractive =
    process.stdin.isTTY &&
    process.stdout.isTTY &&
    !args.marketplace;

  if (isInteractive) {
    await interactiveFlow();
  } else {
    await nonInteractiveFlow(args);
  }
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
