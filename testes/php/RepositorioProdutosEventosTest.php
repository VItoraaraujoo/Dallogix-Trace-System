<?php

declare(strict_types=1);

use App\Persistencia\RepositorioProdutosEventos;
use PHPUnit\Framework\TestCase;

final class RepositorioProdutosEventosTest extends TestCase
{
    private function database(): PDO
    {
        $connection = new PDO(
            "sqlite::memory:",
            null,
            null,
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC],
        );
        $connection->exec("CREATE TABLE produtos (
            id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, remote_product_id INTEGER NULL,
            code TEXT NOT NULL, name TEXT NOT NULL, category TEXT NULL, active INTEGER NOT NULL,
            UNIQUE(company_id, code)
        )");
        $connection->exec("CREATE TABLE codigos_produtos (
            id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, product_id INTEGER NOT NULL,
            barcode TEXT NOT NULL, UNIQUE(company_id, barcode)
        )");
        $connection->exec("CREATE TABLE leituras (
            id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, product_id INTEGER NULL
        )");
        $connection->exec("CREATE TABLE ocorrencias (
            id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, product_id INTEGER NULL
        )");
        $connection->exec("CREATE TABLE romaneio_itens (
            id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, product_id INTEGER NOT NULL
        )");

        return $connection;
    }

    public function testSalvaEAtualizaProdutoSemCriarDuplicata(): void
    {
        $connection = $this->database();
        $repository = new RepositorioProdutosEventos($connection);
        $productId = $repository->salvar(3, [
            "code" => "SKU-7",
            "name" => "Produto inicial",
            "category" => "Sacas",
            "active" => 1,
            "barcode" => "7890000000007",
        ]);

        $updatedId = $repository->salvar(3, [
            "code" => "SKU-7",
            "name" => "Produto atualizado",
            "category" => "",
            "active" => 0,
            "barcode" => "7890000000007",
        ]);

        self::assertSame($productId, $updatedId);
        self::assertSame(1, (int) $connection->query("SELECT COUNT(*) FROM produtos")->fetchColumn());
        self::assertSame("Produto atualizado", $connection->query("SELECT name FROM produtos")->fetchColumn());
        self::assertNull($connection->query("SELECT category FROM produtos")->fetchColumn());
        self::assertSame(0, (int) $connection->query("SELECT active FROM produtos")->fetchColumn());
        self::assertSame("7890000000007", $connection->query("SELECT barcode FROM codigos_produtos")->fetchColumn());
    }

    public function testSalvaProdutosEmLotePreservandoOrdemEDonoOriginalDoCodigoDeBarras(): void
    {
        $connection = $this->database();
        $repository = new RepositorioProdutosEventos($connection);

        $productIds = $repository->salvarVarios(3, [
            ["code" => "SKU-A", "name" => "A inicial", "barcode" => "CODIGO-COMPARTILHADO"],
            ["code" => "SKU-B", "name" => "B", "barcode" => "CODIGO-COMPARTILHADO"],
            ["code" => "SKU-A", "name" => "A final", "barcode" => "CODIGO-A-2"],
        ]);

        self::assertSame($productIds[0], $productIds[2]);
        self::assertNotSame($productIds[0], $productIds[1]);
        self::assertSame(2, (int) $connection->query("SELECT COUNT(*) FROM produtos")->fetchColumn());
        self::assertSame("A final", $connection->query(
            "SELECT name FROM produtos WHERE code = 'SKU-A'",
        )->fetchColumn());
        self::assertSame($productIds[0], (int) $connection->query(
            "SELECT product_id FROM codigos_produtos WHERE barcode = 'CODIGO-COMPARTILHADO'",
        )->fetchColumn());
        self::assertSame($productIds[0], (int) $connection->query(
            "SELECT product_id FROM codigos_produtos WHERE barcode = 'CODIGO-A-2'",
        )->fetchColumn());
    }

    public function testDivideLotesAntesDoLimiteDeParametrosDoSqlite(): void
    {
        $connection = $this->database();
        $repository = new RepositorioProdutosEventos($connection);
        $items = [];
        for ($index = 1; $index <= 501; $index++) {
            $items[] = ["code" => "SKU-{$index}", "name" => "Produto {$index}"];
        }

        $productIds = $repository->salvarVarios(3, $items);

        self::assertCount(501, $productIds);
        self::assertSame(501, (int) $connection->query("SELECT COUNT(*) FROM produtos")->fetchColumn());
        self::assertSame($productIds[500], (int) $connection->query(
            "SELECT id FROM produtos WHERE code = 'SKU-501'",
        )->fetchColumn());
    }

    public function testValidaTodoOLoteAntesDePersistirQualquerProduto(): void
    {
        $connection = $this->database();
        $repository = new RepositorioProdutosEventos($connection);

        try {
            $repository->salvarVarios(3, [
                ["code" => "SKU-VALIDO", "name" => "Produto válido"],
                ["code" => "SKU@INVALIDO", "name" => "Produto inválido"],
            ]);
            self::fail("Era esperado rejeitar o lote inválido.");
        } catch (RuntimeException $exception) {
            self::assertSame("Produto recebido pela sincronização é inválido.", $exception->getMessage());
        }

        self::assertSame(0, (int) $connection->query("SELECT COUNT(*) FROM produtos")->fetchColumn());
    }

    public function testCodigoDeBarrasExistenteNaoMudaDeProduto(): void
    {
        $connection = $this->database();
        $connection->exec("INSERT INTO produtos (id, company_id, code, name, active)
                           VALUES (5, 3, 'SKU-A', 'Produto A', 1), (6, 3, 'SKU-B', 'Produto B', 1)");
        $connection->exec("INSERT INTO codigos_produtos (company_id, product_id, barcode)
                           VALUES (3, 5, '7890000000005')");
        $repository = new RepositorioProdutosEventos($connection);

        $repository->salvar(3, [
            "code" => "SKU-B",
            "name" => "Produto B",
            "active" => 1,
            "barcode" => "7890000000005",
        ]);

        self::assertSame(5, (int) $connection->query(
            "SELECT product_id FROM codigos_produtos WHERE barcode = '7890000000005'",
        )->fetchColumn());
        self::assertSame(1, (int) $connection->query("SELECT COUNT(*) FROM codigos_produtos")->fetchColumn());
    }

    public function testExclusaoAfetaSomenteRegistrosDaEmpresaDoProduto(): void
    {
        $connection = $this->database();
        $connection->exec("INSERT INTO produtos (id, company_id, code, name, active)
                           VALUES (5, 3, 'SKU-A', 'Produto A', 1)");
        $connection->exec("INSERT INTO codigos_produtos (company_id, product_id, barcode)
                           VALUES (3, 5, 'CODIGO-A'), (9, 5, 'CODIGO-OUTRA-EMPRESA')");
        $connection->exec("INSERT INTO leituras (company_id, product_id) VALUES (3, 5), (9, 5)");
        $connection->exec("INSERT INTO ocorrencias (company_id, product_id) VALUES (3, 5), (9, 5)");
        $connection->exec("INSERT INTO romaneio_itens (company_id, product_id) VALUES (3, 5), (9, 5)");
        $repository = new RepositorioProdutosEventos($connection);

        self::assertSame(5, $repository->excluir(3, ["code" => "SKU-A"], 5));
        self::assertSame(0, (int) $connection->query("SELECT COUNT(*) FROM produtos WHERE company_id = 3")->fetchColumn());
        self::assertSame(1, (int) $connection->query("SELECT COUNT(*) FROM codigos_produtos WHERE company_id = 9")->fetchColumn());
        self::assertSame(1, (int) $connection->query("SELECT COUNT(*) FROM leituras WHERE company_id = 3 AND product_id IS NULL")->fetchColumn());
        self::assertSame(5, (int) $connection->query("SELECT product_id FROM leituras WHERE company_id = 9")->fetchColumn());
        self::assertSame(1, (int) $connection->query("SELECT COUNT(*) FROM ocorrencias WHERE company_id = 3 AND product_id IS NULL")->fetchColumn());
        self::assertSame(5, (int) $connection->query("SELECT product_id FROM ocorrencias WHERE company_id = 9")->fetchColumn());
        self::assertSame(0, (int) $connection->query("SELECT COUNT(*) FROM romaneio_itens WHERE company_id = 3")->fetchColumn());
        self::assertSame(1, (int) $connection->query("SELECT COUNT(*) FROM romaneio_itens WHERE company_id = 9")->fetchColumn());
    }

    public function testPayloadDeProdutoInvalidoEhRejeitadoAntesDeGravar(): void
    {
        $connection = $this->database();
        $repository = new RepositorioProdutosEventos($connection);

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage("Produto recebido pela sincronização é inválido.");
        $repository->salvar(3, ["code" => "SKU@INVALIDO", "name" => "Produto"]);
    }
}
