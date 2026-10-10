@echo off
rem Double-click to start CreatorVerse AI. The browser opens once the server is ready.
rem Keep this window open while using the site; close it (or press Ctrl+C) to stop.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1" -Open
if errorlevel 1 pause
