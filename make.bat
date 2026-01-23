@echo off
setlocal

set VENV=.venv
set PYTHON=%VENV%\Scripts\python.exe
set PIP=%VENV%\Scripts\pip.exe
set DIST_DIR=_site

if "%1"=="" goto build
if "%1"=="build" goto build
if "%1"=="install" goto install
if "%1"=="dist" goto dist
if "%1"=="clean" goto clean
if "%1"=="deepclean" goto deepclean
if "%1"=="help" goto help

echo Unknown command: %1
goto help

:install
if not exist %VENV% (
    echo Creating virtual environment...
    python -m pip install --upgrade pip
    python -m venv %VENV%
    %PIP% install -r requirements.txt
)
goto :eof

:build
if not exist %VENV% call :install
%PYTHON% prepareSite.py -n 25 -q 85
goto :eof

:dist
if not exist %VENV% call :install
call :build
if exist %DIST_DIR% rd /s /q %DIST_DIR%
mkdir %DIST_DIR%
copy index.html %DIST_DIR%\ >nul
copy immersive.html %DIST_DIR%\ >nul
copy license.html %DIST_DIR%\ >nul
copy LICENSE %DIST_DIR%\ >nul
xcopy css %DIST_DIR%\css\ /S /E /I /Y >nul
xcopy js %DIST_DIR%\js\ /S /E /I /Y >nul
xcopy fulls %DIST_DIR%\fulls\ /S /E /I /Y >nul
xcopy metadata %DIST_DIR%\metadata\ /S /E /I /Y >nul
xcopy thumbs %DIST_DIR%\thumbs\ /S /E /I /Y >nul
echo Distribution prepared in %DIST_DIR%
goto :eof

:clean
if exist thumbs rd /s /q thumbs
if exist metadata rd /s /q metadata
if exist %DIST_DIR% rd /s /q %DIST_DIR%
echo Cleaned build artifacts.
goto :eof

:deepclean
call :clean
if exist %VENV% rd /s /q %VENV%
echo Removed virtual environment.
goto :eof

:help
echo Gallery Build System Commands:
echo   make.bat install   - Create virtual environment and install dependencies
echo   make.bat build     - Build the site using the local environment (default)
echo   make.bat clean     - Remove build artifacts (thumbs, metadata, _site)
echo   make.bat deepclean - Remove artifacts and the virtual environment
echo   make.bat dist      - Prepare the _site directory for deployment
echo   make.bat help      - Show this help message
goto :eof
