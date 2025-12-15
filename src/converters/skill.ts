import matter from "gray-matter";
import { mapToolsForFactory } from "../analyzer";

const ALLOWED_FRONTMATTER_KEYS = new Set([
  "name",
  "description",
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

export function convertSkillFile(mdText: string, fallbackName?: string): string {
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

  // For skill files, we preserve more content but normalize the frontmatter
  const lines: string[] = [];
  lines.push("---");

  // Name
  const name = sanitizeValue(src.name) || fallbackName;
  if (name) {
    if (isPlainYamlSafe(name)) {
      lines.push(`name: ${name}`);
    } else {
      lines.push(`name: "${escYaml(name)}"`);
    }
  }

  // Description (can be multi-line, so we use special handling)
  if (src.description) {
    const desc = typeof src.description === "string" ? src.description : String(src.description);
    // For long descriptions, use literal block scalar
    if (desc.includes("\n") || desc.length > 100) {
      lines.push("description: |");
      for (const line of desc.split("\n")) {
        lines.push(`  ${line}`);
      }
    } else {
      const sanitized = sanitizeValue(desc);
      if (sanitized) {
        if (isPlainYamlSafe(sanitized)) {
          lines.push(`description: ${sanitized}`);
        } else {
          lines.push(`description: "${escYaml(sanitized)}"`);
        }
      }
    }
  }

  // Allowed tools
  if (src["allowed-tools"]) {
    const rawTools = src["allowed-tools"];
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
      lines.push("allowed-tools:");
      lines.push(`  - ${mappedTools[0]}`);
    } else if (mappedTools.length > 1) {
      lines.push("allowed-tools:");
      for (const t of mappedTools) {
        lines.push(`  - ${t}`);
      }
    }
  }

  lines.push("---");
  return lines.join("\n") + "\n\n" + (body || "");
}

export function isSkillMainFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  return lower === "skill.md" || lower === "skill.mdx";
}
