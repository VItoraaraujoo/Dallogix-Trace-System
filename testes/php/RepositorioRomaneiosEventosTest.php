<?php

declare(strict_types=1);

use App\Persistencia\RepositorioRomaneiosEventos;
use PHPUnit\Framework\TestCase;

require_once __DIR__ . "/../../servidor/configuracao/bootstrap.php";

final class RepositorioRomaneiosEventosTest extends TestCase
{
    private function database(): PDO
    {
        $connection = new PDO(
            "sqlite::memory:",
            null,
            null,
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC],
        );
        $connection->exec("CREATE TABLE romaneios (
            id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL,
            remote_installation_id INTEGER NOT NULL, remote_romaneio_id INTEGER NOT NULL,
            number TEXT NOT NULL, scheduled_date TEXT NOT NULL, status TEXT NOT NULL, expedidor TEXT NULL
        )");
        $connection->exec("CREATE TABLE romaneio_caminhoes (
            id INTEGER PRIMARY KEY AUTOINCREMENT, romaneio_id INTEGER NOT NULL,
            remote_truck_id INTEGER NULL, plate TEXT NOT NULL, driver_name TEXT NULL
        )");
        $connection->exec("CREATE TABLE carregamentos (
            id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL,
            romaneio_id INTEGER NOT NULL, state TEXT NOT NULL
        )");

        return $connection;
    }

    public function testRomaneioReprocessadoAtualizaOMesmoRegistroSemReabrirEstadoTerminal(): void
    {
        $connection = $this->database();
        $repository = new RepositorioRomaneiosEventos($connection, 8);
        $manifest = $repository->salvarRomaneio(3, 99, [
            "number" => "ROM-99",
            "scheduled_date" => "2026-10-20",
            "status" => "AGUARDANDO",
            "expedidor" => "ERP",
        ]);
        $reprocessed = $repository->salvarRomaneio(3, 99, [
            "remote_romaneio_id" => $manifest["id"],
            "number" => "ROM-99-A",
            "scheduled_date" => "2026-10-21",
            "status" => "FINALIZADO",
            "expedidor" => "ERP atualizado",
        ]);
        $staleUpdate = $repository->salvarRomaneio(3, 99, [
            "remote_romaneio_id" => $manifest["id"],
            "number" => "ROM-99-A",
            "scheduled_date" => "2026-10-21",
            "status" => "AGUARDANDO",
        ]);

        self::assertSame($manifest["id"], $reprocessed["id"]);
        self::assertSame($manifest["id"], $staleUpdate["id"]);
        self::assertSame(1, (int) $connection->query("SELECT COUNT(*) FROM romaneios")->fetchColumn());
        self::assertSame("FINALIZADO", $connection->query("SELECT status FROM romaneios")->fetchColumn());
        self::assertSame("2026-10-21", $connection->query("SELECT scheduled_date FROM romaneios")->fetchColumn());
    }

    public function testRomaneioNaoAtualizaRegistroDeOutraEmpresa(): void
    {
        $connection = $this->database();
        $connection->exec("INSERT INTO romaneios
            (company_id, remote_installation_id, remote_romaneio_id, number, scheduled_date, status)
            VALUES (9, 8, 99, 'ROM-OUTRO', '2026-10-20', 'AGUARDANDO')");
        $repository = new RepositorioRomaneiosEventos($connection, 8);

        $result = $repository->salvarRomaneio(3, 99, [
            "number" => "ROM-LOCAL",
            "scheduled_date" => "2026-10-20",
            "status" => "AGUARDANDO",
        ]);

        self::assertSame(2, $result["id"]);
        self::assertSame("ROM-OUTRO", $connection->query("SELECT number FROM romaneios WHERE company_id = 9")->fetchColumn());
        self::assertSame(2, (int) $connection->query("SELECT COUNT(*) FROM romaneios")->fetchColumn());
    }

    public function testCaminhaoReprocessadoAtualizaOMesmoRegistroDoRomaneio(): void
    {
        $connection = $this->database();
        $repository = new RepositorioRomaneiosEventos($connection, 8);
        $truck = $repository->salvarCaminhao(5, [
            "source_truck_id" => 22,
            "plate" => "abc1d23",
            "driver_name" => "Motorista",
        ]);

        $updated = $repository->salvarCaminhao(5, [
            "remote_truck_id" => $truck["id"],
            "source_truck_id" => 22,
            "plate" => "def2g34",
            "driver_name" => "Motorista atualizado",
        ]);

        self::assertSame($truck["id"], $updated["id"]);
        self::assertSame(1, (int) $connection->query("SELECT COUNT(*) FROM romaneio_caminhoes")->fetchColumn());
        self::assertSame("DEF2G34", $connection->query("SELECT plate FROM romaneio_caminhoes")->fetchColumn());
        self::assertSame("Motorista atualizado", $connection->query("SELECT driver_name FROM romaneio_caminhoes")->fetchColumn());
    }

    public function testRepositoriosRespeitamATransacaoDoEvento(): void
    {
        $connection = $this->database();
        $repository = new RepositorioRomaneiosEventos($connection, 8);
        $connection->beginTransaction();

        $repository->salvarRomaneio(3, 99, [
            "number" => "ROM-99",
            "scheduled_date" => "2026-10-20",
            "status" => "AGUARDANDO",
        ]);
        $repository->salvarCaminhao(1, ["plate" => "ABC1D23"]);

        self::assertTrue($connection->inTransaction());
        $connection->rollBack();
        self::assertSame(0, (int) $connection->query("SELECT COUNT(*) FROM romaneios")->fetchColumn());
        self::assertSame(0, (int) $connection->query("SELECT COUNT(*) FROM romaneio_caminhoes")->fetchColumn());
    }

    public function testNaoFinalizaRomaneioEnquantoOutroCarregamentoContinuaAtivo(): void
    {
        $connection = $this->database();
        $connection->exec("INSERT INTO romaneios
            (company_id, remote_installation_id, remote_romaneio_id, number, scheduled_date, status)
            VALUES (3, 8, 99, 'ROM-99', '2026-10-20', 'EM_ANDAMENTO')");
        $connection->exec("INSERT INTO carregamentos (company_id, romaneio_id, state)
            VALUES (3, 1, 'FINALIZADO'), (3, 1, 'CARREGANDO')");
        $repository = new RepositorioRomaneiosEventos($connection, 8);

        $repository->sincronizarStatusCarregamento(3, 1, "FINALIZADO");

        self::assertSame("EM_ANDAMENTO", $connection->query("SELECT status FROM romaneios WHERE id = 1")->fetchColumn());
    }

    public function testFinalizaRomaneioQuandoUltimoCarregamentoConclui(): void
    {
        $connection = $this->database();
        $connection->exec("INSERT INTO romaneios
            (company_id, remote_installation_id, remote_romaneio_id, number, scheduled_date, status)
            VALUES (3, 8, 99, 'ROM-99', '2026-10-20', 'EM_ANDAMENTO')");
        $connection->exec("INSERT INTO carregamentos (company_id, romaneio_id, state)
            VALUES (3, 1, 'FINALIZADO')");
        $repository = new RepositorioRomaneiosEventos($connection, 8);

        $repository->sincronizarStatusCarregamento(3, 1, "FINALIZADO");

        self::assertSame("FINALIZADO", $connection->query("SELECT status FROM romaneios WHERE id = 1")->fetchColumn());
    }

    public function testSincronizacaoNaoReabreRomaneioCancelado(): void
    {
        $connection = $this->database();
        $connection->exec("INSERT INTO romaneios
            (company_id, remote_installation_id, remote_romaneio_id, number, scheduled_date, status)
            VALUES (3, 8, 99, 'ROM-99', '2026-10-20', 'CANCELADO')");
        $connection->exec("INSERT INTO carregamentos (company_id, romaneio_id, state)
            VALUES (3, 1, 'AGUARDANDO')");
        $repository = new RepositorioRomaneiosEventos($connection, 8);

        $repository->sincronizarStatusCarregamento(3, 1, "AGUARDANDO");

        self::assertSame("CANCELADO", $connection->query("SELECT status FROM romaneios WHERE id = 1")->fetchColumn());
    }
}
