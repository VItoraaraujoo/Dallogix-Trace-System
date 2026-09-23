<?php
declare(strict_types=1);

// O servidor central consulta o heartbeat sincronizado, sem tentar TCP na fábrica.
$scenario = $argv[1] ?? '';
if (!in_array($scenario, ['online', 'stale', 'missing'], true)) {
    throw new RuntimeException('Cenário inválido.');
}
class ConnectivityResponse extends RuntimeException {
    public function __construct(public array $body, public int $status) { parent::__construct('response'); }
}
class ConnectivityStatement extends PDOStatement {
    public function __construct(private string $sql) {}
    public function execute(?array $params = null): bool { return true; }
    public function fetch(int $mode = PDO::FETCH_DEFAULT, int $orientation = PDO::FETCH_ORI_NEXT, int $offset = 0): mixed {
        if (str_contains($this->sql, 'FROM equipamentos')) {
            return ['id' => 7, 'equipment_code' => 'dala', 'plc_ip' => '192.168.1.10', 'plc_port' => 502];
        }
        return false;
    }
    public function fetchColumn(int $column = 0): mixed {
        return $GLOBALS['scenario'] === 'missing' ? false : strtoupper($GLOBALS['scenario'] === 'online' ? 'online' : 'offline');
    }
}
class ConnectivityDatabase extends PDO {
    public function __construct() {}
    public function prepare(string $query, array $options = []): PDOStatement|false {
        $GLOBALS['queries'][] = $query;
        return new ConnectivityStatement($query);
    }
}
$database = new ConnectivityDatabase();
$queries = [];
function db(): PDO { return $GLOBALS['database']; }
function require_session_user(): array { return ['id' => 1, 'role' => 'ADMIN_EMPRESA', 'company_id' => 1]; }
function json_response(array $body, int $status = 200): never { throw new ConnectivityResponse($body, $status); }
function trace_e_instalacao_local(): bool { return false; }
function limite_sinal_clp_segundos(): int { return 3; }

$_SERVER['REQUEST_METHOD'] = 'GET';
$_GET = ['id' => '7', 'check' => 'status'];
$source = (string) file_get_contents(__DIR__ . '/../servidor/api/equipamentos.php');
$source = preg_replace('/^require_once .*;$/m', '', $source);
$source = preg_replace('/\A<\?php\s*/', '', $source, 1);
try {
    eval($source);
    throw new RuntimeException('Resposta ausente.');
} catch (ConnectivityResponse $response) {
    $expected = $scenario === 'online' ? 'ONLINE' : 'OFFLINE';
    if ($response->status !== 200 || ($response->body['data']['status'] ?? null) !== $expected) {
        throw new RuntimeException('Status remoto incorreto.');
    }
    if (count($queries) !== 2 || !str_contains($queries[1], 'status_dispositivos')) {
        throw new RuntimeException('O servidor central não consultou o heartbeat do CLP.');
    }
    echo "OK: conectividade central {$scenario}\n";
}
