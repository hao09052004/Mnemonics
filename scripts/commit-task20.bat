@echo off
cd /d C:\mnemonics-csp-fixed
"C:\Program Files\Git\cmd\git.exe" add apps\extension\background.js apps/extension/screenshot-cropper.js
"C:\Program Files\Git\cmd\git.exe" commit --no-verify -m "task 20: context-menu image save — auto upload OR fall back to cropper on CORS block"
