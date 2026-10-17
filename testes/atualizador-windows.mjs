import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const updaterRegistration = readFileSync(new URL("../implantacao/windows/Register-TraceUpdater.ps1", import.meta.url), "utf8");
const updaterScript = readFileSync(new URL("../implantacao/windows/TraceUpdater.ps1", import.meta.url), "utf8");
const releaseWorkflow = readFileSync(new URL("../.github/workflows/release-production.yml", import.meta.url), "utf8");
const machineInstaller = readFileSync(new URL("../implantacao/windows/Install-TraceMachine.ps1", import.meta.url), "utf8");
const localInstaller = readFileSync(new URL("../implantacao/windows/Instalar-TraceLocal.ps1", import.meta.url), "utf8");
const traceLauncher = readFileSync(new URL("../implantacao/windows/TraceLauncher.ps1", import.meta.url), "utf8");
const databaseVolumeGuard = readFileSync(new URL("../implantacao/windows/TraceDatabaseVolume.ps1", import.meta.url), "utf8");
const databaseBackup = readFileSync(new URL("../implantacao/windows/TraceDatabaseBackup.ps1", import.meta.url), "utf8");
const setupPackage = readFileSync(new URL("../implantacao/windows/TraceSetup.iss", import.meta.url), "utf8");
const masterHomologationUpdater = readFileSync(new URL("../implantacao/windows/auto-master-homologacao/Atualizar.ps1", import.meta.url), "utf8");
const setupMachine = readFileSync(new URL("../implantacao/windows/Setup-TraceMachine.ps1", import.meta.url), "utf8");
const dockerStarter = readFileSync(new URL("../implantacao/windows/Start-TraceDocker.ps1", import.meta.url), "utf8");
const desktopProgram = readFileSync(new URL("../desktop/DallogixTrace/Program.cs", import.meta.url), "utf8");

test("quiosque bloqueia gestos de zoom e navegação por deslize", () => {
  assert.match(desktopProgram, /Settings\.IsZoomControlEnabled = false/);
  assert.match(desktopProgram, /Settings\.IsPinchZoomEnabled = false/);
  assert.match(desktopProgram, /Settings\.IsSwipeNavigationEnabled = false/);
});

test("quiosque tenta recuperar travamentos do WebView com limite de tentativas", () => {
  assert.match(desktopProgram, /ProcessFailed \+= RecoverWebViewAfterRendererFailure/);
assert.match(desktopProgram, /NavigationCompleted \+= RecoverWebViewAfterNavigationFailure/);
assert.match(desktopProgram, /CoreWebView2WebErrorStatus\.OperationCanceled/);
  assert.match(desktopProgram, /CoreWebView2ProcessFailedKind\.RenderProcessExited/);
  assert.match(desktopProgram, /CoreWebView2ProcessFailedKind\.RenderProcessUnresponsive/);
  assert.match(desktopProgram, /webRecoveryAttempts >= 3/);
  assert.match(desktopProgram, /NavigateToTraceAsync\(TimeSpan\.FromSeconds\(15\)\)/);
});

test("atualizador estável fica agendado diariamente com a conta SYSTEM", () => {
  assert.match(updaterRegistration, /\$taskName = 'Dallogix Trace Atualizacao Estavel'/);
  assert.match(updaterRegistration, /New-ScheduledTaskTrigger -Daily -At '03:00'/);
  assert.match(updaterRegistration, /New-ScheduledTaskTrigger -AtLogOn -RandomDelay \(New-TimeSpan -Minutes 10\)/);
  assert.match(updaterRegistration, /\$trigger = @\(\$dailyTrigger, \$logonTrigger\)/);
  assert.match(updaterRegistration, /New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest/);
  assert.match(updaterRegistration, /New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit \(New-TimeSpan -Hours 2\) -RestartCount 12 -RestartInterval \(New-TimeSpan -Minutes 5\)/);
  assert.match(updaterRegistration, /12 novas tentativas a cada 5 minutos/);
});

test("registro valida Docker pela conta da tarefa antes de agendar atualização", () => {
  assert.match(updaterRegistration, /-File `"\$updater`" -Preflight/);
  assert.match(updaterRegistration, /preflight-ok\.txt/);
  assert.match(updaterRegistration, /Start-ScheduledTask -TaskName \$preflightTask/);
  assert.match(updaterRegistration, /A conta SYSTEM nao conseguiu acessar o Docker Linux/);
});

test("falha de pré-requisito do atualizador deixa diagnóstico persistente", () => {
  assert.match(updaterScript, /Start-Transcript -Path \(Join-Path \$LogRoot \"update-stable\.log\"\)/);
  assert.match(updaterScript, /function Fail-Preflight/);
  assert.match(updaterScript, /Fail-Preflight \"Docker Desktop não está disponível\.\"/);
  assert.match(updaterScript, /Detalhe: \$dockerDetail/);
  assert.match(updaterScript, /update-stable-errors\.log/);
});

test("instalação valida Central, manifesto e pacote HTTPS antes de configurar a máquina", () => {
  assert.match(setupMachine, /function Get-TraceNetworkRouteHint/);
  assert.match(setupMachine, /function Test-TraceReleaseAccess\(\[string\]\$ManifestUrl, \[string\]\$MinimumVersion/);
  assert.match(setupMachine, /Get-NetRoute -DestinationPrefix '0\.0\.0\.0\/0'/);
  assert.match(setupMachine, /Invoke-RestMethod -Uri \$manifestUri\.AbsoluteUri -Headers \$Headers -TimeoutSec 20/);
  assert.match(setupMachine, /Invoke-WebRequest -Uri \$artifactUri\.AbsoluteUri -Method Head -MaximumRedirection 5 -TimeoutSec 20 -UseBasicParsing/);
  assert.match(setupMachine, /release estável \$\(\$manifest\.version\) é anterior ao instalador/);
  assert.match(setupMachine, /\$updateManifestUrl = Get-TraceEnvValue 'UPDATE_MANIFEST_URL'/);
  assert.match(setupMachine, /UPDATE_MANIFEST_URL = \$updateManifestUrl/);
  assert.ok(setupMachine.indexOf("Test-TraceReleaseAccess $updateManifestUrl") < setupMachine.indexOf("Instalar-TraceLocal.ps1"));
});

test("pré-verificação do Docker não fica presa quando o motor ainda está iniciando", () => {
  assert.match(updaterScript, /function Invoke-External\(\[string\]\$FilePath, \[string\[\]\]\$Arguments, \[string\]\$InputText, \[int\]\$TimeoutMilliseconds = 0\)/);
  assert.match(updaterScript, /taskkill\.exe \/PID \$process\.Id \/T \/F/);
  assert.match(updaterScript, /Invoke-External 'docker\.exe' @\('info', '--format', '\{\{\.OSType\}\}'\) \$null 10000/);
  assert.match(updaterScript, /\$dockerAttempt -le 12/);
});

test("atualizador repara o gatilho de logon depois de uma atualização", () => {
  assert.match(updaterScript, /function Ensure-TraceUpdaterSchedule/);
  assert.match(updaterScript, /MSFT_TaskDailyTrigger/);
  assert.match(updaterScript, /\(\[datetime\]\$trigger\.StartBoundary\)\.TimeOfDay -eq \(New-TimeSpan -Hours 3\)/);
  assert.match(updaterScript, /if \(\$hasDailyAtThree -and \$hasLogon -and \$hasRetryPolicy\) \{ return \}/);
  assert.match(updaterScript, /New-ScheduledTaskTrigger -Daily -At '03:00'/);
  assert.match(updaterScript, /MSFT_TaskLogonTrigger/);
  assert.match(updaterScript, /\$hasRetryPolicy = \[int\]\$existing\.Settings\.RestartCount -ge 12/);
  assert.match(updaterScript, /\$existing\.Settings\.RestartInterval -eq \(New-TimeSpan -Minutes 5\)/);
  assert.match(updaterScript, /if \(\$hasDailyAtThree -and \$hasLogon -and \$hasRetryPolicy\) \{ return \}/);
  assert.match(updaterScript, /New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit \(New-TimeSpan -Hours 2\) -RestartCount 12 -RestartInterval \(New-TimeSpan -Minutes 5\)/);
  assert.match(updaterScript, /Register-ScheduledTask -TaskName \$taskName -Action \$action -Trigger @\(\$dailyTrigger, \$logonTrigger\)/);
  assert.match(updaterScript, /Ensure-TraceUpdaterSchedule/);
});

test("atualizador reinicia o quiosque na conta dona do processo mesmo em sessão RDP", () => {
  assert.match(updaterScript, /Get-CimInstance Win32_Process -Filter "ProcessId = \$\(\$process\.Id\)"/);
  assert.match(updaterScript, /Invoke-CimMethod -InputObject \$desktopProcess -MethodName GetOwner/);
  assert.match(updaterScript, /\$uniqueDesktopUsers\.Count -ne 1/);
  assert.match(updaterScript, /\$script:desktopUser = \$uniqueDesktopUsers\[0\]/);
  assert.match(updaterScript, /New-ScheduledTaskPrincipal -UserId \$desktopUser -LogonType Interactive/);
  assert.match(updaterScript, /New-ScheduledTaskSettingsSet -ExecutionTimeLimit \(New-TimeSpan -Seconds 0\)/);
  assert.doesNotMatch(updaterScript, /Get-CimInstance Win32_ComputerSystem[^\n]*UserName/);
});

test("pacote de release leva a logo à raiz usada pelos atalhos do Windows", () => {
  assert.match(releaseWorkflow, /cp desktop\/DallogixTrace\/trace\.ico dist\/stage\/trace\.ico/);
  assert.match(releaseWorkflow, /test -s dist\/stage\/trace\.ico/);
});

test("atualizador recria os atalhos com a logo correta após instalar os arquivos", () => {
  assert.match(updaterScript, /function Ensure-TraceShortcuts/);
  assert.match(updaterScript, /Join-Path \$env:PUBLIC 'Desktop'/);
  assert.match(updaterScript, /Join-Path \$env:ProgramData 'Microsoft\\Windows\\Start Menu\\Programs'/);
  assert.match(updaterScript, /\$shortcut\.IconLocation = "\$iconPath,0"/);
  assert.match(updaterScript, /Copy-Item -Destination \$InstallRoot -Recurse -Force\r?\n\s+Ensure-TraceShortcuts/);
});

test("instalação registra o agente no início do Windows", () => {
  assert.match(machineInstaller, /New-ScheduledTaskTrigger -AtStartup/);
  assert.match(machineInstaller, /Dallogix Trace Agent/);
  assert.match(machineInstaller, /Start-ScheduledTask -TaskName "Dallogix Trace Agent"/);
});

test("instalação registra o Docker Desktop no logon da conta técnica", () => {
  assert.match(machineInstaller, /Trace-Docker-Start/);
  assert.match(machineInstaller, /Start-TraceDocker\.ps1/);
  assert.match(machineInstaller, /New-ScheduledTaskTrigger -AtLogOn -User \$interactiveUser/);
  assert.match(machineInstaller, /New-ScheduledTaskPrincipal -UserId \$interactiveUser -LogonType Interactive -RunLevel Limited/);
  assert.match(machineInstaller, /New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit \(New-TimeSpan -Hours 2\) -RestartCount 5 -RestartInterval \(New-TimeSpan -Minutes 5\)/);
  assert.match(machineInstaller, /Register-ScheduledTask -TaskName "Trace-Docker-Start"/);
});

test("inicialização do Docker garante serviço privilegiado e aguarda o motor Linux", () => {
  assert.match(dockerStarter, /com\.docker\.service/);
  assert.match(dockerStarter, /Set-Service -Name 'com\.docker\.service' -StartupType Automatic/);
  assert.match(dockerStarter, /Start-Service -Name 'com\.docker\.service'/);
  assert.match(dockerStarter, /Get-Process -Name 'Docker Desktop'/);
  assert.match(dockerStarter, /taskkill\.exe \/PID \$probe\.Id \/T \/F/);
  assert.match(dockerStarter, /docker\.exe/);
  assert.match(dockerStarter, /info.*OSType/);
  assert.match(dockerStarter, /Mecanismo Linux do Docker respondeu ao teste de saúde/);
});

test("o Compose resolve a identidade do volume e bloqueia sua ausência ou troca", () => {
  assert.match(databaseVolumeGuard, /compose --project-directory \$InstallRoot config --format json/);
  assert.match(databaseVolumeGuard, /docker\.exe volume inspect --format '\{\{\.CreatedAt\}\}' \$volumeName/);
  assert.match(databaseVolumeGuard, /Volume persistente do MySQL ausente/);
  assert.match(databaseVolumeGuard, /A identidade do volume MySQL mudou/);
  assert.match(databaseVolumeGuard, /volume_created_at = \$Snapshot\.CreatedAt/);
});

test("banco vazio só é criado no primeiro setup explícito sem instalação ou backup anterior", () => {
  assert.match(databaseVolumeGuard, /Initialize-TraceMySqlVolumeForInstall\(\[string\]\$InstallRoot, \[switch\]\$AllowFreshDatabaseCreation\)/);
  assert.match(databaseVolumeGuard, /if \(\$hasPriorInstallEvidence\) \{[\s\S]*?volume MySQL '[^\n]*esta ausente/);
  assert.match(databaseVolumeGuard, /if \(-not \$AllowFreshDatabaseCreation\)/);
  assert.match(databaseVolumeGuard, /docker\.exe volume create \$snapshot\.Name/);
  assert.match(setupMachine, /Instalar-TraceLocal\.ps1[\s\S]*?-AllowFreshDatabaseCreation/);
  assert.match(localInstaller, /Initialize-TraceMySqlVolumeForInstall[\s\S]*?AllowFreshDatabaseCreation/);
});

test("o marcador só é registrado depois de confirmar a tabela carregamentos", () => {
  assert.match(databaseVolumeGuard, /Test-TraceMySqlApplicationSchema/);
  assert.match(databaseVolumeGuard, /table_name = 0x636172726567616d656e746f73/);
  assert.match(databaseVolumeGuard, /RedirectStandardInput = \$true/);
  assert.match(databaseVolumeGuard, /StandardInput\.WriteLine\(\$query\)/);
  assert.match(databaseVolumeGuard, /exec', '-T', '-i', 'mysql'/);
  assert.doesNotMatch(databaseVolumeGuard, /-e "' \+ \$query/);
  assert.match(databaseVolumeGuard, /function Register-TraceMySqlVolumeAfterDatabaseCheck/);
  const validationIndex = localInstaller.indexOf("Test-TraceMySqlApplicationSchema -InstallRoot $PackageRoot");
  const registrationIndex = localInstaller.indexOf("Register-TraceMySqlVolumeAfterDatabaseCheck -InstallRoot $PackageRoot");
  assert.ok(validationIndex >= 0 && registrationIndex > validationIndex);
  assert.match(localInstaller, /Migrations bloqueadas para proteger os dados existentes/);
});

test("atualizador e rotas Windows de inicialização validam o volume antes de compose up", () => {
  assert.match(updaterScript, /function Invoke-DockerCompose\(\[string\[\]\]\$Arguments\) \{[\s\S]*?if \(\$Arguments -contains 'up'\) \{[\s\S]*?Assert-TraceMySqlVolumeExists[\s\S]*?-RequireMarker/);
  assert.match(updaterScript, /Ensure-TraceDatabaseVolumeGuard/);
  assert.match(updaterScript, /Register-TraceMySqlVolumeAfterDatabaseCheck/);
  assert.match(traceLauncher, /Assert-TraceMySqlVolumeExists -InstallRoot \$InstallRoot -RequireMarker[\s\S]*?docker compose --profile industrial up -d/);
  assert.match(machineInstaller, /Assert-TraceMySqlVolumeExists -InstallRoot \$PackageRoot -RequireMarker[\s\S]*?docker\.exe compose --profile industrial up -d/);
  assert.match(masterHomologationUpdater, /Assert-TraceMySqlVolumeExists -InstallRoot \$installRoot[\s\S]*?docker\.exe compose exec/);
  assert.match(masterHomologationUpdater, /function Ensure-TraceDatabaseBackupSchedule/);
  assert.match(masterHomologationUpdater, /Ensure-TraceDatabaseVolumeMarker\n        Ensure-TraceDatabaseBackupSchedule/);
  const firstMarkerSetup = updaterScript.indexOf("Ensure-TraceDatabaseVolumeGuard");
  const storagePruning = updaterScript.indexOf("Invoke-TraceStoragePruning $installedVersion");
  assert.ok(firstMarkerSetup >= 0 && storagePruning > firstMarkerSetup, "retenção não pode remover backups antes de conferir o volume");
  const masterBootstrap = masterHomologationUpdater.indexOf("function Ensure-TraceDatabaseVolumeMarker");
  const masterNoOp = masterHomologationUpdater.indexOf("Ensure-TraceDatabaseBackupSchedule\n        if ($current");
  assert.ok(masterBootstrap >= 0 && masterNoOp > masterBootstrap, "a rota de homologação também valida o banco sem release nova");
});

test("o instalador inclui o guard e o atualizador protege o PC ao migrar uma instalação existente", () => {
  assert.match(setupPackage, /Source: "TraceDatabaseVolume\.ps1"/);
  assert.match(setupPackage, /Source: "TraceDatabaseBackup\.ps1"/);
  assert.match(setupPackage, /Source: "Start-TraceDocker\.ps1"/);
  assert.match(setupPackage, /Source: "TraceUpdater\.ps1"/);
  assert.match(updaterScript, /Protecao do volume MySQL ausente/);
  assert.match(updaterScript, /tabela carregamentos nao foi confirmada[\s\S]*?nenhum volume novo foi criado/);
});

test("PC Windows agenda backup diário fora do volume MySQL e verifica arquivo e checksum", () => {
  assert.match(updaterRegistration, /Dallogix Trace Backup Diario/);
  assert.match(updaterRegistration, /New-ScheduledTaskTrigger -Daily -At '02:00'/);
  assert.match(updaterRegistration, /New-ScheduledTaskPrincipal -UserId 'SYSTEM'/);
  assert.match(updaterRegistration, /New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable/);
  assert.match(updaterRegistration, /TraceDatabaseBackup\.ps1/);
  assert.match(updaterScript, /function Ensure-TraceDatabaseBackupSchedule/);
  assert.match(updaterScript, /Ensure-TraceDatabaseBackupSchedule/);
  assert.match(databaseBackup, /Assert-TraceMySqlVolumeExists -InstallRoot \$InstallRoot -RequireMarker/);
  assert.match(databaseBackup, /scripts\/backup_db\.sh/);
  assert.match(databaseBackup, /Get-FileHash -LiteralPath \$backup\.FullName -Algorithm SHA256/);
  assert.match(databaseBackup, /database-backup\.log/);
  assert.match(masterHomologationUpdater, /New-ScheduledTaskTrigger -Daily -At '02:00'/);
});
