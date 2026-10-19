<?php
declare(strict_types=1);

use App\Persistencia\RepositorioComandosClp;
use PHPUnit\Framework\TestCase;

final class ConfirmacaoDesbloqueioTest extends TestCase
{
    public function testUltimaSolicitacaoDeSegurancaInvalidaDesbloqueioAnterior(): void
    {
        $pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        $pdo->exec('CREATE TABLE solicitacoes_comandos_clp (id INTEGER PRIMARY KEY, carregamento_id INTEGER, command TEXT)');
        $pdo->exec("INSERT INTO solicitacoes_comandos_clp VALUES
            (1, 5, 'EMERGENCIA'),
            (2, 5, 'DESBLOQUEAR_MAQUINA'),
            (3, 5, 'EMERGENCIA'),
            (4, 6, 'DESBLOQUEAR_MAQUINA')");
        $repository = new RepositorioComandosClp($pdo);

        self::assertSame(3, $repository->ultimaSolicitacaoDeSeguranca(5));
        self::assertSame(4, $repository->ultimaSolicitacaoDeSeguranca(6));

        $pdo->exec("INSERT INTO solicitacoes_comandos_clp VALUES (5, 5, 'DESBLOQUEAR_MAQUINA')");
        self::assertSame(5, $repository->ultimaSolicitacaoDeSeguranca(5));
    }
}
