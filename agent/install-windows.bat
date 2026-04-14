@echo off
chcp 65001 >nul
title TubeFlow Agent — Cai Dat
color 0A

echo.
echo  =============================================
echo    TubeFlow Desktop Agent v1.0 - Cai Dat
echo  =============================================
echo.
echo  Huong dan cai dat: xem file INSTALL-WINDOWS.md
echo.

:: ──────────────────────────────────────
:: KIEM TRA NODE.JS
:: ──────────────────────────────────────
echo [1/4] Kiem tra Node.js...
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo  [!] Node.js CHUA duoc cai dat!
    echo.
    echo      Vui long:
    echo      1. Truy cap https://nodejs.org
    echo      2. Tai phien ban LTS
    echo      3. Cai dat xong roi chay lai file nay
    echo.
    pause
    start https://nodejs.org
    exit /b 1
)

for /f "tokens=*" %%i in ('node -v') do set NODE_VER=%%i
echo  [OK] Node.js %NODE_VER% da san sang
echo.

:: ──────────────────────────────────────
:: CAI DEPENDENCIES
:: ──────────────────────────────────────
echo [2/4] Cai dat thu vien (co the mat 1-2 phut)...
cd /d "%~dp0"
call npm install --silent
if %errorlevel% neq 0 (
    echo.
    echo  [!] Loi cai dat! Kiem tra ket noi Internet va thu lai.
    echo.
    pause
    exit /b 1
)
echo  [OK] Thu vien da cai dat
echo.

:: ──────────────────────────────────────
:: BUILD AGENT
:: ──────────────────────────────────────
echo [3/4] Build agent...
call npm run build --silent
if %errorlevel% neq 0 (
    echo.
    echo  [!] Loi build! Lien he admin de duoc ho tro.
    echo.
    pause
    exit /b 1
)
echo  [OK] Build thanh cong
echo.

:: ──────────────────────────────────────
:: KHOI DONG AGENT
:: ──────────────────────────────────────
echo [4/4] Khoi dong TubeFlow Agent...
echo.
echo  =============================================
echo    Agent dang chay. De dung: Ctrl + C
echo  =============================================
echo.
node dist/index.js

echo.
echo  Agent da dung.
pause
