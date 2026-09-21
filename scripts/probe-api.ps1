$ErrorActionPreference = 'Continue'
try {
  $r = Invoke-WebRequest -Uri 'http://localhost:4000/' -UseBasicParsing -TimeoutSec 5
  Write-Output "STATUS: $($r.StatusCode)"
  Write-Output "BODY: $($r.Content)"
} catch {
  Write-Output "ERROR: $($_.Exception.Message)"
}
