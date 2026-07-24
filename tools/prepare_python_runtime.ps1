param()

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$runtimeRoot = Join-Path $repoRoot "gui\src-tauri\resources\python"
$pythonVersion = "3.11.9"
$archive = Join-Path $env:TEMP "python-$pythonVersion-embed-amd64.zip"
$downloadUrl = "https://www.python.org/ftp/python/$pythonVersion/python-$pythonVersion-embed-amd64.zip"
$marker = Join-Path $runtimeRoot ".ctfbox-runtime-ready"

if (Test-Path $marker) {
    Write-Host "内置 Python 运行时已准备：$runtimeRoot"
    exit 0
}

New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null
if (-not (Test-Path $archive)) {
    Write-Host "下载 Python $pythonVersion 内嵌运行时..."
    Invoke-WebRequest -Uri $downloadUrl -OutFile $archive
}

if (-not (Test-Path (Join-Path $runtimeRoot "python.exe"))) {
    Expand-Archive -LiteralPath $archive -DestinationPath $runtimeRoot -Force
}

$pth = Get-ChildItem -LiteralPath $runtimeRoot -Filter "python*._pth" | Select-Object -First 1
if (-not $pth) { throw "找不到 Python _pth 配置文件" }
$pthLines = @(Get-Content -LiteralPath $pth.FullName)
if (-not ($pthLines -contains "Lib\site-packages")) { $pthLines = @($pthLines[0], ".", "Lib\site-packages") + $pthLines[1..($pthLines.Count - 1)] }
if (-not ($pthLines -contains "import site")) { $pthLines += "import site" }
Set-Content -LiteralPath $pth.FullName -Value $pthLines -Encoding ascii

$python = Join-Path $runtimeRoot "python.exe"
$getPip = Join-Path $env:TEMP "ctfbox-get-pip.py"
if (-not (Test-Path (Join-Path $runtimeRoot "Lib\site-packages\pip"))) {
    Write-Host "安装内置 Python 包管理器..."
    Invoke-WebRequest -Uri "https://bootstrap.pypa.io/get-pip.py" -OutFile $getPip
    & $python $getPip --no-warn-script-location
    if ($LASTEXITCODE -ne 0) { throw "get-pip 执行失败" }
}

$sitePackages = Join-Path $runtimeRoot "Lib\site-packages"
New-Item -ItemType Directory -Force -Path $sitePackages | Out-Null
Write-Host "安装 SSTImap 运行依赖..."
& $python -m pip install --disable-pip-version-check --no-cache-dir --target $sitePackages `
    "argparse==1.4.0" "requests==2.27.1" "urllib3==1.26.9" "mechanize==0.4.8" "html5lib==1.1"
if ($LASTEXITCODE -ne 0) { throw "Python 依赖安装失败" }

& $python -c "import requests, mechanize, html5lib"
if ($LASTEXITCODE -ne 0) { throw "Python 依赖验收失败" }
New-Item -ItemType File -Force -Path $marker | Out-Null
Write-Host "内置 Python 运行时准备完成。"
