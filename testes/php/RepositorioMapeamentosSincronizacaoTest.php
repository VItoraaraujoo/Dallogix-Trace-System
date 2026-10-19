<?php

declare(strict_types=1);

use App\Persistencia\RepositorioMapeamentosSincronizacao;
use PHPUnit\Framework\TestCase;

final class RepositorioMapeamentosSincronizacaoTest extends TestCase
{
    public function testAplicaIdsRemotosDeEquipamentoRomaneioCaminhaoECarregamento(): void
    {
        $pdo = $this->criarBanco();
        $repository = new RepositorioMapeamentosSincronizacao($pdo);

        $repository->aplicar(
            [['event_uuid' => 'evento-1', 'company_id' => 1]],
            ['data' => ['mappings' => [[
                'event_uuid' => 'evento-1',
                'local' => [
                    'equipment_id' => 11,
                    'romaneio_id' => 21,
                    'truck_id' => 31,
                    'carregamento_id' => 41,
                ],
                'remote' => [
                    'equipment_id' => 111,
                    'romaneio_id' => 121,
                    'truck_id' => 131,
                    'carregamento_id' => 141,
                ],
            ]]]],
        );

        self::assertSame(111, (int) $pdo->query('SELECT remote_equipment_id FROM equipamentos WHERE id = 11')->fetchColumn());
        self::assertSame(121, (int) $pdo->query('SELECT remote_romaneio_id FROM romaneios WHERE id = 21')->fetchColumn());
        self::assertSame(131, (int) $pdo->query('SELECT remote_truck_id FROM romaneio_caminhoes WHERE id = 31')->fetchColumn());
        self::assertSame(141, (int) $pdo->query('SELECT remote_carregamento_id FROM carregamentos WHERE id = 41')->fetchColumn());
        self::assertFalse($pdo->inTransaction());
    }

    public function testIdsLocaisDeOutraEmpresaNaoSaoAtualizados(): void
    {
        $pdo = $this->criarBanco();
        $repository = new RepositorioMapeamentosSincronizacao($pdo);

        $repository->aplicar(
            [['event_uuid' => 'evento-1', 'company_id' => 1]],
            ['data' => ['mappings' => [[
                'event_uuid' => 'evento-1',
                'local' => [
                    'equipment_id' => 12,
                    'romaneio_id' => 22,
                    'truck_id' => 32,
                    'carregamento_id' => 42,
                ],
                'remote' => [
                    'equipment_id' => 211,
                    'romaneio_id' => 221,
                    'truck_id' => 231,
                    'carregamento_id' => 241,
                ],
            ]]]],
        );

        self::assertNull($pdo->query('SELECT remote_equipment_id FROM equipamentos WHERE id = 12')->fetchColumn());
        self::assertNull($pdo->query('SELECT remote_romaneio_id FROM romaneios WHERE id = 22')->fetchColumn());
        self::assertNull($pdo->query('SELECT remote_truck_id FROM romaneio_caminhoes WHERE id = 32')->fetchColumn());
        self::assertNull($pdo->query('SELECT remote_carregamento_id FROM carregamentos WHERE id = 42')->fetchColumn());
    }

    public function testMapeamentoQueNaoPertenceAoLoteReverteTodaATransacao(): void
    {
        $pdo = $this->criarBanco();
        $repository = new RepositorioMapeamentosSincronizacao($pdo);
        $response = ['data' => ['mappings' => [
            [
                'event_uuid' => 'evento-1',
                'local' => ['equipment_id' => 11],
                'remote' => ['equipment_id' => 111],
            ],
            [
                'event_uuid' => 'evento-inexistente',
                'local' => ['equipment_id' => 12],
                'remote' => ['equipment_id' => 112],
            ],
        ]]];

        try {
            $repository->aplicar(
                [['event_uuid' => 'evento-1', 'company_id' => 1]],
                $response,
            );
            self::fail('Era esperado rejeitar o mapeamento fora do lote.');
        } catch (RuntimeException $exception) {
            self::assertSame('Mapeamento remoto não corresponde ao lote enviado.', $exception->getMessage());
        }

        self::assertNull($pdo->query('SELECT remote_equipment_id FROM equipamentos WHERE id = 11')->fetchColumn());
        self::assertFalse($pdo->inTransaction());
    }

    private function criarBanco(): PDO
    {
        $pdo = new PDO(
            'sqlite::memory:',
            null,
            null,
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC],
        );
        $pdo->exec('CREATE TABLE equipamentos (
            id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL, remote_equipment_id INTEGER
        )');
        $pdo->exec('CREATE TABLE romaneios (
            id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL, remote_romaneio_id INTEGER
        )');
        $pdo->exec('CREATE TABLE romaneio_caminhoes (
            id INTEGER PRIMARY KEY, romaneio_id INTEGER NOT NULL, remote_truck_id INTEGER
        )');
        $pdo->exec('CREATE TABLE carregamentos (
            id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL, remote_carregamento_id INTEGER
        )');
        $pdo->exec('INSERT INTO equipamentos VALUES (11, 1, NULL), (12, 2, NULL)');
        $pdo->exec('INSERT INTO romaneios VALUES (21, 1, NULL), (22, 2, NULL)');
        $pdo->exec('INSERT INTO romaneio_caminhoes VALUES (31, 21, NULL), (32, 22, NULL)');
        $pdo->exec('INSERT INTO carregamentos VALUES (41, 1, NULL), (42, 2, NULL)');
        return $pdo;
    }
}
