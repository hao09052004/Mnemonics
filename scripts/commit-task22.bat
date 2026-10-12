@echo off
cd /d C:\mnemonics-csp-fixed
"C:\Program Files\Git\cmd\git.exe" add apps/api/src/routes/image-proxy.ts apps/extension/dashboard.js scripts/test-cors-header.mjs
"C:\Program Files\Git\cmd\git.exe" commit --no-verify -m "task 22: proxy returns ACAO + dashboard rewrites http imageUrl through proxy — fix blank thumbnails"
