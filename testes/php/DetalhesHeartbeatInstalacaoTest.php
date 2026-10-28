<?php

declare(strict_types=1);

use App\Aplicacao\DetalhesHeartbeatInstalacao;
use PHPUnit\Framework\TestCase;

require_once __DIR__ . "/../../servidor/src/Aplicacao/DetalhesHeartbeatInstalacao.php";

final class DetalhesHeartbeatInstalacaoTest extends TestCase
{
    public function testPreservaCapacidadeDoGatewayFisicoOnline(): void
    {
        $details = DetalhesHeartbeatInstalacao::normalizar("CLP", "ONLINE", json_encode([
            "command_capability" => ["available" => true, "mode" => "FISICO"],
            "sensitive_future_field" => "must-not-be-forwarded",
        ], JSON_THROW_ON_ERROR));

        self::assertSame("instalacao_local", $details["source"]);
        self::assertSame(["available" => true, "mode" => "FISICO"], $details["command_capability"]);
        self::assertArrayNotHasKey("sensitive_future_field", $details);
    }

    public function testNuncaDeclaraComandoDisponivelComClpOffline(): void
    {
        $details = DetalhesHeartbeatInstalacao::normalizar("CLP", "OFFLINE", [
            "command_capability" => ["available" => true, "mode" => "FISICO"],
        ]);

        self::assertSame(["available" => false, "mode" => "FISICO"], $details["command_capability"]);
    }

    public function testIgnoraCapacidadeDeDispositivosQueNaoSaoClp(): void
    {
        $details = DetalhesHeartbeatInstalacao::normalizar("CAMERA", "ONLINE", [
            "command_capability" => ["available" => true, "mode" => "FISICO"],
        ]);

        self::assertSame(["source" => "instalacao_local"], $details);
    }

    public function testFalhaFechadaComModoInvalidoOuDetalhesMalformados(): void
    {
        $invalidMode = DetalhesHeartbeatInstalacao::normalizar("CLP", "ONLINE", [
            "command_capability" => ["available" => true, "mode" => "BYPASS"],
        ]);
        $malformed = DetalhesHeartbeatInstalacao::normalizar("CLP", "ONLINE", "{");

        self::assertSame(["available" => false, "mode" => "DESCONHECIDO"], $invalidMode["command_capability"]);
        self::assertSame(["available" => false, "mode" => "DESCONHECIDO"], $malformed["command_capability"]);
    }
}
