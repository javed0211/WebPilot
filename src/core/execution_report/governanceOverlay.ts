import type { SuiteExecutionReport } from './types';

/**
 * Vanilla JS overlay injected into the React report-ui shell.
 * The React source tree is not in-repo (minified shell only), so this paints
 * Feature 11 governance surfaces from the same injected report JSON.
 */
export function appendGovernanceOverlay(html: string, report: SuiteExecutionReport): string {
  const hasEvidence = report.testCases.some(
    (t) => t.risk || t.completeness || (t.evidenceHealing && t.evidenceHealing.length)
  );
  if (!hasEvidence) return html;

  const overlay = `
<style id="wp-gov-style">
#wp-gov-root{font-family:ui-sans-serif,system-ui,sans-serif;margin:0;padding:12px 16px;background:#0f172a;color:#e2e8f0;border-bottom:1px solid #334155}
#wp-gov-root .wp-gov-card{background:#1e293b;border:1px solid #334155;border-radius:8px;padding:12px;margin:8px 0}
#wp-gov-root .wp-gov-title{font-size:13px;font-weight:700;margin:0 0 8px;color:#f8fafc}
#wp-gov-root .wp-gov-pills{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:8px}
#wp-gov-root .wp-pill{font-size:11px;font-weight:600;padding:2px 8px;border-radius:999px;border:1px solid #475569}
#wp-gov-root .wp-ok{color:#4ade80;border-color:#4ade80}
#wp-gov-root .wp-bad{color:#f87171;border-color:#f87171}
#wp-gov-root table{width:100%;border-collapse:collapse;font-size:12px}
#wp-gov-root th,#wp-gov-root td{text-align:left;padding:6px 8px;border-top:1px solid #334155;vertical-align:top}
#wp-gov-root code{font-size:11px;color:#93c5fd;word-break:break-all}
#wp-gov-root a{color:#38bdf8}
#wp-gov-root .wp-muted{color:#94a3b8;font-size:11px}
</style>
<div id="wp-gov-root" hidden></div>
<script id="wp-gov-boot">
(function(){
  function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
  function pill(label, ok){return '<span class="wp-pill '+(ok?'wp-ok':'wp-bad')+'">'+esc(label)+'</span>';}
  function renderTest(t){
    if(!t.risk && !t.completeness && !(t.evidenceHealing&&t.evidenceHealing.length) && !(t.evidenceLocators&&t.evidenceLocators.total) && !(t.evidenceDrift&&t.evidenceDrift.length)) return '';
    var riskOk = t.risk && (t.risk.level==='low'||t.risk.level==='medium');
    var gradeOk = t.completeness && (t.completeness.grade==='A'||t.completeness.grade==='B');
    var pills = '<div class="wp-gov-pills">'
      +(t.risk?pill('risk '+t.risk.level+' ('+t.risk.score+')', !!riskOk):'')
      +(t.completeness?pill('completeness '+t.completeness.grade+' ('+t.completeness.score+')', !!gradeOk):'')
      +(typeof t.healingCount==='number'?pill('healed '+t.healingCount, t.healingCount===0):'')
      +(t.codegenQuality?pill('codegen '+t.codegenQuality, t.codegenQuality==='good'):'')
      +(t.evidenceLocators?pill('verified '+t.evidenceLocators.verified+'/'+t.evidenceLocators.total, t.evidenceLocators.verifiedRatio>=0.8):'')
      +(t.evidenceRef?'<a href="../'+esc(String(t.evidenceRef).replace(/^runtime\\/reports\\//,''))+'" target="_blank" rel="noopener">Evidence JSON</a>':'')
      +'</div>';
    var factors = (t.risk&&t.risk.factors&&t.risk.factors.length)
      ? '<p class="wp-muted">Factors: '+esc(t.risk.factors.map(function(f){return f.id+'(+'+f.weight+')';}).join(', '))+'</p>' : '';
    var heal = '';
    if(t.evidenceHealing&&t.evidenceHealing.length){
      heal = '<div class="wp-gov-title">Heal Ledger</div><table><thead><tr><th>Step</th><th>Broken</th><th>Healed</th><th>Class</th></tr></thead><tbody>'
        +t.evidenceHealing.map(function(h){
          return '<tr><td>#'+h.stepIndex+'</td><td><code>'+esc(h.brokenSelector||'—')+'</code></td><td><code>'+esc(h.healedSelector||'—')+'</code></td><td>'+esc(h.classification||'—')+'</td></tr>';
        }).join('')+'</tbody></table>';
    }
    var locs = '';
    if(t.evidenceTimeline&&t.evidenceLocators&&t.evidenceLocators.total){
      var rows = t.evidenceTimeline.filter(function(s){return s.locator&&(s.locator.used||s.locator.kind);}).map(function(s){
        return '<tr><td>#'+s.index+'</td><td><code>'+esc((s.locator&&s.locator.used)||'')+'</code></td><td>'+(s.locator&&s.locator.verified?pill('verified',true):pill('unverified',false))+'</td></tr>';
      }).join('');
      locs = '<div class="wp-gov-title">Locator Verification · '+t.evidenceLocators.verified+'/'+t.evidenceLocators.total+'</div><table><thead><tr><th>Step</th><th>Locator</th><th>Status</th></tr></thead><tbody>'+rows+'</tbody></table>';
    }
    var drift = '';
    if(t.evidenceDrift&&t.evidenceDrift.length){
      drift = '<div class="wp-gov-title">Page Drift</div><table><thead><tr><th>Page</th><th>Prev</th><th>Curr</th><th>+/−/~</th></tr></thead><tbody>'
        +t.evidenceDrift.map(function(d){
          return '<tr><td><code>'+esc(d.pageKey)+'</code></td><td>'+esc(d.previousFingerprint||'—')+'</td><td>'+esc(d.currentFingerprint||'—')+'</td><td>+'+(d.added||0)+' / −'+(d.removed||0)+' / ~'+(d.changed||0)+'</td></tr>';
        }).join('')+'</tbody></table>';
    }
    return '<div class="wp-gov-card"><div class="wp-gov-title">'+esc(t.testName||t.slug)+' · Governance</div>'+pills+factors+heal+locs+drift+'</div>';
  }
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
    if(document.body && root.parentNode!==document.body){
      document.body.insertBefore(root, document.body.firstChild);
    }
  }catch(e){/* ignore */}
})();
</script>`;

  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${overlay}</body>`);
  }
  return `${html}${overlay}`;
}
