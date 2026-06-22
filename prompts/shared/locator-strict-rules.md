# Playwright Python locator strictness

A locator used for an action or assertion must resolve to exactly one element.

Priority:

1. Semantic locators: `get_by_role`, `get_by_label`, `get_by_placeholder`, `get_by_text`.
2. Stable attributes inside a scoped parent.
3. CSS when semantic locators are ambiguous.
4. XPath only as a last resort.

Scope forms and route regions:

```python
form = self.page.locator(".contact-form")
form.locator('input[name="email"]').fill(email)
```

```python
self.page.locator("#contact-page").get_by_role(
    "link", name=re.compile("Home", re.I)
).click()
```

Filter repeated elements:

```python
expect(
    self.page.locator("#contact-page .alert-success").filter(
        has_text=re.compile("submitted successfully", re.I)
    )
).to_be_visible()
```

Do not use `.first` or `.nth()` on a page-wide semantic locator merely to hide ambiguity. Scope the parent first, then use an index only when order is part of the scenario.
