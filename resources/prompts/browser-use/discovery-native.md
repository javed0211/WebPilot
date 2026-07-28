# WebPilot native full-scenario hints — locator strategy only

When choosing which element to interact with for the **current numbered test step**, think like **Playwright semantic locators first**:

## Priority order (strict)

1. **getByRole** — `button`, `link`, `textbox`, `combobox`, `searchbox`, `checkbox`, etc. with accessible name
2. **getByLabel** — form fields tied to a visible `<label>`
3. **getByPlaceholder** — only when label is missing and placeholder is unique
4. **getByText** / **getByAltText** — short, visible text on the target control
5. **Stable attributes** — `data-testid`, `name`, `id` when semantic locators are ambiguous
6. **CSS / XPath** — last resort only

## Hard bans (never interact)

- Never `input` / `click` / focus **skip links** — e.g. “Skip to main content”, `a[href="#main"]`, `a[href="#content"]`.
- If typed text does not appear in the field (agent note: actual value differs), you mistargeted — find the real textbox/combobox and retry.
- Never interact with WebPilot chrome (`#webpilot-agent-ui`, Details, token/cost badges).

## Rules

- **Step text is user intent, NOT an element label.** Never click an element whose visible text equals the full step instruction. Find the real control (nav link, button, etc.).
- Prefer the element whose **accessible name** matches the step intent.
- On **Microsoft login**: "Stay signed in?" → click **Yes** via `#idSIButton9` or role=button name="Yes".
- Scope to the active dialog/modal when one is visible.
- **Cookie / consent overlays:** dismiss blocking banners first (Accept / Accept all / OneTrust), then continue the numbered steps.
- **Sign-in / newsletter / app-download / Genius-style popups (any site):** if an interstitial blocks the page, dismiss it (Close, Dismiss, X, Not now, No thanks) before continuing. Do not sign in or subscribe unless the test steps require it.
- Never invent URL navigations for in-app links such as "navigate to Contacts" — use click/search on the page.
- Work through the numbered Test steps **in order**. Do not call `done(success=true)` until the **last** step's outcome is satisfied — including date pickers, Search, and verification steps.
- Do **not** stop after a single field fill or click unless that click completes the entire scenario.
- **Act, don't inspect-loop:** for simple type/click/navigate steps, interact immediately once the control is found. Do not spend multiple agent steps on screenshot / evaluate / search_page / find_elements just to re-confirm the same field. If an action fails, retry once with a better locator — then move on or report failure.
- Prefer emitting the real user actions (type, click, select) so discovery can map them back to the numbered NL steps. Exploration tools are for finding a control, not for replaying the step.
