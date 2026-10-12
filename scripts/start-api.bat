@echo off
cd /d c:\mnemonics-csp-fixed\apps\api
echo Starting API via cmd /c...
start "mnemonics-api" /min cmd /c npx tsx src/server.ts
echo Started. Waiting 12s for boot...
timeout /t 12 /nobreak > nul
echo --- LISTENING ON 4000? ---
netstat -ano | findstr :4000
echo --- HEALTH ---
powershell -NoProfile -Command "try { (Invoke-WebRequest -Uri 'http://localhost:4000/api/v1/health' -UseBasicParsing -TimeoutSec 5).Content } catch { 'ERR: ' + $_.Exception.Message }"
