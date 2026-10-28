<?php

declare(strict_types=1);

use App\Persistencia\RepositorioDalasEventos;
use PHPUnit\Framework\TestCase;

require_once __DIR__ . "/../../servidor/src/Persistencia/RepositorioDalasEventos.php";

final class RepositorioDalasEventosTest extends TestCase
{
    private function equipmentDatabase(): PDO
    {
        $connection = new PDO("sqlite::memory:", null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        $connection->exec("CREATE TABLE equipamentos (
            id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, equipment_code TEXT NOT NULL,
            name TEXT NOT NULL, plc_ip TEXT NOT NULL, plc_port INTEGER NOT NULL, external_port INTEGER NULL,
            plc_protocol TEXT NOT NULL, UNIQUE(company_id, equipment_code)
        )");
        $connection->exec("CREATE TABLE instalacoes_industriais (
            id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL, equipment_id INTEGER NULL, sync_token_hash TEXT NULL
        )");
        return $connection;
    }

    /** @return array<string,mixed> */
    private function equipmentPayload(array $overrides = []): array
    {
        return array_replace([
            "equipment_code" => "dala_teste_1",
            "name" => "Dala teste",
            "plc_ip" => "192.168.1.10",
            "plc_port" => 502,
            "external_port" => null,
            "plc_protocol" => "MODBUS_TCP",
        ], $overrides);
    }

    private function database(): PDO
    {
        $options = [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION];
        if (class_exists("Pdo\\Sqlite")) {
            $connection = new \Pdo\Sqlite("sqlite::memory:", null, null, $options);
            $connection->createFunction("NOW", static fn (...$arguments): string => "2026-10-19 12:00:00", -1);
        } else {
            $connection = new PDO("sqlite::memory:", null, null, $options);
            $connection->sqliteCreateFunction("NOW", static fn (...$arguments): string => "2026-10-19 12:00:00", -1);
        }
        $connection->exec("CREATE TABLE carregamentos (
            company_id INTEGER NOT NULL, equipment_id INTEGER NULL, state TEXT NOT NULL, started_at TEXT NULL
        )");
        $connection->exec("CREATE TABLE solicitacoes_comandos_clp (
            company_id INTEGER NOT NULL, equipment_id INTEGER NULL, status TEXT NOT NULL,
            completed_at TEXT NULL, response_message TEXT NULL
        )");
        $connection->exec("CREATE TABLE solicitacoes_imagens_evidencia (
            equipment_id INTEGER NULL, status TEXT NOT NULL, error_message TEXT NULL
        )");
        foreach (["eventos_sensor", "imagens"] as $table) {
            $connection->exec("CREATE TABLE {$table} (equipment_id INTEGER NULL)");
        }
        foreach (["dispositivos", "gatilhos_dala", "acoes_dala", "status_dispositivos"] as $table) {
            $connection->exec("CREATE TABLE {$table} (company_id INTEGER NULL, equipment_id INTEGER NOT NULL)");
        }
        $connection->exec("CREATE TABLE equipamentos (id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL)");
        $connection->exec("CREATE TABLE instalacoes_industriais (
            id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL, equipment_id INTEGER NULL
        )");
        return $connection;
    }

    public function testExclusaoDesvinculaOperacoesEPreservaEstadosJaConcluidos(): void
    {
        $connection = $this->database();
        $connection->exec("INSERT INTO equipamentos VALUES (7, 3), (9, 99)");
        $connection->exec("INSERT INTO instalacoes_industriais VALUES (8, 3, 7)");
        $connection->exec("INSERT INTO carregamentos VALUES (3, 7, 'CARREGANDO', '2026-10-19 11:00:00'),
            (3, 7, 'FINALIZADO', '2026-10-19 10:00:00')");
        $connection->exec("INSERT INTO solicitacoes_comandos_clp VALUES (3, 7, 'PENDENTE', NULL, NULL),
            (3, 7, 'APLICADO', '2026-10-19 10:00:00', 'Confirmado')");
        $connection->exec("INSERT INTO solicitacoes_imagens_evidencia VALUES (7, 'PENDENTE', NULL), (7, 'CONCLUIDA', NULL)");
        foreach (["eventos_sensor", "imagens"] as $table) {
            $connection->exec("INSERT INTO {$table} VALUES (7)");
        }
        foreach (["dispositivos", "gatilhos_dala", "acoes_dala", "status_dispositivos"] as $table) {
            $connection->exec("INSERT INTO {$table} VALUES (3, 7)");
        }
        $connection->exec("INSERT INTO dispositivos VALUES (99, 9)");

        (new RepositorioDalasEventos($connection))->excluirDalaVinculada(3, 8, 7);

        self::assertSame(0, (int) $connection->query("SELECT COUNT(*) FROM equipamentos WHERE id = 7 AND company_id = 3")->fetchColumn());
        self::assertSame(1, (int) $connection->query("SELECT COUNT(*) FROM carregamentos WHERE equipment_id IS NULL AND state = 'AGUARDANDO'")->fetchColumn());
        self::assertSame(1, (int) $connection->query("SELECT COUNT(*) FROM carregamentos WHERE equipment_id = 7 AND state = 'FINALIZADO'")->fetchColumn());
        self::assertSame("ERRO", $connection->query("SELECT status FROM solicitacoes_comandos_clp WHERE response_message IS NOT NULL")->fetchColumn());
        self::assertSame("2026-10-19 12:00:00", $connection->query("SELECT completed_at FROM solicitacoes_comandos_clp WHERE status = 'ERRO'")->fetchColumn());
        self::assertSame("Dala excluída antes da conclusão do comando.", $connection->query("SELECT response_message FROM solicitacoes_comandos_clp WHERE status = 'ERRO'")->fetchColumn());
        self::assertSame("APLICADO", $connection->query("SELECT status FROM solicitacoes_comandos_clp WHERE response_message = 'Confirmado'")->fetchColumn());
        self::assertSame("DESCARTADA", $connection->query("SELECT status FROM solicitacoes_imagens_evidencia WHERE error_message IS NOT NULL")->fetchColumn());
        self::assertSame(1, (int) $connection->query("SELECT COUNT(*) FROM solicitacoes_imagens_evidencia WHERE status = 'CONCLUIDA'")->fetchColumn());
        self::assertSame(1, (int) $connection->query("SELECT COUNT(*) FROM dispositivos WHERE company_id = 99 AND equipment_id = 9")->fetchColumn());
        self::assertSame(0, (int) $connection->query("SELECT COUNT(*) FROM dispositivos WHERE company_id = 3 AND equipment_id = 7")->fetchColumn());
        foreach (["eventos_sensor", "imagens"] as $table) {
            self::assertSame(1, (int) $connection->query("SELECT COUNT(*) FROM {$table} WHERE equipment_id IS NULL")->fetchColumn());
        }
        foreach (["gatilhos_dala", "acoes_dala", "status_dispositivos"] as $table) {
            self::assertSame(0, (int) $connection->query("SELECT COUNT(*) FROM {$table} WHERE equipment_id = 7")->fetchColumn());
        }
        self::assertNull($connection->query("SELECT equipment_id FROM instalacoes_industriais WHERE id = 8")->fetchColumn());
        self::assertSame(1, (int) $connection->query("SELECT COUNT(*) FROM equipamentos WHERE id = 9 AND company_id = 99")->fetchColumn());
    }

    public function testRepositorioRespeitaATransacaoDoConsumidor(): void
    {
        $connection = $this->database();
        $connection->exec("INSERT INTO equipamentos VALUES (7, 3)");
        $connection->exec("INSERT INTO instalacoes_industriais VALUES (8, 3, 7)");
        $connection->beginTransaction();

        (new RepositorioDalasEventos($connection))->excluirDalaVinculada(3, 8, 7);

        self::assertTrue($connection->inTransaction());
        $connection->rollBack();
        self::assertSame(1, (int) $connection->query("SELECT COUNT(*) FROM equipamentos")->fetchColumn());
        self::assertSame(7, (int) $connection->query("SELECT equipment_id FROM instalacoes_industriais")->fetchColumn());
    }

    public function testPrimeiroCadastroCriaDalaEVinculaSomenteInstalacaoAutorizada(): void
    {
        $connection = $this->equipmentDatabase();
        $connection->exec("INSERT INTO instalacoes_industriais VALUES (8, 3, NULL, 'token-hash')");

        $saved = (new RepositorioDalasEventos($connection))->salvarDalaVinculada(
            3,
            8,
            null,
            "",
            $this->equipmentPayload(),
        );

        self::assertSame(["id" => 1, "code" => "dala_teste_1"], $saved);
        self::assertSame(1, (int) $connection->query("SELECT equipment_id FROM instalacoes_industriais WHERE id = 8")->fetchColumn());
        self::assertSame("192.168.1.10", $connection->query("SELECT plc_ip FROM equipamentos WHERE id = 1")->fetchColumn());
    }

    public function testCadastroInicialNaoPodeVincularDalaJaAssociadaAOutroPc(): void
    {
        $connection = $this->equipmentDatabase();
        $connection->exec("INSERT INTO equipamentos VALUES (7, 3, 'dala_teste_1', 'Dala', '192.168.1.10', 502, NULL, 'MODBUS_TCP')");
        $connection->exec("INSERT INTO instalacoes_industriais VALUES (8, 3, NULL, 'token-a'), (9, 3, 7, 'token-b')");

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage("A Dala recebida já está vinculada a outro PC industrial.");
        (new RepositorioDalasEventos($connection))->salvarDalaVinculada(
            3,
            8,
            null,
            "",
            $this->equipmentPayload(),
        );
    }

    public function testAtualizacaoEConsultaExigemQueDalaPertencaAInstalacao(): void
    {
        $connection = $this->equipmentDatabase();
        $connection->exec("INSERT INTO equipamentos VALUES (7, 3, 'dala_teste_1', 'Dala', '192.168.1.10', 502, NULL, 'MODBUS_TCP')");
        $connection->exec("INSERT INTO instalacoes_industriais VALUES (8, 3, 7, 'token-a')");
        $repository = new RepositorioDalasEventos($connection);

        $updated = $repository->salvarDalaVinculada(
            3,
            8,
            7,
            "dala_teste_1",
            $this->equipmentPayload([
                "equipment_code" => "dala_teste_2",
                "previous_equipment_code" => "dala_teste_1",
                "name" => "Dala renomeada",
            ]),
        );

        self::assertSame(["id" => 7, "code" => "dala_teste_2"], $updated);
        self::assertSame("dala_teste_2", $connection->query("SELECT equipment_code FROM equipamentos WHERE id = 7")->fetchColumn());
        self::assertSame(7, $repository->obterIdDalaVinculada(3, 7, "dala_teste_2", []));
        $this->expectException(RuntimeException::class);
        $repository->obterIdDalaVinculada(3, 7, "dala_teste_2", ["equipment_code" => "outra_dala"]);
    }
}
