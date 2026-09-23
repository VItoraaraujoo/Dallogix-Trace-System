<?php
declare(strict_types=1);

$scenario = $argv[1] ?? '';
if (!in_array($scenario, ['same', 'foreign'], true)) {
    throw new RuntimeException('Cenário inválido.');
}
class SensorResponse extends RuntimeException {
    public function __construct(public array $body, public int $status) { parent::__construct('response'); }
}
class SensorStatement extends PDOStatement {
    public function __construct(private string $sql) {}
    public function execute(?array $params = null): bool {
        if (str_contains($this->sql, 'INSERT INTO eventos_sensor')) {
            $error = new PDOException('Duplicate entry', 23000);
            $error->errorInfo = ['23000', 1062, 'Duplicate entry'];
            throw $error;
        }
        return true;
    }
    public function fetch(int $mode = PDO::FETCH_DEFAULT, int $orientation = PDO::FETCH_ORI_NEXT, int $offset = 0): mixed {
        return str_contains($this->sql, 'FROM carregamentos c') ? ['id' => 4] : false;
    }
    public function fetchColumn(int $column = 0): mixed {
        if (str_contains($this->sql, 'FROM eventos_sensor s')) {
            return $GLOBALS['scenario'] === 'same' ? 42 : false;
        }
        return false;
    }
}
class SensorDatabase extends PDO {
    private bool $transaction = false;
    public function __construct() {}
    public function prepare(string $query, array $options = []): PDOStatement|false { return new SensorStatement($query); }
    public function beginTransaction(): bool { $this->transaction = true; return true; }
    public function rollBack(): bool { $this->transaction = false; return true; }
    public function inTransaction(): bool { return $this->transaction; }
}
$database = new SensorDatabase();
function db(): PDO { return $GLOBALS['database']; }
function exigir_metodo_http(array $allowed): void {}
function require_device_token(array $types = []): array {
    return ['id' => 2, 'company_id' => 1, 'equipment_id' => 7, 'device_code' => 'sensor'];
}
function request_json(): array {
    return ['carregamento_id' => 4, 'equipment_id' => 7,
        'event_uuid' => '11111111-1111-4111-8111-111111111111'];
}
function json_response(array $body, int $status = 200): never { throw new SensorResponse($body, $status); }

$source = (string) file_get_contents(__DIR__ . '/../servidor/api/sensor_eventos.php');
$source = preg_replace('/^require_once .*;$/m', '', $source);
$source = preg_replace('/\A<\?php\s*/', '', $source, 1);
try {
    eval($source);
    throw new RuntimeException('Resposta ausente.');
} catch (SensorResponse $response) {
    if ($scenario === 'same' && ($response->status !== 200 || ($response->body['data']['id'] ?? null) !== 42)) {
        throw new RuntimeException('Retentativa legítima não foi reconhecida.');
    }
    if ($scenario === 'foreign' && ($response->status !== 409 || isset($response->body['data']['id']))) {
        throw new RuntimeException('ID de outro contexto foi exposto.');
    }
    echo "OK: sensor {$scenario}\n";
}
