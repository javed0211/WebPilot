import * as fs from 'fs';
import * as path from 'path';
import { LLMClient, LLMMessage } from '../LLMClient';
import { PromptLoader } from '../PromptLoader';
import { ApiAuthPlan, ApiRequestStep, ApiSourceType, ApiTestScenario, HttpMethod } from './types';
import { OpenApiLoader } from './OpenApiLoader';
import { OpenApiSuiteBuilder } from './OpenApiSuiteBuilder';
import { deepInterpolate } from './variableUtils';
import { ConfigManager } from '../ConfigManager';

const HTTP_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'];

export class ApiTestParser {
  public static async parseFile(filePath: string, llm?: LLMClient): Promise<ApiTestScenario> {
    const abs = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
    const content = fs.readFileSync(abs, 'utf8');
    return ApiTestParser.parseContent(content, abs, llm);
  }

  public static async parseContent(
    content: string,
    fileHint?: string,
    llm?: LLMClient
  ): Promise<ApiTestScenario> {
    const trimmed = content.trim();
    const sourceType = ApiTestParser.detectSourceType(trimmed, fileHint);

    if (sourceType === 'openapi-url' || sourceType === 'openapi-file' || sourceType === 'openapi-inline') {
      return ApiTestParser.parseOpenApiSource(trimmed, sourceType, fileHint);
    }

    const meta = ApiTestParser.parseMetadata(trimmed);
    // Prefer explicit NL steps in the file over re-expanding the whole OpenAPI at runtime.
    const regexSteps = ApiTestParser.parsePlainTextSteps(trimmed);
    if (regexSteps.length > 0) {
      return {
        name: meta.name ?? 'API Test',
        sourceType: 'plain-text',
        sourceRef: meta.swaggerSource,
        tags: meta.tags,
        steps: regexSteps,
        variables: meta.variables,
        auth: meta.auth,
        rawContent: trimmed,
      };
    }

    if (meta.swaggerSource) {
      return ApiTestParser.parseOpenApiSource(meta.swaggerSource, 'openapi-url', fileHint, meta);
    }

    if (llm) {
      const steps = await ApiTestParser.parseWithLlm(trimmed, llm);
      return {
        name: meta.name ?? 'API Test',
        sourceType: 'plain-text',
        tags: meta.tags,
        steps,
        auth: meta.auth,
        needsLlm: steps.length === 0,
        rawContent: trimmed,
      };
    }

    return {
      name: meta.name ?? 'API Test',
      sourceType: 'plain-text',
      tags: meta.tags,
      steps: [],
      auth: meta.auth,
      needsLlm: true,
      rawContent: trimmed,
    };
  }

  private static detectSourceType(content: string, fileHint?: string): ApiSourceType {
    if (fileHint && OpenApiLoader.isOpenApiFile(fileHint)) {
      return 'openapi-file';
    }
    const firstLine = content.split('\n')[0]?.trim() ?? '';
    if (OpenApiLoader.isOpenApiUrl(firstLine) && content.split('\n').length <= 2) {
      return 'openapi-url';
    }
    if (content.startsWith('{') && (content.includes('"openapi"') || content.includes('"swagger"'))) {
      return 'openapi-inline';
    }
    return 'plain-text';
  }

  private static parseMetadata(content: string): {
    name?: string;
    tags?: string[];
    swaggerSource?: string;
    operations?: string[];
    variables?: Record<string, unknown>;
    auth?: ApiAuthPlan;
    importMode?: 'full' | 'smoke';
  } {
    const lines = content.split('\n');
    let name: string | undefined;
    const tags: string[] = [];
    let swaggerSource: string | undefined;
    let operations: string[] | undefined;
    const variables: Record<string, unknown> = {};
    let auth: ApiAuthPlan | undefined;
    let importMode: 'full' | 'smoke' | undefined;

    for (const line of lines) {
      const t = line.trim();
      if (t.startsWith('Test:')) {
        name = t.replace(/^Test:\s*/i, '').trim();
      }
      if (t.startsWith('@api') || t.startsWith('@openapi') || t.startsWith('@smoke')) {
        tags.push(...t.split(/\s+/).filter((x) => x.startsWith('@')));
      }
      if (/^@source\s+/i.test(t)) {
        swaggerSource = t.replace(/^@source\s+/i, '').trim();
      }
      if (/^@swagger\s+/i.test(t) || /^@openapi\s+/i.test(t)) {
        const rest = t.replace(/^@(swagger|openapi)\s+/i, '').trim();
        if (rest && !rest.startsWith('@')) swaggerSource = rest;
      }
      if (/^@operations\s+/i.test(t)) {
        operations = t
          .replace(/^@operations\s+/i, '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
      }
      if (/^@baseUrl\s+/i.test(t)) {
        variables.apiBaseUrl = t.replace(/^@baseUrl\s+/i, '').trim();
      }
      if (/^@importMode\s+/i.test(t)) {
        const mode = t.replace(/^@importMode\s+/i, '').trim().toLowerCase();
        if (mode === 'full' || mode === 'smoke') importMode = mode;
      }
      if (/^@auth\s+/i.test(t)) {
        const parts = t.replace(/^@auth\s+/i, '').trim().split(/\s+/);
        const type = (parts[0] || 'bearer').toLowerCase();
        const envVar = parts[1] || 'AUTH_TOKEN';
        if (type === 'bearer' || type === 'apiKey' || type === 'basic' || type === 'none') {
          auth = { type: type as ApiAuthPlan['type'], envVar };
        }
      }
      if (/^@var\s+/i.test(t)) {
        const rest = t.replace(/^@var\s+/i, '').trim();
        const eq = rest.indexOf('=');
        if (eq > 0) {
          const key = rest.slice(0, eq).trim();
          let value: unknown = rest.slice(eq + 1).trim();
          try {
            value = JSON.parse(String(value));
          } catch {
            /* keep string */
          }
          variables[key] = value;
        }
      }
    }

    return { name, tags, swaggerSource, operations, variables, auth, importMode };
  }

  private static async parseOpenApiSource(
    content: string,
    sourceType: ApiSourceType,
    fileHint?: string,
    meta?: ReturnType<typeof ApiTestParser.parseMetadata>
  ): Promise<ApiTestScenario> {
    let sourceRef = content.split('\n')[0]?.trim() ?? content;
    if (sourceType === 'openapi-file' && fileHint) {
      sourceRef = fileHint;
    }
    if (meta?.swaggerSource) {
      sourceRef = meta.swaggerSource;
    }
    if (sourceType === 'openapi-inline') {
      const tmp = path.join(process.cwd(), 'runtime', 'tmp', 'inline-openapi.json');
      fs.mkdirSync(path.dirname(tmp), { recursive: true });
      fs.writeFileSync(tmp, content, 'utf8');
      sourceRef = tmp;
    }

    const cfg = ConfigManager.getInstance().getAll() as {
      api?: { openapi?: { importMode?: string } };
    };
    const mode =
      meta?.importMode ||
      (cfg.api?.openapi?.importMode === 'smoke' ? 'smoke' : 'full');

    const built = await OpenApiSuiteBuilder.buildFromSource(sourceRef, {
      mode: mode as 'full' | 'smoke',
      operations: meta?.operations,
      schemaSidecars: true,
    });
    // Persist schema sidecars so schema refs resolve at runtime (do not overwrite scenarios).
    OpenApiSuiteBuilder.writeSchemaFiles(built, process.cwd());

    return {
      name: meta?.name ?? `${built.title} API`,
      sourceType,
      sourceRef,
      tags: meta?.tags ?? ['@openapi'],
      steps: built.steps,
      auth: built.auth.type !== 'none' ? built.auth : meta?.auth,
      variables: { ...meta?.variables, openApiTitle: built.title, apiBaseUrl: built.baseUrl },
    };
  }

  /** Rule-based NL parser for tests/api/*.txt format */
  public static parsePlainTextSteps(content: string): ApiRequestStep[] {
    const lines = content
      .split('\n')
      .map((l) => l.trim())
      .filter(
        (l) =>
          l &&
          !l.startsWith('#') &&
          !l.startsWith('@') &&
          !/^Test:/i.test(l) &&
          !/^(target|baseUrl|codegen|report)\s*:/i.test(l)
      );

    const steps: ApiRequestStep[] = [];
    let current: Partial<ApiRequestStep> | null = null;

    const flush = () => {
      if (current?.method && current.url) {
        steps.push({
          name: current.name ?? `${current.method} ${current.url}`,
          method: current.method,
          url: current.url,
          headers: current.headers,
          body: current.body,
          extractedVariables: current.extractedVariables,
          schema: current.schema,
          schemaRef: current.schemaRef,
          assertions: current.assertions,
          operationId: current.operationId,
          tags: current.tags,
        });
      }
      current = null;
    };

    for (const line of lines) {
      const sendMatch = line.match(
        /^Send\s+(GET|POST|PUT|PATCH|DELETE|HEAD)\s+request\s+to\s+(.+)$/i
      );
      if (sendMatch) {
        flush();
        current = {
          method: sendMatch[1].toUpperCase() as HttpMethod,
          url: sendMatch[2].trim(),
        };
        continue;
      }

      if (!current) continue;

      const bodyMatch = line.match(/^With\s+body\s+(?:payload\s+)?(.+)$/i);
      if (bodyMatch) {
        try {
          current.body = JSON.parse(bodyMatch[1]);
        } catch {
          current.body = bodyMatch[1];
        }
        continue;
      }

      const headersMatch = line.match(/^With\s+Headers?\s+(.+)$/i);
      if (headersMatch) {
        try {
          current.headers = JSON.parse(headersMatch[1]);
        } catch {
          /* ignore */
        }
        continue;
      }

      const extractMatch = line.match(
        /^Extract\s+response\s+(?:body\.)?([\w.]+)\s+into\s+(\w+)$/i
      );
      if (extractMatch) {
        current.extractedVariables = {
          ...(current.extractedVariables ?? {}),
          [extractMatch[1]]: extractMatch[2],
        };
        continue;
      }

      const schemaMatch = line.match(/^Assert\s+response\s+schema\s+(.+)$/i);
      if (schemaMatch) {
        current.schemaRef = schemaMatch[1].trim();
        continue;
      }

      const statusInMatch = line.match(/^Assert\s+status\s+in\s+([\d,\s]+)/i);
      if (statusInMatch) {
        const statusIn = statusInMatch[1]
          .split(',')
          .map((s) => parseInt(s.trim(), 10))
          .filter((n) => Number.isFinite(n));
        current.assertions = { ...(current.assertions ?? {}), statusIn };
        flush();
        continue;
      }

      const statusMatch = line.match(/^Assert\s+status\s+is\s+(\d+)/i);
      if (statusMatch) {
        current.assertions = { ...(current.assertions ?? {}), status: parseInt(statusMatch[1], 10) };
        flush();
        continue;
      }

      const containsMatch = line.match(/^Assert\s+(?:response\s+)?contains\s+["']?(.+?)["']?$/i);
      if (containsMatch) {
        current.assertions = {
          ...(current.assertions ?? {}),
          containsText: containsMatch[1],
        };
        continue;
      }
    }

    flush();
    return steps;
  }

  public static async parseWithLlm(content: string, llm: LLMClient): Promise<ApiRequestStep[]> {
    const systemPrompt =
      PromptLoader.tryLoad('api/nl-parse.md') ||
      `You translate natural language API tests into a JSON array of steps.
Each step: { "name", "method": "GET"|"POST"|"PUT"|"PATCH"|"DELETE", "url", "headers", "body", "extractedVariables": { "json.path": "varName" }, "schema", "schemaRef", "assertions": { "status", "statusIn", "containsText" } }.
Use {{variable}} in URLs and headers. Output ONLY a JSON array.`;

    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Parse this API test:\n\n${content}` },
    ];

    const response = await llm.complete(messages);
    try {
      let cleaned = response.text.trim();
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```json\s*/i, '').replace(/```$/g, '').trim();
      }
      const parsed = JSON.parse(cleaned) as ApiRequestStep[];
      return parsed.map((s) => deepInterpolate(s, {}) as ApiRequestStep);
    } catch {
      return [];
    }
  }
}
