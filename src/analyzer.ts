import matter from "gray-matter";
import type { DiscoveredPlugin, DiscoveredFile, DiscoveredSkill } from "./types";
import { httpGet } from "./marketplace";
import { readFileSync } from "fs";

// Factory AI valid tools
export const FACTORY_TOOLS = new Set([
  // Read-only
  "Read",
  "LS",
  "Grep",
  "Glob",
  // Edit
  "Create",
  "Edit",
  "ApplyPatch",
  "MultiEdit",
  // Execute
  "Execute",
  // Web
  "WebSearch",
  "FetchUrl",
  // Special
  "TodoWrite",
  "Task",
  "Skill",
  // Categories (allowed as values)
  "read-only",
  "edit",
  "execute",
  "web",
  "mcp",
]);

// Claude Code tools that map to Factory tools
export const TOOL_MAPPING: Record<string, string | null> = {
  // Direct mappings
  Read: "Read",
  Write: "Create", // Claude's Write -> Factory's Create (for new files)
  Edit: "Edit",
  MultiEdit: "MultiEdit",
  Bash: "Execute", // Claude's Bash -> Factory's Execute
  Execute: "Execute",
  Glob: "Glob",
  Grep: "Grep",
  LS: "LS",
  WebSearch: "WebSearch",
  FetchUrl: "FetchUrl",
  TodoWrite: "TodoWrite",
  Task: "Task",
  Create: "Create",
  ApplyPatch: "ApplyPatch",
  Skill: "Skill",
  // Tools that don't have Factory equivalents
  NotebookEdit: null,
  BrowseURL: null, // Use WebSearch/FetchUrl instead
  WebFetch: "FetchUrl", // Claude's WebFetch -> Factory's FetchUrl
  // Claude-specific interactive tools
  AskUserQuestion: null, // No Factory equivalent - use conversation flow
};

// Claude-specific patterns that indicate incompatibility
const CLAUDE_SPECIFIC_PATTERNS = [
  /\/claude\s+/i, // References to /claude command
  /claude\s+code\s+specific/i,
  /NotebookEdit/,
  /@claude/i,
];

const LEGACY_RUNTIME_PATTERNS: Array<{ re: RegExp; warning: string; suggestion?: string }> = [
  {
    re: /\bAskUserQuestion\b/,
    warning: "References AskUserQuestion (not available in Factory) - should ask questions in normal chat",
    suggestion: "Replace 'AskUserQuestion' references with plain-language prompts to ask the user",
  },
  {
    re: /^\s*agent\s+\S+/m,
    warning: "Contains 'agent <name>' invocations - Factory uses the Task tool + subagent_type",
    suggestion: "Replace 'agent <name>' with guidance to use the Task tool (subagent_type: <name>)",
  },
  {
    re: /^\s*skill\s+\S+/m,
    warning: "Contains 'skill <name>' invocations - Factory uses the Skill tool",
    suggestion: "Replace 'skill <name>' with guidance to use the Skill tool",
  },
  {
    re: /\b\.claude\//,
    warning: "References .claude/ paths - Factory uses .factory/ for most local automation/config",
    suggestion: "If this is a Factory workflow, update paths to .factory/ equivalents",
  },
];

export interface AnalysisResult {
  compatible: boolean;
  score: number; // 0-100
  issues: string[];
  warnings: string[];
  mappedTools: string[];
  unmappedTools: string[];
  requiredMcps: string[];
  suggestions: string[];
}

export interface PluginAnalysis {
  name: string;
  description: string;
  agents: ItemAnalysis[];
  commands: ItemAnalysis[];
  skills: SkillAnalysis[];
  summary: {
    totalAgents: number;
    compatibleAgents: number;
    totalCommands: number;
    compatibleCommands: number;
    totalSkills: number;
    compatibleSkills: number;
    overallScore: number;
  };
}

export interface ItemAnalysis {
  name: string;
  src: string;
  result: AnalysisResult;
}

export interface SkillAnalysis {
  name: string;
  srcDir: string;
  result: AnalysisResult;
}

function parseTools(toolsValue: unknown): string[] {
  if (!toolsValue) return [];
  if (Array.isArray(toolsValue)) return toolsValue.map(String);
  if (typeof toolsValue === "string") {
    return toolsValue
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }
  return [];
}

// Pattern to detect MCP tools: mcp__<server>__<tool> or mcp__<server>__* or mcp__<server>
const MCP_TOOL_PATTERN = /^mcp__([a-zA-Z0-9_-]+)(?:__(.+))?$/;

// Pattern to detect Bash/Execute tool restrictions: Bash(pattern) or Execute(pattern)
// Claude Code uses this syntax to restrict which shell commands are allowed
const BASH_RESTRICTION_PATTERN = /^(Bash|Execute)\(.+\)$/;

function analyzeTools(tools: string[]): {
  mapped: string[];
  unmapped: string[];
  requiredMcps: string[];
  issues: string[];
  warnings: string[];
  suggestions: string[];
} {
  const mapped: string[] = [];
  const unmapped: string[] = [];
  const requiredMcps: string[] = [];
  const issues: string[] = [];
  const warnings: string[] = [];
  const suggestions: string[] = [];

  for (const tool of tools) {
    // Check if it's already a valid Factory tool
    if (FACTORY_TOOLS.has(tool)) {
      mapped.push(tool);
      continue;
    }

    // Check if it's an MCP tool - Factory supports MCPs
    const mcpMatch = MCP_TOOL_PATTERN.exec(tool);
    if (mcpMatch) {
      const mcpServer = mcpMatch[1];
      if (!requiredMcps.includes(mcpServer)) {
        requiredMcps.push(mcpServer);
      }
      mapped.push(tool); // Keep MCP tools as-is
      continue;
    }

    // Check if it's a Bash/Execute restriction pattern like Bash(git *) or Execute(npm *)
    // These map to Factory's Execute tool
    if (BASH_RESTRICTION_PATTERN.test(tool)) {
      mapped.push("Execute");
      continue;
    }

    // Check if we can map it
    const mapping = TOOL_MAPPING[tool];
    if (mapping) {
      mapped.push(mapping);
    } else if (mapping === null) {
      unmapped.push(tool);
      // Special handling for AskUserQuestion - it's a warning, not an error
      if (tool === "AskUserQuestion") {
        warnings.push("AskUserQuestion not available - agent will use conversation flow for clarification");
        suggestions.push("Consider adding 'Ask clarifying questions before proceeding' to the prompt");
      } else {
        issues.push(`Tool '${tool}' has no Factory equivalent`);
      }
    } else {
      // Unknown tool - might be Claude-specific
      unmapped.push(tool);
      issues.push(`Unknown tool '${tool}' - may be Claude-specific`);
    }
  }

  if (requiredMcps.length > 0) {
    warnings.push(`Requires MCP servers: ${requiredMcps.join(", ")}`);
  }

  return { mapped: [...new Set(mapped)], unmapped, requiredMcps, issues, warnings, suggestions };
}

function checkClaudeSpecificContent(content: string): string[] {
  const issues: string[] = [];
  for (const pattern of CLAUDE_SPECIFIC_PATTERNS) {
    if (pattern.test(content)) {
      issues.push(`Contains Claude-specific reference: ${pattern.source}`);
    }
  }
  return issues;
}

function checkLegacyRuntimeContent(content: string): { warnings: string[]; suggestions: string[] } {
  const warnings: string[] = [];
  const suggestions: string[] = [];
  for (const { re, warning, suggestion } of LEGACY_RUNTIME_PATTERNS) {
    if (re.test(content)) {
      warnings.push(warning);
      if (suggestion) suggestions.push(suggestion);
    }
  }
  return { warnings: [...new Set(warnings)], suggestions: [...new Set(suggestions)] };
}

async function fetchContent(
  src: string,
  srcType: "local" | "remote"
): Promise<string> {
  if (srcType === "local") {
    return readFileSync(src, "utf8");
  }
  return httpGet(src);
}

export async function analyzeAgent(
  agent: DiscoveredFile
): Promise<AnalysisResult> {
  const issues: string[] = [];
  const warnings: string[] = [];
  const suggestions: string[] = [];

  let content: string;
  try {
    content = await fetchContent(agent.src, agent.srcType);
  } catch (e) {
    return {
      compatible: false,
      score: 0,
      issues: [`Failed to fetch content: ${(e as Error).message}`],
      warnings: [],
      mappedTools: [],
      unmappedTools: [],
      requiredMcps: [],
      suggestions: [],
    };
  }

  let frontmatter: Record<string, unknown> = {};
  let body = "";
  try {
    const parsed = matter(content);
    frontmatter = (parsed.data as Record<string, unknown>) || {};
    body = parsed.content || "";
  } catch {
    warnings.push("Failed to parse YAML frontmatter");
  }

  // Check name
  const name = frontmatter.name || agent.name;
  if (!name) {
    issues.push("Missing required 'name' field");
  } else if (!/^[a-z0-9_-]+$/i.test(String(name))) {
    warnings.push("Name should be lowercase with hyphens/underscores only");
  }

  // Check tools
  const tools = parseTools(frontmatter.tools);
  const toolAnalysis = analyzeTools(tools);
  issues.push(...toolAnalysis.issues);
  warnings.push(...toolAnalysis.warnings);
  suggestions.push(...toolAnalysis.suggestions);

  if (toolAnalysis.unmapped.length > 0) {
    suggestions.push(
      `Consider removing or replacing: ${toolAnalysis.unmapped.join(", ")}`
    );
  }

  // Check for Claude-specific content
  const claudeIssues = checkClaudeSpecificContent(body);
  warnings.push(...claudeIssues);

  // Check for legacy runtime patterns that often need normalization
  const legacy = checkLegacyRuntimeContent(body);
  warnings.push(...legacy.warnings);
  suggestions.push(...legacy.suggestions);

  // Check description
  if (!frontmatter.description) {
    warnings.push("Missing 'description' field (recommended)");
  }

  // Calculate score
  let score = 100;
  score -= issues.length * 20;
  score -= warnings.length * 5;
  score = Math.max(0, Math.min(100, score));

  // AskUserQuestion warning doesn't affect compatibility
  const nonAskUserUnmapped = toolAnalysis.unmapped.filter(t => t !== "AskUserQuestion");
  const compatible = nonAskUserUnmapped.length === 0;

  return {
    compatible,
    score,
    issues,
    warnings,
    mappedTools: toolAnalysis.mapped,
    unmappedTools: toolAnalysis.unmapped,
    requiredMcps: toolAnalysis.requiredMcps,
    suggestions,
  };
}

export async function analyzeCommand(
  command: DiscoveredFile
): Promise<AnalysisResult> {
  const issues: string[] = [];
  const warnings: string[] = [];
  const suggestions: string[] = [];

  let content: string;
  try {
    content = await fetchContent(command.src, command.srcType);
  } catch (e) {
    return {
      compatible: false,
      score: 0,
      issues: [`Failed to fetch content: ${(e as Error).message}`],
      warnings: [],
      mappedTools: [],
      unmappedTools: [],
      requiredMcps: [],
      suggestions: [],
    };
  }

  let frontmatter: Record<string, unknown> = {};
  let body = "";
  try {
    const parsed = matter(content);
    frontmatter = (parsed.data as Record<string, unknown>) || {};
    body = parsed.content || "";
  } catch {
    warnings.push("Failed to parse YAML frontmatter");
  }

  // Check allowed-tools
  const tools = parseTools(frontmatter["allowed-tools"]);
  const toolAnalysis = analyzeTools(tools);
  issues.push(...toolAnalysis.issues);
  warnings.push(...toolAnalysis.warnings);
  suggestions.push(...toolAnalysis.suggestions);

  // Check for Claude-specific content
  const claudeIssues = checkClaudeSpecificContent(body);
  warnings.push(...claudeIssues);

  const legacy = checkLegacyRuntimeContent(body);
  warnings.push(...legacy.warnings);
  suggestions.push(...legacy.suggestions);

  // Calculate score
  let score = 100;
  score -= issues.length * 20;
  score -= warnings.length * 5;
  score = Math.max(0, Math.min(100, score));

  // AskUserQuestion warning doesn't affect compatibility
  const nonAskUserUnmapped = toolAnalysis.unmapped.filter(t => t !== "AskUserQuestion");
  const compatible = nonAskUserUnmapped.length === 0;

  return {
    compatible,
    score,
    issues,
    warnings,
    mappedTools: toolAnalysis.mapped,
    unmappedTools: toolAnalysis.unmapped,
    requiredMcps: toolAnalysis.requiredMcps,
    suggestions,
  };
}

export async function analyzeSkill(
  skill: DiscoveredSkill
): Promise<AnalysisResult> {
  const issues: string[] = [];
  const warnings: string[] = [];
  const suggestions: string[] = [];
  let mappedTools: string[] = [];
  let unmappedTools: string[] = [];
  let requiredMcps: string[] = [];

  // Find SKILL.md file
  const skillFile = skill.files.find(
    (f) =>
      f.relativePath.toLowerCase() === "skill.md" ||
      f.relativePath.toLowerCase() === "skill.mdx"
  );

  if (!skillFile) {
    return {
      compatible: false,
      score: 0,
      issues: ["Missing SKILL.md file"],
      warnings: [],
      mappedTools: [],
      unmappedTools: [],
      requiredMcps: [],
      suggestions: [],
    };
  }

  let content: string;
  try {
    content = await fetchContent(skillFile.src, skillFile.srcType);
  } catch (e) {
    return {
      compatible: false,
      score: 0,
      issues: [`Failed to fetch content: ${(e as Error).message}`],
      warnings: [],
      mappedTools: [],
      unmappedTools: [],
      requiredMcps: [],
      suggestions: [],
    };
  }

  let frontmatter: Record<string, unknown> = {};
  let body = "";
  try {
    const parsed = matter(content);
    frontmatter = (parsed.data as Record<string, unknown>) || {};
    body = parsed.content || "";
  } catch {
    warnings.push("Failed to parse YAML frontmatter");
  }

  // Check required fields
  if (!frontmatter.name) {
    issues.push("Missing required 'name' field");
  }
  if (!frontmatter.description) {
    warnings.push("Missing 'description' field (recommended)");
  }

  // Check allowed-tools if present
  const tools = parseTools(frontmatter["allowed-tools"]);
  if (tools.length > 0) {
    const toolAnalysis = analyzeTools(tools);
    issues.push(...toolAnalysis.issues);
    warnings.push(...toolAnalysis.warnings);
    suggestions.push(...toolAnalysis.suggestions);
    mappedTools = toolAnalysis.mapped;
    unmappedTools = toolAnalysis.unmapped;
    requiredMcps = toolAnalysis.requiredMcps;
  }

  // Check for Claude-specific content
  const claudeIssues = checkClaudeSpecificContent(body);
  warnings.push(...claudeIssues);

  const legacy = checkLegacyRuntimeContent(body);
  warnings.push(...legacy.warnings);
  suggestions.push(...legacy.suggestions);

  // Calculate score
  let score = 100;
  score -= issues.length * 20;
  score -= warnings.length * 5;
  score = Math.max(0, Math.min(100, score));

  // AskUserQuestion warning doesn't affect compatibility
  const nonAskUserUnmapped = unmappedTools.filter(t => t !== "AskUserQuestion");
  const compatible = nonAskUserUnmapped.length === 0;

  return {
    compatible,
    score,
    issues,
    warnings,
    mappedTools,
    unmappedTools,
    requiredMcps,
    suggestions,
  };
}

export async function analyzePlugin(
  plugin: DiscoveredPlugin,
  onProgress?: (message: string) => void
): Promise<PluginAnalysis> {
  const log = onProgress || (() => {});

  const agents: ItemAnalysis[] = [];
  const commands: ItemAnalysis[] = [];
  const skills: SkillAnalysis[] = [];

  // Analyze agents
  for (const agent of plugin.agents) {
    log(`Analyzing agent: ${agent.name}`);
    const result = await analyzeAgent(agent);
    agents.push({ name: agent.name, src: agent.src, result });
  }

  // Analyze commands
  for (const command of plugin.commands) {
    log(`Analyzing command: ${command.name}`);
    const result = await analyzeCommand(command);
    commands.push({ name: command.name, src: command.src, result });
  }

  // Analyze skills
  for (const skill of plugin.skills) {
    log(`Analyzing skill: ${skill.name}`);
    const result = await analyzeSkill(skill);
    skills.push({ name: skill.name, srcDir: skill.srcDir, result });
  }

  const compatibleAgents = agents.filter((a) => a.result.compatible).length;
  const compatibleCommands = commands.filter((c) => c.result.compatible).length;
  const compatibleSkills = skills.filter((s) => s.result.compatible).length;

  const totalItems = agents.length + commands.length + skills.length;
  const compatibleItems = compatibleAgents + compatibleCommands + compatibleSkills;
  const overallScore = totalItems > 0 ? Math.round((compatibleItems / totalItems) * 100) : 100;

  return {
    name: plugin.name,
    description: plugin.description,
    agents,
    commands,
    skills,
    summary: {
      totalAgents: agents.length,
      compatibleAgents,
      totalCommands: commands.length,
      compatibleCommands,
      totalSkills: skills.length,
      compatibleSkills,
      overallScore,
    },
  };
}

export function formatAnalysisReport(analyses: PluginAnalysis[]): string {
  const lines: string[] = [];

  lines.push("╔══════════════════════════════════════════════════════════════╗");
  lines.push("║            Factory AI Compatibility Analysis                 ║");
  lines.push("╚══════════════════════════════════════════════════════════════╝");
  lines.push("");

  for (const plugin of analyses) {
    const { summary } = plugin;
    const statusIcon = summary.overallScore >= 80 ? "✓" : summary.overallScore >= 50 ? "⚠" : "✗";

    lines.push(`┌─ ${plugin.name} ${statusIcon} (${summary.overallScore}% compatible)`);
    lines.push(`│  ${plugin.description || "(no description)"}`);
    lines.push("│");
    lines.push(`│  Agents:   ${summary.compatibleAgents}/${summary.totalAgents} compatible`);
    lines.push(`│  Commands: ${summary.compatibleCommands}/${summary.totalCommands} compatible`);
    lines.push(`│  Skills:   ${summary.compatibleSkills}/${summary.totalSkills} compatible`);

    // Collect required MCPs
    const allRequiredMcps = new Set<string>();
    for (const agent of plugin.agents) {
      for (const mcp of agent.result.requiredMcps) allRequiredMcps.add(mcp);
    }
    for (const cmd of plugin.commands) {
      for (const mcp of cmd.result.requiredMcps) allRequiredMcps.add(mcp);
    }
    for (const skill of plugin.skills) {
      for (const mcp of skill.result.requiredMcps) allRequiredMcps.add(mcp);
    }

    if (allRequiredMcps.size > 0) {
      lines.push("│");
      lines.push(`│  ℹ Requires MCP servers: ${[...allRequiredMcps].join(", ")}`);
    }

    // Show incompatible items
    const incompatibleAgents = plugin.agents.filter((a) => !a.result.compatible);
    const incompatibleCommands = plugin.commands.filter((c) => !c.result.compatible);
    const incompatibleSkills = plugin.skills.filter((s) => !s.result.compatible);

    if (incompatibleAgents.length > 0) {
      lines.push("│");
      lines.push("│  ⚠ Incompatible agents (will be skipped):");
      for (const agent of incompatibleAgents) {
        lines.push(`│    - ${agent.name}: ${agent.result.issues[0] || "incompatible tools"}`);
      }
    }

    if (incompatibleCommands.length > 0) {
      lines.push("│");
      lines.push("│  ⚠ Incompatible commands (will be skipped):");
      for (const cmd of incompatibleCommands) {
        lines.push(`│    - ${cmd.name}: ${cmd.result.issues[0] || "incompatible tools"}`);
      }
    }

    if (incompatibleSkills.length > 0) {
      lines.push("│");
      lines.push("│  ⚠ Incompatible skills (will be skipped):");
      for (const skill of incompatibleSkills) {
        lines.push(`│    - ${skill.name}: ${skill.result.issues[0] || "incompatible"}`);
      }
    }

    lines.push("└─────────────────────────────────────────────────────────────");
    lines.push("");
  }

  // Overall summary
  const totalAgents = analyses.reduce((sum, p) => sum + p.summary.totalAgents, 0);
  const compatAgents = analyses.reduce((sum, p) => sum + p.summary.compatibleAgents, 0);
  const totalCommands = analyses.reduce((sum, p) => sum + p.summary.totalCommands, 0);
  const compatCommands = analyses.reduce((sum, p) => sum + p.summary.compatibleCommands, 0);
  const totalSkills = analyses.reduce((sum, p) => sum + p.summary.totalSkills, 0);
  const compatSkills = analyses.reduce((sum, p) => sum + p.summary.compatibleSkills, 0);

  lines.push("Summary:");
  lines.push(`  Will import: ${compatAgents} agents, ${compatCommands} commands, ${compatSkills} skills`);
  lines.push(`  Will skip:   ${totalAgents - compatAgents} agents, ${totalCommands - compatCommands} commands, ${totalSkills - compatSkills} skills`);

  return lines.join("\n");
}

export function mapToolsForFactory(tools: string[]): string[] {
  const mapped: string[] = [];
  for (const tool of tools) {
    // Check if it's already a valid Factory tool
    if (FACTORY_TOOLS.has(tool)) {
      mapped.push(tool);
      continue;
    }
    
    // Check if it's an MCP tool - Factory supports MCPs
    if (MCP_TOOL_PATTERN.test(tool)) {
      mapped.push(tool); // Keep MCP tools as-is
      continue;
    }
    
    // Check if it's a Bash/Execute restriction pattern like Bash(git *) or Execute(npm *)
    // These map to Factory's Execute tool
    if (BASH_RESTRICTION_PATTERN.test(tool)) {
      mapped.push("Execute");
      continue;
    }
    
    // Check if we can map it via TOOL_MAPPING
    if (TOOL_MAPPING[tool]) {
      mapped.push(TOOL_MAPPING[tool]!);
    }
    // Skip unmapped tools (null mappings or unknown tools)
  }
  return [...new Set(mapped)];
}
