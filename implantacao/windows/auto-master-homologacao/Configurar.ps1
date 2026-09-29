param([string]$OriginalCommit = '')

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$installRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..\..')).Path
$repositoryUrl = 'https://github.com/VItoraaraujoo/Dallogix-Trace-System.git'
$commitMarker = Join-Path $installRoot '.trace-source-commit'
$taskName = 'Dallogix Trace Master Homologacao'
$gitPath = @(
    (Join-Path $env:ProgramFiles 'Git\cmd\git.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\Git\cmd\git.exe')
) | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
if (-not $gitPath) {
    $gitCommand = Get-Command git.exe -ErrorAction SilentlyContinue
    if ($gitCommand) { $gitPath = $gitCommand.Source }
}

function Run-Checked([string]$Stage, [string]$Program, [string[]]$Arguments) {
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Stage falhou (codigo $LASTEXITCODE)." }
}

try {
    if (-not (Test-Path -LiteralPath (Join-Path $installRoot 'docker-compose.yml'))) {
        throw 'O pacote deve ser extraido em C:\DallogixTrace\armazenamento\updates\master-homologacao.'
    }
    if (-not $gitPath) {
        throw 'Git for Windows nao encontrado no PATH. Instale-o e reabra o CMD.'
    }
    if (-not (Get-Command docker.exe -ErrorAction SilentlyContinue)) {
        throw 'Docker Desktop nao encontrado no PATH.'
    }
    Set-Location -LiteralPath $installRoot

    if (-not (Test-Path -LiteralPath '.git')) {
        if (-not $OriginalCommit -and (Test-Path -LiteralPath $commitMarker -PathType Leaf)) {
            $OriginalCommit = [IO.File]::ReadAllText($commitMarker).Trim()
        }
        if ($OriginalCommit -notmatch '^[0-9a-fA-F]{7,40}$') {
            throw 'O ZIP nao informa seu commit de origem. Use o pacote Windows oficial ou informe -OriginalCommit; nenhum arquivo foi alterado.'
        }
        Write-Host "Vinculando o ZIP original ($OriginalCommit) ao GitHub sem apagar arquivos..."
        Run-Checked 'Inicializacao do Git' $gitPath @('init', '-b', 'master')
        Run-Checked 'Configuracao do GitHub' $gitPath @('remote', 'add', 'origin', $repositoryUrl)
        Run-Checked 'Download do historico' $gitPath @('fetch', 'origin', 'master')
        $originalCommit = (& $gitPath rev-parse "$OriginalCommit^{commit}").Trim()
        if ($LASTEXITCODE -ne 0) { throw 'A versao original do ZIP nao foi encontrada no historico baixado.' }
        Run-Checked 'Registro da versao original' $gitPath @('update-ref', 'refs/heads/master', $originalCommit)
        Run-Checked 'Leitura dos arquivos originais' $gitPath @('read-tree', $originalCommit)
    }

    $remoteOutput = & $gitPath remote get-url origin
    $remote = ([string]$remoteOutput).Trim().TrimEnd('/') -replace '\.git$', ''
    $expectedRemote = $repositoryUrl -replace '\.git$', ''
    if ($LASTEXITCODE -ne 0 -or $remote -ne $expectedRemote) {
        throw "O repositorio Git configurado nao e $repositoryUrl. Nenhuma tarefa foi criada."
    }
    $branch = (& $gitPath branch --show-current).Trim()
    if ($LASTEXITCODE -ne 0 -or $branch -ne 'master') {
        throw "A pasta esta na branch '$branch'; e necessario estar em master. Nenhuma tarefa foi criada."
    }

    # O marcador do ZIP nao pertence ao Git; scripts legados podem vir de um pacote anterior.
    $excludePath = Join-Path $installRoot '.git\info\exclude'
    $existing = if (Test-Path -LiteralPath $excludePath) { [IO.File]::ReadAllLines($excludePath) } else { @() }
    foreach ($entry in @('/.trace-source-commit', '/Instalar-PC-Windows.cmd', '/implantacao/windows/Instalar-TraceLocal.ps1', '/servidor/.release.json')) {
        if ($existing -notcontains $entry) { Add-Content -LiteralPath $excludePath -Value $entry }
    }

    $changes = @(& $gitPath status --porcelain --untracked-files=all -- . ':!.env' ':!armazenamento/' ':!tmp/' ':!**/__pycache__/')
    if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel conferir os arquivos locais.' }
    if ($changes.Count -gt 0) {
        Write-Host 'A atualizacao foi adiada porque existem arquivos locais diferentes do ZIP original:'
        $changes | ForEach-Object { Write-Host "  $_" }
        throw 'Guarde essas alteracoes e resolva as diferencas antes de habilitar a atualizacao automatica. Nenhuma tarefa foi criada.'
    }

    $updaterPath = Join-Path $PSScriptRoot 'Atualizar.ps1'
    if (-not (Test-Path -LiteralPath $updaterPath)) { throw 'Atualizar.ps1 nao encontrado no pacote.' }
    if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'sync_github.sh') -PathType Leaf)) {
        throw 'sync_github.sh nao encontrado no pacote.'
    }
    $existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($existingTask) {
        $actionText = ($existingTask.Actions | ForEach-Object { "$($_.Execute) $($_.Arguments)" }) -join ' '
        if (-not $actionText.Contains($updaterPath)) {
            throw "A tarefa '$taskName' ja existe e aponta para outro arquivo. Nenhuma tarefa foi substituida."
        }
    }

    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$updaterPath`""
    $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 3650)
    $principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 2)
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Alinha o Trace de homologacao ao commit servido pelo Central quando nao ha carregamento ativo.' -Force | Out-Null
    Write-Host 'Atualizacao automatica configurada para verificar o commit servido pelo Central a cada 5 minutos enquanto esta conta estiver conectada.'
    Write-Host 'Executando a primeira verificacao agora...'
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $updaterPath
    if ($LASTEXITCODE -ne 0) { throw "A primeira verificacao falhou (codigo $LASTEXITCODE). Veja armazenamento\updates\master-homologacao\atualizacao.log." }
    Write-Host 'OK: primeira verificacao concluida.'
} catch {
    [Console]::Error.WriteLine("ERRO: $($_.Exception.Message)")
    exit 1
}
