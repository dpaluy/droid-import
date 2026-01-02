import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import { normalizeText } from "./normalizer";

function listFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;

  const visit = (current: string) => {
    const entries = readdirSync(current);
    for (const entry of entries) {
      const full = join(current, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        visit(full);
      } else {
        out.push(full);
      }
    }
  };

  visit(dir);
  return out;
}

function listMarkdownFiles(dir: string, recursive: boolean): string[] {
  const files = recursive ? listFilesRecursive(dir) : readdirSync(dir).map((f) => join(dir, f));
  return files
    .filter((p) => p.toLowerCase().endsWith(".md"))
    .filter((p) => existsSync(p) && statSync(p).isFile());
}

export interface NormalizeInstalledOptions {
  dryRun: boolean;
  verbose: boolean;
}

export interface NormalizeInstalledResult {
  scanned: number;
  changed: number;
  errors: string[];
}

export function normalizeInstalled(
  baseDir: string,
  options: NormalizeInstalledOptions
): NormalizeInstalledResult {
  const errors: string[] = [];
  let scanned = 0;
  let changed = 0;

  const commandsDir = join(baseDir, "commands");
  const droidsDir = join(baseDir, "droids");
  const skillsDir = join(baseDir, "skills");

  const commandFiles = existsSync(commandsDir)
    ? listMarkdownFiles(commandsDir, true)
    : [];
  const droidFiles = existsSync(droidsDir)
    ? listMarkdownFiles(droidsDir, true)
    : [];
  const skillMdFiles = existsSync(skillsDir)
    ? listMarkdownFiles(skillsDir, true)
    : [];

  const all: Array<{ kind: "command" | "droid" | "skill"; path: string }> = [
    ...commandFiles.map((path) => ({ kind: "command" as const, path })),
    ...droidFiles.map((path) => ({ kind: "droid" as const, path })),
    ...skillMdFiles.map((path) => ({ kind: "skill" as const, path })),
  ];

  for (const file of all) {
    scanned++;
    try {
      const content = readFileSync(file.path, "utf8");
      const normalized = normalizeText(content, {
        fileKind: file.kind,
        addHeaderNote: false,
      });

      if (!normalized.changed) {
        if (options.verbose) console.log(`ok      ${file.path}`);
        continue;
      }

      changed++;
      if (options.verbose) console.log(`${options.dryRun ? "[dry]" : "fix"}     ${file.path}`);
      if (!options.dryRun) {
        writeFileSync(file.path, normalized.text, "utf8");
      }
    } catch (e) {
      errors.push(`${file.path}: ${(e as Error).message}`);
    }
  }

  return { scanned, changed, errors };
}
