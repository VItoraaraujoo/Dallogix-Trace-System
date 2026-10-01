<?php

declare(strict_types=1);

use App\Aplicacao\ServicoSincronizacao;
use PHPUnit\Framework\TestCase;

final class SincronizacaoProdutoOutboundTest extends TestCase
{
    public function testEventoDeProdutoLevaOsDadosAtuaisDoCadastroLocal(): void
    {
        $pdo = new PDO(
            'sqlite::memory:',
            null,
            null,
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC],
        );
        $pdo->exec('CREATE TABLE produtos (
            id INTEGER PRIMARY KEY,
            company_id INTEGER NOT NULL,
            code TEXT NOT NULL,
            name TEXT NOT NULL,
            category TEXT,
            active INTEGER NOT NULL
        )');
        $pdo->exec('CREATE TABLE codigos_produtos (
            id INTEGER PRIMARY KEY,
            product_id INTEGER NOT NULL,
            barcode TEXT NOT NULL
        )');
        $pdo->exec("INSERT INTO produtos VALUES (5, 3, 'SKU-LOCAL-5', 'Produto local atual', 'Sacas', 1)");
        $pdo->exec("INSERT INTO codigos_produtos VALUES (1, 5, '7890000000005')");

        $event = [
            'company_id' => 3,
            'aggregate_id' => 5,
            'payload' => json_encode([
                'action' => 'PRODUTO_CADASTRADO',
                'entity_type' => 'produto',
                'entity_id' => 5,
                'data' => ['code' => 'SKU-ANTIGO', 'name' => 'Nome antigo', 'barcode' => '0000000000000'],
            ], JSON_THROW_ON_ERROR),
        ];

        $method = new ReflectionMethod(ServicoSincronizacao::class, 'decodificarCarga');
        $payload = $method->invoke(new ServicoSincronizacao($pdo), $event);

        self::assertSame('PRODUTO_CADASTRADO', $payload['action']);
        self::assertSame('produto', $payload['entity_type']);
        self::assertSame(5, $payload['entity_id']);
        self::assertSame(5, $payload['data']['remote_product_id']);
        self::assertSame('SKU-LOCAL-5', $payload['data']['code']);
        self::assertSame('Produto local atual', $payload['data']['name']);
        self::assertSame('Sacas', $payload['data']['category']);
        self::assertSame(1, $payload['data']['active']);
        self::assertSame('7890000000005', $payload['data']['barcode']);
    }
}
