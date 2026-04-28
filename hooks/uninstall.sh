#!/usr/bin/env bash
# Memory Mason - uninstaller for Claude Code hooks
# Usage: bash hooks/uninstall.sh
#   or:  bash hooks/uninstall.sh --purge
set -e

PURGE=0
for arg in "$@"; do
  case "$arg" in
    --purge|-p) PURGE=1 ;;
  esac
done

CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
HOOKS_DIR="$CLAUDE_DIR/hooks/memory-mason"
SETTINGS="$CLAUDE_DIR/settings.json"
GLOBAL_CONFIG_DIR="$HOME/.memory-mason"
GLOBAL_CONFIG_PATH="$GLOBAL_CONFIG_DIR/config.json"

echo "Uninstalling Memory Mason Claude Code hooks..."

if [ -d "$HOOKS_DIR" ]; then
  rm -rf "$HOOKS_DIR"
  echo "  Removed: $HOOKS_DIR"
else
  echo "  No hook directory found at $HOOKS_DIR"
fi

if [ -f "$SETTINGS" ]; then
  if ! command -v node >/dev/null 2>&1; then
    echo "WARNING: 'node' not found - cannot safely edit settings.json."
    echo "         Remove Memory Mason hook entries from $SETTINGS manually."
  else
    cp "$SETTINGS" "$SETTINGS.bak"

    MEMORY_MASON_SETTINGS="$SETTINGS" node -e "
      const fs = require('fs');
      const settingsPath = process.env.MEMORY_MASON_SETTINGS;
      const rawSettings = fs.readFileSync(settingsPath, 'utf8').replace(/^\\uFEFF/, '');
      const parsed = JSON.parse(rawSettings);
      const baseSettings = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
      const existingHooks =
        baseSettings.hooks && typeof baseSettings.hooks === 'object' && !Array.isArray(baseSettings.hooks)
          ? baseSettings.hooks
          : {};

      const isMemoryMasonEntry = (entry) =>
        entry &&
        Array.isArray(entry.hooks) &&
        entry.hooks.some((hook) =>
          hook &&
          typeof hook.command === 'string' &&
          hook.command.includes('memory-mason')
        );

      const nextHooks = Object.keys(existingHooks).reduce((accumulator, eventName) => {
        const currentEntries = Array.isArray(existingHooks[eventName]) ? existingHooks[eventName] : [];
        const filteredEntries = currentEntries.filter((entry) => !isMemoryMasonEntry(entry));
        if (filteredEntries.length === 0) {
          return accumulator;
        }
        return {
          ...accumulator,
          [eventName]: filteredEntries
        };
      }, {});

      const nextSettings =
        Object.keys(nextHooks).length === 0
          ? (() => {
              const withoutHooks = { ...baseSettings };
              delete withoutHooks.hooks;
              return withoutHooks;
            })()
          : {
              ...baseSettings,
              hooks: nextHooks
            };

      fs.writeFileSync(settingsPath, JSON.stringify(nextSettings, null, 2) + '\n');
      console.log('  Removed Memory Mason hook entries from settings.json');
    "
  fi
else
  echo "  No settings.json found at $SETTINGS"
fi

if [ "$PURGE" -eq 1 ]; then
  if [ -f "$GLOBAL_CONFIG_PATH" ]; then
    rm "$GLOBAL_CONFIG_PATH"
    echo "  Removed: $GLOBAL_CONFIG_PATH"
  else
    echo "  No global config file found at $GLOBAL_CONFIG_PATH"
  fi

  if [ -d "$GLOBAL_CONFIG_DIR" ]; then
    rmdir "$GLOBAL_CONFIG_DIR" 2>/dev/null || true
  fi
else
  if [ -f "$GLOBAL_CONFIG_PATH" ]; then
    echo "  Global config preserved at ~/.memory-mason/config.json"
    echo "  Re-run with --purge to remove it."
  fi
fi

echo ""
echo "Done! Restart Claude Code to complete uninstall."