#!/usr/bin/env bash
# Lint everything. Used by gates 01-style and 04-security.
#
# Usage:  scripts-or-runners/lint-all.sh [--security]
#
# Exit codes:
#   0  PASS
#   1  FAIL
set -euo pipefail

cd "$(dirname "$0")/../.."   # repo root
LOG_DIR="quality-gates/.logs"
mkdir -p "$LOG_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOG="$LOG_DIR/lint-all-$STAMP.log"

WITH_SECURITY=0
for arg in "$@"; do
  case "$arg" in
    --security) WITH_SECURITY=1 ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done

echo "[lint-all] starting (security=$WITH_SECURITY) → $LOG"

# 01-style: TS + python + markdown
{
  echo "== pnpm lint =="
  pnpm -r lint || { echo "[lint-all] pnpm lint FAILED"; exit 1; }
  echo "== ruff (workers) =="
  if command -v ruff >/dev/null 2>&1; then
    ruff check . || { echo "[lint-all] ruff FAILED"; exit 1; }
  else
    echo "ruff not installed; skipping (install via pip install ruff)"
  fi
  echo "== markdownlint =="
  if command -v markdownlint >/dev/null 2>&1; then
    markdownlint '**/*.md' --ignore node_modules --ignore vendor || {
      echo "[lint-all] markdownlint FAILED"; exit 1;
    }
  else
    echo "markdownlint not installed; skipping"
  fi
} | tee -a "$LOG"

if [ "$WITH_SECURITY" -eq 1 ]; then
  {
    echo "== semgrep (owasp + secrets) =="
    if command -v semgrep >/dev/null 2>&1; then
      semgrep --config=p/owasp-top-ten --config=p/secrets --error \
        apps packages || { echo "[lint-all] semgrep FAILED"; exit 1; }
    else
      echo "semgrep not installed; skipping"
    fi
    echo "== gitleaks =="
    if command -v gitleaks >/dev/null 2>&1; then
      gitleaks detect --redact --no-banner || {
        echo "[lint-all] gitleaks FAILED"; exit 1;
      }
    else
      echo "gitleaks not installed; skipping"
    fi
  } | tee -a "$LOG"
fi

echo "[lint-all] PASS"
