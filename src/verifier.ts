import { spawn } from "child_process";
import type { InstallPlan } from "./types";

function buildVerificationPrompt(plan: InstallPlan, baseDir: string): string {
  const droids = plan.droids.map((d) => d.name);
  const commands = plan.commands.map((c) => c.name);
  const skills = plan.skills.map((s) => s.name);

  const sections: string[] = [];
  
  if (droids.length > 0) {
    sections.push(`Droids (${droids.length}): ${droids.slice(0, 5).join(", ")}${droids.length > 5 ? ` and ${droids.length - 5} more` : ""}`);
  }
  if (commands.length > 0) {
    sections.push(`Commands (${commands.length}): ${commands.slice(0, 5).join(", ")}${commands.length > 5 ? ` and ${commands.length - 5} more` : ""}`);
  }
  if (skills.length > 0) {
    sections.push(`Skills (${skills.length}): ${skills.slice(0, 5).join(", ")}${skills.length > 5 ? ` and ${skills.length - 5} more` : ""}`);
  }

  return `I just imported Claude Code marketplace plugins to ${baseDir}. Please verify the imported files are Factory AI compatible.

## What was imported:
${sections.join("\n")}

## Verification tasks:
1. Sample 3-5 files from each category (droids, commands, skills)
2. Check that allowed-tools/tools use Factory AI tool names: Execute, Create, Edit, Read, Grep, Glob, FetchUrl, WebSearch, TodoWrite, Task, Skill
3. Check that NO Claude-specific tools remain: Bash, Write, WebFetch, AskUserQuestion
4. Report any files that need manual fixes

Start by listing files in ${baseDir}/droids, ${baseDir}/commands, and ${baseDir}/skills.`;
}

export async function runDroidVerification(plan: InstallPlan, baseDir: string): Promise<void> {
  const prompt = buildVerificationPrompt(plan, baseDir);
  
  console.log("\nLaunching droid CLI to verify imported files...\n");
  
  return new Promise((resolve) => {
    const droid = spawn("droid", [prompt], {
      stdio: "inherit",
      shell: true,
    });

    droid.on("error", (err) => {
      console.error("Failed to launch droid CLI:", err.message);
      console.log("You can manually verify by running: droid");
      resolve();
    });

    droid.on("close", (code) => {
      if (code !== 0) {
        console.log(`\nDroid CLI exited with code ${code}`);
      }
      resolve();
    });
  });
}
