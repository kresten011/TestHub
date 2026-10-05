@echo off
echo Building TestHub backend...

C:\msys64\ucrt64\bin\gcc.exe backend\main.c ^
-o backend\server.exe ^
-I"C:\msys64\ucrt64\include\mysql" ^
-L"C:\msys64\ucrt64\lib" ^
-lmariadb ^
-lws2_32 ^
-lbcrypt

if errorlevel 1 (
    echo.
    echo BUILD FAILED!
    pause
    exit /b 1
)

echo.
echo BUILD SUCCESSFUL!
echo.
pause