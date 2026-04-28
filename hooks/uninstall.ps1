# Memory Mason - uninstaller for Claude Code hooks
# Usage: powershell -ExecutionPolicy Bypass -File hooks\uninstall.ps1
#   or:  powershell -ExecutionPolicy Bypass -File hooks\uninstall.ps1 -Purge
param(
    [switch]$Purge
)

$ErrorActionPreference = "Stop"

$ClaudeDir = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $env:USERPROFILE ".claude" }
$HooksDir = Join-Path (Join-Path $ClaudeDir "hooks") "memory-mason"
$Settings = Join-Path $ClaudeDir "settings.json"
$GlobalConfigDir = Join-Path $env:USERPROFILE ".memory-mason"
$GlobalConfigPath = Join-Path $GlobalConfigDir "config.json"

Write-Host "Uninstalling Memory Mason Claude Code hooks..."

if (Test-Path $HooksDir) {
    Remove-Item $HooksDir -Recurse -Force
    Write-Host "  Removed: $HooksDir"
} else {
    Write-Host "  No hook directory found at $HooksDir"
}

if (Test-Path $Settings) {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        Write-Host "WARNING: 'node' not found - cannot safely edit settings.json." -ForegroundColor Yellow
        Write-Host "         Remove Memory Mason hook entries from $Settings manually."
    } else {
        Copy-Item $Settings "$Settings.bak" -Force
        $env:MEMORY_MASON_SETTINGS = $Settings -replace '\\', '/'

        $settingsScript = @'
const fs = require('fs');
const settingsPath = process.env.MEMORY_MASON_SETTINGS;
        const rawSettings = fs.readFileSync(settingsPath, 'utf8').replace(/^\uFEFF/, '');
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
'@

  $settingsScript | node -
        Remove-Item Env:\MEMORY_MASON_SETTINGS -ErrorAction SilentlyContinue
    }
} else {
    Write-Host "  No settings.json found at $Settings"
}

if ($Purge) {
    if (Test-Path $GlobalConfigPath) {
        Remove-Item $GlobalConfigPath -Force
        Write-Host "  Removed: $GlobalConfigPath"
    } else {
        Write-Host "  No global config file found at $GlobalConfigPath"
    }

    if (Test-Path $GlobalConfigDir) {
        try {
            Remove-Item $GlobalConfigDir -Force
        } catch {
        }
    }
} else {
    if (Test-Path $GlobalConfigPath) {
        Write-Host "  Global config preserved at ~/.memory-mason/config.json"
        Write-Host "  Re-run with -Purge to remove it."
    }
}

Write-Host ""
Write-Host "Done! Restart Claude Code to complete uninstall." -ForegroundColor Green