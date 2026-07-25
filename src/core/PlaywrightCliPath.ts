/**
 * Resolve the Playwright CLI from the project being operated on, not from the
 * WebPilot install. Mixing two @playwright/test copies (global/dev-repo CLI +
 * project node_modules) makes test() registration fail with
 * "Playwright Test did not expect test() to be called here".
 */
export function resolvePlaywrightCli(): string {
  try {
    return require.resolve('@playwright/test/cli', { paths: [process.cwd()] });
  } catch {
    return require.resolve('@playwright/test/cli');
  }
}
