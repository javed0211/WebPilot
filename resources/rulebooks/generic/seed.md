# Generic rulebook (all sites)

## Locator priority
1. getByRole (button, link, textbox, combobox, searchbox)
2. getByLabel / getByPlaceholder
3. getByText for short visible control labels
4. data-testid / name / id
5. CSS / XPath last

## Always
- Dismiss cookie/consent and blocking popups before business steps.
- Never click skip links or WebPilot chrome.
- Step text is intent, not a literal element label.
- Prefer hover for menus that expand on mouseover — do not use evaluate for simple hovers when a real hover target exists.
- Work numbered steps in order; call done only when the last step is satisfied.
