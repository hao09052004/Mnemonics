$ErrorActionPreference = 'Continue'
Set-Location 'c:\mnemonics-csp-fixed\apps\api'

# Kill any stale API instances
Get-NetTCPConnection -LocalPort 4000 -ErrorAction SilentlyContinue | ForEach-Object {
  try { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } catch {}
}

Start-Process -FilePath "npx" -ArgumentList "tsx", "src/server.ts" -RedirectStandardOutput "c:\mnemonics-csp-fixed\scripts\api-stdout.log" -RedirectStandardError "c:\mnemonics-csp-fixed\scripts\api-stderr.log" -WorkingDirectory "c:\mnemonics-csp-fixed\apps\api" -WindowStyle Hidden
Write-Output "Started npx tsx src/server.ts, PID=$((Get-Process -Name 'node' -ErrorAction SilentlyContinue | Select-Object -First 1).Id)"

Start-Sleep -Seconds 10

Write-Output "--- STDOUT ---"
if (Test-Path 'c:\mnemonics-csp-fixed\scripts\api-stdout.log') { Get-Content 'c:\mnemonics-csp-fixed\scripts\api-stdout.log' }
Write-Output "--- STDERR ---"
if (Test-Path 'c:\mnemonics-csp-fixed\scripts\api-stderr.log') { Get-Content 'c:\mnemonics-csp-fixed\scripts\api-stderr.log' }
