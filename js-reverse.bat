@echo off
setlocal enabledelayedexpansion

REM JS Reverse MCP - Windows 启动脚本
REM 用法：js-reverse.bat <command> [options]

set "SCRIPT_DIR=%~dp0"
set "CLI_PATH=%SCRIPT_DIR%build\src\bin\js-reverse.js"

REM 检查是否已构建
if not exist "%CLI_PATH%" (
    echo [未检测到构建产物，先执行构建...]
    call npm run build
    if errorlevel 1 (
        echo 构建失败，请检查 Node.js 版本 (需要 v20.19.0+)
        exit /b 1
    )
)

REM 执行 CLI 命令
node "%CLI_PATH%" %*
