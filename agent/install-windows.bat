@echo off
title TubeFlow Agent Installer
echo.
echo ========================================
echo   TubeFlow Desktop Agent - Cai Dat
echo ========================================
echo.

:: Check Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [!] Node.js chua duoc cai dat!
    echo     Tai va cai dat tu: https://nodejs.org
    echo     Chon phien ban LTS ^(khuyen nghi^)
    echo.
    pause
    start https://nodejs.org
    exit /b 1
)

echo [OK] Node.js da cai dat
for /f "tokens=*" %%i in ('node -v') do echo     Phien ban: %%i
echo.

:: Install dependencies
echo [*] Dang cai dat dependencies...
cd /d "%~dp0"
call npm install
if %errorlevel% neq 0 (
    echo [!] Loi cai dat dependencies!
    pause
    exit /b 1
)
echo [OK] Dependencies da cai dat
echo.

:: Build TypeScript
echo [*] Dang build agent...
call npm run build
if %errorlevel% neq 0 (
    echo [!] Loi build!
    pause
    exit /b 1
)
echo [OK] Build thanh cong
echo.

:: Run agent
echo ========================================
echo   Khoi dong TubeFlow Agent...
echo ========================================
echo.
node dist/index.js
pause
