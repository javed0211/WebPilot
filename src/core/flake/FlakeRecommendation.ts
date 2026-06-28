import { FailureSignal, FlakeAnalysis, FlakeCategory } from './FailureSignal';

const BASE_RECOMMENDATIONS: Record<FlakeCategory, string> = {
  selector:
    'Tighten the locator to a unique role, test id, or scoped container. Run `webpilot self-heal --proposals` to review ranked alternatives.',
  wait:
    'Add an explicit wait for navigation or visibility before the action. Prefer `expect(locator).toBeVisible()` over fixed sleeps.',
  network:
    'Stub or mock slow APIs in test, increase request timeouts for known slow endpoints, or wait for `networkidle` only when necessary.',
  modal:
    'Dismiss cookie banners and modals in a `beforeEach` hook or page-object `goto()` helper before interacting with the page.',
  environment:
    'Verify browser dependencies with `webpilot doctor`, confirm credentials in `.env`, and rerun headed to inspect session stability.',
  data:
    'Seed required fixtures before the test and externalize credentials via environment variables referenced in `webpilot.yaml`.',
  assertion:
    'Replace brittle text assertions with role-based checks. Review weak assertions flagged in the codegen metadata before merging.',
  unknown:
    'Open the trace or screenshot artifacts, reproduce headed, and add the failure signature to flake rules if it repeats.',
};

function contextualRecommendation(category: FlakeCategory, signals: FailureSignal[]): string {
  const base = BASE_RECOMMENDATIONS[category];
  const extras: string[] = [];

  const lowConfidence = signals.find(
    (signal) => signal.kind === 'selector_confidence' && Number(signal.value) < 0.5
  );
  if (lowConfidence && category === 'selector') {
    extras.push(`Selector confidence was ${lowConfidence.value}; prefer the primary candidate from the selector registry.`);
  }

  const timeout = signals.find((signal) => signal.kind === 'timeout_location');
  if (timeout && category === 'wait') {
    extras.push(`Timeout occurred at: ${timeout.value}.`);
  }

  const retries = signals.find((signal) => signal.kind === 'retry_count' && Number(signal.value) > 0);
  if (retries) {
    extras.push(`Run used ${retries.value} retries — treat this as a flake until the root cause is fixed.`);
  }

  return extras.length > 0 ? `${base} ${extras.join(' ')}` : base;
}

export class FlakeRecommendation {
  public static build(analysis: Pick<FlakeAnalysis, 'category' | 'signals'>): string {
    return contextualRecommendation(analysis.category, analysis.signals);
  }
}
