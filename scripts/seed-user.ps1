$svc  = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp0bW93d3RtanRtY2VpaHp2cmV1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4OTY5OTU1NSwiZXhwIjoyMTA1Mjc1NTU1fQ.qR4sYBGCorwywXdfXgxMUSjpAIs4ELnirhgwpB63FPQ"
$stamp = [int][double]::Parse((Get-Date -UFormat %s))
$email = "test+$stamp@protonmail.com"
$body = @{ email = $email; password = 'MnemonicsDev#2026'; email_confirm = $true } | ConvertTo-Json -Compress
Write-Host "--- admin create user ($email) ---"
try {
  $r = Invoke-RestMethod -Method Post -Uri "https://jtmowwtmjtmceihzvreu.supabase.co/auth/v1/admin/users" -Headers @{ apikey = $svc; Authorization = "Bearer $svc"; "Content-Type" = "application/json" } -Body $body -ErrorAction Stop
  $r | ConvertTo-Json -Depth 6
  Write-Host ""
  Write-Host "EMAIL: $email"
  Write-Host "PASSWORD: MnemonicsDev#2026"
} catch {
  Write-Host "ERR: $($_.Exception.Message)"
  $resp = $_.Exception.Response
  if ($resp) {
    $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
    Write-Host $reader.ReadToEnd()
  }
}
