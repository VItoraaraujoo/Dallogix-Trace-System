param(
    [string]$PackageRoot = (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path))
)
$ErrorActionPreference = "Stop"

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Execute o instalador como administrador."
}
if (-not (Get-Command docker.exe -ErrorAction SilentlyContinue)) {
    throw "Docker Desktop precisa estar instalado antes do TraceSetup.exe."
}

$configDir = Join-Path $PackageRoot "config"
$envPath = Join-Path $PackageRoot ".env"
New-Item -ItemType Directory -Force -Path $configDir | Out-Null

$updateDefaults = [ordered]@{
    UPDATE_MANIFEST_URL = "https://github.com/VItoraaraujoo/Dallogix-Trace-System/releases/latest/download/manifest.json"
    UPDATE_PUBLIC_KEY_FILE = (Join-Path $PackageRoot "servidor\configuracao\trace-update-public.pem")
    UPDATE_CHANNEL = "stable"
}
$envLines = [System.Collections.Generic.List[string]]::new()
if (Test-Path $envPath) {
    Get-Content $envPath | ForEach-Object { $envLines.Add([string]$_) }
}
foreach ($entry in $updateDefaults.GetEnumerator()) {
    $pattern = "^\s*$([regex]::Escape($entry.Key))=(.*)$"
    $found = $false
    for ($index = 0; $index -lt $envLines.Count; $index++) {
        if ($envLines[$index] -match $pattern) {
            $found = $true
            $configuredValue = $Matches[1].Trim().Trim('"').Trim("'")
            if (-not $configuredValue) { $envLines[$index] = "$($entry.Key)=$($entry.Value)" }
            break
        }
    }
    if (-not $found) { $envLines.Add("$($entry.Key)=$($entry.Value)") }
}
[System.IO.File]::WriteAllText(
    $envPath,
    (($envLines -join [Environment]::NewLine) + [Environment]::NewLine),
    ([System.Text.UTF8Encoding]::new($false))
)

function Ask([string]$Label, [string]$Default = "") {
    $suffix = if ($Default) { " [$Default]" } else { "" }
    $value = Read-Host "$Label$suffix"
    if (-not $value -and $Default) { return $Default }
    return $value
}

$centralUrl = Ask "URL HTTPS do servidor central" "https://trace.santocloud.com.br"
$centralUri = $null
if (-not [Uri]::TryCreate($centralUrl, [UriKind]::Absolute, [ref]$centralUri) -or
    $centralUri.Scheme -ne 'https' -or $centralUri.AbsolutePath -ne '/' -or
    $centralUri.Query -or $centralUri.Fragment -or $centralUri.UserInfo) {
    throw 'Informe apenas a origem HTTPS do servidor Central.'
}
$expectedVersion = [IO.File]::ReadAllText((Join-Path $PackageRoot 'trace-build-version.txt')).Trim()
$expectedCommit = [IO.File]::ReadAllText((Join-Path $PackageRoot 'trace-build-commit.txt')).Trim()
$centralHealth = Invoke-RestMethod -Uri ($centralUrl.TrimEnd('/') + '/api/health.php') -TimeoutSec 15
if ($centralHealth.status -ne 'ok' -or $centralHealth.installation_mode -ne 'central' -or
    $centralHealth.version -ne $expectedVersion -or $centralHealth.commit -ne $expectedCommit) {
    throw "O servidor Central ainda nao serve $expectedVersion no commit $expectedCommit. A instalacao local nao sera iniciada."
}
& powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PackageRoot "implantacao\windows\Instalar-TraceLocal.ps1") -PackageRoot $PackageRoot -CentralUrl $centralUrl -NoBrowser -ProductionMachine
if ($LASTEXITCODE -ne 0) { throw "A instalacao local falhou; a maquina nao foi vinculada." }

$machineId = Ask "Identificação da máquina" "EST-001"
$equipmentId = Ask "ID do equipamento no cadastro central" "1"
$equipmentCode = Ask "Código do equipamento" $machineId
$deviceToken = Read-Host "Token do dispositivo SERVER da máquina"
$traceUrl = Ask "URL local do Trace" "http://127.0.0.1:8080"
$physicalConnection = (Ask "A máquina terá conexão prevista com CLP físico? (S/N)" "N").ToUpperInvariant() -eq "S"

$machineConfig = [ordered]@{
    machine_id = $machineId
    equipment_id = [int]$equipmentId
    equipment_code = $equipmentCode
    central_api_url = $centralUrl
    device_token = $deviceToken
    trace_url = $traceUrl
    heartbeat_seconds = 30
    operation_mode = if ($physicalConnection) { "PHYSICAL" } else { "SIMULATED" }
    # A resposta do instalador nao comprova o mapa de I/O nem autoriza escrita.
    physical_clp_enabled = $false
    io_map_status = "CONFIRMAR"
}
$machineConfig | ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $configDir "machine.json") -Encoding UTF8

& powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PackageRoot "implantacao\windows\Install-TraceMachine.ps1") -PackageRoot $PackageRoot -MachineConfig (Join-Path $configDir "machine.json")
if ($LASTEXITCODE -ne 0) { throw "A preparacao da maquina falhou." }
Write-Output "Configuração concluída. Escritas no CLP permanecem bloqueadas até a aprovação do mapa oficial de I/O."
Write-Output "O Trace será iniciado automaticamente com o Windows."
