# Publishing WebPilot

This page is the release checklist for publishing WebPilot to npm.

WebPilot is distributed as an **npm CLI package** that also installs a Python runtime for the browser-use engine. The npm package owns the `webpilot` command; `webpilot setup` creates the Python virtual environment.

---

## Package manager

WebPilot is published to **npm** under the **`@qubiqlabs`** organization scope as **`@qubiqlabs/webpilot`**. The installed command remains `webpilot`.

Evidence in `package.json`:

```json
{
  "name": "@qubiqlabs/webpilot",
  "bin": {
    "webpilot": "./dist/src/cli/index.js"
  },
  "publishConfig": {
    "access": "public"
  },
  "prepack": "npm run build"
}
```

After install:

```bash
npm install -g @qubiqlabs/webpilot
webpilot --help
```

The package name is scoped (`@qubiqlabs/webpilot`) but the command stays `webpilot` because `package.json#bin` controls the installed binary name. All QubiQ packages publish under the `@qubiqlabs` scope.

> Note: the plain `@qubiq` scope is already taken on npm by an unrelated project, so QubiQ packages use `@qubiqlabs`.

---

## Publishing requirements

| Requirement | Needed | Notes |
|-------------|--------|-------|
| npm account | Yes | Use an account owned by the project/org |
| npm 2FA | Yes | Use security-key or authenticator app |
| Code signing certificate | No | npm does not require one |
| Unique package name | Yes | Check with `npm view webpilot` |
| Build output | Yes | `prepack` runs `npm run build` |
| Clean audits | Yes | npm and Python audits must pass |
| Secrets check | Yes | No real keys in committed configs or docs |

Recommended CI publishing method: **npm trusted publishing** from GitHub Actions (OIDC), instead of long-lived `NPM_TOKEN` secrets.

---

## Runtime requirements for users

| Requirement | Version | Why |
|-------------|---------|-----|
| Node.js | `>=20` | CLI, codegen, reports, graph |
| Python | `>=3.11` | browser-use execution engine |
| Playwright browsers | Current project version | Chrome/Chromium execution |
| LLM credentials | Provider-specific | Discovery on unknown steps |

End-user install:

```bash
npm install -g @qubiqlabs/webpilot
webpilot setup
npx playwright install chromium
webpilot doctor
```

Developer install from a clone:

```bash
npm ci
npm run build
npm link
webpilot setup
npx playwright install chromium
webpilot doctor
```

Use `npm run webpilot -- ...` only when you intentionally want to run the local repo script without relying on the globally linked command.

---

## Node + Python architecture

```text
webpilot (Node CLI)
   |
   | spawns subprocess
   v
.venv/bin/python -m integrations.browser_use
   |
   v
browser-use + Playwright-driven Chrome
```

The npm tarball includes:

- compiled Node CLI under `dist/`
- Python integration sources under `src/**/*.py`
- vendored browser-use sources under `packages/browser-use/browser_use/`
- `requirements.txt`
- `scripts/setup-python.sh`

`webpilot setup` installs Python dependencies into `.venv` from `requirements.txt`.

---

## Release script (recommended)

`scripts/publish.sh` runs all mandatory checks, bumps the version, inspects the
tarball for secrets, and publishes. It refuses to publish from a dirty tree or
when audits fail.

```bash
# Validate everything without publishing (bumps, dry-runs, then reverts):
npm run release -- patch --dry-run

# Publish a patch release with your MFA code:
npm run release -- patch --otp 123456

# Other bumps / explicit version:
npm run release -- minor --otp 123456
npm run release -- 1.2.0 --otp 123456 --yes
```

Options: `--otp <code>`, `--dry-run`, `--skip-pip`, `--skip-audit`, `--yes`, `--help`.

The script performs, in order: precondition checks (npm login, clean tree) →
`npm ci` → `npm audit --audit-level=high` → `pip-audit` → `npm run build` →
`npm pack --dry-run` secret scan → version bump → `npm publish --dry-run` →
confirm → `npm publish` → git commit + tag.

## Mandatory pre-publish checks (manual equivalent)

If you publish by hand instead of `scripts/publish.sh`, run these first:

```bash
npm ci
npm audit --audit-level=high
npm run build

python3.12 -m venv .venv
.venv/bin/python -m pip install -U pip pip-audit
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/pip-audit -r requirements.txt

npm pack --dry-run
npm publish --dry-run
```

Current CI also enforces:

- `npm audit --audit-level=high`
- `pip-audit -r requirements.txt`

---

## Security gate

Do not publish if any of these are true:

- `npm audit --audit-level=high` fails
- `pip-audit -r requirements.txt` reports known vulnerabilities
- `npm run build` fails
- `webpilot doctor` fails in a clean environment
- `.env`, real API keys, cookies, traces, screenshots, or private URLs are present in publishable files
- `npm pack --dry-run` includes unexpected runtime artifacts

Review package contents carefully:

```bash
npm pack --dry-run
```

Expected high-level contents:

- `dist/`
- `src/**/*.py`
- `packages/browser-use/browser_use/`
- `resources/config/`
- `resources/templates/`
- `resources/prompts/`
- `resources/report-ui/`
- `docs/*.md`
- `README.md`, `LICENSE`, `SECURITY.md`, `CONTRIBUTING.md`

Unexpected contents to block:

- `.env`
- `runtime/`
- `node_modules/`
- browser traces/videos/screenshots from private apps
- real credentials in `resources/config/llm.json` or environment files

---

## One-time account and org setup

These steps are manual and must be done by the package owner:

1. Create an npm account at <https://www.npmjs.com/signup>.
2. Enable 2FA (Account → Two-Factor Authentication) — required for publishing.
3. Create the organization `qubiqlabs` at <https://www.npmjs.com/org/create> (free for public packages). This reserves the `@qubiqlabs` scope.
4. Log in locally: `npm login`.
5. Confirm identity: `npm whoami`.

All future QubiQ packages publish under `@qubiqlabs/<package>`.

## First publish

```bash
npm login
npm whoami
npm publish        # access:public is already set in publishConfig
```

After publish:

```bash
npm view @qubiqlabs/webpilot version
npm install -g @qubiqlabs/webpilot
webpilot setup
webpilot doctor
```

---

## Versioning

Use semantic versioning:

| Change | Version bump |
|--------|--------------|
| Bug fix / dependency security fix | Patch |
| New backwards-compatible feature | Minor |
| Breaking CLI/config behavior | Major |

Examples:

```bash
npm version patch
npm version minor
```

Only publish from a clean working tree after tests and audits pass.

---

## Related docs

- [USAGE.md](./USAGE.md)
- [SECURITY.md](../SECURITY.md)
- [CI & Artifacts](./guides/ci-and-artifacts.md)
- [CLI Reference](./guides/cli-reference.md)
