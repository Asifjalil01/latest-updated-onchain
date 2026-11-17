@echo off
title Solana Spot Bot - Startup & Run
echo ========================================
echo   Solana Spot Bot (v1.13.0) Startup
echo ========================================
echo.
echo [1/2] Checking and installing dependencies (npm install)...
call npm install
echo.
echo [2/2] Starting development server (npm run dev)...
call npm run dev
pause
