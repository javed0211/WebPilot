import { GeneratedFile } from '../../../agents/CodegenAgent';
import { ExecutionTrace, TraceSelector, TraceStep } from '../ExecutionTrace';
import { CodegenProfilePlan, GenerationPlan } from '../GenerationPlan';

export interface CodegenProfile {
  id: string;
  language: string;
  automationTool: string;
  testFramework: string;
  patterns: string[];
  matches(profile: CodegenProfilePlan): boolean;
  specPath(slug: string, profile: CodegenProfilePlan): string;
  pagePath(className: string, profile: CodegenProfilePlan, url?: string): string;
  replayCommand(specPath: string): string;
  emit(trace: ExecutionTrace, plan: GenerationPlan): GeneratedFile[];
  validationCommand(profile: CodegenProfilePlan): string | null;
}

export function slugToTitle(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

export function snakeCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

export function camelCase(value: string): string {
  const title = slugToTitle(value);
  return title.charAt(0).toLowerCase() + title.slice(1);
}

export function javaPackageFromPath(filePath: string): string {
  const marker = 'src/test/java/';
  const index = filePath.indexOf(marker);
  if (index < 0) return 'webpilot.generated';
  const dir = filePath.slice(index + marker.length).split('/').slice(0, -1);
  return dir.join('.') || 'webpilot.generated';
}

export function escapeSingle(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export function escapeDouble(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function selectorValue(selector?: TraceSelector): string {
  return selector?.value || selector?.expression || '';
}

export function roleParts(selector?: TraceSelector): { role: string; name?: string } | null {
  if (!selector || selector.kind !== 'role') return null;
  const match = selector.value.match(/^([^[]+)(?:\[name='([^']+)'\])?$/);
  if (!match) return null;
  return { role: match[1], name: match[2] };
}

export function firstUrl(trace: ExecutionTrace): string | undefined {
  return trace.targetUrl || trace.steps.find((step) => step.url)?.url;
}

export function actionSteps(trace: ExecutionTrace): TraceStep[] {
  return trace.steps.filter((step) => step.action !== 'navigate' || Boolean(step.url));
}
