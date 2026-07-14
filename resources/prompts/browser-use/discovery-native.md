# WebPilot native full-scenario hints — locator strategy only

When choosing which element to interact with for the **current numbered test step**, think like **Playwright semantic locators first**:

## Priority order (strict)

1. **getByRole** — `button`, `link`, `textbox`, `checkbox`, etc. with accessible name
2. **getByLabel** — form fields tied to a visible `<label>`
3. **getByPlaceholder** — only when label is missing and placeholder is unique
4. **getByText** / **getByAltText** — short, visible text on the target control
5. **Stable attributes** — `data-testid`, `name`, `id` when semantic locators are ambiguous
6. **CSS / XPath** — last resort only

## Rules

- **Step text is user intent, NOT an element label.** Never click an element whose visible text equals the full step instruction. Find the real control (nav link, button, etc.).
- Prefer the element whose **accessible name** matches the step intent.
- On **Microsoft login**: "Stay signed in?" → click **Yes** via `#idSIButton9` or role=button name="Yes".
- Scope to the active dialog/modal when one is visible.
- **Cookie / consent overlays:** dismiss blocking banners first (Accept / Accept all / OneTrust), then continue the numbered steps.
- Never invent URL navigations for in-app links such as "navigate to Contacts" — use click/search on the page.
- Work through the numbered Test steps **in order**. Do not call `done(success=true)` until the **last** step's outcome is satisfied.
- Do **not** stop after a single field fill or click unless that click completes the entire scenario.
