# Publica Mi CRM en Railway y deja la URL y las claves en CREDENCIALES.txt.
# Se puede volver a ejecutar: los pasos ya hechos se saltan y solo se sube la nueva version.
$ErrorActionPreference = "Continue"
Set-Location (Split-Path $PSScriptRoot -Parent)

function Paso($texto) { Write-Host ""; Write-Host "==> $texto" -ForegroundColor Cyan }
function Fallo($texto) {
  Write-Host ""; Write-Host "ERROR: $texto" -ForegroundColor Red
  Write-Host "Puedes volver a ejecutar PUBLICAR.bat; los pasos ya completados se saltan." -ForegroundColor Yellow
  exit 1
}

$cli = "@railway/cli@5.70.0"
function Railway { & npx --yes $cli @args; if ($LASTEXITCODE -ne 0) { Fallo "railway $($args -join ' ')" } }
function RailwaySalida { (& npx --yes $cli @args 2>&1 | Out-String) }

# Pasos completados, para poder repetir el script sin duplicar el proyecto.
$marcas = ".railway-listo"
$hechos = @(); if (Test-Path $marcas) { $hechos = @(Get-Content $marcas) }
function Hecho($p) { return $hechos -contains $p }
function Marcar($p) { Add-Content $marcas $p; $script:hechos += $p }

Paso "Comprobando Node.js"
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "Instalando Node.js (acepta la ventana de permisos si aparece)..."
  winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
  $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fallo "No se pudo instalar Node.js. Instalalo desde https://nodejs.org y repite." }
}
node -v

Paso "Leyendo tus claves de .env"
if (-not (Test-Path .env)) { Fallo "No encuentro el archivo .env en $(Get-Location)" }
$cfg = @{}
foreach ($linea in Get-Content .env) { if ($linea -match '^\s*([A-Z_]+)\s*=\s*(.+?)\s*$') { $cfg[$Matches[1]] = $Matches[2] } }
foreach ($k in "CRM_PASSWORD", "CRM_API_KEY", "CRM_SECRET") { if (-not $cfg[$k]) { Fallo "Falta $k en .env" } }

Paso "Iniciando sesion en Railway (se abrira el navegador; si no tienes cuenta, se crea ahi mismo)"
& npx --yes $cli whoami 2>$null
if ($LASTEXITCODE -ne 0) { Railway login }

if (-not (Hecho "proyecto")) {
  Paso "Creando el proyecto 'mi-crm'"
  Railway init --name mi-crm
  Marcar "proyecto"
}
if (-not (Hecho "servicio")) {
  Paso "Creando el servicio 'crm' con tus claves"
  Railway add --service crm `
    --variables "CRM_PASSWORD=$($cfg.CRM_PASSWORD)" `
    --variables "CRM_API_KEY=$($cfg.CRM_API_KEY)" `
    --variables "CRM_SECRET=$($cfg.CRM_SECRET)" `
    --variables "CRM_DB_PATH=/data/crm.db" `
    --variables "PORT=3000"
  Marcar "servicio"
}
Railway service link crm
if ($cfg.CRM_ALLOWED_ORIGINS) {
  # Webs autorizadas a enviar formularios al CRM (se actualiza en cada ejecucion).
  Railway variable set "CRM_ALLOWED_ORIGINS=$($cfg.CRM_ALLOWED_ORIGINS)" --service crm --skip-deploys
}
if (-not (Hecho "disco")) {
  Paso "Creando el disco donde se guardan los datos"
  Railway volume add --mount-path /data
  Marcar "disco"
}

Paso "Subiendo y construyendo el CRM (tarda 2-4 minutos)"
Railway up --ci --service crm

Paso "Creando la direccion publica"
$salida = RailwaySalida domain --service crm --port 3000
if ($salida -notmatch '([a-z0-9-]+\.up\.railway\.app)') { $salida = RailwaySalida domain list --service crm }
if ($salida -notmatch '([a-z0-9-]+\.up\.railway\.app)') { Write-Host $salida; Fallo "No pude obtener la URL. Mira en https://railway.com/dashboard > mi-crm > crm > Settings > Networking." }
$url = "https://$($Matches[1])"
$urlRailway = $url

$dominio = $cfg.CRM_DOMINIO
$dnsTexto = ""
if ($dominio) {
  Paso "Conectando tu dominio $dominio"
  if (-not (Hecho "dominio")) {
    $dns = RailwaySalida domain $dominio --service crm --port 3000
    Write-Host $dns
    $dnsTexto = @"
CONECTAR $dominio AL CRM
========================

Entra en el panel donde gestionas el DNS de tu dominio (NIC Chile, Cloudflare, tu hosting...)
y crea EXACTAMENTE los registros que indica Railway aqui abajo (normalmente un CNAME
con nombre "$($dominio.Split('.')[0])" y, a veces, un TXT de verificacion):

$dns

Si no aparecen registros arriba, miralos en: https://railway.com/dashboard > mi-crm > crm > Settings > Networking.

Tras guardarlos, el dominio tarda entre 5 minutos y unas horas en activarse.
Mientras tanto el CRM funciona en: $urlRailway
"@
    Set-Content -Encoding UTF8 DNS-DOMINIO.txt $dnsTexto
    Marcar "dominio"
    Start-Process notepad DNS-DOMINIO.txt
  }
  $url = "https://$dominio"
}

Paso "Esperando a que $urlRailway responda"
$listo = $false
for ($i = 0; $i -lt 40 -and -not $listo; $i++) {
  try { if ((Invoke-WebRequest "$urlRailway/api/health" -UseBasicParsing -TimeoutSec 10).StatusCode -eq 200) { $listo = $true } } catch { Start-Sleep 5 }
}
if (-not $listo) { Write-Host "Aun no responde (puede tardar un par de minutos mas en activarse la URL)." -ForegroundColor Yellow }

$credenciales = @"
MI CRM - CREDENCIALES (no compartas este archivo)
==================================================

Web del CRM:      $url
URL de Railway:   $urlRailway   (funciona siempre, aunque el dominio aun no este activo)
Contrasena web:   $($cfg.CRM_PASSWORD)

API para Emergent
  URL base:       $url
  Clave API:      $($cfg.CRM_API_KEY)
  Cabecera:       x-api-key: <Clave API>
  Especificacion: $url/api/openapi.json
  Comprobacion:   $url/api/health   (debe decir {"ok":true})

Formularios de tu web: pega web\formulario-transfiereloo.html en la pagina de contacto.
  Webs autorizadas: $($cfg.CRM_ALLOWED_ORIGINS)

Panel de Railway: https://railway.com/dashboard
"@
Set-Content -Encoding UTF8 CREDENCIALES.txt $credenciales

$emergent = @"
PEGA ESTO EN EMERGENT
=====================

1) En Emergent, anade un secreto / variable de entorno:
   Nombre: CRM_API_KEY
   Valor:  $($cfg.CRM_API_KEY)

2) Escribe este mensaje (cambia la ultima linea por lo que quieras construir):

Quiero que esta app se conecte a mi CRM existente mediante su API REST.
- URL base: $url
- Especificacion OpenAPI: $url/api/openapi.json (pide la cabecera x-api-key)
- Autenticacion: cabecera "x-api-key" con el valor de la variable de entorno CRM_API_KEY.
- Llama a la API solo desde el backend, nunca desde el navegador.
- Recursos: /api/contacts, /api/companies, /api/deals, /api/tasks (GET lista con ?q=, POST crea, GET/PATCH/DELETE /api/{recurso}/{id}).
Construye: un formulario de captacion de clientes que cree un contacto con status "lead" y una tarea "Llamar a {nombre}" con fecha a 2 dias vista.
"@
Set-Content -Encoding UTF8 EMERGENT.txt $emergent

Paso "LISTO"
Write-Host $credenciales -ForegroundColor Green
Start-Process $urlRailway
Start-Process notepad CREDENCIALES.txt
