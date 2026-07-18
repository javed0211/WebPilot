import { SuiteExecutionReport, TestCaseReport, ReportStep } from './types';
import { REPORT_LOGO_HREF, REPORT_SCRIPTS, REPORT_STYLES } from './reportTheme';
import { browserProviderDisplayName } from '../browserProviders/BrowserProvider';

/* ── Utilities ──────────────────────────────────────────────────── */

function esc(s: unknown): string {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function providerLabel(br: { provider?: { provider?: string; displayName?: string } }): string {
  return (
    br.provider?.displayName ||
    browserProviderDisplayName(br.provider?.provider) ||
    'Local Playwright'
  );
}

function pathBasename(p: string): string {
  return p.split('/').pop() || p;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return String(n);
}

function fmtDuration(ms?: number): string {
  if (!ms) return '—';
  if (ms < 1000) return ms + 'ms';
  return (ms / 1000).toFixed(1) + 's';
}

function mdToHtml(text: string): string {
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^### (.+)$/gm, '<h4 style="font-size:12px;font-weight:700;color:var(--text);margin:12px 0 4px">$1</h4>')
    .replace(/^## (.+)$/gm, '<h3 style="font-size:13px;font-weight:700;color:var(--text);margin:14px 0 6px">$1</h3>')
    .replace(/^# (.+)$/gm, '<h2 style="font-size:14px;font-weight:700;color:var(--text);margin:16px 0 8px">$1</h2>')
    .replace(/^- (.+)$/gm, '<li style="margin:2px 0;padding-left:4px">$1</li>')
    .replace(/(<li.*<\/li>\n?)+/g, (m) => `<ul style="padding-left:18px;margin:6px 0">${m}</ul>`)
    .replace(/\n\n/g, '</p><p style="margin:6px 0">')
    .replace(/\n/g, '<br/>');
}

/* ── Icons (inline SVG snippets) ────────────────────────────────── */

const ICON_OVERVIEW = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1" stroke-width="2"/><rect x="14" y="3" width="7" height="7" rx="1" stroke-width="2"/><rect x="3" y="14" width="7" height="7" rx="1" stroke-width="2"/><rect x="14" y="14" width="7" height="7" rx="1" stroke-width="2"/></svg>`;
const ICON_AI = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/></svg>`;
const ICON_ENV = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2"/></svg>`;
const ICON_TESTS = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"/></svg>`;
const ICON_PRICING = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`;
const ICON_LOGS = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>`;
const ICON_CHECK = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/></svg>`;
const ICON_X = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"/></svg>`;
const ICON_BELL = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/></svg>`;
const ICON_CAL = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" stroke-width="2"/><line x1="16" y1="2" x2="16" y2="6" stroke-width="2" stroke-linecap="round"/><line x1="8" y1="2" x2="8" y2="6" stroke-width="2" stroke-linecap="round"/><line x1="3" y1="10" x2="21" y2="10" stroke-width="2"/></svg>`;
const ICON_MENU = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/></svg>`;
const ICON_SETTINGS = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><circle cx="12" cy="12" r="3" stroke-width="2"/></svg>`;
const ICON_CHROME = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="10" stroke-width="1.5"/><circle cx="12" cy="12" r="4" stroke-width="1.5"/><line x1="21.17" y1="8" x2="12" y2="8" stroke-width="1.5"/><line x1="3.95" y1="6.06" x2="8.54" y2="14" stroke-width="1.5"/><line x1="10.88" y1="21.94" x2="15.46" y2="14" stroke-width="1.5"/></svg>`;
const ICON_EXT_LINK = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>`;

/* ── AI Briefing Card body parser ───────────────────────────────── */

/**
 * Parses AI analysis text into a structured card format.
 * Supports both ## heading style and **Bold** bullet style outputs.
 * For the compact Overview card we extract up to 3 key sections as items.
 */
function parseAiBriefingCompact(text: string): { summary: string; items: { title: string; desc: string; type: 'pass' | 'info' }[] } {
  // Strip --- separators
  const cleaned = text.replace(/---+/g, '').trim();
  const lines = cleaned.split('\n');

  const items: { title: string; desc: string; type: 'pass' | 'info' }[] = [];
  let summary = '';
  let inFirstParagraph = true;
  const firstParaLines: string[] = [];

  // Section tracking for ## headers
  let currentSection: { title: string; bullets: string[] } | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      if (inFirstParagraph && firstParaLines.length > 0) inFirstParagraph = false;
      continue;
    }

    // ## Section headings → become card items
    const h2Match = line.match(/^##\s+(.+)$/);
    if (h2Match) {
      if (currentSection && currentSection.bullets.length > 0) {
        const firstBullet = currentSection.bullets[0].replace(/^\*\*[^*]+\*\*[:\s]*/, '').trim();
        const isWarning = /fail|error|risk|warn|issue/i.test(currentSection.title);
        items.push({ title: currentSection.title, desc: firstBullet, type: isWarning ? 'info' : 'pass' });
      }
      inFirstParagraph = false;
      currentSection = { title: h2Match[1].trim(), bullets: [] };
      continue;
    }

    // **Bold:** pattern → treat as inline item
    const boldMatch = line.match(/^-?\s*\*\*(.+?)\*\*[:\s]*(.*)$/);
    if (boldMatch && !h2Match) {
      if (inFirstParagraph) inFirstParagraph = false;
      if (currentSection) {
        const bTitle = boldMatch[1].trim();
        const bDesc = boldMatch[2].trim();
        // Only collect a few bullets per section
        if (currentSection.bullets.length < 2) {
          currentSection.bullets.push(`${bTitle}: ${bDesc}`);
        }
      } else {
        // Top-level bold bullet → treat as item directly
        const isWarning = /fail|error|risk|warn|issue/i.test(boldMatch[1]);
        if (items.length < 4) {
          items.push({ title: boldMatch[1].trim(), desc: boldMatch[2].trim(), type: isWarning ? 'info' : 'pass' });
        }
      }
      continue;
    }

    // Plain text before any heading → summary
    if (inFirstParagraph && !line.startsWith('#') && !line.startsWith('-')) {
      firstParaLines.push(line);
    } else if (currentSection && line.startsWith('-')) {
      // list item under current section
      const cleaned2 = line.replace(/^-\s*/, '').trim();
      if (currentSection.bullets.length < 2) currentSection.bullets.push(cleaned2);
    }
  }

  // Flush last section
  if (currentSection && items.length < 4) {
    const firstBullet = currentSection.bullets[0]?.replace(/^\*\*[^*]+\*\*[:\s]*/, '').trim() || '';
    const isWarning = /fail|error|risk|warn|issue/i.test(currentSection.title);
    items.push({ title: currentSection.title, desc: firstBullet, type: isWarning ? 'info' : 'pass' });
  }

  // Build summary from first paragraph lines
  summary = firstParaLines
    .join(' ')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .substring(0, 200);
  if (summary.length === 200) summary += '…';

  // If no summary, use first item description
  if (!summary && items.length > 0) {
    summary = `${items[0].title}: ${items[0].desc}`.substring(0, 200);
  }

  // Limit to 3 items for compact card
  return { summary, items: items.slice(0, 3) };
}

function renderAiBriefingCard(text: string): string {
  const { summary, items } = parseAiBriefingCompact(text);

  const summaryHtml = summary
    ? `<p class="ai-summary">${esc(summary)}</p>`
    : '';

  const itemsHtml = items
    .map(
      (item) => `
      <div class="ai-item">
        <div class="ai-item-icon ${item.type === 'pass' ? 'ai-item-icon-pass' : 'ai-item-icon-info'}">
          <svg width="11" height="11" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            ${item.type === 'pass'
              ? '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/>'
              : '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>'
            }
          </svg>
        </div>
        <div class="ai-item-body">
          <div class="ai-item-title">${esc(item.title)}</div>
          ${item.desc ? `<div class="ai-item-desc">${esc(item.desc)}</div>` : ''}
        </div>
      </div>`
    )
    .join('');

  return summaryHtml + (items.length > 0 ? `<div>${itemsHtml}</div>` : '');
}

/* ── Test detail view ────────────────────────────────────────────── */

function renderTimelineItem(s: ReportStep): string {
  let actionType = s.action.toLowerCase();
  let actionLabel = s.action;
  let target = s.selector || s.url || '';
  let value = s.value || '';
  let desc = s.description;
  let isEscaped = false;

  try {
    if (s.description && s.description.trim().startsWith('{')) {
      const parsed = JSON.parse(s.description);
      if (parsed.navigate) {
        actionType = 'nav'; actionLabel = 'Navigate';
        target = parsed.navigate.url || target;
        desc = `Navigate to <a href="${esc(target)}" target="_blank" rel="noopener noreferrer" style="color:var(--brand);word-break:break-all">${esc(target)}</a>`;
        isEscaped = true;
      } else if (parsed.click) {
        actionType = 'click'; actionLabel = 'Click';
        if (parsed.interacted_element) {
          const ax = parsed.interacted_element.match(/ax_name='([^']+)'/);
          const nd = parsed.interacted_element.match(/node_name='([^']+)'/);
          if (ax) target = ax[1]; else if (nd) target = `<${nd[1].toLowerCase()}>`;
        }
        desc = `Clicked ${target ? `<code style="font-size:11px;background:var(--surface-2);padding:1px 4px;border-radius:3px">${esc(target)}</code>` : 'element'}`;
        isEscaped = true;
      } else if (parsed.input) {
        actionType = 'input'; actionLabel = 'Input';
        value = parsed.input.text || value;
        if (parsed.interacted_element) {
          const ax = parsed.interacted_element.match(/ax_name='([^']+)'/);
          const nd = parsed.interacted_element.match(/node_name='([^']+)'/);
          if (ax) target = ax[1]; else if (nd) target = `<${nd[1].toLowerCase()}>`;
        }
        desc = `Typed <strong>"${esc(value)}"</strong> into ${target ? `<code style="font-size:11px;background:var(--surface-2);padding:1px 4px;border-radius:3px">${esc(target)}</code>` : 'field'}`;
        isEscaped = true;
      } else if (parsed.upload_file) {
        actionType = 'input'; actionLabel = 'Upload';
        value = parsed.upload_file.path || value;
        desc = `Uploaded <strong>${esc(pathBasename(value))}</strong>`;
        isEscaped = true;
      } else if (parsed.done) {
        actionType = 'assert'; actionLabel = 'Done';
        desc = `<span style="color:${parsed.done.success ? 'var(--success)' : 'var(--danger)'};font-weight:600">${parsed.done.success ? 'Success' : 'Failed'}</span>${parsed.done.text ? ` — ${esc(parsed.done.text)}` : ''}`;
        isEscaped = true;
      } else if (parsed.thinking || parsed.next_goal) {
        actionType = 'wait'; actionLabel = 'Plan';
        const goal = parsed.next_goal ? `<strong>Next:</strong> ${esc(parsed.next_goal)}` : '';
        const think = parsed.thinking ? `<span style="color:var(--text-2);font-size:11px">${esc(parsed.thinking)}</span>` : '';
        desc = [goal, think].filter(Boolean).join('<br/>');
        isEscaped = true;
      }
    }
  } catch (e) { /* ignore */ }

  // Fallback string-based detection
  if (actionType === 'custom') {
    const dl = s.description.toLowerCase();
    if (dl.includes('click')) { actionType = 'click'; actionLabel = 'Click'; }
    else if (dl.includes('typed') || dl.includes('entered') || dl.includes('input')) { actionType = 'input'; actionLabel = 'Input'; }
    else if (dl.includes('navigat') || dl.includes('opened')) { actionType = 'nav'; actionLabel = 'Navigate'; }
    else if (dl.includes('wait') || dl.includes('slept')) { actionType = 'wait'; actionLabel = 'Wait'; }
    else if (dl.includes('screenshot')) { actionType = 'ss'; actionLabel = 'Screenshot'; }
    else if (dl.includes('success') || dl.includes('verif') || dl.includes('assert')) { actionType = 'assert'; actionLabel = 'Verify'; }
  }

  const dotClass = {
    click: 'tl-click', input: 'tl-input', nav: 'tl-nav',
    wait: 'tl-wait', ss: 'tl-ss', assert: 'tl-assert'
  }[actionType] || '';

  const badgeClass = {
    click: 'tl-badge-click', input: 'tl-badge-input', nav: 'tl-badge-nav',
    wait: 'tl-badge-wait', ss: 'tl-badge-ss', assert: 'tl-badge-assert'
  }[actionType] || 'tl-badge-wait';

  const displayDesc = isEscaped ? desc : esc(desc);

  return `
  <div class="timeline-item">
    <div class="timeline-dot ${dotClass}"></div>
    <div class="timeline-card">
      <div class="timeline-action">
        <span class="tl-step-num">Step ${s.index}</span>
        <span class="tl-badge ${badgeClass}">${esc(actionLabel)}</span>
        ${target && !isEscaped ? `<code style="font-size:10px;color:var(--text-2);background:var(--surface-2);padding:1px 4px;border-radius:3px;max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:inline-block;vertical-align:middle" title="${esc(target)}">${esc(target)}</code>` : ''}
      </div>
      <div class="tl-desc">${displayDesc}</div>
    </div>
  </div>`;
}

function renderCodegenLinks(t: TestCaseReport): string {
  if (!t.codegen) return '';
  const c = t.codegen;
  const link = (label: string, filePath: string) =>
    filePath
      ? `<li style="margin:4px 0;font-size:12px"><span style="color:var(--text-3)">${esc(label)}:</span> <code style="font-size:11px;color:var(--brand)">${esc(filePath)}</code></li>`
      : '';
  const pageLinks = c.pageObjectPaths
    .map((p) => link('Page object', p))
    .filter(Boolean)
    .join('');
  const assertionSummary = c.assertionSummary
    ? `<div style="margin-top:10px;padding:8px;border:1px solid var(--border);border-radius:6px;background:var(--surface-2)">
        <div style="font-size:11px;font-weight:600;color:var(--text-3);text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px">Assertion Strength</div>
        <p style="margin:0;font-size:12px;color:var(--text-2)">Total ${c.assertionSummary.total} · Strong ${c.assertionSummary.strong} · Medium ${c.assertionSummary.medium} · Weak ${c.assertionSummary.weak}</p>
        ${c.assertionSummary.warnings.length ? `<ul style="padding-left:16px;margin:6px 0 0">${c.assertionSummary.warnings.map((warning) => `<li style="font-size:12px;color:var(--warning)">${esc(warning)}</li>`).join('')}</ul>` : ''}
      </div>`
    : '';
  return `<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border)">
    <div style="font-size:11px;font-weight:600;color:var(--text-3);text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px">Generated test artifacts (${esc(c.mode)})</div>
    <ul style="padding-left:16px;margin:0">
      ${link('Spec', c.specPath)}
      ${pageLinks}
      ${link('Trace', c.tracePath)}
      ${link('Plan', c.planPath)}
      ${link('Metadata', c.metadataPath)}
    </ul>
    ${c.replayCommand ? `<p style="margin:8px 0 0;font-size:12px;color:var(--text-2)"><strong>Replay:</strong> <code style="font-size:11px">${esc(c.replayCommand)}</code></p>` : ''}
    ${c.validationCommand ? `<p style="margin:6px 0 0;font-size:12px;color:var(--text-2)"><strong>Validate:</strong> <code style="font-size:11px">${esc(c.validationCommand)}</code></p>` : ''}
    ${assertionSummary}
  </div>`;
}

function renderFlakeAnalysis(t: TestCaseReport, baseHref: string): string {
  const flake = t.flakeAnalysis;
  if (!flake || t.status === 'PASSED') return '';

  const signalRows = flake.signals.slice(0, 8).map((signal) =>
    `<li style="margin:3px 0;font-size:12px;color:var(--text-2)"><code style="font-size:11px">${esc(signal.kind)}</code> — ${esc(String(signal.value))}${signal.detail ? ` <span style="color:var(--text-3)">(${esc(signal.detail)})</span>` : ''}</li>`
  ).join('');

  const evidenceRows = flake.evidence.map((item) =>
    item.href
      ? `<li style="margin:3px 0;font-size:12px"><a href="${esc(baseHref + item.href)}" style="color:var(--brand)">${esc(item.label)}</a></li>`
      : `<li style="margin:3px 0;font-size:12px;color:var(--text-2)">${esc(item.label)}</li>`
  ).join('');

  return `
  <div class="card" style="margin-bottom:16px;border-color:rgba(239,68,68,0.25)">
    <div class="card-header">
      <div class="card-title">Flake Analysis</div>
      <span class="status-pill status-failed" style="font-size:11px;text-transform:capitalize">${esc(flake.category)}</span>
    </div>
    <div class="card-body">
      <p style="font-size:12.5px;color:var(--text-2);margin:0 0 10px"><strong style="color:var(--text)">Likely cause:</strong> ${esc(flake.likelyCause)}</p>
      <p style="font-size:12.5px;color:var(--text-2);margin:0 0 12px"><strong style="color:var(--text)">Recommended fix:</strong> ${esc(flake.recommendation)}</p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div>
          <div class="section-title" style="margin-bottom:6px">Signals</div>
          <ul style="padding-left:16px;margin:0">${signalRows || '<li style="font-size:12px;color:var(--text-3)">No signals captured.</li>'}</ul>
        </div>
        <div>
          <div class="section-title" style="margin-bottom:6px">Evidence</div>
          <ul style="padding-left:16px;margin:0">${evidenceRows || '<li style="font-size:12px;color:var(--text-3)">No artifacts linked.</li>'}</ul>
        </div>
      </div>
      <p style="margin:10px 0 0;font-size:11px;color:var(--text-3)">Confidence ${Math.round(flake.confidence * 100)}% · source ${esc(flake.source)}</p>
    </div>
  </div>`;
}

function renderTestDetail(t: TestCaseReport, baseHref: string, multiTest: boolean): string {
  const isPass = t.status === 'PASSED';

  const summaryHtml = Array.isArray(t.codegenSummary)
    ? `<ul style="padding-left:16px;margin:0">${t.codegenSummary.map((l) => `<li style="margin:3px 0;font-size:12.5px;color:var(--text-2)">${esc(l)}</li>`).join('')}</ul>`
    : `<p style="font-size:12.5px;color:var(--text-2);line-height:1.6">${esc(t.codegenSummary)}</p>`;

  const nlHtml = t.nlSteps.length > 0
    ? `<ol style="padding-left:18px;margin:0">${t.nlSteps.map((s) => `<li style="margin:4px 0;font-size:12.5px;color:var(--text-2)">${esc(s)}</li>`).join('')}</ol>`
    : `<p style="font-size:12px;color:var(--text-3)">No NL steps recorded.</p>`;

  const stepsHtml = t.executionSteps.slice(0, 100).map((s) => renderTimelineItem(s)).join('');

  const insightsHtml = t.runtimeInsights.length > 0
    ? `<ul style="padding-left:16px;margin:0">${t.runtimeInsights.map((i) =>
        `<li style="margin:4px 0;font-size:12.5px;color:var(--text-2)"><strong style="color:var(--text)">${esc(i.type)}</strong>: ${esc(i.message)}</li>`
      ).join('')}</ul>`
    : '';

  const screenshots = t.artifacts.screenshots.map((src) =>
    `<div class="screenshot-item">
      <img src="${esc(baseHref + src)}" alt="screenshot" loading="lazy" data-lightbox="1"/>
      <div class="screenshot-caption" title="${esc(pathBasename(src))}">${esc(pathBasename(src))}</div>
    </div>`
  ).join('');

  const videoHtml = t.artifacts.video
    ? `<div style="border:1px solid var(--border);border-radius:8px;overflow:hidden;margin-bottom:14px">
        <video controls src="${esc(baseHref + t.artifacts.video)}" style="width:100%;max-height:320px;background:#000;display:block"></video>
        <div style="padding:6px 10px;font-size:11px;color:var(--text-3);background:var(--surface-2);border-top:1px solid var(--border)">Execution recording</div>
      </div>`
    : '';

  const traceHtml = t.artifacts.trace
    ? `<a class="table-review-link" href="${esc(baseHref + t.artifacts.trace)}" style="margin-top:8px;display:inline-flex">
        ${ICON_EXT_LINK.replace('viewBox', 'width="13" height="13" viewBox')} Download Playwright Trace
      </a>`
    : '';

  const aiHtml = t.aiAnalysis
    ? `<div class="card" style="margin-bottom:16px">
        <div class="card-header">
          <div class="card-title">${ICON_AI} Test AI Analysis</div>
        </div>
        <div class="card-body">
          ${renderAiBriefingCard(t.aiAnalysis)}
        </div>
      </div>`
    : '';

  const perTestLink = multiTest
    ? `<a class="table-review-link" href="${esc(t.slug)}-report.html">
        Full Report ${ICON_EXT_LINK.replace('viewBox', 'width="12" height="12" viewBox')}
      </a>`
    : '';

  return `
  <div id="detail-${esc(t.slug)}" class="test-detail-panel hidden">
    <!-- Detail header -->
    <div class="detail-header">
      <div style="display:flex;align-items:center;gap:10px;min-width:0">
        <span class="status-pill ${isPass ? 'status-passed' : 'status-failed'}">${esc(t.status)}</span>
        <h2 class="detail-title">${esc(t.testName || t.slug)}</h2>
      </div>
      <div class="detail-meta">
        <span>${esc(t.timestamp)}</span>
        <span>${t.stepsExecuted} steps</span>
        <span style="color:var(--brand);font-weight:600">$${t.pricing.estimatedCostUsd.toFixed(4)}</span>
        ${perTestLink}
      </div>
    </div>

    <!-- Tabs -->
    <div class="tabs-bar">
      <button class="tab-btn tab-active" data-tab="summary">Summary & AI</button>
      <button class="tab-btn" data-tab="steps">Execution Steps</button>
      <button class="tab-btn" data-tab="media">Media & Artifacts</button>
      <button class="tab-btn" data-tab="cost">LLM Cost</button>
    </div>

    <!-- Summary tab -->
    <div class="tab-pane" data-tab-pane="summary">
      ${renderFlakeAnalysis(t, baseHref)}
      ${aiHtml}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        <div class="info-block">
          <div class="section-title">Codegen Summary</div>
          ${summaryHtml}
          ${renderCodegenLinks(t)}
        </div>
        <div class="info-block">
          <div class="section-title">URL Sequence</div>
          ${t.urlSequence.length > 0
            ? `<ul style="padding-left:16px;margin:0">${t.urlSequence.map((u) =>
                `<li style="margin:4px 0"><a href="${esc(u)}" target="_blank" style="color:var(--brand);font-size:12px;font-family:monospace;word-break:break-all">${esc(u)}</a></li>`
              ).join('')}</ul>`
            : `<p style="font-size:12px;color:var(--text-3)">—</p>`}
        </div>
      </div>
    </div>

    <!-- Steps tab -->
    <div class="tab-pane hidden" data-tab-pane="steps">
      <div class="info-block" style="margin-bottom:14px">
        <div class="section-title">Natural Language Steps</div>
        ${nlHtml}
      </div>
      ${insightsHtml ? `
      <div class="info-block" style="margin-bottom:14px">
        <div class="section-title">Runtime Insights</div>
        ${insightsHtml}
      </div>` : ''}
      <div class="info-block">
        <div class="section-title">Execution Timeline</div>
        <div class="timeline" style="margin-top:8px">
          ${stepsHtml || `<p style="font-size:12px;color:var(--text-3)">No steps recorded.</p>`}
        </div>
      </div>
    </div>

    <!-- Media tab -->
    <div class="tab-pane hidden" data-tab-pane="media">
      ${videoHtml}
      ${screenshots
        ? `<div class="screenshots-grid">${screenshots}</div>`
        : `<p style="font-size:12px;color:var(--text-3)">No screenshots for this run.</p>`}
      ${traceHtml ? `<div style="margin-top:12px">${traceHtml}</div>` : ''}
    </div>

    <!-- Cost tab -->
    <div class="tab-pane hidden" data-tab-pane="cost">
      <div class="info-block">
        <div class="section-title">LLM Cost Details</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:16px;margin-top:8px">
          ${[
            { label: 'LLM Calls', value: String(t.pricing.llmCalls) },
            { label: 'Prompt Tokens', value: t.pricing.promptTokens.toLocaleString() },
            { label: 'Completion Tokens', value: t.pricing.completionTokens.toLocaleString() },
            { label: 'Total Tokens', value: t.pricing.totalTokens.toLocaleString() },
            { label: 'Estimated Cost', value: `$${t.pricing.estimatedCostUsd.toFixed(4)}`, accent: true },
            { label: 'Model', value: t.pricing.model || '—' },
          ].map((item) => `
            <div>
              <div style="font-size:10px;font-weight:600;color:var(--text-3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">${item.label}</div>
              <div style="font-size:16px;font-weight:700;color:${item.accent ? 'var(--brand)' : 'var(--text)'}">${esc(item.value)}</div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  </div>`;
}

/* ── HTML shell ──────────────────────────────────────────────────── */

function renderShell(
  title: string,
  suiteName: string,
  passRate: number,
  generatedAt: string,
  body: string,
  testCases: TestCaseReport[],
  hasAi: boolean,
): string {
  const allPass = passRate >= 100;
  const dateStr = new Date(generatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase();

  const sidebarTestItems = testCases.map((t) => {
    const isPass = t.status === 'PASSED';
    return `<a href="#test-${esc(t.slug)}" class="sidebar-test-item" data-slug="${esc(t.slug)}" data-name="${esc((t.testName || t.slug).toLowerCase())}" data-status="${isPass ? 'passed' : 'failed'}">
      <span class="dot ${isPass ? 'dot-pass' : 'dot-fail'}"></span>
      <span class="truncate">${esc(t.testName || t.slug)}</span>
    </a>`;
  }).join('');

  const passedCount = testCases.filter((t) => t.status === 'PASSED').length;
  const failedCount = testCases.length - passedCount;

  return `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${esc(title)}</title>
  <script>
    (function(){
      var stored = localStorage.getItem('webpilot-report-theme');
      var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.setAttribute('data-theme', stored || (prefersDark ? 'dark' : 'light'));
    })();
  </script>
  <style>${REPORT_STYLES}</style>
</head>
<body>
  <div class="app-layout">

    <!-- Mobile header -->
    <header class="mobile-header">
      <img src="${esc(REPORT_LOGO_HREF)}" alt="WebPilot" style="height:28px;width:auto;object-fit:contain"/>
      <button id="mobile-menu-btn" class="header-icon-btn">${ICON_MENU}</button>
    </header>

    <!-- Mobile backdrop -->
    <div id="sidebar-backdrop" class="sidebar-backdrop"></div>

    <!-- Sidebar -->
    <aside id="app-sidebar" class="sidebar">
      <div class="sidebar-logo">
        <img src="${esc(REPORT_LOGO_HREF)}" alt="WebPilot"/>
        <div class="sidebar-logo-sub">Automate Suite</div>
      </div>

      <nav class="sidebar-nav">
        <div class="sidebar-section-label">Navigation</div>

        <a href="#overview" id="nav-overview" class="nav-item active">
          ${ICON_OVERVIEW} Overview
        </a>
        ${hasAi ? `<a href="#ai-analysis" id="nav-ai" class="nav-item">${ICON_AI} AI Analysis</a>` : ''}
        <a href="#environment" id="nav-env" class="nav-item">
          ${ICON_ENV} Environment
        </a>
        <a href="#test-cases" id="nav-tests" class="nav-item">
          ${ICON_TESTS} Test Cases
        </a>
        <a href="#llm-pricing" id="nav-pricing" class="nav-item">
          ${ICON_PRICING} LLM Pricing
        </a>
        <a href="#logs" id="nav-logs" class="nav-item">
          ${ICON_LOGS} Logs &amp; Details
        </a>

        ${testCases.length > 0 ? `
        <div class="sidebar-divider"></div>
        <div class="sidebar-section-label">Test Cases</div>

        <div style="padding:0 8px 6px;display:flex;gap:4px">
          <button class="sidebar-filter-btn active" data-filter="all" style="flex:1;padding:3px 6px;border:1px solid var(--border);border-radius:4px;background:var(--brand);color:#fff;font-size:10px;font-weight:600;cursor:pointer">All (${testCases.length})</button>
          <button class="sidebar-filter-btn" data-filter="passed" style="flex:1;padding:3px 6px;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text-2);font-size:10px;font-weight:600;cursor:pointer">Pass (${passedCount})</button>
          <button class="sidebar-filter-btn" data-filter="failed" style="flex:1;padding:3px 6px;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text-2);font-size:10px;font-weight:600;cursor:pointer">Fail (${failedCount})</button>
        </div>

        <div style="padding:0 8px 6px">
          <div style="position:relative">
            <svg style="position:absolute;left:8px;top:50%;transform:translateY(-50%);width:12px;height:12px;color:var(--text-3)" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
            <input id="sidebar-search" type="text" placeholder="Search..." style="width:100%;padding:5px 8px 5px 26px;border:1px solid var(--border);border-radius:5px;background:var(--surface);color:var(--text);font-size:11.5px;outline:none"/>
          </div>
        </div>

        <div class="sidebar-test-list" style="overflow-y:auto;max-height:280px;padding:0 8px">
          ${sidebarTestItems}
        </div>
        ` : ''}
      </nav>

      <div class="sidebar-footer">
        <div class="sidebar-theme-toggle">
          <span style="font-size:11px;color:var(--text-3);font-weight:600">Theme</span>
          <button id="theme-toggle" class="theme-btn">
            <svg id="theme-icon" width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24"></svg>
            Toggle
          </button>
        </div>
        <div class="sidebar-footer-meta">
          ${ICON_SETTINGS.replace('<svg ', '<svg width="10" height="10" style="margin-right:3px;vertical-align:middle" ')} Settings<br/>
          <span style="opacity:0.7">Ver 1.0.0-PRO · Build ${esc(new Date().toISOString().slice(0, 10).replace(/-/g, '.'))}</span>
        </div>
      </div>
    </aside>

    <!-- Main content -->
    <div class="main-content">
      <!-- Top header -->
      <header class="top-header">
        <h1 class="top-header-title">Execution Report</h1>
        <div class="top-header-date">
          ${ICON_CAL.replace('<svg ', '<svg width="13" height="13" style="margin-right:2px" ')}
          ${dateStr}
        </div>
        <div class="pass-badge ${allPass ? 'pass-badge-pass' : 'pass-badge-fail'}">
          <span class="dot-indicator ${allPass ? 'dot-indicator-pass' : 'dot-indicator-fail'}"></span>
          ${passRate.toFixed(0)}% PASSED
        </div>
        <button class="header-icon-btn" aria-label="Notifications">${ICON_BELL}</button>
        <div class="avatar">WP</div>
      </header>

      <!-- Page body -->
      <main class="page-body">
        ${body}
      </main>
    </div>
  </div>

  <!-- Lightbox -->
  <div id="lightbox" class="lightbox">
    <button id="lightbox-close" class="lightbox-close">×</button>
    <img id="lightbox-img" alt="Screenshot preview"/>
  </div>

  <script>${REPORT_SCRIPTS}</script>
</body>
</html>`;
}

/* ── Main suite renderer ─────────────────────────────────────────── */

export function renderSuiteHtml(report: SuiteExecutionReport, baseHref = ''): string {
  const o = report.overview;
  const env = report.environment;
  const br = report.browser;
  const fw = report.framework;
  const multiTest = report.testCases.length > 1;
  const hasAi = !!report.suiteAiAnalysis;

  // Compute avg duration (rough estimate from steps)
  const avgSteps = o.total > 0 ? Math.round(o.totalSteps / o.total) : 0;

  // ── Overview page ────────────────────────────────────────────────
  const overviewPage = `
  <div id="view-overview">
    <!-- Suite info bar -->
    <div class="suite-info-bar">
      <div class="suite-label">Suite</div>
      <div class="suite-name">${esc(report.suiteName)}</div>
      <div class="suite-meta">
        <span>Ref: <strong>${esc(report.suiteName.toLowerCase().replace(/[^a-z0-9]+/g, '_'))}</strong></span>
        <span class="suite-meta-sep">•</span>
        <span>Environment: <span class="env-chip">${esc(env.name)}</span></span>
        <span class="suite-meta-sep">•</span>
        <span>Timestamp: <time>${esc(report.generatedAt)}</time></span>
      </div>
    </div>

    <!-- Stats row -->
    <div class="stats-row">
      <div class="stat-cell">
        <div class="stat-label">Pass Rate</div>
        <div class="stat-value-primary ${o.passRate >= 100 ? 'stat-value-green' : ''}">${o.passRate.toFixed(1)}%</div>
      </div>
      <div class="stat-cell">
        <div class="stat-label">Test Cases</div>
        <div class="stat-value">${o.total}</div>
      </div>
      <div class="stat-cell">
        <div class="stat-label">Total Steps</div>
        <div class="stat-value">${o.totalSteps}</div>
      </div>
      <div class="stat-cell">
        <div class="stat-label">Avg. Steps</div>
        <div class="stat-value">${avgSteps}</div>
      </div>
      <div class="stat-cell">
        <div class="stat-label">Tokens Used</div>
        <div class="stat-value">${fmtTokens(o.totalTokens)}</div>
      </div>
      <div class="stat-cell">
        <div class="stat-label">Run Cost</div>
        <div class="stat-value stat-value-brand">$${o.totalCostUsd.toFixed(3)}</div>
      </div>
    </div>

    <!-- Two column -->
    <div class="two-col">
      <!-- Left column -->
      <div>
        ${hasAi ? `
        <!-- AI Briefing card -->
        <div class="card">
          <div class="card-header">
            <div class="card-title">${ICON_AI} AI Analysis Briefing</div>
            <a href="#ai-analysis" class="card-action">Full Report →</a>
          </div>
          <div class="card-body">
            ${renderAiBriefingCard(report.suiteAiAnalysis!)}
          </div>
        </div>
        ` : ''}

        <!-- Test Suite Execution Details -->
        <div class="card">
          <div class="card-header">
            <div class="card-title">${ICON_TESTS} Test Suite Execution Details</div>
          </div>
          <table class="data-table">
            <thead>
              <tr>
                <th>Test Case ID</th>
                <th>Status</th>
                <th>Steps</th>
                <th>Outcome Details</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${report.testCases.map((t) => {
                const isPass = t.status === 'PASSED';
                const outcomeText = isPass
                  ? (t.codegenSummary
                    ? (Array.isArray(t.codegenSummary)
                      ? t.codegenSummary[0]
                      : t.codegenSummary).substring(0, 80)
                    : 'Test passed successfully.')
                  : 'Test failed. Check details for more info.';
                return `<tr class="test-table-row" data-slug="${esc(t.slug)}">
                  <td><span style="font-size:12.5px;font-weight:600;color:var(--text)">${esc(t.slug)}</span></td>
                  <td><span class="status-pill ${isPass ? 'status-passed' : 'status-failed'}">${esc(t.status)}</span></td>
                  <td>${t.stepsExecuted}</td>
                  <td style="max-width:260px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(outcomeText)}">${esc(outcomeText)}</td>
                  <td>
                    ${multiTest
                      ? `<a class="table-review-link" href="${esc(t.slug)}-report.html">Full Report ${ICON_EXT_LINK.replace('<svg ', '<svg width="11" height="11" ')}</a>`
                      : `<a class="table-review-link" href="#test-${esc(t.slug)}">Review Logs ${ICON_EXT_LINK.replace('<svg ', '<svg width="11" height="11" ')}</a>`}
                  </td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Right column -->
      <div>
        <!-- Environment card -->
        <div class="card">
          <div class="card-header">
            <div class="card-title">${ICON_ENV} Environment</div>
          </div>
          <div class="card-body" style="padding:8px 16px">
            <div class="env-row">
              <div class="env-key">Context</div>
              <div class="env-val">${esc(env.name)}</div>
            </div>
            <div class="env-row">
              <div class="env-key">Browser</div>
              <div class="env-val env-val-icon">
                ${ICON_CHROME.replace('<svg ', '<svg width="14" height="14" ')}
                ${esc(br.target)} ${br.headless ? '(Headless)' : '(Headed)'}
              </div>
            </div>
            <div class="env-row">
              <div class="env-key">Provider</div>
              <div class="env-val">${esc(providerLabel(br))}</div>
            </div>
            <div class="env-row">
              <div class="env-key">Framework</div>
              <div class="env-val">${esc(fw.name)} v${esc(fw.version)}</div>
            </div>
            <div class="env-row">
              <div class="env-key">OS Host</div>
              <div class="env-val">${env.baseUrl ? esc(new URL(env.baseUrl).hostname) : '—'}</div>
            </div>
            ${env.baseUrl ? `
            <div class="env-row">
              <div class="env-key">Base URL</div>
              <div class="env-val" style="font-size:11.5px"><a href="${esc(env.baseUrl)}" target="_blank" style="color:var(--brand);word-break:break-all">${esc(env.baseUrl)}</a></div>
            </div>` : ''}
          </div>
          <div style="padding:12px 16px;border-top:1px solid var(--border)">
            <a href="#environment" class="view-specs-btn">View System Specs</a>
          </div>
        </div>

        <!-- Quick Stats dark card -->
        <div class="quick-stats-card">
          <div class="quick-stats-header">Quick Stats</div>
          <div class="quick-stat-row">
            <span class="quick-stat-key">Total Assertions</span>
            <span class="quick-stat-val">${o.total}</span>
          </div>
          <div class="quick-stat-row">
            <span class="quick-stat-key">Passed Tests</span>
            <span class="quick-stat-val">${o.passed}</span>
          </div>
          <div class="quick-stat-row">
            <span class="quick-stat-key">Failed Tests</span>
            <span class="quick-stat-val">${o.failed}</span>
          </div>
          <div class="quick-stat-row">
            <span class="quick-stat-key">Total Steps</span>
            <span class="quick-stat-val">${o.totalSteps}</span>
          </div>
          <div class="quick-stat-row">
            <span class="quick-stat-key">LLM Tokens</span>
            <span class="quick-stat-val">${fmtTokens(o.totalTokens)}</span>
          </div>
          <div class="quick-stat-row">
            <span class="quick-stat-key">Total Cost</span>
            <span class="quick-stat-val">$${o.totalCostUsd.toFixed(4)}</span>
          </div>
        </div>
      </div>
    </div>
  </div>`;

  // ── AI Analysis page ─────────────────────────────────────────────
  const aiPage = hasAi ? `
  <div id="view-ai-briefing" class="hidden">
    <div style="margin-bottom:20px">
      <h2 style="font-size:18px;font-weight:700;color:var(--text);margin-bottom:4px">AI Analysis</h2>
      <p style="font-size:12.5px;color:var(--text-2)">Intelligent suite diagnostics and optimization insights powered by LLM analysis.</p>
    </div>
    <div class="card">
      <div class="card-header">
        <div class="card-title">${ICON_AI} Suite AI Analysis Briefing</div>
      </div>
      <div class="card-body" style="font-size:13px;color:var(--text-2);line-height:1.7">
        ${mdToHtml(report.suiteAiAnalysis!)}
      </div>
    </div>
  </div>` : '';

  // ── Environment page ─────────────────────────────────────────────
  const envPage = `
  <div id="view-environment" class="hidden">
    <div style="margin-bottom:20px">
      <h2 style="font-size:18px;font-weight:700;color:var(--text);margin-bottom:4px">Environment & Runtime</h2>
      <p style="font-size:12.5px;color:var(--text-2)">Full technical environment details for this test execution.</p>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px">
      <div class="card" style="margin-bottom:0">
        <div class="card-header"><div class="card-title">${ICON_ENV} Environment</div></div>
        <div class="card-body" style="padding:8px 16px">
          ${[
            ['Context / Name', env.name],
            ['Base URL', env.baseUrl || '—'],
            ['API URL', env.apiBaseUrl || '—'],
          ].map(([k, v]) => `
          <div class="env-row">
            <div class="env-key">${esc(k)}</div>
            <div class="env-val" style="font-size:12px">${esc(v)}</div>
          </div>`).join('')}
        </div>
      </div>
      <div class="card" style="margin-bottom:0">
        <div class="card-header"><div class="card-title">${ICON_CHROME.replace('<svg ', '<svg width="14" height="14" ')} Browser</div></div>
        <div class="card-body" style="padding:8px 16px">
          ${[
            ['Provider', providerLabel(br)],
            ['Target', br.target],
            ['Browser Name', br.provider?.browserName || br.target],
            ['Browser Version', br.provider?.browserVersion || '—'],
            ['Platform', br.provider?.platform || 'local'],
            ['Session ID', br.provider?.sessionId || '—'],
            ['Headless', br.headless ? 'Yes' : 'No (headed)'],
            ['Viewport', br.viewport ? `${br.viewport.width} × ${br.viewport.height}` : '—'],
            ['Video', br.video],
            ['Trace', br.trace],
            ['Screenshots', br.screenshots],
          ].map(([k, v]) => `
          <div class="env-row">
            <div class="env-key">${esc(k)}</div>
            <div class="env-val" style="font-size:12px">${esc(v)}</div>
          </div>`).join('')}
        </div>
      </div>
      <div class="card" style="margin-bottom:0">
        <div class="card-header"><div class="card-title">${ICON_SETTINGS.replace('<svg ', '<svg width="14" height="14" ')} Framework</div></div>
        <div class="card-body" style="padding:8px 16px">
          ${[
            ['Framework', `${fw.name} v${fw.version}`],
            ['WebPilot agent', fw.useBrowserUse ? 'Enabled' : 'Disabled'],
            ['LLM Provider', fw.activeProvider],
          ].map(([k, v]) => `
          <div class="env-row">
            <div class="env-key">${esc(k)}</div>
            <div class="env-val" style="font-size:12px">${esc(v)}</div>
          </div>`).join('')}
        </div>
      </div>
    </div>
  </div>`;

  // ── Test Cases page ──────────────────────────────────────────────
  const testsPage = `
  <div id="view-test-cases" class="hidden">
    <div style="margin-bottom:20px">
      <h2 style="font-size:18px;font-weight:700;color:var(--text);margin-bottom:4px">Test Cases</h2>
      <p style="font-size:12.5px;color:var(--text-2)">All test cases executed in this suite with full status and cost details.</p>
    </div>
    <div class="card">
      <div class="card-header">
        <div class="card-title">${ICON_TESTS} Execution Results</div>
        <div style="display:flex;gap:6px">
          <span class="status-pill status-passed" style="font-size:10px">${o.passed} Passed</span>
          <span class="status-pill status-failed" style="font-size:10px">${o.failed} Failed</span>
        </div>
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th>Test Name</th>
            <th>Status</th>
            <th>Steps</th>
            <th>LLM Cost</th>
            <th>Executed At</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${report.testCases.map((t) => `
          <tr class="test-table-row" data-slug="${esc(t.slug)}">
            <td style="font-weight:600;color:var(--text)">${esc(t.testName || t.slug)}</td>
            <td><span class="status-pill ${t.status === 'PASSED' ? 'status-passed' : 'status-failed'}">${esc(t.status)}</span></td>
            <td>${t.stepsExecuted}</td>
            <td>$${t.pricing.estimatedCostUsd.toFixed(4)}</td>
            <td style="font-size:11.5px">${esc(t.timestamp)}</td>
            <td>
              ${multiTest
                ? `<a class="table-review-link" href="${esc(t.slug)}-report.html">Report</a>`
                : `<a class="table-review-link" href="#test-${esc(t.slug)}">Details</a>`}
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
  </div>`;

  // ── LLM Pricing page ─────────────────────────────────────────────
  const pricingPage = `
  <div id="view-llm-pricing" class="hidden">
    <div style="margin-bottom:20px">
      <h2 style="font-size:18px;font-weight:700;color:var(--text);margin-bottom:4px">LLM Pricing</h2>
      <p style="font-size:12.5px;color:var(--text-2)">Detailed token usage and cost breakdown for all LLM calls.</p>
    </div>
    <div class="card">
      <div class="card-header">
        <div class="card-title">${ICON_PRICING} Cost Breakdown</div>
        <span style="font-size:13px;font-weight:700;color:var(--brand)">Total: $${o.totalCostUsd.toFixed(4)}</span>
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th>Test Case</th>
            <th>LLM Calls</th>
            <th>Prompt Tokens</th>
            <th>Completion Tokens</th>
            <th>Total Tokens</th>
            <th>Cost (USD)</th>
          </tr>
        </thead>
        <tbody>
          ${report.testCases.map((t) => `
          <tr>
            <td><a href="#test-${esc(t.slug)}" class="table-link">${esc(t.slug)}</a></td>
            <td>${t.pricing.llmCalls}</td>
            <td>${t.pricing.promptTokens.toLocaleString()}</td>
            <td>${t.pricing.completionTokens.toLocaleString()}</td>
            <td>${t.pricing.totalTokens.toLocaleString()}</td>
            <td style="font-weight:600;color:var(--text)">$${t.pricing.estimatedCostUsd.toFixed(4)}</td>
          </tr>`).join('')}
        </tbody>
        <tfoot>
          <tr>
            <td style="font-weight:700;color:var(--text)">Suite Total</td>
            <td>—</td><td>—</td><td>—</td>
            <td style="font-weight:700;color:var(--text)">${o.totalTokens.toLocaleString()}</td>
            <td style="font-weight:700;color:var(--brand)">$${o.totalCostUsd.toFixed(4)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  </div>`;

  // ── Logs index page ──────────────────────────────────────────────
  const logsPage = `
  <div id="view-logs-index" class="hidden">
    <div style="margin-bottom:20px">
      <h2 style="font-size:18px;font-weight:700;color:var(--text);margin-bottom:4px">Logs &amp; Details</h2>
      <p style="font-size:12.5px;color:var(--text-2)">Select a test case below to review its full execution log and artifacts.</p>
    </div>
    <div class="card">
      <div class="card-header"><div class="card-title">${ICON_LOGS} Test Case Logs</div></div>
      <div style="padding:8px 0">
        ${report.testCases.map((t) => {
          const isPass = t.status === 'PASSED';
          return `<a href="#test-${esc(t.slug)}" style="display:flex;align-items:center;justify-content:space-between;padding:11px 16px;border-bottom:1px solid var(--border-light);text-decoration:none;transition:background .1s" onmouseover="this.style.background='var(--surface-2)'" onmouseout="this.style.background=''">
            <div style="display:flex;align-items:center;gap:10px">
              <span class="status-pill ${isPass ? 'status-passed' : 'status-failed'}">${esc(t.status)}</span>
              <span style="font-size:13px;font-weight:600;color:var(--text)">${esc(t.testName || t.slug)}</span>
            </div>
            <div style="display:flex;align-items:center;gap:12px;font-size:12px;color:var(--text-2)">
              <span>${t.stepsExecuted} steps</span>
              <span>$${t.pricing.estimatedCostUsd.toFixed(4)}</span>
              <span class="table-review-link">View Logs ${ICON_EXT_LINK.replace('<svg ', '<svg width="11" height="11" ')}</span>
            </div>
          </a>`;
        }).join('')}
      </div>
    </div>
  </div>`;

  // ── Test detail panels ───────────────────────────────────────────
  const detailsPage = `
  <div id="view-test-details" class="hidden">
    ${report.testCases.map((t) => renderTestDetail(t, baseHref, multiTest)).join('')}
  </div>`;

  const body = overviewPage + aiPage + envPage + testsPage + pricingPage + logsPage + detailsPage;

  return renderShell(
    `${report.suiteName} — WebPilot`,
    report.suiteName,
    o.passRate,
    report.generatedAt,
    body,
    report.testCases,
    hasAi,
  );
}

/* ── Single test report ──────────────────────────────────────────── */

export function renderTestHtml(report: SuiteExecutionReport, slug: string): string | null {
  const t = report.testCases.find((c) => c.slug === slug);
  if (!t) return null;

  const single: SuiteExecutionReport = {
    ...report,
    suiteName: t.testName || t.slug,
    testCases: [t],
    overview: {
      total: 1,
      passed: t.status === 'PASSED' ? 1 : 0,
      failed: t.status === 'PASSED' ? 0 : 1,
      passRate: t.status === 'PASSED' ? 100 : 0,
      totalSteps: t.stepsExecuted,
      totalCostUsd: t.pricing.estimatedCostUsd,
      totalTokens: t.pricing.totalTokens,
    },
  };

  return renderSuiteHtml(single, '');
}
