@echo off
setlocal EnableExtensions
title Grafema - Crear instalador .exe
cd /d "%~dp0"

set "ELEV=0"
if /i "%~1"=="elevado" set "ELEV=1"

echo.
echo  ============================================================
echo    GRAFEMA by Petricorp  -  Crear el instalador .exe
echo  ============================================================
echo.

rem ---------------- 1. Node.js ----------------
where node >nul 2>nul
if errorlevel 1 goto sin_node
for /f "delims=" %%v in ('node -v') do set "NODEV=%%v"
echo  [1/4] Node.js detectado: %NODEV%
set "NM=%NODEV:~1%"
for /f "tokens=1 delims=." %%a in ("%NM%") do set "NM=%%a"
if %NM% LSS 18 goto node_viejo
goto paso2

:sin_node
echo  Node.js no esta instalado en este equipo.
where winget >nul 2>nul
if errorlevel 1 goto sin_winget
echo  Instalando Node.js LTS con winget. Puede pedir permiso...
winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
echo.
echo  Listo. CIERRA esta ventana y vuelve a abrir CONSTRUIR_EXE.bat para continuar.
pause
exit /b 0

:sin_winget
echo  Instala Node.js version LTS desde https://nodejs.org y vuelve a abrir este archivo.
start "" https://nodejs.org/es/download
pause
exit /b 1

:node_viejo
echo  Tu version de Node.js es muy antigua. Se necesita la 18 o superior.
echo  Instala la version LTS desde https://nodejs.org y vuelve a abrir este archivo.
start "" https://nodejs.org/es/download
pause
exit /b 1

rem ---------------- 2. Dependencias ----------------
:paso2
echo  [2/4] Instalando dependencias. Necesita internet la primera vez...
call npm install --no-audit --no-fund
if errorlevel 1 goto reintento_npm
goto paso3
:reintento_npm
echo  Reintentando la instalacion...
call npm install --no-audit --no-fund
if errorlevel 1 goto fallo_npm

rem ---------------- 3. Verificacion ----------------
:paso3
echo.
echo  [3/4] Verificando la aplicacion con las pruebas automaticas...
call node tests\run-all.js
if errorlevel 1 echo  Aviso: alguna prueba automatica fallo. Se continua de todos modos.

rem ---------------- 4. Construccion ----------------
:paso4
echo.
echo  [4/4] Creando el instalador. La primera vez descarga Electron y tarda varios minutos...
set "CSC_IDENTITY_AUTO_DISCOVERY=false"
call npm run dist
if not errorlevel 1 goto listo

echo.
echo  El primer intento no termino.
if "%ELEV%"=="1" goto alternativo
net session >nul 2>&1
if not errorlevel 1 goto alternativo
echo  Reintentando con permisos de administrador. Windows pedira confirmacion...
powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -ArgumentList 'elevado' -Verb RunAs"
exit /b 0

:alternativo
echo  Intento alternativo sin editar los metadatos del .exe...
call npx electron-builder --win --config.win.signAndEditExecutable=false
if not errorlevel 1 goto listo
echo.
echo  Ultimo recurso: crear la aplicacion en una carpeta con su Grafema.exe...
call npx --yes @electron/packager . Grafema --platform=win32 --arch=x64 --out=dist-carpeta --overwrite --icon=build\icon.ico --ignore="^/(dist|dist-carpeta|tests)($|/)"
if errorlevel 1 goto fallo_build
echo.
echo  LISTO (version en carpeta, sin instalador). Abre:
echo    dist-carpeta\Grafema-win32-x64\Grafema.exe
start "" explorer "%~dp0dist-carpeta"
pause
exit /b 0

:listo
echo.
echo  ============================================================
echo    LISTO. Instaladores creados en la carpeta dist:
echo  ============================================================
dir /b dist\*.exe
echo.
echo    Grafema-Instalador-1.2.0.exe  = instalador completo para Windows
echo    Grafema-Portatil-1.2.0.exe    = version portatil sin instalar
start "" explorer "%~dp0dist"
pause
exit /b 0

:fallo_npm
echo.
echo  No se pudieron descargar las dependencias. Revisa tu conexion a internet
echo  y vuelve a ejecutar este archivo. Si usas proxy o antivirus, desactiva
echo  temporalmente el bloqueo de npm.
pause
exit /b 1

:fallo_build
echo.
echo  No se pudo crear el .exe. Copia el texto rojo de arriba y envialo a soporte.
echo  Sugerencias: ejecuta este archivo como administrador, activa el Modo
echo  desarrollador de Windows, o desactiva temporalmente el antivirus.
pause
exit /b 1
