param(
    [string]$Workspace,
    [switch]$Force
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: 'node' is required to install Memory Mason Codex hooks." -ForegroundColor Red
    Write-Host "       Install Node.js from https://nodejs.org and re-run this script." -ForegroundColor Red
    exit 1
}

$CodexDir = if ($env:CODEX_CONFIG_DIR) { $env:CODEX_CONFIG_DIR } else { Join-Path $HOME ".codex" }
$HooksDir = Join-Path (Join-Path $CodexDir "hooks") "memory-mason"
$WorkspaceRoot = if ([string]::IsNullOrWhiteSpace($Workspace)) { (Get-Location).Path } else { [System.IO.Path]::GetFullPath($Workspace) }
$WorkspaceCodexDir = Join-Path $WorkspaceRoot ".codex"
$WorkspaceHooksPath = Join-Path $WorkspaceCodexDir "hooks.json"
$WorkspaceConfigPath = Join-Path $WorkspaceCodexDir "config.toml"
$GlobalConfigDir = Join-Path $HOME ".memory-mason"
$GlobalConfigPath = Join-Path $GlobalConfigDir "config.json"
$RepoUrl = "https://raw.githubusercontent.com/s-gryt/memory-mason/main/hooks"

$HookRuntimeFiles = @("session-start.js", "user-prompt-submit.js", "post-tool-use.js", "pre-compact.js", "session-end.js")
$LibFiles = @("config.js", "writer.js", "vault.js", "prompt.js", "transcript.js", "capture-state.js")

if (-not (Test-Path -LiteralPath $WorkspaceRoot -PathType Container)) {
    Write-Host "ERROR: workspace directory does not exist: $WorkspaceRoot" -ForegroundColor Red
    exit 1
}

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

function Test-LocalSourcesAvailable {
    if ([string]::IsNullOrWhiteSpace($ScriptDir)) {
        return $false
    }

    foreach ($runtimeFile in $HookRuntimeFiles) {
        if (-not (Test-Path -LiteralPath (Join-Path $ScriptDir $runtimeFile))) {
            return $false
        }
    }

    foreach ($libFile in $LibFiles) {
        if (-not (Test-Path -LiteralPath (Join-Path (Join-Path $ScriptDir "lib") $libFile))) {
            return $false
        }
    }

    return $true
}

function Test-RuntimeFilesPresent {
    foreach ($runtimeFile in $HookRuntimeFiles) {
        if (-not (Test-Path -LiteralPath (Join-Path $HooksDir $runtimeFile))) {
            return $false
        }
    }

    foreach ($libFile in $LibFiles) {
        if (-not (Test-Path -LiteralPath (Join-Path (Join-Path $HooksDir "lib") $libFile))) {
            return $false
        }
    }

    if (-not (Test-Path -LiteralPath (Join-Path $HooksDir "package.json"))) {
        return $false
    }

    return $true
}

function Test-WorkspaceFilesPresent {
    if (-not (Test-Path -LiteralPath $WorkspaceHooksPath)) {
        return $false
    }

    if (-not (Test-Path -LiteralPath $WorkspaceConfigPath)) {
        return $false
    }

    return [bool](Select-String -Path $WorkspaceConfigPath -Pattern '^\s*codex_hooks\s*=\s*true\s*$' -Quiet)
}

function Copy-OrDownloadFile {
    param(
        [string]$RelativePath,
        [string]$DestinationPath,
        [string]$SourceMode
    )

    $destinationDir = Split-Path -Path $DestinationPath -Parent
    if (-not (Test-Path -LiteralPath $destinationDir)) {
        New-Item -ItemType Directory -Path $destinationDir -Force | Out-Null
    }

    if ($SourceMode -eq "local") {
        Copy-Item -LiteralPath (Join-Path $ScriptDir $RelativePath) -Destination $DestinationPath -Force
    } else {
        Invoke-WebRequest -Uri "$RepoUrl/$RelativePath" -OutFile $DestinationPath -UseBasicParsing
    }

    Write-Host "  Installed: $DestinationPath"
}

$SourceMode = if (Test-LocalSourcesAvailable) { "local" } else { "remote" }
$RuntimePresent = Test-RuntimeFilesPresent
$WorkspacePresent = Test-WorkspaceFilesPresent
$ConfigPresent = Test-Path -LiteralPath $GlobalConfigPath

if (-not $Force -and $RuntimePresent -and $WorkspacePresent -and $ConfigPresent) {
    Write-Host "Memory Mason Codex hooks already installed."
    Write-Host "  Hook runtime: $HooksDir"
    Write-Host "  Workspace config: $WorkspaceCodexDir"
    Write-Host "  Global config: $GlobalConfigPath"
    Write-Host "  Re-run with -Force to reinstall."
    exit 0
}

if ($Force) {
    Write-Host "Reinstalling Memory Mason Codex hooks (-Force)..."
    if (Test-Path -LiteralPath $HooksDir) {
        Remove-Item -LiteralPath $HooksDir -Recurse -Force
    }
} else {
    Write-Host "Installing Memory Mason Codex hooks..."
}

Write-Host "Source mode: $SourceMode"

if (-not (Test-Path -LiteralPath $HooksDir)) {
    New-Item -ItemType Directory -Path $HooksDir -Force | Out-Null
}
if (-not (Test-Path -LiteralPath (Join-Path $HooksDir "lib"))) {
    New-Item -ItemType Directory -Path (Join-Path $HooksDir "lib") -Force | Out-Null
}

foreach ($runtimeFile in $HookRuntimeFiles) {
    Copy-OrDownloadFile -RelativePath $runtimeFile -DestinationPath (Join-Path $HooksDir $runtimeFile) -SourceMode $SourceMode
}

foreach ($libFile in $LibFiles) {
    Copy-OrDownloadFile -RelativePath "lib/$libFile" -DestinationPath (Join-Path (Join-Path $HooksDir "lib") $libFile) -SourceMode $SourceMode
}

$packageJson = @'
{
  "type": "commonjs"
}
'@
Set-Content -Path (Join-Path $HooksDir "package.json") -Value $packageJson -Encoding utf8
Write-Host "  Installed: $(Join-Path $HooksDir "package.json")"

if (Test-Path -LiteralPath $GlobalConfigPath) {
    Write-Host "Global config already exists at $GlobalConfigPath"
} else {
    if (-not [Environment]::UserInteractive) {
        Write-Host "ERROR: Global config missing at $GlobalConfigPath and no interactive terminal is available." -ForegroundColor Red
        Write-Host "       Create the config file manually and re-run this script." -ForegroundColor Red
        exit 1
    }

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

    $env:MEMORY_MASON_GLOBAL_CONFIG = $GlobalConfigPath -replace '\\', '/'
    $env:MEMORY_MASON_VAULT_PATH_INPUT = $vaultPath
    $env:MEMORY_MASON_SUBFOLDER_INPUT = $subfolder

    $globalConfigScript = @'
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
fs.writeFileSync(configPath, JSON.stringify({ vaultPath, subfolder }, null, 2) + '\n');
'@

    $globalConfigScript | node -

    Remove-Item Env:\MEMORY_MASON_GLOBAL_CONFIG -ErrorAction SilentlyContinue
    Remove-Item Env:\MEMORY_MASON_VAULT_PATH_INPUT -ErrorAction SilentlyContinue
    Remove-Item Env:\MEMORY_MASON_SUBFOLDER_INPUT -ErrorAction SilentlyContinue

    Write-Host "Created global config at $GlobalConfigPath"
}

$env:MEMORY_MASON_WORKSPACE_HOOKS_FILE = $WorkspaceHooksPath -replace '\\', '/'
$env:MEMORY_MASON_HOOKS_DIR = $HooksDir -replace '\\', '/'

$workspaceHooksScript = @'
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

const normalizedHooksDir = hooksDir.replace(/\\/g, '/');
const commandFor = (fileName) => 'node "' + normalizedHooksDir + '/' + fileName + '"';
const payload = {
  hooks: {
    SessionStart: [{ hooks: [{ type: 'command', command: commandFor('session-start.js'), timeout: 10 }] }],
    UserPromptSubmit: [{ hooks: [{ type: 'command', command: commandFor('user-prompt-submit.js'), timeout: 5 }] }],
    PostToolUse: [{ hooks: [{ type: 'command', command: commandFor('post-tool-use.js'), timeout: 5 }] }],
    Stop: [{ hooks: [{ type: 'command', command: commandFor('session-end.js'), timeout: 15 }] }]
  }
};

fs.mkdirSync(path.dirname(hooksFile), { recursive: true });
fs.writeFileSync(hooksFile, JSON.stringify(payload, null, 2) + '\n');
'@

$workspaceHooksScript | node -

Remove-Item Env:\MEMORY_MASON_WORKSPACE_HOOKS_FILE -ErrorAction SilentlyContinue
Remove-Item Env:\MEMORY_MASON_HOOKS_DIR -ErrorAction SilentlyContinue

Write-Host "  Installed: $WorkspaceHooksPath"

$env:MEMORY_MASON_CODEX_CONFIG_FILE = $WorkspaceConfigPath -replace '\\', '/'

$workspaceConfigScript = @'
const fs = require('fs');
const path = require('path');
const configFile = process.env.MEMORY_MASON_CODEX_CONFIG_FILE;
if (!configFile) {
  throw new Error('configFile is required');
}

const current = fs.existsSync(configFile) ? fs.readFileSync(configFile, 'utf8') : '';
let next = current;

if (/^\s*codex_hooks\s*=.*$/m.test(next)) {
  next = next.replace(/^\s*codex_hooks\s*=.*$/m, 'codex_hooks = true');
} else {
  const trimmed = next.trimEnd();
  next = trimmed === '' ? 'codex_hooks = true\n' : trimmed + '\n\ncodex_hooks = true\n';
}

fs.mkdirSync(path.dirname(configFile), { recursive: true });
fs.writeFileSync(configFile, next);
'@

$workspaceConfigScript | node -

Remove-Item Env:\MEMORY_MASON_CODEX_CONFIG_FILE -ErrorAction SilentlyContinue

Write-Host "  Updated: $WorkspaceConfigPath"
Write-Host ""
Write-Host "Done!"
Write-Host "  Hook runtime: $HooksDir"
Write-Host "  Workspace config: $WorkspaceCodexDir"
Write-Host "  Global config: $GlobalConfigPath"
