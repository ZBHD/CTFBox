@echo off
setlocal
set PYTHONDONTWRITEBYTECODE=1
where py >nul 2>nul
if errorlevel 1 goto python
py -3 "%~dp0SSTImap-master\sstimap.py" %*
exit /b %ERRORLEVEL%

:python
python "%~dp0SSTImap-master\sstimap.py" %*
exit /b %ERRORLEVEL%
