import * as fs from 'fs';
import * as path from 'path';
import { LLMClient, LLMMessage } from '../core/LLMClient';
import { CodegenContext } from '../core/CodegenContext';
import { CodegenFailureMemory } from '../core/codegen/CodegenFailureMemory';
import { RepoKnowledgeGraph } from '../core/knowledge/RepoKnowledgeGraph';
import { CodegenTools, CodegenToolCall } from '../core/knowledge/CodegenTools';
import {
  CodegenArchitecture,
  resolveCodegenArchitecture,
} from '../core/knowledge/RepoArchitectureDetect';
import { PromptLoader } from '../core/PromptLoader';
import { Logger } from '../utils/Logger';
import {
  inferSitePageFromUrl,
  isInventedFlatPageName,
  isInventedFlatPagePath,
} from '../core/codegen/SitePageNaming';
import { filterActHistoryForCodegen } from '../core/codegen/ActHistoryCodegenFilter';
import { GeneratedFile, CodegenResult } from './CodegenAgent';

type HistoryStep = {
  action: string;
  selector?: string;
  value?: string;
  url?: string;
  description: string;
};

const MAX_ROUNDS = 10;
const MAX_FILE_CHARS = 24_000;

function extractJson(text: string): string {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```$/m, '').trim();
  }
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) return cleaned.slice(start, end + 1);
  return cleaned;
}

function normalizeRepoPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

function sanitizeWrittenFiles(files: GeneratedFile[], urls: string[], architecture: CodegenArchitecture): GeneratedFile[] {
  const primaryUrl = urls.find(Boolean);
  const inferred = primaryUrl ? inferSitePageFromUrl(primaryUrl) : null;

  return files
    .map((file) => {
      let filePath = normalizeRepoPath(file.path);
      const base = path.basename(filePath, '.ts');

      if (architecture !== 'flat' && (isInventedFlatPagePath(filePath) || isInventedFlatPageName(base))) {
        if (inferred) {
          Logger.warn(`[RepoEditCodegen] Rewriting invented ${filePath} → ${inferred.pagePath}`);
          filePath = inferred.pagePath;
          file.content = file.content.replace(
            new RegExp(`\\bclass\\s+${base}\\b`, 'g'),
            `class ${inferred.className}`
          );
          file.content = file.content.replace(new RegExp(`\\b${base}\\b`, 'g'), inferred.className);
        }
      }

      return { path: filePath, content: file.content };
    })
    .filter((file) => {
      if (architecture !== 'flat' && isInventedFlatPagePath(file.path)) {
        Logger.warn(`[RepoEditCodegen] Rejecting invented flat page: ${file.path}`);
        return false;
      }
      return true;
    });
}

/**
 * Coding-agent codegen: tool loop over WebPilot knowledge graph + repo files.
 */
export class RepoEditCodegenAgent {
  private llm: LLMClient;
  private tools: CodegenTools;
  private written: GeneratedFile[] = [];
  private lastSummary = '';
  private lastFixReport?: string;

  constructor(llm: LLMClient, tools?: CodegenTools) {
    this.llm =
      llm instanceof LLMClient
        ? new LLMClient({ maxTokens: 16000 })
        : new LLMClient({ maxTokens: 16000 });
    this.tools = tools ?? new CodegenTools();
  }

  public async generateCode(
    testName: string,
    history: HistoryStep[],
    architecture: CodegenArchitecture,
    _symbolGraphContext?: string,
    fallbackReason?: string
  ): Promise<CodegenResult> {
    const filtered = filterActHistoryForCodegen(
      history.map((h, i) => ({
        index: i + 1,
        action: h.action,
        selector: h.selector ?? null,
        value: h.value ?? null,
        url: h.url ?? null,
        description: h.description,
      }))
    );

    const urls = [...new Set(filtered.steps.map((s) => s.url).filter(Boolean) as string[])];
    const detection = resolveCodegenArchitecture({ override: architecture });
    const arch = detection.architecture;

    try {
      const graph = RepoKnowledgeGraph.load() ?? RepoKnowledgeGraph.refresh();
      this.tools.refreshGraph(graph);
    } catch {
      this.tools.refreshGraph();
    }

    const priorFailures = CodegenFailureMemory.toPromptBlock(testName);
    const failureContext = [fallbackReason, priorFailures].filter(Boolean).join('\n\n');
    const archResult = this.tools.detectArchitecture(arch);
    const pageIndex = this.tools.listPages().text;
    const seedReads = this.seedReadFiles(urls, arch);
    const historyText = filtered.steps
      .map(
        (h, i) =>
          `${i + 1}. [${h.action}] selector="${h.selector || 'none'}" value="${h.value || 'none'}" url="${h.url || ''}" — ${h.description}`
      )
      .join('\n');

    const systemPrompt = PromptLoader.loadWithVars('codegen/repo-edit-system.md', {
      framework_context: CodegenContext.buildFullPromptContext(
        undefined,
        CodegenContext.knowledgeForEdit()
      ),
    });

    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: [
          `Test: ${testName}`,
          `Architecture: ${arch} (frameworkPattern=${detection.frameworkPattern}, confidence=${detection.confidence})`,
          `Architecture signals:\n${archResult.text}`,
          filtered.dropped
            ? `Filtered ${filtered.dropped} non-Playwright ActHistory step(s) before codegen.`
            : '',
          '',
          '## Existing page objects (knowledge graph)',
          pageIndex,
          '',
          '## Pre-read files',
          seedReads || '(none matched yet — use kg_find_page / read_file)',
          '',
          '## ActHistory (Playwright-relevant only)',
          historyText || '(empty after filter)',
          failureContext ? `\n## Prior Playwright / validation failure\n${failureContext}\n` : '',
          '',
          'Respond with ONE JSON action object only.',
        ]
          .filter(Boolean)
          .join('\n'),
      },
    ];

    Logger.info(
      `[RepoEditCodegen] Tool loop (arch=${arch}, filter dropped ${filtered.dropped}, ${MAX_ROUNDS} rounds max)`
    );

    for (let round = 1; round <= MAX_ROUNDS; round++) {
      const response = await this.llm.complete(messages);
      let parsed: CodegenToolCall;
      try {
        parsed = JSON.parse(extractJson(response.text)) as CodegenToolCall;
      } catch {
        messages.push({ role: 'assistant', content: response.text });
        messages.push({
          role: 'user',
          content:
            'Parse error. Reply with a single JSON object using tools: ' +
            'kg_search|kg_find_page|kg_find_method|list_pages|list_dir|read_file|get_compact_steps|' +
            'detect_architecture|write_files|apply_patch|run_tests|done.',
        });
        continue;
      }

      messages.push({ role: 'assistant', content: JSON.stringify(parsed) });

      if (parsed.action === 'write_files') {
        const files = sanitizeWrittenFiles(
          (parsed.files || []).map((f) => ({ path: f.path, content: f.content })),
          urls,
          arch
        );
        if (!files.length) {
          messages.push({
            role: 'user',
            content:
              arch === 'flat'
                ? 'TOOL RESULT write_files: no valid files. Emit a flat spec under packages/test-framework/tests/.'
                : 'TOOL RESULT write_files: no valid files (invented Www* flat pages are rejected). Reuse pages/<site>/ then write_files again.',
          });
          continue;
        }
        const result = await this.tools.execute({ action: 'write_files', files });
        this.written = files;
        this.lastSummary = parsed.summary || `Wrote ${files.length} file(s) via RepoEditCodegen`;
        this.lastFixReport = parsed.fixReport;
        messages.push({
          role: 'user',
          content: `TOOL RESULT write_files: ${result.text}. If done, respond {"action":"done","summary":"..."}.`,
        });
        continue;
      }

      if (parsed.action === 'done') {
        this.lastSummary = parsed.summary || this.lastSummary || 'RepoEditCodegen complete';
        this.lastFixReport = parsed.fixReport || this.lastFixReport;
        break;
      }

      // Bind slug for history/tests tools when omitted
      if (
        (parsed.action === 'get_compact_steps' || parsed.action === 'run_tests') &&
        !parsed.slug
      ) {
        parsed.slug = testName;
      }

      const result = await this.tools.execute(parsed);
      const body =
        parsed.action === 'read_file' && result.ok
          ? `TOOL RESULT read_file ${parsed.path}:\n\`\`\`ts\n${String(result.text).slice(0, MAX_FILE_CHARS)}\n\`\`\``
          : `TOOL RESULT ${parsed.action}:\n${result.text}`;
      messages.push({ role: 'user', content: body });
    }

    if (!this.written.length) {
      Logger.warn('[RepoEditCodegen] No write_files — falling back to minimal scaffold');
      return this.minimalFallback(testName, filtered.steps, urls, arch);
    }

    return {
      files: this.written,
      summary: this.lastSummary,
      fixReport: this.lastFixReport,
    };
  }

  private seedReadFiles(urls: string[], architecture: CodegenArchitecture): string {
    if (architecture === 'flat') {
      const testsDir = path.join(process.cwd(), 'packages/test-framework/tests');
      if (!fs.existsSync(testsDir)) return '';
      const chunks: string[] = [];
      for (const name of fs.readdirSync(testsDir).filter((n) => n.endsWith('.spec.ts')).slice(0, 4)) {
        const rel = `packages/test-framework/tests/${name}`;
        let content = fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
        if (content.length > 8_000) content = content.slice(0, 8_000) + '\n/* truncated */\n';
        chunks.push(`### ${rel}\n\`\`\`ts\n${content}\n\`\`\``);
      }
      return chunks.join('\n\n');
    }

    const chunks: string[] = [];
    const candidates = new Set<string>();
    for (const url of urls) {
      const pageHit = this.tools.kgFindPage(url);
      if (pageHit.data && Array.isArray(pageHit.data)) {
        for (const node of pageHit.data as Array<{ filePath?: string }>) {
          if (node.filePath) candidates.add(normalizeRepoPath(node.filePath));
        }
      }
      const inferred = inferSitePageFromUrl(url);
      candidates.add(inferred.pagePath);
      const dir = path.join(process.cwd(), 'packages/test-framework/pages', inferred.siteFolder);
      if (fs.existsSync(dir)) {
        for (const name of fs.readdirSync(dir).filter((n) => n.endsWith('.ts')).slice(0, 6)) {
          candidates.add(path.posix.join('packages/test-framework/pages', inferred.siteFolder, name));
        }
      }
    }

    for (const rel of [...candidates].slice(0, 8)) {
      const full = path.join(process.cwd(), rel);
      if (!fs.existsSync(full)) continue;
      let content = fs.readFileSync(full, 'utf8');
      if (content.length > 8_000) content = content.slice(0, 8_000) + '\n/* truncated */\n';
      chunks.push(`### ${rel}\n\`\`\`ts\n${content}\n\`\`\``);
    }
    return chunks.join('\n\n');
  }

  private minimalFallback(
    testName: string,
    steps: { action: string; url?: string | null; description: string }[],
    urls: string[],
    architecture: CodegenArchitecture
  ): CodegenResult {
    const url = urls[0] || 'https://example.com/';
    const slug = testName.replace(/\s+/g, '_').toLowerCase();

    if (architecture === 'flat') {
      const specContent = `import { test, expect } from '@playwright/test';

test.describe('${testName}', () => {
  test('${testName}', async ({ page }) => {
    await page.goto('${url.replace(/'/g, "\\'")}');
  });
});
`;
      return {
        files: [{ path: `packages/test-framework/tests/${slug}.spec.ts`, content: specContent }],
        summary: `Minimal flat spec scaffold for ${testName} (RepoEdit wrote nothing).`,
      };
    }

    const inferred = inferSitePageFromUrl(url);
    const pageContent = `import { Page } from '@playwright/test';
import { BasePage } from '../../core/BasePage';

/**
 * @urlPattern ${inferred.siteFolder}
 */
export class ${inferred.className} extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  async goto(): Promise<void> {
    await this.page.goto('${url.replace(/'/g, "\\'")}');
  }
}
`;
    const nav = steps.find((s) => /navigate|goto/i.test(s.action));
    const specContent = `import { test } from '@playwright/test';
import { ${inferred.className} } from '../pages/${inferred.siteFolder}/${inferred.className}';

test.describe('${testName}', () => {
  test('${testName}', async ({ page }) => {
    const pom = new ${inferred.className}(page);
    await pom.goto();${nav ? '' : ''}
  });
});
`;
    return {
      files: [
        { path: inferred.pagePath, content: pageContent },
        { path: `packages/test-framework/tests/${slug}.spec.ts`, content: specContent },
      ],
      summary: `Minimal site-folder scaffold for ${inferred.className} (RepoEdit wrote nothing).`,
    };
  }
}
