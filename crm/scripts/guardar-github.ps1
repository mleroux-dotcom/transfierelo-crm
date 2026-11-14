# Guarda el codigo del CRM en un repositorio PRIVADO de tu cuenta de GitHub.
# El archivo .env (tus claves) NO se sube: esta excluido en .gitignore.
$ErrorActionPreference = "Continue"
Set-Location (Split-Path $PSScriptRoot -Parent)
function Paso($t) { Write-Host ""; Write-Host "==> $t" -ForegroundColor Cyan }
function Fallo($t) { Write-Host ""; Write-Host "ERROR: $t" -ForegroundColor Red; exit 1 }
function Recargar { $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User") }

Paso "Comprobando Git y GitHub CLI"
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { winget install --id Git.Git -e --accept-source-agreements --accept-package-agreements; Recargar }
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { winget install --id GitHub.cli -e --accept-source-agreements --accept-package-agreements; Recargar }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Fallo "Instala Git desde https://git-scm.com/download/win y repite." }
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { Fallo "Instala GitHub CLI desde https://cli.github.com y repite." }

if (-not (Test-Path .git)) {
  git init -b main
  git add -A
  git -c user.name="Mi CRM" -c user.email="crm@localhost" commit -m "Codigo del CRM"
}

Paso "Iniciando sesion en GitHub (se abrira el navegador; si no tienes cuenta, creala en github.com)"
gh auth status 2>$null
if ($LASTEXITCODE -ne 0) { gh auth login --web --git-protocol https; if ($LASTEXITCODE -ne 0) { Fallo "No se pudo iniciar sesion en GitHub." } }
gh auth setup-git

$usuario = (gh api user --jq .login).Trim()
git config user.name $usuario
git config user.email "$usuario@users.noreply.github.com"

Paso "Guardando cambios locales"
git add -A
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) { git commit -m "Cambios del $(Get-Date -Format 'yyyy-MM-dd HH:mm')" }

git remote get-url origin 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
  Paso "Creando el repositorio privado $usuario/mi-crm"
  gh repo create mi-crm --private --source . --remote origin --push
  if ($LASTEXITCODE -ne 0) { Fallo "No se pudo crear el repositorio (quizas ya existe uno llamado mi-crm en tu cuenta)." }
} else {
  Paso "Subiendo cambios"
  git push -u origin main
  if ($LASTEXITCODE -ne 0) { Fallo "No se pudo subir a GitHub." }
}

$url = "https://github.com/$usuario/mi-crm"
Paso "LISTO: tu codigo esta guardado en $url (privado)"
Write-Host "Cada vez que cambies algo, vuelve a ejecutar GUARDAR-EN-GITHUB.bat." -ForegroundColor Green
Start-Process $url
