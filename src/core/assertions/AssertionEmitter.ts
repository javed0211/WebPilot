import { AssertionCandidate } from './AssertionCandidate';
import { escapeDouble, escapeSingle, roleParts } from '../codegen/profiles/CodegenProfile';
import { TraceSelector } from '../codegen/ExecutionTrace';

function regexSafe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function tsLocator(selector: TraceSelector | undefined, receiver = 'page'): string | null {
  if (!selector) return null;
  if (selector.expression) {
    const expr = selector.expression.trim();
    if (expr.startsWith('page.')) return expr.replace(/^page\./, `${receiver}.`);
    if (expr.startsWith('this.page.')) return expr.replace(/^this\.page\./, `${receiver}.`);
    return `${receiver}.${expr}`;
  }
  const role = roleParts(selector);
  if (role) {
    return role.name
      ? `${receiver}.getByRole('${escapeSingle(role.role)}', { name: '${escapeSingle(role.name)}' })`
      : `${receiver}.getByRole('${escapeSingle(role.role)}')`;
  }
  switch (selector.kind) {
    case 'label':
      return `${receiver}.getByLabel('${escapeSingle(selector.value)}')`;
    case 'placeholder':
      return `${receiver}.getByPlaceholder('${escapeSingle(selector.value)}')`;
    case 'testid':
      return `${receiver}.getByTestId('${escapeSingle(selector.value)}')`;
    case 'text':
      return `${receiver}.getByText('${escapeSingle(selector.value)}')`;
    default:
      return `${receiver}.locator('${escapeSingle(selector.value)}')`;
  }
}

function pythonLocator(assertion: AssertionCandidate, receiver = 'page'): string | null {
  const selector = assertion.selector;
  if (!selector) return null;
  const role = roleParts(selector);
  if (role) {
    return role.name
      ? `${receiver}.get_by_role("${escapeDouble(role.role)}", name="${escapeDouble(role.name)}")`
      : `${receiver}.get_by_role("${escapeDouble(role.role)}")`;
  }
  switch (selector.kind) {
    case 'label':
      return `${receiver}.get_by_label("${escapeDouble(selector.value)}")`;
    case 'placeholder':
      return `${receiver}.get_by_placeholder("${escapeDouble(selector.value)}")`;
    case 'testid':
      return `${receiver}.get_by_test_id("${escapeDouble(selector.value)}")`;
    case 'text':
      return `${receiver}.get_by_text("${escapeDouble(selector.value)}")`;
    default:
      return `${receiver}.locator("${escapeDouble(selector.value)}")`;
  }
}

function cypressLocator(assertion: AssertionCandidate): string | null {
  const selector = assertion.selector;
  if (!selector) return null;
  const role = roleParts(selector);
  if (role?.name) return `cy.contains('[role="${escapeSingle(role.role)}"]', '${escapeSingle(role.name)}')`;
  switch (selector.kind) {
    case 'testid':
      return `cy.get('[data-testid="${escapeSingle(selector.value)}"]')`;
    case 'text':
      return `cy.contains('${escapeSingle(selector.value)}')`;
    default:
      return `cy.get('${escapeSingle(selector.value)}')`;
  }
}

function javaBy(assertion: AssertionCandidate): string {
  const selector = assertion.selector;
  if (!selector) return 'By.cssSelector("body")';
  const role = roleParts(selector);
  if (role?.name) {
    return `By.xpath("//*[@role='${escapeDouble(role.role)}' and normalize-space(.)='${escapeDouble(role.name)}']")`;
  }
  switch (selector.kind) {
    case 'testid':
      return `By.cssSelector("[data-testid='${escapeDouble(selector.value)}']")`;
    case 'text':
      return `By.xpath("//*[normalize-space(.)='${escapeDouble(selector.value)}']")`;
    case 'xpath':
      return `By.xpath("${escapeDouble(selector.value)}")`;
    default:
      return `By.cssSelector("${escapeDouble(selector.value)}")`;
  }
}

function csharpBy(assertion: AssertionCandidate): string {
  const selector = assertion.selector;
  if (!selector) return 'By.CssSelector("body")';
  const role = roleParts(selector);
  if (role?.name) {
    return `By.XPath("//*[@role='${escapeDouble(role.role)}' and normalize-space(.)='${escapeDouble(role.name)}']")`;
  }
  switch (selector.kind) {
    case 'testid':
      return `By.CssSelector("[data-testid='${escapeDouble(selector.value)}']")`;
    case 'text':
      return `By.XPath("//*[normalize-space(.)='${escapeDouble(selector.value)}']")`;
    case 'xpath':
      return `By.XPath("${escapeDouble(selector.value)}")`;
    default:
      return `By.CssSelector("${escapeDouble(selector.value)}")`;
  }
}

function csharpPlaywrightLocator(assertion: AssertionCandidate, receiver = 'Page'): string | null {
  const selector = assertion.selector;
  if (!selector) return null;
  const role = roleParts(selector);
  if (role) {
    const aria = role.role.charAt(0).toUpperCase() + role.role.slice(1);
    return role.name
      ? `${receiver}.GetByRole(AriaRole.${aria}, new() { Name = "${escapeDouble(role.name)}" })`
      : `${receiver}.GetByRole(AriaRole.${aria})`;
  }
  switch (selector.kind) {
    case 'label':
      return `${receiver}.GetByLabel("${escapeDouble(selector.value)}")`;
    case 'placeholder':
      return `${receiver}.GetByPlaceholder("${escapeDouble(selector.value)}")`;
    case 'testid':
      return `${receiver}.GetByTestId("${escapeDouble(selector.value)}")`;
    case 'text':
      return `${receiver}.GetByText("${escapeDouble(selector.value)}")`;
    default:
      return `${receiver}.Locator("${escapeDouble(selector.value)}")`;
  }
}

function wdioLocator(assertion: AssertionCandidate): string | null {
  const selector = assertion.selector;
  if (!selector) return null;
  const role = roleParts(selector);
  if (role?.name) {
    return `$('[role="${escapeSingle(role.role)}"]*=${escapeSingle(role.name)}')`;
  }
  switch (selector.kind) {
    case 'testid':
      return `$('[data-testid="${escapeSingle(selector.value)}"]')`;
    case 'text':
      return `$('*=${escapeSingle(selector.value)}')`;
    default:
      return `$('${escapeSingle(selector.value)}')`;
  }
}

export class AssertionEmitter {
  public static typeScriptPlaywright(assertion: AssertionCandidate, receiver = 'page'): string[] {
    const comment = `// assertion(${assertion.strength}): ${assertion.description}`;
    switch (assertion.kind) {
      case 'url_contains':
        return [comment, `await expect(${receiver}).toHaveURL(/${regexSafe(String(assertion.expected))}/);`];
      case 'url_equals':
        return [comment, `await expect(${receiver}).toHaveURL('${escapeSingle(String(assertion.expected))}');`];
      case 'text_visible':
        if (assertion.selector) {
          const locator = tsLocator(assertion.selector, receiver);
          return locator ? [comment, `await expect(${locator}).toBeVisible();`] : [comment];
        }
        return [comment, `await expect(${receiver}.getByText('${escapeSingle(String(assertion.expected))}')).toBeVisible();`];
      case 'value_equals': {
        const locator = assertion.selector ? tsLocator(assertion.selector, receiver) : null;
        return locator ? [comment, `await expect(${locator}).toHaveValue('${escapeSingle(String(assertion.expected))}');`] : [comment];
      }
      case 'count_at_least': {
        const locator = assertion.selector ? tsLocator(assertion.selector, receiver) : null;
        return locator ? [comment, `await expect(${locator}).toHaveCount(${Number(assertion.expected)});`] : [comment];
      }
      default: {
        const locator = assertion.selector ? tsLocator(assertion.selector, receiver) : null;
        return locator ? [comment, `await expect(${locator}).toBeVisible();`] : [comment];
      }
    }
  }

  public static pythonPlaywright(assertion: AssertionCandidate, receiver = 'page'): string[] {
    const comment = `# assertion(${assertion.strength}): ${assertion.description}`;
    switch (assertion.kind) {
      case 'url_contains':
        return [comment, `expect(${receiver}).to_have_url(re.compile("${regexSafe(String(assertion.expected))}"))`];
      case 'text_visible':
        if (!assertion.selector) {
          return [comment, `expect(${receiver}.get_by_text("${escapeDouble(String(assertion.expected))}")).to_be_visible()`];
        }
        break;
      case 'value_equals': {
        const locator = pythonLocator(assertion, receiver);
        return locator ? [comment, `expect(${locator}).to_have_value("${escapeDouble(String(assertion.expected))}")`] : [comment];
      }
    }
    const locator = pythonLocator(assertion, receiver);
    return locator ? [comment, `expect(${locator}).to_be_visible()`] : [comment];
  }

  public static javaSelenium(assertion: AssertionCandidate, driver = 'driver'): string[] {
    const comment = `// assertion(${assertion.strength}): ${assertion.description}`;
    if (assertion.kind === 'url_contains') {
      return [comment, `assertTrue(${driver}.getCurrentUrl().contains("${escapeDouble(String(assertion.expected))}"));`];
    }
    return [comment, `assertTrue(${driver}.findElement(${javaBy(assertion)}).isDisplayed());`];
  }

  public static csharpSelenium(assertion: AssertionCandidate, driver = 'Driver'): string[] {
    const comment = `// assertion(${assertion.strength}): ${assertion.description}`;
    if (assertion.kind === 'url_contains') {
      return [comment, `Assert.That(${driver}.Url, Does.Contain("${escapeDouble(String(assertion.expected))}"));`];
    }
    return [comment, `Assert.That(${driver}.FindElement(${csharpBy(assertion)}).Displayed, Is.True);`];
  }

  public static csharpPlaywright(assertion: AssertionCandidate, receiver = 'Page'): string[] {
    const comment = `// assertion(${assertion.strength}): ${assertion.description}`;
    if (assertion.kind === 'url_contains') {
      return [
        comment,
        `await Expect(${receiver}).ToHaveURLAsync(new Regex("${regexSafe(String(assertion.expected))}"));`,
      ];
    }
    if (assertion.kind === 'text_visible' && !assertion.selector) {
      return [
        comment,
        `await Expect(${receiver}.GetByText("${escapeDouble(String(assertion.expected))}")).ToBeVisibleAsync();`,
      ];
    }
    const locator = csharpPlaywrightLocator(assertion, receiver);
    return locator
      ? [comment, `await Expect(${locator}).ToBeVisibleAsync();`]
      : [comment];
  }

  public static webdriverIO(assertion: AssertionCandidate): string[] {
    const comment = `// assertion(${assertion.strength}): ${assertion.description}`;
    if (assertion.kind === 'url_contains') {
      return [comment, `await expect(browser).toHaveUrl(expect.stringContaining('${escapeSingle(String(assertion.expected))}'));`];
    }
    if (assertion.kind === 'text_visible' && !assertion.selector) {
      return [comment, `await expect($('*=${escapeSingle(String(assertion.expected))}')).toBeDisplayed();`];
    }
    const locator = wdioLocator(assertion);
    return locator ? [comment, `await expect(${locator}).toBeDisplayed();`] : [comment];
  }

  public static cypress(assertion: AssertionCandidate): string[] {
    const comment = `// assertion(${assertion.strength}): ${assertion.description}`;
    if (assertion.kind === 'url_contains') {
      return [comment, `cy.url().should('include', '${escapeSingle(String(assertion.expected))}');`];
    }
    if (assertion.kind === 'text_visible' && !assertion.selector) {
      return [comment, `cy.contains('${escapeSingle(String(assertion.expected))}').should('be.visible');`];
    }
    const locator = cypressLocator(assertion);
    return locator ? [comment, `${locator}.should('be.visible');`] : [comment];
  }
}
