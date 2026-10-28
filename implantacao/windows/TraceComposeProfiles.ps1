function Get-TraceComposeProfileArguments {
    param([Parameter(Mandatory = $true)][string]$EnvPath)

    if (-not (Test-Path -LiteralPath $EnvPath -PathType Leaf)) {
        throw "Arquivo .env não encontrado: $EnvPath"
    }

    $values = @{}
    foreach ($line in [System.IO.File]::ReadAllLines($EnvPath)) {
        if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
            $key = $matches[1]
            if ($values.ContainsKey($key)) {
                throw "O arquivo .env contém a variável $key mais de uma vez. Corrija antes de continuar."
            }
            $values[$key] = $matches[2].Trim().Trim('"').Trim("'")
        }
    }

    $keyenceEnabled = if ($values.ContainsKey('KEYENCE_ENABLED')) { $values['KEYENCE_ENABLED'] } else { '0' }
    if ($keyenceEnabled -notin @('0', '1')) {
        throw 'KEYENCE_ENABLED deve ser 0 ou 1 no .env.'
    }

    $arguments = @('--profile', 'industrial')
    if ($keyenceEnabled -eq '0') { return $arguments }

    foreach ($name in @(
        'KEYENCE_DEVICE_TOKEN',
        'KEYENCE_BIND_ADDRESS',
        'KEYENCE_FTP_PASSWORD',
        'KEYENCE_FTP_PASV_ADDRESS',
        'KEYENCE_FTP_ALLOWED_ADDRESS',
        'KEYENCE_TCP_ALLOWED_ADDRESS'
    )) {
        if (-not $values.ContainsKey($name) -or [string]::IsNullOrWhiteSpace($values[$name])) {
            throw "KEYENCE_ENABLED=1, mas $name está vazio no .env. Configure o leitor e execute novamente."
        }
    }

    foreach ($name in @(
        'KEYENCE_BIND_ADDRESS',
        'KEYENCE_FTP_PASV_ADDRESS',
        'KEYENCE_FTP_ALLOWED_ADDRESS',
        'KEYENCE_TCP_ALLOWED_ADDRESS'
    )) {
        $address = $null
        if (-not [System.Net.IPAddress]::TryParse($values[$name], [ref]$address) -or
            $address.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork -or
            $address.Equals([System.Net.IPAddress]::Any) -or
            [System.Net.IPAddress]::IsLoopback($address)) {
            throw "$name deve conter um endereço IPv4 fixo, diferente de loopback e 0.0.0.0."
        }
    }

    if ($values['KEYENCE_FTP_PASSWORD'].Length -lt 16) {
        throw 'KEYENCE_FTP_PASSWORD deve ter pelo menos 16 caracteres e ser exclusiva do leitor.'
    }

    return ($arguments + @('--profile', 'keyence'))
}
