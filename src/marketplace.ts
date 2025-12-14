import { existsSync, statSync, readFileSync } from "fs";
import { join, dirname } from "path";
import type {
  MarketplaceJson,
  MarketplaceContext,
  LoadedMarketplace,
  GitHubTreeEntry,
} from "./types";

const githubTreeCache = new Map<string, GitHubTreeEntry[]>();

function isUrl(input: string): boolean {
  return /^https?:\/\//i.test(input);
}

function isOwnerRepoShorthand(input: string): boolean {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(input);
}

export async function httpGet(url: string, maxRedirects = 5): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "droid-import",
      ...(process.env.GITHUB_TOKEN && {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      }),
    },
    redirect: "follow",
  });

  if (!response.ok) {
    const err = new Error(`HTTP ${response.status} for ${url}`) as Error & {
      statusCode: number;
      url: string;
    };
    err.statusCode = response.status;
    err.url = url;
    throw err;
  }

  return response.text();
}

export async function httpGetJson<T>(url: string): Promise<T> {
  const text = await httpGet(url);
  return JSON.parse(text);
}

export async function githubGetTree(
  owner: string,
  repo: string,
  ref: string
): Promise<GitHubTreeEntry[]> {
  const key = `${owner}/${repo}@${ref}`;
  if (githubTreeCache.has(key)) {
    return githubTreeCache.get(key)!;
  }

  const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`;
  const json = await httpGetJson<{ tree: GitHubTreeEntry[] }>(url);

  if (!json || !Array.isArray(json.tree)) {
    throw new Error(`GitHub tree response malformed for ${owner}/${repo}@${ref}`);
  }

  githubTreeCache.set(key, json.tree);
  return json.tree;
}

function parseGitHubRawUrl(
  u: string
): { owner: string; repo: string; ref: string; filePath: string } | null {
  try {
    const url = new URL(u);
    if (url.hostname !== "raw.githubusercontent.com") return null;
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 3) return null;
    return {
      owner: parts[0],
      repo: parts[1],
      ref: parts[2],
      filePath: parts.slice(3).join("/"),
    };
  } catch {
    return null;
  }
}

function parseGitRepoUrl(
  u: string
): { provider: "github" | "gitlab"; owner: string; repo: string; namespacePath?: string } | null {
  try {
    const url = new URL(u);
    const host = url.hostname.toLowerCase();
    let pathname = url.pathname.replace(/\.git$/i, "").replace(/\/$/, "");
    const parts = pathname.split("/").filter(Boolean);

    if (!parts.length) return null;

    if (host === "github.com") {
      const owner = parts[0];
      const repo = parts[1];
      if (!owner || !repo) return null;
      return { provider: "github", owner, repo };
    }

    if (host === "gitlab.com") {
      if (parts.length < 2) return null;
      const namespacePath = parts.join("/");
      const repo = parts[parts.length - 1];
      return { provider: "gitlab", owner: parts[0], repo, namespacePath };
    }

    return null;
  } catch {
    return null;
  }
}

export async function loadMarketplace(
  input: string,
  ref?: string
): Promise<LoadedMarketplace> {
  if (!input) {
    throw new Error("No marketplace input provided");
  }

  // Local directory or file
  if (!isUrl(input) && !isOwnerRepoShorthand(input)) {
    let file = input;
    if (existsSync(input) && statSync(input).isDirectory()) {
      const candidate = join(input, ".claude-plugin", "marketplace.json");
      if (!existsSync(candidate)) {
        throw new Error(`marketplace.json not found in ${input}`);
      }
      file = candidate;
    }
    const json: MarketplaceJson = JSON.parse(readFileSync(file, "utf8"));
    const baseDir = dirname(file);
    return { json, context: { kind: "local", baseDir } };
  }

  // GitHub shorthand owner/repo
  if (isOwnerRepoShorthand(input)) {
    const [owner, repo] = input.split("/");
    const refsToTry = [ref, "main", "master"].filter(Boolean) as string[];
    let lastErr: Error | null = null;

    for (const r of refsToTry) {
      const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${r}/.claude-plugin/marketplace.json`;
      try {
        const text = await httpGet(rawUrl);
        const json: MarketplaceJson = JSON.parse(text);
        return {
          json,
          context: { kind: "github", gh: { owner, repo, ref: r, basePath: "" } },
        };
      } catch (e) {
        lastErr = e as Error;
      }
    }
    throw lastErr || new Error("Failed to load marketplace from GitHub shorthand");
  }

  // URL
  if (isUrl(input)) {
    const ghParsed = parseGitHubRawUrl(input);
    if (ghParsed) {
      const text = await httpGet(input);
      const json: MarketplaceJson = JSON.parse(text);
      const basePath = ghParsed.filePath
        ? dirname(ghParsed.filePath)
        : "";
      return {
        json,
        context: {
          kind: "github",
          gh: {
            owner: ghParsed.owner,
            repo: ghParsed.repo,
            ref: ghParsed.ref,
            basePath,
          },
        },
      };
    }

    const gitRepo = parseGitRepoUrl(input);
    if (gitRepo?.provider === "github") {
      const refsToTry = [ref, "main", "master"].filter(Boolean) as string[];
      let lastErr: Error | null = null;

      for (const r of refsToTry) {
        const rawUrl = `https://raw.githubusercontent.com/${gitRepo.owner}/${gitRepo.repo}/${r}/.claude-plugin/marketplace.json`;
        try {
          const text = await httpGet(rawUrl);
          const json: MarketplaceJson = JSON.parse(text);
          return {
            json,
            context: {
              kind: "github",
              gh: { owner: gitRepo.owner, repo: gitRepo.repo, ref: r, basePath: "" },
            },
          };
        } catch (e) {
          lastErr = e as Error;
        }
      }
      throw lastErr || new Error("Failed to load marketplace from GitHub URL");
    }

    // Generic URL
    const text = await httpGet(input);
    const json: MarketplaceJson = JSON.parse(text);
    return {
      json,
      context: { kind: "url", baseUrl: input.replace(/\/marketplace\.json$/, "") },
    };
  }

  throw new Error("Unsupported marketplace input");
}

export function toRawUrl(
  owner: string,
  repo: string,
  ref: string,
  repoPath: string
): string {
  const safe = repoPath.replace(/^\//, "");
  return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${safe}`;
}
