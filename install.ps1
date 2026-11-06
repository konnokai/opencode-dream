param(
  [string[]]$Project = @(),
  [switch]$SkipGlobal
)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$configDir = Join-Path $env:USERPROFILE ".config\opencode"

function Install-File([string]$Source, [string]$Target) {
  $sourceText = Get-Content -LiteralPath $Source -Raw
  $current = if (Test-Path -LiteralPath $Target) { Get-Content -LiteralPath $Target -Raw } else { $null }
  if ($current -eq $sourceText) {
    Write-Host "unchanged: $Target"
    return
  }
  if ($null -ne $current) {
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    Copy-Item -LiteralPath $Target "$Target.bak-$stamp"
    Write-Host "backup: $Target.bak-$stamp"
  }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Target) | Out-Null
  Copy-Item -LiteralPath $Source $Target -Force
  Write-Host "installed: $Target"
}

if ($SkipGlobal) {
  Write-Host "skip global plugins, commands and agents"
} else {
  Install-File (Join-Path $here "global\plugins\dream.ts") (Join-Path $configDir "plugins\dream.ts")
  Install-File (Join-Path $here "global\commands\dream.md") (Join-Path $configDir "commands\dream.md")
  Install-File (Join-Path $here "global\agents\dream.md") (Join-Path $configDir "agents\dream.md")
}

foreach ($dir in $Project) {
  if (-not (Test-Path -LiteralPath $dir -PathType Container)) {
    Write-Warning "skip missing project: $dir"
    continue
  }

  $memory = Join-Path $dir ".opencode\memory"
  New-Item -ItemType Directory -Force -Path $memory | Out-Null

  $ignore = Join-Path $memory ".gitignore"
  $lines = if (Test-Path -LiteralPath $ignore) { Get-Content -LiteralPath $ignore } else { @() }
  if ($lines -notcontains "sessions/") {
    Add-Content -LiteralPath $ignore -Value "sessions/"
  }

  $loops = Join-Path $dir ".agents\loops"
  New-Item -ItemType Directory -Force -Path $loops | Out-Null
  Install-File (Join-Path $here "project\.agents\loops\dream.md") (Join-Path $loops "dream.md")

  if (Test-Path -LiteralPath (Join-Path $dir ".git")) {
    try {
      $ignored = & git -C $dir check-ignore ".opencode/memory/_index.md" 2>$null
    } catch {
      $ignored = $null
    }
    if ($ignored) {
      Write-Warning "$dir ignores .opencode; memory will not sync through git"
    }
  }

  Write-Host "ready: $dir"
}

Write-Host "done. turn the loop on once in OpenChamber > Scheduled Tasks."
