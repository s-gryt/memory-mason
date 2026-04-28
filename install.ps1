param(
    [string]$Agent,
    [switch]$Force,
    [string]$Workspace
)

$ErrorActionPreference = "Stop"
$RepoUrl = "https://raw.githubusercontent.com/s-gryt/memory-mason/main"

function Show-Usage {
    Write-Host "Usage: powershell -File install.ps1 [-Agent claude|copilot|codex|all] [-Force] [-Workspace <path>]"
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: 'node' is required to install Memory Mason hooks." -ForegroundColor Red
    Write-Host "       Install Node.js from https://nodejs.org and re-run this script." -ForegroundColor Red
    exit 1
}

$ScriptDir = if ($PSScriptRoot -and (Test-Path -LiteralPath $PSScriptRoot)) { $PSScriptRoot } else { $null }

function Invoke-InstallerScript {
    param(
        [string]$RelativePath,
        [hashtable]$ScriptArgs
    )

    $effectiveArgs = if ($ScriptArgs) { $ScriptArgs } else { @{} }
    $localScriptPath = if ($ScriptDir) { Join-Path $ScriptDir $RelativePath } else { $null }

    if ($localScriptPath -and (Test-Path -LiteralPath $localScriptPath)) {
        & $localScriptPath @effectiveArgs
        return
    }

    $scriptContent = (Invoke-WebRequest -Uri "$RepoUrl/$RelativePath" -UseBasicParsing).Content
    & ([scriptblock]::Create($scriptContent)) @effectiveArgs
}

if ([string]::IsNullOrWhiteSpace($Agent)) {
    if (-not [string]::IsNullOrWhiteSpace($env:CLAUDE_CONFIG_DIR) -or -not [string]::IsNullOrWhiteSpace($env:CLAUDE_PLUGIN_ROOT)) {
        $Agent = "claude"
        Write-Host "Detected Claude Code environment."
    } else {
        if (-not [Environment]::UserInteractive) {
            Write-Host "ERROR: no -Agent provided and no interactive terminal available." -ForegroundColor Red
            Write-Host "       Re-run with -Agent claude|copilot|codex|all" -ForegroundColor Red
            exit 1
        }

        Write-Host "Which agent?"
        Write-Host "  (1) Claude Code"
        Write-Host "  (2) GitHub Copilot"
        Write-Host "  (3) Codex"
        Write-Host "  (4) All"
        $selection = Read-Host "Select 1-4"

        switch ($selection) {
            "1" { $Agent = "claude" }
            "2" { $Agent = "copilot" }
            "3" { $Agent = "codex" }
            "4" { $Agent = "all" }
            default {
                Write-Host "ERROR: invalid selection: $selection" -ForegroundColor Red
                exit 1
            }
        }
    }
}

$Agent = $Agent.ToLowerInvariant()

if ($Agent -notin @("claude", "copilot", "codex", "all")) {
    Write-Host "ERROR: unsupported agent: $Agent" -ForegroundColor Red
    Show-Usage
    exit 1
}

$ClaudeArgs = @{}
$CopilotArgs = @{}
$CodexArgs = @{}

if ($Force) {
    $ClaudeArgs.Force = $true
    $CopilotArgs.Force = $true
    $CodexArgs.Force = $true
}

if (-not [string]::IsNullOrWhiteSpace($Workspace)) {
    $resolvedWorkspace = [System.IO.Path]::GetFullPath($Workspace)
    $CopilotArgs.Workspace = $resolvedWorkspace
    $CodexArgs.Workspace = $resolvedWorkspace
}

$installed = @()

if ($Agent -eq "claude" -or $Agent -eq "all") {
    Invoke-InstallerScript -RelativePath "hooks/install.ps1" -ScriptArgs $ClaudeArgs
    $installed += "Claude Code"
}

if ($Agent -eq "copilot" -or $Agent -eq "all") {
    Invoke-InstallerScript -RelativePath "hooks/install-copilot-hooks.ps1" -ScriptArgs $CopilotArgs
    $installed += "GitHub Copilot"
}

if ($Agent -eq "codex" -or $Agent -eq "all") {
    Invoke-InstallerScript -RelativePath "hooks/install-codex-hooks.ps1" -ScriptArgs $CodexArgs
    $installed += "Codex"
}

Write-Host ""
Write-Host "Install summary:"
foreach ($item in $installed) {
    Write-Host "  - $item"
}
