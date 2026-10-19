<?php

declare(strict_types=1);

use App\Persistencia\RepositorioItensRomaneioSincronizacao;
use PHPUnit\Framework\TestCase;

final class RepositorioItensRomaneioSincronizacaoTest extends TestCase
{
    private function database(): PDO
    {
        $connection = new PDO(
            "sqlite::memory:",
            null,
            null,
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC],
        );
        $connection->exec(
            "CREATE TABLE romaneio_itens (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                company_id INTEGER NOT NULL,
                romaneio_id INTEGER NOT NULL,
                product_id INTEGER NOT NULL,
                truck_id INTEGER NULL,
                planned_quantity INTEGER NOT NULL
            )",
        );

        return $connection;
    }

    public function testSubstituiItensPreservandoLinhasDeProdutoDuplicadas(): void
    {
        $connection = $this->database();
        $connection->exec("INSERT INTO romaneio_itens (company_id, romaneio_id, product_id, truck_id, planned_quantity)
                           VALUES (3, 12, 8, 4, 99)");
        $connection->exec("INSERT INTO romaneio_itens (company_id, romaneio_id, product_id, truck_id, planned_quantity)
                           VALUES (9, 12, 21, 5, 6)");
        $repository = new RepositorioItensRomaneioSincronizacao($connection);
        $productWriter = static fn (int $companyId, array $items): array => array_map(
            static fn (array $item): int => (int) $item["product_id"],
            $items,
        );

        $repository->substituirItens(3, 12, 4, [
            ["product_id" => 8, "planned_quantity" => 5],
            ["product_id" => 8, "planned_quantity" => 7],
        ], $productWriter);

        $items = $connection->query(
            "SELECT company_id, romaneio_id, product_id, truck_id, planned_quantity
             FROM romaneio_itens ORDER BY company_id, id",
        )->fetchAll();
        self::assertSame([
            ["company_id" => 3, "romaneio_id" => 12, "product_id" => 8, "truck_id" => 4, "planned_quantity" => 5],
            ["company_id" => 3, "romaneio_id" => 12, "product_id" => 8, "truck_id" => 4, "planned_quantity" => 7],
            ["company_id" => 9, "romaneio_id" => 12, "product_id" => 21, "truck_id" => 5, "planned_quantity" => 6],
        ], $items);
    }

    public function testSubstituiItensDeUmCaminhaoSemApagarItensCompartilhadosOuDeOutroCaminhao(): void
    {
        $connection = $this->database();
        $connection->exec("INSERT INTO romaneio_itens (company_id, romaneio_id, product_id, truck_id, planned_quantity)
                           VALUES (3, 12, 7, NULL, 2), (3, 12, 8, 4, 99), (3, 12, 9, 5, 4)");
        $repository = new RepositorioItensRomaneioSincronizacao($connection);
        $productWriter = static fn (int $companyId, array $items): array => array_map(
            static fn (array $item): int => (int) $item["product_id"],
            $items,
        );

        $repository->substituirItens(3, 12, 4, [
            ["product_id" => 8, "planned_quantity" => 5],
        ], $productWriter);

        $items = $connection->query(
            "SELECT product_id, truck_id, planned_quantity FROM romaneio_itens
             WHERE company_id = 3 AND romaneio_id = 12 ORDER BY product_id",
        )->fetchAll();
        self::assertSame([
            ["product_id" => 7, "truck_id" => null, "planned_quantity" => 2],
            ["product_id" => 8, "truck_id" => 4, "planned_quantity" => 5],
            ["product_id" => 9, "truck_id" => 5, "planned_quantity" => 4],
        ], $items);
    }

    public function testSubstituiItensCompartilhadosSemApagarItensDosCaminhoes(): void
    {
        $connection = $this->database();
        $connection->exec("INSERT INTO romaneio_itens (company_id, romaneio_id, product_id, truck_id, planned_quantity)
                           VALUES (3, 12, 8, 4, 99), (3, 12, 9, 5, 4), (3, 12, 7, NULL, 2)");
        $repository = new RepositorioItensRomaneioSincronizacao($connection);
        $productWriter = static fn (int $companyId, array $items): array => array_map(
            static fn (array $item): int => (int) $item["product_id"],
            $items,
        );

        $repository->substituirItens(3, 12, 0, [
            ["product_id" => 7, "planned_quantity" => 6],
        ], $productWriter);

        $items = $connection->query(
            "SELECT product_id, truck_id, planned_quantity FROM romaneio_itens
             WHERE company_id = 3 AND romaneio_id = 12 ORDER BY product_id",
        )->fetchAll();
        self::assertSame([
            ["product_id" => 7, "truck_id" => null, "planned_quantity" => 6],
            ["product_id" => 8, "truck_id" => 4, "planned_quantity" => 99],
            ["product_id" => 9, "truck_id" => 5, "planned_quantity" => 4],
        ], $items);
    }

    public function testPayloadInvalidoNaoApagaItensPersistidos(): void
    {
        $connection = $this->database();
        $connection->exec("INSERT INTO romaneio_itens (company_id, romaneio_id, product_id, truck_id, planned_quantity)
                           VALUES (3, 12, 8, 4, 99)");
        $repository = new RepositorioItensRomaneioSincronizacao($connection);
        $productWriter = static fn (int $companyId, array $items): array => array_map(
            static fn (array $item): int => (int) $item["product_id"],
            $items,
        );

        try {
            $repository->substituirItens(3, 12, 4, [
                ["product_id" => 9, "planned_quantity" => 3],
                ["product_id" => 10, "planned_quantity" => 0],
            ], $productWriter);
            self::fail("Era esperado rejeitar a quantidade inválida.");
        } catch (RuntimeException $exception) {
            self::assertSame("Quantidade de item recebida pela sincronização é inválida.", $exception->getMessage());
        }

        self::assertSame(1, (int) $connection->query("SELECT COUNT(*) FROM romaneio_itens")->fetchColumn());
        self::assertSame(99, (int) $connection->query("SELECT planned_quantity FROM romaneio_itens")->fetchColumn());
    }

    public function testRepositorioRespeitaATransacaoDoEvento(): void
    {
        $connection = $this->database();
        $connection->beginTransaction();
        $repository = new RepositorioItensRomaneioSincronizacao($connection);
        $productWriter = static fn (int $companyId, array $items): array => array_map(
            static fn (array $item): int => (int) $item["product_id"],
            $items,
        );

        $repository->substituirItens(3, 12, 0, [
            ["product_id" => 8, "quantity" => 2],
        ], $productWriter);

        self::assertTrue($connection->inTransaction());
        self::assertNull($connection->query("SELECT truck_id FROM romaneio_itens")->fetchColumn());
        $connection->rollBack();
        self::assertSame(0, (int) $connection->query("SELECT COUNT(*) FROM romaneio_itens")->fetchColumn());
    }
}
