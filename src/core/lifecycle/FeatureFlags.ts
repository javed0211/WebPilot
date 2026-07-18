import { ConfigManager } from '../ConfigManager';

export type HealingClassificationMode = 'off' | 'shadow' | 'enforce';

export interface WebPilotFeatureFlags {
  eventLedger: boolean;
  fixtureLifecycle: boolean;
  semanticAssertions: boolean;
  healingClassification: HealingClassificationMode;
  groundedRootCause: boolean;
  captureNetwork: 'off' | 'errors' | 'metadata';
  captureConsole: 'off' | 'errors' | 'all';
  healingCommitPolicy: 'legacy' | 'postvalidated';
}

const DEFAULTS: WebPilotFeatureFlags = {
  eventLedger: true,
  fixtureLifecycle: false,
  semanticAssertions: false,
  healingClassification: 'off',
  groundedRootCause: false,
  captureNetwork: 'errors',
  captureConsole: 'errors',
  healingCommitPolicy: 'legacy',
};

function asBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(v)) return true;
    if (['0', 'false', 'no', 'off'].includes(v)) return false;
  }
  return fallback;
}

function asMode(value: unknown, allowed: string[], fallback: string): string {
  if (typeof value === 'string' && allowed.includes(value)) return value;
  return fallback;
}

/**
 * Resolve feature flags from webpilot.yaml `features:` block + env overrides.
 * Env overrides (when set):
 *   WEBPILOT_EVENT_LEDGER=0|1
 *   WEBPILOT_FIXTURE_LIFECYCLE=0|1
 *   WEBPILOT_SEMANTIC_ASSERTIONS=0|1
 *   WEBPILOT_HEALING_CLASSIFICATION=off|shadow|enforce
 *   WEBPILOT_GROUNDED_ROOT_CAUSE=0|1
 */
export function resolveFeatureFlags(cm?: ConfigManager): WebPilotFeatureFlags {
  const config = cm || ConfigManager.getInstance();
  const features = (config.get('features', {}) || {}) as Record<string, unknown>;
  const healing = (config.get('healing', {}) || {}) as Record<string, unknown>;
  const evidence = (config.get('evidence', {}) || {}) as Record<string, unknown>;

  const flags: WebPilotFeatureFlags = {
    eventLedger: asBool(features.eventLedger, DEFAULTS.eventLedger),
    fixtureLifecycle: asBool(features.fixtureLifecycle, DEFAULTS.fixtureLifecycle),
    semanticAssertions: asBool(features.semanticAssertions, DEFAULTS.semanticAssertions),
    healingClassification: asMode(
      features.healingClassification,
      ['off', 'shadow', 'enforce'],
      DEFAULTS.healingClassification
    ) as HealingClassificationMode,
    groundedRootCause: asBool(features.groundedRootCause, DEFAULTS.groundedRootCause),
    captureNetwork: asMode(
      evidence.captureNetwork,
      ['off', 'errors', 'metadata'],
      DEFAULTS.captureNetwork
    ) as WebPilotFeatureFlags['captureNetwork'],
    captureConsole: asMode(
      evidence.captureConsole,
      ['off', 'errors', 'all'],
      DEFAULTS.captureConsole
    ) as WebPilotFeatureFlags['captureConsole'],
    healingCommitPolicy: asMode(
      healing.commitPolicy,
      ['legacy', 'postvalidated'],
      DEFAULTS.healingCommitPolicy
    ) as WebPilotFeatureFlags['healingCommitPolicy'],
  };

  if (process.env.WEBPILOT_EVENT_LEDGER != null) {
    flags.eventLedger = asBool(process.env.WEBPILOT_EVENT_LEDGER, flags.eventLedger);
  }
  if (process.env.WEBPILOT_FIXTURE_LIFECYCLE != null) {
    flags.fixtureLifecycle = asBool(process.env.WEBPILOT_FIXTURE_LIFECYCLE, flags.fixtureLifecycle);
  }
  if (process.env.WEBPILOT_SEMANTIC_ASSERTIONS != null) {
    flags.semanticAssertions = asBool(
      process.env.WEBPILOT_SEMANTIC_ASSERTIONS,
      flags.semanticAssertions
    );
  }
  if (process.env.WEBPILOT_HEALING_CLASSIFICATION) {
    flags.healingClassification = asMode(
      process.env.WEBPILOT_HEALING_CLASSIFICATION,
      ['off', 'shadow', 'enforce'],
      flags.healingClassification
    ) as HealingClassificationMode;
  }
  if (process.env.WEBPILOT_HEALING_COMMIT_POLICY) {
    flags.healingCommitPolicy = asMode(
      process.env.WEBPILOT_HEALING_COMMIT_POLICY,
      ['legacy', 'postvalidated'],
      flags.healingCommitPolicy
    ) as WebPilotFeatureFlags['healingCommitPolicy'];
  }
  if (process.env.WEBPILOT_GROUNDED_ROOT_CAUSE != null) {
    flags.groundedRootCause = asBool(
      process.env.WEBPILOT_GROUNDED_ROOT_CAUSE,
      flags.groundedRootCause
    );
  }

  return flags;
}

/**
 * Fixture lifecycle runs when the global flag is on, or when a scenario
 * declares `fixture:` (scenario opt-in).
 */
export function shouldRunFixtureLifecycle(
  flags: WebPilotFeatureFlags,
  fixturePath?: string | null
): boolean {
  if (!fixturePath) return false;
  return flags.fixtureLifecycle || Boolean(fixturePath.trim());
}
