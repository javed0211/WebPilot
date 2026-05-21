import { LLMClient, LLMMessage } from '../core/LLMClient';
import { PageState } from '../core/BrowserManager';
import * as fs from 'fs';
import * as path from 'path';

export interface HealingResult {
  healedSelector: string;
  confidence: number;
  reasoning: string;
}

export class HealingAgent {
  private llm: LLMClient;
  private cachePath: string;

  constructor(llm: LLMClient, cachePath?: string) {
    this.llm = llm;
    this.cachePath = cachePath ?? path.join(process.cwd(), '.healing-cache', 'cache.json');
    
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

  /**
   * Inspects current DOM to find the closest element matching the intent of the broken selector
   */
  public async heal(
    brokenSelector: string,
    state: PageState,
    actionType: string
  ): Promise<HealingResult> {
    // First check local cache
    const cached = this.getFromCache(brokenSelector);
    if (cached) {
      return {
        healedSelector: cached,
        confidence: 1.0,
        reasoning: 'Loaded from local self-healing cache'
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
      .map(el => `Tag: <${el.tagName}> | Text: "${el.text}" | Plh: "${el.placeholder}" | Selector: "${el.selector}"`)
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
      
      // Save it to cache for subsequent execution speed-ups
      if (result.confidence >= 0.6) {
        this.saveToCache(brokenSelector, result.healedSelector);
      }

      return result;
    } catch (error) {
      console.error('[Healing Error] Failed to parse healing result. LLM output:', response.text);
      return {
        healedSelector: brokenSelector, // Fallback to original
        confidence: 0.0,
        reasoning: `AI Healing output could not be parsed: ${response.text}`
      };
    }
  }
}
