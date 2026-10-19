<?php

declare(strict_types=1);

use App\Persistencia\RepositorioRomaneiosLista;
use PHPUnit\Framework\TestCase;

require_once __DIR__ . "/../../servidor/src/Persistencia/RepositorioRomaneiosLista.php";

final class RepositorioRomaneiosListaTest extends TestCase
{
    public function testListaPaginaAgregacoesSemMisturarEmpresas(): void
    {
        $pdo = $this->criarBanco();
        $repository = new RepositorioRomaneiosLista($pdo);
        $filters = [
            "date_from" => null,
            "date_to" => null,
            "number" => "",
            "expedidor" => "",
            "status" => null,
        ];

        self::assertSame(2, $repository->contar(10, $filters));
        $rows = $repository->listar(10, $filters, 1, 1);

        self::assertCount(1, $rows);
        self::assertSame(1, (int) $rows[0]["id"]);
        self::assertSame(5, (int) $rows[0]["planned_quantity"]);
        self::assertSame(2, (int) $rows[0]["loaded_quantity"]);
        self::assertSame(1, (int) $rows[0]["ocorrencias_count"]);
        self::assertSame(2, (int) $rows[0]["trucks_count"]);
        self::assertSame("ABC1D23", $rows[0]["plate"]);
        self::assertSame(101, (int) $rows[0]["active_loading_id"]);
        self::assertSame("CARREGANDO", $rows[0]["active_state"]);
        self::assertSame("DALA-1", $rows[0]["active_equipment"]);
    }

    public function testFiltrosDinamicosMantemContagemEPaginacaoAlinhadas(): void
    {
        $repository = new RepositorioRomaneiosLista($this->criarBanco());
        $filters = [
            "date_from" => "2026-10-19",
            "date_to" => "2026-10-19",
            "number" => "R-2",
            "expedidor" => "Beta",
            "status" => "FINALIZADO",
        ];

        self::assertSame(1, $repository->contar(10, $filters));
        $rows = $repository->listar(10, $filters, 50, 0);

        self::assertCount(1, $rows);
        self::assertSame(2, (int) $rows[0]["id"]);
        self::assertSame(7, (int) $rows[0]["planned_quantity"]);
        self::assertSame(1, (int) $rows[0]["loaded_quantity"]);
        self::assertNull($rows[0]["active_loading_id"]);
    }

    private function criarBanco(): PDO
    {
        $pdo = new PDO("sqlite::memory:", null, null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
        $pdo->exec("CREATE TABLE romaneios (
            id INTEGER PRIMARY KEY, company_id INTEGER, number TEXT,
            scheduled_date TEXT, status TEXT, expedidor TEXT
        )");
        $pdo->exec("CREATE TABLE romaneio_caminhoes (
            id INTEGER PRIMARY KEY, romaneio_id INTEGER, plate TEXT, driver_name TEXT
        )");
        $pdo->exec("CREATE TABLE romaneio_itens (
            id INTEGER PRIMARY KEY, company_id INTEGER, romaneio_id INTEGER, planned_quantity INTEGER
        )");
        $pdo->exec("CREATE TABLE carregamentos (
            id INTEGER PRIMARY KEY, company_id INTEGER, romaneio_id INTEGER,
            state TEXT, equipment_id INTEGER
        )");
        $pdo->exec("CREATE TABLE leituras (
            id INTEGER PRIMARY KEY, company_id INTEGER, carregamento_id INTEGER, result TEXT
        )");
        $pdo->exec("CREATE TABLE ocorrencias (
            id INTEGER PRIMARY KEY, company_id INTEGER, carregamento_id INTEGER
        )");
        $pdo->exec("CREATE TABLE equipamentos (
            id INTEGER PRIMARY KEY, equipment_code TEXT
        )");
        $pdo->exec("INSERT INTO romaneios VALUES
            (1, 10, 'R-1', '2026-10-18', 'AGUARDANDO', 'Alfa'),
            (2, 10, 'R-2', '2026-10-19', 'FINALIZADO', 'Beta'),
            (3, 20, 'OUTRO', '2026-10-19', 'AGUARDANDO', 'Outro')");
        $pdo->exec("INSERT INTO romaneio_caminhoes VALUES
            (1, 1, 'ABC1D23', 'Ana'), (2, 1, 'DEF4G56', 'Bia'), (3, 2, 'HIJ7K89', 'Caio'),
            (4, 3, 'OUT0R00', 'Outro')");
        $pdo->exec("INSERT INTO romaneio_itens VALUES
            (1, 10, 1, 2), (2, 10, 1, 3), (3, 10, 2, 7), (4, 20, 3, 100)");
        $pdo->exec("INSERT INTO carregamentos VALUES
            (100, 10, 1, 'PAUSADO', 1), (101, 10, 1, 'CARREGANDO', 1),
            (102, 10, 2, 'FINALIZADO', 1), (200, 20, 3, 'CARREGANDO', 2)");
        $pdo->exec("INSERT INTO equipamentos VALUES (1, 'DALA-1'), (2, 'DALA-2')");
        $pdo->exec("INSERT INTO leituras VALUES
            (1, 10, 100, 'VALIDO'), (2, 10, 101, 'VALIDO'), (3, 10, 102, 'VALIDO'),
            (4, 20, 200, 'VALIDO'), (5, 20, 200, 'VALIDO')");
        $pdo->exec("INSERT INTO ocorrencias VALUES
            (1, 10, 100), (2, 20, 200), (3, 20, 200)");

        return $pdo;
    }
}
