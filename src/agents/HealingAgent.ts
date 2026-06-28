import { LLMClient, LLMMessage } from '../core/LLMClient';
import { PageState } from '../core/BrowserManager';
import * as fs from 'fs';
import * as path from 'path';
import { HEALING_PROPOSALS_DIR } from '../core/ProjectPaths';
import { SelectorCandidate } from '../core/selectors/SelectorCandidate';
import { SelectorRanker } from '../core/selectors/SelectorRanker';
import { SelectorRegistry } from '../core/selectors/SelectorRegistry';

export interface HealingResult {
  healedSelector: string;
  confidence: number;
  reasoning: string;
  proposalPath?: string;
  candidates?: SelectorCandidate[];
}

export interface HealingProposal {
  version: string;
  createdAt: string;
  url: string;
  title: string;
  actionType: string;
  oldSelector: string;
  newSelector: string;
  confidence: number;
  reasoning: string;
  candidates: SelectorCandidate[];
  apply: {
    instructions: string;
  };
}

export class HealingAgent {
  private llm: LLMClient;
  private cachePath: string;

  constructor(llm: LLMClient, cachePath?: string) {
    this.llm = llm;
    this.cachePath = cachePath ?? path.join(process.cwd(), 'runtime', 'healing-cache', 'cache.json');
    
    // Ensure cache directory exists
    const dir = path.dirname(this.cachePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Loads a selector override from the local healing cache if available
   */
  public getFromCache(brokenSelector: string): string | null {
    if (!fs.existsSync(this.cachePath)) return null;
    try {
      const cache = JSON.parse(fs.readFileSync(this.cachePath, 'utf8'));
      return cache[brokenSelector] || null;
    } catch {
      return null;
    }
  }

  /**
   * Persists a newly healed selector to the cache file
   */
  public saveToCache(brokenSelector: string, healedSelector: string): void {
    let cache: Record<string, string> = {};
    if (fs.existsSync(this.cachePath)) {
      try {
        cache = JSON.parse(fs.readFileSync(this.cachePath, 'utf8'));
      } catch {
        cache = {};
      }
    }
    cache[brokenSelector] = healedSelector;
    fs.writeFileSync(this.cachePath, JSON.stringify(cache, null, 2), 'utf8');
  }

  private candidatesFromState(state: PageState): SelectorCandidate[] {
    const candidates: SelectorCandidate[] = [];
    for (const element of state.elements) {
      for (const candidate of element.selectorCandidates || []) {
        candidates.push(
          SelectorRanker.candidate(
            candidate.kind as SelectorCandidate['kind'],
            candidate.value,
            candidate.expression
          )
        );
      }
      if (element.selector) {
        candidates.push(SelectorRanker.candidate('css', element.selector));
      }
    }
    const ranked = SelectorRanker.rank(candidates);
    return ranked ? [ranked.primary, ...ranked.fallbacks] : candidates;
  }

  private saveProposal(
    brokenSelector: string,
    state: PageState,
    actionType: string,
    result: HealingResult,
    candidates: SelectorCandidate[]
  ): string {
    fs.mkdirSync(HEALING_PROPOSALS_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filePath = path.join(HEALING_PROPOSALS_DIR, `${stamp}.json`);
    const proposal: HealingProposal = {
      version: '1.0.0',
      createdAt: new Date().toISOString(),
      url: state.url,
      title: state.title,
      actionType,
      oldSelector: brokenSelector,
      newSelector: result.healedSelector,
      confidence: result.confidence,
      reasoning: result.reasoning,
      candidates,
      apply: {
        instructions:
          'Review this proposal. Run `webpilot self-heal --apply <proposal.json> --file <target.ts>` to patch a generated test or page object.',
      },
    };
    fs.writeFileSync(filePath, JSON.stringify(proposal, null, 2), 'utf8');
    return filePath;
  }

  /**
   * Inspects current DOM to find the closest element matching the intent of the broken selector
   */
  public async heal(
    brokenSelector: string,
    state: PageState,
    actionType: string
  ): Promise<HealingResult> {
    const selectorCandidates = this.candidatesFromState(state);

    // First check local cache
    const cached = this.getFromCache(brokenSelector);
    if (cached) {
      const result = {
        healedSelector: cached,
        confidence: 1.0,
        reasoning: 'Loaded from local self-healing cache',
        candidates: selectorCandidates,
      };
      const proposalPath = this.saveProposal(brokenSelector, state, actionType, result, selectorCandidates);
      return {
        ...result,
        proposalPath,
      };
    }

    const systemPrompt = `You are the WebPilot Self-Healing Agent.
A test runner encountered a Timeout/NoSuchElement error when trying to perform a "${actionType}" action using the selector: "${brokenSelector}".
The page DOM has changed. Your job is to look at the list of currently visible interactive elements, find the element that most likely represents what the original selector intended to match, and return its current selector.

Return ONLY a valid raw JSON object. Do not include markdown code block formatting.

Output JSON Structure:
{
  "healedSelector": "string (the exact CSS/Playwright selector of the best matched element)",
  "confidence": number (from 0.0 to 1.0 representing your confidence level)",
  "reasoning": "Detailed justification of why this is the correct healed element"
}`;

    const elementsTreeText = state.elements
      .map(el => {
        const candidates = (el.selectorCandidates || [])
          .map(candidate => `${candidate.expression}`)
          .join(' | ');
        return `Tag: <${el.tagName}> | Text: "${el.text}" | Plh: "${el.placeholder}" | Selector: "${el.selector}" | Candidates: ${candidates}`;
      })
      .join('\n');

    const userPrompt = `Failed Selector: "${brokenSelector}"
Action Type: "${actionType}"
Current Page Title: "${state.title}"
Current Page URL: "${state.url}"

Currently Discovered Elements:
${elementsTreeText || 'No elements found.'}

Identify the best element and return its selector.`;

    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    const response = await this.llm.complete(messages);

    try {
      let cleanedText = response.text.trim();
      if (cleanedText.startsWith('```')) {
        cleanedText = cleanedText.replace(/^```json\s*/, '').replace(/```$/, '');
      }
      cleanedText = cleanedText.trim();

      const result: HealingResult = JSON.parse(cleanedText);
      result.candidates = selectorCandidates;
      const proposalPath = this.saveProposal(brokenSelector, state, actionType, result, selectorCandidates);
      result.proposalPath = proposalPath;
      
      // Save it to cache for subsequent execution speed-ups
      if (result.confidence >= 0.6) {
        this.saveToCache(brokenSelector, result.healedSelector);
        SelectorRegistry.recordFailure(state.url, actionType);
      }

      return result;
    } catch (error) {
      console.error('[Healing Error] Failed to parse healing result. LLM output:', response.text);
      return {
        healedSelector: brokenSelector, // Fallback to original
        confidence: 0.0,
        reasoning: `AI Healing output could not be parsed: ${response.text}`,
        candidates: selectorCandidates,
      };
    }
  }
}
