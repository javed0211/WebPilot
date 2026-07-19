import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('report shell contract', () => {
  const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
  const app = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
  const insights = readFileSync(resolve(process.cwd(), 'src/components/AiInsights.tsx'), 'utf8');
  const testCasesPage = readFileSync(resolve(process.cwd(), 'src/components/TestCasesPage.tsx'), 'utf8');
  const detail = readFileSync(resolve(process.cwd(), 'src/components/Detail.tsx'), 'utf8');

  it('retains the report data injection marker', () => {
    expect(html).toContain('id="webpilot-report-data"');
    expect(html).toContain('type="application/json"');
  });

  it('provides primary hash routes and test detail routing', () => {
    for (const route of ['overview', 'test-cases', 'trends', 'ai-analysis', 'logs', 'environment']) {
      expect(app).toContain(`'${route}'`);
    }
    expect(app).toContain('test-');
    expect(app).toContain('test/');
    expect(app).toContain('?tab=');
  });

  it('implements AI insights, theme persistence, and the mobile drawer', () => {
    expect(html + app).toContain('webpilot-report-theme');
    expect(insights).toContain('AI INSIGHTS');
    expect(insights).toContain('computeInsights');
    expect(app).toContain('Open menu');
    expect(app).toContain('Close navigation');
  });

  it('provides a searchable test-cases master-detail page', () => {
    expect(app).toContain('TestCasesPage');
    expect(app).not.toContain('TestCaseRail');
    expect(testCasesPage).toContain('Test cases');
    expect(testCasesPage).toContain('#test-cases?test=');
    expect(testCasesPage).toContain('aria-current');
    expect(testCasesPage).toContain('Search test cases');
    expect(testCasesPage).toContain('showBack={false}');
    expect(detail).toContain('showBack = true');
  });
});
