export interface NormalizeOptions {
  availableDroids?: ReadonlySet<string>;
  availableSkills?: ReadonlySet<string>;
  fileKind: "command" | "droid" | "skill" | "generic";
  addHeaderNote?: boolean;
}

export interface NormalizeResult {
  text: string;
  changed: boolean;
  notes: string[];
  referencedDroids: string[];
  unresolvedDroids: string[];
  referencedSkills: string[];
  unresolvedSkills: string[];
}

function uniq(items: string[]): string[] {
  return [...new Set(items)];
}

function stripQuotes(s: string): string {
  return s.replace(/^['"]+|['"]+$/g, "");
}

function isLikelyDroidName(name: string): boolean {
  // Factory custom droid `name` field: lowercase letters, digits, '-', '_'
  return /^[a-z0-9_-]+$/.test(name);
}

function headerNote(kind: NormalizeOptions["fileKind"], notes: string[]): string {
  const details = notes.length ? `: ${notes.join("; ")}` : "";
  return `<!-- Factory Import Normalizer (${kind})${details} -->\n\n`;
}

function alreadyHasHeaderNote(text: string): boolean {
  return /^<!--\s*Factory Import Normalizer\b/m.test(text);
}

export function normalizeText(input: string, options: NormalizeOptions): NormalizeResult {
  const availableDroids = options.availableDroids;
  const availableSkills = options.availableSkills;
  const notes: string[] = [];
  const referencedDroids: string[] = [];
  const unresolvedDroids: string[] = [];
  const referencedSkills: string[] = [];
  const unresolvedSkills: string[] = [];

  let text = String(input ?? "");
  const original = text;

  // Replace explicit AskUserQuestion tool references.
  if (/AskUserQuestion/.test(text)) {
    // Most common phrasing.
    text = text.replace(/\bUse\s+`?AskUserQuestion`?\b/gi, "Ask the user");
    text = text.replace(/\bInvoke\s+`?AskUserQuestion`?\b/gi, "Ask the user");
    // Any remaining mentions.
    text = text.replace(/`AskUserQuestion`/g, "ask the user");
    text = text.replace(/\bAskUserQuestion\b/g, "ask the user");
    notes.push("removed AskUserQuestion");
  }

  // Convert one-line "agent <name> ..." invocations to Task tool guidance.
  // We keep the remainder of the line intact to avoid mangling prompts.
  text = text.replace(/^([\t ]*)agent\s+([^\s]+)(.*)$/gim, (_m, indent: string, rawName: string, rest: string) => {
    const name = stripQuotes(String(rawName).trim());
    referencedDroids.push(name);
    if (availableDroids && availableDroids.has(name)) {
      return `${indent}Use Task tool with subagent_type \`${name}\`${rest || ""}`;
    }

    if (isLikelyDroidName(name)) {
      unresolvedDroids.push(name);
      return `${indent}Use Task tool with subagent_type \`${name}\` (if available)${rest || ""}`;
    }

    unresolvedDroids.push(name);
    return `${indent}Use Task tool with subagent_type \`${name}\` (legacy name; may not exist)${rest || ""}`;
  });

  // Convert one-line "skill <name> ..." invocations to Skill tool guidance.
  text = text.replace(/^([\t ]*)skill\s+([^\s]+)(.*)$/gim, (_m, indent: string, rawName: string, rest: string) => {
    const name = stripQuotes(String(rawName).trim());
    referencedSkills.push(name);
    if (availableSkills && availableSkills.has(name)) {
      return `${indent}Use Skill tool: \`${name}\`${rest || ""}`;
    }
    unresolvedSkills.push(name);
    return `${indent}Use Skill tool: \`${name}\` (if available)${rest || ""}`;
  });

  if (text !== original) {
    if (/Use Task tool with subagent_type/.test(text)) notes.push("converted agent invocations");
    if (/Use Skill tool:/.test(text)) notes.push("converted skill invocations");
  }

  const changed = text !== original;
  if (changed && options.addHeaderNote !== false && !alreadyHasHeaderNote(text)) {
    text = headerNote(options.fileKind, uniq(notes)) + text;
  }

  return {
    text,
    changed,
    notes: uniq(notes),
    referencedDroids: uniq(referencedDroids),
    unresolvedDroids: uniq(unresolvedDroids),
    referencedSkills: uniq(referencedSkills),
    unresolvedSkills: uniq(unresolvedSkills),
  };
}
