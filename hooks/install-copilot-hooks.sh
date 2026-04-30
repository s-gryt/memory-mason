#!/usr/bin/env bash
set -euo pipefail

FORCE=0
WORKSPACE_ARG=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --workspace|-w)
      if [ "$#" -lt 2 ]; then
        echo "ERROR: $1 requires a workspace path"
        exit 1
      fi
      WORKSPACE_ARG="$2"
      shift 2
      ;;
    --force|-f)
      FORCE=1
      shift
      ;;
    *)
      echo "ERROR: unknown argument: $1"
      exit 1
      ;;
  esac
done

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: 'node' is required to install Memory Mason Copilot hooks."
  echo "       Install Node.js from https://nodejs.org and re-run this script."
  exit 1
fi

COPILOT_DIR="${COPILOT_CONFIG_DIR:-$HOME/.copilot}"
HOOKS_DIR="$COPILOT_DIR/hooks/memory-mason"
GLOBAL_CONFIG_DIR="$HOME/.memory-mason"
GLOBAL_CONFIG_PATH="$GLOBAL_CONFIG_DIR/config.json"
REPO_URL="https://raw.githubusercontent.com/s-gryt/memory-mason/main/hooks"

HOOK_RUNTIME_FILES=("session-start.js" "user-prompt-submit.js" "post-tool-use.js" "pre-compact.js" "session-end.js")
LIB_FILES=("config.js" "writer.js" "vault.js" "prompt.js" "transcript.js" "capture-state.js")
HOOK_JSON_FILES=("session-start.json" "user-prompt-submit.json" "post-tool-use.json" "pre-compact.json" "stop.json" "session-end.json")

SCRIPT_DIR=""
if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)"
fi

is_absolute_path() {
  case "$1" in
    /*|[A-Za-z]:[\\/]* )
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

resolve_workspace_dir() {
  local workspace_value="$1"

  if [ "$workspace_value" = "" ]; then
    pwd
    return
  fi

  if is_absolute_path "$workspace_value"; then
    if [ -d "$workspace_value" ]; then
      (cd "$workspace_value" && pwd)
      return
    fi

    echo "$workspace_value"
    return
  fi

  if [ -d "$workspace_value" ]; then
    (cd "$workspace_value" && pwd)
    return
  fi

  echo "$(pwd)/$workspace_value"
}

has_local_sources() {
  if [ "$SCRIPT_DIR" = "" ]; then
    return 1
  fi

  for runtime_file in "${HOOK_RUNTIME_FILES[@]}"; do
    if [ ! -f "$SCRIPT_DIR/$runtime_file" ]; then
      return 1
    fi
  done

  for lib_file in "${LIB_FILES[@]}"; do
    if [ ! -f "$SCRIPT_DIR/lib/$lib_file" ]; then
      return 1
    fi
  done

  return 0
}

all_runtime_files_present() {
  for runtime_file in "${HOOK_RUNTIME_FILES[@]}"; do
    if [ ! -f "$HOOKS_DIR/$runtime_file" ]; then
      return 1
    fi
  done

  for lib_file in "${LIB_FILES[@]}"; do
    if [ ! -f "$HOOKS_DIR/lib/$lib_file" ]; then
      return 1
    fi
  done

  if [ ! -f "$HOOKS_DIR/package.json" ]; then
    return 1
  fi

  return 0
}

all_workspace_hook_files_present() {
  local workspace_hooks_dir="$1"

  for hook_json_file in "${HOOK_JSON_FILES[@]}"; do
    if [ ! -f "$workspace_hooks_dir/$hook_json_file" ]; then
      return 1
    fi
  done

  return 0
}

copy_or_download_file() {
  local relative_path="$1"
  local destination_path="$2"
  local source_mode="$3"

  mkdir -p "$(dirname "$destination_path")"

  if [ "$source_mode" = "local" ]; then
    cp "$SCRIPT_DIR/$relative_path" "$destination_path"
  else
    if ! command -v curl >/dev/null 2>&1; then
      echo "ERROR: 'curl' is required when local source files are not available."
      exit 1
    fi

    curl -fsSL "$REPO_URL/$relative_path" -o "$destination_path"
  fi

  echo "  Installed: $destination_path"
}

TARGET_WORKSPACE="$(resolve_workspace_dir "$WORKSPACE_ARG")"
if [ ! -d "$TARGET_WORKSPACE" ]; then
  echo "ERROR: workspace directory does not exist: $TARGET_WORKSPACE"
  exit 1
fi

WORKSPACE_HOOKS_DIR="$TARGET_WORKSPACE/.github/hooks"
SOURCE_MODE="remote"
if has_local_sources; then
  SOURCE_MODE="local"
fi

CONFIG_PRESENT=0
if [ -f "$GLOBAL_CONFIG_PATH" ]; then
  CONFIG_PRESENT=1
fi

RUNTIME_PRESENT=0
if all_runtime_files_present; then
  RUNTIME_PRESENT=1
fi

WORKSPACE_HOOKS_PRESENT=0
if all_workspace_hook_files_present "$WORKSPACE_HOOKS_DIR"; then
  WORKSPACE_HOOKS_PRESENT=1
fi

if [ "$FORCE" -eq 0 ] && [ "$RUNTIME_PRESENT" -eq 1 ] && [ "$WORKSPACE_HOOKS_PRESENT" -eq 1 ] && [ "$CONFIG_PRESENT" -eq 1 ]; then
  echo "Memory Mason Copilot hooks already installed."
  echo "  Hook runtime: $HOOKS_DIR"
  echo "  Workspace hooks: $WORKSPACE_HOOKS_DIR"
  echo "  Config: $GLOBAL_CONFIG_PATH"
  echo "  Re-run with --force to reinstall."
  exit 0
fi

if [ "$FORCE" -eq 1 ]; then
  echo "Reinstalling Memory Mason Copilot hooks (--force)..."
  if [ -d "$HOOKS_DIR" ]; then
    rm -rf "$HOOKS_DIR"
  fi
else
  echo "Installing Memory Mason Copilot hooks..."
fi

echo "Source mode: $SOURCE_MODE"

mkdir -p "$HOOKS_DIR"
mkdir -p "$HOOKS_DIR/lib"

for runtime_file in "${HOOK_RUNTIME_FILES[@]}"; do
  copy_or_download_file "$runtime_file" "$HOOKS_DIR/$runtime_file" "$SOURCE_MODE"
done

for lib_file in "${LIB_FILES[@]}"; do
  copy_or_download_file "lib/$lib_file" "$HOOKS_DIR/lib/$lib_file" "$SOURCE_MODE"
done

cat > "$HOOKS_DIR/package.json" <<'JSON'
{
  "type": "commonjs"
}
JSON
echo "  Installed: $HOOKS_DIR/package.json"

if [ -f "$GLOBAL_CONFIG_PATH" ]; then
  echo "Global config already exists at $GLOBAL_CONFIG_PATH"
else
  if [ ! -t 0 ]; then
    echo "ERROR: Global config missing at $GLOBAL_CONFIG_PATH and no interactive terminal is available."
    echo "       Create the config file manually and re-run this script."
    exit 1
  fi

  vault_path=""
  while [ "$vault_path" = "" ]; do
    read -r -p "Enter your Obsidian vault absolute path: " vault_path_input
    if [ "$vault_path_input" = "" ]; then
      echo "Vault path is required."
      continue
    fi

    if ! is_absolute_path "$vault_path_input"; then
      echo "Please provide an absolute path."
      continue
    fi

    vault_path="$vault_path_input"
  done

  read -r -p "Enter subfolder name [memory-mason]: " subfolder_input
  subfolder="${subfolder_input:-memory-mason}"

  MEMORY_MASON_GLOBAL_CONFIG="$GLOBAL_CONFIG_PATH" \
  MEMORY_MASON_VAULT_PATH_INPUT="$vault_path" \
  MEMORY_MASON_SUBFOLDER_INPUT="$subfolder" \
  node -e "
    const fs = require('fs');
    const path = require('path');
    const configPath = process.env.MEMORY_MASON_GLOBAL_CONFIG;
    const vaultPath = process.env.MEMORY_MASON_VAULT_PATH_INPUT;
    const subfolder = process.env.MEMORY_MASON_SUBFOLDER_INPUT;
    if (!configPath) {
      throw new Error('configPath is required');
    }
    if (!vaultPath) {
      throw new Error('vaultPath is required');
    }
    if (!subfolder) {
      throw new Error('subfolder is required');
    }
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({ vaultPath, subfolder }, null, 2) + '\\n');
  "

  echo "Created global config at $GLOBAL_CONFIG_PATH"
fi

MEMORY_MASON_WORKSPACE_HOOKS_DIR="$WORKSPACE_HOOKS_DIR" \
MEMORY_MASON_HOOKS_DIR="$HOOKS_DIR" \
node -e "
  const fs = require('fs');
  const path = require('path');
  const workspaceHooksDir = process.env.MEMORY_MASON_WORKSPACE_HOOKS_DIR;
  const hooksDir = process.env.MEMORY_MASON_HOOKS_DIR;
  if (!workspaceHooksDir) {
    throw new Error('workspaceHooksDir is required');
  }
  if (!hooksDir) {
    throw new Error('hooksDir is required');
  }

  const normalizedHooksDir = hooksDir.replace(/\\\\/g, '/');
  const definitions = [
    { fileName: 'session-start.json', eventName: 'SessionStart', scriptName: 'session-start.js', timeout: 10 },
    { fileName: 'user-prompt-submit.json', eventName: 'UserPromptSubmit', scriptName: 'user-prompt-submit.js', timeout: 5 },
    { fileName: 'post-tool-use.json', eventName: 'PostToolUse', scriptName: 'post-tool-use.js', timeout: 5 },
    { fileName: 'pre-compact.json', eventName: 'PreCompact', scriptName: 'pre-compact.js', timeout: 15 },
    { fileName: 'stop.json', eventName: 'Stop', scriptName: 'session-end.js', timeout: 15 },
    { fileName: 'session-end.json', eventName: 'SessionEnd', scriptName: 'session-end.js', timeout: 15 }
  ];

  fs.mkdirSync(workspaceHooksDir, { recursive: true });
  definitions.forEach((definition) => {
    const payload = {
      hooks: {
        [definition.eventName]: [
          {
            type: 'command',
            command: 'node "' + normalizedHooksDir + '/' + definition.scriptName + '"',
            timeout: definition.timeout
          }
        ]
      }
    };

    fs.writeFileSync(path.join(workspaceHooksDir, definition.fileName), JSON.stringify(payload, null, 2) + '\\n');
  });
"

echo ""
echo "Done!"
echo "  Hook runtime: $HOOKS_DIR"
echo "  Workspace hooks: $WORKSPACE_HOOKS_DIR"
echo "  Config: $GLOBAL_CONFIG_PATH"
