# WebPilot site rulebooks

Origin-gated playbooks injected into discovery **only when the active site matches**.
Learning already stores step capabilities under `runtime/site-knowledge/`; rulebooks add
**vocabulary + prefer-selectors** for *new* steps on that site type.

## Layout

```text
resources/rulebooks/
  generic/          # always on
  digital/          # public / marketing / content sites
  dynamics365/      # Dynamics UCI (EasyRepro-aligned)
  <pack>/
    manifest.json   # id, origins, originSuffixes, always?, priority
    seed.md         # curated human rules (shipped)
runtime/rulebooks/
  <pack>/
    learned.md      # auto-distilled from site-knowledge (optional)
```

The `dynamics365` seed mirrors EasyRepro’s UCI surface (`Navigation`, `CommandBar`,
`Grid`, `Entity`, `Lookup`, `Dialogs`, BPF, Timeline, QuickCreate, GlobalSearch) as
agent-facing recipes — not C# bindings.

For **data / schema** (not UI), use the bundled Dataverse MCP: `webpilot dataverse …`
(see `docs/guides/dataverse-mcp.md`).
## Activation

1. Always load `generic`.
2. Match pack by:
   - scenario metadata `sitePack: dynamics365` (or `digital`), or
   - URL / hostname against `origins` / `originSuffixes` in the manifest.
3. Append `seed.md` + `learned.md` (if present) into discovery `LOCATOR HINTS`.

Non-matching packs are **not** injected (D365 terms never hit Booking, etc.).

## Auto-learn

After successful runs, WebPilot may append high-trust locator/name hints into
`runtime/rulebooks/<pack>/learned.md` when `intelligentRunner.rulebooks.autoLearn` is true
(default on). Seed files are never overwritten.

## Author override

```text
@smoke
sitePack: dynamics365
Test: Open Accounts via Quick Find
1. Navigate to https://contoso.crm.dynamics.com/...
```
