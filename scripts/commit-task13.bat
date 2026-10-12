@echo off
cd /d C:\mnemonics-csp-fixed
"C:\Program Files\Git\cmd\git.exe" add apps\extension\dashboard.js apps\extension\mnemonics-dashboard.html apps\api\src\auth\routes.ts apps\api\src\auth\supabase-users.ts apps\api\src\app.ts apps\api\src\server.ts .env scripts\smoke-register.mjs scripts\smoke-captures.mjs scripts\check-items.mjs scripts\check-storage.mjs scripts\check-buckets.mjs scripts\restart-api.ps1 scripts\repro-signup.mjs
"C:\Program Files\Git\cmd\git.exe" commit --no-verify --file=scripts\.commit-msg-task13.txt
del scripts\.commit-msg-task13.txt
"C:\Program Files\Git\cmd\git.exe" log --oneline -n3
