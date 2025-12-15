import * as p from "@clack/prompts";
import { loadMarketplace } from "../marketplace";
import { discoverPlugins } from "../discovery";
import {
  getBaseDir,
  computeFilteredInstallPlan,
  executeInstallPlan,
  readCustomDroidsSetting,
} from "../installer";
import { analyzePlugin, type PluginAnalysis } from "../analyzer";
import type { DiscoveredPlugin } from "../types";

function formatPluginChoice(plugin: DiscoveredPlugin): string {
  const parts: string[] = [];
  if (plugin.agents.length) parts.push(`${plugin.agents.length} agents`);
  if (plugin.commands.length) parts.push(`${plugin.commands.length} commands`);
  if (plugin.skills.length) parts.push(`${plugin.skills.length} skills`);
  const counts = parts.length ? ` (${parts.join(", ")})` : "";
  return `${plugin.name}${counts}`;
}

export async function interactiveFlow(): Promise<void> {
  const pkg = await import("../../package.json");
  p.intro(`droid-import v${pkg.version}`);

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

  const selectedDiscovered = discovered.filter((p) =>
    (selectedPlugins as string[]).includes(p.name)
  );

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

  const analyzeSpinner = p.spinner();
  analyzeSpinner.start("Analyzing compatibility...");

  const analyses: PluginAnalysis[] = [];
  for (const plugin of selectedDiscovered) {
    const analysis = await analyzePlugin(plugin);
    analyses.push(analysis);
  }

  analyzeSpinner.stop("Analysis complete");

  const totalIncompat =
    analyses.reduce((sum, a) => sum + (a.summary.totalAgents - a.summary.compatibleAgents), 0) +
    analyses.reduce((sum, a) => sum + (a.summary.totalCommands - a.summary.compatibleCommands), 0) +
    analyses.reduce((sum, a) => sum + (a.summary.totalSkills - a.summary.compatibleSkills), 0);

  if (totalIncompat > 0) {
    p.log.warn(`${totalIncompat} items will be skipped (incompatible with Factory AI)`);
  }

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

  const totalItems = plan.droids.length + plan.commands.length + plan.skills.length;

  if (totalItems === 0) {
    p.log.warn("Nothing to install (all items incompatible or filtered)");
    process.exit(0);
  }

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

  const customDroids = readCustomDroidsSetting();
  if (!customDroids.enabled && plan.droids.length > 0) {
    p.log.warn(
      "Custom Droids are not enabled. Enable them in /settings → Experimental → Custom Droids"
    );
  }

  p.outro("Done!");
}
