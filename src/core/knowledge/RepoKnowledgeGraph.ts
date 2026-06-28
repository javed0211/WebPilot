import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { PROJECT_ROOT, TEST_FRAMEWORK_ROOT, KNOWLEDGE_GRAPH_PATH } from '../ProjectPaths';
import { ConfigManager } from '../ConfigManager';
import { SymbolParser, ClassSymbolInfo } from '../SymbolParser';

/**
 * Repo Knowledge Graph
 * --------------------
 * WebPilot's deterministic repository-understanding layer for codegen.
 *
 * The approach intentionally follows the architecture used by projects like
 * Understand-Anything and CodeFlow:
 *   1. discover source files across the repo,
 *   2. extract structural facts from ASTs,
 *   3. build file/declaration/dependency edges,
 *   4. optionally enrich from a cached semantic graph,
 *   5. inject a compact, relevant summary into codegen prompts.
 *
 * We do not vendor those repos. CodeFlow currently has no license, and
 * Understand-Anything is a coding-agent plugin rather than an embeddable npm
 * library. Instead, WebPilot reuses the same core pattern and interoperates with
 * `.understand-anything/knowledge-graph.json` when it exists.
 */

export type KnowledgeNodeType =
  | 'file'
  | 'external'
  | 'class'
  | 'method'
  | 'function'
  | 'page'
  | 'test'
  | 'api'
  | 'domain'
  | 'unknown';

export interface KnowledgeNode {
  id: string;
  type: KnowledgeNodeType;
  name: string;
  filePath?: string;
  layer?: string;
  language?: string;
  meta?: Record<string, unknown>;
}

export type KnowledgeEdgeType =
  | 'contains'
  | 'imports'
  | 'exports'
  | 'extends'
  | 'references'
  | 'calls'
  | 'depends_on'
  | 'semantic';

export interface KnowledgeEdge {
  from: string;
  to: string;
  type: KnowledgeEdgeType;
  meta?: Record<string, unknown>;
}

export interface RepoKnowledgeProfile {
  language?: string;
  automationTool?: string;
  frameworkPattern?: string;
  testFramework?: string;
  target?: string;
}

export interface RepoKnowledgeGraphData {
  version: string;
  generatedAt: string;
  root: string;
  profile: RepoKnowledgeProfile;
  sources: {
    typescriptCompiler: boolean;
    symbolParser: boolean;
    understandAnything: boolean;
    treeSitter: boolean;
  };
  stats: {
    files: number;
    pages: number;
    tests: number;
    apis: number;
    classes: number;
    functions: number;
    methods: number;
    imports: number;
    externalDependencies: number;
    edges: number;
    enriched: number;
    importedNodes: number;
    importedEdges: number;
  };
  notes: string[];
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
}

type ImportedUnderstandGraph = {
  summaries: Map<string, string>;
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
};

type ScanFile = {
  absolutePath: string;
  relativePath: string;
  language: string;
  layer: string;
};

type TreeSitterLanguageKey = 'python' | 'java' | 'csharp' | 'go';

const GRAPH_VERSION = '1.1.0';

const SOURCE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.java',
  '.cs',
  '.go',
  '.rs',
  '.rb',
  '.php',
]);

const TS_JS_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const TREE_SITTER_LANGUAGES = new Set(['python', 'java', 'csharp', 'go']);

const IGNORED_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  '.cursor',
  '.understand-anything',
  'node_modules',
  'dist',
  'build',
  'coverage',
  'runtime',
  '.venv',
  'venv',
  '__pycache__',
  '.pytest_cache',
  'target',
  'bin',
  'obj',
]);

function readProfile(): RepoKnowledgeProfile {
  try {
    const config = ConfigManager.getInstance();
    return {
      language: config.get('project.language', 'typescript'),
      automationTool: config.get('project.automationTool', 'playwright'),
      frameworkPattern: config.get('project.frameworkPattern', 'pom'),
      testFramework: config.get('project.testFramework'),
      target: config.get('project.target', 'web'),
    };
  } catch {
    return { language: 'typescript', automationTool: 'playwright', frameworkPattern: 'pom', target: 'web' };
  }
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '');
}

function normalizeKey(value: string): string {
  return normalizePath(value).toLowerCase();
}

function relativePath(absolutePath: string): string {
  return normalizePath(path.relative(PROJECT_ROOT, absolutePath));
}

function fileId(relative: string): string {
  return `file:${normalizePath(relative)}`;
}

function declarationId(relative: string, kind: string, name: string): string {
  return `${kind}:${normalizePath(relative)}#${name}`;
}

function externalId(specifier: string): string {
  return `external:${specifier}`;
}

function languageForFile(filePath: string): string {
  const ext = path.extname(filePath);
  if (ext === '.ts' || ext === '.tsx') return 'typescript';
  if (ext === '.js' || ext === '.jsx' || ext === '.mjs' || ext === '.cjs') return 'javascript';
  if (ext === '.py') return 'python';
  if (ext === '.java') return 'java';
  if (ext === '.cs') return 'csharp';
  if (ext === '.go') return 'go';
  if (ext === '.rs') return 'rust';
  if (ext === '.rb') return 'ruby';
  if (ext === '.php') return 'php';
  return 'unknown';
}

function treeSitterLanguageKey(language: string): TreeSitterLanguageKey | null {
  if (language === 'python') return 'python';
  if (language === 'java') return 'java';
  if (language === 'csharp') return 'csharp';
  if (language === 'go') return 'go';
  return null;
}

function treeSitterWasmPath(language: TreeSitterLanguageKey): string {
  const wasmNames: Record<TreeSitterLanguageKey, string> = {
    python: 'tree-sitter-python.wasm',
    java: 'tree-sitter-java.wasm',
    csharp: 'tree-sitter-c-sharp.wasm',
    go: 'tree-sitter-go.wasm',
  };
  return require.resolve(`@vscode/tree-sitter-wasm/wasm/${wasmNames[language]}`);
}

function layerForPath(relative: string): string {
  const rel = normalizePath(relative);
  if (rel.includes('/pages/')) return 'page-object';
  if (rel.includes('/apis/') || rel.includes('/api/')) return 'api';
  if (rel.includes('/tests/') || rel.endsWith('.spec.ts') || rel.endsWith('.test.ts')) return 'test';
  if (rel.includes('/agents/')) return 'agent';
  if (rel.includes('/cli/')) return 'cli';
  if (rel.includes('/integrations/')) return 'integration';
  if (rel.includes('/execution_report/')) return 'reporting';
  if (rel.includes('/core/')) return 'core';
  if (rel.includes('/utils/')) return 'utility';
  if (rel.includes('/config/')) return 'config';
  if (rel.includes('/docs/')) return 'docs';
  return 'source';
}

function codegenRelevanceScore(filePath?: string): number {
  if (!filePath) return 0;
  const rel = normalizePath(filePath);
  if (rel.startsWith('packages/test-framework/')) return 100;
  if (rel.startsWith('src/agents/')) return 90;
  if (rel.startsWith('src/core/')) return 85;
  if (rel.startsWith('src/cli/')) return 75;
  if (rel.startsWith('resources/prompts/')) return 70;
  if (rel.startsWith('tests/')) return 65;
  if (rel.startsWith('packages/browser-use/')) return 10;
  return 40;
}

function isIgnoredDirectory(dirName: string): boolean {
  return IGNORED_DIRS.has(dirName) || dirName.startsWith('.');
}

function discoverSourceFiles(root: string): ScanFile[] {
  const files: ScanFile[] = [];
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (isIgnoredDirectory(entry.name)) continue;
        walk(fullPath);
        continue;
      }
      const ext = path.extname(entry.name);
      if (!SOURCE_EXTENSIONS.has(ext)) continue;
      const rel = relativePath(fullPath);
      files.push({
        absolutePath: fullPath,
        relativePath: rel,
        language: languageForFile(fullPath),
        layer: layerForPath(rel),
      });
    }
  };
  walk(root);
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return files;
}

function scriptKindForPath(filePath: string): ts.ScriptKind {
  const ext = path.extname(filePath);
  if (ext === '.tsx') return ts.ScriptKind.TSX;
  if (ext === '.jsx') return ts.ScriptKind.JSX;
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function safeParseClasses(filePath: string): ClassSymbolInfo[] {
  try {
    return SymbolParser.parseFile(filePath);
  } catch {
    return [];
  }
}

function lookupClassInfo(classes: ClassSymbolInfo[], className: string): ClassSymbolInfo | undefined {
  return classes.find((info) => info.name === className);
}

function createSourceFile(scanFile: ScanFile): ts.SourceFile {
  return ts.createSourceFile(
    scanFile.relativePath,
    fs.readFileSync(scanFile.absolutePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    scriptKindForPath(scanFile.absolutePath)
  );
}

function importTargetId(specifier: string, currentFile: ScanFile, fileLookup: Set<string>): string {
  if (!specifier.startsWith('.')) return externalId(specifier);

  const currentDir = path.dirname(currentFile.relativePath);
  const base = normalizePath(path.normalize(path.join(currentDir, specifier)));
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    `${base}.mjs`,
    `${base}.cjs`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
    `${base}/index.js`,
    `${base}/index.jsx`,
  ];

  const resolved = candidates.find((candidate) => fileLookup.has(normalizePath(candidate)));
  return resolved ? fileId(resolved) : fileId(base);
}

function importNames(node: ts.ImportDeclaration, sourceFile: ts.SourceFile): string[] {
  const clause = node.importClause;
  if (!clause) return [];
  const names: string[] = [];
  if (clause.name) names.push(clause.name.text);
  if (clause.namedBindings) {
    if (ts.isNamespaceImport(clause.namedBindings)) {
      names.push(clause.namedBindings.name.text);
    } else {
      for (const element of clause.namedBindings.elements) {
        names.push(element.name.getText(sourceFile));
      }
    }
  }
  return names;
}

function extractHeritage(node: ts.ClassDeclaration, sourceFile: ts.SourceFile): string | undefined {
  for (const clause of node.heritageClauses ?? []) {
    if (clause.token !== ts.SyntaxKind.ExtendsKeyword) continue;
    const first = clause.types[0];
    if (first) return first.expression.getText(sourceFile);
  }
  return undefined;
}

function functionNameFromVariable(node: ts.VariableStatement, sourceFile: ts.SourceFile): string | null {
  for (const declaration of node.declarationList.declarations) {
    if (!ts.isIdentifier(declaration.name)) continue;
    const init = declaration.initializer;
    if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
      return declaration.name.getText(sourceFile);
    }
  }
  return null;
}

function methodSignature(node: ts.MethodDeclaration, sourceFile: ts.SourceFile): string {
  const params = node.parameters
    .map((param) => {
      const type = param.type ? param.type.getText(sourceFile) : 'any';
      return `${param.name.getText(sourceFile)}: ${type}`;
    })
    .join(', ');
  const returnType = node.type ? node.type.getText(sourceFile) : 'Promise<void>';
  return `${node.name.getText(sourceFile)}(${params}): ${returnType}`;
}

function functionSignature(name: string, node: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression, sourceFile: ts.SourceFile): string {
  const params = node.parameters
    .map((param) => {
      const type = param.type ? param.type.getText(sourceFile) : 'any';
      return `${param.name.getText(sourceFile)}: ${type}`;
    })
    .join(', ');
  const returnType = node.type ? node.type.getText(sourceFile) : 'unknown';
  return `${name}(${params}): ${returnType}`;
}

async function createTreeSitterParser(language: TreeSitterLanguageKey): Promise<any> {
  const { Parser, Language } = require('web-tree-sitter');
  await Parser.init({
    locateFile(scriptName: string) {
      return require.resolve(`web-tree-sitter/${scriptName}`);
    },
  });
  const parser = new Parser();
  parser.setLanguage(await Language.load(treeSitterWasmPath(language)));
  return parser;
}

const treeSitterParserCache = new Map<TreeSitterLanguageKey, Promise<any>>();

function getTreeSitterParser(language: TreeSitterLanguageKey): Promise<any> {
  const existing = treeSitterParserCache.get(language);
  if (existing) return existing;
  const parser = createTreeSitterParser(language);
  treeSitterParserCache.set(language, parser);
  return parser;
}

function childText(node: any, fieldName: string): string | undefined {
  const child = node.childForFieldName?.(fieldName);
  return child?.text;
}

function firstNamedChildText(node: any, type: string): string | undefined {
  for (const child of node.namedChildren ?? []) {
    if (child.type === type) return child.text;
  }
  return undefined;
}

function methodLikeSignature(name: string, node: any): string {
  const params =
    childText(node, 'parameters') ||
    firstNamedChildText(node, 'parameters') ||
    firstNamedChildText(node, 'parameter_list') ||
    '()';
  return `${name}${params}`;
}

function cleanImportSpecifier(text: string, language: TreeSitterLanguageKey): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  if (language === 'python') {
    const fromMatch = trimmed.match(/^from\s+([A-Za-z0-9_\\.]+)\s+import\s+/);
    if (fromMatch) return fromMatch[1];
    const importMatch = trimmed.match(/^import\s+([A-Za-z0-9_\\.]+)/);
    if (importMatch) return importMatch[1];
  }

  if (language === 'java') {
    return trimmed
      .replace(/^import\s+static\s+/, '')
      .replace(/^import\s+/, '')
      .replace(/;$/, '')
      .trim() || null;
  }

  if (language === 'csharp') {
    return trimmed
      .replace(/^using\s+static\s+/, '')
      .replace(/^using\s+/, '')
      .replace(/;$/, '')
      .trim() || null;
  }

  if (language === 'go') {
    const quoted = trimmed.match(/"([^"]+)"/);
    if (quoted) return quoted[1];
  }

  return null;
}

function loadUnderstandAnythingGraph(): ImportedUnderstandGraph {
  const result: ImportedUnderstandGraph = { summaries: new Map(), nodes: [], edges: [] };
  const candidate = path.join(PROJECT_ROOT, '.understand-anything', 'knowledge-graph.json');
  if (!fs.existsSync(candidate)) return result;

  try {
    const raw = JSON.parse(fs.readFileSync(candidate, 'utf8'));
    const rawNodes: any[] = Array.isArray(raw) ? raw : raw.nodes || raw.graph?.nodes || [];
    const rawEdges: any[] = raw.edges || raw.links || raw.graph?.edges || raw.graph?.links || [];

    for (const rawNode of rawNodes) {
      if (!rawNode || typeof rawNode !== 'object') continue;
      const name = String(rawNode.name || rawNode.label || rawNode.id || 'unknown');
      const rawPath = rawNode.path || rawNode.file || rawNode.filePath || rawNode.relativePath;
      const normalizedPath = typeof rawPath === 'string' ? normalizePath(rawPath) : undefined;
      const summary = rawNode.summary || rawNode.description || rawNode.explanation;
      const rawType = String(rawNode.type || rawNode.kind || '').toLowerCase();
      const type: KnowledgeNodeType =
        rawType.includes('file') ? 'file' :
        rawType.includes('class') ? 'class' :
        rawType.includes('function') ? 'function' :
        rawType.includes('method') ? 'method' :
        rawType.includes('domain') ? 'domain' :
        'unknown';

      if (typeof summary === 'string') {
        result.summaries.set(normalizeKey(name), summary.trim());
        if (normalizedPath) result.summaries.set(normalizeKey(normalizedPath), summary.trim());
      }

      result.nodes.push({
        id: `understand:${normalizePath(String(rawNode.id || normalizedPath || name))}`,
        type,
        name,
        filePath: normalizedPath,
        layer: normalizedPath ? layerForPath(normalizedPath) : undefined,
        language: normalizedPath ? languageForFile(normalizedPath) : undefined,
        meta: {
          source: 'understand-anything',
          ...(typeof summary === 'string' ? { summary: summary.trim() } : {}),
        },
      });
    }

    for (const rawEdge of rawEdges) {
      if (!rawEdge || typeof rawEdge !== 'object') continue;
      const from = rawEdge.from || rawEdge.source || rawEdge.sourceId;
      const to = rawEdge.to || rawEdge.target || rawEdge.targetId;
      if (!from || !to) continue;
      result.edges.push({
        from: `understand:${normalizePath(String(from))}`,
        to: `understand:${normalizePath(String(to))}`,
        type: 'semantic',
        meta: {
          source: 'understand-anything',
          label: rawEdge.type || rawEdge.label || rawEdge.relationship,
        },
      });
    }
  } catch {
    return { summaries: new Map(), nodes: [], edges: [] };
  }

  return result;
}

class GraphAccumulator {
  public readonly nodes = new Map<string, KnowledgeNode>();
  public readonly edges: KnowledgeEdge[] = [];
  public enrichedCount = 0;
  public importCount = 0;

  public addNode(node: KnowledgeNode): void {
    const existing = this.nodes.get(node.id);
    if (!existing) {
      this.nodes.set(node.id, node);
      if (node.meta?.summary) this.enrichedCount++;
      return;
    }

    this.nodes.set(node.id, {
      ...existing,
      ...node,
      meta: { ...(existing.meta ?? {}), ...(node.meta ?? {}) },
    });
  }

  public addEdge(edge: KnowledgeEdge): void {
    this.edges.push(edge);
    if (edge.type === 'imports') this.importCount++;
  }
}

function addFileNode(acc: GraphAccumulator, scanFile: ScanFile, summaries: Map<string, string>): void {
  const summary = summaries.get(normalizeKey(scanFile.relativePath)) || summaries.get(normalizeKey(path.basename(scanFile.relativePath)));
  const type: KnowledgeNodeType =
    scanFile.layer === 'test' ? 'test' :
    scanFile.layer === 'api' ? 'api' :
    'file';

  acc.addNode({
    id: fileId(scanFile.relativePath),
    type,
    name: path.basename(scanFile.relativePath),
    filePath: scanFile.relativePath,
    layer: scanFile.layer,
    language: scanFile.language,
    meta: summary ? { summary } : undefined,
  });
}

function analyzeTypeScriptFile(
  acc: GraphAccumulator,
  scanFile: ScanFile,
  fileLookup: Set<string>,
  summaries: Map<string, string>
): void {
  const sourceFile = createSourceFile(scanFile);
  const currentFileId = fileId(scanFile.relativePath);
  const classes = safeParseClasses(scanFile.absolutePath);

  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const specifier = node.moduleSpecifier.text;
      const target = importTargetId(specifier, scanFile, fileLookup);
      if (target.startsWith('external:')) {
        acc.addNode({
          id: target,
          type: 'external',
          name: specifier,
          meta: { package: specifier },
        });
      }
      acc.addEdge({
        from: currentFileId,
        to: target,
        type: 'imports',
        meta: { specifier, names: importNames(node, sourceFile) },
      });
    }

    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const specifier = node.moduleSpecifier.text;
      acc.addEdge({
        from: currentFileId,
        to: importTargetId(specifier, scanFile, fileLookup),
        type: 'exports',
        meta: { specifier },
      });
    }

    if (ts.isClassDeclaration(node) && node.name) {
      const className = node.name.text;
      const info = lookupClassInfo(classes, className);
      const classSummary =
        summaries.get(normalizeKey(className)) ||
        summaries.get(normalizeKey(scanFile.relativePath));
      const isPage =
        scanFile.layer === 'page-object' ||
        !!info?.pageIdentity ||
        !!info?.urlPattern;
      const classId = declarationId(scanFile.relativePath, isPage ? 'page' : 'class', className);
      const extendsClass = info?.extendsClass || extractHeritage(node, sourceFile);

      acc.addNode({
        id: classId,
        type: isPage ? 'page' : 'class',
        name: className,
        filePath: scanFile.relativePath,
        layer: scanFile.layer,
        language: scanFile.language,
        meta: {
          ...(info?.pageIdentity ? { pageIdentity: info.pageIdentity } : {}),
          ...(info?.urlPattern ? { urlPattern: info.urlPattern } : {}),
          ...(extendsClass ? { extends: extendsClass } : {}),
          ...(classSummary ? { summary: classSummary } : {}),
        },
      });
      acc.addEdge({ from: currentFileId, to: classId, type: 'contains' });

      if (extendsClass) {
        acc.addEdge({
          from: classId,
          to: `class-ref:${extendsClass}`,
          type: 'extends',
          meta: { name: extendsClass },
        });
      }

      for (const member of node.members) {
        if (!ts.isMethodDeclaration(member) || !member.name) continue;
        const methodName = member.name.getText(sourceFile);
        const methodId = declarationId(scanFile.relativePath, 'method', `${className}.${methodName}`);
        acc.addNode({
          id: methodId,
          type: 'method',
          name: methodName,
          filePath: scanFile.relativePath,
          layer: scanFile.layer,
          language: scanFile.language,
          meta: { signature: methodSignature(member, sourceFile), owner: className },
        });
        acc.addEdge({ from: classId, to: methodId, type: 'contains' });
      }
    }

    if (ts.isFunctionDeclaration(node) && node.name) {
      const name = node.name.text;
      const id = declarationId(scanFile.relativePath, 'function', name);
      acc.addNode({
        id,
        type: 'function',
        name,
        filePath: scanFile.relativePath,
        layer: scanFile.layer,
        language: scanFile.language,
        meta: { signature: functionSignature(name, node, sourceFile) },
      });
      acc.addEdge({ from: currentFileId, to: id, type: 'contains' });
    }

    if (ts.isVariableStatement(node)) {
      const name = functionNameFromVariable(node, sourceFile);
      if (name) {
        const id = declarationId(scanFile.relativePath, 'function', name);
        acc.addNode({
          id,
          type: 'function',
          name,
          filePath: scanFile.relativePath,
          layer: scanFile.layer,
          language: scanFile.language,
        });
        acc.addEdge({ from: currentFileId, to: id, type: 'contains' });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
}

function isTreeSitterImportNode(type: string, language: TreeSitterLanguageKey): boolean {
  if (language === 'python') return type === 'import_statement' || type === 'import_from_statement';
  if (language === 'java') return type === 'import_declaration';
  if (language === 'csharp') return type === 'using_directive';
  if (language === 'go') return type === 'import_declaration' || type === 'import_spec';
  return false;
}

function classNameFromTreeSitterNode(node: any, language: TreeSitterLanguageKey): string | undefined {
  if (language === 'go') {
    if (node.type !== 'type_spec') return undefined;
    const typeNode = childText(node, 'type');
    if (!typeNode || !/(struct|interface)/.test(typeNode)) return undefined;
  }
  return childText(node, 'name') || firstNamedChildText(node, 'identifier') || firstNamedChildText(node, 'type_identifier');
}

function isTreeSitterClassNode(type: string, language: TreeSitterLanguageKey): boolean {
  if (language === 'python') return type === 'class_definition';
  if (language === 'java') return type === 'class_declaration' || type === 'interface_declaration' || type === 'enum_declaration';
  if (language === 'csharp') return type === 'class_declaration' || type === 'interface_declaration' || type === 'struct_declaration' || type === 'enum_declaration';
  if (language === 'go') return type === 'type_spec';
  return false;
}

function isTreeSitterFunctionNode(type: string, language: TreeSitterLanguageKey): boolean {
  if (language === 'python') return type === 'function_definition';
  if (language === 'java') return type === 'method_declaration' || type === 'constructor_declaration';
  if (language === 'csharp') return type === 'method_declaration' || type === 'constructor_declaration';
  if (language === 'go') return type === 'function_declaration' || type === 'method_declaration';
  return false;
}

async function analyzeTreeSitterFile(
  acc: GraphAccumulator,
  scanFile: ScanFile,
  summaries: Map<string, string>
): Promise<boolean> {
  const language = treeSitterLanguageKey(scanFile.language);
  if (!language) return false;

  const parser = await getTreeSitterParser(language);
  const source = fs.readFileSync(scanFile.absolutePath, 'utf8');
  const tree = parser.parse(source);
  const currentFileId = fileId(scanFile.relativePath);
  const classStack: string[] = [];
  let extracted = false;

  const visit = (node: any) => {
    if (isTreeSitterImportNode(node.type, language)) {
      const specifier = cleanImportSpecifier(node.text, language);
      if (specifier) {
        const target = externalId(specifier);
        acc.addNode({
          id: target,
          type: 'external',
          name: specifier,
          meta: { package: specifier },
        });
        acc.addEdge({
          from: currentFileId,
          to: target,
          type: 'imports',
          meta: { specifier, parser: 'tree-sitter' },
        });
        extracted = true;
      }
    }

    if (isTreeSitterClassNode(node.type, language)) {
      const className = classNameFromTreeSitterNode(node, language);
      if (className) {
        const isPage = scanFile.layer === 'page-object' || /Page$/.test(className);
        const id = declarationId(scanFile.relativePath, isPage ? 'page' : 'class', className);
        const summary = summaries.get(normalizeKey(className)) || summaries.get(normalizeKey(scanFile.relativePath));
        acc.addNode({
          id,
          type: isPage ? 'page' : 'class',
          name: className,
          filePath: scanFile.relativePath,
          layer: scanFile.layer,
          language: scanFile.language,
          meta: {
            parser: 'tree-sitter',
            ...(summary ? { summary } : {}),
          },
        });
        acc.addEdge({ from: classStack[classStack.length - 1] || currentFileId, to: id, type: 'contains' });
        classStack.push(id);
        extracted = true;
      }
    }

    if (isTreeSitterFunctionNode(node.type, language)) {
      const name =
        childText(node, 'name') ||
        firstNamedChildText(node, 'identifier') ||
        (node.type === 'constructor_declaration' ? 'constructor' : undefined);
      if (name) {
        const owner = classStack[classStack.length - 1];
        const kind = owner ? 'method' : 'function';
        const id = declarationId(scanFile.relativePath, kind, owner ? `${owner.split('#').pop()}.${name}` : name);
        acc.addNode({
          id,
          type: owner ? 'method' : 'function',
          name,
          filePath: scanFile.relativePath,
          layer: scanFile.layer,
          language: scanFile.language,
          meta: {
            parser: 'tree-sitter',
            signature: methodLikeSignature(name, node),
          },
        });
        acc.addEdge({ from: owner || currentFileId, to: id, type: 'contains' });
        extracted = true;
      }
    }

    for (const child of node.namedChildren ?? []) visit(child);

    if (isTreeSitterClassNode(node.type, language) && classNameFromTreeSitterNode(node, language)) {
      classStack.pop();
    }
  };

  visit(tree.rootNode);
  return extracted;
}

function calculateStats(
  nodes: KnowledgeNode[],
  edges: KnowledgeEdge[],
  importCount: number,
  enrichedCount: number,
  imported: ImportedUnderstandGraph
): RepoKnowledgeGraphData['stats'] {
  return {
    files: nodes.filter((node) => node.type === 'file' || node.type === 'test' || node.type === 'api').length,
    pages: nodes.filter((node) => node.type === 'page').length,
    tests: nodes.filter((node) => node.type === 'test').length,
    apis: nodes.filter((node) => node.type === 'api').length,
    classes: nodes.filter((node) => node.type === 'class').length,
    functions: nodes.filter((node) => node.type === 'function').length,
    methods: nodes.filter((node) => node.type === 'method').length,
    imports: importCount,
    externalDependencies: nodes.filter((node) => node.type === 'external').length,
    edges: edges.length,
    enriched: enrichedCount,
    importedNodes: imported.nodes.length,
    importedEdges: imported.edges.length,
  };
}

export class RepoKnowledgeGraph {
  public static build(): RepoKnowledgeGraphData {
    const profile = readProfile();
    const notes: string[] = [];
    const imported = loadUnderstandAnythingGraph();
    const acc = new GraphAccumulator();

    const scanFiles = discoverSourceFiles(PROJECT_ROOT);
    const fileLookup = new Set(scanFiles.map((file) => file.relativePath));

    for (const scanFile of scanFiles) {
      addFileNode(acc, scanFile, imported.summaries);
    }

    for (const scanFile of scanFiles) {
      const ext = path.extname(scanFile.absolutePath);
      if (TS_JS_EXTENSIONS.has(ext)) {
        try {
          analyzeTypeScriptFile(acc, scanFile, fileLookup, imported.summaries);
        } catch (err: any) {
          notes.push(`Skipped AST extraction for ${scanFile.relativePath}: ${err.message}`);
        }
      }
    }

    for (const node of imported.nodes) acc.addNode(node);
    acc.edges.push(...imported.edges);

    const nodes = [...acc.nodes.values()].sort((a, b) => a.id.localeCompare(b.id));
    const edges = acc.edges.sort((a, b) => `${a.from}:${a.to}:${a.type}`.localeCompare(`${b.from}:${b.to}:${b.type}`));

    const stats = calculateStats(nodes, edges, acc.importCount, acc.enrichedCount, imported);

    const nonTsFiles = scanFiles.filter((file) => !TS_JS_EXTENSIONS.has(path.extname(file.absolutePath)));
    if (nonTsFiles.length > 0) {
      notes.push(
        `Indexed ${nonTsFiles.length} non-TypeScript source file(s) at file level. ` +
          `Tree-sitter extraction is the next backend for full Python/Java/C#/Go AST nodes.`
      );
    }

    return {
      version: GRAPH_VERSION,
      generatedAt: new Date().toISOString(),
      root: PROJECT_ROOT,
      profile,
      sources: {
        typescriptCompiler: true,
        symbolParser: true,
        understandAnything: imported.nodes.length > 0 || imported.summaries.size > 0,
        treeSitter: false,
      },
      stats,
      notes,
      nodes,
      edges,
    };
  }

  public static async buildAsync(): Promise<RepoKnowledgeGraphData> {
    const graph = RepoKnowledgeGraph.build();
    const imported: ImportedUnderstandGraph = {
      summaries: new Map(),
      nodes: new Array(graph.stats.importedNodes).fill(null),
      edges: new Array(graph.stats.importedEdges).fill(null),
    };
    const acc = new GraphAccumulator();
    for (const node of graph.nodes) acc.addNode(node);
    acc.edges.push(...graph.edges);
    acc.importCount = graph.stats.imports;
    acc.enrichedCount = graph.stats.enriched;

    const scanFiles = discoverSourceFiles(PROJECT_ROOT);
    let treeSitterFiles = 0;
    for (const scanFile of scanFiles) {
      if (!TREE_SITTER_LANGUAGES.has(scanFile.language)) continue;
      try {
        const extracted = await analyzeTreeSitterFile(acc, scanFile, new Map());
        if (extracted) treeSitterFiles++;
      } catch (err: any) {
        graph.notes.push(`Tree-sitter extraction skipped for ${scanFile.relativePath}: ${err.message}`);
      }
    }

    const nodes = [...acc.nodes.values()].sort((a, b) => a.id.localeCompare(b.id));
    const edges = acc.edges.sort((a, b) => `${a.from}:${a.to}:${a.type}`.localeCompare(`${b.from}:${b.to}:${b.type}`));
    const notes = graph.notes.filter((note) => !note.includes('Tree-sitter extraction is the next backend'));
    const unsupportedNonTs = scanFiles.filter((file) => !TS_JS_EXTENSIONS.has(path.extname(file.absolutePath)) && !TREE_SITTER_LANGUAGES.has(file.language));
    if (treeSitterFiles > 0) {
      notes.push(`Tree-sitter extracted structural declarations/imports from ${treeSitterFiles} Python/Java/C#/Go file(s).`);
    }
    if (unsupportedNonTs.length > 0) {
      notes.push(`Indexed ${unsupportedNonTs.length} source file(s) at file level because no tree-sitter backend is configured for their language yet.`);
    }

    return {
      ...graph,
      generatedAt: new Date().toISOString(),
      sources: {
        ...graph.sources,
        treeSitter: treeSitterFiles > 0,
      },
      stats: calculateStats(nodes, edges, acc.importCount, acc.enrichedCount, imported),
      notes,
      nodes,
      edges,
    };
  }

  public static save(graph: RepoKnowledgeGraphData, outputPath: string = KNOWLEDGE_GRAPH_PATH): string {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(graph, null, 2), 'utf8');
    return outputPath;
  }

  public static load(inputPath: string = KNOWLEDGE_GRAPH_PATH): RepoKnowledgeGraphData | null {
    if (!fs.existsSync(inputPath)) return null;
    try {
      return JSON.parse(fs.readFileSync(inputPath, 'utf8')) as RepoKnowledgeGraphData;
    } catch {
      return null;
    }
  }

  public static refresh(outputPath: string = KNOWLEDGE_GRAPH_PATH): RepoKnowledgeGraphData {
    const graph = RepoKnowledgeGraph.build();
    RepoKnowledgeGraph.save(graph, outputPath);
    return graph;
  }

  public static async refreshAsync(outputPath: string = KNOWLEDGE_GRAPH_PATH): Promise<RepoKnowledgeGraphData> {
    const graph = await RepoKnowledgeGraph.buildAsync();
    RepoKnowledgeGraph.save(graph, outputPath);
    return graph;
  }

  public static toPromptSummary(graph: RepoKnowledgeGraphData, maxPages = 25, maxMethods = 12): string {
    const { profile, stats, sources } = graph;
    const lines: string[] = [];
    lines.push('=== REPOSITORY KNOWLEDGE GRAPH ===');
    lines.push(
      `Profile: ${profile.language}/${profile.automationTool}/${profile.frameworkPattern}` +
        (profile.testFramework ? ` (runner: ${profile.testFramework})` : '')
    );
    const srcParts = [
      sources.typescriptCompiler ? 'TypeScript compiler AST' : null,
      sources.treeSitter ? 'tree-sitter' : null,
      sources.understandAnything ? 'Understand-Anything graph' : null,
    ].filter(Boolean);
    lines.push(
      `Indexed ${stats.files} source files, ${stats.pages} page objects, ${stats.tests} tests, ` +
        `${stats.apis} API modules, ${stats.imports} imports/dependencies ` +
        `(source: ${srcParts.join(' + ') || 'none'}).`
    );
    for (const note of graph.notes) lines.push(`Note: ${note}`);

    const allPages = graph.nodes
      .filter((node) => node.type === 'page')
      .sort((a, b) => codegenRelevanceScore(b.filePath) - codegenRelevanceScore(a.filePath) || a.name.localeCompare(b.name));
    const focusedPages = allPages.filter((node) => codegenRelevanceScore(node.filePath) >= 65);
    const pages = focusedPages.length > 0 ? focusedPages : allPages;
    if (pages.length > 0) {
      lines.push('');
      lines.push('Existing page objects (REUSE or EXTEND these - never recreate):');
      for (const page of pages.slice(0, maxPages)) {
        const url = (page.meta?.urlPattern as string) || (page.meta?.pageIdentity as string);
        const methods = graph.edges
          .filter((edge) => edge.from === page.id && edge.type === 'contains')
          .map((edge) => graph.nodes.find((node) => node.id === edge.to))
          .filter((node): node is KnowledgeNode => !!node && node.type === 'method')
          .map((node) => (node.meta?.signature as string) || node.name);
        lines.push(`- ${page.name} (${page.filePath})${url ? ` url=${url}` : ''}`);
        if (page.meta?.summary) lines.push(`    summary: ${page.meta.summary}`);
        if (methods.length > 0) {
          const shown = methods.slice(0, maxMethods).join('; ');
          const more = methods.length > maxMethods ? ` ... (+${methods.length - maxMethods} more)` : '';
          lines.push(`    methods: ${shown}${more}`);
        }
      }
    }

    const tests = graph.nodes
      .filter((node) => node.type === 'test')
      .filter((node) => codegenRelevanceScore(node.filePath) >= 65)
      .sort((a, b) => codegenRelevanceScore(b.filePath) - codegenRelevanceScore(a.filePath) || (a.filePath ?? '').localeCompare(b.filePath ?? ''))
      .slice(0, 20);
    if (tests.length > 0) {
      lines.push('');
      lines.push('Existing test files (follow local patterns):');
      for (const test of tests) lines.push(`- ${test.filePath}`);
    }

    const importantFiles = graph.nodes
      .filter((node) => node.type === 'file' && ['core', 'cli', 'agent', 'integration'].includes(node.layer ?? ''))
      .sort((a, b) => codegenRelevanceScore(b.filePath) - codegenRelevanceScore(a.filePath) || (a.filePath ?? '').localeCompare(b.filePath ?? ''))
      .slice(0, 20);
    if (importantFiles.length > 0) {
      lines.push('');
      lines.push('Important implementation files by layer:');
      for (const file of importantFiles) lines.push(`- [${file.layer}] ${file.filePath}`);
    }

    return lines.join('\n');
  }

  public static contextSummary(): string {
    try {
      const graph = RepoKnowledgeGraph.load() ?? RepoKnowledgeGraph.build();
      return RepoKnowledgeGraph.toPromptSummary(graph);
    } catch {
      return '';
    }
  }
}
