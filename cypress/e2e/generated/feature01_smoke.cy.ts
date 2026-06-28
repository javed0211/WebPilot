describe('AutomationExercise smoke', () => {
  it('replays the WebPilot flow', () => {
    cy.visit('https://automationexercise.com/');
    // selector: confidence 0.99
    cy.contains('[role="link"]', 'Products').click();
    cy.visit('https://automationexercise.com/products');
    // assertion(medium): URL contains "products"
    cy.url().should('include', 'products');
    // assertion(strong): role selector is visible
    cy.contains('[role="heading"]', 'All Products').should('be.visible');
  });
});
