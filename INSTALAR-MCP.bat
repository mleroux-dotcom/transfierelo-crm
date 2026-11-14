@echo off
chcp 65001 >nul
title Instalador fuentes-mcp
cd /d "%~dp0mcp-server"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo No tienes Node.js instalado. Se abrira la pagina de descarga:
  echo instala la version LTS ^(22 o superior^) y vuelve a hacer doble clic en este archivo.
  start https://nodejs.org
  pause
  exit /b 1
)
node scripts\instalar.mjs
echo.
pause
