export type TestTemplateKind = 'web-smoke' | 'api-smoke' | 'checkout-flow';

export interface RenderTemplateOptions {
  name: string;
  baseUrl?: string;
}

function titleCaseName(name: string): string {
  return name
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export class TestTemplateRegistry {
  public static list(): TestTemplateKind[] {
    return ['web-smoke', 'api-smoke', 'checkout-flow'];
  }

  public static render(kind: TestTemplateKind, options: RenderTemplateOptions): string {
    const name = titleCaseName(options.name);
    const baseUrl = options.baseUrl || 'https://automationexercise.com';

    if (kind === 'api-smoke') {
      return `@api @smoke
target: api
report: true

Test: ${name}

Send GET request to https://petstore.swagger.io/v2/pet/1
Assert status is 200
`;
    }

    if (kind === 'checkout-flow') {
      return `@smoke @checkout
target: web
baseUrl: ${baseUrl}
codegen: true
report: true

Test: ${name}

1. Navigate to ${baseUrl}/
2. Verify that the home page is visible successfully
3. Click Products in the navigation menu
4. Add the first product to the cart
5. Verify the product appears in the cart
`;
    }

    return `@smoke
target: web
baseUrl: ${baseUrl}
codegen: true
report: true

Test: ${name}

1. Navigate to ${baseUrl}/
2. Verify that the home page is visible successfully
3. Click Products in the navigation menu
4. Verify that the products page is visible
`;
  }
}
