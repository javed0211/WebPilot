# 03. Multi-Language Codegen Profiles

## Goal

Generate production-grade automation code for each selected `webpilot init` profile instead of assuming TypeScript + Playwright.

## Supported Profiles

| Language | Tool | Pattern | Priority | Status |
|----------|------|---------|----------|--------|
| TypeScript | Playwright | POM | P0 | **Done** |
| Python | Playwright | POM/simple | P0 | **Done** |
| Java | Selenium | POM | P1 | **Done** |
| TypeScript | Cypress | simple/POM | P1 | **Done** |
| TypeScript | WebdriverIO | POM | P2 | **Done** |
| C# | Selenium | POM | P2 | **Done** |
| C# | Playwright | POM | P2 | **Done** |

## User Problem

Users pick language/tool during `webpilot init`, but generated automation must honor that choice.

Without profile-aware codegen, WebPilot feels like a Playwright-only tool with a broader setup wizard.

## Profile Contract

The source of truth is:

```yaml
project:
  language: "python"
  automationTool: "playwright"
  testFramework: "pytest"
  frameworkPattern: "pom"
```

Codegen must read this profile before choosing:

- File extensions.
- Test runner.
- Assertion style.
- Locator syntax.
- Page object style.
- Package/build files.

## Codegen Architecture

Codegen profiles live under `src/core/codegen/profiles/`:

```text
src/core/codegen/profiles/
  TypeScriptPlaywrightProfile.ts
  PythonPlaywrightProfile.ts
  JavaSeleniumProfile.ts
  TypeScriptCypressProfile.ts
  TypeScriptWebdriverIOProfile.ts
  CsharpSeleniumProfile.ts
  CsharpPlaywrightProfile.ts
  CodegenProfileRegistry.ts
```

Framework scaffolds (init + codegen auto-write) live in `src/core/*FrameworkTemplates.ts`.

Each profile owns:

- File layout.
- Imports.
- Page object template.
- Test template.
- Selector emitter.
- Assertion emitter.
- Validator command.

## Product Scope

Implemented profiles:

- TypeScript Playwright POM (reference implementation).
- Python Playwright simple/POM.
- Java Selenium POM.
- TypeScript Cypress simple/POM.
- TypeScript WebdriverIO POM.
- C# Selenium POM (NUnit + ChromeDriver).
- C# Playwright POM (NUnit + Microsoft.Playwright.NUnit).

Generated output includes:

- Test file.
- Page object when useful.
- Basic assertions.
- Profile-specific replay and validation commands in codegen metadata and reports.

Future enhancements:

- BDD/Cucumber.
- Screenplay.
- Advanced framework-specific fixtures.

## Example Outputs

### Python Playwright

```python
from playwright.sync_api import Page, expect


class ProductsPage:
    def __init__(self, page: Page):
        self.page = page

    def add_first_product_to_cart(self):
        self.page.get_by_role("button", name="Add to cart").first.click()


def test_add_product_to_cart(page: Page):
    page.goto("https://automationexercise.com/products")
    products = ProductsPage(page)
    products.add_first_product_to_cart()
    expect(page.get_by_text("Added!")).to_be_visible()
```

### Java Selenium

```java
class ProductsPage {
  private final WebDriver driver;

  ProductsPage(WebDriver driver) {
    this.driver = driver;
  }

  void addFirstProductToCart() {
    driver.findElement(By.cssSelector("[data-product-id='1']")).click();
  }
}
```

### WebdriverIO

```typescript
describe('checkout', () => {
  it('replays the WebPilot flow', async () => {
    await browser.url('https://automationexercise.com/');
    await $('[data-testid="add-to-cart"]').click();
  });
});
```

### C# Playwright

```csharp
public class CheckoutTests : PageTest
{
    [Test]
    public async Task ReplayFlow()
    {
        await Page.GotoAsync("https://automationexercise.com/");
        await Page.GetByRole(AriaRole.Button, new() { Name = "Add to cart" }).ClickAsync();
    }
}
```

## Implementation Plan

### Phase 1: Profile Interface

Create:

- `CodegenProfile`
- `CodegenProfileRegistry`
- `GeneratedFile`
- `ValidationCommand`

### Phase 2: Profile-Aware Prompt Context

Prompt must include:

- Active profile.
- Existing graph summary for matching language/tool.
- Framework rules specific to profile.
- Example output for profile.

### Phase 3: Emitters

Split emitters:

- Selector emitter.
- Assertion emitter.
- Page object emitter.
- Test emitter.

### Phase 4: Validators

Per-profile validation:

- TypeScript Playwright: `npm run build`, `npx playwright test`.
- Python Playwright: `python -m compileall`, `pytest`.
- Java Selenium: `mvn test-compile`.
- Cypress / WebdriverIO: `npx tsc --noEmit`.
- C# Selenium / Playwright: `dotnet build`.

## Tests

Unit tests:

- Profile registry selects correct profile from YAML.
- Python profile emits `.py` files.
- Java profile emits Maven/JUnit structure.
- TypeScript Cypress profile emits Cypress syntax.
- WebdriverIO profile emits WDIO specs and page objects.
- C# profiles emit NUnit test classes.

Integration tests:

- Init Python project, generate Python Playwright test.
- Init Java project, generate Selenium test.
- Init WebdriverIO / C# projects, generate profile-specific code.
- Generated code passes syntax validation.

## Exit Criteria

- `webpilot init --language python --tool playwright` leads to Python generated code.
- `webpilot init --language java --tool selenium` leads to Java generated code.
- `webpilot init --language typescript --tool webdriverio` leads to WebdriverIO generated code.
- `webpilot init --language csharp --tool playwright` leads to C# Playwright generated code.
- TypeScript Playwright remains stable.
- Validators are profile-aware.

## Implementation Status

Product feature implemented in WebPilot:

- [x] Codegen profile contract and registry (`src/core/codegen/profiles/`)
- [x] TypeScript Playwright profile preserves existing deterministic POM output
- [x] Python Playwright profile emits pytest-compatible tests and POM page objects
- [x] Java Selenium profile emits JUnit/Selenium test and page-object files
- [x] TypeScript Cypress profile emits native Cypress specs
- [x] TypeScript WebdriverIO profile emits WDIO specs and page objects
- [x] C# Selenium profile emits NUnit/Selenium tests and page objects
- [x] C# Playwright profile emits NUnit/Playwright tests and page objects
- [x] Framework template scaffolds for all profiles (`*FrameworkTemplates.ts`)
- [x] `PlanBuilder` reads `project.language`, `project.automationTool`, `project.testFramework`, and `project.frameworkPattern`
- [x] Deterministic pipeline emits files through the active profile and auto-scaffolds missing framework files
- [x] `webpilot doctor` validates toolchain per profile
- [x] Metadata and reports include profile-specific replay and validation commands

Future enhancements:

- [ ] BDD/Cucumber emitters
- [ ] Screenplay pattern
- [ ] Advanced framework-specific fixtures
