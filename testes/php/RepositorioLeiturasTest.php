<?php

declare(strict_types=1);

use App\Persistencia\RepositorioLeituras;
use PHPUnit\Framework\TestCase;

require_once __DIR__ . "/../../servidor/src/Persistencia/RepositorioLeituras.php";

final class RepositorioLeiturasTest extends TestCase
{
    public function testBuscaProdutoAtivoPorCodigoRespeitaEmpresa(): void
    {
        $pdo = $this->criarBancoDeTeste();
        $pdo->exec("INSERT INTO produtos VALUES
            (10, 10, 1),
            (20, 20, 1),
            (30, 10, 0),
            (40, 20, 1)");
        $pdo->exec("INSERT INTO codigos_produtos VALUES
            (10, 10, 'CODIGO-COMPARTILHADO'),
            (20, 20, 'CODIGO-COMPARTILHADO'),
            (10, 30, 'PRODUTO-INATIVO'),
            (10, 40, 'PRODUTO-DE-OUTRA-EMPRESA')");
        $repository = new RepositorioLeituras($pdo);

        self::assertSame(10, $repository->buscarProdutoAtivoPorCodigo(10, "CODIGO-COMPARTILHADO"));
        self::assertSame(20, $repository->buscarProdutoAtivoPorCodigo(20, "CODIGO-COMPARTILHADO"));
        self::assertNull($repository->buscarProdutoAtivoPorCodigo(10, "PRODUTO-INATIVO"));
        self::assertNull($repository->buscarProdutoAtivoPorCodigo(10, "PRODUTO-DE-OUTRA-EMPRESA"));
        self::assertNull($repository->buscarProdutoAtivoPorCodigo(10, "NAO-EXISTE"));
    }

    public function testQuantidadesSomamItensRepetidosIncluemItensGlobaisEIsolamEmpresa(): void
    {
        $pdo = $this->criarBancoDeTeste();
        $pdo->exec("INSERT INTO romaneio_itens VALUES
            (1, 10, 70, 10, 8, 2),
            (2, 10, 70, 10, 8, 3),
            (3, 10, 70, 20, 8, 4),
            (4, 10, 70, 10, NULL, 1),
            (5, 10, 70, 99, 9, 99),
            (6, 20, 70, 10, 8, 50)");
        $pdo->exec("INSERT INTO leituras VALUES
            (1, 10, 500, 10, 'VALIDO'),
            (2, 10, 500, 10, 'VALIDO'),
            (3, 10, 500, 10, 'PRODUTO_INCORRETO'),
            (4, 10, 501, 10, 'VALIDO'),
            (5, 10, 500, 20, 'VALIDO'),
            (6, 20, 500, 10, 'VALIDO')");

        $quantities = (new RepositorioLeituras($pdo))->obterQuantidadesParaClassificar(
            10,
            500,
            70,
            8,
            10,
        );

        self::assertSame([
            "loading_planned_quantity" => 10,
            "product_planned_quantity" => 6,
            "product_valid_count" => 2,
        ], $quantities);
    }

    public function testSemProdutoRetornaApenasTotalPlanejado(): void
    {
        $pdo = $this->criarBancoDeTeste();
        $pdo->exec("INSERT INTO romaneio_itens VALUES
            (1, 10, 70, 10, 8, 2),
            (2, 10, 70, 20, NULL, 3)");
        $pdo->exec("INSERT INTO leituras VALUES (1, 10, 500, 0, 'VALIDO')");

        $quantities = (new RepositorioLeituras($pdo))->obterQuantidadesParaClassificar(
            10,
            500,
            70,
            8,
            null,
        );

        self::assertSame([
            "loading_planned_quantity" => 5,
            "product_planned_quantity" => 0,
            "product_valid_count" => 0,
        ], $quantities);
    }

    public function testBuscaEventoOfflineELeituraOriginalNaMesmaConsulta(): void
    {
        $pdo = $this->criarBancoDeTeste();
        $pdo->exec("INSERT INTO leituras VALUES (21, 10, 500, 10, 'VALIDO')");
        $audit = $pdo->prepare(
            "INSERT INTO logs_auditoria (company_id, event_uuid, action, entity_id, metadata)
             VALUES (10, :event_uuid, 'LEITURA_REGISTRADA', 21, :metadata)",
        );
        $audit->execute([
            "event_uuid" => "event-company-10",
            "metadata" => '{"carregamento_id":500,"barcode":"123456"}',
        ]);
        $repository = new RepositorioLeituras($pdo);

        $registered = $repository->buscarLeituraOfflineRegistrada(10, "event-company-10", 500);
        $wrongCompany = $repository->buscarLeituraOfflineRegistrada(20, "event-company-10", 500);
        $wrongLoading = $repository->buscarLeituraOfflineRegistrada(10, "event-company-10", 501);

        self::assertSame(21, (int) $registered["reading_id"]);
        self::assertSame("VALIDO", $registered["result"]);
        self::assertNull($wrongCompany);
        self::assertNotNull($wrongLoading);
        self::assertNull($wrongLoading["reading_id"]);
    }

    private function criarBancoDeTeste(): PDO
    {
        $pdo = new PDO("sqlite::memory:", null, null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
        $pdo->exec("CREATE TABLE romaneio_itens (
            id INTEGER PRIMARY KEY,
            company_id INTEGER NOT NULL,
            romaneio_id INTEGER NOT NULL,
            product_id INTEGER NOT NULL,
            truck_id INTEGER NULL,
            planned_quantity INTEGER NOT NULL
        )");
        $pdo->exec("CREATE TABLE leituras (
            id INTEGER PRIMARY KEY,
            company_id INTEGER NOT NULL,
            carregamento_id INTEGER NOT NULL,
            product_id INTEGER NULL,
            result TEXT NOT NULL
        )");
        $pdo->exec("CREATE TABLE logs_auditoria (
            company_id INTEGER NOT NULL,
            event_uuid TEXT NOT NULL,
            action TEXT NOT NULL,
            entity_id INTEGER NOT NULL,
            metadata TEXT NOT NULL
        )");
        $pdo->exec("CREATE TABLE produtos (
            id INTEGER PRIMARY KEY,
            company_id INTEGER NOT NULL,
            active INTEGER NOT NULL
        )");
        $pdo->exec("CREATE TABLE codigos_produtos (
            company_id INTEGER NOT NULL,
            product_id INTEGER NOT NULL,
            barcode TEXT NOT NULL
        )");

        return $pdo;
    }
}
