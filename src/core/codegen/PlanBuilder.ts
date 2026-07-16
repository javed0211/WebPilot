import * as fs from 'fs';
import * as path from 'path';
import { ConfigManager } from '../ConfigManager';
import { RepoKnowledgeGraph, KnowledgeNode } from '../knowledge/RepoKnowledgeGraph';
import { ExecutionTrace } from './ExecutionTrace';
import { CodegenProfilePlan, GenerationPlan, PlannedFile } from './GenerationPlan';
import { CodegenProfile } from './profiles/CodegenProfile';
import { CodegenProfileRegistry } from './profiles/CodegenProfileRegistry';
import {
  hostnameFromUrl,
  inferSitePageFromUrl,
  isInventedFlatPageName,
} from './SitePageNaming';

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

function pagePathForClass(
  profileAdapter: CodegenProfile,
  profile: CodegenProfilePlan,
  className: string,
  filePath?: string,
  url?: string
): string {
  if (filePath) return filePath.replace(/\\/g, '/');
  return profileAdapter.pagePath(className, profile, url);
}

function patternMatchesUrl(pattern: string, url: string): boolean {
  if (!pattern || !url) return false;
  const raw = pattern.replace(/^\/([\s\S]+)\/[a-z]*$/i, '$1');
  try {
    if (new RegExp(raw).test(url)) return true;
  } catch {
    /* fall through */
  }
  return url.includes(pattern);
}

function scorePageNode(node: KnowledgeNode, url: string, host: string | null): number {
  const file = (node.filePath || '').toLowerCase();
  const name = (node.name || '').toLowerCase();
  const pattern = String(node.meta?.urlPattern || '');
  let score = 0;

  if (host) {
    const hostToken = host.split('.')[0];
    if (file.includes(`/pages/${hostToken}/`) || file.includes(`/pages/${host.replace(/\./g, '')}/`)) {
      score += 12;
    }
    if (name.includes(hostToken)) score += 3;
    if (pattern.toLowerCase().includes(host)) score += 4;
    if (pattern.toLowerCase().includes(hostToken)) score += 2;
  }

  // Deprioritize invented flat names from prior bad codegen (Www*, Enwikipediaorg*).
  if (isInventedFlatPageName(node.name) || /^www/i.test(node.name) || /^en[a-z0-9]+org/i.test(node.name)) {
    score -= 20;
  }

  if (pattern && patternMatchesUrl(pattern, url)) score += 15;

  try {
    const pathName = new URL(url).pathname.replace(/\/$/, '') || '/';
    if ((pathName === '/' || pathName === '') && /homepage$/i.test(node.name)) score += 4;
    if (pathName.includes('/wiki/Talk:') && /talk/i.test(node.name)) score += 6;
    if (pathName.includes('action=history') && /history/i.test(node.name)) score += 6;
    if (/\/wiki\/[^/]+$/i.test(pathName) && !/Talk:/i.test(pathName) && /article/i.test(node.name)) {
      score += 5;
    }
    const lastSeg =
      pathName.split('/').filter(Boolean).pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || '';
    if (lastSeg && name.includes(lastSeg)) score += 2;
  } catch {
    /* ignore */
  }

  return score;
}

function matchPageForUrl(
  url: string | undefined,
  profileAdapter: CodegenProfile,
  profile: CodegenProfilePlan,
  graph = RepoKnowledgeGraph.load()
): PlannedFile | null {
  if (!url || !graph) return null;
  if (profile.language !== 'typescript' || profile.automationTool !== 'playwright') return null;

  const host = hostnameFromUrl(url);
  const pageNodes = graph.nodes.filter((node) => node.type === 'page');

  const scored = pageNodes
    .map((node) => ({ node, score: scorePageNode(node, url, host) }))
    .filter((row) => row.score >= 8)
    .sort((a, b) => b.score - a.score || a.node.name.localeCompare(b.node.name));

  if (!scored.length) return null;

  const node = scored[0].node;
  // Never "reuse" invented flat Www* as the plan target — create site-folder pages instead.
  if (isInventedFlatPageName(node.name)) return null;

  const pattern = (node.meta?.urlPattern as string) || host || url;
  const summaryHint = node.meta?.summary ? ` — ${String(node.meta.summary).slice(0, 120)}` : '';
  const fullPath = path.join(
    process.cwd(),
    node.filePath || pagePathForClass(profileAdapter, profile, node.name, undefined, url)
  );
  const exists = fs.existsSync(fullPath);
  // Only hand-maintained site folders are "reuse" (skip inventing). Auto-generated
  // pages/<site>/* from prior codegen must remain "extend" so new ActHistory methods land.
  const curatedPath = String(node.filePath || '');
  const curated =
    /\/pages\/(wikipedia|playwright)\//i.test(curatedPath) ||
    /\b@curated\b/i.test(fs.existsSync(fullPath) ? fs.readFileSync(fullPath, 'utf8').slice(0, 800) : '');

  return {
    path: pagePathForClass(profileAdapter, profile, node.name, node.filePath, url),
    operation: exists ? (curated ? 'reuse' : 'extend') : 'create',
    reason: `Matched existing page object ${node.name} (score ${scored[0].score})${summaryHint}`,
    className: node.name,
    urlPattern: pattern,
  };
}

export class PlanBuilder {
  public static build(trace: ExecutionTrace): GenerationPlan {
    const profile = readProfile();
    const profileAdapter = CodegenProfileRegistry.resolve(profile);
    const notes: string[] = [];
    const pageObjects: PlannedFile[] = [];
    const seenPages = new Set<string>();

    const urls = [...new Set(trace.steps.map((step) => step.url).filter(Boolean) as string[])];
    const graph = RepoKnowledgeGraph.load();
    for (const url of urls) {
      const matched = matchPageForUrl(url, profileAdapter, profile, graph || undefined);
      if (matched) {
        if (!seenPages.has(matched.path)) {
          pageObjects.push(matched);
          seenPages.add(matched.path);
          if (graph) {
            const pageNode = graph.nodes.find(
              (node) => node.type === 'page' && node.name === matched.className
            );
            if (pageNode) {
              const methods = graph.edges
                .filter((edge) => edge.from === pageNode.id && edge.type === 'contains')
                .map((edge) => graph.nodes.find((node) => node.id === edge.to)?.name)
                .filter(Boolean)
                .slice(0, 8);
              if (methods.length) {
                notes.push(`Reuse methods on ${matched.className}: ${methods.join(', ')}`);
              }
            }
          }
        }
        continue;
      }

      // Prefer site-folder naming (pages/booking/BookingHomePage.ts) — never Www* flat invent.
      const inferred = inferSitePageFromUrl(url);
      const pagePath =
        profile.language === 'typescript' && profile.automationTool === 'playwright'
          ? inferred.pagePath
          : pagePathForClass(profileAdapter, profile, inferred.className, undefined, url);
      if (!seenPages.has(pagePath)) {
        pageObjects.push({
          path: pagePath,
          operation: fs.existsSync(path.join(process.cwd(), pagePath)) ? 'extend' : 'create',
          reason: `No curated page matched ${url} — creating site-folder ${inferred.className}`,
          className: inferred.className,
          urlPattern: url,
        });
        seenPages.add(pagePath);
        notes.push(`Site-folder page plan: ${pagePath}`);
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
