/**
 * Dataverse MCP integration (official `@microsoft/dataverse` stdio server).
 * Config lives under `dataverse:` in webpilot.yaml — no Cursor mcp.json required.
 */

export interface DataverseConfig {
  enabled?: boolean;
  /**
   * Organization / environment URL, e.g. https://contoso.crm.dynamics.com
   * Override with DATAVERSE_URL / DATAVERSE_ENVIRONMENT_URL.
   */
  environmentUrl?: string;
  /** Use `/api/mcp_preview` instead of `/api/mcp`. */
  preview?: boolean;
  timeoutMs?: number;
  /**
   * Optional spawn override. When unset, WebPilot launches the pinned
   * `@microsoft/dataverse` package from the install root.
   */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface DataverseMcpLaunchSpec {
  command: string;
  args: string[];
  env: Record<string, string>;
  timeoutMs: number;
  environmentUrl: string;
  preview: boolean;
}

export interface DataverseStatusResult {
  environmentUrl: string;
  preview: boolean;
  toolCount: number;
  tools: string[];
}
