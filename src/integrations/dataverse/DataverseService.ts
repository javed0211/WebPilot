import { spawn } from 'child_process';
import { assertDataverseEnabled, loadDataverseConfig, mcpEndpoint } from './DataverseConfig';
import { buildDataverseMcpLaunchSpec, buildDataverseValidateArgs } from './DataverseMcpLauncher';
import { DataverseMcpService } from './DataverseMcpService';
import { DataverseConfig, DataverseStatusResult } from './types';

function parseKvArgs(pairs: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const pair of pairs) {
    const eq = pair.indexOf('=');
    if (eq <= 0) {
      throw new Error(`Invalid --arg "${pair}". Use key=value (JSON values allowed).`);
    }
    const key = pair.slice(0, eq).trim();
    const raw = pair.slice(eq + 1);
    try {
      out[key] = JSON.parse(raw);
    } catch {
      out[key] = raw;
    }
  }
  return out;
}

/**
 * Domain helpers over the official Dataverse MCP tool surface.
 */
export class DataverseService {
  public constructor(private readonly config: DataverseConfig = loadDataverseConfig()) {}

  public async status(): Promise<DataverseStatusResult> {
    const cfg = assertDataverseEnabled(this.config);
    const svc = new DataverseMcpService(cfg);
    return svc.withClient(async (mcp) => {
      const tools = mcp.listTools().map((t) => t.name);
      return {
        environmentUrl: cfg.environmentUrl!,
        preview: Boolean(cfg.preview),
        toolCount: tools.length,
        tools,
      };
    });
  }

  public async listTools(): Promise<Array<{ name: string; description?: string }>> {
    const cfg = assertDataverseEnabled(this.config);
    const svc = new DataverseMcpService(cfg);
    return svc.withClient(async (mcp) =>
      mcp.listTools().map((t) => ({ name: t.name, description: t.description }))
    );
  }

  public async call(toolName: string, args: Record<string, unknown> | string[]): Promise<unknown> {
    const cfg = assertDataverseEnabled(this.config);
    const payload = Array.isArray(args) ? parseKvArgs(args) : args;
    const svc = new DataverseMcpService(cfg);
    return svc.withClient(async (mcp) => {
      const resolved = mcp.resolveTool([toolName]);
      return mcp.callTool(resolved, payload);
    });
  }

  /** Convenience: schema / entity describe via MCP `describe` (or closest). */
  public async describe(tableOrQuery: string): Promise<unknown> {
    const cfg = assertDataverseEnabled(this.config);
    const svc = new DataverseMcpService(cfg);
    return svc.withClient(async (mcp) => {
      const name = mcp.resolveTool(['describe', 'describe_table', 'search']);
      const tool = mcp.listTools().find((t) => t.name === name);
      const props = (tool?.inputSchema as { properties?: Record<string, unknown> } | undefined)
        ?.properties;
      const args: Record<string, unknown> = {};
      if (props?.table) args.table = tableOrQuery;
      else if (props?.entity) args.entity = tableOrQuery;
      else if (props?.name) args.name = tableOrQuery;
      else if (props?.query) args.query = tableOrQuery;
      else if (props?.search) args.search = tableOrQuery;
      else args.query = tableOrQuery;
      return mcp.callTool(name, args);
    });
  }

  /** Convenience: `search` / `search_data`. */
  public async search(query: string): Promise<unknown> {
    const cfg = assertDataverseEnabled(this.config);
    const svc = new DataverseMcpService(cfg);
    return svc.withClient(async (mcp) => {
      const name = mcp.resolveTool(['search_data', 'search']);
      const tool = mcp.listTools().find((t) => t.name === name);
      const props = (tool?.inputSchema as { properties?: Record<string, unknown> } | undefined)
        ?.properties;
      const args: Record<string, unknown> = {};
      if (props?.query) args.query = query;
      else if (props?.search) args.search = query;
      else if (props?.q) args.q = query;
      else args.query = query;
      return mcp.callTool(name, args);
    });
  }

  /** Convenience: `read_query` SQL SELECT. */
  public async query(sql: string): Promise<unknown> {
    const cfg = assertDataverseEnabled(this.config);
    const svc = new DataverseMcpService(cfg);
    return svc.withClient(async (mcp) => {
      const name = mcp.resolveTool(['read_query', 'query', 'execute_query']);
      const tool = mcp.listTools().find((t) => t.name === name);
      const props = (tool?.inputSchema as { properties?: Record<string, unknown> } | undefined)
        ?.properties;
      const args: Record<string, unknown> = {};
      if (props?.query) args.query = sql;
      else if (props?.sql) args.sql = sql;
      else if (props?.statement) args.statement = sql;
      else args.query = sql;
      return mcp.callTool(name, args);
    });
  }

  /**
   * Runs `dataverse mcp <url> --validate` (auth + endpoint prerequisites).
   * Returns combined stdout/stderr and exit code.
   */
  public async validate(): Promise<{ code: number; output: string; endpoint: string }> {
    const cfg = assertDataverseEnabled(this.config);
    const spec = buildDataverseValidateArgs(cfg);
    const endpoint = mcpEndpoint(cfg.environmentUrl!, cfg.preview);
    return new Promise((resolve, reject) => {
      const child = spawn(spec.command, spec.args, {
        env: { ...process.env, ...spec.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      child.stdout?.on('data', (buf) => {
        output += buf.toString();
      });
      child.stderr?.on('data', (buf) => {
        output += buf.toString();
      });
      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`Dataverse MCP validate timed out after ${spec.timeoutMs}ms`));
      }, spec.timeoutMs);
      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ code: code ?? 1, output: output.trim(), endpoint });
      });
    });
  }

  public launchPreview(): ReturnType<typeof buildDataverseMcpLaunchSpec> {
    return buildDataverseMcpLaunchSpec(assertDataverseEnabled(this.config));
  }
}
