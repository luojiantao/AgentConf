# Install pi CLI and apply this repo's public pi/agent snapshot to ~/.pi/agent.
[CmdletBinding()]
param(
    [switch]$SkipCli,
    [switch]$DryRun,
    [string]$Dest
)

$ErrorActionPreference = "Stop"

function Write-DryRun {
    param([string]$Message)
    Write-Host "[dry-run] $Message"
}

function Invoke-Step {
    param(
        [string]$Label,
        [scriptblock]$Action
    )
    if ($DryRun) {
        Write-DryRun $Label
        return
    }
    & $Action
}

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Src = Join-Path $Root "pi\agent"
if (-not $Dest) {
    if ($env:PI_CODING_AGENT_DIR) {
        $Dest = $env:PI_CODING_AGENT_DIR
    } else {
        $Dest = Join-Path $env:USERPROFILE ".pi\agent"
    }
}

if (-not (Test-Path -LiteralPath $Src -PathType Container)) {
    throw "missing snapshot directory: $Src"
}

Write-Host "source: $Src"
Write-Host "dest:   $Dest"

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw "required command not found: npm"
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "required command not found: node"
}

if (-not $SkipCli) {
    Write-Host "installing pi CLI..."
    Invoke-Step "npm install -g --ignore-scripts @earendil-works/pi-coding-agent" {
        npm install -g --ignore-scripts @earendil-works/pi-coding-agent
        if ($LASTEXITCODE -ne 0) { throw "npm install pi failed" }
    }
}

$npmBin = $null
try { $npmBin = Split-Path (npm root -g) } catch { }
if ($npmBin -and ($env:Path -notlike "*$npmBin*")) {
    $env:Path = "$npmBin;$env:Path"
}

if (-not $DryRun -and -not (Get-Command pi -ErrorAction SilentlyContinue)) {
    throw "pi is not on PATH after install"
}

Invoke-Step "mkdir $Dest" {
    New-Item -ItemType Directory -Force -Path $Dest | Out-Null
}

function Copy-FileRel([string]$Rel) {
    $from = Join-Path $Src $Rel
    if (-not (Test-Path -LiteralPath $from -PathType Leaf)) { return }
    $to = Join-Path $Dest $Rel
    Invoke-Step "cp $Rel" {
        $parent = Split-Path $to
        New-Item -ItemType Directory -Force -Path $parent | Out-Null
        Copy-Item -LiteralPath $from -Destination $to -Force
    }
}

function Mirror-Dir([string]$Rel) {
    $from = Join-Path $Src $Rel
    if (-not (Test-Path -LiteralPath $from -PathType Container)) { return }
    $to = Join-Path $Dest $Rel
    Invoke-Step "mirror $Rel/" {
        if (Test-Path -LiteralPath $to) {
            Remove-Item -LiteralPath $to -Recurse -Force
        }
        $parent = Split-Path $to
        New-Item -ItemType Directory -Force -Path $parent | Out-Null
        Copy-Item -LiteralPath $from -Destination $to -Recurse -Force
    }
}

Copy-FileRel "AGENTS.md"
Copy-FileRel "APPEND_SYSTEM.md"
Copy-FileRel "settings.json"
Copy-FileRel "preloop-gate.json"
Copy-FileRel "auth.json.example"
Copy-FileRel "models-store.json"

foreach ($dir in @("Actor", "Domain", "Stack", "agents", "extensions", "skills", "prompts")) {
    Mirror-Dir $dir
}

$binSrc = Join-Path $Src "bin"
if (Test-Path -LiteralPath $binSrc -PathType Container) {
    $binDest = Join-Path $Dest "bin"
    Invoke-Step "copy bin/* except *.exe" {
        New-Item -ItemType Directory -Force -Path $binDest | Out-Null
        Get-ChildItem -LiteralPath $binSrc -File | Where-Object { $_.Extension -ne ".exe" } | ForEach-Object {
            Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $binDest $_.Name) -Force
        }
    }
}

$npmIgnore = Join-Path $Src "npm\.gitignore"
if (Test-Path -LiteralPath $npmIgnore -PathType Leaf) {
    Invoke-Step "cp npm/.gitignore" {
        New-Item -ItemType Directory -Force -Path (Join-Path $Dest "npm") | Out-Null
        Copy-Item -LiteralPath $npmIgnore -Destination (Join-Path $Dest "npm\.gitignore") -Force
    }
}

if ($DryRun) {
    Write-DryRun "PI_CODING_AGENT_DIR=$Dest pi install <packages from settings.json>"
} else {
    $env:PI_CODING_AGENT_DIR = $Dest
    $settingsPath = Join-Path $Dest "settings.json"
    $settings = Get-Content -LiteralPath $settingsPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $packages = @()
    if ($settings.packages) {
        foreach ($p in $settings.packages) {
            if ($p -is [string]) { $packages += $p }
            else { $packages += $p.source }
        }
    }
    if ($packages.Count -gt 0) {
        Write-Host "installing pi packages from settings.json..."
        foreach ($pkg in $packages) {
            Write-Host "  pi install $pkg"
            & pi install $pkg
            if ($LASTEXITCODE -ne 0) { throw "pi install failed: $pkg" }
        }
    }
}

Write-Host ""
Write-Host "done."
Write-Host "preserved on dest if present: auth.json, models.json, trust.json, sessions/"
if (-not (Test-Path -LiteralPath (Join-Path $Dest "auth.json"))) {
    Write-Host "next: copy auth.json.example to auth.json and fill keys, or run: pi  then /login"
}
if (-not (Test-Path -LiteralPath (Join-Path $Dest "models.json"))) {
    Write-Host "next: add ~/.pi/agent/models.json if you use custom providers (not shipped in this public repo)"
}
