@echo off
title DFT+DMFT Workbench
setlocal EnableDelayedExpansion

echo ============================================
echo   DFT+DMFT Workbench
echo ============================================
echo.

:: Project directory
set "PROJECT_DIR=D:\DFT+DMFT workbench"
set "PORT=3001"

:: Switch to project directory
cd /d "%PROJECT_DIR%" 2>nul
if errorlevel 1 (
    echo [ERROR] Project directory not found: %PROJECT_DIR%
    echo.
    pause
    exit /b 1
)
echo [1/4] Project: %PROJECT_DIR%

:: Find Node.js
set "NODE_EXE="

:: Try PATH first
where node >nul 2>&1
if !errorlevel! equ 0 (
    for /f "delims=" %%i in ('where node') do (
        if not defined NODE_EXE set "NODE_EXE=%%i"
    )
)

:: Fallback: WorkBuddy managed node
if not defined NODE_EXE (
    if exist "C:\Users\pikaqiu\.workbuddy\binaries\node\versions\22.22.2\node.exe" (
        set "NODE_EXE=C:\Users\pikaqiu\.workbuddy\binaries\node\versions\22.22.2\node.exe"
    )
)

:: Fallback: user node
if not defined NODE_EXE (
    if exist "D:\CodexTools\nodejs\node-v22.22.1-win-x64\node.exe" (
        set "NODE_EXE=D:\CodexTools\nodejs\node-v22.22.1-win-x64\node.exe"
    )
)

if not defined NODE_EXE (
    echo [ERROR] Node.js not found. Please install Node.js 22+
    echo.
    pause
    exit /b 1
)

echo [2/4] Node.js: %NODE_EXE%
"%NODE_EXE%" --version
echo.

:: Check if port is already in use
echo [3/4] Checking port %PORT% ...
set "PORT_PID="
for /f "tokens=5" %%a in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":%PORT% "') do (
    set "PORT_PID=%%a"
)

if defined PORT_PID (
    echo.
    echo ============================================
    echo   [WARNING] Port %PORT% is in use ^(PID: !PORT_PID!^)
    echo ============================================
    echo.
    echo  Another DFT+DMFT Workbench instance may be running.
    echo.
    set /p "KILL_CHOICE=Kill old process and restart? (Y/N): "
    if /i "!KILL_CHOICE!"=="Y" (
        echo.
        echo  Killing PID !PORT_PID! ...
        taskkill /PID !PORT_PID! /F >nul 2>&1
        if !errorlevel! equ 0 (
            echo  [OK] Old process terminated
            echo.
        ) else (
            echo  [FAIL] Cannot kill process. Please close it manually.
            echo.
            pause
            exit /b 1
        )
    ) else (
        echo.
        echo  Cancelled. You can access the existing instance at:
        echo  http://localhost:%PORT%
        echo.
        timeout /t 3 /nobreak >nul
        start http://localhost:%PORT%
        exit /b 0
    )
) else (
    echo  Port %PORT% is free
)

:: Build frontend if needed
if not exist "%PROJECT_DIR%\dist\index.html" (
    echo.
    echo [INFO] Frontend not built. Building now...
    "%NODE_EXE%" "%PROJECT_DIR%\node_modules\vite\bin\vite.js" build
    if errorlevel 1 (
        echo.
        echo [ERROR] Frontend build failed
        echo.
        pause
        exit /b 1
    )
)

:: Start server
echo.
echo [4/4] Starting server...
echo.
echo ============================================
echo   URL: http://localhost:%PORT%
echo   Press Ctrl+C to stop
echo ============================================
echo.

:: Open browser after 3 seconds
start "" cmd /c "timeout /t 3 /nobreak >nul && start http://localhost:%PORT%"

:: Run backend server
"%NODE_EXE%" "%PROJECT_DIR%\node_modules\tsx\dist\cli.mjs" server/index.ts

:: Pause after server exits to prevent window closing
echo.
echo ============================================
echo   Server stopped
echo ============================================
echo.
pause
