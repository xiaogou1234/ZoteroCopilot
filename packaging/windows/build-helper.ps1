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
$specPath = Join-Path $root "packaging\\helper\\zotero-mcp-helper.spec"
$versionFile = Join-Path $root "src\\zotero_mcp\\_version.py"
$versionLine = Select-String -Path $versionFile -Pattern '__version__\s*=\s*"([^"]+)"' | Select-Object -First 1
if (-not $versionLine) {
    throw "Could not read version from $versionFile"
}
$version = $versionLine.Matches[0].Groups[1].Value
$productName = "zotero_copilot_${version}_helper_windows_x64"

Push-Location $root
try {
    $env:PYINSTALLER_PRODUCT_NAME = $productName

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
        ".[build]"
    )

    $args = @("-m", "PyInstaller", "--noconfirm")
    if ($Clean) {
        $args += "--clean"
    }
    $args += $specPath

    Invoke-Step -Label "PyInstaller build" -Arguments $args
    Invoke-Step -Label "Release archive build" -Arguments @(
        (Join-Path $root "packaging\\helper\\build_release.py"),
        "--platform",
        "windows",
        "--source-dir",
        (Join-Path $root ("dist\\" + $productName)),
        "--output-dir",
        (Join-Path $root "dist\\releases")
    )

    Write-Host ""
    Write-Host "Build completed."
    Write-Host "Output directory: $(Join-Path $root ("dist\\" + $productName))"
    Write-Host "Release archive: $(Join-Path $root ("dist\\releases\\" + $productName + ".zip"))"
}
finally {
    Pop-Location
}
