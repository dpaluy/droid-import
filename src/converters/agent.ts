import matter from "gray-matter";
import { mapToolsForFactory } from "../analyzer";

function toArray(val: unknown): string[] | null {
  if (!val && val !== 0) return null;
  if (Array.isArray(val)) return [...new Set(val.map(String))];
  const parts = String(val)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? [...new Set(parts)] : null;
}

function sanitizeDescription(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  let s = String(input);
  // Convert literal escape sequences
  s = s.replace(/\\[nrt]/gi, " ");
  // Normalize HTML breaks
  s = s.replace(/<br\s*\/?>/gi, " ");
  s = s.replace(/<\/?:?p\b[^>]*>/gi, " ");
  // Collapse newlines and whitespace
  s = s.replace(/\s*\n\s*/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  // Replace role labels
  s = s.replace(/([A-Za-z0-9])\s*:\s+(?!\/)/g, "$1 - ");
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

export function convertAgentToDroid(
  mdText: string,
  fallbackName?: string
): string {
  let src: Record<string, unknown> = {};
  let body = "";

  try {
    const parsed = matter(mdText || "");
    src = (parsed.data as Record<string, unknown>) || {};
    body = parsed.content || "";
  } catch {
    // Fallback: salvage minimal fields from malformed frontmatter
    const text = String(mdText || "");
    const fmStart = text.indexOf("---");
    let fmEnd = -1;
    if (fmStart === 0) {
      fmEnd = text.indexOf("\n---", 3);
    }
    if (fmStart === 0 && fmEnd !== -1) {
      const fmBlock = text.slice(3, fmEnd).split(/\r?\n/);
      for (const line of fmBlock) {
        const m = /^([A-Za-z0-9_\-]+):\s*(.*)$/.exec(line.trim());
        if (!m) continue;
        const key = m[1].toLowerCase();
        const val = m[2];
        if (key === "name" && !src.name) src.name = val;
        else if (key === "description" && !src.description) src.description = val;
        else if (key === "tools" && !src.tools) src.tools = val;
      }

      // Extract examples from frontmatter
      const fmRaw = fmBlock.join("\n");
      const exampleMatches = fmRaw.match(/<example>[\s\S]*?<\/example>/gi) || [];
      if (exampleMatches.length) {
        const examplesInline = exampleMatches
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        if (src.description) {
          src.description = String(src.description) + " " + examplesInline;
        } else {
          src.description = examplesInline;
        }
      }
      body = text.slice(fmEnd + 4);
    } else {
      body = text;
    }
  }

  const toolsList = toArray(src.tools);
  const description = sanitizeDescription(src.description);
  const name = String(src.name || fallbackName || "");
  // Map Claude tools to Factory tools
  const mappedTools = toolsList ? mapToolsForFactory(toolsList) : null;
  const tools = mappedTools && mappedTools.length > 0 ? mappedTools : null;

  const lines: string[] = [];
  lines.push("---");
  lines.push(`name: ${name}`);

  if (typeof description === "string" && description.length) {
    let plainCandidate =
      description.indexOf("#") !== -1
        ? description.replace(/#/g, "＃")
        : description;
    if (isPlainYamlSafe(plainCandidate)) {
      lines.push(`description: ${plainCandidate}`);
    } else {
      lines.push(`description: "${escYaml(description)}"`);
    }
  }

  lines.push("model: inherit");

  if (tools) {
    lines.push("tools:");
    for (const t of tools) {
      lines.push(`  - ${t}`);
    }
  }

  lines.push("---");
  return lines.join("\n") + "\n\n" + (body || "");
}
