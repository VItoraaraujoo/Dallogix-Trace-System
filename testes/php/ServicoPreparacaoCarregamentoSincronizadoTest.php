<?php

declare(strict_types=1);

use App\Aplicacao\ServicoPreparacaoCarregamentoSincronizado;
use App\Persistencia\RepositorioCarregamentosEventos;
use App\Persistencia\RepositorioDalasEventos;
use App\Persistencia\RepositorioItensRomaneioSincronizacao;
use App\Persistencia\RepositorioProdutosEventos;
use App\Persistencia\RepositorioRomaneiosEventos;
use PHPUnit\Framework\TestCase;

require_once __DIR__ . "/../../servidor/configuracao/bootstrap.php";
require_once __DIR__ . "/../../servidor/src/Aplicacao/ServicoPreparacaoCarregamentoSincronizado.php";
require_once __DIR__ . "/../../servidor/src/Persistencia/RepositorioCarregamentosEventos.php";
require_once __DIR__ . "/../../servidor/src/Persistencia/RepositorioDalasEventos.php";
require_once __DIR__ . "/../../servidor/src/Persistencia/RepositorioItensRomaneioSincronizacao.php";
require_once __DIR__ . "/../../servidor/src/Persistencia/RepositorioProdutosEventos.php";
require_once __DIR__ . "/../../servidor/src/Persistencia/RepositorioRomaneiosEventos.php";

final class ServicoPreparacaoCarregamentoSincronizadoTest extends TestCase
{
    private function service(PDO $connection): ServicoPreparacaoCarregamentoSincronizado
    {
        return new ServicoPreparacaoCarregamentoSincronizado(
            new RepositorioCarregamentosEventos($connection),
            new RepositorioDalasEventos($connection),
            new RepositorioRomaneiosEventos($connection, 8),
            new RepositorioItensRomaneioSincronizacao($connection),
            new RepositorioProdutosEventos($connection),
        );
    }

    private function database(): PDO
    {
        $connection = new PDO("sqlite::memory:", null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        $connection->exec("CREATE TABLE equipamentos (
            id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL, equipment_code TEXT NOT NULL
        )");
        $connection->exec("INSERT INTO equipamentos VALUES (7, 3, 'dala_teste_1')");
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
            remote_installation_id INTEGER NOT NULL, remote_carregamento_id INTEGER NOT NULL,
            equipment_id INTEGER NOT NULL, romaneio_id INTEGER NOT NULL, truck_id INTEGER NOT NULL,
            state TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT NULL,
            finish_justification TEXT NULL
        )");
        return $connection;
    }

    /** @return array<string,mixed> */
    private function payload(array $overrides = []): array
    {
        return array_replace([
            "source_carregamento_id" => 21,
            "source_romaneio_id" => 12,
            "equipment_code" => "dala_teste_1",
            "state" => "PREPARANDO",
            "romaneio" => [
                "source_romaneio_id" => 12,
                "number" => "ROM-12",
                "scheduled_date" => "2026-10-19",
                "status" => "AGUARDANDO",
            ],
            "truck" => ["source_truck_id" => 15, "plate" => "ABC1D23", "driver_name" => "Operador"],
        ], $overrides);
    }

    public function testPreparaCarregamentoEReprocessaEventoSemDuplicarRegistros(): void
    {
        $connection = $this->database();
        $service = $this->service($connection);
        $data = $this->payload();

        $first = $service->preparar(3, 8, 7, "dala_teste_1", 21, $data);
        $replayed = $service->preparar(3, 8, 7, "dala_teste_1", 21, $data);

        self::assertSame($first, $replayed);
        self::assertSame(1, (int) $connection->query("SELECT COUNT(*) FROM romaneios")->fetchColumn());
        self::assertSame(1, (int) $connection->query("SELECT COUNT(*) FROM romaneio_caminhoes")->fetchColumn());
        self::assertSame(1, (int) $connection->query("SELECT COUNT(*) FROM carregamentos")->fetchColumn());
        self::assertSame("PREPARANDO", $connection->query("SELECT state FROM carregamentos")->fetchColumn());
        self::assertSame("EM_ANDAMENTO", $connection->query("SELECT status FROM romaneios")->fetchColumn());
    }

    public function testFalhaDeEstadoSePropagaParaRollbackDoConsumidor(): void
    {
        $connection = $this->database();
        $service = $this->service($connection);
        $connection->beginTransaction();
        try {
            $service->preparar(3, 8, 7, "dala_teste_1", 21, $this->payload(["state" => "ESTADO_INVALIDO"]));
            self::fail("O estado inválido deveria ser rejeitado.");
        } catch (RuntimeException $exception) {
            self::assertSame("Estado de carregamento recebido pela sincronização é inválido.", $exception->getMessage());
            self::assertTrue($connection->inTransaction());
            $connection->rollBack();
        }

        self::assertSame(0, (int) $connection->query("SELECT COUNT(*) FROM romaneios")->fetchColumn());
        self::assertSame(0, (int) $connection->query("SELECT COUNT(*) FROM carregamentos")->fetchColumn());
    }
}
