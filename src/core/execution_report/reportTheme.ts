/** WebPilot-branded report theme — clean professional SaaS dashboard. */

export const REPORT_LOGO_HREF = '../assets/webpilot-logo-light.png';
export const REPORT_LOGO_DARK_HREF = '../assets/webpilot-logo-dark.png';

export const REPORT_STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,300;0,400;0,500;0,600;0,700&display=swap');

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

html {
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 14px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

/* ── Color tokens ─────────────────────────────────── */
:root {
  --bg:            #f7f8fa;
  --surface:       #ffffff;
  --surface-2:     #f0f2f5;
  --border:        #e4e7ec;
  --border-light:  #eef0f3;
  --text:          #101828;
  --text-2:        #475467;
  --text-3:        #98a2b3;
  --brand:         #155eef;
  --brand-light:   #eff4ff;
  --brand-dark:    #1d4ed8;
  --success:       #12b76a;
  --success-bg:    #ecfdf3;
  --success-text:  #027a48;
  --danger:        #f04438;
  --danger-bg:     #fef3f2;
  --danger-text:   #b42318;
  --warning:       #f79009;
  --sidebar-width: 200px;
  --header-h:      56px;
  --content-pad:   24px;
}

[data-theme="dark"] {
  --bg:            #0d1117;
  --surface:       #161b22;
  --surface-2:     #21262d;
  --border:        #30363d;
  --border-light:  #21262d;
  --text:          #e6edf3;
  --text-2:        #8b949e;
  --text-3:        #484f58;
  --brand:         #58a6ff;
  --brand-light:   #0d1f3c;
  --brand-dark:    #388bfd;
  --success:       #3fb950;
  --success-bg:    #0d2b0d;
  --success-text:  #3fb950;
  --danger:        #f85149;
  --danger-bg:     #2d1a1a;
  --danger-text:   #f85149;
  --warning:       #e3b341;
}

/* ── Layout shell ─────────────────────────────────── */
body {
  background: var(--bg);
  color: var(--text);
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.app-layout {
  display: flex;
  min-height: 100vh;
}

/* ── Sidebar ──────────────────────────────────────── */
.sidebar {
  width: var(--sidebar-width);
  flex-shrink: 0;
  background: var(--surface);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  position: fixed;
  top: 0;
  bottom: 0;
  left: 0;
  z-index: 40;
  overflow-y: auto;
  overflow-x: hidden;
}

.sidebar-logo {
  padding: 16px 14px 12px;
  border-bottom: 1px solid var(--border-light);
}

.sidebar-logo img {
  height: 32px;
  width: auto;
  object-fit: contain;
}

.sidebar-logo-sub {
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-3);
  margin-top: 4px;
}

.sidebar-nav {
  flex: 1;
  padding: 8px 8px;
  overflow-y: auto;
}

.sidebar-section-label {
  font-size: 10px;
  font-weight: 600;
  color: var(--text-3);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 8px 8px 4px;
  margin-top: 4px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 8px;
  border-radius: 6px;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--text-2);
  text-decoration: none;
  cursor: pointer;
  border: none;
  background: none;
  width: 100%;
  text-align: left;
  transition: background 0.12s, color 0.12s;
  margin-bottom: 1px;
}

.nav-item svg {
  width: 15px;
  height: 15px;
  flex-shrink: 0;
  opacity: 0.75;
}

.nav-item:hover {
  background: var(--surface-2);
  color: var(--text);
}

.nav-item.active {
  background: var(--brand-light);
  color: var(--brand);
  font-weight: 600;
}

.nav-item.active svg {
  opacity: 1;
}

.sidebar-divider {
  height: 1px;
  background: var(--border-light);
  margin: 8px 0;
}

.sidebar-test-list {
  padding: 0 0 8px;
}

.sidebar-test-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  border-radius: 6px;
  font-size: 11.5px;
  font-weight: 450;
  color: var(--text-2);
  text-decoration: none;
  cursor: pointer;
  transition: background 0.1s, color 0.1s;
  margin-bottom: 1px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sidebar-test-item:hover {
  background: var(--surface-2);
  color: var(--text);
}

.sidebar-test-item.active {
  background: var(--brand-light);
  color: var(--brand);
}

.sidebar-test-item .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.dot-pass { background: var(--success); }
.dot-fail { background: var(--danger); }

.sidebar-footer {
  border-top: 1px solid var(--border-light);
  padding: 12px 14px;
}

.sidebar-footer-meta {
  font-size: 10px;
  color: var(--text-3);
  line-height: 1.6;
}

.sidebar-theme-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.theme-btn {
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--surface);
  color: var(--text-2);
  font-size: 11px;
  cursor: pointer;
  transition: background 0.1s;
  display: flex;
  align-items: center;
  gap: 4px;
}

.theme-btn:hover {
  background: var(--surface-2);
}

/* ── Main content area ────────────────────────────── */
.main-content {
  margin-left: var(--sidebar-width);
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

/* ── Top header ───────────────────────────────────── */
.top-header {
  position: sticky;
  top: 0;
  z-index: 30;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  height: var(--header-h);
  display: flex;
  align-items: center;
  padding: 0 var(--content-pad);
  gap: 12px;
}

.top-header-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--text);
  flex: 1;
}

.top-header-date {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  color: var(--text-2);
  background: var(--surface-2);
  border: 1px solid var(--border);
  padding: 3px 10px;
  border-radius: 5px;
}

.pass-badge {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 5px;
}

.pass-badge-pass {
  background: var(--success-bg);
  color: var(--success-text);
}

.pass-badge-fail {
  background: var(--danger-bg);
  color: var(--danger-text);
}

.pass-badge .dot-indicator {
  width: 7px;
  height: 7px;
  border-radius: 50%;
}

.dot-indicator-pass { background: var(--success); }
.dot-indicator-fail { background: var(--danger); }

.header-icon-btn {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-2);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.1s;
  flex-shrink: 0;
}

.header-icon-btn:hover { background: var(--surface-2); }

.avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  color: #fff;
  flex-shrink: 0;
}

/* ── Page body ────────────────────────────────────── */
.page-body {
  flex: 1;
  padding: var(--content-pad);
  overflow: auto;
}

/* ── Suite info bar ───────────────────────────────── */
.suite-info-bar {
  margin-bottom: 16px;
}

.suite-label {
  font-size: 10.5px;
  font-weight: 600;
  color: var(--text-3);
  text-transform: uppercase;
  letter-spacing: 0.07em;
  margin-bottom: 3px;
}

.suite-name {
  font-size: 17px;
  font-weight: 700;
  color: var(--text);
  line-height: 1.3;
  margin-bottom: 5px;
}

.suite-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  font-size: 11.5px;
  color: var(--text-2);
}

.suite-meta-sep {
  color: var(--text-3);
}

.env-chip {
  display: inline-block;
  background: var(--brand-light);
  color: var(--brand);
  font-size: 10.5px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 4px;
}

/* ── Stats row ────────────────────────────────────── */
.stats-row {
  display: flex;
  align-items: stretch;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  overflow: hidden;
  margin-bottom: 20px;
}

.stat-cell {
  flex: 1;
  padding: 14px 16px;
  border-right: 1px solid var(--border);
  min-width: 0;
}

.stat-cell:last-child {
  border-right: none;
}

.stat-label {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-3);
  margin-bottom: 5px;
  white-space: nowrap;
}

.stat-value {
  font-size: 20px;
  font-weight: 700;
  color: var(--text);
  line-height: 1;
  white-space: nowrap;
}

.stat-value-primary {
  font-size: 26px;
  font-weight: 800;
  color: var(--text);
}

.stat-value-green { color: var(--success-text); }
.stat-value-brand { color: var(--brand); }

/* ── Two column layout ────────────────────────────── */
.two-col {
  display: grid;
  grid-template-columns: 1fr 320px;
  gap: 16px;
  align-items: start;
}

/* ── Cards ────────────────────────────────────────── */
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
  margin-bottom: 16px;
}

.card:last-child { margin-bottom: 0; }

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
}

.card-title {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--text-2);
}

.card-title svg {
  width: 14px;
  height: 14px;
  color: var(--text-3);
}

.card-action {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--brand);
  text-decoration: none;
  cursor: pointer;
  background: none;
  border: none;
  padding: 0;
}

.card-action:hover { text-decoration: underline; }

.card-body {
  padding: 16px;
}

/* ── AI briefing card ─────────────────────────────── */
.ai-summary {
  font-size: 13px;
  color: var(--text);
  line-height: 1.6;
  margin-bottom: 14px;
}

.ai-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 0;
  border-top: 1px solid var(--border-light);
}

.ai-item-icon {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-top: 1px;
}

.ai-item-icon-pass {
  background: var(--success-bg);
  color: var(--success-text);
}

.ai-item-icon-info {
  background: var(--brand-light);
  color: var(--brand);
}

.ai-item-body {}

.ai-item-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  margin-bottom: 2px;
}

.ai-item-desc {
  font-size: 12px;
  color: var(--text-2);
  line-height: 1.5;
}

/* ── Table ────────────────────────────────────────── */
.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
}

.data-table thead th {
  padding: 9px 14px;
  text-align: left;
  font-size: 10.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-3);
  background: var(--surface-2);
  border-bottom: 1px solid var(--border);
}

.data-table tbody td {
  padding: 10px 14px;
  border-bottom: 1px solid var(--border-light);
  color: var(--text-2);
}

.data-table tbody tr:last-child td { border-bottom: none; }

.data-table tbody tr {
  transition: background 0.1s;
  cursor: pointer;
}

.data-table tbody tr:hover td {
  background: var(--surface-2);
  color: var(--text);
}

.data-table tfoot td {
  padding: 10px 14px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-2);
  background: var(--surface-2);
  border-top: 1px solid var(--border);
}

.status-pill {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 10.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.status-passed {
  background: var(--success-bg);
  color: var(--success-text);
}

.status-failed {
  background: var(--danger-bg);
  color: var(--danger-text);
}

.table-link {
  font-size: 11px;
  font-weight: 600;
  color: var(--brand);
  text-decoration: none;
}

.table-link:hover { text-decoration: underline; }

.table-review-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--brand);
  text-decoration: none;
}

.table-review-link:hover { text-decoration: underline; }

/* ── Environment card (right col) ─────────────────── */
.env-row {
  display: flex;
  align-items: flex-start;
  padding: 8px 0;
  border-bottom: 1px solid var(--border-light);
  font-size: 12.5px;
}

.env-row:last-child { border-bottom: none; }

.env-key {
  width: 110px;
  flex-shrink: 0;
  color: var(--text-2);
  font-size: 12px;
}

.env-val {
  flex: 1;
  font-weight: 500;
  color: var(--text);
  word-break: break-all;
}

.env-val-icon {
  display: flex;
  align-items: center;
  gap: 5px;
}

.env-val-icon svg {
  width: 14px;
  height: 14px;
  color: var(--text-2);
  flex-shrink: 0;
}

.view-specs-btn {
  width: 100%;
  padding: 7px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text-2);
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
  margin-top: 12px;
  text-align: center;
  text-decoration: none;
  display: block;
  transition: background 0.1s, color 0.1s;
}

.view-specs-btn:hover {
  background: var(--surface-2);
  color: var(--text);
}

/* ── Quick stats dark card ────────────────────────── */
.quick-stats-card {
  background: #1d2939;
  border-radius: 10px;
  overflow: hidden;
}

[data-theme="dark"] .quick-stats-card {
  background: #0a0f1a;
}

.quick-stats-header {
  padding: 10px 16px 8px;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #94a3b8;
}

.quick-stat-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  border-top: 1px solid rgba(255,255,255,0.06);
  font-size: 12.5px;
}

.quick-stat-key {
  color: #94a3b8;
}

.quick-stat-val {
  font-weight: 700;
  color: #f1f5f9;
}

/* ── Test detail view ─────────────────────────────── */
.detail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 20px;
}

.detail-title {
  font-size: 17px;
  font-weight: 700;
  color: var(--text);
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.detail-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
  color: var(--text-2);
  flex-shrink: 0;
}

/* ── Tabs ─────────────────────────────────────────── */
.tabs-bar {
  display: flex;
  border-bottom: 1px solid var(--border);
  margin-bottom: 20px;
  gap: 0;
}

.tab-btn {
  padding: 8px 16px;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--text-2);
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  transition: color 0.1s, border-color 0.1s;
  margin-bottom: -1px;
}

.tab-btn:hover { color: var(--text); }

.tab-btn.tab-active {
  color: var(--brand);
  border-bottom-color: var(--brand);
  font-weight: 600;
}

/* ── Timeline steps ───────────────────────────────── */
.timeline {
  position: relative;
  padding-left: 24px;
}

.timeline::before {
  content: '';
  position: absolute;
  left: 6px;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--border);
}

.timeline-item {
  position: relative;
  margin-bottom: 12px;
}

.timeline-dot {
  position: absolute;
  left: -21px;
  top: 10px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--border);
  border: 2px solid var(--surface);
}

.tl-click { background: #3b82f6; }
.tl-input  { background: #f59e0b; }
.tl-nav    { background: #8b5cf6; }
.tl-wait   { background: #9ca3af; }
.tl-ss     { background: #14b8a6; }
.tl-assert { background: var(--success); }

.timeline-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
}

.timeline-action {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}

.tl-step-num {
  font-size: 10px;
  color: var(--text-3);
  font-weight: 600;
}

.tl-badge {
  font-size: 9.5px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 4px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.tl-badge-click  { background: #eff6ff; color: #1d4ed8; }
.tl-badge-input  { background: #fffbeb; color: #92400e; }
.tl-badge-nav    { background: #f5f3ff; color: #6d28d9; }
.tl-badge-wait   { background: #f9fafb; color: #6b7280; }
.tl-badge-ss     { background: #f0fdfa; color: #0f766e; }
.tl-badge-assert { background: #ecfdf5; color: #065f46; }

[data-theme="dark"] .tl-badge-click  { background: #1e3a5f; color: #93c5fd; }
[data-theme="dark"] .tl-badge-input  { background: #3b2800; color: #fcd34d; }
[data-theme="dark"] .tl-badge-nav    { background: #2e1b5e; color: #c4b5fd; }
[data-theme="dark"] .tl-badge-wait   { background: #1f2937; color: #9ca3af; }
[data-theme="dark"] .tl-badge-ss     { background: #0c2820; color: #5eead4; }
[data-theme="dark"] .tl-badge-assert { background: #052e16; color: #6ee7b7; }

.tl-desc {
  font-size: 12px;
  color: var(--text-2);
  line-height: 1.5;
}

/* ── Section headings (detail view) ──────────────── */
.section-title {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--text-3);
  margin-bottom: 12px;
}

.info-block {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 14px 16px;
  margin-bottom: 14px;
}

/* ── Screenshots grid ────────────────────────────── */
.screenshots-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
}

.screenshot-item {
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}

.screenshot-item img {
  width: 100%;
  height: auto;
  display: block;
  cursor: zoom-in;
  transition: opacity 0.15s;
}

.screenshot-item img:hover { opacity: 0.88; }

.screenshot-caption {
  padding: 6px 8px;
  font-size: 10px;
  font-family: monospace;
  color: var(--text-3);
  background: var(--surface-2);
  border-top: 1px solid var(--border);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ── Lightbox ─────────────────────────────────────── */
.lightbox {
  display: flex;
  opacity: 0;
  pointer-events: none;
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(0,0,0,0.82);
  backdrop-filter: blur(8px);
  align-items: center;
  justify-content: center;
  padding: 32px;
  transition: opacity 0.2s;
}

.lightbox.open {
  opacity: 1;
  pointer-events: auto;
}

.lightbox img {
  max-width: 90%;
  max-height: 88vh;
  border-radius: 8px;
  box-shadow: 0 25px 50px rgba(0,0,0,0.5);
  transform: scale(0.95);
  transition: transform 0.2s;
}

.lightbox.open img { transform: scale(1); }

.lightbox-close {
  position: fixed;
  top: 16px;
  right: 20px;
  font-size: 28px;
  color: #fff;
  background: none;
  border: none;
  cursor: pointer;
  opacity: 0.7;
  transition: opacity 0.1s;
}

.lightbox-close:hover { opacity: 1; }

/* ── Mobile responsive ───────────────────────────── */
.mobile-header {
  display: none;
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: var(--header-h);
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  z-index: 50;
}

@media (max-width: 768px) {
  .sidebar { transform: translateX(-100%); transition: transform 0.25s; }
  .sidebar.open { transform: translateX(0); }
  .main-content { margin-left: 0; padding-top: var(--header-h); }
  .mobile-header { display: flex; }
  .two-col { grid-template-columns: 1fr; }
  .stats-row { flex-wrap: wrap; }
  .stat-cell { min-width: 45%; }
  .sidebar-backdrop { display: block !important; }
}

.sidebar-backdrop {
  display: none;
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.4);
  z-index: 35;
}

/* ── Scrollbar ───────────────────────────────────── */
::-webkit-scrollbar { width: 5px; height: 5px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 99px; }
::-webkit-scrollbar-thumb:hover { background: var(--text-3); }

/* ── Utility ─────────────────────────────────────── */
.hidden { display: none !important; }
.truncate { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
a { color: inherit; text-decoration: none; }
`;

export const REPORT_SCRIPTS = `
(function () {
  var root = document.documentElement;

  // Early theme sync already done in <head>

  document.addEventListener('DOMContentLoaded', function () {

    // 1. Theme toggle
    var themeBtn = document.getElementById('theme-toggle');
    var themeIcon = document.getElementById('theme-icon');

    function updateThemeIcon() {
      var isDark = root.getAttribute('data-theme') === 'dark';
      if (themeIcon) {
        themeIcon.innerHTML = isDark
          ? '<path d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.36-6.36-.707.707M6.343 17.657l-.707.707M17.657 17.657l-.707-.707M6.343 6.343l-.707-.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'
          : '<path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
      }
    }

    updateThemeIcon();

    themeBtn && themeBtn.addEventListener('click', function () {
      var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      localStorage.setItem('webpilot-report-theme', next);
      updateThemeIcon();
    });

    // 2. Mobile sidebar
    var sidebar = document.getElementById('app-sidebar');
    var backdrop = document.getElementById('sidebar-backdrop');
    var mobileMenuBtn = document.getElementById('mobile-menu-btn');

    function openSidebar() {
      sidebar && sidebar.classList.add('open');
      backdrop && backdrop.classList.add('open');
    }

    function closeSidebar() {
      sidebar && sidebar.classList.remove('open');
      backdrop && backdrop.classList.remove('open');
    }

    mobileMenuBtn && mobileMenuBtn.addEventListener('click', openSidebar);
    backdrop && backdrop.addEventListener('click', closeSidebar);

    document.querySelectorAll('.nav-item, .sidebar-test-item').forEach(function(link) {
      link.addEventListener('click', function() {
        if (window.innerWidth < 768) closeSidebar();
      });
    });

    // 3. Lightbox
    var lightbox = document.getElementById('lightbox');
    var lightboxImg = document.getElementById('lightbox-img');
    var lightboxClose = document.getElementById('lightbox-close');

    document.querySelectorAll('[data-lightbox]').forEach(function(img) {
      img.addEventListener('click', function() {
        if (lightbox && lightboxImg) {
          lightboxImg.src = img.src;
          lightbox.classList.add('open');
        }
      });
    });

    function closeLightbox() { lightbox && lightbox.classList.remove('open'); }
    lightboxClose && lightboxClose.addEventListener('click', closeLightbox);
    lightbox && lightbox.addEventListener('click', function(e) { if (e.target === lightbox) closeLightbox(); });

    // 4. Hash-based router
    function handleRoute() {
      var hash = window.location.hash || '#overview';
      var viewOverview = document.getElementById('view-overview');
      var viewAi = document.getElementById('view-ai-briefing');
      var viewEnv = document.getElementById('view-environment');
      var viewTests = document.getElementById('view-test-cases');
      var viewPricing = document.getElementById('view-llm-pricing');
      var viewLogsIndex = document.getElementById('view-logs-index');
      var viewDetail = document.getElementById('view-test-details');

      // Hide all views
      [viewOverview, viewAi, viewEnv, viewTests, viewPricing, viewLogsIndex, viewDetail].forEach(function(v) {
        if (v) v.classList.add('hidden');
      });

      // Clear all nav active states
      document.querySelectorAll('.nav-item').forEach(function(n) { n.classList.remove('active'); });
      document.querySelectorAll('.sidebar-test-item').forEach(function(i) { i.classList.remove('active'); });

      if (hash === '#overview' || hash === '' || hash === '#') {
        if (viewOverview) viewOverview.classList.remove('hidden');
        var n = document.getElementById('nav-overview');
        if (n) n.classList.add('active');
      } else if (hash === '#ai-analysis') {
        if (viewAi) viewAi.classList.remove('hidden');
        var n = document.getElementById('nav-ai');
        if (n) n.classList.add('active');
      } else if (hash === '#environment') {
        if (viewEnv) viewEnv.classList.remove('hidden');
        var n = document.getElementById('nav-env');
        if (n) n.classList.add('active');
      } else if (hash === '#test-cases') {
        if (viewTests) viewTests.classList.remove('hidden');
        var n = document.getElementById('nav-tests');
        if (n) n.classList.add('active');
      } else if (hash === '#llm-pricing') {
        if (viewPricing) viewPricing.classList.remove('hidden');
        var n = document.getElementById('nav-pricing');
        if (n) n.classList.add('active');
      } else if (hash === '#logs') {
        if (viewLogsIndex) viewLogsIndex.classList.remove('hidden');
        var n = document.getElementById('nav-logs');
        if (n) n.classList.add('active');
      } else if (hash.startsWith('#test-')) {
        var slug = hash.substring(6);
        if (viewDetail) viewDetail.classList.remove('hidden');
        // hide all detail panels
        document.querySelectorAll('.test-detail-panel').forEach(function(p) { p.classList.add('hidden'); });
        var panel = document.getElementById('detail-' + slug);
        if (panel) panel.classList.remove('hidden');
        // highlight sidebar
        var item = document.querySelector('.sidebar-test-item[data-slug="' + slug + '"]');
        if (item) item.classList.add('active');
      }

      window.scrollTo(0, 0);
    }

    window.addEventListener('hashchange', handleRoute);
    handleRoute();

    // 5. Tabs
    document.querySelectorAll('.test-detail-panel').forEach(function(panel) {
      var tabBtns = panel.querySelectorAll('.tab-btn');
      var tabPanes = panel.querySelectorAll('.tab-pane');

      tabBtns.forEach(function(btn) {
        btn.addEventListener('click', function() {
          var target = btn.getAttribute('data-tab');
          tabBtns.forEach(function(b) { b.classList.remove('tab-active'); });
          btn.classList.add('tab-active');
          tabPanes.forEach(function(pane) {
            if (pane.getAttribute('data-tab-pane') === target) {
              pane.classList.remove('hidden');
            } else {
              pane.classList.add('hidden');
            }
          });
        });
      });
    });

    // 6. Sidebar search (on test-cases view)
    var searchInput = document.getElementById('sidebar-search');
    searchInput && searchInput.addEventListener('input', function() {
      var q = searchInput.value.toLowerCase().trim();
      document.querySelectorAll('.sidebar-test-item').forEach(function(item) {
        var name = (item.getAttribute('data-name') || '').toLowerCase();
        item.classList.toggle('hidden', q.length > 0 && !name.includes(q));
      });
    });

    // 7. Status filter pills in sidebar
    document.querySelectorAll('.sidebar-filter-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var filter = btn.getAttribute('data-filter');
        document.querySelectorAll('.sidebar-filter-btn').forEach(function(b) {
          b.classList.remove('active');
        });
        btn.classList.add('active');
        document.querySelectorAll('.sidebar-test-item').forEach(function(item) {
          var status = item.getAttribute('data-status');
          if (filter === 'all' || status === filter) {
            item.classList.remove('hidden');
          } else {
            item.classList.add('hidden');
          }
        });
      });
    });

    // 8. Overview table row click -> test detail
    document.querySelectorAll('.test-table-row').forEach(function(row) {
      row.addEventListener('click', function(e) {
        if (e.target.tagName === 'A' || (e.target.closest && e.target.closest('a'))) return;
        var slug = row.getAttribute('data-slug');
        if (slug) window.location.hash = '#test-' + slug;
      });
    });

  });
})();
`;
