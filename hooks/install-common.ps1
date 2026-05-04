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
