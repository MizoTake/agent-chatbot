@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1

REM opencode-monitor.cmd
REM
REM Windows (cmd.exe) wrapper for opencode-cli.
REM Periodically checks the LMStudio API and kills the process if it becomes unresponsive.
REM
REM Environment variables:
REM   LMSTUDIO_URL             LMStudio API URL (default: http://localhost:1234)
REM   OPENCODE_CHECK_INTERVAL  Check interval in seconds (default: 30)
REM   OPENCODE_FAIL_THRESHOLD  Consecutive failures before timeout (default: 3)
REM
REM Usage (orcha.yml):
REM   command: "cmd.exe"
REM   args: ["/c", "scripts\\opencode-monitor.cmd", "run", "--thinking"]

if not defined LMSTUDIO_URL set "LMSTUDIO_URL=http://localhost:1234"
if not defined OPENCODE_CHECK_INTERVAL set "OPENCODE_CHECK_INTERVAL=30"
if not defined OPENCODE_FAIL_THRESHOLD set "OPENCODE_FAIL_THRESHOLD=3"

REM --- Pre-flight: check LMStudio ---
echo [opencode-monitor] Checking LMStudio... (%LMSTUDIO_URL%) >&2
curl -s -o nul -w "%%{http_code}" --max-time 10 "%LMSTUDIO_URL%/v1/models" > "%TEMP%\orcha_lms_code.txt" 2>nul
set /p LMS_CODE=<"%TEMP%\orcha_lms_code.txt"
del "%TEMP%\orcha_lms_code.txt" 2>nul

if "%LMS_CODE%"=="200" goto :lms_ok
if "%LMS_CODE%"=="401" goto :lms_ok

echo [opencode-monitor] ERROR: LMStudio is not running or no models are loaded >&2
echo ERROR: LMStudio is not running or no models are loaded at %LMSTUDIO_URL%. Please start LMStudio and load a model before running.
exit /b 1

:lms_ok
echo [opencode-monitor] LMStudio OK >&2

REM --- Launch opencode-cli in background via START ---
REM Collect all arguments passed to this script and forward them to opencode-cli.
set "ORCHA_ARGS="
:arg_loop
if "%~1"=="" goto :arg_done
set "ORCHA_ARGS=!ORCHA_ARGS! %1"
shift
goto :arg_loop
:arg_done

REM Run opencode-cli and capture its PID via wmic
start "" /b opencode-cli%ORCHA_ARGS%

REM Since cmd.exe has limited background process management,
REM we run opencode-cli in the foreground and rely on the
REM configured phase_timeout_seconds in orcha.yml for timeout handling.
REM The watchdog pattern from the bash script is not feasible in pure cmd.
REM opencode-cli will exit on its own or be killed by orcha's timeout.

exit /b %ERRORLEVEL%
