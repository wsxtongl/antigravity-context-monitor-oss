@echo off
setlocal EnableExtensions
chcp 65001 >nul

set "TARGET_DIR=%USERPROFILE%\.gemini\config\plugins\context-monitor"

if not exist "%TARGET_DIR%" (
  echo [提示] 未检测到已安装的插件目录：%TARGET_DIR%
  pause
  exit /b 0
)

rmdir /s /q "%TARGET_DIR%"
echo [完成] 已卸载插件：%TARGET_DIR%
echo （注：Antigravity 客户端原版文件从未被修改。）
pause
endlocal
