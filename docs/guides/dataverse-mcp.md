# Dataverse MCP (bundled official server)

WebPilot ships [`@microsoft/dataverse`](https://www.npmjs.com/package/@microsoft/dataverse) and talks to Microsoft’s Dataverse MCP endpoint over stdio. Consumer repos do **not** need Cursor/`mcp.json` — configure `dataverse:` in `resources/config/webpilot.yaml` and use the CLI.

This is the **data / schema** plane. UI automation still uses the Dynamics **rulebook** (`resources/rulebooks/dynamics365/`) and the browser agent.

## What you can do

| Goal | Command |
|------|---------|
| Verify config + MCP tools | `webpilot dataverse status` |
| Official auth/endpoint check | `webpilot dataverse validate` |
| List MCP tools | `webpilot dataverse tools` |
| Call any tool | `webpilot dataverse call --tool describe --arg query=account` |
| Describe a table | `webpilot dataverse describe account` |
| Search | `webpilot dataverse search "contacts named Contoso"` |
| SQL SELECT | `webpilot dataverse query "SELECT TOP 5 name FROM account"` |

Typical tools (names can vary by GA vs preview): `search_data`, `search`, `describe`, `read_query`, `create_record`, `update_record`, `delete_record`, schema tools.

## Consumer setup

1. Admin (once per tenant / environment):
   - Enable Dataverse MCP in [Power Platform admin center](https://aka.ms/enableDataverseMcp).
   - Allow the **Dataverse CLI** client (app id `0c412cc3-0dd6-449b-987f-05b053db9457`).
   - Tenant admin consent:  
     `https://login.microsoftonline.com/{tenant-id}/adminconsent?client_id=0c412cc3-0dd6-449b-987f-05b053db9457`
2. In `resources/config/webpilot.yaml`:

```yaml
dataverse:
  enabled: true
  environmentUrl: "https://contoso.crm.dynamics.com"
  preview: false
```

Or set `DATAVERSE_URL`.

3. Authenticate once with the Dataverse CLI (browser / device code / service principal):

```bash
npx @microsoft/dataverse auth create --environment https://contoso.crm.dynamics.com
# CI / headless:
# npx @microsoft/dataverse auth create --applicationId … --clientSecret … --tenant …
```

4. Smoke-test:

```bash
webpilot dataverse validate
webpilot dataverse status
webpilot dataverse describe account
```

## How it relates to Dynamics UI tests

| Layer | Mechanism |
|-------|-----------|
| Browser discovery | `sitePack: dynamics365` + `resources/rulebooks/dynamics365/seed.md` |
| Data / metadata | `webpilot dataverse …` (this MCP) |

Use MCP to confirm records exist, pull logical names for scenarios, or seed data. Use the rulebook + `webpilot run` for UCI clicks.

## CI notes

- Node.js 20+
- Prefer service-principal auth profiles for non-interactive agents
- Outside Copilot Studio, Dataverse MCP usage may consume Copilot credits (see Microsoft Learn billing notes)
- Keep `dataverse.enabled: false` until the environment is ready

## Related

- Microsoft Learn: [Connect to Dataverse with MCP](https://aka.ms/dataverse/mcp)
- Non-Microsoft clients: [local proxy / Entra app](https://learn.microsoft.com/en-us/power-apps/maker/data-platform/data-platform-mcp-other-clients)
- UI rulebook: `resources/rulebooks/dynamics365/seed.md`
- ADO (same bundling pattern): [ADO Test Plans](./ado-test-plans.md)
