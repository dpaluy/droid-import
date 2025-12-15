import { loadMarketplace } from "../marketplace";
import { discoverPlugins } from "../discovery";
import {
  getBaseDir,
  computeFilteredInstallPlan,
  computeInstallPlan,
  executeInstallPlan,
  readCustomDroidsSetting,
} from "../installer";
import { analyzePlugin, formatAnalysisReport, type PluginAnalysis } from "../analyzer";
import { runDroidVerification } from "../verifier";
import type { DiscoveredPlugin } from "../types";

export interface NonInteractiveArgs {
  marketplace: string;
  plugins?: string[];
  scope: "personal" | "project";
  path?: string;
  force: boolean;
  dryRun: boolean;
  analyze: boolean;
  noFilter: boolean;
  verbose: boolean;
  verify: boolean;
  components: {
    agents: boolean;
    commands: boolean;
    skills: boolean;
  };
}

export async function nonInteractiveFlow(args: NonInteractiveArgs): Promise<void> {
  const pkg = await import("../../package.json");
  console.log(`droid-import v${pkg.version}`);

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

  let selectedDiscovered = discovered;
  if (args.plugins && args.plugins.length > 0) {
    selectedDiscovered = discovered.filter((p) => args.plugins!.includes(p.name));
    if (!selectedDiscovered.length) {
      console.error(
        `No matching plugins found. Available: ${discovered.map((p) => p.name).join(", ")}`
      );
      process.exit(1);
    }
  }

  console.log("Analyzing compatibility...");
  const analyses: PluginAnalysis[] = [];
  for (const plugin of selectedDiscovered) {
    if (args.verbose) {
      console.log(`  Analyzing ${plugin.name}...`);
    }
    const analysis = await analyzePlugin(plugin);
    analyses.push(analysis);
  }

  if (args.analyze) {
    console.log("\n" + formatAnalysisReport(analyses));
    if (!args.force && !args.dryRun) {
      console.log("\nUse --dry-run to preview install or --force to proceed with import.");
      process.exit(0);
    }
  }

  const baseDir = getBaseDir(args.scope, args.path);

  let plan;
  let skippedAgents: string[] = [];
  let skippedCommands: string[] = [];
  let skippedSkills: string[] = [];

  if (args.noFilter) {
    plan = computeInstallPlan(selectedDiscovered, baseDir, {
      includeAgents: args.components.agents,
      includeCommands: args.components.commands,
      includeSkills: args.components.skills,
    });
  } else {
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

  const totalItems = plan.droids.length + plan.commands.length + plan.skills.length;

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

  const customDroids = readCustomDroidsSetting();
  if (!customDroids.enabled && plan.droids.length > 0) {
    console.log(
      "\nWarning: Custom Droids are not enabled. Enable them in /settings → Experimental → Custom Droids"
    );
  }

  if (args.verify && !args.dryRun && (result.created > 0 || result.overwritten > 0)) {
    await runDroidVerification(plan, baseDir);
  }
}
