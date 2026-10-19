<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once __DIR__ . "/../../servidor/configuracao/observabilidade.php";

final class ObservabilidadeTest extends TestCase
{
    public function testIdServidorNaoPodeSerEscolhidoPeloClienteEAOrigemEPropagada(): void
    {
        $_SERVER["HTTP_X_CORRELATION_ID"] = "cliente-req-000001";
        $requestId = trace_correlation_id();
        self::assertMatchesRegularExpression('/\A[a-f0-9]{32}\z/', $requestId);
        self::assertNotSame("cliente-req-000001", $requestId);

        $payload = trace_payload_com_correlacao(["correlation_id" => "cliente-body-0001"]);
        self::assertSame($requestId, $payload["correlation_id"]);
        self::assertSame("cliente-body-0001", $payload["upstream_correlation_id"]);

        $secondPass = trace_payload_com_correlacao($payload);
        self::assertSame($requestId, $secondPass["correlation_id"]);
        self::assertSame("cliente-body-0001", $secondPass["upstream_correlation_id"]);

        unset($_SERVER["HTTP_X_CORRELATION_ID"]);
    }

    public function testRedigeSegredosEmMensagensDeErro(): void
    {
        $message = 'DB_PASSWORD=senha123 Authorization: Bearer abc123 {"token":"xyz456"} https://operador:senha@host.local';
        $redacted = trace_redigir_segredos($message);

        self::assertStringNotContainsString("senha123", $redacted);
        self::assertStringNotContainsString("abc123", $redacted);
        self::assertStringNotContainsString("xyz456", $redacted);
        self::assertStringNotContainsString("operador:senha", $redacted);
        self::assertSame(4, substr_count($redacted, "[omitido]") + substr_count($redacted, "[credenciais]"));
    }
}
