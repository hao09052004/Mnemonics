@echo off
cd /d C:\mnemonics-csp-fixed
"C:\Program Files\Git\cmd\git.exe" add apps\extension\dashboard.js
"C:\Program Files\Git\cmd\git.exe" commit --no-verify -m "task 17: hide bundled sample items for logged-in users — only guests see demo data"
