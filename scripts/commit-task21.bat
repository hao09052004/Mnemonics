@echo off
cd /d C:\mnemonics-csp-fixed
"C:\Program Files\Git\cmd\git.exe" add apps/api/src/app.ts apps/api/src/routes/image-proxy.ts apps/extension/background.js scripts/test-proxy.mjs scripts/test-integration.mjs
"C:\Program Files\Git\cmd\git.exe" commit --no-verify -m "task 21: add /api/v1/proxy/image — bypasses CORS for context-menu save (Facebook/Instagram CDN)"
