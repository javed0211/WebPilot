import { LLMClient, LLMMessage } from '../core/LLMClient';
import { CodegenContext } from '../core/CodegenContext';
import { CodegenFailureMemory } from '../core/codegen/CodegenFailureMemory';
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
   * Generates Playwright POM + spec from execution history, respecting framework conventions.
   */
  public async generateCode(
    testName: string,
    history: { action: string; selector?: string; value?: string; url?: string; description: string }[],
    architecture: 'flat' | 'pom' | 'bdd' | 'pom-bdd',
    symbolGraphContext?: string,
    fallbackReason?: string
  ): Promise<CodegenResult> {
    // Refresh + inject knowledge graph before every generate/repair edit.
    const frameworkContext = CodegenContext.buildFullPromptContext(
      symbolGraphContext,
      CodegenContext.knowledgeForEdit()
    );
    const priorFailures = CodegenFailureMemory.toPromptBlock(testName);
    const failureContext = [fallbackReason, priorFailures].filter(Boolean).join('\n\n');

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
      fallback_reason: failureContext
        ? `\nPlaywright previously failed with this error. You MUST fix it and output a fixReport.\nPrefer REUSING pages under packages/test-framework/pages/<site>/ (e.g. wikipedia/) — never invent Www* / En*org* duplicate page classes.\nError:\n${failureContext}\n`
        : '',
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
            path: `packages/test-framework/tests/${safeTestName}.spec.ts`,
            content: `import { test, expect } from '@playwright/test';\n\ntest('${testName}', async ({ page }) => {\n  // Fallback — codegen parse failed\n});`,
          },
        ],
        summary: 'Codegen parse failed; minimal flat spec written.',
      };
    }
  }
}
