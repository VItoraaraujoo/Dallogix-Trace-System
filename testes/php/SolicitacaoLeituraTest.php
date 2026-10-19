<?php

declare(strict_types=1);

use App\Aplicacao\SolicitacaoLeitura;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

require_once __DIR__ . "/../../servidor/src/Aplicacao/SolicitacaoLeitura.php";

final class SolicitacaoLeituraTest extends TestCase
{
    public function testNormalizaCamposDaLeituraSemAlterarContrato(): void
    {
        $request = SolicitacaoLeitura::fromPayload([
            "carregamento_id" => "42",
            "sensor_event_id" => "17",
            "barcode" => "  789123  ",
            "attempt_number" => 1,
        ], "  123e4567-e89b-12d3-a456-426614174000  ");

        self::assertSame(42, $request->loadingId);
        self::assertSame(17, $request->sensorEventId);
        self::assertSame("789123", $request->barcode);
        self::assertSame("123e4567-e89b-12d3-a456-426614174000", $request->offlineEventId);
        self::assertSame(1, $request->attemptNumber);
    }

    public function testEventoDeSensorAusenteContinuaOpcional(): void
    {
        foreach ([[], ["sensor_event_id" => null], ["sensor_event_id" => ""]] as $sensorInput) {
            $request = SolicitacaoLeitura::fromPayload(
                ["carregamento_id" => 42, ...$sensorInput],
                "",
            );

            self::assertNull($request->sensorEventId);
        }
    }

    #[DataProvider("entradasInvalidas")]
    public function testRejeitaCamposInvalidosComAsMensagensDaApi(array $payload, string $offlineId, string $message): void
    {
        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage($message);

        SolicitacaoLeitura::fromPayload($payload, $offlineId);
    }

    public static function entradasInvalidas(): iterable
    {
        yield "event id" => [[], "inválido", "Identificador da leitura inválido."];
        yield "loading" => [[], "", "Carregamento obrigatório."];
        yield "sensor event" => [["carregamento_id" => 1, "sensor_event_id" => "invalido"], "", "Evento de sensor inválido."];
        yield "barcode length" => [
            ["carregamento_id" => 1, "barcode" => str_repeat("a", 129)],
            "",
            "Código de barras inválido ou longo demais.",
        ];
        yield "barcode control character" => [
            ["carregamento_id" => 1, "barcode" => "123\n456"],
            "",
            "Código de barras inválido ou longo demais.",
        ];
        yield "attempt" => [
            ["carregamento_id" => 1, "attempt_number" => 2],
            "",
            "Cada saco possui uma única tentativa de leitura.",
        ];
    }
}
