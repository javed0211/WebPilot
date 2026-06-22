import * as fs from 'fs';
import * as path from 'path';

export const AUTOMATION_EXERCISE_CANONICAL_PATHS = new Set([
  'framework/pages/automationexercise/automation_exercise_base_page.py',
  'framework/pages/automationexercise/automation_exercise_home_page.py',
  'framework/pages/automationexercise/automation_exercise_products_page.py',
  'framework/pages/automationexercise/automation_exercise_cart_page.py',
  'framework/pages/automationexercise/automation_exercise_contact_us_page.py',
  'framework/pages/automationexercise/automation_exercise_product_detail_page.py',
]);

export function loadCanonicalPageContent(): Record<string, string> {
  return Object.fromEntries(
    [...AUTOMATION_EXERCISE_CANONICAL_PATHS].map((relativePath) => [
      relativePath,
      fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8'),
    ])
  );
}

export const AUTOMATION_EXERCISE_BASE_PAGE_PATH =
  'framework/pages/automationexercise/automation_exercise_base_page.py';
