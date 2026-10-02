param(
    [string]$PackageRoot = (Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path))),
    [string]$MachineConfig = (Join-Path $PSScriptRoot "machine-config.json")
)
$ErrorActionPreference = "Stop"

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Execute a preparação inicial com uma conta técnica administradora."
}
$compose = Join-Path $PackageRoot "docker-compose.yml"
$envFile = Join-Path $PackageRoot ".env"
if (-not (Test-Path $compose)) { throw "Pacote sem docker-compose.yml: $PackageRoot" }
if (-not (Test-Path $envFile)) { throw "O .env deve ser entregue previamente pela Dallogix." }
if (-not (Test-Path $MachineConfig)) { throw "machine.json deve ser criado pela Dallogix antes da instalação." }
if (-not (Get-Command docker.exe -ErrorAction SilentlyContinue)) { throw "Docker Desktop não está instalado." }

$config = Get-Content $MachineConfig -Raw | ConvertFrom-Json
if (-not $config.machine_id -or -not $config.central_api_url) { throw "machine.json sem identidade ou servidor central." }
$equipmentId = if ($null -eq $config.equipment_id) { 0 } else { [int]$config.equipment_id }
$equipmentCode = if ($null -eq $config.equipment_code) { "" } else { [string]$config.equipment_code }
$deviceToken = if ($null -eq $config.device_token) { "" } else { [string]$config.device_token }
$hasEquipment = $equipmentId -gt 0
if ($hasEquipment -and ([string]::IsNullOrWhiteSpace($equipmentCode) -or [string]::IsNullOrWhiteSpace($deviceToken))) {
    throw "machine.json tem uma Dala, mas falta o código ou o token do dispositivo SERVER."
}
if (-not $hasEquipment -and (-not [string]::IsNullOrWhiteSpace($equipmentCode) -or -not [string]::IsNullOrWhiteSpace($deviceToken))) {
    throw "machine.json sem Dala não pode conter código ou token de dispositivo."
}
if ($config.physical_clp_enabled -eq $true -and $config.io_map_status -ne "APPROVED") { throw "Instalação física bloqueada sem mapa de I/O aprovado." }

$installRoot = (Resolve-Path -LiteralPath $PackageRoot).Path
$configDir = Join-Path $installRoot "config"
New-Item -ItemType Directory -Force -Path $configDir | Out-Null
if ((Resolve-Path -LiteralPath $MachineConfig).Path -ne (Join-Path $configDir "machine.json")) {
    Copy-Item $MachineConfig (Join-Path $configDir "machine.json") -Force
}
Set-Location $PackageRoot
& docker.exe compose --profile industrial up -d
if ($LASTEXITCODE -ne 0) { throw "Nao foi possivel iniciar os containers do Trace." }

& powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PackageRoot "implantacao\windows\Register-TraceUpdater.ps1") -PackageRoot $PackageRoot
if ($LASTEXITCODE -ne 0) { throw "Nao foi possivel registrar a atualizacao automatica de producao." }
$taskPrincipal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
if ($hasEquipment) {
    $agentScript = Join-Path $PackageRoot "implantacao\windows\TraceAgent.ps1"
    $taskAction = New-ScheduledTaskAction -Execute "PowerShell.exe" -Argument "-NoLogo -NoProfile -ExecutionPolicy Bypass -File `"$agentScript`" -ConfigPath `"$configDir\machine.json`""
    $taskTrigger = New-ScheduledTaskTrigger -AtStartup
    Register-ScheduledTask -TaskName "Dallogix Trace Agent" -Action $taskAction -Trigger $taskTrigger -Principal $taskPrincipal -Force | Out-Null
    Start-ScheduledTask -TaskName "Dallogix Trace Agent"
    Write-Output "Agente do PC industrial registrado para a Dala $equipmentCode."
} else {
    Unregister-ScheduledTask -TaskName "Dallogix Trace Agent" -Confirm:$false -ErrorAction SilentlyContinue
    Write-Output "PC industrial instalado sem Dala; o agente será registrado após o vínculo da primeira Dala."
}
$updaterScript = Join-Path $PackageRoot "implantacao\windows\TraceUpdater.ps1"
if (-not (Test-Path $updaterScript)) { throw "Atualizador do Trace não encontrado: $updaterScript" }
$updateAction = New-ScheduledTaskAction -Execute "PowerShell.exe" -Argument "-NoLogo -NoProfile -ExecutionPolicy Bypass -File `"$updaterScript`""
$updateTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration (New-TimeSpan -Days 3650)
$updateSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
Register-ScheduledTask -TaskName "Dallogix Trace Atualizacao" -Action $updateAction -Trigger $updateTrigger -Principal $taskPrincipal -Settings $updateSettings -Force | Out-Null
Write-Output "Máquina preparada: $($config.machine_id). Modo: $($config.operation_mode). CLP físico habilitado: $($config.physical_clp_enabled)."
Write-Output "Sincronização automática com a master configurada a cada minuto."
