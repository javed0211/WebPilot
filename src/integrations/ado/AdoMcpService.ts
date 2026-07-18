import { McpStdioClient, McpToolCallResult, McpToolDescriptor } from '../../core/requirements/McpStdioClient';
import { buildAdoMcpLaunchSpec } from './AdoMcpLauncher';
import { loadAdoConfig } from './AdoConfig';
import { AdoConfig, AdoMcpLaunchSpec } from './types';

function getPath(payload: unknown, dotPath?: string): unknown {
  if (!dotPath) return payload;
  let current = payload;
  for (const part of dotPath.split('.').filter(Boolean)) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function parseMcpToolPayload(result: McpToolCallResult, resultPath?: string): unknown {
  if ((result as { isError?: boolean }).isError) {
    const text = (result.content ?? [])
      .map((c) => (typeof c.text === 'string' ? c.text : ''))
      .filter(Boolean)
      .join('\n');
    throw new Error(text || 'ADO MCP tool returned an error.');
  }

  const structured = result.structuredContent ?? (result as Record<string, unknown>).result;
  if (structured !== undefined) {
    return getPath(structured, resultPath) ?? structured;
  }

  for (const item of result.content ?? []) {
    if (item.type === 'text' && typeof item.text === 'string') {
      const text = item.text.trim();
      if (!text) continue;
      if (/^error\b/i.test(text)) throw new Error(text);
      try {
        const parsed = JSON.parse(text);
        return getPath(parsed, resultPath) ?? parsed;
      } catch {
        return text;
      }
    }
  }
  return undefined;
}

function schemaHasArgument(tool: McpToolDescriptor, arg: string): boolean {
  const props = (tool.inputSchema as { properties?: Record<string, unknown> } | undefined)?.properties;
  return Boolean(props && arg in props);
}

/**
 * Thin wrapper around McpStdioClient for the bundled Azure DevOps MCP server.
 */
export class AdoMcpService {
  private client?: McpStdioClient;
  private tools: McpToolDescriptor[] = [];
  public readonly launch: AdoMcpLaunchSpec;

  public constructor(config: AdoConfig = loadAdoConfig()) {
    this.launch = buildAdoMcpLaunchSpec(config);
  }

  public async connect(): Promise<void> {
    this.client = new McpStdioClient({
      command: this.launch.command,
      args: this.launch.args,
      env: this.launch.env,
      timeoutMs: this.launch.timeoutMs,
    });
    await this.client.connect();
    this.tools = await this.client.listTools();
  }

  public listTools(): McpToolDescriptor[] {
    return this.tools;
  }

  public async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.client) throw new Error('ADO MCP client is not connected. Call connect() first.');
    const result = await this.client.callTool(name, args);
    return parseMcpToolPayload(result);
  }

  /**
   * Picks the first available tool from candidates, optionally requiring an argument.
   */
  public resolveTool(candidates: string[], requiredArg?: string): string {
    const lower = candidates.map((c) => c.toLowerCase());
    const byName = this.tools.find((t) => lower.includes(t.name.toLowerCase()));
    if (byName && (!requiredArg || schemaHasArgument(byName, requiredArg))) {
      return byName.name;
    }
    if (requiredArg) {
      const bySchema = this.tools.find(
        (t) =>
          lower.some((c) => t.name.toLowerCase().includes(c.replace(/^testplan_/, ''))) &&
          schemaHasArgument(t, requiredArg)
      );
      if (bySchema) return bySchema.name;
    }
    throw new Error(
      `ADO MCP tool not found. Tried: ${candidates.join(', ')}. Available: ${this.tools
        .map((t) => t.name)
        .join(', ') || '(none)'}`
    );
  }

  public close(): void {
    this.client?.close();
    this.client = undefined;
  }

  public async withClient<T>(fn: (svc: AdoMcpService) => Promise<T>): Promise<T> {
    await this.connect();
    try {
      return await fn(this);
    } finally {
      this.close();
    }
  }
}
