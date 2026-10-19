<?php
declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../servidor/configuracao/bootstrap.php';
require_once __DIR__ . '/../../servidor/api/v1/romaneios-write.php';

final class ApiV1RomaneiosWriteTest extends TestCase
{
    public function testChaveDeIdempotenciaEhObrigatoriaEExigeFormatoSeguro(): void
    {
        try {
            api_v1_chave_idempotencia(null);
            self::fail('A ausência da chave deve ser recusada.');
        } catch (ApiV1PayloadException $exception) {
            self::assertSame('idempotency_key_required', $exception->errorCode);
        }
        self::assertSame('erp-romaneio-20261016-01', api_v1_chave_idempotencia('erp-romaneio-20261016-01'));
        $this->expectException(ApiV1PayloadException::class);
        api_v1_chave_idempotencia('curta');
    }

    public function testReenvioPodeNormalizarDataQueSeTornouPassada(): void
    {
        $payload = [
            'equipment_code' => 'DALA-01',
            'number' => 'ROM-API-ANTIGO',
            'scheduled_date' => '2025-01-01',
            'plate' => 'ABC1D23',
            'items' => [['product_code' => 'P-001', 'quantity' => 1]],
        ];
        self::assertSame('2025-01-01', api_v1_normalizar_payload_romaneio($payload, true)['scheduled_date']);
        $this->expectException(ApiV1PayloadException::class);
        api_v1_normalizar_payload_romaneio($payload);
    }

    public function testNormalizaPayloadDeCriacaoSemEmpresaFornecidaPeloCliente(): void
    {
        $payload = api_v1_normalizar_payload_romaneio([
            'equipment_code' => 'DALA-01',
            'number' => 'ROM-API-100',
            'scheduled_date' => (new DateTimeImmutable('today'))->format('Y-m-d'),
            'expedidor' => 'Expedição',
            'plate' => 'abc1d23',
            'driver_name' => 'Motorista Teste',
            'items' => [[
                'product_code' => 'P-001',
                'quantity' => '12',
            ]],
        ]);

        self::assertSame('ROM-API-100', $payload['number']);
        self::assertSame('DALA-01', $payload['equipment_code']);
        self::assertSame('ABC1D23', $payload['plate']);
        self::assertSame(12, $payload['items'][0]['quantity']);
        self::assertNull($payload['items'][0]['product_id']);
        self::assertSame('P-001', $payload['items'][0]['product_code']);
    }

    public function testRecusaEmpresaECamposDesconhecidosNoCorpo(): void
    {
        $this->expectException(ApiV1PayloadException::class);
        $this->expectExceptionMessage('A empresa é definida pela chave da API.');
        api_v1_normalizar_payload_romaneio([
            'equipment_code' => 'DALA-01',
            'company_id' => 999,
            'number' => 'ROM-API-101',
            'scheduled_date' => (new DateTimeImmutable('today'))->format('Y-m-d'),
            'plate' => 'ABC1D23',
            'items' => [['product_code' => 'P-001', 'quantity' => 1]],
        ]);
    }

    public function testExigeUmIdentificadorDeProdutoPorItem(): void
    {
        $this->expectException(ApiV1PayloadException::class);
        $this->expectExceptionMessage('Informe somente product_id ou product_code');
        api_v1_normalizar_payload_romaneio([
            'equipment_code' => 'DALA-01',
            'number' => 'ROM-API-102',
            'scheduled_date' => (new DateTimeImmutable('today'))->format('Y-m-d'),
            'plate' => 'ABC1D23',
            'items' => [[
                'product_id' => 1,
                'product_code' => 'P-001',
                'quantity' => 1,
            ]],
        ]);
    }

    public function testPreservaLinhasSeparadasDoMesmoProduto(): void
    {
        $payload = api_v1_normalizar_payload_romaneio([
            'equipment_code' => 'DALA-01',
            'number' => 'ROM-API-103',
            'scheduled_date' => (new DateTimeImmutable('today'))->format('Y-m-d'),
            'plate' => 'ABC1D23',
            'items' => [
                ['product_code' => 'P-001', 'quantity' => 1],
                ['product_code' => 'p-001', 'quantity' => 2],
            ],
        ]);

        self::assertCount(2, $payload['items']);
        self::assertSame(1, $payload['items'][0]['quantity']);
        self::assertSame(2, $payload['items'][1]['quantity']);
    }

    public function testQuantidadePrecisaSerInteiroPositivo(): void
    {
        $this->expectException(ApiV1PayloadException::class);
        $this->expectExceptionMessage('inteiro positivo');
        api_v1_normalizar_payload_romaneio([
            'equipment_code' => 'DALA-01',
            'number' => 'ROM-API-104',
            'scheduled_date' => (new DateTimeImmutable('today'))->format('Y-m-d'),
            'plate' => 'ABC1D23',
            'items' => [['product_code' => 'P-001', 'quantity' => 0]],
        ]);
    }

    public function testPayloadDeRomaneioNaoAceitaCamposDeComandoDoClp(): void
    {
        $this->expectException(ApiV1PayloadException::class);
        $this->expectExceptionMessage('campos não permitidos');
        api_v1_normalizar_payload_romaneio([
            'equipment_code' => 'DALA-01',
            'number' => 'ROM-API-105',
            'scheduled_date' => (new DateTimeImmutable('today'))->format('Y-m-d'),
            'plate' => 'ABC1D23',
            'command' => 'INICIAR_CARREGAMENTO',
            'items' => [['product_code' => 'P-001', 'quantity' => 1]],
        ]);
    }

    public function testExigeDestinoDeDalaConfigurado(): void
    {
        $this->expectException(ApiV1PayloadException::class);
        $this->expectExceptionMessage('equipment_code');
        api_v1_normalizar_payload_romaneio([
            'number' => 'ROM-API-106',
            'scheduled_date' => (new DateTimeImmutable('today'))->format('Y-m-d'),
            'plate' => 'ABC1D23',
            'items' => [['product_code' => 'P-001', 'quantity' => 1]],
        ]);
    }
}
