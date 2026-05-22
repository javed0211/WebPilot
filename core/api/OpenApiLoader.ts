import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import SwaggerParser from '@apidevtools/swagger-parser';
import { ApiRequestStep, HttpMethod } from './types';

const HTTP_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

export interface OpenApiOperationRef {
  method: HttpMethod;
  path: string;
  operationId?: string;
  summary?: string;
  tags?: string[];
}

export interface OpenApiLoadResult {
  title: string;
  version?: string;
  baseUrl?: string;
  operations: OpenApiOperationRef[];
  spec: object;
}

export class OpenApiLoader {
  public static isOpenApiUrl(value: string): boolean {
    const v = value.trim();
    return /^https?:\/\//i.test(v) && /(swagger|openapi|api-docs|\.json|\.ya?ml)/i.test(v);
  }

  public static isOpenApiFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return ['.json', '.yaml', '.yml'].includes(ext);
  }

  public static async load(source: string): Promise<OpenApiLoadResult> {
    const trimmed = source.trim();
    let spec: object;

    if (/^https?:\/\//i.test(trimmed)) {
      const res = await axios.get(trimmed, { timeout: 30000, validateStatus: () => true });
      if (res.status >= 400) {
        throw new Error(`Failed to fetch OpenAPI spec (${res.status}): ${trimmed}`);
      }
      spec = res.data;
    } else {
      const filePath = path.isAbsolute(trimmed) ? trimmed : path.join(process.cwd(), trimmed);
      if (!fs.existsSync(filePath)) {
        throw new Error(`OpenAPI file not found: ${filePath}`);
      }
      const raw = fs.readFileSync(filePath, 'utf8');
      spec = raw.trim().startsWith('{') ? JSON.parse(raw) : (await SwaggerParser.parse(filePath)) as object;
    }

    const dereferenced = (await SwaggerParser.validate(spec as any)) as any;
    const operations = OpenApiLoader.listOperations(dereferenced);
    const baseUrl = OpenApiLoader.resolveBaseUrl(dereferenced);

    return {
      title: dereferenced.info?.title ?? 'API',
      version: dereferenced.info?.version,
      baseUrl,
      operations,
      spec: dereferenced
    };
  }

  private static resolveBaseUrl(spec: any): string | undefined {
    if (spec.servers?.length) {
      const url = spec.servers[0].url as string;
      return url.replace(/\/$/, '');
    }
    if (spec.host) {
      const scheme = spec.schemes?.[0] ?? 'https';
      const base = spec.basePath ?? '';
      return `${scheme}://${spec.host}${base}`.replace(/\/$/, '');
    }
    return undefined;
  }

  public static listOperations(spec: any): OpenApiOperationRef[] {
    const ops: OpenApiOperationRef[] = [];
    const paths = spec.paths ?? {};
    for (const pathKey of Object.keys(paths)) {
      const pathItem = paths[pathKey];
      for (const method of HTTP_METHODS) {
        const lower = method.toLowerCase();
        const op = pathItem?.[lower];
        if (!op) continue;
        ops.push({
          method,
          path: pathKey,
          operationId: op.operationId,
          summary: op.summary ?? op.description,
          tags: op.tags
        });
      }
    }
    return ops;
  }

  /** Build smoke steps for selected operations (or all GETs if none specified). */
  public static buildSteps(
    loadResult: OpenApiLoadResult,
    options?: { operations?: string[]; baseUrlVariable?: string }
  ): ApiRequestStep[] {
    const baseVar = options?.baseUrlVariable ?? 'apiBaseUrl';
    const basePrefix = loadResult.baseUrl ? `{{${baseVar}}}` : `{{${baseVar}}}`;
    const selected = options?.operations?.length
      ? OpenApiLoader.filterOperations(loadResult.operations, options.operations)
      : loadResult.operations.filter((o) => o.method === 'GET').slice(0, 5);

    if (selected.length === 0 && loadResult.operations.length > 0) {
      selected.push(...loadResult.operations.slice(0, 3));
    }

    return selected.map((op, i) => ({
      name: op.summary ?? op.operationId ?? `${op.method} ${op.path}`,
      method: op.method === 'HEAD' || op.method === 'OPTIONS' ? 'GET' : op.method,
      url: `${basePrefix}${op.path.replace(/{(\w+)}/g, '{{$1}}')}`,
      assertions: { status: op.method === 'POST' || op.method === 'PUT' ? 201 : 200 }
    }));
  }

  private static filterOperations(
    all: OpenApiOperationRef[],
    selectors: string[]
  ): OpenApiOperationRef[] {
    const out: OpenApiOperationRef[] = [];
    for (const sel of selectors) {
      const normalized = sel.trim();
      const match = all.find(
        (o) =>
          `${o.method} ${o.path}`.toLowerCase() === normalized.toLowerCase() ||
          o.operationId === normalized ||
          o.path === normalized
      );
      if (match) out.push(match);
    }
    return out;
  }

  /** Natural-language scenario file content from an OpenAPI document. */
  public static toScenarioText(loadResult: OpenApiLoadResult, sourceRef: string): string {
    const lines = [
      '@api @openapi',
      `Test: ${loadResult.title} — OpenAPI smoke`,
      '',
      `@source ${sourceRef}`,
      `@baseUrl ${loadResult.baseUrl ?? '{{apiBaseUrl}}'}`,
      ''
    ];
    const sample = loadResult.operations.slice(0, 8);
    for (const op of sample) {
      lines.push(`Send ${op.method} request to {{apiBaseUrl}}${op.path}`);
      lines.push(`Assert status is ${op.method === 'POST' || op.method === 'PUT' ? '201' : '200'}`);
      lines.push('');
    }
    return lines.join('\n').trim() + '\n';
  }
}
