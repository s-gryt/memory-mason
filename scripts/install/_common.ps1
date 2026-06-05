function Test-AbsolutePath {
    param(
        [string]$PathValue
    )

    if ([string]::IsNullOrWhiteSpace($PathValue)) {
        return $false
    }

    return [System.IO.Path]::IsPathRooted($PathValue)
}

$HooksSourceDir = $null
if (-not [string]::IsNullOrWhiteSpace($ScriptDir)) {
    $HooksSourceDir = [System.IO.Path]::GetFullPath((Join-Path $ScriptDir "..\..\hooks"))
}

function Test-LocalSourcesAvailable {
    if ([string]::IsNullOrWhiteSpace($HooksSourceDir)) {
        return $false
    }

    foreach ($runtimeFile in $HookRuntimeFiles) {
        if (-not (Test-Path -LiteralPath (Join-Path $HooksSourceDir $runtimeFile))) {
            return $false
        }
    }

    foreach ($libFile in $LibFiles) {
        if (-not (Test-Path -LiteralPath (Join-Path (Join-Path $HooksSourceDir "lib") $libFile))) {
            return $false
        }
    }

    return $true
}
