import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join, basename, posix } from "path";
import { homedir } from "os";
import type {
  DiscoveredPlugin,
  InstallPlan,
  InstallItem,
  InstallSkillItem,
  InstallResult,
} from "./types";
import { httpGet } from "./marketplace";
import { convertAgentToDroid } from "./converters/agent";
import { convertCommand } from "./converters/command";
import { convertSkillFile, isSkillMainFile } from "./converters/skill";

export function getBaseDir(scope: "personal" | "project", projectPath?: string): string {
  if (scope === "personal") {
    return join(homedir(), ".factory");
  }
  return join(projectPath || process.cwd(), ".factory");
}

export function computeInstallPlan(
  plugins: DiscoveredPlugin[],
  baseDir: string,
  options: {
    includeAgents: boolean;
    includeCommands: boolean;
    includeSkills: boolean;
  }
): InstallPlan {
  const droidsDir = join(baseDir, "droids");
  const commandsDir = join(baseDir, "commands");
  const skillsDir = join(baseDir, "skills");

  const droids: InstallItem[] = [];
  const commands: InstallItem[] = [];
  const skills: InstallSkillItem[] = [];

  for (const plugin of plugins) {
    // Agents -> Droids
    if (options.includeAgents) {
      for (const agent of plugin.agents) {
        const dest = join(droidsDir, `${agent.name}.md`);
        droids.push({
          name: agent.name,
          src: agent.src,
          srcType: agent.srcType,
          dest,
          exists: existsSync(dest),
        });
      }
    }

    // Commands
    if (options.includeCommands) {
      for (const cmd of plugin.commands) {
        const dest = join(commandsDir, `${cmd.name}.md`);
        commands.push({
          name: cmd.name,
          src: cmd.src,
          srcType: cmd.srcType,
          dest,
          exists: existsSync(dest),
        });
      }
    }

    // Skills
    if (options.includeSkills) {
      for (const skill of plugin.skills) {
        const destDir = join(skillsDir, skill.name);
        const skillFiles = skill.files.map((f) => ({
          src: f.src,
          dest: join(destDir, f.relativePath),
          srcType: f.srcType,
        }));
        skills.push({
          name: skill.name,
          srcDir: skill.srcDir,
          srcType: skill.srcType,
          destDir,
          files: skillFiles,
          exists: existsSync(destDir),
        });
      }
    }
  }

  return { droids, commands, skills };
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

async function fetchContent(src: string, srcType: "local" | "remote"): Promise<string> {
  if (srcType === "local") {
    return readFileSync(src, "utf8");
  }
  return httpGet(src);
}

export async function executeInstallPlan(
  plan: InstallPlan,
  options: {
    force: boolean;
    dryRun: boolean;
    verbose: boolean;
    onProgress?: (message: string) => void;
  }
): Promise<InstallResult> {
  const result: InstallResult = {
    created: 0,
    overwritten: 0,
    skipped: 0,
    errors: [],
  };

  const log = options.onProgress || (() => {});

  // Install droids
  for (const item of plan.droids) {
    if (item.exists && !options.force) {
      result.skipped++;
      log(`skip    ${item.dest}`);
      continue;
    }

    if (options.dryRun) {
      log(`[dry-run] would write ${item.dest}`);
      if (item.exists) result.overwritten++;
      else result.created++;
      continue;
    }

    try {
      const content = await fetchContent(item.src, item.srcType);
      const converted = convertAgentToDroid(content, item.name);
      ensureDir(dirname(item.dest));
      writeFileSync(item.dest, converted, "utf8");

      if (item.exists) {
        result.overwritten++;
        log(`overwrote ${item.dest}`);
      } else {
        result.created++;
        log(`created   ${item.dest}`);
      }
    } catch (e) {
      result.errors.push(`Failed to install droid ${item.name}: ${(e as Error).message}`);
      result.skipped++;
    }
  }

  // Install commands
  for (const item of plan.commands) {
    if (item.exists && !options.force) {
      result.skipped++;
      log(`skip    ${item.dest}`);
      continue;
    }

    if (options.dryRun) {
      log(`[dry-run] would write ${item.dest}`);
      if (item.exists) result.overwritten++;
      else result.created++;
      continue;
    }

    try {
      const content = await fetchContent(item.src, item.srcType);
      const converted = convertCommand(content);
      ensureDir(dirname(item.dest));
      writeFileSync(item.dest, converted, "utf8");

      if (item.exists) {
        result.overwritten++;
        log(`overwrote ${item.dest}`);
      } else {
        result.created++;
        log(`created   ${item.dest}`);
      }
    } catch (e) {
      result.errors.push(`Failed to install command ${item.name}: ${(e as Error).message}`);
      result.skipped++;
    }
  }

  // Install skills
  for (const skill of plan.skills) {
    if (skill.exists && !options.force) {
      result.skipped++;
      log(`skip    ${skill.destDir}`);
      continue;
    }

    if (options.dryRun) {
      log(`[dry-run] would write ${skill.destDir}/ (${skill.files.length} files)`);
      if (skill.exists) result.overwritten++;
      else result.created++;
      continue;
    }

    try {
      ensureDir(skill.destDir);

      for (const file of skill.files) {
        const content = await fetchContent(file.src, file.srcType);
        const filename = basename(file.dest);

        // Convert SKILL.md files
        let finalContent = content;
        if (isSkillMainFile(filename)) {
          finalContent = convertSkillFile(content, skill.name);
        }

        ensureDir(dirname(file.dest));
        writeFileSync(file.dest, finalContent, "utf8");
      }

      if (skill.exists) {
        result.overwritten++;
        log(`overwrote ${skill.destDir}/`);
      } else {
        result.created++;
        log(`created   ${skill.destDir}/`);
      }
    } catch (e) {
      result.errors.push(`Failed to install skill ${skill.name}: ${(e as Error).message}`);
      result.skipped++;
    }
  }

  return result;
}

export function readCustomDroidsSetting(): {
  enabled: boolean;
  error?: string;
  missing?: boolean;
} {
  const settingsPath = join(homedir(), ".factory", "settings.json");
  try {
    if (!existsSync(settingsPath)) {
      return { enabled: false, missing: true };
    }
    const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    return { enabled: !!settings.enableCustomDroids };
  } catch (e) {
    return { enabled: false, error: (e as Error).message };
  }
}
