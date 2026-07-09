# Multi-Language Codegen

WebPilot generates automation code for **multiple language and framework profiles** — not only TypeScript Playwright.

---

## Overview

During `webpilot init`, you choose a project profile. Codegen reads that profile from `resources/config/webpilot.yaml` and emits files in the correct language, test runner, locator syntax, and page object pattern.

**Source of truth:**

```yaml
project:
  language: "typescript"
  automationTool: "playwright"
  testFramework: "playwright-test"
  frameworkPattern: "pom"
```

Each profile includes:

- **Init scaffold** — project files, sample test, base page, config helpers
- **Deterministic codegen** — trace → plan → spec + page objects without LLM
- **Profile validation** — compile/build check after generation (`webpilot doctor` uses the same toolchain)
- **Replay command** — recorded in `runtime/codegen/history/<slug>.json` and reports

---

## Supported profiles

| Language | Tool | Pattern | Codegen | Init scaffold | Validation |
|----------|------|---------|---------|---------------|------------|
| TypeScript | Playwright | POM | **Full** | **Full** (`packages/test-framework/`) | `npm run build` + Playwright |
| Python | Playwright | POM/simple | **Full** | **Full** (`tests/generated/`) | `python -m compileall` |
| Java | Selenium | POM | **Full** | **Full** (`src/test/java/webpilot/`) | `mvn test-compile` |
| TypeScript | Cypress | simple/POM | **Full** | **Full** (`cypress/`) | `npx tsc --noEmit` |
| TypeScript | WebdriverIO | POM/simple | **Full** | **Full** (`test/`, `wdio.conf.ts`) | `npx tsc --noEmit` |
| C# | Selenium | POM | **Full** | **Full** (`tests/WebPilot.Tests/`) | `dotnet build` |
| C# | Playwright | POM | **Full** | **Full** (`tests/WebPilot.Playwright.Tests/`) | `dotnet build` |

**TypeScript + Playwright** is the reference profile: it ships the richest framework (`packages/test-framework/` with Playwright config, fixtures, path aliases, and utilities). All other profiles receive a **complete, runnable scaffold** for their stack plus deterministic codegen emitters.

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
  TypeScriptWebdriverIOProfile.ts
  CsharpSeleniumProfile.ts
  CsharpPlaywrightProfile.ts
```

Framework templates (init + codegen auto-scaffold) live alongside the profiles:

```text
src/core/
  FrameworkTemplates.ts              # TypeScript Playwright
  PythonFrameworkTemplates.ts
  JavaFrameworkTemplates.ts
  CypressFrameworkTemplates.ts
  WebdriverIOFrameworkTemplates.ts
  CsharpFrameworkTemplates.ts
```

Each profile owns:

- File extensions and directory layout
- Import statements
- Page object template
- Test/spec template
- Selector emitter (Playwright `getByRole` vs Selenium `By` vs Cypress `cy.get` vs WDIO `$()`)
- Assertion emitter (`AssertionEmitter` per profile)
- Validation and replay commands recorded in codegen metadata

Codegen auto-scaffolds missing framework files before writing generated tests (`DeterministicCodegenPipeline.ensureProfileScaffold`).

---

## Init examples

```bash
# TypeScript Playwright (full packages/test-framework scaffold)
webpilot init --yes --language typescript --tool playwright --pattern pom

# Python Playwright
webpilot init --yes --language python --tool playwright --pattern pom

# Java Selenium
webpilot init --yes --language java --tool selenium --pattern pom

# Cypress
webpilot init --yes --language typescript --tool cypress --pattern simple

# WebdriverIO
webpilot init --yes --language typescript --tool webdriverio --pattern pom

# C# Selenium
webpilot init --yes --language csharp --tool selenium --pattern pom

# C# Playwright
webpilot init --yes --language csharp --tool playwright --pattern pom
```

After init, run `npm install` and `webpilot doctor` to verify the toolchain for your profile.

---

## Generated output layout

| Profile | Specs | Page objects | Sample validation |
|---------|-------|--------------|-------------------|
| TypeScript Playwright | `packages/test-framework/tests/` | `packages/test-framework/pages/` | `npm run build` |
| Python Playwright | `tests/generated/` | `tests/generated/pages/` | `python -m compileall -q tests/generated` |
| Java Selenium | `src/test/java/webpilot/generated/` | `src/test/java/webpilot/generated/pages/` | `mvn -q test-compile` |
| Cypress | `cypress/e2e/generated/` | `cypress/support/pages/` | `npx tsc --noEmit` |
| WebdriverIO | `test/specs/generated/` | `test/pageobjects/` | `npx tsc --noEmit` |
| C# Selenium | `tests/WebPilot.Tests/Generated/` | `tests/WebPilot.Tests/Generated/Pages/` | `dotnet build tests/WebPilot.Tests/WebPilot.Tests.csproj` |
| C# Playwright | `tests/WebPilot.Playwright.Tests/Generated/` | `tests/WebPilot.Playwright.Tests/Generated/Pages/` | `dotnet build tests/WebPilot.Playwright.Tests/WebPilot.Playwright.Tests.csproj` |

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
# tests/generated/pages/products_page.py
class ProductsPage(BasePage):
    def add_first_product_to_cart(self):
        self.page.get_by_role("button", name="Add to cart").first.click()
```

### Java Selenium

```java
// src/test/java/webpilot/generated/pages/ProductsPage.java
public void addFirstProductToCart() {
    driver.findElement(By.cssSelector("button.add-to-cart")).click();
}
```

### Cypress

```typescript
// cypress/e2e/generated/add_product.cy.ts
cy.get('[data-testid="add-to-cart"]').first().click();
```

### WebdriverIO

```typescript
// test/pageobjects/ProductsPage.ts
export class ProductsPage extends BasePage {
  async addFirstProductToCart() {
    await $('[data-testid="add-to-cart"]').click();
  }
}
```

### C# Playwright

```csharp
// tests/WebPilot.Playwright.Tests/Generated/Pages/ProductsPage.cs
public async Task ClickAddToCartAsync() =>
    await Page.GetByRole(AriaRole.Button, new() { Name = "Add to cart" }).ClickAsync();
```

### C# Selenium

```csharp
// tests/WebPilot.Tests/Generated/Pages/ProductsPage.cs
public void ClickAddToCart() =>
    Driver.FindElement(By.CssSelector("[data-testid='add-to-cart']")).Click();
```

---

## Codegen command

Profile is read automatically from `webpilot.yaml`:

```bash
webpilot run tests/web/foo.txt --codegen
webpilot generate --from latest
```

Metadata in `runtime/codegen/history/<slug>.json` records:

- Active profile id (e.g. `csharp-playwright-pom`, `typescript-webdriverio-pom`)
- Generated file paths
- Replay command (e.g. `dotnet test …`, `npx wdio run …`, `pytest …`)
- Validation command used after generation

---

## Running generated tests

| Profile | Typical command |
|---------|-----------------|
| TypeScript Playwright | `webpilot replay` or `npx playwright test` |
| Python Playwright | `pytest tests/generated` |
| Java Selenium | `mvn test` |
| Cypress | `npx cypress run --spec cypress/e2e/generated/*.cy.ts` |
| WebdriverIO | `wdio run wdio.conf.ts` |
| C# Selenium | `dotnet test tests/WebPilot.Tests/WebPilot.Tests.csproj` |
| C# Playwright | `dotnet test tests/WebPilot.Playwright.Tests/WebPilot.Playwright.Tests.csproj` |

Init also adds `npm run test:generated` scripts where applicable.

---

## Roadmap

| Item | Status |
|------|--------|
| TypeScript Playwright POM | **Done** |
| Python Playwright POM | **Done** |
| Java Selenium POM | **Done** |
| TypeScript Cypress | **Done** |
| TypeScript WebdriverIO POM | **Done** |
| C# Selenium POM | **Done** |
| C# Playwright POM | **Done** |
| BDD / Cucumber generation | Planned |
| Screenplay pattern | Planned |

---

## See also

- [Deterministic Codegen](./deterministic-codegen.md)
- [Assertion Engine](./assertion-engine.md)
- [CLI Reference](./cli-reference.md) — `webpilot init` flags
- [features/03-multi-language-codegen-profiles.md](../features/03-multi-language-codegen-profiles.md)
