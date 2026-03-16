param(
    [string]$PythonExe = "python",
    [switch]$Clean
)

$ErrorActionPreference = "Stop"
$env:PYTHONNOUSERSITE = "1"

function Invoke-Step {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Label,
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    & $PythonExe @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Label failed with exit code $LASTEXITCODE"
    }
}

$root = Resolve-Path (Join-Path $PSScriptRoot "..\\..")
$specPath = Join-Path $PSScriptRoot "zotero-mcp-helper.spec"

Push-Location $root
try {
    Invoke-Step -Label "pip upgrade" -Arguments @("-m", "pip", "install", "--upgrade", "pip")
    Invoke-Step -Label "packaging backend install" -Arguments @(
        "-m",
        "pip",
        "install",
        "hatchling",
        "editables"
    )
    Invoke-Step -Label "build dependencies install" -Arguments @(
        "-m",
        "pip",
        "install",
        "--no-build-isolation",
        "-e",
        ".[build,semantic]"
    )

    $args = @("-m", "PyInstaller", "--noconfirm")
    if ($Clean) {
        $args += "--clean"
    }
    $args += $specPath

    Invoke-Step -Label "PyInstaller build" -Arguments $args

    Write-Host ""
    Write-Host "Build completed."
    Write-Host "Output directory: $(Join-Path $root 'dist\\zotero-mcp')"
}
finally {
    Pop-Location
}
