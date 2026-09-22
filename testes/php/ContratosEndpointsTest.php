<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

final class ContratosEndpointsTest extends TestCase
{
    public function testExclusaoDeAcaoNaoExigeCorpoJson(): void
    {
        $source = file_get_contents(__DIR__ . "/../../servidor/api/acoes_dala.php");

        self::assertIsString($source);
        self::assertStringContainsString(
            'exigir_metodo_http(["GET", "POST", "PATCH", "DELETE"]);',
            $source,
        );
        self::assertStringContainsString(
            '$payload = in_array($method, ["POST", "PATCH"], true) ? request_json() : [];',
            $source,
        );
    }

    public function testLogoutAceitaSomentePost(): void
    {
        $source = file_get_contents(__DIR__ . "/../../servidor/api/logout.php");

        self::assertIsString($source);
        self::assertStringContainsString('exigir_metodo_http(["POST"]);', $source);
    }

    public function testMutacoesOperacionaisMantemAuditoriaNaMesmaTransacao(): void
    {
        foreach (["ocorrencias.php", "configuracoes.php", "sensor_eventos.php"] as $endpoint) {
            $source = file_get_contents(__DIR__ . "/../../servidor/api/" . $endpoint);

            self::assertIsString($source);
            self::assertStringContainsString("beginTransaction", $source, $endpoint);
            self::assertStringContainsString("commit", $source, $endpoint);
            self::assertStringContainsString("rollBack", $source, $endpoint);
        }
    }

    public function testFilaMortaPermiteReenfileirarComAuditoria(): void
    {
        $endpoint = file_get_contents(__DIR__ . "/../../servidor/api/sync_dead_letter.php");
        $worker = file_get_contents(__DIR__ . "/../../servidor/src/Aplicacao/ServicoSincronizacao.php");
        $readiness = file_get_contents(__DIR__ . "/../../servidor/api/prontidao.php");

        self::assertIsString($endpoint);
        self::assertIsString($worker);
        self::assertIsString($readiness);
        self::assertStringContainsString('"requeue"', $endpoint);
        self::assertStringContainsString("registrar_evento_operacional", $endpoint);
        self::assertStringContainsString("beginTransaction", $endpoint);
        self::assertStringContainsString("resolved_at = NULL", $worker);
        self::assertStringContainsString("dead_letter_pending", $readiness);
    }

    public function testHeartbeatDaInstalacaoRegistraPcIndustrialNoServidorCentral(): void
    {
        $endpoint = file_get_contents(__DIR__ . "/../../servidor/api/sincronizacao_instalacao.php");
        $migration = file_get_contents(__DIR__ . "/../../banco-de-dados/migrations/051_status_pc_industrial.sql");

        self::assertIsString($endpoint);
        self::assertIsString($migration);
        self::assertStringContainsString('"industrial_pc"', $endpoint);
        self::assertStringContainsString("status_pc_industrial", $endpoint);
        self::assertStringContainsString("status_pc_industrial", $migration);
    }
}
