import * as fs from 'fs';
import * as path from 'path';
import { LLMClient, LLMMessage } from '../core/LLMClient';
import { CodegenContext } from '../core/CodegenContext';
import { CodegenFailureMemory } from '../core/codegen/CodegenFailureMemory';
import { RepoKnowledgeGraph } from '../core/knowledge/RepoKnowledgeGraph';
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

type AgentAction =
  | { action: 'list_pages' }
  | { action: 'read_file'; path: string }
  | { action: 'list_dir'; path: string }
  | { action: 'write_files'; files: GeneratedFile[]; summary: string; fixReport?: string }
  | { action: 'done'; summary: string; fixReport?: string };

const MAX_ROUNDS = 8;
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

function resolveSafePath(rel: string): string | null {
  const normalized = normalizeRepoPath(rel);
  if (normalized.includes('..') || path.isAbsolute(rel)) return null;
  if (
    !normalized.startsWith('packages/test-framework/') &&
    !normalized.startsWith('resources/')
  ) {
    return null;
  }
  return normalized;
}

function listPageIndex(): string {
  try {
    RepoKnowledgeGraph.refresh();
    const graph = RepoKnowledgeGraph.load();
    if (!graph) return CodegenContext.buildSymbolGraphContext();
    const pages = graph.nodes
      .filter((n) => n.type === 'page')
      .map((n) => {
        const methods = graph.edges
          .filter((e) => e.from === n.id && e.type === 'contains')
          .map((e) => graph.nodes.find((x) => x.id === e.to)?.name)
          .filter(Boolean)
          .slice(0, 20);
        return `- ${n.name} @ ${n.filePath || '?'} methods=[${methods.join(', ')}]`;
      });
    return pages.length ? pages.join('\n') : '(no page objects indexed yet)';
  } catch {
    return CodegenContext.buildSymbolGraphContext();
  }
}

function sanitizeWrittenFiles(files: GeneratedFile[], urls: string[]): GeneratedFile[] {
  const primaryUrl = urls.find(Boolean);
  const inferred = primaryUrl ? inferSitePageFromUrl(primaryUrl) : null;

  return files
    .map((file) => {
      let filePath = normalizeRepoPath(file.path);
      const base = path.basename(filePath, '.ts');

      // Rewrite invented flat Www* into site-folder names.
      if (isInventedFlatPagePath(filePath) || isInventedFlatPageName(base)) {
        if (inferred) {
          Logger.warn(
            `[RepoEditCodegen] Rewriting invented ${filePath} → ${inferred.pagePath}`
          );
          filePath = inferred.pagePath;
          // Best-effort rename class in content
          file.content = file.content.replace(
            new RegExp(`\\bclass\\s+${base}\\b`, 'g'),
            `class ${inferred.className}`
          );
          file.content = file.content.replace(
            new RegExp(`\\b${base}\\b`, 'g'),
            inferred.className
          );
        }
      }

      // Specs importing invented flat pages → prefer site path if we rewrote.
      return { path: filePath, content: file.content };
    })
    .filter((file) => {
      if (isInventedFlatPagePath(file.path)) {
        Logger.warn(`[RepoEditCodegen] Rejecting invented flat page: ${file.path}`);
        return false;
      }
      return true;
    });
}

/**
 * Cursor-style codegen: read real repo files, then surgically write POMs/specs.
 * Replaces one-shot invent that ignored existing page objects.
 */
export class RepoEditCodegenAgent {
  private llm: LLMClient;
  private written: GeneratedFile[] = [];
  private lastSummary = '';
  private lastFixReport?: string;

  constructor(llm: LLMClient) {
    // Surgical edits need larger completions than default chat.
    this.llm =
      llm instanceof LLMClient
        ? new LLMClient({ maxTokens: 16000 })
        : new LLMClient({ maxTokens: 16000 });
  }

  public async generateCode(
    testName: string,
    history: HistoryStep[],
    architecture: 'flat' | 'pom' | 'bdd' | 'pom-bdd',
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

    const urls = [
      ...new Set(filtered.steps.map((s) => s.url).filter(Boolean) as string[]),
    ];
    const pageIndex = listPageIndex();
    const priorFailures = CodegenFailureMemory.toPromptBlock(testName);
    const failureContext = [fallbackReason, priorFailures].filter(Boolean).join('\n\n');

    // Pre-read likely page files (Cursor always starts by reading).
    const seedReads = this.seedReadFiles(urls);
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
          `Architecture: ${architecture}`,
          filtered.dropped
            ? `Filtered ${filtered.dropped} non-Playwright ActHistory step(s) before codegen.`
            : '',
          '',
          '## Existing page objects (repo)',
          pageIndex,
          '',
          '## Pre-read files',
          seedReads || '(none matched yet — use list_pages / read_file)',
          '',
          '## ActHistory (Playwright-relevant only)',
          historyText || '(empty after filter)',
          failureContext
            ? `\n## Prior Playwright / validation failure\n${failureContext}\n`
            : '',
          '',
          'Respond with ONE JSON action object only.',
        ]
          .filter(Boolean)
          .join('\n'),
      },
    ];

    Logger.info(
      `[RepoEditCodegen] Cursor-style edit loop (filter dropped ${filtered.dropped} step(s), ${MAX_ROUNDS} rounds max)`
    );

    for (let round = 1; round <= MAX_ROUNDS; round++) {
      const response = await this.llm.complete(messages);
      let parsed: AgentAction;
      try {
        parsed = JSON.parse(extractJson(response.text)) as AgentAction;
      } catch {
        messages.push({ role: 'assistant', content: response.text });
        messages.push({
          role: 'user',
          content:
            'Parse error. Reply with a single JSON object: {"action":"list_pages"|"read_file"|"list_dir"|"write_files"|"done", ...}',
        });
        continue;
      }

      messages.push({ role: 'assistant', content: JSON.stringify(parsed) });

      if (parsed.action === 'list_pages') {
        const result = listPageIndex();
        messages.push({ role: 'user', content: `TOOL RESULT list_pages:\n${result}` });
        continue;
      }

      if (parsed.action === 'read_file') {
        const safe = resolveSafePath(String(parsed.path || ''));
        if (!safe) {
          messages.push({
            role: 'user',
            content: 'TOOL RESULT read_file: denied — path must be under packages/test-framework/',
          });
          continue;
        }
        const full = path.join(process.cwd(), safe);
        if (!fs.existsSync(full)) {
          messages.push({
            role: 'user',
            content: `TOOL RESULT read_file: missing ${safe}`,
          });
          continue;
        }
        let content = fs.readFileSync(full, 'utf8');
        if (content.length > MAX_FILE_CHARS) {
          content = content.slice(0, MAX_FILE_CHARS) + '\n/* …truncated… */\n';
        }
        messages.push({
          role: 'user',
          content: `TOOL RESULT read_file ${safe}:\n\`\`\`ts\n${content}\n\`\`\``,
        });
        continue;
      }

      if (parsed.action === 'list_dir') {
        const safe = resolveSafePath(String(parsed.path || 'packages/test-framework/pages'));
        if (!safe) {
          messages.push({ role: 'user', content: 'TOOL RESULT list_dir: denied' });
          continue;
        }
        const full = path.join(process.cwd(), safe);
        if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) {
          messages.push({ role: 'user', content: `TOOL RESULT list_dir: missing ${safe}` });
          continue;
        }
        const entries = fs.readdirSync(full).slice(0, 80).join('\n');
        messages.push({
          role: 'user',
          content: `TOOL RESULT list_dir ${safe}:\n${entries}`,
        });
        continue;
      }

      if (parsed.action === 'write_files') {
        const files = sanitizeWrittenFiles(parsed.files || [], urls);
        if (!files.length) {
          messages.push({
            role: 'user',
            content:
              'TOOL RESULT write_files: no valid files (invented Www* flat pages are rejected). Reuse pages/<site>/ or create under that folder, then write_files again.',
          });
          continue;
        }
        this.written = files;
        this.lastSummary = parsed.summary || `Wrote ${files.length} file(s) via RepoEditCodegen`;
        this.lastFixReport = parsed.fixReport;
        // Persist immediately so subsequent reads see updates (Cursor-like).
        for (const file of files) {
          const full = path.join(process.cwd(), file.path);
          fs.mkdirSync(path.dirname(full), { recursive: true });
          fs.writeFileSync(full, file.content, 'utf8');
        }
        messages.push({
          role: 'user',
          content: `TOOL RESULT write_files: saved ${files.map((f) => f.path).join(', ')}. If done, respond {"action":"done","summary":"..."}.`,
        });
        continue;
      }

      if (parsed.action === 'done') {
        this.lastSummary = parsed.summary || this.lastSummary || 'RepoEditCodegen complete';
        this.lastFixReport = parsed.fixReport || this.lastFixReport;
        break;
      }

      messages.push({
        role: 'user',
        content: `Unknown action. Use list_pages | read_file | list_dir | write_files | done.`,
      });
    }

    if (!this.written.length) {
      // Fallback: still try to emit a minimal site-folder scaffold from filtered history.
      Logger.warn('[RepoEditCodegen] No write_files — falling back to minimal site scaffold');
      return this.minimalFallback(testName, filtered.steps, urls);
    }

    return {
      files: this.written,
      summary: this.lastSummary,
      fixReport: this.lastFixReport,
    };
  }

  private seedReadFiles(urls: string[]): string {
    const chunks: string[] = [];
    const candidates = new Set<string>();
    for (const url of urls) {
      const inferred = inferSitePageFromUrl(url);
      candidates.add(inferred.pagePath);
      // Also try existing site folder files.
      const dir = path.join(process.cwd(), 'packages/test-framework/pages', inferred.siteFolder);
      if (fs.existsSync(dir)) {
        for (const name of fs.readdirSync(dir).filter((n) => n.endsWith('.ts')).slice(0, 6)) {
          candidates.add(
            path.posix.join('packages/test-framework/pages', inferred.siteFolder, name)
          );
        }
      }
    }
    // automationexercise canonical folder
    const aeDir = path.join(process.cwd(), 'packages/test-framework/pages/automationexercise');
    if (fs.existsSync(aeDir) && urls.some((u) => /automationexercise/i.test(u))) {
      for (const name of fs.readdirSync(aeDir).filter((n) => n.endsWith('Page.ts')).slice(0, 8)) {
        candidates.add(`packages/test-framework/pages/automationexercise/${name}`);
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
    urls: string[]
  ): CodegenResult {
    const url = urls[0] || 'https://example.com/';
    const inferred = inferSitePageFromUrl(url);
    const slug = testName.replace(/\s+/g, '_').toLowerCase();
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
