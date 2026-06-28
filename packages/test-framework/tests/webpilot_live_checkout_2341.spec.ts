import { test, expect } from '@playwright/test';
import { AutomationExerciseHomePage } from '@pages/automationexercise/AutomationExerciseHomePage';
import { AutomationExerciseCartPage } from '@pages/automationexercise/AutomationExerciseCartPage';

test('webpilot_live_checkout_2341', async ({ page }) => {
  const automationExerciseHomePage = new AutomationExerciseHomePage(page);
  // custom: Navigate to https://automationexercise.com/
  // custom: Verify that the home page is visible successfully
  // custom: Click Products in the navigation menu
  // custom: Add the first product to the cart
  // custom: Verify the product appears in the cart
});
