param()

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$runtimeRoot = Join-Path $repoRoot "gui\src-tauri\resources\python"
$runtimeSchemaVersion = "2"
$pythonVersion = "3.11.9"
$archive = Join-Path $env:TEMP "python-$pythonVersion-embed-amd64.zip"
$downloadUrl = "https://www.python.org/ftp/python/$pythonVersion/python-$pythonVersion-embed-amd64.zip"
$marker = Join-Path $runtimeRoot ".ctfbox-runtime-ready"

function Remove-PythonBytecodeCache {
    param([string]$Root)

    if (-not (Test-Path -LiteralPath $Root)) { return }

    Get-ChildItem -LiteralPath $Root -Recurse -Force -Directory -Filter "__pycache__" -ErrorAction SilentlyContinue |
        Sort-Object -Property FullName -Descending |
        ForEach-Object { Remove-Item -LiteralPath $_.FullName -Recurse -Force }

    Get-ChildItem -LiteralPath $Root -Recurse -Force -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Extension -in ".pyc", ".pyo" } |
        ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force }
}

if (Test-Path $marker) {
    $markerVersion = Get-Content -LiteralPath $marker -Raw
    if ($null -eq $markerVersion) {
        $markerVersion = ""
    } else {
        $markerVersion = $markerVersion.Trim()
    }
    if ($markerVersion -eq $runtimeSchemaVersion) {
        Remove-PythonBytecodeCache -Root $runtimeRoot
        Write-Host "Bundled Python runtime is ready: $runtimeRoot"
        exit 0
    }
}

New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null
if (-not (Test-Path $archive)) {
    Write-Host "Downloading Python $pythonVersion embedded runtime..."
    Invoke-WebRequest -Uri $downloadUrl -OutFile $archive
}

if (-not (Test-Path (Join-Path $runtimeRoot "python.exe"))) {
    Expand-Archive -LiteralPath $archive -DestinationPath $runtimeRoot -Force
}

$pth = Get-ChildItem -LiteralPath $runtimeRoot -Filter "python*._pth" | Select-Object -First 1
if (-not $pth) { throw "Python _pth configuration file was not found" }
$pthLines = @(Get-Content -LiteralPath $pth.FullName)
if (-not ($pthLines -contains "Lib\site-packages")) { $pthLines = @($pthLines[0], ".", "Lib\site-packages") + $pthLines[1..($pthLines.Count - 1)] }
if (-not ($pthLines -contains "import site")) { $pthLines += "import site" }
Set-Content -LiteralPath $pth.FullName -Value $pthLines -Encoding ascii

$python = Join-Path $runtimeRoot "python.exe"
$getPip = Join-Path $env:TEMP "ctfbox-get-pip.py"
if (-not (Test-Path (Join-Path $runtimeRoot "Lib\site-packages\pip"))) {
    Write-Host "Installing the bundled Python package manager..."
    Invoke-WebRequest -Uri "https://bootstrap.pypa.io/get-pip.py" -OutFile $getPip
    & $python -B $getPip --no-warn-script-location
    if ($LASTEXITCODE -ne 0) { throw "get-pip failed" }
}

$sitePackages = Join-Path $runtimeRoot "Lib\site-packages"
New-Item -ItemType Directory -Force -Path $sitePackages | Out-Null
Write-Host "Installing SSTImap runtime dependencies..."
& $python -B -m pip install --disable-pip-version-check --no-cache-dir --no-compile --upgrade --target $sitePackages `
    "argparse==1.4.0" "requests==2.27.1" "urllib3==1.26.9" "mechanize==0.4.8" "html5lib==1.1"
if ($LASTEXITCODE -ne 0) { throw "Python dependency installation failed" }

& $python -B -c "import requests, mechanize, html5lib"
if ($LASTEXITCODE -ne 0) { throw "Python dependency validation failed" }

$dirsearchRequirements = Join-Path $repoRoot "Original\dirsearch\requirements\runtime.txt"
if (-not (Test-Path -LiteralPath $dirsearchRequirements)) {
    throw "dirsearch runtime requirements were not found: $dirsearchRequirements"
}
$dirsearchSitePackages = Join-Path $runtimeRoot "tool-packages\dirsearch"
if (Test-Path -LiteralPath $dirsearchSitePackages) {
    Remove-Item -LiteralPath $dirsearchSitePackages -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $dirsearchSitePackages | Out-Null
Write-Host "Installing isolated dirsearch runtime dependencies..."
& $python -B -m pip install --disable-pip-version-check --no-cache-dir --no-compile `
    --target $dirsearchSitePackages --requirement $dirsearchRequirements
if ($LASTEXITCODE -ne 0) { throw "dirsearch dependency installation failed" }

$env:CTFBOX_DIRSEARCH_PACKAGES = $dirsearchSitePackages
try {
    & $python -B -c "import os, sys; sys.path.insert(0, os.environ['CTFBOX_DIRSEARCH_PACKAGES']); import bs4, colorama, defusedcsv, defusedxml, httpx, httpx_ntlm, jinja2, OpenSSL, requests, requests_ntlm, requests_toolbelt, socks"
    if ($LASTEXITCODE -ne 0) { throw "dirsearch dependency validation failed" }
} finally {
    Remove-Item Env:\CTFBOX_DIRSEARCH_PACKAGES -ErrorAction SilentlyContinue
}
Remove-PythonBytecodeCache -Root $runtimeRoot
Set-Content -LiteralPath $marker -Value $runtimeSchemaVersion -Encoding ascii
Write-Host "Bundled Python runtime preparation completed."
