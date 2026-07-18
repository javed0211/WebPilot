import type { ValueType } from './SemanticAssertion';

export class CoercionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CoercionError';
  }
}

const CURRENCY_RE = /[-+]?\d{1,3}(?:,\d{3})*(?:\.\d+)?|[-+]?\d+(?:\.\d+)?/;

/**
 * Coerce raw extracted values into typed forms.
 * Currency/decimal use number with explicit scale tracking via cents for money math.
 */
export class ValueCoercion {
  public static coerce(raw: unknown, as: ValueType): unknown {
    if (raw == null) {
      throw new CoercionError(`Cannot coerce null/undefined as ${as}`);
    }

    switch (as) {
      case 'string':
        return String(raw);
      case 'boolean': {
        if (typeof raw === 'boolean') return raw;
        const s = String(raw).trim().toLowerCase();
        if (['true', '1', 'yes', 'on'].includes(s)) return true;
        if (['false', '0', 'no', 'off'].includes(s)) return false;
        throw new CoercionError(`Cannot coerce "${raw}" as boolean`);
      }
      case 'integer': {
        const n = ValueCoercion.parseNumber(raw);
        if (!Number.isFinite(n) || !Number.isInteger(n)) {
          throw new CoercionError(`Cannot coerce "${raw}" as integer`);
        }
        return n;
      }
      case 'number':
      case 'decimal':
      case 'currency': {
        return ValueCoercion.parseNumber(raw);
      }
      case 'percentage': {
        const s = String(raw).trim();
        if (s.endsWith('%')) {
          return ValueCoercion.parseNumber(s.slice(0, -1)) / 100;
        }
        return ValueCoercion.parseNumber(s);
      }
      case 'date':
      case 'datetime': {
        const s = String(raw).trim();
        const t = Date.parse(s);
        if (Number.isNaN(t)) throw new CoercionError(`Cannot coerce "${raw}" as ${as}`);
        return new Date(t).toISOString();
      }
      default:
        throw new CoercionError(`Unsupported type: ${as}`);
    }
  }

  public static parseNumber(raw: unknown): number {
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    const s = String(raw).trim();
    const match = s.replace(/\s/g, '').match(CURRENCY_RE);
    if (!match) throw new CoercionError(`Cannot parse number from "${raw}"`);
    const n = Number(match[0].replace(/,/g, ''));
    if (!Number.isFinite(n)) throw new CoercionError(`Cannot parse number from "${raw}"`);
    return n;
  }

  /** Convert currency/decimal to integer cents for exact arithmetic. */
  public static toCents(value: number): number {
    return Math.round(value * 100);
  }

  public static fromCents(cents: number): number {
    return cents / 100;
  }
}
