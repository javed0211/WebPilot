import { CodegenAudit } from './CodegenAuditWriter';

export interface CodegenQualityPolicyOptions {
  allowRawPageFallback: boolean;
  minPomMappedStepRatio: number;
}

export function enforceCodegenQuality(
  audit: CodegenAudit,
  options: CodegenQualityPolicyOptions
): void {
  const configuredRatio = Number(options.minPomMappedStepRatio);
  const minimumRatio = Number.isFinite(configuredRatio)
    ? Math.max(0, Math.min(1, configuredRatio))
    : 0;

  if (!options.allowRawPageFallback && audit.qualityRawFallbackStepIndexes.length > 0) {
    throw new Error(
      `Deterministic codegen rejected raw page.* fallback for quality-eligible step(s): ` +
        audit.qualityRawFallbackStepIndexes.join(', ')
    );
  }
  if (audit.pomMappedStepRatio < minimumRatio) {
    throw new Error(
      `Deterministic codegen POM mapping ratio ${audit.pomMappedStepRatio.toFixed(2)} ` +
        `is below configured minimum ${minimumRatio.toFixed(2)}.`
    );
  }
}
