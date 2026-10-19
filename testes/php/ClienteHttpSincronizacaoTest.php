<?php

declare(strict_types=1);

use App\Aplicacao\ClienteHttpSincronizacao;
use PHPUnit\Framework\TestCase;

final class ClienteHttpSincronizacaoTest extends TestCase
{
    public function testEnviaJsonComTokenETimeoutsConfigurados(): void
    {
        $request = null;
        $client = new ClienteHttpSincronizacao(
            static function (string $url, string $body, array $headers, int $connectTimeout, int $requestTimeout) use (&$request): array {
                $request = [$url, $body, $headers, $connectTimeout, $requestTimeout];
                return [
                    "body" => '{"data":{"received":1}}',
                    "error" => "",
                    "http_code" => 200,
                ];
            },
        );

        $result = $client->postarJson("https://central.example.test/events", '{"events":[]}', "abc123");

        self::assertSame([
            "https://central.example.test/events",
            '{"events":[]}',
            ["Accept: application/json", "Content-Type: application/json", "Authorization: Bearer abc123"],
            3,
            10,
        ], $request);
        self::assertSame(["ok" => true, "error" => "", "http_code" => 200, "response" => ["data" => ["received" => 1]]], $result);
    }

    public function testRejeitaTokenComQuebraDeLinhaAntesDaRequisicao(): void
    {
        $called = false;
        $client = new ClienteHttpSincronizacao(
            static function () use (&$called): array {
                $called = true;
                return ["body" => false, "error" => "", "http_code" => 0];
            },
        );

        $result = $client->postarJson("https://central.example.test/events", "{}", "token\r\nX-Injected: yes");

        self::assertFalse($called);
        self::assertSame(["ok" => false, "error" => "Token de sincronização inválido.", "http_code" => 0], $result);
    }

    public function testPreservaFalhaDeInicializacaoEErroDeRede(): void
    {
        $uninitialized = new ClienteHttpSincronizacao(
            static fn (): array => ["body" => false, "error" => "", "http_code" => 0, "initialization_failed" => true],
        );
        self::assertSame(
            ["ok" => false, "error" => "Não foi possível inicializar o cliente HTTP.", "http_code" => 0],
            $uninitialized->postarJson("https://central.example.test/events", "{}", ""),
        );

        $networkFailure = new ClienteHttpSincronizacao(
            static fn (): array => ["body" => false, "error" => "connect timeout", "http_code" => 0],
        );
        self::assertSame(
            ["ok" => false, "error" => "Falha de rede: connect timeout", "http_code" => 0],
            $networkFailure->postarJson("https://central.example.test/events", "{}", ""),
        );
    }

    public function testRetornaErroDoServidorParaRespostaHttpNaoBemSucedida(): void
    {
        $client = new ClienteHttpSincronizacao(
            static fn (): array => [
                "body" => '{"error":"evento rejeitado"}',
                "error" => "",
                "http_code" => 422,
            ],
        );

        self::assertSame(
            ["ok" => false, "error" => "Endpoint remoto respondeu HTTP 422: evento rejeitado", "http_code" => 422],
            $client->postarJson("https://central.example.test/events", "{}", ""),
        );
    }

    public function testRespostaBemSucedidaExigeEnvelopeData(): void
    {
        $client = new ClienteHttpSincronizacao(
            static fn (): array => ["body" => '{"status":"ok"}', "error" => "", "http_code" => 200],
        );

        self::assertSame(
            ["ok" => false, "error" => "Endpoint remoto retornou uma resposta inválida.", "http_code" => 200],
            $client->postarJson("https://central.example.test/events", "{}", ""),
        );
    }
}
