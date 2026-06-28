import * as fs from 'fs';
import * as path from 'path';
import { ConfigManager } from '../ConfigManager';
import { RepoKnowledgeGraph } from '../knowledge/RepoKnowledgeGraph';
import { ExecutionTrace } from './ExecutionTrace';
import { CodegenProfilePlan, GenerationPlan, PlannedFile } from './GenerationPlan';
import { CodegenProfile } from './profiles/CodegenProfile';
import { CodegenProfileRegistry } from './profiles/CodegenProfileRegistry';

const PLAN_VERSION = '1.0.0';

function readProfile(): CodegenProfilePlan {
  const config = ConfigManager.getInstance();
  return {
    language: config.get('project.language', 'typescript'),
    automationTool: config.get('project.automationTool', 'playwright'),
    frameworkPattern: config.get('project.frameworkPattern', 'pom'),
    testFramework: config.get('project.testFramework', 'playwright-test'),
  };
}

function pagePathForClass(profileAdapter: CodegenProfile, profile: CodegenProfilePlan, className: string, filePath?: string): string {
  if (filePath) return filePath.replace(/\\/g, '/');
  return profileAdapter.pagePath(className, profile);
}

function matchPageForUrl(
  url: string | undefined,
  profileAdapter: CodegenProfile,
  profile: CodegenProfilePlan,
  graph = RepoKnowledgeGraph.load()
): PlannedFile | null {
  if (!url || !graph) return null;
  if (profile.language !== 'typescript' || profile.automationTool !== 'playwright') return null;
  for (const node of graph.nodes) {
    if (node.type !== 'page') continue;
    const pattern = (node.meta?.urlPattern as string) || '';
    if (!pattern) continue;
    try {
      const regex = new RegExp(pattern);
      if (regex.test(url)) {
        return {
          path: pagePathForClass(profileAdapter, profile, node.name, node.filePath),
          operation: fs.existsSync(
            path.join(process.cwd(), node.filePath || pagePathForClass(profileAdapter, profile, node.name))
          )
            ? 'extend'
            : 'create',
          reason: `Matched existing page object ${node.name} via urlPattern ${pattern}`,
          className: node.name,
          urlPattern: pattern,
        };
      }
    } catch {
      if (url.includes(pattern)) {
        return {
          path: pagePathForClass(profileAdapter, profile, node.name, node.filePath),
          operation: 'extend',
          reason: `Matched existing page object ${node.name} via url substring ${pattern}`,
          className: node.name,
          urlPattern: pattern,
        };
      }
    }
  }
  return null;
}

function inferPageClassName(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/\./g, '');
    const segments = parsed.pathname.split('/').filter(Boolean);
    const route = segments[segments.length - 1] || 'home';
    const routeName = route
      .replace(/[^a-zA-Z0-9]+/g, ' ')
      .trim()
      .split(/\s+/)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join('');
    return `${host.charAt(0).toUpperCase()}${host.slice(1)}${routeName || 'Home'}Page`;
  } catch {
    return 'GeneratedPage';
  }
}

export class PlanBuilder {
  public static build(trace: ExecutionTrace): GenerationPlan {
    const profile = readProfile();
    const profileAdapter = CodegenProfileRegistry.resolve(profile);
    const notes: string[] = [];
    const pageObjects: PlannedFile[] = [];
    const seenPages = new Set<string>();

    const urls = [...new Set(trace.steps.map((step) => step.url).filter(Boolean) as string[])];
    for (const url of urls) {
      const matched = matchPageForUrl(url, profileAdapter, profile);
      if (matched) {
        if (!seenPages.has(matched.path)) {
          pageObjects.push(matched);
          seenPages.add(matched.path);
        }
        continue;
      }

      const className = inferPageClassName(url);
      const pagePath = pagePathForClass(profileAdapter, profile, className);
      if (!seenPages.has(pagePath)) {
        pageObjects.push({
          path: pagePath,
          operation: fs.existsSync(path.join(process.cwd(), pagePath)) ? 'extend' : 'create',
          reason: `No existing page object matched ${url}`,
          className,
          urlPattern: url,
        });
        seenPages.add(pagePath);
      }
    }

    const specPath = profileAdapter.specPath(trace.scenarioSlug, profile);
    const files: PlannedFile[] = [
      {
        path: specPath,
        operation: fs.existsSync(path.join(process.cwd(), specPath)) ? 'extend' : 'create',
        reason: 'Primary generated Playwright spec for the scenario',
      },
      ...pageObjects,
    ];

    return {
      version: PLAN_VERSION,
      scenarioSlug: trace.scenarioSlug,
      profile,
      specPath,
      files,
      pageObjects,
      notes,
      generatedAt: new Date().toISOString(),
    };
  }
}
