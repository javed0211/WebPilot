import { LLMClient, LLMMessage } from '../core/LLMClient';
import { PageState } from '../core/BrowserManager';
import { PlannedStep } from './PlannerAgent';

export interface ExecutedAction {
  action: 'click' | 'input' | 'select' | 'navigate' | 'wait' | 'done' | 'fail';
  targetSelector?: string;
  targetElementId?: number;
  value?: string;
  url?: string;
  reasoning: string;
}

export class ExecutionAgent {
  private llm: LLMClient;

  constructor(llm: LLMClient) {
    this.llm = llm;
  }

  /**
   * Decides the next atomic browser action based on current state and objective
   */
  public async decideAction(
    step: PlannedStep,
    state: PageState,
    previousActions: string[]
  ): Promise<ExecutedAction> {
    const systemPrompt = `You are the WebPilot Execution Agent, driving a headless browser.
Your current objective is to execute the logical test step: "${step.description}".
You are provided with:
1. Current Page URL: ${state.url}
2. Page Title: ${state.title}
3. A list of interactive elements on the page with their tag, text, and unique temporary IDs.
4. History of actions taken so far in this session.

You must examine the element tree, decide what exact action to take next, and return ONLY a valid raw JSON object. Do not include markdown code block formatting (like \`\`\`json). Just return raw JSON.

Output JSON Structure:
{
  "action": "click" | "input" | "select" | "navigate" | "wait" | "done" | "fail",
  "targetElementId": number (match the "id" from the element tree),
  "value": "string (required if action is 'input' or 'select')",
  "url": "string (required if action is 'navigate')",
  "reasoning": "Short explanation of why you chose this action and which element"
}

Rules:
1. If the logical objective is fully completed (e.g. you've filled credentials and submitted, or verified the dashboard is open), return action "done".
2. If you see the element you need, choose its ID.
3. If the element you need is not visible or you cannot find it, return action "wait" to let content load, or action "fail" with your reasoning if you're stuck.
4. For password inputs, check placeholders or types carefully.`;

    const elementsTreeText = state.elements
      .map(el => `ID: ${el.id} | Tag: <${el.tagName}> | Text: "${el.text}" | Plh: "${el.placeholder}" | Aria: "${el.ariaLabel}"`)
      .join('\n');

    const userPrompt = `Current Objective: "${step.description}"
Expected Outcome: "${step.expectedOutcome}"

Action History:
${previousActions.length > 0 ? previousActions.join('\n') : 'No actions taken yet.'}

Discovered Elements:
${elementsTreeText || 'No interactive elements discovered on page.'}

What is the next best action?`;

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
      
      const decidedAction: ExecutedAction = JSON.parse(cleanedText);

      // Map the targetElementId back to the actual selector
      if (decidedAction.targetElementId) {
        const matchingEl = state.elements.find(el => el.id === decidedAction.targetElementId);
        if (matchingEl) {
          decidedAction.targetSelector = matchingEl.selector;
        }
      }

      return decidedAction;
    } catch (error) {
      console.error('[Execution Error] Failed to parse action. LLM output:', response.text);
      return {
        action: 'fail',
        reasoning: `AI execution response could not be parsed as action JSON: ${response.text}`
      };
    }
  }
}
