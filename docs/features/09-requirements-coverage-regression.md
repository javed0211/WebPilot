# 09. Requirements Coverage and Regression Manager

## Goal

Make WebPilot a requirements-driven QA intelligence layer by connecting official Azure DevOps and Jira MCP sources to coverage, regression pack management, and flake risk.

WebPilot should answer:

- Which requirements are automated?
- Which acceptance criteria have no test coverage?
- Which regression tests should run for a release or sprint?
- Which tests are flaky and should be quarantined?
- What new natural-language tests should an SDET create?

## User Problem

Automation teams often have test execution, requirement tracking, and release risk split across separate systems.

Typical pain:

- Requirements live in Azure DevOps or Jira.
- Manual test cases and automation are not consistently linked to requirements.
- Regression packs grow by habit instead of risk.
- Flaky tests block releases or get ignored.
- QA leads cannot quickly prove coverage for a sprint, release, or epic.

WebPilot already has execution history, selector confidence, flake analysis, generated tests, natural-language tests, and reports. The missing layer is a requirements model that connects those signals to real product scope.

## Product Scope

This feature introduces:

- Official Azure DevOps MCP requirement sync.
- Official Jira / Atlassian Rovo MCP requirement sync.
- A normalized requirement model independent of source system.
- AI-assisted requirement-to-test coverage discovery.
- Guided human review that confirms, rejects, or edits proposed coverage.
- Durable tags and mapping JSON generated after review.
- Coverage gap reporting.
- Regression pack recommendation.
- Flake-aware quarantine and promotion workflows.
- Release readiness summary.

Deferred:

- Bidirectional field write-back for requirements (beyond TestedBy links).
- Deep integrations with Xray, Zephyr, or TestRail.
- Full app-code impact analysis.
- Jira Test Plan write-back.

Shipped (ADO Test Plans via bundled MCP):

- Create/list Test Plans and Suites through official `@azure-devops/mcp`.
- Create Test Cases, add to suites, map local automation via `ado-test-map.yaml`.
- Publish PASSED/FAILED outcomes to ADO Test Runs (REST; MCP has no outcome-write tool).
- CLI: `webpilot ado status|testplan|testcase|link|sync-cases|publish-results`.
- Guide: [ado-test-plans.md](../guides/ado-test-plans.md).

## Official MCP Sources

### Azure DevOps

Use the official Microsoft Azure DevOps MCP Server.

Options:

- **Bundled local MCP (product default):** pinned `@azure-devops/mcp` spawned by WebPilot from the install root (`ado:` in `webpilot.yaml`). Works when WebPilot is packaged into other repos — no Cursor `mcp.json` required.
- Remote MCP Server (IDE-oriented): `https://mcp.dev.azure.com/{organization}`
- Standalone local MCP: `npx @azure-devops/mcp {organization}`

Expected requirement sources:

- Work items: user stories, product backlog items, bugs, features.
- Acceptance criteria fields.
- Tags, area path, iteration path.
- Links to test cases and test plans.
- Pull requests and build/test context later.

Authentication:

- Remote: Microsoft Entra ID OAuth.
- Local: Azure DevOps PAT or Azure CLI auth.

### Jira

Use the official Atlassian Rovo MCP Server.

Endpoint:

```text
https://mcp.atlassian.com/v1/mcp/authv2
```

Expected requirement sources:

- Epics, stories, tasks, bugs.
- Description and acceptance criteria.
- Labels, components, fix versions, sprint.
- Links between issues.
- Confluence pages later, where requirements are documented outside Jira.

Authentication:

- OAuth 2.1 through Atlassian Cloud.
- Site/admin policies can restrict connector usage.

## Coverage Discovery Model

Requirement coverage should not depend on teams already having perfect tags or mapping files. Tags and mappings are the durable output of the process, not the starting assumption.

WebPilot should use an AI-first guided workflow:

1. Pull requirements from ADO/Jira for a selected scope.
2. Normalize epics, features, stories, bugs, and acceptance criteria.
3. Inventory existing coverage sources:
   - natural-language `.txt` tests
   - generated Playwright specs
   - page objects and reusable methods
   - ADO/Jira native test links
   - execution history and reports
   - selector registry and assertion summaries
4. Load and reconcile existing mappings (tags, `requirement-map.yaml`, prior coverage JSON), validating each against current tests and requirement text.
5. Use AI-assisted matching to propose new coverage and corrections for stale, broken, or conflicting mappings.
6. Show confidence, evidence, drift, and gaps to the SDET/QA lead.
7. Let the user accept, reject, split, correct, or edit mappings.
8. Write durable evidence:
   - requirement tags in `.txt` tests where appropriate
   - `resources/config/requirement-map.yaml`
   - `runtime/requirements/coverage/*.json`
9. Use confirmed coverage to build regression packs and release gates.

Existing mappings are always reused or corrected, never silently discarded or blindly trusted. This makes explicit tagging a reinforcement mechanism, not a prerequisite.

## Coverage Scope

Users should be able to generate coverage from different ADO/Jira scopes:

```bash
webpilot coverage generate --source ado --project WebPilot
webpilot coverage generate --source ado --team "QA Platform"
webpilot coverage generate --source ado --sprint "Sprint-24"
webpilot coverage generate --source ado --release "2026.07"
webpilot coverage generate --source ado --backlog
webpilot coverage generate --source jira --project WEB --fix-version "2026.07"
webpilot coverage generate --source jira --sprint "Sprint 24"
webpilot coverage generate --source jira --epic WEB-120
```

Supported scopes:

| Scope | ADO source | Jira source |
|-------|------------|-------------|
| Project | Project work items | Project issues |
| Team | Team / area path | Project + component/team field |
| Sprint | Iteration path | Sprint field |
| Release | Release tag / milestone | Fix version |
| Backlog | Backlog query | JQL backlog query |
| Epic / Feature | Feature hierarchy | Epic link / parent |

## Evidence Priority

Coverage proposals should combine evidence, ranked by strength:

1. Existing ADO/Jira native links to test cases or issues.
2. Confirmed mapping JSON from prior review.
3. Existing test tags, for example `@ADO-4821` or `@JIRA-WEB-123`.
4. AI semantic match between acceptance criteria and `.txt` test titles/steps.
5. AI semantic match against generated specs and POM method names.
6. Execution evidence: URLs/pages/actions/assertions touched by past runs.
7. Selector registry and assertion strength signals.
8. LLM-assisted gap analysis for uncovered criteria.

WebPilot must report confidence for every proposed mapping and show which evidence was used. A mapping can be proposed automatically, but release-grade coverage should require either strong evidence or human confirmation.

## CLI Design

```bash
webpilot requirements sync --source ado
webpilot requirements sync --source jira
webpilot requirements sync --all

webpilot coverage generate --source ado --project WebPilot
webpilot coverage generate --source ado --sprint Sprint-24
webpilot coverage generate --source jira --project WEB
webpilot coverage reconcile           # validate/correct existing tags + mapping
webpilot coverage
webpilot coverage --requirement ADO-4821
webpilot coverage --gaps
webpilot coverage review
webpilot coverage apply-mapping
webpilot coverage --format json

webpilot regression recommend --release Sprint-24
webpilot regression run --pack smoke
webpilot regression run --pack critical
webpilot regression run --pack full

webpilot flaky list
webpilot flaky quarantine
webpilot flaky promote
```

## Configuration

Add a committed requirements config:

```yaml
# resources/config/requirements.yaml
sources:
  ado:
    enabled: true
    organization: qubiqlabs
    project: WebPilot
    mcp:
      type: remote
      url: https://mcp.dev.azure.com/qubiqlabs
  jira:
    enabled: false
    cloudId: your-atlassian-cloud-id
    siteUrl: https://example.atlassian.net
    mcp:
      type: remote
      url: https://mcp.atlassian.com/v1/mcp/authv2

sync:
  query: currentSprint
  itemTypes:
    - User Story
    - Product Backlog Item
    - Bug
    - Feature
  fields:
    - id
    - title
    - description
    - acceptanceCriteria
    - priority
    - state
    - tags
    - sprint
    - release

mapping:
  tagPatterns:
    - "@ADO-{id}"
    - "@JIRA-{key}"
  autoMatch: true
  semanticMatch: true
  minConfidence: 0.72
  requireReviewBelow: 0.88
  writeTagsAfterReview: true
  writeMappingFileAfterReview: true

regression:
  packs:
    smoke:
      maxDurationMinutes: 15
      includePriority: [P0, P1]
      excludeFlakyAbove: 0.25
    critical:
      includePriority: [P0, P1, P2]
      excludeQuarantined: true
    full:
      includeAllCoveredRequirements: true
```

Optional manual overrides:

```yaml
# resources/config/requirement-map.yaml
ADO-4821:
  tests:
    - tests/web/booking_home_visibility_smoke.txt
    - tests/web/booking_search_hotels.txt
  confidence: high
  owner: qa-platform
  notes: Covers positive destination-search path only.
```

## Guided Coverage Workflow

The primary workflow should feel like a coverage assistant, not a static report.

```bash
webpilot requirements sync --source ado --sprint Sprint-24
webpilot coverage generate --sprint Sprint-24
webpilot coverage review
webpilot coverage apply-mapping
webpilot regression recommend --release Sprint-24
```

### Step 1: Sync requirements

WebPilot retrieves the selected scope from ADO/Jira:

```text
Sprint-24
  Feature: Hotel search
    Story: ADO-4821 Search hotels by destination
    Story: ADO-4822 Filter hotels by date
    Bug:   ADO-4890 Destination suggestions not keyboard accessible
```

### Step 2: Inventory existing tests

WebPilot reads:

- `tests/web/**/*.txt`
- `tests/api/**/*`
- `packages/test-framework/tests/**/*`
- `packages/test-framework/pages/**/*`
- `runtime/reports/data/execution-history/**/*`
- `runtime/codegen/**/*`
- `runtime/selectors/registry.json`

### Step 3: Load and reconcile existing mappings

Before proposing anything new, WebPilot loads existing coverage knowledge:

- requirement tags already present in `.txt` tests (`@ADO-4821`, `@JIRA-WEB-123`)
- `resources/config/requirement-map.yaml`
- previously confirmed `runtime/requirements/coverage/*.json`
- ADO/Jira native test links

Each existing mapping is re-validated against current reality, not trusted blindly:

| Check | Action |
|-------|--------|
| Mapped test still exists | If missing, flag mapping as broken |
| Mapped step still matches criterion | If step text changed, flag drift |
| Requirement text changed since mapping | Mark mapping stale, request re-confirm |
| Mapped test recently passing | If failing/flaky, downgrade coverage |
| Tag points to non-existent requirement | Flag orphan tag |
| Requirement has tag but mapping file disagrees | Reconcile and propose correction |

Reconciliation classifies every existing mapping as:

| State | Meaning |
|-------|---------|
| `valid` | Existing mapping still holds; keep as-is |
| `stale` | Requirement or test changed; needs re-confirm |
| `broken` | Mapped test/step no longer exists |
| `orphan` | Tag/mapping references unknown requirement or test |
| `conflict` | Tag and mapping file disagree |
| `low-quality` | Mapping valid but now flaky/weak/quarantined |

Example:

```text
Reconciliation for Sprint-24:
  valid:    12 mappings
  stale:     3 mappings (requirement text changed)
  broken:    1 mapping (tests/web/old_search.txt deleted)
  orphan:    1 tag (@ADO-4099 not in current scope)
  conflict:  1 mapping (tag says ADO-4821, map file says ADO-4822)
```

Only `valid` mappings are reused without review. Everything else gets a proposed correction that the SDET confirms in Step 5. WebPilot never silently rewrites an existing mapping — it surfaces the drift and the suggested fix.

### Step 4: AI proposes criterion-level coverage

Example proposal:

```text
ADO-4821: Search hotels by destination

AC1: User can enter destination
  Proposed coverage:
    tests/web/booking_home_visibility_smoke.txt step 4
    tests/web/booking_search_hotels.txt step 4
  Evidence:
    semantic-step-match: "Enter \"London\" in the destination field"
    execution: passed 3/3 recent runs
    selector: input[name="ss"] confidence high
  Confidence: 0.91

AC2: User can select destination suggestion
  Proposed coverage:
    tests/web/booking_search_hotels.txt step 5
  Evidence:
    semantic-step-match: "Select London, United Kingdom from the destination suggestions"
    execution: passed in knowledge-only replay until later date-picker step
  Confidence: 0.83
  Review required: yes

AC3: Search results show selected destination
  Proposed coverage:
    tests/web/booking_search_hotels.txt step 11
  Evidence:
    weak assertion evidence; no recent successful full run
  Confidence: 0.58
  Status: partial
```

### Step 5: Human confirms and corrects the map

Review presents reconciled existing mappings and new proposals together, so the SDET sees one consolidated picture per requirement.

Interactive review should allow:

- accept proposed mapping
- reject mapping
- correct a stale or conflicting existing mapping
- remove a broken or orphan tag/mapping
- split one criterion into multiple checks
- mark manual-only coverage
- create a new `.txt` test suggestion
- update tags in the test file
- write or update `requirement-map.yaml`

Example confirmed output:

```yaml
ADO-4821:
  criteria:
    "User can enter destination":
      tests:
        - path: tests/web/booking_home_visibility_smoke.txt
          steps: [4]
      confidence: confirmed
    "User can select destination suggestion":
      tests:
        - path: tests/web/booking_search_hotels.txt
          steps: [5]
      confidence: confirmed
    "Search results show selected destination":
      status: partial
      gap: Needs stable full-search assertion.
```

### Step 6: WebPilot maintains coverage

After review, future runs use the confirmed mapping as durable evidence, while still rechecking:

- requirement text changes
- test changes
- last pass status
- flake score
- selector confidence
- assertion strength

If a requirement changes after the last confirmed coverage review, WebPilot marks it stale:

```text
ADO-4821 coverage is stale:
  requirement updated: 2026-06-28
  last coverage review: 2026-06-22
```

## Runtime Data

Store synced and generated data under `runtime/`:

```text
runtime/requirements/
  ado/
    work-items.json
    test-plans.json
  jira/
    issues.json
  normalized/
    requirements.json
  coverage/
    requirement-coverage.json
    coverage-gaps.json
  regression-packs/
    smoke.json
    critical.json
    full.json
    quarantine.json
```

## Normalized Requirement Model

```json
{
  "id": "ADO-4821",
  "source": "ado",
  "sourceUrl": "https://dev.azure.com/qubiqlabs/WebPilot/_workitems/edit/4821",
  "type": "User Story",
  "title": "Search hotels by destination",
  "description": "As a traveler, I want to search hotels by destination...",
  "acceptanceCriteria": [
    "User can enter a destination",
    "User can select a destination suggestion",
    "Search results show the selected destination"
  ],
  "priority": "P1",
  "state": "Active",
  "sprint": "Sprint-24",
  "release": "2026.07",
  "tags": ["booking", "search"],
  "links": {
    "testCases": [],
    "bugs": [],
    "parent": "ADO-4800"
  }
}
```

## Coverage Model

```json
{
  "requirementId": "ADO-4821",
  "coverageStatus": "partial",
  "automationStatus": "automated",
  "confidence": 0.86,
  "coveredCriteria": [
    {
      "criterion": "User can enter a destination",
      "tests": [
        {
          "path": "tests/web/booking_home_visibility_smoke.txt",
          "steps": [4],
          "evidence": ["tag", "semantic-step-match"],
          "lastStatus": "PASSED",
          "flakeScore": 0.0
        }
      ]
    }
  ],
  "gaps": [
    "No automated negative test for invalid destination",
    "No automated empty destination validation"
  ],
  "risk": "medium"
}
```

## Coverage Scoring Rules

Coverage is calculated at the acceptance-criterion level, then rolled up to the requirement.

WebPilot should not mark a requirement as covered just because a test title looks similar. Coverage requires evidence that the criterion is verified by automation or explicitly accepted as manual coverage.

Scoring inputs:

| Signal | Example | Weight |
|--------|---------|--------|
| ADO/Jira native test link | linked test case | +25 |
| Confirmed mapping JSON | reviewed by SDET | +30 |
| Existing requirement tag | `@ADO-4821` | +20 |
| AI semantic criterion-step match | AC ↔ `.txt` step | +20 |
| Generated spec/POM match | method verifies same action/outcome | +10 |
| Strong assertion exists | verifies outcome, not just page load | +20 |
| Recent passing execution | pass within configured window | +10 |
| High selector confidence | stable primary selector | +5 |
| Strong assertion rating | assertion engine score strong | +5 |

Penalties:

| Signal | Penalty |
|--------|---------|
| No recent execution | -10 |
| Weak assertion only | -15 |
| Flake score above threshold | -20 to quarantine |
| Requirement updated after last coverage review | -20 |
| Test quarantined | does not count as automated coverage |

Classification:

| Score | Status |
|-------|--------|
| `>= 80` | Covered |
| `50-79` | Partial |
| `< 50` | Uncovered |
| quarantined | Mapped but not release-credit coverage |

Requirement roll-up:

```text
all criteria covered          -> Covered
some covered, some partial    -> Partial
any critical criterion gap    -> Partial / Blocked
all criteria uncovered        -> Uncovered
only quarantined automation   -> Not release-ready
```

## Regression Pack Rules

Regression pack recommendation should rank tests using:

| Signal | Effect |
|--------|--------|
| Requirement priority | Higher priority means stronger inclusion |
| Requirement changed recently | Strong inclusion |
| Requirement uncovered or partial | Suggest new tests |
| Test flake score | Penalize or quarantine |
| Selector confidence | Penalize low-confidence tests |
| Assertion strength | Penalize weak assertion coverage |
| Last run status | Failed tests need attention before release gate |
| Duration | Prefer fast stable tests for smoke |
| Tags | Respect `@smoke`, `@critical`, `@regression` |

Example pack output:

```json
{
  "pack": "critical",
  "release": "Sprint-24",
  "tests": [
    {
      "path": "tests/web/booking_search_hotels.txt",
      "reason": "Covers P1 requirement ADO-4821",
      "confidence": 0.84,
      "flakeScore": 0.12
    }
  ],
  "quarantined": [
    {
      "path": "tests/web/payment_coupon_flow.txt",
      "reason": "Flake score 0.42 over last 10 runs"
    }
  ]
}
```

## Reports

Add a Requirements Coverage section to HTML reports:

- Requirement coverage summary.
- Covered / partial / uncovered counts.
- Critical uncovered requirements.
- Flaky tests in release pack.
- Suggested new `.txt` test cases.
- Requirement-to-test traceability matrix.

Add JSON artifacts:

```text
runtime/reports/data/requirements/coverage-summary.json
runtime/reports/data/regression/recommended-pack.json
```

## Implementation Plan

### Phase 1: Local Model, Import, and AI Coverage Discovery

Implement without live MCP first so the core works offline.

Files:

- `src/core/requirements/Requirement.ts`
- `src/core/requirements/RequirementStore.ts`
- `src/core/requirements/RequirementNormalizer.ts`
- `src/core/requirements/CoverageMatcher.ts`
- `src/core/requirements/CoverageEvidenceCollector.ts`
- `src/core/requirements/CoverageReviewSession.ts`
- `src/core/regression/RegressionPackManager.ts`

CLI:

```bash
webpilot requirements import --file requirements.json
webpilot coverage generate
webpilot coverage review
webpilot coverage apply-mapping
webpilot coverage
webpilot regression recommend
```

Exit criteria:

- Local requirement JSON imports into normalized store.
- WebPilot inventories existing `.txt` tests, generated specs, page objects, and execution history.
- Existing tags and `requirement-map.yaml` are loaded and reconciled (valid/stale/broken/orphan/conflict), not ignored or blindly trusted.
- AI-assisted matching proposes acceptance-criterion coverage without requiring tags.
- Coverage review can accept/reject/edit proposed mappings and correct existing ones.
- Accepted mappings are persisted to `resources/config/requirement-map.yaml`.
- Optional tags can be written back to `.txt` tests after review.
- Coverage report identifies covered, partial, uncovered, and stale requirements.

### Phase 2: Azure DevOps MCP Connector

Files:

- `src/integrations/mcp/McpClient.ts`
- `src/integrations/requirements/AdoMcpConnector.ts`

CLI:

```bash
webpilot requirements sync --source ado
```

Exit criteria:

- Sync user stories/bugs from official ADO MCP.
- Normalize acceptance criteria and metadata.
- Cache results under `runtime/requirements/ado/`.
- No credentials are written to disk.

### Phase 3: Jira MCP Connector

Files:

- `src/integrations/requirements/JiraMcpConnector.ts`

CLI:

```bash
webpilot requirements sync --source jira
```

Exit criteria:

- Sync Jira stories/bugs from official Atlassian Rovo MCP.
- Normalize issue descriptions and acceptance criteria.
- Cache results under `runtime/requirements/jira/`.

### Phase 4: Flake-Aware Regression

Integrate:

- `src/core/flake/FlakeAnalyzer.ts`
- `runtime/reports/data/summaries/`
- `runtime/selectors/registry.json`
- codegen assertion summaries

Exit criteria:

- `webpilot regression recommend --release <name>` outputs smoke, critical, full, and quarantine packs.
- Flaky tests are excluded or downgraded based on configured thresholds.
- Quarantined tests do not count toward release-grade requirement coverage.
- Recommended pack can run through `webpilot regression run --pack <name>`.

### Phase 5: Report Integration

Add:

- HTML coverage dashboard.
- Requirement traceability matrix.
- Exportable JSON/CSV.

Exit criteria:

- `webpilot report --html` includes requirements coverage when data exists.
- CI artifact manifest includes coverage/regression JSON.

## Tests

Unit tests:

- ADO work item normalizer.
- Jira issue normalizer.
- Acceptance criteria extraction.
- AI-assisted criterion-to-test proposal scoring.
- Confirmed mapping precedence over inferred mappings.
- Stale coverage detection when requirements change.
- Optional tag writing after review.
- Semantic match confidence scoring.
- Regression ranking and quarantine thresholds.

Integration tests:

- Import fixture requirements and match existing `tests/web/*.txt`.
- Generate proposed coverage without any requirement tags present.
- Review and persist accepted mappings to `requirement-map.yaml`.
- Generate coverage gaps for uncovered criteria.
- Build smoke and critical packs from fixture execution history.
- Verify no secrets are persisted in `runtime/requirements/`.

MCP contract tests:

- Mock ADO MCP tool responses.
- Mock Jira MCP tool responses.
- Validate connector behavior when auth fails or tools are unavailable.

## Security and Privacy

Requirements may contain confidential product data. WebPilot must:

- Store synced data under `runtime/requirements/`, ignored by default.
- Never write OAuth tokens or PATs to disk.
- Redact credentials from logs and reports.
- Make LLM-assisted semantic matching opt-in for sensitive teams.
- Provide `--offline` mode using cached or imported requirements.
- Clearly report which MCP source and user identity were used.

## Exit Criteria

- `webpilot requirements import --file <json>` creates normalized requirements.
- `webpilot coverage generate` proposes requirement coverage from existing tests/scripts without requiring tags.
- `webpilot coverage review` lets SDETs confirm, reject, and edit proposed coverage.
- `webpilot coverage apply-mapping` persists confirmed coverage and optionally adds requirement tags to tests.
- `webpilot coverage --gaps` identifies uncovered acceptance criteria.
- `webpilot regression recommend` creates smoke, critical, full, and quarantine packs.
- ADO MCP sync works with official Microsoft MCP server.
- Jira MCP sync works with official Atlassian Rovo MCP server.
- HTML reports show a requirements coverage summary.
- No requirement credentials or tokens are persisted.

## Implementation Status

Phase 1 shipped (local model + AI-assisted discovery + reconciliation + regression packs). Phase 2 MCP sync is wired for official ADO/Jira stdio servers. **ADO Test Plans** (create plans/cases, map automation, publish pass/fail) ship via bundled `@azure-devops/mcp` under `src/integrations/ado/` and `webpilot ado …`. The HTML requirements dashboard is still planned.

### Shipped in Phase 1

Source modules:

- `src/core/requirements/types.ts` — normalized requirement, coverage, mapping, and reconciliation models.
- `src/core/requirements/RequirementNormalizer.ts` — normalizes generic / ADO REST / Jira REST payloads and extracts acceptance criteria (heading, list, and Given/When/Then aware).
- `src/core/requirements/RequirementStore.ts` — import + merge into `runtime/requirements/normalized/requirements.json`.
- `src/core/requirements/TestInventory.ts` — collects natural-language tests, tags, steps, last status, and a history-derived flake score.
- `src/core/requirements/CoverageMatcher.ts` — deterministic semantic baseline matcher, acceptance-criterion-level scoring, and mapping reconciliation.
- `src/core/requirements/RequirementMap.ts` — reads/writes `resources/config/requirement-map.yaml` (human-editable, `confirmed` / `proposed` / `rejected`).
- `src/core/requirements/CoverageService.ts` — orchestrates reconcile → coverage → proposal writing → confirmation.
- `src/integrations/ado/` — bundled ADO MCP launcher, Test Plan/Case services, automation map, REST result publisher.
- `src/core/requirements/McpStdioClient.ts` — minimal JSON-RPC-over-stdio MCP client for official ADO/Jira MCP servers.
- `src/core/requirements/RequirementSyncService.ts` — guided ADO WIQL / Jira JQL scope sync, MCP tool selection, result extraction, and direct normalization.
- `src/core/regression/RegressionPackManager.ts` — priority- and flake-weighted pack recommendation with quarantine.

### Shipped commands

```
webpilot requirements import <file.json> [--source ado|jira|import] [--project --team --sprint --release --epic] [--no-merge]
webpilot requirements list
webpilot requirements sync [ado|jira] [--project --team --sprint --release --epic --backlog] [--dry-run] [--no-merge]
webpilot coverage generate [--no-proposals] [--json]   # default for `webpilot coverage`
webpilot coverage show [--gaps] [--json]
webpilot coverage reconcile [--json]
webpilot coverage apply-mapping (--all | --requirement <id>)
webpilot regression recommend [--name <name>] [--no-partial] [--json]   # default for `webpilot regression`
```

`requirements sync` now supports the intended guided workflow: choose ADO or Jira, pick project/team/sprint/release/epic/backlog scope, call the configured MCP tool, normalize stories/issues directly into `runtime/requirements/normalized/requirements.json`, then run coverage. `requirements import` remains as an offline/test fallback.

To enable live sync, configure `resources/config/webpilot.yaml`:

```yaml
requirements:
  mcp:
    ado:
      enabled: true
      command: "<official-ado-mcp-command>"
      args: ["..."]
      toolName: "query_work_items" # optional if auto-discovery finds the tool
      queryArgument: "wiql"
    jira:
      enabled: true
      command: "<official-jira-mcp-command>"
      args: ["..."]
      toolName: "search_issues" # optional if auto-discovery finds the tool
      queryArgument: "jql"
```

Run `webpilot requirements sync --source ado --project WebPilot --sprint Sprint-24 --dry-run` to validate the generated WIQL/JQL before calling MCP.

### Remaining MVP roadmap

1. ✅ Local import + AI-assisted coverage discovery.
2. ✅ ADO MCP sync (configured stdio MCP).
3. ✅ Guided coverage review + mapping/tag generation (reconcile + apply-mapping).
4. ✅ Flake-aware regression packs.
5. ✅ Jira MCP sync (configured stdio MCP).
6. ⏳ HTML requirements dashboard.
