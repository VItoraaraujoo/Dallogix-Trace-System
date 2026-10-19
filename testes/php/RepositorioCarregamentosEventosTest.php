<?php

declare(strict_types=1);

use App\Persistencia\RepositorioCarregamentosEventos;
use PHPUnit\Framework\TestCase;

require_once __DIR__ . "/../../servidor/src/Persistencia/RepositorioCarregamentosEventos.php";

final class RepositorioCarregamentosEventosTest extends TestCase
{
    private function database(): PDO
    {
        if (class_exists("Pdo\\Sqlite")) {
            $connection = new \Pdo\Sqlite("sqlite::memory:", null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
            $connection->createFunction("NOW", static fn (): string => "2026-10-19 12:00:00");
        } else {
            $connection = new PDO("sqlite::memory:", null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
            $connection->sqliteCreateFunction("NOW", static fn (): string => "2026-10-19 12:00:00");
        }
        $connection->exec("CREATE TABLE carregamentos (
            id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL,
            remote_installation_id INTEGER NULL, remote_carregamento_id INTEGER NULL,
            equipment_id INTEGER NULL, romaneio_id INTEGER NOT NULL, truck_id INTEGER NOT NULL,
            state TEXT NOT NULL, started_at TEXT NULL, finished_at TEXT NULL,
            finish_justification TEXT NULL
        )");
        return $connection;
    }

    /** @return array{company_id:int,installation_id:int,source_id:int,equipment_id:int,manifest_id:int,truck_id:int,state:string,started_at:string} */
    private function loading(array $overrides = []): array
    {
        return array_replace([
            "company_id" => 3,
            "installation_id" => 8,
            "source_id" => 21,
            "equipment_id" => 7,
            "manifest_id" => 12,
            "truck_id" => 15,
            "state" => "PREPARANDO",
            "started_at" => "2026-10-19 11:00:00",
        ], $overrides);
    }

    public function testSalvaEAtualizaMesmoCarregamentoDaInstalacao(): void
    {
        $connection = $this->database();
        $repository = new RepositorioCarregamentosEventos($connection);
        $id = $repository->salvar($this->loading(), null);
        $updatedId = $repository->salvar($this->loading(["state" => "CARREGANDO"]), $id);

        self::assertSame($id, $updatedId);
        self::assertSame(1, (int) $connection->query("SELECT COUNT(*) FROM carregamentos")->fetchColumn());
        self::assertSame("CARREGANDO", $connection->query("SELECT state FROM carregamentos WHERE id = {$id}")->fetchColumn());
        self::assertSame($id, $repository->localizarPorOrigem(3, 8, 21));
        self::assertSame($id, $repository->localizarPorIdRemoto(3, $id, 7));
        self::assertNull($repository->localizarPorIdRemoto(8, $id, 7));
    }

    public function testLocalizacaoDeEventoExigeVinculoComEmpresaInstalacaoEDala(): void
    {
        $connection = $this->database();
        $connection->exec("INSERT INTO carregamentos
            (id, company_id, remote_installation_id, remote_carregamento_id, equipment_id, romaneio_id, truck_id, state)
            VALUES (4, 3, 8, 21, 7, 12, 15, 'CARREGANDO'),
                   (5, 3, 9, 21, 9, 12, 15, 'CARREGANDO'),
                   (6, 8, 8, 21, 7, 12, 15, 'CARREGANDO')");
        $repository = new RepositorioCarregamentosEventos($connection);

        self::assertSame(4, $repository->localizar(3, 8, 7, 4, 0));
        self::assertSame(4, $repository->localizar(3, 8, 7, 0, 21));
        self::assertNull($repository->localizar(3, 8, null, 4, 21));
        self::assertNull($repository->localizar(3, 8, 7, 0, 0));
        self::assertNull($repository->localizar(9, 8, 7, 4, 21));
    }

    public function testVinculoEstadoEFinalizacaoUsamAtualizacoesEscopadas(): void
    {
        $connection = $this->database();
        $connection->exec("INSERT INTO carregamentos
            (id, company_id, remote_installation_id, remote_carregamento_id, equipment_id, romaneio_id, truck_id, state, started_at)
            VALUES (4, 3, 8, 21, 7, 12, 15, 'CARREGANDO', '2026-10-19 11:00:00'),
                   (5, 3, 8, 22, 7, 12, 15, 'CARREGANDO', '2026-10-19 11:00:00'),
                   (6, 8, 8, 23, 7, 12, 15, 'CARREGANDO', '2026-10-19 11:00:00')");
        $repository = new RepositorioCarregamentosEventos($connection);

        $repository->desvincularDala(3, 4);
        self::assertNull($connection->query("SELECT equipment_id FROM carregamentos WHERE id = 4")->fetchColumn());
        self::assertNull($connection->query("SELECT started_at FROM carregamentos WHERE id = 4")->fetchColumn());
        $repository->vincularDala(3, 4, 9);
        $repository->atualizarEstado(3, 4, "PAUSADO");
        self::assertSame("PAUSADO", $connection->query("SELECT state FROM carregamentos WHERE id = 4")->fetchColumn());
        $repository->finalizar(3, 4);
        self::assertSame("2026-10-19 12:00:00", $connection->query("SELECT finished_at FROM carregamentos WHERE id = 4")->fetchColumn());

        $repository->finalizarPorRomaneio(3, 12);
        self::assertSame("FINALIZADO", $connection->query("SELECT state FROM carregamentos WHERE id = 4")->fetchColumn());
        self::assertSame("ROMANEIO CANCELADO POR SINCRONIZAÇÃO", $connection->query("SELECT finish_justification FROM carregamentos WHERE id = 5")->fetchColumn());
        self::assertSame("CARREGANDO", $connection->query("SELECT state FROM carregamentos WHERE id = 6")->fetchColumn());
    }

    public function testPersistenciaMantemATransacaoSobControleDoConsumidor(): void
    {
        $connection = $this->database();
        $repository = new RepositorioCarregamentosEventos($connection);
        $connection->beginTransaction();
        $repository->salvar($this->loading(), null);

        self::assertTrue($connection->inTransaction());
        $connection->rollBack();
        self::assertSame(0, (int) $connection->query("SELECT COUNT(*) FROM carregamentos")->fetchColumn());
    }
}
