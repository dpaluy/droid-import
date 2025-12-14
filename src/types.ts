export interface MarketplaceJson {
  name: string;
  owner?: {
    name: string;
    url?: string;
  };
  metadata?: {
    description?: string;
    version?: string;
    pluginRoot?: string;
  };
  pluginRoot?: string;
  plugins: PluginDefinition[];
}

export interface PluginDefinition {
  name: string;
  description?: string;
  version?: string;
  author?: {
    name?: string;
    url?: string;
    email?: string;
  };
  homepage?: string;
  tags?: string[];
  source: string | PluginSource;
  commands?: string | string[];
  agents?: string | string[];
  skills?: string | string[];
  hooks?: string | string[];
  mcpServers?: string | string[];
}

export interface PluginSource {
  type?: string;
  source?: string;
  repo?: string;
  repository?: string;
  url?: string;
  href?: string;
  ref?: string;
  path?: string;
}

export interface MarketplaceContext {
  kind: "local" | "github" | "gitlab" | "url";
  baseDir?: string;
  gh?: GitHubContext;
  gl?: GitLabContext;
  baseUrl?: string;
}

export interface GitHubContext {
  owner: string;
  repo: string;
  ref: string;
  basePath: string;
}

export interface GitLabContext {
  namespacePath: string;
  repo: string;
  ref: string;
  basePath: string;
}

export interface LoadedMarketplace {
  json: MarketplaceJson;
  context: MarketplaceContext;
}

export interface DiscoveredPlugin {
  name: string;
  description: string;
  agents: DiscoveredFile[];
  commands: DiscoveredFile[];
  skills: DiscoveredSkill[];
  errors: string[];
}

export interface DiscoveredFile {
  name: string;
  srcType: "local" | "remote";
  src: string;
}

export interface DiscoveredSkill {
  name: string;
  srcType: "local" | "remote";
  srcDir: string;
  files: SkillFile[];
}

export interface SkillFile {
  relativePath: string;
  src: string;
  srcType: "local" | "remote";
}

export interface InstallPlan {
  droids: InstallItem[];
  commands: InstallItem[];
  skills: InstallSkillItem[];
}

export interface InstallItem {
  name: string;
  src: string;
  srcType: "local" | "remote";
  dest: string;
  exists: boolean;
}

export interface InstallSkillItem {
  name: string;
  srcDir: string;
  srcType: "local" | "remote";
  destDir: string;
  files: {
    src: string;
    dest: string;
    srcType: "local" | "remote";
  }[];
  exists: boolean;
}

export interface CLIArgs {
  marketplace?: string;
  plugins?: string[];
  scope: "personal" | "project";
  path?: string;
  force: boolean;
  dryRun: boolean;
  verbose: boolean;
  help: boolean;
  components: {
    agents: boolean;
    commands: boolean;
    skills: boolean;
  };
}

export interface InstallResult {
  created: number;
  overwritten: number;
  skipped: number;
  errors: string[];
}

export type GitHubTreeEntry = {
  path: string;
  type: "blob" | "tree";
  sha: string;
  size?: number;
  url: string;
};
