# Creates a verified Supabase user via the service-role admin endpoint
# so the IP-level rate limit on /auth/v1/signup does not block QA sign-ups.
#
# Required environment:
#   $env:SUPABASE_URL                  e.g. https://<project>.supabase.co
#   $env:SUPABASE_SERVICE_ROLE_KEY     service-role JWT (rotate via Supabase dashboard)
#
# The script intentionally FAILS FAST when the credential is missing
# rather than falling back to a baked-in value. Hardcoded service-role
# credentials were removed after a P0 secret-exposure incident; the
# previous exposed key is treated as compromised and must be rotated
# before reuse.

$ErrorActionPreference = 'Stop'

if (-not $env:SUPABASE_URL) {
  Write-Host "ERROR: SUPABASE_URL is not configured." -ForegroundColor Red
  Write-Host "Set it before running this script, e.g.:" -ForegroundColor Yellow
  Write-Host "  `$env:SUPABASE_URL = 'https://<project>.supabase.co'" -ForegroundColor Yellow
  exit 1
}
if (-not $env:SUPABASE_SERVICE_ROLE_KEY) {
  Write-Host "ERROR: SUPABASE_SERVICE_ROLE_KEY is not configured." -ForegroundColor Red
  Write-Host "Set it before running this script, e.g.:" -ForegroundColor Yellow
  Write-Host "  `$env:SUPABASE_SERVICE_ROLE_KEY = '<service-role-jwt>'" -ForegroundColor Yellow
  exit 1
}

$svc  = $env:SUPABASE_SERVICE_ROLE_KEY
$url  = "$env:SUPABASE_URL/auth/v1/admin/users"
$stamp = [int][double]::Parse((Get-Date -UFormat %s))
$email = "test+$stamp@protonmail.com"
$body = @{ email = $email; password = 'MnemonicsDev#2026'; email_confirm = $true } | ConvertTo-Json -Compress
Write-Host "--- admin create user ($email) ---"
try {
  $r = Invoke-RestMethod -Method Post -Uri $url -Headers @{ apikey = $svc; Authorization = "Bearer $svc"; "Content-Type" = "application/json" } -Body $body -ErrorAction Stop
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
