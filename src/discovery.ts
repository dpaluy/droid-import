import { existsSync, statSync, readdirSync } from "fs";
import { join, basename, posix } from "path";
import type {
  MarketplaceJson,
  MarketplaceContext,
  PluginDefinition,
  DiscoveredPlugin,
  DiscoveredFile,
  DiscoveredSkill,
  SkillFile,
  GitHubTreeEntry,
} from "./types";
import { githubGetTree, toRawUrl } from "./marketplace";

interface ResolvedSource {
  kind: "local" | "github" | "gitlab" | "unsupported";
  localDir?: string;
  github?: { owner: string; repo: string; ref: string; path: string };
  gitlab?: { namespacePath: string; repo: string; ref: string; path: string };
  reason?: string;
  overrides?: {
    commands?: string | string[];
    agents?: string | string[];
    skills?: string | string[];
  };
}

function resolvePluginSource(
  plugin: PluginDefinition,
  context: MarketplaceContext
): ResolvedSource {
  const overrides = {
    commands: plugin.commands,
    agents: plugin.agents,
    skills: plugin.skills,
  };
  const src = plugin.source;
  const pluginRoot = "";

  if (typeof src === "string") {
    if (context.kind === "local" && context.baseDir) {
      const base = join(context.baseDir, pluginRoot);
      return { kind: "local", localDir: join(base, src), overrides };
    }
    if (context.kind === "github" && context.gh) {
      const basePath = posix.join(context.gh.basePath || "", pluginRoot);
      const full = posix.join(basePath, src);
      return { kind: "github", github: { ...context.gh, path: full }, overrides };
    }
    return { kind: "unsupported", reason: "Non-GitHub remote source path", overrides };
  }

  if (src && typeof src === "object") {
    const type = (src.source || src.type || "").toLowerCase();
    if (type === "github") {
      const repo = src.repo || src.repository;
      if (!repo) return { kind: "unsupported", reason: "Missing GitHub repo", overrides };
      const [owner, repoName] = repo.split("/");
      const ref = src.ref || context.gh?.ref || "main";
      const basePath = src.path || "";
      return { kind: "github", github: { owner, repo: repoName, ref, path: basePath }, overrides };
    }
  }

  return { kind: "unsupported", reason: "Unknown source type", overrides };
}

function listMarkdownFilesLocal(dir: string): string[] {
  try {
    if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => join(dir, f))
      .sort();
  } catch {
    return [];
  }
}

function listSkillDirsLocal(dir: string): string[] {
  try {
    if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
    return readdirSync(dir)
      .map((f) => join(dir, f))
      .filter((p) => existsSync(p) && statSync(p).isDirectory())
      .filter((p) => {
        const skillFile = join(p, "SKILL.md");
        const skillMdx = join(p, "skill.mdx");
        return existsSync(skillFile) || existsSync(skillMdx);
      })
      .sort();
  } catch {
    return [];
  }
}

function getAllFilesInDir(dir: string, base = ""): string[] {
  const files: string[] = [];
  try {
    if (!existsSync(dir) || !statSync(dir).isDirectory()) return files;
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      const relativePath = base ? posix.join(base, entry) : entry;
      if (statSync(fullPath).isDirectory()) {
        files.push(...getAllFilesInDir(fullPath, relativePath));
      } else {
        files.push(relativePath);
      }
    }
  } catch {}
  return files;
}

async function scanPluginLocal(
  localDir: string,
  overrides?: ResolvedSource["overrides"]
): Promise<{
  agents: DiscoveredFile[];
  commands: DiscoveredFile[];
  skills: DiscoveredSkill[];
  errors: string[];
}> {
  const errors: string[] = [];

  if (!existsSync(localDir) || !statSync(localDir).isDirectory()) {
    errors.push(`Local source not found: ${localDir}`);
    return { agents: [], commands: [], skills: [], errors };
  }

  const commandsDir =
    typeof overrides?.commands === "string"
      ? join(localDir, overrides.commands)
      : join(localDir, "commands");
  const agentsDir =
    typeof overrides?.agents === "string"
      ? join(localDir, overrides.agents)
      : join(localDir, "agents");
  const skillsDir =
    typeof overrides?.skills === "string"
      ? join(localDir, overrides.skills)
      : join(localDir, "skills");

  const agentFiles = Array.isArray(overrides?.agents)
    ? overrides.agents.map((p) => join(localDir, p)).filter((p) => existsSync(p))
    : listMarkdownFilesLocal(agentsDir);

  const commandFiles = Array.isArray(overrides?.commands)
    ? overrides.commands.map((p) => join(localDir, p)).filter((p) => existsSync(p))
    : listMarkdownFilesLocal(commandsDir);

  const agents: DiscoveredFile[] = agentFiles.map((src) => ({
    name: basename(src, ".md"),
    srcType: "local",
    src,
  }));

  const commands: DiscoveredFile[] = commandFiles.map((src) => ({
    name: basename(src, ".md"),
    srcType: "local",
    src,
  }));

  const skillDirs = listSkillDirsLocal(skillsDir);
  const skills: DiscoveredSkill[] = skillDirs.map((srcDir) => {
    const name = basename(srcDir);
    const allFiles = getAllFilesInDir(srcDir);
    const files: SkillFile[] = allFiles.map((relativePath) => ({
      relativePath,
      src: join(srcDir, relativePath),
      srcType: "local" as const,
    }));
    return { name, srcType: "local" as const, srcDir, files };
  });

  return { agents, commands, skills, errors };
}

async function scanPluginGithub(
  gh: { owner: string; repo: string; ref: string; path: string },
  overrides?: ResolvedSource["overrides"]
): Promise<{
  agents: DiscoveredFile[];
  commands: DiscoveredFile[];
  skills: DiscoveredSkill[];
  errors: string[];
}> {
  const errors: string[] = [];
  const base = gh.path || "";

  const commandsPath =
    typeof overrides?.commands === "string"
      ? posix.join(base, overrides.commands)
      : posix.join(base, "commands");
  const agentsPath =
    typeof overrides?.agents === "string"
      ? posix.join(base, overrides.agents)
      : posix.join(base, "agents");
  const skillsPath =
    typeof overrides?.skills === "string"
      ? posix.join(base, overrides.skills)
      : posix.join(base, "skills");

  let tree: GitHubTreeEntry[];
  try {
    tree = await githubGetTree(gh.owner, gh.repo, gh.ref);
  } catch (e) {
    errors.push(`Failed to fetch GitHub tree: ${(e as Error).message}`);
    return { agents: [], commands: [], skills: [], errors };
  }

  const isMarkdown = (p: string) => /\.md$/i.test(p);
  const normalize = (p: string) => p.replace(/^\/+/, "").replace(/\/+/g, "/").replace(/\/+$/, "");

  function listFilesFromTree(pathInRepo: string, filter?: (p: string) => boolean): string[] {
    const normalized = normalize(pathInRepo);
    if (!normalized) return [];
    const prefix = normalized + "/";
    const results: string[] = [];

    for (const entry of tree) {
      if (entry.type !== "blob" || !entry.path.startsWith(prefix)) continue;
      const remainder = entry.path.slice(prefix.length);
      if (!remainder || remainder.includes("/")) continue;
      if (filter && !filter(entry.path)) continue;
      results.push(toRawUrl(gh.owner, gh.repo, gh.ref, entry.path));
    }
    return results;
  }

  function listSkillsFromTree(pathInRepo: string): Map<string, string[]> {
    const normalized = normalize(pathInRepo);
    if (!normalized) return new Map();
    const prefix = normalized + "/";
    const skillsMap = new Map<string, string[]>();

    for (const entry of tree) {
      if (entry.type !== "blob" || !entry.path.startsWith(prefix)) continue;
      const remainder = entry.path.slice(prefix.length);
      const parts = remainder.split("/");
      if (parts.length < 2) continue;

      const skillName = parts[0];
      const relativePath = parts.slice(1).join("/");

      if (!skillsMap.has(skillName)) {
        skillsMap.set(skillName, []);
      }
      skillsMap.get(skillName)!.push(relativePath);
    }

    // Filter to only directories with SKILL.md or skill.mdx
    for (const [name, files] of skillsMap) {
      const hasSkillFile = files.some(
        (f) => f === "SKILL.md" || f === "skill.mdx"
      );
      if (!hasSkillFile) {
        skillsMap.delete(name);
      }
    }

    return skillsMap;
  }

  // Agents
  const agentUrls = Array.isArray(overrides?.agents)
    ? overrides.agents.map((p) => toRawUrl(gh.owner, gh.repo, gh.ref, posix.join(base, p)))
    : listFilesFromTree(agentsPath, isMarkdown);

  const agents: DiscoveredFile[] = agentUrls.map((src) => {
    const urlParts = src.split("/");
    const filename = urlParts[urlParts.length - 1];
    return {
      name: filename.replace(/\.md$/i, ""),
      srcType: "remote" as const,
      src,
    };
  });

  // Commands
  const commandUrls = Array.isArray(overrides?.commands)
    ? overrides.commands.map((p) => toRawUrl(gh.owner, gh.repo, gh.ref, posix.join(base, p)))
    : listFilesFromTree(commandsPath, isMarkdown);

  const commands: DiscoveredFile[] = commandUrls.map((src) => {
    const urlParts = src.split("/");
    const filename = urlParts[urlParts.length - 1];
    return {
      name: filename.replace(/\.md$/i, ""),
      srcType: "remote" as const,
      src,
    };
  });

  // Skills
  const skillsMap = listSkillsFromTree(skillsPath);
  const skills: DiscoveredSkill[] = [];

  for (const [name, fileList] of skillsMap) {
    const srcDir = posix.join(skillsPath, name);
    const files: SkillFile[] = fileList.map((relativePath) => ({
      relativePath,
      src: toRawUrl(gh.owner, gh.repo, gh.ref, posix.join(srcDir, relativePath)),
      srcType: "remote" as const,
    }));
    skills.push({ name, srcType: "remote", srcDir, files });
  }

  return { agents, commands, skills, errors };
}

export async function discoverPlugins(
  json: MarketplaceJson,
  context: MarketplaceContext
): Promise<DiscoveredPlugin[]> {
  const plugins = Array.isArray(json.plugins) ? json.plugins : [];
  const results: DiscoveredPlugin[] = [];

  for (const p of plugins) {
    if (!p.name) continue;

    const resolved = resolvePluginSource(p, context);
    let scan = { agents: [], commands: [], skills: [], errors: [] } as {
      agents: DiscoveredFile[];
      commands: DiscoveredFile[];
      skills: DiscoveredSkill[];
      errors: string[];
    };

    try {
      if (resolved.kind === "local" && resolved.localDir) {
        scan = await scanPluginLocal(resolved.localDir, resolved.overrides);
      } else if (resolved.kind === "github" && resolved.github) {
        scan = await scanPluginGithub(resolved.github, resolved.overrides);
      } else if (resolved.kind === "unsupported") {
        scan.errors.push(resolved.reason || "Unsupported source");
      }
    } catch (e) {
      scan.errors.push(`Plugin ${p.name} scan error: ${(e as Error).message}`);
    }

    results.push({
      name: p.name,
      description: p.description || "",
      agents: scan.agents,
      commands: scan.commands,
      skills: scan.skills,
      errors: scan.errors,
    });
  }

  return results;
}
