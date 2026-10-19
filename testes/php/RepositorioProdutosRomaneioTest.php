<?php

declare(strict_types=1);

use App\Persistencia\RepositorioProdutosRomaneio;
use PHPUnit\Framework\TestCase;

require_once __DIR__ . "/../../servidor/src/Persistencia/RepositorioProdutosRomaneio.php";

final class RepositorioProdutosRomaneioTest extends TestCase
{
    public function testBuscaIdsAtivosEmLoteEIsolaAEmpresa(): void
    {
        $repository = new RepositorioProdutosRomaneio($this->criarBanco());

        $products = $repository->buscarAtivosPorIds(10, [1, 1, 2, 5]);

        $productIds = array_keys($products);
        sort($productIds);
        self::assertSame([1, 2], $productIds);
        self::assertSame("SKU-1", $products[1]["code"]);
        self::assertSame([], $repository->buscarAtivosPorIds(10, []));
    }

    public function testResolveCodigoOuBarrasUmaVezPorIdentificador(): void
    {
        $repository = new RepositorioProdutosRomaneio($this->criarBanco());

        $products = $repository->buscarAtivosPorCodigoOuBarras(
            10,
            ["sku-1", "789", "123", "999", "NAO-EXISTE", "789"],
        );

        self::assertSame(1, $products["sku-1"]["id"]);
        self::assertSame(2, $products["789"]["id"]);
        self::assertSame(4, $products["123"]["id"]);
        self::assertArrayNotHasKey("999", $products);
        self::assertArrayNotHasKey("nao-existe", $products);
        self::assertSame([], $repository->buscarAtivosPorCodigoOuBarras(10, []));
    }

    public function testBuscaPorCodigoNaoUsaCodigoDeBarrasComoAlternativa(): void
    {
        $repository = new RepositorioProdutosRomaneio($this->criarBanco());

        $products = $repository->buscarAtivosPorCodigos(10, ["SKU-1", "789", "SKU-1"]);

        self::assertSame(1, $products["sku-1"]["id"]);
        self::assertArrayNotHasKey("789", $products);
    }

    private function criarBanco(): PDO
    {
        $pdo = new PDO("sqlite::memory:", null, null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
        $pdo->exec("CREATE TABLE produtos (
            id INTEGER PRIMARY KEY,
            company_id INTEGER NOT NULL,
            code TEXT COLLATE NOCASE NOT NULL,
            name TEXT NOT NULL,
            active INTEGER NOT NULL
        )");
        $pdo->exec("CREATE TABLE codigos_produtos (
            id INTEGER PRIMARY KEY,
            company_id INTEGER NOT NULL,
            product_id INTEGER NOT NULL,
            barcode TEXT COLLATE NOCASE NOT NULL
        )");
        $pdo->exec("INSERT INTO produtos VALUES
            (1, 10, 'SKU-1', 'Produto um', 1),
            (2, 10, 'SKU-2', 'Produto dois', 1),
            (3, 10, 'SKU-INATIVO', 'Produto inativo', 0),
            (4, 10, '123', 'Código prioritário', 1),
            (5, 20, 'SKU-OUTRO', 'Outra empresa', 1)");
        $pdo->exec("INSERT INTO codigos_produtos VALUES
            (1, 10, 2, '789'), (2, 10, 3, '999'), (3, 10, 2, '123'),
            (4, 20, 5, 'FORA-DA-EMPRESA')");

        return $pdo;
    }
}
