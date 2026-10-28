@echo off
chcp 65001 >nul
echo ========================================================
echo   Iniciando o Motor Scraper Nativo (Porta 8080)...
echo ========================================================
.\gmaps-scraper.exe -web -data-folder gmapsdata
pause
