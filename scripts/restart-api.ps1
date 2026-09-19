# Stop the existing API process listening on port 4000
Get-NetTCPConnection -LocalPort 4000 -ErrorAction SilentlyContinue | ForEach-Object {
  Write-Host "Stopping PID $($_.OwningProcess)"
  Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 2

# Start the tsx dev server in the background
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = 'cmd.exe'
$psi.Arguments = '/c cd /d C:\mnemonics-csp-fixed\apps\api & pnpm dev'
$psi.UseShellExecute = $true
$psi.WindowStyle = 'Hidden'
$psi.CreateNoWindow = $true
$proc = [System.Diagnostics.Process]::Start($psi)
Write-Host "Spawned dev PID $($proc.Id)"
Start-Sleep -Seconds 8

Get-NetTCPConnection -LocalPort 4000 -ErrorAction SilentlyContinue | ForEach-Object {
  $owner = (Get-CimInstance Win32_Process -Filter "ProcessId = $($_.OwningProcess)" -ErrorAction SilentlyContinue).CommandLine
  Write-Host "PORT 4000 owner PID $($_.OwningProcess)"
  if ($owner) {
    Write-Host ("CMD: " + $owner.Substring(0, [Math]::Min(200, $owner.Length)))
  }
}
