#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

pick_python() {
  if [[ -n "${WEBPILOT_PYTHON:-}" ]]; then
    echo "$WEBPILOT_PYTHON"
    return
  fi
  for cmd in python3.13 python3.12 python3.11 python3 python py; do
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
  echo "  macOS: brew install python@3.12"
  echo "  Windows: install from https://www.python.org/downloads/"
  echo "  Or set WEBPILOT_PYTHON to your python executable"
  exit 1
fi

VENV_PY="${ROOT}/.venv/bin/python3"
if [[ -f "${ROOT}/.venv/Scripts/python.exe" ]]; then
  VENV_PY="${ROOT}/.venv/Scripts/python.exe"
fi

echo "WebPilot: using $PYTHON ($($PYTHON --version))"
echo "Creating venv at ${ROOT}/.venv"
rm -rf .venv
"$PYTHON" -m venv .venv
"$VENV_PY" -m pip install -U pip
"$VENV_PY" -m pip install -r requirements.txt
echo "Done. WebPilot's Browser Use engine source is installed editable in .venv"
"$VENV_PY" -c "import browser_use; print(f'browser_use source: {browser_use.__file__}')"
