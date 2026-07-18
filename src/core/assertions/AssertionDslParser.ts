import type {
  ComparisonOperator,
  ExtractionSpec,
  SemanticAssertion,
  SemanticExpression,
  SemanticPlan,
  ValueType,
} from './SemanticAssertion';
import { SEMANTIC_ASSERTION_SCHEMA_VERSION } from './SemanticAssertion';
import { parseLocatorRef } from './TypedExtractor';

const VALUE_TYPES = new Set<ValueType>([
  'string',
  'number',
  'boolean',
  'integer',
  'decimal',
  'currency',
  'percentage',
  'date',
  'datetime',
]);

const OP_ALIASES: Record<string, ComparisonOperator> = {
  equals: 'equals',
  eq: 'equals',
  '==': 'equals',
  '=': 'equals',
  notequals: 'notEquals',
  ne: 'notEquals',
  '!=': 'notEquals',
  greaterthan: 'greaterThan',
  gt: 'greaterThan',
  '>': 'greaterThan',
  greaterorequal: 'greaterOrEqual',
  gte: 'greaterOrEqual',
  '>=': 'greaterOrEqual',
  lessthan: 'lessThan',
  lt: 'lessThan',
  '<': 'lessThan',
  lessorequal: 'lessOrEqual',
  lte: 'lessOrEqual',
  '<=': 'lessOrEqual',
  contains: 'contains',
  exists: 'exists',
  approximatelyequals: 'approximatelyEquals',
  approx: 'approximatelyEquals',
  '~=': 'approximatelyEquals',
};

function slugId(prefix: string, text: string, index: number): string {
  const base = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return `${prefix}_${base || 'item'}_${index}`;
}

function parseValueType(raw: string): ValueType | null {
  const t = raw.trim().toLowerCase() as ValueType;
  return VALUE_TYPES.has(t) ? t : null;
}

function parseExtractionSource(fromRaw: string, name: string, as: ValueType): ExtractionSpec['source'] {
  const from = fromRaw.trim();
  if (/^url$/i.test(from)) return { kind: 'url' };
  if (/^title$/i.test(from)) return { kind: 'title' };
  if (/^status$/i.test(from)) return { kind: 'status' };
  if (/^header:/i.test(from)) {
    return { kind: 'header', path: from.slice('header:'.length).trim() };
  }
  if (/^json:/i.test(from)) {
    return { kind: 'jsonPath', path: from.slice('json:'.length).trim() };
  }
  if (/^var:/i.test(from)) {
    return { kind: 'variable', path: from.slice('var:'.length).trim() };
  }
  if (/^(true|false)$/i.test(from) || /^-?\d+(\.\d+)?$/.test(from) || /^["'].*["']$/.test(from)) {
    let literal: string | number | boolean = from;
    if (/^["']/.test(from)) literal = from.slice(1, -1);
    else if (/^(true|false)$/i.test(from)) literal = /^true$/i.test(from);
    else literal = Number(from);
    return { kind: 'literal', literal };
  }

  // Locator forms
  const locator = parseLocatorRef(from);
  if (/value of /i.test(from) || /\.value$/i.test(from)) {
    return { kind: 'locatorValue', locator };
  }
  if (/^count:/i.test(from)) {
    return { kind: 'locatorCount', locator: parseLocatorRef(from.slice(6).trim()) };
  }
  if (/^attr:(\w+):/i.test(from)) {
    const m = from.match(/^attr:(\w+):(.+)$/i)!;
    return {
      kind: 'locatorAttribute',
      locator: { ...parseLocatorRef(m[2].trim()), attribute: m[1] },
    };
  }

  // Default locator text; currency/number from text is common.
  void as;
  void name;
  return { kind: 'locatorText', locator };
}

/**
 * Parse arithmetic / ref / literal expressions.
 * Supports: name, 12.5, "x", (a + b), a - b, a * b, a / b
 */
export function parseExpression(input: string): SemanticExpression {
  const tokens = tokenize(input);
  let i = 0;

  function peek() {
    return tokens[i];
  }
  function consume(expected?: string) {
    const t = tokens[i++];
    if (expected && t !== expected) {
      throw new Error(`Expected ${expected}, got ${t ?? 'EOF'}`);
    }
    return t;
  }

  function parsePrimary(): SemanticExpression {
    const t = peek();
    if (!t) throw new Error('Unexpected end of expression');
    if (t === '(') {
      consume('(');
      const inner = parseAdd();
      consume(')');
      return inner;
    }
    if (/^["']/.test(t)) {
      consume();
      return { kind: 'literal', value: t.slice(1, -1), as: 'string' };
    }
    if (/^-?\d+(\.\d+)?$/.test(t)) {
      consume();
      return { kind: 'literal', value: Number(t), as: 'decimal' };
    }
    if (/^(true|false)$/i.test(t)) {
      consume();
      return { kind: 'literal', value: /^true$/i.test(t), as: 'boolean' };
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(t)) {
      consume();
      return { kind: 'ref', name: t };
    }
    throw new Error(`Unexpected token in expression: ${t}`);
  }

  function parseMul(): SemanticExpression {
    let left = parsePrimary();
    while (peek() === '*' || peek() === '/') {
      const op = consume() === '*' ? 'multiply' : 'divide';
      const right = parsePrimary();
      left = { kind: 'arithmetic', op, left, right };
    }
    return left;
  }

  function parseAdd(): SemanticExpression {
    let left = parseMul();
    while (peek() === '+' || peek() === '-') {
      const op = consume() === '+' ? 'add' : 'subtract';
      const right = parseMul();
      left = { kind: 'arithmetic', op, left, right };
    }
    return left;
  }

  const expr = parseAdd();
  if (i < tokens.length) {
    throw new Error(`Unexpected trailing token: ${tokens[i]}`);
  }
  return expr;
}

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  const re =
    /\s+|("[^"]*"|'[^']*')|(\d+\.\d+|\d+)|([A-Za-z_][A-Za-z0-9_]*)|([+\-*/()])|([^\s])/g;
  let m: RegExpExecArray | null;
  const src = input.trim();
  while ((m = re.exec(src))) {
    if (m[0].trim() === '') continue;
    tokens.push(m[1] || m[2] || m[3] || m[4] || m[5]);
  }
  return tokens;
}

function parseDomainArgs(raw: string): Record<string, SemanticExpression> {
  const args: Record<string, SemanticExpression> = {};
  if (!raw.trim()) return args;

  // Split on commas not inside parentheses or brackets.
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of raw) {
    if (ch === '(' || ch === '[') depth += 1;
    if (ch === ')' || ch === ']') depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());

  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq < 0) throw new Error(`Domain arg must be name=value: ${part}`);
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (value.startsWith('[') && value.endsWith(']')) {
      const inner = value.slice(1, -1).trim();
      const items = inner
        ? inner.split(',').map((s) => s.trim()).filter(Boolean)
        : [];
      args[key] = {
        kind: 'array',
        items: items.map((name) =>
          /^[A-Za-z_]/.test(name) ? { kind: 'ref', name } : parseExpression(name)
        ),
      };
      continue;
    }
    args[key] = parseExpression(value);
  }
  return args;
}

/**
 * Parse explicit semantic DSL lines. Ambiguous lines are rejected, not invented.
 */
export class AssertionDslParser {
  public static parseText(text: string): SemanticPlan {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const extractions: ExtractionSpec[] = [];
    const assertions: SemanticAssertion[] = [];
    const rejected: SemanticPlan['rejected'] = [];
    let index = 0;

    for (const line of lines) {
      // Skip numbered prefixes: "4. Extract ..."
      const normalized = line.replace(/^\d+\.\s*/, '').replace(/^[-*]\s*/, '');

      const extractMatch = normalized.match(
        /^Extract\s+([A-Za-z_][A-Za-z0-9_]*)\s+as\s+([A-Za-z]+)\s+from\s+(.+)$/i
      );
      if (extractMatch) {
        const name = extractMatch[1];
        const as = parseValueType(extractMatch[2]);
        if (!as) {
          rejected.push({ line, reason: `Unknown type "${extractMatch[2]}"` });
          continue;
        }
        try {
          const source = parseExtractionSource(extractMatch[3], name, as);
          extractions.push({ name, as, source });
        } catch (err) {
          rejected.push({
            line,
            reason: err instanceof Error ? err.message : String(err),
          });
        }
        continue;
      }

      const domainMatch = normalized.match(/^Assert\s+domain\s+([A-Za-z0-9_.]+)\((.*)\)\s*$/i);
      if (domainMatch) {
        try {
          const arguments_ = parseDomainArgs(domainMatch[2]);
          assertions.push({
            schemaVersion: SEMANTIC_ASSERTION_SCHEMA_VERSION,
            assertionId: slugId('domain', domainMatch[1], index++),
            description: `domain ${domainMatch[1]}`,
            extract: [...extractions],
            domainCheck: { id: domainMatch[1], arguments: arguments_ },
          });
        } catch (err) {
          rejected.push({
            line,
            reason: err instanceof Error ? err.message : String(err),
          });
        }
        continue;
      }

      const assertMatch = normalized.match(
        /^Assert\s+(.+?)\s+(equals|notEquals|eq|ne|gt|gte|lt|lte|contains|exists|approximatelyEquals|approx|==|!=|>=|<=|>|<|~=)\s*(.*?)\s*(?:within\s+(-?\d+(?:\.\d+)?))?\s*$/i
      );
      if (assertMatch) {
        try {
          const leftRaw = assertMatch[1].trim();
          const opRaw = assertMatch[2].trim().toLowerCase();
          const rightRaw = assertMatch[3].trim();
          const within = assertMatch[4] ? Number(assertMatch[4]) : undefined;
          const op = OP_ALIASES[opRaw];
          if (!op) {
            rejected.push({ line, reason: `Unknown operator "${assertMatch[2]}"` });
            continue;
          }
          if (op !== 'exists' && !rightRaw) {
            rejected.push({ line, reason: 'Comparison requires a right-hand expression' });
            continue;
          }
          const left = parseExpression(leftRaw);
          const right = op === 'exists' ? undefined : parseExpression(rightRaw);
          assertions.push({
            schemaVersion: SEMANTIC_ASSERTION_SCHEMA_VERSION,
            assertionId: slugId('assert', normalized, index++),
            description: normalized,
            extract: [...extractions],
            assert: {
              op,
              left,
              right,
              absoluteTolerance: within,
            },
          });
        } catch (err) {
          rejected.push({
            line,
            reason: err instanceof Error ? err.message : String(err),
          });
        }
        continue;
      }

      // Only reject lines that look like semantic intent but failed to parse.
      if (/^(Extract|Assert)\b/i.test(normalized)) {
        rejected.push({
          line,
          reason: 'Unrecognized semantic assertion syntax (refusing to invent operands)',
        });
      }
    }

    return {
      schemaVersion: SEMANTIC_ASSERTION_SCHEMA_VERSION,
      extractions,
      assertions,
      rejected,
    };
  }

  public static looksLikeSemanticDsl(text: string): boolean {
    return /(?:^|\n)\s*(?:\d+\.\s*)?(Extract|Assert)\b/i.test(text);
  }
}
