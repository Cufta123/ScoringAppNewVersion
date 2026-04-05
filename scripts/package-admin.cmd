@echo off
setlocal

REM Self-elevate to Administrator if needed.
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Requesting Administrator privileges...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

cd /d "%~dp0.."
echo Working directory: %cd%

echo.
echo [1/3] Installing dependencies...
call npm install
if %errorlevel% neq 0 goto :fail

echo.
echo [2/3] Cleaning previous build output...
if exist "release\build" rmdir /s /q "release\build"

echo.
echo [3/3] Building and packaging app...
call npm run package
if %errorlevel% neq 0 goto :fail

echo.
echo Build completed successfully.
echo Output folder: %cd%\release\build
echo Unpacked app: %cd%\release\build\win-unpacked
goto :end

:fail
echo.
echo Build failed with exit code %errorlevel%.

:end
echo.
pause
endlocal
