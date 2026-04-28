#!/usr/bin/env bash
set -euo pipefail

REMOTE_BASE="https://raw.githubusercontent.com/s-gryt/memory-mason/main"
AGENT=""
FORCE=0
WORKSPACE=""

print_usage() {
  echo "Usage: bash install.sh [--agent claude|copilot|codex|all] [--force] [--workspace /path/to/project]"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --agent|-a)
      if [ "$#" -lt 2 ]; then
        echo "ERROR: $1 requires a value"
        exit 1
      fi
      AGENT="$2"
      shift 2
      ;;
    --force|-f)
      FORCE=1
      shift
      ;;
    --workspace|-w)
      if [ "$#" -lt 2 ]; then
        echo "ERROR: $1 requires a workspace path"
        exit 1
      fi
      WORKSPACE="$2"
      shift 2
      ;;
    --help|-h)
      print_usage
      exit 0
      ;;
    *)
      echo "ERROR: unknown argument: $1"
      print_usage
      exit 1
      ;;
  esac
done

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: 'node' is required to install Memory Mason hooks."
  echo "       Install Node.js from https://nodejs.org and re-run this script."
  exit 1
fi

SCRIPT_DIR=""
if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)"
fi

run_remote_script() {
  local relative_path="$1"
  shift

  if command -v curl >/dev/null 2>&1; then
    bash <(curl -fsSL "$REMOTE_BASE/$relative_path") "$@"
    return
  fi

  if command -v wget >/dev/null 2>&1; then
    bash <(wget -qO- "$REMOTE_BASE/$relative_path") "$@"
    return
  fi

  echo "ERROR: remote install requires curl or wget"
  exit 1
}

run_installer() {
  local relative_path="$1"
  shift

  if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/$relative_path" ]; then
    bash "$SCRIPT_DIR/$relative_path" "$@"
    return
  fi

  run_remote_script "$relative_path" "$@"
}

normalize_agent() {
  local value="$1"
  echo "$value" | tr '[:upper:]' '[:lower:]'
}

prompt_for_agent() {
  if [ ! -t 0 ]; then
    echo "ERROR: no --agent provided and no interactive terminal available."
    echo "       Re-run with --agent claude|copilot|codex|all"
    exit 1
  fi

  echo "Which agent?"
  echo "  (1) Claude Code"
  echo "  (2) GitHub Copilot"
  echo "  (3) Codex"
  echo "  (4) All"
  read -r -p "Select 1-4: " selection

  case "$selection" in
    1) AGENT="claude" ;;
    2) AGENT="copilot" ;;
    3) AGENT="codex" ;;
    4) AGENT="all" ;;
    *)
      echo "ERROR: invalid selection: $selection"
      exit 1
      ;;
  esac
}

if [ "$AGENT" = "" ]; then
  if [ -n "${CLAUDE_CONFIG_DIR:-}" ] || [ -n "${CLAUDE_PLUGIN_ROOT:-}" ]; then
    AGENT="claude"
    echo "Detected Claude Code environment."
  else
    prompt_for_agent
  fi
else
  AGENT="$(normalize_agent "$AGENT")"
fi

case "$AGENT" in
  claude|copilot|codex|all)
    ;;
  *)
    echo "ERROR: unsupported agent: $AGENT"
    print_usage
    exit 1
    ;;
esac

CLAUDE_ARGS=()
COPILOT_ARGS=()
CODEX_ARGS=()

if [ "$FORCE" -eq 1 ]; then
  CLAUDE_ARGS+=("--force")
  COPILOT_ARGS+=("--force")
  CODEX_ARGS+=("--force")
fi

if [ "$WORKSPACE" != "" ]; then
  COPILOT_ARGS+=("--workspace" "$WORKSPACE")
  CODEX_ARGS+=("--workspace" "$WORKSPACE")
fi

INSTALLED=()

if [ "$AGENT" = "claude" ] || [ "$AGENT" = "all" ]; then
  run_installer "hooks/install.sh" "${CLAUDE_ARGS[@]}"
  INSTALLED+=("Claude Code")
fi

if [ "$AGENT" = "copilot" ] || [ "$AGENT" = "all" ]; then
  run_installer "hooks/install-copilot-hooks.sh" "${COPILOT_ARGS[@]}"
  INSTALLED+=("GitHub Copilot")
fi

if [ "$AGENT" = "codex" ] || [ "$AGENT" = "all" ]; then
  run_installer "hooks/install-codex-hooks.sh" "${CODEX_ARGS[@]}"
  INSTALLED+=("Codex")
fi

echo ""
echo "Install summary:"
for installed_agent in "${INSTALLED[@]}"; do
  echo "  - $installed_agent"
done
