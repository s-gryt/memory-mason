#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "${SCRIPT_DIR}/_common.sh" ]; then
  source "${SCRIPT_DIR}/_common.sh"
else
  if command -v curl >/dev/null 2>&1; then
    source /dev/stdin <<<"$(curl -fsSL "https://raw.githubusercontent.com/s-gryt/memory-mason/main/scripts/install/_common.sh")"
  elif command -v wget >/dev/null 2>&1; then
    source /dev/stdin <<<"$(wget -qO- "https://raw.githubusercontent.com/s-gryt/memory-mason/main/scripts/install/_common.sh")"
  else
    echo "ERROR: remote install requires curl or wget"
    exit 1
  fi
fi

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
    --help|-h)
      echo "Usage: bash scripts/install/codex.sh [--workspace /path/to/project] [--force]"
      exit 0
      ;;
    *)
      echo "ERROR: unknown argument: $1"
      exit 1
      ;;
  esac
done

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: 'node' is required to install Memory Mason Codex hooks."
  echo "       Install Node.js from https://nodejs.org and re-run this script."
  exit 1
fi

CODEX_DIR="${CODEX_CONFIG_DIR:-$HOME/.codex}"
HOOKS_DIR="$CODEX_DIR/hooks/memory-mason"
GLOBAL_CONFIG_DIR="$HOME/.memory-mason"
GLOBAL_CONFIG_PATH="$GLOBAL_CONFIG_DIR/config.json"
REPO_URL="https://raw.githubusercontent.com/s-gryt/memory-mason/main/hooks"

HOOK_RUNTIME_FILES=("session-start.js" "user-prompt-submit.js" "post-tool-use.js" "pre-compact.js" "session-end.js")
LIB_FILES=(
  "capture/capture-state.js"
  "capture/coaching-emit.js"
  "capture/constants.js"
  "capture/transcript-labels.js"
  "capture/transcript.js"
  "cli/cli.js"
  "coaching/insights.js"
  "config/config.js"
  "config/constants.js"
  "config/platforms.js"
  "economics/compress.js"
  "economics/constants.js"
  "economics/token-economics.js"
  "filter/classifier.js"
  "filter/constants.js"
  "filter/sensitive-guard.js"
  "filter/tag-stripper.js"
  "hook/capture-ops.js"
  "hook/constants.js"
  "hook/hook-events.js"
  "hook/hook-ops.js"
  "hook/hook-runtime.js"
  "migration/migrate-daily.js"
  "prompt/prompt.js"
  "shared/assert.js"
  "shared/constants.js"
  "state/json-state.js"
  "state/state.js"
  "vault/chunk-writer.js"
  "vault/constants.js"
  "vault/markdown-labels.js"
  "vault/vault-paths.js"
  "vault/vault.js"
  "vault/writer.js"
)

runtime_files_present() {
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

workspace_hooks_present() {
  local workspace_hooks_file="$1"
  local workspace_config_file="$2"

  if [ ! -f "$workspace_hooks_file" ]; then
    return 1
  fi

  if [ ! -f "$workspace_config_file" ]; then
    return 1
  fi

  if ! grep -Eq '^[[:space:]]*hooks[[:space:]]*=[[:space:]]*true([[:space:]]*)$' "$workspace_config_file"; then
    return 1
  fi

  return 0
}

download_file() {
  local url="$1"
  local destination_path="$2"

  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" -o "$destination_path"
    return
  fi

  if command -v wget >/dev/null 2>&1; then
    wget -qO "$destination_path" "$url"
    return
  fi

  echo "ERROR: remote install requires curl or wget"
  exit 1
}

copy_or_download_file() {
  local relative_path="$1"
  local destination_path="$2"
  local source_mode="$3"

  mkdir -p "$(dirname "$destination_path")"

  if [ "$source_mode" = "local" ]; then
    cp "$HOOKS_SOURCE_DIR/$relative_path" "$destination_path"
  else
    download_file "$REPO_URL/$relative_path" "$destination_path"
  fi

  echo "  Installed: $destination_path"
}

WORKSPACE_ROOT="$(resolve_workspace_dir "$WORKSPACE_ARG")"
if [ ! -d "$WORKSPACE_ROOT" ]; then
  echo "ERROR: workspace directory does not exist: $WORKSPACE_ROOT"
  exit 1
fi

WORKSPACE_CODEX_DIR="$WORKSPACE_ROOT/.codex"
WORKSPACE_HOOKS_FILE="$WORKSPACE_CODEX_DIR/hooks.json"
WORKSPACE_CONFIG_FILE="$WORKSPACE_CODEX_DIR/config.toml"

SOURCE_MODE="remote"
if has_local_sources; then
  SOURCE_MODE="local"
fi

RUNTIME_PRESENT=0
if runtime_files_present; then
  RUNTIME_PRESENT=1
fi

WORKSPACE_PRESENT=0
if workspace_hooks_present "$WORKSPACE_HOOKS_FILE" "$WORKSPACE_CONFIG_FILE"; then
  WORKSPACE_PRESENT=1
fi

CONFIG_PRESENT=0
if [ -f "$GLOBAL_CONFIG_PATH" ]; then
  CONFIG_PRESENT=1
fi

if [ "$FORCE" -eq 0 ] && [ "$RUNTIME_PRESENT" -eq 1 ] && [ "$WORKSPACE_PRESENT" -eq 1 ] && [ "$CONFIG_PRESENT" -eq 1 ]; then
  echo "Memory Mason Codex hooks already installed."
  echo "  Hook runtime: $HOOKS_DIR"
  echo "  Workspace config: $WORKSPACE_CODEX_DIR"
  echo "  Global config: $GLOBAL_CONFIG_PATH"
  echo "  Re-run with --force to reinstall."
  exit 0
fi

if [ "$FORCE" -eq 1 ]; then
  echo "Reinstalling Memory Mason Codex hooks (--force)..."
  if [ -d "$HOOKS_DIR" ]; then
    rm -rf "$HOOKS_DIR"
  fi
else
  echo "Installing Memory Mason Codex hooks..."
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

  read -r -p "Enter subfolder name [ai-knowledge]: " subfolder_input
  subfolder="${subfolder_input:-ai-knowledge}"

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

MEMORY_MASON_WORKSPACE_HOOKS_FILE="$WORKSPACE_HOOKS_FILE" \
MEMORY_MASON_HOOKS_DIR="$HOOKS_DIR" \
node -e "
  const fs = require('fs');
  const path = require('path');
  const hooksFile = process.env.MEMORY_MASON_WORKSPACE_HOOKS_FILE;
  const hooksDir = process.env.MEMORY_MASON_HOOKS_DIR;
  if (!hooksFile) {
    throw new Error('hooksFile is required');
  }
  if (!hooksDir) {
    throw new Error('hooksDir is required');
  }

  const normalizedHooksDir = hooksDir.replace(/\\\\/g, '/');
  const commandFor = (fileName) => 'node \"' + normalizedHooksDir + '/' + fileName + '\"';
  const payload = {
    hooks: {
      SessionStart: [{ hooks: [{ type: 'command', command: commandFor('session-start.js'), timeout: 10 }] }],
      UserPromptSubmit: [{ hooks: [{ type: 'command', command: commandFor('user-prompt-submit.js'), timeout: 5 }] }],
      PostToolUse: [{ hooks: [{ type: 'command', command: commandFor('post-tool-use.js'), timeout: 5 }] }],
      PreCompact: [{ hooks: [{ type: 'command', command: commandFor('pre-compact.js'), timeout: 10 }] }],
      Stop: [{ hooks: [{ type: 'command', command: commandFor('session-end.js'), timeout: 15 }] }]
    }
  };

  fs.mkdirSync(path.dirname(hooksFile), { recursive: true });
  fs.writeFileSync(hooksFile, JSON.stringify(payload, null, 2) + '\\n');
"

echo "  Installed: $WORKSPACE_HOOKS_FILE"

MEMORY_MASON_CODEX_CONFIG_FILE="$WORKSPACE_CONFIG_FILE" \
node -e "
  const fs = require('fs');
  const path = require('path');
  const configFile = process.env.MEMORY_MASON_CODEX_CONFIG_FILE;
  if (!configFile) {
    throw new Error('configFile is required');
  }

  const current = fs.existsSync(configFile) ? fs.readFileSync(configFile, 'utf8') : '';
  let next = current;

  if (/^\\s*hooks\\s*=.*$/m.test(next)) {
    next = next.replace(/^\\s*hooks\\s*=.*$/m, 'hooks = true');
  } else {
    const trimmed = next.trimEnd();
    next = trimmed === '' ? 'hooks = true\\n' : trimmed + '\\n\\nhooks = true\\n';
  }

  fs.mkdirSync(path.dirname(configFile), { recursive: true });
  fs.writeFileSync(configFile, next);
"

echo "  Updated: $WORKSPACE_CONFIG_FILE"

echo ""
echo "Done!"
echo "  Hook runtime: $HOOKS_DIR"
echo "  Workspace config: $WORKSPACE_CODEX_DIR"
echo "  Global config: $GLOBAL_CONFIG_PATH"
