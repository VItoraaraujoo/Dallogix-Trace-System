<?php

declare(strict_types=1);

require_once __DIR__ . "/../../servidor/configuracao/bootstrap.php";

use PHPUnit\Framework\TestCase;

final class SegurancaHardeningTest extends TestCase
{
    protected function tearDown(): void
    {
        putenv("TRACE_ALLOWED_DEVICE_HOSTS");
        putenv("TRACE_ALLOWED_DEVICE_PORTS");
    }

    public function testDestinoDeRedeExigeAllowlistDeHostEPorta(): void
    {
        putenv("TRACE_ALLOWED_DEVICE_HOSTS=gateway.example.com,192.0.2.10");
        putenv("TRACE_ALLOWED_DEVICE_PORTS=502,1502");

        self::assertTrue(destino_dispositivo_permitido("gateway.example.com", 502));
        self::assertTrue(destino_dispositivo_permitido("192.0.2.10", 1502));
        self::assertFalse(destino_dispositivo_permitido("127.0.0.1", 502));
        self::assertFalse(destino_dispositivo_permitido("gateway.example.com", 22));
    }

    public function testCredencialDaInstalacaoTemEntropiaEFormatoEsperados(): void
    {
        self::assertTrue(credencial_instalacao_valida(str_repeat("a", 64)));
        self::assertFalse(credencial_instalacao_valida("TRC-AAAA-BBBB"));
        self::assertFalse(credencial_instalacao_valida(str_repeat("a", 63)));
    }

    public function testSessaoLegadaNaoECompatívelSemAuthVersion(): void
    {
        self::assertFalse(sessao_auth_version_compativel(0, 1));
        self::assertTrue(sessao_auth_version_compativel(1, 1));
        self::assertFalse(sessao_auth_version_compativel(1, 2));
    }
}
