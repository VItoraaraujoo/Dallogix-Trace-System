<?php
declare(strict_types=1);

use App\Aplicacao\ServicoMonitoramento;
use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../servidor/src/Aplicacao/ServicoMonitoramento.php';

final class ServicoMonitoramentoTest extends TestCase
{
    public function testEventosDetectadosContamSomenteASensorDaDalaAtual(): void
    {
        $pdoClass = class_exists('Pdo\\Sqlite') ? 'Pdo\\Sqlite' : PDO::class;
        $pdo = new $pdoClass('sqlite::memory:', null, null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
        $unquote = static fn (?string $value): ?string => $value;
        if (method_exists($pdo, 'createFunction')) {
            (new ReflectionMethod($pdo, 'createFunction'))->invoke($pdo, 'JSON_UNQUOTE', $unquote, 1);
        } else {
            $pdo->sqliteCreateFunction('JSON_UNQUOTE', $unquote, 1);
        }
        $pdo->exec('CREATE TABLE carregamentos (
            id INTEGER, company_id INTEGER, romaneio_id INTEGER, truck_id INTEGER,
            equipment_id INTEGER, state TEXT, started_at TEXT, finished_at TEXT,
            leituras_validas INTEGER, stop_reason TEXT, operator_alert TEXT
        )');
        $pdo->exec('CREATE TABLE romaneios (id INTEGER, number TEXT, status TEXT)');
        $pdo->exec('CREATE TABLE romaneio_caminhoes (id INTEGER, plate TEXT)');
        $pdo->exec('CREATE TABLE romaneio_itens (romaneio_id INTEGER, truck_id INTEGER, product_id INTEGER, planned_quantity INTEGER)');
        $pdo->exec('CREATE TABLE produtos (id INTEGER, name TEXT, code TEXT)');
        $pdo->exec('CREATE TABLE eventos_sensor (carregamento_id INTEGER, equipment_id INTEGER)');
        $pdo->exec('CREATE TABLE logs_auditoria (id INTEGER, company_id INTEGER, entity_id INTEGER, action TEXT, entity_type TEXT, metadata TEXT)');
        $pdo->exec('CREATE TABLE equipamentos (id INTEGER, equipment_code TEXT)');
        $pdo->exec('CREATE TABLE leituras (carregamento_id INTEGER, product_id INTEGER, result TEXT)');

        $pdo->exec("INSERT INTO carregamentos VALUES (1, 5, 2, 3, 20, 'CARREGANDO', NULL, NULL, 0, NULL, NULL)");
        $pdo->exec("INSERT INTO romaneios VALUES (2, 'ROM-2', 'EM_ANDAMENTO')");
        $pdo->exec("INSERT INTO romaneio_caminhoes VALUES (3, 'ABC1D23')");
        $pdo->exec('INSERT INTO romaneio_itens VALUES (2, 3, 4, 5)');
        $pdo->exec("INSERT INTO produtos VALUES (4, 'Produto', 'P-4')");
        $pdo->exec("INSERT INTO equipamentos VALUES (20, 'DALA-20')");
        $pdo->exec('INSERT INTO eventos_sensor VALUES (1, 10), (1, 10), (1, 10), (1, 20), (1, 20)');

        $rows = (new ServicoMonitoramento($pdo))->carregamentosAtivos(5);

        self::assertCount(1, $rows);
        self::assertSame(2, (int) $rows[0]['detected_bags']);
    }

    public function testCameraMantemStatusOnlineEntreHeartbeatsSemAtrasarDeteccaoDoClp(): void
    {
        $device = static fn (int $id, string $type, string $status, ?int $ageMicros): array => [
            "equipment_id" => $id,
            "device_type" => $type,
            "status" => $status,
            "last_seen_at" => $ageMicros === null ? null : "2026-10-16 12:00:00",
            "segundos_sem_sinal" => $ageMicros === null ? null : intdiv($ageMicros, 1_000_000),
            "micros_sem_sinal" => $ageMicros,
            "equipment_code" => "DALA-{$id}",
        ];
        $service = new ServicoMonitoramento(new MonitoramentoPdoFake([
            $device(1, "CLP", "ONLINE", 4_000_000),
            $device(2, "CAMERA", "ONLINE", 8_000_000),
            $device(3, "CAMERA", "ONLINE", 15_000_001),
            $device(4, "CAMERA", "ERRO", 20_000_000),
            $device(5, "CAMERA", "ONLINE", null),
            $device(6, "SENSOR", "ONLINE", 8_000_000),
        ]));

        $snapshot = $service->obterInstantaneo(5, 30, 3, 15);

        self::assertSame([
            1 => "OFFLINE",
            2 => "ONLINE",
            3 => "OFFLINE",
            4 => "ERRO",
            5 => "OFFLINE",
            6 => "OFFLINE",
        ], array_column($snapshot["dispositivos"], "status", "equipment_id"));
        self::assertSame(15, $snapshot["limite_sinal_camera_segundos"]);
        self::assertArrayNotHasKey("micros_sem_sinal", $snapshot["dispositivos"][0]);

        $shorterLimit = $service->obterInstantaneo(5, 30, 3, 6);
        self::assertSame("OFFLINE", $shorterLimit["dispositivos"][1]["status"]);
    }
}

final class MonitoramentoPdoFake extends PDO
{
    /** @param list<array<string,mixed>> $devices */
    public function __construct(private readonly array $devices)
    {
    }

    public function prepare(string $query, array $options = []): PDOStatement|false
    {
        return new MonitoramentoStatementFake(
            str_contains($query, "FROM status_dispositivos d") ? $this->devices : [],
        );
    }
}

final class MonitoramentoStatementFake extends PDOStatement
{
    /** @param list<array<string,mixed>> $rows */
    public function __construct(private readonly array $rows)
    {
    }

    public function execute(?array $params = null): bool
    {
        return true;
    }

    public function fetchAll(int $mode = PDO::FETCH_DEFAULT, mixed ...$args): array
    {
        return $this->rows;
    }
}
