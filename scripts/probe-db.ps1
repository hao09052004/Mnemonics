$ErrorActionPreference = 'Continue'
$env:NODE_PATH = 'c:\mnemonics-csp-fixed\node_modules'
$env:DATABASE_URL = (Get-Content 'c:\mnemonics-csp-fixed\.env' | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1) -replace '^DATABASE_URL=',''
& node -e "process.env.NODE_PATH='c:\mnemonics-csp-fixed\node_modules'; require('module').Module._initPaths(); require('c:\mnemonics-csp-fixed\scripts\probe-db.cjs')"
