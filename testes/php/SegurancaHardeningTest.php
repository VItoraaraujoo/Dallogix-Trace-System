<?php

declare(strict_types=1);

require_once __DIR__ . "/../../servidor/configuracao/bootstrap.php";

use PHPUnit\Framework\TestCase;

final class SegurancaHardeningTest extends TestCase
{
    /** @param array<string, string> $environment */
    private function executarPhpIsolado(string $codigo, array $environment): string
    {
        $descriptors = [
            0 => ["pipe", "r"],
            1 => ["pipe", "w"],
            2 => ["pipe", "w"],
        ];
        $process = proc_open(
            [PHP_BINARY, "-r", $codigo],
            $descriptors,
            $pipes,
            dirname(__DIR__, 2),
            array_merge(getenv(), $environment),
        );
        self::assertIsResource($process);
        fclose($pipes[0]);
        $output = stream_get_contents($pipes[1]);
        $error = stream_get_contents($pipes[2]);
        fclose($pipes[1]);
        fclose($pipes[2]);
        self::assertSame(0, proc_close($process), $error ?: "Execução PHP isolada falhou.");
        return (string) $output;
    }

    public function testFlagsLegadasNaoDesativamCsrfEmAmbientesOperacionais(): void
    {
        $bootstrap = var_export(dirname(__DIR__, 2) . "/servidor/configuracao/bootstrap.php", true);
        foreach (["local", "production"] as $ambiente) {
            $environment = [
                "APP_ENV" => $ambiente,
                "TRACE_TESTING_DISABLE_CSRF" => "1",
            ];
            $semToken = $this->executarPhpIsolado(
                "require {$bootstrap}; exigir_csrf(); echo 'BYPASS';",
                $environment,
            );
            self::assertSame(
                ["error" => "Token CSRF inválido ou ausente."],
                json_decode($semToken, true),
                "CSRF foi ignorado em {$ambiente}.",
            );

            $comToken = $this->executarPhpIsolado(
                "require {$bootstrap}; \$_SERVER['HTTP_X_CSRF_TOKEN'] = gerar_token_csrf(); exigir_csrf(); echo 'OK';",
                $environment,
            );
            self::assertSame("OK", $comToken);
        }
    }

    public function testFlagLegadaNaoDesativaLimitadoresDeLoginEAtivacao(): void
    {
        $bootstrap = var_export(dirname(__DIR__, 2) . "/servidor/configuracao/bootstrap.php", true);
        foreach (["local", "production"] as $ambiente) {
            foreach (["verificar_taxa_de_login('teste')", "verificar_taxa_de_ativacao('teste')", "registrar_login_sucesso('teste')"] as $chamada) {
                $output = $this->executarPhpIsolado(
                    "require {$bootstrap}; try { {$chamada}; echo 'BYPASS'; } catch (RuntimeException \$error) { echo \$error->getMessage(); }",
                    [
                        "APP_ENV" => $ambiente,
                        "DB_PASSWORD" => "",
                        "TRACE_TESTING_DISABLE_LOGIN_RATE_LIMIT" => "1",
                    ],
                );
                self::assertSame("DB_PASSWORD não configurado.", $output, "{$chamada} ignorou o banco em {$ambiente}.");
            }
        }
    }

    protected function tearDown(): void
    {
        putenv("TRACE_INSTALLATION_MODE");
    }

    public function testPcIndustrialAceitaIpPrivadoDaDalaSemDestinoPredefinido(): void
    {
        putenv("TRACE_INSTALLATION_MODE=local");

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

    public function testUrlRemotaExigeHttpsEEnderecoPublico(): void
    {
        self::assertSame("https://8.8.8.8/events", url_remota_segura("https://8.8.8.8/events"));
        self::assertSame("", url_remota_segura("http://8.8.8.8/events"));
        self::assertSame("", url_remota_segura("https://127.0.0.1/events"));
        self::assertSame("", url_remota_segura("https://user:pass@8.8.8.8/events"));
    }
}
