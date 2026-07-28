"""
WebPilot browser-use branding: Google Chrome channel + in-page agent chrome (blue border, badge).
"""
from __future__ import annotations

from typing import Any

# Last status pushed from Python (survives full page navigations).
_last_branding_status: dict[str, Any] | None = None

WEBPILOT_BRANDING_INIT_SCRIPT = r"""(function () {
  const STYLE_ID = 'webpilot-agent-branding-style';
  const BORDER_ID = 'webpilot-agent-border';
  const BADGE_ID = 'webpilot-corner-badge';
  const UI_ID = 'webpilot-agent-ui';
  const STATUS_KEY = '__webpilotAgentStatus';

  function loadPersistedStatus() {
    if (window.__webpilotBootstrapStatus) {
      return window.__webpilotBootstrapStatus;
    }
    try {
      const raw = sessionStorage.getItem(STATUS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function persistStatus(data) {
    if (!data) {
      return;
    }
    window.__webpilotLastStatus = data;
    try {
      sessionStorage.setItem(STATUS_KEY, JSON.stringify(data));
    } catch (e) {}
  }

  function applyStatusToDom(data) {
    if (!data) {
      return;
    }
    const stepsEl = document.getElementById('webpilot-steps-container');
    if (stepsEl && data.allSteps) {
      const stepsHtml = data.allSteps.map(function (s) {
        return (
          '<li class="wp-step-item">' +
          '<span class="wp-step-number">' + s.index + '</span>' +
          '<span>' + s.text + '</span></li>'
        );
      }).join('');
      stepsEl.innerHTML = stepsHtml;
    }
    const statusBadge = document.getElementById('webpilot-status-badge');
    if (statusBadge) {
      statusBadge.textContent = data.currentIndex
        ? 'ITERATION ' + data.currentIndex
        : 'AGENT STARTING';
    }
    const currentText = document.getElementById('webpilot-current-text');
    if (currentText) {
      currentText.textContent = data.currentText || 'Working...';
    }
    const tokensEl = document.getElementById('webpilot-tokens');
    if (tokensEl) {
      const n = Number(data.tokens != null ? data.tokens : 0);
      tokensEl.textContent = Number.isFinite(n) ? n.toLocaleString() : '0';
    }
    const costEl = document.getElementById('webpilot-cost');
    if (costEl) {
      costEl.textContent = '$' + (data.cost != null ? data.cost : '0.0000');
    }
  }

  function inject() {
    const root = document.documentElement;
    if (!root) {
      return;
    }

    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = `
        #${BORDER_ID} {
          position: fixed;
          inset: 0;
          width: 100vw;
          height: 100vh;
          margin: 0;
          padding: 0;
          pointer-events: none;
          z-index: 2147483646;
          border: none;
          outline: 6px solid #2563eb;
          outline-offset: -6px;
          box-shadow: inset 0 0 0 2px rgba(37, 99, 235, 0.35);
          box-sizing: border-box;
        }
        #${BADGE_ID} {
          position: fixed;
          top: 12px;
          right: 12px;
          z-index: 2147483647;
          pointer-events: none;
          font: 600 13px/1.2 system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          color: #ffffff;
          background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
          padding: 8px 14px;
          border-radius: 8px;
          box-shadow: 0 4px 14px rgba(37, 99, 235, 0.5);
          letter-spacing: 0.02em;
        }
        #${UI_ID} {
          position: fixed;
          bottom: 0;
          left: 0;
          right: 0;
          background: rgba(15, 23, 42, 0.95);
          color: white;
          font-family: system-ui, -apple-system, sans-serif;
          z-index: 2147483647;
          box-shadow: 0 -4px 6px -1px rgba(0, 0, 0, 0.1);
          backdrop-filter: blur(8px);
          border-top: 1px solid rgba(255, 255, 255, 0.1);
          display: flex;
          flex-direction: column;
          transition: transform 0.3s ease;
          /* Visual-only: must not enter browser-use selector_map / steal focus */
          pointer-events: none;
        }
        .wp-bar {
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 12px 20px;
          min-height: 60px;
          box-sizing: border-box;
        }
        .wp-bar-inner {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 20px;
          flex-wrap: wrap;
          width: 100%;
          max-width: 1100px;
        }
        .wp-left { display: flex; align-items: center; gap: 16px; flex: 1; justify-content: center; min-width: 0; }
        .wp-badge {
          background: #3b82f6;
          color: white;
          padding: 4px 10px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.5px;
          white-space: nowrap;
        }
        .wp-text { font-size: 14px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 600px; color: #f8fafc; }
        .wp-right { display: flex; align-items: center; gap: 24px; pointer-events: none; }
        .wp-stat { display: flex; flex-direction: column; font-size: 11px; color: #94a3b8; }
        .wp-stat span { font-size: 14px; font-weight: 600; color: white; margin-top: 2px; }
        .wp-btn {
          background: rgba(255,255,255,0.1);
          border: 1px solid rgba(255,255,255,0.2);
          color: white;
          padding: 6px 12px;
          border-radius: 6px;
          cursor: default;
          font-size: 13px;
          font-weight: 500;
          pointer-events: none;
        }
        .wp-panel {
          height: 0;
          overflow-y: auto;
          transition: height 0.3s ease;
          background: rgba(15, 23, 42, 0.98);
          pointer-events: none;
        }
        .wp-panel.open { height: 300px; border-top: 1px solid rgba(255, 255, 255, 0.1); }
        .wp-steps-list { padding: 20px; margin: 0; list-style: none; }
        .wp-step-item {
          display: flex;
          gap: 12px;
          padding: 10px 0;
          border-bottom: 1px solid rgba(255,255,255,0.05);
          color: #94a3b8;
          font-size: 13px;
        }
        .wp-step-number { font-weight: bold; min-width: 24px; }
        .wp-step-item.active { color: white; background: rgba(59, 130, 246, 0.1); border-radius: 6px; padding: 10px; border-bottom: none; }
      `;
      (document.head || root).appendChild(style);
    }

    const host = document.body || root;
    if (!document.getElementById(BORDER_ID)) {
      const border = document.createElement('div');
      border.id = BORDER_ID;
      border.setAttribute('aria-hidden', 'true');
      host.appendChild(border);
    }

    if (!document.getElementById(BADGE_ID)) {
      const badge = document.createElement('div');
      badge.id = BADGE_ID;
      badge.textContent = 'WebPilot';
      badge.setAttribute('aria-hidden', 'true');
      host.appendChild(badge);
    }

    if (!document.getElementById(UI_ID)) {
      const ui = document.createElement('div');
      ui.id = UI_ID;
      ui.setAttribute('aria-hidden', 'true');
      
      window.toggleWpPanel = function() {
        const panel = document.getElementById('webpilot-panel');
        if (panel) panel.classList.toggle('open');
      };
      
      host.appendChild(ui);
      
      // Default initial state
      ui.innerHTML = [
        '<div id="webpilot-panel" class="wp-panel">',
        '  <ul class="wp-steps-list" id="webpilot-steps-container"></ul>',
        '</div>',
        '<div class="wp-bar">',
        '  <div class="wp-bar-inner">',
        '    <div class="wp-left">',
        '      <div class="wp-badge" id="webpilot-status-badge">AGENT STARTING</div>',
        '      <div class="wp-text" id="webpilot-current-text">Starting agent...</div>',
        '    </div>',
        '    <div class="wp-right">',
        '      <div class="wp-stat">TOKENS USED<span id="webpilot-tokens">0</span></div>',
        '      <div class="wp-stat">EST. COST<span id="webpilot-cost">$0.0000</span></div>',
        '      <span class="wp-btn" id="webpilot-details-btn" aria-hidden="true">Details</span>',
        '    </div>',
        '  </div>',
        '</div>',
      ].join('');
      // Details is display-only (pointer-events:none) so it never enters browser-use's index.
      applyStatusToDom(loadPersistedStatus());
      delete window.__webpilotBootstrapStatus;
    } else {
      applyStatusToDom(loadPersistedStatus());
    }
  }

  window.updateWebpilotStatus = function (data) {
    if (!data) {
      return;
    }
    persistStatus(data);
    inject();
    applyStatusToDom(data);
  };

  inject();

  if (!window.__webpilotBrandingListeners) {
    window.__webpilotBrandingListeners = true;
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', inject, { once: true });
    }
    window.addEventListener('pageshow', inject);
    window.addEventListener('load', inject);
  }
})();"""


def resolve_browser_channel(target: str | None) -> str:
    """Map config/webpilot.yaml browser.target to browser-use BrowserChannel value."""
    t = (target or 'chrome').lower().strip()
    channel_map = {
        'chrome': 'chrome',
        'chromium': 'chromium',
        'chrome-beta': 'chrome-beta',
        'chrome-dev': 'chrome-dev',
        'chrome-canary': 'chrome-canary',
        'msedge': 'msedge',
        'edge': 'msedge',
        'firefox': 'chromium',
        'webkit': 'chromium',
    }
    return channel_map.get(t, 'chrome')


def build_browser_kwargs(
    browser_cfg: dict[str, Any],
    *,
    test_name: str | None = None,
) -> dict[str, Any]:
    """Build browser-use Browser() kwargs from WebPilot artifact config."""
    testmu = browser_cfg.get('testmu') or {}
    if testmu.get('enabled'):
        from .testmu import build_testmu_cdp_url

        viewport = browser_cfg.get('viewport') or {'width': 1280, 'height': 720}
        cdp_url = build_testmu_cdp_url(
            testmu,
            test_name or testmu.get('name', 'WebPilot Test'),
            viewport=viewport,
        )
        kwargs: dict[str, Any] = {
            'cdp_url': cdp_url,
            'is_local': False,
            'headless': False,
            'disable_security': False,
            'viewport': viewport,
        }
        if browser_cfg.get('record_trace'):
            kwargs['traces_dir'] = browser_cfg['traces_dir']
        return kwargs

    viewport = browser_cfg.get('viewport') or {'width': 1280, 'height': 720}
    headless = bool(browser_cfg.get('headless', False))
    kwargs: dict[str, Any] = {
        'headless': headless,
        'disable_security': False, # Changed to False to prevent the "invalid argument" infobar in Chromium
        'enable_default_extensions': False,
        'channel': resolve_browser_channel(browser_cfg.get('target')),
        # Drop flags Chrome now warns about or that show automation infobars.
        'ignore_default_args': [
            '--enable-automation',
            '--extensions-on-chrome-urls',
            '--disable-blink-features=AutomationControlled',
        ],
    }
    if headless:
        # Headless needs an explicit content size (no OS window).
        kwargs['viewport'] = viewport
    else:
        # Headful: fill the OS window. Do NOT set viewport — a fixed viewport larger
        # than the window causes the classic "content bigger than chrome" mismatch.
        # Prefer --start-maximized; prefer_maximized_window() clears browser-use's
        # auto window_size=screen so it cannot inject competing --window-size flags.
        kwargs['no_viewport'] = True
        kwargs['args'] = ['--start-maximized']
    # Prefer discovery-session video (CDP screencast + ffmpeg) so report evidence does
    # not require a second Playwright browser. Disabled when ffmpeg is unavailable.
    if browser_cfg.get('record_video') and browser_cfg.get('video_dir'):
        kwargs['record_video_dir'] = browser_cfg['video_dir']
        size = viewport if isinstance(viewport, dict) else {'width': 1280, 'height': 720}
        kwargs['record_video_size'] = {
            'width': int(size.get('width') or 1280),
            'height': int(size.get('height') or 720),
        }
    if browser_cfg.get('record_trace'):
        kwargs['traces_dir'] = browser_cfg['traces_dir']
    return kwargs


def prefer_maximized_window(browser: Any) -> None:
    """Stop browser-use from emitting --window-size=screen (fights --start-maximized).

    BrowserProfile.detect_display_configuration() always sets window_size to the
    display size in headful mode, which makes get_args() prefer --window-size over
    --start-maximized. Clear it before launch so maximize wins.
    """
    try:
        profile = getattr(browser, 'browser_profile', None)
        if profile is None or getattr(profile, 'headless', False):
            return
        profile.window_size = None
        profile.no_viewport = True
        profile.viewport = None
    except Exception as exc:
        print(f'[WebPilot] Warning: could not prefer maximized window: {exc}')


async def ensure_window_maximized(browser_session: Any) -> None:
    """Maximize the OS window via CDP after launch (belt-and-suspenders with --start-maximized)."""
    try:
        profile = getattr(browser_session, 'browser_profile', None)
        if profile is not None and getattr(profile, 'headless', False):
            return
        cdp = await browser_session.get_or_create_cdp_session()
        target_id = getattr(cdp, 'target_id', None) or getattr(
            browser_session, 'agent_focus_target_id', None
        )
        if not target_id:
            return
        window_info = await cdp.cdp_client.send.Browser.getWindowForTarget(
            params={'targetId': target_id},
        )
        window_id = window_info.get('windowId')
        if window_id is None:
            return
        await cdp.cdp_client.send.Browser.setWindowBounds(
            params={
                'windowId': window_id,
                'bounds': {'windowState': 'maximized'},
            },
        )
        print('[WebPilot] Browser window maximized')
    except Exception as exc:
        print(f'[WebPilot] Warning: could not maximize browser window: {exc}')


async def inject_webpilot_branding(
    browser_session: Any,
    bootstrap_status: dict[str, Any] | None = None,
) -> None:
    """Register init script so every page shows WebPilot border + badge."""
    global _last_branding_status
    if bootstrap_status is not None:
        _last_branding_status = bootstrap_status
    try:
        import json

        await browser_session._cdp_add_init_script(WEBPILOT_BRANDING_INIT_SCRIPT)
        cdp = await browser_session.get_or_create_cdp_session()
        bootstrap_expr = ''
        if _last_branding_status:
            payload = json.dumps(_last_branding_status)
            bootstrap_expr = f'window.__webpilotBootstrapStatus = {payload};'
        await cdp.cdp_client.send.Runtime.evaluate(
            params={
                'expression': bootstrap_expr + WEBPILOT_BRANDING_INIT_SCRIPT,
                'returnByValue': False,
            },
            session_id=cdp.session_id,
        )
        print('[WebPilot] Injected agent branding (blue border + WebPilot badge)')
    except Exception as exc:
        print(f'[WebPilot] Warning: Could not inject branding overlay: {exc}')


async def push_branding_status(browser_session: Any, data: dict[str, Any]) -> None:
    """Update overlay without flashing default text between agent steps."""
    global _last_branding_status
    _last_branding_status = data
    import json

    cdp = await browser_session.get_or_create_cdp_session()
    payload = json.dumps(data)

    # Prefer a light update on the current page (no full re-init).
    result = await cdp.cdp_client.send.Runtime.evaluate(
        params={
            'expression': (
                '(function () {'
                'if (typeof window.updateWebpilotStatus !== "function") return false;'
                f'window.updateWebpilotStatus({payload});'
                'return true;'
                '})()'
            ),
            'returnByValue': True,
        },
        session_id=cdp.session_id,
    )
    updated = (result.get('result') or {}).get('value')
    if updated:
        return

    await inject_webpilot_branding(browser_session, bootstrap_status=data)


def install_branding_hook() -> None:
    """Hook BrowserSession.start so branding is injected when the browser launches."""
    from browser_use.browser.session import BrowserSession

    if getattr(BrowserSession, '_webpilot_branding_hook_installed', False):
        return

    original_start = BrowserSession.start

    async def start_with_branding(self: Any) -> Any:
        result = await original_start(self)
        await inject_webpilot_branding(self)
        return result

    BrowserSession.start = start_with_branding  # type: ignore[method-assign]
    BrowserSession._webpilot_branding_hook_installed = True
