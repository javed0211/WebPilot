import { ArrowRight, Sparkles } from 'lucide-react';
import type { Report } from '../types';
import { excerpt } from '../lib/format';
import { Markdown } from '../lib/markdown';
import { Empty } from './Empty';
import { Title } from './shared';

export function AiAnalysisPage({ report }: { report: Report }) {
  const tests = report.testCases.filter(t => t.aiAnalysis);
  return <><Title eyebrow="MODEL-ASSISTED TRIAGE" title="AI analysis" copy="Generated findings grounded in this execution report." />
    {report.suiteAiAnalysis ? <section className="panel analysis"><Markdown value={report.suiteAiAnalysis} /></section> : <Empty icon={Sparkles} title="No suite analysis" copy="This run does not include suite-level AI analysis." />}
    {tests.length > 0 && <section className="panel analysis-links"><h2>Test analyses</h2>{tests.map(t => <a href={`#test-${t.slug}?tab=analysis`} key={t.slug}><div><strong>{t.testName}</strong><span>{excerpt(t.aiAnalysis)}</span></div><ArrowRight /></a>)}</section>}
  </>;
}
