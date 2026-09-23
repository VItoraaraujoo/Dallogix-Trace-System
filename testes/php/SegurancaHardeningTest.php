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
        putenv("TRACE_INSTALLATION_MODE");
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

    public function testPcIndustrialAceitaIpPrivadoDaDalaSemDestinoPredefinido(): void
    {
        putenv("TRACE_INSTALLATION_MODE=local");
        putenv("TRACE_ALLOWED_DEVICE_HOSTS");
        putenv("TRACE_ALLOWED_DEVICE_PORTS");

        self::assertSame("10.1.2.3", resolver_destino_clp_local("10.1.2.3", 502));
        self::assertSame("172.18.0.2", resolver_destino_clp_local("172.18.0.2", 1502));
        self::assertSame("192.168.1.10", resolver_destino_clp_local("192.168.1.10", 1502));
        self::assertNull(resolver_destino_clp_local("127.0.0.1", 502));
        self::assertNull(resolver_destino_clp_local("169.254.169.254", 80));
        self::assertNull(resolver_destino_clp_local("8.8.8.8", 502));
        self::assertNull(resolver_destino_clp_local("192.168.1.10", 0));
        self::assertNull(resolver_destino_clp_local("999.999.999.999", 502));
    }

    public function testServidorCentralNaoAbreDestinoPrivadoPeloCaminhoLocal(): void
    {
        putenv("TRACE_INSTALLATION_MODE=central");
        self::assertNull(resolver_destino_clp_local("192.168.1.10", 502));
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
