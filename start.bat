@echo off
echo Starting Gewardz Partner Discovery...
echo.

cd /d "%~dp0"

IF NOT EXIST "backend\node_modules" (
  echo Installing backend dependencies...
  cd backend && npm install && cd ..
)

IF NOT EXIST "frontend\node_modules" (
  echo Installing frontend dependencies...
  cd frontend && npm install && cd ..
)

echo.
echo Starting backend on http://localhost:3001
echo Starting frontend on http://localhost:5173
echo.
echo Open http://localhost:5173 in your browser.
echo Press Ctrl+C to stop.
echo.

start "Gewardz Backend" cmd /k "cd /d %~dp0backend && npm run dev"
timeout /t 2 /noisy >nul
start "Gewardz Frontend" cmd /k "cd /d %~dp0frontend && npm run dev"
