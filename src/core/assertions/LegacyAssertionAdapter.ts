import type { AssertionCandidate } from './AssertionCandidate';
import type { SemanticAssertion } from './SemanticAssertion';
import { SEMANTIC_ASSERTION_SCHEMA_VERSION } from './SemanticAssertion';

/**
 * Adapt legacy flat AssertionCandidate into a SemanticAssertion for unified evaluation.
 */
export class LegacyAssertionAdapter {
  public static toSemantic(candidate: AssertionCandidate, index = 0): SemanticAssertion {
    const assertionId = `legacy_${candidate.kind}_${index}`;
    switch (candidate.kind) {
      case 'url_contains':
        return {
          schemaVersion: SEMANTIC_ASSERTION_SCHEMA_VERSION,
          assertionId,
          description: candidate.description,
          assert: {
            op: 'contains',
            left: { kind: 'extract', extraction: { name: 'url', as: 'string', source: { kind: 'url' } } },
            right: { kind: 'literal', value: String(candidate.expected ?? ''), as: 'string' },
          },
        };
      case 'url_equals':
        return {
          schemaVersion: SEMANTIC_ASSERTION_SCHEMA_VERSION,
          assertionId,
          description: candidate.description,
          assert: {
            op: 'equals',
            left: { kind: 'extract', extraction: { name: 'url', as: 'string', source: { kind: 'url' } } },
            right: { kind: 'literal', value: String(candidate.expected ?? ''), as: 'string' },
          },
        };
      case 'value_equals':
        return {
          schemaVersion: SEMANTIC_ASSERTION_SCHEMA_VERSION,
          assertionId,
          description: candidate.description,
          assert: {
            op: 'equals',
            left: {
              kind: 'extract',
              extraction: {
                name: 'field',
                as: 'string',
                source: {
                  kind: 'locatorValue',
                  locator: {
                    selector: candidate.selector?.value || candidate.selector?.expression || '',
                    kind: (candidate.selector?.kind as any) || 'css',
                  },
                },
              },
            },
            right: { kind: 'literal', value: String(candidate.expected ?? ''), as: 'string' },
          },
        };
      case 'count_at_least':
        return {
          schemaVersion: SEMANTIC_ASSERTION_SCHEMA_VERSION,
          assertionId,
          description: candidate.description,
          assert: {
            op: 'greaterOrEqual',
            left: {
              kind: 'extract',
              extraction: {
                name: 'count',
                as: 'integer',
                source: {
                  kind: 'locatorCount',
                  locator: {
                    selector: candidate.selector?.value || '',
                    kind: (candidate.selector?.kind as any) || 'css',
                  },
                },
              },
            },
            right: { kind: 'literal', value: Number(candidate.expected ?? 0), as: 'integer' },
          },
        };
      case 'text_visible':
      case 'role_visible':
      case 'element_visible':
      case 'enabled':
      case 'disabled':
      default:
        // Visibility checks stay legacy at runtime until a page bridge exposes isVisible.
        return {
          schemaVersion: SEMANTIC_ASSERTION_SCHEMA_VERSION,
          assertionId,
          description: candidate.description,
          assert: {
            op: 'exists',
            left: {
              kind: 'literal',
              value: candidate.expected ?? candidate.selector?.value ?? true,
            },
          },
        };
    }
  }
}
