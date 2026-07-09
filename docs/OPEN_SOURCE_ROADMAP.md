# Open-Source Roadmap

WebPilot's goal is to become the leading open-source AI-native web automation layer on top of Playwright: easy enough for product teams to describe intent, strong enough for automation engineers to maintain in CI, and transparent enough that generated tests are never a black box.

## Product Positioning

WebPilot should not be marketed as a replacement for Playwright, Selenium, or Cypress.

It should be positioned as:

> An AI-native automation layer that turns natural language into reliable Playwright automation, runs and heals browser workflows, reuses learned site knowledge, and publishes rich execution reports.

This keeps the story credible:

- Playwright remains the browser engine.
- WebPilot adds planning, execution, code generation, healing, reporting, and knowledge reuse.
- Teams can gradually adopt WebPilot without giving up normal Playwright tests.

## North Star

The north-star workflow:

```text
Write a natural-language scenario
        |
        v
Run `webpilot run`
        |
        v
Watch WebPilot execute, learn, and generate Playwright
        |
        v
Review a beautiful report with evidence and AI diagnosis
        |
        v
Commit deterministic Playwright tests to CI
```

## Launch Milestones

### 1. Foundation

Goal: make the repository trustworthy for first-time users and contributors.

- Keep generated output under `runtime/`.
- Keep root directories small and well documented.
- Publish a root README focused on users, not internals.
- Add `CONTRIBUTING.md`, `SECURITY.md`, and a root `LICENSE`.
- Ensure `npm ci`, `npm run build`, and `webpilot doctor` are reliable.
- Make `.env.example` complete without containing secrets.
- Add package metadata for npm discoverability.

Exit criteria:

- A new user understands what WebPilot is within 60 seconds.
- A contributor can build the project from a fresh clone.
- Runtime artifacts do not pollute the repo root.

### 2. CLI Reliability

Goal: make the CLI feel like a product.

Priority commands:

- `webpilot init`
- `webpilot setup`
- `webpilot doctor`
- `webpilot run`
- `webpilot replay`
- `webpilot report --html`
- `webpilot self-heal`
- `webpilot reports-tidy`

Planned improvements:

- Make command help concise and example-driven.
- Add clear errors for missing provider credentials.
- Add clear errors for missing Playwright browsers.
- Print the exact report path after every run.
- Make `doctor` validate Node, npm, Playwright, Python, provider config, and writable runtime directories.
- Add `--json` output for CI and tooling.

Exit criteria:

- Users can diagnose most setup problems from CLI output alone.
- CI jobs can consume machine-readable output.

### 3. Examples and Templates

Goal: make WebPilot easy to understand by running real examples.

Example targets:

- AutomationExercise browser flows
- SauceDemo login/cart flows
- TodoMVC smoke flows
- Petstore API scenarios
- Mixed API + browser flows

Templates:

- basic browser test
- BDD-style browser test
- API token-chaining test
- CI workflow
- generated Playwright replay workflow

Exit criteria:

- Users can run a passing public demo in less than five minutes.
- Examples demonstrate natural language execution, report generation, codegen, and replay.

### 4. Report UI as a Differentiator

Goal: make reports one of WebPilot's strongest reasons to exist.

Current strengths:

- static HTML output
- suite and per-test reports
- screenshots, videos, traces
- token and cost visibility
- run history and trend views
- AI analysis hooks

Planned improvements:

- Extract report UI into editable source instead of patching a compiled bundle.
- Add clear report data schema documentation.
- Add duration and retry data when available.
- Improve artifact preview and download handling.
- Add CI-friendly report index and artifact manifest.
- Add failure grouping, flaky test ranking, and root-cause summaries.
- Add dark/light mode visual QA before release.

Exit criteria:

- Reports are shareable as static artifacts from GitHub Actions.
- Report UI source can be maintained like a normal frontend package.

### 5. Deterministic Generated Test Output

Goal: generated tests should be readable, reviewable, and CI-friendly across supported frameworks.

**Shipped:** profile-aware deterministic codegen for TypeScript Playwright, Python Playwright, Java Selenium, Cypress, WebdriverIO, C# Selenium, and C# Playwright (see [guides/multi-language-codegen.md](./guides/multi-language-codegen.md)).

Planned improvements:

- Prefer semantic locators and role-based selectors.
- Generate page objects only when they reduce duplication.
- Preserve existing page object methods when extending a suite.
- Add post-generation TypeScript validation (Playwright); compile/build validation for other profiles.
- Add replay mode that runs without an LLM.
- Keep generated code stable between runs when behavior has not changed.

Exit criteria:

- Generated code looks like code an experienced automation engineer would accept in review.
- Replay can run in CI without provider credentials.

### 6. Knowledge Reuse and Healing

Goal: make automation faster and less flaky over time.

Planned improvements:

- Document the site knowledge model.
- Separate learned facts from ephemeral runtime evidence.
- Version knowledge entries when page structure changes.
- Surface reused/learned steps in reports.
- Provide commands to inspect, prune, and export knowledge.
- Make selector healing explainable and auditable.

Exit criteria:

- Users can understand why WebPilot reused or healed an action.
- Knowledge improves reliability without hiding unexpected behavior.

### 7. CI and Integrations

Goal: make WebPilot useful in real engineering workflows.

Planned integrations:

- GitHub Actions examples
- JUnit output
- static HTML report artifacts
- optional Slack/Teams summary hooks
- provider-neutral LLM configuration
- Docker workflow for reproducible execution

Exit criteria:

- A team can run WebPilot in CI and attach reports to pull requests.

### 8. Community Growth

Goal: make the project approachable and contribution-friendly.

Planned work:

- Good first issues
- issue templates
- pull request template
- contributor guide
- architecture map
- public examples
- demo video
- release notes

Exit criteria:

- New contributors know where to start.
- Maintainers can review changes without reverse-engineering the whole stack.

## Near-Term Backlog

High priority:

- Extract report UI into source files.
- Add a public examples directory with two reliable demo flows.
- Improve `webpilot doctor`.
- Add command snapshots to docs.
- Add package metadata and license.
- Make runtime report paths consistent.
- Add a release checklist.

Medium priority:

- Add API examples and OpenAPI import examples.
- Add report schema documentation.
- Add provider setup recipes.
- Improve generated code formatting and comments.
- Add artifact manifest JSON.

Later:

- plugin system
- browser cloud support
- visual assertions
- test management integrations
- hosted report viewer
- multi-agent planning extensions

## Release Checklist

Before a public release:

- `npm ci` passes.
- `npm run build` passes.
- `webpilot doctor` passes on a clean machine.
- sample browser test passes.
- sample API test passes.
- static HTML report opens locally.
- generated Playwright replay passes.
- README quickstart works as written.
- no secrets or private artifacts are committed.
- package contents are reviewed with `npm pack --dry-run`.

## Guiding Principles

- Build on Playwright instead of competing with it.
- Keep generated code readable.
- Prefer deterministic replay when knowledge exists.
- Make AI actions explainable.
- Keep reports static and portable.
- Treat setup and error messages as product surfaces.
- Keep the repo clean enough that contributors can reason about it.
