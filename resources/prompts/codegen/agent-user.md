Test Name: "{{test_name}}"
Architecture: "{{architecture}}"

Execution history:
{{execution_history}}

For automationexercise flows: WebPilot overwrites page POMs with canonical implementations — prioritize a correct **spec** that uses scoped locators and page object methods from the catalog.

If the test uses automationexercise.com, the spec must use `@pages/automationexercise/...` imports and catalog method names. Apply strict locator rules in the spec when calling `page.*` directly.
{{fallback_reason}}
