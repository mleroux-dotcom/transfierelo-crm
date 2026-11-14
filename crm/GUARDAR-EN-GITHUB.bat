@echo off
rem Guarda el codigo del CRM en un repositorio privado de tu GitHub.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\guardar-github.ps1"
pause
