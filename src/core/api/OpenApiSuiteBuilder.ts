import * as fs from 'fs';
import * as path from 'path';
import { OpenApiLoadResult, OpenApiLoader, OpenApiOperationRef } from './OpenApiLoader';
import { ApiAuthPlan, ApiRequestStep, HttpMethod } from './types';

export type OpenApiImportMode = 'full' | 'smoke';
export type OpenApiSplitBy = 'none' | 'tag';

export interface OpenApiSuiteBuildOptions {
  mode?: OpenApiImportMode;
  operations?: string[];
  includeDeprecated?: boolean;
  negatives?: boolean;
  splitBy?: OpenApiSplitBy;
  /** Write large schemas as sidecar JSON under this directory (relative to project). */
  schemaDir?: string;
  schemaSidecars?: boolean;
  baseUrlVariable?: string;
}

export interface OpenApiSuiteFile {
  /** Suggested relative path e.g. tests/api/petstore_openapi.txt */
  relativePath: string;
  content: string;
  tag?: string;
  stepCount: number;
}

export interface OpenApiSuiteBuildResult {
  title: string;
  baseUrl?: string;
  auth: ApiAuthPlan;
  operations: number;
  steps: ApiRequestStep[];
  files: OpenApiSuiteFile[];
  /** Sidecar schema files to write: relativePath → JSON string */
  schemaFiles: Record<string, string>;
  negatives: ApiRequestStep[];
  /** Suggested @var seeds for path/query params */
  variableSeeds: Record<string, unknown>;
}

const SUCCESS_STATUSES = ['200', '201', '202', '204'];

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 64) || 'op'
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Builds complete API suites from an OpenAPI/Swagger document.
 */
export class OpenApiSuiteBuilder {
  public static async buildFromSource(
    source: string,
    options: OpenApiSuiteBuildOptions = {}
  ): Promise<OpenApiSuiteBuildResult> {
    const loaded = await OpenApiLoader.load(source);
    return OpenApiSuiteBuilder.build(loaded, source, options);
  }

  public static build(
    loaded: OpenApiLoadResult,
    sourceRef: string,
    options: OpenApiSuiteBuildOptions = {}
  ): OpenApiSuiteBuildResult {
    const mode: OpenApiImportMode = options.mode ?? 'full';
    const baseVar = options.baseUrlVariable ?? 'apiBaseUrl';
    const auth = OpenApiSuiteBuilder.resolveAuth(loaded.spec as Record<string, unknown>);
    const ops = OpenApiSuiteBuilder.selectOperations(loaded, options, mode);
    const schemaFiles: Record<string, string> = {};
    const schemaDir = options.schemaDir ?? 'tests/api/schemas';
    const useSidecars = options.schemaSidecars !== false;

    const steps: ApiRequestStep[] = [];
    const variableSeeds: Record<string, unknown> = {};
    for (const op of ops) {
      const step = OpenApiSuiteBuilder.buildStep(loaded, op, baseVar, auth, {
        schemaDir,
        useSidecars,
        schemaFiles,
        variableSeeds,
      });
      steps.push(step);
    }

    const negatives = options.negatives
      ? OpenApiSuiteBuilder.buildNegativeSteps(loaded, ops, baseVar, auth)
      : [];

    const files = OpenApiSuiteBuilder.toScenarioFiles(
      loaded,
      sourceRef,
      steps,
      negatives,
      auth,
      options.splitBy ?? 'none',
      variableSeeds
    );

    return {
      title: loaded.title,
      baseUrl: loaded.baseUrl,
      auth,
      operations: ops.length,
      steps,
      files,
      schemaFiles,
      negatives,
      variableSeeds,
    };
  }

  public static resolveAuth(spec: Record<string, unknown>): ApiAuthPlan {
    const components = asRecord(spec.components);
    const schemes = {
      ...asRecord(spec.securityDefinitions),
      ...asRecord(components.securitySchemes),
    };
    const entries = Object.entries(schemes);
    if (entries.length === 0) {
      return { type: 'none', envVar: 'AUTH_TOKEN' };
    }

    for (const [name, raw] of entries) {
      const scheme = asRecord(raw);
      const type = String(scheme.type || '').toLowerCase();
      if (type === 'http' && String(scheme.scheme || '').toLowerCase() === 'bearer') {
        return { type: 'bearer', envVar: 'AUTH_TOKEN', scheme: 'bearer', name };
      }
      if (type === 'oauth2' || type === 'openIdConnect') {
        return { type: 'bearer', envVar: 'AUTH_TOKEN', scheme: 'bearer', name };
      }
      if (type === 'apiKey') {
        return {
          type: 'apiKey',
          envVar: 'API_KEY',
          name: String(scheme.name || 'X-API-Key'),
          in: String(scheme.in || 'header').toLowerCase() === 'query' ? 'query' : 'header',
        };
      }
      if (type === 'basic' || (type === 'http' && String(scheme.scheme || '').toLowerCase() === 'basic')) {
        return { type: 'basic', envVar: 'API_BASIC_AUTH', name };
      }
      if (type === 'http') {
        return { type: 'bearer', envVar: 'AUTH_TOKEN', scheme: String(scheme.scheme || 'bearer'), name };
      }
    }

    return { type: 'bearer', envVar: 'AUTH_TOKEN' };
  }

  private static selectOperations(
    loaded: OpenApiLoadResult,
    options: OpenApiSuiteBuildOptions,
    mode: OpenApiImportMode
  ): OpenApiOperationRef[] {
    let ops = [...loaded.operations];
    const spec = loaded.spec as any;

    if (!options.includeDeprecated) {
      ops = ops.filter((op) => {
        const pathItem = spec.paths?.[op.path];
        const detail = pathItem?.[op.method.toLowerCase()];
        return !detail?.deprecated;
      });
    }

    if (options.operations?.length) {
      return OpenApiLoader.filterOperations(ops, options.operations);
    }

    if (mode === 'smoke') {
      const gets = ops.filter((o) => o.method === 'GET').slice(0, 5);
      return gets.length > 0 ? gets : ops.slice(0, 3);
    }

    return ops;
  }

  private static buildStep(
    loaded: OpenApiLoadResult,
    op: OpenApiOperationRef,
    baseVar: string,
    auth: ApiAuthPlan,
    opts: {
      schemaDir: string;
      useSidecars: boolean;
      schemaFiles: Record<string, string>;
      variableSeeds: Record<string, unknown>;
    }
  ): ApiRequestStep {
    const spec = loaded.spec as any;
    const detail = spec.paths?.[op.path]?.[op.method.toLowerCase()] ?? {};
    const pathWithVars = op.path.replace(/\{(\w+)\}/g, '{{$1}}');
    const query = OpenApiSuiteBuilder.buildQueryString(detail.parameters);
    const url = `{{${baseVar}}}${pathWithVars}${query}`;

    const body = OpenApiSuiteBuilder.buildRequestBody(detail);
    const { status, statusIn, schema } = OpenApiSuiteBuilder.resolveSuccessResponse(detail);
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    OpenApiSuiteBuilder.applyAuthHeaders(headers, auth);
    Object.assign(opts.variableSeeds, OpenApiSuiteBuilder.seedPathParams(detail.parameters));

    const step: ApiRequestStep = {
      name: op.summary ?? op.operationId ?? `${op.method} ${op.path}`,
      method: op.method === 'OPTIONS' ? 'GET' : (op.method as HttpMethod),
      url,
      headers,
      body,
      operationId: op.operationId ?? slugify(`${op.method}_${op.path}`),
      tags: op.tags,
      assertions: {
        ...(status !== undefined ? { status } : {}),
        ...(statusIn ? { statusIn } : {}),
      },
      extractedVariables: OpenApiSuiteBuilder.suggestExtractedVariables(schema),
    };

    if (schema) {
      if (opts.useSidecars) {
        const fileName = `${slugify(step.operationId!)}.json`;
        const rel = path.join(opts.schemaDir, fileName).replace(/\\/g, '/');
        opts.schemaFiles[rel] = JSON.stringify(schema, null, 2);
        step.schemaRef = rel.replace(/^tests\/api\//, '');
      } else {
        step.schema = schema;
      }
    }

    return step;
  }

  private static buildNegativeSteps(
    loaded: OpenApiLoadResult,
    ops: OpenApiOperationRef[],
    baseVar: string,
    auth: ApiAuthPlan
  ): ApiRequestStep[] {
    const negatives: ApiRequestStep[] = [];
    const spec = loaded.spec as any;

    for (const op of ops) {
      if (!['POST', 'PUT', 'PATCH'].includes(op.method)) continue;
      const detail = spec.paths?.[op.path]?.[op.method.toLowerCase()] ?? {};
      const body = OpenApiSuiteBuilder.buildRequestBody(detail);
      if (!body || typeof body !== 'object' || Array.isArray(body)) continue;

      const required = OpenApiSuiteBuilder.getRequiredBodyFields(detail);
      if (required.length === 0) continue;

      const badBody = { ...(body as Record<string, unknown>) };
      delete badBody[required[0]];

      const pathWithVars = op.path.replace(/\{(\w+)\}/g, '{{$1}}');
      const errorStatus = OpenApiSuiteBuilder.resolveClientErrorStatus(detail);

      const headers: Record<string, string> = {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      };
      OpenApiSuiteBuilder.applyAuthHeaders(headers, auth);

      negatives.push({
        name: `Negative: ${op.summary ?? op.operationId ?? op.path} missing ${required[0]}`,
        method: op.method as HttpMethod,
        url: `{{${baseVar}}}${pathWithVars}`,
        headers,
        body: badBody,
        operationId: `${op.operationId ?? slugify(op.path)}_negative`,
        tags: [...(op.tags ?? []), 'negative'],
        assertions: errorStatus
          ? { status: errorStatus }
          : { statusIn: [400, 401, 403, 404, 409, 422] },
      });
    }

    return negatives;
  }

  private static getRequiredBodyFields(detail: any): string[] {
    const content = detail.requestBody?.content?.['application/json'];
    const schema = content?.schema;
    if (schema?.required && Array.isArray(schema.required)) return schema.required;
    // Swagger 2
    const bodyParam = (detail.parameters ?? []).find((p: any) => p.in === 'body');
    if (bodyParam?.schema?.required) return bodyParam.schema.required;
    return [];
  }

  private static resolveClientErrorStatus(detail: any): number | undefined {
    const responses = detail.responses ?? {};
    for (const code of ['400', '422', '409', '404', '401', '403']) {
      if (responses[code]) return Number(code);
    }
    return undefined;
  }

  private static buildQueryString(parameters: any[] | undefined): string {
    if (!Array.isArray(parameters)) return '';
    const parts: string[] = [];
    for (const p of parameters) {
      if (p.in !== 'query') continue;
      const name = p.name as string;
      const example =
        p.example ??
        p.schema?.default ??
        p.schema?.example ??
        (p.schema?.type === 'boolean' ? 'true' : p.schema?.type === 'integer' ? '1' : 'sample');
      parts.push(`${encodeURIComponent(name)}={{${name}}}`);
      // Also allow literal seed — variables will interpolate {{name}}
      void example;
    }
    return parts.length ? `?${parts.join('&')}` : '';
  }

  private static seedPathParams(parameters: any[] | undefined): Record<string, unknown> {
    const seeds: Record<string, unknown> = {};
    if (!Array.isArray(parameters)) return seeds;
    for (const p of parameters) {
      if (p.in !== 'path' && p.in !== 'query') continue;
      const schema = p.schema ?? p;
      seeds[p.name] =
        p.example ??
        schema.default ??
        schema.example ??
        (Array.isArray(schema.enum) && schema.enum.length ? schema.enum[0] : undefined) ??
        (Array.isArray(p.enum) && p.enum.length ? p.enum[0] : undefined) ??
        (schema.type === 'integer' || schema.type === 'number' || p.type === 'integer' || p.type === 'number'
          ? 1
          : p.name.toLowerCase().includes('status')
            ? 'available'
            : p.name.toLowerCase().includes('user')
              ? 'user1'
              : '1');
    }
    return seeds;
  }

  private static buildRequestBody(detail: any): unknown {
    const jsonContent = detail.requestBody?.content?.['application/json'];
    if (jsonContent) {
      if (jsonContent.example !== undefined) return jsonContent.example;
      if (jsonContent.examples) {
        const first = Object.values(jsonContent.examples)[0] as any;
        if (first?.value !== undefined) return first.value;
      }
      if (jsonContent.schema) return OpenApiSuiteBuilder.synthesizeFromSchema(jsonContent.schema);
    }
    // Swagger 2 body parameter
    const bodyParam = (detail.parameters ?? []).find((p: any) => p.in === 'body');
    if (bodyParam?.schema) {
      if (bodyParam.example !== undefined) return bodyParam.example;
      return OpenApiSuiteBuilder.synthesizeFromSchema(bodyParam.schema);
    }
    return undefined;
  }

  public static synthesizeFromSchema(schema: any, depth = 0): unknown {
    if (!schema || depth > 6) return null;
    if (schema.example !== undefined) return schema.example;
    if (schema.default !== undefined) return schema.default;
    if (schema.enum?.length) return schema.enum[0];

    if (schema.$ref) {
      return {};
    }

    const type = schema.type || (schema.properties ? 'object' : schema.items ? 'array' : 'string');

    if (type === 'object' || schema.properties) {
      const obj: Record<string, unknown> = {};
      const required: string[] = schema.required ?? Object.keys(schema.properties ?? {}).slice(0, 5);
      const props = schema.properties ?? {};
      for (const key of required) {
        if (props[key]) obj[key] = OpenApiSuiteBuilder.synthesizeFromSchema(props[key], depth + 1);
      }
      // Include a couple optional props for richer bodies
      for (const [key, prop] of Object.entries(props)) {
        if (obj[key] !== undefined) continue;
        if (Object.keys(obj).length >= 8) break;
        obj[key] = OpenApiSuiteBuilder.synthesizeFromSchema(prop, depth + 1);
      }
      return obj;
    }

    if (type === 'array') {
      const item = OpenApiSuiteBuilder.synthesizeFromSchema(schema.items ?? { type: 'string' }, depth + 1);
      return [item];
    }

    if (type === 'integer' || type === 'number') return schema.minimum ?? 1;
    if (type === 'boolean') return true;
    if (schema.format === 'date-time') return new Date().toISOString();
    if (schema.format === 'date') return new Date().toISOString().slice(0, 10);
    if (schema.format === 'email') return 'user@example.com';
    if (schema.format === 'uuid') return '00000000-0000-4000-8000-000000000001';
    return schema.title ? String(schema.title).slice(0, 32) : 'string';
  }

  private static resolveSuccessResponse(detail: any): {
    status?: number;
    statusIn?: number[];
    schema?: object;
  } {
    const responses = detail.responses ?? {};
    const codes = Object.keys(responses);
    const successCodes = codes
      .filter((c) => SUCCESS_STATUSES.includes(c) || /^2\d\d$/.test(c))
      .map((c) => Number(c))
      .filter((n) => Number.isFinite(n));

    let chosen: string | undefined =
      SUCCESS_STATUSES.find((c) => responses[c]) ??
      codes.find((c) => /^2\d\d$/.test(c)) ??
      (responses.default ? 'default' : undefined);

    const response = chosen ? responses[chosen] : undefined;
    let schema: object | undefined;
    if (response) {
      const content = response.content?.['application/json'] ?? response.content?.['*/*'];
      schema = content?.schema ?? response.schema;
    }

    if (successCodes.length > 1) {
      return {
        statusIn: successCodes,
        status: successCodes[0],
        schema,
      };
    }
    if (successCodes.length === 1) {
      return { status: successCodes[0], schema };
    }
    if (chosen && chosen !== 'default') {
      return { status: Number(chosen), schema };
    }
    return { status: 200, schema };
  }

  private static suggestExtractedVariables(schema: any): Record<string, string> | undefined {
    if (!schema?.properties) return undefined;
    if (schema.properties.id) return { id: 'id' };
    return undefined;
  }

  private static applyAuthHeaders(headers: Record<string, string>, auth: ApiAuthPlan): void {
    if (auth.type === 'bearer') {
      headers.Authorization = `Bearer {{${auth.envVar}}}`;
    } else if (auth.type === 'apiKey' && auth.in !== 'query' && auth.name) {
      headers[auth.name] = `{{${auth.envVar}}}`;
    } else if (auth.type === 'basic') {
      headers.Authorization = `Basic {{${auth.envVar}}}`;
    }
  }

  private static toScenarioFiles(
    loaded: OpenApiLoadResult,
    sourceRef: string,
    steps: ApiRequestStep[],
    negatives: ApiRequestStep[],
    auth: ApiAuthPlan,
    splitBy: OpenApiSplitBy,
    variableSeeds: Record<string, unknown>
  ): OpenApiSuiteFile[] {
    const baseName = slugify(loaded.title);

    if (splitBy === 'tag') {
      const byTag = new Map<string, ApiRequestStep[]>();
      for (const step of steps) {
        const tag = step.tags?.[0] || 'default';
        if (!byTag.has(tag)) byTag.set(tag, []);
        byTag.get(tag)!.push(step);
      }
      const files: OpenApiSuiteFile[] = [];
      for (const [tag, tagSteps] of byTag) {
        const negForTag = negatives.filter((n) => n.tags?.includes(tag));
        files.push({
          relativePath: `tests/api/${baseName}_${slugify(tag)}_openapi.txt`,
          content: OpenApiSuiteBuilder.renderScenarioText(
            loaded,
            sourceRef,
            [...tagSteps, ...negForTag],
            auth,
            tag,
            variableSeeds
          ),
          tag,
          stepCount: tagSteps.length + negForTag.length,
        });
      }
      return files;
    }

    const all = [...steps, ...negatives];
    return [
      {
        relativePath: `tests/api/${baseName}_openapi.txt`,
        content: OpenApiSuiteBuilder.renderScenarioText(
          loaded,
          sourceRef,
          all,
          auth,
          undefined,
          variableSeeds
        ),
        stepCount: all.length,
      },
    ];
  }

  public static renderScenarioText(
    loaded: OpenApiLoadResult,
    sourceRef: string,
    steps: ApiRequestStep[],
    auth: ApiAuthPlan,
    tag?: string,
    variableSeeds: Record<string, unknown> = {}
  ): string {
    const lines: string[] = [
      '@api @openapi',
      `Test: ${loaded.title}${tag ? ` — ${tag}` : ''} — OpenAPI suite`,
      '',
      `@source ${sourceRef}`,
      `@baseUrl ${loaded.baseUrl ?? '{{apiBaseUrl}}'}`,
      `@importMode full`,
    ];
    if (auth.type !== 'none') {
      lines.push(`@auth ${auth.type} ${auth.envVar}`);
    }
    if (tag) lines.push(`@tag ${tag}`);
    lines.push('');

    if (Object.keys(variableSeeds).length) {
      lines.push('# Seed variables for path/query params (override in environments/*.json)');
      for (const [k, v] of Object.entries(variableSeeds)) {
        lines.push(`@var ${k}=${JSON.stringify(v)}`);
      }
      lines.push('');
    }

    for (const step of steps) {
      lines.push(`# ${step.operationId ?? step.name}`);
      lines.push(`Send ${step.method} request to ${step.url}`);
      if (step.headers && Object.keys(step.headers).length) {
        lines.push(`With Headers ${JSON.stringify(step.headers)}`);
      }
      if (step.body !== undefined) {
        lines.push(`With body ${JSON.stringify(step.body)}`);
      }
      if (step.schemaRef) {
        lines.push(`Assert response schema ${step.schemaRef}`);
      }
      if (step.assertions?.status !== undefined) {
        lines.push(`Assert status is ${step.assertions.status}`);
      } else if (step.assertions?.statusIn?.length) {
        lines.push(`Assert status in ${step.assertions.statusIn.join(',')}`);
      }
      if (step.extractedVariables) {
        for (const [jsonPath, varName] of Object.entries(step.extractedVariables)) {
          lines.push(`Extract response ${jsonPath} into ${varName}`);
        }
      }
      lines.push('');
    }

    return lines.join('\n').trimEnd() + '\n';
  }

  public static writeSchemaFiles(
    result: OpenApiSuiteBuildResult,
    projectRoot = process.cwd()
  ): string[] {
    const written: string[] = [];
    for (const [rel, content] of Object.entries(result.schemaFiles)) {
      const abs = path.join(projectRoot, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content, 'utf8');
      written.push(rel);
    }
    return written;
  }

  public static writeSuite(
    result: OpenApiSuiteBuildResult,
    projectRoot = process.cwd(),
    outputOverride?: string
  ): string[] {
    const written = OpenApiSuiteBuilder.writeSchemaFiles(result, projectRoot);

    if (outputOverride && result.files.length === 1) {
      const abs = path.isAbsolute(outputOverride)
        ? outputOverride
        : path.join(projectRoot, outputOverride);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, result.files[0].content, 'utf8');
      written.push(path.relative(projectRoot, abs).replace(/\\/g, '/'));
      return written;
    }

    for (const file of result.files) {
      const abs = path.join(projectRoot, file.relativePath);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, file.content, 'utf8');
      written.push(file.relativePath);
    }
    return written;
  }
}
