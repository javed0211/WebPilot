# Multi-Language Codegen

WebPilot generates automation code for **multiple language and framework profiles** — not only TypeScript Playwright.

---

## Overview

During `webpilot init`, you choose a project profile. Codegen reads that profile and emits files in the correct language, test runner, locator syntax, and page object pattern.

**Source of truth** in `resources/config/webpilot.yaml`:

```yaml
project:
  language: "typescript"
  automationTool: "playwright"
  testFramework: "playwright-test"
  frameworkPattern: "pom"
```

---

## Supported profiles

| Language | Tool | Pattern | Codegen | Init scaffold | Validation |
|----------|------|---------|---------|---------------|------------|
| TypeScript | Playwright | POM | **Full** | **Full** | `npm run build` + Playwright |
| Python | Playwright | POM/simple | **Full** | Starter | Profile command in metadata |
| Java | Selenium | POM | **Full** | Starter | Profile command in metadata |
| TypeScript | Cypress | simple/POM | **Full** | Starter | Profile command in metadata |
| TypeScript | WebdriverIO | POM | Planned | Starter only | — |
| C# | Selenium/Playwright | POM | Planned | — | — |

---

## Profile architecture

Each profile is a self-contained module under `src/core/codegen/profiles/`:

```text
src/core/codegen/profiles/
  CodegenProfileRegistry.ts
  TypeScriptPlaywrightProfile.ts
  PythonPlaywrightProfile.ts
  JavaSeleniumProfile.ts
  TypeScriptCypressProfile.ts
```

Each profile owns:

- File extensions and directory layout
- Import statements
- Page object template
- Test/spec template
- Selector emitter (Playwright `getByRole` vs Selenium `By` vs Cypress `cy.get`)
- Assertion emitter
- Validation command recorded in codegen metadata

---

## Init examples

```bash
# Full scaffold (TypeScript Playwright)
webpilot init --yes --language typescript --tool playwright --pattern pom

# Python Playwright starter
webpilot init --yes --language python --tool playwright --pattern pom

# Java Selenium starter
webpilot init --yes --language java --tool selenium --pattern pom

# Cypress
webpilot init --yes --language typescript --tool cypress --pattern simple
```

Only **TypeScript + Playwright** receives the complete framework scaffold (`packages/test-framework/` with Playwright config, fixtures, utilities). Other profiles get starter templates and codegen emitters.

---

## Generated output examples

### TypeScript Playwright

```typescript
// packages/test-framework/pages/ProductsPage.ts
export class ProductsPage extends BasePage {
  async addFirstProductToCart(): Promise<void> {
    await this.getByRole('button', { name: 'Add to cart' }).first().click();
  }
}
```

### Python Playwright

```python
# packages/test-framework/pages/products_page.py
class ProductsPage(BasePage):
    def add_first_product_to_cart(self):
        self.page.get_by_role("button", name="Add to cart").first.click()
```

### Java Selenium

```java
// packages/test-framework/pages/ProductsPage.java
public void addFirstProductToCart() {
    driver.findElement(By.cssSelector("button.add-to-cart")).click();
}
```

---

## Codegen command

Profile is read automatically from `webpilot.yaml`:

```bash
webpilot run tests/web/foo.txt --codegen
webpilot generate --from latest
```

Metadata in `runtime/codegen/history/<slug>.json` records the active profile and validation command.

---

## Roadmap

| Item | Status |
|------|--------|
| WebdriverIO profile emitter | Planned |
| C# Selenium / Playwright | Planned |
| BDD / Cucumber generation | Planned |
| Full init scaffold for all P0 profiles | Partial |

---

## See also

- [Deterministic Codegen](./deterministic-codegen.md)
- [Assertion Engine](./assertion-engine.md)
- [features/03-multi-language-codegen-profiles.md](../features/03-multi-language-codegen-profiles.md)
