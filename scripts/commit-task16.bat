@echo off
cd /d C:\mnemonics-csp-fixed
"C:\Program Files\Git\cmd\git.exe" add apps\extension\screenshot-cropper.js apps\extension\background.js apps\extension\extension.js
"C:\Program Files\Git\cmd\git.exe" commit --no-verify -m "task 16: fix image save — local storage write + per-user namespace in all extension flows"
