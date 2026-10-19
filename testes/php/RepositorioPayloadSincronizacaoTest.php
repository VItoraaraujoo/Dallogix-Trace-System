<?php

declare(strict_types=1);

use App\Persistencia\RepositorioPayloadSincronizacao;
use PHPUnit\Framework\TestCase;

final class RepositorioPayloadSincronizacaoTest extends TestCase
{
    public function testPayloadDeRomaneioPreservaLinhasSeparadasDoMesmoProduto(): void
    {
        $pdo = $this->criarBancoRomaneios();
        $pdo->exec("INSERT INTO romaneios VALUES (31, 3, 301, 'R-31', '2026-10-20', 'AGUARDANDO', 'Expedição')");
        $pdo->exec("INSERT INTO romaneio_caminhoes VALUES (81, 31, 801, 'ABC1D23', 'Motorista')");
        $pdo->exec("INSERT INTO produtos VALUES (5, 3, 'SKU-5', 'Produto 5', 'Sacas', 1)");
        $pdo->exec("INSERT INTO codigos_produtos VALUES (1, 3, 5, '7890000000005')");
        $pdo->exec("INSERT INTO romaneio_itens VALUES (1, 31, 5, 2), (2, 31, 5, 3)");

        $payload = $this->preparar($pdo, 3, 31, "ROMANEIO_CRIADO");

        self::assertSame(301, $payload["data"]["remote_romaneio_id"]);
        self::assertSame(801, $payload["data"]["truck"]["remote_truck_id"]);
        self::assertCount(2, $payload["data"]["items"]);
        self::assertSame([2, 3], array_column($payload["data"]["items"], "planned_quantity"));
        self::assertSame([5, 5], array_column($payload["data"]["items"], "remote_product_id"));
    }

    public function testPayloadNaoIncluiRomaneioDeOutraEmpresa(): void
    {
        $pdo = $this->criarBancoRomaneios();
        $pdo->exec("INSERT INTO romaneios VALUES (31, 4, 401, 'R-31', '2026-10-20', 'AGUARDANDO', 'Privado')");

        $payload = $this->preparar($pdo, 3, 31, "ROMANEIO_CRIADO");

        self::assertSame(["action" => "ROMANEIO_CRIADO", "data" => ["original" => true]], $payload);
    }

    public function testPayloadDeCarregamentoUsaRelacionamentosERemoteIdsAtuais(): void
    {
        $pdo = new PDO(
            "sqlite::memory:",
            null,
            null,
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC],
        );
        $pdo->exec("CREATE TABLE romaneios (
            id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL, remote_romaneio_id INTEGER,
            number TEXT NOT NULL, scheduled_date TEXT NOT NULL, status TEXT NOT NULL, expedidor TEXT NOT NULL
        )");
        $pdo->exec("CREATE TABLE romaneio_caminhoes (
            id INTEGER PRIMARY KEY, romaneio_id INTEGER NOT NULL, remote_truck_id INTEGER,
            plate TEXT NOT NULL, driver_name TEXT NOT NULL
        )");
        $pdo->exec("CREATE TABLE equipamentos (
            id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL, remote_equipment_id INTEGER, equipment_code TEXT NOT NULL
        )");
        $pdo->exec("CREATE TABLE carregamentos (
            id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL, remote_carregamento_id INTEGER,
            state TEXT NOT NULL, equipment_id INTEGER, started_at TEXT, romaneio_id INTEGER NOT NULL, truck_id INTEGER NOT NULL
        )");
        $pdo->exec("INSERT INTO romaneios VALUES (31, 3, 301, 'R-31', '2026-10-20', 'EM_ANDAMENTO', 'Expedição')");
        $pdo->exec("INSERT INTO romaneio_caminhoes VALUES (81, 31, 801, 'ABC1D23', 'Motorista')");
        $pdo->exec("INSERT INTO equipamentos VALUES (91, 3, 901, 'DALA-1')");
        $pdo->exec("INSERT INTO carregamentos VALUES (101, 3, 1001, 'CARREGANDO', 91, '2026-10-19 10:00:00', 31, 81)");

        $payload = $this->preparar($pdo, 3, 101, "CARREGAMENTO_PREPARADO");

        self::assertSame(1001, $payload["data"]["remote_carregamento_id"]);
        self::assertSame(301, $payload["data"]["remote_romaneio_id"]);
        self::assertSame(801, $payload["data"]["remote_truck_id"]);
        self::assertSame(901, $payload["data"]["remote_equipment_id"]);
        self::assertSame("CARREGANDO", $payload["data"]["state"]);
    }

    private function criarBancoRomaneios(): PDO
    {
        $pdo = new PDO(
            "sqlite::memory:",
            null,
            null,
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC],
        );
        $pdo->exec("CREATE TABLE romaneios (
            id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL, remote_romaneio_id INTEGER,
            number TEXT NOT NULL, scheduled_date TEXT NOT NULL, status TEXT NOT NULL, expedidor TEXT NOT NULL
        )");
        $pdo->exec("CREATE TABLE romaneio_caminhoes (
            id INTEGER PRIMARY KEY, romaneio_id INTEGER NOT NULL, remote_truck_id INTEGER,
            plate TEXT NOT NULL, driver_name TEXT NOT NULL
        )");
        $pdo->exec("CREATE TABLE produtos (
            id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL,
            category TEXT, active INTEGER NOT NULL
        )");
        $pdo->exec("CREATE TABLE codigos_produtos (
            id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL, product_id INTEGER NOT NULL, barcode TEXT NOT NULL
        )");
        $pdo->exec("CREATE TABLE romaneio_itens (
            id INTEGER PRIMARY KEY, romaneio_id INTEGER NOT NULL, product_id INTEGER NOT NULL, planned_quantity INTEGER NOT NULL
        )");
        return $pdo;
    }

    private function preparar(PDO $pdo, int $companyId, int $entityId, string $action): array
    {
        $repository = new RepositorioPayloadSincronizacao($pdo);
        $payload = $repository->prepararEvento([
            "company_id" => $companyId,
            "aggregate_id" => $entityId,
            "payload" => json_encode([
                "action" => $action,
                "data" => ["original" => true],
            ], JSON_THROW_ON_ERROR),
        ]);

        self::assertIsArray($payload);
        return $payload;
    }
}
