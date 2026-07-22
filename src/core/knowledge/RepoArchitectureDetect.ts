import * as fs from 'fs';
import * as path from 'path';
import { ConfigManager } from '../ConfigManager';
import { PROJECT_ROOT, TEST_FRAMEWORK_ROOT } from '../ProjectPaths';

export type CodegenArchitecture = 'flat' | 'pom' | 'bdd' | 'pom-bdd';

export interface ArchitectureDetection {
  architecture: CodegenArchitecture;
  /** Profile key used by deterministic emitters (`simple` maps from `flat`). */
  frameworkPattern: string;
  confidence: 'high' | 'medium' | 'low';
  reasons: string[];
  signals: {
    pageObjectFiles: number;
    pagesDirs: number;
    featureFiles: number;
    stepDirs: number;
    flatSpecs: number;
  };
}

function existsDir(abs: string): boolean {
  try {
    return fs.existsSync(abs) && fs.statSync(abs).isDirectory();
  } catch {
    return false;
  }
}

function walkFiles(root: string, exts: string[], max = 400): string[] {
  const out: string[] = [];
  if (!existsDir(root)) return out;
  const stack = [root];
  while (stack.length && out.length < max) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(abs);
      } else if (exts.some((ext) => entry.name.endsWith(ext))) {
        out.push(abs);
      }
    }
  }
  return out;
}

function countMatching(files: string[], re: RegExp): number {
  return files.filter((f) => re.test(f.replace(/\\/g, '/'))).length;
}

/**
 * Detect flat / POM / BDD layout from the test framework tree.
 * Does not require Cursor or Understand-Anything.
 */
export function detectRepoArchitecture(
  root: string = PROJECT_ROOT
): ArchitectureDetection {
  const reasons: string[] = [];
  const tf =
    TEST_FRAMEWORK_ROOT && fs.existsSync(TEST_FRAMEWORK_ROOT)
      ? TEST_FRAMEWORK_ROOT
      : path.join(root, 'packages', 'test-framework');
  const pagesRoot = path.join(tf, 'pages');
  const testsRoot = path.join(tf, 'tests');
  const featuresRootCandidates = [
    path.join(tf, 'features'),
    path.join(root, 'features'),
    path.join(tf, 'Features'),
  ];
  const stepDirCandidates = [
    path.join(tf, 'steps'),
    path.join(tf, 'step_definitions'),
    path.join(tf, 'step-definitions'),
    path.join(root, 'features', 'steps'),
  ];

  const pageFiles = existsDir(pagesRoot)
    ? walkFiles(pagesRoot, ['.ts', '.js', '.py', '.java', '.cs'])
    : [];
  const pageObjectFiles = pageFiles.filter((f) => {
    const base = path.basename(f);
    return /Page\.(ts|js|py|java|cs)$/i.test(base) || /page[_-]?object/i.test(f);
  }).length;

  let pagesDirs = 0;
  if (existsDir(pagesRoot)) {
    pagesDirs = fs
      .readdirSync(pagesRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.')).length;
  }

  let featureFiles = 0;
  for (const feat of featuresRootCandidates) {
    featureFiles += walkFiles(feat, ['.feature']).length;
  }

  let stepDirs = 0;
  for (const step of stepDirCandidates) {
    if (existsDir(step)) stepDirs++;
  }

  const specFiles = existsDir(testsRoot)
    ? walkFiles(testsRoot, ['.spec.ts', '.test.ts', '.spec.js'])
    : [];
  const flatSpecs = countMatching(
    specFiles,
    /packages\/test-framework\/tests\/[^/]+\.(spec|test)\.(ts|js)$/
  );

  const signals = { pageObjectFiles, pagesDirs, featureFiles, stepDirs, flatSpecs };

  const hasPom = pageObjectFiles >= 1 || (existsDir(pagesRoot) && pagesDirs >= 1);
  const hasBdd = featureFiles >= 1 || stepDirs >= 1;
  const looksFlat =
    !hasPom &&
    !hasBdd &&
    (flatSpecs >= 1 || (!existsDir(pagesRoot) && specFiles.length >= 0));

  let architecture: CodegenArchitecture;
  let confidence: ArchitectureDetection['confidence'];

  if (hasPom && hasBdd) {
    architecture = 'pom-bdd';
    confidence = featureFiles >= 1 && pageObjectFiles >= 1 ? 'high' : 'medium';
    reasons.push(`Found ${pageObjectFiles} page object(s) and ${featureFiles} feature file(s)`);
  } else if (hasBdd && !hasPom) {
    architecture = 'bdd';
    confidence = featureFiles >= 1 ? 'high' : 'medium';
    reasons.push(`Found BDD signals (${featureFiles} features, ${stepDirs} step dir(s))`);
  } else if (hasPom) {
    architecture = 'pom';
    confidence = pageObjectFiles >= 2 || pagesDirs >= 1 ? 'high' : 'medium';
    reasons.push(
      `Found POM layout (${pageObjectFiles} page object file(s), ${pagesDirs} site folder(s) under pages/)`
    );
  } else if (looksFlat) {
    architecture = 'flat';
    confidence = flatSpecs >= 1 ? 'high' : 'low';
    reasons.push(
      flatSpecs >= 1
        ? `Found ${flatSpecs} flat spec(s) without pages/`
        : 'No pages/ or features/ — defaulting to flat/simple emit'
    );
  } else {
    architecture = 'pom';
    confidence = 'low';
    reasons.push('Ambiguous layout — defaulting to POM');
  }

  return {
    architecture,
    frameworkPattern: architectureToFrameworkPattern(architecture),
    confidence,
    reasons,
    signals,
  };
}

export function architectureToFrameworkPattern(architecture: CodegenArchitecture): string {
  if (architecture === 'flat') return 'simple';
  return architecture;
}

export function frameworkPatternToArchitecture(pattern: string): CodegenArchitecture {
  const p = pattern.trim().toLowerCase();
  if (p === 'simple' || p === 'flat') return 'flat';
  if (p === 'bdd') return 'bdd';
  if (p === 'pom-bdd') return 'pom-bdd';
  return 'pom';
}

/**
 * Resolve architecture for codegen: explicit CLI/config override wins;
 * otherwise use filesystem detection.
 */
export function resolveCodegenArchitecture(options?: {
  override?: string | null;
  preferConfig?: boolean;
}): ArchitectureDetection {
  const override = options?.override?.trim();
  if (override && ['flat', 'pom', 'bdd', 'pom-bdd', 'simple'].includes(override)) {
    const architecture = frameworkPatternToArchitecture(override);
    return {
      architecture,
      frameworkPattern: architectureToFrameworkPattern(architecture),
      confidence: 'high',
      reasons: [`Explicit override: ${override}`],
      signals: detectRepoArchitecture().signals,
    };
  }

  if (options?.preferConfig) {
    try {
      const configured = ConfigManager.getInstance().get('project.frameworkPattern', '') as string;
      if (configured && configured.trim()) {
        const architecture = frameworkPatternToArchitecture(configured);
        return {
          architecture,
          frameworkPattern: architectureToFrameworkPattern(architecture),
          confidence: 'medium',
          reasons: [`project.frameworkPattern=${configured}`],
          signals: detectRepoArchitecture().signals,
        };
      }
    } catch {
      // fall through to detect
    }
  }

  return detectRepoArchitecture();
}
