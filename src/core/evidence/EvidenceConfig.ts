import { ConfigManager } from '../ConfigManager';
import {
  DEFAULT_COMPLETENESS_THRESHOLDS,
  DEFAULT_RISK_WEIGHTS,
  type CompletenessThresholds,
  type RiskWeights,
} from './types';

export interface EvidenceFeatureConfig {
  enabled: boolean;
  writeBundle: boolean;
  risk: RiskWeights;
  completeness: CompletenessThresholds;
}

function asBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(v)) return true;
    if (['0', 'false', 'no', 'off'].includes(v)) return false;
  }
  return fallback;
}

function asNum(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Resolve evidence bundle config from webpilot.yaml `evidence:` block + env.
 * Env: WEBPILOT_EVIDENCE_BUNDLE=0|1
 */
export function resolveEvidenceConfig(cm?: ConfigManager): EvidenceFeatureConfig {
  const config = cm || ConfigManager.getInstance();
  const evidence = (config.get('evidence', {}) || {}) as Record<string, unknown>;
  const riskRaw = (evidence.risk || {}) as Record<string, unknown>;
  const compRaw = (evidence.completeness || {}) as Record<string, unknown>;

  const cfg: EvidenceFeatureConfig = {
    enabled: asBool(evidence.enabled, true),
    writeBundle: asBool(evidence.writeBundle, true),
    risk: {
      failWeight: asNum(riskRaw.failWeight, DEFAULT_RISK_WEIGHTS.failWeight),
      flakeHighConfidence: asNum(
        riskRaw.flakeHighConfidence,
        DEFAULT_RISK_WEIGHTS.flakeHighConfidence
      ),
      healingPerStep: asNum(riskRaw.healingPerStep, DEFAULT_RISK_WEIGHTS.healingPerStep),
      healingCap: asNum(riskRaw.healingCap, DEFAULT_RISK_WEIGHTS.healingCap),
      codegenDegraded: asNum(riskRaw.codegenDegraded, DEFAULT_RISK_WEIGHTS.codegenDegraded),
      unverifiedLocatorMax: asNum(
        riskRaw.unverifiedLocatorMax,
        DEFAULT_RISK_WEIGHTS.unverifiedLocatorMax
      ),
      weakAssertionOnly: asNum(
        riskRaw.weakAssertionOnly,
        DEFAULT_RISK_WEIGHTS.weakAssertionOnly
      ),
      missingFailureArtifacts: asNum(
        riskRaw.missingFailureArtifacts,
        DEFAULT_RISK_WEIGHTS.missingFailureArtifacts
      ),
      pageDrift: asNum(riskRaw.pageDrift, DEFAULT_RISK_WEIGHTS.pageDrift),
      highLlmSpend: asNum(riskRaw.highLlmSpend, DEFAULT_RISK_WEIGHTS.highLlmSpend),
    },
    completeness: {
      requireVerifiedLocatorRatio: asNum(
        compRaw.requireVerifiedLocatorRatio,
        DEFAULT_COMPLETENESS_THRESHOLDS.requireVerifiedLocatorRatio
      ),
      requireTraceOnFailure: asBool(
        compRaw.requireTraceOnFailure,
        DEFAULT_COMPLETENESS_THRESHOLDS.requireTraceOnFailure
      ),
      requireAssertionOnPass: asBool(
        compRaw.requireAssertionOnPass,
        DEFAULT_COMPLETENESS_THRESHOLDS.requireAssertionOnPass
      ),
    },
  };

  if (process.env.WEBPILOT_EVIDENCE_BUNDLE != null) {
    const on = asBool(process.env.WEBPILOT_EVIDENCE_BUNDLE, cfg.enabled);
    cfg.enabled = on;
    cfg.writeBundle = on;
  }

  return cfg;
}
