<?php
declare(strict_types=1);

// Executa o controlador real com PDO simulado; nenhuma conexão é aberta.
$scenario = $argv[1] ?? '';
class Result extends RuntimeException {
    public function __construct(public array $payload, public int $status) { parent::__construct('response'); }
}
class TestStatement extends PDOStatement {
    public function __construct(private string $sql) {}
    public function execute(?array $params = null): bool {
        $GLOBALS['queries'][] = $this->sql;
        return true;
    }
    public function fetch(int $mode = PDO::FETCH_DEFAULT, int $orientation = PDO::FETCH_ORI_NEXT, int $offset = 0): mixed {
        if (str_contains($this->sql, 'FROM usuarios')) return ['id' => 2, 'role' => 'ADMIN_EMPRESA', 'active' => 1];
        if (str_contains($this->sql, 'FROM equipamentos')) return ['id' => 1];
        if (str_contains($this->sql, 'FROM acoes_dala')) return false;
        if (str_contains($this->sql, 'SELECT q.*')) return ['id' => 7, 'status' => 'PENDENTE'];
        throw new RuntimeException('Consulta inesperada: ' . $this->sql);
    }
    public function fetchColumn(int $column = 0): mixed { return 1; }
    public function rowCount(): int { return $GLOBALS['scenario'] === 'sync-reserved' ? 0 : 1; }
}
class TestDatabase extends PDO {
    public string $insertId = '42';
    public function __construct() {}
    public function prepare(string $query, array $options = []): PDOStatement|false { return new TestStatement($query); }
    public function query(string $query, ?int $fetchMode = null, mixed ...$fetchModeArgs): PDOStatement|false { return new TestStatement($query); }
    public function lastInsertId(?string $name = null): string|false { return $this->insertId; }
}
$database = new TestDatabase();
$queries = [];
function db(): PDO { return $GLOBALS['database']; }
function require_session_user(): array { return ['id' => 1, 'role' => 'ADMIN_EMPRESA', 'company_id' => 1]; }
function require_csrf(): void {}
function request_json(): array { return $GLOBALS['input']; }
function json_response(array $payload, int $status = 200): never { throw new Result($payload, $status); }
function record_operational_event(mixed ...$args): void { $GLOBALS['database']->insertId = '999'; }

if ($scenario === 'admin-target') {
    $endpoint = 'usuarios.php';
    $_SERVER['REQUEST_METHOD'] = 'PUT';
    $input = ['id' => 2, 'name' => 'Teste', 'role' => 'SUPERVISOR', 'active' => true];
    $expected = 403;
} elseif ($scenario === 'foreign-action') {
    $endpoint = 'acoes_dala.php';
    $_SERVER['REQUEST_METHOD'] = 'PATCH';
    $input = ['equipment_id' => 1, 'action' => 'trigger', 'trigger_id' => 1, 'acao_id' => 999, 'ativo' => true];
    $expected = 422;
} elseif ($scenario === 'created-id') {
    $endpoint = 'acoes_dala.php';
    $_SERVER['REQUEST_METHOD'] = 'POST';
    $input = ['equipment_id' => 1, 'comando' => 'PAUSAR_CARREGAMENTO', 'rotulo' => 'Parar'];
    $expected = 201;
} elseif ($scenario === 'sync-reserved') {
    $endpoint = 'sync_queue.php';
    $_SERVER['REQUEST_METHOD'] = 'POST';
    $input = ['id' => 7];
    putenv('SYNC_REMOTE_URL=https://example.invalid/events');
    $expected = 409;
} else { throw new RuntimeException('Cenário inválido.'); }
$code = file_get_contents(__DIR__ . '/../servidor/api/' . $endpoint);
$code = preg_replace('/^require_once .*bootstrap\.php";$/m', '', $code);
try {
    eval('?>' . $code);
    throw new RuntimeException('Resposta ausente.');
} catch (Result $result) {
    if ($result->status !== $expected) throw new RuntimeException('Status inesperado: ' . $result->status);
    if ($scenario === 'created-id' && $result->payload['data']['id'] !== 42) throw new RuntimeException('ID não pertence à ação.');
    if (!in_array($scenario, ['created-id', 'sync-reserved'], true)) foreach ($queries as $query) {
        if (str_starts_with($query, 'UPDATE')) throw new RuntimeException('Alteração indevida executada.');
    }
    echo "OK: {$scenario}\n";
}
