# WebPilot step discovery — locator strategy (mandatory)

When choosing which element to interact with, think like **Playwright semantic locators first**:

## Priority order (strict)

1. **getByRole** — `button`, `link`, `textbox`, `checkbox`, etc. with accessible name (e.g. role=button name="Yes")
2. **getByLabel** — form fields tied to a visible `<label>`
3. **getByPlaceholder** — only when label is missing and placeholder is unique on the page
4. **getByText** / **getByAltText** — short, visible text on the target control
5. **Stable attributes** — `data-testid`, `name`, `id` when semantic locators are ambiguous
6. **CSS / XPath** — last resort only

## Rules

- **Step text is user intent, NOT an element label.** Never click an element whose visible text equals the full step instruction (e.g. do not click a span literally named "click on application link…"). Find the real control: app switcher, nav menu, `role=button`, `role=link`, etc.
- **Memory must describe the current page only.** Do not claim progress from "previous sessions" or earlier failed clicks in this step — re-read the DOM each action.
- Prefer the element whose **accessible name** matches the step intent (e.g. step says "Click Yes" → role=button name="Yes", not a nearby div).
- On **Microsoft login** (`login.microsoftonline.com`): "Stay signed in?" → click **Yes** via `#idSIButton9` or role=button name="Yes" (`input[type=submit][value="Yes"]`).
- Scope to the active dialog/modal when one is visible — do not click footer or background duplicates.
- **Cookie / consent overlays:** If a banner blocks inputs or navigation, dismiss it first (e.g. **Accept**, **Accept all cookies**, **Consent**, OneTrust `#onetrust-accept-btn-handler`). Do not call done(success=true) while the overlay still covers the target control.
- For submit controls, treat `input[type="submit"]` and `input[type="button"]` as buttons when they have a visible label/value.
- Never pick an element only because it is first in the DOM tree; match **meaning** first.

## Before calling done(success=true)

Confirm the step's observable outcome on the page (navigation, field value, visible heading, etc.).
- **Login steps:** not complete until past Microsoft "Stay signed in?" (click **Yes**) and the target app shell is loading or visible.

## After performing the step action (critical)

- If you **clicked** Continue / Next / Sign in / Confirm and the form **progressed** (e.g. password field appears, Continue disappears, URL changes), call `done(success=true)` immediately.
- Do **not** search again for the same button and treat its absence as failure — that usually means the click already worked.
- If you **entered** a value into the intended field, call `done(success=true)` — do not continue to the next scenario step.
