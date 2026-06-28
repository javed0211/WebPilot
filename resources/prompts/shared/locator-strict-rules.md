# Playwright locator strictness (mandatory)

WebPilot codegen MUST produce tests that pass Playwright **strict mode**. A locator used for `click`, `fill`, `check`, or `expect` must resolve to **exactly one** element.

## Priority order

1. **Semantic locators** — `getByRole`, `getByLabel`, `getByPlaceholder`, `getByText`, `getByAltText`
2. **Stable attributes** — `name`, `data-testid`, `href`, `type` on a scoped parent
3. **CSS** — only when semantic locators are ambiguous
4. **XPath** — last resort

## When semantic locators match multiple elements

**Never** call actions on an unscoped locator that can match footer, nav, modals, or duplicate widgets.

### Required techniques (in order of preference)

1. **Scope to a page region** (best for forms and route-specific UI):

```typescript
const form = this.page.locator('.contact-form');
await form.locator('input[name="email"]').fill(email);
```

```typescript
await this.page.locator('#contact-page').getByRole('link', { name: /Home/i }).click();
```

2. **Chain `.filter()`** on semantic locators:

```typescript
await this.page
  .getByRole('button', { name: /Submit/i })
  .filter({ has: this.page.locator('#contact-page') })
  .click();
```

```typescript
await expect(
  this.page.locator('#contact-page .alert-success').filter({
    hasText: /Success! Your details have been submitted successfully/i,
  })
).toBeVisible();
```

3. **Use `.filter({ hasText })` / `.filter({ has })`** to disambiguate siblings:

```typescript
await this.page.getByRole('link', { name: 'Products' }).filter({ hasNot: this.page.locator('footer') }).click();
```

4. **Prefer `name` / `id` inside a scoped parent** when placeholders repeat site-wide (e.g. footer “Your email address” vs form “Email”):

```typescript
// BAD — matches newsletter + form
await page.getByPlaceholder('Email').fill(email);

// GOOD
await page.locator('.contact-form input[name="email"]').fill(email);
```

5. **`.first()` / `.nth(i)`** — only when the target is genuinely the first visible match **after** scoping; never as the first choice on a full-page semantic locator.

```typescript
// BAD
await page.locator('.product-image-wrapper').click();

// GOOD
await page.locator('.features_items .product-image-wrapper').nth(0).locator('a.add-to-cart').first().click();
```

## POM pattern

- Expose **private region locators** (`contactForm()`, `productCards()`) and build actions from them.
- Assertions: scope success/error messages to the route container (`#contact-page`, `#cart_info_table`), not `page.getByText(...)` globally.

## Anti-patterns (reject in generated code)

- `page.getByPlaceholder('Email')` on pages with a footer email field
- `page.getByRole('link', { name: 'Home' })` when nav and in-content Home links both exist
- `page.getByText(/Success/)` when subscription and form success banners share text
- `expect(page.locator('.foo')).toBeVisible()` when `.foo` matches 10+ nodes — use `.first()` after `assertCountAtLeast` or scope the parent
