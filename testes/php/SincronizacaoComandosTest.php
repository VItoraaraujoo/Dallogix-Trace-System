<?php
declare(strict_types=1);

use App\Aplicacao\ServicoSincronizacaoRemota;
use PHPUnit\Framework\TestCase;

final class SincronizacaoComandosTest extends TestCase
{
    private function database(): PDO
    {
        $pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
        $pdo->exec('CREATE TABLE solicitacoes_comandos_clp (
            id INTEGER PRIMARY KEY, company_id INTEGER, remote_command_id INTEGER,
            equipment_id INTEGER, carregamento_id INTEGER, command TEXT, status TEXT,
            requested_by INTEGER, requested_at TEXT, response_message TEXT,
            completed_at TEXT, claimed_by_device_id INTEGER, claimed_at TEXT, expires_at TEXT)');
        return $pdo;
    }

    private function synchronize(PDO $pdo, string $remoteStatus): void
    {
        $method = new ReflectionMethod(ServicoSincronizacaoRemota::class, 'upsertCommand');
        $method->invoke(new ServicoSincronizacaoRemota($pdo), 1, 2, 3, 4, [
            'id' => 99, 'command' => 'REVERSAO_ATIVAR', 'status' => $remoteStatus,
            'requested_at' => '2026-09-23 00:00:00.000',
        ]);
    }

    public function testSnapshotNaoReabreComandoConcluidoNemApagaAck(): void
    {
        $pdo = $this->database();
        foreach (['APLICADO', 'REJEITADO', 'ERRO', 'PROCESSANDO'] as $status) {
            $pdo->exec('DELETE FROM solicitacoes_comandos_clp');
            $stmt = $pdo->prepare("INSERT INTO solicitacoes_comandos_clp (id, company_id, remote_command_id, status, response_message, claimed_by_device_id) VALUES (1, 1, 99, ?, 'resultado local', 7)");
            $stmt->execute([$status]);
            $this->synchronize($pdo, 'PENDENTE');
            $row = $pdo->query('SELECT * FROM solicitacoes_comandos_clp')->fetch();
            self::assertSame($status, $row['status']);
            self::assertSame('resultado local', $row['response_message']);
            self::assertSame(7, (int) $row['claimed_by_device_id']);
        }
    }

    public function testComandoNovoPrecisaDeReservaLocalMesmoSeRemotoProcessando(): void
    {
        $pdo = $this->database();
        $this->synchronize($pdo, 'PROCESSANDO');
        self::assertSame('PENDENTE', $pdo->query('SELECT status FROM solicitacoes_comandos_clp')->fetchColumn());
        $this->synchronize($pdo, 'PENDENTE');
        self::assertSame('PENDENTE', $pdo->query('SELECT status FROM solicitacoes_comandos_clp')->fetchColumn());
        self::assertSame(1, (int) $pdo->query('SELECT COUNT(*) FROM solicitacoes_comandos_clp')->fetchColumn());
    }
}
