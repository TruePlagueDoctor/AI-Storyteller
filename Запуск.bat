@echo off
chcp 65001 >nul
title Хроника — ИИ-рассказчик
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Не найден Node.js. Скачай и установи LTS-версию: https://nodejs.org
  echo  Потом запусти этот файл ещё раз.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\express" (
  echo  Первый запуск: ставлю зависимости, это минута...
  call npm.cmd install --no-audit --no-fund
  if errorlevel 1 (
    echo  Не получилось установить зависимости. Проверь интернет и запусти ещё раз.
    pause
    exit /b 1
  )
)

if not exist ".env" (
  copy ".env.example" ".env" >nul
  echo.
  echo  Создан файл .env — впиши в него ключ OpenRouter после OPENROUTER_API_KEY=
  echo  Ключ берётся здесь: https://openrouter.ai/keys
  echo  Сохрани файл и закрой Блокнот — игра запустится.
  echo.
  notepad ".env"
)

set OPEN_BROWSER=1
echo  Сервер запускается. Игра откроется в браузере.
echo  Чтобы остановить — закрой это окно.
echo.
node server.js
echo.
echo  Сервер остановился.
pause
