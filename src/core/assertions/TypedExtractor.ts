import type { ExtractionSpec, LocatorRef, ValueType } from './SemanticAssertion';
import { CoercionError, ValueCoercion } from './ValueCoercion';

export interface ExtractionContext {
  variables: Record<string, unknown>;
  url?: string;
  title?: string;
  /** Last API response envelope: { status, headers, body }. */
  lastResponse?: {
    status?: number;
    headers?: Record<string, string>;
    body?: unknown;
  };
  /**
   * Optional live page bridge. When absent, locator extractionsions fail unless
   * the variable bag already contains the named value.
   */
  page?: {
    locator: (selector: string) => {
      first: () => {
        innerText: () => Promise<string>;
        inputValue: () => Promise<string>;
        getAttribute: (name: string) => Promise<string | null>;
        count: () => Promise<number>;
      };
      count: () => Promise<number>;
    };
  };
}

export class ExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExtractionError';
  }
}

function getNested(obj: unknown, dotPath: string): unknown {
  const parts = dotPath.split('.').filter(Boolean);
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function locatorToPlaywrightSelector(ref: LocatorRef): string {
  if (ref.kind === 'testid' || /^\[data-testid=/i.test(ref.selector) || /^testid:/i.test(ref.selector)) {
    const id =
      ref.selector.replace(/^testid:/i, '').replace(/^\[data-testid=['"]?/i, '').replace(/['"]?\]$/, '') ||
      ref.selector;
    return `[data-testid="${id}"]`;
  }
  if (ref.kind === 'role' && ref.name) {
    return `role=${ref.kind === 'role' ? ref.selector : 'button'}[name="${ref.name}"]`;
  }
  return ref.selector;
}

/**
 * Parse locator shorthand from DSL:
 *   [data-testid=subtotal]
 *   testid:subtotal
 *   role:button[name=Search]
 *   css:.total
 *   text:Order confirmed
 */
export function parseLocatorRef(raw: string): LocatorRef {
  const s = raw.trim();
  const testIdBracket = s.match(/^\[data-testid=['"]?([^'"\]]+)['"]?\]$/i);
  if (testIdBracket) {
    return { kind: 'testid', selector: testIdBracket[1] };
  }
  if (/^testid:/i.test(s)) {
    return { kind: 'testid', selector: s.slice('testid:'.length).trim() };
  }
  const role = s.match(/^role:([^\[]+)(?:\[name=['"]?([^'"\]]+)['"]?\])?$/i);
  if (role) {
    return { kind: 'role', selector: role[1].trim(), name: role[2]?.trim() };
  }
  if (/^css:/i.test(s)) {
    return { kind: 'css', selector: s.slice(4).trim() };
  }
  if (/^text:/i.test(s)) {
    return { kind: 'text', selector: s.slice(5).trim() };
  }
  if (/^label:/i.test(s)) {
    return { kind: 'label', selector: s.slice(6).trim() };
  }
  return { kind: 'css', selector: s };
}

export class TypedExtractor {
  public static async extract(
    spec: ExtractionSpec,
    ctx: ExtractionContext
  ): Promise<{ value: unknown; coercion: string }> {
    const raw = await TypedExtractor.readRaw(spec, ctx);
    try {
      const value = ValueCoercion.coerce(raw, spec.as);
      return { value, coercion: `${typeof raw}→${spec.as}` };
    } catch (err) {
      if (err instanceof CoercionError) {
        throw new ExtractionError(
          `Failed to coerce "${String(raw)}" as ${spec.as} for ${spec.name}: ${err.message}`
        );
      }
      throw err;
    }
  }

  private static async readRaw(spec: ExtractionSpec, ctx: ExtractionContext): Promise<unknown> {
    const { source } = spec;

    // Prefer already-bound variable with the same name (tests / prior extract).
    if (source.kind !== 'literal' && ctx.variables[spec.name] !== undefined && !source.locator) {
      if (source.kind === 'variable' || source.kind === 'jsonPath') {
        // continue to explicit path
      } else if (
        source.kind === 'locatorText' ||
        source.kind === 'locatorValue' ||
        source.kind === 'locatorAttribute' ||
        source.kind === 'locatorCount'
      ) {
        // fall through to live extract when locator present
      }
    }

    switch (source.kind) {
      case 'literal':
        return source.literal;
      case 'variable': {
        const path = source.path || spec.name;
        const value = getNested(ctx.variables, path);
        if (value === undefined) {
          throw new ExtractionError(`Variable not found: ${path}`);
        }
        return value;
      }
      case 'url':
        if (!ctx.url) throw new ExtractionError('URL not available in extraction context');
        return ctx.url;
      case 'title':
        if (!ctx.title) throw new ExtractionError('Title not available in extraction context');
        return ctx.title;
      case 'status': {
        const status = ctx.lastResponse?.status ?? ctx.variables.status;
        if (status === undefined) throw new ExtractionError('HTTP status not available');
        return status;
      }
      case 'header': {
        const path = source.path;
        if (!path) throw new ExtractionError('header extraction requires path');
        const headers = ctx.lastResponse?.headers || {};
        const found =
          headers[path] ??
          headers[path.toLowerCase()] ??
          Object.entries(headers).find(([k]) => k.toLowerCase() === path.toLowerCase())?.[1];
        if (found === undefined) throw new ExtractionError(`Header not found: ${path}`);
        return found;
      }
      case 'jsonPath': {
        const path = source.path;
        if (!path) throw new ExtractionError('jsonPath extraction requires path');
        const body = ctx.lastResponse?.body ?? ctx.variables;
        const value = getNested(body, path);
        if (value === undefined) throw new ExtractionError(`JSON path not found: ${path}`);
        return value;
      }
      case 'locatorText':
      case 'locatorValue':
      case 'locatorAttribute':
      case 'locatorCount':
        return TypedExtractor.fromLocator(spec.as, source.kind, source.locator, ctx, spec.name);
      default:
        throw new ExtractionError(`Unsupported extraction source: ${(source as any).kind}`);
    }
  }

  private static async fromLocator(
    _as: ValueType,
    kind: ExtractionSpec['source']['kind'],
    locator: LocatorRef | undefined,
    ctx: ExtractionContext,
    name: string
  ): Promise<unknown> {
    if (!locator) throw new ExtractionError(`Locator required for ${kind} (${name})`);

    // Soft path: variable already populated (unit tests / prior step).
    if (!ctx.page && ctx.variables[name] !== undefined) {
      return ctx.variables[name];
    }
    if (!ctx.page) {
      throw new ExtractionError(
        `No page available to extract ${name} from locator ${locator.selector}`
      );
    }

    const sel =
      locator.kind === 'testid'
        ? `[data-testid="${locator.selector}"]`
        : locator.kind === 'text'
          ? `text=${locator.selector}`
          : locator.kind === 'label'
            ? `label=${locator.selector}`
            : locator.selector;

    const loc = ctx.page.locator(sel);
    if (kind === 'locatorCount') {
      return loc.count();
    }
    const first = loc.first();
    if (kind === 'locatorValue') return first.inputValue();
    if (kind === 'locatorAttribute') {
      const attr = locator.attribute || 'value';
      const v = await first.getAttribute(attr);
      if (v == null) throw new ExtractionError(`Attribute ${attr} missing on ${sel}`);
      return v;
    }
    return first.innerText();
  }
}
