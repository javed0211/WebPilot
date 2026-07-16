# ActHistory, Codegen Reuse & History Management

How WebPilot stores browser discovery results, when it reuses them, when it generates code, and how to clear history.

---

## Why this matters

On `--codegen` re-runs, WebPilot can **skip expensive browser rediscovery** and reuse a prior ActHistory. That saves tokens and time — but only when the prior run actually **succeeded**.

Failed runs (for example `net::ERR_CONNECTION_CLOSED`) still write a history file. Those failures must **not**:

- Be reused as “successful” discovery
- Trigger codegen
- Report the job as **PASSED** without opening a browser

This guide documents the rules and the CLI to manage that state.

---

## What ActHistory is

After a `browser-use` run, WebPilot writes a full execution context:

```text
runtime/reports/data/execution-history/<slug>_execution_history.json
```

The slug is the scenario file name without extension (`Digital.txt` → `Digital`).

Important fields:

| Field | Meaning |
|-------|---------|
| `actHistory` / `executionHistory` | Structured browser actions (source of truth for codegen) |
| `isSuccessful` | `true` only when discovery completed the scenario successfully |
| `isDone` | Agent finished — **not** the same as success |
| `failure` / `errors` | Failure markers when the run did not succeed |
| `nlSteps` | Original natural-language steps (reference) |
| `urlSequence` | Pages visited |

> **Rule:** only `isSuccessful === true` counts as a reusable, codegen-eligible history. `isDone` alone is never enough.

Related artifacts (optional to clear together):

| Artifact | Path |
|----------|------|
| Summary | `runtime/reports/data/summaries/<slug>_summary.json` |
| LLM usage | `runtime/reports/data/llm-usage/<slug>_llm_usage.json` |
| HTML report | `runtime/reports/html/<slug>-report.html` |
| Screenshots | `runtime/reports/screenshots/<slug>/` |
| Video / trace | `runtime/reports/videos/`, `runtime/reports/traces/` |
| Codegen failure memory | `runtime/codegen/failures/<slug>.json` |
| Codegen trace / plan | `runtime/codegen/traces/`, `runtime/codegen/plans/` |

---

## Success-only codegen

**Codegen runs only after a successful discovery/execution.**

| Outcome | Codegen |
|---------|---------|
| Scenario passes (`isSuccessful: true`) and `--codegen` is set | Generates POM + spec |
| Scenario fails | **Skipped** — message: only successful executions generate code |
| Prior failed history on disk | Not reused; next run rediscovers (or clear history) |

```bash
# Generates code only if this run succeeds
webpilot run tests/web/Digital.txt --codegen
```

On failure you will see something like:

```text
[Codegen] Skipped — only successful executions generate code.
Re-run after the scenario passes.
```

The hard gate lives in `runPostExecutionCodegen` (`src/core/codegen/PostExecutionCodegen.ts`) and is also enforced in the browser-use runner before queuing deterministic codegen.

---

## ActHistory reuse on `--codegen` re-runs

When you re-run the **same** `.txt` with `--codegen`, WebPilot may skip the browser:

```text
○ Skipping browser discovery — reusing N ActHistory step(s) from …
```

### Reuse is allowed only when all of these hold

1. `--codegen` is set (or `WEBPILOT_REUSE_HISTORY=1`)
2. An ActHistory file exists for the slug
3. The test file is **not newer** than the history (mtime)
4. `isSuccessful === true`
5. No failure markers on the document
6. History has at least one act step
7. `WEBPILOT_FORCE_DISCOVERY` is not set

### Reuse is refused when

| Condition | What happens |
|-----------|----------------|
| Prior run failed (`isSuccessful: false`) | Rediscover |
| History has `failure` / `errors` | Rediscover |
| Test `.txt` edited after history was saved | Rediscover |
| `--force-discovery` / `WEBPILOT_FORCE_DISCOVERY=1` | Rediscover |
| `WEBPILOT_REUSE_HISTORY=0` | Never reuse |

Implementation: `src/core/codegen/HistoryReuse.ts`, used from `Engine.ts`.

---

## Force rediscovery (one-off)

Without deleting files:

```bash
webpilot run tests/web/Digital.txt --codegen --force-discovery
```

Equivalent env:

```bash
WEBPILOT_FORCE_DISCOVERY=1 webpilot run tests/web/Digital.txt --codegen
```

Use when:

- The UI changed and locators need refreshing
- You suspect stale ActHistory
- You want a clean discovery without clearing disk history

---

## Managing history from the CLI

### List

```bash
webpilot history list
```

Shows each slug, whether history was **successful** or **failed/incomplete**, and the file path.

### Clear one scenario

```bash
webpilot history clear Digital
webpilot history clear tests/web/Digital.txt
```

Deletes that scenario’s ActHistory so the next `--codegen` run rediscovers.

### Clear everything

```bash
webpilot history clear --all
webpilot history clear --all -y          # skip confirmation
```

### Clear history + related report artifacts

```bash
webpilot history clear Digital --related
webpilot history clear --all --related -y
```

`--related` also removes summary, LLM usage, HTML report, screenshots, video, trace, codegen failure memory, and codegen trace/plan for the slug(s).

| Command | What it removes |
|---------|-----------------|
| `history clear <slug>` | ActHistory JSON only |
| `history clear <slug> --related` | ActHistory + related report/codegen artifacts |
| `history clear --all` | All ActHistory files |
| `history clear --all --related` | All ActHistory + related artifacts per slug |

Source: `src/core/HistoryClear.ts`.

---

## Recommended workflows

### After a failed run (do not want a false pass)

```bash
# Option A — clear bad history, then re-run
webpilot history clear Digital
webpilot run tests/web/Digital.txt --codegen

# Option B — keep the file, force rediscovery once
webpilot run tests/web/Digital.txt --codegen --force-discovery
```

### After a successful run (generate CI code)

```bash
webpilot run tests/web/Digital.txt --codegen --report
# … later, cheap re-codegen from successful history (no browser if unchanged)
webpilot run tests/web/Digital.txt --codegen
```

### Reset local learned state for a scenario

```bash
webpilot history clear Digital --related
```

### Nuclear reset of all ActHistory

```bash
webpilot history clear --all --related -y
```

---

## Init from an existing repository

Interactive `webpilot init` (without `-y`) asks whether to start from an existing code repo:

1. **No** — empty WebPilot project  
2. **Yes — clone a Git repository** — CodegenAgent / knowledge graph can reuse existing page objects  
3. **Yes — use an existing local folder**

Non-interactive flags:

```bash
webpilot init --clone https://github.com/org/repo.git --branch main
webpilot init --from-path ../my-existing-tests
webpilot init --clone https://github.com/org/repo.git --skip-graph
```

| Flag | Purpose |
|------|---------|
| `--clone <url>` | Clone a Git repo, overlay WebPilot, build knowledge graph |
| `--from-path <dir>` | Use a local folder (no clone) |
| `--branch <name>` | Branch for `--clone` |
| `--skip-graph` | Skip knowledge graph build after init |
| `-y` / `--yes` | Skip wizard (blank project defaults) |

### How clone works

`webpilot init --clone` runs system Git:

```bash
git clone --depth 1 [--branch <name>] <url> <dest>
```

- Shallow clone (`--depth 1`) for speed  
- Destination defaults to the repo name when you pass `.` as the init directory  
- If the destination already has a `.git` folder, clone is skipped and WebPilot overlays on top  
- **`webpilot setup` does not clone** — only `webpilot init` does  

### Git credentials (private repos)

**WebPilot does not store, prompt for, or inject Git credentials.** Authentication is entirely whatever your installed `git` already uses.

| Method | Example URL | What you need |
|--------|-------------|----------------|
| **SSH** (recommended for private) | `git@github.com:org/repo.git` | SSH key in `ssh-agent` / GitHub account |
| **HTTPS + credential helper** | `https://github.com/org/repo.git` | Already logged in via Git Credential Manager, macOS Keychain, or `gh auth login` |
| **HTTPS + PAT in URL** | `https://<token>@github.com/org/repo.git` | Works but avoid committing the URL; prefer helpers |
| **Already cloned locally** | — | `webpilot init --from-path /path/to/repo` (no network auth) |
| **Public HTTPS** | `https://github.com/octocat/Hello-World.git` | No credentials |

Because clone uses `stdio: 'inherit'`, if Git needs an interactive prompt (rare with modern credential managers), it appears in your terminal.

If clone fails with auth errors, fix Git first (`ssh -T git@github.com`, `gh auth status`, or clone manually), then retry — or use `--from-path` on a repo you already cloned.

See [Repository Knowledge Graph](./repository-knowledge-graph.md).

---

## Environment variables

| Variable | Effect |
|----------|--------|
| `WEBPILOT_CODEGEN=1` | Enable codegen (set by `--codegen`) |
| `WEBPILOT_FORCE_DISCOVERY=1` | Ignore ActHistory reuse; rediscover |
| `WEBPILOT_REUSE_HISTORY=0` | Disable ActHistory reuse even with `--codegen` |
| `WEBPILOT_REUSE_HISTORY=1` | Allow reuse even without `--codegen` |
| `WEBPILOT_FORCE_CODEGEN=1` | Do not reuse an existing passing generated spec |

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Second run **PASSED** in ~1s with no browser | Old bug: failed history reused as success | Upgrade; clear history or `--force-discovery` |
| Codegen wrote files after a failed navigation | Should no longer happen | Confirm package version; check `[Codegen] Skipped` on failure |
| Always rediscovering despite success | Test file mtime newer than history, or `WEBPILOT_REUSE_HISTORY=0` | Check `history list`; unset env |
| Want to wipe one flaky scenario | Stale ActHistory | `webpilot history clear <slug> --related` |

---

## See also

- [Execution & Replay](./execution-and-replay.md)
- [Deterministic Codegen](./deterministic-codegen.md)
- [CLI Reference](./cli-reference.md) — `history`, `run --codegen`, `run --force-discovery`
- [Reports & Evidence](./reports-and-evidence.md)
- [Repository Knowledge Graph](./repository-knowledge-graph.md)
