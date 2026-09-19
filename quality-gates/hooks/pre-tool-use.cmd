@echo off
REM Cursor pre-tool-use hook: refuse obviously dangerous commands before they run.
REM Wired into quality-gates/hooks/cursor-hooks.json (or .cursor/hooks.json).
setlocal

REM Tool name is passed as %1, command payload as %2 (may be empty).
set "TOOL=%~1"
set "CMD=%~2"

if /I not "%TOOL%"=="Bash" goto :ok
if /I not "%TOOL%"=="Write" goto :ok

REM Block force-push / hard reset / secret env dumping.
for %%P in ("git push --force" "git push -f" "git reset --hard" "rm -rf /" "rmdir /s /q C:\\Windows") do (
  echo "%CMD%" | findstr /I /C:"%%~P" >nul && (
    echo [pre-tool-use] BLOCKED: dangerous command '%%~P'
    exit /b 2
  )
)

:ok
exit /b 0
