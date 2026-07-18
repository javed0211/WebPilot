/**
 * Azure DevOps Test Plans integration (Feature 09 extension).
 * Config lives under `ado:` in webpilot.yaml; durable script↔case links in ado-test-map.yaml.
 */

export type AdoAuthMode = 'pat' | 'azcli';

export interface AdoTestPlansConfig {
  defaultPlanName?: string;
  autoPublishResults?: boolean;
}

export interface AdoConfig {
  enabled?: boolean;
  organization?: string;
  project?: string;
  auth?: AdoAuthMode;
  /** Optional Entra tenant for azcli auth. */
  tenant?: string;
  domains?: string[];
  timeoutMs?: number;
  testPlans?: AdoTestPlansConfig;
  /**
   * Optional override of the bundled MCP spawn. When unset, WebPilot launches
   * the pinned `@azure-devops/mcp` from the install root.
   */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface AdoTestMapEntry {
  testCaseId: number;
  testPlanId?: number;
  testSuiteId?: number;
  automatedTestName?: string;
  title?: string;
}

export interface AdoTestMapFile {
  version: 1;
  /** Repo-relative test path → ADO Test Case mapping. */
  tests: Record<string, AdoTestMapEntry>;
}

export interface AdoMcpLaunchSpec {
  command: string;
  args: string[];
  env: Record<string, string>;
  timeoutMs: number;
  organization: string;
  project: string;
  auth: AdoAuthMode;
}

export interface AdoPublishResult {
  runId?: number;
  published: number;
  skipped: number;
  outcomes: Array<{ path: string; testCaseId: number; outcome: string }>;
  dryRun: boolean;
}
