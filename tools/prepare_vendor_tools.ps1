param()

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ("ctfbox-vendor-" + [guid]::NewGuid().ToString("N"))

function Assert-FileHash {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Expected
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Required file was not found: $Path"
    }
    $actual = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
    $normalizedExpected = $Expected.ToLowerInvariant()
    if ($actual -ne $normalizedExpected) {
        throw "Hash mismatch for ${Path}: expected $normalizedExpected, got $actual"
    }
}

function Get-VerifiedArchive {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Uri,
        [Parameter(Mandatory = $true)][string]$Sha256
    )

    $archive = Join-Path $tempRoot $Name
    Invoke-WebRequest -UseBasicParsing -Uri $Uri -OutFile $archive
    Assert-FileHash -Path $archive -Expected $Sha256
    return $archive
}

function Install-Dirsearch {
    $commit = "467f66b107f5316f6da85ceb4bcfcddbea447ae4"
    $target = Join-Path $repoRoot "Original\dirsearch"
    $entry = Join-Path $target "dirsearch.py"
    $requirements = Join-Path $target "requirements\runtime.txt"
    $entryHash = "647a911ca7cb45ee04211e10dcb377c7fcfd68a3b73bb9504fc543730d3584a7"
    $requirementsHash = "c65f7c09ddceb92cb58ab82bccc0ff81240878f741895040287bf5c6f34f5a14"

    if (Test-Path -LiteralPath $entry -PathType Leaf) {
        Assert-FileHash -Path $entry -Expected $entryHash
        Assert-FileHash -Path $requirements -Expected $requirementsHash
        Write-Host "Pinned dirsearch source is ready: $target"
        return
    }

    $archive = Get-VerifiedArchive `
        -Name "dirsearch-$commit.zip" `
        -Uri "https://github.com/maurosoria/dirsearch/archive/$commit.zip" `
        -Sha256 "09ae975cb58297ddd1e263197156ebf4a7cf2d1d8dcf00f2614370e0525007d8"
    $extractRoot = Join-Path $tempRoot "dirsearch"
    Expand-Archive -LiteralPath $archive -DestinationPath $extractRoot
    $sourceRoots = @(Get-ChildItem -LiteralPath $extractRoot -Directory)
    if ($sourceRoots.Count -ne 1) {
        throw "Unexpected dirsearch archive layout"
    }
    New-Item -ItemType Directory -Force -Path $target | Out-Null
    foreach ($item in Get-ChildItem -LiteralPath $sourceRoots[0].FullName -Force) {
        Copy-Item -LiteralPath $item.FullName -Destination $target -Recurse -Force
    }
    Assert-FileHash -Path $entry -Expected $entryHash
    Assert-FileHash -Path $requirements -Expected $requirementsHash
}

function Install-WindowsBinary {
    param(
        [Parameter(Mandatory = $true)][string]$Program,
        [Parameter(Mandatory = $true)][string]$Version,
        [Parameter(Mandatory = $true)][string]$ArchiveSha256,
        [Parameter(Mandatory = $true)][string]$ExecutableSha256
    )

    $targetRoot = Join-Path $repoRoot "tools\bin\windows"
    $target = Join-Path $targetRoot "$Program.exe"
    if (Test-Path -LiteralPath $target -PathType Leaf) {
        Assert-FileHash -Path $target -Expected $ExecutableSha256
        Write-Host "Pinned $Program binary is ready: $target"
        return
    }

    $archiveName = "${Program}_${Version}_windows_amd64.zip"
    $archive = Get-VerifiedArchive `
        -Name $archiveName `
        -Uri "https://github.com/projectdiscovery/$Program/releases/download/v$Version/$archiveName" `
        -Sha256 $ArchiveSha256
    $extractRoot = Join-Path $tempRoot $Program
    Expand-Archive -LiteralPath $archive -DestinationPath $extractRoot
    $source = Join-Path $extractRoot "$Program.exe"
    Assert-FileHash -Path $source -Expected $ExecutableSha256
    New-Item -ItemType Directory -Force -Path $targetRoot | Out-Null
    Copy-Item -LiteralPath $source -Destination $target -Force

    $license = Join-Path $extractRoot "LICENSE.md"
    if (Test-Path -LiteralPath $license -PathType Leaf) {
        Copy-Item -LiteralPath $license -Destination (Join-Path $targetRoot "$Program-LICENSE.md") -Force
    }
}

New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null
try {
    Install-Dirsearch
    Install-WindowsBinary `
        -Program "subfinder" `
        -Version "2.14.0" `
        -ArchiveSha256 "84e8a01d3d062484bb0958445e635a5773b6671566407fb4ab48417391539681" `
        -ExecutableSha256 "ba0acbcd2e34147f27b39a0c8a6a17454cdeefc088ac12ed642d9b9013e5d9e4"
    Install-WindowsBinary `
        -Program "nuclei" `
        -Version "3.11.0" `
        -ArchiveSha256 "87173bd0dc1ccda2101e102e7a6e2f01e29010259b4ec3f84d65108bca94d663" `
        -ExecutableSha256 "5315e0938ed80f60d78d90433d919bce5485eb94c61a1f36e3cb376e1285b7d5"
} finally {
    if (Test-Path -LiteralPath $tempRoot) {
        Remove-Item -LiteralPath $tempRoot -Recurse -Force
    }
}

Write-Host "Pinned vendor tools are ready."
