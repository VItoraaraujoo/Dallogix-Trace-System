<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');

session_name('dallogix_trace_session');
session_set_cookie_params([
    'httponly' => true,
    'samesite' => 'Lax',
    'secure' => false,
]);
session_start();

function json_response(array $payload, int $status = 200): never
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function db(): PDO
{
    static $connection;
    if ($connection instanceof PDO) return $connection;
    $host = getenv('DB_HOST') ?: 'mysql';
    $name = getenv('DB_NAME') ?: 'trace_local';
    $user = getenv('DB_USER') ?: 'trace';
    $password = getenv('DB_PASSWORD') ?: 'change-me-local';
    $connection = new PDO("mysql:host={$host};dbname={$name};charset=utf8mb4", $user, $password, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    $connection->exec('SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci');
    return $connection;
}

function request_json(): array
{
    $payload = json_decode(file_get_contents('php://input'), true);
    return is_array($payload) ? $payload : [];
}

function session_user(): ?array
{
    return isset($_SESSION['user']) && is_array($_SESSION['user']) ? $_SESSION['user'] : null;
}

function require_session_user(): array
{
    $user = session_user();
    if ($user === null) {
        json_response(['error' => 'Autenticação necessária.'], 401);
    }
    return $user;
}

function public_user(array $user): array
{
    return [
        'id' => (int) $user['id'],
        'name' => $user['name'],
        'email' => $user['email'],
        'role' => $user['role'],
        'company_id' => $user['company_id'] === null ? null : (int) $user['company_id'],
    ];
}

function record_operational_event(PDO $connection, array $user, string $action, string $entityType, int $entityId, array $payload = []): void
{
    $metadata = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '{}';
    try {
        $audit = $connection->prepare('INSERT INTO audit_logs (company_id, user_id, action, entity_type, entity_id, metadata) VALUES (:company_id, :user_id, :action, :entity_type, :entity_id, :metadata)');
        $audit->execute([
            'company_id' => $user['company_id'],
            'user_id' => $user['id'],
            'action' => $action,
            'entity_type' => $entityType,
            'entity_id' => $entityId,
            'metadata' => $metadata,
        ]);

        $eventUuid = sprintf('%s-%s-%s-%s-%s', bin2hex(random_bytes(4)), bin2hex(random_bytes(2)), bin2hex(random_bytes(2)), bin2hex(random_bytes(2)), bin2hex(random_bytes(6)));
        $syncPayload = json_encode(['action' => $action, 'entity_type' => $entityType, 'entity_id' => $entityId, 'data' => $payload], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '{}';
        $queue = $connection->prepare('INSERT INTO sync_queue (event_uuid, aggregate_type, aggregate_id, payload) VALUES (:event_uuid, :aggregate_type, :aggregate_id, :payload)');
        $queue->execute(['event_uuid' => $eventUuid, 'aggregate_type' => $entityType, 'aggregate_id' => $entityId, 'payload' => $syncPayload]);
    } catch (Throwable $exception) {
        error_log('Operational event could not be recorded: ' . $exception->getMessage());
    }
}
