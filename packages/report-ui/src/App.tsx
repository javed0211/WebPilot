import { useEffect, useState } from 'react';
import { BarChart3, LayoutDashboard, ListChecks, Menu, Moon, Server, Sun, Terminal, X, type LucideIcon } from 'lucide-react';
import type { Report } from './types';
import { date } from './lib/format';
import logoUrl from './assets/webpilot-logo.png';
import { Overview } from './components/Overview';
import { Trends } from './components/Trends';
import { AiAnalysisPage } from './components/AiAnalysisPage';
import { Environment } from './components/Environment';
import { Logs } from './components/Logs';
import { Detail } from './components/Detail';
import { Empty } from './components/Empty';
import { Status } from './components/Status';
import { AiGlyph } from './components/shared';
import { TestCasesPage } from './components/TestCasesPage';

type Route = 'overview' | 'test-cases' | 'trends' | 'ai-analysis' | 'environment' | 'logs' | 'test';
type NavIcon = LucideIcon | typeof AiGlyph;
const navItems = (report: Report): [Route, string, NavIcon][] => [['overview', 'Overview', LayoutDashboard], ['test-cases', 'Test cases', ListChecks], ['trends', 'Trends', BarChart3], ...(report.suiteAiAnalysis || report.testCases.some(t => t.aiAnalysis) ? [['ai-analysis', 'AI analysis', AiGlyph] as [Route, string, NavIcon]] : []), ['environment', 'Environment', Server], ['logs', 'Test logs', Terminal]];
function parseHash(hash: string) {
  const raw = (hash || '#overview').slice(1), [path, query = ''] = raw.split('?');
  const params = new URLSearchParams(query);
  if (path === 'test-cases') return { route: 'test-cases' as Route, slug: params.get('test') || undefined, tab: params.get('tab') || 'timeline' };
  const legacy = path.startsWith('test/'), modern = path.startsWith('test-');
  return { route: (legacy || modern ? 'test' : path || 'overview') as Route, slug: legacy ? path.slice(5) : modern ? path.slice(5) : undefined, tab: params.get('tab') || 'timeline' };
}

export function App({report}:{report:Report}) {
  const [hash,setHash]=useState(location.hash||'#overview'), [drawer,setDrawer]=useState(false);
  const [theme,setTheme]=useState(()=>localStorage.getItem('webpilot-report-theme')||document.documentElement.dataset.theme||'light');
  useEffect(()=>{const change=()=>{setHash(location.hash||'#overview');setDrawer(false)};addEventListener('hashchange',change);return()=>removeEventListener('hashchange',change)},[]);
  useEffect(()=>{document.documentElement.dataset.theme=theme;localStorage.setItem('webpilot-report-theme',theme)},[theme]);
  const parsed=parseHash(hash);
  const selectedSlug=parsed.route==='test-cases'?(parsed.slug||report.testCases[0]?.slug):parsed.slug;
  const selected=selectedSlug?report.testCases.find(t=>t.slug===selectedSlug):undefined;
  const setTab=(tab:string)=>{if(selected)location.hash=parsed.route==='test-cases'?`test-cases?test=${encodeURIComponent(selected.slug)}&tab=${encodeURIComponent(tab)}`:`test-${selected.slug}?tab=${tab}`};
  return <div className="app">
    <button className={`backdrop ${drawer?'show':''}`} aria-label="Close navigation" onClick={()=>setDrawer(false)}/>
    <aside className={`sidebar ${drawer?'open':''}`} aria-label="Report navigation">
      <div className="brand"><img className="brand-logo" src={logoUrl} alt="WebPilot — Automate. Navigate. Achieve." /><button className="icon mobile-close" onClick={()=>setDrawer(false)} aria-label="Close menu"><X/></button></div>
      <nav><section className="nav-group"><h2>REPORT</h2>{navItems(report).map(([id,label,Icon])=><a className={parsed.route===id||(parsed.route==='test'&&id==='test-cases')?'active':''} href={`#${id}`} key={id}><Icon/><span>{label}</span></a>)}</section></nav>
      <footer className="sidebar-foot"><div><span>Generated</span><strong>{date(report.generatedAt)}</strong></div><button className="theme" onClick={()=>setTheme(theme==='dark'?'light':'dark')} aria-label={`Use ${theme==='dark'?'light':'dark'} theme`}>{theme==='dark'?<Sun/>:<Moon/>}<span>{theme==='dark'?'Light':'Dark'} theme</span></button><small>WebPilot report · schema v1</small></footer>
    </aside>
    <main>
      <header className="topbar"><button className="icon menu" onClick={()=>setDrawer(true)} aria-label="Open menu"><Menu/></button><div><span>{parsed.route==='test'?'EXECUTION DETAIL':`REPORT / ${parsed.route.replace('-', ' ').toUpperCase()}`}</span><strong>{parsed.route==='test'&&selected?selected.testName:report.suiteName}</strong></div><div className="top-meta"><span>{date(report.generatedAt)}</span><Status value={report.overview.failed?'FAILED':'PASSED'}/><button className="icon theme-top" onClick={()=>setTheme(theme==='dark'?'light':'dark')} aria-label="Toggle theme">{theme==='dark'?<Sun/>:<Moon/>}</button></div></header>
      <div className="content">{parsed.route==='test'?(selected?<Detail test={selected} tab={parsed.tab} onTab={setTab}/>:<Empty title="Test not found" copy="The requested test does not exist in this report."/>):parsed.route==='test-cases'?<TestCasesPage testCases={report.testCases} selectedSlug={selectedSlug} tab={parsed.tab} onTab={setTab}/>:<Page route={parsed.route} report={report}/>}</div>
    </main>
  </div>
}

function Page({route,report}:{route:Route;report:Report}) {
  if(route==='trends') return <Trends report={report}/>;
  if(route==='ai-analysis') return <AiAnalysisPage report={report}/>;
  if(route==='logs') return <Logs report={report}/>;
  if(route==='environment') return <Environment report={report}/>;
  return <Overview report={report}/>;
}
