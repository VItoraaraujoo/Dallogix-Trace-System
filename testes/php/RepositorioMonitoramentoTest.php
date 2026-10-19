<?php

declare(strict_types=1);

use App\Persistencia\RepositorioMonitoramento;
use PHPUnit\Framework\TestCase;

require_once __DIR__ . "/../../servidor/src/Persistencia/RepositorioMonitoramento.php";

final class RepositorioMonitoramentoTest extends TestCase
{
    public function testUltimaLeituraFicaIsoladaPorEmpresa(): void
    {
        $pdo = new PDO("sqlite::memory:", null, null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
        $pdo->exec("CREATE TABLE leituras (
            id INTEGER PRIMARY KEY,
            company_id INTEGER NOT NULL,
            barcode TEXT,
            result TEXT NOT NULL,
            read_at TEXT NOT NULL
        )");
        $pdo->exec("INSERT INTO leituras VALUES
            (1, 10, 'A-1', 'VALIDO', '2026-10-19 10:00:00'),
            (2, 20, 'B-1', 'VALIDO', '2026-10-19 10:01:00'),
            (3, 10, 'A-2', 'RETORNO', '2026-10-19 10:02:00')");

        $latest = (new RepositorioMonitoramento($pdo))->obterUltimaLeitura(10);

        self::assertSame([[
            "barcode" => "A-2",
            "result" => "RETORNO",
            "read_at" => "2026-10-19 10:02:00",
        ]], $latest);
    }

    public function testMigrationCriaIndiceCompostoParaUltimaLeitura(): void
    {
        $migration = file_get_contents(__DIR__ . "/../../banco-de-dados/migrations/069_indice_ultima_leitura_empresa.sql");

        self::assertIsString($migration);
        self::assertStringContainsString("idx_reading_company_latest", $migration);
        self::assertStringContainsString("(company_id, id)", $migration);
        self::assertStringContainsString("information_schema.statistics", $migration);
    }

    public function testContagemDeLeiturasFiltraEmpresaEDataComIndiceComposto(): void
    {
        $source = file_get_contents(__DIR__ . "/../../servidor/src/Persistencia/RepositorioMonitoramento.php");
        $index = file_get_contents(__DIR__ . "/../../banco-de-dados/migrations/071_indice_monitoramento_leituras_empresa_data.sql");

        self::assertIsString($source);
        self::assertIsString($index);
        self::assertStringContainsString("WHERE l.company_id = :reading_company_id", $source);
        self::assertStringContainsString("c.company_id = :loading_company_id", $source);
        self::assertStringContainsString("l.read_at >= DATE_SUB(NOW(), INTERVAL", $source);
        self::assertStringContainsString("(company_id, read_at, carregamento_id, result)", $index);
    }

    public function testLeiturasDosCarregamentosAtivosTambemFiltramEmpresa(): void
    {
        $source = file_get_contents(__DIR__ . "/../../servidor/src/Persistencia/RepositorioMonitoramento.php");
        $index = file_get_contents(__DIR__ . "/../../banco-de-dados/migrations/070_indice_contagem_produto_carregamento.sql");

        self::assertIsString($source);
        self::assertIsString($index);
        $method = substr($source, strpos($source, "private function anexarItensCarregados"));
        self::assertStringContainsString("l.company_id = :reading_company_id", $method);
        self::assertStringContainsString('"reading_company_id" => $companyId', $method);
        self::assertStringContainsString("(company_id, carregamento_id, result, product_id)", $index);
    }

    public function testContagemDeEventosSensorTemIndiceParaCarregamentoEEquipamento(): void
    {
        $source = file_get_contents(__DIR__ . "/../../servidor/src/Persistencia/RepositorioMonitoramento.php");
        $index = file_get_contents(__DIR__ . "/../../banco-de-dados/migrations/072_indice_evento_sensor_carregamento_equipamento.sql");

        self::assertIsString($source);
        self::assertIsString($index);
        self::assertStringContainsString(
            "JOIN carregamentos_ativos ca\n                  ON ca.id = se.carregamento_id AND ca.equipment_id = se.equipment_id",
            $source,
        );
        self::assertStringContainsString("idx_sensor_loading_equipment", $index);
        self::assertStringContainsString("(carregamento_id, equipment_id)", $index);
        self::assertStringContainsString("information_schema.statistics", $index);
    }
}
