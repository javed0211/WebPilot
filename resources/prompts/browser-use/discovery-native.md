# WebPilot native full-scenario hints — optional guidance only

browser-use owns element targeting (index / selector_map). These hints are
**optional** — do not invent interactions that are not required by the numbered steps.

## When blocked

- Dismiss cookie/consent overlays only when they block the next test step.
- Scope to the active dialog/modal when one is visible and required.
- On Microsoft login: "Stay signed in?" → click **Yes** when shown.

## Navigation

- Never invent URL navigations for in-app links such as "navigate to Contacts" —
  use click/search on the page.
- Work through the numbered Test steps **in order**.
- Call `done(success=true)` only when the **last** step's outcome is satisfied.

## Do not

- Stop after a single field fill or click unless that completes the entire scenario.
- Click an element whose visible text equals the full step instruction — find the real control.
