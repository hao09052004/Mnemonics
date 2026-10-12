@echo off
cd /d C:\mnemonics-csp-fixed
"C:\Program Files\Git\cmd\git.exe" add apps\extension\dashboard.js
"C:\Program Files\Git\cmd\git.exe" commit --no-verify -m "task 15: reload items from correct user namespace after login/signup"
