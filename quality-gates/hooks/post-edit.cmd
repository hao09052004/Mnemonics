@echo off
REM Cursor post-edit hook: enforce the cheap gates immediately after a file is saved.
REM Wired into quality-gates/hooks/cursor-hooks.json (or .cursor/hooks.json).
setlocal

set "ROOT=%~dp0..\.."
pushd "%ROOT%" >nul

echo [post-edit] running gates 01-style, 06-skill-frontmatter (subset)

REM 01-style (lightweight subset, no semgrep here)
call node scripts\seed-skill-metas.mjs >nul 2>&1
call node quality-gates\runners\check-skills.mjs
if errorlevel 1 (
  echo [post-edit] FAIL: 06-skill-frontmatter
  popd
  exit /b 1
)

REM 06-skill-frontmatter already runs above.

REM 05-agent-contract only fires if agents/ changed
for %%F in ("%ROOT%\agents\*.md") do (
  if exist "%%~fF" (
    call node quality-gates\runners\check-agents.mjs
    if errorlevel 1 (
      echo [post-edit] FAIL: 05-agent-contract
      popd
      exit /b 1
    )
    goto :agents_done
  )
)
:agents_done

echo [post-edit] OK
popd
endlocal
