#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

pick_python() {
  if [[ -n "${WEBPILOT_PYTHON:-}" ]]; then
    echo "$WEBPILOT_PYTHON"
    return
  fi
  for cmd in python3.12 python3.11 python3; do
    if command -v "$cmd" >/dev/null 2>&1; then
      ver="$("$cmd" -c 'import sys; print(sys.version_info[:2])' 2>/dev/null || echo '(0,0)')"
      major="${ver#*(}"
      major="${major%,*}"
      minor="${ver#*, }"
      minor="${minor%)*}"
      if [[ "$major" -ge 3 && "$minor" -ge 11 ]]; then
        echo "$cmd"
        return
      fi
    fi
  done
  echo ""
}

PYTHON="$(pick_python)"
if [[ -z "$PYTHON" ]]; then
  echo "ERROR: browser-use requires Python 3.11+."
  echo "  Install: brew install python@3.12"
  echo "  Or set WEBPILOT_PYTHON=/path/to/python3.12"
  exit 1
fi

echo "WebPilot: using $PYTHON ($($PYTHON --version))"
echo "Creating venv at ${ROOT}/.venv"
rm -rf .venv
"$PYTHON" -m venv .venv
.venv/bin/python3 -m pip install -U pip
.venv/bin/python3 -m pip install -r requirements.txt
echo "Done. browser-use is installed in .venv"
.venv/bin/python3 -c "import browser_use; print('browser_use ok')"
