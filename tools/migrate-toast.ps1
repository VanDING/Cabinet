# Migrate from custom Toast to Sonner — v2 (clean)
param([switch]$Fix)

$files = Get-ChildItem -Path "apps/desktop/src" -Recurse -Include "*.tsx","*.ts" | Where-Object { 
  $_.FullName -notmatch "\\node_modules\\" -and $_.FullName -notmatch "\\components\\ui\\"
}

foreach ($file in $files) {
  $lines = Get-Content -Path $file.FullName
  $original = $lines -join "`n"
  $changed = $false
  $hasSonnerImport = $false
  $firstImportLine = -1

  # Check if already has sonner import
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match 'import.*sonner') {
      $hasSonnerImport = $true
    }
    if ($firstImportLine -eq -1 -and $lines[$i] -match '^import ') {
      $firstImportLine = $i
    }
  }

  $newLines = @()

  for ($i = 0; $i -lt $lines.Count; $i++) {
    $line = $lines[$i]
    
    # Remove old useToast import line
    if ($line -match 'import \{ useToast \} from .*Toast') {
      $changed = $true
      continue
    }

    # Remove addToast destructuring
    if ($line -match 'const \{ addToast \} = useToast\(\)') {
      $changed = $true
      continue
    }

    # Remove duplicate sonner imports (keep only first)
    if ($line -match 'import.*sonner') {
      if ($hasSonnerImport) {
        continue  # skip duplicates
      }
      $hasSonnerImport = $true
    }

    # Fix addToast calls
    $modified = $false
    if ($line -match "addToast\(") {
      $line = $line -replace "addToast\(['""]success['""],\s*", "toast.success("
      $line = $line -replace "addToast\(['""]error['""],\s*", "toast.error("
      $line = $line -replace "addToast\(['""]warning['""],\s*", "toast.warning("
      $line = $line -replace "addToast\(['""]info['""],\s*", "toast("
      $changed = $true
      $modified = $true
    }

    # Remove addToast from dep arrays
    if ($line -match ',\s*addToast') {
      $line = $line -replace ',\s*addToast', ''
      $changed = $true
    }
    if ($line -match 'addToast,\s*') {
      $line = $line -replace 'addToast,\s*', ''
      $changed = $true
    }

    $newLines += $line
  }

  if ($changed) {
    # Add sonner import after the first import line if not already there
    if (-not $hasSonnerImport -and $firstImportLine -ge 0) {
      $newLines = $newLines[0..$firstImportLine] + @("import { toast } from 'sonner';") + $newLines[($firstImportLine+1)..($newLines.Count-1)]
    }
    
    $newContent = $newLines -join "`n"
    Set-Content -Path $file.FullName -Value $newContent
    Write-Host "Fixed: $($file.FullName)"
  }
}

Write-Host "Migration complete."
