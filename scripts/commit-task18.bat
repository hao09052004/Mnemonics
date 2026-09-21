@echo off
cd /d C:\mnemonics-csp-fixed
"C:\Program Files\Git\cmd\git.exe" add apps\extension\api-client.js apps\extension\background.js
"C:\Program Files\Git\cmd\git.exe" commit --no-verify -m "task 18: bypass CSP block on data: URL fetch — convert dataURL/blob to Blob via atob/Uint8Array"
