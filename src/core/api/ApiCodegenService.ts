import { GeneratedFile } from '../../agents/CodegenAgent';
import { ApiRequestStep, ApiStepExecutionRecord, ApiTestScenario } from './types';

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'api-test'
  );
}

function methodNameFromStep(step: ApiRequestStep, index: number): string {
  if (step.operationId) {
    const id = step.operationId.replace(/[^a-zA-Z0-9_]/g, '_');
    if (/^[A-Za-z]/.test(id)) return id.charAt(0).toLowerCase() + id.slice(1);
  }
  if (step.name) {
    const fromName = step.name
      .replace(/[^a-zA-Z0-9\s]/g, '')
      .split(/\s+/)
      .map((w, i) => (i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
      .join('');
    if (fromName && /^[a-z]/.test(fromName)) return fromName.slice(0, 40);
  }
  const pathPart = step.url.replace(/\{\{[^}]+\}\}/g, '').split('/').filter(Boolean).pop() ?? 'step';
  return `${step.method.toLowerCase()}${pathPart.charAt(0).toUpperCase()}${pathPart.slice(1)}${index}`;
}

export class ApiCodegenService {
  public static generate(
    scenario: ApiTestScenario,
    steps: ApiRequestStep[],
    _executionLog: ApiStepExecutionRecord[]
  ): GeneratedFile[] {
    const slug = slugify(scenario.name);
    const className =
      slug
        .split('-')
        .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
        .join('') + 'Api';

    const schemaConsts: string[] = [];
    const clientMethods = steps
      .map((step, i) => {
        const schemaLiteral = step.schema
          ? JSON.stringify(step.schema)
          : step.schemaRef
            ? `/* load from ${step.schemaRef} at runtime */ null`
            : null;
        if (step.schema) {
          const constName = `SCHEMA_${methodNameFromStep(step, i).toUpperCase()}`;
          schemaConsts.push(`const ${constName} = ${JSON.stringify(step.schema)} as const;`);
        }
        return ApiCodegenService.renderClientMethod(step, i, schemaLiteral !== null);
      })
      .join('\n\n');

    const clientFile: GeneratedFile = {
      path: `packages/test-framework/apis/${className}.ts`,
      content: `import { APIResponse } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { BaseAPI } from '@core/BaseAPI';

${schemaConsts.join('\n')}

function loadSchemaRef(schemaRef: string): object | undefined {
  const candidates = [
    path.join(process.cwd(), 'tests', 'api', schemaRef),
    path.join(process.cwd(), schemaRef),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return JSON.parse(fs.readFileSync(c, 'utf8'));
  }
  return undefined;
}

/**
 * Generated API client — ${scenario.name}
 * @generated WebPilot
 */
export class ${className} {
  constructor(private readonly client: BaseAPI) {}

${clientMethods}
}
`,
    };

    const byTag = new Map<string, Array<{ step: ApiRequestStep; index: number }>>();
    steps.forEach((step, index) => {
      const tag = step.tags?.[0] || 'default';
      if (!byTag.has(tag)) byTag.set(tag, []);
      byTag.get(tag)!.push({ step, index });
    });

    const describes: string[] = [];
    for (const [tag, group] of byTag) {
      const tests = group
        .map(({ step, index }) => {
          const fn = methodNameFromStep(step, index);
          const title = (step.name || fn).replace(/'/g, "\\'");
          const call =
            step.body !== undefined && ['POST', 'PUT', 'PATCH'].includes(step.method)
              ? `    await api.${fn}(${JSON.stringify(step.body)});`
              : `    await api.${fn}();`;
          return `  test('${title}', async ({ apiClient }) => {
    const api = new ${className}(apiClient);
${call}
  });`;
        })
        .join('\n\n');
      describes.push(`test.describe('API: ${tag.replace(/'/g, "\\'")}', () => {
${tests}
});`);
    }

    const specFile: GeneratedFile = {
      path: `packages/test-framework/tests/api/${slug}.api.spec.ts`,
      content: `import { test } from '@core/fixtures';
import { ${className} } from '../../apis/${className}';

${describes.join('\n\n')}
`,
    };

    return [clientFile, specFile];
  }

  /** Playwright fixture sets baseURL to apiBaseUrl — emit path-only URLs in generated code. */
  private static urlForGeneratedClient(url: string): string {
    const stripped = url
      .replace(/^\{\{apiBaseUrl\}\}/i, '')
      .replace(/^\{\{baseUrl\}\}/i, '')
      .replace(/\?.*$/, '');
    if (!stripped || stripped.startsWith('{{')) {
      return url.replace(/'/g, "\\'");
    }
    // Keep query template as-is on full url if present
    const withoutBase = url
      .replace(/^\{\{apiBaseUrl\}\}/i, '')
      .replace(/^\{\{baseUrl\}\}/i, '');
    return (withoutBase.startsWith('/') ? withoutBase : `/${withoutBase}`).replace(/'/g, "\\'");
  }

  private static renderClientMethod(
    step: ApiRequestStep,
    index: number,
    hasSchema: boolean
  ): string {
    const fn = methodNameFromStep(step, index);
    const url = ApiCodegenService.urlForGeneratedClient(step.url);
    const hasBody = step.body !== undefined && ['POST', 'PUT', 'PATCH'].includes(step.method);
    const schemaConst = `SCHEMA_${fn.toUpperCase()}`;

    const asserts: string[] = [];
    if (step.assertions?.status !== undefined) {
      asserts.push(`    await this.client.assertStatus(response, ${step.assertions.status});`);
    } else if (step.assertions?.statusIn?.length) {
      asserts.push(
        `    await this.client.assertStatusIn(response, ${JSON.stringify(step.assertions.statusIn)});`
      );
    }
    if (step.schema) {
      asserts.push(`    await this.client.validateSchema(response, ${schemaConst});`);
    } else if (step.schemaRef) {
      asserts.push(`    const schema = loadSchemaRef('${step.schemaRef.replace(/'/g, "\\'")}');`);
      asserts.push(`    if (schema) await this.client.validateSchema(response, schema);`);
    }

    const assertBlock = asserts.length ? `\n${asserts.join('\n')}` : '';

    if (hasBody) {
      return `  async ${fn}(body: unknown = ${JSON.stringify(step.body)}): Promise<APIResponse> {
    const response = await this.client.${step.method.toLowerCase()}('${url}', body);${assertBlock}
    return response;
  }`;
    }
    return `  async ${fn}(): Promise<APIResponse> {
    const response = await this.client.${step.method.toLowerCase()}('${url}');${assertBlock}
    return response;
  }`;
  }
}
