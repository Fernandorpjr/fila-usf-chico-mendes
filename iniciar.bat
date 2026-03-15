@echo off
echo ========================================
echo  SISTEMA DE FILAS - USF CHICO MENDES
echo ========================================
echo.

REM Check if node_modules exists
if not exist "node_modules\" (
    echo [1/3] Instalando dependencias...
    call npm install
    if errorlevel 1 (
        echo.
        echo ERRO: Falha na instalacao das dependencias.
        echo Verifique se o Node.js esta instalado.
        pause
        exit /b 1
    )
) else (
    echo [1/3] Dependencias ja instaladas.
)

echo.
echo [2/3] Iniciando servidor...
echo.
echo [3/3] Acesse: http://localhost:3000
echo.
echo Para parar: Pressione CTRL+C
echo ========================================
echo.

REM Start the server
call npm start

pause
