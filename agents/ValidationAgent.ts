import { LLMClient, LLMMessage } from '../core/LLMClient';
import { PageState } from '../core/BrowserManager';
import { PlannedStep } from './PlannerAgent';

export interface ValidationResult {
  passed: boolean;
  reasoning: string;
}

export class ValidationAgent {
  private llm: LLMClient;

  constructor(llm: LLMClient) {
    this.llm = llm;
  }

  /**
   * Evaluates if the current page state matches the assert step's expected outcome
   */
  public async validate(
    step: PlannedStep,
    state: PageState,
    visibleText: string
  ): Promise<ValidationResult> {
    const systemPrompt = `You are the WebPilot Validation Agent.
Your role is to act as a Quality Engineer and verify if the assertion objective: "${step.originalText}" is currently true.
You are given the:
1. Current Page URL: ${state.url}
2. Page Title: ${state.title}
3. Cleaned visible text of the page
4. List of interactive elements

You must decide whether the validation PASSED or FAILED and return ONLY a valid raw JSON object. Do not include markdown code block formatting.

Output JSON Structure:
{
  "passed": true | false,
  "reasoning": "Clear description of what was verified and why it passed or failed (mentioning visible texts or buttons found)."
}`;

    const userPrompt = `Assertion Step: "${step.description}"
Expected Outcome: "${step.expectedOutcome}"

Visible Text Snippet:
"""
${visibleText.slice(0, 5000)}
"""

List of elements:
${state.elements.slice(0, 50).map(el => `ID: ${el.id} | Tag: <${el.tagName}> | Text: "${el.text}" | Selector: "${el.selector}" | Aria: "${el.ariaLabel}" | Plh: "${el.placeholder}"`).join('\n')}

Verify if the assertion passed or failed.`;

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

      const result: ValidationResult = JSON.parse(cleanedText);
      return result;
    } catch (error) {
      console.error('[Validation Error] Failed to parse validation result. LLM output:', response.text);
      return {
        passed: false,
        reasoning: `AI Validation output format invalid: ${response.text}`
      };
    }
  }
}
