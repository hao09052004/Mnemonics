@echo off
cd /d C:\mnemonics-csp-fixed
"C:\Program Files\Git\cmd\git.exe" add .env.example
"C:\Program Files\Git\cmd\git.exe" commit --no-verify -m "task 13.1: document AUTH_AUTO_CONFIRM dev flag"
"C:\Program Files\Git\cmd\git.exe" log --oneline -n3
