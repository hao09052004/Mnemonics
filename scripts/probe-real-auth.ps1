$ErrorActionPreference = 'Continue'
$base = 'http://localhost:4000'
$email = 'probe+' + ([guid]::NewGuid().ToString().Substring(0,8)) + '@example.com'
$password = 'ProbePwd123!'
$name = 'Probe User'

Write-Output "1) Register user $email"
$regBody = @{ email = $email; password = $password; name = $name } | ConvertTo-Json
try {
  $r = Invoke-WebRequest -Uri "$base/api/v1/auth/register" -Method POST -ContentType 'application/json' -Body $regBody -UseBasicParsing -TimeoutSec 15
  Write-Output "  STATUS: $($r.StatusCode)"
  Write-Output "  BODY: $($r.Content)"
} catch {
  Write-Output "  ERR: $($_.Exception.Message)"
  if ($_.Exception.Response) {
    $reader = [System.IO.StreamReader]::new($_.Exception.Response.GetResponseStream())
    Write-Output "  BODY: $($reader.ReadToEnd())"
  }
}

Write-Output ""
Write-Output "2) Login"
$loginBody = @{ email = $email; password = $password } | ConvertTo-Json
$token = $null
try {
  $r = Invoke-WebRequest -Uri "$base/api/v1/auth/login" -Method POST -ContentType 'application/json' -Body $loginBody -UseBasicParsing -TimeoutSec 15
  Write-Output "  STATUS: $($r.StatusCode)"
  Write-Output "  BODY: $($r.Content)"
  $j = $r.Content | ConvertFrom-Json
  $token = $j.data.session.accessToken
} catch {
  Write-Output "  ERR: $($_.Exception.Message)"
  if ($_.Exception.Response) {
    $reader = [System.IO.StreamReader]::new($_.Exception.Response.GetResponseStream())
    Write-Output "  BODY: $($reader.ReadToEnd())"
  }
}

if ($null -eq $token) { Write-Output "No token — stopping"; exit 1 }

Write-Output ""
Write-Output "3) POST /api/v1/captures (text)"
$uuid = [guid]::NewGuid().ToString()
$textBody = @{ type = 'text'; title = 'probe text'; selectedText = 'hello world'; clientRequestId = $uuid } | ConvertTo-Json
try {
  $r = Invoke-WebRequest -Uri "$base/api/v1/captures" -Method POST -ContentType 'application/json' -Headers @{ Authorization = "Bearer $token" } -Body $textBody -UseBasicParsing -TimeoutSec 15
  Write-Output "  STATUS: $($r.StatusCode)"
  Write-Output "  BODY: $($r.Content)"
} catch {
  Write-Output "  ERR: $($_.Exception.Message)"
  if ($_.Exception.Response) {
    $reader = [System.IO.StreamReader]::new($_.Exception.Response.GetResponseStream())
    Write-Output "  BODY: $($reader.ReadToEnd())"
  }
}

Write-Output ""
Write-Output "4) POST /api/v1/captures/image (multipart)"
$pngPath = "c:\mnemonics-csp-fixed\scripts\test.png"
$b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABh6FO1AAAAABJRU5ErkJggg=='
[System.IO.File]::WriteAllBytes($pngPath, [System.Convert]::FromBase64String($b64))
$imgUuid = [guid]::NewGuid().ToString()
try {
  $boundary = [System.Guid]::NewGuid().ToString()
  $headers = @{ Authorization = "Bearer $token" }
  $fileBytes = [System.IO.File]::ReadAllBytes($pngPath)
  $body = @"
--$boundary
Content-Disposition: form-data; name="title"

probe image
--$boundary
Content-Disposition: form-data; name="sourceUrl"


--$boundary
Content-Disposition: form-data; name="capturedAt"

2026-09-21T00:00:00.000Z
--$boundary
Content-Disposition: form-data; name="clientRequestId"

$imgUuid
--$boundary
Content-Disposition: form-data; name="file"; filename="probe.png"
Content-Type: image/png

$([System.Text.Encoding]::GetEncoding('iso-8859-1').GetString($fileBytes))
--$boundary--
"@
  $body = $body -replace "`r`n","`n"
  $headers['Content-Type'] = "multipart/form-data; boundary=$boundary"
  $r = Invoke-WebRequest -Uri "$base/api/v1/captures/image" -Method POST -Headers $headers -Body $body -UseBasicParsing -TimeoutSec 30
  Write-Output "  STATUS: $($r.StatusCode)"
  Write-Output "  BODY: $($r.Content)"
} catch {
  Write-Output "  ERR: $($_.Exception.Message)"
  if ($_.Exception.Response) {
    $reader = [System.IO.StreamReader]::new($_.Exception.Response.GetResponseStream())
    Write-Output "  BODY: $($reader.ReadToEnd())"
  }
}
