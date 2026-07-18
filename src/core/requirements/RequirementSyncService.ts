import { ConfigManager } from '../ConfigManager';
import { McpStdioClient, McpToolCallResult, McpToolDescriptor } from './McpStdioClient';
import {
  McpServerCommandConfig,
  RequirementScope,
  RequirementsSyncOptions,
  RequirementSource,
} from './types';
import { RequirementStore } from './RequirementStore';
import { RequirementNormalizer } from './RequirementNormalizer';

export interface RequirementSyncResult {
  source: Exclude<RequirementSource, 'import'>;
  query: string;
  toolName?: string;
  added: number;
  updated: number;
  total: number;
  imported: number;
  dryRun: boolean;
}

const DEFAULT_TIMEOUT = 90_000;

const ADO_TOOL_CANDIDATES = [
  'query_work_items',
  'work_items_query',
  'wit_query',
  'ado_query_work_items',
  'search_work_items',
  'list_work_items',
];

const JIRA_TOOL_CANDIDATES = [
  'search_issues',
  'jira_search',
  'jql_search',
  'search_jira_issues',
  'list_issues',
  'search',
];

function escapeQuery(value: string): string {
  return value.replace(/'/g, "''").replace(/"/g, '\\"');
}

function defined(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function expand(value: string): string {
  return value.replace(/\$\{([A-Z0-9_]+)\}/gi, (_, name) => process.env[name] ?? '');
}

function expandEnv(env?: Record<string, string>): Record<string, string> | undefined {
  if (!env) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) out[key] = expand(value);
  return out;
}

function templateValue(value: unknown, vars: Record<string, string>): unknown {
  if (typeof value === 'string') {
    return value.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, key) => vars[key] ?? '');
  }
  if (Array.isArray(value)) return value.map((item) => templateValue(item, vars));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = templateValue(v, vars);
    return out;
  }
  return value;
}

function getPath(payload: unknown, dotPath?: string): unknown {
  if (!dotPath) return payload;
  let current = payload;
  for (const part of dotPath.split('.').filter(Boolean)) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function resultPayload(result: McpToolCallResult, resultPath?: string): unknown {
  const structured = result.structuredContent ?? (result as Record<string, unknown>).result;
  if (structured !== undefined) {
    return getPath(structured, resultPath) ?? structured;
  }

  for (const item of result.content ?? []) {
    if (item.type === 'text' && typeof item.text === 'string') {
      try {
        const parsed = JSON.parse(item.text);
        return getPath(parsed, resultPath) ?? parsed;
      } catch {
        // Keep looking; text content can include human-readable status lines.
      }
    }
  }

  return getPath(result, resultPath) ?? result;
}

function readConfig(source: Exclude<RequirementSource, 'import'>): {
  server: McpServerCommandConfig;
  timeoutMs: number;
} {
  const config = ConfigManager.getInstance().getAll() as {
    ado?: { enabled?: boolean; organization?: string; project?: string };
    requirements?: {
      mcp?: {
        timeoutMs?: number;
        ado?: McpServerCommandConfig;
        jira?: McpServerCommandConfig;
      };
    };
  };
  const mcp = config.requirements?.mcp ?? {};
  const server = { ...(source === 'ado' ? mcp.ado : mcp.jira) } as McpServerCommandConfig;

  // Prefer an explicit requirements.mcp command; otherwise reuse the bundled ADO MCP launcher.
  if (source === 'ado' && (!server.command || !server.command.trim())) {
    try {
      const { buildAdoMcpLaunchSpec } = require('../../integrations/ado/AdoMcpLauncher');
      const { loadAdoConfig } = require('../../integrations/ado/AdoConfig');
      const adoCfg = loadAdoConfig();
      if (adoCfg.enabled && adoCfg.organization) {
        const launch = buildAdoMcpLaunchSpec(adoCfg);
        server.enabled = true;
        server.command = launch.command;
        server.args = launch.args;
        server.env = { ...(server.env || {}), ...launch.env };
        return { server, timeoutMs: mcp.timeoutMs ?? launch.timeoutMs ?? DEFAULT_TIMEOUT };
      }
    } catch {
      // Fall through to the explicit-config error below.
    }
  }

  if (!server?.enabled || !server.command) {
    throw new Error(
      `${source.toUpperCase()} MCP sync is not configured. Set ado.enabled=true (bundled MCP) or requirements.mcp.${source}.enabled=true with command/args in resources/config/webpilot.yaml.`
    );
  }
  return { server, timeoutMs: mcp.timeoutMs ?? DEFAULT_TIMEOUT };
}

function buildAdoWiql(scope: RequirementScope): string {
  const clauses = [
    "[System.WorkItemType] IN ('Epic', 'Feature', 'User Story', 'Requirement', 'Product Backlog Item', 'Bug')",
  ];
  if (defined(scope.project)) clauses.push(`[System.TeamProject] = '${escapeQuery(scope.project)}'`);
  if (defined(scope.team)) clauses.push(`[System.AreaPath] UNDER '${escapeQuery(scope.team)}'`);
  if (defined(scope.sprint)) clauses.push(`[System.IterationPath] UNDER '${escapeQuery(scope.sprint)}'`);
  if (defined(scope.epic)) clauses.push(`[System.Parent] = '${escapeQuery(scope.epic)}'`);
  clauses.push("[System.State] <> 'Removed'");

  return [
    'SELECT [System.Id], [System.WorkItemType], [System.Title], [System.State],',
    '[System.AreaPath], [System.IterationPath], [System.Tags],',
    '[Microsoft.VSTS.Common.Priority], [Microsoft.VSTS.Common.AcceptanceCriteria],',
    '[System.Description], [System.ChangedDate]',
    'FROM WorkItems',
    `WHERE ${clauses.join(' AND ')}`,
    'ORDER BY [System.ChangedDate] DESC',
  ].join(' ');
}

function buildJiraJql(scope: RequirementScope): string {
  const clauses = ["issuetype in (Epic, Story, Task, Bug)"];
  if (defined(scope.project)) clauses.push(`project = "${escapeQuery(scope.project)}"`);
  if (defined(scope.sprint)) clauses.push(`sprint = "${escapeQuery(scope.sprint)}"`);
  if (defined(scope.release)) clauses.push(`fixVersion = "${escapeQuery(scope.release)}"`);
  if (defined(scope.epic)) clauses.push(`"Epic Link" = "${escapeQuery(scope.epic)}"`);
  if (!scope.backlog) clauses.push('statusCategory != Done');
  return `${clauses.join(' AND ')} ORDER BY updated DESC`;
}

function buildQuery(source: Exclude<RequirementSource, 'import'>, scope: RequirementScope): string {
  return source === 'ado' ? buildAdoWiql(scope) : buildJiraJql(scope);
}

function schemaHasArgument(tool: McpToolDescriptor, arg: string): boolean {
  const props = (tool.inputSchema?.properties ?? {}) as Record<string, unknown>;
  return Object.prototype.hasOwnProperty.call(props, arg);
}

function chooseTool(
  source: Exclude<RequirementSource, 'import'>,
  tools: McpToolDescriptor[],
  server: McpServerCommandConfig
): { toolName: string; queryArgument: string } {
  const configuredArg = server.queryArgument ?? (source === 'ado' ? 'wiql' : 'jql');
  if (server.toolName) return { toolName: server.toolName, queryArgument: configuredArg };

  const candidates = source === 'ado' ? ADO_TOOL_CANDIDATES : JIRA_TOOL_CANDIDATES;
  const lowerCandidates = candidates.map((name) => name.toLowerCase());
  const named = tools.find((tool) => lowerCandidates.includes(tool.name.toLowerCase()));
  if (named) {
    const props = (named.inputSchema?.properties ?? {}) as Record<string, unknown>;
    const queryArg = [configuredArg, 'query', 'wiql', 'jql', 'search'].find((arg) =>
      Object.prototype.hasOwnProperty.call(props, arg)
    );
    return { toolName: named.name, queryArgument: queryArg ?? configuredArg };
  }

  const bySchema = tools.find((tool) =>
    ['wiql', 'jql', 'query', 'search'].some((arg) => schemaHasArgument(tool, arg))
  );
  if (bySchema) {
    const queryArg =
      ['wiql', 'jql', 'query', 'search'].find((arg) => schemaHasArgument(bySchema, arg)) ??
      configuredArg;
    return { toolName: bySchema.name, queryArgument: queryArg };
  }

  throw new Error(
    `Unable to find a ${source.toUpperCase()} query tool. Set requirements.mcp.${source}.toolName in webpilot.yaml.`
  );
}

function buildArguments(
  server: McpServerCommandConfig,
  queryArgument: string,
  query: string,
  scope: RequirementScope
): Record<string, unknown> {
  const vars: Record<string, string> = {
    query,
    project: scope.project ?? '',
    team: scope.team ?? '',
    sprint: scope.sprint ?? '',
    release: scope.release ?? '',
    epic: scope.epic ?? '',
    source: scope.source ?? '',
  };
  if (server.payloadTemplate) {
    return templateValue(server.payloadTemplate, vars) as Record<string, unknown>;
  }
  return { [queryArgument]: query };
}

export class RequirementSyncService {
  public static buildQuery(source: Exclude<RequirementSource, 'import'>, scope: RequirementScope): string {
    return buildQuery(source, scope);
  }

  public static async sync(options: RequirementsSyncOptions): Promise<RequirementSyncResult> {
    const query = buildQuery(options.source, options.scope);

    if (options.dryRun) {
      return {
        source: options.source,
        query,
        toolName: undefined,
        added: 0,
        updated: 0,
        total: 0,
        imported: 0,
        dryRun: true,
      };
    }

    const { server, timeoutMs } = readConfig(options.source);
    const client = new McpStdioClient({
      command: server.command!,
      args: server.args,
      env: expandEnv(server.env),
      timeoutMs,
    });

    try {
      await client.connect();
      const tools = await client.listTools();
      const { toolName, queryArgument } = chooseTool(options.source, tools, server);
      const args = buildArguments(server, queryArgument, query, {
        ...options.scope,
        source: options.source,
      });
      const result = await client.callTool(toolName, args);
      const payload = resultPayload(result, server.resultPath);
      const normalized = RequirementNormalizer.normalizeMany(payload, options.source);
      if (normalized.length === 0) {
        throw new Error(
          `MCP tool ${toolName} returned no normalizable ${options.source.toUpperCase()} requirements. Configure resultPath if the items are nested.`
        );
      }
      const imported = RequirementStore.importPayload(
        { requirements: normalized },
        {
          source: options.source,
          scope: { ...options.scope, source: options.source },
          merge: options.merge,
        }
      );
      return {
        source: options.source,
        query,
        toolName,
        added: imported.added,
        updated: imported.updated,
        total: imported.set.requirements.length,
        imported: normalized.length,
        dryRun: false,
      };
    } finally {
      client.close();
    }
  }
}
