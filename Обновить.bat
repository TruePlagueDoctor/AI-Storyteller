@echo off
chcp 65001 >nul
title Хроника — обновление

rem Скрипт копирует себя во временную папку и работает оттуда: при обновлении
rem из архива он перезапишет и этот файл, а Windows читает .bat по ходу выполнения.
if not "%~1"=="--run" (
  copy /y "%~f0" "%TEMP%\hronika-update.bat" >nul
  call "%TEMP%\hronika-update.bat" --run "%~dp0"
  exit /b
)
set "APP=%~2"
cd /d "%APP%"

echo.
echo  Обновление Хроники. Партии (папка data) и ключ (.env) не трогаются.
echo  Если игра запущена — сначала закрой окно сервера.
echo.
pause

if not exist ".git" goto zip
where git >nul 2>nul
if errorlevel 1 goto zip
echo  Забираю свежую версию через git...
git pull --ff-only
if not errorlevel 1 goto deps
echo.
echo  git не смог обновиться — похоже, файлы проекта менялись вручную. Обновляю из архива поверх.

:zip
set "TMPZIP=%TEMP%\hronika-update.zip"
set "TMPDIR=%TEMP%\hronika-update"
echo  Скачиваю свежую версию...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri 'https://github.com/TruePlagueDoctor/AI-Storyteller/archive/refs/heads/main.zip' -OutFile $env:TMPZIP; if (Test-Path $env:TMPDIR) { Remove-Item -Recurse -Force $env:TMPDIR }; Expand-Archive -Path $env:TMPZIP -DestinationPath $env:TMPDIR -Force"
if errorlevel 1 goto netfail
rem Копируем поверх всё, кроме партий, ключа и зависимостей.
robocopy "%TMPDIR%\AI-Storyteller-main" "%APP%." /E /XD data node_modules .git /XF .env /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 goto copyfail
rmdir /s /q "%TMPDIR%" 2>nul
del "%TMPZIP%" 2>nul

:deps
echo  Обновляю зависимости...
call npm.cmd install --no-audit --no-fund
echo.
echo  Готово. Запускай Запуск.bat и обнови страницу в браузере: Ctrl+F5.
echo.
pause
exit /b 0

:netfail
echo  Не удалось скачать обновление. Проверь интернет и попробуй ещё раз.
pause
exit /b 1

:copyfail
echo  Не удалось скопировать файлы обновления. Закрой окно сервера и попробуй ещё раз.
pause
exit /b 1
