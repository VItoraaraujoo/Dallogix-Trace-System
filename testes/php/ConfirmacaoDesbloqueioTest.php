<?php
declare(strict_types=1);

use App\Aplicacao\ServicoGatewayClp;
use PHPUnit\Framework\TestCase;

final class ConfirmacaoDesbloqueioTest extends TestCase
{
    public function testNovaEmergenciaInvalidaAckDeDesbloqueioAnterior(): void
    {
        $pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        $pdo->exec('CREATE TABLE solicitacoes_comandos_clp (id INTEGER PRIMARY KEY, carregamento_id INTEGER, command TEXT)');
        $pdo->exec("INSERT INTO solicitacoes_comandos_clp VALUES
            (1, 5, 'EMERGENCIA'),
            (2, 5, 'DESBLOQUEAR_MAQUINA'),
            (3, 5, 'EMERGENCIA'),
            (4, 6, 'DESBLOQUEAR_MAQUINA')");
        $method = new ReflectionMethod(ServicoGatewayClp::class, 'isLatestUnlockRequest');
        $service = new ServicoGatewayClp($pdo);

        self::assertFalse($method->invoke($service, 5, 2));
        self::assertTrue($method->invoke($service, 6, 4));

        $pdo->exec("INSERT INTO solicitacoes_comandos_clp VALUES (5, 5, 'DESBLOQUEAR_MAQUINA')");
        self::assertTrue($method->invoke($service, 5, 5));
        self::assertFalse($method->invoke($service, 5, 2));
    }
}
