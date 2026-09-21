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
}
