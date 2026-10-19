<?php

declare(strict_types=1);

use App\Persistencia\RepositorioItensRomaneio;
use PHPUnit\Framework\TestCase;

require_once __DIR__ . "/../../servidor/src/Persistencia/RepositorioItensRomaneio.php";

final class RepositorioItensRomaneioTest extends TestCase
{
    public function testMantemLinhasRepetidasComoRegistrosSeparados(): void
    {
        $pdo = $this->criarBanco();
        $repository = new RepositorioItensRomaneio($pdo);

        $repository->inserirLinhas(10, [
            ["romaneio_id" => 20, "product_id" => 7, "truck_id" => 3, "quantity" => 12],
            ["romaneio_id" => 20, "product_id" => 7, "truck_id" => 3, "quantity" => 2],
            ["romaneio_id" => 21, "product_id" => 8, "truck_id" => null, "quantity" => 5],
        ]);

        self::assertSame([[12, 7, 3], [2, 7, 3], [5, 8, null]], $pdo->query(
            "SELECT planned_quantity, product_id, truck_id FROM romaneio_itens ORDER BY id",
        )->fetchAll(PDO::FETCH_NUM));
        self::assertSame([10, 10, 10], array_column(
            $pdo->query("SELECT company_id FROM romaneio_itens ORDER BY id")->fetchAll(PDO::FETCH_ASSOC),
            "company_id",
        ));
    }

    public function testDivideImportacoesGrandesEmLotesSemPerderLinhas(): void
    {
        $pdo = $this->criarBanco();
        $items = array_fill(0, 501, [
            "romaneio_id" => 20,
            "product_id" => 7,
            "truck_id" => null,
            "quantity" => 1,
        ]);

        (new RepositorioItensRomaneio($pdo))->inserirLinhas(10, $items);

        self::assertSame(501, (int) $pdo->query("SELECT COUNT(*) FROM romaneio_itens")->fetchColumn());
        self::assertSame(501, (int) $pdo->query("SELECT SUM(planned_quantity) FROM romaneio_itens")->fetchColumn());
    }

    public function testValidaTodasAsLinhasAntesDeIniciarAsInsercoes(): void
    {
        $pdo = $this->criarBanco();
        $items = [
            ["romaneio_id" => 20, "product_id" => 7, "truck_id" => null, "quantity" => 1],
            ["romaneio_id" => 20, "product_id" => 7, "truck_id" => null, "quantity" => 0],
        ];

        try {
            (new RepositorioItensRomaneio($pdo))->inserirLinhas(10, $items);
            self::fail("A quantidade inválida deveria ser rejeitada.");
        } catch (InvalidArgumentException) {
            self::assertSame(0, (int) $pdo->query("SELECT COUNT(*) FROM romaneio_itens")->fetchColumn());
        }
    }

    private function criarBanco(): PDO
    {
        $pdo = new PDO("sqlite::memory:", null, null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
        $pdo->exec("CREATE TABLE romaneio_itens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id INTEGER NOT NULL,
            romaneio_id INTEGER NOT NULL,
            product_id INTEGER NOT NULL,
            truck_id INTEGER NULL,
            planned_quantity INTEGER NOT NULL
        )");

        return $pdo;
    }
}
