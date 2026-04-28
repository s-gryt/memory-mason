#!/usr/bin/env bash
# Memory Mason - one-command hook installer for Claude Code
# Usage: bash hooks/install.sh
#   or:  bash hooks/install.sh --force
#   or:  bash <(curl -s https://raw.githubusercontent.com/s-gryt/memory-mason/main/hooks/install.sh)
set -e

FORCE=0
for arg in "$@"; do
  case "$arg" in
    --force|-f) FORCE=1 ;;
  esac
done

case "$OSTYPE" in
  msys*|cygwin*|mingw*)
    echo "WARNING: Running on Windows ($OSTYPE)."
    echo "         This script works in Git Bash/MSYS but symlinks may require"
    echo "         Developer Mode or admin privileges."
    echo ""
    ;;
esac

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: 'node' is required to install Memory Mason Claude Code hooks."
  echo "       Install Node.js from https://nodejs.org and re-run this script."
  exit 1
fi

CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
HOOKS_DIR="$CLAUDE_DIR/hooks/memory-mason"
SETTINGS="$CLAUDE_DIR/settings.json"
GLOBAL_CONFIG_DIR="$HOME/.memory-mason"
GLOBAL_CONFIG_PATH="$GLOBAL_CONFIG_DIR/config.json"
REPO_URL="https://raw.githubusercontent.com/s-gryt/memory-mason/main/hooks"

HOOK_RUNTIME_FILES=("session-start.js" "user-prompt-submit.js" "post-tool-use.js" "pre-compact.js" "session-end.js")
LIB_FILES=("config.js" "writer.js" "vault.js" "prompt.js" "transcript.js" "capture-state.js")
HOOK_EVENTS=("SessionStart" "UserPromptSubmit" "UserPromptExpansion" "PostToolUse" "PreCompact" "SessionEnd")

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

all_files_present() {
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

hooks_wired() {
  if [ ! -f "$SETTINGS" ]; then
    return 1
  fi

  MEMORY_MASON_SETTINGS="$SETTINGS" node -e "
    const fs = require('fs');
    const settingsPath = process.env.MEMORY_MASON_SETTINGS;
    const rawSettings = fs.readFileSync(settingsPath, 'utf8').replace(/^\\uFEFF/, '');
    const settings = JSON.parse(rawSettings);
    const requiredEvents = ['SessionStart', 'UserPromptSubmit', 'UserPromptExpansion', 'PostToolUse', 'PreCompact', 'SessionEnd'];
    const hasHook = (eventName) =>
      Array.isArray(settings.hooks && settings.hooks[eventName]) &&
      settings.hooks[eventName].some((entry) =>
        entry &&
        Array.isArray(entry.hooks) &&
        entry.hooks.some((hook) =>
          hook &&
          typeof hook.command === 'string' &&
          hook.command.includes('memory-mason')
        )
      );
    process.exit(requiredEvents.every(hasHook) ? 0 : 1);
  " >/dev/null 2>&1
}

copy_or_download_file() {
  local relative_path="$1"
  local destination_path="$2"

  mkdir -p "$(dirname "$destination_path")"

  if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/$relative_path" ]; then
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

CONFIG_PRESENT=0
if [ -f "$GLOBAL_CONFIG_PATH" ]; then
  CONFIG_PRESENT=1
fi

ALL_FILES_PRESENT=0
if all_files_present; then
  ALL_FILES_PRESENT=1
fi

HOOKS_WIRED=0
if [ "$ALL_FILES_PRESENT" -eq 1 ] && hooks_wired; then
  HOOKS_WIRED=1
fi

if [ "$FORCE" -eq 0 ] && [ "$ALL_FILES_PRESENT" -eq 1 ] && [ "$HOOKS_WIRED" -eq 1 ] && [ "$CONFIG_PRESENT" -eq 1 ]; then
  echo "Memory Mason hooks already installed in $HOOKS_DIR"
  echo "Global config already exists at ~/.memory-mason/config.json"
  echo "  Re-run with --force to overwrite: bash hooks/install.sh --force"
  echo ""
  echo "Nothing to do. Hooks are already in place."
  exit 0
fi

if [ "$FORCE" -eq 1 ]; then
  echo "Reinstalling Memory Mason hooks (--force)..."
  if [ -d "$HOOKS_DIR" ]; then
    rm -rf "$HOOKS_DIR"
  fi
else
  echo "Installing Memory Mason hooks..."
fi

mkdir -p "$HOOKS_DIR"
mkdir -p "$HOOKS_DIR/lib"

for runtime_file in "${HOOK_RUNTIME_FILES[@]}"; do
  copy_or_download_file "$runtime_file" "$HOOKS_DIR/$runtime_file"
done

for lib_file in "${LIB_FILES[@]}"; do
  copy_or_download_file "lib/$lib_file" "$HOOKS_DIR/lib/$lib_file"
done

cat > "$HOOKS_DIR/package.json" <<'JSON'
{
  "type": "commonjs"
}
JSON
echo "  Installed: $HOOKS_DIR/package.json"

if [ -f "$GLOBAL_CONFIG_PATH" ]; then
  echo "Global config already exists at ~/.memory-mason/config.json"
else
  if [ ! -t 0 ]; then
    echo "ERROR: Global config missing at ~/.memory-mason/config.json and no interactive terminal is available."
    echo "       Create ~/.memory-mason/config.json manually and re-run this script."
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
    if (!vaultPath) {
      throw new Error('vaultPath is required');
    }
    if (!subfolder) {
      throw new Error('subfolder is required');
    }
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    const config = { vaultPath, subfolder };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  "

  echo "Created global config at $GLOBAL_CONFIG_PATH"
fi

if [ ! -d "$CLAUDE_DIR" ]; then
  mkdir -p "$CLAUDE_DIR"
fi

if [ ! -f "$SETTINGS" ]; then
  echo '{}' > "$SETTINGS"
fi

cp "$SETTINGS" "$SETTINGS.bak"

MEMORY_MASON_SETTINGS="$SETTINGS" MEMORY_MASON_HOOKS_DIR="$HOOKS_DIR" node -e "
  const fs = require('fs');
  const settingsPath = process.env.MEMORY_MASON_SETTINGS;
  const hooksDir = process.env.MEMORY_MASON_HOOKS_DIR;
  const rawSettings = fs.readFileSync(settingsPath, 'utf8').replace(/^\\uFEFF/, '');
  const parsed = JSON.parse(rawSettings);
  const baseSettings = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  const existingHooks =
    baseSettings.hooks && typeof baseSettings.hooks === 'object' && !Array.isArray(baseSettings.hooks)
      ? baseSettings.hooks
      : {};

  const definitions = [
    { eventName: 'SessionStart', fileName: 'session-start.js', timeout: 10 },
    { eventName: 'UserPromptSubmit', fileName: 'user-prompt-submit.js', timeout: 5 },
    { eventName: 'UserPromptExpansion', fileName: 'user-prompt-submit.js', timeout: 5 },
    { eventName: 'PostToolUse', fileName: 'post-tool-use.js', timeout: 5 },
    { eventName: 'PreCompact', fileName: 'pre-compact.js', timeout: 15 },
    { eventName: 'SessionEnd', fileName: 'session-end.js', timeout: 15 }
  ];

  const hasMemoryMasonHook = (entries) =>
    Array.isArray(entries) &&
    entries.some((entry) =>
      entry &&
      Array.isArray(entry.hooks) &&
      entry.hooks.some((hook) =>
        hook &&
        typeof hook.command === 'string' &&
        hook.command.includes('memory-mason')
      )
    );

  const nextHooks = definitions.reduce((accumulator, definition) => {
    const currentEntries = Array.isArray(existingHooks[definition.eventName]) ? existingHooks[definition.eventName] : [];
    if (hasMemoryMasonHook(currentEntries)) {
      return {
        ...accumulator,
        [definition.eventName]: currentEntries
      };
    }

    const command = 'node "' + hooksDir + '/' + definition.fileName + '"';
    const entry = {
      hooks: [
        {
          type: 'command',
          command,
          timeout: definition.timeout
        }
      ]
    };

    return {
      ...accumulator,
      [definition.eventName]: [...currentEntries, entry]
    };
  }, existingHooks);

  const nextSettings = {
    ...baseSettings,
    hooks: nextHooks
  };

  fs.writeFileSync(settingsPath, JSON.stringify(nextSettings, null, 2) + '\n');
  console.log('  Hooks wired in settings.json');
"

echo ""
echo "Done! Restart Claude Code to activate."
echo ""
echo "What's installed:"
echo "  - SessionStart hook: restores knowledge base context every session"
echo "  - UserPromptSubmit hook: captures every prompt to daily log"
echo "  - UserPromptExpansion hook: captures slash-command metadata before expansion"
echo "  - PostToolUse hook: captures tool results to daily log"
echo "  - PreCompact hook: saves conversation transcript before compaction"
echo "  - SessionEnd hook: saves conversation transcript at session end"
echo "  - Global config: ~/.memory-mason/config.json"
echo ""
echo "Config file path: $GLOBAL_CONFIG_PATH"