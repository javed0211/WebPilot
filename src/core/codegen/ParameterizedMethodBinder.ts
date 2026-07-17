import { MethodInfo } from '../SymbolParser';
import { TraceStep } from './ExecutionTrace';

export interface MethodBinding {
  method: string;
  args: string[];
}

const SECTION_HINTS = /\b(section|heading|see also|references|external links|categories)\b/i;
const ZERO_ARG_ASSERT_HINTS =
  /\b(homepage|home page|loaded|article tab|revision history|talk page|last edited|categories is displayed)\b/i;

/**
 * Pull a human-meaningful subject out of sparse assert/fill/screenshot steps.
 * Browser-use search_page leftovers and NL verify steps often bury the subject
 * in free-text intent when value/selector are empty.
 */
export function extractStepSubject(step: TraceStep): string | undefined {
  if (step.value && !String(step.value).startsWith('__')) {
    return String(step.value).trim().slice(0, 120);
  }
  if (step.semanticTarget) return step.semanticTarget.trim().slice(0, 120);

  // Prefer a single source — concatenating intent+description doubles NL text.
  const blob = (step.description || step.intent || '').trim();
  if (!blob) return undefined;

  // URL asserts are not text subjects.
  if (/\burl\s+contains\b/i.test(blob) || /\bloads?\s+successfully\b/i.test(blob)) {
    return undefined;
  }

  const searched = blob.match(/searched page for\s+["']([^"']+)["']/i);
  if (searched?.[1]) return searched[1].trim().slice(0, 120);

  const quoted = blob.match(/["']([^"']{2,80})["']/);
  if (quoted?.[1] && !/^https?:/i.test(quoted[1])) return quoted[1].trim();

  let text = blob
    .replace(/^(verify|assert|check|ensure)\s+/i, '')
    .replace(/\s+(is|are)\s+(visible|displayed|shown|present|loaded).*$/i, '')
    .replace(/\s+section\s*$/i, '')
    .replace(/^that\s+/i, '')
    .replace(/^the\s+/i, '')
    .replace(/[."']+$/g, '')
    .trim();

  text = text.replace(/^custom\s*\|\s*/i, '').replace(/^assert\s*\|\s*/i, '').trim();
  if (!text || text.length > 120) return undefined;
  if (/^https?:/i.test(text)) return undefined;
  if (/\burl\s+contains\b/i.test(text)) return undefined;
  return text;
}

function methodHasStringParam(method: MethodInfo): boolean {
  if (!method.parameters?.length) return false;
  const first = method.parameters[0];
  const type = (first.type || '').toLowerCase();
  return (
    !type ||
    type.includes('string') ||
    type.includes('regexp') ||
    type === 'any'
  );
}

function pickMethod(
  methods: MethodInfo[],
  names: string[],
  requireParam: boolean
): MethodInfo | undefined {
  for (const name of names) {
    const match = methods.find((m) => m.name === name);
    if (!match) continue;
    if (requireParam && !methodHasStringParam(match)) continue;
    if (!requireParam && match.parameters?.length) continue;
    return match;
  }
  return undefined;
}

/**
 * Bind a trace step to an existing POM method *with arguments* when possible.
 * Prefer role-based reuse (assert → assertSectionVisible/assertTextVisible)
 * over brittle method-name token overlap.
 */
export function bindParameterizedMethod(
  step: TraceStep,
  methods: MethodInfo[]
): MethodBinding | null {
  if (!methods.length) return null;
  const action = (step.action || '').toLowerCase();
  const intent = `${step.intent || ''} ${step.description || ''}`.toLowerCase();
  const subject = extractStepSubject(step);
  const byName = new Map(methods.map((m) => [m.name, m]));

  if (action === 'fill' || action === 'input' || action === 'type') {
    const value = step.value || subject;
    if (!value) return null;
    const search = pickMethod(methods, ['search', 'fillSearch', 'enterSearch'], true);
    if (search) return { method: search.name, args: [value] };
    return null;
  }

  if (action === 'screenshot') {
    const shot = pickMethod(methods, ['screenshotHeading', 'screenshotSection', 'captureSection'], true);
    if (shot) {
      const file =
        subject
          ? `${subject.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'section'}.png`
          : 'codegen-section.png';
      return { method: shot.name, args: [file] };
    }
    return null;
  }

  if (action !== 'assert') return null;

  // URL asserts are handled by AssertionEmitter / toHaveURL — not text POM methods.
  if (String(step.value || '').startsWith('__url_') || /\burl\s+contains\b/i.test(intent)) {
    return null;
  }

  // Prefer dedicated zero-arg asserts when the NL clearly matches them.
  if (/\bcategories\b/i.test(intent) && byName.has('assertCategoriesVisible')) {
    return { method: 'assertCategoriesVisible', args: [] };
  }
  if (/last edited/i.test(intent) && byName.has('assertLastEditedVisible')) {
    return { method: 'assertLastEditedVisible', args: [] };
  }
  if (/\barticle\b/i.test(intent) && !/\bsection\b/i.test(intent) && byName.has('assertArticleTabVisible')) {
    return { method: 'assertArticleTabVisible', args: [] };
  }
  if (/revision history/i.test(intent) && byName.has('assertRevisionHistoryVisible')) {
    return { method: 'assertRevisionHistoryVisible', args: [] };
  }
  if (
    (/\bhomepage\b|\bhome page\b|loads successfully/i.test(intent) || intent.includes('search wikipedia is visible')) &&
    byName.has('assertHomePageLoaded')
  ) {
    return { method: 'assertHomePageLoaded', args: [] };
  }
  if (/assertonarticlepage|on article|article page loaded|from wikipedia/i.test(intent) && byName.has('assertOnArticlePage')) {
    // Broad page-loaded asserts — avoid stealing section-specific verifies.
    if (!SECTION_HINTS.test(intent) || /from wikipedia/i.test(intent)) {
      if (/from wikipedia|article page|assert on article|software testing is displayed/i.test(intent)) {
        return { method: 'assertOnArticlePage', args: [] };
      }
    }
  }
  if (/talk:/i.test(intent) && byName.has('assertOnTalkPage')) {
    return { method: 'assertOnTalkPage', args: [] };
  }
  if (/revision history|history page/i.test(intent) && byName.has('assertOnHistoryPage')) {
    return { method: 'assertOnHistoryPage', args: [] };
  }

  if (!subject) return null;
  if (ZERO_ARG_ASSERT_HINTS.test(intent) && !subject) return null;

  // Section-style subjects → assertSectionVisible(section)
  const looksLikeSection =
    SECTION_HINTS.test(intent) ||
    /^(see also|references|external links|installation|learn|community|more)$/i.test(subject);
  if (looksLikeSection) {
    const section = pickMethod(methods, ['assertSectionVisible', 'assertHeadingVisible', 'scrollToSection'], true);
    if (section) return { method: section.name, args: [subject.replace(/\s+section$/i, '').trim()] };
  }

  // Generic visible text → assertTextVisible(text)
  const textAssert = pickMethod(methods, ['assertTextVisible', 'assertVisibleText', 'verifyTextVisible'], true);
  if (textAssert) return { method: textAssert.name, args: [subject] };

  return null;
}

/** Dedupe key so assertTextVisible('A') and assertTextVisible('B') both emit. */
export function bindingDedupeKey(binding: MethodBinding): string {
  return `${binding.method}(${binding.args.map((a) => a.toLowerCase()).join(',')})`;
}
