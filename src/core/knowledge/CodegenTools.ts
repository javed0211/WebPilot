import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { PROJECT_ROOT } from '../ProjectPaths';
import {
  KnowledgeNode,
  RepoKnowledgeGraph,
  RepoKnowledgeGraphData,
} from './RepoKnowledgeGraph';
import {
  CodegenArchitecture,
  detectRepoArchitecture,
  resolveCodegenArchitecture,
  ArchitectureDetection,
} from './RepoArchitectureDetect';
import { getCompactWorkflow } from '../codegen/CompactWorkflow';
import { resolveExecutionHistoryPath } from '../ReportPaths';

export type CodegenToolName =
  | 'kg_search'
  | 'kg_find_page'
  | 'kg_find_method'
  | 'list_dir'
  | 'read_file'
  | 'get_compact_steps'
  | 'detect_architecture'
  | 'write_files'
  | 'apply_patch'
  | 'run_tests'
  | 'list_pages'
  | 'done';

export interface CodegenToolCall {
  action: CodegenToolName | string;
  query?: string;
  path?: string;
  url?: string;
  intent?: string;
  page?: string;
  slug?: string;
  files?: Array<{ path: string; content: string }>;
  patch?: { path: string; oldText: string; newText: string };
  summary?: string;
  fixReport?: string;
}

export interface CodegenToolResult {
  ok: boolean;
  tool: string;
  text: string;
  data?: unknown;
}

const MAX_FILE_CHARS = 24_000;
const ALLOWED_PREFIXES = ['packages/test-framework/', 'resources/', 'tests/'];

function normalizeRepoPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

function resolveSafePath(rel: string, allowTests = true): string | null {
  const normalized = normalizeRepoPath(rel);
  if (normalized.includes('..') || path.isAbsolute(rel)) return null;
  const allowed = allowTests
    ? ALLOWED_PREFIXES
    : ALLOWED_PREFIXES.filter((p) => p !== 'tests/');
  if (!allowed.some((prefix) => normalized.startsWith(prefix))) return null;
  return normalized;
}

function scoreText(haystack: string, needle: string): number {
  const h = haystack.toLowerCase();
  const parts = needle.toLowerCase().split(/[\s_./-]+/).filter(Boolean);
  if (!parts.length) return 0;
  let score = 0;
  for (const part of parts) {
    if (h.includes(part)) score += part.length >= 4 ? 3 : 1;
  }
  if (h.includes(needle.toLowerCase())) score += 5;
  return score;
}

function loadGraph(graph?: RepoKnowledgeGraphData | null): RepoKnowledgeGraphData {
  if (graph) return graph;
  return RepoKnowledgeGraph.load() ?? RepoKnowledgeGraph.build();
}

function methodNamesForPage(graph: RepoKnowledgeGraphData, pageId: string): string[] {
  return graph.edges
    .filter((e) => e.from === pageId && e.type === 'contains')
    .map((e) => graph.nodes.find((n) => n.id === e.to))
    .filter((n): n is KnowledgeNode => !!n && n.type === 'method')
    .map((n) => n.name);
}

/**
 * Tool surface over WebPilot's owned knowledge graph for coding-agent codegen.
 */
export class CodegenTools {
  constructor(
    private readonly root: string = PROJECT_ROOT,
    private graphCache: RepoKnowledgeGraphData | null = null
  ) {}

  public refreshGraph(graph?: RepoKnowledgeGraphData): RepoKnowledgeGraphData {
    this.graphCache = graph ?? RepoKnowledgeGraph.load() ?? RepoKnowledgeGraph.build();
    return this.graphCache;
  }

  public getGraph(): RepoKnowledgeGraphData {
    return loadGraph(this.graphCache);
  }

  public async execute(call: CodegenToolCall): Promise<CodegenToolResult> {
    const action = String(call.action || '');
    switch (action) {
      case 'kg_search':
        return this.kgSearch(String(call.query || ''));
      case 'kg_find_page':
        return this.kgFindPage(String(call.url || call.query || ''));
      case 'kg_find_method':
        return this.kgFindMethod(String(call.intent || call.query || ''), call.page);
      case 'list_pages':
        return this.listPages();
      case 'list_dir':
        return this.listDir(String(call.path || 'packages/test-framework/pages'));
      case 'read_file':
        return this.readFile(String(call.path || ''));
      case 'get_compact_steps':
        return this.getCompactSteps(String(call.slug || ''));
      case 'detect_architecture':
        return this.detectArchitecture();
      case 'write_files':
        return this.writeFiles(call.files || []);
      case 'apply_patch':
        return this.applyPatch(call.patch);
      case 'run_tests':
        return this.runTests(String(call.slug || call.query || ''));
      case 'done':
        return {
          ok: true,
          tool: 'done',
          text: call.summary || 'done',
          data: { summary: call.summary, fixReport: call.fixReport },
        };
      default:
        return {
          ok: false,
          tool: action,
          text: `Unknown tool "${action}". Use kg_search|kg_find_page|kg_find_method|list_dir|read_file|get_compact_steps|detect_architecture|write_files|apply_patch|run_tests|list_pages|done.`,
        };
    }
  }

  public kgSearch(query: string): CodegenToolResult {
    const graph = this.getGraph();
    const q = query.trim();
    if (!q) {
      return { ok: false, tool: 'kg_search', text: 'query is required' };
    }
    const scored = graph.nodes
      .map((n) => {
        const blob = [
          n.name,
          n.type,
          n.filePath || '',
          String(n.meta?.summary || ''),
          String(n.meta?.urlPattern || ''),
          Array.isArray(n.meta?.intentTags) ? (n.meta!.intentTags as string[]).join(' ') : '',
        ].join(' ');
        return { node: n, score: scoreText(blob, q) };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.node.name.localeCompare(b.node.name))
      .slice(0, 20);

    if (!scored.length) {
      return { ok: true, tool: 'kg_search', text: `(no matches for "${q}")`, data: [] };
    }

    const lines = scored.map(({ node, score }) => {
      const summary = node.meta?.summary ? ` — ${String(node.meta.summary).slice(0, 140)}` : '';
      const url = node.meta?.urlPattern ? ` url=${node.meta.urlPattern}` : '';
      return `- [${node.type}] ${node.name} @ ${node.filePath || '?'} (score=${score})${url}${summary}`;
    });
    return {
      ok: true,
      tool: 'kg_search',
      text: lines.join('\n'),
      data: scored.map((s) => s.node),
    };
  }

  public kgFindPage(urlOrHost: string): CodegenToolResult {
    const graph = this.getGraph();
    const needle = urlOrHost.trim().toLowerCase();
    let host = needle;
    try {
      if (/^https?:\/\//i.test(urlOrHost)) host = new URL(urlOrHost).hostname.toLowerCase();
    } catch {
      // keep needle
    }

    const pages = graph.nodes.filter((n) => n.type === 'page');
    const scored = pages
      .map((n) => {
        const urlPattern = String(n.meta?.urlPattern || n.meta?.pageIdentity || '').toLowerCase();
        const pathBlob = (n.filePath || '').toLowerCase();
        const name = n.name.toLowerCase();
        let score = 0;
        if (urlPattern && (needle.includes(urlPattern) || urlPattern.includes(host))) score += 10;
        if (host && pathBlob.includes(host.split('.')[0])) score += 6;
        if (host && name.includes(host.split('.')[0])) score += 4;
        score += scoreText(`${name} ${pathBlob} ${urlPattern} ${n.meta?.summary || ''}`, needle);
        return { node: n, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);

    if (!scored.length) {
      return {
        ok: true,
        tool: 'kg_find_page',
        text: `(no page match for "${urlOrHost}")`,
        data: [],
      };
    }

    const lines = scored.map(({ node, score }) => {
      const methods = methodNamesForPage(graph, node.id).slice(0, 16).join(', ');
      return `- ${node.name} @ ${node.filePath} score=${score} methods=[${methods}]`;
    });
    return { ok: true, tool: 'kg_find_page', text: lines.join('\n'), data: scored.map((s) => s.node) };
  }

  public kgFindMethod(intent: string, pageHint?: string): CodegenToolResult {
    const graph = this.getGraph();
    const methods = graph.nodes.filter((n) => n.type === 'method');
    const scored = methods
      .map((n) => {
        const parent = graph.edges.find((e) => e.to === n.id && e.type === 'contains');
        const page = parent ? graph.nodes.find((x) => x.id === parent.from) : undefined;
        const blob = [
          n.name,
          String(n.meta?.signature || ''),
          String(n.meta?.summary || ''),
          Array.isArray(n.meta?.intentTags) ? (n.meta!.intentTags as string[]).join(' ') : '',
          page?.name || '',
          page?.filePath || '',
        ].join(' ');
        let score = scoreText(blob, intent);
        if (pageHint) {
          const hint = pageHint.toLowerCase();
          if (page?.name?.toLowerCase().includes(hint) || page?.filePath?.toLowerCase().includes(hint)) {
            score += 8;
          }
        }
        return { node: n, page, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12);

    if (!scored.length) {
      return { ok: true, tool: 'kg_find_method', text: `(no method match for "${intent}")`, data: [] };
    }

    const lines = scored.map(({ node, page, score }) => {
      const tags = Array.isArray(node.meta?.intentTags)
        ? ` tags=[${(node.meta!.intentTags as string[]).join(',')}]`
        : '';
      return `- ${page?.name || '?'}.${node.name} @ ${node.filePath || page?.filePath || '?'} score=${score}${tags}`;
    });
    return { ok: true, tool: 'kg_find_method', text: lines.join('\n'), data: scored };
  }

  public listPages(): CodegenToolResult {
    const graph = this.getGraph();
    const pages = graph.nodes.filter((n) => n.type === 'page');
    if (!pages.length) {
      return { ok: true, tool: 'list_pages', text: '(no page objects indexed yet)', data: [] };
    }
    const lines = pages.map((n) => {
      const methods = methodNamesForPage(graph, n.id).slice(0, 20).join(', ');
      const summary = n.meta?.summary ? ` — ${String(n.meta.summary).slice(0, 100)}` : '';
      return `- ${n.name} @ ${n.filePath || '?'} methods=[${methods}]${summary}`;
    });
    return { ok: true, tool: 'list_pages', text: lines.join('\n'), data: pages };
  }

  public listDir(rel: string): CodegenToolResult {
    const safe = resolveSafePath(rel);
    if (!safe) {
      return { ok: false, tool: 'list_dir', text: 'denied — path must be under packages/test-framework/ or resources/' };
    }
    const full = path.join(this.root, safe);
    if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) {
      return { ok: false, tool: 'list_dir', text: `missing ${safe}` };
    }
    const entries = fs.readdirSync(full).slice(0, 100).join('\n');
    return { ok: true, tool: 'list_dir', text: entries, data: { path: safe } };
  }

  public readFile(rel: string): CodegenToolResult {
    const safe = resolveSafePath(rel);
    if (!safe) {
      return { ok: false, tool: 'read_file', text: 'denied — path must be under packages/test-framework/ or resources/' };
    }
    const full = path.join(this.root, safe);
    if (!fs.existsSync(full)) {
      return { ok: false, tool: 'read_file', text: `missing ${safe}` };
    }
    let content = fs.readFileSync(full, 'utf8');
    if (content.length > MAX_FILE_CHARS) {
      content = content.slice(0, MAX_FILE_CHARS) + '\n/* …truncated… */\n';
    }
    return {
      ok: true,
      tool: 'read_file',
      text: content,
      data: { path: safe, content },
    };
  }

  public getCompactSteps(slug: string): CodegenToolResult {
    if (!slug) {
      return { ok: false, tool: 'get_compact_steps', text: 'slug is required' };
    }
    const historyPath = resolveExecutionHistoryPath(slug);
    if (!fs.existsSync(historyPath)) {
      return { ok: false, tool: 'get_compact_steps', text: `no ActHistory for ${slug}` };
    }
    try {
      const doc = JSON.parse(fs.readFileSync(historyPath, 'utf8')) as Record<string, unknown>;
      const compact = getCompactWorkflow(doc);
      if (!compact) {
        return { ok: false, tool: 'get_compact_steps', text: `no compactWorkflow on ${slug}` };
      }
      const steps = Array.isArray((compact as any).steps) ? (compact as any).steps : [];
      const lines = steps.map((s: any, i: number) => {
        const action = s.action || s.type || '?';
        const desc = s.nlStep || s.description || s.nl || s.text || '';
        const url = s.url ? ` url=${s.url}` : '';
        return `${i + 1}. [${action}]${url} ${desc}`.trim();
      });
      return {
        ok: true,
        tool: 'get_compact_steps',
        text: lines.join('\n') || '(empty compact steps)',
        data: compact,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, tool: 'get_compact_steps', text: message };
    }
  }

  public detectArchitecture(override?: string): CodegenToolResult {
    const detection: ArchitectureDetection = override
      ? resolveCodegenArchitecture({ override })
      : detectRepoArchitecture(this.root);
    const text = [
      `architecture=${detection.architecture}`,
      `frameworkPattern=${detection.frameworkPattern}`,
      `confidence=${detection.confidence}`,
      ...detection.reasons.map((r) => `reason: ${r}`),
      `signals: pages=${detection.signals.pageObjectFiles} dirs=${detection.signals.pagesDirs} features=${detection.signals.featureFiles} steps=${detection.signals.stepDirs} flatSpecs=${detection.signals.flatSpecs}`,
    ].join('\n');
    return { ok: true, tool: 'detect_architecture', text, data: detection };
  }

  public writeFiles(files: Array<{ path: string; content: string }>): CodegenToolResult {
    const written: string[] = [];
    for (const file of files) {
      const safe = resolveSafePath(String(file.path || ''), true);
      if (!safe) {
        return {
          ok: false,
          tool: 'write_files',
          text: `denied path: ${file.path}`,
        };
      }
      const full = path.join(this.root, safe);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, file.content, 'utf8');
      written.push(safe);
    }
    return {
      ok: true,
      tool: 'write_files',
      text: written.length ? `saved ${written.join(', ')}` : 'no files',
      data: { paths: written },
    };
  }

  public applyPatch(patch?: { path: string; oldText: string; newText: string }): CodegenToolResult {
    if (!patch?.path || patch.oldText == null || patch.newText == null) {
      return { ok: false, tool: 'apply_patch', text: 'path, oldText, newText required' };
    }
    const safe = resolveSafePath(patch.path);
    if (!safe) return { ok: false, tool: 'apply_patch', text: `denied path: ${patch.path}` };
    const full = path.join(this.root, safe);
    if (!fs.existsSync(full)) return { ok: false, tool: 'apply_patch', text: `missing ${safe}` };
    const current = fs.readFileSync(full, 'utf8');
    if (!current.includes(patch.oldText)) {
      return { ok: false, tool: 'apply_patch', text: `oldText not found in ${safe}` };
    }
    const next = current.replace(patch.oldText, patch.newText);
    fs.writeFileSync(full, next, 'utf8');
    return { ok: true, tool: 'apply_patch', text: `patched ${safe}`, data: { path: safe } };
  }

  public runTests(slug: string): CodegenToolResult {
    if (!slug) {
      return { ok: false, tool: 'run_tests', text: 'slug is required' };
    }
    const candidates = [
      path.join('packages/test-framework/tests', `${slug}.spec.ts`),
      path.join('packages/test-framework/tests', `${slug.replace(/-/g, '_')}.spec.ts`),
    ];
    const rel = candidates.find((c) => fs.existsSync(path.join(this.root, c)));
    if (!rel) {
      return {
        ok: false,
        tool: 'run_tests',
        text: `no spec found for slug ${slug} (tried ${candidates.join(', ')})`,
      };
    }
    try {
      const output = execSync(`npx playwright test ${rel} --reporter=line`, {
        cwd: this.root,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        env: process.env,
        timeout: 180_000,
      });
      return {
        ok: true,
        tool: 'run_tests',
        text: (output || 'passed').slice(-4000),
        data: { path: rel, passed: true },
      };
    } catch (err: any) {
      const output = `${err.stdout || ''}${err.stderr || err.message || ''}`.slice(-4000);
      return {
        ok: false,
        tool: 'run_tests',
        text: output || 'playwright failed',
        data: { path: rel, passed: false },
      };
    }
  }
}

export type { CodegenArchitecture };
