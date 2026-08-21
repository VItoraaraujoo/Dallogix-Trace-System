<?php
declare(strict_types=1);

require_once __DIR__ . '/../config/bootstrap.php';

$user = require_session_user();
if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    json_response(['error' => 'Método não permitido.'], 405);
}
if ($user['company_id'] === null) {
    json_response(['error' => 'Usuário sem empresa vinculada.'], 403);
}

$pdo = db();
$companyId = $user['company_id'];
$query = static function (PDO $pdo, string $sql, array $params): array {
    $statement = $pdo->prepare($sql);
    $statement->execute($params);
    return $statement->fetchAll();
};

$romaneios = $query($pdo, 'SELECT status, COUNT(*) AS total FROM romaneios WHERE company_id = :company_id GROUP BY status', ['company_id' => $companyId]);
$readings = $query($pdo, 'SELECT l.result, COUNT(*) AS total FROM leituras l JOIN carregamentos c ON c.id = l.carregamento_id WHERE c.company_id = :company_id GROUP BY l.result', ['company_id' => $companyId]);
$occurrences = $query($pdo, 'SELECT o.id, o.type, o.quantity, o.description, o.created_at FROM ocorrencias o WHERE o.company_id = :company_id ORDER BY o.id DESC LIMIT 10', ['company_id' => $companyId]);
$audit = $query($pdo, 'SELECT action, entity_type, entity_id, created_at FROM audit_logs WHERE company_id = :company_id ORDER BY id DESC LIMIT 10', ['company_id' => $companyId]);
$pendingSync = $query($pdo, "SELECT COUNT(*) AS total FROM sync_queue q JOIN audit_logs a ON a.entity_type = q.aggregate_type AND a.entity_id = q.aggregate_id WHERE a.company_id = :company_id AND q.status = 'PENDENTE'", ['company_id' => $companyId]);
$devices = $query($pdo, 'SELECT d.device_type, d.status, d.last_seen_at, e.equipment_code FROM device_status d JOIN equipments e ON e.id = d.equipment_id WHERE e.company_id = :company_id ORDER BY d.device_type', ['company_id' => $companyId]);

$romaneioSummary = [];
foreach ($romaneios as $row) $romaneioSummary[$row['status']] = (int) $row['total'];
$readingSummary = [];
foreach ($readings as $row) $readingSummary[$row['result']] = (int) $row['total'];

json_response(['data' => [
    'romaneios' => $romaneioSummary,
    'leituras' => $readingSummary,
    'ocorrencias' => $occurrences,
    'auditoria' => $audit,
    'sync_pendente' => (int) ($pendingSync[0]['total'] ?? 0),
    'dispositivos' => $devices,
]]);
