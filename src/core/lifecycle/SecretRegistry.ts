import { EvidenceRedactor, REDACTED, type RedactionOptions } from '../events/EvidenceRedactor';

/**
 * Tracks secret field names for a run and redacts structured payloads before persistence.
 */
export class SecretRegistry {
  private readonly fields = new Set<string>();

  constructor(initialFields: string[] = []) {
    for (const field of initialFields) {
      this.register(field);
    }
  }

  public register(field: string): void {
    const trimmed = field.trim();
    if (trimmed) this.fields.add(trimmed);
  }

  public registerMany(fields: string[]): void {
    for (const field of fields) this.register(field);
  }

  public list(): string[] {
    return [...this.fields];
  }

  public redactStructured(
    payload: Record<string, unknown>,
    options: RedactionOptions = {}
  ): Record<string, unknown> {
    return EvidenceRedactor.redactStructured(payload, {
      ...options,
      extraFields: [...(options.extraFields || []), ...this.fields],
    });
  }

  public redactValue(value: unknown, keyHint = ''): unknown {
    return EvidenceRedactor.redactValue(value, { extraFields: [...this.fields] }, keyHint);
  }

  public static readonly REDACTED = REDACTED;
}
