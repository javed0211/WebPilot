import type { SuiteExecutionReport } from './types';

/**
 * Vanilla JS overlay injected into the React report-ui shell.
 * The React source tree is not in-repo (minified shell only), so this paints
 * Feature 11 governance surfaces from the same injected report JSON.
 *
 * Mounts inside `.page-body` / `#view-overview` so it follows the React layout
 * and uses the same light/dark CSS tokens as the dashboard.
 */
export function appendGovernanceOverlay(html: string, report: SuiteExecutionReport): string {
  const hasEvidence = report.testCases.some(
    (t) => t.risk || t.completeness || (t.evidenceHealing && t.evidenceHealing.length)
  );
  if (!hasEvidence) return html;

  const overlay = `
<style id="wp-gov-style">
#wp-gov-root{font-family:inherit;margin:0 0 14px;padding:0;color:var(--text);background:transparent}
#wp-gov-root .wp-gov-card{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:16px 18px;margin:0 0 14px;overflow:hidden}
#wp-gov-root .wp-gov-title{font-size:16px;font-weight:700;margin:0 0 12px;color:var(--text);letter-spacing:-.01em;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
#wp-gov-root .wp-gov-subtitle{font-size:12px;font-weight:700;margin:16px 0 8px;color:var(--text-2)}
#wp-gov-root .wp-gov-pills{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:10px}
#wp-gov-root .wp-pill{display:inline-flex;align-items:center;font-size:11px;font-weight:700;padding:3px 10px;border-radius:999px;letter-spacing:.02em;text-transform:uppercase}
#wp-gov-root .wp-ok{color:var(--success-text);background:var(--success-bg)}
#wp-gov-root .wp-bad{color:var(--danger-text);background:var(--danger-bg)}
#wp-gov-root .wp-warn{color:#b54708;background:#fffaeb}
#wp-gov-root .wp-neutral{color:var(--text-2);background:var(--surface-2)}
#wp-gov-root table{width:100%;border-collapse:collapse;font-size:12.5px}
#wp-gov-root th,#wp-gov-root td{text-align:left;padding:8px 10px;border-top:1px solid var(--border-light);vertical-align:top;color:var(--text-2)}
#wp-gov-root th{color:var(--text-3);font-size:11px;font-weight:650}
#wp-gov-root code{font-size:11px;color:var(--brand);word-break:break-all;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--surface-2);padding:1px 4px;border-radius:3px}
#wp-gov-root a{color:var(--brand);font-size:12.5px;font-weight:650;text-decoration:none}
#wp-gov-root a:hover{text-decoration:underline}
#wp-gov-root .wp-muted{color:var(--text-2);font-size:12.5px;margin:0 0 6px;line-height:1.5}
[data-theme="dark"] #wp-gov-root .wp-warn{color:var(--warning);background:color-mix(in srgb,var(--warning) 14%,var(--surface))}
</style>
<div id="wp-gov-root" hidden></div>
<script id="wp-gov-boot">
(function(){
  function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
  function pill(label, tone){
    var cls = tone==='ok'?'wp-ok':tone==='bad'?'wp-bad':tone==='warn'?'wp-warn':'wp-neutral';
    return '<span class="wp-pill '+cls+'">'+esc(label)+'</span>';
  }
  function riskTone(level){
    if(level==='low') return 'ok';
    if(level==='medium') return 'warn';
    return 'bad';
  }
  function gradeTone(grade){
    if(grade==='A'||grade==='B') return 'ok';
    if(grade==='C') return 'warn';
    return 'bad';
  }
  function renderTest(t){
    if(!t.risk && !t.completeness && !(t.evidenceHealing&&t.evidenceHealing.length) && !(t.evidenceLocators&&t.evidenceLocators.total) && !(t.evidenceDrift&&t.evidenceDrift.length)) return '';
    var link = t.evidenceRef
      ? '<a href="../'+esc(String(t.evidenceRef).replace(/^runtime\\/reports\\//,''))+'" target="_blank" rel="noopener">Evidence JSON</a>'
      : '';
    var pills = '<div class="wp-gov-pills">'
      +(t.risk?pill('risk '+t.risk.level+' ('+t.risk.score+')', riskTone(t.risk.level)):'')
      +(t.completeness?pill('completeness '+t.completeness.grade+' ('+t.completeness.score+')', gradeTone(t.completeness.grade)):'')
      +(typeof t.healingCount==='number'?pill('healed '+t.healingCount, t.healingCount===0?'ok':'warn'):'')
      +(t.codegenQuality?pill('codegen '+t.codegenQuality, t.codegenQuality==='good'?'ok':'warn'):'')
      +(t.evidenceLocators?pill('verified '+t.evidenceLocators.verified+'/'+t.evidenceLocators.total, (t.evidenceLocators.verifiedRatio==null?false:t.evidenceLocators.verifiedRatio>=0.8)?'ok':'bad'):'')
      +'</div>';
    var factors = (t.risk&&t.risk.factors&&t.risk.factors.length)
      ? '<p class="wp-muted">Risk factors: '+esc(t.risk.factors.map(function(f){return f.id+'(+'+f.weight+')';}).join(', '))+'</p>' : '';
    var warnings = (t.completeness&&t.completeness.warnings&&t.completeness.warnings.length)
      ? '<p class="wp-muted">Warnings: '+esc(t.completeness.warnings.join('; '))+'</p>' : '';
    var heal = '';
    if(t.evidenceHealing&&t.evidenceHealing.length){
      heal = '<div class="wp-gov-subtitle">Heal Ledger</div><table><thead><tr><th>Step</th><th>Broken</th><th>Healed</th><th>Class</th></tr></thead><tbody>'
        +t.evidenceHealing.map(function(h){
          return '<tr><td>#'+h.stepIndex+'</td><td><code>'+esc(h.brokenSelector||'—')+'</code></td><td><code>'+esc(h.healedSelector||'—')+'</code></td><td>'+esc(h.classification||'—')+'</td></tr>';
        }).join('')+'</tbody></table>';
    }
    var locs = '';
    if(t.evidenceTimeline&&t.evidenceLocators&&t.evidenceLocators.total){
      var rows = t.evidenceTimeline.filter(function(s){return s.locator&&(s.locator.used||s.locator.kind);}).map(function(s){
        return '<tr><td>#'+s.index+'</td><td><code>'+esc((s.locator&&s.locator.used)||'')+'</code></td><td>'+(s.locator&&s.locator.verified?pill('verified','ok'):pill('unverified','bad'))+'</td></tr>';
      }).join('');
      locs = '<div class="wp-gov-subtitle">Locator Verification · '+t.evidenceLocators.verified+'/'+t.evidenceLocators.total+'</div><table><thead><tr><th>Step</th><th>Locator</th><th>Status</th></tr></thead><tbody>'+rows+'</tbody></table>';
    }
    var drift = '';
    if(t.evidenceDrift&&t.evidenceDrift.length){
      drift = '<div class="wp-gov-subtitle">Page Drift</div><table><thead><tr><th>Page</th><th>Prev</th><th>Curr</th><th>+/−/~</th></tr></thead><tbody>'
        +t.evidenceDrift.map(function(d){
          return '<tr><td><code>'+esc(d.pageKey)+'</code></td><td>'+esc(d.previousFingerprint||'—')+'</td><td>'+esc(d.currentFingerprint||'—')+'</td><td>+'+(d.added||0)+' / −'+(d.removed||0)+' / ~'+(d.changed||0)+'</td></tr>';
        }).join('')+'</tbody></table>';
    }
    return '<div class="wp-gov-card"><div class="wp-gov-title"><span>Evidence &amp; Governance · '+esc(t.testName||t.slug)+'</span>'+link+'</div>'+pills+factors+warnings+heal+locs+drift+'</div>';
  }
  function placeRoot(root){
    var overview = document.getElementById('view-overview');
    if(overview){
      // Sit under the KPI strip on the React overview (after context/kpi if present).
      var kpi = overview.querySelector('.overview-kpi-strip');
      if(kpi && kpi.parentNode){
        kpi.parentNode.insertBefore(root, kpi.nextSibling);
        return;
      }
      overview.insertBefore(root, overview.firstChild);
      return;
    }
    var detail = document.querySelector('.test-detail-panel');
    if(detail){
      var hero = detail.querySelector('.execution-hero');
      if(hero && hero.parentNode){
        hero.parentNode.insertBefore(root, hero.nextSibling);
        return;
      }
      detail.insertBefore(root, detail.firstChild);
      return;
    }
    var pageBody = document.querySelector('.page-body');
    if(pageBody){
      pageBody.appendChild(root);
      return;
    }
    if(document.body) document.body.appendChild(root);
  }
  function mount(){
    try{
      var el = document.getElementById('webpilot-report-data');
      var root = document.getElementById('wp-gov-root');
      if(!el||!root) return;
      var data = JSON.parse(el.textContent||'{}');
      var tests = (data&&data.testCases)||[];
      var html = tests.map(renderTest).filter(Boolean).join('');
      if(!html) return;
      root.innerHTML = html;
      root.hidden = false;
      placeRoot(root);
    }catch(e){/* ignore */}
  }
  function boot(){
    mount();
    // React hydrates after this script; remount once the overview/detail exists.
    var tries = 0;
    var timer = setInterval(function(){
      tries += 1;
      var ready = document.getElementById('view-overview') || document.querySelector('.test-detail-panel') || document.querySelector('.page-body');
      if(ready){ mount(); clearInterval(timer); }
      if(tries > 40) clearInterval(timer);
    }, 100);
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
</script>`;

  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${overlay}</body>`);
  }
  return `${html}${overlay}`;
}
