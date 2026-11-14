@echo off
rem Arranca el CRM en este PC: http://localhost:3000
cd /d "%~dp0"
where node >nul 2>nul || (echo Instala Node.js 22 LTS desde https://nodejs.org y vuelve a abrir este archivo. & pause & exit /b 1)
if not exist node_modules call npm install
start "" cmd /c "timeout /t 10 >nul & start http://localhost:3000"
call npm run dev
pause
