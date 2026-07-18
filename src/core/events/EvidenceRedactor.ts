/**
 * Redacts secrets and sensitive values before events are persisted.
 * Applied at ingestion and again before disk write.
 */

const SENSITIVE_KEY_RE =
  /pass(word)?|passwd|secret|token|api[_-]?key|auth|authorization|cookie|session|bearer|credential|access[_-]?key|private[_-]?key|pat|refresh/i;

const SENSITIVE_VALUE_RE =
  /\b(Bearer\s+[A-Za-z0-9\-._~+/]+=*|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/gi;

const QUERY_SECRET_RE = /([?&](?:token|key|api_key|access_token|auth|password|secret)=)([^&#]*)/gi;

export const REDACTED = '[REDACTED]';

export interface RedactionOptions {
  /** Extra field names to redact (case-insensitive). */
  extraFields?: string[];
  /** Max string length retained after redaction. */
  maxStringLength?: number;
}

function shouldRedactKey(key: string, extraFields: string[]): boolean {
  if (SENSITIVE_KEY_RE.test(key)) return true;
  const lower = key.toLowerCase();
  return extraFields.some((f) => lower === f.toLowerCase() || lower.includes(f.toLowerCase()));
}

function redactString(value: string, maxLen: number): string {
  let next = value
    .replace(SENSITIVE_VALUE_RE, REDACTED)
    .replace(QUERY_SECRET_RE, `$1${REDACTED}`);
  if (next.length > maxLen) {
    next = `${next.slice(0, maxLen)}…`;
  }
  return next;
}

export class EvidenceRedactor {
  public static redactValue(
    value: unknown,
    options: RedactionOptions = {},
    keyHint = ''
  ): unknown {
    const extraFields = options.extraFields ?? [];
    const maxLen = options.maxStringLength ?? 2_000;

    if (keyHint && shouldRedactKey(keyHint, extraFields)) {
      return REDACTED;
    }

    if (value == null) return value;
    if (typeof value === 'string') return redactString(value, maxLen);
    if (typeof value === 'number' || typeof value === 'boolean') return value;

    if (Array.isArray(value)) {
      return value.map((item, index) =>
        EvidenceRedactor.redactValue(item, options, `${keyHint}[${index}]`)
      );
    }

    if (typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = EvidenceRedactor.redactValue(v, options, k);
      }
      return out;
    }

    return String(value);
  }

  public static redactStructured(
    payload: Record<string, unknown>,
    options: RedactionOptions = {}
  ): Record<string, unknown> {
    return EvidenceRedactor.redactValue(payload, options) as Record<string, unknown>;
  }

  public static redactUrl(url: string): string {
    return redactString(url, 2_000);
  }
}
