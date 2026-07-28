import * as fs from 'fs';
import * as path from 'path';

export const PROJECT_ROOT = path.resolve(process.env.WEBPILOT_PROJECT_ROOT || process.cwd());
export const SOURCE_ROOT = path.join(PROJECT_ROOT, 'src');
export const PACKAGES_ROOT = path.join(PROJECT_ROOT, 'packages');
export const TEST_FRAMEWORK_ROOT = path.join(PACKAGES_ROOT, 'test-framework');
export const RESOURCES_ROOT = path.join(PROJECT_ROOT, 'resources');
export const CONFIG_ROOT = path.join(RESOURCES_ROOT, 'config');
export const PROMPTS_ROOT = path.join(RESOURCES_ROOT, 'prompts');
export const ASSETS_ROOT = path.join(RESOURCES_ROOT, 'assets');
export const RUNTIME_ROOT = path.join(PROJECT_ROOT, 'runtime');
export const REPORTS_ROOT = path.join(RUNTIME_ROOT, 'reports');
export const ARTIFACTS_ROOT = path.join(RUNTIME_ROOT, 'artifacts');
export const HEALING_CACHE_ROOT = path.join(RUNTIME_ROOT, 'healing-cache');
export const KNOWLEDGE_ROOT = path.join(RUNTIME_ROOT, 'knowledge');
export const KNOWLEDGE_GRAPH_PATH = path.join(KNOWLEDGE_ROOT, 'knowledge-graph.json');
export const KNOWLEDGE_INTERMEDIATE_ROOT = path.join(KNOWLEDGE_ROOT, 'intermediate');
export const KNOWLEDGE_SCAN_MANIFEST_PATH = path.join(KNOWLEDGE_INTERMEDIATE_ROOT, 'scan-manifest.json');
export const KNOWLEDGE_MERGE_REPORT_PATH = path.join(KNOWLEDGE_INTERMEDIATE_ROOT, 'merge-report.json');
export const CODEGEN_ROOT = path.join(RUNTIME_ROOT, 'codegen');
export const CODEGEN_TRACES_DIR = path.join(CODEGEN_ROOT, 'traces');
export const CODEGEN_PLANS_DIR = path.join(CODEGEN_ROOT, 'plans');
export const CODEGEN_HISTORY_DIR = path.join(CODEGEN_ROOT, 'history');
export const SELECTORS_ROOT = path.join(RUNTIME_ROOT, 'selectors');
export const SELECTOR_REGISTRY_PATH = path.join(SELECTORS_ROOT, 'registry.json');
export const HEALING_PROPOSALS_DIR = path.join(SELECTORS_ROOT, 'healing-proposals');

// Feature 09: requirements coverage and regression manager
export const REQUIREMENTS_ROOT = path.join(RUNTIME_ROOT, 'requirements');
export const REQUIREMENTS_NORMALIZED_DIR = path.join(REQUIREMENTS_ROOT, 'normalized');
export const REQUIREMENTS_NORMALIZED_PATH = path.join(REQUIREMENTS_NORMALIZED_DIR, 'requirements.json');
export const REQUIREMENTS_COVERAGE_DIR = path.join(REQUIREMENTS_ROOT, 'coverage');
export const REQUIREMENTS_COVERAGE_PATH = path.join(REQUIREMENTS_COVERAGE_DIR, 'requirement-coverage.json');
export const REQUIREMENTS_GAPS_PATH = path.join(REQUIREMENTS_COVERAGE_DIR, 'coverage-gaps.json');
export const REGRESSION_PACKS_DIR = path.join(REQUIREMENTS_ROOT, 'regression-packs');
export const REQUIREMENT_MAP_PATH = path.join(CONFIG_ROOT, 'requirement-map.yaml');
export const ADO_TEST_MAP_PATH = path.join(CONFIG_ROOT, 'ado-test-map.yaml');
export const ADO_RUNTIME_DIR = path.join(RUNTIME_ROOT, 'ado');
export const TESTS_WEB_ROOT = path.join(PROJECT_ROOT, 'tests', 'web');
export const TESTS_API_ROOT = path.join(PROJECT_ROOT, 'tests', 'api');

/**
 * runtime/ is gitignored working state — it is no longer scaffolded by
 * `webpilot init`. Commands that write under runtime/ call this at startup so
 * every writer can assume its directory exists.
 */
export function ensureRuntimeDirs(): void {
  const dirs = [
    path.join(REPORTS_ROOT, 'html'),
    path.join(REPORTS_ROOT, 'data', 'summaries'),
    path.join(REPORTS_ROOT, 'data', 'execution-history'),
    path.join(REPORTS_ROOT, 'data', 'llm-usage'),
    path.join(REPORTS_ROOT, 'data', 'api'),
    path.join(REPORTS_ROOT, 'data', 'logs'),
    path.join(REPORTS_ROOT, 'markdown'),
    path.join(REPORTS_ROOT, 'junit'),
    path.join(REPORTS_ROOT, 'videos'),
    path.join(REPORTS_ROOT, 'traces'),
    path.join(REPORTS_ROOT, 'assets'),
    ARTIFACTS_ROOT,
    HEALING_CACHE_ROOT,
    KNOWLEDGE_ROOT,
    path.join(RUNTIME_ROOT, 'site-knowledge', 'pages'),
    path.join(RUNTIME_ROOT, 'site-knowledge', 'scenarios'),
    path.join(RUNTIME_ROOT, 'rulebooks'),
    CODEGEN_ROOT,
    path.join(CODEGEN_ROOT, 'failures'),
  ];
  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
