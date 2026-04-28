# Memory Mason - one-command hook installer for Claude Code
# Usage: powershell -ExecutionPolicy Bypass -File hooks\install.ps1
#   or:  powershell -ExecutionPolicy Bypass -File hooks\install.ps1 -Force
#   or:  irm https://raw.githubusercontent.com/s-gryt/memory-mason/main/hooks/install.ps1 | iex
param(
    [switch]$Force
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: 'node' is required to install Memory Mason Claude Code hooks." -ForegroundColor Red
    Write-Host "       Install Node.js from https://nodejs.org and re-run this script." -ForegroundColor Red
    exit 1
}

$ClaudeDir = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $env:USERPROFILE ".claude" }
$HooksDir = Join-Path (Join-Path $ClaudeDir "hooks") "memory-mason"
$Settings = Join-Path $ClaudeDir "settings.json"
$GlobalConfigDir = Join-Path $env:USERPROFILE ".memory-mason"
$GlobalConfigPath = Join-Path $GlobalConfigDir "config.json"
$RepoUrl = "https://raw.githubusercontent.com/s-gryt/memory-mason/main/hooks"

$HookRuntimeFiles = @("session-start.js", "user-prompt-submit.js", "post-tool-use.js", "pre-compact.js", "session-end.js")
$LibFiles = @("config.js", "writer.js", "vault.js", "prompt.js", "transcript.js", "capture-state.js")

$ScriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { $null }

function Test-AbsolutePath {
    param(
        [string]$PathValue
    )

    if ([string]::IsNullOrWhiteSpace($PathValue)) {
        return $false
    }

    return [System.IO.Path]::IsPathRooted($PathValue)
}

function Test-AllFilesPresent {
    foreach ($runtimeFile in $HookRuntimeFiles) {
        if (-not (Test-Path (Join-Path $HooksDir $runtimeFile))) {
            return $false
        }
    }

    foreach ($libFile in $LibFiles) {
        if (-not (Test-Path (Join-Path (Join-Path $HooksDir "lib") $libFile))) {
            return $false
        }
    }

    if (-not (Test-Path (Join-Path $HooksDir "package.json"))) {
        return $false
    }

    return $true
}

function Test-HooksWired {
    if (-not (Test-Path $Settings)) {
        return $false
    }

    $env:MEMORY_MASON_SETTINGS = $Settings -replace '\\', '/'
    $hookCheckScript = @'
const fs = require('fs');
const settingsPath = process.env.MEMORY_MASON_SETTINGS;
const rawSettings = fs.readFileSync(settingsPath, 'utf8').replace(/^\uFEFF/, '');
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
'@
    $hookCheckScript | node - *> $null
    $result = $LASTEXITCODE -eq 0
    Remove-Item Env:\MEMORY_MASON_SETTINGS -ErrorAction SilentlyContinue
    return $result
}

function Copy-OrDownloadFile {
    param(
        [string]$RelativePath,
        [string]$DestinationPath
    )

    $destinationDir = Split-Path $DestinationPath -Parent
    if (-not (Test-Path $destinationDir)) {
        New-Item -ItemType Directory -Path $destinationDir -Force | Out-Null
    }

    $localSource = if ($ScriptDir) { Join-Path $ScriptDir $RelativePath } else { $null }

    if ($localSource -and (Test-Path $localSource)) {
        Copy-Item $localSource $DestinationPath -Force
    } else {
        Invoke-WebRequest -Uri "$RepoUrl/$RelativePath" -OutFile $DestinationPath -UseBasicParsing
    }

    Write-Host "  Installed: $DestinationPath"
}

$AllFilesPresent = Test-AllFilesPresent
$HooksWired = if ($AllFilesPresent) { Test-HooksWired } else { $false }
$ConfigPresent = Test-Path $GlobalConfigPath

if (-not $Force -and $AllFilesPresent -and $HooksWired -and $ConfigPresent) {
    Write-Host "Memory Mason hooks already installed in $HooksDir"
    Write-Host "Global config already exists at ~/.memory-mason/config.json"
    Write-Host "  Re-run with -Force to overwrite: powershell -ExecutionPolicy Bypass -File hooks\install.ps1 -Force"
    Write-Host ""
    Write-Host "Nothing to do. Hooks are already in place."
    exit 0
}

if ($Force) {
    Write-Host "Reinstalling Memory Mason hooks (-Force)..."
    if (Test-Path $HooksDir) {
        Remove-Item $HooksDir -Recurse -Force
    }
} else {
    Write-Host "Installing Memory Mason hooks..."
}

if (-not (Test-Path $HooksDir)) {
    New-Item -ItemType Directory -Path $HooksDir -Force | Out-Null
}

if (-not (Test-Path (Join-Path $HooksDir "lib"))) {
    New-Item -ItemType Directory -Path (Join-Path $HooksDir "lib") -Force | Out-Null
}

foreach ($runtimeFile in $HookRuntimeFiles) {
    Copy-OrDownloadFile -RelativePath $runtimeFile -DestinationPath (Join-Path $HooksDir $runtimeFile)
}

foreach ($libFile in $LibFiles) {
    Copy-OrDownloadFile -RelativePath "lib/$libFile" -DestinationPath (Join-Path (Join-Path $HooksDir "lib") $libFile)
}

$packageJson = @'
{
  "type": "commonjs"
}
'@
Set-Content -Path (Join-Path $HooksDir "package.json") -Value $packageJson -Encoding utf8
Write-Host "  Installed: $(Join-Path $HooksDir "package.json")"

if (Test-Path $GlobalConfigPath) {
    Write-Host "Global config already exists at ~/.memory-mason/config.json"
} else {
    $vaultPath = ""
    while ([string]::IsNullOrWhiteSpace($vaultPath)) {
        $vaultPathInput = Read-Host "Enter your Obsidian vault absolute path"
        if (-not (Test-AbsolutePath $vaultPathInput)) {
            Write-Host "Please provide an absolute path." -ForegroundColor Yellow
            continue
        }
        $vaultPath = $vaultPathInput
    }

    $subfolderInput = Read-Host "Enter subfolder name [memory-mason]"
    $subfolder = if ([string]::IsNullOrWhiteSpace($subfolderInput)) { "memory-mason" } else { $subfolderInput.Trim() }

    if (-not (Test-Path $GlobalConfigDir)) {
        New-Item -ItemType Directory -Path $GlobalConfigDir -Force | Out-Null
    }

    $env:MEMORY_MASON_GLOBAL_CONFIG = $GlobalConfigPath -replace '\\', '/'
    $env:MEMORY_MASON_VAULT_PATH_INPUT = $vaultPath
    $env:MEMORY_MASON_SUBFOLDER_INPUT = $subfolder

    $globalConfigScript = @'
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
'@

  $globalConfigScript | node -

    Remove-Item Env:\MEMORY_MASON_GLOBAL_CONFIG -ErrorAction SilentlyContinue
    Remove-Item Env:\MEMORY_MASON_VAULT_PATH_INPUT -ErrorAction SilentlyContinue
    Remove-Item Env:\MEMORY_MASON_SUBFOLDER_INPUT -ErrorAction SilentlyContinue

    Write-Host "Created global config at $GlobalConfigPath"
}

if (-not (Test-Path $ClaudeDir)) {
    New-Item -ItemType Directory -Path $ClaudeDir -Force | Out-Null
}

if (-not (Test-Path $Settings)) {
    Set-Content -Path $Settings -Value "{}" -Encoding utf8
}

Copy-Item $Settings "$Settings.bak" -Force

$env:MEMORY_MASON_SETTINGS = $Settings -replace '\\', '/'
$env:MEMORY_MASON_HOOKS_DIR = $HooksDir -replace '\\', '/'

$settingsScript = @'
const fs = require('fs');
const settingsPath = process.env.MEMORY_MASON_SETTINGS;
const hooksDir = process.env.MEMORY_MASON_HOOKS_DIR;
const rawSettings = fs.readFileSync(settingsPath, 'utf8').replace(/^\uFEFF/, '');
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
'@

$settingsScript | node -

Remove-Item Env:\MEMORY_MASON_SETTINGS -ErrorAction SilentlyContinue
Remove-Item Env:\MEMORY_MASON_HOOKS_DIR -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "Done! Restart Claude Code to activate." -ForegroundColor Green
Write-Host ""
Write-Host "What's installed:"
Write-Host "  - SessionStart hook: restores knowledge base context every session"
Write-Host "  - UserPromptSubmit hook: captures every prompt to daily log"
Write-Host "  - UserPromptExpansion hook: captures slash-command metadata before expansion"
Write-Host "  - PostToolUse hook: captures tool results to daily log"
Write-Host "  - PreCompact hook: saves conversation transcript before compaction"
Write-Host "  - SessionEnd hook: saves conversation transcript at session end"
Write-Host "  - Global config: ~/.memory-mason/config.json"
Write-Host ""
Write-Host "Config file path: $GlobalConfigPath"