@echo off
echo ================================
echo Building TestHub Backend...
echo ================================

C:\msys64\ucrt64\bin\gcc.exe backend\main.c ^
-o backend\server.exe ^
-I"C:\msys64\ucrt64\include" ^
-L"C:\msys64\ucrt64\lib" ^
-lmariadb ^
-lws2_32 ^
-lbcrypt

if errorlevel 1 (
    echo.
    echo ================================
    echo BUILD FAILED
    echo ================================
    pause
    exit /b 1
)

echo.
echo ================================
echo BUILD SUCCESSFUL
echo ================================
echo server.exe created successfully.
echo.

pause