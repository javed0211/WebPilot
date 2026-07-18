# Azure DevOps Test Plans (bundled MCP)

WebPilot ships the official [`@azure-devops/mcp`](https://www.npmjs.com/package/@azure-devops/mcp) server and talks to it over stdio. Consumer repos that install `@qubiqlabs/webpilot` do **not** need a Cursor/`mcp.json` setup — configure `ado:` in project `resources/config/webpilot.yaml` and use the CLI.

## What you can do

| Goal | Command |
|------|---------|
| Verify org/project/auth + MCP | `webpilot ado status` |
| Create a Test Plan | `webpilot ado testplan create --name "…" --iteration "Project\\Sprint 1"` |
| List plans | `webpilot ado testplan list` |
| Create a Test Case (+ optional suite) | `webpilot ado testcase create --title "…" --plan <id> --suite <id> --from-test tests/web/foo.txt` |
| Map automation → Test Case | `webpilot ado link --test tests/web/foo.txt --testcase <id> --plan <id> --suite <id>` |
| Create missing cases from `tests/` | `webpilot ado sync-cases --plan <id> --suite <id>` |
| Push PASSED/FAILED to ADO | `webpilot ado publish-results` |

Pass/fail write-back uses the **Azure DevOps Test Results REST API** (MCP has no publish-outcome tool today). Plan/case CRUD uses MCP `test-plans` tools.

## Consumer setup

1. Install WebPilot in the target repo (`npm i -D @qubiqlabs/webpilot` or global).
2. Ensure `resources/config/webpilot.yaml` has an `ado:` block (copied by `webpilot init`):

```yaml
ado:
  enabled: true
  organization: "contoso"
  project: "MyProject"
  auth: pat                 # or azcli for MCP-only interactive/CI with Azure CLI
  domains: [core, work-items, test-plans]
  testPlans:
    defaultPlanName: "WebPilot Automation"
    autoPublishResults: false
```

3. Export a PAT with Test Plans + Work Items scope:

```bash
export AZURE_DEVOPS_EXT_PAT="…"   # or ADO_MCP_AUTH_TOKEN / AZURE_DEVOPS_PAT
```

4. Smoke-test:

```bash
webpilot ado status
```

5. Durable map file: `resources/config/ado-test-map.yaml` (written by `ado link` / `ado sync-cases`).

## Auto-publish after runs

Set `ado.testPlans.autoPublishResults: true`. After Engine or ActHistory replay writes a summary, WebPilot best-effort publishes mapped outcomes. Publish failures are logged and do not fail the local run unless you use an explicit `webpilot ado publish-results` (which exits non-zero on error).

## Requirements sync reuse

When `ado.enabled` is true and `requirements.mcp.ado.command` is empty, `webpilot requirements sync --source ado` reuses the same bundled MCP launcher.

## CI notes

- Node.js 20+
- Provide PAT via pipeline secret (no interactive browser login)
- Result publish requires `auth: pat` (REST Basic). `auth: azcli` is supported for MCP tool calls only.
- Least privilege: Test Plans (read/write), Work Items (read/write)

## Related

- Feature spec: [09 Requirements Coverage & Regression](../features/09-requirements-coverage-regression.md)
- CLI overview: [CLI Reference](./cli-reference.md)
