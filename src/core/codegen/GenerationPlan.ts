import { AssertionSummary } from '../assertions/AssertionCandidate';

export type FileOperation = 'create' | 'extend' | 'reuse';

export interface CodegenProfilePlan {
  language: string;
  automationTool: string;
  frameworkPattern: string;
  testFramework?: string;
}

export interface PlannedFile {
  path: string;
  operation: FileOperation;
  reason: string;
  className?: string;
  urlPattern?: string;
}

export interface GenerationPlan {
  version: string;
  scenarioSlug: string;
  profile: CodegenProfilePlan;
  specPath: string;
  files: PlannedFile[];
  pageObjects: PlannedFile[];
  notes: string[];
  generatedAt: string;
}

export interface CodegenMetadata {
  generatedBy: 'webpilot';
  scenarioSlug: string;
  sourceTrace: string;
  sourcePlan: string;
  profile: string;
  specPath?: string;
  pageObjectPaths?: string[];
  generatedFiles?: string[];
  replayCommand?: string;
  validationCommand?: string | null;
  assertionSummary?: AssertionSummary;
  updatedAt: string;
  mode: 'deterministic' | 'llm';
}
