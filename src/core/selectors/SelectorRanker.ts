import { SelectorCandidate, SelectorCandidateKind, RankedSelectorSet } from './SelectorCandidate';

const KIND_BASE_SCORE: Record<SelectorCandidateKind, number> = {
  role: 0.9,
  label: 0.86,
  placeholder: 0.82,
  testid: 0.8,
  text: 0.68,
  css: 0.5,
  xpath: 0.25,
  unknown: 0.2,
};

const SEMANTIC_ATTRS = [
  'aria-label',
  'aria-labelledby',
  'data-testid',
  'data-test',
  'data-qa',
  'name',
  'placeholder',
];

function clampScore(score: number): number {
  return Math.max(0, Math.min(0.99, Number(score.toFixed(2))));
}

function expressionFor(kind: SelectorCandidateKind, value: string): string {
  const escaped = value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  if (kind === 'role') {
    const match = value.match(/^([^[]+)(?:\[name='([^']+)'\])?$/);
    if (match?.[2]) return `page.getByRole('${match[1]}', { name: '${match[2].replace(/'/g, "\\'")}' })`;
    return `page.getByRole('${escaped}')`;
  }
  if (kind === 'label') return `page.getByLabel('${escaped}')`;
  if (kind === 'placeholder') return `page.getByPlaceholder('${escaped}')`;
  if (kind === 'testid') return `page.getByTestId('${escaped}')`;
  if (kind === 'text') return `page.getByText('${escaped}')`;
  return `page.locator('${escaped}')`;
}

function cssRisks(value: string): string[] {
  const risks: string[] = [];
  if (/nth-child|nth-of-type|:nth|>\s*[^>]+>/.test(value)) risks.push('structural-css');
  if (/\.[a-z0-9_-]{16,}/i.test(value)) risks.push('generated-class');
  if (!SEMANTIC_ATTRS.some((attr) => value.includes(attr))) risks.push('non-semantic-css');
  return risks;
}

export class SelectorRanker {
  public static candidate(kind: SelectorCandidateKind, value: string, expression?: string): SelectorCandidate {
    const signals: string[] = [];
    const risks: string[] = [];
    let score = KIND_BASE_SCORE[kind];

    if (['role', 'label', 'placeholder', 'testid'].includes(kind)) {
      signals.push('semantic');
    }
    if (kind === 'role' && /\[name='[^']+'\]/.test(value)) {
      signals.push('accessible-name');
      score += 0.04;
      const nameMatch = value.match(/\[name='([^']+)'\]/);
      const accessibleName = nameMatch?.[1] || '';
      // Tooltip / shortcut labels are brittle (Wikipedia "Past revisions... [ctrl-option-h]").
      if (accessibleName.length > 40 || /\[ctrl|\[alt|\[shift|\[cmd/i.test(accessibleName)) {
        risks.push('tooltip-or-shortcut-name');
        score -= 0.25;
      }
    }
    if (kind === 'testid') {
      signals.push('stable-attribute');
    }
    if (kind === 'text') {
      signals.push('visible-text');
      if (value.length > 60) risks.push('long-text');
    }
    if (kind === 'css') {
      const cssSelectorRisks = cssRisks(value);
      risks.push(...cssSelectorRisks);
      if (cssSelectorRisks.length === 0) {
        signals.push('semantic-css');
        score += 0.12;
      } else {
        score -= cssSelectorRisks.length * 0.08;
      }
    }
    if (kind === 'xpath') risks.push('xpath-last-resort');
    if (kind === 'unknown') risks.push('unclassified');

    if (value) signals.push('observed');

    return {
      kind,
      value,
      frameworkExpression: expression || expressionFor(kind, value),
      confidence: clampScore(score),
      signals: [...new Set(signals)],
      risks: [...new Set(risks)],
      createdAt: new Date().toISOString(),
    };
  }

  public static rank(candidates: SelectorCandidate[]): RankedSelectorSet | null {
    const unique = new Map<string, SelectorCandidate>();
    for (const candidate of candidates) {
      unique.set(candidate.frameworkExpression, candidate);
    }

    const ranked = [...unique.values()].sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      return KIND_BASE_SCORE[b.kind] - KIND_BASE_SCORE[a.kind];
    });

    const primary = ranked[0];
    if (!primary) return null;
    return {
      primary,
      fallbacks: ranked.slice(1, 4),
    };
  }
}
