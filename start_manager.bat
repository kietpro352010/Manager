@echo off
title KingMC - Manager [Local Control Plane]
color 0B
cd /d D:\manager
echo ========================================================
echo   KINGMC MANAGER - LOCAL SERVER STARTING
echo ========================================================
node src/index.js 2>&1 | powershell -Command "$input | Tee-Object -FilePath 'D:\manager\manager.log'"
pause
