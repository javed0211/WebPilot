#!/usr/bin/env bash
#
# WebPilot release/publish helper.
#
# Runs the mandatory pre-publish checks from docs/PUBLISHING.md (audits, build,
# pack inspection, dry-run), bumps the version, and publishes to npm.
#
# Usage:
#   scripts/publish.sh [patch|minor|major|<explicit-version>] [options]
#
# Options:
#   --otp <code>     One-time MFA code passed to `npm publish`.
#   --dry-run        Run every check and `npm publish --dry-run`, but do NOT publish.
#   --skip-pip       Skip the Python pip-audit step (Node-only release).
#   --skip-audit     Skip npm + pip audits (NOT recommended).
#   --yes            Do not prompt for confirmation before publishing.
#   -h, --help       Show this help.
#
# Examples:
#   scripts/publish.sh patch --otp 123456
#   scripts/publish.sh minor --dry-run
#   scripts/publish.sh 1.2.0 --otp 123456 --yes
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# ----- pretty output ---------------------------------------------------------
if [[ -t 1 ]]; then
  BOLD="$(printf '\033[1m')"; RED="$(printf '\033[31m')"; GREEN="$(printf '\033[32m')"
  YELLOW="$(printf '\033[33m')"; BLUE="$(printf '\033[34m')"; DIM="$(printf '\033[2m')"
  RESET="$(printf '\033[0m')"
else
  BOLD=""; RED=""; GREEN=""; YELLOW=""; BLUE=""; DIM=""; RESET=""
fi
step() { printf '\n%s==> %s%s\n' "$BLUE$BOLD" "$1" "$RESET"; }
ok()   { printf '%s  ✔ %s%s\n' "$GREEN" "$1" "$RESET"; }
warn() { printf '%s  ! %s%s\n' "$YELLOW" "$1" "$RESET"; }
die()  { printf '\n%s  ✘ %s%s\n' "$RED$BOLD" "$1" "$RESET"; exit 1; }

# ----- args ------------------------------------------------------------------
BUMP=""
OTP=""
DRY_RUN=0
SKIP_PIP=0
SKIP_AUDIT=0
ASSUME_YES=0

usage() { sed -n '2,33p' "$0" | sed 's/^# \{0,1\}//'; exit 0; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    patch|minor|major) BUMP="$1"; shift ;;
    [0-9]*.[0-9]*.[0-9]*) BUMP="$1"; shift ;;
    --otp) OTP="${2:-}"; shift 2 ;;
    --otp=*) OTP="${1#*=}"; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --skip-pip) SKIP_PIP=1; shift ;;
    --skip-audit) SKIP_AUDIT=1; shift ;;
    --yes|-y) ASSUME_YES=1; shift ;;
    -h|--help) usage ;;
    *) die "Unknown argument: $1 (use --help)" ;;
  esac
done

[[ -z "$BUMP" ]] && die "Specify a version bump: patch | minor | major | <x.y.z> (see --help)"

CURRENT_VERSION="$(node -p "require('./package.json').version")"
PKG_NAME="$(node -p "require('./package.json').name")"
step "Releasing ${BOLD}${PKG_NAME}${RESET} (current ${CURRENT_VERSION}, bump: ${BUMP})"

# ----- 0. preconditions ------------------------------------------------------
step "Checking preconditions"

command -v node >/dev/null 2>&1 || die "node is not installed"
command -v npm  >/dev/null 2>&1 || die "npm is not installed"

if [[ "$DRY_RUN" -eq 0 ]]; then
  if ! npm whoami >/dev/null 2>&1; then
    die "Not logged in to npm. Run: npm login --registry=https://registry.npmjs.org/"
  fi
  ok "npm user: $(npm whoami)"
fi

# Refuse to publish from a dirty tree (uncommitted changes can leak into the tarball intent).
if [[ -n "$(git status --porcelain 2>/dev/null)" ]]; then
  if [[ "$DRY_RUN" -eq 1 ]]; then
    warn "Working tree is dirty (allowed for --dry-run)."
  else
    git status --short
    die "Working tree is dirty. Commit or stash changes before publishing."
  fi
else
  ok "Working tree is clean"
fi

# ----- 1. install ------------------------------------------------------------
step "Installing dependencies (npm ci)"
if [[ -f package-lock.json ]]; then
  npm ci
else
  warn "No package-lock.json; falling back to npm install"
  npm install
fi
ok "Dependencies installed"

# ----- 2. audits -------------------------------------------------------------
if [[ "$SKIP_AUDIT" -eq 1 ]]; then
  warn "Skipping audits (--skip-audit)"
else
  step "Auditing npm dependencies (high+)"
  npm audit --audit-level=high || die "npm audit found high/critical vulnerabilities. Fix before publishing."
  ok "npm audit passed"

  if [[ "$SKIP_PIP" -eq 1 ]]; then
    warn "Skipping Python pip-audit (--skip-pip)"
  else
    step "Auditing Python dependencies (pip-audit)"
    PYTHON="${WEBPILOT_PYTHON:-}"
    if [[ -z "$PYTHON" ]]; then
      for cmd in python3.12 python3.11 python3; do
        command -v "$cmd" >/dev/null 2>&1 && PYTHON="$cmd" && break
      done
    fi
    if [[ -z "$PYTHON" ]]; then
      warn "No suitable Python found; skipping pip-audit. Install python@3.12 or pass --skip-pip."
    else
      AUDIT_VENV="$(mktemp -d)/.audit-venv"
      "$PYTHON" -m venv "$AUDIT_VENV"
      "$AUDIT_VENV/bin/python" -m pip install -q -U pip pip-audit
      "$AUDIT_VENV/bin/python" -m pip install -q -r requirements.txt
      "$AUDIT_VENV/bin/pip-audit" -r requirements.txt || die "pip-audit found vulnerable Python dependencies."
      rm -rf "$AUDIT_VENV"
      ok "pip-audit passed"
    fi
  fi
fi

# ----- 3. build --------------------------------------------------------------
step "Building (npm run build)"
npm run build || die "Build failed"
ok "Build succeeded"

# ----- 4. secrets / artifact sanity -----------------------------------------
step "Inspecting package contents (npm pack --dry-run)"
PACK_OUTPUT="$(npm pack --dry-run 2>&1)"
echo "$PACK_OUTPUT" | grep -E '(\.env$|/runtime/|node_modules/|\.pem$|\.key$|secrets)' \
  && die "Refusing to publish: package would include sensitive or unexpected files (see above)." \
  || ok "No obviously sensitive files in the tarball"

# Guard against real secrets accidentally committed into llm.json.
if [[ -f resources/config/llm.json ]]; then
  if grep -Eq '"(apiKey|secretKey)"\s*:\s*"(sk-|AKIA|AIza)[A-Za-z0-9_-]{8,}' resources/config/llm.json; then
    die "resources/config/llm.json appears to contain a real API key. Replace with \${ENV} placeholders before publishing."
  fi
  ok "resources/config/llm.json contains no obvious real secrets"
fi

# ----- 5. version bump -------------------------------------------------------
if [[ "$BUMP" == "$CURRENT_VERSION" ]]; then
  step "Using current version (${CURRENT_VERSION})"
  NEW_VERSION="$CURRENT_VERSION"
  VERSION_CHANGED=0
  ok "Version already set to ${BOLD}${NEW_VERSION}${RESET}"
else
  step "Bumping version (${BUMP})"
  # `npm version` updates package.json + package-lock.json without creating a git tag here.
  NEW_VERSION="$(npm version "$BUMP" --no-git-tag-version | tail -n1)"
  NEW_VERSION="${NEW_VERSION#v}"
  VERSION_CHANGED=1
  ok "Version: ${CURRENT_VERSION} -> ${BOLD}${NEW_VERSION}${RESET}"
fi

# ----- 6. publish dry-run ----------------------------------------------------
step "Publish dry-run"
npm publish --dry-run --access public || die "npm publish --dry-run failed"
ok "Dry-run succeeded"

if [[ "$DRY_RUN" -eq 1 ]]; then
  warn "--dry-run set: stopping before publish."
  if [[ "${VERSION_CHANGED:-0}" -eq 1 ]]; then
    warn "Reverting version bump."
    # Restore ONLY the version field so any other uncommitted edits are preserved.
    node -e "const fs=require('fs');const p=require('./package.json');p.version='${CURRENT_VERSION}';fs.writeFileSync('./package.json',JSON.stringify(p,null,2)+'\n');"
    if [[ -f package-lock.json ]]; then
      node -e "const fs=require('fs');const l=require('./package-lock.json');l.version='${CURRENT_VERSION}';if(l.packages&&l.packages['']){l.packages[''].version='${CURRENT_VERSION}';}fs.writeFileSync('./package-lock.json',JSON.stringify(l,null,2)+'\n');"
    fi
    ok "Reverted version to ${CURRENT_VERSION}."
  fi
  ok "Nothing was published."
  exit 0
fi

# ----- 7. confirm + publish --------------------------------------------------
if [[ "$ASSUME_YES" -eq 0 ]]; then
  printf '\n%sPublish %s@%s to npm now? [y/N] %s' "$BOLD" "$PKG_NAME" "$NEW_VERSION" "$RESET"
  read -r REPLY
  case "$REPLY" in
    y|Y|yes|YES) ;;
    *) warn "Aborted by user. Version bumped to ${NEW_VERSION} locally but not published."; exit 1 ;;
  esac
fi

step "Publishing to npm"
PUBLISH_ARGS=(--access public)
[[ -n "$OTP" ]] && PUBLISH_ARGS+=(--otp "$OTP")

if npm publish "${PUBLISH_ARGS[@]}"; then
  ok "Published ${PKG_NAME}@${NEW_VERSION}"
else
  die "npm publish failed. If this is an OTP error, re-run: npm publish --access public --otp <code>"
fi

# ----- 8. git tag ------------------------------------------------------------
step "Tagging release"
git add package.json package-lock.json 2>/dev/null || true
if git diff --cached --quiet 2>/dev/null; then
  warn "No staged package.json changes to commit (already committed?)."
else
  git commit -m "release: ${PKG_NAME}@${NEW_VERSION}"
fi
git tag -a "v${NEW_VERSION}" -m "${PKG_NAME} v${NEW_VERSION}" 2>/dev/null && ok "Created tag v${NEW_VERSION}" || warn "Tag v${NEW_VERSION} already exists"

printf '\n%s%sDone.%s Verify with: %snpm view %s version%s\n' \
  "$GREEN" "$BOLD" "$RESET" "$DIM" "$PKG_NAME" "$RESET"
printf '%sPush the release commit + tag with: git push && git push --tags%s\n' "$DIM" "$RESET"
