<?php
declare(strict_types=1);

use App\Aplicacao\ServicoSincronizacaoRemota;
use App\Aplicacao\ValidadorInstantaneoRemoto;
use App\Persistencia\RepositorioFilaSincronizacao;
use App\Persistencia\RepositorioEquipamentosRemotos;
use App\Persistencia\RepositorioProdutosRemotos;
use App\Persistencia\RepositorioRomaneiosRemotos;
use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../servidor/configuracao/bootstrap.php';

final class SincronizacaoSnapshotPendenteTest extends TestCase
{
    private function database(): PDO
    {
        $pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
        $pdo->exec('CREATE TABLE fila_sincronizacao (company_id INTEGER, aggregate_type TEXT, aggregate_id INTEGER, status TEXT)');
        $pdo->exec('CREATE TABLE equipamentos (id INTEGER PRIMARY KEY, company_id INTEGER, remote_equipment_id INTEGER,
            equipment_code TEXT, name TEXT, plc_ip TEXT, plc_port INTEGER, external_port INTEGER, plc_protocol TEXT)');
        $pdo->exec('CREATE TABLE produtos (id INTEGER PRIMARY KEY, company_id INTEGER, remote_product_id INTEGER,
            code TEXT, name TEXT, category TEXT, active INTEGER)');
        $pdo->exec('CREATE TABLE codigos_produtos (id INTEGER PRIMARY KEY, company_id INTEGER, product_id INTEGER, barcode TEXT)');
        $pdo->exec('CREATE TABLE romaneios (id INTEGER PRIMARY KEY, company_id INTEGER, remote_romaneio_id INTEGER,
            number TEXT, status TEXT)');
        return $pdo;
    }

    private function databaseForAvailableManifests(): PDO
    {
        $pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
        $pdo->exec('CREATE TABLE fila_sincronizacao (company_id INTEGER, aggregate_type TEXT, aggregate_id INTEGER, status TEXT)');
        $pdo->exec('CREATE TABLE produtos (id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER, code TEXT, name TEXT, active INTEGER)');
        $pdo->exec('CREATE TABLE romaneios (
            id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER, remote_romaneio_id INTEGER,
            number TEXT, scheduled_date TEXT, expedidor TEXT, status TEXT
        )');
        $pdo->exec('CREATE TABLE romaneio_caminhoes (
            id INTEGER PRIMARY KEY AUTOINCREMENT, romaneio_id INTEGER, remote_truck_id INTEGER,
            plate TEXT, driver_name TEXT
        )');
        $pdo->exec('CREATE TABLE romaneio_itens (
            id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER, romaneio_id INTEGER, product_id INTEGER,
            truck_id INTEGER, planned_quantity INTEGER
        )');
        $pdo->exec("INSERT INTO produtos (company_id, code, name, active) VALUES (1, 'SKU-1', 'Produto 1', 1)");
        return $pdo;
    }

    private function productRepository(PDO $pdo): RepositorioProdutosRemotos
    {
        return new RepositorioProdutosRemotos($pdo, new RepositorioFilaSincronizacao($pdo));
    }

    private function manifestRepository(PDO $pdo): RepositorioRomaneiosRemotos
    {
        return new RepositorioRomaneiosRemotos($pdo, new RepositorioFilaSincronizacao($pdo));
    }

    private function equipmentRepository(PDO $pdo): RepositorioEquipamentosRemotos
    {
        return new RepositorioEquipamentosRemotos($pdo, new RepositorioFilaSincronizacao($pdo));
    }

    public function testCancelamentoCentralAtualizaRomaneioLocalMesmoComEventoAntigoPendente(): void
    {
        $pdo = $this->database();
        $pdo->exec("INSERT INTO romaneios VALUES (7, 1, NULL, 'ROM-700', 'EM_ANDAMENTO')");
        $pdo->exec("INSERT INTO fila_sincronizacao VALUES (1, 'romaneio', 7, 'PENDENTE')");
        $repository = $this->manifestRepository($pdo);

        $repository->sincronizarRomaneiosCancelados(1, [['id' => 70, 'number' => 'ROM-700', 'status' => 'CANCELADO']]);

        $row = $pdo->query('SELECT remote_romaneio_id, status FROM romaneios WHERE id = 7')->fetch();
        self::assertSame(70, (int) $row['remote_romaneio_id']);
        self::assertSame('CANCELADO', $row['status']);
    }

    public function testCancelamentoCentralNaoVinculaRomaneioLocalComNumeroAmbiguo(): void
    {
        $pdo = $this->database();
        $pdo->exec("INSERT INTO romaneios VALUES (7, 1, NULL, 'ROM-700', 'EM_ANDAMENTO')");
        $pdo->exec("INSERT INTO romaneios VALUES (8, 1, NULL, 'ROM-700', 'EM_ANDAMENTO')");
        $repository = $this->manifestRepository($pdo);

        $repository->sincronizarRomaneiosCancelados(1, [['id' => 70, 'number' => 'ROM-700', 'status' => 'CANCELADO']]);

        self::assertSame(0, (int) $pdo->query("SELECT COUNT(*) FROM romaneios WHERE status = 'CANCELADO'")->fetchColumn());
    }

    public function testSnapshotPreservaEnderecoDaDalaEnquantoAlteracaoLocalNaoFoiEntregue(): void
    {
        $pdo = $this->database();
        $pdo->exec("INSERT INTO equipamentos VALUES (7, 1, NULL, 'dala_a', 'Dala local', '192.168.1.40', 1502, NULL, 'MODBUS_TCP')");
        $pdo->exec("INSERT INTO fila_sincronizacao VALUES (1, 'equipment', 7, 'ERRO')");
        $repository = $this->equipmentRepository($pdo);
        $remote = ['id' => 90, 'equipment_code' => 'dala_a', 'name' => 'Dala antiga',
            'plc_ip' => '192.168.1.10', 'plc_port' => 502, 'plc_protocol' => 'MODBUS_TCP'];

        self::assertSame(
            ['id' => 7, 'codigo' => 'dala_a', 'provisionar' => false],
            $repository->sincronizarEquipamento(1, $remote),
        );
        $row = $pdo->query('SELECT * FROM equipamentos WHERE id = 7')->fetch();
        self::assertSame('192.168.1.40', $row['plc_ip']);
        self::assertSame(1502, (int) $row['plc_port']);
        self::assertSame(90, (int) $row['remote_equipment_id']);

        $pdo->exec("UPDATE fila_sincronizacao SET status = 'ENVIADO'");
        self::assertSame(
            ['id' => 7, 'codigo' => 'dala_a', 'provisionar' => true],
            $repository->sincronizarEquipamento(1, $remote),
        );
        self::assertSame('192.168.1.10', $pdo->query('SELECT plc_ip FROM equipamentos WHERE id = 7')->fetchColumn());
    }

    public function testSnapshotNaoDescartaProdutoEBarcodeEditadosLocalmente(): void
    {
        $pdo = $this->database();
        $pdo->exec("INSERT INTO produtos VALUES (5, 1, 80, 'SKU-A', 'Nome local', 'Local', 1)");
        $pdo->exec("INSERT INTO codigos_produtos VALUES (1, 1, 5, 'LOCAL-123')");
        $pdo->exec("INSERT INTO fila_sincronizacao VALUES (1, 'produto', 5, 'PENDENTE')");
        $repository = $this->productRepository($pdo);
        $remote = [['id' => 80, 'code' => 'SKU-A', 'name' => 'Nome antigo',
            'category' => 'Antigo', 'active' => 1, 'barcodes' => ['REMOTE-999']]];

        $repository->sincronizar(1, $remote);
        self::assertSame('Nome local', $pdo->query('SELECT name FROM produtos WHERE id = 5')->fetchColumn());
        self::assertSame('LOCAL-123', $pdo->query('SELECT barcode FROM codigos_produtos WHERE product_id = 5')->fetchColumn());
        $repository->sincronizar(1, []);
        self::assertSame(1, (int) $pdo->query('SELECT active FROM produtos WHERE id = 5')->fetchColumn());

        $pdo->exec("UPDATE fila_sincronizacao SET status = 'ENVIADO'");
        $repository->sincronizar(1, $remote);
        self::assertSame('Nome antigo', $pdo->query('SELECT name FROM produtos WHERE id = 5')->fetchColumn());
        self::assertSame('REMOTE-999', $pdo->query('SELECT barcode FROM codigos_produtos WHERE product_id = 5')->fetchColumn());
    }

    public function testSnapshotNaoRoubaBarcodeDeOutroProdutoComEdicaoPendente(): void
    {
        $pdo = $this->database();
        $pdo->exec("INSERT INTO produtos VALUES (5, 1, 80, 'SKU-A', 'Nome local', NULL, 1)");
        $pdo->exec("INSERT INTO produtos VALUES (6, 1, 81, 'SKU-B', 'Produto remoto', NULL, 1)");
        $pdo->exec("INSERT INTO codigos_produtos VALUES (1, 1, 5, 'LOCAL-123')");
        $pdo->exec("INSERT INTO fila_sincronizacao VALUES (1, 'produto', 5, 'PENDENTE')");
        $repository = $this->productRepository($pdo);
        $repository->sincronizar(1, [['id' => 81, 'code' => 'SKU-B', 'name' => 'Produto remoto',
            'active' => 1, 'barcodes' => ['LOCAL-123']]]);

        self::assertSame(5, (int) $pdo->query("SELECT product_id FROM codigos_produtos WHERE barcode = 'LOCAL-123'")->fetchColumn());
        self::assertSame(1, (int) $pdo->query("SELECT COUNT(*) FROM codigos_produtos WHERE barcode = 'LOCAL-123'")->fetchColumn());
    }

    public function testRepositorioDeProdutosRespeitaATransacaoDoSnapshot(): void
    {
        $pdo = $this->database();
        $pdo->beginTransaction();
        $repository = $this->productRepository($pdo);

        $repository->sincronizar(1, [[
            'id' => 90,
            'code' => 'SKU-90',
            'name' => 'Produto remoto',
            'active' => 1,
            'barcodes' => ['REMOTE-090'],
        ]]);

        self::assertTrue($pdo->inTransaction());
        self::assertSame(1, (int) $pdo->query("SELECT COUNT(*) FROM produtos WHERE remote_product_id = 90")->fetchColumn());
        $pdo->rollBack();

        self::assertSame(0, (int) $pdo->query("SELECT COUNT(*) FROM produtos WHERE remote_product_id = 90")->fetchColumn());
    }

    public function testSnapshotRecusaMaisDeUmaDalaNoMesmoPcIndustrial(): void
    {
        $snapshot = [
            'empresa' => ['id' => 9, 'license_status' => 'ATIVA'],
            'equipamentos' => [
                ['id' => 1, 'equipment_code' => 'dala_a', 'plc_port' => 502],
                ['id' => 2, 'equipment_code' => 'dala_b', 'plc_port' => 502],
            ],
            'produtos' => [], 'carregamentos_ativos' => [], 'comandos' => [],
        ];
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('aceita uma Dala');
        ValidadorInstantaneoRemoto::validar(['remote_company_id' => 9], $snapshot);
    }

    public function testSnapshotValidoDeUmaDalaVinculadaEhAceito(): void
    {
        $snapshot = [
            'empresa' => ['id' => 9, 'license_status' => 'ATIVA'],
            'instalacao' => ['id' => 3, 'equipment_id' => 2],
            'equipamentos' => [['id' => 2, 'equipment_code' => 'dala_a', 'plc_port' => 502]],
            'produtos' => [],
            'carregamentos_ativos' => [],
            'comandos' => [],
        ];

        ValidadorInstantaneoRemoto::validar(['remote_company_id' => 9], $snapshot);

        self::assertCount(1, $snapshot['equipamentos']);
    }

    public function testRomaneioAtribuidoEAplicadoUmaUnicaVezComCaminhaoEItens(): void
    {
        $pdo = $this->databaseForAvailableManifests();
        $repository = $this->manifestRepository($pdo);
        $manifest = [[
            'id' => 70,
            'number' => 'ROM-700',
            'scheduled_date' => '2026-10-14',
            'status' => 'AGUARDANDO',
            'expedidor' => 'ERP',
            'trucks' => [[
                'id' => 90,
                'plate' => 'ABC1D23',
                'driver_name' => 'Motorista ERP',
                'items' => [['code' => 'SKU-1', 'name' => 'Produto 1', 'planned_quantity' => 12]],
            ]],
        ]];

        self::assertSame(1, $repository->sincronizarRomaneiosDisponiveis(1, $manifest));
        $repository->sincronizarRomaneiosDisponiveis(1, $manifest);
        self::assertSame(1, (int) $pdo->query('SELECT COUNT(*) FROM romaneios')->fetchColumn());
        self::assertSame(1, (int) $pdo->query('SELECT COUNT(*) FROM romaneio_caminhoes')->fetchColumn());
        self::assertSame(1, (int) $pdo->query('SELECT COUNT(*) FROM romaneio_itens')->fetchColumn());
        self::assertSame(70, (int) $pdo->query('SELECT remote_romaneio_id FROM romaneios')->fetchColumn());
        self::assertSame(1, (int) $pdo->query('SELECT company_id FROM romaneio_itens')->fetchColumn());
        self::assertSame(12, (int) $pdo->query('SELECT planned_quantity FROM romaneio_itens')->fetchColumn());
    }

    public function testRepositorioDeRomaneiosRespeitaATransacaoDoSnapshot(): void
    {
        $pdo = $this->databaseForAvailableManifests();
        $pdo->beginTransaction();
        $repository = $this->manifestRepository($pdo);

        $repository->sincronizarRomaneiosDisponiveis(1, [[
            'id' => 71,
            'number' => 'ROM-701',
            'scheduled_date' => '2026-10-14',
            'status' => 'AGUARDANDO',
            'trucks' => [],
        ]]);

        self::assertTrue($pdo->inTransaction());
        self::assertSame(1, (int) $pdo->query("SELECT COUNT(*) FROM romaneios WHERE remote_romaneio_id = 71")->fetchColumn());
        $pdo->rollBack();

        self::assertSame(0, (int) $pdo->query("SELECT COUNT(*) FROM romaneios WHERE remote_romaneio_id = 71")->fetchColumn());
    }

    public function testRomaneioCentralNaoSeVinculaPorNumeroARegistroLocalAmbiguo(): void
    {
        $pdo = $this->databaseForAvailableManifests();
        $pdo->exec("INSERT INTO romaneios (company_id, number, scheduled_date, status)
            VALUES (1, 'ROM-700', '2026-10-14', 'AGUARDANDO')");
        $repository = $this->manifestRepository($pdo);
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('conflita com um registro local');
        $repository->sincronizarRomaneiosDisponiveis(1, [[
            'id' => 70,
            'number' => 'ROM-700',
            'scheduled_date' => '2026-10-14',
            'status' => 'AGUARDANDO',
            'trucks' => [['id' => 90, 'plate' => 'ABC1D23', 'items' => []]],
        ]]);
    }
}
