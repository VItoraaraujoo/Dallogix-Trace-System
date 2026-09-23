<?php
declare(strict_types=1);

require_once __DIR__ . '/../../scripts/image_storage_path.php';

class CameraUploadResponse extends RuntimeException
{
    public function __construct(public array $body, public int $status)
    {
        parent::__construct('response');
    }
}
class CameraUploadStatement extends PDOStatement
{
    private array $params = [];
    public function __construct(private string $sql) {}
    public function execute(?array $params = null): bool
    {
        $this->params = $params ?? [];
        return true;
    }
    public function fetch(int $mode = PDO::FETCH_DEFAULT, int $orientation = PDO::FETCH_ORI_NEXT, int $offset = 0): mixed
    {
        if (str_contains($this->sql, 'r.reason')) {
            return ($this->params['id'] ?? null) === 42
                ? ['id' => 42, 'carregamento_id' => 5, 'equipment_id' => 7,
                    'reason' => 'SEM_LEITURA', 'company_id' => 1]
                : false;
        }
        return $this->params === [
            'request_id' => 42, 'equipment_id' => 7, 'company_id' => 1, 'device_id' => 3,
        ] ? ['id' => 42] : false;
    }
    public function rowCount(): int { return 1; }
}
class CameraUploadDatabase extends PDO
{
    private bool $transaction = false;
    public function __construct() {}
    public function prepare(string $query, array $options = []): PDOStatement|false
    {
        return new CameraUploadStatement($query);
    }
    public function beginTransaction(): bool { $this->transaction = true; return true; }
    public function commit(): bool { $this->transaction = false; return true; }
    public function rollBack(): bool { $this->transaction = false; return true; }
    public function inTransaction(): bool { return $this->transaction; }
    public function lastInsertId(?string $name = null): string|false { return '99'; }
}
function exigir_metodo_http(array $allowed): void
{
    if (!in_array($_SERVER['REQUEST_METHOD'] ?? '', $allowed, true)) {
        json_response(['error' => 'Método não permitido.'], 405);
    }
}
function require_device_token(array $allowed = []): array
{
    if (($_SERVER['HTTP_X_DEVICE_TOKEN'] ?? '') !== 'test-camera-token') {
        json_response(['error' => 'Token inválido.'], 401);
    }
    return ['id' => 3, 'company_id' => 1, 'equipment_id' => 7];
}
function db(): PDO { return new CameraUploadDatabase(); }
function request_json(): array { return json_decode((string) file_get_contents('php://input'), true, 512, JSON_THROW_ON_ERROR); }
function record_operational_event(mixed ...$args): void {}
function json_response(array $body, int $status = 200): never
{
    throw new CameraUploadResponse($body, $status);
}

$endpoint = str_ends_with((string) ($_SERVER['REQUEST_URI'] ?? ''), '/camera_worker.php')
    ? 'camera_worker.php' : 'camera_upload.php';
$source = (string) file_get_contents(__DIR__ . '/../../servidor/api/' . $endpoint);
$source = preg_replace('/^require_once .*;$/m', '', $source);
$source = str_replace("__DIR__ . '/../../armazenamento'", 'TRACE_CAMERA_TEST_STORAGE', $source);
$source = preg_replace('/\A<\?php\s*/', '', $source, 1);
define('TRACE_CAMERA_TEST_STORAGE', (string) getenv('TRACE_CAMERA_TEST_STORAGE'));
try {
    eval($source);
} catch (CameraUploadResponse $response) {
    http_response_code($response->status);
    header('Content-Type: application/json');
    echo json_encode($response->body, JSON_THROW_ON_ERROR);
}
