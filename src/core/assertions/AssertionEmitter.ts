import { AssertionCandidate } from './AssertionCandidate';
import { escapeDouble, escapeSingle, roleParts } from '../codegen/profiles/CodegenProfile';
import { TraceSelector } from '../codegen/ExecutionTrace';

function regexSafe(value: string): string {
  // Escape regex metacharacters AND `/` so `/microsoft/playwright/` is a valid TS literal.
  return value.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
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
    if (assertion.kind === 'semantic' && assertion.semantic) {
      return AssertionEmitter.typeScriptPlaywrightSemantic(assertion, receiver);
    }
    const comment = `// assertion(${assertion.strength}): ${assertion.description}`;
    switch (assertion.kind) {
      case 'url_contains':
        return [comment, `await expect(${receiver}).toHaveURL(/${regexSafe(String(assertion.expected))}/);`];
      case 'url_equals':
        return [comment, `await expect(${receiver}).toHaveURL('${escapeSingle(String(assertion.expected))}');`];
      case 'text_visible':
        if (assertion.selector) {
          const locator = tsLocator(assertion.selector, receiver);
          return locator
            ? [comment, `await expect(${locator}.filter({ visible: true }).first()).toBeVisible();`]
            : [comment];
        }
        return [
          comment,
          `await expect(${receiver}.getByText('${escapeSingle(String(assertion.expected))}').filter({ visible: true }).first()).toBeVisible();`,
        ];
      case 'value_equals': {
        const locator = assertion.selector ? tsLocator(assertion.selector, receiver) : null;
        return locator ? [comment, `await expect(${locator}).toHaveValue('${escapeSingle(String(assertion.expected))}');`] : [comment];
      }
      case 'count_at_least': {
        const locator = assertion.selector ? tsLocator(assertion.selector, receiver) : null;
        // Count is "at least N", not exact equality.
        return locator
          ? [
              comment,
              `expect(await ${locator}.count()).toBeGreaterThanOrEqual(${Number(assertion.expected)});`,
            ]
          : [comment];
      }
      default: {
        const locator = assertion.selector ? tsLocator(assertion.selector, receiver) : null;
        return locator
          ? [comment, `await expect(${locator}.filter({ visible: true }).first()).toBeVisible();`]
          : [comment];
      }
    }
  }

  /**
   * Emit TypeScript Playwright for semantic assertions.
   * Unsupported nodes fail closed with a thrown Error in generated code comments + runtime throw.
   */
  public static typeScriptPlaywrightSemantic(
    assertion: AssertionCandidate,
    receiver = 'page'
  ): string[] {
    const semantic = assertion.semantic!;
    const lines: string[] = [
      `// semantic-assertion(${assertion.strength}): ${assertion.description}`,
    ];

    for (const spec of semantic.extract || []) {
      const src = spec.source;
      if (src.kind === 'locatorText' && src.locator?.kind === 'testid') {
        lines.push(
          `const ${spec.name} = Number(String(await ${receiver}.getByTestId('${escapeSingle(src.locator.selector)}').innerText()).replace(/[^0-9.-]+/g, ''));`
        );
      } else if (src.kind === 'locatorText' && src.locator) {
        lines.push(
          `const ${spec.name} = Number(String(await ${receiver}.locator('${escapeSingle(src.locator.selector)}').innerText()).replace(/[^0-9.-]+/g, ''));`
        );
      } else if (src.kind === 'variable' || src.kind === 'jsonPath') {
        lines.push(
          `const ${spec.name} = /* from ${src.kind}:${src.path || spec.name} */ Number(process.env['${escapeSingle(spec.name)}'] ?? 0); // bind via fixture/API variables in runtime`
        );
      } else if (src.kind === 'url') {
        lines.push(`const ${spec.name} = ${receiver}.url();`);
      } else {
        lines.push(
          `throw new Error('Unsupported semantic extraction in codegen: ${spec.name} (${src.kind})');`
        );
      }
    }

    if (semantic.domainCheck) {
      lines.push(
        `// domain check: ${semantic.domainCheck.id} — evaluate via SemanticAssertionRuntime in WebPilot runs`
      );
      lines.push(
        `throw new Error('Domain check ${semantic.domainCheck.id} requires SemanticAssertionRuntime (not inlined)');`
      );
      return lines;
    }

    if (semantic.assert) {
      const left = AssertionEmitter.exprToTs(semantic.assert.left);
      const right = semantic.assert.right
        ? AssertionEmitter.exprToTs(semantic.assert.right)
        : 'undefined';
      const op = semantic.assert.op;
      if (op === 'approximatelyEquals') {
        const tol = semantic.assert.absoluteTolerance ?? 0.01;
        lines.push(`expect(Math.abs((${left}) - (${right}))).toBeLessThanOrEqual(${tol});`);
      } else if (op === 'equals') {
        lines.push(`expect(${left}).toEqual(${right});`);
      } else if (op === 'greaterOrEqual') {
        lines.push(`expect(${left}).toBeGreaterThanOrEqual(${right});`);
      } else if (op === 'greaterThan') {
        lines.push(`expect(${left}).toBeGreaterThan(${right});`);
      } else if (op === 'lessOrEqual') {
        lines.push(`expect(${left}).toBeLessThanOrEqual(${right});`);
      } else if (op === 'lessThan') {
        lines.push(`expect(${left}).toBeLessThan(${right});`);
      } else if (op === 'contains') {
        lines.push(`expect(String(${left})).toContain(String(${right}));`);
      } else if (op === 'exists') {
        lines.push(`expect(${left}).toBeTruthy();`);
      } else {
        lines.push(
          `throw new Error('Unsupported semantic operator in codegen: ${op}');`
        );
      }
    }

    return lines;
  }

  private static exprToTs(expr: import('./SemanticAssertion').SemanticExpression): string {
    switch (expr.kind) {
      case 'literal':
        return JSON.stringify(expr.value);
      case 'ref':
        return expr.name;
      case 'arithmetic': {
        const op =
          expr.op === 'add'
            ? '+'
            : expr.op === 'subtract'
              ? '-'
              : expr.op === 'multiply'
                ? '*'
                : '/';
        return `(${AssertionEmitter.exprToTs(expr.left)} ${op} ${AssertionEmitter.exprToTs(expr.right)})`;
      }
      case 'array':
        return `[${expr.items.map((i) => AssertionEmitter.exprToTs(i)).join(', ')}]`;
      case 'extract':
        return expr.extraction.name;
      default:
        return 'undefined';
    }
  }

  public static pythonPlaywright(assertion: AssertionCandidate, receiver = 'page'): string[] {
    if (assertion.kind === 'semantic') {
      return [
        `# semantic-assertion not emitted for Python yet: ${assertion.description}`,
        `raise NotImplementedError("Semantic assertions require TypeScript Playwright or SemanticAssertionRuntime")`,
      ];
    }
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
