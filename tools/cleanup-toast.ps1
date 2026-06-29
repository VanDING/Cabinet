# Clean up botched toast migration — ensure exactly 1 sonner import per file

$files = Get-ChildItem -Path "apps/desktop/src" -Recurse -Include "*.tsx","*.ts" | Where-Object { 
  $_.FullName -notmatch "\\node_modules\\" -and $_.FullName -notmatch "\\components\\ui\\"
}

foreach ($file in $files) {
  $content = Get-Content -Path $file.FullName -Raw
  
  # Fix merged lines: "import { toast } from 'sonner';import X" → "import { toast } from 'sonner';\nimport X"
  $content = $content -replace "(from 'sonner';)import ", "`$1`nimport "
  
  # Deduplicate sonner imports — keep only the last one, remove all others
  $lines = $content -split "`n"
  $sonnerLines = @()
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match "import.*sonner") {
      $sonnerLines += $i
    }
  }
  
  if ($sonnerLines.Count -gt 1) {
    # Mark duplicates for removal (keep last)
    $removeLine = $sonnerLines[0..($sonnerLines.Count - 2)]
    $newLines = @()
    for ($i = 0; $i -lt $lines.Count; $i++) {
      if ($i -in $removeLine) {
        continue
      }
      $newLines += $lines[$i]
    }
    $content = $newLines -join "`n"
  }
  
  Set-Content -Path $file.FullName -Value $content -NoNewline
}
Write-Host "Cleanup complete."
