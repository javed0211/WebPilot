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
  'id',
];

function clampScore(score: number): number {
  return Math.max(0, Math.min(0.99, Number(score.toFixed(2))));
}

function expressionFor(kind: SelectorCandidateKind, value: string): string {
  const escaped = value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  if (kind === 'role') {
    const match = value.match(/^([^[]+)(?:\[name='([^']+)'\])?$/);
    if (match?.[2]) {
      const name = match[2].replace(/'/g, "\\'");
      // Exact match for path-like names (e.g. microsoft/playwright) to avoid prefix collisions.
      const exact = /[/.]/.test(match[2]) ? ', exact: true' : '';
      return `page.getByRole('${match[1]}', { name: '${name}'${exact} })`;
    }
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
      // Repo/app underlinenav tabs: id + exact href beat ambiguous short role names
      // (e.g. GitHub "Security" matches both tab "Security and quality" and footer).
      if (/\[[\s]*id\s*=/.test(value) || /#-?[\w-]+-tab\b/i.test(value) || /-tab["\]]/.test(value)) {
        signals.push('stable-tab-id');
        score += 0.28;
      }
      if (/\[[\s]*href\s*=\s*["'][^"'*]+["']\s*\]/.test(value)) {
        signals.push('exact-href');
        score += 0.22;
      }
    }
    if (kind === 'role' && /\[name='[^']+'\]/.test(value)) {
      const nameMatch = value.match(/\[name='([^']+)'\]/);
      const accessibleName = nameMatch?.[1] || '';
      // Short generic labels collide with chrome/footer links ("Security", "Code").
      if (/^(security|code|actions|insights|issues|pull requests)$/i.test(accessibleName.trim())) {
        risks.push('ambiguous-short-name');
        score -= 0.18;
      }
      // Prefer compound tab names ("Security and quality") over bare "Security".
      if (accessibleName.trim().split(/\s+/).length >= 2) {
        score += 0.1;
      }
      // GitHub underlinenav often exposes "Issues 149" / "Security and quality 0" —
      // these counter-suffixed names are brittle vs stable tab ids.
      if (/\s+\d+$/.test(accessibleName.trim())) {
        risks.push('counter-suffixed-name');
        score -= 0.22;
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

    // Prefer longer accessible-name role candidates when one name is a prefix of another.
    for (let i = 0; i < ranked.length; i++) {
      const current = ranked[i];
      if (current.kind !== 'role') continue;
      const currentName = current.value.match(/\[name='([^']+)'\]/)?.[1];
      if (!currentName) continue;
      const longer = ranked.find((other) => {
        if (other === current || other.kind !== 'role') return false;
        const otherName = other.value.match(/\[name='([^']+)'\]/)?.[1];
        return Boolean(
          otherName &&
            otherName !== currentName &&
            otherName.toLowerCase().startsWith(currentName.toLowerCase())
        );
      });
      if (longer) {
        const idx = ranked.indexOf(longer);
        ranked.splice(idx, 1);
        ranked.splice(i, 0, longer);
      }
      break;
    }

    const primary = ranked[0];
    if (!primary) return null;
    return {
      primary,
      fallbacks: ranked.slice(1, 4),
    };
  }
}
