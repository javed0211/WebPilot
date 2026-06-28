import { spawn, ChildProcessWithoutNullStreams } from 'child_process';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface McpToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpToolCallResult {
  content?: Array<{ type?: string; text?: string; [key: string]: unknown }>;
  structuredContent?: unknown;
  [key: string]: unknown;
}

export interface McpClientOptions {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  timeoutMs?: number;
}

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

function parseHeaderBlock(header: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of header.split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
  }
  return headers;
}

/**
 * Minimal JSON-RPC-over-stdio MCP client. This avoids a hard dependency on a
 * specific MCP SDK version while still supporting official ADO/Jira stdio
 * servers configured by command/args in `webpilot.yaml`.
 */
export class McpStdioClient {
  private process?: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private buffer = Buffer.alloc(0);
  private pending = new Map<number, PendingRequest>();
  private stderr = '';

  public constructor(private readonly options: McpClientOptions) {}

  public async connect(): Promise<void> {
    this.process = spawn(this.options.command, this.options.args ?? [], {
      env: { ...process.env, ...(this.options.env ?? {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.process.stdout.on('data', (chunk: Buffer) => this.onStdout(chunk));
    this.process.stderr.on('data', (chunk: Buffer) => {
      this.stderr += chunk.toString('utf8');
    });
    this.process.on('error', (err) => this.rejectAll(err));
    this.process.on('exit', (code) => {
      if (this.pending.size > 0) {
        this.rejectAll(new Error(`MCP server exited with code ${code}. ${this.stderr.trim()}`));
      }
    });

    await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'WebPilot', version: '1.0.0' },
    });
    this.notify('notifications/initialized', {});
  }

  public async listTools(): Promise<McpToolDescriptor[]> {
    const result = await this.request('tools/list', {});
    const tools = (result as { tools?: McpToolDescriptor[] })?.tools;
    return Array.isArray(tools) ? tools : [];
  }

  public async callTool(name: string, args: Record<string, unknown>): Promise<McpToolCallResult> {
    return (await this.request('tools/call', { name, arguments: args })) as McpToolCallResult;
  }

  public close(): void {
    if (this.process && !this.process.killed) {
      this.process.kill();
    }
    this.rejectAll(new Error('MCP client closed.'));
  }

  private request(method: string, params: unknown): Promise<unknown> {
    if (!this.process) throw new Error('MCP client is not connected.');
    const id = this.nextId++;
    const timeoutMs = this.options.timeoutMs ?? 60_000;
    const payload: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };

    const promise = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });

    this.write(payload);
    return promise;
  }

  private notify(method: string, params: unknown): void {
    this.write({ jsonrpc: '2.0', method, params });
  }

  private write(payload: JsonRpcRequest): void {
    if (!this.process) throw new Error('MCP client is not connected.');
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    this.process.stdin.write(`Content-Length: ${body.byteLength}\r\n\r\n`);
    this.process.stdin.write(body);
  }

  private onStdout(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) return;
      const headers = parseHeaderBlock(this.buffer.slice(0, headerEnd).toString('utf8'));
      const length = Number(headers['content-length']);
      if (!Number.isFinite(length) || length < 0) {
        this.rejectAll(new Error('Invalid MCP message header: missing Content-Length.'));
        return;
      }
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + length;
      if (this.buffer.length < bodyEnd) return;

      const body = this.buffer.slice(bodyStart, bodyEnd).toString('utf8');
      this.buffer = this.buffer.slice(bodyEnd);
      this.handleMessage(body);
    }
  }

  private handleMessage(body: string): void {
    let message: JsonRpcRequest;
    try {
      message = JSON.parse(body) as JsonRpcRequest;
    } catch {
      return;
    }

    if (typeof message.id !== 'number') return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);

    if (message.error) {
      pending.reject(new Error(`${message.error.message}${message.error.data ? ` ${JSON.stringify(message.error.data)}` : ''}`));
      return;
    }
    pending.resolve(message.result);
  }

  private rejectAll(error: Error): void {
    for (const [id, pending] of this.pending.entries()) {
      this.pending.delete(id);
      clearTimeout(pending.timer);
      pending.reject(error);
    }
  }
}
