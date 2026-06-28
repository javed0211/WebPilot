import * as fs from 'fs';
import * as path from 'path';
import { FailureSignal, FailureSource, FlakeAnalysisInput } from './FailureSignal';
import { SelectorRegistry } from '../selectors/SelectorRegistry';
import { RUNTIME_ROOT } from '../ProjectPaths';

const TEST_RESULTS_DIR = path.join(RUNTIME_ROOT, 'test-results');

function pushSignal(
  signals: FailureSignal[],
  signal: Omit<FailureSignal, 'source'> & { source?: FailureSource }
): void {
  signals.push({
    source: signal.source || 'unknown',
    ...signal,
  });
}

function parsePlaywrightError(text: string, source: FailureSource): FailureSignal[] {
  const signals: FailureSignal[] = [];
  if (!text.trim()) return signals;

  pushSignal(signals, { kind: 'raw_error', value: text.slice(0, 2000), source });

  const timeoutMatch = text.match(/waiting for (?:locator|selector|getBy[\w]+)\([^)]{0,200}\)/i);
  if (timeoutMatch) {
    pushSignal(signals, {
      kind: 'timeout_location',
      value: timeoutMatch[0],
      source,
    });
  } else if (/timeout.*exceeded/i.test(text)) {
    pushSignal(signals, {
      kind: 'timeout_location',
      value: 'step timeout',
      detail: text.split('\n')[0]?.slice(0, 240),
      source,
    });
  }

  if (/element is detached|not attached to the dom/i.test(text)) {
    pushSignal(signals, { kind: 'element_detached', value: true, source });
  }

  if (/intercepts pointer events|not actionable/i.test(text)) {
    pushSignal(signals, { kind: 'actionability_failure', value: true, source });
  }

  if (/cookie|consent|modal|dialog|overlay|banner/i.test(text)) {
    pushSignal(signals, { kind: 'modal_interference', value: true, source });
  }

  const consoleErrors = text.match(/console\.(?:error|warning)[^\n]*/gi) || [];
  for (const line of consoleErrors.slice(0, 5)) {
    pushSignal(signals, { kind: 'console_error', value: line.slice(0, 240), source });
  }

  const failedRequests = text.match(/(?:net::ERR_[A-Z_]+|failed request|request failed)[^\n]*/gi) || [];
  for (const line of failedRequests.slice(0, 5)) {
    pushSignal(signals, { kind: 'failed_request', value: line.slice(0, 240), source });
  }

  if (/slow|latency|took \d{4,}ms/i.test(text)) {
    pushSignal(signals, { kind: 'network_latency', value: true, source });
  }

  if (/page load|domcontentloaded|networkidle/i.test(text)) {
    pushSignal(signals, { kind: 'page_load_timing', value: true, source });
  }

  return signals;
}

function findPlaywrightErrorContext(slug: string): string | undefined {
  if (!fs.existsSync(TEST_RESULTS_DIR)) return undefined;

  const slugToken = slug.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  const candidates: string[] = [];

  const walk = (dir: string, depth: number): void => {
    if (depth > 4) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.toLowerCase().includes(slugToken)) {
          const errorFile = path.join(full, 'error-context.md');
          if (fs.existsSync(errorFile)) candidates.push(errorFile);
        }
        walk(full, depth + 1);
      }
    }
  };

  walk(TEST_RESULTS_DIR, 0);

  if (candidates.length === 0) {
    const fallback = path.join(TEST_RESULTS_DIR, 'error-context.md');
    if (fs.existsSync(fallback)) candidates.push(fallback);
  }

  const file = candidates.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  if (!file) return undefined;
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
}

function selectorSignalsForSteps(
  steps: FlakeAnalysisInput['executionSteps']
): FailureSignal[] {
  if (!steps?.length) return [];
  const registry = SelectorRegistry.load();
  const signals: FailureSignal[] = [];
  const tail = steps.slice(-3);

  for (const step of tail) {
    if (!step.selector) continue;
    const key = SelectorRegistry.keyFor(step.url || undefined, step.description || step.action);
    const page = registry.selectors[key.page];
    const entry = page?.[key.action];
    if (!entry) continue;
    pushSignal(signals, {
      kind: 'selector_confidence',
      value: entry.primary.confidence,
      detail: `${key.page}/${key.action}`,
      source: 'webpilot',
    });
  }

  return signals;
}

function runtimeInsightSignals(
  insights: FlakeAnalysisInput['runtimeInsights']
): FailureSignal[] {
  if (!insights?.length) return [];
  const signals: FailureSignal[] = [];
  for (const insight of insights) {
    const message = `${insight.type || ''} ${insight.message || ''}`.trim();
    if (!message) continue;
    signals.push(...parsePlaywrightError(message, 'browser-use'));
  }
  return signals;
}

export class FailureSignalExtractor {
  public static extract(input: FlakeAnalysisInput): FailureSignal[] {
    const signals: FailureSignal[] = [];

    if (input.retryCount && input.retryCount > 0) {
      pushSignal(signals, {
        kind: 'retry_count',
        value: input.retryCount,
        source: 'playwright',
      });
    }

    const playwrightContext = findPlaywrightErrorContext(input.slug);
    const mergedContext = [input.failureContext, playwrightContext].filter(Boolean).join('\n\n');

    if (mergedContext) {
      const source: FailureSource = /browser-use|agent failed/i.test(mergedContext)
        ? 'browser-use'
        : /playwright|locator|expect\(/i.test(mergedContext)
          ? 'playwright'
          : 'unknown';
      signals.push(...parsePlaywrightError(mergedContext, source));
    }

    signals.push(...selectorSignalsForSteps(input.executionSteps));
    signals.push(...runtimeInsightSignals(input.runtimeInsights));

    return signals;
  }
}
