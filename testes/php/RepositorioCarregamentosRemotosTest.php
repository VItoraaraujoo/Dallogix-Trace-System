<?php

declare(strict_types=1);

use App\Persistencia\RepositorioCarregamentosRemotos;
use App\Persistencia\RepositorioFilaSincronizacao;
use App\Persistencia\RepositorioRomaneiosRemotos;
use PHPUnit\Framework\TestCase;

require_once __DIR__ . "/../../servidor/configuracao/bootstrap.php";

final class RepositorioCarregamentosRemotosTest extends TestCase
{
    private function repository(): array
    {
        $pdo = new PDO(
            "sqlite::memory:",
            null,
            null,
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC],
        );
        $pdo->exec("CREATE TABLE fila_sincronizacao (
            company_id INTEGER, aggregate_type TEXT, aggregate_id INTEGER, status TEXT
        )");
        $pdo->exec("CREATE TABLE romaneios (
            id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER, remote_romaneio_id INTEGER,
            number TEXT, expedidor TEXT, scheduled_date TEXT, status TEXT
        )");
        $pdo->exec("CREATE TABLE romaneio_caminhoes (
            id INTEGER PRIMARY KEY AUTOINCREMENT, romaneio_id INTEGER, remote_truck_id INTEGER,
            plate TEXT, driver_name TEXT
        )");
        $pdo->exec("CREATE TABLE romaneio_itens (
            id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER, romaneio_id INTEGER,
            product_id INTEGER, truck_id INTEGER, planned_quantity INTEGER
        )");
        $pdo->exec("CREATE TABLE produtos (
            id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER, code TEXT, name TEXT, active INTEGER
        )");
        $pdo->exec("CREATE TABLE carregamentos (
            id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER, remote_carregamento_id INTEGER,
            equipment_id INTEGER, romaneio_id INTEGER, truck_id INTEGER, state TEXT,
            started_at TEXT, finished_at TEXT
        )");

        $queue = new RepositorioFilaSincronizacao($pdo);
        $manifestRepository = new RepositorioRomaneiosRemotos($pdo, $queue);
        return [$pdo, new RepositorioCarregamentosRemotos($pdo, $queue, $manifestRepository)];
    }

    /** @return array<string,mixed> */
    private function remoteLoading(string $state = "CARREGANDO"): array
    {
        return [
            "id" => 900,
            "romaneio_id" => 70,
            "romaneio_number" => "ROM-700",
            "romaneio_status" => "AGUARDANDO",
            "truck_id" => 90,
            "plate" => "ABC1D23",
            "driver_name" => "Motorista",
            "state" => $state,
            "started_at" => "2026-10-19 10:00:00.000",
            "items" => [],
        ];
    }

    public function testImportaSnapshotDeFormaIdempotente(): void
    {
        [$pdo, $repository] = $this->repository();

        self::assertSame(1, $repository->salvarOuAtualizar(1, 2, $this->remoteLoading()));
        self::assertSame(1, $repository->salvarOuAtualizar(1, 2, $this->remoteLoading("PAUSADO")));

        self::assertSame(1, (int) $pdo->query("SELECT COUNT(*) FROM carregamentos")->fetchColumn());
        self::assertSame("PAUSADO", $pdo->query("SELECT state FROM carregamentos")->fetchColumn());
        self::assertSame(1, (int) $pdo->query("SELECT COUNT(*) FROM romaneios")->fetchColumn());
        self::assertSame(1, (int) $pdo->query("SELECT COUNT(*) FROM romaneio_caminhoes")->fetchColumn());
    }

    public function testSnapshotNaoSubstituiCarregamentoComEventoLocalPendente(): void
    {
        [$pdo, $repository] = $this->repository();
        $pdo->exec("INSERT INTO romaneios (id, company_id, remote_romaneio_id, number, status)
            VALUES (7, 1, 70, 'ROM-700', 'EM_ANDAMENTO')");
        $pdo->exec("INSERT INTO romaneio_caminhoes (id, romaneio_id, remote_truck_id, plate)
            VALUES (8, 7, 90, 'ABC1D23')");
        $pdo->exec("INSERT INTO carregamentos
            (id, company_id, remote_carregamento_id, equipment_id, romaneio_id, truck_id, state, started_at)
            VALUES (9, 1, 900, 2, 7, 8, 'PAUSADO', '2026-10-19 09:00:00.000')");
        $pdo->exec("INSERT INTO fila_sincronizacao VALUES (1, 'carregamento', 9, 'PENDENTE')");

        $repository->salvarOuAtualizar(1, 3, $this->remoteLoading("CARREGANDO"));

        $loading = $pdo->query("SELECT equipment_id, state, started_at FROM carregamentos WHERE id = 9")->fetch();
        self::assertSame(2, (int) $loading["equipment_id"]);
        self::assertSame("PAUSADO", $loading["state"]);
        self::assertSame("2026-10-19 09:00:00.000", $loading["started_at"]);
    }

    public function testFinalizaSomenteCarregamentosAusentesSemEventoPendente(): void
    {
        [$pdo, $repository] = $this->repository();
        $pdo->exec("INSERT INTO carregamentos
            (company_id, remote_carregamento_id, state) VALUES
            (1, 900, 'CARREGANDO'), (1, 901, 'CARREGANDO'), (1, 902, 'CARREGANDO'),
            (2, 903, 'CARREGANDO')");
        $pdo->exec("INSERT INTO fila_sincronizacao VALUES (1, 'carregamento', 2, 'ERRO')");

        $repository->finalizarAusentes(1, [900, 900, 0]);

        $states = $pdo->query("SELECT remote_carregamento_id, state, finished_at FROM carregamentos")->fetchAll();
        $byRemoteId = array_column($states, null, "remote_carregamento_id");
        self::assertSame("CARREGANDO", $byRemoteId[900]["state"]);
        self::assertSame("CARREGANDO", $byRemoteId[901]["state"]);
        self::assertSame("FINALIZADO", $byRemoteId[902]["state"]);
        self::assertNotEmpty($byRemoteId[902]["finished_at"]);
        self::assertSame("CARREGANDO", $byRemoteId[903]["state"]);
    }
}
