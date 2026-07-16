import * as fs from 'fs';
import * as path from 'path';
import { PromptLoader } from './PromptLoader';
import { SymbolGraph, SymbolParser } from './SymbolParser';
import { RepoKnowledgeGraph } from './knowledge/RepoKnowledgeGraph';

const BASE_PAGE_PATH = path.join(process.cwd(), 'packages', 'test-framework', 'core', 'BasePage.ts');

/**
 * Builds repository-aware context for LLM code generation prompts.
 */
export class CodegenContext {
  public static loadGuidelines(): string {
    return PromptLoader.loadFrameworkRules();
  }

  public static buildBasePageApiSummary(): string {
    if (!fs.existsSync(BASE_PAGE_PATH)) {
      return 'BasePage: navigate, click, fill, getText, isVisible, assertElementVisible, assertTextPresent, hover, press, assertCountAtLeast, clickByRole, fillByLabel, fillByPlaceholder';
    }
    const graph = SymbolParser.parseFile(BASE_PAGE_PATH);
    const base = graph.find((c) => c.name === 'BasePage');
    if (!base) {
      return fs.readFileSync(BASE_PAGE_PATH, 'utf8');
    }
    const methods = base.methods
      .map((m) => {
        const params = m.parameters.map((p) => `${p.name}: ${p.type}`).join(', ');
        return `  - ${m.name}(${params}): ${m.returnType}`;
      })
      .join('\n');
    return `BasePage (packages/test-framework/core/BasePage.ts) — subclasses MUST reuse these methods:\n${methods}`;
  }

  public static buildSymbolGraphContext(pagesDir?: string): string {
    const dir = pagesDir ?? path.join(process.cwd(), 'packages', 'test-framework', 'pages');
    const graph: SymbolGraph = SymbolParser.generateGraph(dir);
    const payload = {
      ...graph,
      classes: graph.classes.map((c) => ({
        name: c.name,
        extendsClass: c.extendsClass,
        pageIdentity: c.pageIdentity,
        urlPattern: c.urlPattern,
        filePath: path.basename(c.filePath),
        properties: c.properties,
        methods: c.methods,
      })),
    };
    return JSON.stringify(payload, null, 2);
  }

  public static buildAutomationExercisePageCatalog(): string {
    return PromptLoader.load('shared/automationexercise-catalog.md');
  }

  /**
   * Fresh knowledge-graph summary for an LLM edit (generate or repair).
   * Refreshes the AST graph so the agent sees pages/methods that already exist
   * before it proposes file changes. Understand-Anything enrichment is included
   * automatically when `.ua/` / `.understand-anything/` is present — no manual step.
   */
  public static knowledgeForEdit(): string {
    try {
      RepoKnowledgeGraph.refresh();
      return RepoKnowledgeGraph.contextSummary();
    } catch {
      return CodegenContext.buildRepoKnowledgeSummary();
    }
  }

  /**
   * Compact repository knowledge graph summary (page objects, methods, layers),
   * built from the TypeScript AST and enriched by Understand-Anything (.ua/ or
   * .understand-anything/) when that graph JSON is present.
   * Returns '' when unavailable so callers can omit the section cleanly.
   */
  public static buildRepoKnowledgeSummary(): string {
    return RepoKnowledgeGraph.contextSummary();
  }

  public static buildFullPromptContext(symbolGraphJson?: string, repoKnowledgeOverride?: string): string {
    const graph =
      symbolGraphJson?.trim() ||
      CodegenContext.buildSymbolGraphContext();
    const repoKnowledge =
      repoKnowledgeOverride?.trim() ||
      CodegenContext.buildRepoKnowledgeSummary();
    return [
      '=== CODE GENERATION GUIDELINES ===',
      CodegenContext.loadGuidelines(),
      '',
      '=== BASE PAGE API (reuse in every POM) ===',
      CodegenContext.buildBasePageApiSummary(),
      ...(repoKnowledge ? ['', repoKnowledge] : []),
      '',
      '=== EXISTING PAGE OBJECTS (extend the correct page file only) ===',
      graph,
    ].join('\n');
  }
}
