@echo off
setlocal EnableExtensions
chcp 65001 >nul

set "REPO_DIR=%~dp0.."
set "TARGET_DIR=%USERPROFILE%\.gemini\config\plugins\context-monitor"

echo =======================================================
echo  Antigravity 上下文与 Token 监控插件 - Windows 一键安装
echo =======================================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [错误] 未检测到 Node.js，请先安装 Node.js 18+：https://nodejs.org
  pause
  exit /b 1
)

if not exist "%REPO_DIR%\dist\server.cjs" (
  echo [错误] 未找到预编译产物 dist\server.cjs，请先运行 npm install ^&^& npm run build
  pause
  exit /b 1
)

if not exist "%TARGET_DIR%\assets" mkdir "%TARGET_DIR%\assets"
if not exist "%TARGET_DIR%\dist" mkdir "%TARGET_DIR%\dist"

copy /y "%REPO_DIR%\plugin.json" "%TARGET_DIR%\plugin.json" >nul
copy /y "%REPO_DIR%\mcp_config.json" "%TARGET_DIR%\mcp_config.json" >nul
if exist "%REPO_DIR%\README.md" copy /y "%REPO_DIR%\README.md" "%TARGET_DIR%\README.md" >nul
copy /y "%REPO_DIR%\assets\logo.svg" "%TARGET_DIR%\assets\logo.svg" >nul
copy /y "%REPO_DIR%\dist\server.cjs" "%TARGET_DIR%\dist\server.cjs" >nul
copy /y "%REPO_DIR%\dist\app.html" "%TARGET_DIR%\dist\app.html" >nul

echo [完成] 插件已安装至：%TARGET_DIR%
echo.
echo 使用方法（无需重启 Antigravity）：
echo   1. 对话右侧辅助栏点击「+」-^> 选择「上下文监控」
echo   2. 或在左侧导航栏点击「上下文监控」全屏查看
echo.
pause
endlocal
