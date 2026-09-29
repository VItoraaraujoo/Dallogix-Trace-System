Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$installRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..\..')).Path
$logPath = Join-Path $PSScriptRoot 'atualizacao.log'
$appliedPath = Join-Path $PSScriptRoot 'commit-aplicado.txt'
$mutex = $null
$hasLock = $false
$exitCode = 0

function Find-Program([string[]]$Candidates, [string]$CommandName) {
    foreach ($candidate in $Candidates) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
    }
    $found = Get-Command $CommandName -ErrorAction SilentlyContinue
    if ($found) { return $found.Source }
    throw "$CommandName nao foi encontrado."
}

function Run-Checked([string]$Stage, [string]$Program, [string[]]$Arguments) {
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Stage falhou (codigo $LASTEXITCODE)." }
}

Start-Transcript -Path $logPath -Append | Out-Null
try {
    $mutex = New-Object System.Threading.Mutex($false, 'Local\DallogixTraceMasterHomologacao')
    $hasLock = $mutex.WaitOne(0)
    if (-not $hasLock) {
        Write-Host 'Outra atualizacao ja esta em execucao.'
    } else {
        $git = Find-Program -Candidates @(
            (Join-Path $env:ProgramFiles 'Git\cmd\git.exe'),
            (Join-Path $env:LOCALAPPDATA 'Programs\Git\cmd\git.exe')
        ) -CommandName 'git.exe'
        $bash = Find-Program -Candidates @(
            (Join-Path $env:ProgramFiles 'Git\bin\bash.exe'),
            (Join-Path $env:LOCALAPPDATA 'Programs\Git\bin\bash.exe')
        ) -CommandName 'bash.exe'
        $pinnedSync = Join-Path $PSScriptRoot 'sync_github.sh'
        if (-not (Test-Path -LiteralPath $pinnedSync -PathType Leaf)) {
            throw 'O pacote nao inclui o sincronizador vinculado ao commit do Central.'
        }
        if (-not (Get-Command docker.exe -ErrorAction SilentlyContinue)) { throw 'Docker Desktop nao encontrado no PATH.' }
        Set-Location -LiteralPath $installRoot
        if (-not (Test-Path -LiteralPath '.git')) { throw 'Repositorio Git nao configurado. Execute Configurar.cmd primeiro.' }

        $branch = (& $git branch --show-current).Trim()
        if ($LASTEXITCODE -ne 0 -or $branch -ne 'master') { throw "A branch local e '$branch'; esperado 'master'." }
        $changes = @(& $git status --porcelain --untracked-files=all -- . ':!.env' ':!armazenamento/' ':!tmp/' ':!**/__pycache__/')
        if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel conferir os arquivos locais.' }
        if ($changes.Count -gt 0) {
            $changes | ForEach-Object { Write-Host "Arquivo local diferente: $_" }
            throw 'Atualizacao adiada por alteracoes locais.'
        }

        $envFile = Join-Path $installRoot '.env'
        if (-not (Test-Path -LiteralPath $envFile -PathType Leaf)) { throw 'Arquivo .env nao encontrado.' }
        $centralLines = @([IO.File]::ReadAllLines($envFile) | Where-Object { $_ -match '^TRACE_CENTRAL_URL=' })
        if ($centralLines.Count -ne 1) { throw 'Configure exatamente um TRACE_CENTRAL_URL em .env.' }
        $centralUrl = ($centralLines[0] -split '=', 2)[1].Trim().Trim('"').Trim("'").TrimEnd('/')
        $parsedCentral = $null
        if (-not [Uri]::TryCreate($centralUrl, [UriKind]::Absolute, [ref]$parsedCentral) -or
            $parsedCentral.Scheme -ne 'https' -or $parsedCentral.AbsolutePath -ne '/' -or
            $parsedCentral.Query -or $parsedCentral.Fragment -or $parsedCentral.UserInfo) {
            throw 'TRACE_CENTRAL_URL deve conter apenas a origem HTTPS do servidor Central.'
        }
        $centralHealth = Invoke-RestMethod -Uri "$centralUrl/api/health.php" -TimeoutSec 15
        $centralCommit = ([string]$centralHealth.commit).Trim().ToLowerInvariant()
        $centralVersion = ([string]$centralHealth.version).Trim()
        if ($centralHealth.status -ne 'ok' -or $centralHealth.installation_mode -ne 'central' -or
            $centralCommit -notmatch '^[0-9a-f]{40}$' -or -not $centralVersion) {
            throw 'O servidor Central nao informou uma versao implantada valida. Atualizacao adiada.'
        }
        $webPort = 8080
        $portLine = [IO.File]::ReadAllLines($envFile) | Where-Object { $_ -match '^WEB_PORT=' } | Select-Object -Last 1
        if ($portLine -and $portLine.Substring(9) -match '^\d+$') { $webPort = [int]$portLine.Substring(9) }
        if ($webPort -lt 1 -or $webPort -gt 65535) { throw 'WEB_PORT invalida em .env.' }

        Run-Checked 'Consulta ao GitHub' $git @('fetch', '--prune', 'origin', 'master')
        $current = (& $git rev-parse HEAD).Trim()
        $target = $centralCommit
        if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel ler os commits locais.' }
        & $git merge-base --is-ancestor $target origin/master
        if ($LASTEXITCODE -ne 0) { throw 'O commit servido pelo Central nao pertence a master publicada. Atualizacao adiada.' }
        & $git merge-base --is-ancestor $current $target
        if ($LASTEXITCODE -ne 0) { throw 'Este PC esta a frente ou divergiu do servidor Central; nao sera feito downgrade automatico.' }
        $applied = if (Test-Path -LiteralPath $appliedPath) { [IO.File]::ReadAllText($appliedPath).Trim() } else { '' }
        $localMatches = $false
        try {
            $localHealth = Invoke-RestMethod -Uri "http://127.0.0.1:$webPort/api/health.php" -TimeoutSec 5
            $localMatches = $localHealth.status -eq 'ok' -and
                $localHealth.commit -eq $target -and $localHealth.version -eq $centralVersion
        } catch {
            $localMatches = $false
        }
        if ($current -eq $target -and $applied -eq $target -and $localMatches) {
            Write-Host "[$(Get-Date -Format s)] Trace ja esta atualizado ($target)."
        } else {
            if ($current -ne $target) {
                & $git merge-base --is-ancestor $current $target
                if ($LASTEXITCODE -ne 0) { throw 'A master nao pode ser aplicada por fast-forward. Atualizacao adiada.' }
            }

            # Repete a mesma trava de seguranca do sincronizador antes do backup.
            $sql = "SELECT COUNT(*) FROM carregamentos WHERE state IN ('PREPARANDO','CARREGANDO','PAUSADO','FINALIZANDO','EMERGENCIA');"
            $mysqlCommand = 'mysql -N -B -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" -e "' + $sql + '"'
            $active = (& docker.exe compose exec -T mysql sh -lc $mysqlCommand | Out-String).Trim()
            if ($LASTEXITCODE -ne 0 -or $active -notmatch '^\d+$') { throw 'Nao foi possivel confirmar se ha carregamentos ativos. Atualizacao adiada.' }
            if ([int]$active -gt 0) {
                Write-Host 'Atualizacao adiada: existe carregamento ativo ou em intervencao.'
            } else {
                if ($current -ne $target) {
                    # O backup anterior a troca de codigo protege a instalacao atual.
                    Run-Checked 'Backup do banco antes da atualizacao' $bash @('scripts/backup_db.sh')
                    $env:TRACE_PREMERGE_BACKUP_DONE = '1'
                    $env:TRACE_GITHUB_HEALTH_PATH = '/api/health.php'
                    $env:TRACE_GITHUB_TARGET_COMMIT = $target
                    try {
                        Run-Checked 'Sincronizacao com o Central' $bash @('armazenamento/updates/master-homologacao/sync_github.sh')
                    } finally {
                        Remove-Item Env:TRACE_PREMERGE_BACKUP_DONE -ErrorAction SilentlyContinue
                        Remove-Item Env:TRACE_GITHUB_HEALTH_PATH -ErrorAction SilentlyContinue
                        Remove-Item Env:TRACE_GITHUB_TARGET_COMMIT -ErrorAction SilentlyContinue
                    }
                } else {
                    # Recupera uma execucao anterior interrompida apos o Git avancar.
                    Run-Checked 'Migracoes pendentes' $bash @('scripts/migrate.sh')
                    Run-Checked 'Inicializacao dos containers' 'docker.exe' @('compose', 'up', '-d', '--build')
                    $ready = $false
                    for ($attempt = 0; $attempt -lt 60; $attempt++) {
                        try {
                            $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$webPort/api/health.php" -TimeoutSec 3
                            if ($response.StatusCode -eq 200) { $ready = $true; break }
                        } catch { Start-Sleep -Seconds 2 }
                    }
                    if (-not $ready) { throw 'A API nao respondeu apos aplicar a atualizacao.' }
                }
                $installed = (& $git rev-parse HEAD).Trim().ToLowerInvariant()
                if ($LASTEXITCODE -ne 0 -or $installed -ne $target) { throw 'O codigo local nao corresponde ao commit servido pelo Central.' }
                $releaseFile = Join-Path $installRoot 'servidor\.release.json'
                $releaseTemp = Join-Path $PSScriptRoot ("release-" + [guid]::NewGuid().ToString('N') + '.tmp')
                $releaseJson = @{ version = $centralVersion; commit = $target } | ConvertTo-Json -Compress
                [IO.File]::WriteAllText($releaseTemp, $releaseJson + "`n", (New-Object System.Text.UTF8Encoding($false)))
                Move-Item -LiteralPath $releaseTemp -Destination $releaseFile -Force
                $localHealth = Invoke-RestMethod -Uri "http://127.0.0.1:$webPort/api/health.php" -TimeoutSec 5
                if ($localHealth.status -ne 'ok' -or $localHealth.commit -ne $target -or
                    $localHealth.version -ne $centralVersion) {
                    throw 'O PC nao confirmou a mesma versao e commit do servidor Central.'
                }
                [IO.File]::WriteAllText($appliedPath, $target + "`n", (New-Object System.Text.UTF8Encoding($false)))
                Write-Host "[$(Get-Date -Format s)] Trace atualizado para $target."
            }
        }
    }
} catch {
    [Console]::Error.WriteLine("ERRO: $($_.Exception.Message)")
    $exitCode = 1
} finally {
    if ($hasLock) { $mutex.ReleaseMutex() }
    if ($mutex) { $mutex.Dispose() }
    Stop-Transcript | Out-Null
}
exit $exitCode
