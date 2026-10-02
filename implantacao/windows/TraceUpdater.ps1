param([switch]$Preflight)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

# Atualizador nativo do PC Windows. Deve rodar por tarefa técnica, nunca pela
# conta restrita do operador.
$InstallRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path))
$ComposeProfile = @('--profile', 'industrial')
# O PC industrial tem memória limitada. O Compose padrão constrói várias
# imagens em paralelo e pode matar o MySQL com código 137 durante a atualização.
$env:COMPOSE_PARALLEL_LIMIT = '1'
$StateRoot = Join-Path $InstallRoot "armazenamento\updates"
$BackupRoot = Join-Path $StateRoot "backups"
$LogRoot = Join-Path $InstallRoot "armazenamento\logs"
$ErrorLogPath = Join-Path $LogRoot "update-stable-errors.log"
$ComposeLogPath = Join-Path $LogRoot "update-compose.log"
$MaintenanceFile = Join-Path $InstallRoot "armazenamento\.maintenance"
$createdMaintenance = $false
$keepMaintenance = $false
$EnvPath = Join-Path $InstallRoot ".env"
if (-not (Test-Path -LiteralPath $EnvPath -PathType Leaf)) { throw "Arquivo .env nao encontrado." }
if (Test-Path $EnvPath) {
    Get-Content $EnvPath | Where-Object { $_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$' } | ForEach-Object {
        $name = $Matches[1]; $value = $Matches[2].Trim().Trim('"').Trim("'")
        if (-not (Get-Item "Env:$name" -ErrorAction SilentlyContinue)) { Set-Item "Env:$name" $value }
    }
}
$ManifestUrl = $env:UPDATE_MANIFEST_URL
$PublicKey = $env:UPDATE_PUBLIC_KEY_FILE
$Channel = if ($env:UPDATE_CHANNEL) { $env:UPDATE_CHANNEL } else { "stable" }
if (-not $ManifestUrl -or -not $PublicKey) { throw "Defina UPDATE_MANIFEST_URL e UPDATE_PUBLIC_KEY_FILE no .env." }
if ($ManifestUrl -notmatch '^https://') { throw "O manifesto deve usar HTTPS." }
if (-not (Test-Path $PublicKey)) { throw "Chave pública não encontrada: $PublicKey" }
$dockerBin = Join-Path $env:ProgramFiles 'Docker\Docker\resources\bin'
if (Test-Path -LiteralPath (Join-Path $dockerBin 'docker.exe') -PathType Leaf) {
    $env:PATH = "$dockerBin;$env:PATH"
}
if (-not (Get-Command docker.exe -ErrorAction SilentlyContinue)) { throw "Docker Desktop não está disponível." }
$OpenSsl = Get-Command openssl.exe -ErrorAction SilentlyContinue
if (-not $OpenSsl) {
    $candidate = Join-Path $env:ProgramFiles "Git\usr\bin\openssl.exe"
    if (Test-Path -LiteralPath $candidate -PathType Leaf) { $OpenSsl = $candidate }
}
if (-not $OpenSsl) { throw "OpenSSL do Git for Windows e necessario para validar a assinatura." }
if (-not (Get-Command tar.exe -ErrorAction SilentlyContinue)) { throw "tar.exe é necessário para extrair o pacote." }
$GitBash = Join-Path $env:ProgramFiles "Git\bin\bash.exe"
if (-not (Test-Path -LiteralPath $GitBash -PathType Leaf)) { throw "Git for Windows e necessario para backup e migrations." }

New-Item -ItemType Directory -Force -Path (Join-Path $StateRoot "releases"), $BackupRoot, $LogRoot | Out-Null
Start-Transcript -Path (Join-Path $LogRoot "update-stable.log") -Append | Out-Null
$Lock = [System.Threading.Mutex]::new($false, 'Global\DallogixTraceStableUpdater')
$hasLock = $false
$rollbackRequired = $false
$stackStopped = $false
$previousArchive = $null
$databaseBackup = $null
$work = $null

function Write-AtomicTextFile([string]$Path, [string]$Content) {
    $temporaryPath = "$Path.tmp-$([guid]::NewGuid().ToString('N'))"
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    try {
        [IO.File]::WriteAllText($temporaryPath, $Content, $utf8)
        # Move-Item com -Force substitui o destino no mesmo volume sem a
        # sobrecarga File.Replace que o Windows PowerShell interpreta com
        # backup nulo e rejeita como caminho inválido.
        Move-Item -LiteralPath $temporaryPath -Destination $Path -Force
    } finally {
        if (Test-Path -LiteralPath $temporaryPath -PathType Leaf) {
            Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue
        }
    }
}

function Invoke-DockerCompose([string[]]$Arguments) {
    $runId = [guid]::NewGuid().ToString('N')
    $stdoutPath = Join-Path $env:TEMP ("trace-compose-" + $runId + ".out")
    $stderrPath = Join-Path $env:TEMP ("trace-compose-" + $runId + ".err")
    $process = $null
    try {
        $composeArguments = @('compose') + $Arguments
        $process = Start-Process -FilePath 'docker.exe' -ArgumentList $composeArguments -Wait -PassThru -NoNewWindow -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
        return $process.ExitCode
    } finally {
        Add-Content -LiteralPath $ComposeLogPath -Value ("$(Get-Date -Format o) docker compose " + ($Arguments -join ' ')) -Encoding UTF8
        if (Test-Path -LiteralPath $stdoutPath) { Get-Content -LiteralPath $stdoutPath | Add-Content -LiteralPath $ComposeLogPath -Encoding UTF8 }
        if (Test-Path -LiteralPath $stderrPath) { Get-Content -LiteralPath $stderrPath | Add-Content -LiteralPath $ComposeLogPath -Encoding UTF8 }
        Remove-Item -LiteralPath $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue
    }
}

function Start-TraceStack([switch]$Build) {
    if ($Build) {
        $buildExit = Invoke-DockerCompose ($ComposeProfile + @('build'))
        if ($buildExit -ne 0) { throw "A construcao das imagens nao foi concluida (codigo $buildExit)." }
    }
    $startExit = Invoke-DockerCompose ($ComposeProfile + @('up', '-d'))
    if ($startExit -ne 0) { throw "A nova versao nao iniciou (codigo $startExit)." }
}

try { $hasLock = $Lock.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $hasLock = $true }
try {
    if (-not $hasLock) { throw "Já existe uma atualização em execução." }
    $dockerInfo = & docker.exe info --format '{{.OSType}}'
    $dockerOs = ([string]$dockerInfo).Trim()
    if ($LASTEXITCODE -ne 0 -or $dockerOs -ne 'linux') {
        throw "A tarefa agendada nao consegue acessar o mecanismo Linux do Docker Desktop."
    }
    $headers = @{}
    if ($env:UPDATE_MANIFEST_TOKEN) { $headers.Authorization = "Bearer $($env:UPDATE_MANIFEST_TOKEN)" }
    $manifest = Invoke-RestMethod -Uri $ManifestUrl -Headers $headers -TimeoutSec 20
    $manifestChannel = if ($manifest.channel) { $manifest.channel } else { $Channel }
    if ($manifestChannel -ne $Channel) { throw "Manifesto de canal diferente do configurado." }
    foreach ($field in @("version", "artifact_url", "sha256", "signature")) { if (-not $manifest.$field) { throw "Manifesto sem $field." } }
    if ($manifest.artifact_url -notmatch '^https://') { throw "O pacote deve usar HTTPS." }
    if ($manifest.version -notmatch '^v\d+\.\d+\.\d+$') { throw "Versão inválida: esperado vN.N.N." }
    if ($manifest.sha256 -notmatch '^[0-9a-fA-F]{64}$') { throw "SHA-256 inválido." }
    $failedMarker = Join-Path $StateRoot ("failed-" + $manifest.version)
    if (Test-Path $failedMarker) { throw "A versão $($manifest.version) já falhou; revise a instalação e remova $failedMarker para autorizar nova tentativa." }

    $work = Join-Path $StateRoot (".staging-" + [guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Force -Path $work | Out-Null
    $payload = Join-Path $work "payload"
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($payload, "$($manifest.version)`n$($manifest.artifact_url)`n$($manifest.sha256.ToLower())`n", $utf8)
    $sig = Join-Path $work "signature.bin"
    [IO.File]::WriteAllBytes($sig, [Convert]::FromBase64String($manifest.signature))
    $opensslExe = if ($OpenSsl -is [string]) { $OpenSsl } else { $OpenSsl.Source }
    & $opensslExe dgst -sha256 -verify $PublicKey -signature $sig $payload | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Assinatura do pacote rejeitada." }

    $current = Join-Path $StateRoot "current_version"
    if (-not (Test-Path -LiteralPath $current -PathType Leaf)) {
        throw "Versao instalada nao registrada. Execute Register-TraceUpdater.ps1 a partir de um instalador de release."
    }
    $installedVersion = (Get-Content -LiteralPath $current -Raw).Trim()
    if ($installedVersion -notmatch '^v\d+\.\d+\.\d+$') { throw "Versao instalada invalida." }
    if ($Preflight) {
        [IO.File]::WriteAllText((Join-Path $StateRoot 'preflight-ok.txt'), (Get-Date -Format o))
        Write-Host 'Preflight: Docker Linux, chave publica, Git Bash e versao local acessiveis pela tarefa agendada.'
        return
    }
    if ([version]($manifest.version.Substring(1)) -le [version]($installedVersion.Substring(1))) {
        Write-Output "Sem release nova: instalada $installedVersion; publicada $($manifest.version)."
        return
    }
    $failedMarker = Join-Path $StateRoot ("failed-" + $manifest.version)
    if (Test-Path -LiteralPath $failedMarker) { throw "A versao $($manifest.version) falhou anteriormente e exige revisao tecnica." }

    Set-Location $InstallRoot
    if (Test-Path -LiteralPath $MaintenanceFile) { throw "O sistema ja esta em manutencao. Atualizacao adiada." }
    New-Item -ItemType File -Force -Path $MaintenanceFile | Out-Null
    $createdMaintenance = $true
    $sql = "SELECT COUNT(*) FROM carregamentos WHERE state IN ('PREPARANDO','CARREGANDO','PAUSADO','FINALIZANDO','EMERGENCIA');"
    # Pass the query through stdin. Windows PowerShell can strip the nested
    # quotes when a SQL string is assembled into `sh -lc ...`, leaving mysql
    # with an empty or malformed `-e` argument (ERROR 1064). The container
    # keeps reading its credentials and database name from its own environment.
    $active = ($sql | & docker.exe compose @ComposeProfile exec -T mysql sh -lc 'mysql -N -B -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"' | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $active -notmatch '^\d+$') { throw "Nao foi possivel confirmar os carregamentos ativos. Atualizacao adiada." }
    if ([int]$active -gt 0) { throw "Atualizacao adiada: existe carregamento ativo ou em intervencao." }

    # O workflow de release publica tar.gz (o formato é o mesmo usado pelo
    # atualizador Linux); não tente abrir esses bytes como ZIP.
    $artifact = Join-Path $work ("trace-" + $manifest.version + ".tar.gz")
    Invoke-WebRequest -Uri $manifest.artifact_url -Headers $headers -OutFile $artifact -TimeoutSec 120
    if ((Get-FileHash $artifact -Algorithm SHA256).Hash.ToLower() -ne $manifest.sha256.ToLower()) { throw "Integridade do pacote rejeitada." }
    $release = Join-Path $StateRoot ("releases\" + $manifest.version)
    if (Test-Path $release) { Remove-Item $release -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $release | Out-Null
    & tar.exe -xzf $artifact -C $release
    if ($LASTEXITCODE -ne 0) { throw "Não foi possível extrair o pacote." }
    $source = if (Test-Path (Join-Path $release "trace\docker-compose.yml")) { Join-Path $release "trace" } else { $release }
    if (-not (Test-Path (Join-Path $source "docker-compose.yml")) -or
        -not (Test-Path (Join-Path $source "scripts\migrate.sh"))) {
        throw "Pacote sem docker-compose.yml ou scripts/migrate.sh."
    }
    $releaseCommitFile = Join-Path $source 'trace-build-commit.txt'
    if (-not (Test-Path -LiteralPath $releaseCommitFile -PathType Leaf)) { throw 'Pacote sem identificacao do commit aprovado.' }
    $releaseCommit = [IO.File]::ReadAllText($releaseCommitFile).Trim().ToLowerInvariant()
    if ($releaseCommit -notmatch '^[0-9a-f]{40}$') { throw 'Commit do pacote invalido.' }
    $centralUrl = ([string]$env:TRACE_CENTRAL_URL).Trim().Trim('"').Trim("'").TrimEnd('/')
    $centralUri = $null
    if (-not [Uri]::TryCreate($centralUrl, [UriKind]::Absolute, [ref]$centralUri) -or
        $centralUri.Scheme -ne 'https' -or $centralUri.AbsolutePath -ne '/' -or
        $centralUri.Query -or $centralUri.Fragment -or $centralUri.UserInfo) {
        throw 'TRACE_CENTRAL_URL deve conter a origem HTTPS do servidor Central.'
    }
    $centralHealth = Invoke-RestMethod -Uri "$centralUrl/api/health.php" -TimeoutSec 15
    if ($centralHealth.status -ne 'ok' -or $centralHealth.installation_mode -ne 'central' -or
        $centralHealth.version -ne $manifest.version -or $centralHealth.commit -ne $releaseCommit) {
        throw "O servidor Central ainda nao serve a versao $($manifest.version) e o commit $releaseCommit. Atualizacao adiada."
    }

    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $previousArchive = Join-Path $BackupRoot ("pre-" + $manifest.version + "-" + $stamp + ".tar.gz")
    $stackStopped = $true
    & docker.exe compose @ComposeProfile stop | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Nao foi possivel parar os containers antes do backup." }
    & docker.exe compose @ComposeProfile up -d mysql | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Nao foi possivel iniciar o MySQL para o backup." }
    $mysqlReady = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        & docker.exe compose @ComposeProfile exec -T mysql sh -lc 'mysqladmin ping -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" --silent' | Out-Null
        if ($LASTEXITCODE -eq 0) { $mysqlReady = $true; break }
        Start-Sleep -Seconds 2
    }
    if (-not $mysqlReady) { throw "O MySQL nao ficou pronto para o backup." }
    $backupOutput = & $GitBash 'scripts/backup_db.sh'
    if ($LASTEXITCODE -ne 0) { throw "Backup do banco falhou." }
    $databaseBackup = ($backupOutput | Where-Object { $_ -like 'Backup criado: *' } | Select-Object -Last 1) -replace '^Backup criado: ', ''
    if (-not $databaseBackup) { throw "O backup do banco nao informou seu caminho." }
    $preservedNames = @(".env", "armazenamento", ".git", "config", "logs")
    $previousNames = @(Get-ChildItem -Path $InstallRoot -Force | Where-Object { $_.Name -notin $preservedNames } | ForEach-Object { $_.Name })
    if ($previousNames.Count -gt 0) {
        & tar.exe -czf $previousArchive -C $InstallRoot @previousNames
        if ($LASTEXITCODE -ne 0) { throw "Backup dos arquivos atuais falhou." }
    } else { throw "Nenhum arquivo da aplicacao encontrado para backup." }
    $rollbackRequired = $true
    Get-ChildItem -Path $InstallRoot -Force | Where-Object { $_.Name -notin $preservedNames } | Remove-Item -Recurse -Force
    Get-ChildItem $source -Force | Where-Object { $_.Name -notin $preservedNames } | Copy-Item -Destination $InstallRoot -Recurse -Force
    $releaseMetadata = @{ version = $manifest.version; commit = $releaseCommit } | ConvertTo-Json -Compress
    Write-AtomicTextFile (Join-Path $InstallRoot 'servidor\.release.json') ($releaseMetadata + "`n")
    & docker.exe compose @ComposeProfile config --quiet
    if ($LASTEXITCODE -ne 0) { throw "A configuracao da nova versao e invalida." }
    & $GitBash 'scripts/migrate.sh'
    if ($LASTEXITCODE -ne 0) { throw "As migrations da nova versao falharam." }
    Start-TraceStack -Build
    $healthy = $false
    $webPort = if ($env:WEB_PORT) { $env:WEB_PORT } else { '8080' }
    1..60 | ForEach-Object { if (-not $healthy) { try { $r = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$webPort/api/health.php" -TimeoutSec 3; $health = $r.Content | ConvertFrom-Json; if ($r.StatusCode -eq 200 -and $health.status -eq 'ok' -and $health.mysql -eq $true -and $health.version -eq $manifest.version -and $health.commit -eq $releaseCommit) { $healthy = $true } } catch { Start-Sleep -Seconds 2 } } }
    if (-not $healthy) { throw "A nova versão não passou no healthcheck." }
    Write-AtomicTextFile $current "$($manifest.version)`n"
    Remove-Item -LiteralPath $failedMarker -Force -ErrorAction SilentlyContinue
    $rollbackRequired = $false
    Write-Output "Trace atualizado com sucesso para $($manifest.version). Backup: $databaseBackup"
} catch {
    $originalError = $_
    $errorMessage = if ($_.Exception -and $_.Exception.Message) { $_.Exception.Message } else { [string]$_ }
    try {
        Add-Content -LiteralPath $ErrorLogPath -Value ("$(Get-Date -Format o) $errorMessage") -Encoding UTF8
    } catch {
        Write-Warning "Nao foi possivel registrar o erro do atualizador: $($_.Exception.Message)"
    }
    if ($rollbackRequired -and $previousArchive) {
        try {
            [IO.File]::WriteAllText($failedMarker, (Get-Date -Format o))
            Write-Warning "A atualização falhou; iniciando rollback automático."
            Set-Location $InstallRoot
            & docker.exe compose @ComposeProfile stop | Out-Null
            $restoreRoot = Join-Path $StateRoot (".rollback-" + [guid]::NewGuid().ToString("N"))
            New-Item -ItemType Directory -Force -Path $restoreRoot | Out-Null
            & tar.exe -xzf $previousArchive -C $restoreRoot
            if ($LASTEXITCODE -ne 0) { throw "Não foi possível extrair o backup anterior." }
            Get-ChildItem -Path $InstallRoot -Force | Where-Object { $_.Name -notin $preservedNames } | Remove-Item -Recurse -Force
            Get-ChildItem $restoreRoot -Force | Copy-Item -Destination $InstallRoot -Recurse -Force
            & docker.exe compose @ComposeProfile up -d mysql | Out-Null
            if ($LASTEXITCODE -ne 0) { throw "Nao foi possivel iniciar o MySQL anterior." }
            $mysqlReady = $false
            1..30 | ForEach-Object {
                if (-not $mysqlReady) {
                    & docker.exe compose @ComposeProfile exec -T mysql sh -lc 'mysqladmin ping -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" --silent' | Out-Null
                    if ($LASTEXITCODE -eq 0) { $mysqlReady = $true } else { Start-Sleep -Seconds 2 }
                }
            }
            if (-not $mysqlReady) { throw "O banco não ficou disponível para o rollback." }
            $env:TRACE_ALLOW_RESTORE = '1'
            try {
                & $GitBash 'scripts/restore_db.sh' $databaseBackup
                if ($LASTEXITCODE -ne 0) { throw "Não foi possível restaurar o backup do banco." }
            } finally {
                Remove-Item Env:TRACE_ALLOW_RESTORE -ErrorAction SilentlyContinue
            }
            Start-TraceStack -Build
            $rollbackHealthy = $false
            1..30 | ForEach-Object {
                if (-not $rollbackHealthy) {
                    try {
                        $rollbackPort = if ($env:WEB_PORT) { $env:WEB_PORT } else { '8080' }
                        $health = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$rollbackPort/api/health.php" -TimeoutSec 3
                        $healthData = $health.Content | ConvertFrom-Json
                        if ($health.StatusCode -eq 200 -and $healthData.status -eq 'ok' -and $healthData.mysql -eq $true) { $rollbackHealthy = $true }
                    } catch { Start-Sleep -Seconds 2 }
                }
            }
            if (-not $rollbackHealthy) { throw "O rollback não passou no healthcheck." }
            Remove-Item $restoreRoot -Recurse -Force -ErrorAction SilentlyContinue
            Write-Warning "Rollback automático concluído; a versão anterior foi restaurada."
        } catch {
            [Console]::Error.WriteLine("ROLLBACK FALHOU: $($_.Exception.Message)")
            $keepMaintenance = $true
        }
    } elseif ($stackStopped) {
        Set-Location $InstallRoot
        try {
            Start-TraceStack -Build
            $restartExit = 0
        } catch {
            $restartExit = 1
        }
        if ($restartExit -ne 0) {
            [Console]::Error.WriteLine("Nao foi possivel reiniciar a versao anterior apos falha no backup.")
            $keepMaintenance = $true
        } else {
            $restartHealthy = $false
            $restartPort = if ($env:WEB_PORT) { $env:WEB_PORT } else { '8080' }
            for ($attempt = 0; $attempt -lt 30; $attempt++) {
                try {
                    $response = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$restartPort/api/health.php" -TimeoutSec 3
                    $healthData = $response.Content | ConvertFrom-Json
                    if ($response.StatusCode -eq 200 -and $healthData.status -eq 'ok' -and $healthData.mysql -eq $true) { $restartHealthy = $true; break }
                } catch { Start-Sleep -Seconds 2 }
            }
            if (-not $restartHealthy) {
                [Console]::Error.WriteLine("A versao anterior reiniciou, mas nao passou na verificacao de saude.")
                $keepMaintenance = $true
            }
        }
    }
    throw $originalError
} finally {
    if ($createdMaintenance -and -not $keepMaintenance -and (Test-Path -LiteralPath $MaintenanceFile)) { Remove-Item -LiteralPath $MaintenanceFile -Force }
    if ($work -and (Test-Path -LiteralPath $work)) { Remove-Item -LiteralPath $work -Recurse -Force }
    if ($hasLock) { $Lock.ReleaseMutex() }
    $Lock.Dispose()
    Stop-Transcript | Out-Null
}
