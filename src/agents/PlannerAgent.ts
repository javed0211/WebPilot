import { LLMClient, LLMMessage } from '../core/LLMClient';

export interface PlannedStep {
  index: number;
  originalText: string;
  actionType: 'navigate' | 'input' | 'click' | 'select' | 'assert' | 'custom';
  description: string;
  expectedOutcome: string;
}

export class PlannerAgent {
  private llm: LLMClient;

  constructor(llm: LLMClient) {
    this.llm = llm;
  }

  /**
   * Translates unstructured user steps into a sequential structured plan
   */
  public async plan(testContent: string): Promise<PlannedStep[]> {
    const systemPrompt = `You are the Lead Test Planner Agent for WebPilot.
Your job is to read natural language test scripts and translate them into a structured, sequential JSON array of atomic test steps.

Each step MUST fit into one of these action types:
- 'navigate': Go to a specific URL or base URL.
- 'input': Type text into a field (inputs, textareas).
- 'click': Click a button, link, checkbox, or option.
- 'select': Select from a dropdown.
- 'assert': Verify that some text, title, or element is present/visible.
- 'custom': Complex actions requiring planning.

Output ONLY a raw valid JSON array. Do not include markdown code block formatting (like \`\`\`json). Just return the raw JSON content.

Example Output Structure:
[
  {
    "index": 1,
    "originalText": "Open login page",
    "actionType": "navigate",
    "description": "Navigate to the application login page",
    "expectedOutcome": "Login page is loaded and input forms are visible"
  },
  {
    "index": 2,
    "originalText": "Login using valid credentials",
    "actionType": "input",
    "description": "Enter username and password into credentials fields, then click sign in",
    "expectedOutcome": "Credentials submitted"
  }
]`;

    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Here is the test content to plan:\n\n${testContent}` }
    ];

    const response = await this.llm.complete(messages);
    
    try {
      // Clean possible JSON fence wrappers safely
      let cleanedText = response.text.trim();
      if (cleanedText.startsWith('```')) {
        cleanedText = cleanedText.replace(/^```json\s*/, '').replace(/```$/, '');
      }
      cleanedText = cleanedText.trim();
      
      const plannedSteps: PlannedStep[] = JSON.parse(cleanedText);
      return plannedSteps;
    } catch (error) {
      console.error('[Planner Error] Failed to parse planned steps as JSON. LLM returned:', response.text);
      // Return a basic fallback step so execution doesn't crash completely
      return [
        {
          index: 1,
          originalText: testContent,
          actionType: 'custom',
          description: `Execute entire instruction: ${testContent}`,
          expectedOutcome: 'Execution completes'
        }
      ];
    }
  }
}
