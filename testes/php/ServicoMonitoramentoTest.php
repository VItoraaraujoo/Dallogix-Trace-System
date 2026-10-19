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
        $pdo->exec('CREATE TABLE leituras (
            company_id INTEGER, carregamento_id INTEGER, product_id INTEGER, result TEXT
        )');

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
        $pdo = new MonitoramentoPdoFake([
            $device(1, "CLP", "ONLINE", 4_000_000),
            $device(2, "CAMERA", "ONLINE", 8_000_000),
            $device(3, "CAMERA", "ONLINE", 15_000_001),
            $device(4, "CAMERA", "ERRO", 20_000_000),
            $device(5, "CAMERA", "ONLINE", null),
            $device(6, "SENSOR", "ONLINE", 8_000_000),
        ]);
        $service = new ServicoMonitoramento($pdo);

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
        $machineQueries = array_values(array_filter(
            $pdo->queries,
            static fn (string $query): bool => str_contains($query, "WITH carregamento_candidato AS"),
        ));
        self::assertNotEmpty($machineQueries);
        $machineQuery = $machineQueries[0];
        self::assertIsString($machineQuery);
        self::assertStringContainsString("c.company_id = :company_id_carregamentos", $machineQuery);
        self::assertStringContainsString(
            "JOIN romaneios_ativos ra ON ra.romaneio_id = ri.romaneio_id",
            $machineQuery,
        );

        $shorterLimit = $service->obterInstantaneo(5, 30, 3, 6);
        self::assertSame("OFFLINE", $shorterLimit["dispositivos"][1]["status"]);
    }

    public function testStatusDosDispositivosUsaConsultaLeveSemAgregacoesDoSnapshot(): void
    {
        $pdo = new MonitoramentoPdoFake([[
            "equipment_id" => 8,
            "device_type" => "CAMERA",
            "status" => "ONLINE",
            "last_seen_at" => "2026-10-19 12:00:00",
            "segundos_sem_sinal" => 8,
            "micros_sem_sinal" => 8_000_000,
            "equipment_code" => "DALA-8",
        ]]);

        $devices = (new ServicoMonitoramento($pdo))->obterStatusDispositivos(5, 3, 15);

        self::assertSame("ONLINE", $devices[0]["status"]);
        self::assertArrayNotHasKey("micros_sem_sinal", $devices[0]);
        self::assertCount(1, $pdo->queries);
        self::assertStringContainsString("WHERE e.company_id = :company_id", $pdo->queries[0]);
        self::assertStringNotContainsString("leituras", $pdo->queries[0]);
        self::assertStringNotContainsString("logs_auditoria", $pdo->queries[0]);
    }

    public function testScannerUsaLimiteDeHeartbeatProprioEStatusDesconhecidoQuandoAgenteAtrasa(): void
    {
        $device = static fn (int $id, string $status, int $ageMicros): array => [
            "equipment_id" => $id,
            "device_type" => "SCANNER",
            "status" => $status,
            "last_seen_at" => "2026-10-19 12:00:00",
            "segundos_sem_sinal" => intdiv($ageMicros, 1_000_000),
            "micros_sem_sinal" => $ageMicros,
            "equipment_code" => "DALA-{$id}",
        ];
        $pdo = new MonitoramentoPdoFake([
            $device(1, "ONLINE", 20_000_000),
            $device(2, "OFFLINE", 20_000_000),
            $device(3, "ONLINE", 90_000_001),
            $device(4, "ERRO", 20_000_000),
        ]);

        $devices = (new ServicoMonitoramento($pdo))->obterStatusDispositivos(5, 3, 15, 90);

        self::assertSame([
            1 => "ONLINE",
            2 => "OFFLINE",
            3 => "DESCONHECIDO",
            4 => "ERRO",
        ], array_column($devices, "status", "equipment_id"));
    }

    public function testObterMaquinasCalculaEstadosFisicoEOperacionalSemCarregarSnapshot(): void
    {
        $pdo = new MonitoramentoPdoFake([], [[
            "id" => 8,
            "equipment_code" => "DALA-8",
            "name" => "Esteira 8",
            "clp_status" => "ONLINE",
            "last_seen_at" => "2026-10-19 12:00:00",
            "segundos_sem_sinal" => 0,
            "clp_details" => '{"physical_running":true}',
            "carregamento_id" => 21,
            "carregamento_state" => "CARREGANDO",
            "romaneio_id" => 34,
            "romaneio_number" => "ROM-34",
            "plate" => "ABC1D23",
            "planned_quantity" => 10,
            "valid_readings" => 4,
        ]]);

        $machines = (new ServicoMonitoramento($pdo))->obterMaquinas(5, 3);

        self::assertCount(1, $machines);
        self::assertSame(8, (int) $machines[0]["id"]);
        self::assertSame(true, $machines[0]["physical_running"]);
        self::assertSame("OPERANDO", $machines[0]["operational_status"]);
        self::assertSame(10, (int) $machines[0]["planned_quantity"]);
        self::assertSame(4, (int) $machines[0]["valid_readings"]);
        self::assertArrayNotHasKey("clp_details", $machines[0]);
        self::assertCount(1, $pdo->queries);
        self::assertStringContainsString("WHERE e.company_id = :company_id", $pdo->queries[0]);
        self::assertStringContainsString("segundos_sem_sinal", $pdo->queries[0]);
    }

    public function testResumoDeAlertasCarregaSomenteLeiturasDispositivosEMaquinas(): void
    {
        $pdo = new MonitoramentoPdoFake(
            [[
                "equipment_id" => 8,
                "device_type" => "CLP",
                "status" => "ONLINE",
                "last_seen_at" => "2026-10-19 12:00:00",
                "segundos_sem_sinal" => 0,
                "micros_sem_sinal" => 0,
                "equipment_code" => "DALA-8",
            ]],
            [[
                "id" => 8,
                "equipment_code" => "DALA-8",
                "name" => "Esteira 8",
                "clp_status" => "ONLINE",
                "clp_details" => '{"physical_running":true}',
                "carregamento_state" => "CARREGANDO",
                "planned_quantity" => 10,
                "valid_readings" => 4,
            ]],
            [["result" => "VALIDO", "total" => 4], ["result" => "PRODUTO_INCORRETO", "total" => 1]],
        );

        $summary = (new ServicoMonitoramento($pdo))->obterResumoAlertas(5, 30, 3, 15);

        self::assertSame(["VALIDO" => 4, "PRODUTO_INCORRETO" => 1], $summary["leituras"]);
        self::assertSame("ONLINE", $summary["dispositivos"][0]["status"]);
        self::assertSame("OPERANDO", $summary["maquinas"][0]["operational_status"]);
        self::assertSame(30, $summary["periodo_dias"]);
        self::assertCount(3, $pdo->queries);
        self::assertStringContainsString("FROM leituras l", $pdo->queries[0]);
        self::assertStringNotContainsString("logs_auditoria", implode(" ", $pdo->queries));
    }

    public function testResumoFinalConsultaSomenteLeiturasOcorrenciasRecentesEPendencias(): void
    {
        $occurrences = [["id" => 42, "type" => "PARADA_MAQUINA"]];
        $pdo = new MonitoramentoPdoFake(
            [],
            [],
            [["result" => "VALIDO", "total" => 7]],
            $occurrences,
            3,
        );

        $summary = (new ServicoMonitoramento($pdo))->obterResumoFinal(5, 30);

        self::assertSame(["VALIDO" => 7], $summary["leituras"]);
        self::assertSame($occurrences, $summary["ocorrencias"]);
        self::assertSame(3, $summary["sync_pendente"]);
        self::assertCount(3, $pdo->queries);
        $queries = implode(" ", $pdo->queries);
        self::assertStringContainsString("FROM leituras l", $queries);
        self::assertStringContainsString("FROM ocorrencias o", $queries);
        self::assertStringContainsString("FROM fila_sincronizacao q", $queries);
        self::assertStringNotContainsString("status_dispositivos", $queries);
        self::assertStringNotContainsString("logs_auditoria", $queries);
        self::assertStringNotContainsString("FROM romaneios", $queries);
    }
}

final class MonitoramentoPdoFake extends PDO
{
    /** @var list<string> */
    public array $queries = [];

    /**
     * @param list<array<string,mixed>> $devices
     * @param list<array<string,mixed>> $machines
     * @param list<array<string,mixed>> $readings
     * @param list<array<string,mixed>> $occurrences
     */
    public function __construct(
        private readonly array $devices,
        private readonly array $machines = [],
        private readonly array $readings = [],
        private readonly array $occurrences = [],
        private readonly int $pendingSync = 0,
    ) {
    }

    public function prepare(string $query, array $options = []): PDOStatement|false
    {
        $this->queries[] = $query;
        $rows = str_contains($query, "WITH carregamento_candidato AS")
            ? $this->machines
            : (str_contains($query, "FROM status_dispositivos d")
                ? $this->devices
                : (str_contains($query, "FROM leituras l")
                    ? $this->readings
                    : (str_contains($query, "FROM ocorrencias o")
                        ? $this->occurrences
                        : (str_contains($query, "FROM fila_sincronizacao q")
                            ? [["total" => $this->pendingSync]]
                            : []))));
        return new MonitoramentoStatementFake(
            $rows,
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
