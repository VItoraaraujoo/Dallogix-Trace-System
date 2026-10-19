<?php

declare(strict_types=1);

use App\Aplicacao\ServicoSincronizacao;
use PHPUnit\Framework\TestCase;

final class ServicoSincronizacaoInstalacaoCacheTest extends TestCase
{
    public function testReutilizaConfiguracaoDaInstalacaoDuranteUmLote(): void
    {
        $originalToken = getenv("SYNC_REMOTE_TOKEN");
        putenv("SYNC_REMOTE_TOKEN=token-fallback");

        try {
            $pdo = new PDO(
                "sqlite::memory:",
                null,
                null,
                [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC],
            );
            $pdo->exec("CREATE TABLE instalacoes_locais (id INTEGER PRIMARY KEY, company_id INTEGER, sync_token TEXT)");

            $methodToken = new ReflectionMethod(ServicoSincronizacao::class, "obterTokenRemoto");
            $methodEmpresa = new ReflectionMethod(ServicoSincronizacao::class, "obterIdEmpresaInstalada");
            $serviceWithoutInstallation = new ServicoSincronizacao($pdo);
            self::assertSame("token-fallback", $methodToken->invoke($serviceWithoutInstallation));

            $tokenLocal = str_repeat("a", 64);
            $insert = $pdo->prepare("INSERT INTO instalacoes_locais (id, company_id, sync_token) VALUES (1, 42, :token)");
            $insert->execute(["token" => $tokenLocal]);

            // O serviço mantém o snapshot lido no início da execução.
            self::assertSame("token-fallback", $methodToken->invoke($serviceWithoutInstallation));

            $serviceWithInstallation = new ServicoSincronizacao($pdo);
            self::assertSame($tokenLocal, $methodToken->invoke($serviceWithInstallation, 42));
            self::assertSame("", $methodToken->invoke($serviceWithInstallation, 43));
            self::assertSame(42, $methodEmpresa->invoke($serviceWithInstallation));

            $pdo->exec("DELETE FROM instalacoes_locais WHERE id = 1");
            self::assertSame($tokenLocal, $methodToken->invoke($serviceWithInstallation, 42));
            self::assertSame(42, $methodEmpresa->invoke($serviceWithInstallation));
        } finally {
            if ($originalToken === false) {
                putenv("SYNC_REMOTE_TOKEN");
            } else {
                putenv("SYNC_REMOTE_TOKEN=" . $originalToken);
            }
        }
    }
}
