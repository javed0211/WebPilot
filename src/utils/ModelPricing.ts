/**
 * Approximate USD pricing per 1M tokens (input / output).
 * Used when providers do not return billing metadata.
 */
const PRICING_PER_MILLION: Array<{ match: (m: string) => boolean; input: number; output: number }> = [
  { match: (m) => m.includes('gpt-4o-mini') || m.includes('gpt-4-mini'), input: 0.15, output: 0.6 },
  { match: (m) => m.includes('gpt-4.1-mini') || m.includes('gpt-4.1-nano'), input: 0.4, output: 1.6 },
  { match: (m) => m.includes('gpt-4.1'), input: 2.0, output: 8.0 },
  { match: (m) => m.includes('gpt-4o'), input: 2.5, output: 10.0 },
  { match: (m) => m.includes('gpt-4-turbo'), input: 10.0, output: 30.0 },
  { match: (m) => m.includes('gpt-4'), input: 30.0, output: 60.0 },
  { match: (m) => m.includes('gpt-3.5'), input: 0.5, output: 1.5 },
  { match: (m) => m.includes('o3-mini'), input: 1.1, output: 4.4 },
  { match: (m) => m.includes('o3'), input: 10.0, output: 40.0 },
  { match: (m) => m.includes('o1-mini'), input: 1.1, output: 4.4 },
  { match: (m) => m.includes('o1'), input: 15.0, output: 60.0 },
  { match: (m) => m.includes('claude-3-5-sonnet') || m.includes('claude-sonnet-4'), input: 3.0, output: 15.0 },
  { match: (m) => m.includes('claude-3-opus') || m.includes('claude-opus'), input: 15.0, output: 75.0 },
  { match: (m) => m.includes('claude-3-haiku') || m.includes('claude-haiku'), input: 0.25, output: 1.25 },
  { match: (m) => m.includes('gemini-2.5-flash') || m.includes('gemini-2-flash'), input: 0.075, output: 0.3 },
  { match: (m) => m.includes('gemini-2.5-pro') || m.includes('gemini-2-pro'), input: 1.25, output: 5.0 },
  { match: (m) => m.includes('gemini-1.5-flash'), input: 0.075, output: 0.3 },
  { match: (m) => m.includes('gemini-1.5-pro'), input: 1.25, output: 5.0 },
  { match: (m) => m.includes('gemini'), input: 0.5, output: 1.5 }
];

const DEFAULT_INPUT_PER_M = 2.5;
const DEFAULT_OUTPUT_PER_M = 10.0;

export function normalizeModelName(model: string): string {
  return model
    .toLowerCase()
    .replace(/^(azure|aws|gcp|google)\//, '')
    .trim();
}

export function estimateCostUsd(model: string, promptTokens: number, completionTokens: number): number {
  const m = normalizeModelName(model);
  let inputCostPerMil = DEFAULT_INPUT_PER_M;
  let outputCostPerMil = DEFAULT_OUTPUT_PER_M;

  for (const tier of PRICING_PER_MILLION) {
    if (tier.match(m)) {
      inputCostPerMil = tier.input;
      outputCostPerMil = tier.output;
      break;
    }
  }

  return (promptTokens / 1_000_000) * inputCostPerMil + (completionTokens / 1_000_000) * outputCostPerMil;
}
