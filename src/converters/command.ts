import matter from "gray-matter";
import { mapToolsForFactory } from "../analyzer";
import { normalizeText } from "../normalizer";

const ALLOWED_FRONTMATTER_KEYS = new Set([
  "description",
  "argument-hint",
  "allowed-tools",
]);

function sanitizeValue(val: unknown): string | undefined {
  if (typeof val !== "string") return undefined;
  let s = String(val);
  s = s.replace(/\\[nrt]/gi, " ");
  s = s.replace(/\s*\n\s*/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s || undefined;
}

function isPlainYamlSafe(s: string): boolean {
  if (typeof s !== "string") return false;
  if (!s.length) return true;
  if (/[\r\n]/.test(s)) return false;
  if (/^\s/.test(s)) return false;
  if (/\s$/.test(s)) return false;
  if (/^[-?:,\[\]{}#&*!|>'"%@`]/.test(s)) return false;
  if (/#/.test(s)) return false;
  return true;
}

function escYaml(s: string): string {
  return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function convertCommand(mdText: string): string {
  let src: Record<string, unknown> = {};
  let body = "";

  try {
    const parsed = matter(mdText || "");
    src = (parsed.data as Record<string, unknown>) || {};
    body = parsed.content || "";
  } catch {
    // If parsing fails, return original
    return mdText;
  }

  // Filter to only allowed keys
  const filtered: Record<string, unknown> = {};
  for (const key of Object.keys(src)) {
    if (ALLOWED_FRONTMATTER_KEYS.has(key)) {
      filtered[key] = src[key];
    }
  }

  // Normalize the body for Factory (best-effort)
  const normalizedBody = normalizeText(body || "", {
    fileKind: "command",
    addHeaderNote: false,
  }).text;

  // If no frontmatter after filtering, just return body
  if (Object.keys(filtered).length === 0) {
    return normalizedBody.trim() ? normalizedBody : mdText;
  }

  const lines: string[] = [];
  lines.push("---");

  if (filtered.description) {
    const desc = sanitizeValue(filtered.description);
    if (desc) {
      if (isPlainYamlSafe(desc)) {
        lines.push(`description: ${desc}`);
      } else {
        lines.push(`description: "${escYaml(desc)}"`);
      }
    }
  }

  if (filtered["argument-hint"]) {
    const hint = sanitizeValue(filtered["argument-hint"]);
    if (hint) {
      if (isPlainYamlSafe(hint)) {
        lines.push(`argument-hint: ${hint}`);
      } else {
        lines.push(`argument-hint: "${escYaml(hint)}"`);
      }
    }
  }

  if (filtered["allowed-tools"]) {
    const rawTools = filtered["allowed-tools"];
    let toolList: string[] = [];
    if (Array.isArray(rawTools)) {
      toolList = rawTools.map(String);
    } else if (typeof rawTools === "string") {
      toolList = rawTools
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
    }
    // Map Claude tools to Factory tools
    const mappedTools = mapToolsForFactory(toolList);
    if (mappedTools.length === 1) {
      lines.push(`allowed-tools:`);
      lines.push(`  - ${mappedTools[0]}`);
    } else if (mappedTools.length > 1) {
      lines.push("allowed-tools:");
      for (const t of mappedTools) {
        lines.push(`  - ${t}`);
      }
    }
  }

  lines.push("---");
  return lines.join("\n") + "\n\n" + normalizedBody;
}
