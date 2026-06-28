import { FailureSignal, FlakeCategory, FailureSource } from './FailureSignal';

export interface ClassificationResult {
  category: FlakeCategory;
  confidence: number;
  likelyCause: string;
  source: FailureSource;
}

interface Rule {
  category: FlakeCategory;
  weight: number;
  patterns: RegExp[];
  cause: string;
  source?: FailureSource;
}

const RULES: Rule[] = [
  {
    category: 'selector',
    weight: 0.95,
    patterns: [
      /strict mode violation/i,
      /resolved to \d+ elements/i,
      /matched multiple elements/i,
      /locator resolved to hidden/i,
      /no element matching/i,
    ],
    cause: 'The locator matched zero or multiple elements instead of one unique target.',
    source: 'playwright',
  },
  {
    category: 'modal',
    weight: 0.92,
    patterns: [
      /intercepts pointer events/i,
      /element is not visible.*overlay/i,
      /cookie/i,
      /consent banner/i,
      /modal/i,
      /dialog/i,
      /popup/i,
      /banner.*click/i,
    ],
    cause: 'A modal, cookie banner, or overlay blocked the intended click or input.',
    source: 'playwright',
  },
  {
    category: 'wait',
    weight: 0.9,
    patterns: [
      /timeout.*exceeded/i,
      /waiting for (?:locator|selector|element)/i,
      /element is not attached/i,
      /element is detached/i,
      /not actionable/i,
      /waiting for navigation/i,
      /load state/i,
    ],
    cause: 'The step timed out before the page or element became ready for interaction.',
    source: 'playwright',
  },
  {
    category: 'network',
    weight: 0.88,
    patterns: [
      /econnreset/i,
      /etimedout/i,
      /enotfound/i,
      /net::err_/i,
      /network error/i,
      /failed to fetch/i,
      /api.*(?:slow|timeout|failed)/i,
      /request failed/i,
      /502|503|504/,
    ],
    cause: 'A network request failed or took longer than the configured timeout.',
    source: 'playwright',
  },
  {
    category: 'environment',
    weight: 0.86,
    patterns: [
      /browser has been closed/i,
      /target closed/i,
      /remote session/i,
      /browser crashed/i,
      /connection refused/i,
      /llm connection/i,
      /azure\/openai credentials/i,
      /playwright.*not installed/i,
    ],
    cause: 'The browser session or runtime environment became unavailable during the run.',
    source: 'browser-use',
  },
  {
    category: 'data',
    weight: 0.84,
    patterns: [
      /fixture.*not found/i,
      /test account/i,
      /user.*not found/i,
      /missing credentials/i,
      /invalid username|password/i,
      /seed data/i,
    ],
    cause: 'Required test data, credentials, or fixtures were missing or invalid.',
  },
  {
    category: 'assertion',
    weight: 0.9,
    patterns: [
      /expected:.*received:/i,
      /tohavetext/i,
      /tobevisible/i,
      /tohaveurl/i,
      /assertion failed/i,
      /expect\(.*\)\./i,
      /text content.*(?:mismatch|different)/i,
    ],
    cause: 'An assertion did not match the current page state.',
    source: 'playwright',
  },
];

function signalBlob(signals: FailureSignal[]): string {
  return signals
    .map((signal) => {
      const base = `${signal.kind}:${String(signal.value)}`;
      return signal.detail ? `${base} ${signal.detail}` : base;
    })
    .join('\n');
}

function detectSource(blob: string, fallback: FailureSource): FailureSource {
  if (/browser-use|agent failed|llm connection/i.test(blob)) return 'browser-use';
  if (/playwright|locator|strict mode|expect\(/i.test(blob)) return 'playwright';
  if (/webpilot|codegen/i.test(blob)) return 'webpilot';
  return fallback;
}

export class FlakeClassifier {
  public static classify(signals: FailureSignal[], failureContext?: string): ClassificationResult {
    const blob = `${failureContext || ''}\n${signalBlob(signals)}`.toLowerCase();

    let best: Rule | null = null;
    let bestWeight = 0;

    for (const rule of RULES) {
      if (!rule.patterns.some((pattern) => pattern.test(blob))) continue;
      if (rule.weight > bestWeight) {
        best = rule;
        bestWeight = rule.weight;
      }
    }

    if (signals.some((signal) => signal.kind === 'modal_interference')) {
      return {
        category: 'modal',
        confidence: 0.93,
        likelyCause: 'A modal, cookie banner, or overlay blocked the intended interaction.',
        source: detectSource(blob, 'playwright'),
      };
    }

    if (signals.some((signal) => signal.kind === 'selector_confidence' && Number(signal.value) < 0.5)) {
      if (!best) {
        return {
          category: 'selector',
          confidence: 0.8,
          likelyCause: 'A low-confidence selector was used on the failing step.',
          source: detectSource(blob, 'playwright'),
        };
      }
    }

    if (signals.some((signal) => signal.kind === 'element_detached')) {
      if (!best || best.weight < 0.9) {
        return {
          category: 'wait',
          confidence: 0.85,
          likelyCause: 'The target element detached from the DOM before the action completed.',
          source: detectSource(blob, 'playwright'),
        };
      }
    }

    if (best) {
      return {
        category: best.category,
        confidence: best.weight,
        likelyCause: best.cause,
        source: best.source || detectSource(blob, 'unknown'),
      };
    }

    return {
      category: 'unknown',
      confidence: 0.4,
      likelyCause: failureContext
        ? 'The failure message did not match a known flake pattern yet.'
        : 'No failure context was captured for classification.',
      source: detectSource(blob, 'unknown'),
    };
  }
}
