<?php
declare(strict_types=1);

use App\Aplicacao\ServicoSincronizacaoRemota;
use PHPUnit\Framework\TestCase;

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
        return $pdo;
    }

    public function testSnapshotPreservaEnderecoDaDalaEnquantoAlteracaoLocalNaoFoiEntregue(): void
    {
        $pdo = $this->database();
        $pdo->exec("INSERT INTO equipamentos VALUES (7, 1, NULL, 'dala_a', 'Dala local', '192.168.1.40', 1502, NULL, 'MODBUS_TCP')");
        $pdo->exec("INSERT INTO fila_sincronizacao VALUES (1, 'equipment', 7, 'ERRO')");
        $method = new ReflectionMethod(ServicoSincronizacaoRemota::class, 'upsertEquipment');
        $service = new ServicoSincronizacaoRemota($pdo);
        $remote = ['id' => 90, 'equipment_code' => 'dala_a', 'name' => 'Dala antiga',
            'plc_ip' => '192.168.1.10', 'plc_port' => 502, 'plc_protocol' => 'MODBUS_TCP'];

        self::assertSame(7, $method->invoke($service, 1, $remote));
        $row = $pdo->query('SELECT * FROM equipamentos WHERE id = 7')->fetch();
        self::assertSame('192.168.1.40', $row['plc_ip']);
        self::assertSame(1502, (int) $row['plc_port']);
        self::assertSame(90, (int) $row['remote_equipment_id']);

        $pdo->exec("UPDATE fila_sincronizacao SET status = 'ENVIADO'");
        $method->invoke($service, 1, $remote);
        self::assertSame('192.168.1.10', $pdo->query('SELECT plc_ip FROM equipamentos WHERE id = 7')->fetchColumn());
    }

    public function testSnapshotNaoDescartaProdutoEBarcodeEditadosLocalmente(): void
    {
        $pdo = $this->database();
        $pdo->exec("INSERT INTO produtos VALUES (5, 1, 80, 'SKU-A', 'Nome local', 'Local', 1)");
        $pdo->exec("INSERT INTO codigos_produtos VALUES (1, 1, 5, 'LOCAL-123')");
        $pdo->exec("INSERT INTO fila_sincronizacao VALUES (1, 'produto', 5, 'PENDENTE')");
        $method = new ReflectionMethod(ServicoSincronizacaoRemota::class, 'syncProducts');
        $service = new ServicoSincronizacaoRemota($pdo);
        $remote = [['id' => 80, 'code' => 'SKU-A', 'name' => 'Nome antigo',
            'category' => 'Antigo', 'active' => 1, 'barcodes' => ['REMOTE-999']]];

        $method->invoke($service, 1, $remote);
        self::assertSame('Nome local', $pdo->query('SELECT name FROM produtos WHERE id = 5')->fetchColumn());
        self::assertSame('LOCAL-123', $pdo->query('SELECT barcode FROM codigos_produtos WHERE product_id = 5')->fetchColumn());
        $method->invoke($service, 1, []);
        self::assertSame(1, (int) $pdo->query('SELECT active FROM produtos WHERE id = 5')->fetchColumn());

        $pdo->exec("UPDATE fila_sincronizacao SET status = 'ENVIADO'");
        $method->invoke($service, 1, $remote);
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
        $method = new ReflectionMethod(ServicoSincronizacaoRemota::class, 'syncProducts');
        $service = new ServicoSincronizacaoRemota($pdo);
        $method->invoke($service, 1, [['id' => 81, 'code' => 'SKU-B', 'name' => 'Produto remoto',
            'active' => 1, 'barcodes' => ['LOCAL-123']]]);

        self::assertSame(5, (int) $pdo->query("SELECT product_id FROM codigos_produtos WHERE barcode = 'LOCAL-123'")->fetchColumn());
        self::assertSame(1, (int) $pdo->query("SELECT COUNT(*) FROM codigos_produtos WHERE barcode = 'LOCAL-123'")->fetchColumn());
    }

    public function testSnapshotRecusaMaisDeUmaDalaNoMesmoPcIndustrial(): void
    {
        $service = new ServicoSincronizacaoRemota($this->database());
        $snapshot = [
            'empresa' => ['id' => 9, 'license_status' => 'ATIVA'],
            'equipamentos' => [
                ['id' => 1, 'equipment_code' => 'dala_a', 'plc_port' => 502],
                ['id' => 2, 'equipment_code' => 'dala_b', 'plc_port' => 502],
            ],
            'produtos' => [], 'carregamentos_ativos' => [], 'comandos' => [],
        ];
        $method = new ReflectionMethod(ServicoSincronizacaoRemota::class, 'validateSnapshot');
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('aceita uma Dala');
        $method->invoke($service, ['remote_company_id' => 9], $snapshot);
    }
}
