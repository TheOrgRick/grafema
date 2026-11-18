@echo off
setlocal EnableExtensions
title Grafema - Modo de prueba
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo  Instala Node.js version LTS desde https://nodejs.org y vuelve a abrir este archivo.
  pause
  exit /b 1
)
if not exist node_modules (
  echo  Instalando dependencias por primera vez. Necesita internet...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo  No se pudieron instalar las dependencias.
    pause
    exit /b 1
  )
)
call npm start
