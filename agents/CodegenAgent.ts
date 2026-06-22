import { LLMClient, LLMMessage } from '../core/LLMClient';
import { CodegenContext } from '../core/CodegenContext';
import { PromptLoader } from '../core/PromptLoader';

export interface GeneratedFile {
  path: string;
  content: string;
}

export interface CodegenResult {
  files: GeneratedFile[];
  summary: string;
  fixReport?: string;
}

export class CodegenAgent {
  private llm: LLMClient;

  constructor(llm: LLMClient) {
    this.llm = llm;
  }

  /**
   * Generates Playwright Python POM + pytest test from execution history.
   */
  public async generateCode(
    testName: string,
    history: { action: string; selector?: string; value?: string; url?: string; description: string }[],
    architecture: 'flat' | 'pom' | 'bdd' | 'pom-bdd',
    symbolGraphContext?: string,
    fallbackReason?: string
  ): Promise<CodegenResult> {
    const frameworkContext = CodegenContext.buildFullPromptContext(symbolGraphContext);

    const systemPrompt = PromptLoader.loadWithVars('codegen/agent-system.md', {
      framework_context: frameworkContext,
    });

    const historyText = history
      .map(
        (h, i) =>
          `${i + 1}. [${h.action}] selector="${h.selector || 'none'}" value="${h.value || 'none'}" — ${h.description}`
      )
      .join('\n');

    const userPrompt = PromptLoader.loadWithVars('codegen/agent-user.md', {
      test_name: testName,
      architecture,
      execution_history: historyText,
      fallback_reason: fallbackReason ? `\nPlaywright previously failed with this error. You MUST fix it and output a fixReport.\nError:\n${fallbackReason}\n` : '',
    });

    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    const response = await this.llm.complete(messages);

    try {
      let cleanedText = response.text.trim();
      if (cleanedText.startsWith('```')) {
        cleanedText = cleanedText.replace(/^```json\s*/, '').replace(/```$/, '');
      }
      return JSON.parse(cleanedText.trim()) as CodegenResult;
    } catch (error) {
      console.error('[Codegen Error] Failed to parse codegen response. LLM output:', response.text);

      const safeTestName = testName.replace(/\s+/g, '_').toLowerCase();
      return {
        files: [
          {
            path: `framework/tests/test_${safeTestName}.py`,
            content: `from playwright.sync_api import Page\n\n\ndef test_${safeTestName}(page: Page) -> None:\n    # Fallback — codegen parse failed\n    pass\n`,
          },
        ],
        summary: 'Codegen parse failed; minimal pytest Playwright test written.',
      };
    }
  }
}
