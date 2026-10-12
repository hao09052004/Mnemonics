$ErrorActionPreference = 'Continue'

# Create a tiny test PNG (1x1 transparent)
$pngPath = "c:\mnemonics-csp-fixed\scripts\test.png"
$b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABh6FO1AAAAABJRU5ErkJggg=='
[System.IO.File]::WriteAllBytes($pngPath, [System.Convert]::FromBase64String($b64))

# Generate a UUID for clientRequestId
$uuid = [guid]::NewGuid().ToString()

Write-Output "Test 1: POST /api/v1/captures (text, no auth) - expect 401"
try {
  $r = Invoke-WebRequest -Uri 'http://localhost:4000/api/v1/captures' `
    -Method POST `
    -ContentType 'application/json' `
    -Body '{"type":"text","title":"hi","selectedText":"hello","clientRequestId":"00000000-0000-4000-8000-000000000001"}' `
    -UseBasicParsing `
    -TimeoutSec 10
  Write-Output "STATUS: $($r.StatusCode)"
  Write-Output "BODY: $($r.Content)"
} catch {
  Write-Output "STATUS: $($_.Exception.Response.StatusCode.value__)"
  Write-Output "BODY: $($_.Exception.Response)"
}

Write-Output ""
Write-Output "Test 2: POST /api/v1/captures (text, with dev auth) - expect 201"
try {
  $r = Invoke-WebRequest -Uri 'http://localhost:4000/api/v1/captures' `
    -Method POST `
    -ContentType 'application/json' `
    -Headers @{ Authorization = 'Bearer mnemonics-dev-token' } `
    -Body ('{"type":"text","title":"test text","selectedText":"hello world","clientRequestId":"' + $uuid + '"}') `
    -UseBasicParsing `
    -TimeoutSec 10
  Write-Output "STATUS: $($r.StatusCode)"
  Write-Output "BODY: $($r.Content)"
} catch {
  Write-Output "STATUS: $($_.Exception.Response.StatusCode.value__)"
  if ($_.Exception.Response) {
    $reader = [System.IO.StreamReader]::new($_.Exception.Response.GetResponseStream())
    Write-Output "BODY: $($reader.ReadToEnd())"
  } else {
    Write-Output "BODY: $($_.Exception.Message)"
  }
}

Write-Output ""
Write-Output "Test 3: POST /api/v1/captures/image (multipart, with dev auth) - expect 201"
try {
  $r = Invoke-WebRequest -Uri 'http://localhost:4000/api/v1/captures/image' `
    -Method POST `
    -Headers @{ Authorization = 'Bearer mnemonics-dev-token' } `
    -Form @{ title = 'test image'; sourceUrl = ''; capturedAt = '2026-09-21T00:00:00.000Z'; clientRequestId = $uuid; file = Get-Item $pngPath } `
    -UseBasicParsing `
    -TimeoutSec 30
  Write-Output "STATUS: $($r.StatusCode)"
  Write-Output "BODY: $($r.Content)"
} catch {
  Write-Output "STATUS: $($_.Exception.Response.StatusCode.value__)"
  if ($_.Exception.Response) {
    $reader = [System.IO.StreamReader]::new($_.Exception.Response.GetResponseStream())
    Write-Output "BODY: $($reader.ReadToEnd())"
  } else {
    Write-Output "BODY: $($_.Exception.Message)"
  }
}
