import * as fs from 'fs';
import * as path from 'path';

export interface CiWorkflowOptions {
  nodeVersion?: string;
  testPath?: string;
  provider?: string;
}

export const DEFAULT_CI_WORKFLOW_PATH = path.join('.github', 'workflows', 'webpilot.yml');

export function renderGithubActionsWorkflow(options: CiWorkflowOptions = {}): string {
  const nodeVersion = options.nodeVersion || '20';
  const testPath = options.testPath || 'tests/web';
  const provider = options.provider || 'browser-use';

  return `name: WebPilot

on:
  pull_request:
  push:
    branches: [main]

jobs:
  webpilot:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${nodeVersion}
          cache: npm
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npx webpilot ci doctor --provider ${provider}
      - run: npx webpilot ci run ${testPath} --provider ${provider}
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: webpilot-report
          path: runtime/reports
`;
}

export function writeGithubActionsWorkflow(options: {
  force?: boolean;
  outputPath?: string;
  workflow?: CiWorkflowOptions;
} = {}): { path: string; written: boolean; reason?: string } {
  const outputPath = path.resolve(process.cwd(), options.outputPath || DEFAULT_CI_WORKFLOW_PATH);
  if (fs.existsSync(outputPath) && !options.force) {
    return {
      path: outputPath,
      written: false,
      reason: 'Workflow already exists. Re-run with --force to overwrite it.',
    };
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, renderGithubActionsWorkflow(options.workflow), 'utf8');
  return { path: outputPath, written: true };
}
